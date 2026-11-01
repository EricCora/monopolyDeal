import Foundation

/// Mirrors `src/engine/types.ts`, including the JSON shape, so online state and
/// saved games decode directly. Field names are the wire names.
public typealias PlayerId = String

public enum PlayerController: String, Codable, Hashable, Sendable { case human, bot }
public enum BotDifficulty: String, Codable, Hashable, Sendable { case easy, hard }

public struct PlayerConfig: Sendable {
    public var id: PlayerId
    public var name: String
    public var controller: PlayerController
    public var botDifficulty: BotDifficulty

    public init(id: PlayerId, name: String, controller: PlayerController = .human, botDifficulty: BotDifficulty = .easy) {
        self.id = id
        self.name = name
        self.controller = controller
        self.botDifficulty = botDifficulty
    }
}

public struct Ruleset: Codable, Hashable, Sendable {
    public var winCompleteSets: Int
    public var maxHandAtEndTurn: Int
    public var maxPlaysPerTurn: Int

    public init(winCompleteSets: Int = 3, maxHandAtEndTurn: Int = 7, maxPlaysPerTurn: Int = 3) {
        self.winCompleteSets = winCompleteSets
        self.maxHandAtEndTurn = maxHandAtEndTurn
        self.maxPlaysPerTurn = maxPlaysPerTurn
    }

    public static let standard = Ruleset()
}

public struct GameConfig: Sendable {
    public var players: [PlayerConfig]
    public var seed: Int?
    public var variant: GameVariant
    public var ruleset: Ruleset?

    public init(players: [PlayerConfig], seed: Int? = nil, variant: GameVariant = .classic, ruleset: Ruleset? = nil) {
        self.players = players
        self.seed = seed
        self.variant = variant
        self.ruleset = ruleset
    }
}

public struct PropertyCardPlacement: Codable, Hashable, Sendable {
    public var cardId: String
    public var assignedColor: PropertyColor
    public var setId: String?
    public var attachedToCardId: String?

    public init(cardId: String, assignedColor: PropertyColor, setId: String? = nil, attachedToCardId: String? = nil) {
        self.cardId = cardId
        self.assignedColor = assignedColor
        self.setId = setId
        self.attachedToCardId = attachedToCardId
    }
}

public struct DebtRecord: Codable, Hashable, Sendable {
    public var id: String?
    public var chipId: String?
    public var debtorPlayerId: PlayerId?
    public var creditorPlayerId: PlayerId
    public var amount: Int?
    public var createdTurn: Int?
}

/// The ten color lanes, stored in catalog order so copying a game state stays cheap.
public struct PropertyLanes: Hashable, Sendable, Codable {
    private var lanes: [[PropertyCardPlacement]]

    public init() {
        lanes = Array(repeating: [], count: PropertyColor.allCases.count)
    }

    @inline(__always)
    private static func index(_ color: PropertyColor) -> Int {
        switch color {
        case .brown: 0
        case .light_blue: 1
        case .pink: 2
        case .orange: 3
        case .red: 4
        case .yellow: 5
        case .green: 6
        case .dark_blue: 7
        case .railroad: 8
        case .utility: 9
        }
    }

    public subscript(color: PropertyColor) -> [PropertyCardPlacement] {
        get { lanes[Self.index(color)] }
        set { lanes[Self.index(color)] = newValue }
        _modify { yield &lanes[Self.index(color)] }
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public init(from decoder: Decoder) throws {
        self.init()
        let container = try decoder.container(keyedBy: Key.self)
        for color in PropertyColor.allCases {
            self[color] = try container.decodeIfPresent([PropertyCardPlacement].self, forKey: Key(stringValue: color.rawValue)) ?? []
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        for color in PropertyColor.allCases {
            try container.encode(self[color], forKey: Key(stringValue: color.rawValue))
        }
    }
}

public struct PlayerState: Hashable, Sendable {
    public var id: PlayerId
    public var name: String
    public var controller: PlayerController?
    public var botDifficulty: BotDifficulty?
    public var hand: [String]
    public var bank: [String]
    public var properties: PropertyLanes
    /// Debts this player owes. The wire format repeats this as `debtsOwed`.
    public var debts: [DebtRecord]?
    public var debtChipsRemaining: Int?
    /// Chips held from other players. The wire format repeats this as `debtChips`.
    public var debtChipsHeld: [DebtRecord]?

    public init(id: PlayerId, name: String, controller: PlayerController?, botDifficulty: BotDifficulty?, hand: [String], bank: [String], properties: PropertyLanes, debts: [DebtRecord]? = nil, debtChipsRemaining: Int? = nil, debtChipsHeld: [DebtRecord]? = nil) {
        self.id = id
        self.name = name
        self.controller = controller
        self.botDifficulty = botDifficulty
        self.hand = hand
        self.bank = bank
        self.properties = properties
        self.debts = debts
        self.debtChipsRemaining = debtChipsRemaining
        self.debtChipsHeld = debtChipsHeld
    }
}

extension PlayerState: Codable {
    private enum CodingKeys: String, CodingKey {
        case id, name, controller, botDifficulty, hand, bank, properties, debts, debtsOwed, debtChipsRemaining, debtChipsHeld, debtChips
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        controller = try container.decodeIfPresent(PlayerController.self, forKey: .controller)
        botDifficulty = try container.decodeIfPresent(BotDifficulty.self, forKey: .botDifficulty)
        hand = try container.decodeIfPresent([String].self, forKey: .hand) ?? []
        bank = try container.decodeIfPresent([String].self, forKey: .bank) ?? []
        properties = try container.decodeIfPresent(PropertyLanes.self, forKey: .properties) ?? PropertyLanes()
        let primary = try container.decodeIfPresent([DebtRecord].self, forKey: .debts)
        let alias = try container.decodeIfPresent([DebtRecord].self, forKey: .debtsOwed)
        if let alias, !alias.isEmpty, primary?.isEmpty ?? true {
            debts = alias
        } else {
            debts = primary ?? alias
        }
        debtChipsRemaining = try container.decodeIfPresent(Int.self, forKey: .debtChipsRemaining)
        debtChipsHeld = try container.decodeIfPresent([DebtRecord].self, forKey: .debtChipsHeld)
            ?? container.decodeIfPresent([DebtRecord].self, forKey: .debtChips)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encodeIfPresent(controller, forKey: .controller)
        try container.encodeIfPresent(botDifficulty, forKey: .botDifficulty)
        try container.encode(hand, forKey: .hand)
        try container.encode(bank, forKey: .bank)
        try container.encode(properties, forKey: .properties)
        try container.encodeIfPresent(debts, forKey: .debts)
        try container.encodeIfPresent(debts, forKey: .debtsOwed)
        try container.encodeIfPresent(debtChipsRemaining, forKey: .debtChipsRemaining)
        try container.encodeIfPresent(debtChipsHeld, forKey: .debtChipsHeld)
        try container.encodeIfPresent(debtChipsHeld, forKey: .debtChips)
    }
}

public enum TurnPhase: String, Codable, Hashable, Sendable { case draw, debt, action, finished }

public struct TurnState: Codable, Hashable, Sendable {
    public var phase: TurnPhase
    public var playsUsed: Int
    public var doubleRentMultiplier: Int
    public var endingTurn: Bool?

    public static let fresh = TurnState(phase: .draw, playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false)
    public static let actionWindow = TurnState(phase: .action, playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false)
}

public struct GameEventDetails: Codable, Hashable, Sendable {
    public var kind: String
    public var sourcePlayerId: PlayerId?
    public var targetPlayerId: PlayerId?
    public var cardIds: [String]?
    public var mode: String?
    public var playerId: PlayerId?
    public var count: Int?
    public var reason: String?
}

public struct GameEvent: Codable, Hashable, Sendable {
    public var timestamp: Double
    public var type: String
    public var message: String
    public var details: GameEventDetails?
}

public struct PaymentRequest: Codable, Hashable, Sendable {
    public var sourcePlayerId: PlayerId
    public var targetPlayerId: PlayerId
    public var amount: Int
    public var reason: String
    public var actionCardId: String
    public var remainingTargetPlayerIds: [PlayerId]?
}

public struct PendingDeal: Codable, Hashable, Sendable {
    public var sourcePlayerId: PlayerId
    public var targetPlayerId: PlayerId
    public var actionCardId: String
}

public struct PendingRent: Codable, Hashable, Sendable {
    public var sourcePlayerId: PlayerId
    public var actionCardId: String
    public var color: PropertyColor
    public var amount: Int
}

public struct PendingDebtCard: Codable, Hashable, Sendable {
    public var debtorPlayerId: PlayerId
    public var creditorPlayerId: PlayerId
    public var debtId: String
    public var cardId: String
}

public enum ToughLuckChoice: String, Codable, Hashable, Sendable, CaseIterable { case property, money, action }

public struct RedistributionItem: Codable, Hashable, Sendable {
    public var cardId: String
    public var color: PropertyColor?
    public var setId: String?
    public var attachedToCardId: String?
}

public struct PendingNoMercy: Codable, Hashable, Sendable {
    public var sourcePlayerId: PlayerId
    public var actionCardId: String
    public var effect: String
    public var targetPlayerIds: [PlayerId]?
    public var targetPlayerId: PlayerId?
    public var color: PropertyColor?
    public var step: String?
    public var cardId: String?
    public var recipientPlayerId: PlayerId?
    public var choice: ToughLuckChoice?
    public var redistribution: [RedistributionItem]?
}

public enum PendingEffect: Hashable, Sendable {
    case payment(PaymentRequest)
    case slyDeal(PendingDeal)
    case forcedDeal(PendingDeal)
    case dealBreaker(PendingDeal)
    case rent(PendingRent)
    case noMercy(PendingNoMercy)
}

extension PendingEffect: Codable {
    private enum CodingKeys: String, CodingKey { case kind, payload }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "payment": self = .payment(try container.decode(PaymentRequest.self, forKey: .payload))
        case "sly_deal": self = .slyDeal(try container.decode(PendingDeal.self, forKey: .payload))
        case "forced_deal": self = .forcedDeal(try container.decode(PendingDeal.self, forKey: .payload))
        case "deal_breaker": self = .dealBreaker(try container.decode(PendingDeal.self, forKey: .payload))
        case "rent": self = .rent(try container.decode(PendingRent.self, forKey: .payload))
        case "no_mercy": self = .noMercy(try container.decode(PendingNoMercy.self, forKey: .payload))
        default:
            throw DecodingError.dataCorruptedError(forKey: .kind, in: container, debugDescription: "Unknown effect kind \(kind)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .payment(let payload):
            try container.encode("payment", forKey: .kind)
            try container.encode(payload, forKey: .payload)
        case .slyDeal(let payload):
            try container.encode("sly_deal", forKey: .kind)
            try container.encode(payload, forKey: .payload)
        case .forcedDeal(let payload):
            try container.encode("forced_deal", forKey: .kind)
            try container.encode(payload, forKey: .payload)
        case .dealBreaker(let payload):
            try container.encode("deal_breaker", forKey: .kind)
            try container.encode(payload, forKey: .payload)
        case .rent(let payload):
            try container.encode("rent", forKey: .kind)
            try container.encode(payload, forKey: .payload)
        case .noMercy(let payload):
            try container.encode("no_mercy", forKey: .kind)
            try container.encode(payload, forKey: .payload)
        }
    }
}

public struct CounterChainLink: Codable, Hashable, Sendable {
    public var playerId: PlayerId
    public var cardId: String
}

public struct CounterRequest: Codable, Hashable, Sendable {
    public var sourcePlayerId: PlayerId
    public var targetPlayerId: PlayerId
    public var actionCardId: String
    public var effect: PendingEffect
    public var chain: [CounterChainLink]
    public var awaitingPlayerId: PlayerId
}

public enum PendingInteraction: Hashable, Sendable {
    case counter(CounterRequest)
    case payment(PaymentRequest)
    case slyDeal(PendingDeal)
    case forcedDeal(PendingDeal)
    case dealBreaker(PendingDeal)
    case rent(PendingRent)
    case debtCard(PendingDebtCard)
    case noMercy(PendingNoMercy)

    public init(effect: PendingEffect) {
        switch effect {
        case .payment(let payload): self = .payment(payload)
        case .slyDeal(let payload): self = .slyDeal(payload)
        case .forcedDeal(let payload): self = .forcedDeal(payload)
        case .dealBreaker(let payload): self = .dealBreaker(payload)
        case .rent(let payload): self = .rent(payload)
        case .noMercy(let payload): self = .noMercy(payload)
        }
    }
}

extension PendingInteraction: Codable {
    private enum CodingKeys: String, CodingKey { case kind, payload }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let kind = try container.decode(String.self, forKey: .kind)
        switch kind {
        case "counter": self = .counter(try container.decode(CounterRequest.self, forKey: .payload))
        case "debt_card": self = .debtCard(try container.decode(PendingDebtCard.self, forKey: .payload))
        default: self = PendingInteraction(effect: try PendingEffect(from: decoder))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .counter(let payload):
            try container.encode("counter", forKey: .kind)
            try container.encode(payload, forKey: .payload)
        case .debtCard(let payload):
            try container.encode("debt_card", forKey: .kind)
            try container.encode(payload, forKey: .payload)
        case .payment(let payload): try PendingEffect.payment(payload).encode(to: encoder)
        case .slyDeal(let payload): try PendingEffect.slyDeal(payload).encode(to: encoder)
        case .forcedDeal(let payload): try PendingEffect.forcedDeal(payload).encode(to: encoder)
        case .dealBreaker(let payload): try PendingEffect.dealBreaker(payload).encode(to: encoder)
        case .rent(let payload): try PendingEffect.rent(payload).encode(to: encoder)
        case .noMercy(let payload): try PendingEffect.noMercy(payload).encode(to: encoder)
        }
    }
}

public struct GameState: Codable, Hashable, Sendable {
    public var version: Int
    public var createdAt: Double
    public var updatedAt: Double
    public var deckVersion: String
    public var variant: GameVariant?
    public var ruleset: Ruleset?
    public var players: [PlayerState]
    public var drawPile: [String]
    public var discardPile: [String]
    public var currentPlayerIndex: Int
    public var turn: TurnState
    public var pending: PendingInteraction?
    public var history: [GameEvent]
    public var winnerId: PlayerId?
    public var turnCount: Int

    private enum CodingKeys: String, CodingKey {
        case version, createdAt, updatedAt, deckVersion, variant, ruleset, players, drawPile, discardPile
        case currentPlayerIndex, turn, pending, history, winnerId, turnCount
    }

    public init(version: Int, createdAt: Double, updatedAt: Double, deckVersion: String, variant: GameVariant?, ruleset: Ruleset?, players: [PlayerState], drawPile: [String], discardPile: [String], currentPlayerIndex: Int, turn: TurnState, pending: PendingInteraction?, history: [GameEvent], winnerId: PlayerId?, turnCount: Int) {
        self.version = version
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deckVersion = deckVersion
        self.variant = variant
        self.ruleset = ruleset
        self.players = players
        self.drawPile = drawPile
        self.discardPile = discardPile
        self.currentPlayerIndex = currentPlayerIndex
        self.turn = turn
        self.pending = pending
        self.history = history
        self.winnerId = winnerId
        self.turnCount = turnCount
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
        try container.encode(deckVersion, forKey: .deckVersion)
        try container.encodeIfPresent(variant, forKey: .variant)
        try container.encodeIfPresent(ruleset, forKey: .ruleset)
        try container.encode(players, forKey: .players)
        try container.encode(drawPile, forKey: .drawPile)
        try container.encode(discardPile, forKey: .discardPile)
        try container.encode(currentPlayerIndex, forKey: .currentPlayerIndex)
        try container.encode(turn, forKey: .turn)
        // `pending` is always present in the TypeScript state, as null when idle.
        if let pending { try container.encode(pending, forKey: .pending) } else { try container.encodeNil(forKey: .pending) }
        try container.encode(history, forKey: .history)
        try container.encodeIfPresent(winnerId, forKey: .winnerId)
        try container.encode(turnCount, forKey: .turnCount)
    }

    public var resolvedVariant: GameVariant { variant == .no_mercy ? .no_mercy : .classic }
}

public enum RuleErrorCode: String, Codable, Sendable {
    case invalid_phase, invalid_turn, invalid_action, hand_limit, invalid_target
    case illegal_play_limit, insufficient_cards, unresolved_pending, unknown_card
}

public struct RuleError: Error, Hashable, Sendable {
    public var code: RuleErrorCode
    public var message: String

    public init(_ code: RuleErrorCode, _ message: String) {
        self.code = code
        self.message = message
    }
}

public enum ActionType: String, Codable, Hashable, Sendable {
    case draw_cards, pass_turn, play_to_bank, play_property, move_wild, play_action, discard_card
    case counter_response, pay_request, repay_debt, resolve_debt_card, no_mercy_pick
    case sly_deal_pick, forced_deal_pick, deal_breaker_pick
}

/// A flat form of the TypeScript `Action` union. Only the fields a given type uses
/// are set, and unset fields are left out of the JSON, so it matches on the wire.
public struct Action: Codable, Hashable, Sendable {
    public var type: ActionType
    public var playerId: PlayerId
    public var cardId: String?
    public var color: PropertyColor?
    public var setId: String?
    public var attachedToCardId: String?
    public var fromColor: PropertyColor?
    public var toColor: PropertyColor?
    public var fromSetId: String?
    public var targetPlayerId: PlayerId?
    public var useJustSayNo: Bool?
    public var cards: [String]?
    public var debtId: String?
    public var chipId: String?
    public var creditorPlayerId: PlayerId?
    public var mode: String?
    public var actionCardId: String?
    public var recipientPlayerId: PlayerId?
    public var choice: ToughLuckChoice?
    public var sourceColor: PropertyColor?
    public var destinationColor: PropertyColor?
    public var sourceSetId: String?
    public var giveCardId: String?
    public var giveColor: PropertyColor?
    public var takeCardId: String?
    public var takeColor: PropertyColor?
    public var giveSetId: String?
    public var takeSetId: String?

    public init(_ type: ActionType, playerId: PlayerId) {
        self.type = type
        self.playerId = playerId
    }
}

extension Action {
    /// The action as JSON, with keys in the order the TypeScript engine writes them. The
    /// server decides legality by comparing `JSON.stringify` text, so key order is part
    /// of the protocol. Always send actions to a room in this form.
    public var wireJSON: String {
        var parts = ["\"type\":\(Self.quoted(type.rawValue))", "\"playerId\":\(Self.quoted(playerId))"]
        func add(_ key: String, _ value: String?) {
            if let value { parts.append("\"\(key)\":\(Self.quoted(value))") }
        }
        switch type {
        case .draw_cards, .pass_turn:
            break
        case .play_to_bank, .discard_card:
            add("cardId", cardId)
        case .play_property:
            add("cardId", cardId)
            add("color", color?.rawValue)
            add("setId", setId)
            add("attachedToCardId", attachedToCardId)
        case .move_wild:
            add("cardId", cardId)
            add("fromColor", fromColor?.rawValue)
            add("toColor", toColor?.rawValue)
            add("fromSetId", fromSetId)
            add("setId", setId)
        case .play_action:
            add("cardId", cardId)
            add("targetPlayerId", targetPlayerId)
            add("color", color?.rawValue)
        case .counter_response:
            if let useJustSayNo { parts.append("\"useJustSayNo\":\(useJustSayNo)") }
            add("cardId", cardId)
        case .pay_request:
            parts.append("\"cards\":[\((cards ?? []).map(Self.quoted).joined(separator: ","))]")
        case .repay_debt:
            add("debtId", debtId)
            add("chipId", chipId)
            add("creditorPlayerId", creditorPlayerId)
            add("cardId", cardId)
        case .resolve_debt_card:
            add("debtId", debtId)
            add("cardId", cardId)
            add("mode", mode)
            add("targetPlayerId", targetPlayerId)
            add("color", color?.rawValue)
            add("setId", setId)
        case .no_mercy_pick:
            add("actionCardId", actionCardId)
            add("targetPlayerId", targetPlayerId)
            add("cardId", cardId)
            add("color", color?.rawValue)
            add("recipientPlayerId", recipientPlayerId)
            add("choice", choice?.rawValue)
        case .sly_deal_pick:
            add("cardId", cardId)
            add("sourceColor", sourceColor?.rawValue)
            add("destinationColor", destinationColor?.rawValue)
            add("sourceSetId", sourceSetId)
            add("setId", setId)
        case .forced_deal_pick:
            add("giveCardId", giveCardId)
            add("giveColor", giveColor?.rawValue)
            add("takeCardId", takeCardId)
            add("takeColor", takeColor?.rawValue)
            add("destinationColor", destinationColor?.rawValue)
            add("giveSetId", giveSetId)
            add("takeSetId", takeSetId)
            add("setId", setId)
        case .deal_breaker_pick:
            add("color", color?.rawValue)
            add("setId", setId)
        }
        return "{\(parts.joined(separator: ","))}"
    }

    private static func quoted(_ text: String) -> String {
        var output = "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": output += "\\\""
            case "\\": output += "\\\\"
            default: output.unicodeScalars.append(scalar)
            }
        }
        return output + "\""
    }
}

public enum RiskLevel: String, Codable, Hashable, Sendable { case low, medium, high }

public struct LegalAction: Codable, Hashable, Sendable {
    public var label: String
    public var action: Action
    public var targetPlayerId: PlayerId?
    public var requestedAmount: Int?
    public var collectibleCap: Int?
    public var requiresPropertyTransfer: Bool?
    public var requiresConfirmation: Bool?
    public var riskLevel: RiskLevel?
    public var previewText: String?

    public init(label: String, action: Action, targetPlayerId: PlayerId? = nil, requestedAmount: Int? = nil, collectibleCap: Int? = nil, requiresPropertyTransfer: Bool? = nil, requiresConfirmation: Bool? = nil, riskLevel: RiskLevel? = nil, previewText: String? = nil) {
        self.label = label
        self.action = action
        self.targetPlayerId = targetPlayerId
        self.requestedAmount = requestedAmount
        self.collectibleCap = collectibleCap
        self.requiresPropertyTransfer = requiresPropertyTransfer
        self.requiresConfirmation = requiresConfirmation
        self.riskLevel = riskLevel
        self.previewText = previewText
    }
}

public struct ApplyResult: Sendable {
    public var state: GameState
    public var events: [GameEvent]
    public var error: RuleError?

    public init(state: GameState, events: [GameEvent], error: RuleError? = nil) {
        self.state = state
        self.events = events
        self.error = error
    }
}

public enum PromptKind: String, Codable, Hashable, Sendable {
    case draw, debt, main, response, payment, selection, discard
}

public struct TurnPrompt: Codable, Hashable, Sendable {
    public var playerId: PlayerId
    public var text: String
    public var kind: PromptKind
}

public struct PropertySetView: Hashable, Sendable {
    public var setId: String
    public var entries: [PropertyCardPlacement]
}
