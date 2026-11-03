import Foundation

/// Mirrors `createGame`, `applyAction` and `getNextPrompt` in `src/engine/game.ts`.
extension Engine {
    public static func createGame(_ config: GameConfig) -> GameState {
        precondition((2...5).contains(config.players.count), "Monopoly Deal supports 2-5 players.")
        let variant = config.variant
        let rules = variant == .classic ? (config.ruleset ?? defaultRuleset) : defaultRuleset
        var rand = SeededRandom(seed: config.seed ?? Int.random(in: 0..<1_000_000_000))

        var deck: [String] = []
        for card in Catalog.definitions(variant) {
            for copy in 0..<card.quantity { deck.append("\(card.id)#\(copy + 1)") }
        }
        let shuffled = shuffle(deck, rand: &rand)

        let players = config.players.map { player in
            PlayerState(
                id: player.id,
                name: player.name,
                controller: player.controller,
                botDifficulty: player.botDifficulty,
                hand: [],
                bank: [],
                properties: PropertyLanes(),
                debts: variant == .no_mercy ? [] : nil,
                debtChipsRemaining: variant == .no_mercy ? 3 : nil,
                debtChipsHeld: variant == .no_mercy ? [] : nil
            )
        }

        let time = now()
        var state = GameState(
            version: 1,
            createdAt: time,
            updatedAt: time,
            deckVersion: "v1",
            variant: variant,
            ruleset: rules,
            players: players,
            drawPile: shuffled,
            discardPile: [],
            currentPlayerIndex: 0,
            turn: .fresh,
            pending: nil,
            history: [],
            winnerId: nil,
            turnCount: 1
        )
        for index in state.players.indices { drawCards(&state, playerAt: index, amount: 5) }
        return state
    }

    // MARK: Payment suggestions

    public static func suggestedPaymentCards(_ state: GameState, playerId: PlayerId, amount: Int) -> [String] {
        guard let player = player(state, playerId) else { return [] }
        let variant = gameVariant(state)
        return suggestPayment(player, amount, gameVariant(state))
    }

    // MARK: Debt

    private static func nextChipId(_ player: PlayerState) -> String {
        let used = Set(debts(player).compactMap { $0.chipId ?? $0.id })
        var index = 1
        while used.contains("\(player.id)-chip-\(index)") { index += 1 }
        return "\(player.id)-chip-\(index)"
    }

    private static func issueDebt(_ state: inout GameState, debtor debtorIndex: Int, creditor creditorIndex: Int, amount: Int) {
        guard gameVariant(state) == .no_mercy else { return }
        let debtor = state.players[debtorIndex]
        let remaining = min(debtor.debtChipsRemaining ?? 3, max(0, 3 - debts(debtor).count))
        guard remaining > 0 else { return }
        let chipId = nextChipId(debtor)
        let record = DebtRecord(id: chipId, chipId: chipId, debtorPlayerId: debtor.id, creditorPlayerId: state.players[creditorIndex].id, amount: amount, createdTurn: state.turnCount)
        state.players[debtorIndex].debts = debts(debtor) + [record]
        state.players[creditorIndex].debtChipsHeld = (state.players[creditorIndex].debtChipsHeld ?? []) + [record]
        state.players[debtorIndex].debtChipsRemaining = remaining - 1
    }

    /// Leave the debt phase once nothing more can be repaid this turn. A debt that
    /// is still owed carries over; staying in the phase would leave the player with
    /// no legal action at all.
    private static func settleDebtPhase(_ state: inout GameState) {
        guard gameVariant(state) == .no_mercy, state.turn.phase == .debt, state.pending == nil else { return }
        let current = currentPlayer(state)
        if debts(current).isEmpty || current.hand.isEmpty || state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn {
            state.turn.phase = .action
        }
    }

    // MARK: Pending helpers

    private static func openCounter(_ state: inout GameState, source: PlayerId, target: PlayerId, actionCardId: String, effect: PendingEffect) -> Bool {
        guard player(state, target) != nil else { return false }
        state.pending = .counter(CounterRequest(sourcePlayerId: source, targetPlayerId: target, actionCardId: actionCardId, effect: effect, chain: [], awaitingPlayerId: target))
        return true
    }

    /// Opens a counter window for the target, or applies the effect if the target is gone.
    private static func offerCounter(_ state: inout GameState, source: PlayerId, target: PlayerId, actionCardId: String, effect: PendingEffect) {
        if !openCounter(&state, source: source, target: target, actionCardId: actionCardId, effect: effect) {
            state.pending = PendingInteraction(effect: effect)
        }
    }

    private static func continuePaymentChain(_ state: inout GameState, _ request: PaymentRequest) {
        var remaining = request.remainingTargetPlayerIds ?? []
        while !remaining.isEmpty {
            let next = remaining.removeFirst()
            guard player(state, next) != nil else { continue }
            let effect = PendingEffect.payment(PaymentRequest(
                sourcePlayerId: request.sourcePlayerId,
                targetPlayerId: next,
                amount: request.amount,
                reason: request.reason,
                actionCardId: request.actionCardId,
                remainingTargetPlayerIds: remaining.isEmpty ? nil : remaining
            ))
            offerCounter(&state, source: request.sourcePlayerId, target: next, actionCardId: request.actionCardId, effect: effect)
            return
        }
    }

    /// Moves a property from one player to another, and any Shack attached to it.
    private static func transferWithAttachments(_ state: inout GameState, from fromIndex: Int, to toIndex: Int, color: PropertyColor, removed: PropertyCardPlacement, sourceSetId: String?, variant: GameVariant) {
        addToProperty(&state.players[toIndex], removed.cardId, color, setId: nil, attachedTo: removed.attachedToCardId, variant)
        let destinationSetId = findPropertySetId(state.players[toIndex], color, cardId: removed.cardId, variant)
        for attachment in attachedPropertyCards(state.players[fromIndex], color, removed.cardId, setId: sourceSetId) {
            removePropertyCard(&state.players[fromIndex], color, attachment.cardId, setId: sourceSetId)
            addToProperty(&state.players[toIndex], attachment.cardId, color, setId: destinationSetId, attachedTo: attachment.attachedToCardId, variant)
        }
    }

    private static func isPropertyEntry(_ cardId: String, _ variant: GameVariant) -> Bool {
        let kind = Catalog.card(cardId, variant).kind
        return kind == .property || kind == .wild
    }

    private static func matches(_ cardId: String, color: PropertyColor, _ variant: GameVariant) -> Bool {
        let def = Catalog.card(cardId, variant)
        return (def.kind == .property && def.color == color) || (def.kind == .wild && def.colors.contains(color))
    }

    /// Resolve deterministic, server-authoritative No Mercy global effects.
    private static func progressNoMercy(_ state: inout GameState) {
        guard case .noMercy(var req) = state.pending else { return }
        let variant = gameVariant(state)
        guard let sourceIndex = playerIndex(state, req.sourcePlayerId) else {
            state.pending = nil
            return
        }

        switch req.effect {
        case "forced_debt":
            if let target = req.targetPlayerId, let debtor = playerIndex(state, target) {
                issueDebt(&state, debtor: debtor, creditor: sourceIndex, amount: 1)
            }
            state.pending = nil

        case "heist", "market_crash":
            var remaining = req.targetPlayerIds ?? []
            guard let next = remaining.first, let target = player(state, next) else {
                state.pending = nil
                return
            }
            let hasCards = req.effect == "heist"
                ? !target.bank.isEmpty
                : propertyColors.contains { color in target.properties[color].contains { isPropertyEntry($0.cardId, variant) } }
            if !hasCards {
                remaining.removeFirst()
                req.targetPlayerIds = remaining
                state.pending = remaining.isEmpty ? nil : .noMercy(req)
                if state.pending != nil { progressNoMercy(&state) }
                return
            }
            req.step = req.effect == "heist" ? "heist_pick" : "market_crash_pick"
            req.targetPlayerId = target.id
            state.pending = .noMercy(req)

        case "super_sly_deal":
            var remaining = req.targetPlayerIds ?? []
            let next = remaining.isEmpty ? nil : remaining.removeFirst()
            guard let next, let targetIndex = playerIndex(state, next), let chosen = req.color else {
                state.pending = nil
                return
            }
            let taken = propertyColors.flatMap { color in
                state.players[targetIndex].properties[color]
                    .filter { matches($0.cardId, color: chosen, variant) }
                    .map { (color, $0) }
            }
            for (color, entry) in taken {
                if let removed = removePropertyCard(&state.players[targetIndex], color, entry.cardId, setId: entry.setId) {
                    transferWithAttachments(&state, from: targetIndex, to: sourceIndex, color: color, removed: removed, sourceSetId: entry.setId, variant: variant)
                }
            }
            if remaining.isEmpty {
                state.pending = nil
                return
            }
            req.targetPlayerIds = remaining
            req.step = nil
            req.targetPlayerId = nil
            state.pending = nil
            offerCounter(&state, source: req.sourcePlayerId, target: remaining[0], actionCardId: req.actionCardId, effect: .noMercy(req))

        case "repossession", "tax_collector", "tough_luck":
            guard let targetId = req.targetPlayerId, let target = player(state, targetId) else {
                state.pending = nil
                return
            }
            if req.effect == "repossession" {
                if req.step == "repossession_distribute" { return }
                let hasProperty = propertyColors.contains { color in target.properties[color].contains { isPropertyEntry($0.cardId, variant) } }
                if !hasProperty {
                    state.pending = nil
                } else if req.step != "repossession_keep" {
                    req.step = "repossession_keep"
                    state.pending = .noMercy(req)
                }
            } else if req.effect == "tax_collector" {
                if req.step == "tax_collector_distribute" { return }
                if target.bank.count <= 1 {
                    state.pending = nil
                } else if req.step != "tax_collector_keep" {
                    req.step = "tax_collector_keep"
                    state.pending = .noMercy(req)
                }
            } else if req.step != "tough_luck_choice" {
                req.step = "tough_luck_choice"
                state.pending = .noMercy(req)
            }

        case "unfair_trade":
            if let targetId = req.targetPlayerId, let targetIndex = playerIndex(state, targetId), !state.players[sourceIndex].bank.isEmpty {
                let own = state.players[sourceIndex].bank
                state.players[sourceIndex].bank = state.players[targetIndex].bank
                state.players[targetIndex].bank = own
            }
            state.pending = nil

        default:
            state.pending = nil
        }
    }

    // MARK: applyAction

    public static func applyAction(_ currentState: GameState, _ action: Action) -> ApplyResult {
        var state = currentState
        let variant = gameVariant(state)
        for index in state.players.indices { normalizePropertySets(&state.players[index], variant) }
        var events: [GameEvent] = []

        guard let pi = playerIndex(state, action.playerId) else {
            return ApplyResult(state: currentState, events: events, error: RuleError(.invalid_target, "Player not found."))
        }
        func fail(_ code: RuleErrorCode, _ message: String) -> ApplyResult {
            ApplyResult(state: currentState, events: events, error: RuleError(code, message))
        }
        let playerId = action.playerId
        let playerName = state.players[pi].name
        let rules = ruleset(state)

        if let pending = state.pending {
            let resolving: Set<ActionType> = [.counter_response, .pay_request, .sly_deal_pick, .forced_deal_pick, .deal_breaker_pick, .repay_debt, .resolve_debt_card, .no_mercy_pick]
            var isRentChoice = false
            if case .rent = pending, action.type == .play_action { isRentChoice = true }
            if !resolving.contains(action.type) && !isRentChoice {
                return fail(.unresolved_pending, "Resolve pending interaction first.")
            }
            if case .debtCard = pending, action.type != .resolve_debt_card {
                return fail(.unresolved_pending, "Resolve the received debt card first.")
            }
            if case .noMercy = pending, action.type != .no_mercy_pick {
                return fail(.unresolved_pending, "Resolve the No Mercy selection first.")
            }
        }

        switch action.type {
        case .draw_cards:
            if currentPlayer(state).id != playerId { return fail(.invalid_turn, "Not your turn.") }
            if state.turn.phase != .draw { return fail(.invalid_phase, "Can only draw during draw phase.") }
            let amount = state.players[pi].hand.isEmpty ? 5 : 2
            let drawn = drawCards(&state, playerAt: pi, amount: amount)
            state.turn.phase = variant == .no_mercy && !debts(state.players[pi]).isEmpty ? .debt : .action
            state.turn.endingTurn = false
            pushEvent(&events, "draw", "\(playerName) drew \(drawn.count) cards.", details: GameEventDetails(kind: "draw", playerId: playerId, count: drawn.count, reason: "turn_draw"))

        case .pass_turn:
            if currentPlayer(state).id != playerId { return fail(.invalid_action, "Not your turn.") }
            if state.turn.phase != .action { return fail(.invalid_phase, "Cannot pass now.") }
            if state.players[pi].hand.count > rules.maxHandAtEndTurn {
                state.turn.endingTurn = true
            } else if let err = finishTurn(&state, &events) {
                return ApplyResult(state: currentState, events: events, error: err)
            }

        case .discard_card:
            guard let cardId = action.cardId, requiresEndTurnDiscard(state, state.players[pi]) else {
                return fail(.invalid_action, "Discard is only allowed when over the hand limit at end of turn.")
            }
            if !removeFromHand(&state.players[pi], cardId) { return fail(.insufficient_cards, "Card not in hand.") }
            state.discardPile.append(cardId)
            pushEvent(&events, "discard", "\(playerName) discarded \(cardLabel(cardId, variant)).")
            if state.turn.endingTurn == true && state.players[pi].hand.count <= rules.maxHandAtEndTurn {
                if let err = finishTurn(&state, &events) {
                    return ApplyResult(state: currentState, events: events, error: err)
                }
            }

        case .repay_debt:
            if variant != .no_mercy { return fail(.invalid_action, "Debt is only used in No Mercy.") }
            if currentPlayer(state).id != playerId || state.turn.phase != .debt {
                return fail(.invalid_phase, "Debt repayment is only available before card plays.")
            }
            if state.turn.playsUsed >= rules.maxPlaysPerTurn {
                return fail(.illegal_play_limit, "Already used \(rules.maxPlaysPerTurn) plays this turn.")
            }
            var owed = debts(state.players[pi])
            let debtId = action.debtId ?? action.chipId
            guard let debtIndex = owed.firstIndex(where: { debt in
                debt.id == debtId || debt.chipId == debtId
                    || (action.creditorPlayerId != nil && debt.creditorPlayerId == action.creditorPlayerId)
            }) else { return fail(.invalid_target, "Debt not found.") }
            guard let cardId = action.cardId, removeFromHand(&state.players[pi], cardId) else {
                return fail(.insufficient_cards, "Repayment card not in hand.")
            }
            let debt = owed.remove(at: debtIndex)
            state.players[pi].debts = owed
            state.players[pi].debtChipsRemaining = min(3, (state.players[pi].debtChipsRemaining ?? 0) + 1)
            guard let creditorIndex = playerIndex(state, debt.creditorPlayerId) else {
                return fail(.invalid_target, "Creditor not found.")
            }
            var held = state.players[creditorIndex].debtChipsHeld ?? []
            if let heldIndex = held.firstIndex(where: { ($0.chipId ?? $0.id) == (debt.chipId ?? debt.id) }) {
                held.remove(at: heldIndex)
            }
            state.players[creditorIndex].debtChipsHeld = held
            let card = Catalog.card(cardId, variant)
            if card.kind == .money || card.kind == .building {
                state.players[creditorIndex].bank.append(cardId)
            } else {
                state.pending = .debtCard(PendingDebtCard(debtorPlayerId: playerId, creditorPlayerId: state.players[creditorIndex].id, debtId: debt.id ?? debt.chipId ?? "", cardId: cardId))
            }
            state.turn.playsUsed += 1
            pushEvent(&events, "debt_repaid", "\(playerName) repaid \(state.players[creditorIndex].name) with \(cardLabel(cardId, variant)).")
            if owed.isEmpty && state.pending == nil { state.turn.phase = .action }

        case .resolve_debt_card:
            guard case .debtCard(let pending) = state.pending, pending.creditorPlayerId == playerId else {
                return fail(.invalid_action, "No debt card is awaiting resolution.")
            }
            guard let cardId = action.cardId, pending.cardId == cardId else { return fail(.invalid_action, "Invalid debt card.") }
            let card = Catalog.card(cardId, variant)
            if action.mode == "action" {
                if card.kind != .action || card.actionKind == .go_again {
                    return fail(.invalid_action, "This debt card cannot be played immediately.")
                }
                guard let choice = receivedActionChoices(state, recipient: state.players[pi], cardId: cardId)
                    .first(where: { $0.targetPlayerId == action.targetPlayerId && $0.color == action.color }) else {
                    return fail(.invalid_target, "Choose a legal immediate action for the received card.")
                }
                let originalIndex = state.currentPlayerIndex
                let originalTurn = state.turn
                var temporary = state
                temporary.pending = nil
                temporary.currentPlayerIndex = pi
                temporary.turn = .actionWindow
                temporary.players[pi].hand.append(cardId)
                let nested = applyAction(temporary, choice)
                if let err = nested.error { return ApplyResult(state: currentState, events: events, error: err) }
                var result = nested.state
                if result.winnerId == nil {
                    result.currentPlayerIndex = originalIndex
                    result.turn = originalTurn
                    settleDebtPhase(&result)
                }
                let resolved = GameEvent(timestamp: now(), type: "debt_card_resolved", message: "\(playerName) played the received \(card.name) immediately.", details: nil)
                result.history.append(resolved)
                result.updatedAt = now()
                return ApplyResult(state: result, events: nested.events + [resolved])
            }
            if action.mode == "bank" {
                if !canCardBeBanked(card) { return fail(.invalid_action, "This received card cannot be banked.") }
                state.players[pi].bank.append(cardId)
            } else {
                guard let color = action.color, canCardBePlaced(card, in: color) else {
                    return fail(.invalid_target, "Choose a valid property color.")
                }
                addToProperty(&state.players[pi], cardId, color, setId: action.setId, attachedTo: nil, variant)
            }
            state.pending = nil
            if state.turn.phase == .debt && debts(currentPlayer(state)).isEmpty { state.turn.phase = .action }
            pushEvent(&events, "debt_card_resolved", "\(playerName) resolved a received debt card.")

        case .no_mercy_pick:
            if let err = applyNoMercyPick(&state, action, pi, &events) {
                return ApplyResult(state: currentState, events: events, error: err)
            }

        case .play_to_bank:
            if currentPlayer(state).id != playerId { return fail(.invalid_action, "Not your turn.") }
            if state.turn.phase != .action { return fail(.invalid_phase, "Cannot play now.") }
            if state.turn.playsUsed >= rules.maxPlaysPerTurn {
                return fail(.illegal_play_limit, "Already used \(rules.maxPlaysPerTurn) plays this turn.")
            }
            guard let cardId = action.cardId, canCardBeBanked(Catalog.card(cardId, variant)) else {
                return fail(.invalid_action, "Only money, action, and building cards can be banked.")
            }
            if !removeFromHand(&state.players[pi], cardId) { return fail(.insufficient_cards, "Card not in hand.") }
            state.players[pi].bank.append(cardId)
            state.turn.playsUsed += 1
            pushEvent(&events, "bank", "\(playerName) banked \(cardLabel(cardId, variant)).")

        case .play_property:
            if currentPlayer(state).id != playerId { return fail(.invalid_action, "Not your turn.") }
            if state.turn.phase != .action { return fail(.invalid_phase, "Cannot play now.") }
            if state.turn.playsUsed >= rules.maxPlaysPerTurn {
                return fail(.illegal_play_limit, "Already used \(rules.maxPlaysPerTurn) plays this turn.")
            }
            guard let cardId = action.cardId, let color = action.color else {
                return fail(.invalid_action, "Card cannot be placed in that color group.")
            }
            let card = Catalog.card(cardId, variant)
            var placementSetId = action.setId
            if card.kind == .building {
                if variant == .no_mercy && card.actionKind == .shack {
                    let sets = propertySets(state.players[pi], color, variant)
                    let targetSet = sets.first { action.setId == nil || $0.setId == action.setId }
                    let attachedTo = action.attachedToCardId ?? targetSet?.entries.first { entry in
                        isPropertyEntry(entry.cardId, variant) && !targetSet!.entries.contains { $0.attachedToCardId == entry.cardId }
                    }?.cardId
                    guard let targetSet, isShackPlacementLegal(state.players[pi], color, setId: targetSet.setId, attachedTo: attachedTo, variant) else {
                        return fail(.invalid_action, "Shack must attach to a property or set without a Shack.")
                    }
                    if !removeFromHand(&state.players[pi], cardId) { return fail(.insufficient_cards, "Card not in hand.") }
                    addToProperty(&state.players[pi], cardId, color, setId: targetSet.setId, attachedTo: attachedTo, variant)
                    state.turn.playsUsed += 1
                    pushEvent(&events, "property", "\(playerName) attached a Shack to \(color.label).")
                    checkWinner(&state)
                    state.history.append(contentsOf: events)
                    state.updatedAt = now()
                    return ApplyResult(state: state, events: events)
                }
                let eligible = propertySets(state.players[pi], color, variant)
                    .filter { isBuildingPlacementLegal(state.players[pi], color, card.actionKind, setId: $0.setId, variant) }
                    .map(\.setId)
                if action.setId == nil && eligible.count > 1 {
                    return fail(.invalid_target, "Choose which physical property set receives this building.")
                }
                placementSetId = action.setId ?? eligible.first
                if !isBuildingPlacementLegal(state.players[pi], color, card.actionKind, setId: placementSetId, variant) {
                    return fail(.invalid_action, "Building requires a complete property set.")
                }
            } else if !canCardBePlaced(card, in: color) {
                return fail(.invalid_action, "Card cannot be placed in that color group.")
            } else if let setId = action.setId, isCompleteSet(state.players[pi], color, setId: setId, variant) {
                return fail(.invalid_action, "Cannot place an excess property into a protected complete set.")
            }
            if !removeFromHand(&state.players[pi], cardId) { return fail(.insufficient_cards, "Card not in hand.") }
            addToProperty(&state.players[pi], cardId, color, setId: placementSetId, attachedTo: nil, variant)
            if variant == .no_mercy {
                let resultingId = findPropertySetId(state.players[pi], color, cardId: cardId, variant)
                let resulting = propertySets(state.players[pi], color, variant).first { $0.setId == resultingId }
                let shacks = resulting?.entries.filter { Catalog.card($0.cardId, variant).actionKind == .shack }.count ?? 0
                if let resulting, isCompleteSet(state.players[pi], color, setId: resulting.setId, variant), shacks > 1 {
                    return fail(.invalid_action, "A complete No Mercy set may have only one Shack.")
                }
            }
            state.turn.playsUsed += 1
            pushEvent(&events, "property", "\(playerName) placed \(cardLabel(cardId, variant)) in \(color.label).")

        case .move_wild:
            if currentPlayer(state).id != playerId { return fail(.invalid_action, "Not your turn.") }
            if state.turn.phase != .action { return fail(.invalid_phase, "Cannot move now.") }
            guard let cardId = action.cardId, let fromColor = action.fromColor, let toColor = action.toColor,
                  let moved = removePropertyCard(&state.players[pi], fromColor, cardId, setId: action.fromSetId) else {
                return fail(.invalid_target, "Wild card not found in source set.")
            }
            if variant == .no_mercy, !attachedPropertyCards(state.players[pi], fromColor, cardId, setId: moved.setId).isEmpty {
                return fail(.invalid_action, "A property with a Shack cannot be moved.")
            }
            let def = Catalog.card(cardId, variant)
            if def.kind != .wild || !canCardBePlaced(def, in: toColor)
                || (action.setId != nil && isCompleteSet(state.players[pi], toColor, setId: action.setId, variant)) {
                return fail(.invalid_action, "Card cannot move to target color.")
            }
            addToProperty(&state.players[pi], cardId, toColor, setId: action.setId, attachedTo: nil, variant)
            pushEvent(&events, "wild_move", "\(playerName) moved \(cardLabel(cardId, variant)) to \(toColor.label).")

        case .play_action:
            if let err = applyPlayAction(&state, action, pi, &events) {
                return ApplyResult(state: currentState, events: events, error: err)
            }

        case .counter_response:
            guard case .counter(var pending) = state.pending else { return fail(.invalid_action, "No counter pending.") }
            if pending.awaitingPlayerId != playerId { return fail(.invalid_action, "Not your response to counter.") }
            if action.useJustSayNo == true {
                guard let cardId = action.cardId else { return fail(.invalid_action, "Must select Just Say No card.") }
                if !removeFromHand(&state.players[pi], cardId) { return fail(.insufficient_cards, "Just Say No not in hand.") }
                state.discardPile.append(cardId)
                pending.chain.append(CounterChainLink(playerId: playerId, cardId: cardId))
                // A source player may answer a target's Just Say No, but the final result
                // applies only to that target; the remaining targets of a No Mercy global
                // effect get their own independent counter windows below.
                pending.awaitingPlayerId = pending.awaitingPlayerId == pending.targetPlayerId ? pending.sourcePlayerId : pending.targetPlayerId
                state.pending = .counter(pending)
                pushEvent(&events, "counter", "\(playerName) played Just Say No.")
            } else {
                let canceled = pending.chain.count % 2 == 1
                state.pending = nil
                if case .noMercy(var payload) = pending.effect {
                    if canceled {
                        let remainingTargets = Array((payload.targetPlayerIds ?? []).dropFirst())
                        if !remainingTargets.isEmpty {
                            payload.targetPlayerIds = remainingTargets
                            payload.targetPlayerId = nil
                            payload.step = nil
                            offerCounter(&state, source: payload.sourcePlayerId, target: remainingTargets[0], actionCardId: payload.actionCardId, effect: .noMercy(payload))
                        }
                        pushEvent(&events, "counter", "Action canceled for this target by Just Say No chain.")
                    } else {
                        // Re-run the effect for the current target. Global effect payloads
                        // retain the full target list so the selection step can continue to
                        // the remaining players after this target resolves.
                        state.pending = PendingInteraction(effect: pending.effect)
                        pushEvent(&events, "counter", "Action resolved after counter chain.")
                        progressNoMercy(&state)
                    }
                } else if !canceled {
                    state.pending = PendingInteraction(effect: pending.effect)
                    pushEvent(&events, "counter", "Action resolved after counter chain.")
                    progressNoMercy(&state)
                } else {
                    if case .payment(let request) = pending.effect { continuePaymentChain(&state, request) }
                    pushEvent(&events, "counter", "Action canceled by Just Say No chain.")
                }
            }

        case .pay_request:
            if let err = applyPayment(&state, action, pi, &events) {
                return ApplyResult(state: currentState, events: events, error: err)
            }

        case .sly_deal_pick:
            if let err = applySlyDeal(&state, action, pi, &events) {
                return ApplyResult(state: currentState, events: events, error: err)
            }

        case .forced_deal_pick:
            if let err = applyForcedDeal(&state, action, pi, &events) {
                return ApplyResult(state: currentState, events: events, error: err)
            }

        case .deal_breaker_pick:
            if let err = applyDealBreaker(&state, action, pi, &events) {
                return ApplyResult(state: currentState, events: events, error: err)
            }
        }

        checkWinner(&state)
        progressNoMercy(&state)
        settleDebtPhase(&state)
        state.history.append(contentsOf: events)
        state.updatedAt = now()
        return ApplyResult(state: state, events: events)
    }

    private static func applyNoMercyPick(_ state: inout GameState, _ action: Action, _ pi: Int, _ events: inout [GameEvent]) -> RuleError? {
        let variant = gameVariant(state)
        guard variant == .no_mercy, case .noMercy(var req) = state.pending else {
            return RuleError(.invalid_action, "No Mercy selection is not pending.")
        }
        if action.actionCardId != req.actionCardId { return RuleError(.invalid_action, "Invalid No Mercy selection card.") }
        let targetIndex = req.targetPlayerId.flatMap { playerIndex(state, $0) }
        let targetId = targetIndex.map { state.players[$0].id }
        let actorIsSource = req.step == "heist_pick" || req.step == "market_crash_pick" || req.step == "tough_luck_choice"
        if (actorIsSource ? req.sourcePlayerId : targetId) != action.playerId {
            return RuleError(.invalid_action, "Not your No Mercy selection.")
        }

        func advance(_ state: inout GameState, remaining: [PlayerId]) {
            state.pending = nil
            if remaining.isEmpty { return }
            var next = req
            next.targetPlayerIds = remaining
            next.targetPlayerId = nil
            next.step = nil
            next.cardId = nil
            offerCounter(&state, source: req.sourcePlayerId, target: remaining[0], actionCardId: req.actionCardId, effect: .noMercy(next))
        }

        switch req.step {
        case "heist_pick":
            guard let targetIndex, let cardId = action.cardId, let bankIndex = state.players[targetIndex].bank.firstIndex(of: cardId) else {
                return RuleError(.invalid_target, "Choose a card from the target Bank.")
            }
            state.players[targetIndex].bank.remove(at: bankIndex)
            let source = playerIndex(state, req.sourcePlayerId)
            if let source { state.players[source].bank.append(cardId) }
            pushEvent(&events, "heist", "\(source.map { state.players[$0].name } ?? "Player") stole a bank card from \(state.players[targetIndex].name).")
            advance(&state, remaining: Array((req.targetPlayerIds ?? []).dropFirst()))

        case "market_crash_pick":
            guard let targetIndex, let cardId = action.cardId, let color = action.color,
                  let chosen = state.players[targetIndex].properties[color].first(where: { $0.cardId == cardId }),
                  isPropertyEntry(chosen.cardId, variant) else {
                return RuleError(.invalid_target, "Choose a property from the target collection.")
            }
            let removed = removePropertyCard(&state.players[targetIndex], color, cardId, setId: chosen.setId)
            if let removed, let source = playerIndex(state, req.sourcePlayerId) {
                transferWithAttachments(&state, from: targetIndex, to: source, color: color, removed: removed, sourceSetId: chosen.setId, variant: variant)
            }
            advance(&state, remaining: Array((req.targetPlayerIds ?? []).dropFirst()))

        case "tough_luck_choice":
            guard req.sourcePlayerId == action.playerId, let targetIndex, let choice = action.choice else {
                return RuleError(.invalid_target, "Choose a Tough Luck card type.")
            }
            let taken = state.players[targetIndex].hand.filter { cardId in
                let kind = Catalog.card(cardId, variant).kind
                switch choice {
                case .property: return kind == .property || kind == .wild
                case .money: return kind == .money
                case .action: return kind == .action || kind == .building
                }
            }
            state.players[targetIndex].hand.removeAll { taken.contains($0) }
            state.players[pi].hand.append(contentsOf: taken)
            state.pending = nil

        case "repossession_keep":
            guard let targetIndex, let cardId = action.cardId, let color = action.color,
                  let keep = state.players[targetIndex].properties[color].first(where: { $0.cardId == cardId }),
                  isPropertyEntry(keep.cardId, variant) else {
                return RuleError(.invalid_target, "Choose one property to keep.")
            }
            let all = propertyColors.flatMap { c in state.players[targetIndex].properties[c].map { (c, $0) } }
            var keepIds: Set<String> = [keep.cardId]
            for (_, entry) in all where entry.attachedToCardId == keep.cardId { keepIds.insert(entry.cardId) }
            var redistribution: [RedistributionItem] = []
            for (c, entry) in all {
                if keepIds.contains(entry.cardId) { continue }
                // Leave Shack attachments in place until their parent property is
                // assigned; they must travel with that property as one physical unit.
                if entry.attachedToCardId != nil { continue }
                if let removed = removePropertyCard(&state.players[targetIndex], c, entry.cardId, setId: entry.setId) {
                    redistribution.append(RedistributionItem(cardId: removed.cardId, color: c, setId: removed.setId))
                }
            }
            if redistribution.isEmpty {
                state.pending = nil
            } else {
                req.step = "repossession_distribute"
                req.redistribution = redistribution
                state.pending = .noMercy(req)
            }

        case "tax_collector_keep":
            guard let targetIndex, let cardId = action.cardId, state.players[targetIndex].bank.contains(cardId) else {
                return RuleError(.invalid_target, "Choose one Bank card to keep.")
            }
            let remaining = state.players[targetIndex].bank.filter { $0 != cardId }
            state.players[targetIndex].bank = [cardId]
            if remaining.isEmpty {
                state.pending = nil
            } else {
                req.step = "tax_collector_distribute"
                req.redistribution = remaining.map { RedistributionItem(cardId: $0) }
                state.pending = .noMercy(req)
            }

        case "repossession_distribute", "tax_collector_distribute":
            guard let targetIndex, let item = req.redistribution?.first else { break }
            guard let recipientId = action.recipientPlayerId, let recipient = playerIndex(state, recipientId),
                  recipient != targetIndex, item.cardId == action.cardId else {
                return RuleError(.invalid_target, "Choose another player for this card.")
            }
            let def = Catalog.card(item.cardId, variant)
            if def.kind == .money || def.kind == .action || def.kind == .building {
                state.players[recipient].bank.append(item.cardId)
            } else if let destination = item.color ?? (def.kind == .property ? def.color : nil) {
                addToProperty(&state.players[recipient], item.cardId, destination, setId: nil, attachedTo: item.attachedToCardId, variant)
                let destinationSetId = findPropertySetId(state.players[recipient], destination, cardId: item.cardId, variant)
                if req.step == "repossession_distribute" {
                    for attachment in state.players[targetIndex].properties[destination].filter({ $0.attachedToCardId == item.cardId }) {
                        removePropertyCard(&state.players[targetIndex], destination, attachment.cardId, setId: attachment.setId)
                        addToProperty(&state.players[recipient], attachment.cardId, destination, setId: destinationSetId, attachedTo: attachment.attachedToCardId, variant)
                    }
                }
            } else {
                return RuleError(.invalid_target, "Transferred card needs a property color.")
            }
            let remaining = Array(req.redistribution!.dropFirst())
            if remaining.isEmpty {
                state.pending = nil
            } else {
                req.redistribution = remaining
                state.pending = .noMercy(req)
            }

        default:
            break
        }
        return nil
    }

    private static func applyPlayAction(_ state: inout GameState, _ action: Action, _ pi: Int, _ events: inout [GameEvent]) -> RuleError? {
        let variant = gameVariant(state)
        let playerId = action.playerId
        let playerName = state.players[pi].name

        if case .rent(let pending) = state.pending {
            if pending.sourcePlayerId != playerId { return RuleError(.invalid_action, "Only source player can choose rent target.") }
            guard let targetId = action.targetPlayerId else { return RuleError(.invalid_target, "Rent target required.") }
            guard let target = player(state, targetId) else { return RuleError(.invalid_target, "Target player not found.") }
            if target.id == playerId { return RuleError(.invalid_target, "Cannot charge yourself rent.") }
            let effect = PendingEffect.payment(PaymentRequest(sourcePlayerId: playerId, targetPlayerId: target.id, amount: pending.amount, reason: "Rent (\(pending.color.rawValue))", actionCardId: pending.actionCardId))
            state.pending = nil
            offerCounter(&state, source: playerId, target: target.id, actionCardId: pending.actionCardId, effect: effect)
            pushEvent(&events, "rent_target", "\(playerName) charged \(target.name) $\(pending.amount) rent.")
            return nil
        }

        let rules = ruleset(state)
        if currentPlayer(state).id != playerId { return RuleError(.invalid_action, "Not your turn.") }
        if state.turn.phase != .action { return RuleError(.invalid_phase, "Cannot play now.") }
        if state.turn.playsUsed >= rules.maxPlaysPerTurn {
            return RuleError(.illegal_play_limit, "Already used \(rules.maxPlaysPerTurn) plays this turn.")
        }
        guard let cardId = action.cardId else { return RuleError(.invalid_action, "Card required.") }
        let card = Catalog.card(cardId, variant)
        if card.kind != .action { return RuleError(.invalid_action, "Building cards must be placed on a complete property set.") }
        if card.actionKind == .just_say_no { return RuleError(.invalid_action, "Just Say No can only be played as response.") }
        guard let actionKind = card.actionKind else { return RuleError(.invalid_action, "Card has no action.") }

        let targeted: Set<ActionKind> = [.debt_collector, .sly_deal, .forced_deal, .deal_breaker]
        let noMercyTargeted: Set<ActionKind> = [.forced_debt, .repossession, .tax_collector, .tough_luck, .unfair_trade, .yoink]
        var validated: PlayerState?
        if targeted.contains(actionKind) || (variant == .no_mercy && noMercyTargeted.contains(actionKind)) {
            guard let targetId = action.targetPlayerId else { return RuleError(.invalid_target, "Target required.") }
            guard let target = player(state, targetId) else { return RuleError(.invalid_target, "Target not found.") }
            if target.id == playerId { return RuleError(.invalid_target, "Cannot target yourself.") }
            validated = target
        }
        if actionKind == .sly_deal, let validated, movablePropertyCards(validated, variant).isEmpty {
            return RuleError(.invalid_action, "Target has no movable property cards.")
        }
        if actionKind == .forced_deal, let validated {
            if movablePropertyCards(state.players[pi], variant).isEmpty { return RuleError(.invalid_action, "You have no movable property cards.") }
            if movablePropertyCards(validated, variant).isEmpty { return RuleError(.invalid_action, "Target has no movable property cards.") }
        }
        if actionKind == .deal_breaker, let validated, completeSetColors(validated, variant).isEmpty {
            return RuleError(.invalid_action, "Target has no complete property sets.")
        }
        if variant == .no_mercy, actionKind == .forced_debt, let validated, !canIssueDebt(state, validated) {
            return RuleError(.invalid_action, "Target has reached the No Mercy debt-chip limit.")
        }
        if actionKind == .double_rent {
            if variant == .classic && !canPlayDoubleRent(state, state.players[pi], excluding: cardId) {
                return RuleError(.invalid_action, "Double Rent requires a playable rent card this turn.")
            }
            if variant == .no_mercy {
                guard let color = action.color else { return RuleError(.invalid_target, "Double Rent color required.") }
                if !card.rentColors.contains(color) { return RuleError(.invalid_target, "Double Rent card cannot target that color.") }
                if getRentAmount(state.players[pi], color, variant) <= 0 {
                    return RuleError(.invalid_action, "You do not own a standard property for that rent color.")
                }
            }
        }
        if actionKind == .rent || actionKind == .rent_wild {
            guard let color = action.color else { return RuleError(.invalid_target, "Rent color required.") }
            if !card.rentColors.contains(color) { return RuleError(.invalid_target, "Rent card cannot target that color.") }
            if getRentAmount(state.players[pi], color, variant) <= 0 {
                return RuleError(.invalid_action, "You do not own a standard property for that rent color.")
            }
        }
        if variant == .no_mercy && actionKind == .super_sly_deal {
            guard let color = action.color else { return RuleError(.invalid_target, "Choose a property color.") }
            let hasMatch = state.players.contains { target in
                target.id != playerId && target.properties[color].contains { matches($0.cardId, color: color, variant) }
            }
            if !hasMatch { return RuleError(.invalid_action, "No opponent has a property matching that color.") }
        }

        if !removeFromHand(&state.players[pi], cardId) { return RuleError(.insufficient_cards, "Card not in hand.") }
        state.discardPile.append(cardId)
        let others = state.players.filter { $0.id != playerId }.map(\.id)

        func chargeAll(_ state: inout GameState, amount: Int, reason: String) {
            guard let first = others.first else { return }
            let effect = PendingEffect.payment(PaymentRequest(sourcePlayerId: playerId, targetPlayerId: first, amount: amount, reason: reason, actionCardId: cardId, remainingTargetPlayerIds: Array(others.dropFirst())))
            offerCounter(&state, source: playerId, target: first, actionCardId: cardId, effect: effect)
        }
        func noMercyEffect(_ effect: String, targets: [PlayerId]? = nil, target: PlayerId? = nil, color: PropertyColor? = nil) -> PendingEffect {
            .noMercy(PendingNoMercy(sourcePlayerId: playerId, actionCardId: cardId, effect: effect, targetPlayerIds: targets, targetPlayerId: target, color: color))
        }

        switch actionKind {
        case .pass_go:
            let count = variant == .no_mercy && card.id == "pass_go_go_go" ? max(0, 7 - state.players[pi].hand.count) : 2
            let drawn = drawCards(&state, playerAt: pi, amount: count)
            pushEvent(&events, "action", "\(playerName) played Pass Go and drew \(drawn.count).", details: GameEventDetails(kind: "draw", playerId: playerId, count: drawn.count, reason: "pass_go"))

        case .double_rent:
            if variant == .classic {
                state.turn.doubleRentMultiplier *= 2
                pushEvent(&events, "action", "\(playerName) played Double Rent.")
            } else {
                let color = action.color!
                let amount = getRentAmount(state.players[pi], color, variant) * 2
                chargeAll(&state, amount: amount, reason: "Double Rent (\(color.rawValue))")
                pushEvent(&events, "action", "\(playerName) played Double Rent for \(color.label) at $\(amount).")
            }

        case .go_again where variant == .no_mercy:
            state.currentPlayerIndex = pi
            state.turn = .fresh
            state.turnCount += 1
            pushEvent(&events, "go_again", "\(playerName) gets another turn.")

        case .forced_debt where variant == .no_mercy:
            offerCounter(&state, source: playerId, target: validated!.id, actionCardId: cardId, effect: noMercyEffect("forced_debt", target: validated!.id))

        case .heist where variant == .no_mercy:
            // A player with no Bank card is not affected by Heist and therefore
            // does not receive a needless Just Say No window.
            let targets = state.players.filter { $0.id != playerId && !$0.bank.isEmpty }.map(\.id)
            if let first = targets.first {
                offerCounter(&state, source: playerId, target: first, actionCardId: cardId, effect: noMercyEffect("heist", targets: targets))
            }

        case .market_crash where variant == .no_mercy:
            let targets = state.players.filter { target in
                target.id != playerId && propertyColors.contains { color in target.properties[color].contains { isPropertyEntry($0.cardId, variant) } }
            }.map(\.id)
            if let first = targets.first {
                offerCounter(&state, source: playerId, target: first, actionCardId: cardId, effect: noMercyEffect("market_crash", targets: targets))
            }

        case .super_sly_deal where variant == .no_mercy:
            let color = action.color!
            let targets = state.players.filter { target in
                target.id != playerId && target.properties[color].contains { matches($0.cardId, color: color, variant) }
            }.map(\.id)
            if let first = targets.first {
                offerCounter(&state, source: playerId, target: first, actionCardId: cardId, effect: noMercyEffect("super_sly_deal", targets: targets, color: color))
            }

        case .repossession where variant == .no_mercy, .tax_collector where variant == .no_mercy,
             .tough_luck where variant == .no_mercy, .unfair_trade where variant == .no_mercy:
            offerCounter(&state, source: playerId, target: validated!.id, actionCardId: cardId, effect: noMercyEffect(actionKind.rawValue, target: validated!.id))

        case .yoink where variant == .no_mercy:
            let effect = PendingEffect.payment(PaymentRequest(sourcePlayerId: playerId, targetPlayerId: validated!.id, amount: 10, reason: "Yoink!", actionCardId: cardId))
            offerCounter(&state, source: playerId, target: validated!.id, actionCardId: cardId, effect: effect)

        case .its_my_birthday:
            chargeAll(&state, amount: 2, reason: "It's My Birthday")
            pushEvent(&events, "action", "\(playerName) played It's My Birthday.")

        case .debt_collector:
            let target = validated!
            let effect = PendingEffect.payment(PaymentRequest(sourcePlayerId: playerId, targetPlayerId: target.id, amount: 5, reason: "Debt Collector", actionCardId: cardId))
            offerCounter(&state, source: playerId, target: target.id, actionCardId: cardId, effect: effect)
            pushEvent(&events, "action", "\(playerName) played Debt Collector on \(target.name).")

        case .rent, .rent_wild:
            let color = action.color!
            let amount = getRentAmount(state.players[pi], color, variant) * state.turn.doubleRentMultiplier
            state.turn.doubleRentMultiplier = 1
            if actionKind == .rent && variant == .classic {
                state.pending = .rent(PendingRent(sourcePlayerId: playerId, actionCardId: cardId, color: color, amount: amount))
            } else {
                chargeAll(&state, amount: amount, reason: "Rent (\(color.rawValue))")
            }
            pushEvent(&events, "action", "\(playerName) played rent for \(color.label) at $\(amount).")

        case .sly_deal:
            let target = validated!
            let deal = PendingDeal(sourcePlayerId: playerId, targetPlayerId: target.id, actionCardId: cardId)
            offerCounter(&state, source: playerId, target: target.id, actionCardId: cardId, effect: .slyDeal(deal))
            pushEvent(&events, "action", "\(playerName) played Sly Deal on \(target.name).")

        case .forced_deal:
            let target = validated!
            let deal = PendingDeal(sourcePlayerId: playerId, targetPlayerId: target.id, actionCardId: cardId)
            offerCounter(&state, source: playerId, target: target.id, actionCardId: cardId, effect: .forcedDeal(deal))
            pushEvent(&events, "action", "\(playerName) played Forced Deal on \(target.name).")

        case .deal_breaker:
            let target = validated!
            let deal = PendingDeal(sourcePlayerId: playerId, targetPlayerId: target.id, actionCardId: cardId)
            offerCounter(&state, source: playerId, target: target.id, actionCardId: cardId, effect: .dealBreaker(deal))
            pushEvent(&events, "action", "\(playerName) played Deal Breaker on \(target.name).")

        default:
            break
        }

        if actionKind != .go_again { state.turn.playsUsed += 1 }
        return nil
    }

    private static func applyPayment(_ state: inout GameState, _ action: Action, _ pi: Int, _ events: inout [GameEvent]) -> RuleError? {
        guard case .payment(let req) = state.pending else { return RuleError(.invalid_action, "No payment pending.") }
        if req.targetPlayerId != action.playerId { return RuleError(.invalid_action, "Not your payment request.") }
        guard let collector = playerIndex(state, req.sourcePlayerId) else { return RuleError(.invalid_target, "Player not found.") }
        let variant = gameVariant(state)

        // Duplicates are dropped in first-seen order, as `new Set(action.cards)` does.
        var seen = Set<String>()
        let selected = (action.cards ?? []).filter { seen.insert($0).inserted }
        for cardId in selected {
            let inBank = state.players[pi].bank.contains(cardId)
            let inProperty = findPropertyColor(state.players[pi], cardId: cardId) != nil
            if !inBank && !inProperty { return RuleError(.invalid_action, "Cannot pay with \(cardId).") }
            if variant == .no_mercy && Catalog.isEveryColorWild(cardId, variant) {
                return RuleError(.invalid_action, "An every-color Wild cannot be used as payment.")
            }
        }
        let total = selected.reduce(0) { $0 + cardMoneyValue($1, variant) }
        let payable = totalPayableValue(state.players[pi], variant)
        if payable >= req.amount && total < req.amount {
            return RuleError(.invalid_action, "Payment must total at least $\(req.amount).")
        }
        if payable < req.amount && total < payable {
            return RuleError(.invalid_action, "Player must pay all available cards when total funds are insufficient.")
        }

        // Move property cards before their attached buildings so a Shack travels
        // with the property as one physical unit. An attached building selected on
        // its own is treated as a Bank card, matching the printed Shack rule.
        func isParent(_ cardId: String) -> Bool {
            guard let color = findPropertyColor(state.players[pi], cardId: cardId) else { return false }
            return state.players[pi].properties[color].contains { $0.attachedToCardId == cardId }
        }
        let parents = selected.filter(isParent)
        let ordered = parents + selected.filter { !isParent($0) }
        let selectedIds = Set(selected)
        var transferred = Set<String>()

        for cardId in ordered where !transferred.contains(cardId) {
            if let bankIndex = state.players[pi].bank.firstIndex(of: cardId) {
                state.players[pi].bank.remove(at: bankIndex)
                state.players[collector].bank.append(cardId)
                transferred.insert(cardId)
                continue
            }
            guard let color = findPropertyColor(state.players[pi], cardId: cardId) else { continue }
            let placement = state.players[pi].properties[color].first { $0.cardId == cardId }
            if let parent = placement?.attachedToCardId, selectedIds.contains(parent) { continue }
            guard let removed = removePropertyCard(&state.players[pi], color, cardId) else { continue }
            let def = Catalog.card(cardId, variant)
            if def.kind == .building {
                state.players[collector].bank.append(cardId)
            } else {
                let assign = def.kind == .property ? def.color! : color
                addToProperty(&state.players[collector], cardId, assign, setId: nil, attachedTo: nil, variant)
                let destinationSetId = findPropertySetId(state.players[collector], assign, cardId: cardId, variant)
                for attachment in attachedPropertyCards(state.players[pi], color, cardId, setId: removed.setId) {
                    removePropertyCard(&state.players[pi], color, attachment.cardId, setId: removed.setId)
                    if let destinationSetId {
                        addToProperty(&state.players[collector], attachment.cardId, assign, setId: destinationSetId, attachedTo: attachment.attachedToCardId, variant)
                    } else {
                        state.players[collector].bank.append(attachment.cardId)
                    }
                    transferred.insert(attachment.cardId)
                }
            }
            transferred.insert(cardId)
        }

        state.pending = nil
        if variant == .no_mercy && total < req.amount {
            issueDebt(&state, debtor: pi, creditor: collector, amount: req.amount - total)
        }
        pushEvent(&events, "pay", "\(state.players[pi].name) paid \(state.players[collector].name) $\(min(total, req.amount)) (\(req.reason)).")
        continuePaymentChain(&state, req)
        return nil
    }

    private static func applySlyDeal(_ state: inout GameState, _ action: Action, _ pi: Int, _ events: inout [GameEvent]) -> RuleError? {
        guard case .slyDeal(let req) = state.pending else { return RuleError(.invalid_action, "No sly deal pending.") }
        if req.sourcePlayerId != action.playerId { return RuleError(.invalid_action, "Not your sly deal selection.") }
        guard let target = playerIndex(state, req.targetPlayerId) else { return RuleError(.invalid_target, "Player not found.") }
        let variant = gameVariant(state)
        guard let cardId = action.cardId, let sourceColor = action.sourceColor, let destination = action.destinationColor else {
            return RuleError(.invalid_target, "Card not found in target set.")
        }
        let sourceSetId = action.sourceSetId ?? findPropertySetId(state.players[target], sourceColor, cardId: cardId, variant)
        let wasComplete = isCompleteSet(state.players[target], sourceColor, setId: sourceSetId, variant)
        guard let removed = removePropertyCard(&state.players[target], sourceColor, cardId, setId: sourceSetId) else {
            return RuleError(.invalid_target, "Card not found in target set.")
        }
        if wasComplete { return RuleError(.invalid_action, "Cannot steal cards from a complete set.") }
        let def = Catalog.card(cardId, variant)
        if !canCardBePlaced(def, in: destination)
            || (action.setId != nil && isCompleteSet(state.players[pi], destination, setId: action.setId, variant)) {
            return RuleError(.invalid_action, "Cannot place card in selected destination.")
        }
        addToProperty(&state.players[pi], cardId, destination, setId: action.setId, attachedTo: removed.attachedToCardId, variant)
        for attachment in attachedPropertyCards(state.players[target], sourceColor, cardId, setId: sourceSetId) {
            removePropertyCard(&state.players[target], sourceColor, attachment.cardId, setId: sourceSetId)
            addToProperty(&state.players[pi], attachment.cardId, destination, setId: action.setId, attachedTo: attachment.attachedToCardId, variant)
        }
        state.pending = nil
        pushEvent(&events, "sly_deal", "\(state.players[pi].name) took \(cardLabel(cardId, variant)) from \(state.players[target].name).", details: GameEventDetails(kind: "property_steal", sourcePlayerId: state.players[pi].id, targetPlayerId: state.players[target].id, cardIds: [cardId], mode: "sly_deal"))
        return nil
    }

    private static func applyForcedDeal(_ state: inout GameState, _ action: Action, _ pi: Int, _ events: inout [GameEvent]) -> RuleError? {
        guard case .forcedDeal(let req) = state.pending else { return RuleError(.invalid_action, "No forced deal pending.") }
        if req.sourcePlayerId != action.playerId { return RuleError(.invalid_action, "Not your forced deal selection.") }
        guard let target = playerIndex(state, req.targetPlayerId) else { return RuleError(.invalid_target, "Player not found.") }
        let variant = gameVariant(state)
        guard let giveId = action.giveCardId, let takeId = action.takeCardId,
              let giveColor = action.giveColor, let takeColor = action.takeColor, let destination = action.destinationColor else {
            return RuleError(.invalid_target, "Swap card not found.")
        }
        let giveSetId = action.giveSetId ?? findPropertySetId(state.players[pi], giveColor, cardId: giveId, variant)
        let takeSetId = action.takeSetId ?? findPropertySetId(state.players[target], takeColor, cardId: takeId, variant)
        let giveWasComplete = isCompleteSet(state.players[pi], giveColor, setId: giveSetId, variant)
        let takeWasComplete = isCompleteSet(state.players[target], takeColor, setId: takeSetId, variant)
        guard let give = removePropertyCard(&state.players[pi], giveColor, giveId, setId: giveSetId),
              let take = removePropertyCard(&state.players[target], takeColor, takeId, setId: takeSetId) else {
            return RuleError(.invalid_target, "Swap card not found.")
        }
        if giveWasComplete || takeWasComplete { return RuleError(.invalid_action, "Cannot swap cards that are part of a complete set.") }
        let takeDef = Catalog.card(take.cardId, variant)
        let giveDef = Catalog.card(give.cardId, variant)
        let targetDestination = giveDef.kind == .property ? giveDef.color! : giveColor
        if !canCardBePlaced(takeDef, in: destination)
            || (action.setId != nil && isCompleteSet(state.players[pi], destination, setId: action.setId, variant))
            || (giveDef.kind == .wild && !canCardBePlaced(giveDef, in: targetDestination)) {
            return RuleError(.invalid_action, "Cannot place taken card in destination.")
        }
        addToProperty(&state.players[pi], take.cardId, destination, setId: action.setId, attachedTo: take.attachedToCardId, variant)
        addToProperty(&state.players[target], give.cardId, targetDestination, setId: nil, attachedTo: give.attachedToCardId, variant)
        for attachment in attachedPropertyCards(state.players[target], takeColor, takeId, setId: takeSetId) {
            removePropertyCard(&state.players[target], takeColor, attachment.cardId, setId: takeSetId)
            addToProperty(&state.players[pi], attachment.cardId, destination, setId: action.setId, attachedTo: attachment.attachedToCardId, variant)
        }
        for attachment in attachedPropertyCards(state.players[pi], giveColor, giveId, setId: giveSetId) {
            removePropertyCard(&state.players[pi], giveColor, attachment.cardId, setId: giveSetId)
            addToProperty(&state.players[target], attachment.cardId, targetDestination, setId: nil, attachedTo: attachment.attachedToCardId, variant)
        }
        state.pending = nil
        pushEvent(&events, "forced_deal", "\(state.players[pi].name) swapped \(cardLabel(giveId, variant)) for \(cardLabel(takeId, variant)).", details: GameEventDetails(kind: "property_steal", sourcePlayerId: state.players[pi].id, targetPlayerId: state.players[target].id, cardIds: [giveId, takeId], mode: "forced_deal"))
        return nil
    }

    private static func applyDealBreaker(_ state: inout GameState, _ action: Action, _ pi: Int, _ events: inout [GameEvent]) -> RuleError? {
        guard case .dealBreaker(let req) = state.pending else { return RuleError(.invalid_action, "No deal breaker pending.") }
        if req.sourcePlayerId != action.playerId { return RuleError(.invalid_action, "Not your deal breaker choice.") }
        guard let target = playerIndex(state, req.targetPlayerId), let color = action.color else {
            return RuleError(.invalid_target, "Player not found.")
        }
        let variant = gameVariant(state)
        let completeSets = propertySets(state.players[target], color, variant)
            .filter { isCompleteSet(state.players[target], color, setId: $0.setId, variant) }
        let selected = action.setId.map { id in completeSets.first { $0.setId == id } } ?? (completeSets.count == 1 ? completeSets[0] : nil)
        guard let selected else { return RuleError(.invalid_action, "Target set is not complete.") }

        state.players[target].properties[color].removeAll { $0.setId == selected.setId }
        let stolenSetId = allocatePropertySetId(state.players[pi], color, preferred: "\(color.rawValue):stolen-\(selected.setId)", variant)
        for entry in selected.entries {
            let def = Catalog.card(entry.cardId, variant)
            let destination = def.kind == .property ? def.color! : color
            addToProperty(&state.players[pi], entry.cardId, destination, setId: stolenSetId, attachedTo: entry.attachedToCardId, variant)
        }
        state.pending = nil
        pushEvent(&events, "deal_breaker", "\(state.players[pi].name) stole \(state.players[target].name)'s \(color.rawValue) set.", details: GameEventDetails(kind: "property_steal", sourcePlayerId: state.players[pi].id, targetPlayerId: state.players[target].id, cardIds: selected.entries.map(\.cardId), mode: "deal_breaker"))
        return nil
    }

    // MARK: Game status and prompts

    public static func isGameOver(_ state: GameState) -> (done: Bool, winnerId: PlayerId?) {
        if let winnerId = state.winnerId { return (true, winnerId) }
        let variant = gameVariant(state)
        let needed = ruleset(state).winCompleteSets
        if let winner = state.players.first(where: { countCompleteSets($0, variant) >= needed }) {
            return (true, winner.id)
        }
        return (false, nil)
    }

    public static func nextPrompt(_ state: GameState) -> TurnPrompt {
        let current = currentPlayer(state)
        let rules = ruleset(state)
        let variant = gameVariant(state)
        func name(_ id: PlayerId, _ fallback: String) -> String { player(state, id)?.name ?? fallback }

        if requiresEndTurnDiscard(state, current) {
            return TurnPrompt(playerId: current.id, text: "\(current.name): discard down to \(rules.maxHandAtEndTurn) cards to end your turn.", kind: .discard)
        }
        switch state.pending {
        case .counter(let req):
            let waiting = player(state, req.awaitingPlayerId)
            return TurnPrompt(playerId: waiting?.id ?? current.id, text: "\(waiting?.name ?? "Player"): respond to \(name(req.sourcePlayerId, "Player"))'s \(cardLabel(req.actionCardId, variant)) or allow it to resolve.", kind: .response)
        case .payment(let req):
            let payer = player(state, req.targetPlayerId)
            return TurnPrompt(playerId: payer?.id ?? current.id, text: "\(payer?.name ?? "Player"): pay \(name(req.sourcePlayerId, "Player")) $\(req.amount) for \(req.reason).", kind: .payment)
        case .debtCard(let req):
            let recipient = player(state, req.creditorPlayerId)
            return TurnPrompt(playerId: recipient?.id ?? current.id, text: "\(recipient?.name ?? "Player"): resolve the card received for debt repayment.", kind: .selection)
        case .noMercy(let req):
            let target = req.targetPlayerId.flatMap { player(state, $0) }
            let actorIsSource = req.step == "heist_pick" || req.step == "market_crash_pick" || req.step == "tough_luck_choice"
            let actor = player(state, actorIsSource ? req.sourcePlayerId : target?.id ?? req.sourcePlayerId)
            let actorName = actor?.name ?? "Player"
            let text: String
            if req.step == "tough_luck_choice" {
                text = "\(actorName): choose which card type Tough Luck takes."
            } else if req.step?.hasSuffix("_distribute") == true {
                text = "\(actorName): choose who receives the next redistributed card."
            } else {
                text = "\(actorName): resolve the No Mercy effect."
            }
            return TurnPrompt(playerId: actor?.id ?? current.id, text: text, kind: .selection)
        case .rent(let req):
            return TurnPrompt(playerId: req.sourcePlayerId, text: "\(name(req.sourcePlayerId, "Player")): choose who pays $\(req.amount) rent for \(req.color.label).", kind: .selection)
        case .slyDeal(let req):
            return TurnPrompt(playerId: req.sourcePlayerId, text: "\(name(req.sourcePlayerId, "Player")): choose a property card to steal from \(name(req.targetPlayerId, "target")).", kind: .selection)
        case .forcedDeal(let req):
            return TurnPrompt(playerId: req.sourcePlayerId, text: "\(name(req.sourcePlayerId, "Player")): choose one of your properties, then a property from \(name(req.targetPlayerId, "target")) to swap.", kind: .selection)
        case .dealBreaker(let req):
            return TurnPrompt(playerId: req.sourcePlayerId, text: "\(name(req.sourcePlayerId, "Player")): choose a complete set to steal from \(name(req.targetPlayerId, "target")).", kind: .selection)
        case nil:
            break
        }
        if state.turn.phase == .debt {
            return TurnPrompt(playerId: current.id, text: "\(current.name): repay outstanding debt before playing cards.", kind: .debt)
        }
        if state.turn.phase == .draw {
            return TurnPrompt(playerId: current.id, text: "\(current.name): draw cards to start your turn.", kind: .draw)
        }
        return TurnPrompt(playerId: current.id, text: "\(current.name): play up to \(rules.maxPlaysPerTurn - state.turn.playsUsed) cards or pass.", kind: .main)
    }

    // MARK: Undo policy (`src/engine/undoPolicy.ts`)

    public static let maxTurnSnapshots = 32

    /// True when an action other than the turn's forced draw changed the deck. Those
    /// cards are now known, so undoing the action would be a free peek.
    public static func actionRevealedDeckCards(before: GameState, after: GameState, actionType: ActionType) -> Bool {
        actionType != .draw_cards && after.drawPile != before.drawPile
    }

    /// Drops the oldest step past the cap, but keeps the first entry, which Reset Turn restores.
    public static func appendTurnSnapshot<T>(_ snapshots: [T], _ snapshot: T) -> [T] {
        var next = snapshots + [snapshot]
        if next.count > maxTurnSnapshots { next.remove(at: 1) }
        return next
    }

    /// The moves a turn's player can take back. Mirrors `isReversibleActionType` in `apps/server/src/gameService.ts`.
    public static let reversibleActionTypes: Set<ActionType> = [.draw_cards, .play_to_bank, .play_property, .play_action, .move_wild, .repay_debt]

    /// Whether the turn's undo history survives this state. It doesn't once another player
    /// has to answer, or the turn is over. Mirrors `shouldRetainTurnSnapshots` in `src/App.tsx`.
    public static func shouldRetainTurnSnapshots(_ state: GameState, promptPlayerId: PlayerId) -> Bool {
        if isGameOver(state).done { return false }
        guard state.turn.phase == .action || (state.variant == .no_mercy && state.turn.phase == .debt) else { return false }
        guard state.players[state.currentPlayerIndex].id == promptPlayerId else { return false }
        switch state.pending {
        case nil, .rent, .slyDeal, .forcedDeal, .dealBreaker, .debtCard, .noMercy: return true
        case .counter, .payment: return false
        }
    }
}
