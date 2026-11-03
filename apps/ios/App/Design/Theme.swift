import DealEngine
import DealStats
import SwiftUI

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

enum Palette {
    static let paper = Color(hex: 0xFBF7EC)
    static let paperShade = Color(hex: 0xEFE7D2)
    static let ink = Color(hex: 0x14202F)
    static let gold = Color(hex: 0xF2C54F)
    static let goldDeep = Color(hex: 0xB9872A)
    static let danger = Color(hex: 0xE5484D)
    static let success = Color(hex: 0x30B47F)
    static let navy = Color(hex: 0x101B2D)
    static let solidPanel = Color(hex: 0x1B2A41)
}

extension PropertyColor {
    var tint: Color {
        switch self {
        case .brown: Color(hex: 0x8A5A33)
        case .light_blue: Color(hex: 0x8FD3F4)
        case .pink: Color(hex: 0xE2559D)
        case .orange: Color(hex: 0xF2902B)
        case .red: Color(hex: 0xD92F3B)
        case .yellow: Color(hex: 0xF7D13D)
        case .green: Color(hex: 0x1FA45C)
        case .dark_blue: Color(hex: 0x204FA9)
        case .railroad: Color(hex: 0x2C323B)
        case .utility: Color(hex: 0xB9C7A5)
        }
    }

    /// Text color that stays readable on `tint`.
    var onTint: Color {
        switch self {
        case .light_blue, .yellow, .utility, .orange: Palette.ink
        default: .white
        }
    }
}

extension TableTheme {
    /// Nine colors for a 3x3 mesh, top-left to bottom-right.
    var meshColors: [Color] {
        switch self {
        case .premium_tabletop:
            [
                Color(hex: 0x0D1726), Color(hex: 0x14283F), Color(hex: 0x0E1B2E),
                Color(hex: 0x123246), Color(hex: 0x17495A), Color(hex: 0x12314A),
                Color(hex: 0x0A1320), Color(hex: 0x10283A), Color(hex: 0x09121F),
            ]
        case .classic_green:
            [
                Color(hex: 0x0B3A26), Color(hex: 0x0F4D32), Color(hex: 0x0B3A26),
                Color(hex: 0x11583A), Color(hex: 0x187148), Color(hex: 0x11583A),
                Color(hex: 0x09301F), Color(hex: 0x0D4229), Color(hex: 0x09301F),
            ]
        case .neon_arcade:
            [
                Color(hex: 0x140A2E), Color(hex: 0x2A1160), Color(hex: 0x0F1240),
                Color(hex: 0x3A1272), Color(hex: 0x5B1A8E), Color(hex: 0x123A7A),
                Color(hex: 0x0E0726), Color(hex: 0x2B0F58), Color(hex: 0x0A1A44),
            ]
        case .sunset_lounge:
            [
                Color(hex: 0x2A1124), Color(hex: 0x5A1F33), Color(hex: 0x301030),
                Color(hex: 0x7A2F33), Color(hex: 0xB5552F), Color(hex: 0x6E2345),
                Color(hex: 0x1D0D22), Color(hex: 0x4A1A33), Color(hex: 0x1A0B1F),
            ]
        case .royal_velvet:
            [
                Color(hex: 0x1C0B2E), Color(hex: 0x351352), Color(hex: 0x1E0C35),
                Color(hex: 0x4A1A6B), Color(hex: 0x6D2A8F), Color(hex: 0x421861),
                Color(hex: 0x130723), Color(hex: 0x2C0F45), Color(hex: 0x10061E),
            ]
        case .midnight_vault:
            [
                Color(hex: 0x05070D), Color(hex: 0x0C111C), Color(hex: 0x06080F),
                Color(hex: 0x12182A), Color(hex: 0x1F2740), Color(hex: 0x101627),
                Color(hex: 0x030409), Color(hex: 0x0A0E18), Color(hex: 0x020308),
            ]
        }
    }

    /// The poker table's felt, lightest in the middle.
    var feltColors: [Color] {
        switch self {
        case .premium_tabletop: [Color(hex: 0x2B5C4A), Color(hex: 0x1D4537), Color(hex: 0x14332A)]
        case .classic_green: [Color(hex: 0x2E7A50), Color(hex: 0x1E5A3A), Color(hex: 0x123D27)]
        case .neon_arcade: [Color(hex: 0x3B1A78), Color(hex: 0x2A115A), Color(hex: 0x170A38)]
        case .sunset_lounge: [Color(hex: 0x8A3A2C), Color(hex: 0x5E2230), Color(hex: 0x3A1424)]
        case .royal_velvet: [Color(hex: 0x5A2580), Color(hex: 0x3E1760), Color(hex: 0x250C3C)]
        case .midnight_vault: [Color(hex: 0x22304A), Color(hex: 0x161F33), Color(hex: 0x0C111D)]
        }
    }

    var accent: Color {
        switch self {
        case .premium_tabletop: Palette.gold
        case .classic_green: Color(hex: 0xF4E3A1)
        case .neon_arcade: Color(hex: 0x4DE3FF)
        case .sunset_lounge: Color(hex: 0xFFC27A)
        case .royal_velvet: Color(hex: 0xE7C6FF)
        case .midnight_vault: Color(hex: 0xE9C46A)
        }
    }
}

/// The animated table surface. It only redraws when the style changes.
struct TableBackground: View {
    var style: TableTheme

    var body: some View {
        ZStack {
            MeshGradient(
                width: 3,
                height: 3,
                points: [
                    [0, 0], [0.5, 0], [1, 0],
                    [0, 0.5], [0.5, 0.42], [1, 0.5],
                    [0, 1], [0.5, 1], [1, 1],
                ],
                colors: style.meshColors
            )
            FeltTexture()
                .opacity(style == .neon_arcade || style == .midnight_vault ? 0.05 : 0.12)
                .blendMode(.overlay)
            RadialGradient(colors: [.clear, .black.opacity(0.45)], center: .center, startRadius: 180, endRadius: 720)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// A fine speckle that gives the table a woven look. Drawn once and flattened.
private struct FeltTexture: View {
    var body: some View {
        Canvas { context, size in
            var random = SplitMix(seed: 42)
            let count = Int(size.width * size.height / 90)
            for _ in 0..<count {
                let x = random.next() * size.width
                let y = random.next() * size.height
                let bright = random.next() > 0.5
                context.fill(
                    Path(CGRect(x: x, y: y, width: 1, height: 1)),
                    with: .color(bright ? .white : .black)
                )
            }
        }
        .drawingGroup()
    }
}

struct SplitMix {
    private var state: UInt64

    init(seed: UInt64) { state = seed }

    mutating func next() -> CGFloat {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        z ^= z >> 31
        return CGFloat(z >> 11) / CGFloat(1 << 53)
    }
}

// MARK: Reusable surfaces

extension View {
    /// A Liquid Glass panel for floating controls.
    func glassPanel(cornerRadius: CGFloat = 22, tint: Color? = nil) -> some View {
        dealGlass(tint: tint, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }

    /// Liquid Glass, or a solid panel when the player has asked for Reduce Transparency
    /// or Increase Contrast.
    func dealGlass<S: InsettableShape>(tint: Color? = nil, interactive: Bool = false, in shape: S) -> some View {
        modifier(DealGlass(tint: tint, interactive: interactive, shape: shape))
    }
}

private struct DealGlass<S: InsettableShape>: ViewModifier {
    var tint: Color?
    var interactive: Bool
    var shape: S
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    func body(content: Content) -> some View {
        if reduceTransparency || contrast == .increased {
            content
                .background {
                    shape.fill(Palette.solidPanel)
                    if let tint { shape.fill(tint) }
                }
                .overlay(shape.strokeBorder(.white.opacity(contrast == .increased ? 0.8 : 0.22), lineWidth: 1))
        } else {
            let glass = tint.map { Glass.regular.tint($0) } ?? .regular
            content.glassEffect(interactive ? glass.interactive() : glass, in: shape)
        }
    }
}

/// White text kept quieter than the main text, except under Increase Contrast.
struct SoftWhite: ShapeStyle {
    var opacity: Double

    init(_ opacity: Double) { self.opacity = opacity }

    func resolve(in environment: EnvironmentValues) -> Color {
        .white.opacity(environment.colorSchemeContrast == .increased ? max(opacity, 0.92) : opacity)
    }
}

struct PrimaryButtonStyle: ButtonStyle {
    var tint: Color = Palette.gold
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline.weight(.bold))
            .foregroundStyle(Palette.ink)
            .padding(.horizontal, 20)
            .frame(minHeight: 50)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(LinearGradient(colors: [tint, tint.opacity(0.82)], startPoint: .top, endPoint: .bottom))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(.white.opacity(0.35), lineWidth: 1)
            )
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.snappy(duration: 0.16), value: configuration.isPressed)
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .frame(maxWidth: .infinity)
            .dealGlass(interactive: true, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(isEnabled ? 1 : 0.45)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.snappy(duration: 0.16), value: configuration.isPressed)
    }
}

struct SectionTitle: View {
    var text: String

    var body: some View {
        Text(text.uppercased())
            .font(.caption.weight(.heavy))
            .tracking(1.1)
            .foregroundStyle(SoftWhite(0.62))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

func formatDuration(_ seconds: Int) -> String {
    if seconds < 60 { return "\(seconds)s" }
    let minutes = seconds / 60
    if minutes < 60 { return "\(minutes)m \(seconds % 60)s" }
    return "\(minutes / 60)h \(minutes % 60)m"
}

/// Engine messages use raw color ids such as `light_blue`. This makes them read naturally.
func displayText(_ message: String) -> String {
    message.replacingOccurrences(of: "_", with: " ")
}

/// "You win!" or "Ann wins!"
func winnerHeadline(_ name: String?) -> String {
    guard let name else { return "Nobody wins" }
    return name == "You" ? "You win!" : "\(name) wins!"
}
