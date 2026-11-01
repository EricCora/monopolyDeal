import DealEngine
import Foundation

public struct ActiveGame: Codable, Hashable, Sendable {
    public var version = 1
    public var timestamp: Double
    public var gameState: GameState
    public var matchMode: MatchMode?
}

public struct SavedSlot: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var createdAt: Double
    public var updatedAt: Double
    public var gameState: GameState
    public var matchMode: MatchMode?
}

public enum TableTheme: String, Codable, CaseIterable, Hashable, Sendable {
    case premium_tabletop, classic_green, neon_arcade

    public var label: String {
        switch self {
        case .premium_tabletop: "Premium Tabletop"
        case .classic_green: "Classic Felt"
        case .neon_arcade: "Neon Arcade"
        }
    }
}

public struct Preferences: Codable, Hashable, Sendable {
    public var tableStyle = TableTheme.premium_tabletop
    public var reducedEffects = false
    public var confirmRiskyActions = true
    public var soundEnabled = true
    public var hapticsEnabled = true
    public var coachEnabled = false
    public var hardCoach = false
    public var customRulesEnabled = false
    public var onlineName = ""
    public var gamePaused = false
    public var pausedGameId: String?

    public init() {}

    private enum CodingKeys: String, CodingKey {
        case tableStyle, reducedEffects, confirmRiskyActions, soundEnabled, hapticsEnabled, coachEnabled
        case hardCoach, customRulesEnabled, onlineName, gamePaused, pausedGameId
    }

    /// Every field falls back to its default, so a newer build can add settings freely.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tableStyle = (try? c.decodeIfPresent(TableTheme.self, forKey: .tableStyle)) ?? .premium_tabletop
        reducedEffects = (try? c.decodeIfPresent(Bool.self, forKey: .reducedEffects)) ?? false
        confirmRiskyActions = (try? c.decodeIfPresent(Bool.self, forKey: .confirmRiskyActions)) ?? true
        soundEnabled = (try? c.decodeIfPresent(Bool.self, forKey: .soundEnabled)) ?? true
        hapticsEnabled = (try? c.decodeIfPresent(Bool.self, forKey: .hapticsEnabled)) ?? true
        coachEnabled = (try? c.decodeIfPresent(Bool.self, forKey: .coachEnabled)) ?? false
        hardCoach = (try? c.decodeIfPresent(Bool.self, forKey: .hardCoach)) ?? false
        customRulesEnabled = (try? c.decodeIfPresent(Bool.self, forKey: .customRulesEnabled)) ?? false
        onlineName = (try? c.decodeIfPresent(String.self, forKey: .onlineName)) ?? ""
        gamePaused = (try? c.decodeIfPresent(Bool.self, forKey: .gamePaused)) ?? false
        pausedGameId = try? c.decodeIfPresent(String.self, forKey: .pausedGameId)
    }
}

public enum SaveError: Error, Equatable { case slotsFull }

/// JSON files in the app's support folder, one per kind of record. A file that can't be
/// read is treated as empty rather than blocking the app.
public final class DealStore: @unchecked Sendable {
    public static let maxSavedSlots = 5
    public static let maxHistory = 50

    private let directory: URL
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public static func defaultDirectory() -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("MonopolyDeal", isDirectory: true)
    }

    private func url(_ name: String) -> URL { directory.appendingPathComponent("\(name).v1.json") }

    private func load<T: Decodable>(_ type: T.Type, _ name: String) -> T? {
        guard let data = try? Data(contentsOf: url(name)) else { return nil }
        return try? decoder.decode(type, from: data)
    }

    private func save<T: Encodable>(_ value: T, _ name: String) {
        guard let data = try? encoder.encode(value) else { return }
        try? data.write(to: url(name), options: [.atomic])
    }

    private func remove(_ name: String) {
        try? FileManager.default.removeItem(at: url(name))
    }

    private static func nowMs() -> Double { (Date().timeIntervalSince1970 * 1000).rounded(.down) }

    // MARK: Active game

    public func saveActiveGame(_ state: GameState, mode: MatchMode) {
        save(ActiveGame(timestamp: Self.nowMs(), gameState: Engine.normalizeGameState(state), matchMode: mode), "activeGame")
    }

    public func loadActiveGame() -> ActiveGame? {
        guard var active = load(ActiveGame.self, "activeGame"), active.version == 1 else { return nil }
        active.gameState = Engine.normalizeGameState(active.gameState)
        return active
    }

    public func clearActiveGame() { remove("activeGame") }

    // MARK: Save slots

    public func savedSlots() -> [SavedSlot] {
        (load([SavedSlot].self, "savedGames") ?? [])
            .sorted { $0.updatedAt > $1.updatedAt }
            .prefix(Self.maxSavedSlots)
            .map {
                var slot = $0
                slot.gameState = Engine.normalizeGameState(slot.gameState)
                return slot
            }
    }

    @discardableResult
    public func upsertSlot(id: String? = nil, name: String, state: GameState, mode: MatchMode) throws -> [SavedSlot] {
        var slots = savedSlots()
        let now = Self.nowMs()
        if let id, let index = slots.firstIndex(where: { $0.id == id }) {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { slots[index].name = trimmed }
            slots[index].updatedAt = now
            slots[index].gameState = Engine.normalizeGameState(state)
            slots[index].matchMode = mode
        } else {
            if slots.count >= Self.maxSavedSlots { throw SaveError.slotsFull }
            slots.append(SavedSlot(id: "slot_\(Int(now))_\(UUID().uuidString.prefix(6))", name: name, createdAt: now, updatedAt: now, gameState: Engine.normalizeGameState(state), matchMode: mode))
        }
        save(slots, "savedGames")
        return savedSlots()
    }

    @discardableResult
    public func renameSlot(id: String, name: String) -> [SavedSlot] {
        var slots = savedSlots()
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let index = slots.firstIndex(where: { $0.id == id }), !trimmed.isEmpty {
            slots[index].name = trimmed
            slots[index].updatedAt = Self.nowMs()
            save(slots, "savedGames")
        }
        return savedSlots()
    }

    @discardableResult
    public func deleteSlot(id: String) -> [SavedSlot] {
        let slots = savedSlots().filter { $0.id != id }
        save(slots, "savedGames")
        return slots
    }

    // MARK: Stats

    public func matchHistory() -> [MatchRecord] { load([MatchRecord].self, "matchHistory") ?? [] }
    public func lifetimeStats() -> LifetimeStats { load(LifetimeStats.self, "lifetimeStats") ?? LifetimeStats() }
    public func achievements() -> AchievementState { load(AchievementState.self, "achievements") ?? AchievementState() }
    public func dailyChallenge() -> DailyChallenge { DailyChallenge.current(load(DailyChallenge.self, "dailyChallenge")) }

    public struct RecordedMatch: Sendable {
        public var lifetime: LifetimeStats
        public var unlocked: [AchievementId]
    }

    /// Adds a finished match to history, lifetime stats, achievements and, for a daily
    /// game, the daily challenge. Online and local games both call this.
    @discardableResult
    public func record(_ match: MatchRecord) -> RecordedMatch {
        var history = matchHistory()
        if !history.contains(where: { $0.id == match.id }) {
            history.insert(match, at: 0)
            save(Array(history.prefix(Self.maxHistory)), "matchHistory")
        }
        let lifetime = StatsBuilder.applying(match, to: lifetimeStats())
        save(lifetime, "lifetimeStats")
        let previous = achievements()
        let next = previous.applying(match)
        save(next, "achievements")
        if match.mode == .daily_challenge { save(dailyChallenge().applying(match), "dailyChallenge") }
        return RecordedMatch(lifetime: lifetime, unlocked: next.newUnlocks(comparedTo: previous))
    }

    public func clearStats() {
        ["matchHistory", "lifetimeStats", "achievements", "dailyChallenge"].forEach(remove)
    }

    // MARK: Preferences

    public func preferences() -> Preferences { load(Preferences.self, "preferences") ?? Preferences() }
    public func savePreferences(_ preferences: Preferences) { save(preferences, "preferences") }
}
