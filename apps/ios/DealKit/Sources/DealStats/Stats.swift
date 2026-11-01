import DealEngine
import Foundation

/// Mirrors `src/stats/` and the save schema in `src/persistence/storage.ts`.
public enum MatchMode: String, Codable, Hashable, Sendable {
    case hot_seat, practice, daily_challenge, live_online

    public var label: String {
        switch self {
        case .hot_seat: "Pass & Play"
        case .practice: "Practice"
        case .daily_challenge: "Daily Challenge"
        case .live_online: "Online"
        }
    }
}

public enum MatchSurface: String, Codable, Hashable, Sendable { case local, multiplayer }

public struct MatchRecord: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var startedAt: Double
    public var endedAt: Double
    public var players: [String]
    public var winnerId: String?
    public var winnerName: String?
    public var turnCount: Int
    public var durationSec: Int
    public var actionsByType: [String: Int]
    public var mode: MatchMode
    public var surface: MatchSurface
    public var presetId: String?
    public var roomCode: String?

    public var endedDate: Date { Date(timeIntervalSince1970: endedAt / 1000) }
}

public struct LifetimePlayerStats: Codable, Hashable, Sendable {
    public var name: String
    public var gamesPlayed = 0
    public var wins = 0
    public var totalTurns = 0
    public var totalDurationSec = 0
    public var actionsByType: [String: Int] = [:]
}

public struct LifetimeStats: Codable, Hashable, Sendable {
    public var version = 1
    public var players: [String: LifetimePlayerStats] = [:]

    public init() {}
}

public enum AchievementId: String, Codable, CaseIterable, Hashable, Sendable {
    case first_win, ten_wins, action_century, quick_win

    public var label: String {
        switch self {
        case .first_win: "First Win"
        case .ten_wins: "Ten Wins"
        case .action_century: "Action Century"
        case .quick_win: "Quick Win"
        }
    }

    public var detail: String {
        switch self {
        case .first_win: "Finish a game with a winner."
        case .ten_wins: "Finish ten games with a winner."
        case .action_century: "Play 100 actions across all games."
        case .quick_win: "Win within 12 turns."
        }
    }

    public var symbol: String {
        switch self {
        case .first_win: "trophy.fill"
        case .ten_wins: "medal.fill"
        case .action_century: "bolt.fill"
        case .quick_win: "hare.fill"
        }
    }

    var target: Int {
        switch self {
        case .first_win, .quick_win: 1
        case .ten_wins: 10
        case .action_century: 100
        }
    }
}

public struct AchievementState: Codable, Hashable, Sendable {
    public struct Counters: Codable, Hashable, Sendable {
        public var wins = 0
        public var actions = 0
        public var gamesPlayed = 0
        public var quickWins = 0
    }

    public var version = 1
    public var counters = Counters()
    public var unlockedAt: [String: Double] = [:]

    public init() {}

    public func isUnlocked(_ id: AchievementId) -> Bool { unlockedAt[id.rawValue] != nil }

    public func progress(_ id: AchievementId) -> Int {
        switch id {
        case .first_win, .ten_wins: counters.wins
        case .action_century: counters.actions
        case .quick_win: counters.quickWins
        }
    }

    public func applying(_ match: MatchRecord) -> AchievementState {
        var next = self
        next.counters.gamesPlayed += 1
        next.counters.actions += match.actionsByType.values.reduce(0, +)
        if match.winnerName != nil { next.counters.wins += 1 }
        if match.turnCount <= 12 && match.winnerName != nil { next.counters.quickWins += 1 }
        for id in AchievementId.allCases where next.progress(id) >= id.target && next.unlockedAt[id.rawValue] == nil {
            next.unlockedAt[id.rawValue] = match.endedAt
        }
        return next
    }

    public func newUnlocks(comparedTo previous: AchievementState) -> [AchievementId] {
        AchievementId.allCases.filter { !previous.isUnlocked($0) && isUnlocked($0) }
    }
}

public struct DailyChallenge: Codable, Hashable, Sendable {
    public var version = 1
    public var day: String
    public var seed: Int
    public var targetTurns: Int
    public var completed = false
    public var attempts = 0
    public var bestTurnCount: Int?

    public static func dayString(_ date: Date, calendar: Calendar = .current) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    /// Same seed as the web app for the same day, so the same deal comes up on both.
    public static func seed(forDay day: String) -> Int {
        day.utf16.reduce(0) { ($0 * 31 + Int($1)) % 1_000_000_007 }
    }

    public init(day: String) {
        self.day = day
        seed = Self.seed(forDay: day)
        targetTurns = 12 + seed % 4
    }

    public static func current(_ existing: DailyChallenge?, now: Date = Date()) -> DailyChallenge {
        let day = dayString(now)
        if let existing, existing.version == 1, existing.day == day { return existing }
        return DailyChallenge(day: day)
    }

    public func applying(_ match: MatchRecord) -> DailyChallenge {
        var next = self
        next.attempts += 1
        if let best = next.bestTurnCount {
            next.bestTurnCount = min(best, match.turnCount)
        } else {
            next.bestTurnCount = match.turnCount
        }
        if match.turnCount <= next.targetTurns { next.completed = true }
        return next
    }
}

public enum StatsBuilder {
    public static func matchRecord(_ state: GameState, mode: MatchMode, surface: MatchSurface, presetId: String? = nil, roomCode: String? = nil) -> MatchRecord {
        var actions: [String: Int] = [:]
        for event in state.history { actions[event.type, default: 0] += 1 }
        let winner = state.players.first { $0.id == state.winnerId }
        return MatchRecord(
            id: "\(Int(state.createdAt))-\(Int(state.updatedAt))",
            startedAt: state.createdAt,
            endedAt: state.updatedAt,
            players: state.players.map(\.name),
            winnerId: state.winnerId,
            winnerName: winner?.name,
            turnCount: state.turnCount,
            durationSec: max(1, Int((state.updatedAt - state.createdAt) / 1000)),
            actionsByType: actions,
            mode: mode,
            surface: surface,
            presetId: presetId,
            roomCode: roomCode
        )
    }

    public static func applying(_ match: MatchRecord, to stats: LifetimeStats) -> LifetimeStats {
        var next = stats
        for name in match.players {
            var player = next.players[name] ?? LifetimePlayerStats(name: name)
            player.gamesPlayed += 1
            player.totalTurns += match.turnCount
            player.totalDurationSec += match.durationSec
            for (type, count) in match.actionsByType { player.actionsByType[type, default: 0] += count }
            next.players[name] = player
        }
        if let winner = match.winnerName {
            var player = next.players[winner] ?? LifetimePlayerStats(name: winner)
            player.wins += 1
            next.players[winner] = player
        }
        return next
    }
}

// MARK: Post-game recap

public struct PostGamePlayerRow: Hashable, Sendable, Identifiable {
    public var id: String { playerId }
    public var playerId: String
    public var name: String
    public var rank: Int
    public var isWinner: Bool
    public var completeSets: Int
    public var bankValue: Int
    public var propertyCardCount: Int
    public var handCount: Int
    public var totalCardValue: Int
    public var lifetimeWins: Int
    public var lifetimeGamesPlayed: Int
}

public struct PostGameSummary: Hashable, Sendable {
    public var winnerId: String?
    public var winnerName: String?
    public var endedAt: Double
    public var turnCount: Int
    public var durationSec: Int
    public var totalEvents: Int
    public var finalSwing: String
    public var winningMove: String
    public var momentumShift: String
    public var highlightCards: [String]
    public var players: [PostGamePlayerRow]
    public var recentEvents: [GameEvent]
}

public enum PostGame {
    private static let impactful: Set<String> = ["deal_breaker", "forced_deal", "sly_deal", "rent_target", "pay", "payment", "counter", "action", "property", "wild_move", "bank"]
    private static let aliases: [String: String] = [
        "deal breaker": "Deal Breaker", "forced deal": "Forced Deal", "sly deal": "Sly Deal",
        "debt collector": "Debt Collector", "its my birthday": "It's My Birthday", "pass go": "Pass Go",
        "double rent": "Double Rent", "just say no": "Just Say No", "rent": "Rent", "house": "House", "hotel": "Hotel",
    ]

    private static func normalize(_ label: String) -> String? {
        var cleaned = label.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        while let last = cleaned.last, ".!,:;".contains(last) { cleaned.removeLast() }
        if cleaned.isEmpty { return nil }
        let key = cleaned.lowercased().filter { $0.isLetter || $0.isNumber || $0 == " " }
        return aliases[key] ?? cleaned
    }

    private static func firstCapture(_ pattern: String, _ text: String, count: Int = 1) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return [] }
        return (1...count).compactMap { Range(match.range(at: $0), in: text).map { String(text[$0]) } }
    }

    private static func cardMentions(_ message: String) -> [String] {
        var mentions: [String] = []
        func add(_ label: String) {
            if let normalized = normalize(label), !mentions.contains(normalized) { mentions.append(normalized) }
        }
        firstCapture("played (.+?)(?: and| on| for| at|\\.|$)", message).forEach(add)
        firstCapture("banked (.+?)\\.", message).forEach(add)
        firstCapture("placed (.+?) in ", message).forEach(add)
        firstCapture("moved (.+?) to ", message).forEach(add)
        firstCapture("took (.+?) from ", message).forEach(add)
        firstCapture("swapped (.+?) for (.+?)\\.", message, count: 2).forEach(add)
        firstCapture("\\((.+)\\)", message).forEach(add)
        if !firstCapture("(charged .* rent)", message).isEmpty || !firstCapture("(played rent)", message).isEmpty { add("Rent") }
        return mentions
    }

    private static func momentumMessage(_ event: GameEvent?, winner: String?) -> String {
        let actor = winner ?? "The winner"
        guard let event else { return "\(actor) kept pressure up through the closing sequence." }
        let lower = event.message.lowercased()
        switch event.type {
        case "deal_breaker": return "\(actor) flipped control by stealing a complete set."
        case "rent_target": return "\(actor) converted board pressure into a major rent hit."
        case "action" where lower.contains("debt collector"): return "\(actor) forced a Debt Collector swing."
        case "action" where lower.contains("rent"): return "\(actor) set up the finishing rent sequence."
        case "property": return "\(actor) locked in board position with a key property play."
        case "pay": return "A high-value payment swung table economy right before the finish."
        default: return event.message
        }
    }

    public static func summary(_ state: GameState, lifetime: LifetimeStats) -> PostGameSummary {
        let variant = state.resolvedVariant
        // Online, other players' hands arrive as hidden placeholders, which count for nothing.
        func zone(_ cards: [String]) -> Int {
            cards.reduce(0) { total, cardId in
                total + (Catalog.lookup(cardId, variant).map { $0.moneyValue ?? $0.value } ?? 0)
            }
        }
        struct Ranked {
            var player: PlayerState
            var sets: Int
            var bank: Int
            var props: Int
            var hand: Int
            var total: Int
        }
        let ranked = state.players.map { player -> Ranked in
            let propertyCards = PropertyColor.allCases.flatMap { player.properties[$0].map(\.cardId) }
            let bank = zone(player.bank)
            return Ranked(player: player, sets: Engine.countCompleteSets(player, variant), bank: bank, props: propertyCards.count, hand: player.hand.count, total: bank + zone(propertyCards) + zone(player.hand))
        }.sorted { left, right in
            if left.sets != right.sets { return left.sets > right.sets }
            if left.bank != right.bank { return left.bank > right.bank }
            if left.props != right.props { return left.props > right.props }
            if left.hand != right.hand { return left.hand < right.hand }
            return left.player.name.localizedCompare(right.player.name) == .orderedAscending
        }

        let events = state.history
        let winner = state.players.first { $0.id == state.winnerId }
        let trimmedWinner = winner?.name.trimmingCharacters(in: .whitespaces)
        func isImpactful(_ event: GameEvent) -> Bool { impactful.contains(event.type) }

        var winningIndex = -1
        if let trimmedWinner, !trimmedWinner.isEmpty {
            winningIndex = events.lastIndex { isImpactful($0) && $0.message.contains(trimmedWinner) } ?? -1
        }
        if winningIndex < 0 { winningIndex = events.lastIndex(where: isImpactful) ?? events.count - 1 }
        let winningEvent = winningIndex >= 0 ? events[winningIndex] : nil

        let fallbackSwing = events.last(where: isImpactful)?.message ?? events.last?.message ?? "No key swing captured this match."
        var momentum: GameEvent?
        let searchEnd = winningIndex >= 0 ? winningIndex - 1 : events.count - 1
        if searchEnd >= 0 { momentum = events[0...searchEnd].last(where: isImpactful) }
        momentum = momentum ?? winningEvent ?? events.last

        var ordered: [GameEvent] = []
        if let winningEvent { ordered.append(winningEvent) }
        if let momentum, momentum != winningEvent { ordered.append(momentum) }
        ordered += events.reversed()
        var highlights: [String] = []
        outer: for event in ordered {
            for mention in cardMentions(event.message) where !highlights.contains(mention) {
                highlights.append(mention)
                if highlights.count >= 3 { break outer }
            }
        }

        return PostGameSummary(
            winnerId: state.winnerId,
            winnerName: winner?.name,
            endedAt: state.updatedAt,
            turnCount: state.turnCount,
            durationSec: max(1, Int((state.updatedAt - state.createdAt) / 1000)),
            totalEvents: events.count,
            finalSwing: fallbackSwing,
            winningMove: winningEvent?.message ?? fallbackSwing,
            momentumShift: momentumMessage(momentum, winner: winner?.name),
            highlightCards: highlights,
            players: ranked.enumerated().map { index, entry in
                let record = lifetime.players[entry.player.name]
                return PostGamePlayerRow(
                    playerId: entry.player.id, name: entry.player.name, rank: index + 1,
                    isWinner: entry.player.id == state.winnerId, completeSets: entry.sets, bankValue: entry.bank,
                    propertyCardCount: entry.props, handCount: entry.hand, totalCardValue: entry.total,
                    lifetimeWins: record?.wins ?? 0, lifetimeGamesPlayed: record?.gamesPlayed ?? 0
                )
            },
            recentEvents: Array(events.suffix(6).reversed())
        )
    }
}
