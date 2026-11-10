import DealEngine
import Foundation

// Earned from what the stats already count, so nothing new is stored and progress is never
// lost. Mirrors `src/ui/unlockables.ts`.

public enum CardBackStyle: String, Codable, CaseIterable, Hashable, Sendable {
    case classic_red, ocean_blue, forest_green, midnight_gold, neon_grid

    public var label: String {
        switch self {
        case .classic_red: "Classic Red"
        case .ocean_blue: "Ocean Blue"
        case .forest_green: "Forest Green"
        case .midnight_gold: "Midnight Gold"
        case .neon_grid: "Neon Grid"
        }
    }
}

public struct UnlockRule: Hashable, Sendable {
    public var needs: String
    public var wins = 0
    public var actions = 0
    public var quickWins = 0

    public func isMet(by counters: AchievementState.Counters) -> Bool {
        counters.wins >= wins && counters.actions >= actions && counters.quickWins >= quickWins
    }
}

extension TableTheme {
    /// Nil when the style is free.
    public var unlockRule: UnlockRule? {
        switch self {
        case .premium_tabletop, .classic_green, .neon_arcade: nil
        case .sunset_lounge: UnlockRule(needs: "Win a game", wins: 1)
        case .royal_velvet: UnlockRule(needs: "Make 100 moves", actions: 100)
        case .midnight_vault: UnlockRule(needs: "Win 10 games", wins: 10)
        }
    }

    public func isUnlocked(_ counters: AchievementState.Counters) -> Bool { unlockRule?.isMet(by: counters) ?? true }
}

extension CardBackStyle {
    /// Nil when the back is free.
    public var unlockRule: UnlockRule? {
        switch self {
        case .classic_red: nil
        case .ocean_blue: UnlockRule(needs: "Win a game", wins: 1)
        case .forest_green: UnlockRule(needs: "Win 5 games", wins: 5)
        case .neon_grid: UnlockRule(needs: "Win within 12 turns", quickWins: 1)
        case .midnight_gold: UnlockRule(needs: "Win 10 games", wins: 10)
        }
    }

    public func isUnlocked(_ counters: AchievementState.Counters) -> Bool { unlockRule?.isMet(by: counters) ?? true }
}

public enum Unlockables {
    /// What a game's result just earned, for the results screen.
    public static func newlyUnlocked(before: AchievementState.Counters, after: AchievementState.Counters) -> [String] {
        let styles = TableTheme.allCases.filter { !$0.isUnlocked(before) && $0.isUnlocked(after) }.map { "\($0.label) table style" }
        let backs = CardBackStyle.allCases.filter { !$0.isUnlocked(before) && $0.isUnlocked(after) }.map { "\($0.label) card back" }
        return styles + backs
    }
}

// MARK: Replays

/// An opening state and its moves, which rebuild the game exactly because the engine is deterministic.
public struct GameLog: Codable, Hashable, Sendable {
    public var initial: GameState
    public var actions: [Action]

    public init(initial: GameState, actions: [Action] = []) {
        self.initial = initial
        self.actions = actions
    }

    /// Every position of the game. A move that won't apply ends the replay there.
    public func positions() -> [GameState] {
        var result = [initial]
        var state = initial
        for action in actions {
            let next = Engine.applyAction(state, action)
            if next.error != nil { break }
            state = next.state
            result.append(state)
        }
        return result
    }

    /// The recorded draw step for the sole human's turn in a complete local replay.
    public static func retryTurnStart(in positions: [GameState], actionCount: Int, at index: Int) -> GameState? {
        guard positions.indices.contains(index), let last = positions.last,
              positions.count == actionCount + 1, Engine.isGameOver(last).done else { return nil }
        let current = positions[index]
        let humans = current.players.filter { $0.controller != .bot }
        guard !Engine.isGameOver(current).done, humans.count == 1,
              current.players[current.currentPlayerIndex].id == humans[0].id else { return nil }
        return positions[...index].reversed()
            .prefix(while: { $0.turnCount == current.turnCount })
            .first(where: { $0.turn.phase == .draw && $0.pending == nil })
    }
}

public struct StoredReplay: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var endedAt: Double
    public var title: String
    public var initial: GameState
    public var actions: [Action]

    public init(id: String, endedAt: Double, title: String, log: GameLog) {
        self.id = id
        self.endedAt = endedAt
        self.title = title
        initial = log.initial
        actions = log.actions
    }

    public var log: GameLog { GameLog(initial: initial, actions: actions) }
}

// MARK: Match options

public struct MatchSeries: Codable, Hashable, Sendable {
    public var bestOf: Int
    public var wins: [String: Int]
    public var gameNumber: Int
    public var winnerId: PlayerId?

    public init(bestOf: Int = 3, wins: [String: Int] = [:], gameNumber: Int = 1, winnerId: PlayerId? = nil) {
        self.bestOf = bestOf
        self.wins = wins
        self.gameNumber = gameNumber
        self.winnerId = winnerId
    }

    public func recording(winner: PlayerId) -> MatchSeries {
        guard winnerId == nil else { return self }
        var next = self
        next.wins[winner, default: 0] += 1
        if next.wins[winner, default: 0] * 2 > bestOf { next.winnerId = winner }
        return next
    }

    /// The next game of this series, or game one of a fresh series once this one is won.
    public var next: MatchSeries {
        if winnerId != nil { return MatchSeries(bestOf: bestOf) }
        var next = self
        next.gameNumber += 1
        return next
    }
}

/// Speed and series, tied to the game they were chosen for.
public struct MatchOptions: Codable, Hashable, Sendable {
    public var speed = false
    /// How long a Speed turn lasts: 30, 45 or 60.
    public var speedSeconds: Int?
    public var series: MatchSeries?
    public var gameCreatedAt: Double = 0

    public init(speed: Bool = false, speedSeconds: Int? = nil, series: MatchSeries? = nil) {
        self.speed = speed
        self.speedSeconds = speedSeconds
        self.series = series
    }
}
