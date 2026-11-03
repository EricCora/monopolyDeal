import DealEngine
import Foundation
import Observation

/// What a joining phone keeps, so it can take its seat back after a drop or a relaunch.
public struct NearbyGuestSession: Codable, Hashable, Sendable {
    public var tableId: String
    public var hostName: String
    public var seatToken: String

    public init(tableId: String, hostName: String, seatToken: String = UUID().uuidString) {
        self.tableId = tableId
        self.hostName = hostName
        self.seatToken = seatToken
    }
}

/// A seat at someone else's nearby table. Lists the tables close by, joins one, and
/// rejoins by itself whenever the host shows up again after a drop.
@MainActor
@Observable
public final class NearbyGuest {
    public private(set) var tables: [NearbyTableAd] = []
    public private(set) var view: NearbyView?
    public private(set) var link: NearbyLinkState = .idle
    public private(set) var session: NearbyGuestSession?
    /// Set when the host turned this phone away. The seat is gone.
    public private(set) var refusal: NearbyRefusal?
    /// Why the last move was refused.
    public var lastRejection: String?
    public var onSessionChange: ((NearbyGuestSession?) -> Void)?
    /// How far the host's clock is ahead of this phone's, in milliseconds.
    public private(set) var hostClockOffsetMs: Double = 0

    /// The name this phone sits down with. It can change until the game starts.
    public var name: String
    private let transport: NearbyGuestTransport
    private var acceptNextView = true
    /// Looking for tables. Off in the background, so a drop then doesn't start a reconnect.
    private var active = false
    private var retryTask: Task<Void, Never>?

    public static let retryInterval: Duration = .seconds(3)

    public init(transport: NearbyGuestTransport, name: String, session: NearbyGuestSession? = nil) {
        self.transport = transport
        self.name = name
        self.session = session
        transport.onTablesChange = { [weak self] tables in self?.tablesChanged(tables) }
        transport.onLinkChange = { [weak self] state in self?.linkChanged(state) }
        transport.onReceive = { [weak self] data in self?.receive(data) }
    }

    public var isSeated: Bool { session != nil && refusal == nil }

    /// The table this phone's seat is at, if it's in range right now.
    private var ourTable: NearbyTableAd? { session.flatMap { session in tables.first { $0.tableId == session.tableId } } }

    // MARK: Lifecycle

    /// Looks for tables, and rejoins this phone's own as soon as it's found. Safe to call again after a drop.
    public func start() {
        active = true
        transport.startBrowsing()
        if let ourTable, link != .connected { connect(ourTable) }
    }

    /// Lists the tables close by without rejoining one, for the screen that picks a table.
    public func browse() {
        transport.startBrowsing()
    }

    /// Drops the link to the host but keeps listing tables. The seat waits until `join` or `start`.
    public func stepAway() {
        active = false
        retryTask?.cancel()
        retryTask = nil
        transport.stop()
        link = .disconnected
        transport.startBrowsing()
    }

    /// Stops listening, as when the app goes to the background.
    public func stop() {
        active = false
        retryTask?.cancel()
        retryTask = nil
        transport.stop()
        tables = []
        link = .disconnected
    }

    public func join(_ table: NearbyTableAd) {
        refusal = nil
        active = true
        if session?.tableId != table.tableId {
            session = NearbyGuestSession(tableId: table.tableId, hostName: table.hostName)
            onSessionChange?(session)
            view = nil
        }
        connect(table)
    }

    /// Gives the seat up for good. During a game a bot takes it over.
    public func leave() {
        send(.leave)
        forgetSeat()
        // Closing the link at once could drop the message, so the link closes a moment later.
        retryTask?.cancel()
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(600))
            self?.stepAway()
        }
    }

    private func forgetSeat() {
        session = nil
        onSessionChange?(nil)
        view = nil
    }

    private func connect(_ table: NearbyTableAd) {
        guard link != .connecting else { return }
        link = .connecting
        acceptNextView = true
        transport.connect(to: table)
    }

    // MARK: Moves

    public func perform(_ action: Action) {
        guard let view else { return }
        send(.perform(action, revision: view.revision))
    }

    public func undo() {
        guard let view else { return }
        send(.undo(revision: view.revision))
    }

    public func resetTurn() {
        guard let view else { return }
        send(.resetTurn(revision: view.revision))
    }

    private func send(_ message: NearbyGuestMessage) {
        guard link == .connected, let data = try? NearbyCoding.encode(message) else { return }
        transport.send(data)
    }

    // MARK: Transport

    private func tablesChanged(_ next: [NearbyTableAd]) {
        tables = next
        if active, let ourTable, link == .disconnected || link == .idle { connect(ourTable) }
    }

    private func linkChanged(_ state: NearbyLinkState) {
        link = state
        switch state {
        case .connected:
            retryTask?.cancel()
            retryTask = nil
            if let session {
                send(.join(NearbyJoinRequest(name: name, seatToken: session.seatToken)))
            }
        case .disconnected:
            guard isSeated, active else { return }
            // The host may still be listed, for example when only the link dropped. Try again shortly.
            retryTask?.cancel()
            retryTask = Task { [weak self] in
                try? await Task.sleep(for: NearbyGuest.retryInterval)
                guard let self, !Task.isCancelled, self.link == .disconnected, let table = self.ourTable else { return }
                self.connect(table)
            }
        case .idle, .connecting:
            break
        }
    }

    private func receive(_ data: Data) {
        guard let message = try? NearbyCoding.decode(NearbyHostMessage.self, data) else { return }
        switch message {
        case .seated:
            acceptNextView = true
        case .refused(let reason):
            refusal = reason
            forgetSeat()
            stepAway()
        case .view(let next):
            // Messages from one host arrive in order, but a host restored from its save
            // can be a revision behind what this phone last saw, so a rejoin takes what it's given.
            if acceptNextView || next.revision >= (view?.revision ?? 0) || next.tableId != view?.tableId {
                acceptNextView = false
                view = next
                hostClockOffsetMs = next.hostTime - Date().timeIntervalSince1970 * 1000
            }
        case .rejected(let message):
            lastRejection = message
        }
    }
}
