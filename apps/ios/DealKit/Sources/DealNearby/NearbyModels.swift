import DealEngine
import Foundation

/// A table hosted on one phone and joined by phones close by, with no internet. The host
/// runs the rules, like the room server does online, and sends each phone its own view.
public enum Nearby {
    /// Bonjour service name: at most 15 lowercase letters, digits and hyphens. The app's
    /// Info.plist lists it under `NSBonjourServices`.
    public static let serviceType = "mdeal-nearby"
    /// Bumped when a message changes in a way an older build can't read.
    public static let protocolVersion = 1
    public static let maxSeats = 5
    public static let maxNameLength = 24
}

/// One seat at the table, as every phone sees it.
public struct NearbySeat: Codable, Hashable, Sendable, Identifiable {
    public var id: PlayerId
    public var name: String
    public var isHost: Bool
    /// A bot the host added, rather than one covering for someone.
    public var isBot: Bool
    public var botDifficulty: BotDifficulty?
    /// The phone holding this seat is linked. Always true for the host and bots.
    public var connected: Bool
    /// A bot plays this seat until its player comes back.
    public var botCovering: Bool

    public var isAway: Bool { !connected && !botCovering }
}

/// Whose turn the clock is timing, in the host's clock.
public struct NearbyTurnClock: Codable, Hashable, Sendable {
    public var playerId: PlayerId
    public var startedAt: Double
}

/// A finished game, for the replay. Sent only once the game is over, when nothing is hidden.
public struct NearbyGameLog: Codable, Hashable, Sendable {
    public var initial: GameState
    public var actions: [Action]
}

/// What one phone is shown: the game with other hands hidden, and its own legal moves.
public struct NearbyView: Codable, Hashable, Sendable {
    public var tableId: String
    public var yourSeatId: PlayerId
    public var seats: [NearbySeat]
    public var variant: GameVariant
    public var game: GameState?
    public var legalActions: [LegalAction]
    /// Goes up with every change, so a move made against an older board is refused.
    public var revision: Int
    public var canUndo: Bool
    public var paused: Bool
    public var turnClock: NearbyTurnClock?
    public var hostTime: Double
    public var log: NearbyGameLog?

    public var hostSeat: NearbySeat? { seats.first(where: \.isHost) }
    public var yourSeat: NearbySeat? { seats.first { $0.id == yourSeatId } }
    public var started: Bool { game != nil }
    public var isFinished: Bool { game.map { Engine.isGameOver($0).done } ?? false }
    public var awaySeats: [NearbySeat] { seats.filter(\.isAway) }

    /// Why play has stopped, in words for the pause screen.
    public var pauseMessage: String {
        let names = awaySeats.map(\.name)
        guard let last = names.last else { return "Waiting for a player to come back." }
        let list = names.count > 1 ? "\(names.dropLast().joined(separator: ", ")) and \(last)" : last
        return "\(list) dropped out. The game goes on when \(names.count > 1 ? "they come" : "that phone comes") back."
    }
}

/// Why the host turned a phone away.
public enum NearbyRefusal: String, Codable, Hashable, Sendable, Error, LocalizedError {
    case tableFull, gameInProgress, versionMismatch, removed, closed

    public var errorDescription: String? {
        switch self {
        case .tableFull: "That table is full."
        case .gameInProgress: "That game has already started without you."
        case .versionMismatch: "That phone has a different version of the app. Install the same build on both."
        case .removed: "The host removed you from the table."
        case .closed: "The host closed the table."
        }
    }
}

public struct NearbyJoinRequest: Codable, Hashable, Sendable {
    public var name: String
    /// Proves a returning phone owns its seat. Kept on the phone, never shown.
    public var seatToken: String
    public var protocolVersion: Int

    public init(name: String, seatToken: String, protocolVersion: Int = Nearby.protocolVersion) {
        self.name = name
        self.seatToken = seatToken
        self.protocolVersion = protocolVersion
    }
}

/// Sent by a joining phone to the host.
public enum NearbyGuestMessage: Codable, Hashable, Sendable {
    case join(NearbyJoinRequest)
    case perform(Action, revision: Int)
    case undo(revision: Int)
    case resetTurn(revision: Int)
    /// Gives the seat up for good. A bot plays it from here.
    case leave
}

/// Sent by the host to one phone.
public enum NearbyHostMessage: Codable, Hashable, Sendable {
    case seated(seatId: PlayerId)
    case refused(NearbyRefusal)
    case view(NearbyView)
    /// A move that wasn't applied. The view that follows shows the board as it is.
    case rejected(message: String)
}

enum NearbyCoding {
    static func encode<T: Encodable>(_ value: T) throws -> Data { try JSONEncoder().encode(value) }
    static func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T { try JSONDecoder().decode(type, from: data) }
}

extension String {
    /// A player's name as the table shows it: trimmed and short, never empty.
    func nearbyName(fallback: String) -> String {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? fallback : String(trimmed.prefix(Nearby.maxNameLength))
    }
}
