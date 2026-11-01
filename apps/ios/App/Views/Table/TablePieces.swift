import DealEngine
import DealOnline
import DealStats
import SwiftUI

// MARK: Hand

/// The viewer's hand as an arc of cards. Cards overlap more as the hand grows, so it
/// always fits the screen. Tap to play, or drag a card up onto the table. Hold to spread
/// the hand and slide along it: the card under your finger lifts up, large enough to read.
struct HandFan: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var session: any TableSession
    var actions: TableActions
    var ui: TableUI
    var cardWidth: CGFloat
    var space: Namespace.ID

    var animatesDeal = true

    @State private var dragging: String?
    @State private var dragOffset: CGSize = .zero
    /// While the opening hand is being dealt, how many cards have landed so far.
    @State private var dealtCount: Int?
    /// The card the current touch started on.
    @State private var touchedCard: String?
    @State private var holdTask: Task<Void, Never>?
    @State private var isFanned = false
    @State private var focusedCard: String?

    private static let holdDelay: Duration = .milliseconds(220)
    private static let moveTolerance: CGFloat = 12
    private static let focusScale: CGFloat = 1.5

    private var allCards: [String] { session.viewer?.hand ?? [] }
    private var cards: [String] { dealtCount.map { Array(allCards.prefix($0)) } ?? allCards }

    /// Where each card's center sits. A held hand spreads as wide as the screen allows.
    private func centers(width: CGFloat) -> [CGFloat] {
        let count = cards.count
        // The outer cards tilt, so they need some margin to stay on screen.
        let available = width - cardWidth - (isFanned ? 12 : 34)
        let spacing = count > 1 ? min(cardWidth * (isFanned ? 0.95 : 0.8), available / CGFloat(count - 1)) : 0
        let total = spacing * CGFloat(max(count - 1, 0))
        return (0..<count).map { (width - total) / 2 + CGFloat($0) * spacing }
    }

    /// The topmost card under a touch. Later cards overlap earlier ones.
    private func cardIndex(atX x: CGFloat, width: CGFloat) -> Int? {
        let positions = centers(width: width)
        return positions.indices.last { abs(positions[$0] - x) <= cardWidth / 2 }
    }

    /// While the hand is held, every point along it belongs to the nearest card.
    private func nearestCard(toX x: CGFloat, width: CGFloat) -> String? {
        let positions = centers(width: width)
        return positions.indices.min { abs(positions[$0] - x) < abs(positions[$1] - x) }.map { cards[$0] }
    }

    var body: some View {
        // Worked out once per draw: comparing every card to every legal action is costly
        // when a Forced Deal offers hundreds of them.
        let playable = session.isViewersPrompt
            ? Set(session.legalActions.compactMap { TableActions.handCardId($0.action) })
            : Set<String>()
        GeometryReader { geometry in
            let width = geometry.size.width
            let positions = centers(width: width)
            ZStack(alignment: .bottomLeading) {
                ForEach(Array(cards.enumerated()), id: \.element) { index, cardId in
                    handCard(cardId, index: index, count: cards.count, playable: playable.contains(cardId))
                        .position(
                            x: cardX(cardId, center: positions[index], width: width),
                            y: geometry.size.height - cardWidth * CardView.aspect / 2
                        )
                }
            }
            .frame(width: width, height: geometry.size.height)
            .contentShape(Rectangle())
            .gesture(handGesture(width: width, playable: playable))
        }
        .frame(height: cardWidth * CardView.aspect + 8)
        .accessibilityElement(children: .contain)
        .sensoryFeedback(.selection, trigger: focusedCard) { _, new in
            new != nil && app.preferences.hapticsEnabled
        }
        .task(id: session.viewerId) { await dealOpeningHand() }
        .onChange(of: session.viewerId) { endHold() }
    }

    /// Keeps the enlarged card on screen at either end of the hand.
    private func cardX(_ cardId: String, center: CGFloat, width: CGFloat) -> CGFloat {
        guard focusedCard == cardId else { return center }
        let half = cardWidth * Self.focusScale / 2 + 6
        return min(max(center, half), max(half, width - half))
    }

    /// One gesture covers the whole hand, so a held finger can slide from card to card.
    private func handGesture(width: CGFloat, playable: Set<String>) -> some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { value in
                if touchedCard == nil, holdTask == nil {
                    touchedCard = cardIndex(atX: value.startLocation.x, width: width).map { cards[$0] }
                    let startX = value.startLocation.x
                    holdTask = Task {
                        try? await Task.sleep(for: Self.holdDelay)
                        if !Task.isCancelled { beginHold(atX: startX, width: width) }
                    }
                }
                if isFanned {
                    let next = nearestCard(toX: value.location.x, width: width)
                    if next != focusedCard {
                        withAnimation(.snappy(duration: 0.16)) { focusedCard = next }
                    }
                    return
                }
                let distance = hypot(value.translation.width, value.translation.height)
                guard distance > Self.moveTolerance else { return }
                holdTask?.cancel()
                if let touchedCard, playable.contains(touchedCard) {
                    dragging = touchedCard
                    dragOffset = value.translation
                }
            }
            .onEnded { value in
                holdTask?.cancel()
                holdTask = nil
                let card = touchedCard
                touchedCard = nil
                if isFanned {
                    endHold()
                    return
                }
                let distance = hypot(value.translation.width, value.translation.height)
                let released = dragging != nil && value.translation.height < -90
                withAnimation(.snappy(duration: 0.28)) {
                    dragging = nil
                    dragOffset = .zero
                }
                if let card, released || distance <= Self.moveTolerance {
                    actions.tapHandCard(card)
                }
            }
    }

    private func beginHold(atX x: CGFloat, width: CGFloat) {
        guard !cards.isEmpty else { return }
        let animation: Animation = reduceMotion ? .easeOut(duration: 0.12) : .snappy(duration: 0.24)
        withAnimation(animation) { isFanned = true }
        withAnimation(animation) { focusedCard = nearestCard(toX: x, width: width) }
    }

    private func endHold() {
        holdTask?.cancel()
        holdTask = nil
        touchedCard = nil
        withAnimation(reduceMotion ? .easeOut(duration: 0.12) : .snappy(duration: 0.26)) {
            isFanned = false
            focusedCard = nil
        }
    }

    /// Deals a new game's first hand one card at a time.
    private func dealOpeningHand() async {
        guard animatesDeal, session.game?.history.isEmpty == true, !allCards.isEmpty else {
            dealtCount = nil
            return
        }
        dealtCount = 0
        for index in 1...allCards.count {
            try? await Task.sleep(for: .milliseconds(95))
            if Task.isCancelled { break }
            withAnimation(.snappy(duration: 0.34)) { dealtCount = index }
        }
        dealtCount = nil
    }

    @ViewBuilder
    private func handCard(_ cardId: String, index: Int, count: Int, playable: Bool) -> some View {
        let middle = CGFloat(count - 1) / 2
        let offsetFromMiddle = CGFloat(index) - middle
        let maxTilt: CGFloat = isFanned ? 1.2 : (count > 7 ? 2.2 : 3.2)
        let selected = ui.selectedCardId == cardId
        let isDragging = dragging == cardId
        let isFocused = focusedCard == cardId
        CardView(cardId: cardId, variant: session.variant, width: cardWidth)
            .matchedGeometryEffect(id: cardId, in: space)
            .shadow(color: .black.opacity(isFocused ? 0.55 : 0.35), radius: isFocused ? 16 : (selected ? 9 : 4), y: isFocused ? 10 : (selected ? 6 : 2))
            .overlay {
                if playable {
                    RoundedRectangle(cornerRadius: cardWidth * 0.09, style: .continuous)
                        .strokeBorder(Palette.gold.opacity(0.9), lineWidth: 1.5)
                }
            }
            .saturation(session.isViewersPrompt && !playable && !isFocused ? 0.75 : 1)
            .scaleEffect(isFocused ? Self.focusScale : 1, anchor: .bottom)
            .rotationEffect(.degrees(isDragging || isFocused ? 0 : offsetFromMiddle * maxTilt), anchor: .bottom)
            .offset(
                x: isDragging ? dragOffset.width : 0,
                y: (isDragging ? dragOffset.height : 0)
                    + (selected && !isFanned ? -24 : 0)
                    + (isFocused ? -18 : (isFanned ? -6 : abs(offsetFromMiddle) * abs(offsetFromMiddle) * 0.7))
            )
            .modifier(ShakeEffect(animatableData: ui.shakeCardId == cardId ? ui.shakeToken : 0))
            .zIndex(isFocused ? 200 : (isDragging || selected ? 100 : Double(index)))
            .transition(.asymmetric(
                insertion: .offset(x: 120, y: -360).combined(with: .scale(scale: 0.4)).combined(with: .opacity),
                removal: .opacity
            ))
            .animation(.snappy(duration: 0.28), value: selected)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("hand.\(index)")
            .accessibilityValue(playable ? "playable" : "")
            .accessibilityAddTraits(playable ? .isButton : [])
            .accessibilityAction { actions.tapHandCard(cardId) }
            .accessibilityAction(named: "View Card") { ui.inspectedCard = cardId }
    }
}

// MARK: Player board

/// The viewer's Bank and property sets. Complete sets get a gold outline.
struct PlayerBoard: View {
    var player: PlayerState
    var session: any TableSession
    var actions: TableActions
    var cardWidth: CGFloat
    var space: Namespace.ID

    var body: some View {
        let lanes = BoardLane.lanes(for: player, variant: session.variant)
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(player.name)
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(.white)
                Spacer()
                SetCountBadge(count: Engine.countCompleteSets(player, session.variant), needed: session.game.map { Engine.ruleset($0).winCompleteSets } ?? 3)
                if session.variant == .no_mercy { DebtBadge(player: player) }
            }
            ScrollView([.horizontal, .vertical], showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    BankStack(cards: player.bank, variant: session.variant, cardWidth: cardWidth, space: space, onTap: { actions.ui.inspectedCard = $0 })
                    ForEach(lanes, id: \.id) { lane in
                        SetLane(lane: lane, variant: session.variant, cardWidth: cardWidth, space: space) { cardId in
                            actions.tapBoardCard(cardId, in: lane.color)
                        }
                    }
                }
                .padding(.vertical, 4)
                .padding(.horizontal, 2)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .overlay {
                if lanes.isEmpty && player.bank.isEmpty {
                    Text("Your Bank and properties go here.")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.white.opacity(0.45))
                        .allowsHitTesting(false)
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .scrollBounceBehavior(.basedOnSize)
        }
        .padding(10)
        .frame(maxHeight: .infinity, alignment: .top)
        .glassPanel(cornerRadius: 18)
    }
}

struct BoardLane: Identifiable, Hashable {
    var id: String { "\(color.rawValue)-\(setId)" }
    var color: PropertyColor
    var setId: String
    var entries: [PropertyCardPlacement]
    var isComplete: Bool

    static func lanes(for player: PlayerState, variant: GameVariant) -> [BoardLane] {
        PropertyColor.allCases.flatMap { color in
            Engine.propertySets(player, color, variant).map { set in
                BoardLane(color: color, setId: set.setId, entries: set.entries, isComplete: Engine.isCompletePropertySet(set.entries, color, variant))
            }
        }
    }
}

struct SetLane: View {
    var lane: BoardLane
    var variant: GameVariant
    var cardWidth: CGFloat
    var space: Namespace.ID?
    var onTap: (String) -> Void

    var body: some View {
        let reveal = cardWidth * 0.46
        let height = cardWidth * CardView.aspect + reveal * CGFloat(max(lane.entries.count - 1, 0))
        VStack(spacing: 4) {
            ZStack(alignment: .top) {
                ForEach(Array(lane.entries.enumerated()), id: \.element.cardId) { index, entry in
                    card(entry)
                        .offset(y: CGFloat(index) * reveal)
                        .zIndex(Double(index))
                }
            }
            .frame(width: cardWidth, height: height, alignment: .top)
            .padding(3)
            .background(
                RoundedRectangle(cornerRadius: cardWidth * 0.14, style: .continuous)
                    .strokeBorder(lane.isComplete ? Palette.gold : .white.opacity(0.14), lineWidth: lane.isComplete ? 2 : 1)
            )
            .shadow(color: lane.isComplete ? Palette.gold.opacity(0.55) : .clear, radius: 7)

            Text(lane.isComplete ? "Complete" : "\(lane.entries.filter(isProperty).count)/\(lane.color.setSize)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(lane.isComplete ? Palette.gold : .white.opacity(0.7))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(lane.color.label) set, \(lane.isComplete ? "complete" : "incomplete")")
    }

    private func isProperty(_ entry: PropertyCardPlacement) -> Bool {
        let kind = Catalog.lookup(entry.cardId, variant)?.kind
        return kind == .property || kind == .wild
    }

    @ViewBuilder
    private func card(_ entry: PropertyCardPlacement) -> some View {
        let view = CardView(cardId: entry.cardId, variant: variant, width: cardWidth, assignedColor: entry.assignedColor)
            .shadow(color: .black.opacity(0.28), radius: 2, y: 1)
            .onTapGesture { onTap(entry.cardId) }
        if let space {
            view.matchedGeometryEffect(id: entry.cardId, in: space)
        } else {
            view
        }
    }
}

struct BankStack: View {
    var cards: [String]
    var variant: GameVariant
    var cardWidth: CGFloat
    var space: Namespace.ID?
    var onTap: (String) -> Void

    private var total: Int { cards.reduce(0) { $0 + Engine.cardMoneyValue($1, variant) } }

    /// Only the newest cards are drawn, so a rich Bank doesn't crowd out the sets beside it.
    private var visibleCards: [String] { Array(cards.suffix(5)) }
    private static let overlap: CGFloat = 7

    var body: some View {
        VStack(spacing: 4) {
            ZStack(alignment: .topLeading) {
                RoundedRectangle(cornerRadius: cardWidth * 0.09, style: .continuous)
                    .strokeBorder(.white.opacity(0.18), style: StrokeStyle(lineWidth: 1, dash: [4]))
                    .frame(width: cardWidth, height: cardWidth * CardView.aspect)
                    .overlay {
                        if cards.isEmpty {
                            Image(systemName: "banknote")
                                .foregroundStyle(.white.opacity(0.4))
                        }
                    }
                ForEach(Array(visibleCards.enumerated()), id: \.element) { index, cardId in
                    card(cardId)
                        .offset(x: CGFloat(index) * Self.overlap)
                        .zIndex(Double(index))
                }
            }
            .frame(width: cardWidth + Self.overlap * CGFloat(max(visibleCards.count - 1, 0)), alignment: .topLeading)
            Text("Bank $\(total)")
                .font(.caption2.weight(.bold))
                .foregroundStyle(.white.opacity(0.85))
                .contentTransition(.numericText())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Bank, \(total) dollars")
    }

    @ViewBuilder
    private func card(_ cardId: String) -> some View {
        let view = CardView(cardId: cardId, variant: variant, width: cardWidth)
            .shadow(color: .black.opacity(0.25), radius: 1.5, y: 1)
            .onTapGesture { onTap(cardId) }
        if let space {
            view.matchedGeometryEffect(id: cardId, in: space)
        } else {
            view
        }
    }
}

struct SetCountBadge: View {
    var count: Int
    var needed: Int

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<max(needed, 1), id: \.self) { index in
                Image(systemName: index < count ? "star.fill" : "star")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(index < count ? Palette.gold : .white.opacity(0.4))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) of \(needed) sets complete")
    }
}

struct DebtBadge: View {
    var player: PlayerState

    var body: some View {
        let owed = player.debts?.count ?? 0
        Label("\(owed)", systemImage: "creditcard.fill")
            .font(.caption2.weight(.heavy))
            .foregroundStyle(owed > 0 ? Palette.danger : .white.opacity(0.55))
            .accessibilityLabel("\(owed) debts owed")
    }
}

// MARK: Opponents

/// A compact summary for each other player. Tap one to see their whole board.
struct OpponentColumn: View {
    var session: any TableSession
    var ui: TableUI
    var wide: Bool

    /// Taller phones have room to show each opponent's cards on the table.
    var showsBoards = true

    private var opponents: [PlayerState] { session.game?.players.filter { $0.id != session.viewerId } ?? [] }

    var body: some View {
        if wide {
            ScrollView(showsIndicators: false) {
                VStack(spacing: 8) {
                    ForEach(opponents, id: \.id) { summary($0, showBoard: true) }
                }
            }
        } else if opponents.count <= 2 {
            VStack(spacing: 8) {
                ForEach(opponents, id: \.id) { summary($0, showBoard: showsBoards).frame(maxWidth: .infinity) }
            }
        } else if showsBoards {
            // Room for everyone at once, so the player who's up is never scrolled away.
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible())], spacing: 8) {
                ForEach(opponents, id: \.id) { summary($0, showBoard: false) }
            }
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(opponents, id: \.id) { summary($0, showBoard: false).frame(width: 178) }
                }
            }
        }
    }

    private func summary(_ player: PlayerState, showBoard: Bool) -> some View {
        OpponentSummary(
            player: player,
            showBoard: showBoard,
            variant: session.variant,
            isPrompted: session.prompt?.playerId == player.id,
            isCurrent: session.game.map { $0.players[$0.currentPlayerIndex].id == player.id } ?? false,
            needed: session.game.map { Engine.ruleset($0).winCompleteSets } ?? 3,
            connection: (session as? OnlineMatch)?.view?.players.first { $0.id == player.id }
        ) {
            ui.inspectedOpponent = player.id
        }
    }
}

struct OpponentSummary: View {
    var player: PlayerState
    var showBoard = false
    var variant: GameVariant
    var isPrompted: Bool
    var isCurrent: Bool
    var needed: Int
    var connection: RoomPlayer?
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    PlayerAvatar(name: player.name, isBot: player.controller == .bot)
                    Text(player.name)
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    if let connection, !connection.connected {
                        Image(systemName: "wifi.slash")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Palette.danger)
                            .accessibilityLabel("Disconnected")
                    }
                    Spacer(minLength: 0)
                    SetCountBadge(count: Engine.countCompleteSets(player, variant), needed: needed)
                }
                HStack(spacing: 10) {
                    Label("\(player.hand.count)", systemImage: "rectangle.portrait.on.rectangle.portrait.fill")
                    Label("$\(Engine.totalBankValue(player, variant))", systemImage: "banknote.fill")
                    if variant == .no_mercy { DebtBadge(player: player) }
                    Spacer(minLength: 0)
                }
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white.opacity(0.8))
                if showBoard && hasCardsOnTable {
                    MiniBoard(player: player, variant: variant)
                } else {
                    SetProgressBar(player: player, variant: variant)
                }
            }
            .padding(9)
            .glassEffect(
                isPrompted ? .regular.tint(Palette.gold.opacity(0.28)) : .regular,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isCurrent ? Palette.gold.opacity(0.85) : .clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(player.name), \(player.hand.count) cards in hand, Bank \(Engine.totalBankValue(player, variant)) dollars")
        .accessibilityHint("Shows their whole board")
    }
}

extension OpponentSummary {
    fileprivate var hasCardsOnTable: Bool {
        !player.bank.isEmpty || PropertyColor.allCases.contains { !player.properties[$0].isEmpty }
    }
}

/// An opponent's sets and Bank at a glance, small enough to sit in their panel.
struct MiniBoard: View {
    var player: PlayerState
    var variant: GameVariant

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 8) {
                ForEach(BoardLane.lanes(for: player, variant: variant)) { lane in
                    ZStack(alignment: .top) {
                        ForEach(Array(lane.entries.enumerated()), id: \.element.cardId) { index, entry in
                            CardView(cardId: entry.cardId, variant: variant, width: 40, assignedColor: entry.assignedColor)
                                .offset(y: CGFloat(index) * 13)
                        }
                    }
                    .frame(width: 40, height: 56 + 13 * CGFloat(max(lane.entries.count - 1, 0)), alignment: .top)
                    .padding(2)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .strokeBorder(lane.isComplete ? Palette.gold : .clear, lineWidth: 1.5)
                    )
                }
                if !player.bank.isEmpty {
                    ZStack(alignment: .topLeading) {
                        ForEach(Array(player.bank.suffix(4).enumerated()), id: \.element) { index, cardId in
                            CardView(cardId: cardId, variant: variant, width: 40)
                                .offset(x: CGFloat(index) * 4, y: CGFloat(index) * 2)
                        }
                    }
                    .frame(width: 54, height: 62, alignment: .topLeading)
                    .padding(.vertical, 2)
                }
            }
        }
        .scrollDisabled(false)
    }
}

/// A row of small color tiles showing how close each color is to complete.
struct SetProgressBar: View {
    var player: PlayerState
    var variant: GameVariant

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(PropertyColor.allCases, id: \.self) { color in
                let sets = Engine.propertySets(player, color, variant)
                let best = sets.map { set in
                    set.entries.filter {
                        let kind = Catalog.lookup($0.cardId, variant)?.kind
                        return kind == .property || kind == .wild
                    }.count
                }.max() ?? 0
                let complete = Engine.isCompleteSet(player, color, setId: nil, variant)
                ZStack(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2).fill(color.tint.opacity(0.18))
                    GeometryReader { proxy in
                        RoundedRectangle(cornerRadius: 2)
                            .fill(color.tint)
                            .frame(width: proxy.size.width * min(1, CGFloat(best) / CGFloat(color.setSize)))
                    }
                    if complete {
                        RoundedRectangle(cornerRadius: 2).strokeBorder(Palette.gold, lineWidth: 1)
                    }
                }
                .frame(height: 7)
            }
        }
        .accessibilityHidden(true)
    }
}

struct PlayerAvatar: View {
    var name: String
    var isBot: Bool

    private var tint: Color {
        let colors: [Color] = [Color(hex: 0xE5484D), Color(hex: 0x3B82F6), Color(hex: 0x30B47F), Color(hex: 0xF59E0B), Color(hex: 0xA855F7)]
        return colors[name.unicodeScalars.reduce(0) { $0 + Int($1.value) } % colors.count]
    }

    var body: some View {
        ZStack {
            Circle().fill(tint)
            if isBot {
                Image(systemName: "cpu.fill")
                    .font(.system(size: 10, weight: .bold))
            } else {
                Text(String(name.prefix(1)).uppercased())
                    .font(.system(size: 11, weight: .black, design: .rounded))
            }
        }
        .foregroundStyle(.white)
        .frame(width: 22, height: 22)
        .accessibilityHidden(true)
    }
}

// MARK: Sheets

struct OpponentBoardSheet: View {
    var player: PlayerState
    var session: any TableSession

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                PlayerAvatar(name: player.name, isBot: player.controller == .bot)
                Text(player.name).font(.title3.weight(.bold))
                Spacer()
                Label("\(player.hand.count) in hand", systemImage: "rectangle.portrait.on.rectangle.portrait.fill")
                    .font(.footnote.weight(.semibold))
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    SectionTitle(text: "Bank")
                    BankStack(cards: player.bank, variant: session.variant, cardWidth: 72, space: nil) { _ in }
                    SectionTitle(text: "Properties")
                    let lanes = BoardLane.lanes(for: player, variant: session.variant)
                    if lanes.isEmpty {
                        Text("No properties yet.").foregroundStyle(.secondary)
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(alignment: .top, spacing: 10) {
                            ForEach(lanes) { lane in
                                SetLane(lane: lane, variant: session.variant, cardWidth: 78, space: nil) { _ in }
                            }
                        }
                    }
                }
            }
        }
        .padding(20)
    }
}

struct ChooserSheet: View {
    var content: ChooserContent
    var variant: GameVariant
    var onChoose: (CardOption) -> Void

    var body: some View {
        VStack(spacing: 14) {
            CardView(cardId: content.cardId, variant: variant, width: 124)
                .shadow(radius: 8, y: 4)
                .padding(.top, 18)
            Text(content.title)
                .font(.title3.weight(.bold))
            ScrollView {
                VStack(spacing: 8) {
                    ForEach(Array(content.options.enumerated()), id: \.element.id) { index, option in
                        Button {
                            onChoose(option)
                        } label: {
                            VStack(spacing: 2) {
                                Text(option.label)
                                    .font(.headline.weight(.semibold))
                                if let detail = option.detail {
                                    Text(detail).font(.caption).opacity(0.72)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .padding(.vertical, 2)
                        }
                        .buttonStyle(.glass)
                        .accessibilityIdentifier("chooser.\(index)")
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }
}

struct CardInspector: View {
    var cardId: String
    var variant: GameVariant

    var body: some View {
        VStack(spacing: 16) {
            CardView(cardId: cardId, variant: variant, width: 190)
                .shadow(radius: 12, y: 6)
            if let card = Catalog.lookup(cardId, variant), card.kind == .action || card.kind == .building {
                Text(CardText.summary(card))
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 30)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Everything played so far, newest first.
struct DiscardBrowser: View {
    var cards: [String]
    var variant: GameVariant

    var body: some View {
        VStack(spacing: 14) {
            Text("Discard Pile")
                .font(.headline.weight(.bold))
                .padding(.top, 18)
            Text("\(cards.count) \(cards.count == 1 ? "card" : "cards"), newest first")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if cards.isEmpty {
                ContentUnavailableView("Nothing Yet", systemImage: "tray", description: Text("Cards played as actions and discards land here."))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(Array(cards.reversed().enumerated()), id: \.element) { _, cardId in
                            CardView(cardId: cardId, variant: variant, width: 132)
                                .shadow(radius: 4, y: 2)
                        }
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 8)
                }
            }
            Spacer(minLength: 0)
        }
        .accessibilityIdentifier("discard.browser")
    }
}

/// The card another player just played, large enough to read across the table.
struct PlaySpotlightView: View {
    var spotlight: PlaySpotlight
    var variant: GameVariant
    var width: CGFloat

    var body: some View {
        VStack(spacing: 10) {
            Text("\(spotlight.playerName) played")
                .font(.subheadline.weight(.heavy))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .glassEffect(.regular, in: Capsule())
            CardView(cardId: spotlight.cardId, variant: variant, width: width)
                .shadow(color: .black.opacity(0.55), radius: 22, y: 12)
        }
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("table.spotlight")
    }
}

struct EventLogSheet: View {
    var events: [GameEvent]

    var body: some View {
        NavigationStack {
            List(Array(events.enumerated().reversed()), id: \.offset) { _, event in
                Text(displayText(event.message))
                    .font(.subheadline)
                    .listRowBackground(Color.clear)
            }
            .scrollContentBackground(.hidden)
            .overlay {
                if events.isEmpty {
                    ContentUnavailableView("Nothing yet", systemImage: "list.bullet", description: Text("Moves appear here as they happen."))
                }
            }
            .navigationTitle("Game Log")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
