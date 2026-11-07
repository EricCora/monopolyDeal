import DealEngine
import DealOnline
import DealStats
import SwiftUI

/// The table as an oval with everyone seated around it. Each player's sets and Bank are
/// laid out on the felt in front of them, turned to face them, so you watch the sets get
/// built. `TableLayout` says where each seat goes; this scales it to the space given.
struct PokerTable: View {
    var session: any TableSession
    var actions: TableActions
    var ui: TableUI
    var space: Namespace.ID
    var accent: Color

    /// The player at the bottom: you, or whoever's first when the hands are hidden.
    private var bottomPlayer: PlayerState? {
        session.viewer ?? session.game?.players.first
    }

    /// Everyone else in turn order after the bottom player, so the next player sits on the left.
    private var opponents: [PlayerState] {
        guard let game = session.game, let bottom = bottomPlayer,
              let start = game.players.firstIndex(where: { $0.id == bottom.id }) else { return [] }
        return (1..<game.players.count).map { game.players[(start + $0) % game.players.count] }
    }

    private var needed: Int { session.game.map { Engine.ruleset($0).winCompleteSets } ?? 3 }

    var body: some View {
        GeometryReader { proxy in
            let frame = TableFrame(size: proxy.size)
            let seats = TableLayout.seats(opponents: opponents.count)
            ZStack(alignment: .topLeading) {
                FeltOval(felt: frame.felt, scale: frame.scale)

                CentrePiles(session: session, ui: ui, scale: frame.scale, accent: accent)
                    .position(frame.point(CGPoint(x: TableLayout.centre.midX, y: TableLayout.centre.midY)))

                ForEach(Array(zip(opponents, seats)), id: \.0.id) { player, seat in
                    seatPiles(player, seat: seat, frame: frame)
                    seatPill(player)
                        .position(frame.point(seat.pill))
                }

                if let bottom = bottomPlayer {
                    viewerArea(bottom, frame: frame)
                    viewerPill(bottom)
                        .position(frame.point(TableLayout.viewerPill))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
    }

    // MARK: Opponents

    private func seatPiles(_ player: PlayerState, seat: TableSeat, frame: TableFrame) -> some View {
        let lanes = BoardLane.lanes(for: player, variant: session.variant)
        let piles = lanes.count + (player.bank.isEmpty ? 0 : 1)
        let tallest = max(lanes.map(\.entries.count).max() ?? 1, min(player.bank.count, 4))
        let area = CGSize(width: seat.area.width * frame.scale, height: seat.area.height * frame.scale)
        let grid = TableLayout.pileGrid(piles: piles, tallest: min(tallest, 4), in: area, largest: 46 * frame.scale)
        let cardWidth = grid.cardWidth
        let rowWidth = CGFloat(grid.columns) * cardWidth + CGFloat(grid.columns - 1) * TableLayout.pileGap
        return Button {
            ui.inspectedOpponent = player.id
        } label: {
            CentredFlow(spacing: TableLayout.pileGap) {
                ForEach(lanes) { lane in
                    TablePile(
                        cards: lane.entries.map { (id: $0.cardId, color: Optional($0.assignedColor)) },
                        label: pileLabel(lane, owner: player, small: cardWidth < 40 && cardWidth >= 28),
                        complete: lane.isComplete,
                        variant: session.variant,
                        cardWidth: cardWidth,
                        space: space
                    )
                }
                if !player.bank.isEmpty {
                    TablePile(
                        cards: player.bank.suffix(4).map { (id: $0, color: PropertyColor?.none) },
                        label: "$\(Engine.totalBankValue(player, session.variant))",
                        complete: false,
                        variant: session.variant,
                        cardWidth: cardWidth,
                        space: space
                    )
                }
            }
            .frame(width: min(area.width, rowWidth + 1))
            .frame(width: area.width, height: area.height, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .rotationEffect(.degrees(seat.rotation))
        .position(frame.point(seat.center))
        .accessibilityLabel("\(player.name)'s table")
        .accessibilityHint("Shows their whole board")
    }

    private func pileLabel(_ lane: BoardLane, owner: PlayerState, small: Bool) -> String {
        let count = lane.entries.filter { entry in
            let kind = Catalog.lookup(entry.cardId, session.variant)?.kind
            return kind == .property || kind == .wild
        }.count
        if lane.isComplete { return "\(count)/\(lane.color.setSize) ✓" }
        let progress = "\(count)/\(lane.color.setSize)"
        // Small cards can't show their rent, so the label carries it, unless even that won't fit.
        return small ? "\(progress) · $\(Engine.getRentAmount(owner, lane.color, session.variant))" : progress
    }

    private func seatPill(_ player: PlayerState) -> some View {
        SeatPill(
            player: player,
            variant: session.variant,
            needed: needed,
            isCurrent: session.game.map { $0.players[$0.currentPlayerIndex].id == player.id } ?? false,
            isPrompted: session.prompt?.playerId == player.id,
            connection: (session as? OnlineMatch)?.view?.players.first { $0.id == player.id },
            botPlaying: session.botSeatIds.contains(player.id),
            accent: accent
        ) {
            ui.inspectedOpponent = player.id
        }
    }

    // MARK: You

    private func viewerArea(_ player: PlayerState, frame: TableFrame) -> some View {
        let area = TableLayout.viewerArea
        let lanes = BoardLane.lanes(for: player, variant: session.variant)
        let isViewer = player.id == session.viewerId
        let cardWidth = min(46, 46 * frame.scale * 1.08)
        return ScrollView(.vertical, showsIndicators: false) {
            CentredFlow(spacing: 10) {
                BankStack(cards: player.bank, variant: session.variant, cardWidth: cardWidth, space: space) { _ in
                    if isViewer { ui.showBank = true }
                }
                ForEach(lanes) { lane in
                    SetLane(lane: lane, variant: session.variant, cardWidth: cardWidth, space: space) { cardId in
                        if isViewer { actions.tapBoardCard(cardId, in: lane.color) }
                    }
                }
            }
            .frame(width: area.width * frame.sx)
            .padding(.vertical, 4)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(width: area.width * frame.sx, height: area.height * frame.sy)
        .position(frame.point(CGPoint(x: area.midX, y: area.midY)))
        .accessibilityIdentifier("table.board")
    }

    private func viewerPill(_ player: PlayerState) -> some View {
        HStack(spacing: 8) {
            Text(player.id == session.viewerId ? player.name.uppercased() : player.name)
                .font(.subheadline.weight(.heavy))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            SetCountBadge(count: Engine.countCompleteSets(player, session.variant), needed: needed)
            if session.variant == .no_mercy { DebtBadge(player: player) }
        }
        .padding(.horizontal, 16)
        .frame(height: 38)
        // The glow is on the pill only, so the name stays crisp.
        .background(
            Capsule()
                .fill(Color(hex: 0x120C0E))
                .shadow(color: isCurrent(player) ? accent.opacity(0.45) : .clear, radius: 10)
        )
        .overlay(
            Capsule().strokeBorder(isCurrent(player) ? accent : .white.opacity(0.14), lineWidth: isCurrent(player) ? 1.5 : 1)
        )
        .accessibilityElement(children: .combine)
    }

    private func isCurrent(_ player: PlayerState) -> Bool {
        session.game.map { $0.players[$0.currentPlayerIndex].id == player.id } ?? false
    }
}

/// Maps the design space in `TableLayout` onto the view. Positions stretch to fill the
/// space; sizes use the smaller stretch, so nothing grows into its neighbour.
struct TableFrame {
    var size: CGSize

    var sx: CGFloat { size.width / TableLayout.canvas.width }
    var sy: CGFloat { size.height / TableLayout.canvas.height }
    var scale: CGFloat { min(sx, sy) }

    func point(_ design: CGPoint) -> CGPoint {
        CGPoint(x: (design.x - TableLayout.canvas.minX) * sx, y: (design.y - TableLayout.canvas.minY) * sy)
    }

    var felt: CGRect {
        CGRect(origin: point(.zero), size: CGSize(width: TableLayout.felt.width * sx, height: TableLayout.felt.height * sy))
    }
}

/// A wooden rail around an oval of felt.
private struct FeltOval: View {
    @Environment(AppModel.self) private var app
    var felt: CGRect
    var scale: CGFloat

    var body: some View {
        let rail = 16 * scale
        let colors = app.preferences.tableStyle.feltColors
        ZStack {
            Ellipse()
                .fill(LinearGradient(colors: [Color(hex: 0x9A5A30), Color(hex: 0x6E3B1F), Color(hex: 0x4E2913)], startPoint: .top, endPoint: .bottom))
                .frame(width: felt.width + rail * 2, height: felt.height + rail * 2)
                .shadow(color: .black.opacity(0.55), radius: 18, y: 12)
            Ellipse()
                .fill(RadialGradient(colors: colors, center: .init(x: 0.5, y: 0.45), startRadius: 10, endRadius: felt.height * 0.6))
                .overlay(Ellipse().strokeBorder(Color.black.opacity(0.35), lineWidth: 2))
                .frame(width: felt.width, height: felt.height)
        }
        .position(x: felt.midX, y: felt.midY)
        .accessibilityHidden(true)
    }
}

/// The draw pile and the discard, in the middle of the table.
struct CentrePiles: View {
    var session: any TableSession
    var ui: TableUI
    var scale: CGFloat
    var accent: Color

    var body: some View {
        let width = 54 * scale
        HStack(alignment: .top, spacing: 6 * scale) {
            VStack(spacing: 4) {
                ZStack {
                    ForEach(0..<min(3, session.game?.drawPile.count ?? 0), id: \.self) { index in
                        CardBack(width: width)
                            .clipShape(RoundedRectangle(cornerRadius: width * 0.09, style: .continuous))
                            .offset(x: CGFloat(index) * 1.5, y: CGFloat(index) * -1.5)
                    }
                    if session.game?.drawPile.isEmpty ?? true {
                        emptySlot(width)
                    }
                }
                .frame(width: width + 3, height: width * CardView.aspect + 3)
                Text("Draw \(session.game?.drawPile.count ?? 0)")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.white.opacity(0.85))
                    .contentTransition(.numericText())
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(session.game?.drawPile.count ?? 0) cards in the deck")
            .accessibilityIdentifier("table.deck")

            Button {
                ui.showDiscards = true
            } label: {
                VStack(spacing: 4) {
                    Group {
                        if let top = session.game?.discardPile.last {
                            CardView(cardId: top, variant: session.variant, width: width)
                                .shadow(color: .black.opacity(0.4), radius: 4, y: 3)
                        } else {
                            emptySlot(width)
                        }
                    }
                    .frame(width: width + 3, height: width * CardView.aspect + 3)
                    Text("Discard")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(.white.opacity(0.85))
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Discard pile, \(session.game?.discardPile.count ?? 0) cards")
            .accessibilityHint("Shows every discarded card")
            .accessibilityIdentifier("table.discards")
        }
    }

    private func emptySlot(_ width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: width * 0.09, style: .continuous)
            .strokeBorder(.white.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [4]))
            .frame(width: width, height: width * CardView.aspect)
    }
}

/// One pile on the felt: cards cascaded so each colour band shows, with a label under it.
struct TablePile: View {
    var cards: [(id: String, color: PropertyColor?)]
    var label: String
    var complete: Bool
    var variant: GameVariant
    var cardWidth: CGFloat
    var space: Namespace.ID?

    var body: some View {
        let reveal = cardWidth * TableLayout.reveal
        let height = cardWidth * CardView.aspect + reveal * CGFloat(max(cards.count - 1, 0))
        ZStack(alignment: .top) {
            ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                pileCard(card.id, color: card.color)
                    .offset(y: CGFloat(index) * reveal)
                    .zIndex(Double(index))
            }
        }
        .frame(width: cardWidth, height: height, alignment: .top)
        .overlay {
            if complete {
                RoundedRectangle(cornerRadius: cardWidth * 0.11, style: .continuous)
                    .strokeBorder(Palette.gold, lineWidth: 1.5)
                    .padding(-2)
            }
        }
        .shadow(color: complete ? Palette.gold.opacity(0.5) : .clear, radius: 5)
        // The label may be wider than a small card. It hangs below without widening the pile.
        .padding(.bottom, TableLayout.labelHeight)
        .overlay(alignment: .bottom) {
            Text(label)
                .font(.system(size: max(8, min(11, cardWidth * 0.24)), weight: .heavy, design: .rounded))
                .foregroundStyle(complete ? Palette.gold : .white.opacity(0.9))
                .lineLimit(1)
                .fixedSize()
        }
    }

    @ViewBuilder
    private func pileCard(_ cardId: String, color: PropertyColor?) -> some View {
        let view = CardView(cardId: cardId, variant: variant, width: cardWidth, assignedColor: color)
            .shadow(color: .black.opacity(0.3), radius: 1.5, y: 1)
        if let space {
            view.matchedGeometryEffect(id: cardId, in: space)
        } else {
            view
        }
    }
}

/// An opponent's name on the rail: who they are, how many cards they hold and how many
/// sets they've finished. The player whose turn it is gets a ring.
private struct SeatPill: View {
    var player: PlayerState
    var variant: GameVariant
    var needed: Int
    var isCurrent: Bool
    var isPrompted: Bool
    var connection: RoomPlayer?
    var botPlaying: Bool
    var accent: Color
    var onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 7) {
                PlayerAvatar(name: player.name, isBot: player.controller == .bot || botPlaying)
                    .scaleEffect(1.2)
                    .frame(width: 28, height: 28)
                VStack(alignment: .leading, spacing: 1) {
                    nameLine
                    detailLine
                }
            }
            .padding(.leading, 6)
            .padding(.trailing, 12)
            .padding(.vertical, 5)
            .background(background)
            .overlay(ring)
            .fixedSize()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilitySummary)
        .accessibilityHint("Shows their whole board")
    }

    private var nameLine: some View {
        HStack(spacing: 4) {
            Text(player.name)
                .font(.footnote.weight(.heavy))
                .foregroundStyle(.white)
                .lineLimit(1)
            if let connection, !connection.connected, !botPlaying {
                Image(systemName: "wifi.slash")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Palette.danger)
            }
        }
    }

    private var detailLine: some View {
        HStack(spacing: 6) {
            if botPlaying {
                Text("Bot playing").foregroundStyle(Palette.gold)
            } else {
                Text("\(player.hand.count) in hand").foregroundStyle(.white)
            }
            SetCountBadge(count: Engine.countCompleteSets(player, variant), needed: needed)
            if variant == .no_mercy { DebtBadge(player: player) }
        }
        .font(.caption2.weight(.semibold))
    }

    /// The glow is on the pill only, so the name stays crisp.
    private var background: some View {
        Capsule()
            .fill(isPrompted ? Color(hex: 0x3A2E12) : Color(hex: 0x120C0E))
            .shadow(color: shadowColor, radius: isCurrent ? 10 : 6)
    }

    private var ring: some View {
        Capsule().strokeBorder(isCurrent ? accent : Color.white.opacity(0.14), lineWidth: isCurrent ? 1.5 : 1)
    }

    private var shadowColor: Color {
        isCurrent ? accent.opacity(0.45) : Color.black.opacity(0.35)
    }

    private var accessibilitySummary: String {
        var parts = [
            player.name,
            "\(Engine.countCompleteSets(player, variant)) of \(needed) sets complete",
            "\(player.hand.count) cards in hand",
            "Bank \(Engine.totalBankValue(player, variant)) dollars",
        ]
        if isCurrent { parts.append("their turn") }
        if variant == .no_mercy, let debts = player.debts?.count, debts > 0 { parts.append("\(debts) debts owed") }
        if let connection, !connection.connected { parts.append("disconnected") }
        if botPlaying { parts.append("bot playing") }
        return parts.joined(separator: ", ")
    }
}

/// Lays piles out in centred rows.
struct CentredFlow: Layout {
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
            let rowWidth = row.reduce(0) { $0 + $1.size.width } + spacing * CGFloat(max(row.count - 1, 0))
            var x = bounds.minX + max(0, (bounds.width - rowWidth) / 2)
            for item in row {
                subviews[item.index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(item.size))
                x += item.size.width + spacing
            }
            y += (row.map(\.size.height).max() ?? 0) + spacing
        }
    }
}
