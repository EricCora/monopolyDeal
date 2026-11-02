import XCTest
@testable import DealEngine
@testable import DealStats

/// Mirrors `src/test/set-rules.test.ts`.
final class SetRulesTests: XCTestCase {
    private func table(_ variant: GameVariant = .classic) -> GameState {
        var state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "p1", name: "Ann"), PlayerConfig(id: "p2", name: "Bo")], seed: 3, variant: variant))
        state.turn.phase = .action
        state.currentPlayerIndex = 0
        state.players[0].hand = ["money_1#a"]
        return state
    }

    private func bank(_ state: GameState) -> GameState {
        let result = Engine.applyAction(state, Action(.play_to_bank, playerId: "p1").with { $0.cardId = "money_1#a" })
        XCTAssertNil(result.error)
        return result.state
    }

    private func place(_ color: PropertyColor, _ cards: [String], setId: String? = nil) -> [PropertyCardPlacement] {
        cards.map { PropertyCardPlacement(cardId: $0, assignedColor: color, setId: setId) }
    }

    func testATwoColorWildAndAnAnyColorWildAreComplete() {
        var state = table()
        state.players[0].properties[.brown] = place(.brown, ["wild_brown_light_blue#a", "wild_all#a"])
        XCTAssertEqual(Engine.countCompleteSets(state.players[0], .classic), 1)
    }

    func testTwoAnyColorWildsAreNot() {
        var state = table()
        state.players[0].properties[.brown] = place(.brown, ["wild_all#a", "wild_all#b"])
        XCTAssertEqual(Engine.countCompleteSets(state.players[0], .classic), 0)
    }

    func testAStandardPropertyBesideACompleteWildSetLeavesItWhole() {
        var state = table()
        state.players[0].properties[.brown] = place(.brown, ["wild_brown_light_blue#a", "wild_all#a"])
        state.players[0].hand = ["brown_1#a"]
        let next = Engine.applyAction(state, Action(.play_property, playerId: "p1").with { $0.cardId = "brown_1#a"; $0.color = .brown }).state
        XCTAssertEqual(Set(next.players[0].properties[.brown].map(\.setId)).count, 2)
        XCTAssertEqual(Engine.countCompleteSets(next.players[0], .classic), 1)
    }

    func testPilesRejoinOnceTheyHoldASet() {
        var state = table()
        state.players[0].properties[.pink] = place(.pink, ["pink_1#a", "pink_1#b"], setId: "a") + place(.pink, ["pink_1#c"], setId: "b")
        let next = bank(state)
        XCTAssertEqual(Engine.countCompleteSets(next.players[0], .classic), 1)
        XCTAssertEqual(Set(next.players[0].properties[.pink].map(\.setId)).count, 1)
    }

    func testPilesRejoinWithAShackAndWin() {
        var state = table(.no_mercy)
        state.players[0].properties[.pink] = place(.pink, ["pink_1#a", "pink_1#b"], setId: "a")
            + [PropertyCardPlacement(cardId: "shack#a", assignedColor: .pink, setId: "a", attachedToCardId: "pink_1#b")]
            + place(.pink, ["pink_1#c"], setId: "b")
        state.players[0].properties[.yellow] = place(.yellow, ["yellow_1#a", "yellow_1#b", "yellow_1#c"])
        state.players[0].properties[.green] = place(.green, ["green_1#a", "green_1#b", "green_1#c"])
        state.players[0].debts = []
        XCTAssertEqual(Engine.isGameOver(bank(state)).winnerId, "p1")
    }

    func testOnePileIsToppedUpWhenThereAreTooManyForOneSet() {
        var state = table()
        state.players[0].properties[.pink] = place(.pink, ["pink_1#a", "pink_1#b"], setId: "a") + place(.pink, ["pink_1#c", "pink_1#d"], setId: "b")
        let entries = bank(state).players[0].properties[.pink]
        let counts = Dictionary(grouping: entries, by: \.setId).values.map(\.count).sorted()
        XCTAssertEqual(counts, [1, 3])
    }

    func testPilesStayApartRatherThanPutTwoShacksOnACompleteSet() {
        var state = table(.no_mercy)
        state.players[0].properties[.pink] = place(.pink, ["pink_1#a", "pink_1#b"], setId: "a") + [
            PropertyCardPlacement(cardId: "shack#a", assignedColor: .pink, setId: "a", attachedToCardId: "pink_1#a"),
            PropertyCardPlacement(cardId: "shack#b", assignedColor: .pink, setId: "a", attachedToCardId: "pink_1#b"),
        ] + place(.pink, ["pink_1#c"], setId: "b")
        state.players[0].debts = []
        XCTAssertEqual(Engine.countCompleteSets(bank(state).players[0], .no_mercy), 0)
    }

    func testAPileOfAnyColorWildsSwapsOneForARealCard() {
        var state = table()
        state.players[0].properties[.brown] = place(.brown, ["wild_all#a", "wild_all#b"], setId: "a") + place(.brown, ["brown_1#a"], setId: "b")
        XCTAssertEqual(Engine.countCompleteSets(bank(state).players[0], .classic), 1)
    }
}

final class AutoDecisionTests: XCTestCase {
    private func table() -> GameState {
        var state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "p1", name: "Ann"), PlayerConfig(id: "p2", name: "Bo")], seed: 3))
        state.turn.phase = .action
        state.currentPlayerIndex = 0
        state.players[0].hand = []
        state.players[0].bank = []
        return state
    }

    private func place(_ color: PropertyColor, _ cards: String...) -> [PropertyCardPlacement] {
        cards.map { PropertyCardPlacement(cardId: $0, assignedColor: color) }
    }

    func testTheBankPaysBeforeAProperty() {
        var state = table()
        state.players[0].bank = ["money_5#a"]
        state.players[0].properties[.red] = place(.red, "red_1#a")
        XCTAssertEqual(Engine.suggestedPaymentCards(state, playerId: "p1", amount: 3), ["money_5#a"])
    }

    func testBankCardsAddUpBeforeAnExactProperty() {
        var state = table()
        state.players[0].bank = ["money_1#a", "money_2#a"]
        state.players[0].properties[.red] = place(.red, "red_1#a")
        XCTAssertEqual(Set(Engine.suggestedPaymentCards(state, playerId: "p1", amount: 3)), ["money_1#a", "money_2#a"])
    }

    func testPlainMoneyGoesBeforeABankedActionCard() {
        var state = table()
        state.players[0].bank = ["deal_breaker#a", "money_5#a"]
        XCTAssertEqual(Engine.suggestedPaymentCards(state, playerId: "p1", amount: 5), ["money_5#a"])
    }

    func testACompleteSetBreaksOnlyWhenNothingElseCovers() {
        var state = table()
        state.players[0].properties[.red] = place(.red, "red_1#a", "red_1#b", "red_1#c")
        state.players[0].properties[.pink] = place(.pink, "pink_1#a")
        XCTAssertEqual(Engine.suggestedPaymentCards(state, playerId: "p1", amount: 2), ["pink_1#a"])
        XCTAssertTrue(Engine.suggestedPaymentCards(state, playerId: "p1", amount: 4).contains("pink_1#a"))
    }
}

final class GameLogModelTests: XCTestCase {
    private func event(_ type: String, _ message: String) -> GameEvent {
        try! JSONDecoder().decode(GameEvent.self, from: JSONSerialization.data(withJSONObject: ["timestamp": 1, "type": type, "message": message]))
    }

    func testGroupsByTurnNewestFirstAndNamesWhoPlayed() {
        let turns = GameLogModel.turns([
            event("draw", "Ann drew 2 cards."),
            event("turn_passed", "Ann ended their turn."),
            event("draw", "Bot 10 drew 2 cards."),
        ], playerNames: ["Ann", "Bot 1", "Bot 10"])
        XCTAssertEqual(turns.map(\.number), [2, 1])
        XCTAssertEqual(turns[0].playerName, "Bot 10")
        XCTAssertTrue(turns[0].isCurrent)
        XCTAssertFalse(turns[1].isCurrent)
        XCTAssertEqual(turns[1].entries.first?.message, "Ann ended their turn.")
    }
}
