import Foundation

/// Names bots go by instead of "Player N", drawn at random each game.
/// Matches `src/ai/botNames.ts`.
public enum BotNames {
    public static let all = [
        "Ada", "Milo", "Rosa", "Otis", "Ivy", "Hugo", "Mabel", "Felix",
        "Nora", "Theo", "Pearl", "Gus", "Clara", "Jasper", "Wren", "Bruno",
    ]

    public static func defaultSeatName(_ index: Int) -> String {
        "Player \(index + 1)"
    }

    /// A bot seat with no name of its own is left blank in setup, and draws a name
    /// when the game starts. A name someone typed is always kept.
    public static func seatName(_ name: String, at index: Int, for controller: PlayerController) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if controller == .bot { return trimmed == defaultSeatName(index) ? "" : name }
        return trimmed.isEmpty ? defaultSeatName(index) : name
    }

    /// A random bot name nobody at the table has.
    public static func random<G: RandomNumberGenerator>(taken: [String], using generator: inout G) -> String {
        let used = Set(taken.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        let free = all.filter { !used.contains($0.lowercased()) }
        return (free.isEmpty ? all : free).randomElement(using: &generator)!
    }

    public static func random(taken: [String]) -> String {
        var generator = SystemRandomNumberGenerator()
        return random(taken: taken, using: &generator)
    }

    /// The names seats start a game with: bot seats without a name of their own draw one.
    public static func startingNames<G: RandomNumberGenerator>(_ seats: [(name: String, controller: PlayerController)], using generator: inout G) -> [String] {
        var names = seats.enumerated().map { index, seat -> String in
            let trimmed = seat.name.trimmingCharacters(in: .whitespacesAndNewlines)
            if seat.controller == .bot && (trimmed.isEmpty || trimmed == defaultSeatName(index)) { return "" }
            return trimmed.isEmpty ? defaultSeatName(index) : trimmed
        }
        for index in names.indices where names[index].isEmpty {
            names[index] = random(taken: names, using: &generator)
        }
        return names
    }

    public static func startingNames(_ seats: [(name: String, controller: PlayerController)]) -> [String] {
        var generator = SystemRandomNumberGenerator()
        return startingNames(seats, using: &generator)
    }
}
