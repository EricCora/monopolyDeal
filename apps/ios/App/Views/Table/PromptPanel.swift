import DealEngine
import SwiftUI

/// The floating panel for anything that interrupts normal play: paying, responding,
/// and choosing targets. Every case is built from the legal action list, and the last
/// case lists them plainly, so a player can never be stuck without a button.
struct PromptPanel: View {
    var session: any TableSession
    var actions: TableActions
    var ui: TableUI

    var body: some View {
        Group {
            if session.isViewersPrompt, !session.isPaused, case .counter(let request)? = session.game?.pending {
                CounterPanel(session: session, actions: actions, request: request)
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            } else if session.isViewersPrompt, !session.isPaused, let content = panelContent {
                VStack(spacing: 10) { content }
                    .padding(14)
                    .frame(maxWidth: 620)
                    .glassPanel(cornerRadius: 26, tint: Color.black.opacity(0.42))
                    .padding(.horizontal, 10)
                    .padding(.bottom, 6)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.snappy(duration: 0.32), value: session.prompt)
    }

    private var panelContent: AnyView? {
        guard let game = session.game else { return nil }
        switch game.pending {
        case .payment(let request):
            return AnyView(PaymentPanel(session: session, actions: actions, ui: ui, request: request))
        case .counter:
            return nil
        case .rent(let request):
            return AnyView(RentTargetPanel(session: session, actions: actions, request: request))
        case .slyDeal(let request):
            return AnyView(CardPickPanel(
                session: session,
                actions: actions,
                title: "Sly Deal",
                subtitle: "Take a property from \(session.playerName(request.targetPlayerId)).",
                groups: grouped { $0.type == .sly_deal_pick ? $0.cardId : nil }
            ))
        case .forcedDeal(let request):
            return AnyView(ForcedDealPanel(session: session, actions: actions, ui: ui, request: request))
        case .dealBreaker(let request):
            return AnyView(DealBreakerPanel(session: session, actions: actions, request: request))
        case .debtCard, .noMercy:
            return AnyView(noMercyContent(game))
        case nil:
            return nil
        }
    }

    /// Legal actions grouped by the card each one is about, keeping the engine's order.
    private func grouped(_ key: (Action) -> String?) -> [(cardId: String, legal: [LegalAction])] {
        var order: [String] = []
        var groups: [String: [LegalAction]] = [:]
        for legal in session.legalActions {
            guard let cardId = key(legal.action) else { continue }
            if groups[cardId] == nil { order.append(cardId) }
            groups[cardId, default: []].append(legal)
        }
        return order.map { ($0, groups[$0]!) }
    }

    @ViewBuilder
    private func noMercyContent(_ game: GameState) -> some View {
        if case .noMercy(let request) = game.pending {
            switch request.step {
            case "heist_pick":
                CardPickPanel(session: session, actions: actions, title: "Heist", subtitle: "Take a Bank card from \(session.playerName(request.targetPlayerId)).", groups: grouped { $0.cardId })
            case "market_crash_pick":
                CardPickPanel(session: session, actions: actions, title: "Market Crash", subtitle: "Take a property from \(session.playerName(request.targetPlayerId)).", groups: grouped { $0.cardId })
            case "repossession_keep":
                CardPickPanel(session: session, actions: actions, title: "Repossession", subtitle: "Choose the one property you keep. The rest go to other players.", groups: grouped { $0.cardId })
            case "tax_collector_keep":
                CardPickPanel(session: session, actions: actions, title: "Tax Collector", subtitle: "Choose the one Bank card you keep. The rest go to other players.", groups: grouped { $0.cardId })
            case "repossession_distribute", "tax_collector_distribute":
                DistributePanel(session: session, actions: actions, cardId: request.redistribution?.first?.cardId)
            case "tough_luck_choice":
                ChoiceListPanel(session: session, actions: actions, title: "Tough Luck", subtitle: "Choose which cards to take from \(session.playerName(request.targetPlayerId))'s hand.")
            default:
                ChoiceListPanel(session: session, actions: actions, title: "Your Move", subtitle: session.prompt?.text ?? "")
            }
        } else if case .debtCard(let request) = game.pending {
            VStack(spacing: 8) {
                PanelHeader(title: "Debt Repaid", subtitle: "\(session.playerName(request.debtorPlayerId)) gave you this card. Decide what to do with it.")
                CardView(cardId: request.cardId, variant: session.variant, width: 88)
                ChoiceListPanel(session: session, actions: actions, title: nil, subtitle: nil)
            }
        }
    }
}

struct PanelHeader: View {
    var title: String
    var subtitle: String

    var body: some View {
        VStack(spacing: 2) {
            Text(title)
                .font(.headline.weight(.heavy))
                .foregroundStyle(.white)
            Text(subtitle)
                .font(.footnote)
                .foregroundStyle(SoftWhite(0.78))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: Payment

private struct PaymentPanel: View {
    var session: any TableSession
    var actions: TableActions
    var ui: TableUI
    var request: PaymentRequest

    private var payer: PlayerState? { session.viewer }

    /// Bank first, then properties, without the cards No Mercy forbids as payment.
    private var payable: [String] {
        guard let payer else { return [] }
        let variant = session.variant
        let properties = PropertyColor.allCases.flatMap { payer.properties[$0].map(\.cardId) }
        return (payer.bank + properties).filter { !(variant == .no_mercy && Catalog.isEveryColorWild($0, variant)) }
    }

    private var selected: [String] { ui.paymentCards.filter { payable.contains($0) } }
    private func value(_ cards: [String]) -> Int { cards.reduce(0) { $0 + Engine.cardMoneyValue($1, session.variant) } }

    private var canSubmit: Bool {
        let available = value(payable)
        return available < request.amount
            ? value(selected) >= available
            : !selected.isEmpty && value(selected) >= request.amount
    }

    var body: some View {
        VStack(spacing: 10) {
            PanelHeader(title: "Pay \(session.playerName(request.sourcePlayerId)) $\(request.amount)", subtitle: displayText(reasonText))

            HStack {
                Text("Selected")
                    .font(.footnote.weight(.semibold))
                Text("$\(value(selected))")
                    .font(.title3.weight(.black))
                    .foregroundStyle(value(selected) >= request.amount ? Palette.success : Palette.gold)
                    .contentTransition(.numericText())
                Text("of $\(request.amount)")
                    .font(.footnote.weight(.semibold))
                Spacer()
                Button("Auto-Select") {
                    if let game = session.game {
                        withAnimation(.snappy) {
                            ui.paymentCards = Engine.suggestedPaymentCards(game, playerId: request.targetPlayerId, amount: request.amount)
                        }
                    }
                }
                .font(.footnote.weight(.bold))
                .buttonStyle(.glass)
                .accessibilityIdentifier("payment.auto")
            }
            .foregroundStyle(.white)

            if payable.isEmpty {
                Text("You have nothing to pay with.")
                    .font(.subheadline)
                    .foregroundStyle(SoftWhite(0.8))
                    .padding(.vertical, 8)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(payable.enumerated()), id: \.element) { index, cardId in
                            let isSelected = selected.contains(cardId)
                            Button {
                                withAnimation(.snappy(duration: 0.2)) {
                                    if isSelected {
                                        ui.paymentCards.removeAll { $0 == cardId }
                                    } else {
                                        ui.paymentCards.append(cardId)
                                    }
                                }
                                actions.tapFeedback()
                            } label: {
                                CardView(cardId: cardId, variant: session.variant, width: 78, assignedColor: session.assignedColor(of: cardId))
                                    .overlay {
                                        if isSelected {
                                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                                .strokeBorder(Palette.gold, lineWidth: 3)
                                        }
                                    }
                                    .overlay(alignment: .topTrailing) {
                                        if isSelected {
                                            Image(systemName: "checkmark.circle.fill")
                                                .symbolRenderingMode(.palette)
                                                .foregroundStyle(Palette.ink, Palette.gold)
                                                .font(.title3)
                                                .offset(x: 5, y: -5)
                                        }
                                    }
                                    .offset(y: isSelected ? -4 : 0)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("payment.card.\(index)")
                            .accessibilityAddTraits(isSelected ? .isSelected : [])
                        }
                    }
                    .padding(.top, 8)
                    .padding(.horizontal, 2)
                }
            }

            Button {
                let sorted = selected.sorted(by: paymentOrder)
                actions.perform(Action(.pay_request, playerId: request.targetPlayerId).setting(cards: sorted))
            } label: {
                Text(submitLabel)
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!canSubmit)
            .accessibilityIdentifier("payment.submit")
        }
    }

    private func paymentOrder(_ left: String, _ right: String) -> Bool {
        let delta = Engine.cardMoneyValue(left, session.variant) - Engine.cardMoneyValue(right, session.variant)
        return delta != 0 ? delta < 0 : left < right
    }

    private var reasonText: String {
        let shortfall = value(payable) < request.amount
        return shortfall ? "\(request.reason). You can't cover it, so everything you have goes." : request.reason
    }

    private var submitLabel: String {
        if payable.isEmpty { return "Pay Nothing" }
        return "Pay $\(value(selected))"
    }
}

extension Action {
    func setting(cards: [String]) -> Action {
        var copy = self
        copy.cards = cards
        return copy
    }
}

// MARK: Response

private struct CounterPanel: View {
    var session: any TableSession
    var actions: TableActions
    var request: CounterRequest

    private var justSayNo: LegalAction? {
        session.legalActions.first { $0.action.type == .counter_response && $0.action.useJustSayNo == true }
    }

    private var allow: LegalAction? {
        session.legalActions.first { $0.action.type == .counter_response && $0.action.useJustSayNo != true }
    }

    private var heading: String {
        let isCounter = !request.chain.isEmpty
        let source = session.playerName(isCounter ? request.chain.last?.playerId : request.sourcePlayerId)
        return isCounter ? "\(source) said Just Say No" : "\(source) played on you"
    }

    /// Something is being done to the viewer, so the card comes up large over a lightly
    /// dimmed table, which stays visible behind it, with the answers in a panel below.
    var body: some View {
        GeometryReader { geometry in
            let cardWidth = min(geometry.size.width * 0.62, geometry.size.height * 0.42 / CardView.aspect, 300)
            VStack(spacing: 14) {
                Spacer(minLength: 0)
                CardView(cardId: request.chain.last?.cardId ?? request.actionCardId, variant: session.variant, width: cardWidth)
                    .shadow(color: .black.opacity(0.55), radius: 24, y: 12)
                Spacer(minLength: 0)
                VStack(spacing: 10) {
                    VStack(spacing: 4) {
                        Text(heading)
                            .font(.title3.weight(.heavy))
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.center)
                        Text(detail)
                            .font(.subheadline)
                            .foregroundStyle(SoftWhite(0.82))
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)
                    if let justSayNo {
                        Button {
                            actions.perform(justSayNo.action)
                        } label: {
                            Label("Just Say No", systemImage: "hand.raised.fill")
                        }
                        .buttonStyle(PrimaryButtonStyle(tint: Palette.danger))
                        .accessibilityIdentifier("counter.jsn")
                    }
                    if let allow {
                        Button(request.chain.isEmpty ? "Accept" : "Let It Stand") {
                            actions.perform(allow.action)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("counter.allow")
                    }
                }
                .padding(14)
                .frame(maxWidth: 620)
                .glassPanel(cornerRadius: 26, tint: Color.black.opacity(0.42))
                .padding(.horizontal, 10)
                .padding(.bottom, 6)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(0.32).ignoresSafeArea())
        }
    }

    private var detail: String {
        switch request.effect {
        case .payment(let payment): return displayText("\(payment.reason): pay $\(payment.amount) unless you stop it.")
        case .slyDeal: return "They'll take one of your properties."
        case .forcedDeal: return "They'll swap a property with you."
        case .dealBreaker: return "They'll take a complete set."
        case .noMercy(let effect): return "\(Engine.cardLabel(effect.actionCardId, session.variant)) will affect you."
        case .rent: return "They'll choose who pays rent."
        }
    }
}

// MARK: Target choices

private struct RentTargetPanel: View {
    var session: any TableSession
    var actions: TableActions
    var request: PendingRent

    var body: some View {
        VStack(spacing: 10) {
            PanelHeader(title: "Charge $\(request.amount) rent", subtitle: "Choose who pays for your \(request.color.label) set.")
            ForEach(Array(session.legalActions.enumerated()), id: \.offset) { index, legal in
                Button {
                    actions.perform(legal.action)
                } label: {
                    VStack(spacing: 1) {
                        Text(session.playerName(legal.targetPlayerId))
                            .font(.headline.weight(.semibold))
                        if legal.requiresPropertyTransfer == true {
                            Text("Can only pay with property").font(.caption).opacity(0.75)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.glass)
                .accessibilityIdentifier("prompt.\(index)")
            }
        }
    }
}

/// Shows the available cards. If a card can go to more than one place, a chooser follows.
private struct CardPickPanel: View {
    var session: any TableSession
    var actions: TableActions
    var title: String
    var subtitle: String
    var groups: [(cardId: String, legal: [LegalAction])]

    var body: some View {
        VStack(spacing: 10) {
            PanelHeader(title: title, subtitle: subtitle)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(groups.enumerated()), id: \.element.cardId) { index, group in
                        Button {
                            pick(group.cardId, group.legal)
                        } label: {
                            CardView(cardId: group.cardId, variant: session.variant, width: 88, assignedColor: session.assignedColor(of: group.cardId))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("prompt.\(index)")
                    }
                }
                .padding(.horizontal, 2)
            }
        }
    }

    private func pick(_ cardId: String, _ legal: [LegalAction]) {
        actions.tapFeedback()
        if legal.count == 1 {
            actions.perform(legal[0].action)
            return
        }
        actions.ui.chooser = ChooserContent(
            cardId: cardId,
            title: Catalog.card(cardId, session.variant).name,
            note: nil,
            options: legal.enumerated().map { index, item in
                let destination = item.action.destinationColor?.label
                return CardOption(id: index, label: destination.map { "Put in \($0)" } ?? item.label, detail: nil, legal: item)
            }
        )
    }
}

private struct ForcedDealPanel: View {
    var session: any TableSession
    var actions: TableActions
    var ui: TableUI
    var request: PendingDeal

    private var picks: [LegalAction] { session.legalActions.filter { $0.action.type == .forced_deal_pick } }

    private var ownCards: [(id: String, color: PropertyColor)] {
        var seen = Set<String>()
        return picks.compactMap { legal in
            guard let id = legal.action.giveCardId, let color = legal.action.giveColor, seen.insert(id).inserted else { return nil }
            return (id, color)
        }
    }

    private var theirCards: [(id: String, color: PropertyColor)] {
        guard let give = ui.forcedDealGive else { return [] }
        var seen = Set<String>()
        return picks.compactMap { legal in
            guard legal.action.giveCardId == give.cardId,
                  let id = legal.action.takeCardId, let color = legal.action.takeColor,
                  seen.insert(id).inserted else { return nil }
            return (id, color)
        }
    }

    var body: some View {
        VStack(spacing: 8) {
            PanelHeader(title: "Forced Deal", subtitle: ui.forcedDealGive == nil
                ? "First, choose the property you'll give up."
                : "Now choose what to take from \(session.playerName(request.targetPlayerId)).")
            SectionTitle(text: "You give")
            row(ownCards, prefix: "give", selected: ui.forcedDealGive?.cardId) { card in
                actions.tapFeedback()
                withAnimation(.snappy(duration: 0.2)) {
                    ui.forcedDealGive = ui.forcedDealGive?.cardId == card.id ? nil : Engine.MovableCard(color: card.color, cardId: card.id, setId: nil)
                }
            }
            if ui.forcedDealGive != nil {
                SectionTitle(text: "You take")
                row(theirCards, prefix: "take", selected: nil) { card in
                    take(card)
                }
            }
        }
    }

    private func take(_ card: (id: String, color: PropertyColor)) {
        guard let give = ui.forcedDealGive else { return }
        let matches = picks.filter { $0.action.giveCardId == give.cardId && $0.action.takeCardId == card.id }
        if matches.count == 1 {
            actions.perform(matches[0].action)
        } else if !matches.isEmpty {
            ui.chooser = ChooserContent(
                cardId: card.id,
                title: Catalog.card(card.id, session.variant).name,
                note: nil,
                options: matches.enumerated().map { index, item in
                    CardOption(id: index, label: item.action.destinationColor.map { "Put in \($0.label)" } ?? item.label, detail: nil, legal: item)
                }
            )
        }
    }

    private func row(_ cards: [(id: String, color: PropertyColor)], prefix: String, selected: String?, onTap: @escaping ((id: String, color: PropertyColor)) -> Void) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                    Button {
                        onTap(card)
                    } label: {
                        CardView(cardId: card.id, variant: session.variant, width: 70, assignedColor: card.color)
                            .overlay {
                                if selected == card.id {
                                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                                        .strokeBorder(Palette.gold, lineWidth: 3)
                                }
                            }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("forced.\(prefix).\(index)")
                }
            }
            .padding(.horizontal, 2)
        }
    }
}

private struct DealBreakerPanel: View {
    var session: any TableSession
    var actions: TableActions
    var request: PendingDeal

    private var target: PlayerState? { session.game?.players.first { $0.id == request.targetPlayerId } }

    var body: some View {
        VStack(spacing: 10) {
            PanelHeader(title: "Deal Breaker", subtitle: "Take a complete set from \(session.playerName(request.targetPlayerId)).")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(Array(session.legalActions.enumerated()), id: \.offset) { index, legal in
                        if let target, let color = legal.action.color, let lane = BoardLane.lanes(for: target, variant: session.variant).first(where: { $0.color == color && $0.setId == legal.action.setId }) {
                            Button {
                                actions.perform(legal.action)
                            } label: {
                                SetLane(lane: lane, variant: session.variant, cardWidth: 58, space: nil) { _ in
                                    actions.perform(legal.action)
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("prompt.\(index)")
                        }
                    }
                }
            }
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct DistributePanel: View {
    var session: any TableSession
    var actions: TableActions
    var cardId: String?

    var body: some View {
        VStack(spacing: 10) {
            PanelHeader(title: "Give This Card Away", subtitle: "Choose who receives it.")
            if let cardId { CardView(cardId: cardId, variant: session.variant, width: 88) }
            ForEach(Array(session.legalActions.enumerated()), id: \.offset) { index, legal in
                Button(session.playerName(legal.action.recipientPlayerId)) {
                    actions.perform(legal.action)
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("prompt.\(index)")
            }
        }
    }
}

/// A plain list of whatever the rules allow. Also the fallback for anything unexpected.
private struct ChoiceListPanel: View {
    var session: any TableSession
    var actions: TableActions
    var title: String?
    var subtitle: String?

    var body: some View {
        VStack(spacing: 10) {
            if let title { PanelHeader(title: title, subtitle: subtitle ?? "") }
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(Array(session.legalActions.enumerated()), id: \.offset) { index, legal in
                        Button(legal.label) {
                            actions.perform(legal.action)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("prompt.\(index)")
                    }
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(height: min(CGFloat(session.legalActions.count) * 52, 280))
        }
    }
}
