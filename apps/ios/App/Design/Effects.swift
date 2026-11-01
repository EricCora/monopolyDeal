import AudioToolbox
import SwiftUI
import UIKit

/// Haptics and short system sounds, each gated by a setting.
@MainActor
enum Feedback {
    enum Tone { case tap, success, error, turn, win }

    static func play(_ tone: Tone, haptics: Bool, sound: Bool) {
        if haptics {
            switch tone {
            case .tap: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case .success: UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            case .error: UINotificationFeedbackGenerator().notificationOccurred(.error)
            case .turn: UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case .win: UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
        }
        if sound {
            switch tone {
            case .tap: AudioServicesPlaySystemSound(1104)
            case .success: AudioServicesPlaySystemSound(1105)
            case .error: AudioServicesPlaySystemSound(1053)
            case .turn: AudioServicesPlaySystemSound(1113)
            case .win: AudioServicesPlaySystemSound(1025)
            }
        }
    }
}

/// Falling confetti, drawn on one canvas so hundreds of pieces stay smooth.
struct ConfettiView: View {
    var colors: [Color] = [Palette.gold, Palette.danger, Palette.success, .cyan, .pink, .orange]
    private let start = Date.now
    private let pieces = 160

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let elapsed = timeline.date.timeIntervalSince(start)
                var random = SplitMix(seed: 7)
                for index in 0..<pieces {
                    let x = random.next()
                    let speed = 0.7 + random.next() * 0.7
                    let delay = random.next() * 2.5
                    let sway = random.next() * 44 + 12
                    let phase = random.next() * .pi * 2
                    let spin = random.next() * 8 + 3
                    let time = elapsed - Double(delay)
                    if time < 0 { continue }
                    let fall = (CGFloat(time) * 190 * speed)
                    let y = fall.truncatingRemainder(dividingBy: size.height + 60) - 30
                    let wobble = sin(CGFloat(time) * 2.4 + phase) * sway
                    var piece = context
                    piece.translateBy(x: x * size.width + wobble, y: y)
                    piece.rotate(by: .radians(Double(time) * Double(spin)))
                    let squash = abs(cos(CGFloat(time) * spin))
                    let rect = CGRect(x: -4, y: -6 * squash, width: 8, height: 12 * squash)
                    piece.fill(Path(rect), with: .color(colors[index % colors.count]))
                }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// A brief horizontal shake, for a card that can't be played.
struct ShakeEffect: GeometryEffect {
    var travel: CGFloat = 7
    var animatableData: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        ProjectionTransform(CGAffineTransform(translationX: travel * sin(animatableData * .pi * 4), y: 0))
    }
}
