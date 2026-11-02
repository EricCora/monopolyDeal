import DealEngine
import Foundation

/// The game's events by turn. Mirrors `src/ui/table/gameLog.ts`.
public struct LogEntry: Hashable, Sendable, Identifiable {
    public enum Tone: Sendable { case action, money, property, turn, neutral }

    public var id: Int
    public var message: String
    public var type: String
    /// Whoever the entry starts with, so the name can stand out.
    public var actor: String?

    public var tone: Tone {
        switch type {
        case "turn_passed", "draw", "discard": .turn
        case "bank", "pay", "payment": .money
        case "property", "wild_move": .property
        case "counter", "action", "rent_target": .action
        default: .neutral
        }
    }

    public var symbol: String {
        switch type {
        case "turn_passed": "checkmark"
        case "draw": "arrow.down.to.line"
        case "bank", "pay", "payment": "dollarsign"
        case "property", "wild_move": "square.stack.fill"
        case "counter": "hand.raised.fill"
        case "action", "rent_target": "sparkles"
        case "discard": "trash"
        case "game_over": "trophy.fill"
        default: "info"
        }
    }
}

public struct LogTurn: Hashable, Sendable, Identifiable {
    public var number: Int
    public var playerName: String?
    public var entries: [LogEntry]
    public var isCurrent = false

    public var id: Int { number }
}

public enum GameLogModel {
    /// Newest turn first, and newest entry first within it.
    public static func turns(_ events: [GameEvent], playerNames: [String], finished: Bool = false) -> [LogTurn] {
        // Longest first, so "Bot 10" isn't read as "Bot 1".
        let names = playerNames.sorted { $0.count > $1.count }
        var turns: [LogTurn] = []
        var open = false
        for (index, event) in events.enumerated() {
            if !open {
                turns.append(LogTurn(number: turns.count + 1, playerName: nil, entries: []))
                open = true
            }
            let actor = names.first { event.message.hasPrefix("\($0) ") }
            if turns[turns.count - 1].playerName == nil { turns[turns.count - 1].playerName = actor }
            turns[turns.count - 1].entries.append(LogEntry(id: index, message: event.message, type: event.type, actor: actor))
            if event.type == "turn_passed" { open = false }
        }
        if open && !finished { turns[turns.count - 1].isCurrent = true }
        return turns.reversed().map { turn in
            var next = turn
            next.entries.reverse()
            return next
        }
    }
}
