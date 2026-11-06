import XCTest
@testable import DealEngine

/// Mirrors the property-discard cases in `src/test/engine.test.ts`.
final class DiscardRulesTests: XCTestCase {
    private func overLimit(_ hand: [String]) -> GameState {
        var state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "p1", name: "Ann"), PlayerConfig(id: "p2", name: "Bo")], seed: 42))
        state.turn.phase = .action
        state.turn.playsUsed = 3
        state.currentPlayerIndex = 0
        state.pending = nil
        state.players[0].hand = hand
        return state
    }

    private func discard(_ state: GameState, _ cardId: String) -> ApplyResult {
        Engine.applyAction(state, Action(.discard_card, playerId: "p1").with { $0.cardId = cardId })
    }

    func testPropertyCardsCannotBeDiscardedWhileOtherCardsAreInHand() {
        let state = overLimit(["money_1#x1", "money_2#x2", "pink_1#x3", "orange_1#x4", "wild_red_yellow#x5", "wild_all#x6", "green_1#x7", "dark_blue_1#x8"])
        XCTAssertEqual(Engine.getLegalActions(state, "p1").compactMap(\.action.cardId).sorted(), ["money_1#x1", "money_2#x2"])

        let rejected = discard(state, "wild_red_yellow#x5")
        XCTAssertEqual(rejected.error?.code, .invalid_action)
        XCTAssertFalse(rejected.state.discardPile.contains("wild_red_yellow#x5"))

        let accepted = discard(state, "money_1#x1")
        XCTAssertNil(accepted.error)
        XCTAssertTrue(accepted.state.discardPile.contains("money_1#x1"))
    }

    func testPropertyCardsCanBeDiscardedWhenTheHandHoldsNothingElse() {
        let state = overLimit(["pink_1#x1", "pink_1#x2", "orange_1#x3", "orange_1#x4", "red_1#x5", "yellow_1#x6", "green_1#x7", "wild_all#x8"])
        XCTAssertEqual(Engine.getLegalActions(state, "p1").count, 8)
        let result = discard(state, "pink_1#x1")
        XCTAssertNil(result.error)
        XCTAssertTrue(result.state.discardPile.contains("pink_1#x1"))
    }
}
