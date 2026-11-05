import DealEngine
import DealStats
import SwiftUI

struct HomeView: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floating = false
    @State private var practiceOptions = false
    @State private var showRules = false

    var body: some View {
        ZStack {
            HomeBackground()
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 16) {
                        hero(width: min(geometry.size.width, 560) - 32)
                        newGameButton
                        modeTiles
                        if let active = app.activeGame { continuePanel(active) }
                        menuRow
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
        }
        .navigationBarHidden(true)
        .onAppear {
            app.reloadStoredData()
            if !reduceMotion && !app.preferences.reducedEffects {
                withAnimation(.easeInOut(duration: 3.2).repeatForever(autoreverses: true)) { floating = true }
            }
        }
        .sheet(isPresented: $showRules) { RulesView() }
    }

    // MARK: Hero

    private func hero(width: CGFloat) -> some View {
        let scale = min(1, width * 0.62 / 250)
        return ZStack(alignment: .bottomLeading) {
            HomeSkyline()
                .frame(height: 150 * scale)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.horizontal, -16)

            HomeCardHand(floating: floating)
                .scaleEffect(scale)
                .frame(width: 170 * scale, height: 200 * scale)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .padding(.bottom, 34)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                HomeLogo()
                    .scaleEffect(scale, anchor: .topLeading)
                    .frame(width: 250 * scale, height: 220 * scale, alignment: .topLeading)
                    .accessibilityRepresentation {
                        Text("Monopoly Deal")
                            .font(.largeTitle)
                            .accessibilityAddTraits(.isHeader)
                    }
                // A soft dark scrim keeps the tagline readable over the skyline's lit windows.
                Text("Collect three sets. Trust no one.")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Capsule().fill(.black.opacity(0.35)))
                    .padding(.leading, -8)
            }
            .padding(.bottom, 10)
        }
        .frame(height: 220 * scale + 64)
    }

    // MARK: Play

    private var newGameButton: some View {
        Button {
            app.path.append(.setup)
        } label: {
            HStack(spacing: 16) {
                Image(systemName: "play.fill")
                    .font(.system(size: 30, weight: .black))
                Text("New Game")
                    .font(.system(.largeTitle, design: .rounded, weight: .heavy))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .foregroundStyle(HomePalette.buttonInk)
            .padding(.horizontal, 24)
            .frame(maxWidth: .infinity, minHeight: 76)
            .background(
                Capsule()
                    .fill(LinearGradient(colors: [HomePalette.buttonGold, HomePalette.buttonGoldDeep], startPoint: .top, endPoint: .bottom))
                    .shadow(color: HomePalette.buttonGoldDeep.opacity(0.6), radius: 14, y: 4)
            )
            .overlay(Capsule().strokeBorder(.white.opacity(0.55), lineWidth: 1.5))
            .contentShape(Capsule())
        }
        .buttonStyle(HomePressStyle())
        .accessibilityIdentifier("home.newGame")
    }

    private var modeTiles: some View {
        let row = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(spacing: 10))
        let daily = app.dailyChallenge
        return VStack(spacing: 10) {
            row {
                practiceTile
                onlineTile
            }
            row {
                nearbyTile
                dailyTile(daily)
            }
        }
        .fixedSize(horizontal: false, vertical: !typeSize.isAccessibilitySize)
    }

    private var practiceTile: some View {
        Button {
            practiceOptions = true
        } label: {
            HomeModeTile(title: "Practice", detail: "Learn & refine", icon: "person.3.fill", colors: HomePalette.practice) { EmptyView() }
        }
        .buttonStyle(HomePressStyle())
        .accessibilityIdentifier("home.practice")
        .confirmationDialog("Practice Against a Bot", isPresented: $practiceOptions, titleVisibility: .visible) {
            Button("Classic, Easy") { app.startPractice() }
                .accessibilityIdentifier("practice.classicEasy")
            Button("Classic, Hard") { app.startPractice(hard: true) }
            Button("No Mercy, Easy") { app.startPractice(variant: .no_mercy) }
                .accessibilityIdentifier("practice.noMercyEasy")
            Button("No Mercy, Hard") { app.startPractice(variant: .no_mercy, hard: true) }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var onlineTile: some View {
        Button {
            app.path.append(.online)
        } label: {
            HomeModeTile(title: "Online", detail: "Play with friends", icon: "globe", colors: HomePalette.online, showsLiveDot: true) { EmptyView() }
        }
        .buttonStyle(HomePressStyle())
        .accessibilityIdentifier("home.online")
    }

    /// Phones close together, with no internet. iOS only.
    private var nearbyTile: some View {
        Button {
            app.path.append(.nearby)
        } label: {
            HomeModeTile(title: "Nearby", detail: "No internet needed", icon: "antenna.radiowaves.left.and.right", colors: HomePalette.nearby) { EmptyView() }
        }
        .buttonStyle(HomePressStyle())
        .accessibilityIdentifier("home.nearby")
    }

    private func dailyTile(_ daily: DailyChallenge) -> some View {
        Button {
            app.startDailyChallenge()
        } label: {
            HomeModeTile(
                title: "Daily Challenge",
                detail: daily.completed ? "Beaten in \(daily.bestTurnCount ?? 0) turns" : "Win within \(daily.targetTurns) turns",
                icon: daily.completed ? "checkmark.seal.fill" : "calendar",
                colors: HomePalette.daily
            ) {
                Image(systemName: daily.completed ? "checkmark" : "sparkle")
                    .font(.system(size: 15, weight: .black))
                    .foregroundStyle(HomePalette.buttonInk)
                    .frame(width: 30, height: 30)
                    .background(Circle().fill(HomePalette.buttonGold))
                    .overlay(Circle().strokeBorder(.white.opacity(0.6), lineWidth: 1))
            }
        }
        .buttonStyle(HomePressStyle())
        .accessibilityLabel("Daily Challenge")
        .accessibilityValue(dailyDetail)
        .accessibilityIdentifier("home.daily")
    }

    private var dailyDetail: String {
        let challenge = app.dailyChallenge
        if challenge.completed { return "Beaten today in \(challenge.bestTurnCount ?? 0) turns." }
        if let best = challenge.bestTurnCount { return "Win within \(challenge.targetTurns) turns. Best so far: \(best)." }
        return "Today's deal: win within \(challenge.targetTurns) turns."
    }

    // MARK: Continue

    private func continuePanel(_ active: ActiveGame) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "clock")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(SoftWhite(0.85))
                Text("Continue Playing")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.white)
                    .accessibilityAddTraits(.isHeader)
                Spacer(minLength: 6)
                Button {
                    app.path.append(.saved)
                } label: {
                    HStack(spacing: 4) {
                        Text("See All")
                        Image(systemName: "chevron.right").font(.caption.weight(.bold))
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(SoftWhite(0.75))
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("See All Saved Games")
            }

            Button {
                app.resumeActive()
            } label: {
                HStack(spacing: 14) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(.black.opacity(0.25))
                        ZStack {
                            CardView(cardId: "wild_all#1", variant: .classic, width: 30).rotationEffect(.degrees(-16)).offset(x: -12)
                            CardView(cardId: "deal_breaker#1", variant: .classic, width: 30).rotationEffect(.degrees(-2))
                            CardView(cardId: "red_1#1", variant: .classic, width: 30).rotationEffect(.degrees(14)).offset(x: 12)
                        }
                    }
                    .frame(width: 72, height: 64)
                    .accessibilityHidden(true)

                    VStack(alignment: .leading, spacing: 3) {
                        Text("\(active.gameState.resolvedVariant.label) Game")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Text("\(active.gameState.players.count) players · Turn \(active.gameState.turnCount)")
                            .font(.subheadline)
                            .foregroundStyle(SoftWhite(0.72))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    Spacer(minLength: 6)
                    Label("Resume", systemImage: "play.fill")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 44)
                        .background(
                            Capsule().fill(LinearGradient(colors: [HomePalette.resume.0, HomePalette.resume.1], startPoint: .top, endPoint: .bottom))
                        )
                        .overlay(Capsule().strokeBorder(.white.opacity(0.25), lineWidth: 1))
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.black.opacity(0.12)))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.12), lineWidth: 1))
                .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(HomePressStyle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Continue Game")
            .accessibilityValue("\(active.gameState.players.map(\.name).joined(separator: ", ")), turn \(active.gameState.turnCount)")
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("home.continue")
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(HomePalette.panel))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(.white.opacity(0.14), lineWidth: 1))
    }

    // MARK: Menu

    private var menuRow: some View {
        let row = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        return row {
            menuTile("Saved Games", icon: "archivebox.fill", id: "home.saved") { app.path.append(.saved) }
            menuTile("Stats", icon: "chart.bar.fill", id: "home.stats") { app.path.append(.stats) }
            menuTile("Rules", icon: "book.fill", id: "home.rules") { showRules = true }
            menuTile("Settings", icon: "gearshape.fill", id: "home.settings") { app.path.append(.settings) }
        }
        .fixedSize(horizontal: false, vertical: !typeSize.isAccessibilitySize)
    }

    private func menuTile(_ title: String, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HomeMenuTile(title: title, icon: icon)
        }
        .buttonStyle(HomePressStyle())
        .accessibilityIdentifier(id)
    }
}

// MARK: Setup

struct SetupView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        @Bindable var app = app
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            ScrollView {
                VStack(spacing: 18) {
                    VStack(spacing: 8) {
                        SectionTitle(text: "Game")
                        Picker("Game", selection: $app.setup.variant) {
                            ForEach(GameVariant.allCases, id: \.self) { Text($0.label).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("setup.variant")
                        Text(app.setup.variant == .classic
                            ? "The original: 106 cards and three sets to win."
                            : "115 cards, debt chips, Shacks and far nastier action cards.")
                            .font(.footnote)
                            .foregroundStyle(SoftWhite(0.7))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    VStack(spacing: 8) {
                        SectionTitle(text: "Players")
                        Picker("Number of players", selection: $app.setup.playerCount) {
                            ForEach(2...5, id: \.self) { Text("\($0)").tag($0) }
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("setup.count")
                        ForEach(0..<app.setup.playerCount, id: \.self) { index in
                            playerRow(index)
                        }
                    }

                    VStack(spacing: 8) {
                        SectionTitle(text: "Pace")
                        Picker("Turn timer", selection: $app.setup.speedMode) {
                            Text("No Limit").tag(false)
                            Text("Speed").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("setup.speed")
                        Text(app.setup.speedMode
                            ? "When time runs out, a bot moves for you."
                            : "A clock shows how long each turn is taking, with no limit.")
                            .font(.footnote)
                            .foregroundStyle(SoftWhite(0.7))
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if app.setup.speedMode {
                            TurnTimerSlider(seconds: app.setup.speedSeconds) { app.setup.speedSeconds = $0 }
                        }
                        Picker("Match length", selection: $app.setup.bestOfThree) {
                            Text("Single Game").tag(false)
                            Text("Best of Three").tag(true)
                        }
                        .pickerStyle(.segmented)
                        .accessibilityIdentifier("setup.bestOf")
                    }

                    if app.setup.variant == .classic && app.preferences.customRulesEnabled {
                        VStack(spacing: 8) {
                            SectionTitle(text: "Custom Rules")
                            ruleStepper("Sets to win", value: $app.setup.winCompleteSets, range: 2...5)
                            ruleStepper("Hand limit", value: $app.setup.maxHandAtEndTurn, range: 4...12)
                            ruleStepper("Plays per turn", value: $app.setup.maxPlaysPerTurn, range: 1...6)
                        }
                    }

                    Button {
                        app.startFromSetup()
                    } label: {
                        Label("Deal the Cards", systemImage: "suit.spade.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("setup.start")
                }
                .padding(18)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("New Game")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func playerRow(_ index: Int) -> some View {
        @Bindable var app = app
        let line = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        return VStack(spacing: 8) {
            line {
                PlayerAvatar(name: app.setup.names[index], isBot: app.setup.controllers[index] == .bot)
                TextField(app.setup.controllers[index] == .bot ? "Random bot name" : "Player \(index + 1)", text: $app.setup.names[index])
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .accessibilityIdentifier("setup.name.\(index)")
                Picker("Controlled by", selection: Binding(
                    get: { app.setup.controllers[index] },
                    set: { app.setup.setController($0, at: index) }
                )) {
                    Text("Human").tag(PlayerController.human)
                    Text("Bot").tag(PlayerController.bot)
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("setup.controller.\(index)")
            }
            if app.setup.controllers[index] == .bot {
                Picker("Difficulty", selection: $app.setup.difficulties[index]) {
                    Text("Easy").tag(BotDifficulty.easy)
                    Text("Hard").tag(BotDifficulty.hard)
                }
                .pickerStyle(.segmented)
            }
        }
        .padding(12)
        .glassPanel(cornerRadius: 16)
    }

    private func ruleStepper(_ title: String, value: Binding<Int>, range: ClosedRange<Int>) -> some View {
        Stepper("\(title): \(value.wrappedValue)", value: value, in: range)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(12)
            .glassPanel(cornerRadius: 14)
    }
}

// MARK: Saved games

struct SavedGamesView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    var duringGame: Bool

    @State private var renaming: SavedSlot?
    @State private var newName = ""
    @State private var deleting: SavedSlot?
    @State private var overwriting: SavedSlot?
    @State private var message: String?

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            ScrollView {
                VStack(spacing: 10) {
                    if duringGame {
                        Button {
                            message = app.saveToNewSlot() ? "Game saved." : "All 5 slots are full. Overwrite one below."
                        } label: {
                            Label("Save to a New Slot", systemImage: "square.and.arrow.down")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("saves.new")
                    }
                    if let message {
                        Text(message)
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(SoftWhite(0.85))
                    }
                    if app.savedSlots.isEmpty {
                        ContentUnavailableView("No Saved Games", systemImage: "square.stack", description: Text("Save a game from the table menu to keep up to 5 at once."))
                            .padding(.top, 50)
                    }
                    ForEach(app.savedSlots) { slot in slotRow(slot) }
                }
                .padding(18)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Saved Games")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if duringGame {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
        .onAppear { app.savedSlots = app.store.savedSlots() }
        .alert("Rename Slot", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Rename") { if let renaming { app.renameSlot(renaming, name: newName) } }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Delete This Save?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), presenting: deleting) { slot in
            Button("Delete", role: .destructive) { app.deleteSlot(slot) }
            Button("Cancel", role: .cancel) {}
        } message: { slot in
            Text("\(slot.name) will be gone for good.")
        }
        .alert("Overwrite This Save?", isPresented: Binding(get: { overwriting != nil }, set: { if !$0 { overwriting = nil } }), presenting: overwriting) { slot in
            Button("Overwrite", role: .destructive) { app.overwriteSlot(slot) }
            Button("Cancel", role: .cancel) {}
        } message: { slot in
            Text("\(slot.name) will be replaced with the current game.")
        }
    }

    private func slotRow(_ slot: SavedSlot) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(slot.name)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                Text("\(slot.gameState.resolvedVariant.label) · \(Date(timeIntervalSince1970: slot.updatedAt / 1000).formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption)
                    .foregroundStyle(SoftWhite(0.65))
            }
            Spacer(minLength: 6)
            if !duringGame {
                Button("Load") {
                    app.loadSlot(slot)
                }
                .buttonStyle(.glass)
                .accessibilityIdentifier("saves.load")
            }
            Menu {
                if duringGame {
                    Button("Save Over This", systemImage: "square.and.arrow.down") { overwriting = slot }
                }
                Button("Rename", systemImage: "pencil") {
                    newName = slot.name
                    renaming = slot
                }
                Button("Delete", systemImage: "trash", role: .destructive) { deleting = slot }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
                    .foregroundStyle(SoftWhite(0.85))
                    .frame(width: 40, height: 40)
            }
            .accessibilityLabel("More for \(slot.name)")
        }
        .padding(12)
        .glassPanel(cornerRadius: 16)
    }
}

// MARK: Settings

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var confirmClear = false
    @State private var feedback = ""
    @Environment(\.openURL) private var openURL

    private var counters: AchievementState.Counters { app.achievements.counters }

    private func unlockableRow(_ label: String, unlocked: Bool, needs: String?, selected: Bool, choose: @escaping () -> Void) -> some View {
        Button(action: choose) {
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text(label).foregroundStyle(unlocked ? Color.white : Color.white.opacity(0.55))
                    if !unlocked, let needs {
                        Text(needs).font(.caption).foregroundStyle(SoftWhite(0.6))
                    }
                }
                Spacer()
                if selected {
                    Image(systemName: "checkmark").foregroundStyle(Palette.gold).accessibilityLabel("Selected")
                } else if !unlocked {
                    Image(systemName: "lock.fill").foregroundStyle(SoftWhite(0.55)).accessibilityLabel("Locked")
                }
            }
        }
        .disabled(!unlocked)
    }

    private func sendFeedback() {
        var parts = URLComponents()
        parts.scheme = "mailto"
        parts.path = "tblsemail@gmail.com"
        parts.queryItems = [
            URLQueryItem(name: "subject", value: "Monopoly Deal feedback"),
            URLQueryItem(name: "body", value: feedback.trimmingCharacters(in: .whitespacesAndNewlines) + "\n\n---\nSent from the iOS app"),
        ]
        if let url = parts.url { openURL(url) }
    }

    var body: some View {
        @Bindable var app = app
        Form {
            Section("Table Style") {
                ForEach(TableTheme.allCases, id: \.self) { style in
                    unlockableRow(style.label, unlocked: style.isUnlocked(counters), needs: style.unlockRule?.needs, selected: app.preferences.tableStyle == style) {
                        app.preferences.tableStyle = style
                    }
                }
            }
            Section("Card Back") {
                ForEach(CardBackStyle.allCases, id: \.self) { back in
                    unlockableRow(back.label, unlocked: back.isUnlocked(counters), needs: back.unlockRule?.needs, selected: app.preferences.cardBack == back) {
                        app.preferences.cardBack = back
                    }
                }
            }
            Section("Table") {
                Toggle("Reduce Effects", isOn: $app.preferences.reducedEffects)
            }
            Section("Feedback") {
                Toggle("Sound", isOn: $app.preferences.soundEnabled)
                Toggle("Haptics", isOn: $app.preferences.hapticsEnabled)
            }
            Section {
                Toggle("Confirm Risky Plays", isOn: $app.preferences.confirmRiskyActions)
                Toggle("Coach Hints", isOn: $app.preferences.coachEnabled)
                    .accessibilityIdentifier("settings.coach")
                if app.preferences.coachEnabled {
                    Toggle("Thorough Coach", isOn: $app.preferences.hardCoach)
                }
                Toggle("Custom Classic Rules", isOn: $app.preferences.customRulesEnabled)
            } header: {
                Text("Gameplay")
            } footer: {
                Text("Custom rules add sets to win, hand limit and plays per turn to New Game. No Mercy always uses the official rules.")
            }
            Section {
                TextField("Bugs, ideas, anything", text: $feedback, axis: .vertical)
                    .lineLimit(3...8)
                    .accessibilityIdentifier("settings.feedback")
                Button("Email the Developer") { sendFeedback() }
                    .disabled(feedback.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } header: {
                Text("Send Feedback")
            } footer: {
                Text("Opens your email app with the message ready to send.")
            }
            Section("Data") {
                Button("Clear Stats and History", role: .destructive) { confirmClear = true }
            }
            Section("About") {
                LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
            }
        }
        .scrollContentBackground(.hidden)
        .background(TableBackground(style: app.preferences.tableStyle))
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Clear all stats, match history, achievements and today's challenge?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear Everything", role: .destructive) { app.clearStats() }
            Button("Cancel", role: .cancel) {}
        }
    }
}

// MARK: Rules

struct RulesView: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Your Turn") {
                    rule("Draw 2 cards, or 5 if your hand is empty.")
                    rule("Play up to 3 cards: to your Bank, your properties, or as actions.")
                    rule("End with no more than 7 cards. Discard any extra.")
                    rule("The first player with 3 complete sets of different colors wins.")
                }
                Section("Sets and Rent") {
                    ForEach(PropertyColor.allCases, id: \.self) { color in
                        HStack {
                            RoundedRectangle(cornerRadius: 3).fill(color.tint).frame(width: 16, height: 22)
                            Text(color.label).font(.subheadline.weight(.semibold))
                            Spacer()
                            Text("Set of \(color.setSize)").font(.caption).foregroundStyle(.secondary)
                            Text(color.rentScale.map { "$\($0)" }.joined(separator: " / "))
                                .font(.footnote.monospacedDigit())
                                .frame(minWidth: 100, alignment: .trailing)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
                Section("Classic") {
                    rule("Property cards, including Wilds, can't be banked. Any-color Wilds can't complete a set on their own.")
                    rule("Two-color Rent charges everyone. Any-color Rent charges one player.")
                    rule("Each complete set except Railroads and Utilities can hold one House and one Hotel. A Hotel needs a House.")
                    rule("An any-color Wild on its own earns no rent.")
                    rule("If you can't pay in full, you pay everything you have.")
                }
                Section("No Mercy") {
                    rule("Everyone starts with 3 debt chips. If you can't pay in full, you pay all you can and take a chip.")
                    rule("After drawing, repay debts before other plays. Each repayment card uses one of your plays.")
                    rule("Every-color Wilds can't complete a set on their own or be used as payment.")
                    rule("Shacks add $5 rent and move with the property they're on. A complete set can hold one Shack.")
                    rule("Each player gets their own Just Say No chance against effects that hit everyone.")
                }
                Section("Interruptions") {
                    rule("Just Say No: cancel an action against you, or answer another player's Just Say No.")
                    rule("Payment: the target chooses which Bank cards and properties to pay with, and gets no change back.")
                    rule("Complete sets are safe from Sly Deal and Forced Deal, but not from Deal Breaker.")
                }
            }
            .navigationTitle("Rules")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    private func rule(_ text: String) -> some View {
        Text(text).font(.subheadline)
    }
}
