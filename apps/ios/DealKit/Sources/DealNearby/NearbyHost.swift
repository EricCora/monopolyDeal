import DealEngine
import Foundation
import Observation

/// Picks a bot's move. The app supplies its bots, so this package doesn't decide how hard they think.
public typealias NearbyBotChooser = @Sendable (GameState, PlayerId, [LegalAction], BotDifficulty) async -> Action

/// Runs a nearby table on the host's phone: answers the phones that join, applies their
/// moves, plays the bots and sends every phone its own view after each change.
@MainActor
@Observable
public final class NearbyHost {
    public private(set) var table: NearbyTable
    /// Why the host's own last move was refused.
    public var lastRejection: String?
    /// A bot working through a long decision, so the wait doesn't look like a freeze.
    public private(set) var thinkingSeatId: PlayerId?
    /// Called after every change, for saving and stats.
    public var onChange: ((NearbyTable) -> Void)?
    public var botDelay: Duration = .milliseconds(650)
    public var clock: () -> Double = { Date().timeIntervalSince1970 * 1000 }

    private let transport: NearbyHostTransport
    private let chooseBotMove: NearbyBotChooser
    private var peerSeats: [NearbyPeer: PlayerId] = [:]
    private var botTask: Task<Void, Never>?
    private var running = false

    public init(table: NearbyTable, transport: NearbyHostTransport, chooseBotMove: @escaping NearbyBotChooser) {
        var table = table
        table.markEveryoneAway()
        self.table = table
        self.transport = transport
        self.chooseBotMove = chooseBotMove
        transport.onConnect = { _ in }
        transport.onDisconnect = { [weak self] peer in self?.peerDropped(peer) }
        transport.onReceive = { [weak self] peer, data in self?.receive(data, from: peer) }
    }

    public var hostSeatId: PlayerId { NearbyTable.hostSeatId }
    public var view: NearbyView { table.view(for: hostSeatId, now: clock()) }

    // MARK: Lifecycle

    /// Shows the table to phones close by. Called again after returning from the background.
    public func start() {
        guard !running else { return }
        running = true
        transport.start(tableId: table.tableId, hostName: table.hostName)
        scheduleBot()
    }

    /// Stops listening, as when the app goes to the background. Phones at the table rejoin after `start`.
    public func stop() {
        running = false
        botTask?.cancel()
        botTask = nil
        thinkingSeatId = nil
        transport.stop()
        let dropped = peerSeats.values
        peerSeats = [:]
        for seatId in dropped { table.disconnect(seatId) }
        if !dropped.isEmpty { onChange?(table) }
    }

    /// Ends the table for everyone.
    public func close() {
        for peer in peerSeats.keys { send(.refused(.closed), to: peer) }
        stop()
    }

    // MARK: Host controls

    public func perform(_ action: Action) {
        if let error = table.apply(action, by: hostSeatId, revision: nil, now: clock()) {
            lastRejection = error.message
            return
        }
        lastRejection = nil
        changed()
    }

    public func undo() {
        if table.undo(by: hostSeatId, revision: nil) == nil { changed() }
    }

    public func resetTurn() {
        if table.resetTurn(by: hostSeatId, revision: nil) == nil { changed() }
    }

    public func setVariant(_ variant: GameVariant) {
        table.setVariant(variant)
        changed()
    }

    public func addBot(_ difficulty: BotDifficulty) {
        if table.addBot(difficulty) { changed() }
    }

    /// Takes a seat off the table before the game, telling its phone why.
    public func remove(_ seatId: PlayerId) {
        guard table.remove(seatId) else { return }
        for (peer, seat) in peerSeats where seat == seatId {
            send(.refused(.removed), to: peer)
            peerSeats[peer] = nil
            transport.disconnect(peer)
        }
        changed()
    }

    public func coverWithBot(_ seatId: PlayerId) {
        if table.coverWithBot(seatId) { changed() }
    }

    /// Deals a new game with the same seats: the first one, or a rematch.
    public func startGame(seed: Int? = nil) {
        table.start(seed: seed, now: clock())
        changed()
    }

    // MARK: Messages

    private func receive(_ data: Data, from peer: NearbyPeer) {
        guard let message = try? NearbyCoding.decode(NearbyGuestMessage.self, data) else { return }
        let now = clock()
        switch message {
        case .join(let request):
            switch table.join(request, now: now) {
            case .success(let seatId):
                // The same phone on a new link: the old link is stale.
                for (other, seat) in peerSeats where seat == seatId && other != peer { peerSeats[other] = nil }
                peerSeats[peer] = seatId
                send(.seated(seatId: seatId), to: peer)
                changed()
            case .failure(let refusal):
                send(.refused(refusal), to: peer)
            }
        case .perform(let action, let revision):
            guard let seatId = peerSeats[peer] else { return }
            answer(peer, seatId, table.apply(action, by: seatId, revision: revision, now: now))
        case .undo(let revision):
            guard let seatId = peerSeats[peer] else { return }
            answer(peer, seatId, table.undo(by: seatId, revision: revision))
        case .resetTurn(let revision):
            guard let seatId = peerSeats[peer] else { return }
            answer(peer, seatId, table.resetTurn(by: seatId, revision: revision))
        case .leave:
            guard let seatId = peerSeats.removeValue(forKey: peer) else { return }
            table.leave(seatId)
            transport.disconnect(peer)
            changed()
        }
    }

    private func answer(_ peer: NearbyPeer, _ seatId: PlayerId, _ error: NearbyTable.MoveError?) {
        if let error {
            send(.rejected(message: error.message), to: peer)
            send(.view(table.view(for: seatId, now: clock())), to: peer)
        } else {
            changed()
        }
    }

    private func peerDropped(_ peer: NearbyPeer) {
        guard let seatId = peerSeats.removeValue(forKey: peer) else { return }
        table.disconnect(seatId)
        changed()
    }

    private func send(_ message: NearbyHostMessage, to peer: NearbyPeer) {
        guard let data = try? NearbyCoding.encode(message) else { return }
        transport.send(data, to: peer)
    }

    private func changed() {
        let now = clock()
        for (peer, seatId) in peerSeats { send(.view(table.view(for: seatId, now: now)), to: peer) }
        onChange?(table)
        scheduleBot()
    }

    // MARK: Bots

    private func scheduleBot() {
        botTask?.cancel()
        botTask = nil
        thinkingSeatId = nil
        guard running, let (seatId, difficulty) = table.botToMove, let game = table.game else { return }
        let legal = Engine.getLegalActions(game, seatId)
        guard !legal.isEmpty else { return }
        let revision = table.revision
        let delay = botDelay
        let choose = chooseBotMove
        botTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            if Task.isCancelled { return }
            if difficulty == .hard { self?.thinkingSeatId = seatId }
            let action = await choose(game, seatId, legal, difficulty)
            guard let self, !Task.isCancelled, self.table.revision == revision else { return }
            self.thinkingSeatId = nil
            let now = self.clock()
            // A bot's choice is always legal; the first legal move keeps the game going if it ever isn't.
            if self.table.apply(action, by: seatId, revision: revision, now: now) != nil,
               self.table.apply(legal[0].action, by: seatId, revision: revision, now: now) != nil {
                return
            }
            self.changed()
        }
    }
}
