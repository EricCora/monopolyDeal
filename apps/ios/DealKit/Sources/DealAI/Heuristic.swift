import DealEngine

/// Mirrors `src/ai/heuristic.ts`.
public struct ScoredAction: Hashable, Sendable {
    public var action: Action
    public var label: String
    public var score: Double
    public var reason: String
}

public enum Heuristic {
    private static func actionKindScore(_ kind: ActionKind) -> Double {
        switch kind {
        case .deal_breaker: 650
        case .forced_deal: 560
        case .sly_deal: 500
        case .debt_collector: 450
        case .its_my_birthday: 430
        case .rent, .rent_wild: 410
        case .just_say_no: 230
        case .pass_go: 380
        case .house: 360
        case .hotel: 330
        case .double_rent: 340
        case .forced_debt: 520
        case .go_again: 480
        case .heist: 500
        case .market_crash: 560
        case .repossession: 540
        case .shack: 320
        case .super_sly_deal: 620
        case .tax_collector: 500
        case .tough_luck: 470
        case .unfair_trade: 360
        case .yoink: 460
        }
    }

    private static let holdInHand: Set<ActionKind> = [.deal_breaker, .just_say_no, .sly_deal, .forced_deal, .super_sly_deal]

    private static func score(_ state: GameState, actorId: PlayerId, item: LegalAction) -> ScoredAction {
        let variant = state.resolvedVariant
        let action = item.action
        func scored(_ score: Double, _ reason: String) -> ScoredAction {
            ScoredAction(action: action, label: item.label, score: score, reason: reason)
        }
        switch action.type {
        case .draw_cards:
            return scored(900, "Drawing unlocks the whole turn.")
        case .discard_card:
            return scored(Double(80 - Engine.cardMoneyValue(action.cardId ?? "", variant)), "Discarding a lower-value card preserves stronger options.")
        case .counter_response:
            return action.useJustSayNo == true
                ? scored(500, "Countering can fully cancel the incoming effect.")
                : scored(260, "Passing on the counter preserves cards for later.")
        case .pay_request:
            let paid = (action.cards ?? []).reduce(0) { $0 + Engine.cardMoneyValue($1, variant) }
            var amount = 0
            if case .payment(let request) = state.pending { amount = request.amount }
            let sensible = Engine.suggestedPaymentCards(state, playerId: actorId, amount: amount).sorted()
            if (action.cards ?? []).sorted() == sensible {
                return scored(300, "This is what a careful player would hand over.")
            }
            return scored(Double(250 - paid), "Prefer lower-cost payment options when resolving debt.")
        case .play_property:
            let beforeSets = Engine.player(state, actorId).map { Engine.countCompleteSets($0, variant) } ?? 0
            let base: Double = Catalog.card(action.cardId ?? "", variant).kind == .property ? 420 : 340
            return scored(base + (beforeSets >= 2 ? 180 : 40), "Playing property directly improves set progress and win pressure.")
        case .move_wild:
            // Wild repositioning is a free maintenance action. Keep it below Pass
            // so bots cannot oscillate a wild between two legal lanes forever.
            return scored(5, "Moving a wild can optimize set completion and future rent value.")
        case .play_to_bank:
            // Banked, a Deal Breaker is only $5. Hold it for a target, unless the hand has to shrink.
            let handLimit = state.ruleset?.maxHandAtEndTurn ?? Engine.defaultRuleset.maxHandAtEndTurn
            if let kind = Catalog.card(action.cardId ?? "", variant).actionKind, holdInHand.contains(kind),
               (Engine.player(state, actorId)?.hand.count ?? 0) <= handLimit {
                return scored(10, "This card is worth more played later than banked now.")
            }
            return scored(Double(200 + Engine.cardMoneyValue(action.cardId ?? "", variant) * 6), "Banking increases payment resilience and future spend flexibility.")
        case .play_action:
            let card = Catalog.card(action.cardId ?? "", variant)
            let base = card.actionKind.map(actionKindScore) ?? 300
            return scored(base + (item.requiresPropertyTransfer == true ? 40 : 0), "\(card.name) is a high-leverage action in this position.")
        case .sly_deal_pick, .forced_deal_pick, .deal_breaker_pick, .no_mercy_pick:
            return scored(520, "Resolving a targeted property selection can swing set control.")
        case .repay_debt, .resolve_debt_card:
            return scored(540, "Clearing a required debt step keeps the turn moving legally.")
        case .pass_turn:
            let spent = state.turn.playsUsed >= (state.ruleset?.maxPlaysPerTurn ?? Engine.defaultRuleset.maxPlaysPerTurn)
            return spent
                ? scored(210, "Play budget is spent; passing is efficient.")
                : scored(20, "Passing early can avoid overextending.")
        }
    }

    public static func rank(_ state: GameState, actorId: PlayerId, legalActions: [LegalAction]) -> [ScoredAction] {
        // Array.prototype.sort is stable, so ties keep their legal-action order.
        legalActions.enumerated()
            .map { (offset: $0.offset, scored: score(state, actorId: actorId, item: $0.element)) }
            .sorted { $0.scored.score != $1.scored.score ? $0.scored.score > $1.scored.score : $0.offset < $1.offset }
            .map(\.scored)
    }

    private static func strength(_ state: GameState, _ playerId: PlayerId) -> Int {
        guard let player = Engine.player(state, playerId) else { return 0 }
        let variant = state.resolvedVariant
        return Engine.countCompleteSets(player, variant) * 100 + Engine.totalBankValue(player, variant)
    }

    public static func choose(_ state: GameState, actorId: PlayerId, legalActions: [LegalAction]) -> ScoredAction? {
        if legalActions.isEmpty { return nil }
        let ranked = rank(state, actorId: actorId, legalActions: legalActions)
        let top = ranked[0]
        if top.action.type == .pass_turn && strength(state, actorId) < 180 {
            if let better = ranked.first(where: { $0.action.type != .pass_turn && $0.action.type != .move_wild && $0.score >= top.score }) { return better }
        }
        return top
    }
}

/// Mirrors `src/ai/rollout.ts`, the hard bot.
public enum MonteCarlo {
    private static func evaluate(_ state: GameState, _ playerId: PlayerId) -> Double {
        guard let me = Engine.player(state, playerId) else { return -999 }
        let variant = state.resolvedVariant
        let mine = Engine.countCompleteSets(me, variant) * 220 + me.bank.count * 16 + me.hand.count * 6
        var best: Int?
        for player in state.players where player.id != playerId {
            let score = Engine.countCompleteSets(player, variant) * 200 + player.bank.count * 14 + player.hand.count * 5
            if best == nil || score > best! { best = score }
        }
        return Double(mine - (best ?? 0))
    }

    private static func rolloutChoice(_ state: GameState, _ actorId: PlayerId, _ legal: [LegalAction], _ rand: inout Engine.SeededRandom) -> Action {
        if legal.count == 1 { return legal[0].action }
        let top = Array(Heuristic.rank(state, actorId: actorId, legalActions: legal).prefix(3))
        let roll = rand.next()
        if roll < 0.62 { return top[0].action }
        if roll < 0.86 { return top[min(1, top.count - 1)].action }
        return top[min(2, top.count - 1)].action
    }

    private static func simulate(_ start: GameState, root: PlayerId, depth: Int, rand: inout Engine.SeededRandom) -> Double {
        var state = start
        for step in 0..<depth {
            let status = Engine.isGameOver(state)
            if status.done {
                return status.winnerId == root ? Double(1200 - step * 10) : Double(-1200 + step * 10)
            }
            let prompt = Engine.nextPrompt(state)
            let legal = Engine.getLegalActions(state, prompt.playerId)
            if legal.isEmpty { break }
            let result = Engine.applyAction(state, rolloutChoice(state, prompt.playerId, legal, &rand))
            if result.error != nil { break }
            state = result.state
        }
        return evaluate(state, root)
    }

    /// How many times a hard bot may reposition Wilds in one turn.
    private static let maxWildMovesPerTurn = 2

    /// Moving a Wild costs no play, so a bot whose simulations keep rating it highest would
    /// never end its turn and the game would freeze. Past the limit, it has to do something else.
    private static func allowedMoves(_ state: GameState, _ legalActions: [LegalAction]) -> [LegalAction] {
        var wildMoves = 0
        for event in state.history.reversed() {
            if event.type == "draw" || event.type == "turn_passed" || event.type == "go_again" { break }
            if event.type == "wild_move" { wildMoves += 1 }
        }
        guard wildMoves >= maxWildMovesPerTurn else { return legalActions }
        let others = legalActions.filter { $0.action.type != .move_wild }
        return others.isEmpty ? legalActions : others
    }

    /// `timeBudget` limits how long the search runs. A Forced Deal can offer over 200 moves,
    /// so under a budget the most promising moves go first, and running out of time only
    /// drops the weakest. At least one move is always evaluated.
    public static func choose(_ state: GameState, actorId: PlayerId, legalActions: [LegalAction], simulations: Int = 16, depth: Int = 10, seed: Int? = nil, timeBudget: Duration? = nil) -> ScoredAction? {
        if legalActions.isEmpty { return nil }
        var rand = Engine.SeededRandom(seed: seed ?? state.turnCount + state.history.count + 17)
        var best: ScoredAction?
        let clock = ContinuousClock()
        let deadline = timeBudget.map { clock.now.advanced(by: $0) }
        var candidates = allowedMoves(state, legalActions)
        if deadline != nil {
            let byAction = Dictionary(candidates.map { ($0.action, $0) }, uniquingKeysWith: { first, _ in first })
            candidates = Heuristic.rank(state, actorId: actorId, legalActions: candidates).compactMap { byAction[$0.action] }
        }
        for legal in candidates {
            if let deadline, best != nil, clock.now >= deadline { break }
            let first = Engine.applyAction(state, legal.action)
            if first.error != nil { continue }
            var total = Heuristic.choose(state, actorId: actorId, legalActions: [legal])?.score ?? 0
            for _ in 0..<simulations {
                total += simulate(first.state, root: actorId, depth: depth, rand: &rand)
            }
            let average = total / Double(simulations + 1)
            if best == nil || average > best!.score {
                best = ScoredAction(action: legal.action, label: legal.label, score: average, reason: "\(simulations) rollout simulations estimated this as strongest expected value.")
            }
        }
        return best ?? Heuristic.choose(state, actorId: actorId, legalActions: legalActions)
    }
}

public struct CoachHint: Hashable, Sendable {
    public var title: String
    public var summary: String
    public var topActionLabel: String
    public var topAction: Action
    public var alternatives: [String]
}

public enum Coach {
    /// Mirrors `buildCoachHint` in `src/ai/explain.ts`.
    public static func hint(_ state: GameState, playerId: PlayerId, legalActions: [LegalAction], hard: Bool = false) -> CoachHint? {
        if legalActions.isEmpty { return nil }
        let ranked = Heuristic.rank(state, actorId: playerId, legalActions: legalActions)
        let selected = hard
            ? MonteCarlo.choose(state, actorId: playerId, legalActions: legalActions, simulations: 12, depth: 9, timeBudget: .seconds(2))
            : Heuristic.choose(state, actorId: playerId, legalActions: legalActions)
        guard let selected else { return nil }
        return CoachHint(
            title: hard ? "AI Coach (Hard Search)" : "AI Coach",
            summary: selected.reason,
            topActionLabel: selected.label,
            topAction: selected.action,
            alternatives: ranked.dropFirst().prefix(2).map { "\($0.label) (\(Int($0.score.rounded())))" }
        )
    }
}
