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
    private(set) var index = 0
    private(set) var playing = true
    private(set) var speed = 1
    private var task: Task<Void, Never>?

    init(log: GameLog) {
        positions = log.positions()
    }

    var last: Int { positions.count - 1 }
    var game: GameState? { positions[min(index, last)] }
    var prompt: TurnPrompt? { game.map(Engine.nextPrompt) }
    var legalActions: [LegalAction] { [] }
    var viewerId: PlayerId? { prompt?.playerId }
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
}

struct ReplayView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var match: ReplayMatch

    init(log: GameLog) {
        _match = State(initialValue: ReplayMatch(log: log))
    }

    var body: some View {
        TableView(session: match, extras: AnyView(bar)) { dismiss() }
            .environment(\.cardBackStyle, app.preferences.cardBack)
            .onAppear { match.begin() }
            .onDisappear { match.end() }
            .accessibilityIdentifier("replay")
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
                Button("\(match.speed)x") { match.nextSpeed() }
                    .font(.subheadline.weight(.heavy))
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 38)
                    .dealGlass(interactive: true, in: Capsule())
                    .accessibilityLabel("Playback speed \(match.speed) times")
            }
            HStack(spacing: 8) {
                Slider(
                    value: Binding(get: { Double(match.index) }, set: { match.seek(Int($0)) }),
                    in: 0...Double(max(match.last, 1)),
                    step: 1
                )
                .accessibilityLabel("Replay position")
                Text("Move \(match.index) of \(match.last)")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(SoftWhite(0.8))
                    .accessibilityIdentifier("replay.position")
            }
        }
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
