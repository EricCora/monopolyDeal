import SwiftUI

extension ReorderDifference where CollectionID == ReorderableSingleCollectionIdentifier, ItemID: Hashable {
    /// The ids in their new order once this drag lands.
    func reordered(_ ids: [ItemID]) -> [ItemID] {
        let moving = Set(sources)
        guard !moving.isEmpty else { return ids }
        let moved = ids.filter { moving.contains($0) }
        var rest = ids.filter { !moving.contains($0) }
        switch destination.position {
        case .before(let id):
            rest.insert(contentsOf: moved, at: rest.firstIndex(of: id) ?? rest.endIndex)
        case .end:
            rest.append(contentsOf: moved)
        }
        return rest
    }
}

/// Shows the order the host just dropped until the table catches up with it.
func turnOrderShown<Seat: Identifiable>(_ seats: [Seat], pending: [Seat.ID]?) -> [Seat] {
    guard let pending, pending.count == seats.count else { return seats }
    let byId = Dictionary(seats.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    let ordered = pending.compactMap { byId[$0] }
    return ordered.count == seats.count ? ordered : seats
}

/// The hint under a roster the host can reorder.
struct TurnOrderHint: View {
    var body: some View {
        Label("Hold a player and drag to change the turn order. The top player goes first.", systemImage: "arrow.up.arrow.down")
            .font(.caption)
            .foregroundStyle(SoftWhite(0.7))
    }
}
