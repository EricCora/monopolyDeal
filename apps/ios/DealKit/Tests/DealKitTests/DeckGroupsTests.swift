import XCTest
@testable import DealEngine

/// Mirrors `src/test/deck-groups.test.ts` and the ownership cases in `src/test/god-mode-ui.test.tsx`.
final class DeckGroupsTests: XCTestCase {
    private func fullDeck(_ variant: GameVariant) -> [String] {
        Catalog.definitions(variant).flatMap { card in (0..<card.quantity).map { "\(card.id)#\($0)" } }
    }

    func testOrdersSectionsAsActionsMoneyPropertiesAndLosesNoCard() {
        for variant in GameVariant.allCases {
            let pile = Array(fullDeck(variant).reversed())
            let sections = DeckGroups.sections(pile, variant: variant)
            XCTAssertEqual(sections.map(\.kind), [.action, .money, .property])
            let ids = sections.flatMap { $0.groups.flatMap { $0.cards.map(\.cardId) } }
            XCTAssertEqual(ids.sorted(), pile.sorted())
            let keys = sections.flatMap { section in section.groups.map { "\(section.kind):\($0.key)" } }
            XCTAssertEqual(Set(keys).count, keys.count, "Cards of a kind always sit together")
        }
    }

    func testGroupsPropertiesByBoardColorWithWildsAfterAndAnyColorLast() {
        let pile = ["wild_all#0", "red_1#0", "wild_blue_green#0", "brown_1#0", "wild_brown_light_blue#0", "dark_blue_1#0", "green_1#0"]
        let properties = DeckGroups.sections(pile, variant: .classic)[0]
        XCTAssertEqual(properties.groups.map(\.label), ["Brown", "Red", "Green", "Dark Blue", "Any color"])
        XCTAssertEqual(properties.groups.map { $0.cards.map(\.cardId) }, [
            ["brown_1#0", "wild_brown_light_blue#0"], ["red_1#0"], ["green_1#0", "wild_blue_green#0"], ["dark_blue_1#0"], ["wild_all#0"],
        ])
    }

    func testPutsMoneyBiggestFirstAndRentsInBoardColorOrder() {
        let sections = DeckGroups.sections(["money_1#0", "rent_color#0", "money_10#0", "rent_red_yellow#0", "rent_brown_light_blue#0", "money_1#1"], variant: .classic)
        XCTAssertEqual(sections[0].groups.map(\.label), ["Rent"])
        XCTAssertEqual(sections[0].groups[0].cards.map(\.cardId), ["rent_brown_light_blue#0", "rent_red_yellow#0", "rent_color#0"])
        XCTAssertEqual(sections[1].groups.map(\.label), ["$10M", "$1M"])
        XCTAssertEqual(sections[1].groups[1].cards.map(\.drawIndex), [0, 5])
    }

    func testMatchesTheWebOrderForAWholeDeck() {
        // The same deck sorts the same way on both apps: actions run Pass Go, Rent, Double Rent first.
        let sections = DeckGroups.sections(fullDeck(.classic), variant: .classic)
        XCTAssertEqual(Array(sections[0].groups.map(\.label).prefix(3)), ["Pass Go", "Rent", "Double Rent"])
        XCTAssertEqual(sections[0].groups.last?.label, "Buildings")
    }

    private var players: [PlayerState] {
        let state = Engine.createGame(GameConfig(players: [
            PlayerConfig(id: "p1", name: "Eric"),
            PlayerConfig(id: "p2", name: "Anna"),
            PlayerConfig(id: "p3", name: "Hugo", controller: .bot),
        ], seed: 3))
        return state.players
    }

    func testBelongsToTheHumanWhoseTurnItIsOrTheFirstHumanWhileABotMoves() {
        XCTAssertEqual(GodModeSeats.owner(players: players, currentPlayerIndex: 1), "anna")
        XCTAssertEqual(GodModeSeats.owner(players: players, currentPlayerIndex: 2), "eric")
    }

    func testNeverOpensTheDeckOnAnotherPlayersDrawAtASharedTable() {
        XCTAssertTrue(GodModeSeats.applies(owner: "eric", players: players, playerId: "p1"))
        XCTAssertFalse(GodModeSeats.applies(owner: "eric", players: players, playerId: "p2"))
        XCTAssertFalse(GodModeSeats.applies(owner: "eric", players: players, playerId: "p3"))
        XCTAssertFalse(GodModeSeats.applies(owner: nil, players: players, playerId: "p1"))
        XCTAssertTrue(GodModeSeats.applies(owner: nil, players: [players[0], players[2]], playerId: "p1"))
    }
}
