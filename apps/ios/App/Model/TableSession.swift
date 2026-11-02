import DealEngine
import DealOnline
import DealStats
import Foundation
import Observation

/// Whose turn the clock is timing, and whether it can run out.
struct TurnClockInfo: Equatable {
    var playerId: PlayerId
    var startedAt: Date
    var deadline: Date?
}

/// What the table screen needs from a game, local or online.
@MainActor
protocol TableSession: AnyObject {
    var game: GameState? { get }
    var prompt: TurnPrompt? { get }
    var legalActions: [LegalAction] { get }
    /// Whose hand and board the player holding the phone is looking at.
    var viewerId: PlayerId? { get }
    var isPaused: Bool { get }
    var canPause: Bool { get }
    /// Why play stopped, when something other than a player's own choice paused it.
    var pauseMessage: String? { get }
    /// When a dropped player's seat is lost, for the countdown on the pause screen.
    var pauseDeadline: Date? { get }
    var canUndo: Bool { get }
    var errorMessage: String? { get set }
    /// A bot working through a long decision, so the wait doesn't look like a freeze.
    var thinkingPlayerId: PlayerId? { get }
    var showsCoach: Bool { get }
    var title: String { get }
    var turnClock: TurnClockInfo? { get }
    var series: MatchSeries? { get }
    /// Watching with every hand hidden, so nothing here is yours to play.
    var isSpectating: Bool { get }
    /// A finished game playing back. Nothing can be played.
    var isReplay: Bool { get }

    func perform(_ action: Action)
    func undo()
    func resetTurn()
    func togglePause()
}

extension TableSession {
    var turnClock: TurnClockInfo? { nil }
    var series: MatchSeries? { nil }
    var isSpectating: Bool { false }
    var isReplay: Bool { false }

    var variant: GameVariant { game?.resolvedVariant ?? .classic }

    var viewer: PlayerState? { viewerId.flatMap { id in game?.players.first { $0.id == id } } }

    /// True when the phone's player is the one the game is waiting on.
    var isViewersPrompt: Bool { prompt != nil && prompt?.playerId == viewerId }

    /// The color a card on the table is currently played as, so a Wild shows that color upright.
    func assignedColor(of cardId: String) -> PropertyColor? {
        for player in game?.players ?? [] {
            for color in PropertyColor.allCases where player.properties[color].contains(where: { $0.cardId == cardId }) {
                return color
            }
        }
        return nil
    }

    func playerName(_ id: PlayerId?) -> String {
        game?.players.first { $0.id == id }?.name ?? "Player"
    }
}

/// Runs a game on this device. Mirrors the local orchestration in `src/App.tsx`.
@MainActor
@Observable
final class LocalMatch: TableSession {
    private(set) var game: GameState?
    private(set) var prompt: TurnPrompt?
    private(set) var legalActions: [LegalAction] = []
    private(set) var mode: MatchMode
    private(set) var turnSnapshots: [GameState] = []
    private(set) var revealedPlayerId: PlayerId?
    private(set) var summary: PostGameSummary?
    private(set) var unlocked: [AchievementId] = []
    private(set) var thinkingPlayerId: PlayerId?
    private(set) var options: MatchOptions
    private(set) var turnClock: TurnClockInfo?
    /// The game so far, for watching it back once it's over. Nil for a game loaded without one.
    private(set) var log: GameLog?
    private(set) var newUnlocks: [String] = []
    var errorMessage: String?

    private var clockRuns = false
    private var clockTask: Task<Void, Never>?
    private var logMarks: [Int] = []
    /// How long a Speed turn lasts. UI tests shorten it.
    var speedTurnSeconds = 45.0
    /// After time runs out, the rest of the turn plays out at this pace.
    static let timedOutStepSeconds = 1.5
    private let store: DealStore
    private let preferences: () -> Preferences
    private let updatePreferences: ((inout Preferences) -> Void) -> Void
    private let onFeedback: (Feedback.Tone) -> Void
    private var botTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?
    private var finalized = false
    /// UI tests shorten the bot's pause so a whole game fits in a test run.
    var botDelay: Duration = .milliseconds(650)
    var active = true
    #if DEBUG
    /// Debug builds can play every seat, to soak-test the real screens: see `LaunchOptions.autoplayGames`.
    var autoplayAll = false
    var onFinished: (() -> Void)?
    #endif

    init(game: GameState, mode: MatchMode, options: MatchOptions = MatchOptions(), log: GameLog? = nil, store: DealStore, preferences: @escaping () -> Preferences, updatePreferences: @escaping ((inout Preferences) -> Void) -> Void, onFeedback: @escaping (Feedback.Tone) -> Void) {
        self.game = game
        self.mode = mode
        self.options = options
        self.log = log
        self.store = store
        self.preferences = preferences
        self.updatePreferences = updatePreferences
        self.onFeedback = onFeedback
        refreshDerived()
    }

    var title: String { mode.label }
    var series: MatchSeries? { options.series }
    var canPause: Bool { true }
    var pauseMessage: String? { nil }
    var pauseDeadline: Date? { nil }
    var canUndo: Bool { !turnSnapshots.isEmpty && !isPaused }

    var showsCoach: Bool {
        preferences().coachEnabled && promptPlayer?.controller != .bot
    }

    var gameId: String { game.map { "\(Int($0.createdAt))" } ?? "" }

    var isPaused: Bool {
        let prefs = preferences()
        return prefs.gamePaused && prefs.pausedGameId == gameId
    }

    private var promptPlayer: PlayerState? {
        prompt.flatMap { prompt in game?.players.first { $0.id == prompt.playerId } }
    }

    private var humans: [PlayerState] { game?.players.filter { $0.controller != .bot } ?? [] }

    /// With a single human there's nobody to hide the hand from.
    private var soleHuman: PlayerState? { humans.count == 1 ? humans[0] : nil }

    var viewerId: PlayerId? {
        if let soleHuman { return soleHuman.id }
        guard let prompt else { return revealedPlayerId }
        return revealedPlayerId == prompt.playerId ? prompt.playerId : nil
    }

    /// Pass-and-play hides the table until the next player taps to reveal.
    var shouldShowShield: Bool {
        guard let game, let prompt, soleHuman == nil else { return false }
        return promptPlayer?.controller != .bot
            && !Engine.isGameOver(game).done
            && revealedPlayerId != prompt.playerId
    }

    var isGameOver: Bool { game.map { Engine.isGameOver($0).done } ?? false }

    func reveal() {
        revealedPlayerId = prompt?.playerId
        syncClock()
    }

    // MARK: Lifecycle

    func start() {
        active = true
        scheduleBotIfNeeded()
        syncClock()
    }

    func stop() {
        active = false
        botTask?.cancel()
        botTask = nil
        clockTask?.cancel()
        clockTask = nil
        turnClock = nil
    }

    private func refreshDerived() {
        guard let game else {
            prompt = nil
            legalActions = []
            return
        }
        let next = Engine.nextPrompt(game)
        prompt = next
        legalActions = Engine.getLegalActions(game, next.playerId)
    }

    private func scheduleSave() {
        guard let game, !Engine.isGameOver(game).done else { return }
        let store = self.store
        let mode = self.mode
        let log = self.log
        let options = self.options
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(for: .milliseconds(220))
            if Task.isCancelled { return }
            store.saveActiveGame(game, mode: mode)
            store.saveActiveReplay(log)
            store.saveMatchOptions(options, for: game)
        }
    }

    func saveNow() {
        saveTask?.cancel()
        guard let game, !Engine.isGameOver(game).done else { return }
        store.saveActiveGame(game, mode: mode)
        store.saveActiveReplay(log)
        store.saveMatchOptions(options, for: game)
    }

    // MARK: Actions

    private static let reversible: Set<ActionType> = [.draw_cards, .play_to_bank, .play_property, .play_action, .move_wild, .repay_debt]

    private func shouldRetainSnapshots(_ state: GameState, promptPlayerId: PlayerId) -> Bool {
        if Engine.isGameOver(state).done { return false }
        guard state.turn.phase == .action || (state.variant == .no_mercy && state.turn.phase == .debt) else { return false }
        guard state.players[state.currentPlayerIndex].id == promptPlayerId else { return false }
        switch state.pending {
        case nil, .rent, .slyDeal, .forcedDeal, .dealBreaker, .debtCard, .noMercy: return true
        case .counter, .payment: return false
        }
    }

    func perform(_ action: Action) {
        guard let game, !isPaused else { return }
        let takeSnapshot = Self.reversible.contains(action.type) && prompt?.playerId == action.playerId
        let result = Engine.applyAction(game, action)
        if let error = result.error {
            errorMessage = error.message
            onFeedback(.error)
            return
        }
        onFeedback(.success)
        errorMessage = nil
        let previousPrompt = prompt?.playerId
        let nextPrompt = Engine.nextPrompt(result.state).playerId
        if previousPrompt != nextPrompt { revealedPlayerId = nil }
        if takeSnapshot {
            turnSnapshots = Engine.appendTurnSnapshot(turnSnapshots, game)
            logMarks.append(log?.actions.count ?? 0)
        }
        log?.actions.append(action)
        if !shouldRetainSnapshots(result.state, promptPlayerId: nextPrompt)
            || Engine.actionRevealedDeckCards(before: game, after: result.state, actionType: action.type) {
            turnSnapshots = []
            logMarks = []
        }
        self.game = result.state
        refreshDerived()
        scheduleSave()
        finalizeIfGameOver(result.state)
        scheduleBotIfNeeded()
        syncClock()
    }

    func undo() {
        guard !isPaused, let previous = turnSnapshots.last else { return }
        turnSnapshots.removeLast()
        if let mark = logMarks.popLast() { log?.actions.removeSubrange(mark...) }
        game = previous
        errorMessage = nil
        refreshDerived()
        scheduleSave()
    }

    func resetTurn() {
        guard !isPaused, let first = turnSnapshots.first else { return }
        turnSnapshots = []
        if let mark = logMarks.first { log?.actions.removeSubrange(mark...) }
        logMarks = []
        game = first
        errorMessage = nil
        refreshDerived()
        scheduleSave()
    }

    func togglePause() {
        let id = gameId
        let pausing = !isPaused
        updatePreferences {
            $0.gamePaused = pausing
            $0.pausedGameId = pausing ? id : nil
        }
        if pausing {
            botTask?.cancel()
            botTask = nil
        } else {
            scheduleBotIfNeeded()
        }
        syncClock()
    }

    // MARK: Clock

    /// Every game shows a turn clock. Speed games also run out, and then a bot moves.
    private func syncClock() {
        guard active, let game, let prompt, !Engine.isGameOver(game).done else {
            clockTask?.cancel()
            clockTask = nil
            turnClock = nil
            return
        }
        let runs = options.speed && promptPlayer?.controller != .bot && !shouldShowShield && !isPaused
        if turnClock?.playerId == prompt.playerId && runs == clockRuns { return }
        clockRuns = runs
        let now = Date.now
        turnClock = TurnClockInfo(playerId: prompt.playerId, startedAt: now, deadline: runs ? now.addingTimeInterval(speedTurnSeconds) : nil)
        scheduleExpiry()
    }

    private func scheduleExpiry() {
        clockTask?.cancel()
        clockTask = nil
        guard let deadline = turnClock?.deadline else { return }
        clockTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(max(0, deadline.timeIntervalSinceNow)))
            if Task.isCancelled { return }
            self?.timeRanOut()
        }
    }

    private func timeRanOut() {
        guard let game, let prompt, !legalActions.isEmpty else { return }
        let owner = prompt.playerId
        perform(BotBrain.choose(game, actorId: owner, legalActions: legalActions, hard: false))
        // If it's still this player's decision, the next step follows shortly.
        guard clockRuns, turnClock?.playerId == owner, self.prompt?.playerId == owner else { return }
        turnClock?.deadline = Date.now.addingTimeInterval(Self.timedOutStepSeconds)
        scheduleExpiry()
    }

    // MARK: Bots

    private func scheduleBotIfNeeded() {
        botTask?.cancel()
        botTask = nil
        guard active, !isPaused, let game, let prompt, !Engine.isGameOver(game).done,
              let player = promptPlayer, !legalActions.isEmpty else { return }
        #if DEBUG
        if autoplayAll { revealedPlayerId = prompt.playerId }
        guard player.controller == .bot || autoplayAll else { return }
        #else
        guard player.controller == .bot else { return }
        #endif
        let legal = legalActions
        let actorId = prompt.playerId
        let hard = player.botDifficulty == .hard
        let delay = botDelay
        botTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            if Task.isCancelled { return }
            // A hard bot simulates thousands of moves, so it thinks off the main thread.
            if hard { self?.thinkingPlayerId = actorId }
            let action = await Task.detached(priority: .userInitiated) {
                BotBrain.choose(game, actorId: actorId, legalActions: legal, hard: hard)
            }.value
            self?.thinkingPlayerId = nil
            if Task.isCancelled { return }
            self?.perform(action)
        }
    }

    // MARK: Finish

    private func finalizeIfGameOver(_ state: GameState) {
        guard !finalized, Engine.isGameOver(state).done else { return }
        finalized = true
        let before = store.achievements().counters
        let record = store.record(StatsBuilder.matchRecord(state, mode: mode, surface: .local))
        summary = PostGame.summary(state, lifetime: record.lifetime)
        unlocked = record.unlocked
        newUnlocks = Unlockables.newlyUnlocked(before: before, after: store.achievements().counters)
        if let log {
            let winner = state.players.first { $0.id == state.winnerId }?.name ?? "Nobody"
            store.saveReplay(StoredReplay(id: "\(Int(state.createdAt))-\(Int(state.updatedAt))", endedAt: state.updatedAt, title: "\(winner) won in \(state.turnCount) turns", log: log))
        }
        store.saveActiveReplay(nil)
        if let winnerId = state.winnerId, let series = options.series { options.series = series.recording(winner: winnerId) }
        store.clearActiveGame()
        saveTask?.cancel()
        turnSnapshots = []
        onFeedback(.win)
        #if DEBUG
        onFinished?()
        #endif
    }
}

import DealAI

enum BotBrain {
    nonisolated static func choose(_ game: GameState, actorId: PlayerId, legalActions: [LegalAction], hard: Bool) -> Action {
        let decision = hard
            ? MonteCarlo.choose(game, actorId: actorId, legalActions: legalActions, simulations: 18, depth: 11, timeBudget: .seconds(2.5))
            : Heuristic.choose(game, actorId: actorId, legalActions: legalActions)
        if let action = decision?.action, legalActions.contains(where: { $0.action == action }) { return action }
        return legalActions[0].action
    }
}
