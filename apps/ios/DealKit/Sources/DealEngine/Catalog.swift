import Foundation

/// Mirrors `src/cards/catalog.ts`. The TypeScript catalog stays the source of truth.
public enum PropertyColor: String, Codable, CaseIterable, Hashable, Sendable {
    case brown
    case light_blue
    case pink
    case orange
    case red
    case yellow
    case green
    case dark_blue
    case railroad
    case utility

    public var setSize: Int {
        switch self {
        case .brown, .dark_blue, .utility: 2
        case .railroad: 4
        default: 3
        }
    }

    public var rentScale: [Int] {
        switch self {
        case .brown: [1, 2]
        case .light_blue: [1, 2, 3]
        case .pink: [1, 2, 4]
        case .orange: [1, 3, 5]
        case .red: [2, 3, 6]
        case .yellow: [2, 4, 6]
        case .green: [2, 4, 7]
        case .dark_blue: [3, 8]
        case .railroad: [1, 2, 3, 4]
        case .utility: [1, 2]
        }
    }

    /// "Light Blue". Matches `formatPropertyColor`, which capitalizes each word.
    public var label: String {
        rawValue.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

public enum GameVariant: String, Codable, CaseIterable, Hashable, Sendable {
    case classic
    case no_mercy

    public var label: String { self == .classic ? "Classic" : "No Mercy" }
}

public enum ActionKind: String, Codable, Hashable, Sendable {
    case pass_go, rent, rent_wild, double_rent, debt_collector, its_my_birthday, sly_deal
    case forced_deal, deal_breaker, house, hotel, shack, go_again, forced_debt, heist
    case market_crash, repossession, super_sly_deal, tax_collector, tough_luck, unfair_trade
    case yoink, just_say_no
}

public enum CardKind: String, Codable, Hashable, Sendable {
    case money, property, wild, action, building
}

public struct CardDefinition: Hashable, Sendable {
    public let id: String
    public let name: String
    public let kind: CardKind
    public let value: Int
    public let moneyValue: Int?
    public let color: PropertyColor?
    public let colors: [PropertyColor]
    public let actionKind: ActionKind?
    /// Rent colors in catalog order. Order matters: legal actions list them in this order.
    public let rentColors: [PropertyColor]
    public let quantity: Int
}

private func money(_ id: String, _ value: Int, _ quantity: Int) -> CardDefinition {
    CardDefinition(id: id, name: "M\(value)", kind: .money, value: value, moneyValue: nil, color: nil, colors: [], actionKind: nil, rentColors: [], quantity: quantity)
}

private func property(_ color: PropertyColor, _ name: String, _ value: Int, _ quantity: Int) -> CardDefinition {
    CardDefinition(id: "\(color.rawValue)_1", name: name, kind: .property, value: value, moneyValue: nil, color: color, colors: [], actionKind: nil, rentColors: [], quantity: quantity)
}

private func wild(_ id: String, _ name: String, _ colors: [PropertyColor], _ value: Int, _ quantity: Int) -> CardDefinition {
    CardDefinition(id: id, name: name, kind: .wild, value: value, moneyValue: nil, color: nil, colors: colors, actionKind: nil, rentColors: [], quantity: quantity)
}

private func action(_ id: String, _ name: String, _ kind: ActionKind, _ value: Int, _ quantity: Int, rent: [PropertyColor] = [], cardKind: CardKind = .action) -> CardDefinition {
    CardDefinition(id: id, name: name, kind: cardKind, value: value, moneyValue: value, color: nil, colors: [], actionKind: kind, rentColors: rent, quantity: quantity)
}

private let allColors = PropertyColor.allCases

private let propertyCards: [CardDefinition] = [
    property(.brown, "Brown", 1, 2),
    property(.light_blue, "Light Blue", 1, 3),
    property(.pink, "Pink", 2, 3),
    property(.orange, "Orange", 2, 3),
    property(.red, "Red", 3, 3),
    property(.yellow, "Yellow", 3, 3),
    property(.green, "Green", 4, 3),
    property(.dark_blue, "Dark Blue", 4, 2),
    property(.railroad, "Railroad", 2, 4),
    property(.utility, "Utility", 2, 2),
]

private let wildCards: [CardDefinition] = [
    wild("wild_blue_green", "Wild Blue/Green", [.dark_blue, .green], 4, 1),
    wild("wild_brown_light_blue", "Wild Brown/Light Blue", [.brown, .light_blue], 1, 1),
    wild("wild_light_blue_railroad", "Wild Light Blue/Railroad", [.light_blue, .railroad], 4, 1),
    wild("wild_pink_orange", "Wild Pink/Orange", [.pink, .orange], 2, 2),
    wild("wild_red_yellow", "Wild Red/Yellow", [.red, .yellow], 3, 2),
    wild("wild_railroad_green", "Wild Railroad/Green", [.railroad, .green], 4, 1),
    wild("wild_railroad_utility", "Wild Railroad/Utility", [.railroad, .utility], 2, 1),
    wild("wild_all", "Wild Any", allColors, 0, 2),
]

private let classicDefinitions: [CardDefinition] = [
    money("money_1", 1, 6), money("money_2", 2, 5), money("money_3", 3, 3),
    money("money_4", 4, 3), money("money_5", 5, 2), money("money_10", 10, 1),
] + propertyCards + wildCards + [
    action("pass_go", "Pass Go", .pass_go, 1, 10),
    action("rent_color", "Rent (Any Color)", .rent, 3, 3, rent: allColors),
    action("rent_brown_light_blue", "Rent Brown/Light Blue", .rent_wild, 1, 2, rent: [.brown, .light_blue]),
    action("rent_pink_orange", "Rent Pink/Orange", .rent_wild, 1, 2, rent: [.pink, .orange]),
    action("rent_red_yellow", "Rent Red/Yellow", .rent_wild, 1, 2, rent: [.red, .yellow]),
    action("rent_green_dark_blue", "Rent Green/Dark Blue", .rent_wild, 1, 2, rent: [.green, .dark_blue]),
    action("rent_railroad_utility", "Rent Railroad/Utility", .rent_wild, 1, 2, rent: [.railroad, .utility]),
    action("double_rent", "Double Rent", .double_rent, 1, 2),
    action("debt_collector", "Debt Collector", .debt_collector, 3, 3),
    action("its_my_birthday", "It's My Birthday", .its_my_birthday, 2, 3),
    action("sly_deal", "Sly Deal", .sly_deal, 3, 3),
    action("forced_deal", "Forced Deal", .forced_deal, 3, 3),
    action("deal_breaker", "Deal Breaker", .deal_breaker, 5, 2),
    action("house", "House", .house, 3, 3, cardKind: .building),
    action("hotel", "Hotel", .hotel, 4, 2, cardKind: .building),
    action("just_say_no", "Just Say No", .just_say_no, 4, 3),
]

private let noMercyDefinitions: [CardDefinition] = [
    money("money_1", 1, 5), money("money_2", 2, 4), money("money_3", 3, 3), money("money_4", 4, 2),
    money("money_5", 5, 2), money("money_10", 10, 1), money("money_15", 15, 1),
] + propertyCards + wildCards + [
    action("rent_brown_light_blue", "Rent Brown/Light Blue", .rent_wild, 1, 1, rent: [.brown, .light_blue]),
    action("rent_pink_orange", "Rent Pink/Orange", .rent_wild, 1, 1, rent: [.pink, .orange]),
    action("rent_red_yellow", "Rent Red/Yellow", .rent_wild, 1, 1, rent: [.red, .yellow]),
    action("rent_green_dark_blue", "Rent Green/Dark Blue", .rent_wild, 1, 1, rent: [.green, .dark_blue]),
    action("rent_railroad_utility", "Rent Railroad/Utility", .rent_wild, 1, 1, rent: [.railroad, .utility]),
    action("double_rent_brown_light_blue", "Double Rent Brown/Light Blue", .double_rent, 1, 1, rent: [.brown, .light_blue]),
    action("double_rent_pink_orange", "Double Rent Pink/Orange", .double_rent, 1, 1, rent: [.pink, .orange]),
    action("double_rent_red_yellow", "Double Rent Red/Yellow", .double_rent, 1, 1, rent: [.red, .yellow]),
    action("double_rent_green_dark_blue", "Double Rent Green/Dark Blue", .double_rent, 1, 1, rent: [.green, .dark_blue]),
    action("double_rent_railroad_utility", "Double Rent Railroad/Utility", .double_rent, 1, 1, rent: [.railroad, .utility]),
    action("rent_any_color", "Rent (Any Color)", .rent, 3, 3, rent: allColors),
    action("double_rent_any_color", "Double Rent (Any Color)", .double_rent, 3, 3, rent: allColors),
    action("deal_breaker", "Deal Breaker", .deal_breaker, 3, 3),
    action("forced_debt", "Forced Debt", .forced_debt, 2, 3),
    action("go_again", "Go Again", .go_again, 1, 3),
    action("heist", "Heist", .heist, 4, 3),
    action("just_say_no", "Just Say No", .just_say_no, 4, 5),
    action("market_crash", "Market Crash", .market_crash, 4, 3),
    action("pass_go_go_go", "Pass Go, Go Go!", .pass_go, 1, 4),
    action("repossession", "Repossession", .repossession, 5, 2),
    action("shack", "Shack", .shack, 3, 3, cardKind: .building),
    action("super_sly_deal", "Super Sly Deal", .super_sly_deal, 3, 3),
    action("tax_collector", "Tax Collector", .tax_collector, 5, 2),
    action("tough_luck", "Tough Luck", .tough_luck, 5, 3),
    action("unfair_trade", "Unfair Trade", .unfair_trade, 4, 2),
    action("yoink", "Yoink!", .yoink, 2, 3),
]

private let classicById = Dictionary(uniqueKeysWithValues: classicDefinitions.map { ($0.id, $0) })
private let noMercyById = Dictionary(uniqueKeysWithValues: noMercyDefinitions.map { ($0.id, $0) })

/// Bots look cards up constantly, so every instance id is indexed ahead of time.
private func instanceIndex(_ definitions: [CardDefinition]) -> [String: CardDefinition] {
    var index: [String: CardDefinition] = [:]
    for definition in definitions {
        for copy in 1...definition.quantity { index["\(definition.id)#\(copy)"] = definition }
    }
    return index
}

private let classicInstances = instanceIndex(classicDefinitions)
private let noMercyInstances = instanceIndex(noMercyDefinitions)

public enum Catalog {
    /// What the server sends in place of a card the viewer isn't allowed to see.
    public static let hiddenCardId = "__hidden__"

    public static func definitions(_ variant: GameVariant) -> [CardDefinition] {
        variant == .no_mercy ? noMercyDefinitions : classicDefinitions
    }

    public static func deckSize(_ variant: GameVariant) -> Int {
        definitions(variant).reduce(0) { $0 + $1.quantity }
    }

    /// Looks up a card instance id such as `pass_go#3`. Nil for a card this build doesn't know,
    /// which can happen online if the server has a newer catalog than the app.
    public static func lookup(_ instanceId: String, _ variant: GameVariant) -> CardDefinition? {
        if let known = (variant == .no_mercy ? noMercyInstances : classicInstances)[instanceId] { return known }
        let base = instanceId.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? instanceId
        return (variant == .no_mercy ? noMercyById : classicById)[base]
    }

    public static func card(_ instanceId: String, _ variant: GameVariant) -> CardDefinition {
        guard let card = lookup(instanceId, variant) else {
            fatalError("Unknown card id: \(instanceId)")
        }
        return card
    }

    public static func isEveryColorWild(_ cardId: String, _ variant: GameVariant) -> Bool {
        let definition = card(cardId, variant)
        return definition.kind == .wild && definition.colors.count >= PropertyColor.allCases.count
    }

    /// Matches `getCardDisplayName`.
    public static func displayName(_ instanceId: String, _ variant: GameVariant) -> String {
        let definition = card(instanceId, variant)
        switch definition.kind {
        case .money: return "$\(definition.value) Money"
        case .property: return "\(definition.color!.label) Property"
        case .wild: return definition.colors.count > 4 ? "Wild Card" : definition.name
        default: return definition.name
        }
    }
}
