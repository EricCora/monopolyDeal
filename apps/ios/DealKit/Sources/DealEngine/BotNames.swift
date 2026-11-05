import Foundation

/// Names bots go by instead of "Player N". A local seat always gets the same
/// one, so its lifetime stats stay under one name. Matches `src/ai/botNames.ts`.
public enum BotNames {
    public static let all = ["Ada", "Milo", "Rosa", "Otis", "Ivy", "Hugo", "Mabel", "Felix"]

    public static func defaultSeatName(_ index: Int) -> String {
        "Player \(index + 1)"
    }

    public static func seatBotName(_ index: Int) -> String {
        all[index % all.count]
    }

    /// The name a seat should show after its controller changes, keeping any name someone typed.
    public static func seatName(_ name: String, at index: Int, for controller: PlayerController) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if controller == .bot {
            return trimmed.isEmpty || trimmed == defaultSeatName(index) ? seatBotName(index) : name
        }
        return trimmed == seatBotName(index) ? defaultSeatName(index) : name
    }

    /// The first bot name nobody at the table has, for bots added to a room or nearby table.
    public static func next(taken: [String]) -> String {
        let used = Set(taken.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        return all.first { !used.contains($0.lowercased()) } ?? all[0]
    }
}
