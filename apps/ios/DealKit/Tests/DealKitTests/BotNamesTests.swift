import XCTest
@testable import DealEngine
@testable import DealNearby

/// Mirrors `src/test/bot-names.test.ts`.
final class BotNamesTests: XCTestCase {
    /// Always picks the first element, so draws are repeatable. Returns 1, not 0:
    /// `randomElement` rejects 0 for most list sizes and would ask again forever.
    private struct FirstPick: RandomNumberGenerator {
        mutating func next() -> UInt64 { 1 }
    }

    func testNeverDrawsANameSomebodyAtTheTableHas() {
        let taken = BotNames.all.dropLast().map { $0.lowercased() }
        for _ in 0..<20 { XCTAssertEqual(BotNames.random(taken: Array(taken)), BotNames.all.last) }
    }

    func testDrawsVaryFromGameToGame() {
        let drawn = Set((0..<200).map { _ in BotNames.random(taken: []) })
        XCTAssertGreaterThan(drawn.count, 1)
    }

    func testASeatGetsARandomNameNobodyHasWhenItBecomesABot() {
        var generator = FirstPick()
        XCTAssertEqual(BotNames.seatName("Player 2", at: 1, for: .bot, taken: ["Eric"], using: &generator), BotNames.all[0])
        XCTAssertEqual(BotNames.seatName("", at: 1, for: .bot, taken: [BotNames.all[0]], using: &generator), BotNames.all[1])
    }

    func testABotNameGoesBackToPlayerNWhenTheSeatBecomesHuman() {
        XCTAssertEqual(BotNames.seatName(BotNames.all[3], at: 1, for: .human), "Player 2")
        XCTAssertEqual(BotNames.seatName("", at: 1, for: .human), "Player 2")
    }

    func testATypedNameIsNeverReplaced() {
        XCTAssertEqual(BotNames.seatName("Anna", at: 1, for: .bot), "Anna")
        XCTAssertEqual(BotNames.seatName("Anna", at: 1, for: .human), "Anna")
    }

    func testBotSeatsWithoutANameDrawDistinctNamesAtTheStart() {
        var generator = FirstPick()
        let names = BotNames.startingNames([
            ("Eric", .human), ("", .bot), ("Player 3", .bot), ("Anna", .bot), (" ", .human),
        ], using: &generator)
        XCTAssertEqual(names, ["Eric", BotNames.all[0], BotNames.all[1], "Anna", "Player 5"])
    }

    func testANearbyTableGivesEachBotANameNobodyHas() {
        var table = NearbyTable(hostName: "Ada")
        XCTAssertTrue(table.addBot(.easy))
        XCTAssertTrue(table.addBot(.hard))
        let names = table.seats.map(\.name)
        XCTAssertEqual(Set(names).count, 3)
        XCTAssertTrue(names.dropFirst().allSatisfy { BotNames.all.contains($0) })
    }
}
