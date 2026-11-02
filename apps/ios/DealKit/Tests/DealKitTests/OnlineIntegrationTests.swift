import DealAI
import DealEngine
import DealStats
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
        client = RoomClient(baseURL: url, turnBaseURL: url)
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
            // Yield while waiting, so a refresh already in flight can finish. Ten seconds
            // with no move from anyone is a real stall.
            idle = moved ? 0 : idle + 1
            if !moved { try await Task.sleep(for: .milliseconds(10)) }
            if idle >= 1000 {
                let detail = seats.map { seat in
                    let view = seat.view
                    return "\(view?.yourPlayerId ?? "?") legal=\(view?.legalActions.map(\.label).prefix(3) ?? []) prompt=\(view?.promptPlayerId ?? "?") pending=\(String(describing: view?.gameState?.pending).prefix(120)) paused=\(view?.paused ?? false) rev=\(view?.revision ?? -1) err=\(String(describing: seat.lastError)) connected=\(view?.yourSeat?.connected as Any)"
                }.joined(separator: " | ")
                XCTFail("Nobody could move: \(detail)")
                return
            }
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

        // Each seat builds its results screen from a state with the other hands hidden.
        for seat in [host, guest] {
            let finished = try XCTUnwrap(seat.view?.gameState)
            let summary = PostGame.summary(finished, lifetime: LifetimeStats())
            XCTAssertEqual(summary.winnerId, seat.view?.winnerId)
            XCTAssertEqual(summary.players.count, 2)
            XCTAssertEqual(StatsBuilder.matchRecord(finished, mode: .live_online, surface: .multiplayer).winnerId, seat.view?.winnerId)
        }
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

    /// Starts a match, then lets the guest go quiet until the server marks the seat disconnected.
    private func matchWithSilentGuest() async throws -> (host: RoomConnection, guest: RoomConnection) {
        let hostSession = try await client.createRoom(playerName: "Host")
        let guestSession = try await client.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let host = RoomConnection(client: client, session: hostSession)
        let guest = RoomConnection(client: client, session: guestSession)
        await host.connect()
        await guest.connect()
        await readyUp(guest)
        await readyUp(host)
        try await start(host)
        // Hand the turn to the guest, so the guest has a move to try when the network returns.
        await host.refresh()
        let hostId = hostSession.playerId
        _ = await host.perform(Action(.draw_cards, playerId: hostId))
        _ = await host.perform(Action(.pass_turn, playerId: hostId))
        await guest.refresh()
        XCTAssertEqual(guest.view?.promptPlayerId, guestSession.playerId)
        guest.stop()
        try await waitFor("the server to mark the quiet seat disconnected", timeout: .seconds(70)) {
            host.view?.players.first { $0.id == guestSession.playerId }?.connected == false
        }
        return (host, guest)
    }

    /// A network blip outlasts the server's 20-second limit, then the network returns.
    func testASeatMarkedDisconnectedRecoversByItself() async throws {
        let (host, guest) = try await matchWithSilentGuest()
        defer {
            host.stop()
            guest.stop()
        }
        await guest.refresh()
        try await waitFor("the seat to recover", timeout: .seconds(10)) {
            guest.view?.players.first { $0.id == guest.view?.yourPlayerId }?.connected == true
        }
        XCTAssertNil(guest.endedReason)
        await host.refresh()
        XCTAssertEqual(host.view?.paused, false, "The match should resume once the seat is back")
    }

    /// The first thing the app does after the blip is try to act, which the server refuses.
    /// That refusal must not be mistaken for the seat being gone for good.
    func testActingWhileMarkedDisconnectedDoesNotLoseTheSeat() async throws {
        let (host, guest) = try await matchWithSilentGuest()
        defer {
            host.stop()
            guest.stop()
        }
        let guestId = try XCTUnwrap(guest.view?.yourPlayerId)
        _ = await guest.perform(Action(.draw_cards, playerId: guestId))
        XCTAssertNil(guest.endedReason, "A reconnectable seat was treated as lost")
        try await waitFor("the seat to recover", timeout: .seconds(10)) {
            guest.view?.players.first { $0.id == guestId }?.connected == true
        }
        // With the seat back, the move goes through.
        await guest.refresh()
        let draw = guest.view?.legalActions.first { $0.action.type == .draw_cards }
        XCTAssertNotNil(draw, "The seat came back without its legal actions")
        if let draw {
            let drew = await guest.perform(draw.action)
            XCTAssertTrue(drew)
        }
    }

    /// The hosted server restarts on every deploy, and on its free tier after sleeping.
    func testMatchSurvivesAServerRestart() async throws {
        let repoRoot = try XCTUnwrap(ProcessInfo.processInfo.environment["DEAL_REPO_ROOT"], "ios:verify sets DEAL_REPO_ROOT")
        let snapshots = FileManager.default.temporaryDirectory.appendingPathComponent("deal-restart-\(UUID().uuidString).json")
        let port = 8807
        func launchServer() throws -> Process {
            let server = Process()
            server.currentDirectoryURL = URL(fileURLWithPath: repoRoot)
            server.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            server.arguments = ["node", "--import", "tsx/esm", "apps/server/src/index.ts"]
            server.environment = ProcessInfo.processInfo.environment.merging(["PORT": "\(port)", "MONOPOLY_DEAL_SNAPSHOT_PATH": snapshots.path]) { $1 }
            server.standardOutput = FileHandle.nullDevice
            server.standardError = FileHandle.nullDevice
            try server.run()
            return server
        }
        let local = RoomClient(baseURL: URL(string: "http://localhost:\(port)")!)
        func waitForHealth() async throws {
            let clock = ContinuousClock()
            let deadline = clock.now + .seconds(60)
            while await !local.health() {
                if clock.now > deadline {
                    XCTFail("The server didn't start")
                    throw CancellationError()
                }
                try await Task.sleep(for: .milliseconds(200))
            }
        }

        var server = try launchServer()
        defer {
            server.terminate()
            try? FileManager.default.removeItem(at: snapshots)
        }
        try await waitForHealth()
        let hostSession = try await local.createRoom(playerName: "Host")
        let guestSession = try await local.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let host = RoomConnection(client: local, session: hostSession)
        let guest = RoomConnection(client: local, session: guestSession)
        await host.connect()
        await guest.connect()
        defer {
            host.stop()
            guest.stop()
        }
        await readyUp(guest)
        await readyUp(host)
        try await start(host)
        await guest.refresh()
        let hand = try XCTUnwrap(guest.view?.gameState?.players.first { $0.id == guestSession.playerId }?.hand)
        XCTAssertFalse(hand.isEmpty)

        server.terminate()
        server.waitUntilExit()
        await guest.refresh()
        XCTAssertEqual(guest.status, .reconnecting, "An unreachable server should show as reconnecting")
        XCTAssertNil(guest.endedReason, "An outage must not end the seat")

        server = try launchServer()
        try await waitForHealth()
        try await waitFor("both seats to recover", timeout: .seconds(45)) {
            host.status != .reconnecting && guest.status != .reconnecting
                && host.view?.players.allSatisfy(\.connected) == true
        }
        XCTAssertEqual(guest.view?.gameState?.players.first { $0.id == guestSession.playerId }?.hand, hand)
        XCTAssertNil(guest.endedReason)
        XCTAssertNil(host.endedReason)

        // The match is still playable.
        var moved = false
        for _ in 0..<40 where !moved {
            if await playOneMove(host) { moved = true } else if await playOneMove(guest) { moved = true }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertTrue(moved, "Nobody could move after the restart")
    }

    /// A caller of `refresh` relies on seeing the room as it is now, even if another
    /// refresh is already running. The retry of a stale command depends on this.
    func testRefreshWaitsForFreshStateWhenOneIsAlreadyRunning() async throws {
        let hostSession = try await client.createRoom(playerName: "Host")
        let guestSession = try await client.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let host = RoomConnection(client: client, session: hostSession)
        await host.refresh()
        let client = self.client!
        for round in 0..<20 {
            try await client.setReady(guestSession, ready: round % 2 == 0, expectedRevision: nil)
            let latest = try await client.state(guestSession).revision
            async let first: Void = host.refresh()
            await Task.yield()
            await host.refresh()
            XCTAssertEqual(host.view?.revision, latest, "Round \(round) returned before the room was fetched")
            await first
        }
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

    private func playToTheEnd(_ seats: [RoomConnection]) async throws {
        for _ in 0..<4000 {
            if seats[0].view?.isFinished == true { return }
            var moved = false
            for seat in seats where await playOneMove(seat) { moved = true }
            if !moved { try await Task.sleep(for: .milliseconds(30)) }
        }
        XCTFail("The match never finished")
    }

    func testRoomOptionsSpectatorClockSeriesAndReplay() async throws {
        let hostSession = try await client.createRoom(playerName: "Host")
        let host = RoomConnection(client: client, session: hostSession)
        await host.connect()
        defer { host.stop() }
        await host.run { client, session, revision in
            try await client.setOptions(session, botFill: true, turnTimerSeconds: 45, bestOf: 3, expectedRevision: revision)
        }
        XCTAssertEqual(host.view?.options?.botFill, true)
        XCTAssertEqual(host.view?.options?.turnTimerSeconds, 45)
        XCTAssertEqual(host.view?.options?.bestOf, 3)

        let guestSession = try await client.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let guest = RoomConnection(client: client, session: guestSession)
        await guest.connect()
        defer { guest.stop() }
        await readyUp(guest)
        await host.refresh()
        await readyUp(host)
        try await start(host)

        XCTAssertNotNil(host.view?.turnClock?.deadlineMs)
        XCTAssertEqual(host.view?.series?.gameNumber, 1)

        let watcherSession = try await client.watchRoom(code: hostSession.roomCode, playerName: "Sam")
        let watcher = RoomConnection(client: client, session: watcherSession)
        await watcher.connect()
        defer { watcher.stop() }
        let seen = try XCTUnwrap(watcher.view)
        XCTAssertTrue(seen.isSpectator)
        XCTAssertTrue(seen.legalActions.isEmpty)
        let hands = seen.gameState?.players.flatMap(\.hand) ?? []
        XCTAssertFalse(hands.isEmpty)
        XCTAssertTrue(hands.allSatisfy { $0 == Catalog.hiddenCardId })
        await host.refresh()
        XCTAssertEqual(host.view?.spectatorCount, 1)

        try await playToTheEnd([host, guest])
        await host.refresh()
        let finished = try XCTUnwrap(host.view)
        XCTAssertEqual(finished.series?.wins.values.reduce(0, +), 1)
        XCTAssertEqual(finished.replayAvailable, true)
        let log = try await client.replay(host.session)
        let rebuilt = GameLog(initial: log.initial, actions: log.actions).positions()
        XCTAssertEqual(rebuilt.count, log.actions.count + 1)
        XCTAssertTrue(Engine.isGameOver(try XCTUnwrap(rebuilt.last)).done)
    }

    func testTheHostCanChangeAndRemoveABotWithoutLosingTheirSeat() async throws {
        let session = try await client.createRoom(playerName: "Host")
        let host = RoomConnection(client: client, session: session)
        await host.connect()
        defer { host.stop() }
        let added = await host.run { client, session, _ in try await client.addBot(session, difficulty: .easy) }
        XCTAssertTrue(added)
        let bot = try XCTUnwrap(host.view?.players.first { $0.isBot == true })
        XCTAssertEqual(bot.botDifficulty, .easy)
        let botId = bot.id
        let changed = await host.run { client, session, _ in try await client.setBotDifficulty(session, seatId: botId, difficulty: .hard) }
        XCTAssertTrue(changed)
        XCTAssertNil(host.endedReason)
        XCTAssertEqual(host.view?.players.first { $0.id == botId }?.botDifficulty, .hard)
        let removed = await host.run { client, session, _ in try await client.removeBot(session, seatId: botId) }
        XCTAssertTrue(removed)
        XCTAssertEqual(host.view?.players.count, 1)
    }

    func testABotPlaysADroppedSeatWhenTheRoomAsks() async throws {
        let hostSession = try await client.createRoom(playerName: "Host")
        let host = RoomConnection(client: client, session: hostSession)
        await host.connect()
        defer { host.stop() }
        await host.run { client, session, revision in try await client.setOptions(session, botFill: true, expectedRevision: revision) }
        let guestSession = try await client.joinRoom(code: hostSession.roomCode, playerName: "Guest")
        let guest = RoomConnection(client: client, session: guestSession)
        await guest.connect()
        await readyUp(guest)
        await host.refresh()
        await readyUp(host)
        try await start(host)
        await guest.leave(abandon: false)
        try await waitFor("a bot to take the seat", timeout: .seconds(45)) {
            host.view?.botSeatIds?.contains(guestSession.playerId) == true
        }
        XCTAssertEqual(host.view?.paused, false)
    }

    func testATurnRoomPlaysThroughRequestsAlone() async throws {
        let aSession = try await client.createTurnRoom(playerName: "Ann")
        XCTAssertEqual(aSession.roomCode.count, RoomClient.turnRoomCodeLength)
        let a = RoomConnection(client: client, session: aSession)
        await a.connect()
        defer { a.stop() }
        XCTAssertEqual(a.view?.turnBased, true)
        let bSession = try await client.joinRoom(code: aSession.roomCode, playerName: "Bo")
        let b = RoomConnection(client: client, session: bSession)
        await b.connect()
        defer { b.stop() }
        await readyUp(b)
        await a.refresh()
        await readyUp(a)
        try await start(a)
        await b.refresh()
        XCTAssertEqual(b.view?.started, true)
        // A few turns are enough to show moves pass between the two.
        for _ in 0..<30 {
            _ = await playOneMove(a)
            _ = await playOneMove(b)
        }
        // Bo may have moved last, so catch Ann up before comparing.
        await a.refresh()
        let turn = try XCTUnwrap(a.view?.gameState?.turnCount)
        XCTAssertGreaterThan(turn, 1)
        // The seat comes back on a fresh connection.
        a.stop()
        let again = RoomConnection(client: client, session: a.session)
        await again.connect()
        defer { again.stop() }
        XCTAssertEqual(again.view?.gameState?.turnCount, turn)
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
