import DealEngine
import DealStats
import SwiftUI

struct HomeView: View {
    @ScaledMetric(relativeTo: .largeTitle) private var titleSize = 42.0
    @Environment(\.dynamicTypeSize) private var typeSize
    @Environment(AppModel.self) private var app
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var floating = false
    @State private var practiceOptions = false
    @State private var showRules = false

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            GeometryReader { geometry in
                ScrollView {
                    VStack(spacing: 18) {
                        hero
                        if let active = app.activeGame { continueCard(active) }
                        playButtons
                        dailyCard
                        menuGrid
                    }
                    .padding(.horizontal, 18)
                    .padding(.vertical, 24)
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

    private var hero: some View {
        VStack(spacing: 8) {
            ZStack {
                heroCard("rent_color#1", angle: -24, x: -82, y: 22, lift: 3)
                heroCard("wild_all#1", angle: -11, x: -41, y: 6, lift: -3)
                heroCard("deal_breaker#1", angle: 13, x: 41, y: 6, lift: 4)
                heroCard("money_10#1", angle: 25, x: 82, y: 24, lift: -4)
                heroCard("red_1#1", angle: 0, x: 0, y: 0, lift: 6)
            }
            .frame(height: 210)
            .padding(.top, 10)
            .accessibilityHidden(true)

            Text("Monopoly Deal")
                .font(.system(size: titleSize, weight: .black, design: .rounded))
                .foregroundStyle(LinearGradient(colors: [.white, Palette.gold], startPoint: .top, endPoint: .bottom))
                .shadow(color: .black.opacity(0.4), radius: 8, y: 4)
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text("Collect three sets. Trust no one.")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(SoftWhite(0.74))
        }
    }

    private func heroCard(_ id: String, angle: Double, x: CGFloat, y: CGFloat, lift: CGFloat) -> some View {
        CardView(cardId: id, variant: .classic, width: 116)
            .shadow(color: .black.opacity(0.45), radius: 10, y: 6)
            .rotationEffect(.degrees(angle + (floating ? lift * 0.25 : 0)))
            .offset(x: x, y: y + (floating ? lift : 0))
    }

    private func continueCard(_ active: ActiveGame) -> some View {
        Button {
            app.resumeActive()
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "play.circle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(Palette.gold)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Continue Game")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                    Text("\(active.gameState.players.map(\.name).joined(separator: ", ")) · Turn \(active.gameState.turnCount)")
                        .font(.caption)
                        .foregroundStyle(SoftWhite(0.7))
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.bold))
                    .foregroundStyle(SoftWhite(0.5))
            }
            .padding(14)
            .dealGlass(tint: Palette.gold.opacity(0.18), interactive: true, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.continue")
    }

    private var playButtons: some View {
        VStack(spacing: 10) {
            Button {
                app.path.append(.setup)
            } label: {
                Label("New Game", systemImage: "person.2.fill")
            }
            .buttonStyle(PrimaryButtonStyle())
            .accessibilityIdentifier("home.newGame")

            HStack(spacing: 10) {
                Button {
                    practiceOptions = true
                } label: {
                    Label("Practice", systemImage: "cpu.fill")
                }
                .buttonStyle(SecondaryButtonStyle())
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

                Button {
                    app.path.append(.online)
                } label: {
                    Label("Online", systemImage: "globe")
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("home.online")
            }
        }
    }

    private var dailyCard: some View {
        Button {
            app.startDailyChallenge()
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Palette.gold.opacity(0.2))
                    Image(systemName: app.dailyChallenge.completed ? "checkmark.seal.fill" : "calendar")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Palette.gold)
                }
                .frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Daily Challenge")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                    Text(dailyDetail)
                        .font(.caption)
                        .foregroundStyle(.white)
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .dealGlass(interactive: true, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("home.daily")
    }

    private var dailyDetail: String {
        let challenge = app.dailyChallenge
        if challenge.completed { return "Beaten today in \(challenge.bestTurnCount ?? 0) turns." }
        if let best = challenge.bestTurnCount { return "Finish within \(challenge.targetTurns) turns. Best so far: \(best)." }
        return "Today's deal: finish within \(challenge.targetTurns) turns."
    }

    private var menuGrid: some View {
        let row = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 10)) : AnyLayout(HStackLayout(spacing: 10))
        return VStack(spacing: 10) {
            row {
                menuTile("Saved Games", icon: "square.stack.fill", id: "home.saved") { app.path.append(.saved) }
                menuTile("Stats", icon: "chart.bar.fill", id: "home.stats") { app.path.append(.stats) }
            }
            row {
                menuTile("Rules", icon: "book.fill", id: "home.rules") { showRules = true }
                menuTile("Settings", icon: "gearshape.fill", id: "home.settings") { app.path.append(.settings) }
            }
        }
    }

    private func menuTile(_ title: String, icon: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: icon)
        }
        .buttonStyle(SecondaryButtonStyle())
        .accessibilityIdentifier(id)
    }
}

// MARK: Setup

struct SetupView: View {
    @Environment(AppModel.self) private var app

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
        return VStack(spacing: 8) {
            HStack(spacing: 8) {
                PlayerAvatar(name: app.setup.names[index], isBot: app.setup.controllers[index] == .bot)
                TextField("Player \(index + 1)", text: $app.setup.names[index])
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .font(.body.weight(.semibold))
                    .foregroundStyle(.white)
                    .accessibilityIdentifier("setup.name.\(index)")
                Picker("Controlled by", selection: $app.setup.controllers[index]) {
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

    var body: some View {
        @Bindable var app = app
        Form {
            Section("Table") {
                Picker("Table Style", selection: $app.preferences.tableStyle) {
                    ForEach(TableTheme.allCases, id: \.self) { Text($0.label).tag($0) }
                }
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
                    rule("Property cards, including Wilds, can't be banked. A complete set needs at least one standard Property.")
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
