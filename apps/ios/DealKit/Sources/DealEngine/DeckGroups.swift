import Foundation

/// God mode's picker, grouped: actions, then money, then properties. Inside each, cards of a
/// kind sit together (action type, money value, property color), and cards that are alike keep
/// their draw order. Mirrors `src/ui/godMode/deckGroups.ts`.
public enum DeckGroups {
    public struct Card: Hashable, Sendable {
        public var cardId: String
        /// Where the card sits in the draw order. 0 is the next card.
        public var drawIndex: Int
    }

    public struct Group: Hashable, Sendable, Identifiable {
        public var key: String
        public var label: String
        public var cards: [Card]
        public var id: String { key }
    }

    public enum SectionKind: String, CaseIterable, Sendable { case action, money, property }

    public struct Section: Hashable, Sendable, Identifiable {
        public var kind: SectionKind
        public var title: String
        public var count: Int
        public var groups: [Group]
        public var id: String { kind.rawValue }
    }

    private static let colorOrder = PropertyColor.allCases

    private static let actionOrder: [(key: String, label: String, kinds: [ActionKind])] = [
        ("pass_go", "Pass Go", [.pass_go]),
        ("rent", "Rent", [.rent, .rent_wild]),
        ("double_rent", "Double Rent", [.double_rent]),
        ("just_say_no", "Just Say No", [.just_say_no]),
        ("deal_breaker", "Deal Breaker", [.deal_breaker]),
        ("sly_deal", "Sly Deal", [.sly_deal]),
        ("super_sly_deal", "Super Sly Deal", [.super_sly_deal]),
        ("forced_deal", "Forced Deal", [.forced_deal]),
        ("debt_collector", "Debt Collector", [.debt_collector]),
        ("its_my_birthday", "It's My Birthday", [.its_my_birthday]),
        ("building", "Buildings", [.house, .hotel, .shack]),
    ]

    private struct Place {
        var section: SectionKind
        var groupOrder: Int
        var groupKey: String
        var groupLabel: String
        var within: Int
    }

    /// The earliest board color a card belongs to, for ordering rents and wilds.
    private static func firstColorIndex(_ colors: [PropertyColor]) -> Int {
        if colors.isEmpty || colors.count >= colorOrder.count { return colorOrder.count }
        return colors.compactMap { colorOrder.firstIndex(of: $0) }.min() ?? colorOrder.count
    }

    private static func place(_ card: CardDefinition) -> Place {
        switch card.kind {
        case .money:
            // Biggest money first.
            return Place(section: .money, groupOrder: -card.value, groupKey: "money_\(card.value)", groupLabel: "$\(card.value)M", within: 0)
        case .property, .wild:
            let colors = card.kind == .property ? [card.color].compactMap { $0 } : card.colors
            let index = firstColorIndex(colors)
            if index >= colorOrder.count {
                return Place(section: .property, groupOrder: colorOrder.count, groupKey: "wild_any", groupLabel: "Any color", within: 0)
            }
            let color = colorOrder[index]
            // Plain properties before the two-color wilds that share their color.
            let within = card.kind == .property ? 0 : 1 + firstColorIndex(colors.filter { $0 != color })
            return Place(section: .property, groupOrder: index, groupKey: color.rawValue, groupLabel: color.label, within: within)
        case .action, .building:
            if let kind = card.actionKind, let family = actionOrder.firstIndex(where: { $0.kinds.contains(kind) }) {
                let entry = actionOrder[family]
                // Rents run in board-color order, with any-color rents last.
                let within = entry.key == "rent" || entry.key == "double_rent" ? firstColorIndex(card.rentColors) : 0
                return Place(section: .action, groupOrder: family, groupKey: entry.key, groupLabel: entry.label, within: within)
            }
            return Place(section: .action, groupOrder: actionOrder.count, groupKey: "other_\(card.id)", groupLabel: card.name, within: 0)
        }
    }

    private static let titles: [SectionKind: String] = [.action: "Actions", .money: "Money", .property: "Properties"]

    /// `pile` runs from the next card to be drawn to the last.
    public static func sections(_ pile: [String], variant: GameVariant) -> [Section] {
        let placed = pile.enumerated().map { index, cardId in
            let card = Catalog.card(cardId, variant)
            return (cardId: cardId, drawIndex: index, card: card, place: place(card))
        }
        return SectionKind.allCases.compactMap { kind in
            let inSection = placed.filter { $0.place.section == kind }.sorted { a, b in
                if a.place.groupOrder != b.place.groupOrder { return a.place.groupOrder < b.place.groupOrder }
                if a.place.groupLabel != b.place.groupLabel { return a.place.groupLabel < b.place.groupLabel }
                if a.place.within != b.place.within { return a.place.within < b.place.within }
                if a.card.id != b.card.id { return a.card.id < b.card.id }
                return a.drawIndex < b.drawIndex
            }
            guard !inSection.isEmpty else { return nil }
            var groups: [Group] = []
            for entry in inSection {
                let card = Card(cardId: entry.cardId, drawIndex: entry.drawIndex)
                if groups.last?.key == entry.place.groupKey {
                    groups[groups.count - 1].cards.append(card)
                } else {
                    groups.append(Group(key: entry.place.groupKey, label: entry.place.groupLabel, cards: [card]))
                }
            }
            return Section(kind: kind, title: titles[kind] ?? kind.rawValue, count: inSection.count, groups: groups)
        }
    }
}

/// Who god mode belongs to on a shared device. Mirrors `src/ui/godMode/godMode.ts`.
public enum GodModeSeats {
    public static func normalize(_ name: String?) -> String? {
        let trimmed = name?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    /// The seat a hold switches god mode on for, in a game played on this device: the player
    /// whose turn it is, or, while a bot is moving, the first human seat.
    public static func owner(players: [PlayerState], currentPlayerIndex: Int) -> String? {
        if players.indices.contains(currentPlayerIndex), players[currentPlayerIndex].controller != .bot {
            return normalize(players[currentPlayerIndex].name)
        }
        return normalize(players.first { $0.controller != .bot }?.name)
    }

    /// Whether a draw by `playerId`, in a game played on this device, may show the deck.
    /// With no owner (switched on before owners were kept), only a game with one human seat counts.
    public static func applies(owner: String?, players: [PlayerState], playerId: PlayerId) -> Bool {
        guard let drawer = players.first(where: { $0.id == playerId }), drawer.controller != .bot else { return false }
        if let owner { return normalize(drawer.name) == owner }
        return players.filter { $0.controller != .bot }.count == 1
    }
}
