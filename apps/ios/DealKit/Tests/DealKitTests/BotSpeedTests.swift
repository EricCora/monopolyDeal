import DealEngine
import XCTest
@testable import DealAI

/// How long the hard bot takes in its slowest positions. Set DEAL_BOT_BENCHMARK=1 to
/// print a report; it isn't part of a normal run because it takes minutes.
final class BotSpeedTests: XCTestCase {
    private struct Position {
        var state: GameState
        var actor: PlayerId
        var legal: [LegalAction]
    }

    /// Plays seeded games and keeps the positions offering the most legal moves.
    private func widestPositions(variant: GameVariant, players: Int, games: Int, keep: Int) -> [Position] {
        var widest: [Position] = []
        for seed in 0..<games {
            var random = FuzzRandom(seed: seed * 13 + 1)
            var state = Engine.createGame(GameConfig(
                players: (1...players).map { PlayerConfig(id: "p\($0)", name: "P\($0)") },
                seed: seed * 17 + 3,
                variant: variant
            ))
            for _ in 0..<1500 where !Engine.isGameOver(state).done {
                let prompt = Engine.nextPrompt(state)
                let legal = Engine.getLegalActions(state, prompt.playerId)
                if legal.isEmpty { break }
                if widest.count < keep || legal.count > widest.last!.legal.count {
                    widest.append(Position(state: state, actor: prompt.playerId, legal: legal))
                    widest.sort { $0.legal.count > $1.legal.count }
                    if widest.count > keep { widest.removeLast() }
                }
                let preferred = legal.filter { $0.action.type != .pass_turn && $0.action.type != .move_wild }
                let pool = preferred.isEmpty ? legal : preferred
                state = Engine.applyAction(state, pool[Int((random.next() * Double(pool.count)).rounded(.down))].action).state
            }
        }
        return widest
    }

    func testTheTimeLimitHoldsInTheWidestPositions() throws {
        let positions = widestPositions(variant: .classic, players: 5, games: 25, keep: 2)
        XCTAssertGreaterThan(positions[0].legal.count, 100, "Expected a position with a lot of choices")
        let budget = Duration.milliseconds(150)
        for position in positions {
            let clock = ContinuousClock()
            var decision: ScoredAction?
            let elapsed = clock.measure {
                decision = MonteCarlo.choose(position.state, actorId: position.actor, legalActions: position.legal, simulations: 18, depth: 11, timeBudget: budget)
            }
            let chosen = try XCTUnwrap(decision)
            XCTAssertTrue(position.legal.contains { $0.action == chosen.action }, "The bot must pick a legal move")
            XCTAssertLessThan(elapsed, budget * 3, "One move's simulations may run past the limit, but not many more")
        }
    }

    func testRunningOutOfTimeKeepsTheStrongestMoves() {
        // With almost no time, the bot should still choose the move the heuristic rates highest.
        let position = widestPositions(variant: .classic, players: 3, games: 8, keep: 1)[0]
        let top = Heuristic.rank(position.state, actorId: position.actor, legalActions: position.legal)[0]
        let rushed = MonteCarlo.choose(position.state, actorId: position.actor, legalActions: position.legal, simulations: 1, depth: 1, timeBudget: .nanoseconds(1))
        XCTAssertEqual(rushed?.action, top.action)
    }

    func testAHardBotUnderTheLimitStillFinishesGames() {
        for seed in 0..<40 {
            var state = Engine.createGame(GameConfig(
                players: (1...(2 + seed % 4)).map { PlayerConfig(id: "p\($0)", name: "P\($0)") },
                seed: seed * 7 + 2,
                variant: seed % 2 == 0 ? .classic : .no_mercy
            ))
            var steps = 0
            while !Engine.isGameOver(state).done && steps < 5000 {
                let prompt = Engine.nextPrompt(state)
                let legal = Engine.getLegalActions(state, prompt.playerId)
                let decision = MonteCarlo.choose(state, actorId: prompt.playerId, legalActions: legal, simulations: 2, depth: 3, timeBudget: .milliseconds(4))
                let result = Engine.applyAction(state, decision!.action)
                XCTAssertNil(result.error, "seed \(seed): \(decision!.label)")
                state = result.state
                steps += 1
            }
            XCTAssertTrue(Engine.isGameOver(state).done, "seed \(seed) didn't finish")
        }
    }

    /// Moving a Wild costs no play, so a bot that keeps preferring it never ends its turn.
    /// This seed froze a real three-player game on turn 33.
    func testAHardBotDoesNotShuffleWildsForever() {
        var state = Engine.createGame(GameConfig(
            players: (1...3).map { PlayerConfig(id: "p\($0)", name: "P\($0)") },
            seed: 65,
            variant: .no_mercy
        ))
        var wildMovesInARow = 0
        var steps = 0
        while !Engine.isGameOver(state).done && steps < 1500 {
            let prompt = Engine.nextPrompt(state)
            let legal = Engine.getLegalActions(state, prompt.playerId)
            let decision = MonteCarlo.choose(state, actorId: prompt.playerId, legalActions: legal, simulations: 18, depth: 11)!
            wildMovesInARow = decision.action.type == .move_wild ? wildMovesInARow + 1 : 0
            guard wildMovesInARow < 20 else {
                XCTFail("Stuck moving Wilds at turn \(state.turnCount), step \(steps)")
                return
            }
            state = Engine.applyAction(state, decision.action).state
            steps += 1
        }
        XCTAssertTrue(Engine.isGameOver(state).done, "The game didn't finish in \(steps) steps")
    }

    func testReportHardBotWorstCases() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["DEAL_BOT_BENCHMARK"] == "1", "Set DEAL_BOT_BENCHMARK=1 to run.")
        for (variant, players) in [(GameVariant.classic, 2), (.classic, 5), (.no_mercy, 2), (.no_mercy, 5)] {
            let positions = widestPositions(variant: variant, players: players, games: 60, keep: 3)
            for position in positions {
                let clock = ContinuousClock()
                let full = clock.measure {
                    _ = MonteCarlo.choose(position.state, actorId: position.actor, legalActions: position.legal, simulations: 18, depth: 11)
                }
                let limited = clock.measure {
                    _ = MonteCarlo.choose(position.state, actorId: position.actor, legalActions: position.legal, simulations: 18, depth: 11, timeBudget: .seconds(2.5))
                }
                let kind = position.legal[0].action.type.rawValue
                print("BENCH \(variant.rawValue) \(players)p legal=\(position.legal.count) first=\(kind) full=\(full) limited=\(limited)")
            }
        }
    }
}
