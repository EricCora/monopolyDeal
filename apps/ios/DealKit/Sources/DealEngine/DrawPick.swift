import Foundation

extension Engine {
    /// How many cards `action` will draw from the pile, or nil when it draws none.
    /// God mode uses it to offer a choice of the pile before a draw or Pass Go.
    public static func drawCount(for action: Action, in state: GameState) -> Int? {
        guard let player = player(state, action.playerId) else { return nil }
        switch action.type {
        case .draw_cards:
            return player.hand.isEmpty ? 5 : 2
        case .play_action:
            guard let cardId = action.cardId else { return nil }
            let variant = gameVariant(state)
            let card = Catalog.card(cardId, variant)
            guard card.kind == .action, card.actionKind == .pass_go else { return nil }
            // Pass Go Go Go fills the hand to 7 after the card itself leaves the hand.
            if variant == .no_mercy && card.id == "pass_go_go_go" { return max(0, 7 - (player.hand.count - 1)) }
            return 2
        default:
            return nil
        }
    }

    /// The draw pile from the next card to be drawn to the last.
    public static func drawPileInDrawOrder(_ state: GameState) -> [String] {
        Array(state.drawPile.reversed())
    }
}

extension Engine {
    /// The action as a match log keeps it. Every draw names the cards it took, so a draw chosen
    /// in god mode looks the same in a replay as any other draw. Replaying the named cards gives
    /// the same game, because they are exactly what the draw took from the pile. A draw that
    /// reshuffled the discards keeps its plain form. Mirrors `actionAsRecorded` in `src/engine/drawPick.ts`.
    public static func actionAsRecorded(before: GameState, after: GameState, action: Action) -> Action {
        guard action.type == .draw_cards || action.type == .play_action, action.pick == nil,
              drawCount(for: action, in: before) != nil else { return action }
        let had = Set(before.players.first { $0.id == action.playerId }?.hand ?? [])
        let drawn = (after.players.first { $0.id == action.playerId }?.hand ?? []).filter { !had.contains($0) }
        let pile = Set(before.drawPile)
        guard !drawn.isEmpty, drawn.count <= 7, drawn.allSatisfy(pile.contains) else { return action }
        var recorded = action
        recorded.pick = drawn
        return recorded
    }
}
