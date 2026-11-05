import DealEngine
import Foundation

/// The host's copy of a nearby table: the seats, the game and its undo history. It has no
/// networking, so tests drive it directly. It plays the part of the room server's room in
/// `apps/server/src/gameService.ts`, with the same masking and undo rules.
public struct NearbyTable: Codable, Hashable, Sendable {
    public struct Seat: Codable, Hashable, Sendable {
        public var id: PlayerId
        public var name: String
        /// Proves a phone owns this seat. Nil for the host and bots.
        var token: String?
        public var isHost: Bool
        public var isBot: Bool
        public var botDifficulty: BotDifficulty?
        public var connected: Bool
        public var botCovering: Bool

        public var isAway: Bool { !connected && !botCovering }

        var shared: NearbySeat {
            NearbySeat(id: id, name: name, isHost: isHost, isBot: isBot, botDifficulty: botDifficulty, connected: connected, botCovering: botCovering)
        }
    }

    public enum MoveError: Error, Equatable, Sendable {
        case noGame, paused, notYourMove, stale
        case rule(String)

        public var message: String {
            switch self {
            case .noGame: "There's no game in progress."
            case .paused: "The game is paused until everyone is back."
            case .notYourMove: "It isn't your move."
            case .stale: "The table changed before your move arrived. Look again and choose."
            case .rule(let message): message
            }
        }
    }

    public let tableId: String
    public private(set) var seats: [Seat]
    public private(set) var variant: GameVariant
    public private(set) var game: GameState?
    public private(set) var log: NearbyGameLog?
    public private(set) var revision = 0
    public private(set) var turnClock: NearbyTurnClock?
    private var snapshots: [GameState] = []
    private var logMarks: [Int] = []

    public static let hostSeatId: PlayerId = "p1"

    public init(hostName: String, tableId: String = UUID().uuidString, variant: GameVariant = .classic) {
        self.tableId = tableId
        self.variant = variant
        seats = [Seat(id: Self.hostSeatId, name: hostName.nearbyName(fallback: "Host"), token: nil, isHost: true, isBot: false, botDifficulty: nil, connected: true, botCovering: false)]
    }

    public var hostName: String { seats[0].name }
    public var isFinished: Bool { game.map { Engine.isGameOver($0).done } ?? false }
    public var canStart: Bool { game == nil && seats.count >= 2 }
    public var isFull: Bool { seats.count >= Nearby.maxSeats }

    /// Play waits while a player's phone is away and no bot is covering for them.
    public var isPaused: Bool { game != nil && !isFinished && seats.contains(where: \.isAway) }

    public func seat(_ id: PlayerId) -> Seat? { seats.first { $0.id == id } }

    public func seatId(forToken token: String) -> PlayerId? { seats.first { $0.token == token }?.id }

    // MARK: Seats

    /// Seats a phone, or gives a returning one its seat back.
    public mutating func join(_ request: NearbyJoinRequest, now: Double) -> Result<PlayerId, NearbyRefusal> {
        guard request.protocolVersion == Nearby.protocolVersion else { return .failure(.versionMismatch) }
        let name = request.name.nearbyName(fallback: "Player")
        if let index = seats.firstIndex(where: { $0.token == request.seatToken }) {
            seats[index].connected = true
            seats[index].botCovering = false
            if game == nil { seats[index].name = name }
            changed()
            return .success(seats[index].id)
        }
        guard game == nil else { return .failure(.gameInProgress) }
        guard !isFull else { return .failure(.tableFull) }
        let id = nextSeatId()
        seats.append(Seat(id: id, name: name, token: request.seatToken, isHost: false, isBot: false, botDifficulty: nil, connected: true, botCovering: false))
        changed()
        return .success(id)
    }

    /// A phone's link dropped. Before the game it simply leaves; during it, its seat waits.
    public mutating func disconnect(_ seatId: PlayerId) {
        guard let index = guestIndex(seatId), seats[index].connected else { return }
        if game == nil {
            seats.remove(at: index)
        } else {
            seats[index].connected = false
        }
        changed()
    }

    /// No phone is linked to a table just restored from a save, whatever it last recorded.
    public mutating func markEveryoneAway() {
        for seat in seats where !seat.isHost && !seat.isBot { disconnect(seat.id) }
    }

    /// A player gave their seat up. During a game a bot takes it over.
    public mutating func leave(_ seatId: PlayerId) {
        guard let index = guestIndex(seatId) else { return }
        if game == nil {
            seats.remove(at: index)
        } else {
            seats[index].connected = false
            seats[index].botCovering = true
        }
        changed()
    }

    /// Before the game starts, the host can take any seat off the table.
    @discardableResult
    public mutating func remove(_ seatId: PlayerId) -> Bool {
        guard game == nil, let index = seats.firstIndex(where: { $0.id == seatId && !$0.isHost }) else { return false }
        seats.remove(at: index)
        changed()
        return true
    }

    @discardableResult
    public mutating func addBot(_ difficulty: BotDifficulty) -> Bool {
        guard game == nil, !isFull else { return false }
        let id = nextSeatId()
        seats.append(Seat(id: id, name: BotNames.random(taken: seats.map(\.name)), token: nil, isHost: false, isBot: true, botDifficulty: difficulty, connected: true, botCovering: false))
        changed()
        return true
    }

    public mutating func setVariant(_ next: GameVariant) {
        guard game == nil, next != variant else { return }
        variant = next
        changed()
    }

    /// Lets a bot play for a player who's away, so the game can go on. They get the seat back when they return.
    @discardableResult
    public mutating func coverWithBot(_ seatId: PlayerId) -> Bool {
        guard game != nil, let index = guestIndex(seatId), seats[index].isAway else { return false }
        seats[index].botCovering = true
        if seats[index].botDifficulty == nil { seats[index].botDifficulty = .easy }
        changed()
        return true
    }

    private func guestIndex(_ seatId: PlayerId) -> Int? {
        seats.firstIndex { $0.id == seatId && !$0.isHost && !$0.isBot }
    }

    private func nextSeatId() -> PlayerId {
        let taken = Set(seats.map(\.id))
        return (1...Nearby.maxSeats).map { "p\($0)" }.first { !taken.contains($0) } ?? "p\(seats.count + 1)"
    }

    // MARK: Game

    public mutating func start(seed: Int? = nil, now: Double) {
        guard canStart || isFinished else { return }
        let players = seats.map {
            PlayerConfig(id: $0.id, name: $0.name, controller: $0.isBot ? .bot : .human, botDifficulty: $0.botDifficulty ?? .easy)
        }
        let fresh = Engine.createGame(GameConfig(players: players, seed: seed, variant: variant))
        game = fresh
        log = NearbyGameLog(initial: fresh, actions: [])
        snapshots = []
        logMarks = []
        turnClock = nil
        syncClock(now: now)
        changed()
    }

    /// Applies a move for a seat. The caller has already checked who's asking: a phone for its own seat, the host for its own and the bots'.
    public mutating func apply(_ action: Action, by seatId: PlayerId, revision expected: Int?, now: Double) -> MoveError? {
        guard let game, !isFinished else { return .noGame }
        guard !isPaused else { return .paused }
        guard action.playerId == seatId else { return .notYourMove }
        if let expected, expected != revision { return .stale }
        let takeSnapshot = Engine.reversibleActionTypes.contains(action.type) && Engine.nextPrompt(game).playerId == seatId
        let result = Engine.applyAction(game, action)
        if let error = result.error { return .rule(error.message) }
        if takeSnapshot {
            snapshots = Engine.appendTurnSnapshot(snapshots, game)
            logMarks.append(log?.actions.count ?? 0)
        }
        log?.actions.append(action)
        let nextPrompt = Engine.nextPrompt(result.state).playerId
        if !Engine.shouldRetainTurnSnapshots(result.state, promptPlayerId: nextPrompt)
            || Engine.actionRevealedDeckCards(before: game, after: result.state, actionType: action.type) {
            snapshots = []
            logMarks = []
        }
        self.game = result.state
        syncClock(now: now)
        changed()
        return nil
    }

    public func canUndo(_ seatId: PlayerId) -> Bool {
        guard let game, !snapshots.isEmpty, !isPaused, !isFinished else { return false }
        return game.players[game.currentPlayerIndex].id == seatId
    }

    public mutating func undo(by seatId: PlayerId, revision expected: Int?) -> MoveError? {
        if let error = checkUndo(seatId, expected) { return error }
        game = snapshots.removeLast()
        if let mark = logMarks.popLast() { log?.actions.removeSubrange(mark...) }
        changed()
        return nil
    }

    public mutating func resetTurn(by seatId: PlayerId, revision expected: Int?) -> MoveError? {
        if let error = checkUndo(seatId, expected) { return error }
        game = snapshots[0]
        if let mark = logMarks.first { log?.actions.removeSubrange(mark...) }
        snapshots = []
        logMarks = []
        changed()
        return nil
    }

    private func checkUndo(_ seatId: PlayerId, _ expected: Int?) -> MoveError? {
        if let expected, expected != revision { return .stale }
        return canUndo(seatId) ? nil : .notYourMove
    }

    /// The seat a bot has to move for right now, if any.
    public var botToMove: (seatId: PlayerId, difficulty: BotDifficulty)? {
        guard let game, !isFinished, !isPaused else { return nil }
        let promptId = Engine.nextPrompt(game).playerId
        guard let seat = seat(promptId), seat.isBot || seat.botCovering else { return nil }
        return (promptId, seat.botDifficulty ?? .easy)
    }

    private mutating func syncClock(now: Double) {
        guard let game, !isFinished else {
            turnClock = nil
            return
        }
        let promptId = Engine.nextPrompt(game).playerId
        if turnClock?.playerId != promptId { turnClock = NearbyTurnClock(playerId: promptId, startedAt: now) }
    }

    private mutating func changed() { revision += 1 }

    // MARK: Views

    /// What one seat is shown. Other hands, the deck and other people's debt cards stay hidden.
    public func view(for seatId: PlayerId, now: Double) -> NearbyView {
        let seat = seat(seatId)
        let canAct = game != nil && !isFinished && !isPaused && (seat?.connected ?? false) && seat?.botCovering != true
        return NearbyView(
            tableId: tableId,
            yourSeatId: seatId,
            seats: seats.map(\.shared),
            variant: variant,
            game: game.map { Self.mask($0, for: seatId) },
            legalActions: canAct ? game.map { Engine.getLegalActions($0, seatId) } ?? [] : [],
            revision: revision,
            canUndo: canUndo(seatId),
            paused: isPaused,
            turnClock: turnClock,
            hostTime: now,
            log: isFinished ? log : nil
        )
    }

    /// Mirrors `maskForViewer` in `apps/server/src/gameService.ts`.
    public static func mask(_ state: GameState, for viewerId: PlayerId) -> GameState {
        var masked = state
        for index in masked.players.indices where masked.players[index].id != viewerId {
            masked.players[index].hand = Array(repeating: Catalog.hiddenCardId, count: masked.players[index].hand.count)
        }
        // A debt repayment card is the debtor's private choice until the creditor resolves it.
        if case .debtCard(var payload) = masked.pending, viewerId != payload.debtorPlayerId, viewerId != payload.creditorPlayerId {
            payload.cardId = Catalog.hiddenCardId
            masked.pending = .debtCard(payload)
        }
        // The deck's order is hidden too. Its length still shows the count.
        masked.drawPile = Array(repeating: Catalog.hiddenCardId, count: masked.drawPile.count)
        return masked
    }
}
