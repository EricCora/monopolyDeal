import DealEngine
import XCTest
@testable import DealAI
@testable import DealOnline
@testable import DealStats

final class UnlockablesAndReplayTests: XCTestCase {
    private var directory: URL!
    private var store: DealStore!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        store = DealStore(directory: directory)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func counters(wins: Int = 0, actions: Int = 0, quickWins: Int = 0) -> AchievementState.Counters {
        var counters = AchievementState.Counters()
        counters.wins = wins
        counters.actions = actions
        counters.quickWins = quickWins
        return counters
    }

    private func playedGame(seed: Int = 21) -> (log: GameLog, final: GameState) {
        let initial = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "Ann"), PlayerConfig(id: "b", name: "Bo")], seed: seed))
        var log = GameLog(initial: initial)
        var state = initial
        while !Engine.isGameOver(state).done {
            let prompt = Engine.nextPrompt(state)
            let legal = Engine.getLegalActions(state, prompt.playerId)
            let action = Heuristic.choose(state, actorId: prompt.playerId, legalActions: legal)?.action ?? legal[0].action
            state = Engine.applyAction(state, action).state
            log.actions.append(action)
        }
        return (log, state)
    }

    func testTheOriginalStylesStayFree() {
        let fresh = counters()
        XCTAssertEqual(TableTheme.allCases.filter { $0.isUnlocked(fresh) }, [.premium_tabletop, .classic_green, .neon_arcade])
        XCTAssertEqual(CardBackStyle.allCases.filter { $0.isUnlocked(fresh) }, [.classic_red])
    }

    func testEachRuleMatchesTheWeb() {
        XCTAssertTrue(TableTheme.sunset_lounge.isUnlocked(counters(wins: 1)))
        XCTAssertTrue(TableTheme.royal_velvet.isUnlocked(counters(actions: 100)))
        XCTAssertFalse(TableTheme.royal_velvet.isUnlocked(counters(actions: 99)))
        XCTAssertTrue(TableTheme.midnight_vault.isUnlocked(counters(wins: 10)))
        XCTAssertTrue(CardBackStyle.forest_green.isUnlocked(counters(wins: 5)))
        XCTAssertTrue(CardBackStyle.neon_grid.isUnlocked(counters(quickWins: 1)))
        XCTAssertTrue(CardBackStyle.midnight_gold.isUnlocked(counters(wins: 10)))
    }

    func testOnlyWhatThisGameEarnedIsNamed() {
        XCTAssertEqual(Unlockables.newlyUnlocked(before: counters(), after: counters(wins: 1, actions: 3)), ["Sunset Lounge table style", "Ocean Blue card back"])
        XCTAssertEqual(Unlockables.newlyUnlocked(before: counters(wins: 1), after: counters(wins: 2)), [])
    }

    func testPreferencesWithoutACardBackStillLoad() throws {
        let prefs = try JSONDecoder().decode(Preferences.self, from: Data(#"{"tableStyle":"classic_green"}"#.utf8))
        XCTAssertEqual(prefs.cardBack, .classic_red)
        XCTAssertEqual(prefs.tableStyle, .classic_green)
    }

    func testAReplayRebuildsTheExactGameAcrossASave() throws {
        let played = playedGame()
        store.saveReplay(StoredReplay(id: "g", endedAt: 1, title: "Ann won", log: played.log))
        let stored = try XCTUnwrap(store.replays().first)
        let positions = stored.log.positions()
        XCTAssertEqual(positions.count, played.log.actions.count + 1)
        // Timestamps differ between the two runs; everything that matters must not.
        let last = try XCTUnwrap(positions.last)
        XCTAssertEqual(last.players, played.final.players)
        XCTAssertEqual(last.discardPile, played.final.discardPile)
        XCTAssertEqual(last.winnerId, played.final.winnerId)
        XCTAssertEqual(last.turnCount, played.final.turnCount)
    }

    func testAMoveThatWontApplyEndsTheReplayThere() {
        let initial = playedGame().log.initial
        let bad = Engine.getLegalActions(initial, Engine.nextPrompt(initial).playerId)[0].action
        var wrongPlayer = bad
        wrongPlayer.playerId = "nobody"
        XCTAssertEqual(GameLog(initial: initial, actions: [wrongPlayer]).positions().count, 1)
    }

    func testTheNewestFiveAreKept() {
        let log = playedGame().log
        for index in 0..<7 { store.saveReplay(StoredReplay(id: "g\(index)", endedAt: Double(index), title: "", log: log)) }
        XCTAssertEqual(store.replays().map(\.id), ["g6", "g5", "g4", "g3", "g2"])
    }

    func testAnActiveLogOnlyResumesItsOwnGame() {
        let log = playedGame().log
        store.saveActiveReplay(log)
        XCTAssertNotNil(store.activeReplay(for: log.initial))
        var other = log.initial
        other.createdAt += 1
        XCTAssertNil(store.activeReplay(for: other))
    }

    func testASeriesEndsAtTwoWinsAndThenStartsOver() {
        var series = MatchSeries().recording(winner: "a")
        XCTAssertNil(series.winnerId)
        series = series.next.recording(winner: "b")
        XCTAssertEqual(series.gameNumber, 2)
        XCTAssertNil(series.winnerId)
        series = series.next.recording(winner: "a")
        XCTAssertEqual(series.winnerId, "a")
        XCTAssertEqual(series.wins, ["a": 2, "b": 1])
        XCTAssertEqual(series.next, MatchSeries())
    }

    func testMatchOptionsOnlyApplyToTheirOwnGame() {
        let game = playedGame().log.initial
        store.saveMatchOptions(MatchOptions(speed: true, series: MatchSeries()), for: game)
        XCTAssertTrue(store.matchOptions(for: game).speed)
        var other = game
        other.createdAt += 1
        XCTAssertFalse(store.matchOptions(for: other).speed)
    }

    func testTurnRoomsAreToldApartByTheirCodes() {
        XCTAssertTrue(RoomClient.isTurnRoom("ABCDEF"))
        XCTAssertFalse(RoomClient.isTurnRoom("ABCDE"))
    }
}

final class ReactionTrackerTests: XCTestCase {
    private func reaction(_ id: Int) -> RoomActivity {
        RoomActivity(id: id, createdAt: 0, kind: "reaction", message: "", playerId: "p1", reaction: .wow)
    }

    func testOldReactionsStayStillWhenTheTableOpens() {
        var tracker = ReactionTracker()
        XCTAssertNil(tracker.note(reaction(4)))
    }

    func testARoomsFirstReactionFlies() {
        var tracker = ReactionTracker()
        XCTAssertNil(tracker.note(nil))
        XCTAssertEqual(tracker.note(reaction(1))?.id, 1)
    }

    func testEachReactionFliesOnce() {
        var tracker = ReactionTracker()
        _ = tracker.note(reaction(1))
        XCTAssertEqual(tracker.note(reaction(2))?.id, 2)
        XCTAssertNil(tracker.note(reaction(2)))
    }
}
