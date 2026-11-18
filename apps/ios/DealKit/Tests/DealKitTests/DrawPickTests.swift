import XCTest
@testable import DealEngine

/// Mirrors `src/test/engine-draw-pick.test.ts`: god mode's chosen draws.
final class DrawPickTests: XCTestCase {
    private func drawState(_ variant: GameVariant = .classic) -> GameState {
        var state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "p1", name: "A"), PlayerConfig(id: "p2", name: "B")], seed: 7, variant: variant))
        state.currentPlayerIndex = 0
        state.turn.phase = .draw
        return state
    }

    func testDrawsTheChosenCardsFromAnywhereInThePile() {
        let state = drawState()
        let pick = [state.drawPile[0], state.drawPile[5]]
        let result = Engine.applyAction(state, Action(.draw_cards, playerId: "p1").with { $0.pick = pick })
        XCTAssertNil(result.error)
        XCTAssertEqual(Array(result.state.players[0].hand.suffix(2)), pick)
        XCTAssertEqual(result.state.drawPile.count, state.drawPile.count - 2)
        XCTAssertEqual(result.events.first?.message, "A drew 2 cards.")
    }

    func testTopsUpAShortPickWithTheNormalNextCards() {
        let state = drawState()
        let chosen = state.drawPile[3]
        let next = state.drawPile.filter { $0 != chosen }.last
        let result = Engine.applyAction(state, Action(.draw_cards, playerId: "p1").with { $0.pick = [chosen] })
        XCTAssertNil(result.error)
        XCTAssertEqual(Array(result.state.players[0].hand.suffix(2)), [chosen, next!])
    }

    func testRejectsAPickThatIsTooLongRepeatedOrNotInThePile() {
        let state = drawState()
        let pile = state.drawPile
        for pick in [[pile[0], pile[1], pile[2]], [pile[0], pile[0]], [state.players[1].hand[0]]] {
            let result = Engine.applyAction(state, Action(.draw_cards, playerId: "p1").with { $0.pick = pick })
            XCTAssertEqual(result.error?.code, .invalid_target)
            XCTAssertEqual(result.state, state)
        }
    }

    func testPassGoChoosesItsTwoCards() {
        var state = drawState()
        state.turn.phase = .action
        state.players[0].hand = ["pass_go#pg1"]
        let pick = [state.drawPile[1], state.drawPile[2]]
        let action = Action(.play_action, playerId: "p1").with { $0.cardId = "pass_go#pg1" }
        XCTAssertEqual(Engine.drawCount(for: action, in: state), 2)
        let result = Engine.applyAction(state, action.with { $0.pick = pick })
        XCTAssertNil(result.error)
        XCTAssertEqual(result.state.players[0].hand, pick)
    }

    func testPassGoGoGoCountsUpToSevenAfterItLeavesTheHand() {
        var state = drawState(.no_mercy)
        state.turn.phase = .action
        state.players[0].hand = ["pass_go_go_go#g1", "money_1#m1"]
        let action = Action(.play_action, playerId: "p1").with { $0.cardId = "pass_go_go_go#g1" }
        XCTAssertEqual(Engine.drawCount(for: action, in: state), 6)
        let pick = Array(Engine.drawPileInDrawOrder(state).suffix(6))
        let result = Engine.applyAction(state, action.with { $0.pick = pick })
        XCTAssertNil(result.error)
        XCTAssertEqual(result.state.players[0].hand, ["money_1#m1"] + pick)
    }

    func testRejectsAPickOnAPlayThatDrawsNothing() {
        var state = drawState()
        state.turn.phase = .action
        state.players[0].hand = ["debt_collector#d1"]
        let action = Action(.play_action, playerId: "p1").with { $0.cardId = "debt_collector#d1"; $0.targetPlayerId = "p2"; $0.pick = [state.drawPile[0]] }
        XCTAssertNil(Engine.drawCount(for: action, in: state))
        XCTAssertEqual(Engine.applyAction(state, action).error?.code, .invalid_action)
    }

    func testPickGoesOnTheWireOnlyWhenSet() {
        XCTAssertEqual(Action(.draw_cards, playerId: "p1").wireJSON, #"{"type":"draw_cards","playerId":"p1"}"#)
        XCTAssertEqual(Action(.draw_cards, playerId: "p1").with { $0.pick = ["a#1", "b#2"] }.wireJSON, #"{"type":"draw_cards","playerId":"p1","pick":["a#1","b#2"]}"#)
    }
}
