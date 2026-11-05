import XCTest
@testable import DealEngine
@testable import DealNearby

/// Mirrors `src/test/bot-names.test.ts`.
final class BotNamesTests: XCTestCase {
    func testABotSeatIsNamedByItsPosition() {
        XCTAssertEqual(BotNames.seatBotName(1), "Milo")
        XCTAssertEqual(Set((0..<5).map(BotNames.seatBotName)).count, 5)
    }

    func testADefaultNameIsReplacedWhenASeatBecomesABotAndGivenBack() {
        XCTAssertEqual(BotNames.seatName("Player 2", at: 1, for: .bot), "Milo")
        XCTAssertEqual(BotNames.seatName("  ", at: 1, for: .bot), "Milo")
        XCTAssertEqual(BotNames.seatName("Milo", at: 1, for: .human), "Player 2")
    }

    func testATypedNameIsNeverReplaced() {
        XCTAssertEqual(BotNames.seatName("Anna", at: 1, for: .bot), "Anna")
        XCTAssertEqual(BotNames.seatName("Anna", at: 1, for: .human), "Anna")
        XCTAssertEqual(BotNames.seatName("Player 3", at: 1, for: .bot), "Player 3")
    }

    func testANearbyTableGivesEachBotANameNobodyHas() {
        var table = NearbyTable(hostName: "Ada")
        XCTAssertTrue(table.addBot(.easy))
        XCTAssertTrue(table.addBot(.hard))
        XCTAssertEqual(table.seats.map(\.name), ["Ada", "Milo", "Rosa"])
    }
}
