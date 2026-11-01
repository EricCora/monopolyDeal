import DealAI
import DealEngine
import XCTest
@testable import DealOnline

/// Plays full matches on a real room server. `npm run ios:verify` starts one and sets
/// DEAL_TEST_SERVER_URL; without it these tests are skipped.
@MainActor
final class OnlineIntegrationTests: XCTestCase {
    private var client: RoomClient!

    override func setUp() async throws {
        guard let url = ProcessInfo.processInfo.environment["DEAL_TEST_SERVER_URL"].flatMap(URL.init(string:)) else {
            throw XCTSkip("Set DEAL_TEST_SERVER_URL to run against a server.")
        }
        client = RoomClient(baseURL: url)
    }

    private func waitFor(_ what: String, timeout: Duration = .seconds(30), _ condition: () -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now + timeout
        while !condition() {
            if clock.now > deadline {
                XCTFail("Timed out waiting for \(what)")
                throw CancellationError()
            }
            try await Task.sleep(for: .milliseconds(50))
        }
    }

    private func readyUp(_ connection: RoomConnection) async {
        await connection.run { client, session, revision in try await client.setReady(session, ready: true, expectedRevision: revision) }
    }

    /// Plays this seat's next move, if it has one. The bot logic picks from the server's legal list.
    private func playOneMove(_ connection: RoomConnection) async -> Bool {
        await connection.refresh()
        guard let view = connection.view, let game = view.gameState, !view.legalActions.isEmpty else { return false }
        let choice = Heuristic.choose(game, actorId: view.yourPlayerId, legalActions: view.legalActions)?.action ?? view.legalActions[0].action
        return await connection.perform(choice)
    }

    private func start(_ host: RoomConnection) async throws {
        try await waitFor("the host to be able to start") {
            host.view?.canStart == true
        }
        await host.run { client, session, revision in try await client.start(session, expectedRevision: revision) }
        try await waitFor("the match to start") { host.view?.started == true }
    }

    private func playToFinish(_ seats: [RoomConnection]) async throws {
        var idle = 0
        for _ in 0..<20000 {
            var moved = false
            for seat in seats where await playOneMove(seat) { moved = true }
            if seats[0].view?.isFinished == true { return }
            idle = moved ? 0 : idle + 1
            XCTAssertLessThan(idle, 400, "Nobody could move: \(seats[0].view?.gameState?.turn as Any)")
            if idle >= 400 { return }
        }
        XCTFail("The match never finished")
    }

    private func appVsApp(_ variant: GameVariant) async throws {
        let hostSession = try await client.createRoom(playerName: "Host")
        let guestSession = try await client.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let host = RoomConnection(client: client, session: hostSession)
        let guest = RoomConnection(client: client, session: guestSession)
        await host.connect()
        await guest.connect()
        defer {
            host.stop()
            guest.stop()
        }
        // Changing the game clears everyone's ready state, so the host sets it first.
        await host.run { client, session, revision in try await client.setVariant(session, variant, expectedRevision: revision) }
        await guest.refresh()
        await readyUp(guest)
        await readyUp(host)
        try await start(host)
        await guest.refresh()
        XCTAssertEqual(guest.view?.variant, variant)
        // Opponents' hands and the deck must stay hidden.
        let masked = try XCTUnwrap(guest.view?.gameState)
        XCTAssertTrue(masked.drawPile.allSatisfy { $0 == Catalog.hiddenCardId })
        XCTAssertTrue(masked.players.first { $0.id == hostSession.playerId }!.hand.allSatisfy { $0 == Catalog.hiddenCardId })
        XCTAssertFalse(masked.players.first { $0.id == guestSession.playerId }!.hand.contains(Catalog.hiddenCardId))

        try await playToFinish([host, guest])
        await guest.refresh()
        XCTAssertEqual(host.view?.isFinished, true)
        XCTAssertNotNil(guest.view?.winnerId)
    }

    func testAppVersusAppClassicFinishes() async throws { try await appVsApp(.classic) }
    func testAppVersusAppNoMercyFinishes() async throws { try await appVsApp(.no_mercy) }

    /// iOS over HTTP and SSE, against a browser-style client over Socket.IO.
    func testAppVersusBrowserFinishes() async throws {
        let hostSession = try await client.createRoom(playerName: "iPhone")
        let host = RoomConnection(client: client, session: hostSession)
        await host.connect()
        defer { host.stop() }

        let repoRoot = try XCTUnwrap(ProcessInfo.processInfo.environment["DEAL_REPO_ROOT"], "ios:verify sets DEAL_REPO_ROOT")
        let peer = Process()
        peer.currentDirectoryURL = URL(fileURLWithPath: repoRoot)
        peer.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        peer.arguments = ["node", "--import", "tsx/esm", "scripts/online_peer.ts", client.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")), hostSession.roomCode]
        let output = Pipe()
        peer.standardOutput = output
        peer.standardError = output
        try peer.run()
        defer { if peer.isRunning { peer.terminate() } }

        try await waitFor("the browser player to join and ready up", timeout: .seconds(45)) {
            host.view?.players.count == 2 && host.view?.players.contains { $0.name == "Browser Peer" && $0.ready } == true
        }
        await readyUp(host)
        try await start(host)
        XCTAssertEqual(host.status == .live || host.status == .polling, true)

        var idle = 0
        while host.view?.isFinished != true {
            let moved = await playOneMove(host)
            idle = moved ? 0 : idle + 1
            if idle > 2400 {
                XCTFail("The match stalled at \(host.view?.gameState?.turn as Any)")
                return
            }
            try await Task.sleep(for: .milliseconds(moved ? 5 : 50))
        }
        XCTAssertNotNil(host.view?.winnerId)
        peer.waitUntilExit()
        let log = String(data: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        XCTAssertTrue(log.contains("finished winner="), "Browser player output: \(log)")
    }

    func testDroppedConnectionRejoinsTheSameSeat() async throws {
        let hostSession = try await client.createRoom(playerName: "Host")
        let guestSession = try await client.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let host = RoomConnection(client: client, session: hostSession)
        var guest = RoomConnection(client: client, session: guestSession)
        await host.connect()
        await guest.connect()
        defer { host.stop() }
        await readyUp(guest)
        await readyUp(host)
        try await start(host)
        await guest.refresh()
        let hand = try XCTUnwrap(guest.view?.gameState?.players.first { $0.id == guestSession.playerId }?.hand)

        // The app is killed: its connection goes away and a new one starts from the stored session.
        guest.stop()
        guest = RoomConnection(client: client, session: guestSession)
        await guest.connect()
        defer { guest.stop() }
        XCTAssertEqual(guest.view?.yourPlayerId, guestSession.playerId)
        XCTAssertEqual(guest.view?.gameState?.players.first { $0.id == guestSession.playerId }?.hand, hand)
        XCTAssertNil(guest.endedReason)
        XCTAssertEqual(guest.view?.players.first { $0.id == guestSession.playerId }?.connected, true)
    }

    func testStaleRevisionRefreshesInsteadOfFailing() async throws {
        let hostSession = try await client.createRoom(playerName: "Host")
        let guestSession = try await client.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let host = RoomConnection(client: client, session: hostSession)
        await host.connect()
        defer { host.stop() }
        let client = self.client!
        try await client.setReady(guestSession, ready: true, expectedRevision: nil)
        // The host's view is now behind by the guest's change.
        await host.run { client, session, _ in try await client.setPreset(session, .fast, expectedRevision: 0) }
        XCTAssertNil(host.lastError)
        XCTAssertGreaterThan(host.view?.revision ?? 0, 0)
    }

    func testForgetRoomRetiresTheSeat() async throws {
        let hostSession = try await client.createRoom(playerName: "Host")
        let guestSession = try await client.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let guest = RoomConnection(client: client, session: guestSession)
        await guest.connect()
        await guest.leave(abandon: true)
        let view = try await client.state(hostSession)
        XCTAssertEqual(view.players.map(\.name), ["Host"])
    }

    func testJoiningAMissingRoomExplainsItself() async {
        do {
            _ = try await client.joinRoom(code: "ZZZZ", playerName: "Nobody")
            XCTFail("Expected a refusal")
        } catch let error as OnlineError {
            XCTAssertNotNil(error.code)
            XCTAssertEqual(error.errorDescription, "No room has that code. Check it and try again.")
        } catch {
            XCTFail("Unexpected error \(error)")
        }
    }
}
