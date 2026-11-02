import DealEngine
import DealOnline
import DealStats
import SwiftUI

extension EnvironmentValues {
    /// The back chosen in Settings, for every face-down card on screen.
    @Entry var cardBackStyle = CardBackStyle.classic_red
}

/// Reads a span of time at a glance: seconds, then hours, then days.
enum ClockText {
    static func format(_ seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded(.up)))
        if total >= 86_400 { return "\(total / 86_400)d \((total % 86_400) / 3_600)h" }
        if total >= 3_600 { return "\(total / 3_600)h \((total % 3_600) / 60)m" }
        return "\(total / 60):" + String(format: "%02d", total % 60)
    }
}

/// Every mode shows a clock. It counts up, or down when the turn can run out.
struct TurnClockPill: View {
    var clock: TurnClockInfo

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = clock.deadline?.timeIntervalSince(context.date)
            let shown = remaining ?? context.date.timeIntervalSince(clock.startedAt)
            let urgent = remaining.map { $0 <= 10 } ?? false
            Label(ClockText.format(shown), systemImage: "hourglass")
                .font(.caption.weight(.heavy).monospacedDigit())
                .foregroundStyle(.white)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 9)
                .frame(height: 28)
                .background(Capsule().fill(urgent ? Palette.danger : Color.black.opacity(0.35)))
                .accessibilityLabel(remaining == nil ? "Turn time \(ClockText.format(shown))" : "\(ClockText.format(shown)) left this turn")
                .accessibilityIdentifier("table.clock")
        }
    }
}

struct JustSayNoStamp: Identifiable, Equatable {
    let id = UUID()
    var playerName: String
}

/// A Just Say No lands on the whole table, including when it's your own.
struct JustSayNoStampView: View {
    var stamp: JustSayNoStamp

    var body: some View {
        VStack(spacing: 4) {
            Text("Just Say No!")
                .font(.system(size: 36, weight: .black, design: .rounded))
                .foregroundStyle(Palette.danger)
                .padding(.horizontal, 18)
                .padding(.vertical, 8)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Palette.paper))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Palette.danger, lineWidth: 5))
                .rotationEffect(.degrees(-8))
                .shadow(radius: 14, y: 8)
            if !stamp.playerName.isEmpty {
                Text(stamp.playerName)
                    .font(.headline.weight(.heavy))
                    .foregroundStyle(.white)
                    .padding(.top, 8)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("table.justSayNo")
    }
}

/// One reaction crossing the table, from whoever sent it to the seat across from them.
struct ReactionFlightView: View {
    var flight: FlyingReaction
    @State private var arrived = false

    var body: some View {
        GeometryReader { geometry in
            let top = geometry.size.height * 0.14
            let bottom = geometry.size.height * 0.72
            let x = geometry.size.width * (0.2 + 0.6 * flight.seatPosition)
            VStack(spacing: 2) {
                Text(flight.reaction.emoji).font(.system(size: 54))
                Text(flight.playerName)
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(.white)
                    .shadow(radius: 3)
            }
            .scaleEffect(arrived ? 1.25 : 0.7)
            .rotationEffect(.degrees(arrived ? 0 : -24))
            .position(
                x: arrived ? geometry.size.width / 2 : x,
                y: flight.fromViewer ? (arrived ? top : bottom) : (arrived ? bottom : top)
            )
            .opacity(arrived ? 0 : 1)
        }
        .onAppear {
            withAnimation(.easeIn(duration: 1.3)) { arrived = true }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// How long a Speed turn lasts: a slider with three stops.
struct TurnTimerSlider: View {
    var seconds: Int
    var onChange: (Int) -> Void

    private static let stops = [30, 45, 60]

    var body: some View {
        VStack(spacing: 4) {
            HStack {
                Text("Seconds per turn").font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(seconds)")
                    .font(.subheadline.weight(.heavy).monospacedDigit())
                    .foregroundStyle(Palette.gold)
            }
            .foregroundStyle(.white)
            Slider(
                value: Binding(get: { Double(seconds) }, set: { onChange(Int($0)) }),
                in: 30...60,
                step: 15
            )
            .tint(Palette.gold)
            .accessibilityLabel("Seconds per turn")
            .accessibilityValue("\(seconds) seconds")
            .accessibilityIdentifier("timer.slider")
            HStack {
                ForEach(Array(Self.stops.enumerated()), id: \.offset) { index, stop in
                    if index > 0 { Spacer() }
                    Text("\(stop)")
                        .font(.caption2.weight(stop == seconds ? .heavy : .medium))
                        .foregroundStyle(stop == seconds ? Palette.gold : Color.white.opacity(0.6))
                }
            }
            .accessibilityHidden(true)
        }
        .padding(12)
        .glassPanel(cornerRadius: 14)
    }
}

