import CoreGraphics
import DealStats
import XCTest

/// The same cases as `src/test/seat-layout.test.ts`.
final class TableLayoutTests: XCTestCase {
    func testEverySeatsPilesStayOnTheFelt() {
        for opponents in 1...4 {
            for (index, seat) in TableLayout.seats(opponents: opponents).enumerated() {
                for corner in seat.corners {
                    XCTAssertTrue(TableLayout.onFelt(corner), "\(opponents + 1) players, seat \(index): \(corner) is off the felt")
                }
            }
        }
        let area = TableLayout.viewerArea
        for corner in [CGPoint(x: area.minX, y: area.minY), CGPoint(x: area.maxX, y: area.minY), CGPoint(x: area.minX, y: area.maxY), CGPoint(x: area.maxX, y: area.maxY)] {
            XCTAssertTrue(TableLayout.onFelt(corner), "The viewer's area leaves the felt at \(corner)")
        }
    }

    func testNothingOverlaps() {
        for opponents in 1...4 {
            let seats = TableLayout.seats(opponents: opponents)
            XCTAssertEqual(seats.count, opponents)
            var fixed: [(String, CGRect)] = [("the centre piles", TableLayout.centre), ("your area", TableLayout.viewerArea)]
            fixed += seats.enumerated().map { ("seat \($0.offset)'s name", $0.element.pillFrame) }
            for (index, seat) in seats.enumerated() {
                for (name, frame) in fixed {
                    XCTAssertFalse(seat.bounds.intersects(frame), "\(opponents + 1) players: seat \(index)'s piles overlap \(name)")
                }
                for (other, otherSeat) in seats.enumerated() where other > index {
                    XCTAssertFalse(seat.bounds.intersects(otherSeat.bounds), "\(opponents + 1) players: seats \(index) and \(other) overlap")
                }
            }
        }
    }

    func testPilesFaceTheirOwner() {
        XCTAssertEqual(TableLayout.seats(opponents: 1).map(\.rotation), [180])
        XCTAssertEqual(TableLayout.seats(opponents: 2).map(\.rotation), [90, -90])
        XCTAssertEqual(TableLayout.seats(opponents: 3).map(\.rotation), [90, 180, -90])
        XCTAssertEqual(TableLayout.seats(opponents: 4).map(\.rotation), [90, 166, 194, -90])
    }

    func testCardsShrinkToFitMorePiles() {
        let area = CGSize(width: 156, height: 110)
        XCTAssertEqual(TableLayout.cardWidth(piles: 3, tallest: 3, in: area), 46, accuracy: 1)
        let six = TableLayout.cardWidth(piles: 6, tallest: 2, in: area)
        XCTAssertLessThan(six, 46)
        XCTAssertGreaterThan(six, 20)
        XCTAssertLessThanOrEqual(TableLayout.cardWidth(piles: 9, tallest: 3, in: area), six)
    }
}
