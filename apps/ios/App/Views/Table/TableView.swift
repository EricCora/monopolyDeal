import DealAI
import DealEngine
import DealOnline
import DealStats
import SwiftUI

/// The game table, for local and online play alike.
struct TableView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var session: any TableSession
    var extras: AnyView?
    var onLeave: () -> Void

    @State private var ui = TableUI()
    @Namespace private var cardSpace

    private var cardsAnimate: Bool { !reduceMotion && !app.preferences.reducedEffects }

    private var actions: TableActions {
        TableActions(
            session: session,
            ui: ui,
            confirmRisky: app.preferences.confirmRiskyActions,
            tapFeedback: { app.feedback(.tap) },
            errorFeedback: { app.feedback(.error) }
        )
    }

    var body: some View {
        GeometryReader { geometry in
            let wide = geometry.size.width > 700
            let phoneHand = min(118, geometry.size.width * 0.27)
            let phoneLane = geometry.size.height > 800 ? min(84, geometry.size.width * 0.19) : 62
            ZStack(alignment: .bottom) {
                TableBackground(style: app.preferences.tableStyle)

                VStack(spacing: 8) {
                    topBar
                    if let extras { extras }
                    if wide {
                        HStack(alignment: .top, spacing: 12) {
                            OpponentColumn(session: session, ui: ui, wide: true)
                                .frame(width: 280)
                            VStack(spacing: 8) {
                                statusRow
                                playerBoard(cardWidth: 112)
                            }
                        }
                    } else {
                        OpponentColumn(session: session, ui: ui, wide: false, showsBoards: geometry.size.height > 760)
                        statusRow
                        playerBoard(cardWidth: phoneLane)
                    }
                    if (session.isViewersPrompt || session.viewerId != nil) && !session.isReplay {
                        actionBar
                    }
                    HandFan(
                        session: session,
                        actions: actions,
                        ui: ui,
                        cardWidth: wide ? 170 : phoneHand,
                        space: cardSpace,
                        animatesDeal: cardsAnimate
                    )
                    .allowsHitTesting(!session.isReplay)
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 4)

                if !session.isReplay {
                    PromptPanel(session: session, actions: actions, ui: ui)
                }

                toast

                tableMoments(wide: wide, height: geometry.size.height)
            }
        }
        .overlay { pauseOverlay }
        // Every state change animates here, so a bot's or another player's move glides too.
        .animation(cardsAnimate ? .snappy(duration: 0.42) : nil, value: session.game?.updatedAt)
        .sheet(item: Binding(get: { ui.chooser }, set: { ui.chooser = $0 })) { chooser in
            ChooserSheet(content: chooser, variant: session.variant) { option in
                ui.chooser = nil
                actions.run(option.legal)
            }
            .presentationDetents([.height(min(CGFloat(chooser.options.count) * 56 + (chooser.note == nil ? 300 : 350), 680))])
            .presentationBackground(.ultraThinMaterial)
        }
        .sheet(isPresented: Binding(get: { ui.inspectedCard != nil }, set: { if !$0 { ui.inspectedCard = nil } })) {
            if let cardId = ui.inspectedCard {
                CardInspector(cardId: cardId, variant: session.variant)
                    .presentationDetents([.medium])
                    .presentationBackground(.ultraThinMaterial)
            }
        }
        .sheet(isPresented: Binding(get: { ui.inspectedOpponent != nil }, set: { if !$0 { ui.inspectedOpponent = nil } })) {
            if let player = ui.inspectedOpponent.flatMap({ id in session.game?.players.first { $0.id == id } }) {
                OpponentBoardSheet(player: player, session: session)
                    .presentationDetents([.medium, .large])
                    .presentationBackground(.ultraThinMaterial)
            }
        }
        .sheet(isPresented: $ui.showBank) {
            if let viewer = session.viewer {
                BankSheet(player: viewer, variant: session.variant)
                    .presentationDetents([.height(280), .medium])
                    .presentationBackground(.ultraThinMaterial)
            }
        }
        .sheet(isPresented: $ui.showDiscards) {
            DiscardBrowser(cards: session.game?.discardPile ?? [], variant: session.variant)
                .presentationDetents([.medium])
                .presentationBackground(.ultraThinMaterial)
        }
        .sheet(isPresented: $ui.showLog) {
            EventLogSheet(events: session.game?.history ?? [], playerNames: session.game?.players.map(\.name) ?? [])
                .presentationDetents([.medium, .large])
                .presentationBackground(.ultraThinMaterial)
        }
        .sheet(isPresented: $ui.showRules) {
            RulesView()
        }
        .sheet(isPresented: $ui.showSaves) {
            NavigationStack { SavedGamesView(duringGame: true) }
        }
        // Past this size the board no longer fits a phone. Menus and sheets have no limit.
        .dynamicTypeSize(...DynamicTypeSize.accessibility1)
        .confirmationDialog(
            ui.confirmation?.label ?? "",
            isPresented: Binding(get: { ui.confirmation != nil }, set: { if !$0 { ui.confirmation = nil } }),
            titleVisibility: .visible,
            presenting: ui.confirmation
        ) { confirmation in
            Button("Play It", role: confirmation.risk == .high ? .destructive : nil) {
                actions.perform(confirmation.action)
            }
            .accessibilityIdentifier("confirm.play")
            Button("Cancel", role: .cancel) { ui.confirmation = nil }
        } message: { confirmation in
            Text(confirmation.preview)
        }
        .onChange(of: session.game?.discardPile.last) { old, new in
            showSpotlightIfNeeded(previousTop: old, newTop: new)
        }
        .onChange(of: viewerCompleteSets) { old, new in
            celebrateIfNeeded(old: old, new: new)
        }
        .onChange(of: session.isViewersPrompt) { _, yours in
            if yours { AccessibilityNotification.Announcement("Your move").post() }
        }
        .onChange(of: session.prompt) {
            ui.notice = nil
            ui.chooser = nil
            ui.selectedCardId = nil
            ui.coach = nil
            if case .payment = session.game?.pending {} else { ui.paymentCards = [] }
            if case .forcedDeal = session.game?.pending {} else { ui.forcedDealGive = nil }
        }
    }

    // MARK: Top

    private var topBar: some View {
        HStack(spacing: 10) {
            Menu {
                if session.canPause {
                    Button(session.isPaused ? "Resume" : "Pause", systemImage: session.isPaused ? "play.fill" : "pause.fill") {
                        session.togglePause()
                    }
                }
                Button("Rules", systemImage: "book") { ui.showRules = true }
                Button("Game Log", systemImage: "list.bullet") { ui.showLog = true }
                if session is LocalMatch {
                    Button("Save Game", systemImage: "square.and.arrow.down") { ui.showSaves = true }
                }
                Divider()
                Button(leaveLabel, systemImage: "chevron.backward", action: onLeave)
            } label: {
                Image(systemName: "line.3.horizontal")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .dealGlass(interactive: true, in: Circle())
            }
            .accessibilityLabel("Game menu")
            .accessibilityIdentifier("table.menu")

            VStack(alignment: .leading, spacing: 1) {
                Text(turnTitle)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                // The clock takes room from this line, so it gives way before anything gets cut off.
                ViewThatFits(in: .horizontal) {
                    subtitleText(subtitle)
                    subtitleText(shortSubtitle)
                }
            }
            Spacer(minLength: 4)

            if let clock = session.turnClock { TurnClockPill(clock: clock) }

            PlaysPips(used: session.game?.turn.playsUsed ?? 0, total: session.game.map { Engine.ruleset($0).maxPlaysPerTurn } ?? 3)

            PileStack(session: session, ui: ui)
        }
    }

    private var leaveLabel: String {
        if session.isReplay { return "Close Replay" }
        if session.isSpectating { return "Stop Watching" }
        return session is LocalMatch ? "Back to Menu" : "Exit Match"
    }

    private var turnTitle: String {
        guard let game = session.game else { return "" }
        let current = game.players[game.currentPlayerIndex]
        return current.id == session.viewerId && !session.isReplay ? "Your turn" : "\(current.name)'s turn"
    }

    private func subtitleText(_ text: String) -> some View {
        Text(text)
            .font(.caption.weight(.medium))
            .foregroundStyle(.white)
            .lineLimit(1)
            .fixedSize()
    }

    private var shortSubtitle: String {
        guard let game = session.game else { return session.title }
        return "Turn \(game.turnCount)"
    }

    private var subtitle: String {
        guard let game = session.game else { return session.title }
        if let series = session.series, series.bestOf > 1 {
            let score = game.players.map { String(series.wins[$0.id] ?? 0) }.joined(separator: "–")
            return "Turn \(game.turnCount) · \(game.resolvedVariant.label) · Game \(series.gameNumber) · \(score)"
        }
        return "Turn \(game.turnCount) · \(game.resolvedVariant.label) · \(Engine.ruleset(game).winCompleteSets) \(Engine.ruleset(game).winCompleteSets == 1 ? "set" : "sets") to win"
    }

    // MARK: Status

    private var statusRow: some View {
        Button {
            ui.showLog = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: statusIcon)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(session.isViewersPrompt ? app.preferences.tableStyle.accent : .white.opacity(0.8))
                    .symbolEffect(.pulse, isActive: session.isViewersPrompt && !reduceMotion)
                VStack(alignment: .leading, spacing: 1) {
                    Text(statusText)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                        .multilineTextAlignment(.leading)
                        .contentTransition(.opacity)
                    if let latest = latestEventText {
                        Text(latest.text)
                            .font(.caption.weight(latest.againstYou ? .bold : .regular))
                            .foregroundStyle(latest.againstYou ? Color(hex: 0xFF9A9E) : .white.opacity(0.62))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .frame(minHeight: 46)
            .dealGlass(tint: Color.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(session.isViewersPrompt ? app.preferences.tableStyle.accent.opacity(0.8) : .clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("table.status")
    }

    /// The most recent thing to happen, so you can see what the last player did.
    /// A property taken from you stands out.
    private var latestEventText: (text: String, againstYou: Bool)? {
        guard session.isViewersPrompt, let event = session.game?.history.last else { return nil }
        let againstYou = event.details?.kind == "property_steal" && event.details?.targetPlayerId == session.viewerId
        return (displayText(event.message), againstYou)
    }

    private var statusIcon: String {
        guard let prompt = session.prompt else { return "circle" }
        guard session.isViewersPrompt else { return "hourglass" }
        switch prompt.kind {
        case .draw: return "arrow.down.to.line"
        case .debt: return "creditcard"
        case .main: return "hand.tap"
        case .response: return "exclamationmark.bubble"
        case .payment: return "dollarsign.circle"
        case .selection: return "hand.point.up.left"
        case .discard: return "trash"
        }
    }

    private var statusText: String {
        guard let game = session.game, let prompt = session.prompt else { return "Waiting for the game to start." }
        if let thinking = session.thinkingPlayerId {
            return "\(session.playerName(thinking)) is thinking…"
        }
        if !session.isViewersPrompt {
            if let last = game.history.last, session.viewerId != nil { return displayText(last.message) }
            return "Waiting for \(session.playerName(prompt.playerId))."
        }
        switch prompt.kind {
        case .draw: return "Draw to start your turn."
        case .main:
            let remaining = Engine.ruleset(game).maxPlaysPerTurn - game.turn.playsUsed
            return remaining > 0 ? "Play up to \(remaining) more card\(remaining == 1 ? "" : "s"), or end your turn." : "No plays left. End your turn."
        case .discard:
            let over = (session.viewer?.hand.count ?? 0) - Engine.ruleset(game).maxHandAtEndTurn
            return "Discard \(over) card\(over == 1 ? "" : "s") to end your turn."
        case .debt:
            return "Repay your debt: tap a card from your hand."
        default:
            // Engine prompts start with the player's name, which reads oddly on your own screen.
            let name = "\(session.playerName(prompt.playerId)): "
            let text = prompt.text.hasPrefix(name) ? String(prompt.text.dropFirst(name.count)) : prompt.text
            return displayText(text.prefix(1).uppercased() + text.dropFirst())
        }
    }

    // MARK: Board

    @ViewBuilder
    private func playerBoard(cardWidth: CGFloat) -> some View {
        if let viewer = session.viewer {
            PlayerBoard(player: viewer, session: session, actions: actions, cardWidth: cardWidth, space: cardSpace)
                .frame(maxHeight: .infinity)
        } else {
            VStack(spacing: 8) {
                Image(systemName: "eye.slash")
                    .font(.title2)
                Text(session.isSpectating ? "You're watching. Every hand stays hidden." : "Hands are hidden until the next player takes the phone.")
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
            }
            .foregroundStyle(SoftWhite(0.6))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // MARK: Action bar

    // A local game's legal actions belong to whoever it's waiting on, which may be a bot.
    private var drawAction: LegalAction? {
        session.isViewersPrompt ? session.legalActions.first { $0.action.type == .draw_cards } : nil
    }
    private var passAction: LegalAction? {
        session.isViewersPrompt ? session.legalActions.first { $0.action.type == .pass_turn } : nil
    }

    private var actionBar: some View {
        HStack(spacing: 8) {
            if session.canUndo {
                Button { session.undo() } label: {
                    Label("Undo", systemImage: "arrow.uturn.backward")
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(SecondaryButtonStyle())
                .frame(width: 52)
                .accessibilityLabel("Undo")
                .accessibilityIdentifier("action.undo")

                Button { session.resetTurn() } label: {
                    Label("Reset Turn", systemImage: "arrow.counterclockwise")
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(SecondaryButtonStyle())
                .frame(width: 52)
                .accessibilityLabel("Reset Turn")
                .accessibilityIdentifier("action.reset")
            }
            if session.showsCoach && session.isViewersPrompt {
                Button {
                    showCoach()
                } label: {
                    Label("Hint", systemImage: "lightbulb.fill")
                        .labelStyle(.iconOnly)
                }
                .buttonStyle(SecondaryButtonStyle())
                .frame(width: 52)
                .accessibilityLabel("Coach hint")
                .accessibilityIdentifier("action.coach")
            }
            if let drawAction {
                Button {
                    actions.perform(drawAction.action)
                } label: {
                    Label("Draw", systemImage: "arrow.down.to.line.compact")
                }
                .buttonStyle(PrimaryButtonStyle(tint: app.preferences.tableStyle.accent))
                .accessibilityIdentifier("action.draw")
            } else if let passAction {
                Button {
                    actions.perform(passAction.action)
                } label: {
                    Label(endTurnLabel, systemImage: "checkmark")
                }
                .buttonStyle(PrimaryButtonStyle(tint: playsExhausted ? app.preferences.tableStyle.accent : Color(hex: 0xC8D3DF)))
                .accessibilityIdentifier("action.pass")
            } else {
                Spacer().frame(height: 50)
            }
        }
        .overlay(alignment: .top) {
            if let coach = ui.coach {
                CoachBubble(hint: coach) { ui.coach = nil }
                    .offset(y: -128)
                    .transition(.scale(scale: 0.9, anchor: .bottom).combined(with: .opacity))
            }
        }
    }

    private var playsExhausted: Bool {
        guard let game = session.game else { return false }
        return game.turn.playsUsed >= Engine.ruleset(game).maxPlaysPerTurn
    }

    private var endTurnLabel: String {
        guard let game = session.game else { return "End Turn" }
        let over = (session.viewer?.hand.count ?? 0) - Engine.ruleset(game).maxHandAtEndTurn
        return over > 0 ? "End Turn (discard \(over))" : "End Turn"
    }

    private func showCoach() {
        guard let game = session.game, let prompt = session.prompt else { return }
        let legal = session.legalActions
        // The thorough coach simulates ahead, which needs every card. Online, other hands are hidden.
        let hard = app.preferences.hardCoach && session is LocalMatch
        Task {
            let hint = await Task.detached(priority: .userInitiated) {
                Coach.hint(game, playerId: prompt.playerId, legalActions: legal, hard: hard)
            }.value
            withAnimation(.snappy) { ui.coach = hint }
        }
    }

    // MARK: Moments

    private var viewerCompleteSets: Int {
        session.viewer.map { Engine.countCompleteSets($0, session.variant) } ?? 0
    }

    /// Shows the card someone else just played. Reduce Effects leaves this out, and the
    /// status line still says what happened.
    private func showSpotlightIfNeeded(previousTop: String?, newTop: String?) {
        guard let newTop, newTop != previousTop,
              let game = session.game, let card = Catalog.lookup(newTop, session.variant),
              card.kind == .action, let actor = actorOfLatestPlay(in: game) else { return }
        if card.actionKind == .just_say_no {
            stampJustSayNo(by: session.playerName(actor))
            return
        }
        guard actor != session.viewerId else { return }
        let spotlight = PlaySpotlight(cardId: newTop, playerName: session.playerName(actor))
        AccessibilityNotification.Announcement("\(spotlight.playerName) played \(CardText.spokenName(card))").post()
        guard !app.preferences.reducedEffects else { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.34, dampingFraction: 0.72)) {
            ui.spotlight = spotlight
        }
        Task {
            try? await Task.sleep(for: .seconds(1.5))
            guard ui.spotlight?.id == spotlight.id else { return }
            withAnimation(.easeOut(duration: 0.25)) { ui.spotlight = nil }
        }
    }

    private func stampJustSayNo(by name: String) {
        let stamp = JustSayNoStamp(playerName: name)
        AccessibilityNotification.Announcement("Just Say No, from \(name)").post()
        guard !app.preferences.reducedEffects else { return }
        withAnimation(reduceMotion ? .easeOut(duration: 0.15) : .spring(response: 0.28, dampingFraction: 0.55)) {
            ui.noStamp = stamp
        }
        Task {
            try? await Task.sleep(for: .seconds(1.3))
            guard ui.noStamp?.id == stamp.id else { return }
            withAnimation(.easeOut(duration: 0.25)) { ui.noStamp = nil }
        }
    }

    /// A Just Say No comes from whoever is in the chain. Anything else, from the current player.
    private func actorOfLatestPlay(in game: GameState) -> PlayerId? {
        if case .counter(let request) = game.pending, let last = request.chain.last { return last.playerId }
        return game.players[game.currentPlayerIndex].id
    }

    private func celebrateIfNeeded(old: Int, new: Int) {
        guard new > old else { return }
        app.feedback(.win)
        let needed = session.game.map { Engine.ruleset($0).winCompleteSets } ?? 3
        ui.setBurstToken += 1
        withAnimation(.snappy) { ui.setBanner = "Set complete! \(new) of \(needed)" }
        let token = ui.setBurstToken
        Task {
            try? await Task.sleep(for: .seconds(1.6))
            guard ui.setBurstToken == token else { return }
            withAnimation(.easeOut(duration: 0.25)) { ui.setBanner = nil }
        }
    }

    @ViewBuilder
    private func tableMoments(wide: Bool, height: CGFloat) -> some View {
        VStack(spacing: 0) {
            ZStack {
                if let spotlight = ui.spotlight {
                    PlaySpotlightView(spotlight: spotlight, variant: session.variant, width: wide ? 260 : min(210, height * 0.22))
                        .transition(reduceMotion ? .opacity : .scale(scale: 0.6).combined(with: .opacity))
                }
                if let stamp = ui.noStamp {
                    JustSayNoStampView(stamp: stamp)
                        .transition(reduceMotion ? .opacity : .scale(scale: 2.2).combined(with: .opacity))
                }
                if let banner = ui.setBanner {
                    ZStack {
                        if cardsAnimate {
                            GoldBurst()
                                .frame(width: 380, height: 380)
                                .id(ui.setBurstToken)
                        }
                        Label(banner, systemImage: "star.fill")
                            .font(.headline.weight(.heavy))
                            .foregroundStyle(Palette.ink)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 11)
                            .background(Capsule().fill(Palette.gold))
                            .shadow(color: Palette.gold.opacity(0.6), radius: 14)
                            .accessibilityIdentifier("table.setBanner")
                    }
                    .transition(.scale(scale: 0.8).combined(with: .opacity))
                }
            }
            .frame(maxHeight: .infinity)
            // Keep clear of the hand and any prompt panel below.
            Spacer().frame(height: height * 0.3)
        }
        .allowsHitTesting(false)
    }

    // MARK: Overlays

    @ViewBuilder
    private var toast: some View {
        if let notice = ui.notice {
            Label(notice, systemImage: "info.circle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .dealGlass(tint: Color.black.opacity(0.5), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(.bottom, 200)
                .padding(.horizontal, 20)
                .transition(.opacity)
                .onTapGesture { ui.notice = nil }
                .task(id: notice) {
                    AccessibilityNotification.Announcement(notice).post()
                    try? await Task.sleep(for: .seconds(3.5))
                    ui.notice = nil
                }
                .accessibilityIdentifier("table.notice")
        } else if let message = session.errorMessage {
            Text(message)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .dealGlass(tint: Palette.danger.opacity(0.65), in: Capsule())
                .padding(.bottom, 170)
                .padding(.horizontal, 20)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .onTapGesture { session.errorMessage = nil }
                .task(id: message) {
                    try? await Task.sleep(for: .seconds(4))
                    session.errorMessage = nil
                }
                .accessibilityIdentifier("table.error")
        }
    }

    @ViewBuilder
    private var pauseOverlay: some View {
        if session.isPaused {
            ZStack {
                Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
                VStack(spacing: 16) {
                    Image(systemName: "pause.circle.fill")
                        .font(.system(size: 64))
                        .foregroundStyle(.white)
                    Text("Game Paused")
                        .font(.title.weight(.bold))
                        .foregroundStyle(.white)
                    if session.canPause {
                        Button("Resume") { session.togglePause() }
                            .buttonStyle(PrimaryButtonStyle())
                            .frame(maxWidth: 220)
                            .accessibilityIdentifier("pause.resume")
                    } else if let message = session.pauseMessage {
                        Text(message)
                            .multilineTextAlignment(.center)
                            .foregroundStyle(SoftWhite(0.8))
                            .padding(.horizontal, 28)
                            .accessibilityIdentifier("pause.message")
                    }
                    if let action = session.pauseAction {
                        Button(action.title, systemImage: action.systemImage, action: action.run)
                            .buttonStyle(PrimaryButtonStyle())
                            .frame(maxWidth: 280)
                            .accessibilityIdentifier("pause.action")
                    }
                    if let deadline = session.pauseDeadline {
                        HStack(spacing: 6) {
                            Text("Seat held for")
                            Text(timerInterval: Date.now...max(deadline, Date.now), countsDown: true)
                                .monospacedDigit()
                                .fontWeight(.bold)
                        }
                        .font(.subheadline)
                        .foregroundStyle(Palette.gold)
                        .accessibilityElement(children: .combine)
                    }
                    Button(leaveLabel, action: onLeave)
                        .buttonStyle(SecondaryButtonStyle())
                        .frame(maxWidth: 220)
                }
            }
            .transition(.opacity)
        }
    }
}

private struct PlaysPips: View {
    var used: Int
    var total: Int

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<max(total, 0), id: \.self) { index in
                Circle()
                    .fill(index < used ? Palette.gold : .white.opacity(0.22))
                    .frame(width: 9, height: 9)
            }
        }
        .animation(.snappy, value: used)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(used) of \(total) plays used")
        .accessibilityAddTraits(.isStaticText)
    }
}

/// The deck and discard, drawn as small stacks.
private struct PileStack: View {
    var session: any TableSession
    var ui: TableUI

    var body: some View {
        HStack(spacing: 8) {
            ZStack {
                ForEach(0..<min(3, session.game?.drawPile.count ?? 0), id: \.self) { index in
                    CardBack(width: 26)
                        .clipShape(RoundedRectangle(cornerRadius: 3))
                        .offset(x: CGFloat(index) * 1.2, y: CGFloat(index) * -1.2)
                }
            }
            .frame(width: 30, height: 40)
            .overlay(alignment: .bottom) {
                Text("\(session.game?.drawPile.count ?? 0)")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 5)
                    .background(Capsule().fill(.black.opacity(0.65)))
                    .offset(y: 5)
                    .contentTransition(.numericText())
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(session.game?.drawPile.count ?? 0) cards in the deck")
            .accessibilityIdentifier("table.deck")

            Button {
                ui.showDiscards = true
            } label: {
                Group {
                    if let top = session.game?.discardPile.last {
                        CardView(cardId: top, variant: session.variant, width: 28)
                    } else {
                        RoundedRectangle(cornerRadius: 3)
                            .strokeBorder(.white.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [3]))
                            .frame(width: 28, height: 39)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Discard pile, \(session.game?.discardPile.count ?? 0) cards")
            .accessibilityHint("Shows every discarded card")
            .accessibilityIdentifier("table.discards")
        }
    }
}

private struct CoachBubble: View {
    var hint: CoachHint
    var onClose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(hint.title, systemImage: "lightbulb.fill")
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(Palette.gold)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(SoftWhite(0.8))
                }
                .accessibilityLabel("Close hint")
            }
            Text(hint.topActionLabel)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
            Text(hint.summary)
                .font(.caption)
                .foregroundStyle(SoftWhite(0.75))
        }
        .padding(12)
        .glassPanel(cornerRadius: 16)
        .accessibilityIdentifier("coach.hint")
    }
}
