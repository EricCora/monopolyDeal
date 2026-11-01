import DealEngine
import SwiftUI

/// Draws any card as vector shapes, so it stays sharp at every size. The layout is
/// designed at 100 x 140 points and scaled, which keeps a tiny table card and a large
/// inspected card looking the same.
struct CardView: View {
    var cardId: String
    var variant: GameVariant
    var width: CGFloat
    /// The color a wild is currently assigned to, shown on the table.
    var assignedColor: PropertyColor?

    static let aspect: CGFloat = 1.4

    var body: some View {
        Group {
            if let card = Catalog.lookup(cardId, variant) {
                face(card)
            } else {
                CardBack(width: width)
            }
        }
        .frame(width: width, height: width * Self.aspect)
        .clipShape(RoundedRectangle(cornerRadius: width * 0.09, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: width * 0.09, style: .continuous)
                .strokeBorder(Palette.ink.opacity(0.16), lineWidth: max(0.5, width * 0.008))
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Catalog.lookup(cardId, variant).map(CardText.spokenName) ?? "Face-down card")
    }

    @ViewBuilder
    private func face(_ card: CardDefinition) -> some View {
        switch card.kind {
        case .money: MoneyFace(card: card, width: width)
        case .property: PropertyFace(card: card, width: width)
        case .wild: WildFace(card: card, width: width, assigned: assignedColor)
        case .action, .building: ActionFace(card: card, width: width)
        }
    }
}

/// A scaled size helper, so faces read as if drawn on a 100-point card.
private struct Scale {
    var width: CGFloat
    func callAsFunction(_ value: CGFloat) -> CGFloat { value * width / 100 }
}

private struct ValueBadge: View {
    var value: Int
    var width: CGFloat
    var inverted = false

    var body: some View {
        let s = Scale(width: width)
        Text("$\(value)")
            .font(.system(size: s(10.5), weight: .heavy, design: .rounded))
            .foregroundStyle(inverted ? Palette.ink : .white)
            .padding(.horizontal, s(4.5))
            .frame(minWidth: s(18), minHeight: s(15))
            .background(Capsule().fill(inverted ? Palette.gold : Palette.ink.opacity(0.9)))
    }
}

private struct PaperBackground: View {
    var body: some View {
        LinearGradient(colors: [Palette.paper, Palette.paperShade], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: Money

private struct MoneyFace: View {
    var card: CardDefinition
    var width: CGFloat

    private var tint: Color {
        switch card.value {
        case 1: Color(hex: 0xB99B6B)
        case 2: Color(hex: 0xD76A8C)
        case 3: Color(hex: 0x3FA66C)
        case 4: Color(hex: 0x4C9BD6)
        case 5: Color(hex: 0x8A5CC9)
        case 10: Color(hex: 0xE5873A)
        default: Palette.goldDeep
        }
    }

    var body: some View {
        let s = Scale(width: width)
        ZStack {
            LinearGradient(colors: [tint.opacity(0.28), tint.opacity(0.5)], startPoint: .top, endPoint: .bottom)
                .background(Palette.paper)
            ForEach(0..<4, id: \.self) { ring in
                Circle()
                    .strokeBorder(tint.opacity(0.5 - Double(ring) * 0.1), lineWidth: s(1))
                    .frame(width: s(72 + CGFloat(ring) * 16), height: s(72 + CGFloat(ring) * 16))
            }
            Circle()
                .fill(.white.opacity(0.75))
                .frame(width: s(58), height: s(58))
            Circle()
                .strokeBorder(tint, lineWidth: s(2.5))
                .frame(width: s(58), height: s(58))
            Text("$\(card.value)")
                .font(.system(size: s(card.value >= 10 ? 26 : 30), weight: .black, design: .rounded))
                .foregroundStyle(Palette.ink)
            VStack {
                HStack {
                    Text("$\(card.value)")
                    Spacer()
                }
                Spacer()
                HStack {
                    Spacer()
                    Text("$\(card.value)")
                        .rotationEffect(.degrees(180))
                }
            }
            .font(.system(size: s(11), weight: .heavy, design: .rounded))
            .foregroundStyle(Palette.ink.opacity(0.8))
            .padding(s(6))
        }
    }
}

// MARK: Properties

private struct RentLadder: View {
    var color: PropertyColor
    var width: CGFloat

    var body: some View {
        let s = Scale(width: width)
        VStack(spacing: s(2.5)) {
            ForEach(Array(color.rentScale.enumerated()), id: \.offset) { index, rent in
                HStack(spacing: s(3)) {
                    HStack(spacing: s(1.5)) {
                        ForEach(0...index, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: s(1))
                                .fill(color.tint)
                                .overlay(RoundedRectangle(cornerRadius: s(1)).strokeBorder(Palette.ink.opacity(0.3), lineWidth: s(0.4)))
                                .frame(width: s(6), height: s(8.5))
                        }
                    }
                    Spacer(minLength: 0)
                    Text("$\(rent)")
                        .font(.system(size: s(10.5), weight: .bold, design: .rounded))
                        .foregroundStyle(Palette.ink)
                }
            }
        }
    }
}

private struct PropertyFace: View {
    var card: CardDefinition
    var width: CGFloat

    var body: some View {
        let s = Scale(width: width)
        let color = card.color ?? .brown
        ZStack(alignment: .top) {
            PaperBackground()
            VStack(spacing: s(5)) {
                ZStack {
                    LinearGradient(colors: [color.tint, color.tint.opacity(0.82)], startPoint: .top, endPoint: .bottom)
                    Text(CardText.colorName(color))
                        .font(.system(size: s(11.5), weight: .heavy, design: .rounded))
                        .foregroundStyle(color.onTint)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .padding(.horizontal, s(4))
                }
                .frame(height: s(32))

                Text("SET OF \(color.setSize)")
                    .font(.system(size: s(7), weight: .bold, design: .rounded))
                    .tracking(0.6)
                    .foregroundStyle(Palette.ink.opacity(0.55))

                RentLadder(color: color, width: width)
                    .padding(.horizontal, s(10))

                Spacer(minLength: 0)
                HStack {
                    Spacer()
                    ValueBadge(value: card.value, width: width)
                }
                .padding(.horizontal, s(6))
                .padding(.bottom, s(6))
            }
        }
    }
}

private struct WildFace: View {
    var card: CardDefinition
    var width: CGFloat
    var assigned: PropertyColor?

    var body: some View {
        let s = Scale(width: width)
        ZStack {
            // The bands below are translucent gradients, so the card needs a solid base.
            Palette.paper
            if card.colors.count > 2 {
                AngularGradient(colors: [.red, .orange, .yellow, .green, .cyan, .blue, .purple, .pink, .red], center: .center)
                Circle()
                    .fill(Palette.paper)
                    .frame(width: s(66), height: s(66))
                VStack(spacing: s(1)) {
                    Image(systemName: "sparkles")
                        .font(.system(size: s(17), weight: .bold))
                    Text("WILD")
                        .font(.system(size: s(13), weight: .black, design: .rounded))
                    Text("ANY COLOR")
                        .font(.system(size: s(6.5), weight: .bold, design: .rounded))
                }
                .foregroundStyle(Palette.ink)
            } else {
                let first = card.colors.first ?? .brown
                let second = card.colors.last ?? .brown
                VStack(spacing: 0) {
                    ZStack {
                        LinearGradient(colors: [first.tint, first.tint.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                        ColorLadderRow(color: first, width: width)
                    }
                    ZStack {
                        LinearGradient(colors: [second.tint.opacity(0.85), second.tint], startPoint: .top, endPoint: .bottom)
                        ColorLadderRow(color: second, width: width)
                            .rotationEffect(.degrees(180))
                    }
                }
                Text("WILD")
                    .font(.system(size: s(11), weight: .black, design: .rounded))
                    .foregroundStyle(Palette.ink)
                    .padding(.horizontal, s(8))
                    .padding(.vertical, s(3))
                    .background(Capsule().fill(Palette.paper))
                    .overlay(Capsule().strokeBorder(Palette.ink.opacity(0.25), lineWidth: s(0.6)))
            }
            if let assigned {
                VStack {
                    HStack {
                        Circle()
                            .fill(assigned.tint)
                            .overlay(Circle().strokeBorder(.white, lineWidth: s(1.5)))
                            .frame(width: s(14), height: s(14))
                        Spacer()
                    }
                    Spacer()
                }
                .padding(s(5))
            }
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    ValueBadge(value: card.value, width: width)
                }
            }
            .padding(s(5))
        }
    }
}

private struct ColorLadderRow: View {
    var color: PropertyColor
    var width: CGFloat

    var body: some View {
        let s = Scale(width: width)
        VStack(spacing: s(1)) {
            Text(CardText.colorName(color))
                .font(.system(size: s(9), weight: .heavy, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(color.rentScale.map { "$\($0)" }.joined(separator: " · "))
                .font(.system(size: s(8), weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .foregroundStyle(color.onTint)
        .padding(.horizontal, s(5))
        .offset(y: -s(9))
    }
}

// MARK: Actions

private struct ActionFace: View {
    var card: CardDefinition
    var width: CGFloat

    private var accent: Color {
        switch card.actionKind {
        case .just_say_no: Color(hex: 0xC42B35)
        case .deal_breaker, .super_sly_deal, .market_crash: Color(hex: 0x6B21A8)
        case .sly_deal, .forced_deal, .heist, .yoink: Color(hex: 0x0F766E)
        case .debt_collector, .forced_debt, .tax_collector, .repossession: Color(hex: 0xB45309)
        case .pass_go, .go_again: Color(hex: 0x15803D)
        case .its_my_birthday: Color(hex: 0xDB2777)
        case .house, .hotel, .shack: Color(hex: 0x1D4ED8)
        case .tough_luck, .unfair_trade: Color(hex: 0x475569)
        default: Color(hex: 0x1F3A5F)
        }
    }

    var body: some View {
        let s = Scale(width: width)
        ZStack {
            PaperBackground()
            VStack(spacing: s(4)) {
                HStack(alignment: .top) {
                    ValueBadge(value: card.value, width: width)
                    Spacer()
                    Text(card.kind == .building ? "BUILD" : "ACTION")
                        .font(.system(size: s(6.5), weight: .heavy, design: .rounded))
                        .tracking(0.4)
                        .foregroundStyle(accent)
                }

                emblem(s)
                    .frame(width: s(60), height: s(60))

                Spacer(minLength: 0)

                Text(card.name)
                    .font(.system(size: s(11.5), weight: .black, design: .rounded))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .foregroundStyle(Palette.ink)

                Text(CardText.summary(card))
                    .font(.system(size: s(7), weight: .semibold, design: .rounded))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                    .foregroundStyle(Palette.ink.opacity(0.66))
            }
            .padding(s(6))
        }
    }

    @ViewBuilder
    private func emblem(_ s: Scale) -> some View {
        let isRent = card.actionKind == .rent || card.actionKind == .rent_wild || (card.actionKind == .double_rent && !card.rentColors.isEmpty)
        ZStack {
            if isRent {
                RentWheel(colors: card.rentColors)
                Circle().fill(Palette.paper).padding(s(10))
                Text(card.actionKind == .double_rent ? "x2" : "RENT")
                    .font(.system(size: s(card.actionKind == .double_rent ? 16 : 10.5), weight: .black, design: .rounded))
                    .foregroundStyle(Palette.ink)
            } else {
                Circle()
                    .fill(RadialGradient(colors: [accent.opacity(0.85), accent], center: .topLeading, startRadius: 0, endRadius: s(60)))
                Circle()
                    .strokeBorder(.white.opacity(0.5), lineWidth: s(1.5))
                    .padding(s(3.5))
                if card.actionKind == .double_rent {
                    Text("x2")
                        .font(.system(size: s(24), weight: .black, design: .rounded))
                        .foregroundStyle(.white)
                } else {
                    Image(systemName: CardText.symbol(card))
                        .font(.system(size: s(26), weight: .bold))
                        .foregroundStyle(.white)
                }
            }
        }
    }
}

/// A ring split evenly among the colors a rent card charges for.
private struct RentWheel: View {
    var colors: [PropertyColor]

    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = min(size.width, size.height) / 2
            let step = 360.0 / Double(max(colors.count, 1))
            for (index, color) in colors.enumerated() {
                var path = Path()
                path.move(to: center)
                path.addArc(center: center, radius: radius, startAngle: .degrees(Double(index) * step - 90), endAngle: .degrees(Double(index + 1) * step - 90), clockwise: false)
                path.closeSubpath()
                context.fill(path, with: .color(color.tint))
            }
        }
    }
}

// MARK: Back

struct CardBack: View {
    var width: CGFloat

    var body: some View {
        let s = Scale(width: width)
        ZStack {
            LinearGradient(colors: [Color(hex: 0xC42B35), Color(hex: 0x8E1721)], startPoint: .topLeading, endPoint: .bottomTrailing)
            RoundedRectangle(cornerRadius: s(6), style: .continuous)
                .strokeBorder(.white.opacity(0.55), lineWidth: s(1.5))
                .padding(s(6))
            Text("DEAL")
                .font(.system(size: s(21), weight: .black, design: .rounded))
                .tracking(1)
                .foregroundStyle(.white)
                .rotationEffect(.degrees(-24))
        }
        .frame(width: width, height: width * CardView.aspect)
    }
}

// MARK: Text

enum CardText {
    static func colorName(_ color: PropertyColor) -> String { color.label }

    static func spokenName(_ card: CardDefinition) -> String {
        switch card.kind {
        case .money: "\(card.value) dollar money"
        case .property: "\(card.color?.label ?? "") property, worth \(card.value) dollars"
        case .wild: "\(card.name), worth \(card.value) dollars"
        default: "\(card.name), worth \(card.value) dollars"
        }
    }

    static func symbol(_ card: CardDefinition) -> String {
        switch card.actionKind {
        case .pass_go: "arrow.forward"
        case .debt_collector: "person.fill.questionmark"
        case .its_my_birthday: "birthday.cake.fill"
        case .sly_deal: "hand.point.up.left.fill"
        case .forced_deal: "arrow.left.arrow.right"
        case .deal_breaker: "bolt.fill"
        case .house: "house.fill"
        case .hotel: "building.2.fill"
        case .shack: "house.lodge.fill"
        case .go_again: "arrow.clockwise"
        case .forced_debt: "creditcard.fill"
        case .heist: "lock.open.fill"
        case .market_crash: "chart.line.downtrend.xyaxis"
        case .repossession: "truck.box.fill"
        case .super_sly_deal: "hand.raised.fingers.spread.fill"
        case .tax_collector: "percent"
        case .tough_luck: "cloud.bolt.rain.fill"
        case .unfair_trade: "scalemass.fill"
        case .yoink: "hand.draw.fill"
        case .just_say_no: "hand.raised.fill"
        default: "star.fill"
        }
    }

    /// The one-line reminder printed on the card.
    static func summary(_ card: CardDefinition) -> String {
        switch card.actionKind {
        case .pass_go: card.id == "pass_go_go_go" ? "Draw back up to 7 cards." : "Draw 2 extra cards."
        case .rent: "Charge rent on one color."
        case .rent_wild: "All players pay rent."
        case .double_rent: card.rentColors.isEmpty ? "Doubles your next rent." : "All players pay double."
        case .debt_collector: "One player pays you $5."
        case .its_my_birthday: "Everyone pays you $2."
        case .sly_deal: "Steal a property not in a full set."
        case .forced_deal: "Swap a property with a player."
        case .deal_breaker: "Steal a complete set."
        case .house: "Adds $3 rent to a full set."
        case .hotel: "Adds $4 rent. Needs a House."
        case .shack: "Adds $5 rent to a property."
        case .go_again: "Take another turn."
        case .forced_debt: "Give a player a debt chip."
        case .heist: "Steal a Bank card from everyone."
        case .market_crash: "Take a property from everyone."
        case .repossession: "They keep 1 property, and give away the rest."
        case .super_sly_deal: "Take one color from everyone."
        case .tax_collector: "They keep 1 Bank card, and give away the rest."
        case .tough_luck: "Take one card type from a hand."
        case .unfair_trade: "Swap Banks with a player."
        case .yoink: "One player pays you $10."
        case .just_say_no: "Cancel an action against you."
        default: ""
        }
    }
}
