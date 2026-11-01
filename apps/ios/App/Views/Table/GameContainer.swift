import DealEngine
import DealStats
import SwiftUI

/// Hosts a local game: the table, then the pass-and-play screen and results on top.
struct LocalGameView: View {
    @Environment(AppModel.self) private var app
    var match: LocalMatch

    var body: some View {
        ZStack {
            TableView(session: match, extras: nil) {
                app.closeLocalMatch()
            }
            if match.shouldShowShield {
                PassDeviceShield(match: match)
                    .transition(.opacity)
            }
            if let summary = match.summary, let game = match.game {
                PostGameView(
                    summary: summary,
                    game: game,
                    unlocked: match.unlocked,
                    primaryTitle: "Rematch",
                    onPrimary: { app.rematch() },
                    onClose: { app.closeLocalMatch() }
                )
                .transition(.opacity)
                .zIndex(10)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: match.shouldShowShield)
        .animation(.easeInOut(duration: 0.3), value: match.summary)
    }
}

/// Hides the table between players, so the next one can take the phone without seeing a hand.
struct PassDeviceShield: View {
    @Environment(AppModel.self) private var app
    var match: LocalMatch

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            VStack(spacing: 22) {
                ZStack {
                    CardBack(width: 92)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                        .rotationEffect(.degrees(-10))
                        .offset(x: -24)
                    CardBack(width: 92)
                        .clipShape(RoundedRectangle(cornerRadius: 9))
                        .rotationEffect(.degrees(9))
                        .offset(x: 24)
                }
                .shadow(radius: 12, y: 8)
                VStack(spacing: 6) {
                    Text("Pass the phone to")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(SoftWhite(0.7))
                    Text(promptName)
                        .font(.largeTitle.weight(.black))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                    Text(detail)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(SoftWhite(0.7))
                        .multilineTextAlignment(.center)
                }
                Button {
                    app.feedback(.tap)
                    withAnimation(.easeInOut(duration: 0.25)) { match.reveal() }
                } label: {
                    Label("Show My Hand", systemImage: "eye.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .frame(maxWidth: 280)
                .accessibilityIdentifier("shield.reveal")
            }
            .padding(30)
        }
    }

    private var promptName: String {
        match.playerName(match.prompt?.playerId)
    }

    private var detail: String {
        let turn = match.game?.turnCount ?? 1
        switch match.prompt?.kind {
        case .draw: return "Turn \(turn): start by drawing."
        case .payment: return "Turn \(turn): a payment is due."
        case .response: return "Turn \(turn): respond to an action."
        case .selection: return "Turn \(turn): a choice is waiting."
        case .discard: return "Turn \(turn): discard to end the turn."
        case .debt: return "Turn \(turn): a debt is due."
        default: return "Turn \(turn)"
        }
    }
}

/// The results screen. Mirrors `PostGameScreen.tsx`.
struct PostGameView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var summary: PostGameSummary
    var game: GameState
    var unlocked: [AchievementId]
    var primaryTitle: String?
    var onPrimary: () -> Void
    var onClose: () -> Void

    @State private var shareImage: Image?

    private var showConfetti: Bool { !reduceMotion && !app.preferences.reducedEffects }

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            if showConfetti { ConfettiView().ignoresSafeArea() }
            ScrollView {
                VStack(spacing: 16) {
                    hero
                    if !unlocked.isEmpty { achievementsRow }
                    recap
                    standings
                    buttons
                }
                .padding(18)
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
        }
        .task(id: summary.endedAt) { renderShareImage() }
        .accessibilityIdentifier("postgame")
    }

    private var hero: some View {
        VStack(spacing: 6) {
            Image(systemName: "trophy.fill")
                .font(.system(size: 62))
                .foregroundStyle(LinearGradient(colors: [Palette.gold, Palette.goldDeep], startPoint: .top, endPoint: .bottom))
                .shadow(color: Palette.gold.opacity(0.6), radius: 16)
                .symbolEffect(.bounce, options: .nonRepeating, value: summary.endedAt)
            Text(winnerHeadline(summary.winnerName))
                .font(.largeTitle.weight(.black))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("postgame.winner")
            Text("\(summary.turnCount) turns · \(formatDuration(summary.durationSec))")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(SoftWhite(0.75))
        }
        .padding(.top, 20)
    }

    private var achievementsRow: some View {
        HStack(spacing: 8) {
            ForEach(unlocked, id: \.self) { id in
                Label(id.label, systemImage: id.symbol)
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(Palette.gold))
            }
        }
        .accessibilityLabel("Achievement unlocked: \(unlocked.map(\.label).joined(separator: ", "))")
    }

    private var recap: some View {
        VStack(alignment: .leading, spacing: 10) {
            recapRow("Winning move", displayText(summary.winningMove), icon: "flag.checkered")
            recapRow("Momentum shift", displayText(summary.momentumShift), icon: "chart.line.uptrend.xyaxis")
            if !summary.highlightCards.isEmpty {
                recapRow("Standout cards", summary.highlightCards.joined(separator: ", "), icon: "sparkles")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel()
    }

    private func recapRow(_ title: String, _ text: String, icon: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon)
                .foregroundStyle(Palette.gold)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption.weight(.heavy)).foregroundStyle(SoftWhite(0.62))
                Text(text).font(.subheadline.weight(.medium)).foregroundStyle(.white)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var standings: some View {
        VStack(spacing: 2) {
            ForEach(summary.players) { row in
                HStack(spacing: 10) {
                    Text("\(row.rank)")
                        .font(.headline.weight(.black))
                        .foregroundStyle(row.isWinner ? Palette.gold : .white.opacity(0.6))
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(row.name).font(.subheadline.weight(.bold)).foregroundStyle(.white)
                        Text("\(row.lifetimeWins) \(row.lifetimeWins == 1 ? "win" : "wins") in \(row.lifetimeGamesPlayed) \(row.lifetimeGamesPlayed == 1 ? "game" : "games")")
                            .font(.caption2).foregroundStyle(SoftWhite(0.6))
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("\(row.completeSets) \(row.completeSets == 1 ? "set" : "sets")").font(.footnote.weight(.bold)).foregroundStyle(.white)
                        Text("Bank $\(row.bankValue)").font(.caption2).foregroundStyle(SoftWhite(0.65))
                    }
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
            }
        }
        .glassPanel()
    }

    private var buttons: some View {
        VStack(spacing: 8) {
            if let primaryTitle {
                Button(primaryTitle, action: onPrimary)
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("postgame.primary")
            }
            HStack(spacing: 8) {
                if let shareImage {
                    ShareLink(
                        item: shareImage,
                        preview: SharePreview("\(summary.winnerName ?? "Nobody") won Monopoly Deal", image: shareImage)
                    ) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("postgame.share")
                }
                Button("Done", action: onClose)
                    .buttonStyle(SecondaryButtonStyle())
                    .accessibilityIdentifier("postgame.done")
            }
        }
    }

    private func renderShareImage() {
        let renderer = ImageRenderer(content: ShareCardView(summary: summary, style: app.preferences.tableStyle))
        renderer.scale = 3
        if let image = renderer.uiImage { shareImage = Image(uiImage: image) }
    }
}

/// The brag image for the share sheet.
struct ShareCardView: View {
    var summary: PostGameSummary
    var style: TableTheme

    var body: some View {
        ZStack {
            MeshGradient(width: 3, height: 3, points: [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]], colors: style.meshColors)
            VStack(spacing: 14) {
                Image(systemName: "trophy.fill")
                    .font(.system(size: 54))
                    .foregroundStyle(Palette.gold)
                Text(summary.winnerName == "You" ? "I won Monopoly Deal" : "\(summary.winnerName ?? "Nobody") won Monopoly Deal")
                    .font(.system(size: 26, weight: .black, design: .rounded))
                    .multilineTextAlignment(.center)
                Text("\(summary.turnCount) turns · \(formatDuration(summary.durationSec))")
                    .font(.system(size: 15, weight: .semibold))
                    .opacity(0.8)
                VStack(spacing: 6) {
                    ForEach(summary.players) { row in
                        HStack {
                            Text("\(row.rank). \(row.name)").fontWeight(.bold)
                            Spacer()
                            Text("\(row.completeSets) \(row.completeSets == 1 ? "set" : "sets") · $\(row.bankValue)")
                        }
                        .font(.system(size: 15))
                    }
                }
                .padding(.top, 6)
                Text(displayText(summary.winningMove))
                    .font(.system(size: 13, weight: .medium))
                    .multilineTextAlignment(.center)
                    .opacity(0.8)
            }
            .foregroundStyle(.white)
            .padding(26)
        }
        .frame(width: 380, height: 420)
    }
}
