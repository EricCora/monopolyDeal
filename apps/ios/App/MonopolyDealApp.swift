import SwiftUI

@main
struct MonopolyDealApp: App {
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
                    }
                }
        }
        .tint(Palette.gold)
        .fullScreenCover(item: Binding(
            get: { app.localMatch.map(LocalMatchBox.init) },
            set: { if $0 == nil { app.closeLocalMatch() } }
        )) { box in
            LocalGameView(match: box.match)
                .environment(app)
        }
        .fullScreenCover(item: Binding(
            get: { app.onlineMatch.map(OnlineMatchBox.init) },
            set: { if $0 == nil { Task { await app.exitRoom() } } }
        )) { box in
            OnlineGameView(match: box.match)
                .environment(app)
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
