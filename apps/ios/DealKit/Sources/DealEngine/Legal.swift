import Foundation

/// Mirrors the legal-action generators in `src/engine/game.ts` and `pending.ts`.
/// Labels are part of the contract, because the conformance test compares them.
extension Action {
    func with(_ configure: (inout Action) -> Void) -> Action {
        var copy = self
        configure(&copy)
        return copy
    }
}

extension Engine {
    private static func playerName(_ state: GameState, _ id: PlayerId) -> String {
        player(state, id)?.name ?? "Player"
    }

    static func debts(_ player: PlayerState) -> [DebtRecord] { player.debts ?? [] }

    static func canIssueDebt(_ state: GameState, _ debtor: PlayerState) -> Bool {
        guard gameVariant(state) == .no_mercy else { return false }
        return (debtor.debtChipsRemaining ?? 3) > 0 && debts(debtor).count < 3
    }

    // MARK: Pending interactions

    private static func legalForCounter(_ req: CounterRequest, _ player: PlayerState, _ variant: GameVariant) -> [LegalAction] {
        guard req.awaitingPlayerId == player.id else { return [] }
        var actions = [LegalAction(
            label: "Resolve without Just Say No",
            action: Action(.counter_response, playerId: player.id).with { $0.useJustSayNo = false }
        )]
        for cardId in player.hand where Catalog.card(cardId, variant).actionKind == .just_say_no {
            actions.append(LegalAction(
                label: "Play Just Say No (\(cardLabel(cardId, variant)))",
                action: Action(.counter_response, playerId: player.id).with {
                    $0.useJustSayNo = true
                    $0.cardId = cardId
                }
            ))
        }
        return actions
    }

    private static func legalForPayment(_ req: PaymentRequest, _ player: PlayerState, _ variant: GameVariant) -> [LegalAction] {
        guard req.targetPlayerId == player.id else { return [] }
        return generatePaymentOptions(player, targetAmount: req.amount, variant).enumerated().map { index, cards in
            LegalAction(
                label: cards.isEmpty
                    ? "Cannot pay (no cards)"
                    : "Pay option \(index + 1): \(cards.map { cardLabel($0, variant) }.joined(separator: ", "))",
                action: Action(.pay_request, playerId: player.id).with { $0.cards = cards }
            )
        }
    }

    private static func legalForRent(_ state: GameState, _ req: PendingRent, _ player: PlayerState, _ variant: GameVariant) -> [LegalAction] {
        guard req.sourcePlayerId == player.id else { return [] }
        return state.players.filter { $0.id != player.id }.map { target in
            let cap = min(req.amount, totalPayableValue(target, variant))
            let transfer = cap > totalBankValue(target, variant)
            return LegalAction(
                label: "Charge \(target.name) rent for \(req.color.label)",
                action: Action(.play_action, playerId: player.id).with {
                    $0.cardId = req.actionCardId
                    $0.targetPlayerId = target.id
                    $0.color = req.color
                },
                targetPlayerId: target.id,
                requestedAmount: req.amount,
                collectibleCap: cap,
                requiresPropertyTransfer: transfer,
                requiresConfirmation: false,
                riskLevel: transfer ? .high : .medium,
                previewText: transfer
                    ? "This rent likely requires property transfer to cover payment."
                    : "This rent charge may force the target to pay from their bank."
            )
        }
    }

    private static func openSetIds(_ player: PlayerState, _ color: PropertyColor, _ variant: GameVariant) -> [String?] {
        let open = propertySets(player, color, variant).filter { set in
            let count = set.entries.filter {
                let kind = Catalog.card($0.cardId, variant).kind
                return kind == .property || kind == .wild
            }.count
            return count < color.setSize && !isCompleteSet(player, color, setId: set.setId, variant)
        }
        return open.isEmpty ? [nil] : open.map(\.setId)
    }

    private static func legalForSlyDeal(_ state: GameState, _ req: PendingDeal, _ player: PlayerState, _ variant: GameVariant) -> [LegalAction] {
        guard req.sourcePlayerId == player.id, let target = Self.player(state, req.targetPlayerId) else { return [] }
        var choices: [LegalAction] = []
        for movable in movablePropertyCards(target, variant) {
            let def = Catalog.card(movable.cardId, variant)
            for destination in propertyColors where canCardBePlaced(def, in: destination) {
                for setId in openSetIds(player, destination, variant) {
                    choices.append(LegalAction(
                        label: "Take \(cardLabel(movable.cardId, variant)) from \(target.name) to \(destination.label)",
                        action: Action(.sly_deal_pick, playerId: player.id).with {
                            $0.cardId = movable.cardId
                            $0.sourceColor = movable.color
                            $0.destinationColor = destination
                            $0.sourceSetId = movable.setId
                            $0.setId = setId
                        }
                    ))
                }
            }
        }
        return choices
    }

    private static func legalForForcedDeal(_ state: GameState, _ req: PendingDeal, _ player: PlayerState, _ variant: GameVariant) -> [LegalAction] {
        guard req.sourcePlayerId == player.id,
              let source = Self.player(state, req.sourcePlayerId),
              let target = Self.player(state, req.targetPlayerId) else { return [] }
        var actions: [LegalAction] = []
        for own in movablePropertyCards(source, variant) {
            for theirs in movablePropertyCards(target, variant) {
                let taken = Catalog.card(theirs.cardId, variant)
                for destination in propertyColors where canCardBePlaced(taken, in: destination) {
                    for setId in openSetIds(source, destination, variant) {
                        actions.append(LegalAction(
                            label: "Swap \(cardLabel(own.cardId, variant)) for \(cardLabel(theirs.cardId, variant))",
                            action: Action(.forced_deal_pick, playerId: player.id).with {
                                $0.giveCardId = own.cardId
                                $0.giveColor = own.color
                                $0.takeCardId = theirs.cardId
                                $0.takeColor = theirs.color
                                $0.destinationColor = destination
                                $0.giveSetId = own.setId
                                $0.takeSetId = theirs.setId
                                $0.setId = setId
                            }
                        ))
                    }
                }
            }
        }
        return actions
    }

    private static func legalForDealBreaker(_ state: GameState, _ req: PendingDeal, _ player: PlayerState, _ variant: GameVariant) -> [LegalAction] {
        guard req.sourcePlayerId == player.id, let target = Self.player(state, req.targetPlayerId) else { return [] }
        return completeSetColors(target, variant).flatMap { color in
            propertySets(target, color, variant)
                .filter { isCompleteSet(target, color, setId: $0.setId, variant) }
                .map { set in
                    LegalAction(
                        label: "Take complete \(color.label) set",
                        action: Action(.deal_breaker_pick, playerId: player.id).with {
                            $0.color = color
                            $0.setId = set.setId
                        }
                    )
                }
        }
    }

    private static func legalForPending(_ state: GameState, _ player: PlayerState) -> [LegalAction] {
        let variant = gameVariant(state)
        switch state.pending {
        case .counter(let req): return legalForCounter(req, player, variant)
        case .payment(let req): return legalForPayment(req, player, variant)
        case .rent(let req): return legalForRent(state, req, player, variant)
        case .slyDeal(let req): return legalForSlyDeal(state, req, player, variant)
        case .forcedDeal(let req): return legalForForcedDeal(state, req, player, variant)
        case .dealBreaker(let req): return legalForDealBreaker(state, req, player, variant)
        default: return []
        }
    }

    // MARK: Debt

    private static func legalDebtActions(_ state: GameState, _ player: PlayerState) -> [LegalAction] {
        let variant = gameVariant(state)
        guard variant == .no_mercy, state.turn.phase == .debt, currentPlayer(state).id == player.id else { return [] }
        if state.turn.playsUsed >= ruleset(state).maxPlaysPerTurn { return [] }
        return debts(player).flatMap { debt in
            player.hand.map { cardId in
                LegalAction(
                    label: "Repay \(playerName(state, debt.creditorPlayerId)) with \(cardLabel(cardId, variant))",
                    action: Action(.repay_debt, playerId: player.id).with {
                        $0.debtId = debt.id ?? debt.chipId
                        $0.cardId = cardId
                    }
                )
            }
        }
    }

    /// A debt card is resolved immediately by its creditor. Build a temporary
    /// action window for that player so the normal legal-action generator remains
    /// the single source of truth for target and color choices, without changing
    /// the debtor's turn or play budget.
    static func receivedActionChoices(_ state: GameState, recipient: PlayerState, cardId: String) -> [Action] {
        var temporary = state
        temporary.pending = nil
        guard let index = playerIndex(temporary, recipient.id) else { return [] }
        temporary.currentPlayerIndex = index
        temporary.turn = .actionWindow
        temporary.players[index].hand.append(cardId)
        return getLegalActions(temporary, recipient.id)
            .map(\.action)
            .filter { $0.type == .play_action && $0.cardId == cardId }
    }

    private static func legalDebtCardActions(_ state: GameState, _ player: PlayerState) -> [LegalAction] {
        guard case .debtCard(let pending) = state.pending, pending.creditorPlayerId == player.id else { return [] }
        let variant = gameVariant(state)
        let card = Catalog.card(pending.cardId, variant)
        if card.kind == .action || card.kind == .building || card.kind == .money {
            var actions = [LegalAction(
                label: "Bank \(card.name)",
                action: Action(.resolve_debt_card, playerId: player.id).with {
                    $0.debtId = pending.debtId
                    $0.cardId = pending.cardId
                    $0.mode = "bank"
                }
            )]
            // Go Again explicitly goes to the Bank when received as debt payment.
            if card.kind == .action && card.actionKind != .go_again {
                for choice in receivedActionChoices(state, recipient: player, cardId: pending.cardId) {
                    let suffix: String
                    if let target = choice.targetPlayerId {
                        suffix = " on \(playerName(state, target))"
                    } else if let color = choice.color {
                        suffix = " for \(color.label) rent"
                    } else {
                        suffix = ""
                    }
                    actions.append(LegalAction(
                        label: "Play received \(card.name)\(suffix)",
                        action: Action(.resolve_debt_card, playerId: player.id).with {
                            $0.debtId = pending.debtId
                            $0.cardId = pending.cardId
                            $0.mode = "action"
                            $0.targetPlayerId = choice.targetPlayerId
                            $0.color = choice.color
                        }
                    ))
                }
            }
            return actions
        }
        return propertyColors.filter { canCardBePlaced(card, in: $0) }.map { color in
            LegalAction(
                label: "Place \(card.name) in \(color.label)",
                action: Action(.resolve_debt_card, playerId: player.id).with {
                    $0.debtId = pending.debtId
                    $0.cardId = pending.cardId
                    $0.mode = "property"
                    $0.color = color
                }
            )
        }
    }

    // MARK: No Mercy selections

    private static func legalNoMercyActions(_ state: GameState, _ player: PlayerState) -> [LegalAction] {
        guard case .noMercy(let req) = state.pending else { return [] }
        let variant = gameVariant(state)
        let target = req.targetPlayerId.flatMap { Self.player(state, $0) }
        var actions: [LegalAction] = []

        func pick(_ label: String, _ configure: (inout Action) -> Void) {
            actions.append(LegalAction(
                label: label,
                action: Action(.no_mercy_pick, playerId: player.id).with {
                    $0.actionCardId = req.actionCardId
                    $0.targetPlayerId = target?.id
                    configure(&$0)
                }
            ))
        }
        func propertyEntries(_ owner: PlayerState) -> [(PropertyColor, PropertyCardPlacement)] {
            propertyColors.flatMap { color in
                owner.properties[color].compactMap { entry in
                    let kind = Catalog.card(entry.cardId, variant).kind
                    return kind == .property || kind == .wild ? (color, entry) : nil
                }
            }
        }

        if req.effect == "heist", req.step == "heist_pick", req.sourcePlayerId == player.id, let target {
            for cardId in target.bank {
                pick("Heist \(cardLabel(cardId, variant)) from \(target.name)") { $0.cardId = cardId }
            }
        }
        if req.effect == "market_crash", req.step == "market_crash_pick", req.sourcePlayerId == player.id, let target {
            for (color, entry) in propertyEntries(target) {
                pick("Take \(cardLabel(entry.cardId, variant)) from \(target.name)") {
                    $0.cardId = entry.cardId
                    $0.color = color
                }
            }
        }
        if req.effect == "repossession", req.step == "repossession_keep", let target, target.id == player.id {
            for (color, entry) in propertyEntries(target) {
                pick("Keep \(cardLabel(entry.cardId, variant))") {
                    $0.cardId = entry.cardId
                    $0.color = color
                }
            }
        }
        if (req.effect == "repossession" && req.step == "repossession_distribute")
            || (req.effect == "tax_collector" && req.step == "tax_collector_distribute") {
            guard let target, target.id == player.id, let card = req.redistribution?.first else { return actions }
            for recipient in state.players where recipient.id != target.id {
                pick("Give \(cardLabel(card.cardId, variant)) to \(recipient.name)") {
                    $0.cardId = card.cardId
                    $0.recipientPlayerId = recipient.id
                }
            }
        }
        if req.effect == "tax_collector", req.step == "tax_collector_keep", let target, target.id == player.id {
            for cardId in target.bank {
                pick("Keep \(cardLabel(cardId, variant))") { $0.cardId = cardId }
            }
        }
        if req.effect == "tough_luck", req.step == "tough_luck_choice", req.sourcePlayerId == player.id {
            for choice in ToughLuckChoice.allCases {
                pick("Take all \(choice.rawValue) cards from \(target?.name ?? "target")'s hand") { $0.choice = choice }
            }
        }
        return actions
    }

    // MARK: Normal plays

    private static func legalPlayActions(_ state: GameState, _ player: PlayerState) -> [LegalAction] {
        var actions: [LegalAction] = []
        guard state.turn.phase == .action else { return actions }
        let variant = gameVariant(state)

        if state.turn.playsUsed < ruleset(state).maxPlaysPerTurn {
            for cardId in player.hand {
                let card = Catalog.card(cardId, variant)
                if canCardBeBanked(card) {
                    actions.append(LegalAction(
                        label: "Bank \(card.name)",
                        action: Action(.play_to_bank, playerId: player.id).with { $0.cardId = cardId }
                    ))
                }
                switch card.kind {
                case .property, .wild:
                    for color in propertyColors where canCardBePlaced(card, in: color) {
                        actions.append(LegalAction(
                            label: "Play \(card.name) to \(color.label)",
                            action: Action(.play_property, playerId: player.id).with {
                                $0.cardId = cardId
                                $0.color = color
                            }
                        ))
                    }
                case .building:
                    appendBuildingActions(&actions, card, cardId, player, variant)
                case .action:
                    appendCardActions(&actions, card, cardId, player, state, variant)
                case .money:
                    break
                }
            }
        }

        for color in propertyColors {
            for placement in player.properties[color] {
                let def = Catalog.card(placement.cardId, variant)
                guard def.kind == .wild else { continue }
                // A Shack is physically attached to its property and cannot be moved
                // independently by the Wild's free color-change action.
                if variant == .no_mercy, !attachedPropertyCards(player, color, placement.cardId, setId: placement.setId).isEmpty { continue }
                for targetColor in propertyColors where canCardBePlaced(def, in: targetColor) && targetColor != color {
                    let openSets = propertySets(player, targetColor, variant).filter { !isCompleteSet(player, targetColor, setId: $0.setId, variant) }
                    let targetSetIds: [String?] = openSets.isEmpty ? [nil] : openSets.map(\.setId)
                    for setId in targetSetIds {
                        actions.append(LegalAction(
                            label: "Move \(cardLabel(placement.cardId, variant)) from \(color.label) to \(targetColor.label)",
                            action: Action(.move_wild, playerId: player.id).with {
                                $0.cardId = placement.cardId
                                $0.fromColor = color
                                $0.toColor = targetColor
                                $0.fromSetId = placement.setId
                                $0.setId = setId
                            }
                        ))
                    }
                }
            }
        }

        actions.append(LegalAction(label: "Pass turn", action: Action(.pass_turn, playerId: player.id)))
        return actions
    }

    private static func appendBuildingActions(_ actions: inout [LegalAction], _ card: CardDefinition, _ cardId: String, _ player: PlayerState, _ variant: GameVariant) {
        if variant == .no_mercy && card.actionKind == .shack {
            for color in propertyColors {
                for set in propertySets(player, color, variant) {
                    for entry in set.entries {
                        let kind = Catalog.card(entry.cardId, variant).kind
                        guard kind == .property || kind == .wild else { continue }
                        guard isShackPlacementLegal(player, color, setId: set.setId, attachedTo: entry.cardId, variant) else { continue }
                        actions.append(LegalAction(
                            label: "Play Shack on \(color.label) property",
                            action: Action(.play_property, playerId: player.id).with {
                                $0.cardId = cardId
                                $0.color = color
                                $0.setId = set.setId
                                $0.attachedToCardId = entry.cardId
                            }
                        ))
                    }
                }
            }
            return
        }
        for color in propertyColors {
            let eligible = propertySets(player, color, variant)
                .filter { isBuildingPlacementLegal(player, color, card.actionKind, setId: $0.setId, variant) }
                .map(\.setId)
            for setId in eligible {
                actions.append(LegalAction(
                    label: eligible.count > 1 ? "Play \(card.name) on \(color.label) set \(setId)" : "Play \(card.name) on \(color.label)",
                    action: Action(.play_property, playerId: player.id).with {
                        $0.cardId = cardId
                        $0.color = color
                        if eligible.count > 1 { $0.setId = setId }
                    }
                ))
            }
        }
    }

    private static func appendCardActions(_ actions: inout [LegalAction], _ card: CardDefinition, _ cardId: String, _ player: PlayerState, _ state: GameState, _ variant: GameVariant) {
        guard let kind = card.actionKind, kind != .just_say_no else { return }
        let others = state.players.filter { $0.id != player.id }
        let baseAction = Action(.play_action, playerId: player.id).with { $0.cardId = cardId }

        if variant == .no_mercy {
            switch kind {
            case .go_again, .heist, .market_crash:
                actions.append(LegalAction(label: "Play \(card.name)", action: baseAction))
                return
            case .super_sly_deal:
                let colors = propertyColors.filter { color in
                    others.contains { target in
                        target.properties[color].contains { entry in
                            let def = Catalog.card(entry.cardId, variant)
                            return (def.kind == .property && def.color == color) || (def.kind == .wild && def.colors.contains(color))
                        }
                    }
                }
                for color in colors {
                    actions.append(LegalAction(
                        label: "Play \(card.name) for \(color.label)",
                        action: baseAction.with { $0.color = color },
                        requiresConfirmation: true,
                        riskLevel: .high,
                        previewText: "Take every \(color.label) property from all opponents, including complete sets."
                    ))
                }
                return
            case .forced_debt, .repossession, .tax_collector, .tough_luck, .unfair_trade, .yoink:
                if kind == .unfair_trade && player.bank.isEmpty { return }
                for target in others where kind != .forced_debt || canIssueDebt(state, target) {
                    actions.append(LegalAction(
                        label: "Play \(card.name) on \(target.name)",
                        action: baseAction.with { $0.targetPlayerId = target.id },
                        targetPlayerId: target.id
                    ))
                }
                return
            default:
                break
            }
        }

        switch kind {
        case .pass_go, .its_my_birthday:
            actions.append(LegalAction(label: "Play \(card.name)", action: baseAction))
        case .double_rent:
            if variant == .no_mercy {
                for color in card.rentColors where getRentAmount(player, color, variant) > 0 {
                    actions.append(LegalAction(
                        label: "Play \(card.name) for \(color.label) rent",
                        action: baseAction.with { $0.color = color },
                        requiresConfirmation: true,
                        riskLevel: .high,
                        previewText: "Charge all opponents double \(color.label) rent."
                    ))
                }
            } else if canPlayDoubleRent(state, player, excluding: cardId) {
                actions.append(LegalAction(label: "Play \(card.name)", action: baseAction))
            }
        case .debt_collector, .sly_deal, .forced_deal, .deal_breaker:
            let ownMovable = movablePropertyCards(player, variant)
            for target in others {
                if kind == .sly_deal && movablePropertyCards(target, variant).isEmpty { continue }
                if kind == .forced_deal && (ownMovable.isEmpty || movablePropertyCards(target, variant).isEmpty) { continue }
                if kind == .deal_breaker && completeSetColors(target, variant).isEmpty { continue }
                let preview: String
                switch kind {
                case .deal_breaker: preview = "This can steal an entire complete set."
                case .forced_deal: preview = "This swaps properties and can reshape both boards."
                case .sly_deal: preview = "This steals a property from the selected target."
                default: preview = "This demands payment from the selected target."
                }
                actions.append(LegalAction(
                    label: "Play \(card.name) on \(target.name)",
                    action: baseAction.with { $0.targetPlayerId = target.id },
                    targetPlayerId: target.id,
                    requiresConfirmation: true,
                    riskLevel: kind == .deal_breaker || kind == .forced_deal ? .high : .medium,
                    previewText: preview
                ))
            }
        case .rent, .rent_wild:
            for color in card.rentColors where getRentAmount(player, color, variant) > 0 {
                actions.append(LegalAction(
                    label: "Play \(card.name) for \(color.label) rent",
                    action: baseAction.with { $0.color = color },
                    requiresConfirmation: true,
                    riskLevel: .medium,
                    previewText: variant == .no_mercy || kind == .rent_wild
                        ? "Charge all opponents for \(color.label) rent."
                        : "Charge one opponent for \(color.label) rent."
                ))
            }
        default:
            break
        }
    }

    // MARK: Entry point

    public static func getLegalActions(_ state: GameState, _ playerId: PlayerId) -> [LegalAction] {
        guard let player = player(state, playerId), state.winnerId == nil else { return [] }
        let variant = gameVariant(state)

        if requiresEndTurnDiscard(state, player) {
            return player.hand.map { cardId in
                LegalAction(
                    label: "Discard \(cardLabel(cardId, variant))",
                    action: Action(.discard_card, playerId: playerId).with { $0.cardId = cardId }
                )
            }
        }

        let pendingActions = legalForPending(state, player)
        if !pendingActions.isEmpty { return pendingActions }
        let debtCardActions = legalDebtCardActions(state, player)
        if !debtCardActions.isEmpty { return debtCardActions }
        let noMercyActions = legalNoMercyActions(state, player)
        if !noMercyActions.isEmpty { return noMercyActions }
        if state.pending != nil { return [] }

        guard currentPlayer(state).id == playerId else { return [] }
        switch state.turn.phase {
        case .draw: return [LegalAction(label: "Draw cards", action: Action(.draw_cards, playerId: playerId))]
        case .debt: return legalDebtActions(state, player)
        case .action: return legalPlayActions(state, player)
        case .finished: return []
        }
    }
}
