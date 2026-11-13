import DealEngine
import DealOnline
import DealStats
import Foundation
import Observation
import Security

/// A seat in an online room, seen through the same interface as a local game.
@MainActor
@Observable
final class OnlineMatch: TableSession {
    let connection: RoomConnection
    private let store: DealStore
    private let preferences: () -> Preferences
    private let onFeedback: (Feedback.Tone) -> Void
    private var recordedSignature: String?
    private(set) var summary: PostGameSummary?
    private(set) var unlocked: [AchievementId] = []
    private var lastSeenChatId = 0
    private(set) var unreadChat = 0
    var chatOpen = false {
        didSet { if chatOpen { unreadChat = 0 } }
    }
    private var lastPromptWasMine = false
    private(set) var newUnlocks: [String] = []
    private var reactions = ReactionTracker()
    /// The reaction crossing the table right now.
    private(set) var flight: FlyingReaction?

    init(connection: RoomConnection, store: DealStore, preferences: @escaping () -> Preferences, onFeedback: @escaping (Feedback.Tone) -> Void) {
        self.connection = connection
        self.store = store
        self.preferences = preferences
        self.onFeedback = onFeedback
    }

    var view: RoomView? { connection.view }
    var game: GameState? { view?.gameState }
    var prompt: TurnPrompt? { game.map(Engine.nextPrompt) }
    var legalActions: [LegalAction] { view?.legalActions ?? [] }
    /// A spectator has no seat, so every player shows as across the table.
    var viewerId: PlayerId? { view?.isSpectator == true ? nil : view?.yourPlayerId }
    var isSpectating: Bool { view?.isSpectator == true }

    var turnClock: TurnClockInfo? {
        guard let clock = view?.turnClock, game.map({ !Engine.isGameOver($0).done }) == true else { return nil }
        let offset = connection.serverClockOffsetMs
        return TurnClockInfo(
            playerId: clock.playerId,
            startedAt: Date(timeIntervalSince1970: (clock.startedAt - offset) / 1000),
            deadline: clock.deadlineMs.map { Date(timeIntervalSince1970: ($0 - offset) / 1000) }
        )
    }

    var series: MatchSeries? {
        view?.series.map { MatchSeries(bestOf: $0.bestOf, wins: $0.wins, gameNumber: $0.gameNumber, winnerId: $0.winnerId) }
    }

    var botSeatIds: [PlayerId] { view?.botSeatIds ?? [] }
    var isPaused: Bool { view?.paused ?? false }
    var canPause: Bool { view?.canHostTogglePause ?? false }
    var pauseMessage: String? { view?.pauseMessage }
    var thinkingPlayerId: PlayerId? { nil }

    var pauseDeadline: Date? {
        view?.secondsUntilRejoinDeadline.map { Date.now.addingTimeInterval($0) }
    }
    var title: String { "Room \(connection.session.roomCode)" }
    var showsCoach: Bool { preferences().coachEnabled }

    /// The server keeps a snapshot for each step of the turn, and lets only that turn's player use them.
    var canUndo: Bool {
        guard let view, let game, view.turnSnapshotCount > 0, !view.paused else { return false }
        return game.players[game.currentPlayerIndex].id == view.yourPlayerId
    }

    var errorMessage: String? {
        get {
            // The connection pill already shows an outage, so it doesn't need a message too.
            guard let error = connection.lastError, !error.isStale, error != .networkUnavailable else { return nil }
            return error.errorDescription
        }
        set { if newValue == nil { connection.lastError = nil } }
    }

    /// The finished game's moves, to watch it back. Keeps a copy with the local replays.
    func fetchReplay() async -> GameLog? {
        guard let room = try? await connection.replay() else { return nil }
        let log = GameLog(initial: room.initial, actions: room.actions)
        if let game, !isSpectating {
            let winner = game.players.first { $0.id == game.winnerId }?.name ?? "Nobody"
            // The same id as the match record, so the history can find it.
            store.saveReplay(StoredReplay(id: "\(Int(game.createdAt))-\(Int(game.updatedAt))", endedAt: game.updatedAt, title: "\(winner) won in \(game.turnCount) turns", log: log))
        }
        return log
    }

    func perform(_ action: Action) {
        Task {
            let succeeded = await connection.perform(action)
            DevLog.add("online \(action.playerId) \(action.type)\(succeeded ? "" : " failed")")
            onFeedback(succeeded ? .success : .error)
        }
    }

    func undo() {
        Task { await connection.run(retryIfStale: false) { client, session, revision in try await client.undo(session, expectedRevision: revision) } }
    }

    func resetTurn() {
        Task { await connection.run(retryIfStale: false) { client, session, revision in try await client.resetTurn(session, expectedRevision: revision) } }
    }

    func togglePause() {
        let paused = isPaused
        Task {
            await connection.run { client, session, revision in
                if paused {
                    try await client.resume(session, expectedRevision: revision)
                } else {
                    try await client.pause(session, expectedRevision: revision)
                }
            }
        }
    }

    /// Called when the room changes: counts unread chat, nudges on a new prompt, and records a finished match.
    func observeChange() {
        guard let view else { return }
        #if DEBUG
        autoplayIfNeeded(view)
        #endif
        if let latest = view.chatMessages.last?.id, latest > lastSeenChatId {
            if !chatOpen {
                unreadChat += view.chatMessages.filter { $0.id > lastSeenChatId && $0.playerId != view.yourPlayerId }.count
            }
            lastSeenChatId = latest
        }
        if let reaction = reactions.note(view.latestReaction), let kind = reaction.reaction {
            let opponents = view.players.filter { $0.id != view.yourPlayerId }
            let seat = opponents.firstIndex { $0.id == reaction.playerId } ?? 0
            let flying = FlyingReaction(
                reaction: kind,
                playerName: view.players.first { $0.id == reaction.playerId }?.name ?? "",
                fromViewer: reaction.playerId == view.yourPlayerId,
                seatPosition: opponents.count > 1 ? Double(seat) / Double(opponents.count - 1) : 0.5
            )
            flight = flying
            Task {
                try? await Task.sleep(for: .seconds(1.4))
                if self.flight?.id == flying.id { self.flight = nil }
            }
        }
        // A spectator has nothing to be nudged about and no result to record.
        if view.isSpectator { return }
        let mine = prompt?.playerId == view.yourPlayerId && !view.legalActions.isEmpty
        if mine && !lastPromptWasMine { onFeedback(.turn) }
        lastPromptWasMine = mine

        guard let game, Engine.isGameOver(game).done else {
            if view.status == "lobby" {
                summary = nil
                unlocked = []
                newUnlocks = []
            }
            return
        }
        let signature = "\(view.roomCode):\(game.winnerId ?? ""):\(Int(game.createdAt))"
        guard recordedSignature != signature else { return }
        recordedSignature = signature
        let before = store.achievements().counters
        let record = store.record(StatsBuilder.matchRecord(game, mode: .live_online, surface: .multiplayer, presetId: view.presetId.rawValue, roomCode: view.roomCode, viewerId: view.yourPlayerId))
        summary = PostGame.summary(game, lifetime: record.lifetime)
        unlocked = record.unlocked
        newUnlocks = Unlockables.newlyUnlocked(before: before, after: store.achievements().counters)
        // Kept now, so this game can be watched from the history later.
        if view.replayAvailable == true { Task { _ = await fetchReplay() } }
        onFeedback(.win)
    }
}

#if DEBUG
import DealAI

extension OnlineMatch {
    /// Self-play for soak tests: `-autoplayOnlineRoom CODE` joins a room and plays its seat.
    fileprivate func autoplayIfNeeded(_ view: RoomView) {
        guard UserDefaults.standard.string(forKey: "autoplayOnlineRoom") != nil else { return }
        let you = view.players.first { $0.id == view.yourPlayerId }
        if !view.started, you?.ready == false {
            Task { await connection.run { client, session, revision in try await client.setReady(session, ready: true, expectedRevision: revision) } }
            return
        }
        guard let game = view.gameState, !view.legalActions.isEmpty, !view.isFinished else { return }
        let revision = view.revision
        Task {
            try? await Task.sleep(for: .milliseconds(120))
            guard self.view?.revision == revision else { return }
            let choice = Heuristic.choose(game, actorId: view.yourPlayerId, legalActions: view.legalActions)?.action ?? view.legalActions[0].action
            self.perform(choice)
        }
    }
}
#endif

struct FlyingReaction: Identifiable, Equatable {
    let id = UUID()
    var reaction: RoomReaction
    var playerName: String
    var fromViewer: Bool
    /// Where the sender sits across the top of the table, from 0 to 1.
    var seatPosition: Double
}

/// Stores the seat token for a room in the Keychain, so a relaunch can rejoin it.
enum SessionVault {
    private static let account = "active-room-session"
    private static let service = "com.ericcora.monopolydeal.room"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    static func load() -> RoomSession? {
        var search = query
        search[kSecReturnData as String] = true
        search[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(search as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(RoomSession.self, from: data)
    }

    static func save(_ session: RoomSession) {
        guard let data = try? JSONEncoder().encode(session) else { return }
        clear()
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }
}
