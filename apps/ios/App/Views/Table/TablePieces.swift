import DealEngine
import DealOnline
import DealStats
import SwiftUI
import UIKit

// MARK: Hand

/// Reports touches on the hand the moment they happen. SwiftUI's own drag gesture was
/// measured on an iPhone delivering a resting finger about 700 ms late, which made holding
/// feel broken. A UIKit recognizer sees the touch directly.
struct HandTouch: UIGestureRecognizerRepresentable {
    enum Phase { case began, moved, ended, cancelled }

    var onChange: (Phase, CGPoint) -> Void

    func makeUIGestureRecognizer(context: Context) -> Recognizer {
        let recognizer = Recognizer()
        recognizer.cancelsTouchesInView = false
        recognizer.delaysTouchesBegan = false
        recognizer.delaysTouchesEnded = false
        return recognizer
    }

    func handleUIGestureRecognizerAction(_ recognizer: Recognizer, context: Context) {
        let location = context.converter.localLocation
        switch recognizer.state {
        case .began: onChange(.began, location)
        case .changed: onChange(.moved, location)
        case .ended: onChange(.ended, location)
        case .cancelled, .failed: onChange(.cancelled, location)
        default: break
        }
    }

    final class Recognizer: UIGestureRecognizer {
        override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
            guard state == .possible, let touch = touches.first else {
                touches.forEach { ignore($0, for: event) }
                return
            }
            state = .began
        }

        override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) { state = .changed }
        override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) { state = .ended }
        override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) { state = .cancelled }
    }
}

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
    /// How far the outer cards drop, for the arc.
    var arc: CGFloat = 0.7

    @State private var dragging: String?
    @State private var dragOffset: CGSize = .zero
    /// While the opening hand is being dealt, how many cards have landed so far.
    @State private var dealtCount: Int?
    /// The card the current touch started on.
    @State private var touchedCard: String?
    @State private var touchStartTime: CFTimeInterval = 0
    @State private var touchStartLocation: CGPoint = .zero
    @State private var holdTask: Task<Void, Never>?
    @State private var isFanned = false
    @State private var focusedCard: String?

    /// How soon the hand starts to spread, and how long a touch can last and still count as
    /// a tap. Spreading starts well before a tap has ended, so it feels immediate.
    private static let holdDelay: Duration = .milliseconds(60)
    private static let tapWindow: TimeInterval = 0.25
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
            .gesture(HandTouch { phase, location in
                handleTouch(phase, at: location, width: width, playable: playable)
            })
        }
        .frame(height: cardWidth * CardView.aspect + 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("table.hand")
        // Only when sliding between cards, so a plain tap doesn't buzz twice.
        .sensoryFeedback(.selection, trigger: focusedCard) { old, new in
            old != nil && new != nil && app.preferences.hapticsEnabled
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

    /// One recognizer covers the whole hand, so a held finger can slide from card to card.
    private func handleTouch(_ phase: HandTouch.Phase, at location: CGPoint, width: CGFloat, playable: Set<String>) {
        let translation = CGSize(width: location.x - touchStartLocation.x, height: location.y - touchStartLocation.y)
        let distance = hypot(translation.width, translation.height)
        switch phase {
        case .began:
            touchStartLocation = location
            touchStartTime = CACurrentMediaTime()
            touchedCard = cardIndex(atX: location.x, width: width).map { cards[$0] }
            holdTask?.cancel()
            holdTask = Task {
                try? await Task.sleep(for: Self.holdDelay)
                if !Task.isCancelled { beginHold(atX: location.x, width: width) }
            }
        case .moved:
            if isFanned {
                let next = nearestCard(toX: location.x, width: width)
                if next != focusedCard {
                    withAnimation(.snappy(duration: 0.16)) { focusedCard = next }
                }
                return
            }
            guard distance > Self.moveTolerance else { return }
            holdTask?.cancel()
            if let touchedCard, playable.contains(touchedCard) {
                dragging = touchedCard
                dragOffset = translation
            }
        case .ended:
            holdTask?.cancel()
            holdTask = nil
            let card = touchedCard
            touchedCard = nil
            if isFanned {
                endHold()
                let wasTap = CACurrentMediaTime() - touchStartTime < Self.tapWindow && distance <= Self.moveTolerance
                if wasTap, let card { actions.tapHandCard(card) }
                return
            }
            let released = dragging != nil && translation.height < -90
            withAnimation(.snappy(duration: 0.28)) {
                dragging = nil
                dragOffset = .zero
            }
            if let card, released || distance <= Self.moveTolerance {
                actions.tapHandCard(card)
            }
        case .cancelled:
            withAnimation(.snappy(duration: 0.28)) {
                dragging = nil
                dragOffset = .zero
            }
            endHold()
        }
    }

    private func beginHold(atX x: CGFloat, width: CGFloat) {
        guard !cards.isEmpty else { return }
        let animation: Animation = reduceMotion ? .easeOut(duration: 0.1) : .snappy(duration: 0.16)
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
                    + (isFocused ? -18 : (isFanned ? -6 : abs(offsetFromMiddle) * abs(offsetFromMiddle) * arc))
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
            ScrollView(.vertical, showsIndicators: false) {
                TableFlow(spacing: 10) {
                    BankStack(cards: player.bank, variant: session.variant, cardWidth: cardWidth, space: space, onTap: { _ in actions.ui.showBank = true })
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
                        .foregroundStyle(.white)
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

            Text(laneStatus)
                .font(.caption2.weight(.bold))
                .foregroundStyle(lane.isComplete ? Palette.gold : .white.opacity(0.7))
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(lane.color.label) set, \(lane.isComplete ? "complete" : "incomplete")")
    }

    /// A full lane of Wilds can still be incomplete, so "2/2" alone would look like a bug.
    private var laneStatus: String {
        if lane.isComplete { return "Complete" }
        let count = lane.entries.filter(isProperty).count
        return count >= lane.color.setSize ? "Needs a \(lane.color.label)" : "\(count)/\(lane.color.setSize)"
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

/// Lays piles out in rows, so the table fills its space before anything needs scrolling.
struct TableFlow: Layout {
    var spacing: CGFloat

    private func rows(_ subviews: Subviews, width: CGFloat) -> [[(index: Int, size: CGSize)]] {
        var rows: [[(index: Int, size: CGSize)]] = [[]]
        var used: CGFloat = 0
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            if !rows[rows.count - 1].isEmpty && used + spacing + size.width > width {
                rows.append([])
                used = 0
            }
            used += (rows[rows.count - 1].isEmpty ? 0 : spacing) + size.width
            rows[rows.count - 1].append((index, size))
        }
        return rows
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(subviews, width: width)
        let height = rows.reduce(0) { $0 + ($1.map(\.size.height).max() ?? 0) } + spacing * CGFloat(max(rows.count - 1, 0))
        let widest = rows.map { row in row.reduce(0) { $0 + $1.size.width } + spacing * CGFloat(max(row.count - 1, 0)) }.max() ?? 0
        return CGSize(width: proposal.width ?? widest, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews, width: bounds.width) {
            var x = bounds.minX
            for item in row {
                subviews[item.index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += (row.map(\.size.height).max() ?? 0) + spacing
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
                                .foregroundStyle(SoftWhite(0.4))
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
                .foregroundStyle(.white)
                .contentTransition(.numericText())
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Bank, \(total) dollars")
    }

    @ViewBuilder
    private func card(_ cardId: String) -> some View {
        let view = CardView(cardId: cardId, variant: variant, width: cardWidth, edgeOnly: cardId != visibleCards.last)
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
        .accessibilityAddTraits(.isStaticText)
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
            connection: (session as? OnlineMatch)?.view?.players.first { $0.id == player.id },
            botPlaying: session.botSeatIds.contains(player.id)
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
    var botPlaying = false
    /// In the landscape strip the seats are narrow, so the stars move down a line and
    /// leave the name the whole width.
    var compact = false
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 6) {
                    PlayerAvatar(name: player.name, isBot: player.controller == .bot || botPlaying)
                    Text(player.name)
                        .font(.footnote.weight(.bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    if botPlaying {
                        Text("Bot playing")
                            .font(.caption2.weight(.heavy))
                            .foregroundStyle(Palette.gold)
                            .lineLimit(1)
                            .accessibilityIdentifier("opponent.botPlaying")
                    } else if let connection, !connection.connected {
                        Image(systemName: "wifi.slash")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Palette.danger)
                            .accessibilityLabel("Disconnected")
                    }
                    Spacer(minLength: 0)
                    if !compact {
                        SetCountBadge(count: Engine.countCompleteSets(player, variant), needed: needed)
                            .accessibilityHidden(true)
                    }
                }
                HStack(spacing: compact ? 7 : 10) {
                    Label("\(player.hand.count)", systemImage: "rectangle.portrait.on.rectangle.portrait.fill")
                    Label("$\(Engine.totalBankValue(player, variant))", systemImage: "banknote.fill")
                    if variant == .no_mercy { DebtBadge(player: player) }
                    Spacer(minLength: 0)
                    if compact {
                        let complete = Engine.countCompleteSets(player, variant)
                        Label("\(complete)/\(needed)", systemImage: complete > 0 ? "star.fill" : "star")
                            .foregroundStyle(complete > 0 ? Palette.gold : SoftWhite(0.8))
                            .accessibilityHidden(true)
                    }
                }
                .labelStyle(TightLabelStyle(compact: compact))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(SoftWhite(0.8))
                if showBoard && hasCardsOnTable {
                    MiniBoard(player: player, variant: variant)
                } else {
                    SetProgressBar(player: player, variant: variant)
                }
            }
            .padding(9)
            .dealGlass(
                tint: isPrompted ? Palette.gold.opacity(0.28) : nil,
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(isCurrent ? Palette.gold.opacity(0.85) : .clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityHint("Shows their whole board")
    }
}

extension OpponentSummary {
    fileprivate var accessibilitySummary: String {
        var parts = [
            player.name,
            "\(Engine.countCompleteSets(player, variant)) of \(needed) sets complete",
            "\(player.hand.count) cards in hand",
            "Bank \(Engine.totalBankValue(player, variant)) dollars",
        ]
        if variant == .no_mercy, let debts = player.debts?.count, debts > 0 { parts.append("\(debts) debts owed") }
        if let connection, !connection.connected { parts.append("disconnected") }
        return parts.joined(separator: ", ")
    }

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
                            CardView(cardId: cardId, variant: variant, width: 40, edgeOnly: cardId != player.bank.last)
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

    private var online: OnlineMatch? { session as? OnlineMatch }

    /// The host picks how a bot plays, whether it's a bot seat or covering for someone who dropped.
    @ViewBuilder
    private var botDifficulty: some View {
        if let online, let view = online.view, view.isHost, player.controller == .bot || online.botSeatIds.contains(player.id),
           let seat = view.players.first(where: { $0.id == player.id }) {
            VStack(alignment: .leading, spacing: 6) {
                SectionTitle(text: "Bot Difficulty")
                Picker("Bot difficulty", selection: Binding(
                    get: { seat.botDifficulty ?? .easy },
                    set: { difficulty in
                        let seatId = player.id
                        Task { await online.connection.run { client, session, _ in try await client.setBotDifficulty(session, seatId: seatId, difficulty: difficulty) } }
                    }
                )) {
                    Text("Easy").tag(BotDifficulty.easy)
                    Text("Hard").tag(BotDifficulty.hard)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("opponent.difficulty")
            }
        }
    }

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
                    botDifficulty
                    BankFan(cards: player.bank, variant: session.variant)
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
            if let note = content.note {
                Label(note, systemImage: "info.circle")
                    .font(.footnote)
                    .multilineTextAlignment(.leading)
                    .padding(.horizontal, 20)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("chooser.note")
            }
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
                .dealGlass(in: Capsule())
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
    var playerNames: [String]

    @State private var filter = Filter.all

    private enum Filter: String, CaseIterable {
        case all = "All", actions = "Actions", money = "Money", property = "Property"

        func allows(_ entry: LogEntry) -> Bool {
            switch self {
            case .all: true
            case .actions: entry.tone == .action
            case .money: entry.tone == .money
            case .property: entry.tone == .property
            }
        }
    }

    private var turns: [LogTurn] {
        GameLogModel.turns(events, playerNames: playerNames).compactMap { turn in
            var next = turn
            next.entries = turn.entries.filter(filter.allows)
            return next.entries.isEmpty ? nil : next
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(spacing: 10) {
                    Picker("Show", selection: $filter) {
                        ForEach(Filter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("log.filter")
                    ForEach(turns) { turn in
                        LogTurnCard(turn: turn)
                    }
                }
                .padding(16)
            }
            .overlay {
                if turns.isEmpty {
                    ContentUnavailableView("Nothing yet", systemImage: "list.bullet")
                }
            }
            .navigationTitle("Game Log")
            .navigationBarTitleDisplayMode(.inline)
        }
        .accessibilityIdentifier("log")
    }
}

struct LogTurnCard: View {
    var turn: LogTurn

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if let name = turn.playerName { PlayerAvatar(name: name, isBot: false) }
                Text(turn.playerName ?? "Table")
                    .font(.subheadline.weight(.bold))
                Spacer()
                Text(turn.isCurrent ? "Now" : "Turn \(turn.number)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(turn.isCurrent ? Palette.gold : Color.secondary)
            }
            ForEach(turn.entries) { entry in
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: entry.symbol)
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(tint(entry))
                        .frame(width: 24, height: 24)
                        .background(Circle().fill(tint(entry).opacity(0.2)))
                    text(entry)
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Color.white.opacity(0.06)))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(turn.isCurrent ? Palette.gold.opacity(0.7) : Color.white.opacity(0.1), lineWidth: 1)
        )
    }

    private func text(_ entry: LogEntry) -> Text {
        let message = displayText(entry.message)
        guard let actor = entry.actor, message.hasPrefix(actor) else { return Text(message) }
        return Text("\(Text(actor).fontWeight(.bold))\(String(message.dropFirst(actor.count)))")
    }

    private func tint(_ entry: LogEntry) -> Color {
        switch entry.tone {
        case .money: Palette.success
        case .property: Color(hex: 0x6DB8F2)
        case .action: Color(hex: 0xB892FF)
        case .turn, .neutral: .white.opacity(0.7)
        }
    }
}

/// A bank laid out so every card can be read. Tapping the pile spreads it, and the row scrolls.
struct BankFan: View {
    var cards: [String]
    var variant: GameVariant
    var startsOpen = false

    @State private var open: Bool?

    private var isOpen: Bool { open ?? startsOpen }
    private var total: Int { cards.reduce(0) { $0 + Engine.cardMoneyValue($1, variant) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: "Bank $\(total)")
            if cards.isEmpty {
                Text("Nothing banked.").foregroundStyle(.secondary)
            } else if isOpen {
                ScrollView(.horizontal, showsIndicators: true) {
                    HStack(spacing: 10) {
                        ForEach(cards, id: \.self) { CardView(cardId: $0, variant: variant, width: 112) }
                    }
                    .padding(.vertical, 4)
                }
                .accessibilityIdentifier("bank.fan")
            } else {
                Button {
                    withAnimation(.snappy) { open = true }
                } label: {
                    ZStack(alignment: .topLeading) {
                        ForEach(Array(cards.enumerated()), id: \.element) { index, cardId in
                            CardView(cardId: cardId, variant: variant, width: 88, edgeOnly: cardId != cards.last)
                                .shadow(color: .black.opacity(0.25), radius: 1.5, y: 1)
                                .offset(x: CGFloat(index) * 9)
                        }
                    }
                    .padding(.trailing, CGFloat(cards.count - 1) * 9)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Spread out all \(cards.count) bank cards")
                .accessibilityIdentifier("bank.pile")
            }
        }
    }
}

struct BankSheet: View {
    var player: PlayerState
    var variant: GameVariant

    var body: some View {
        BankFan(cards: player.bank, variant: variant, startsOpen: true)
            .padding(20)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// An icon and its text, closer together when space is short.
private struct TightLabelStyle: LabelStyle {
    var compact: Bool

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: compact ? 2 : 4) {
            configuration.icon
            configuration.title
        }
    }
}
