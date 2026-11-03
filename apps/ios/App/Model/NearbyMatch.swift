import DealEngine
import DealNearby
import DealStats
import Foundation
import Observation

/// Records a finished nearby game once, on whichever phone it finished on.
@MainActor
private struct NearbyRecorder {
    private var recordedSignature: String?
    private(set) var summary: PostGameSummary?
    private(set) var unlocked: [AchievementId] = []
    private(set) var newUnlocks: [String] = []

    /// Returns true the first time it sees this game finished.
    mutating func noteFinished(_ game: GameState, viewerId: PlayerId, log: NearbyGameLog?, store: DealStore) -> Bool {
        let signature = "\(Int(game.createdAt)):\(game.winnerId ?? "")"
        guard recordedSignature != signature else { return false }
        recordedSignature = signature
        let before = store.achievements().counters
        let record = store.record(StatsBuilder.matchRecord(game, mode: .nearby, surface: .multiplayer, viewerId: viewerId))
        summary = PostGame.summary(game, lifetime: record.lifetime)
        unlocked = record.unlocked
        newUnlocks = Unlockables.newlyUnlocked(before: before, after: store.achievements().counters)
        if let log {
            let winner = game.players.first { $0.id == game.winnerId }?.name ?? "Nobody"
            // The same id as the match record, so the history can find it.
            store.saveReplay(StoredReplay(id: "\(Int(game.createdAt))-\(Int(game.updatedAt))", endedAt: game.updatedAt, title: "\(winner) won in \(game.turnCount) turns", log: GameLog(initial: log.initial, actions: log.actions)))
        }
        return true
    }

    mutating func clear() {
        summary = nil
        unlocked = []
        newUnlocks = []
    }
}

/// The host's seat at a nearby table. The rules run here, and every change goes out to the other phones.
@MainActor
@Observable
final class NearbyHostMatch: TableSession {
    let host: NearbyHost
    /// The host's own view, refreshed after each change.
    private(set) var view: NearbyView
    private var recorder = NearbyRecorder()
    private let store: DealStore
    private let preferences: () -> Preferences
    private let onFeedback: (Feedback.Tone) -> Void
    private var lastPromptWasMine = false
    private var saveTask: Task<Void, Never>?

    init(table: NearbyTable, store: DealStore, preferences: @escaping () -> Preferences, onFeedback: @escaping (Feedback.Tone) -> Void) {
        let host = NearbyHost(table: table, transport: MultipeerHostTransport(), chooseBotMove: { game, seatId, legal, difficulty in
            await Task.detached(priority: .userInitiated) {
                BotBrain.choose(game, actorId: seatId, legalActions: legal, hard: difficulty == .hard)
            }.value
        })
        self.host = host
        self.store = store
        self.preferences = preferences
        self.onFeedback = onFeedback
        view = host.view
        host.onChange = { [weak self] table in self?.tableChanged(table) }
        tableChanged(table)
    }

    var summary: PostGameSummary? { recorder.summary }
    var unlocked: [AchievementId] { recorder.unlocked }
    var newUnlocks: [String] { recorder.newUnlocks }

    var game: GameState? { view.game }
    var prompt: TurnPrompt? { game.map(Engine.nextPrompt) }
    var legalActions: [LegalAction] { view.legalActions }
    var viewerId: PlayerId? { view.yourSeatId }
    var isPaused: Bool { view.paused }
    var canPause: Bool { false }
    var pauseMessage: String? { view.pauseMessage }
    var pauseDeadline: Date? { nil }
    var canUndo: Bool { view.canUndo }
    var thinkingPlayerId: PlayerId? { host.thinkingSeatId }
    var showsCoach: Bool { preferences().coachEnabled }
    var title: String { "Nearby Table" }
    var botSeatIds: [PlayerId] { view.seats.filter(\.botCovering).map(\.id) }

    var turnClock: TurnClockInfo? {
        view.turnClock.map { TurnClockInfo(playerId: $0.playerId, startedAt: Date(timeIntervalSince1970: $0.startedAt / 1000), deadline: nil) }
    }

    var errorMessage: String? {
        get { host.lastRejection }
        set { if newValue == nil { host.lastRejection = nil } }
    }

    /// The first player who's away can be handed to a bot, so the others don't have to wait.
    var pauseAction: PauseAction? {
        guard let seat = view.awaySeats.first else { return nil }
        let host = host
        return PauseAction(title: "Let a Bot Play for \(seat.name)", systemImage: "cpu.fill") { host.coverWithBot(seat.id) }
    }

    func perform(_ action: Action) {
        host.perform(action)
        onFeedback(host.lastRejection == nil ? .success : .error)
    }

    func undo() { host.undo() }
    func resetTurn() { host.resetTurn() }
    func togglePause() {}

    func start() { host.start() }

    /// Stops listening and saves, as when the app goes to the background. The table comes back with `start`.
    func suspend() {
        host.stop()
        saveNow()
    }

    func saveNow() {
        saveTask?.cancel()
        NearbyVault.saveTable(host.table)
    }

    private func tableChanged(_ table: NearbyTable) {
        view = host.view
        scheduleSave(table)
        let mine = prompt?.playerId == view.yourSeatId && !view.legalActions.isEmpty
        if mine && !lastPromptWasMine && table.game != nil { onFeedback(.turn) }
        lastPromptWasMine = mine
        guard let game = table.game, table.isFinished else {
            recorder.clear()
            return
        }
        if recorder.noteFinished(game, viewerId: view.yourSeatId, log: table.log, store: store) { onFeedback(.win) }
    }

    private func scheduleSave(_ table: NearbyTable) {
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(220))
            if Task.isCancelled { return }
            NearbyVault.saveTable(table)
        }
    }
}

/// A seat at someone else's nearby table, seen through the same interface as a local game.
@MainActor
@Observable
final class NearbyGuestMatch: TableSession {
    let guest: NearbyGuest
    private var recorder = NearbyRecorder()
    private let store: DealStore
    private let preferences: () -> Preferences
    private let onFeedback: (Feedback.Tone) -> Void
    private var lastPromptWasMine = false

    init(guest: NearbyGuest, store: DealStore, preferences: @escaping () -> Preferences, onFeedback: @escaping (Feedback.Tone) -> Void) {
        self.guest = guest
        self.store = store
        self.preferences = preferences
        self.onFeedback = onFeedback
    }

    var summary: PostGameSummary? { recorder.summary }
    var unlocked: [AchievementId] { recorder.unlocked }
    var newUnlocks: [String] { recorder.newUnlocks }

    var view: NearbyView? { guest.view }
    var isLinked: Bool { guest.link == .connected }
    var hostName: String { guest.session?.hostName ?? view?.hostSeat?.name ?? "the host" }

    var game: GameState? { view?.game }
    var prompt: TurnPrompt? { game.map(Engine.nextPrompt) }
    var legalActions: [LegalAction] { isLinked ? view?.legalActions ?? [] : [] }
    var viewerId: PlayerId? { view?.yourSeatId }
    var canPause: Bool { false }
    var pauseDeadline: Date? { nil }
    var canUndo: Bool { isLinked && view?.canUndo == true }
    var thinkingPlayerId: PlayerId? { nil }
    var showsCoach: Bool { preferences().coachEnabled }
    var title: String { "\(hostName)'s Table" }
    var botSeatIds: [PlayerId] { view?.seats.filter(\.botCovering).map(\.id) ?? [] }

    /// Play stops for a player who's away, and on this phone while it's out of touch with the host.
    var isPaused: Bool {
        guard let view, view.started, !view.isFinished else { return false }
        return view.paused || !isLinked
    }

    var pauseMessage: String? {
        isLinked ? view?.pauseMessage : "Reconnecting to \(hostName). Keep the phones close, with Bluetooth and Wi-Fi on."
    }

    var turnClock: TurnClockInfo? {
        guard let clock = view?.turnClock, view?.isFinished == false else { return nil }
        let offset = guest.hostClockOffsetMs
        return TurnClockInfo(playerId: clock.playerId, startedAt: Date(timeIntervalSince1970: (clock.startedAt - offset) / 1000), deadline: nil)
    }

    var errorMessage: String? {
        get { guest.lastRejection }
        set { if newValue == nil { guest.lastRejection = nil } }
    }

    func perform(_ action: Action) {
        guest.perform(action)
        onFeedback(.success)
    }

    func undo() { guest.undo() }
    func resetTurn() { guest.resetTurn() }
    func togglePause() {}

    /// Called when the view changes: nudges on a new prompt, and records a finished game.
    func observeChange() {
        guard let view else { return }
        let mine = prompt?.playerId == view.yourSeatId && !view.legalActions.isEmpty
        if mine && !lastPromptWasMine { onFeedback(.turn) }
        lastPromptWasMine = mine
        guard let game = view.game, view.isFinished else {
            recorder.clear()
            return
        }
        if recorder.noteFinished(game, viewerId: view.yourSeatId, log: view.log, store: store) { onFeedback(.win) }
    }
}

/// Keeps the host's table and a guest's seat token across launches.
enum NearbyVault {
    private static var tableURL: URL {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("nearbyTable.v1.json")
    }

    private static let guestKey = "nearbyGuestSession.v1"

    static func loadTable() -> NearbyTable? {
        (try? Data(contentsOf: tableURL)).flatMap { try? JSONDecoder().decode(NearbyTable.self, from: $0) }
    }

    static func saveTable(_ table: NearbyTable) {
        guard let data = try? JSONEncoder().encode(table) else { return }
        try? data.write(to: tableURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func clearTable() {
        try? FileManager.default.removeItem(at: tableURL)
    }

    static func loadGuestSession() -> NearbyGuestSession? {
        UserDefaults.standard.data(forKey: guestKey).flatMap { try? JSONDecoder().decode(NearbyGuestSession.self, from: $0) }
    }

    static func saveGuestSession(_ session: NearbyGuestSession?) {
        if let session, let data = try? JSONEncoder().encode(session) {
            UserDefaults.standard.set(data, forKey: guestKey)
        } else {
            UserDefaults.standard.removeObject(forKey: guestKey)
        }
    }
}
