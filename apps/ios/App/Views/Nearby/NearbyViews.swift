import DealEngine
import DealNearby
import DealStats
import SwiftUI

/// Host a table for phones close by, or join one. No internet is needed.
struct NearbyHomeView: View {
    @Environment(AppModel.self) private var app
    @State private var confirmDiscard = false

    private var nameIsSet: Bool { !app.preferences.onlineName.trimmingCharacters(in: .whitespaces).isEmpty }
    private var browser: NearbyGuest? { app.nearbyBrowser }

    /// This phone's seat at a table it stepped away from.
    private var heldSeat: NearbyGuestSession? { app.nearbyGuest == nil ? browser?.session : nil }

    private var tables: [NearbyTableAd] {
        (browser?.tables ?? []).filter { $0.tableId != app.savedNearbyTable?.tableId }
    }

    var body: some View {
        @Bindable var app = app
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 8) {
                        SectionTitle(text: "Your Name")
                        TextField("Name", text: $app.preferences.onlineName)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(14)
                            .glassPanel(cornerRadius: 14)
                            .accessibilityIdentifier("nearby.name")
                            .onChange(of: app.preferences.onlineName) { browser?.name = app.preferences.onlineName }
                    }
                    if !nameIsSet {
                        Text("Enter your name to host or join a table.")
                            .font(.footnote)
                            .foregroundStyle(SoftWhite(0.7))
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if let held = heldSeat { heldSeatCard(held) }

                    VStack(spacing: 8) {
                        SectionTitle(text: "Host a Table")
                        if let saved = app.savedNearbyTable {
                            VStack(spacing: 10) {
                                Text(saved.game == nil ? "Your table is still open" : "Your game is waiting")
                                    .font(.headline.weight(.heavy))
                                    .foregroundStyle(.white)
                                Text(saved.seats.map(\.name).joined(separator: ", "))
                                    .font(.footnote)
                                    .foregroundStyle(SoftWhite(0.75))
                                HStack(spacing: 8) {
                                    Button("End Table", role: .destructive) { confirmDiscard = true }
                                        .buttonStyle(SecondaryButtonStyle())
                                    Button("Continue") { app.hostNearby(continuing: true) }
                                        .buttonStyle(PrimaryButtonStyle())
                                        .accessibilityIdentifier("nearby.continue")
                                }
                            }
                            .padding(14)
                            .glassPanel()
                        } else {
                            Button {
                                app.hostNearby(continuing: false)
                            } label: {
                                Label("Host a Table", systemImage: "antenna.radiowaves.left.and.right")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .disabled(!nameIsSet)
                            .accessibilityIdentifier("nearby.host")
                        }
                    }

                    VStack(spacing: 8) {
                        SectionTitle(text: "Tables Close By")
                        if tables.isEmpty {
                            HStack(spacing: 10) {
                                ProgressView().tint(.white)
                                Text("Looking for tables. Ask the host to open the Nearby screen and tap Host a Table.")
                                    .font(.footnote)
                                    .foregroundStyle(SoftWhite(0.8))
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .glassPanel(cornerRadius: 14)
                        }
                        ForEach(tables) { table in
                            HStack(spacing: 12) {
                                PlayerAvatar(name: table.hostName, isBot: false)
                                Text("\(table.hostName)'s Table")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                Spacer()
                                Button(heldSeat?.tableId == table.tableId ? "Rejoin" : "Join") { app.joinNearby(table) }
                                    .buttonStyle(PrimaryButtonStyle())
                                    .frame(maxWidth: 110)
                                    .disabled(!nameIsSet)
                                    .accessibilityIdentifier("nearby.join")
                            }
                            .padding(12)
                            .glassPanel(cornerRadius: 16)
                        }
                    }

                    if let refusal = browser?.refusal {
                        Label(refusal.localizedDescription, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .glassPanel(cornerRadius: 14, tint: Palette.danger.opacity(0.45))
                            .accessibilityIdentifier("nearby.error")
                    }

                    Text("Phones connect over Bluetooth and Wi-Fi directly, with no internet or router. Keep both turned on, and stay within about 10 metres. Everyone needs this same version of the app.")
                        .font(.footnote)
                        .foregroundStyle(SoftWhite(0.65))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(18)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Nearby")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { app.openNearbyScreen() }
        .onDisappear { app.closeNearbyScreen() }
        .confirmationDialog("End this table for everyone?", isPresented: $confirmDiscard, titleVisibility: .visible) {
            Button("End Table", role: .destructive) { app.discardNearbyTable() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func heldSeatCard(_ held: NearbyGuestSession) -> some View {
        let table = tables.first { $0.tableId == held.tableId }
        return VStack(spacing: 8) {
            SectionTitle(text: "Your Seat")
            VStack(spacing: 10) {
                Text("\(held.hostName)'s Table")
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(.white)
                Text(table == nil ? "Looking for \(held.hostName)'s phone." : "Your seat is waiting.")
                    .font(.footnote)
                    .foregroundStyle(SoftWhite(0.75))
                HStack(spacing: 8) {
                    Button("Give Up Seat", role: .destructive) { app.leaveNearbyTable() }
                        .buttonStyle(SecondaryButtonStyle())
                    Button("Rejoin") { if let table { app.joinNearby(table) } }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(table == nil)
                        .accessibilityIdentifier("nearby.rejoin")
                }
            }
            .padding(14)
            .glassPanel()
        }
    }
}

/// The host's screens, from the lobby to the rematch.
struct NearbyHostGameView: View {
    @Environment(AppModel.self) private var app
    var match: NearbyHostMatch
    @State private var replay: ReplayRequest?
    @State private var confirmClose = false

    var body: some View {
        ZStack {
            if let summary = match.summary, let game = match.game {
                PostGameView(
                    summary: summary,
                    game: game,
                    unlocked: match.unlocked,
                    primaryTitle: "Rematch",
                    newUnlocks: match.newUnlocks,
                    onWatchReplay: match.host.table.log.map { log in { replay = ReplayRequest(log: GameLog(initial: log.initial, actions: log.actions)) } },
                    closeTitle: "Close Table",
                    onPrimary: { match.host.startGame() },
                    onClose: { confirmClose = true }
                )
            } else if match.game != nil {
                TableView(session: match, extras: AnyView(NearbyBar(seats: match.view.seats, linked: true, isHost: true))) {
                    app.exitNearbyHost()
                }
            } else {
                NearbyLobbyView(view: match.view, isHost: true, host: match.host, onBack: { app.exitNearbyHost() }, onClose: { confirmClose = true })
            }
        }
        .keepsScreenAwake()
        .fullScreenCover(item: $replay) { request in
            ReplayView(log: request.log)
                .environment(app)
        }
        .confirmationDialog("Close the table for everyone?", isPresented: $confirmClose, titleVisibility: .visible) {
            Button("Close Table", role: .destructive) { app.closeNearbyTable() }
                .accessibilityIdentifier("nearby.closeConfirm")
            Button("Cancel", role: .cancel) {}
        }
    }
}

/// A guest's screens, from the lobby to the rematch.
struct NearbyGuestGameView: View {
    @Environment(AppModel.self) private var app
    var match: NearbyGuestMatch
    @State private var replay: ReplayRequest?
    @State private var confirmLeave = false

    var body: some View {
        ZStack {
            if let refusal = match.guest.refusal {
                NearbyMessageView(symbol: "door.left.hand.closed", title: "Not at the Table", message: refusal.localizedDescription) {
                    app.exitNearbyGuest()
                }
            } else if let view = match.view {
                if let summary = match.summary, let game = match.game, view.isFinished {
                    PostGameView(
                        summary: summary,
                        game: game,
                        unlocked: match.unlocked,
                        primaryTitle: nil,
                        newUnlocks: match.newUnlocks,
                        onWatchReplay: view.log.map { log in { replay = ReplayRequest(log: GameLog(initial: log.initial, actions: log.actions)) } },
                        closeTitle: "Leave Table",
                        onPrimary: {},
                        onClose: { confirmLeave = true }
                    )
                    .overlay(alignment: .top) {
                        Text("\(match.hostName) can start a rematch.")
                            .font(.footnote.weight(.bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .glassPanel(cornerRadius: 14)
                            .padding(.top, 8)
                    }
                } else if view.started {
                    TableView(session: match, extras: AnyView(NearbyBar(seats: view.seats, linked: match.isLinked, isHost: false))) {
                        app.exitNearbyGuest()
                    }
                } else {
                    NearbyLobbyView(view: view, isHost: false, host: nil, linked: match.isLinked, onBack: { app.exitNearbyGuest() }, onClose: { confirmLeave = true })
                }
            } else {
                TableBackground(style: app.preferences.tableStyle)
                VStack(spacing: 16) {
                    ProgressView("Joining \(match.hostName)'s table").tint(.white).foregroundStyle(.white)
                    Button("Cancel") { app.exitNearbyGuest() }
                        .buttonStyle(SecondaryButtonStyle())
                        .frame(maxWidth: 200)
                }
            }
        }
        .keepsScreenAwake()
        .onChange(of: match.view) { match.observeChange() }
        .fullScreenCover(item: $replay) { request in
            ReplayView(log: request.log)
                .environment(app)
        }
        .confirmationDialog("Give up your seat? A bot plays it from here.", isPresented: $confirmLeave, titleVisibility: .visible) {
            Button("Leave Table", role: .destructive) { app.leaveNearbyTable() }
                .accessibilityIdentifier("nearby.leaveConfirm")
            Button("Cancel", role: .cancel) {}
        }
    }
}

/// Seats and settings before the deal.
private struct NearbyLobbyView: View {
    @Environment(AppModel.self) private var app
    var view: NearbyView
    var isHost: Bool
    var host: NearbyHost?
    var linked = true
    var onBack: () -> Void
    var onClose: () -> Void

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            ScrollView {
                VStack(spacing: 14) {
                    header
                    roster
                    if let host { hostControls(host) } else { guestNote }
                    Button(isHost ? "Close Table" : "Leave Table", role: .destructive, action: onClose)
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("nearby.close")
                }
                .padding(18)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityIdentifier("nearby.lobby")
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack {
                Button(action: onBack) {
                    Image(systemName: "chevron.backward")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .dealGlass(interactive: true, in: Circle())
                }
                .accessibilityLabel("Back")
                .accessibilityIdentifier("nearby.back")
                Spacer()
                NearbyLinkPill(linked: linked, isHost: isHost)
            }
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(Palette.gold)
            Text("\(view.hostSeat?.name ?? "Host")'s Table")
                .font(.title.weight(.black))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            Text(isHost ? "Phones close by can see this table on their Nearby screen." : "You're in. The host deals when everyone's here.")
                .font(.footnote)
                .foregroundStyle(SoftWhite(0.75))
                .multilineTextAlignment(.center)
        }
    }

    private var roster: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: "Players (\(view.seats.count)/\(Nearby.maxSeats))")
            ForEach(view.seats) { seat in
                HStack(spacing: 10) {
                    PlayerAvatar(name: seat.name, isBot: seat.isBot)
                    Text(seat.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                    if seat.isHost {
                        Image(systemName: "crown.fill")
                            .font(.caption2)
                            .foregroundStyle(Palette.gold)
                            .accessibilityLabel("Host")
                    }
                    if seat.id == view.yourSeatId {
                        Text("You").font(.caption2.weight(.heavy)).foregroundStyle(SoftWhite(0.6))
                    }
                    Spacer()
                    if seat.isBot {
                        Text(seat.botDifficulty == .hard ? "Hard Bot" : "Easy Bot")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(SoftWhite(0.75))
                    }
                    if let host, !seat.isHost {
                        Button {
                            host.remove(seat.id)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(SoftWhite(0.6))
                        }
                        .accessibilityLabel("Remove \(seat.name)")
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(14)
        .glassPanel(cornerRadius: 18)
    }

    private func hostControls(_ host: NearbyHost) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: "Table Settings")
            Picker("Game", selection: Binding(get: { view.variant }, set: { host.setVariant($0) })) {
                ForEach(GameVariant.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("nearby.variant")
            Menu {
                Button("Easy Bot") { host.addBot(.easy) }
                Button("Hard Bot") { host.addBot(.hard) }
            } label: {
                Label("Add a Bot", systemImage: "cpu.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(view.seats.count >= Nearby.maxSeats)
            .accessibilityIdentifier("nearby.addBot")
            Button {
                app.feedback(.tap)
                host.startGame()
            } label: {
                Label("Deal", systemImage: "play.fill")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(view.seats.count < 2)
            .accessibilityIdentifier("nearby.start")
            if view.seats.count < 2 {
                Text("Waiting for another phone to join, or add a bot.")
                    .font(.footnote)
                    .foregroundStyle(SoftWhite(0.7))
            }
        }
        .padding(14)
        .glassPanel(cornerRadius: 18)
    }

    private var guestNote: some View {
        HStack(spacing: 10) {
            ProgressView().tint(.white)
            Text("Playing \(view.variant.label). Waiting for \(view.hostSeat?.name ?? "the host") to deal.")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.white)
            Spacer(minLength: 0)
        }
        .padding(14)
        .glassPanel(cornerRadius: 18)
    }
}

/// The strip above the table: the link, and who's away.
private struct NearbyBar: View {
    var seats: [NearbySeat]
    var linked: Bool
    var isHost: Bool

    var body: some View {
        HStack(spacing: 8) {
            NearbyLinkPill(linked: linked, isHost: isHost)
            let away = seats.filter(\.isAway).map(\.name)
            if !away.isEmpty {
                Label("\(away.joined(separator: ", ")) away", systemImage: "wifi.slash")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(Palette.danger)
            }
            Spacer()
        }
    }
}

private struct NearbyLinkPill: View {
    var linked: Bool
    var isHost: Bool

    var body: some View {
        Label(isHost ? "Hosting" : (linked ? "Connected" : "Reconnecting"), systemImage: linked ? "antenna.radiowaves.left.and.right" : "antenna.radiowaves.left.and.right.slash")
            .font(.caption2.weight(.heavy))
            .foregroundStyle(linked ? Palette.success : Palette.gold)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .dealGlass(in: Capsule())
            .accessibilityIdentifier("nearby.link")
    }
}

private struct NearbyMessageView: View {
    @Environment(AppModel.self) private var app
    var symbol: String
    var title: String
    var message: String
    var onDone: () -> Void

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            VStack(spacing: 16) {
                Image(systemName: symbol)
                    .font(.system(size: 56))
                    .foregroundStyle(SoftWhite(0.85))
                Text(title)
                    .font(.title.weight(.bold))
                    .foregroundStyle(.white)
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(SoftWhite(0.8))
                Button("Done", action: onDone)
                    .buttonStyle(PrimaryButtonStyle())
                    .frame(maxWidth: 220)
            }
            .padding(30)
        }
    }
}

private struct KeepsScreenAwake: ViewModifier {
    func body(content: Content) -> some View {
        content
            .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
            .onDisappear { UIApplication.shared.isIdleTimerDisabled = false }
    }
}

extension View {
    /// A locked phone drops off the table, so the screen stays on while a nearby game is open.
    func keepsScreenAwake() -> some View { modifier(KeepsScreenAwake()) }
}
