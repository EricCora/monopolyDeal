import CoreGraphics

/// Where each opponent sits around the table. Mirrors `src/ui/table/seatLayout.ts`.
///
/// Everything is in a design space: an oval felt of 388 × 600 points, with name pills
/// allowed to sit out on the rail. The table scales this to the screen. Each seat's
/// piles fill a box `area` wide (along the rail) and deep (toward the middle), turned
/// by `rotation` degrees so the cards face their owner.
public struct TableSeat: Equatable, Sendable {
    public var center: CGPoint
    public var area: CGSize
    public var rotation: Double
    public var pill: CGPoint

    /// The upright box the turned piles take up.
    public var bounds: CGRect {
        let radians = rotation * .pi / 180
        let width = abs(area.width * cos(radians)) + abs(area.height * sin(radians))
        let height = abs(area.width * sin(radians)) + abs(area.height * cos(radians))
        return CGRect(x: center.x - width / 2, y: center.y - height / 2, width: width, height: height)
    }

    /// The four corners of the turned piles' box.
    public var corners: [CGPoint] {
        let radians = rotation * .pi / 180
        let halfWidth = area.width / 2, halfHeight = area.height / 2
        return [(-halfWidth, -halfHeight), (halfWidth, -halfHeight), (halfWidth, halfHeight), (-halfWidth, halfHeight)].map { x, y in
            CGPoint(x: center.x + x * cos(radians) - y * sin(radians), y: center.y + x * sin(radians) + y * cos(radians))
        }
    }

    public var pillFrame: CGRect {
        CGRect(x: pill.x - TableLayout.pillSize.width / 2, y: pill.y - TableLayout.pillSize.height / 2, width: TableLayout.pillSize.width, height: TableLayout.pillSize.height)
    }
}

public enum TableLayout {
    public static let felt = CGSize(width: 388, height: 600)
    /// The whole drawing, with room on every side for the rail and the pills on it.
    public static let canvas = CGRect(x: -30, y: -40, width: 448, height: 676)
    public static let pillSize = CGSize(width: 160, height: 44)
    /// The draw pile and the discard, side by side.
    public static let centre = CGRect(x: 136, y: 250, width: 116, height: 100)
    /// The viewer's own Bank and sets.
    public static let viewerArea = CGRect(x: 82, y: 366, width: 224, height: 170)
    /// The viewer's name, on the rail below the felt.
    public static let viewerPill = CGPoint(x: 194, y: 604)

    /// Seats for this many opponents, in turn order after the viewer: left, then around
    /// the top, then right. Five players is the most the game allows.
    public static func seats(opponents: Int) -> [TableSeat] {
        switch opponents {
        case ..<1:
            return []
        case 1:
            return [TableSeat(center: CGPoint(x: 194, y: 130), area: CGSize(width: 200, height: 150), rotation: 180, pill: CGPoint(x: 194, y: -14))]
        case 2:
            return [
                TableSeat(center: CGPoint(x: 84, y: 251), area: CGSize(width: 200, height: 100), rotation: 90, pill: CGPoint(x: 84, y: 120)),
                TableSeat(center: CGPoint(x: 304, y: 251), area: CGSize(width: 200, height: 100), rotation: -90, pill: CGPoint(x: 304, y: 120)),
            ]
        case 3:
            return [
                TableSeat(center: CGPoint(x: 84, y: 268), area: CGSize(width: 156, height: 100), rotation: 90, pill: CGPoint(x: 84, y: 162)),
                TableSeat(center: CGPoint(x: 194, y: 86), area: CGSize(width: 170, height: 100), rotation: 180, pill: CGPoint(x: 194, y: -14)),
                TableSeat(center: CGPoint(x: 304, y: 268), area: CGSize(width: 156, height: 100), rotation: -90, pill: CGPoint(x: 304, y: 162)),
            ]
        default:
            return [
                TableSeat(center: CGPoint(x: 66, y: 300), area: CGSize(width: 130, height: 84), rotation: 90, pill: CGPoint(x: 84, y: 210)),
                TableSeat(center: CGPoint(x: 122, y: 132), area: CGSize(width: 104, height: 78), rotation: 166, pill: CGPoint(x: 84, y: -10)),
                TableSeat(center: CGPoint(x: 266, y: 132), area: CGSize(width: 104, height: 78), rotation: 194, pill: CGPoint(x: 304, y: -10)),
                TableSeat(center: CGPoint(x: 322, y: 300), area: CGSize(width: 130, height: 84), rotation: -90, pill: CGPoint(x: 304, y: 210)),
            ]
        }
    }

    /// Whether a point lies on the felt, `inset` points in from its edge.
    public static func onFelt(_ point: CGPoint, inset: CGFloat = 0) -> Bool {
        let radiusX = felt.width / 2 - inset, radiusY = felt.height / 2 - inset
        let x = (point.x - felt.width / 2) / radiusX, y = (point.y - felt.height / 2) / radiusY
        return x * x + y * y <= 1
    }

    /// How much of each card under the top one shows, as a share of the card's width.
    public static let reveal: CGFloat = 0.3
    /// Room under each pile for its label.
    public static let labelHeight: CGFloat = 14
    public static let pileGap: CGFloat = 8

    /// The card width that fits `piles` piles into a seat's box, wrapping onto up to three
    /// rows, and how many piles go in a row. `tallest` is the most cards in any one pile.
    public static func pileGrid(piles: Int, tallest: Int, in area: CGSize, largest: CGFloat = 46) -> (cardWidth: CGFloat, columns: Int) {
        guard piles > 0 else { return (largest, 1) }
        // A card is 1.4 widths tall, and each card under it shows `reveal` widths more.
        let pileHeight = 1.4 + reveal * CGFloat(max(tallest, 1) - 1)
        var best: (cardWidth: CGFloat, columns: Int) = (0, piles)
        for rows in 1...3 {
            let columns = (piles + rows - 1) / rows
            let byWidth = (area.width - pileGap * CGFloat(columns - 1)) / CGFloat(columns)
            let byHeight = ((area.height - pileGap * CGFloat(rows - 1)) / CGFloat(rows) - labelHeight) / pileHeight
            let width = min(largest, byWidth, byHeight)
            if width > best.cardWidth { best = (width, columns) }
        }
        return (max(best.cardWidth, 14), best.columns)
    }

    public static func cardWidth(piles: Int, tallest: Int, in area: CGSize, largest: CGFloat = 46) -> CGFloat {
        pileGrid(piles: piles, tallest: tallest, in: area, largest: largest).cardWidth
    }
}
