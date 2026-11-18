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
