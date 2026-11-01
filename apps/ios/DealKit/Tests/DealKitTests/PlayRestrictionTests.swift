import XCTest
@testable import DealEngine

/// The reasons the app gives when a card can't do what it's meant for.
final class PlayRestrictionTests: XCTestCase {
    /// A Classic game on Ann's action phase, with her hand and table set by each test.
    private func game(variant: GameVariant = .classic, hand: [String], table: [(PropertyColor, [String])] = [], bank: [String] = []) -> GameState {
        var state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "Ann"), PlayerConfig(id: "b", name: "Bo")], seed: 2, variant: variant))
        state.turn.phase = .action
        state.players[0].hand = hand
        state.players[0].bank = bank
        for (color, cards) in table {
            state.players[0].properties[color] = cards.map { PropertyCardPlacement(cardId: $0, assignedColor: color, setId: "\(color.rawValue):auto-1") }
        }
        return state
    }

    private func reason(_ state: GameState, _ cardId: String) -> String? {
        Engine.playRestriction(state, playerId: "a", cardId: cardId)
    }

    func testHouseOnAWildAndUtilitySetIsExplained() {
        let state = game(hand: ["house#1"], table: [(.utility, ["wild_all#1", "utility_1#1"])])
        XCTAssertEqual(reason(state, "house#1"), "Houses and Hotels can't go on Railroads or Utilities.")
    }

    func testHouseWithoutACompleteSetIsExplained() {
        let state = game(hand: ["house#1"], table: [(.red, ["red_1#1"])])
        XCTAssertEqual(reason(state, "house#1"), "A House needs a complete set.")
    }

    func testTwoWildsDoNotCountAsACompleteSetForAHouse() {
        let state = game(hand: ["house#1"], table: [(.pink, ["wild_all#1", "wild_all#2", "wild_pink_orange#1"])])
        XCTAssertEqual(reason(state, "house#1"), "A House needs a complete set.")
    }

    func testHouseOnACompleteSetHasNothingToExplain() {
        let state = game(hand: ["house#1"], table: [(.dark_blue, ["dark_blue_1#1", "dark_blue_1#2"])])
        XCTAssertNil(reason(state, "house#1"))
    }

    func testHotelNeedsAHouse() {
        let state = game(hand: ["hotel#1"], table: [(.dark_blue, ["dark_blue_1#1", "dark_blue_1#2"])])
        XCTAssertEqual(reason(state, "hotel#1"), "A Hotel needs a complete set with a House on it.")
    }

    func testSecondHouseOnTheOnlySetIsExplained() {
        let state = game(hand: ["house#1"], table: [(.dark_blue, ["dark_blue_1#1", "dark_blue_1#2", "house#2"])])
        XCTAssertEqual(reason(state, "house#1"), "Each complete set can hold only one House.")
    }

    func testRentWithoutAMatchingPropertyIsExplained() {
        let state = game(hand: ["rent_red_yellow#1"], table: [(.green, ["green_1#1"])])
        XCTAssertEqual(reason(state, "rent_red_yellow#1"), "You need a property in one of this card's colors to charge rent. An any-color Wild on its own doesn't count.")
    }

    func testRentWithAMatchingPropertyHasNothingToExplain() {
        let state = game(hand: ["rent_red_yellow#1"], table: [(.red, ["red_1#1"])])
        XCTAssertNil(reason(state, "rent_red_yellow#1"))
    }

    func testJustSayNoIsExplained() {
        XCTAssertEqual(reason(game(hand: ["just_say_no#1"]), "just_say_no#1"), "Save Just Say No to block an action against you.")
    }

    func testStealsWithNoTargetAreExplained() {
        let state = game(hand: ["sly_deal#1", "deal_breaker#1", "forced_deal#1"])
        XCTAssertEqual(reason(state, "sly_deal#1"), "No opponent has a property outside a complete set.")
        XCTAssertEqual(reason(state, "deal_breaker#1"), "No opponent has a complete set.")
        XCTAssertEqual(reason(state, "forced_deal#1"), "You need a property outside a complete set to swap.")
    }

    func testMoneyAndPropertiesHaveNothingToExplain() {
        let state = game(hand: ["money_1#1", "red_1#1", "wild_all#1"])
        for card in state.players[0].hand { XCTAssertNil(reason(state, card), card) }
    }

    func testTurnAndPhaseComeFirst() {
        var state = game(hand: ["money_1#1"])
        state.turn.phase = .draw
        XCTAssertEqual(reason(state, "money_1#1"), "Draw your cards first.")

        state = game(hand: ["money_1#1"])
        state.turn.playsUsed = 3
        XCTAssertEqual(reason(state, "money_1#1"), "You've used all 3 plays this turn.")

        state = game(hand: ["money_1#1"])
        state.currentPlayerIndex = 1
        XCTAssertEqual(reason(state, "money_1#1"), "It's Bo's turn.")
    }

    func testNoMercyReasonsUseItsOwnCards() {
        let state = game(variant: .no_mercy, hand: ["unfair_trade#1", "double_rent_any_color#1"])
        XCTAssertEqual(reason(state, "unfair_trade#1"), "You need money in your Bank to swap.")
        XCTAssertNotNil(reason(state, "double_rent_any_color#1"))
    }
}
