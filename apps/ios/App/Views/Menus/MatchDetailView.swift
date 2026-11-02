import DealEngine
import DealStats
import SwiftUI

/// One game from the history: how it went, its log, and a way to watch it back.
struct MatchDetailView: View {
    @Environment(AppModel.self) private var app
    var match: MatchRecord

    @State private var replay: StoredReplay?
    @State private var loaded = false
    @State private var turns: [LogTurn] = []

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(match.winnerName.map { "\($0) won" } ?? "No winner")
                            .font(.title2.weight(.black))
                            .foregroundStyle(.white)
                        Text(match.players.joined(separator: ", "))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(SoftWhite(0.85))
                        Text("\(match.mode.label) · \(match.turnCount) turns · \(formatDuration(match.durationSec)) · \(match.endedDate.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption)
                            .foregroundStyle(SoftWhite(0.65))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let replay {
                        Button {
                            app.replayToWatch = ReplayRequest(log: replay.log)
                        } label: {
                            Label("Watch Replay", systemImage: "play.rectangle.fill")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .accessibilityIdentifier("match.replay")
                        SectionTitle(text: "Game Log")
                        ForEach(turns) { LogTurnCard(turn: $0) }
                    } else if loaded {
                        Label("This game has no replay. It was played before replays were saved, or it's older than the last \(DealStore.maxReplays) games.", systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(SoftWhite(0.8))
                            .accessibilityIdentifier("match.noReplay")
                    }
                }
                .padding(18)
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Match")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            replay = app.store.replays().first { $0.id == match.id }
            loaded = true
            guard let log = replay?.log else { return }
            turns = await Task.detached(priority: .userInitiated) {
                let final = log.positions().last ?? log.initial
                return GameLogModel.turns(final.history, playerNames: final.players.map(\.name), finished: true)
            }.value
        }
    }
}
