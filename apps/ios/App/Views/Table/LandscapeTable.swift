import DealEngine
import DealOnline
import SwiftUI
import UIKit

/// The table on a phone held sideways. Opponents sit in a strip along the top. The middle
/// row has the piles, your sets and Bank, and the turn button at the right edge, where a
/// thumb rests. Your hand fans along the bottom edge, large, and runs off it.
/// `TableView` supplies the menu, the status cell, the turn buttons and the hand.
struct LandscapeTable<MenuButton: View, Status: View, TurnButtons: View, Hand: View>: View {
    var session: any TableSession
    var actions: TableActions
    var ui: TableUI
    var space: Namespace.ID
    var accent: Color
    var extras: AnyView?
    var showsTurnButtons: Bool
    @ViewBuilder var menu: () -> MenuButton
    @ViewBuilder var status: () -> Status
    @ViewBuilder var turnButtons: () -> TurnButtons
    @ViewBuilder var hand: (_ cardWidth: CGFloat) -> Hand

    /// How much of each hand card hangs below the screen.
    static var handOverhang: CGFloat { 0.27 }
    /// Room for "Your turn", the plays left and the status line.
    private static var statusWidth: CGFloat { 220 }
    private static var turnButtonsWidth: CGFloat { 148 }

    /// 128 pt on a Pro Max, a little less on smaller phones.
    static func handCardWidth(height: CGFloat) -> CGFloat { min(128, (height * 0.29).rounded()) }

    private var bottomPlayer: PlayerState? { session.viewer ?? session.game?.players.first }

    /// Everyone else in turn order after you, so the next player is on the left.
    private var opponents: [PlayerState] {
        guard let game = session.game, let bottom = bottomPlayer,
              let start = game.players.firstIndex(where: { $0.id == bottom.id }) else { return [] }
        return (1..<game.players.count).map { game.players[(start + $0) % game.players.count] }
    }

    private var needed: Int { session.game.map { Engine.ruleset($0).winCompleteSets } ?? 3 }

    var body: some View {
        GeometryReader { proxy in
            let handWidth = Self.handCardWidth(height: proxy.size.height)
            // Measured from the screen's edge, so the home indicator's strip counts toward it.
            let overhang = max(0, (handWidth * CardView.aspect * Self.handOverhang).rounded() - proxy.safeAreaInsets.bottom)
            VStack(spacing: 6) {
                if let extras { extras }
                HStack(alignment: .top, spacing: 6) {
                    menu()
                    opponentStrip
                    status()
                        .frame(width: Self.statusWidth)
                }
                .fixedSize(horizontal: false, vertical: true)

                HStack(alignment: .bottom, spacing: 10) {
                    CentrePiles(session: session, ui: ui, scale: handWidth / 112, accent: accent)
                        .frame(maxHeight: .infinity)
                    if let player = bottomPlayer { board(player) }
                    if showsTurnButtons {
                        turnButtons()
                            .frame(width: Self.turnButtonsWidth)
                    }
                }
                .frame(maxHeight: .infinity)

                hand(handWidth)
                    .padding(.bottom, -overhang)
                    .offset(y: overhang)
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .top)
        }
    }

    // MARK: Opponents

    private var opponentStrip: some View {
        HStack(alignment: .top, spacing: 6) {
            ForEach(opponents, id: \.id) { player in
                OpponentSummary(
                    player: player,
                    variant: session.variant,
                    isPrompted: session.prompt?.playerId == player.id,
                    isCurrent: session.game.map { $0.players[$0.currentPlayerIndex].id == player.id } ?? false,
                    needed: needed,
                    connection: (session as? OnlineMatch)?.view?.players.first { $0.id == player.id },
                    botPlaying: session.botSeatIds.contains(player.id),
                    compact: true
                ) {
                    ui.inspectedOpponent = player.id
                }
                .frame(maxWidth: 230, maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("table.opponents")
    }

    // MARK: You

    private func board(_ player: PlayerState) -> some View {
        let lanes = BoardLane.lanes(for: player, variant: session.variant)
        let isViewer = player.id == session.viewerId
        // Cards stay one size until a set grows past two, so the table doesn't jump much.
        let tallest = CGFloat(max(lanes.map(\.entries.count).max() ?? 2, 2))
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(isViewer ? "Your table" : player.name)
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(1)
                SetCountBadge(count: Engine.countCompleteSets(player, session.variant), needed: needed)
                if session.variant == .no_mercy { DebtBadge(player: player) }
            }
            GeometryReader { proxy in
                // A lane is the card plus each card's revealed band, plus its label.
                let cardWidth = min(70, max(36, (proxy.size.height - 26) / (CardView.aspect + 0.46 * (tallest - 1))))
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 10) {
                        BankStack(cards: player.bank, variant: session.variant, cardWidth: cardWidth, space: space) { _ in
                            if isViewer { ui.showBank = true }
                        }
                        ForEach(lanes) { lane in
                            SetLane(lane: lane, variant: session.variant, cardWidth: cardWidth, space: space) { cardId in
                                if isViewer { actions.tapBoardCard(cardId, in: lane.color) }
                            }
                        }
                    }
                    .padding(.horizontal, 2)
                    .padding(.vertical, 2)
                }
                .scrollBounceBehavior(.basedOnSize)
                .overlay {
                    if lanes.isEmpty && player.bank.isEmpty {
                        Text("Your Bank and properties go here.")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.white.opacity(0.7))
                            .allowsHitTesting(false)
                    }
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .glassPanel(cornerRadius: 18)
        .accessibilityIdentifier("table.board")
    }
}

/// Which way the phone may turn. Menus stay upright; the table turns sideways while it's
/// on screen, unless the Landscape Table setting is off. iPad turns freely throughout.
@MainActor
enum OrientationLock {
    private static var isPhone: Bool { UIDevice.current.userInterfaceIdiom == .phone }
    private(set) static var mask: UIInterfaceOrientationMask = UIDevice.current.userInterfaceIdiom == .phone ? .portrait : .all

    /// A replay opens a second table over the first, so count them.
    private static var openTables = 0
    private static var landscapeTable = true

    static func tableAppeared(landscape: Bool) {
        openTables += 1
        landscapeTable = landscape
        apply()
    }

    static func tableDisappeared() {
        openTables = max(0, openTables - 1)
        apply()
    }

    static func setLandscapeTable(_ landscape: Bool) {
        landscapeTable = landscape
        apply()
    }

    private static func apply() {
        guard isPhone else { return }
        let next: UIInterfaceOrientationMask = openTables > 0 && landscapeTable ? .landscape : .portrait
        guard next != mask else { return }
        mask = next
        for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
            var controller = scene.keyWindow?.rootViewController
            while let current = controller {
                current.setNeedsUpdateOfSupportedInterfaceOrientations()
                controller = current.presentedViewController
            }
            scene.requestGeometryUpdate(.iOS(interfaceOrientations: next))
        }
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        MainActor.assumeIsolated { OrientationLock.mask }
    }
}
