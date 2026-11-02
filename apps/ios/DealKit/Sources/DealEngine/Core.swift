import Foundation

/// Mirrors `src/engine/core.ts`. Keep behavior identical: the conformance test in
/// DealKitTests replays games recorded from the TypeScript engine.
public enum Engine {
    public static let maxHandAtEndTurn = 7
    public static let defaultRuleset = Ruleset.standard
    public static let propertyColors = PropertyColor.allCases

    public static func gameVariant(_ state: GameState) -> GameVariant { state.resolvedVariant }

    /// Fills in fields that older saves omit. Missing variants are Classic.
    public static func normalizeGameState(_ input: GameState) -> GameState {
        var state = input
        let variant = state.resolvedVariant
        state.variant = variant
        if variant == .no_mercy { state.ruleset = defaultRuleset }
        for index in state.players.indices {
            state.players[index].debts = state.players[index].debts ?? []
            if variant == .no_mercy {
                state.players[index].debtChipsRemaining = state.players[index].debtChipsRemaining ?? 3
                state.players[index].debtChipsHeld = state.players[index].debtChipsHeld ?? []
            }
        }
        return state
    }

    static func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded(.down) }

    public struct SeededRandom: Sendable {
        private var value: Int

        public init(seed: Int) {
            var value = seed % 2147483647
            if value <= 0 { value += 2147483646 }
            self.value = value
        }

        public mutating func next() -> Double {
            value = (value * 16807) % 2147483647
            return Double(value - 1) / 2147483646
        }
    }

    static func shuffle(_ array: [String], rand: inout SeededRandom) -> [String] {
        var clone = array
        var i = clone.count - 1
        while i > 0 {
            let j = Int((rand.next() * Double(i + 1)).rounded(.down))
            clone.swapAt(i, j)
            i -= 1
        }
        return clone
    }

    public static func ruleset(_ state: GameState) -> Ruleset {
        state.variant == .no_mercy ? defaultRuleset : state.ruleset ?? defaultRuleset
    }

    static func pushEvent(_ events: inout [GameEvent], _ type: String, _ message: String, details: GameEventDetails? = nil) {
        events.append(GameEvent(timestamp: now(), type: type, message: message, details: details))
    }

    public static func playerIndex(_ state: GameState, _ playerId: PlayerId) -> Int? {
        state.players.firstIndex { $0.id == playerId }
    }

    public static func player(_ state: GameState, _ playerId: PlayerId) -> PlayerState? {
        state.players.first { $0.id == playerId }
    }

    public static func currentPlayer(_ state: GameState) -> PlayerState {
        state.players[state.currentPlayerIndex]
    }

    @discardableResult
    static func drawCards(_ state: inout GameState, playerAt index: Int, amount: Int) -> [String] {
        var drawn: [String] = []
        for _ in 0..<max(0, amount) {
            if state.drawPile.isEmpty {
                if state.discardPile.isEmpty { break }
                var rand = SeededRandom(seed: state.turnCount + state.history.count + 1)
                state.drawPile = shuffle(state.discardPile, rand: &rand)
                state.discardPile = []
            }
            if let card = state.drawPile.popLast() {
                state.players[index].hand.append(card)
                drawn.append(card)
            }
        }
        return drawn
    }

    static func removeFromHand(_ player: inout PlayerState, _ cardId: String) -> Bool {
        guard let index = player.hand.firstIndex(of: cardId) else { return false }
        player.hand.remove(at: index)
        return true
    }

    private static func isPropertyPlacement(_ entry: PropertyCardPlacement, _ variant: GameVariant) -> Bool {
        let kind = Catalog.card(entry.cardId, variant).kind
        return kind == .property || kind == .wild
    }

    private static func isStandardPlacement(_ entry: PropertyCardPlacement, _ variant: GameVariant) -> Bool {
        Catalog.card(entry.cardId, variant).kind == .property
    }

    private static func propertyCount(_ set: PropertySetView, _ variant: GameVariant) -> Int {
        set.entries.reduce(0) { $0 + (isPropertyPlacement($1, variant) ? 1 : 0) }
    }

    private static func hasStandardProperty(_ set: PropertySetView, _ variant: GameVariant) -> Bool {
        set.entries.contains { isStandardPlacement($0, variant) }
    }

    private static func hasBuilding(_ set: PropertySetView, _ kind: ActionKind?, _ variant: GameVariant) -> Bool {
        set.entries.contains { Catalog.card($0.cardId, variant).actionKind == kind }
    }

    private static func isRainbowWild(_ entry: PropertyCardPlacement, _ variant: GameVariant) -> Bool {
        let definition = Catalog.card(entry.cardId, variant)
        return definition.kind == .wild && definition.colors.count >= propertyColors.count
    }

    private static func generatedSetId(_ color: PropertyColor, _ index: Int) -> String {
        "\(color.rawValue):auto-\(index)"
    }

    static func allocatePropertySetId(_ player: PlayerState, _ color: PropertyColor, preferred: String, _ variant: GameVariant) -> String {
        let used = Set(propertySets(player, color, variant).map(\.setId))
        if !used.contains(preferred) { return preferred }
        var suffix = 2
        while used.contains("\(preferred)-\(suffix)") { suffix += 1 }
        return "\(preferred)-\(suffix)"
    }

    /// Derives physical sets from a color lane. Untagged cards from older saves are
    /// assigned standard properties first, so a wild-only lane can't complete by accident.
    public static func propertySets(_ player: PlayerState, _ color: PropertyColor, _ variant: GameVariant) -> [PropertySetView] {
        let entries = player.properties[color]
        if entries.isEmpty { return [] }
        let required = color.setSize
        var groups: [PropertySetView] = []
        var usedIds = Set<String>()
        var hasUntagged = false

        for entry in entries {
            guard let setId = entry.setId else {
                hasUntagged = true
                continue
            }
            if let index = groups.firstIndex(where: { $0.setId == setId }) {
                groups[index].entries.append(entry)
            } else {
                groups.append(PropertySetView(setId: setId, entries: [entry]))
                usedIds.insert(setId)
            }
        }
        if !hasUntagged { return groups }

        var nextId = 1
        func createGroup() -> Int {
            while usedIds.contains(generatedSetId(color, nextId)) { nextId += 1 }
            let group = PropertySetView(setId: generatedSetId(color, nextId), entries: [])
            nextId += 1
            groups.append(group)
            usedIds.insert(group.setId)
            return groups.count - 1
        }
        func chooseOpenGroup(preferStandard: Bool) -> Int {
            let open = groups.indices.filter { propertyCount(groups[$0], variant) < required }
            if preferStandard, let withStandard = open.first(where: { hasStandardProperty(groups[$0], variant) }) {
                return withStandard
            }
            return open.first ?? createGroup()
        }

        let untagged = entries.filter { $0.setId == nil }
        for entry in untagged where isStandardPlacement(entry, variant) {
            let index = chooseOpenGroup(preferStandard: false)
            groups[index].entries.append(entry)
        }
        for entry in untagged where isPropertyPlacement(entry, variant) && !isStandardPlacement(entry, variant) {
            let index = chooseOpenGroup(preferStandard: true)
            groups[index].entries.append(entry)
        }
        for entry in untagged where !isPropertyPlacement(entry, variant) {
            let kind = Catalog.card(entry.cardId, variant).actionKind
            let eligible = groups.indices.first {
                propertyCount(groups[$0], variant) >= required && !hasBuilding(groups[$0], kind, variant)
            }
            let index = eligible ?? (groups.isEmpty ? createGroup() : 0)
            groups[index].entries.append(entry)
        }
        return groups
    }

    /// Writes the derived set ids onto a player's placements before a lane changes.
    static func normalizePropertySets(_ player: inout PlayerState, _ variant: GameVariant) {
        for color in propertyColors where player.properties[color].contains(where: { $0.setId == nil }) {
            var assigned: [String: String] = [:]
            for set in propertySets(player, color, variant) {
                for entry in set.entries { assigned[entry.cardId] = set.setId }
            }
            for index in player.properties[color].indices {
                player.properties[color][index].setId = assigned[player.properties[color][index].cardId]
            }
        }
    }

    static func findPropertySetId(_ player: PlayerState, _ color: PropertyColor, cardId: String, _ variant: GameVariant) -> String? {
        propertySets(player, color, variant).first { $0.entries.contains { $0.cardId == cardId } }?.setId
    }

    public static func isCompletePropertySet(_ entries: [PropertyCardPlacement], _ color: PropertyColor, _ variant: GameVariant) -> Bool {
        let properties = entries.filter { isPropertyPlacement($0, variant) }
        if properties.count < color.setSize { return false }
        // Any-color Wilds can't complete a set on their own, but anything else can sit beside them.
        return properties.contains { !Catalog.isEveryColorWild($0.cardId, variant) }
    }

    private static func consolidateOnce(_ player: inout PlayerState, _ color: PropertyColor, _ variant: GameVariant) -> Bool {
        let required = color.setSize
        let open = propertySets(player, color, variant).filter { !isCompletePropertySet($0.entries, color, variant) }
        if open.count < 2 { return false }
        func properties(_ set: PropertySetView) -> [PropertyCardPlacement] { set.entries.filter { isPropertyPlacement($0, variant) } }
        func riders(_ set: PropertySetView, _ entry: PropertyCardPlacement) -> [PropertyCardPlacement] { set.entries.filter { $0.attachedToCardId == entry.cardId } }
        func setSetId(_ cardId: String, _ setId: String, _ player: inout PlayerState) {
            if let index = player.properties[color].firstIndex(where: { $0.cardId == cardId }) { player.properties[color][index].setId = setId }
        }

        // A pile full of any-color Wilds needs one real card, and gives back a Wild for it.
        if let stuck = open.first(where: { properties($0).count >= required }) {
            for other in open where other.setId != stuck.setId {
                let real = properties(other).first { !Catalog.isEveryColorWild($0.cardId, variant) && riders(other, $0).isEmpty }
                let spare = properties(stuck).reversed().first { riders(stuck, $0).isEmpty }
                if let real, let spare {
                    setSetId(real.cardId, stuck.setId, &player)
                    setSetId(spare.cardId, other.setId, &player)
                    return true
                }
            }
            return false
        }

        let target = open[0]
        for source in open.dropFirst().reversed() {
            let reversed = Array(properties(source).reversed())
            // A stable sort, like the web's: real cards before any-color Wilds.
            let candidates = reversed.filter { !Catalog.isEveryColorWild($0.cardId, variant) } + reversed.filter { Catalog.isEveryColorWild($0.cardId, variant) }
            for entry in candidates {
                let moving = [entry] + riders(source, entry)
                let completes = properties(target).count + 1 >= required
                let shacks = (target.entries + moving).filter { Catalog.card($0.cardId, variant).actionKind == .shack }.count
                if completes && shacks > 1 { continue }
                for card in moving { setSetId(card.cardId, target.setId, &player) }
                // A building left with nothing under it goes along with the cards.
                if properties(source).count == 1 {
                    for left in source.entries { setSetId(left.cardId, target.setId, &player) }
                }
                return true
            }
        }
        return false
    }

    /// Piles of one color exist so a spare card has somewhere to go, and paying with a card can
    /// leave two partial piles behind. Standard cards can't be moved by hand, so those rejoin here.
    static func consolidatePropertySets(_ player: inout PlayerState, _ variant: GameVariant) {
        for color in PropertyColor.allCases {
            while consolidateOnce(&player, color, variant) {}
        }
    }

    static func isBuildingPlacementLegal(_ player: PlayerState, _ color: PropertyColor, _ kind: ActionKind?, setId: String?, _ variant: GameVariant) -> Bool {
        if color == .railroad || color == .utility { return false }
        let eligible = propertySets(player, color, variant).filter { isCompletePropertySet($0.entries, color, variant) }
        let target: PropertySetView?
        if let setId {
            target = eligible.first { $0.setId == setId }
        } else {
            target = eligible.first { !hasBuilding($0, kind, variant) && (kind != .hotel || hasBuilding($0, .house, variant)) }
        }
        guard let target else { return false }
        if hasBuilding(target, kind, variant) { return false }
        if kind == .hotel && !hasBuilding(target, .house, variant) { return false }
        return true
    }

    static func isShackPlacementLegal(_ player: PlayerState, _ color: PropertyColor, setId: String?, attachedTo: String?, _ variant: GameVariant) -> Bool {
        let sets = propertySets(player, color, variant)
        guard let target = setId.map({ id in sets.first { $0.setId == id } }) ?? sets.first else { return false }
        let properties = target.entries.filter { isPropertyPlacement($0, variant) }
        if properties.isEmpty { return false }
        // No Mercy allows one Shack on each loose property, but a completed
        // property set may contain only one Shack total.
        if variant == .no_mercy,
           isCompletePropertySet(target.entries, color, variant),
           target.entries.contains(where: { Catalog.card($0.cardId, variant).actionKind == .shack }) {
            return false
        }
        if let attachedTo {
            return properties.contains { $0.cardId == attachedTo }
                && !target.entries.contains { $0.attachedToCardId == attachedTo }
        }
        return properties.contains { entry in !target.entries.contains { $0.attachedToCardId == entry.cardId } }
    }

    static func addToProperty(_ player: inout PlayerState, _ cardId: String, _ color: PropertyColor, setId: String?, attachedTo: String?, _ variant: GameVariant) {
        normalizePropertySets(&player, variant)
        let card = Catalog.card(cardId, variant)
        let required = color.setSize
        let sets = propertySets(player, color, variant)
        var target: PropertySetView? = setId.flatMap { id in sets.first { $0.setId == id } }
        // An explicit set id is a physical-group instruction. If this is a newly
        // transferred set, create that group before the normal "first open set"
        // placement heuristic can merge it into an existing lane.
        if target == nil, let setId { target = PropertySetView(setId: setId, entries: []) }

        if target == nil && card.kind == .building {
            target = sets.first {
                isCompletePropertySet($0.entries, color, variant)
                    && color != .railroad && color != .utility
                    && !hasBuilding($0, card.actionKind, variant)
            }
        }
        func firstUnusedGeneratedId() -> String {
            let used = Set(sets.map(\.setId))
            var index = 1
            while used.contains(generatedSetId(color, index)) { index += 1 }
            return generatedSetId(color, index)
        }
        if target == nil && card.kind != .building {
            // A complete No Mercy set may hold only one Shack, so a card that would
            // complete a set carrying two starts a new physical set instead.
            let open = sets.filter { set in
                propertyCount(set, variant) < required
                    && !(variant == .no_mercy
                        && propertyCount(set, variant) + 1 >= required
                        && set.entries.filter { Catalog.card($0.cardId, variant).actionKind == .shack }.count > 1)
            }
            target = card.kind == .wild
                ? open.first { hasStandardProperty($0, variant) } ?? open.first
                : open.first
            if target == nil && card.kind == .property {
                // A standard property can complete a wild-only group. Move one excess
                // wild into its own group first so the original group remains physical.
                let wildOnly = sets.first { !hasStandardProperty($0, variant) && propertyCount($0, variant) >= required && !isCompletePropertySet($0.entries, color, variant) }
                let excess = wildOnly?.entries.last { Catalog.card($0.cardId, variant).kind == .wild }
                if let wildOnly, let excess {
                    let nextId = firstUnusedGeneratedId()
                    if let index = player.properties[color].firstIndex(where: { $0.cardId == excess.cardId }) {
                        player.properties[color][index].setId = nextId
                    }
                    target = wildOnly
                }
            }
        }
        let resolvedSetId = target?.setId ?? setId ?? firstUnusedGeneratedId()
        player.properties[color].append(PropertyCardPlacement(cardId: cardId, assignedColor: color, setId: resolvedSetId, attachedToCardId: attachedTo))
    }

    @discardableResult
    static func removePropertyCard(_ player: inout PlayerState, _ color: PropertyColor, _ cardId: String, setId: String? = nil) -> PropertyCardPlacement? {
        guard let index = player.properties[color].firstIndex(where: { $0.cardId == cardId && (setId == nil || $0.setId == setId) }) else { return nil }
        return player.properties[color].remove(at: index)
    }

    static func attachedPropertyCards(_ player: PlayerState, _ color: PropertyColor, _ cardId: String, setId: String?) -> [PropertyCardPlacement] {
        player.properties[color].filter { $0.attachedToCardId == cardId && (setId == nil || $0.setId == setId) }
    }

    /// The cheapest pick from `cards` that reaches `amount`: least overpaid, then fewest banked action cards, then fewest cards.
    private static func cheapestCover(_ cards: [String], _ amount: Int, _ variant: GameVariant) -> [String]? {
        func actions(_ pick: [String]) -> Int { pick.filter { Catalog.card($0, variant).kind != .money }.count }
        var picks: [Int: [String]] = [0: []]
        for cardId in cards.sorted(by: cardIdPrecedes) {
            var next = picks
            // A dictionary's order is random, so read totals in order to match the web's insertion order closely enough:
            // `better` decides on content, and ties keep whichever was already held.
            for total in picks.keys.sorted() where total < amount {
                let sum = total + cardMoneyValue(cardId, variant)
                let candidate = picks[total]! + [cardId]
                if let held = next[sum] {
                    let difference = actions(candidate) - actions(held)
                    if difference < 0 || (difference == 0 && candidate.count < held.count) { next[sum] = candidate }
                } else {
                    next[sum] = candidate
                }
            }
            picks = next
        }
        return picks.keys.filter { $0 >= amount }.min().flatMap { picks[$0] }
    }

    /// What a sensible player hands over: the bank first, since that money is spent either way,
    /// then cards outside complete sets, and a complete set only when nothing else covers it.
    public static func suggestPayment(_ player: PlayerState, _ amount: Int, _ variant: GameVariant) -> [String] {
        func payable(_ cardId: String) -> Bool {
            cardMoneyValue(cardId, variant) > 0 && !(variant == .no_mercy && Catalog.isEveryColorWild(cardId, variant))
        }
        func worth(_ cards: [String]) -> Int { cards.reduce(0) { $0 + cardMoneyValue($1, variant) } }
        let bank = player.bank.filter(payable)
        if let fromBank = cheapestCover(bank, amount, variant) { return fromBank }
        let remaining = amount - worth(bank)

        var loose: [String] = []
        var complete: [[String]] = []
        for color in propertyColors {
            for set in propertySets(player, color, variant) {
                let cards = set.entries.map(\.cardId).filter(payable)
                if isCompletePropertySet(set.entries, color, variant) { complete.append(cards) } else { loose += cards }
            }
        }
        complete = complete.enumerated().sorted { left, right in
            let difference = worth(left.element) - worth(right.element)
            return difference != 0 ? difference < 0 : left.offset < right.offset
        }.map(\.element)

        var pool = loose
        for added in 0...complete.count {
            if let cover = cheapestCover(pool, remaining, variant) { return bank + cover }
            if added < complete.count { pool += complete[added] }
        }
        return bank + pool
    }

    public static func cardMoneyValue(_ cardId: String, _ variant: GameVariant) -> Int {
        let card = Catalog.card(cardId, variant)
        return card.moneyValue ?? card.value
    }

    public static func cardLabel(_ cardId: String, _ variant: GameVariant) -> String {
        Catalog.displayName(cardId, variant)
    }

    /// Complete color groups. Two complete sets of one color count once toward winning.
    public static func countCompleteSets(_ player: PlayerState, _ variant: GameVariant) -> Int {
        propertyColors.reduce(0) { $0 + (isCompleteSet(player, $1, setId: nil, variant) ? 1 : 0) }
    }

    public static func isCompleteSet(_ player: PlayerState, _ color: PropertyColor, setId: String?, _ variant: GameVariant) -> Bool {
        let sets = propertySets(player, color, variant)
        if let setId {
            guard let set = sets.first(where: { $0.setId == setId }) else { return false }
            return isCompletePropertySet(set.entries, color, variant)
        }
        return sets.contains { isCompletePropertySet($0.entries, color, variant) }
    }

    public static func getRentAmount(_ player: PlayerState, _ color: PropertyColor, _ variant: GameVariant) -> Int {
        let scale = color.rentScale
        let amounts: [Int] = propertySets(player, color, variant)
            .filter { set in set.entries.contains { isPropertyPlacement($0, variant) && !isRainbowWild($0, variant) } }
            .map { set in
                let count = set.entries.filter { isPropertyPlacement($0, variant) }.count
                let base = scale[min(count, scale.count) - 1]
                let houseBonus = hasBuilding(set, .house, variant) ? 3 : 0
                let hotelBonus = hasBuilding(set, .hotel, variant) ? 4 : 0
                let shackBonus = variant == .no_mercy
                    ? set.entries.filter { Catalog.card($0.cardId, variant).actionKind == .shack }.count * 5
                    : 0
                return base + houseBonus + hotelBonus + shackBonus
            }
        // A rainbow wild in an otherwise empty color lane has no rent value.
        return amounts.max() ?? 0
    }

    public struct MovableCard: Hashable, Sendable {
        public var color: PropertyColor
        public var cardId: String
        public var setId: String?

        public init(color: PropertyColor, cardId: String, setId: String? = nil) {
            self.color = color
            self.cardId = cardId
            self.setId = setId
        }
    }

    public static func movablePropertyCards(_ player: PlayerState, _ variant: GameVariant) -> [MovableCard] {
        var options: [MovableCard] = []
        for color in propertyColors {
            for set in propertySets(player, color, variant) {
                if isCompletePropertySet(set.entries, color, variant) { continue }
                for entry in set.entries {
                    let kind = Catalog.card(entry.cardId, variant).actionKind
                    if kind == .house || kind == .hotel || kind == .shack { continue }
                    options.append(MovableCard(color: color, cardId: entry.cardId, setId: set.setId))
                }
            }
        }
        return options
    }

    public static func totalBankValue(_ player: PlayerState, _ variant: GameVariant) -> Int {
        player.bank.reduce(0) { $0 + cardMoneyValue($1, variant) }
    }

    public static func totalPayableValue(_ player: PlayerState, _ variant: GameVariant) -> Int {
        func payable(_ cardId: String) -> Int {
            variant == .no_mercy && Catalog.isEveryColorWild(cardId, variant) ? 0 : cardMoneyValue(cardId, variant)
        }
        let propertyValue = propertyColors.flatMap { player.properties[$0] }.reduce(0) { $0 + payable($1.cardId) }
        return player.bank.reduce(0) { $0 + payable($1) } + propertyValue
    }

    public static func completeSetColors(_ player: PlayerState, _ variant: GameVariant) -> [PropertyColor] {
        propertyColors.filter { isCompleteSet(player, $0, setId: nil, variant) }
    }

    /// `String.localeCompare` as Node's ICU applies it to card ids: punctuation sorts
    /// before digits, digits before letters, and `_` before `#`.
    static func cardIdPrecedes(_ left: String, _ right: String) -> Bool {
        @inline(__always) func weight(_ byte: UInt8) -> Int {
            switch byte {
            case UInt8(ascii: "_"): 0
            case UInt8(ascii: "#"): 1
            default: Int(byte) + 2
            }
        }
        var l = left.utf8.makeIterator()
        var r = right.utf8.makeIterator()
        while true {
            switch (l.next(), r.next()) {
            case (nil, nil): return false
            case (nil, _): return true
            case (_, nil): return false
            case let (a?, b?):
                if a != b { return weight(a) < weight(b) }
            }
        }
    }

    public static func generatePaymentOptions(_ player: PlayerState, targetAmount: Int, _ variant: GameVariant) -> [[String]] {
        let allCards = (player.bank + propertyColors.flatMap { player.properties[$0].map(\.cardId) })
            .filter { !(variant == .no_mercy && Catalog.isEveryColorWild($0, variant)) }
        if allCards.isEmpty { return [[]] }

        let sorted = allCards.sorted { left, right in
            let delta = cardMoneyValue(left, variant) - cardMoneyValue(right, variant)
            if delta != 0 { return delta < 0 }
            return cardIdPrecedes(left, right)
        }
        let values = sorted.map { cardMoneyValue($0, variant) }
        var options: [[String]] = []
        var seen = Set<[String]>()
        let maxOptions = 120

        func addOption(_ cards: [String]) {
            if cards.isEmpty { return }
            let normalized = cards.sorted(by: cardIdPrecedes)
            if !seen.insert(normalized).inserted { return }
            options.append(normalized)
        }

        for (index, cardId) in sorted.enumerated() where values[index] == targetAmount {
            addOption([cardId])
        }

        var selected: [String] = []
        func backtrack(_ index: Int, _ total: Int) {
            if options.count >= maxOptions { return }
            if total >= targetAmount {
                addOption(selected)
                return
            }
            if index >= sorted.count { return }
            selected.append(sorted[index])
            backtrack(index + 1, total + values[index])
            selected.removeLast()
            backtrack(index + 1, total)
        }
        backtrack(0, 0)
        if options.isEmpty { addOption(sorted) }

        func total(_ cards: [String]) -> Int { cards.reduce(0) { $0 + cardMoneyValue($1, variant) } }
        let ranked = options.enumerated().sorted { leftItem, rightItem in
            let left = leftItem.element, right = rightItem.element
            let leftTotal = total(left), rightTotal = total(right)
            let leftMeets = leftTotal >= targetAmount, rightMeets = rightTotal >= targetAmount
            if leftMeets != rightMeets { return leftMeets }
            let leftOver = leftMeets ? leftTotal - targetAmount : targetAmount - leftTotal
            let rightOver = rightMeets ? rightTotal - targetAmount : targetAmount - rightTotal
            if leftOver != rightOver { return leftOver < rightOver }
            if left.count != right.count { return left.count < right.count }
            if leftTotal != rightTotal { return leftTotal < rightTotal }
            return leftItem.offset < rightItem.offset // Array.prototype.sort is stable.
        }
        return ranked.prefix(25).map(\.element)
    }

    public static func findPropertyColor(_ player: PlayerState, cardId: String) -> PropertyColor? {
        propertyColors.first { color in player.properties[color].contains { $0.cardId == cardId } }
    }

    public static func canCardBePlaced(_ card: CardDefinition, in color: PropertyColor) -> Bool {
        switch card.kind {
        case .property: card.color == color
        case .wild: card.colors.contains(color)
        default: false
        }
    }

    public static func canCardBeBanked(_ card: CardDefinition) -> Bool {
        card.kind == .money || card.kind == .action || card.kind == .building
    }

    private static func hasPlayableRentCard(_ player: PlayerState, excluding excluded: String, _ variant: GameVariant) -> Bool {
        for cardId in player.hand where cardId != excluded {
            let card = Catalog.card(cardId, variant)
            guard card.kind == .action, card.actionKind == .rent || card.actionKind == .rent_wild else { continue }
            if card.rentColors.contains(where: { getRentAmount(player, $0, variant) > 0 }) { return true }
        }
        return false
    }

    static func canPlayDoubleRent(_ state: GameState, _ player: PlayerState, excluding cardId: String) -> Bool {
        guard state.turn.playsUsed <= ruleset(state).maxPlaysPerTurn - 2 else { return false }
        return hasPlayableRentCard(player, excluding: cardId, gameVariant(state))
    }

    public static func requiresEndTurnDiscard(_ state: GameState, _ player: PlayerState) -> Bool {
        let rules = ruleset(state)
        let overHandLimit = player.hand.count > rules.maxHandAtEndTurn
        let mustResolveEndTurn = (state.turn.endingTurn ?? false) || state.turn.playsUsed >= rules.maxPlaysPerTurn
        return state.pending == nil
            && state.turn.phase == .action
            && currentPlayer(state).id == player.id
            && overHandLimit
            && mustResolveEndTurn
    }

    static func finishTurn(_ state: inout GameState, _ events: inout [GameEvent]) -> RuleError? {
        let current = currentPlayer(state)
        let limit = ruleset(state).maxHandAtEndTurn
        if current.hand.count > limit {
            return RuleError(.hand_limit, "You must discard to \(limit) cards or fewer (currently \(current.hand.count)).")
        }
        state.currentPlayerIndex = (state.currentPlayerIndex + 1) % state.players.count
        state.turn = .fresh
        state.turnCount += 1
        pushEvent(&events, "turn_passed", "\(current.name) ended the turn.")
        endGameIfDeckExhausted(&state, &events)
        return nil
    }

    /// With every card out of the deck, the discard pile and all hands, no player
    /// can ever act again. Award the game on complete sets, then on table value,
    /// with seat order as the final tie-break so the result stays deterministic.
    private static func endGameIfDeckExhausted(_ state: inout GameState, _ events: inout [GameEvent]) {
        if state.pending != nil || state.winnerId != nil { return }
        if !state.drawPile.isEmpty || !state.discardPile.isEmpty { return }
        if state.players.contains(where: { !$0.hand.isEmpty }) { return }
        let variant = gameVariant(state)
        func tableValue(_ player: PlayerState) -> Int {
            let cards = player.bank + propertyColors.flatMap { player.properties[$0].map(\.cardId) }
            return cards.reduce(0) { $0 + Catalog.card($1, variant).value }
        }
        let ranked = state.players.enumerated().sorted { left, right in
            let leftSets = countCompleteSets(left.element, variant), rightSets = countCompleteSets(right.element, variant)
            if leftSets != rightSets { return leftSets > rightSets }
            let leftValue = tableValue(left.element), rightValue = tableValue(right.element)
            if leftValue != rightValue { return leftValue > rightValue }
            return left.offset < right.offset
        }
        let winner = ranked[0].element
        state.winnerId = winner.id
        state.turn.phase = .finished
        pushEvent(&events, "game_over", "The deck ran out. \(winner.name) wins on complete sets and table value.")
    }

    static func checkWinner(_ state: inout GameState) {
        let variant = gameVariant(state)
        // A card in the middle of being resolved may still name its pile.
        if state.pending == nil {
            for index in state.players.indices { consolidatePropertySets(&state.players[index], variant) }
        }
        let needed = ruleset(state).winCompleteSets
        if let winner = state.players.first(where: { countCompleteSets($0, variant) >= needed }) {
            state.winnerId = winner.id
            state.turn.phase = .finished
            discardCardsHeldByPending(&state)
            state.pending = nil
        }
    }

    /// Cards in transit inside a pending effect would otherwise vanish with it.
    private static func discardCardsHeldByPending(_ state: inout GameState) {
        switch state.pending {
        case .debtCard(let payload):
            state.discardPile.append(payload.cardId)
        case .noMercy(let payload):
            for item in payload.redistribution ?? [] { state.discardPile.append(item.cardId) }
        default:
            break
        }
    }
}
