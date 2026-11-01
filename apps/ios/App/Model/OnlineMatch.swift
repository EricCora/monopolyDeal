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
    var viewerId: PlayerId? { view?.yourPlayerId }
    var isPaused: Bool { view?.paused ?? false }
    var canPause: Bool { view?.canHostTogglePause ?? false }
    var pauseMessage: String? { view?.pauseMessage }

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

    func perform(_ action: Action) {
        Task {
            let succeeded = await connection.perform(action)
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
        let mine = prompt?.playerId == view.yourPlayerId && !view.legalActions.isEmpty
        if mine && !lastPromptWasMine { onFeedback(.turn) }
        lastPromptWasMine = mine

        guard let game, Engine.isGameOver(game).done else {
            if view.status == "lobby" {
                summary = nil
                unlocked = []
            }
            return
        }
        let signature = "\(view.roomCode):\(game.winnerId ?? ""):\(Int(game.createdAt))"
        guard recordedSignature != signature else { return }
        recordedSignature = signature
        let record = store.record(StatsBuilder.matchRecord(game, mode: .live_online, surface: .multiplayer, presetId: view.presetId.rawValue, roomCode: view.roomCode))
        summary = PostGame.summary(game, lifetime: record.lifetime)
        unlocked = record.unlocked
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
