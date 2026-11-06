import DealEngine
import DealNearby
import DealOnline
import DealStats
import Foundation
import Observation
import SwiftUI

/// Setup choices for a new local game. Mirrors `SetupViewModel`.
struct GameSetup {
    var variant = GameVariant.classic
    var playerCount = 2
    var names = ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5"]
    var controllers = Array(repeating: PlayerController.human, count: 5)
    var difficulties = Array(repeating: BotDifficulty.easy, count: 5)
    var winCompleteSets = 3
    var maxHandAtEndTurn = 7
    var maxPlaysPerTurn = 3
    var speedMode = false
    var speedSeconds = 45
    var bestOfThree = false

    var ruleset: Ruleset {
        Ruleset(
            winCompleteSets: min(5, max(2, winCompleteSets)),
            maxHandAtEndTurn: min(12, max(4, maxHandAtEndTurn)),
            maxPlaysPerTurn: min(6, max(1, maxPlaysPerTurn))
        )
    }

    /// Clears a default name when a seat becomes a bot, so it draws one at the start, and gives "Player N" back when it stops.
    mutating func setController(_ controller: PlayerController, at index: Int) {
        controllers[index] = controller
        names[index] = BotNames.seatName(names[index], at: index, for: controller)
    }

    var players: [PlayerConfig] {
        let starting = BotNames.startingNames((0..<playerCount).map { (names[$0], controllers[$0]) })
        return (0..<playerCount).map { index in
            PlayerConfig(
                id: "p\(index + 1)",
                name: starting[index],
                controller: controllers[index],
                botDifficulty: difficulties[index]
            )
        }
    }
}

enum AppRoute: Hashable {
    case setup, saved, stats, settings, online, nearby
}

/// App-wide state: navigation, stored data, and the game in progress.
@MainActor
@Observable
final class AppModel {
    let store: DealStore
    var preferences: Preferences {
        didSet { store.savePreferences(preferences) }
    }
    var path: [AppRoute] = []
    var setup = GameSetup()
    var localMatch: LocalMatch?
    var onlineMatch: OnlineMatch?
    var activeGame: ActiveGame?
    var savedSlots: [SavedSlot] = []
    var history: [MatchRecord] = []
    var lifetime = LifetimeStats()
    var achievements = AchievementState()
    var dailyChallenge: DailyChallenge
    var pendingJoinCode: String?
    var storedRoom: RoomSession?
    var onlineError: String?
    var onlineBusy = false
    /// Hosting a nearby table on this phone.
    var nearbyHost: NearbyHostMatch?
    /// A seat at another phone's nearby table, while it's on screen.
    var nearbyGuest: NearbyGuestMatch?
    /// Lists the tables close by. It keeps this phone's seat while the table is off screen.
    var nearbyBrowser: NearbyGuest?
    /// A table this phone was hosting, to continue.
    var savedNearbyTable: NearbyTable?
    /// A finished game opened from a save, shown straight on the results screen.
    var viewedSummary: ViewedSummary?
    /// A saved game opened from the Stats screen, to watch it back.
    var replayToWatch: ReplayRequest?

    struct ViewedSummary: Identifiable {
        let id = UUID()
        var game: GameState
        var summary: PostGameSummary
    }

    let client: RoomClient
    private let launch = LaunchOptions()

    init() {
        let store = DealStore(directory: LaunchOptions().storeDirectory ?? DealStore.defaultDirectory())
        self.store = store
        preferences = store.preferences()
        dailyChallenge = store.dailyChallenge()
        client = RoomClient(
            baseURL: LaunchOptions().serverURL ?? RoomClient.productionURL,
            turnBaseURL: LaunchOptions().serverURL ?? RoomClient.productionTurnURL
        )
        storedRoom = SessionVault.load()
        savedNearbyTable = NearbyVault.loadTable()
        reloadStoredData()
        if launch.resumeOnLaunch { resumeActive() }
        if let route = launch.route { path = [route] }
        #if DEBUG
        // For reviewing themes: `-tableStyle neon_arcade -reducedEffects YES`.
        if let raw = UserDefaults.standard.string(forKey: "tableStyle"), let style = TableTheme(rawValue: raw) { preferences.tableStyle = style }
        if UserDefaults.standard.object(forKey: "reducedEffects") != nil { preferences.reducedEffects = UserDefaults.standard.bool(forKey: "reducedEffects") }
        if UserDefaults.standard.object(forKey: "landscapeTable") != nil { preferences.landscapeTable = UserDefaults.standard.bool(forKey: "landscapeTable") }
        autoplayRemaining = launch.autoplayGames
        if autoplayRemaining > 0 { startFromSetupForAutoplay() }
        if let room = UserDefaults.standard.string(forKey: "autoplayOnlineRoom") {
            preferences.onlineName = "iPhone Auto"
            Task { await joinRoom(code: room) }
        }
        if let role = UserDefaults.standard.string(forKey: "autoplayNearby") { startNearbyAutoplay(role) }
        #endif
    }

    func reloadStoredData() {
        activeGame = store.loadActiveGame()
        savedSlots = store.savedSlots()
        history = store.matchHistory()
        lifetime = store.lifetimeStats()
        achievements = store.achievements()
        dailyChallenge = store.dailyChallenge()
    }

    func feedback(_ tone: Feedback.Tone) {
        Feedback.play(tone, haptics: preferences.hapticsEnabled, sound: preferences.soundEnabled)
    }

    #if DEBUG
    /// Self-play for soak tests. Launch with `-autoplayGames 3 -autoplayVariant no_mercy`.
    private var autoplayRemaining = 0

    private func startFromSetupForAutoplay() {
        setup.variant = launch.autoplayVariant
        setup.playerCount = launch.autoplayPlayers
        // Bots in every other seat keep you at the bottom of the table, for screenshots.
        if UserDefaults.standard.bool(forKey: "autoplayBots") {
            for index in 1..<setup.playerCount { setup.controllers[index] = .bot }
        }
        startFromSetup()
    }

    private func autoplayFinishedGame() {
        autoplayRemaining -= 1
        guard autoplayRemaining > 0 else { return }
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            startFromSetupForAutoplay()
        }
    }
    #endif

    // MARK: Local games

    private func open(_ game: GameState, mode: MatchMode, options: MatchOptions = MatchOptions(), log: GameLog?) {
        localMatch?.stop()
        let match = LocalMatch(
            game: game,
            mode: mode,
            options: options,
            log: log,
            store: store,
            preferences: { [weak self] in self?.preferences ?? Preferences() },
            updatePreferences: { [weak self] change in
                if var prefs = self?.preferences {
                    change(&prefs)
                    self?.preferences = prefs
                }
            },
            onFeedback: { [weak self] tone in self?.feedback(tone) }
        )
        if let delay = launch.botDelay { match.botDelay = delay }
        if let seconds = options.speedSeconds { match.speedTurnSeconds = Double(seconds) }
        if let seconds = launch.speedTurnSeconds { match.speedTurnSeconds = seconds }
        localMatch = match
        #if DEBUG
        if autoplayRemaining > 0 {
            match.autoplayAll = true
            match.onFinished = { [weak self] in self?.autoplayFinishedGame() }
        }
        #endif
        match.start()
    }

    private func newGame(players: [PlayerConfig], variant: GameVariant = .classic, seed: Int? = nil, ruleset: Ruleset? = nil, mode: MatchMode, options: MatchOptions = MatchOptions()) {
        preferences.gamePaused = false
        preferences.pausedGameId = nil
        let game = Engine.createGame(GameConfig(players: players, seed: seed ?? launch.seed, variant: variant, ruleset: ruleset ?? launch.ruleset))
        open(game, mode: mode, options: options, log: GameLog(initial: game))
    }

    func startFromSetup() {
        let hasBot = setup.players.contains { $0.controller == .bot }
        let ruleset = setup.variant == .classic && preferences.customRulesEnabled ? setup.ruleset : nil
        let options = MatchOptions(speed: setup.speedMode, speedSeconds: setup.speedSeconds, series: setup.bestOfThree ? MatchSeries() : nil)
        newGame(players: setup.players, variant: setup.variant, ruleset: ruleset, mode: hasBot ? .practice : .hot_seat, options: options)
    }

    func startPractice(variant: GameVariant = .classic, hard: Bool = false) {
        newGame(players: [
            PlayerConfig(id: "p1", name: "You", controller: .human, botDifficulty: .easy),
            PlayerConfig(id: "p2", name: "House Bot", controller: .bot, botDifficulty: hard ? .hard : .easy),
        ], variant: variant, mode: .practice)
    }

    func startDailyChallenge() {
        let challenge = store.dailyChallenge()
        newGame(players: [
            PlayerConfig(id: "p1", name: "You", controller: .human, botDifficulty: .easy),
            PlayerConfig(id: "p2", name: "Daily Rival", controller: .bot, botDifficulty: .easy),
        ], seed: challenge.seed, mode: .daily_challenge)
    }

    func resumeActive() {
        guard let saved = store.loadActiveGame() else { return }
        openSaved(saved.gameState, mode: saved.matchMode ?? .hot_seat, clearsActive: true)
    }

    func loadSlot(_ slot: SavedSlot) {
        openSaved(slot.gameState, mode: slot.matchMode ?? .hot_seat, clearsActive: false)
    }

    private func openSaved(_ game: GameState, mode: MatchMode, clearsActive: Bool) {
        if Engine.isGameOver(game).done {
            viewedSummary = ViewedSummary(game: game, summary: PostGame.summary(game, lifetime: store.lifetimeStats()))
            if clearsActive { store.clearActiveGame() }
            reloadStoredData()
            return
        }
        open(game, mode: mode, options: store.matchOptions(for: game), log: store.activeReplay(for: game))
    }

    func rematch() {
        guard let match = localMatch, let game = match.game else { return }
        let players = game.players.map {
            PlayerConfig(id: $0.id, name: $0.name, controller: $0.controller ?? .human, botDifficulty: $0.botDifficulty ?? .easy)
        }
        let ruleset = game.variant == .classic ? game.ruleset : nil
        let options = MatchOptions(speed: match.options.speed, speedSeconds: match.options.speedSeconds, series: match.options.series?.next)
        newGame(players: players, variant: game.resolvedVariant, ruleset: ruleset, mode: match.mode == .daily_challenge ? .practice : match.mode, options: options)
    }

    func closeLocalMatch() {
        localMatch?.saveNow()
        localMatch?.stop()
        localMatch = nil
        reloadStoredData()
    }

    // MARK: Save slots

    func slotName(for game: GameState) -> String {
        let names = game.players.map(\.name)
        let prefix = names.count > 1 ? "\(names[0]) vs \(names.dropFirst().joined(separator: ", "))" : names.first ?? "Saved Game"
        let trimmed = prefix.count > 54 ? "\(prefix.prefix(54))..." : prefix
        return "\(trimmed) - Turn \(game.turnCount)"
    }

    /// Saves the running game to a new slot. Returns false when all five are full.
    func saveToNewSlot() -> Bool {
        guard let match = localMatch, let game = match.game else { return false }
        do {
            savedSlots = try store.upsertSlot(name: slotName(for: game), state: game, mode: match.mode)
            return true
        } catch {
            return false
        }
    }

    func overwriteSlot(_ slot: SavedSlot) {
        guard let match = localMatch, let game = match.game else { return }
        savedSlots = (try? store.upsertSlot(id: slot.id, name: slot.name, state: game, mode: match.mode)) ?? savedSlots
    }

    func renameSlot(_ slot: SavedSlot, name: String) {
        savedSlots = store.renameSlot(id: slot.id, name: name)
    }

    func deleteSlot(_ slot: SavedSlot) {
        savedSlots = store.deleteSlot(id: slot.id)
    }

    func clearStats() {
        store.clearStats()
        reloadStoredData()
    }

    // MARK: Online

    private func attach(_ session: RoomSession, remember: Bool = true) async {
        // A spectator holds no seat, so there's nothing to come back to.
        if remember {
            SessionVault.save(session)
            storedRoom = session
        }
        let connection = RoomConnection(client: client, session: session)
        connection.onSessionChange = { SessionVault.save($0) }
        let match = OnlineMatch(
            connection: connection,
            store: store,
            preferences: { [weak self] in self?.preferences ?? Preferences() },
            onFeedback: { [weak self] tone in self?.feedback(tone) }
        )
        onlineMatch = match
        await connection.connect()
        if connection.endedReason != nil {
            onlineError = connection.endedReason
            forgetStoredRoom()
        } else if connection.view == nil {
            onlineError = connection.lastError?.errorDescription ?? OnlineError.networkUnavailable.errorDescription
            connection.stop()
            onlineMatch = nil
        }
    }

    private func onlineName() -> String {
        let trimmed = preferences.onlineName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Player" : String(trimmed.prefix(24))
    }

    func hostRoom() async {
        onlineBusy = true
        onlineError = nil
        defer { onlineBusy = false }
        do {
            await attach(try await client.createRoom(playerName: onlineName()))
            // New live rooms start with bots on. The server's default stays off for older clients.
            await onlineMatch?.connection.run { client, session, revision in
                try await client.setOptions(session, botFill: true, expectedRevision: revision)
            }
        } catch {
            onlineError = error.localizedDescription
        }
    }

    /// A room that lasts for days. Players take their turns when they like.
    func hostTurnRoom() async {
        onlineBusy = true
        onlineError = nil
        defer { onlineBusy = false }
        do {
            await attach(try await client.createTurnRoom(playerName: onlineName()))
        } catch {
            onlineError = error.localizedDescription
        }
    }

    /// Takes a place at the table with every hand hidden.
    func watchRoom(code rawCode: String) async {
        let code = rawCode.uppercased().filter { $0.isLetter || $0.isNumber }
        guard !code.isEmpty else { return }
        onlineBusy = true
        onlineError = nil
        defer { onlineBusy = false }
        do {
            await attach(try await client.watchRoom(code: String(code.prefix(8)), playerName: onlineName()), remember: false)
        } catch {
            onlineError = error.localizedDescription
        }
    }

    func joinRoom(code rawCode: String) async {
        let code = rawCode.uppercased().filter { $0.isLetter || $0.isNumber }
        guard !code.isEmpty else { return }
        onlineBusy = true
        onlineError = nil
        defer { onlineBusy = false }
        do {
            await attach(try await client.joinRoom(code: String(code.prefix(8)), playerName: onlineName()))
        } catch {
            onlineError = error.localizedDescription
        }
    }

    func resumeStoredRoom() async {
        guard let storedRoom else { return }
        onlineBusy = true
        onlineError = nil
        defer { onlineBusy = false }
        await attach(storedRoom)
    }

    /// Exit Match: step away but keep the seat for the grace period.
    func exitRoom() async {
        onlineMatch?.connection.stop()
        onlineMatch = nil
        reloadStoredData()
    }

    /// Forget Room: give the seat up for good.
    func forgetRoom() async {
        await onlineMatch?.connection.leave(abandon: true)
        onlineMatch = nil
        forgetStoredRoom()
        reloadStoredData()
    }

    func forgetStoredRoom() {
        SessionVault.clear()
        storedRoom = nil
    }

    func handleSeatLost() {
        onlineError = onlineMatch?.connection.endedReason
        onlineMatch?.connection.stop()
        onlineMatch = nil
        forgetStoredRoom()
    }

    func scenePhaseChanged(_ phase: ScenePhase) {
        switch phase {
        case .active:
            if let match = onlineMatch { Task { await match.connection.connect() } }
            nearbyHost?.start()
            if nearbyGuest != nil {
                nearbyBrowser?.start()
            } else if path.last == .nearby {
                nearbyBrowser?.browse()
            }
            dailyChallenge = store.dailyChallenge()
        case .background:
            onlineMatch?.connection.stop()
            localMatch?.saveNow()
            // The phone stops listening in the background anyway. The others wait, and rejoin when it's back.
            nearbyHost?.suspend()
            nearbyBrowser?.stop()
        default:
            break
        }
    }

    // MARK: Nearby

    private func nearbyName() -> String {
        let trimmed = preferences.onlineName.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Player" : String(trimmed.prefix(Nearby.maxNameLength))
    }

    /// The Nearby screen is showing: list the tables close by.
    func openNearbyScreen() {
        if nearbyBrowser == nil {
            let browser = NearbyGuest(transport: MultipeerGuestTransport(displayName: nearbyName()), name: nearbyName(), session: NearbyVault.loadGuestSession())
            browser.onSessionChange = { NearbyVault.saveGuestSession($0) }
            nearbyBrowser = browser
        }
        nearbyBrowser?.name = nearbyName()
        guard nearbyHost == nil else { return }
        if nearbyGuest == nil { nearbyBrowser?.browse() }
    }

    func closeNearbyScreen() {
        if nearbyGuest == nil { nearbyBrowser?.stop() }
    }

    /// Hosts a new table, or continues the saved one.
    func hostNearby(continuing: Bool) {
        nearbyBrowser?.stop()
        let table = continuing ? savedNearbyTable ?? NearbyTable(hostName: nearbyName()) : NearbyTable(hostName: nearbyName())
        NearbyVault.saveTable(table)
        savedNearbyTable = table
        let match = NearbyHostMatch(
            table: table,
            store: store,
            preferences: { [weak self] in self?.preferences ?? Preferences() },
            onFeedback: { [weak self] tone in self?.feedback(tone) }
        )
        if let delay = launch.botDelay { match.host.botDelay = delay }
        nearbyHost = match
        match.start()
    }

    /// Leaves the table screen. The others wait, and the table can be continued from the Nearby screen.
    func exitNearbyHost() {
        guard let match = nearbyHost else { return }
        match.suspend()
        savedNearbyTable = match.host.table
        nearbyHost = nil
        reloadStoredData()
        if path.last == .nearby { openNearbyScreen() }
    }

    /// Ends the table for everyone.
    func closeNearbyTable() {
        nearbyHost?.host.close()
        nearbyHost = nil
        discardNearbyTable()
        reloadStoredData()
        if path.last == .nearby { openNearbyScreen() }
    }

    func discardNearbyTable() {
        NearbyVault.clearTable()
        savedNearbyTable = nil
    }

    func joinNearby(_ table: NearbyTableAd) {
        guard let browser = nearbyBrowser else { return }
        browser.name = nearbyName()
        nearbyGuest = NearbyGuestMatch(
            guest: browser,
            store: store,
            preferences: { [weak self] in self?.preferences ?? Preferences() },
            onFeedback: { [weak self] tone in self?.feedback(tone) }
        )
        browser.join(table)
    }

    /// Leaves the table screen but keeps the seat, to rejoin from the Nearby screen.
    func exitNearbyGuest() {
        nearbyBrowser?.stepAway()
        nearbyGuest = nil
        reloadStoredData()
    }

    /// Gives the seat up for good. A bot plays it from here.
    func leaveNearbyTable() {
        nearbyBrowser?.leave()
        nearbyGuest = nil
        reloadStoredData()
    }

    #if DEBUG
    /// Device tests: `-autoplayNearby host` hosts a table and starts once someone joins,
    /// `-autoplayNearby join` joins the first table found. Each phone plays its own seat.
    private func startNearbyAutoplay(_ role: String) {
        preferences.onlineName = role == "host" ? "Auto Host" : "Auto Guest"
        NearbyVault.saveGuestSession(nil)
        if role == "host" {
            discardNearbyTable()
            hostNearby(continuing: false)
            NearbyAutoplay.watchHost(self)
        } else {
            openNearbyScreen()
            NearbyAutoplay.watchGuest(self)
        }
    }
    #endif

    // MARK: Links

    /// Accepts `monopolydeal://join/CODE` and web-style `.../join/CODE` links.
    func open(url: URL) {
        guard let code = RoomInvite.roomCode(from: url) else { return }
        pendingJoinCode = code
        if path.last != .online { path.append(.online) }
    }
}

/// Launch arguments for tests and local development. UserDefaults reads `-name value`
/// arguments automatically, so nothing here affects a normal launch.
struct LaunchOptions {
    private let defaults = UserDefaults.standard

    var serverURL: URL? { defaults.string(forKey: "serverURL").flatMap(URL.init(string:)) }
    var seed: Int? { defaults.object(forKey: "seed") == nil ? nil : defaults.integer(forKey: "seed") }
    var storeDirectory: URL? {
        defaults.string(forKey: "storeDirectory").map { FileManager.default.temporaryDirectory.appendingPathComponent($0, isDirectory: true) }
    }
    var botDelay: Duration? {
        defaults.object(forKey: "botDelayMs") == nil ? nil : .milliseconds(defaults.integer(forKey: "botDelayMs"))
    }
    var speedTurnSeconds: Double? {
        defaults.object(forKey: "speedTurnSeconds") == nil ? nil : defaults.double(forKey: "speedTurnSeconds")
    }
    var ruleset: Ruleset? {
        defaults.object(forKey: "winSets") == nil ? nil : Ruleset(winCompleteSets: defaults.integer(forKey: "winSets"))
    }
    var resumeOnLaunch: Bool { defaults.bool(forKey: "resumeOnLaunch") }
    var autoplayGames: Int { defaults.integer(forKey: "autoplayGames") }
    var autoplayVariant: GameVariant { defaults.string(forKey: "autoplayVariant") == "no_mercy" ? .no_mercy : .classic }
    var autoplayPlayers: Int { max(2, min(5, defaults.integer(forKey: "autoplayPlayers"))) }
    var route: AppRoute? {
        switch defaults.string(forKey: "route") {
        case "setup": .setup
        case "saved": .saved
        case "stats": .stats
        case "settings": .settings
        case "online": .online
        case "nearby": .nearby
        default: nil
        }
    }
}
