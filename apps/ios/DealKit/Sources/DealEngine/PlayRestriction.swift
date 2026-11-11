import Foundation

extension Engine {
    /// Why this card can't be used for what it's meant for right now, in words for the player.
    /// Nil when there's nothing to explain. An action card can usually still be banked, so
    /// a reason doesn't always mean the card has no options.
    public static func playRestriction(_ state: GameState, playerId: PlayerId, cardId: String) -> String? {
        let variant = gameVariant(state)
        guard let player = player(state, playerId), let card = Catalog.lookup(cardId, variant) else { return nil }
        if isGameOver(state).done { return nil }

        let prompt = nextPrompt(state)
        if prompt.playerId != playerId {
            return "It's \(self.player(state, prompt.playerId)?.name ?? "another player")'s turn."
        }
        if prompt.kind == .discard {
            return discardableCards(state, player).contains(cardId) || !player.hand.contains(cardId)
                ? nil
                : "Discard your other cards first. Properties go only when nothing else is left."
        }
        if prompt.kind == .debt { return nil }
        if state.pending != nil { return "Finish the choice in front of you first." }
        if state.turn.phase == .draw { return "Draw your cards first." }
        let limit = ruleset(state).maxPlaysPerTurn
        if state.turn.playsUsed >= limit {
            return "You've used all \(limit) plays this turn."
        }

        // Anything it can do beyond the Bank means there's nothing to explain.
        let usable = getLegalActions(state, playerId).contains { legal in
            legal.action.cardId == cardId && legal.action.type != .play_to_bank
        }
        if usable { return nil }

        let others = state.players.filter { $0.id != playerId }
        switch card.actionKind {
        case .house, .hotel:
            return buildingRestriction(player, kind: card.actionKind!, variant)
        case .shack:
            return "A Shack needs a property to sit on that doesn't already have one."
        case .just_say_no:
            return "Save Just Say No to block an action against you."
        case .rent, .rent_wild:
            return "You need a property in one of this card's colors to charge rent. An any-color Wild on its own doesn't count."
        case .double_rent:
            return variant == .classic
                ? "Double Rent needs a rent card you can play, and 2 plays left this turn."
                : "You need a property in one of this card's colors to charge rent. An any-color Wild on its own doesn't count."
        case .sly_deal:
            return "No opponent has a property outside a complete set."
        case .forced_deal:
            return movablePropertyCards(player, variant).isEmpty
                ? "You need a property outside a complete set to swap."
                : "No opponent has a property outside a complete set."
        case .deal_breaker:
            return "No opponent has a complete set."
        case .forced_debt:
            return "Every opponent is already at the limit of debt chips."
        case .unfair_trade:
            return "You need money in your Bank to swap."
        case .super_sly_deal:
            return others.isEmpty ? nil : "No opponent has any properties to take."
        default:
            return nil
        }
    }

    private static func buildingRestriction(_ player: PlayerState, kind: ActionKind, _ variant: GameVariant) -> String {
        let name = kind == .house ? "House" : "Hotel"
        let buildable = propertyColors.filter { $0 != .railroad && $0 != .utility }.flatMap { color in
            propertySets(player, color, variant).filter { isCompletePropertySet($0.entries, color, variant) }
        }
        if buildable.isEmpty {
            let onlyUnbuildable = isCompleteSet(player, .railroad, setId: nil, variant) || isCompleteSet(player, .utility, setId: nil, variant)
            return onlyUnbuildable
                ? "Houses and Hotels can't go on Railroads or Utilities."
                : "A \(name) needs a complete set."
        }
        func has(_ set: PropertySetView, _ building: ActionKind) -> Bool {
            set.entries.contains { Catalog.lookup($0.cardId, variant)?.actionKind == building }
        }
        if kind == .hotel, !buildable.contains(where: { has($0, .house) }) {
            return "A Hotel needs a complete set with a House on it."
        }
        return "Each complete set can hold only one \(name)."
    }
}
