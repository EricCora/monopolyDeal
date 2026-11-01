import DealEngine
import XCTest
@testable import DealOnline

/// The words and rules behind the online pause and ended screens.
final class RoomStatusTests: XCTestCase {
    private func view(
        paused: Bool = false,
        pausedReason: String? = nil,
        runtime: String? = nil,
        endedReason: String? = nil,
        host: String = "a",
        you: String = "a",
        connected: [String: Bool] = ["a": true, "b": true],
        prompt: String? = nil,
        started: Bool = true
    ) throws -> RoomView {
        let players: [[String: Any]] = connected.keys.sorted().map { id in
            [
                "id": id, "name": id == "a" ? "Ann" : "Bo", "handCount": 5, "bankCount": 0, "completeSets": 0,
                "connected": connected[id]!, "lastSeenAt": 0, "reconnectDeadlineMs": connected[id]! ? 0 : 91_000,
                "isHost": id == host, "ready": true,
            ]
        }
        var body: [String: Any] = [
            "roomCode": "ABCDE", "status": "active", "started": started, "presetId": "standard",
            "hostPlayerId": host, "yourPlayerId": you, "players": players, "legalActions": [],
            "paused": paused, "revision": 4, "turnSnapshotCount": 0, "checkpointSlots": [], "canStart": false,
            "canRematch": false, "reconnectDeadlineMs": 0, "serverTime": 1_000, "activityFeed": [],
            "chatMessages": [], "typingPlayerIds": [], "lastEventId": 2,
        ]
        body["pausedReason"] = pausedReason
        body["roomRuntimeState"] = runtime
        body["endedReason"] = endedReason
        body["promptPlayerId"] = prompt
        return try JSONDecoder().decode(RoomView.self, from: JSONSerialization.data(withJSONObject: body))
    }

    func testADroppedPlayerIsNamedAndOnlyAManualPauseCanBeResumed() throws {
        let dropped = try view(paused: true, pausedReason: "player_disconnect", runtime: "paused_disconnect", connected: ["a": true, "b": false])
        XCTAssertEqual(dropped.pauseMessage, "Bo dropped out. The match continues when they return.")
        XCTAssertFalse(dropped.canHostTogglePause, "This pause lifts by itself when Bo returns")
        XCTAssertEqual(dropped.secondsUntilRejoinDeadline, 90)

        let manual = try view(paused: true, pausedReason: "manual")
        XCTAssertEqual(manual.pauseMessage, "The host paused this match.")
        XCTAssertTrue(manual.canHostTogglePause)
        XCTAssertNil(manual.secondsUntilRejoinDeadline)

        let guestView = try view(paused: true, pausedReason: "manual", you: "b")
        XCTAssertFalse(guestView.canHostTogglePause)
    }

    func testADroppedHostIsCalledOut() throws {
        let dropped = try view(paused: true, pausedReason: "host_disconnect", runtime: "paused_host_disconnect", you: "b", connected: ["a": false, "b": true])
        XCTAssertEqual(dropped.pauseMessage, "The host, Ann, dropped out. The match continues when they return.")
    }

    func testAnEndedRoomExplainsWhy() throws {
        XCTAssertTrue(try view(runtime: "ended_timeout", endedReason: "host_timeout").hasEnded)
        XCTAssertEqual(try view(runtime: "ended_timeout", endedReason: "host_timeout").endedMessage, "The host didn't return in time, so this match has ended.")
        XCTAssertEqual(try view(runtime: "ended_timeout", endedReason: "disconnect_timeout").endedMessage, "A player didn't return in time, so this match has ended.")
    }

    func testOnlyAPlayableSeatWithNoMovesLooksStale() throws {
        XCTAssertTrue(try view(prompt: "a").isAwaitingMissingMoves)
        XCTAssertFalse(try view(prompt: "b").isAwaitingMissingMoves, "It's someone else's turn")
        XCTAssertFalse(try view(paused: true, prompt: "a").isAwaitingMissingMoves, "A paused room lists no moves")
        XCTAssertFalse(try view(connected: ["a": false, "b": true], prompt: "a").isAwaitingMissingMoves, "Reclaiming the seat comes first")
        XCTAssertFalse(try view(prompt: "a", started: false).isAwaitingMissingMoves)
    }
}
