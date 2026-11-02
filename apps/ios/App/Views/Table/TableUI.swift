import DealAI
import DealEngine
import DealStats
import Observation
import SwiftUI

/// One thing a card can do, as offered to the player.
struct CardOption: Identifiable {
    let id: Int
    var label: String
    var detail: String?
    var legal: LegalAction
}

struct ChooserContent: Identifiable {
    let id = UUID()
    var cardId: String
    var title: String
    /// Why the card can't do what it's meant for, when only something lesser is on offer.
    var note: String?
    var options: [CardOption]
}

struct PlaySpotlight: Identifiable, Equatable {
    let id = UUID()
    var cardId: String
    var playerName: String
}

struct RiskyConfirmation: Identifiable {
    let id = UUID()
    var action: Action
    var label: String
    var risk: RiskLevel
    var preview: String
}

/// Screen state for one table: what's selected, and which dialogs are open.
@MainActor
@Observable
final class TableUI {
    var selectedCardId: String?
    var chooser: ChooserContent?
    var confirmation: RiskyConfirmation?
    var paymentCards: [String] = []
    var forcedDealGive: Engine.MovableCard?
    var inspectedCard: String?
    var inspectedOpponent: PlayerId?
    var showLog = false
    var showRules = false
    var showSaves = false
    var showMenu = false
    var showDiscards = false
    /// The card another player just played, shown large for a moment.
    var spotlight: PlaySpotlight?
    var noStamp: JustSayNoStamp?
    /// Bumped each time the viewer completes a set, to start the celebration.
    var setBurstToken = 0
    var setBanner: String?
    /// A short explanation of why a tap didn't do anything.
    var notice: String?
    var coach: CoachHint?
    var shakeToken: CGFloat = 0
    var shakeCardId: String?

    func clearSelection() {
        selectedCardId = nil
        chooser = nil
        paymentCards = []
        forcedDealGive = nil
    }
}

/// Turns taps into game actions. Shared by every table panel.
@MainActor
struct TableActions {
    let session: any TableSession
    let ui: TableUI
    let confirmRisky: Bool
    let tapFeedback: () -> Void
    let errorFeedback: () -> Void

    /// Everything the hand card can do right now, in the order the rules list it.
    func options(forHandCard cardId: String) -> [CardOption] {
        session.legalActions.enumerated().compactMap { index, legal in
            guard Self.handCardId(legal.action) == cardId else { return nil }
            return CardOption(id: index, label: describe(legal), detail: legal.previewText, legal: legal)
        }
    }

    static func handCardId(_ action: Action) -> String? {
        switch action.type {
        case .play_to_bank, .play_property, .play_action, .discard_card, .repay_debt: action.cardId
        default: nil
        }
    }

    func moveOptions(forWild cardId: String) -> [CardOption] {
        session.legalActions.enumerated().compactMap { index, legal in
            guard legal.action.type == .move_wild, legal.action.cardId == cardId else { return nil }
            let target = legal.action.toColor?.label ?? "another color"
            let suffix = legal.action.setId?.contains("auto") == false ? " (new set)" : ""
            return CardOption(id: index, label: "Move to \(target)\(suffix)", detail: nil, legal: legal)
        }
    }

    /// A clearer label than the engine's, since the card is already on screen.
    func describe(_ legal: LegalAction) -> String {
        let action = legal.action
        let variant = session.variant
        switch action.type {
        case .play_to_bank:
            let value = action.cardId.map { Engine.cardMoneyValue($0, variant) } ?? 0
            return "Bank as $\(value)"
        case .play_property:
            let color = action.color?.label ?? ""
            if let cardId = action.cardId, Catalog.card(cardId, variant).kind == .building {
                return "Build on \(color)"
            }
            return "Play to \(color)"
        case .play_action:
            let target = action.targetPlayerId.map { session.playerName($0) }
            if let color = action.color, let target { return "Use on \(target) (\(color.label) rent)" }
            if let target { return "Use on \(target)" }
            if let color = action.color { return "Charge \(color.label) rent" }
            return "Play it"
        case .discard_card:
            return "Discard"
        case .repay_debt:
            let debts = session.viewer?.debts ?? []
            let creditor = debts.first { ($0.id ?? $0.chipId) == action.debtId }?.creditorPlayerId
            return "Repay \(session.playerName(creditor))"
        default:
            return legal.label
        }
    }

    private func restriction(for cardId: String) -> String? {
        guard let game = session.game, let viewerId = session.viewerId else { return nil }
        return Engine.playRestriction(game, playerId: viewerId, cardId: cardId)
    }

    func tapHandCard(_ cardId: String) {
        guard !session.isPaused else { return }
        let options = session.isViewersPrompt ? options(forHandCard: cardId) : []
        guard !options.isEmpty else {
            ui.shakeCardId = cardId
            ui.shakeToken += 1
            ui.notice = restriction(for: cardId)
            errorFeedback()
            return
        }
        tapFeedback()
        ui.selectedCardId = cardId
        let card = Catalog.card(cardId, session.variant)
        // One tap plays money and properties. Anything costlier to misplay, such as an
        // action card whose only option is the Bank, or a discard, always asks first.
        let oneTap = (card.kind == .money || card.kind == .property || card.kind == .wild)
            && options[0].legal.action.type != .discard_card
            && options[0].legal.action.type != .repay_debt
        if options.count == 1 && oneTap {
            run(options[0].legal)
        } else {
            ui.chooser = ChooserContent(cardId: cardId, title: card.kind == .money ? "$\(card.value)" : card.name, note: restriction(for: cardId), options: options)
        }
    }

    func tapBoardCard(_ cardId: String, in color: PropertyColor) {
        guard session.isViewersPrompt, !session.isPaused else { return }
        let options = moveOptions(forWild: cardId)
        if options.isEmpty {
            ui.inspectedCard = cardId
            return
        }
        tapFeedback()
        ui.chooser = ChooserContent(cardId: cardId, title: "Move Wild", options: options)
    }

    /// Runs an action, asking first if it's risky and the player wants to be asked.
    func run(_ legal: LegalAction) {
        if legal.requiresConfirmation == true && confirmRisky {
            ui.chooser = nil
            ui.confirmation = RiskyConfirmation(action: legal.action, label: legal.label, risk: legal.riskLevel ?? .medium, preview: legal.previewText ?? "This play can't be undone once it resolves.")
            return
        }
        perform(legal.action)
    }

    func perform(_ action: Action) {
        ui.clearSelection()
        ui.confirmation = nil
        session.perform(action)
    }
}
