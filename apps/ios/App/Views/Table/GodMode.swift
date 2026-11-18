import DealEngine
import SwiftUI
import UIKit

/// God mode: a hidden, on-device setting. Holding the table still for ten seconds turns it on
/// or off. While it's on, each draw and Pass Go first shows the deck so the player picks the
/// cards. Nothing about it is sent to a room or another phone; only the chosen draw is.
enum GodMode {
    static let storageKey = "monopolyDeal.tableHold"
    static let holdSeconds: Double = 10
    /// Moving further than this cancels the hold, so drags and scrolls never count.
    static let holdSlop: CGFloat = 14

    static func toggled(_ on: Bool) {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(on ? .success : .warning)
    }
}

/// A draw waiting on god mode's choice. `pile` is nil while the deck is still on its way.
struct DeckPickRequest: Identifiable {
    let id = UUID()
    var action: Action
    var count: Int
    var pile: [String]?
}

/// The deck, next card first. Pick the cards this draw takes, in any order.
struct DeckPickerSheet: View {
    var request: DeckPickRequest
    var variant: GameVariant
    var onDraw: ([String]) -> Void
    var onCancel: () -> Void
    @State private var picked: [String] = []

    private var needed: Int { min(request.count, request.pile?.count ?? 0) }

    var body: some View {
        VStack(spacing: 10) {
            Text("Choose \(needed) \(needed == 1 ? "card" : "cards")")
                .font(.headline.weight(.bold))
                .padding(.top, 18)
                .accessibilityIdentifier("deckPicker")
            if let pile = request.pile {
                Text("\(pile.count) in the deck, next card first. \(picked.count) of \(needed) chosen.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 74), spacing: 10)], spacing: 10) {
                        ForEach(Array(pile.enumerated()), id: \.element) { index, cardId in
                            card(cardId, index: index)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                }
                HStack(spacing: 12) {
                    Button("Cancel", role: .cancel, action: onCancel)
                        .buttonStyle(.bordered)
                    Button("Draw \(needed)") { onDraw(picked) }
                        .buttonStyle(.borderedProminent)
                        .disabled(picked.count != needed)
                        .accessibilityIdentifier("deckPicker.draw")
                }
                .padding(.bottom, 14)
            } else {
                Spacer()
                ProgressView()
                Spacer()
            }
        }
    }

    private func card(_ cardId: String, index: Int) -> some View {
        let order = picked.firstIndex(of: cardId)
        return Button {
            toggle(cardId)
        } label: {
            CardView(cardId: cardId, variant: variant, width: 70)
                .overlay {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(order == nil ? Color.clear : Palette.gold, lineWidth: 3)
                }
                .overlay(alignment: .topTrailing) {
                    if let order {
                        Text("\(order + 1)")
                            .font(.caption.weight(.heavy))
                            .foregroundStyle(.black)
                            .frame(width: 22, height: 22)
                            .background(Palette.gold, in: Circle())
                            .offset(x: 6, y: -6)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Deck card \(index + 1), \(Catalog.lookup(cardId, variant).map(CardText.spokenName) ?? "card")")
        .accessibilityAddTraits(order == nil ? [] : .isSelected)
    }

    private func toggle(_ cardId: String) {
        if let index = picked.firstIndex(of: cardId) {
            picked.remove(at: index)
        } else if picked.count >= needed {
            picked = Array(picked.dropFirst()) + [cardId]
        } else {
            picked.append(cardId)
        }
    }
}

/// A one-second glint in the corner when the hold switches god mode. No lasting badge.
struct GodModeCue: View {
    var on: Bool
    @State private var shown = false

    var body: some View {
        Circle()
            .fill(on ? Palette.gold : Color.white.opacity(0.55))
            .frame(width: 10, height: 10)
            .shadow(color: on ? Palette.gold : .clear, radius: 6)
            .opacity(shown ? 0 : 1)
            .scaleEffect(shown ? 1 : 1.3)
            .onAppear { withAnimation(.easeOut(duration: 1.1)) { shown = true } }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Watches the whole window for the ten-second hold while the table is on screen. A UIKit
/// recognizer sees touches over scroll views too, runs alongside every other gesture and
/// never cancels their touches, so taps, drags and scrolling work exactly as before.
struct TableHoldDetector: UIViewRepresentable {
    var onHold: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onHold: onHold) }

    func makeUIView(context: Context) -> HostView {
        let view = HostView()
        view.coordinator = context.coordinator
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: HostView, context: Context) {
        context.coordinator.onHold = onHold
    }

    static func dismantleUIView(_ view: HostView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class HostView: UIView {
        weak var coordinator: Coordinator?
        override func didMoveToWindow() {
            super.didMoveToWindow()
            if let window { coordinator?.attach(to: window) } else { coordinator?.detach() }
        }
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        var onHold: () -> Void
        private var recognizer: UILongPressGestureRecognizer?

        init(onHold: @escaping () -> Void) { self.onHold = onHold }

        func attach(to window: UIWindow) {
            detach()
            let recognizer = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
            recognizer.minimumPressDuration = GodMode.holdSeconds
            recognizer.allowableMovement = GodMode.holdSlop
            recognizer.cancelsTouchesInView = false
            recognizer.delaysTouchesBegan = false
            recognizer.delaysTouchesEnded = false
            recognizer.delegate = self
            window.addGestureRecognizer(recognizer)
            self.recognizer = recognizer
        }

        func detach() {
            if let recognizer { recognizer.view?.removeGestureRecognizer(recognizer) }
            recognizer = nil
        }

        @objc private func held(_ recognizer: UILongPressGestureRecognizer) {
            if recognizer.state == .began { onHold() }
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}
