import DealEngine
import XCTest
@testable import DealOnline

/// Invite links, the event stream, and a server newer than the app.
final class RoomInviteTests: XCTestCase {
    private func code(_ link: String) -> String? {
        RoomInvite.roomCode(from: URL(string: link)!)
    }

    func testAppAndWebLinksGiveTheRoomCode() {
        XCTAssertEqual(code("monopolydeal://join/ABCDE"), "ABCDE")
        XCTAssertEqual(code("https://monopoly-deal-smoky.vercel.app/join/ABCDE"), "ABCDE")
        XCTAssertEqual(code("https://example.com/some/path/join/ABCDE?x=1"), "ABCDE")
    }

    func testCodesAreNormalized() {
        XCTAssertEqual(code("monopolydeal://join/abcde"), "ABCDE")
        XCTAssertEqual(code("monopolydeal://JOIN/ab-cd"), "ABCD")
    }

    func testOtherLinksAreIgnored() {
        XCTAssertNil(code("monopolydeal://join"))
        XCTAssertNil(code("monopolydeal://settings/ABCDE"))
        XCTAssertNil(code("https://monopoly-deal-smoky.vercel.app/"))
        XCTAssertNil(code("monopolydeal://join/ABC"))
        XCTAssertNil(code("monopolydeal://join/ABCDEFGHI"))
    }

    func testAnInviteOffersBothWaysIn() throws {
        let text = RoomInvite.text(roomCode: "ABCDE")
        XCTAssertTrue(text.contains("https://monopoly-deal-smoky.vercel.app/join/ABCDE"), text)
        XCTAssertTrue(text.contains("monopolydeal://join/ABCDE"), text)
        for line in text.split(separator: "\n") {
            guard let link = line.split(separator: " ").last, link.contains("://") else { continue }
            XCTAssertEqual(code(String(link)), "ABCDE")
        }
    }
}

final class SSEParserTests: XCTestCase {
    func testDataLinesAreEmitted() {
        var parser = SSEParser()
        XCTAssertEqual(parser.feed("data: {\"a\":1}"), "{\"a\":1}")
        XCTAssertEqual(parser.feed("data:{\"a\":2}"), "{\"a\":2}")
    }

    func testEverythingElseIsIgnored() {
        var parser = SSEParser()
        for line in [": keep-alive", "event: room", "id: 12", "retry: 1000", ""] {
            XCTAssertNil(parser.feed(line), line)
        }
    }
}

final class NewerServerTests: XCTestCase {
    private func game(discard: [String] = []) -> GameState {
        var state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "Ann"), PlayerConfig(id: "b", name: "Bo")], seed: 2))
        state.discardPile = discard
        return state
    }

    func testKnownAndHiddenCardsAreFine() {
        XCTAssertTrue(game().usesOnlyKnownCards)
        var state = game()
        state.players[1].hand = [Catalog.hiddenCardId, Catalog.hiddenCardId]
        XCTAssertTrue(state.usesOnlyKnownCards)
    }

    func testAnUnknownCardAnywhereIsCaught() {
        XCTAssertFalse(game(discard: ["future_card#1"]).usesOnlyKnownCards)
        var state = game()
        state.players[0].bank = ["future_card#1"]
        XCTAssertFalse(state.usesOnlyKnownCards)
        state = game()
        state.players[1].properties[.red] = [PropertyCardPlacement(cardId: "future_card#1", assignedColor: .red)]
        XCTAssertFalse(state.usesOnlyKnownCards)
    }

    /// The whole path: the room holds a card this build doesn't know, so the player is
    /// told to update and the connection stops instead of drawing the table.
    @MainActor
    func testARoomWithAnUnknownCardAsksForAnUpdate() async throws {
        let state = try JSONSerialization.jsonObject(with: JSONEncoder().encode(game(discard: ["future_card#1"])))
        let view: [String: Any] = [
            "roomCode": "ABCDE", "status": "active", "started": true, "presetId": "standard",
            "hostPlayerId": "a", "yourPlayerId": "a", "players": [], "legalActions": [],
            "paused": false, "revision": 4, "turnSnapshotCount": 0, "checkpointSlots": [], "canStart": false,
            "canRematch": false, "reconnectDeadlineMs": 0, "serverTime": 1_000, "activityFeed": [],
            "chatMessages": [], "typingPlayerIds": [], "lastEventId": 2, "gameState": state,
        ]
        StubServer.reply = try JSONSerialization.data(withJSONObject: view)
        StubServer.reconnectReply = try JSONSerialization.data(withJSONObject: ["roomCode": "ABCDE", "seatId": "a"])
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubServer.self]
        let client = RoomClient(baseURL: URL(string: "https://rooms.test")!, configuration: configuration)
        let session = RoomSession(roomCode: "ABCDE", seatId: "a", resumeToken: "t", playerId: "a", sessionToken: "t", playerName: "Ann", reconnectDeadlineMs: 0)

        let connection = RoomConnection(client: client, session: session)
        await connection.connect()
        connection.stop()

        XCTAssertEqual(connection.lastError, .updateRequired)
        XCTAssertNil(connection.view)
    }
}

/// Answers every request with a canned reply.
private final class StubServer: URLProtocol {
    nonisolated(unsafe) static var reply = Data()
    nonisolated(unsafe) static var reconnectReply = Data()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let body = request.url?.lastPathComponent == "reconnect" ? Self.reconnectReply : Self.reply
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
}
