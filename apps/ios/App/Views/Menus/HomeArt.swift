import DealEngine
import SwiftUI

/// Colors for the home screen, which keeps its own dusk look whatever the table style.
enum HomePalette {
    static let skyTop = Color(hex: 0x3A1E5C)
    static let skyMid = Color(hex: 0x5E1F43)
    static let skyBottom = Color(hex: 0x2B0E24)
    static let horizon = Color(hex: 0xE0663A)
    static let skyline = Color(hex: 0x24102A)
    static let bannerRed = Color(hex: 0xD3222F)
    static let bannerRedDeep = Color(hex: 0x9E1220)
    static let plate = Color(hex: 0x24140F)
    static let buttonGold = Color(hex: 0xFFD84D)
    static let buttonGoldDeep = Color(hex: 0xF3AE22)
    static let buttonInk = Color(hex: 0x2A1608)
    static let practice = (Color(hex: 0x3557A8), Color(hex: 0x223C7E))
    static let online = (Color(hex: 0x7140AE), Color(hex: 0x4B2382))
    static let daily = (Color(hex: 0x16807E), Color(hex: 0x0D5556))
    static let resume = (Color(hex: 0x9A4637), Color(hex: 0x6E2A2B))
    static let panel = Color(hex: 0x4A1830, opacity: 0.72)
    static let tile = Color(hex: 0x4E1C37)
}

/// The dusk sky behind the home screen, with a glow low on the horizon.
struct HomeBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [HomePalette.skyTop, HomePalette.skyMid, HomePalette.skyBottom],
                startPoint: .top,
                endPoint: .bottom
            )
            RadialGradient(
                colors: [HomePalette.horizon.opacity(0.42), .clear],
                center: UnitPoint(x: 0.3, y: 0.3),
                startRadius: 10,
                endRadius: 320
            )
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// A row of city towers, drawn once from a fixed seed.
struct HomeSkyline: View {
    var body: some View {
        Canvas { context, size in
            var random = SplitMix(seed: 7)
            var x: CGFloat = -6
            while x < size.width {
                let width = 16 + random.next() * 26
                let height = size.height * (0.25 + random.next() * 0.75)
                let tower = CGRect(x: x, y: size.height - height, width: width, height: height)
                context.fill(Path(tower), with: .color(HomePalette.skyline))
                if random.next() > 0.6 {
                    let spire = CGRect(x: tower.midX - 1.5, y: tower.minY - 14, width: 3, height: 14)
                    context.fill(Path(spire), with: .color(HomePalette.skyline))
                }
                var windowY = tower.minY + 8
                while windowY < size.height - 6 {
                    var windowX = tower.minX + 4
                    while windowX < tower.maxX - 6 {
                        if random.next() > 0.72 {
                            context.fill(
                                Path(CGRect(x: windowX, y: windowY, width: 3, height: 4)),
                                with: .color(Color(hex: 0xF6B66A, opacity: 0.35))
                            )
                        }
                        windowX += 7
                    }
                    windowY += 9
                }
                x += width + 2 + random.next() * 8
            }
        }
        .mask(LinearGradient(colors: [.black, .black, .clear], startPoint: .top, endPoint: .bottom))
        .opacity(0.7)
        .accessibilityHidden(true)
    }
}

/// The game's wordmark: three cards behind a tilted red banner and a dark "DEAL" plate.
/// Drawn at 250 by 220 points and scaled by the caller.
struct HomeLogo: View {
    var body: some View {
        ZStack(alignment: .topLeading) {
            logoCard(Color(hex: 0xF4B63C), angle: -16, x: 62, y: 22)
            logoCard(HomePalette.bannerRed, angle: -4, x: 104, y: 4)
            logoCard(Color(hex: 0x4A2A22), angle: 10, x: 146, y: 14)

            Text("MONOPOLY")
                .font(.system(size: 40, weight: .black, design: .rounded))
                .tracking(-0.5)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .foregroundStyle(.white)
                .shadow(color: .black.opacity(0.35), radius: 0, x: 0, y: 2)
                .padding(.horizontal, 14)
                .frame(width: 250, height: 64)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(LinearGradient(colors: [HomePalette.bannerRed, HomePalette.bannerRedDeep], startPoint: .top, endPoint: .bottom))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(.white, lineWidth: 4))
                        .shadow(color: .black.opacity(0.45), radius: 8, y: 5)
                )
                .rotationEffect(.degrees(-8))
                .offset(x: 0, y: 70)

            Text("DEAL")
                .font(.system(size: 66, weight: .black, design: .rounded))
                .italic()
                .tracking(-1)
                .foregroundStyle(LinearGradient(colors: [.white, Palette.paperShade], startPoint: .top, endPoint: .bottom))
                .padding(.horizontal, 18)
                .frame(height: 84)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(HomePalette.plate)
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Palette.paperShade, lineWidth: 3))
                        .shadow(color: .black.opacity(0.5), radius: 8, y: 6)
                )
                .rotationEffect(.degrees(-8))
                .offset(x: 62, y: 128)
        }
        .frame(width: 250, height: 220, alignment: .topLeading)
    }

    private func logoCard(_ color: Color, angle: Double, x: CGFloat, y: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 7, style: .continuous)
            .fill(color)
            .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(.white, lineWidth: 4))
            .frame(width: 58, height: 80)
            .shadow(color: .black.opacity(0.35), radius: 4, y: 3)
            .rotationEffect(.degrees(angle))
            .offset(x: x, y: y)
    }
}

/// A hand of real cards, fanned like a player showing them off, with a few gold sparks.
struct HomeCardHand: View {
    var floating: Bool

    var body: some View {
        ZStack {
            card("rent_color#1", angle: -30, x: -46, y: 18, lift: 3)
            card("wild_all#1", angle: -16, x: -22, y: 6, lift: -3)
            card("deal_breaker#1", angle: -2, x: 4, y: 0, lift: 4)
            card("red_1#1", angle: 13, x: 30, y: 4, lift: -4)
            sparks.offset(x: -44, y: -78)
        }
        .frame(width: 170, height: 200)
    }

    private func card(_ id: String, angle: Double, x: CGFloat, y: CGFloat, lift: CGFloat) -> some View {
        CardView(cardId: id, variant: .classic, width: 88)
            .shadow(color: .black.opacity(0.45), radius: 8, y: 5)
            .rotationEffect(.degrees(angle + (floating ? lift * 0.25 : 0)), anchor: .bottom)
            .offset(x: x, y: y + (floating ? lift : 0))
    }

    private var sparks: some View {
        ZStack {
            ForEach(Array([-40.0, -8, 24].enumerated()), id: \.offset) { _, angle in
                Capsule()
                    .fill(Palette.gold)
                    .frame(width: 5, height: 22)
                    .offset(y: -16)
                    .rotationEffect(.degrees(angle))
            }
        }
    }
}

/// One of the colored mode tiles under New Game.
struct HomeModeTile<Badge: View>: View {
    var title: String
    var detail: String
    var icon: String
    var colors: (Color, Color)
    var showsLiveDot = false
    @ViewBuilder var badge: Badge
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 30, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .frame(height: 36)
            Text(title)
                .font(.headline.weight(.heavy))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            HStack(spacing: 5) {
                if showsLiveDot {
                    Circle().fill(Palette.success).frame(width: 8, height: 8)
                }
                Text(detail)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
        }
        .foregroundStyle(.white)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 8)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, minHeight: 118, maxHeight: .infinity)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(LinearGradient(colors: [colors.0, colors.1], startPoint: .top, endPoint: .bottom))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(.white.opacity(contrast == .increased ? 0.8 : 0.22), lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) { badge.offset(x: 6, y: -8) }
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

/// A tile in the bottom row: an icon over its name.
struct HomeMenuTile: View {
    var title: String
    var icon: String
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.system(size: 26, weight: .semibold))
                .frame(height: 30)
            Text(title)
                .font(.subheadline.weight(.semibold))
                .tracking(-0.3)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 2)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, minHeight: 80, maxHeight: .infinity)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(HomePalette.tile))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(.white.opacity(contrast == .increased ? 0.8 : 0.16), lineWidth: 1)
        )
        .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

/// Scales a button down a touch while pressed, without changing how it looks.
struct HomePressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.snappy(duration: 0.16), value: configuration.isPressed)
    }
}
