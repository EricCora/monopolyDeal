import DealEngine
import DealOnline
import DealStats
import Foundation
import Observation
import SwiftUI

/// Plays a finished game back on the real table, following whoever is deciding at each step.
@MainActor
@Observable
final class ReplayMatch: TableSession {
    static let stepSeconds = 1.1
    static let speeds = [1, 2, 4]

    private let positions: [GameState]
    private let actionCount: Int
    private(set) var index = 0
    private(set) var playing = true
    private(set) var speed = 1
    private var task: Task<Void, Never>?
    /// Whose hand is showing. Nil follows whoever is deciding. It's a finished game, so anyone's is fair.
    var revealedPlayerId: PlayerId?

    init(log: GameLog) {
        positions = log.positions()
        actionCount = log.actions.count
    }

    var last: Int { positions.count - 1 }
    var game: GameState? { positions[min(index, last)] }
    var prompt: TurnPrompt? { game.map(Engine.nextPrompt) }
    var legalActions: [LegalAction] { [] }
    var viewerId: PlayerId? { revealedPlayerId ?? prompt?.playerId }
    var isPaused: Bool { false }
    var canPause: Bool { false }
    var pauseMessage: String? { nil }
    var pauseDeadline: Date? { nil }
    var canUndo: Bool { false }
    var errorMessage: String? {
        get { nil }
        set {}
    }
    var thinkingPlayerId: PlayerId? { nil }
    var showsCoach: Bool { false }
    var title: String { "Replay" }
    var isReplay: Bool { true }
    var isPlaying: Bool { playing && index < last }
    var retryStart: GameState? {
        guard !isPlaying else { return nil }
        return GameLog.retryTurnStart(in: positions, actionCount: actionCount, at: index)
    }

    func perform(_ action: Action) {}
    func undo() {}
    func resetTurn() {}
    func togglePause() {}

    func begin() { schedule() }

    func end() {
        task?.cancel()
        task = nil
    }

    private func schedule() {
        task?.cancel()
        task = nil
        guard isPlaying else { return }
        let delay = Self.stepSeconds / Double(speed)
        task = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard let self, !Task.isCancelled else { return }
            self.index = min(self.index + 1, self.last)
            self.schedule()
        }
    }

    func playOrPause() {
        if index >= last { index = 0; playing = true } else { playing.toggle() }
        schedule()
    }

    func step(_ delta: Int) {
        playing = false
        index = min(max(index + delta, 0), last)
        schedule()
    }

    func seek(_ position: Int) {
        playing = false
        index = min(max(position, 0), last)
        schedule()
    }

    func nextSpeed() {
        speed = Self.speeds[(Self.speeds.firstIndex(of: speed).map { $0 + 1 } ?? 0) % Self.speeds.count]
        schedule()
    }
}

/// A finished game opened for watching.
struct ReplayRequest: Identifiable {
    let id = UUID()
    var log: GameLog
    var isLocal = false
}

struct ReplayView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var match: ReplayMatch
    @State private var showLog = false
    @State private var retry: LocalMatch?
    private let isLocal: Bool

    private var session: any TableSession {
        if let retry { return retry }
        return match
    }

    init(log: GameLog, isLocal: Bool = false) {
        self.isLocal = isLocal
        _match = State(initialValue: ReplayMatch(log: log))
    }

    var body: some View {
        TableView(session: session, extras: retry == nil ? AnyView(bar) : nil) {
            if retry == nil { dismiss() } else { closeRetry() }
        }
            .overlay {
                if let retry, retry.isGameOver, let game = retry.game {
                    retryResult(game)
                }
            }
            .environment(\.cardBackStyle, app.preferences.cardBack)
            .onAppear { match.begin() }
            .onDisappear {
                match.end()
                retry?.stop()
            }
            .sheet(isPresented: $showLog) {
                EventLogSheet(events: match.game?.history ?? [], playerNames: match.game?.players.map(\.name) ?? [])
                    .presentationDetents([.medium, .large])
                    .presentationBackground(.ultraThinMaterial)
            }
    }

    private func startRetry(_ state: GameState) {
        match.seek(match.index)
        let practice = LocalMatch(
            game: state, mode: .practice, isRetry: true, store: app.store,
            preferences: { [app] in app.preferences }, updatePreferences: { _ in },
            onFeedback: { [app] in app.feedback($0) }
        )
        retry = practice
        practice.start()
    }

    private func closeRetry() {
        retry?.stop()
        retry = nil
    }

    private func retryResult(_ game: GameState) -> some View {
        let winner = game.players.first { $0.id == game.winnerId }?.name ?? "Nobody"
        return ZStack {
            Rectangle().fill(.ultraThinMaterial).ignoresSafeArea()
            VStack(spacing: 16) {
                Text(winner == "You" ? "You win!" : "\(winner) wins!")
                    .font(.title.bold())
                Text("Retry complete")
                Button("Back to Replay", action: closeRetry)
                    .buttonStyle(PrimaryButtonStyle())
                    .frame(maxWidth: 240)
                    .accessibilityIdentifier("retry.return")
            }
            .foregroundStyle(.white)
        }
        .accessibilityAddTraits(.isModal)
    }

    private var bar: some View {
        VStack(spacing: 6) {
            HStack(spacing: 8) {
                roundButton("xmark", label: "Close replay") { dismiss() }
                    .accessibilityIdentifier("replay.close")
                roundButton("backward.frame.fill", label: "Previous move") { match.step(-1) }
                    .disabled(match.index == 0)
                Button {
                    match.playOrPause()
                } label: {
                    Label(match.isPlaying ? "Pause" : (match.index >= match.last ? "Watch Again" : "Play"), systemImage: match.isPlaying ? "pause.fill" : "play.fill")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 38)
                        .dealGlass(interactive: true, in: Capsule())
                }
                .accessibilityIdentifier("replay.play")
                roundButton("forward.frame.fill", label: "Next move") { match.step(1) }
                    .disabled(match.index >= match.last)
                roundButton("list.bullet", label: "Game log") { showLog = true }
                    .accessibilityIdentifier("replay.log")
                Button("\(match.speed)x") { match.nextSpeed() }
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 38)
                    .dealGlass(interactive: true, in: Capsule())
                    .accessibilityLabel("Playback speed \(match.speed) times")
            }
            HStack(spacing: 8) {
                handPicker
                Slider(
                    value: Binding(get: { Double(match.index) }, set: { match.seek(Int($0)) }),
                    in: 0...Double(max(match.last, 1)),
                    step: 1
                )
                .accessibilityLabel("Replay position")
                .accessibilityIdentifier("replay.slider")
                Text("Move \(match.index) of \(match.last)")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(SoftWhite(0.8))
                    .accessibilityIdentifier("replay.position")
            }
            if isLocal, let state = match.retryStart {
                Button("Retry This Turn", systemImage: "arrow.counterclockwise") { startRetry(state) }
                    .font(.caption.weight(.bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 36)
                    .dealGlass(interactive: true, in: Capsule())
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("replay.retry")
            }
        }
    }

    private var handPicker: some View {
        let players = match.game?.players ?? []
        let shown = players.first { $0.id == match.revealedPlayerId }?.name ?? "Follow Play"
        return Menu {
            Button("Follow Play", systemImage: "arrow.triangle.turn.up.right.circle") { match.revealedPlayerId = nil }
            ForEach(Array(players.enumerated()), id: \.element.id) { index, player in
                Button(player.name, systemImage: match.revealedPlayerId == player.id ? "checkmark" : "eye") {
                    match.revealedPlayerId = player.id
                }
                .accessibilityIdentifier("replay.hand.\(index)")
            }
        } label: {
            Label(shown, systemImage: "eye.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .frame(maxWidth: 120)
                .padding(.horizontal, 10)
                .frame(height: 32)
                .dealGlass(interactive: true, in: Capsule())
        }
        .accessibilityLabel("Whose hand to show: \(shown)")
        .accessibilityIdentifier("replay.hand")
    }

    private func roundButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
                .frame(width: 38, height: 38)
                .dealGlass(interactive: true, in: Circle())
        }
        .accessibilityLabel(label)
    }
}
