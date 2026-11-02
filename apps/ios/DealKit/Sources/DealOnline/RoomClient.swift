import DealEngine
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Talks to the room server over its HTTP routes and SSE stream. The web client's
/// Socket.IO transport is a faster path to the same routes, so neither is required.
public struct RoomClient: Sendable {
    public static let productionURL = URL(string: "https://monopolydeal-multiplayer.onrender.com")!
    /// Turn-by-turn rooms live on the website, because the free room server forgets everything when it sleeps.
    public static let productionTurnURL = URL(string: "https://monopoly-deal-smoky.vercel.app")!
    public static let turnRoomCodeLength = 6

    public let baseURL: URL
    public let turnBaseURL: URL
    private let session: URLSession

    public init(baseURL: URL = RoomClient.productionURL, turnBaseURL: URL = RoomClient.productionTurnURL) {
        self.baseURL = baseURL
        self.turnBaseURL = turnBaseURL
        let configuration = URLSessionConfiguration.default
        // The free hosting tier takes around 20 seconds to wake a sleeping server.
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 90
        configuration.waitsForConnectivity = false
        session = URLSession(configuration: configuration)
    }

    /// For tests that answer requests themselves.
    init(baseURL: URL, configuration: URLSessionConfiguration) {
        self.baseURL = baseURL
        turnBaseURL = baseURL
        session = URLSession(configuration: configuration)
    }

    public static func isTurnRoom(_ code: String) -> Bool { code.count == turnRoomCodeLength }

    private var turnRoomsURL: URL { turnBaseURL.appendingPathComponent("api/turn/api/multiplayer/rooms") }

    private func roomURL(_ code: String, _ operation: String) -> URL {
        let rooms = Self.isTurnRoom(code) ? turnRoomsURL : baseURL.appendingPathComponent("api/multiplayer/rooms")
        return rooms.appendingPathComponent(code).appendingPathComponent(operation)
    }

    private func send<T: Decodable>(_ type: T.Type, _ request: URLRequest) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            if (error as? URLError)?.code == .cancelled { throw CancellationError() }
            throw OnlineError.networkUnavailable
        }
        guard let http = response as? HTTPURLResponse else { throw OnlineError.networkUnavailable }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
            let code = body?["error"] as? String ?? "request_failed"
            throw OnlineError.server(code: code, message: body?["message"] as? String)
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw OnlineError.updateRequired
        }
    }

    private func post<T: Decodable>(_ type: T.Type, _ url: URL, _ body: [String: Any]) async throws -> T {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(type, request)
    }

    private struct OK: Decodable {}

    /// Puts the action's exact wire text into the body, because the server compares it as text.
    private func actionBody(_ body: [String: Any], action: Action) throws -> Data {
        let rest = try JSONSerialization.data(withJSONObject: body)
        var text = String(decoding: rest, as: UTF8.self)
        text.removeLast()
        return Data("\(text),\"action\":\(action.wireJSON)}".utf8)
    }

    private func identity(_ session: RoomSession, expectedRevision: Int? = nil) -> [String: Any] {
        var body: [String: Any] = ["playerId": session.playerId, "sessionToken": session.sessionToken]
        if let seatId = session.seatId, let resumeToken = session.resumeToken {
            body["seatId"] = seatId
            body["resumeToken"] = resumeToken
        }
        if let expectedRevision { body["expectedRevision"] = expectedRevision }
        return body
    }

    private func command(_ session: RoomSession, _ operation: String, expectedRevision: Int?, extra: [String: Any] = [:]) async throws {
        let body = identity(session, expectedRevision: expectedRevision).merging(extra) { $1 }
        _ = try await post(OK.self, roomURL(session.roomCode, operation), body)
    }

    // MARK: Rooms

    public func health() async -> Bool {
        var request = URLRequest(url: baseURL.appendingPathComponent("api/multiplayer/health"))
        request.timeoutInterval = 60
        struct Health: Decodable { var ok: Bool }
        return (try? await send(Health.self, request).ok) ?? false
    }

    private func makeSession(_ reply: RoomSessionResponse, name: String) throws -> RoomSession {
        guard let playerId = reply.playerId ?? reply.seatId, let token = reply.sessionToken ?? reply.resumeToken else {
            throw OnlineError.updateRequired
        }
        return RoomSession(roomCode: reply.roomCode, seatId: reply.seatId, resumeToken: reply.resumeToken, playerId: playerId, sessionToken: token, playerName: name, reconnectDeadlineMs: reply.reconnectDeadlineMs ?? 0)
    }

    public func createRoom(playerName: String) async throws -> RoomSession {
        let reply = try await post(RoomSessionResponse.self, baseURL.appendingPathComponent("api/multiplayer/rooms"), ["playerName": playerName])
        return try makeSession(reply, name: playerName)
    }

    /// A room that lasts for days, where players take their turns when they like.
    public func createTurnRoom(playerName: String) async throws -> RoomSession {
        let reply = try await post(RoomSessionResponse.self, turnRoomsURL, ["playerName": playerName])
        return try makeSession(reply, name: playerName)
    }

    /// Takes a place at the table with every hand hidden.
    public func watchRoom(code: String, playerName: String) async throws -> RoomSession {
        let reply = try await post(RoomSessionResponse.self, roomURL(code, "watch"), ["playerName": playerName])
        return try makeSession(reply, name: playerName)
    }

    public func joinRoom(code: String, playerName: String) async throws -> RoomSession {
        let reply = try await post(RoomSessionResponse.self, roomURL(code, "join"), ["playerName": playerName])
        return try makeSession(reply, name: playerName)
    }

    /// Reclaims a seat. Returns the session to use, which may have fresh tokens.
    public func reconnect(_ session: RoomSession, expectedRevision: Int? = nil) async throws -> RoomSession {
        let reply = try await post(RoomSessionResponse.self, roomURL(session.roomCode, "reconnect"), identity(session, expectedRevision: expectedRevision))
        if let status = reply.status, status != "ok" {
            throw OnlineError.server(code: status, message: reply.message)
        }
        var next = session
        next.seatId = reply.seatId ?? session.seatId
        next.resumeToken = reply.resumeToken ?? session.resumeToken
        next.playerId = reply.playerId ?? reply.seatId ?? session.playerId
        next.sessionToken = reply.sessionToken ?? reply.resumeToken ?? session.sessionToken
        next.reconnectDeadlineMs = reply.reconnectDeadlineMs ?? session.reconnectDeadlineMs
        return next
    }

    /// `fresh` reads past a turn room's storage cache, which can otherwise be a minute old.
    public func state(_ session: RoomSession, fresh: Bool = false) async throws -> RoomView {
        var components = URLComponents(url: roomURL(session.roomCode, "state"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "playerId", value: session.playerId),
            URLQueryItem(name: "sessionToken", value: session.sessionToken),
        ]
        if fresh { components.queryItems?.append(URLQueryItem(name: "fresh", value: "1")) }
        return try await send(RoomView.self, URLRequest(url: components.url!))
    }

    /// A finished game's opening state and moves.
    public func replay(_ session: RoomSession) async throws -> RoomReplayLog {
        var components = URLComponents(url: roomURL(session.roomCode, "replay"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "playerId", value: session.playerId),
            URLQueryItem(name: "sessionToken", value: session.sessionToken),
        ]
        return try await send(RoomReplayLog.self, URLRequest(url: components.url!))
    }

    // MARK: Commands

    public func start(_ session: RoomSession, checkpointId: String? = nil, expectedRevision: Int?) async throws {
        try await command(session, "start", expectedRevision: expectedRevision, extra: checkpointId.map { ["checkpointId": $0] } ?? [:])
    }

    public func apply(_ session: RoomSession, action: Action, expectedRevision: Int?, actionId: String = UUID().uuidString) async throws {
        var body = identity(session, expectedRevision: expectedRevision)
        body["actionId"] = actionId
        if let expectedRevision { body["clientStateVersion"] = expectedRevision }
        var request = URLRequest(url: roomURL(session.roomCode, "action"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try actionBody(body, action: action)
        _ = try await send(OK.self, request)
    }

    public func setPreset(_ session: RoomSession, _ preset: RoomPreset, expectedRevision: Int?) async throws {
        try await command(session, "preset", expectedRevision: expectedRevision, extra: ["presetId": preset.rawValue])
    }

    public func setVariant(_ session: RoomSession, _ variant: GameVariant, expectedRevision: Int?) async throws {
        try await command(session, "variant", expectedRevision: expectedRevision, extra: ["variant": variant.rawValue])
    }

    /// Only the options passed change. `turnTimerSeconds` of nil leaves the timer alone; use `clearTurnTimer` to remove it.
    public func setOptions(_ session: RoomSession, botFill: Bool? = nil, turnTimerSeconds: Int? = nil, clearTurnTimer: Bool = false, bestOf: Int? = nil, expectedRevision: Int?) async throws {
        var extra: [String: Any] = [:]
        if let botFill { extra["botFill"] = botFill }
        if let turnTimerSeconds { extra["turnTimerSeconds"] = turnTimerSeconds }
        if clearTurnTimer { extra["turnTimerSeconds"] = NSNull() }
        if let bestOf { extra["bestOf"] = bestOf }
        try await command(session, "options", expectedRevision: expectedRevision, extra: extra)
    }

    public func setReady(_ session: RoomSession, ready: Bool, expectedRevision: Int?) async throws {
        try await command(session, "ready", expectedRevision: expectedRevision, extra: ["ready": ready])
    }

    public func rematch(_ session: RoomSession, expectedRevision: Int?) async throws {
        try await command(session, "rematch", expectedRevision: expectedRevision)
    }

    public func pause(_ session: RoomSession, expectedRevision: Int?) async throws {
        try await command(session, "pause", expectedRevision: expectedRevision)
    }

    public func resume(_ session: RoomSession, expectedRevision: Int?) async throws {
        try await command(session, "resume", expectedRevision: expectedRevision)
    }

    public func undo(_ session: RoomSession, expectedRevision: Int?) async throws {
        try await command(session, "undo", expectedRevision: expectedRevision)
    }

    public func resetTurn(_ session: RoomSession, expectedRevision: Int?) async throws {
        try await command(session, "reset-turn", expectedRevision: expectedRevision)
    }

    public func sendReaction(_ session: RoomSession, _ reaction: RoomReaction, expectedRevision: Int?) async throws {
        try await command(session, "reaction", expectedRevision: expectedRevision, extra: ["reaction": reaction.rawValue])
    }

    public func sendChat(_ session: RoomSession, text: String) async throws {
        try await command(session, "chat", expectedRevision: nil, extra: ["text": text])
    }

    public func setTyping(_ session: RoomSession, typing: Bool) async throws {
        try await command(session, "typing", expectedRevision: nil, extra: ["typing": typing])
    }

    public func saveCheckpoint(_ session: RoomSession, name: String, expectedRevision: Int?) async throws {
        try await command(session, "checkpoints/save", expectedRevision: expectedRevision, extra: ["name": name])
    }

    public func loadCheckpoint(_ session: RoomSession, id: String, expectedRevision: Int?) async throws {
        try await command(session, "checkpoints/load", expectedRevision: expectedRevision, extra: ["checkpointId": id])
    }

    public func deleteCheckpoint(_ session: RoomSession, id: String, expectedRevision: Int?) async throws {
        try await command(session, "checkpoints/delete", expectedRevision: expectedRevision, extra: ["checkpointId": id])
    }

    /// `abandon` retires the seat at once (Forget Room). Without it the seat keeps its grace period.
    public func leave(_ session: RoomSession, abandon: Bool, expectedRevision: Int?) async throws {
        try await command(session, "leave", expectedRevision: expectedRevision, extra: ["abandon": abandon])
    }

    // MARK: Live updates

    /// Yields each room update until the stream ends or the task is cancelled.
    public func events(_ session: RoomSession, lastEventId: Int? = nil) -> AsyncThrowingStream<RoomEventEnvelope, Error> {
        var components = URLComponents(url: roomURL(session.roomCode, "events"), resolvingAgainstBaseURL: false)!
        var items = [
            URLQueryItem(name: "playerId", value: session.playerId),
            URLQueryItem(name: "sessionToken", value: session.sessionToken),
        ]
        if let lastEventId, lastEventId > 0 { items.append(URLQueryItem(name: "lastEventId", value: String(lastEventId))) }
        components.queryItems = items
        var streamRequest = URLRequest(url: components.url!)
        streamRequest.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        streamRequest.timeoutInterval = 3600
        let request = streamRequest
        let urlSession = self.session

        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await urlSession.bytes(for: request)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                        continuation.finish(throwing: OnlineError.networkUnavailable)
                        return
                    }
                    var parser = SSEParser()
                    for try await line in bytes.lines {
                        if let data = parser.feed(line), let event = try? JSONDecoder().decode(RoomEventEnvelope.self, from: Data(data.utf8)) {
                            continuation.yield(event)
                        }
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// Reads Server-Sent Events. `URLSession.AsyncBytes.lines` drops blank lines, so an
/// event is emitted as soon as its `data:` line arrives; the server sends one per event.
struct SSEParser {
    mutating func feed(_ line: String) -> String? {
        if line.hasPrefix(":") { return nil }
        guard line.hasPrefix("data:") else { return nil }
        return line.dropFirst(5).trimmingCharacters(in: .whitespaces)
    }
}
