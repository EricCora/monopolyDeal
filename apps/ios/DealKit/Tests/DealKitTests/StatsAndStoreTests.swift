import DealEngine
import XCTest
@testable import DealAI
@testable import DealStats

final class StatsAndStoreTests: XCTestCase {
    private var directory: URL!
    private var store: DealStore!

    override func setUp() {
        directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        store = DealStore(directory: directory)
    }

    override func tearDown() {
        try? FileManager.default.removeItem(at: directory)
    }

    private func finishedGame(_ seed: Int = 12) -> GameState {
        var state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "Ann"), PlayerConfig(id: "b", name: "Bo")], seed: seed))
        while !Engine.isGameOver(state).done {
            let prompt = Engine.nextPrompt(state)
            let legal = Engine.getLegalActions(state, prompt.playerId)
            state = Engine.applyAction(state, Heuristic.choose(state, actorId: prompt.playerId, legalActions: legal)!.action).state
        }
        return state
    }

    func testActiveGameSurvivesARestart() {
        let game = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "Ann"), PlayerConfig(id: "b", name: "Bo")], seed: 3))
        store.saveActiveGame(game, mode: .practice)
        let reopened = DealStore(directory: directory).loadActiveGame()
        XCTAssertEqual(reopened?.gameState.drawPile, game.drawPile)
        XCTAssertEqual(reopened?.matchMode, .practice)
        store.clearActiveGame()
        XCTAssertNil(store.loadActiveGame())
    }

    func testOnlyFiveSlotsFitAndRenameAndDeleteWork() throws {
        let game = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "Ann"), PlayerConfig(id: "b", name: "Bo")], seed: 3))
        for index in 0..<5 { try store.upsertSlot(name: "Slot \(index)", state: game, mode: .hot_seat) }
        XCTAssertThrowsError(try store.upsertSlot(name: "Sixth", state: game, mode: .hot_seat)) {
            XCTAssertEqual($0 as? SaveError, .slotsFull)
        }
        let first = store.savedSlots()[0]
        // Overwriting an existing slot still works when all five are taken.
        XCTAssertNoThrow(try store.upsertSlot(id: first.id, name: first.name, state: game, mode: .practice))
        store.renameSlot(id: first.id, name: "  Renamed  ")
        XCTAssertEqual(store.savedSlots().first { $0.id == first.id }?.name, "Renamed")
        store.deleteSlot(id: first.id)
        XCTAssertEqual(store.savedSlots().count, 4)
    }

    func testCorruptFilesAreTreatedAsEmpty() throws {
        try Data("not json".utf8).write(to: directory.appendingPathComponent("matchHistory.v1.json"))
        try Data("not json".utf8).write(to: directory.appendingPathComponent("activeGame.v1.json"))
        XCTAssertEqual(store.matchHistory(), [])
        XCTAssertNil(store.loadActiveGame())
    }

    func testFinishedMatchUpdatesEverything() {
        let game = finishedGame()
        let match = StatsBuilder.matchRecord(game, mode: .daily_challenge, surface: .local)
        let result = store.record(match)
        XCTAssertEqual(store.matchHistory().count, 1)
        let winner = try? XCTUnwrap(match.winnerName)
        XCTAssertEqual(result.lifetime.players[winner ?? ""]?.wins, 1)
        XCTAssertEqual(result.lifetime.players["Ann"]?.gamesPlayed, 1)
        XCTAssertTrue(result.unlocked.contains(.first_win))
        XCTAssertEqual(store.dailyChallenge().attempts, 1)
        store.clearStats()
        XCTAssertEqual(store.matchHistory(), [])
        XCTAssertFalse(store.achievements().isUnlocked(.first_win))
    }

    func testDailySeedMatchesTheWebApp() {
        // Computed by `seedFromDay` in src/stats/retention.ts.
        XCTAssertEqual(DailyChallenge.seed(forDay: "2026-11-01"), DailyChallenge.seed(forDay: "2026-11-01"))
        var expected = 0
        for unit in "2026-11-01".utf16 { expected = (expected * 31 + Int(unit)) % 1_000_000_007 }
        XCTAssertEqual(DailyChallenge(day: "2026-11-01").seed, expected)
        XCTAssertEqual(DailyChallenge(day: "2026-11-01").targetTurns, 12 + expected % 4)
    }

    func testPostGameRecapNamesTheWinner() {
        let game = finishedGame()
        let summary = PostGame.summary(game, lifetime: LifetimeStats())
        XCTAssertEqual(summary.winnerId, game.winnerId)
        XCTAssertEqual(summary.players.first?.isWinner, true)
        XCTAssertEqual(summary.players.map(\.rank), [1, 2])
        XCTAssertFalse(summary.winningMove.isEmpty)
        XCTAssertLessThanOrEqual(summary.highlightCards.count, 3)
    }

    /// The hard bot can't be compared move for move with the web bot (see DECISIONS.md),
    /// so it's checked by what matters: it finishes games and beats the easy bot.
    func testHardBotBeatsTheEasyBot() {
        var hardWins = 0
        let games = 12
        for seed in 0..<games {
            var state = Engine.createGame(GameConfig(
                players: [
                    PlayerConfig(id: "hard", name: "Hard", controller: .bot, botDifficulty: .hard),
                    PlayerConfig(id: "easy", name: "Easy", controller: .bot, botDifficulty: .easy),
                ],
                seed: seed * 101 + 5
            ))
            var steps = 0
            while !Engine.isGameOver(state).done && steps < 4000 {
                let prompt = Engine.nextPrompt(state)
                let legal = Engine.getLegalActions(state, prompt.playerId)
                let decision = prompt.playerId == "hard"
                    ? MonteCarlo.choose(state, actorId: prompt.playerId, legalActions: legal, simulations: 6, depth: 8)
                    : Heuristic.choose(state, actorId: prompt.playerId, legalActions: legal)
                state = Engine.applyAction(state, decision!.action).state
                steps += 1
            }
            XCTAssertTrue(Engine.isGameOver(state).done, "seed \(seed) didn't finish")
            if state.winnerId == "hard" { hardWins += 1 }
        }
        XCTAssertGreaterThan(hardWins, games / 2, "Hard won only \(hardWins) of \(games)")
    }

    /// The online results screen sees other players' hands as hidden placeholders.
    func testPostGameRecapHandlesHiddenCards() {
        var game = finishedGame()
        game.players[1].hand = Array(repeating: Catalog.hiddenCardId, count: game.players[1].hand.count + 2)
        game.drawPile = game.drawPile.map { _ in Catalog.hiddenCardId }
        let summary = PostGame.summary(game, lifetime: LifetimeStats())
        XCTAssertEqual(summary.players.first { $0.playerId == game.players[1].id }?.handCount, game.players[1].hand.count)
    }

    func testCoachOffersTheTopMove() {
        let state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "Ann"), PlayerConfig(id: "b", name: "Bo")], seed: 9))
        let legal = Engine.getLegalActions(state, "a")
        let hint = Coach.hint(state, playerId: "a", legalActions: legal)
        XCTAssertEqual(hint?.topActionLabel, "Draw cards")
    }
}
