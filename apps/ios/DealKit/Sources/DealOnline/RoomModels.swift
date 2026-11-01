import DealEngine
import Foundation

/// Mirrors `packages/shared/multiplayer.ts`. The server is the authority in a room: it
/// runs the rules and sends each client its own view and legal actions.
public enum RoomPreset: String, Codable, CaseIterable, Hashable, Sendable {
    case standard, fast, teaching

    public var label: String {
        switch self {
        case .standard: "Standard"
        case .fast: "Fast"
        case .teaching: "Teaching"
        }
    }

    public var summary: String {
        switch self {
        case .standard: "Classic three-set race with the full normal room pace."
        case .fast: "Shorter live session with the same actions but only two complete sets needed."
        case .teaching: "Standard rules with clearer support copy for mixed-skill groups."
        }
    }
}

public enum RoomReaction: String, Codable, CaseIterable, Hashable, Sendable {
    case nice, wow, gg, oops

    public var label: String {
        switch self {
        case .nice: "Nice"
        case .wow: "Wow"
        case .gg: "GG"
        case .oops: "Oops"
        }
    }

    public var symbol: String {
        switch self {
        case .nice: "hand.thumbsup.fill"
        case .wow: "sparkles"
        case .gg: "flag.checkered"
        case .oops: "face.smiling.inverse"
        }
    }
}

public struct RoomPlayer: Codable, Hashable, Sendable, Identifiable {
    public var id: PlayerId
    public var name: String
    public var handCount: Int
    public var bankCount: Int
    public var completeSets: Int
    public var connected: Bool
    public var connectionState: String?
    public var disconnectedAt: Double?
    public var lastSeenAt: Double
    public var reconnectDeadlineMs: Double
    public var isHost: Bool
    public var ready: Bool
}

public struct RoomActivity: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var createdAt: Double
    public var kind: String
    public var message: String
    public var playerId: PlayerId?
    public var reaction: RoomReaction?
}

public struct RoomChatMessage: Codable, Hashable, Sendable, Identifiable {
    public var id: Int
    public var createdAt: Double
    public var playerId: PlayerId
    public var playerName: String
    public var text: String
}

public struct RoomCheckpoint: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var savedAt: Double
}

public struct RoomView: Codable, Hashable, Sendable {
    public var roomCode: String
    public var status: String
    public var started: Bool
    public var winnerId: PlayerId?
    public var presetId: RoomPreset
    public var variant: GameVariant?
    public var hostPlayerId: PlayerId
    public var yourPlayerId: PlayerId
    public var players: [RoomPlayer]
    public var promptPlayerId: PlayerId?
    public var legalActions: [LegalAction]
    public var gameState: GameState?
    public var paused: Bool
    public var pausedByPlayerId: PlayerId?
    public var roomRuntimeState: String?
    public var pausedReason: String?
    public var endedReason: String?
    public var revision: Int
    public var turnSnapshotCount: Int
    public var checkpointSlots: [RoomCheckpoint]
    public var canStart: Bool
    public var canRematch: Bool
    public var reconnectDeadlineMs: Double
    public var serverTime: Double
    public var activityFeed: [RoomActivity]
    public var chatMessages: [RoomChatMessage]
    public var typingPlayerIds: [PlayerId]
    public var lastEventId: Int

    public var isHost: Bool { hostPlayerId == yourPlayerId }
    public var isFinished: Bool { status == "finished" }
    public var hasEnded: Bool { roomRuntimeState == "ended_timeout" }
}

public struct RoomSession: Codable, Hashable, Sendable {
    public var version = 1
    public var roomCode: String
    public var seatId: String?
    public var resumeToken: String?
    public var playerId: String
    public var sessionToken: String
    public var playerName: String
    public var reconnectDeadlineMs: Double

    public init(roomCode: String, seatId: String?, resumeToken: String?, playerId: String, sessionToken: String, playerName: String, reconnectDeadlineMs: Double) {
        self.roomCode = roomCode
        self.seatId = seatId
        self.resumeToken = resumeToken
        self.playerId = playerId
        self.sessionToken = sessionToken
        self.playerName = playerName
        self.reconnectDeadlineMs = reconnectDeadlineMs
    }
}

public struct RoomSessionResponse: Codable, Sendable {
    public var roomCode: String
    public var seatId: String?
    public var resumeToken: String?
    public var playerId: String?
    public var sessionToken: String?
    public var reconnectDeadlineMs: Double?
    /// Only the resume form of the reconnect reply carries these.
    public var status: String?
    public var message: String?
}

public struct RoomEventEnvelope: Codable, Hashable, Sendable {
    public var roomCode: String
    public var revision: Int
    public var reason: String
    public var serverTime: Double
    public var eventId: Int
    public var seatId: String?
    public var displayName: String?
    public var graceExpiresAt: Double?
}

public enum OnlineError: Error, Equatable, LocalizedError {
    /// The app couldn't reach the server at all.
    case networkUnavailable
    /// The server refused. `code` is its error code, such as `room_full`.
    case server(code: String, message: String?)
    /// The reply didn't parse, which usually means the server is newer than the app.
    case updateRequired

    public var code: String? {
        if case .server(let code, _) = self { return code }
        return nil
    }

    public var isStale: Bool { ["revision_conflict", "stale_state", "action_rejected"].contains(code ?? "") }

    /// The seat is gone for good, so keeping the stored session has no use.
    public var endsSession: Bool {
        ["invalid_session", "invalid_token", "seat_not_found", "room_not_found", "room_closed", "seat_timed_out", "not_found"].contains(code ?? "")
    }

    public var errorDescription: String? {
        switch self {
        case .networkUnavailable:
            return "Can't reach the game server. Check your connection and try again."
        case .updateRequired:
            return "This room uses something this version of the app doesn't understand. Rebuild the app to update it."
        case .server(let code, let message):
            switch code {
            case "room_full": return "That room is full."
            case "room_not_found", "not_found": return "No room has that code. Check it and try again."
            case "room_started", "match_already_started": return "That match has already started."
            case "invalid_session", "invalid_token", "seat_not_found": return "Your seat in that room is no longer valid."
            case "seat_timed_out": return "Your seat timed out while you were away."
            case "rate_limited": return "Too many requests. Wait a moment and try again."
            default: return message ?? code.replacingOccurrences(of: "_", with: " ").capitalized + "."
            }
        }
    }
}
