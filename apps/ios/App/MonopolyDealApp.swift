import SwiftUI

@main
struct MonopolyDealApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var app = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .preferredColorScheme(.dark)
                .onOpenURL { app.open(url: $0) }
                .onChange(of: scenePhase) { _, phase in app.scenePhaseChanged(phase) }
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        @Bindable var app = app
        NavigationStack(path: $app.path) {
            HomeView()
                .navigationDestination(for: AppRoute.self) { route in
                    switch route {
                    case .setup: SetupView()
                    case .saved: SavedGamesView(duringGame: false)
                    case .stats: StatsView()
                    case .settings: SettingsView()
                    case .online: OnlineHomeView()
                    case .nearby: NearbyHomeView()
                    }
                }
        }
        .tint(Palette.gold)
        .environment(\.cardBackStyle, app.preferences.cardBack)
        .fullScreenCover(item: $app.replayToWatch) { request in
            ReplayView(log: request.log, isLocal: request.isLocal)
                .environment(app)
        }
        .fullScreenCover(item: Binding(
            get: { app.localMatch.map(LocalMatchBox.init) },
            set: { if $0 == nil { app.closeLocalMatch() } }
        )) { box in
            LocalGameView(match: box.match)
                .environment(app)
                .environment(\.cardBackStyle, app.preferences.cardBack)
        }
        .fullScreenCover(item: Binding(
            get: { app.onlineMatch.map(OnlineMatchBox.init) },
            set: { if $0 == nil { Task { await app.exitRoom() } } }
        )) { box in
            OnlineGameView(match: box.match)
                .environment(app)
                .environment(\.cardBackStyle, app.preferences.cardBack)
        }
        .fullScreenCover(item: Binding(
            get: { app.nearbyHost.map(NearbyHostBox.init) },
            set: { if $0 == nil { app.exitNearbyHost() } }
        )) { box in
            NearbyHostGameView(match: box.match)
                .environment(app)
                .environment(\.cardBackStyle, app.preferences.cardBack)
        }
        .fullScreenCover(item: Binding(
            get: { app.nearbyGuest.map(NearbyGuestBox.init) },
            set: { if $0 == nil { app.exitNearbyGuest() } }
        )) { box in
            NearbyGuestGameView(match: box.match)
                .environment(app)
                .environment(\.cardBackStyle, app.preferences.cardBack)
        }
        .sheet(item: $app.viewedSummary) { viewed in
            PostGameView(summary: viewed.summary, game: viewed.game, unlocked: [], primaryTitle: nil, onPrimary: {}, onClose: { app.viewedSummary = nil })
                .environment(app)
        }
    }
}

private struct LocalMatchBox: Identifiable {
    let match: LocalMatch
    var id: ObjectIdentifier { ObjectIdentifier(match) }
}

private struct OnlineMatchBox: Identifiable {
    let match: OnlineMatch
    var id: ObjectIdentifier { ObjectIdentifier(match) }
}

private struct NearbyHostBox: Identifiable {
    let match: NearbyHostMatch
    var id: ObjectIdentifier { ObjectIdentifier(match) }
}

private struct NearbyGuestBox: Identifiable {
    let match: NearbyGuestMatch
    var id: ObjectIdentifier { ObjectIdentifier(match) }
}
