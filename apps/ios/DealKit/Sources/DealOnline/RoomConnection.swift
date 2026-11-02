import DealEngine
import Foundation
import Observation

/// Keeps one seat in sync with its room: a live event stream while it holds, polling
/// when it doesn't, and a reconnect when returning from the background. Commands are
/// sent with the last seen revision, and a conflict simply refreshes.
@MainActor
@Observable
public final class RoomConnection {
    public enum Status: Equatable, Sendable {
        case connecting, live, polling, reconnecting, disconnected
    }

    public private(set) var view: RoomView?
    public private(set) var status: Status = .connecting
    public private(set) var session: RoomSession
    /// How far the server's clock is ahead of this device's, in milliseconds.
    public private(set) var serverClockOffsetMs: Double = 0
    public var lastError: OnlineError?
    /// Set when the seat is gone for good. The owner should clear the stored session.
    public private(set) var endedReason: String?
    public var onSessionChange: ((RoomSession) -> Void)?

    private let client: RoomClient
    private var streamTask: Task<Void, Never>?
    private var pollTask: Task<Void, Never>?
    private var keepAliveTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var refreshAgain = false
    private var reclaimingSeat = false
    private var healedRevision: Int?

    public static let pollInterval: Duration = .seconds(2)
    /// A turn-by-turn room moves slowly and runs on someone's free quota, so it looks less often.
    public static let turnRoomPollInterval: Duration = .seconds(30)
    /// The server marks a seat disconnected when it hasn't been seen for a while, and an
    /// open event stream doesn't count, so a quiet room still needs a periodic fetch.
    public static let keepAliveInterval: Duration = .seconds(15)

    public init(client: RoomClient, session: RoomSession) {
        self.client = client
        self.session = session
    }

    private var revision: Int? { view?.revision }

    /// Routine polls of a turn room can be a minute old. Your own move, and a room you've just opened, can't.
    private static let freshReadSeconds = 15.0
    private var freshReadsUntil = Date.distantPast

    private func readFreshForAWhile() {
        if isTurnRoom { freshReadsUntil = Date().addingTimeInterval(Self.freshReadSeconds) }
    }

    private var isTurnRoom: Bool { RoomClient.isTurnRoom(session.roomCode) }

    /// Spectators hold no seat, so there's nothing to reclaim or keep alive.
    private var isSpectator: Bool { session.playerId.hasPrefix("s") }

    /// Turn rooms have no live stream, and a spectator's token doesn't open one.
    private var pollsOnly: Bool { isTurnRoom || isSpectator }

    // MARK: Lifecycle

    /// Reclaims the seat and starts listening. Safe to call again after a drop.
    public func connect() async {
        stop()
        readFreshForAWhile()
        status = view == nil ? .connecting : .reconnecting
        do {
            if !isSpectator {
                let next = try await client.reconnect(session, expectedRevision: revision)
                if next != session {
                    session = next
                    onSessionChange?(next)
                }
            }
            try await fetch()
            lastError = nil
            if pollsOnly {
                status = .live
                startPolling()
            } else {
                startStream()
                startKeepAlive()
            }
        } catch let error as OnlineError {
            handle(error)
            if !error.endsSession { startPolling() }
        } catch {
            status = .disconnected
        }
    }

    public func stop() {
        streamTask?.cancel()
        streamTask = nil
        pollTask?.cancel()
        pollTask = nil
        keepAliveTask?.cancel()
        keepAliveTask = nil
    }

    private func startKeepAlive() {
        keepAliveTask?.cancel()
        keepAliveTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: RoomConnection.keepAliveInterval)
                guard let self, !Task.isCancelled else { return }
                await self.refresh()
            }
        }
    }

    private func startStream() {
        streamTask?.cancel()
        let client = self.client
        let session = self.session
        let lastEventId = view?.lastEventId
        streamTask = Task { [weak self] in
            var first = true
            do {
                for try await event in client.events(session, lastEventId: lastEventId) {
                    guard let self else { return }
                    if first {
                        first = false
                        self.status = .live
                        self.stopPolling()
                    }
                    if self.view.map({ event.revision > $0.revision || event.reason == "typing" || event.reason == "chat" }) ?? true {
                        await self.refresh()
                    }
                }
            } catch {}
            guard let self, !Task.isCancelled else { return }
            self.startPolling()
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { self.startStream() }
        }
        startPolling()
    }

    private func startPolling() {
        guard pollTask == nil else { return }
        if status != .live { status = .polling }
        let interval = isTurnRoom ? RoomConnection.turnRoomPollInterval : RoomConnection.pollInterval
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard let self, !Task.isCancelled else { return }
                await self.refresh()
            }
        }
    }

    private func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    // MARK: State

    private func fetch() async throws {
        let next = try await client.state(session, fresh: Date() < freshReadsUntil)
        // A card this build doesn't know means the server is newer than the app. Stop
        // here with a clear message rather than drawing or rule-checking something unknown.
        if let game = next.gameState, !game.usesOnlyKnownCards { throw OnlineError.updateRequired }
        // Replies can arrive out of order, so an older revision never replaces a newer one.
        if let view, next.revision < view.revision, next.roomCode == view.roomCode { return }
        view = next
        serverClockOffsetMs = next.serverTime - Date().timeIntervalSince1970 * 1000
        if status == .disconnected || status == .reconnecting || status == .connecting {
            status = pollTask == nil ? .live : .polling
        }
    }

    /// Fetches the room, coalescing bursts so only one request runs at a time. It always
    /// returns with state from after the call: callers such as a command's retry rely on that.
    public func refresh() async {
        if let running = refreshTask {
            refreshAgain = true
            await running.value
            return
        }
        let task = Task { await runRefreshes() }
        refreshTask = task
        await task.value
    }

    private func runRefreshes() async {
        defer { refreshTask = nil }
        repeat {
            refreshAgain = false
            do {
                try await fetch()
                lastError = nil
            } catch let error as OnlineError {
                handle(error)
                return
            } catch {
                return
            }
            if view?.yourSeat?.connected == false, view?.hasEnded == false {
                await reclaimSeat()
            }
            // The web client does this too: if it's our prompt with no moves, the view is
            // out of date, so look again now instead of waiting for the next check.
            if let view, view.isAwaitingMissingMoves, healedRevision != view.revision {
                healedRevision = view.revision
                try? await Task.sleep(for: .milliseconds(250))
                refreshAgain = true
            }
        } while refreshAgain
    }

    /// Takes the seat back after the server marked it disconnected, which it does after 20
    /// quiet seconds. A marked seat gets no legal actions and has its commands refused, so
    /// after a network blip this is what makes the game playable again.
    @discardableResult
    private func reclaimSeat() async -> Bool {
        guard !reclaimingSeat else { return false }
        reclaimingSeat = true
        defer { reclaimingSeat = false }
        do {
            let next = try await client.reconnect(session, expectedRevision: revision)
            if next != session {
                session = next
                onSessionChange?(next)
                if streamTask != nil { startStream() }
            }
            try await fetch()
            lastError = nil
            return true
        } catch let error as OnlineError {
            handle(error)
            return false
        } catch {
            return false
        }
    }

    private func handle(_ error: OnlineError) {
        if error.endsSession {
            endedReason = error.errorDescription
            stop()
            status = .disconnected
        } else if error == .networkUnavailable {
            status = .reconnecting
        }
        lastError = error
    }

    // MARK: Commands

    /// Runs a command and refreshes. If the room changed underneath it, a lobby command
    /// such as Ready is simply retried against the new revision. A game move is not,
    /// because the player chose it for a board that no longer exists: they see the new
    /// board and can act again.
    @discardableResult
    public func run(retryIfStale: Bool = true, _ command: @Sendable (RoomClient, RoomSession, Int?) async throws -> Void) async -> Bool {
        readFreshForAWhile()
        do {
            try await command(client, session, revision)
            lastError = nil
            await refresh()
            return true
        } catch let error as OnlineError {
            if error.code == "invalid_session" {
                // The server says this for a disconnected seat as well as a bad token, so
                // the seat isn't lost unless taking it back fails too.
                guard await reclaimSeat() else { return false }
            } else if !error.isStale {
                handle(error)
                return false
            } else {
                await refresh()
            }
            guard retryIfStale else { return false }
            do {
                try await command(client, session, revision)
                lastError = nil
                await refresh()
                return true
            } catch let retryError as OnlineError {
                if !retryError.isStale { handle(retryError) }
                return false
            } catch {
                return false
            }
        } catch {
            return false
        }
    }

    public func perform(_ action: Action) async -> Bool {
        await run(retryIfStale: false) { client, session, revision in
            try await client.apply(session, action: action, expectedRevision: revision)
        }
    }

    public func replay() async throws -> RoomReplayLog {
        try await client.replay(session)
    }

    public func leave(abandon: Bool) async {
        stop()
        _ = try? await client.leave(session, abandon: abandon, expectedRevision: revision)
    }
}

extension GameState {
    /// True when every visible card is in this build's catalog. Cards hidden by the server don't count.
    public var usesOnlyKnownCards: Bool {
        let variant = resolvedVariant
        var cards = discardPile
        for player in players {
            cards += player.hand + player.bank
            for color in PropertyColor.allCases { cards += player.properties[color].map(\.cardId) }
        }
        return cards.allSatisfy { $0 == Catalog.hiddenCardId || Catalog.lookup($0, variant) != nil }
    }
}
