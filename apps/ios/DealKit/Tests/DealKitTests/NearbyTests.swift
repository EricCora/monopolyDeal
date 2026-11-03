import DealAI
@testable import DealEngine
import XCTest
@testable import DealNearby

/// Stands in for Multipeer: one host and any number of phones, with messages delivered in
/// order on the main actor, as Multipeer's reliable mode delivers them.
@MainActor
private final class LoopbackHub {
    final class Host: NearbyHostTransport {
        var onConnect: ((NearbyPeer) -> Void)?
        var onDisconnect: ((NearbyPeer) -> Void)?
        var onReceive: ((NearbyPeer, Data) -> Void)?
        unowned let hub: LoopbackHub
        var ad: NearbyTableAd?
        init(hub: LoopbackHub) { self.hub = hub }

        func start(tableId: String, hostName: String) {
            ad = NearbyTableAd(tableId: tableId, hostName: hostName, peer: NearbyPeer(id: UUID().uuidString))
            hub.advertise()
        }

        func stop() {
            ad = nil
            hub.hostStopped()
        }

        func send(_ data: Data, to peer: NearbyPeer) {
            guard let guest = hub.guests.first(where: { $0.peer == peer }) else { return }
            hub.deliver { guest.onReceive?(data) }
        }

        func disconnect(_ peer: NearbyPeer) {}
    }

    final class Guest: NearbyGuestTransport {
        var onTablesChange: (([NearbyTableAd]) -> Void)?
        var onLinkChange: ((NearbyLinkState) -> Void)?
        var onReceive: ((Data) -> Void)?
        unowned let hub: LoopbackHub
        var browsing = false
        var peer: NearbyPeer?
        /// Messages sent to the host, for checking what a phone asked for.
        var sent: [NearbyGuestMessage] = []
        init(hub: LoopbackHub) { self.hub = hub }

        func startBrowsing() {
            browsing = true
            let tables = hub.host.ad.map { [$0] } ?? []
            hub.deliver { self.onTablesChange?(tables) }
        }

        func stop() {
            browsing = false
            drop()
        }

        func connect(to table: NearbyTableAd) {
            guard hub.host.ad?.peer == table.peer else {
                hub.deliver { self.onLinkChange?(.disconnected) }
                return
            }
            let peer = NearbyPeer(id: UUID().uuidString)
            self.peer = peer
            hub.deliver {
                self.hub.host.onConnect?(peer)
                self.onLinkChange?(.connected)
            }
        }

        func send(_ data: Data) {
            guard let peer else { return }
            if let message = try? JSONDecoder().decode(NearbyGuestMessage.self, from: data) { sent.append(message) }
            hub.deliver { self.hub.host.onReceive?(peer, data) }
        }

        /// The link drops, as when a phone locks or walks out of range.
        func drop() {
            guard let peer else { return }
            self.peer = nil
            hub.deliver {
                self.hub.host.onDisconnect?(peer)
                self.onLinkChange?(.disconnected)
            }
        }
    }

    private(set) var host: Host!
    private(set) var guests: [Guest] = []
    private var queue: [() -> Void] = []
    private var draining = false

    init() { host = Host(hub: self) }

    func makeGuest() -> Guest {
        let guest = Guest(hub: self)
        guests.append(guest)
        return guest
    }

    func deliver(_ work: @escaping () -> Void) {
        queue.append(work)
        guard !draining else { return }
        draining = true
        while !queue.isEmpty { queue.removeFirst()() }
        draining = false
    }

    fileprivate func advertise() {
        let tables = host.ad.map { [$0] } ?? []
        for guest in guests where guest.browsing { deliver { guest.onTablesChange?(tables) } }
    }

    fileprivate func hostStopped() {
        for guest in guests where guest.peer != nil {
            guest.peer = nil
            deliver { guest.onLinkChange?(.disconnected) }
        }
        for guest in guests where guest.browsing { deliver { guest.onTablesChange?([]) } }
    }
}

private let heuristicBot: NearbyBotChooser = { game, seatId, legal, _ in
    Heuristic.choose(game, actorId: seatId, legalActions: legal)?.action ?? legal[0].action
}

@MainActor
final class NearbyTableTests: XCTestCase {
    private func join(_ table: inout NearbyTable, _ name: String, token: String = UUID().uuidString) -> PlayerId? {
        try? table.join(NearbyJoinRequest(name: name, seatToken: token), now: 0).get()
    }

    func testSeatsFillUpToFiveAndRefuseLateStrangers() {
        var table = NearbyTable(hostName: "Eric")
        for index in 2...5 { XCTAssertEqual(join(&table, "Guest \(index)"), "p\(index)") }
        XCTAssertEqual(table.join(NearbyJoinRequest(name: "Sixth", seatToken: "x"), now: 0), .failure(.tableFull))
        XCTAssertTrue(table.remove("p5"))
        XCTAssertTrue(table.addBot(.easy))
        table.start(seed: 4, now: 0)
        XCTAssertEqual(table.join(NearbyJoinRequest(name: "Late", seatToken: "late"), now: 0), .failure(.gameInProgress))
        XCTAssertEqual(table.join(NearbyJoinRequest(name: "Old", seatToken: "y", protocolVersion: 99), now: 0), .failure(.versionMismatch))
    }

    func testAReturningPhoneGetsItsSeatBackAndPlayWaitsForIt() {
        var table = NearbyTable(hostName: "Eric")
        XCTAssertEqual(join(&table, "Anna", token: "anna"), "p2")
        table.start(seed: 7, now: 0)
        table.disconnect("p2")
        XCTAssertTrue(table.isPaused)
        let game = table.game!
        let move = Engine.getLegalActions(game, Engine.nextPrompt(game).playerId)[0].action
        XCTAssertEqual(table.apply(move, by: move.playerId, revision: nil, now: 0), .paused)
        XCTAssertEqual(join(&table, "Anna again", token: "anna"), "p2")
        XCTAssertFalse(table.isPaused)
        XCTAssertEqual(table.seat("p2")?.name, "Anna", "a name only changes in the lobby")
    }

    func testABotCanCoverForSomeoneAwayUntilTheyReturn() {
        var table = NearbyTable(hostName: "Eric")
        _ = join(&table, "Anna", token: "anna")
        table.start(seed: 3, now: 0)
        table.disconnect("p2")
        XCTAssertTrue(table.coverWithBot("p2"))
        XCTAssertFalse(table.isPaused)
        // Once it's Anna's prompt, the bot moves for her.
        var guard_ = 0
        while Engine.nextPrompt(table.game!).playerId != "p2", guard_ < 50 {
            let game = table.game!
            let id = Engine.nextPrompt(game).playerId
            let legal = Engine.getLegalActions(game, id)
            XCTAssertNil(table.apply(Heuristic.choose(game, actorId: id, legalActions: legal)?.action ?? legal[0].action, by: id, revision: nil, now: 0))
            guard_ += 1
        }
        XCTAssertEqual(table.botToMove?.seatId, "p2")
        _ = join(&table, "Anna", token: "anna")
        XCTAssertNil(table.botToMove, "she plays her own seat again")
        XCTAssertEqual(table.view(for: "p2", now: 0).legalActions.isEmpty, false)
    }

    func testMovesFromTheWrongSeatOrAnOldBoardAreRefused() {
        var table = NearbyTable(hostName: "Eric")
        _ = join(&table, "Anna")
        table.start(seed: 11, now: 0)
        let game = table.game!
        let promptId = Engine.nextPrompt(game).playerId
        let other = promptId == "p1" ? "p2" : "p1"
        let move = Engine.getLegalActions(game, promptId)[0].action
        XCTAssertEqual(table.apply(move, by: other, revision: nil, now: 0), .notYourMove)
        XCTAssertEqual(table.apply(move, by: promptId, revision: table.revision - 1, now: 0), .stale)
        XCTAssertNil(table.apply(move, by: promptId, revision: table.revision, now: 0))
    }

    func testUndoIsOnlyForTheTurnsPlayer() throws {
        var table = NearbyTable(hostName: "Eric")
        _ = join(&table, "Anna")
        table.start(seed: 5, now: 0)
        let current = table.game!.players[table.game!.currentPlayerIndex].id
        let other = current == "p1" ? "p2" : "p1"
        let draw = try XCTUnwrap(Engine.getLegalActions(table.game!, current).first { $0.action.type == .draw_cards }).action
        XCTAssertNil(table.apply(draw, by: current, revision: nil, now: 0))
        let before = table.game
        let play = try XCTUnwrap(Engine.getLegalActions(table.game!, current).first { $0.action.type == .play_to_bank || $0.action.type == .play_property }).action
        XCTAssertNil(table.apply(play, by: current, revision: nil, now: 0))
        XCTAssertFalse(table.canUndo(other))
        XCTAssertEqual(table.undo(by: other, revision: nil), .notYourMove)
        XCTAssertTrue(table.canUndo(current))
        XCTAssertNil(table.undo(by: current, revision: nil))
        XCTAssertEqual(table.game, before)
        XCTAssertNil(table.resetTurn(by: current, revision: nil))
        XCTAssertEqual(table.log?.actions.count, 0, "the log loses the undone moves too")
    }

    func testEachPhoneSeesOnlyItsOwnHand() throws {
        var table = NearbyTable(hostName: "Eric")
        _ = join(&table, "Anna")
        _ = join(&table, "Sam")
        table.start(seed: 9, now: 0)
        let view = table.view(for: "p2", now: 0)
        let game = try XCTUnwrap(view.game)
        for player in game.players {
            if player.id == "p2" {
                XCTAssertFalse(player.hand.contains(Catalog.hiddenCardId))
            } else {
                XCTAssertTrue(player.hand.allSatisfy { $0 == Catalog.hiddenCardId })
            }
        }
        XCTAssertTrue(game.drawPile.allSatisfy { $0 == Catalog.hiddenCardId })
        XCTAssertEqual(game.drawPile.count, table.game?.drawPile.count)
        XCTAssertNil(view.log, "the full log only goes out once the game is over")
        XCTAssertTrue(view.legalActions.allSatisfy { $0.action.playerId == "p2" })

        var debt = table.game!
        debt.pending = .debtCard(PendingDebtCard(debtorPlayerId: "p2", creditorPlayerId: "p1", debtId: "d1", cardId: "money-5-a"))
        for (viewer, hidden) in [("p1", false), ("p2", false), ("p3", true)] {
            guard case .debtCard(let payload) = NearbyTable.mask(debt, for: viewer).pending else { return XCTFail("pending changed") }
            XCTAssertEqual(payload.cardId == Catalog.hiddenCardId, hidden, viewer)
        }
    }

    func testASavedTableRestoresWithItsSeatsAndUndoHistory() throws {
        var table = NearbyTable(hostName: "Eric")
        _ = join(&table, "Anna", token: "anna")
        table.start(seed: 2, now: 0)
        let current = table.game!.players[table.game!.currentPlayerIndex].id
        let draw = try XCTUnwrap(Engine.getLegalActions(table.game!, current).first { $0.action.type == .draw_cards }).action
        XCTAssertNil(table.apply(draw, by: current, revision: nil, now: 0))
        let restored = try JSONDecoder().decode(NearbyTable.self, from: JSONEncoder().encode(table))
        XCTAssertEqual(restored, table)
        XCTAssertEqual(restored.seatId(forToken: "anna"), "p2")
        XCTAssertTrue(restored.canUndo(current))
    }

    func testLobbyDropsAndLeavingDuringAGame() {
        var table = NearbyTable(hostName: "Eric")
        _ = join(&table, "Anna")
        table.disconnect("p2")
        XCTAssertEqual(table.seats.count, 1, "before the game, a dropped phone just leaves")
        _ = join(&table, "Sam")
        table.start(seed: 1, now: 0)
        table.leave("p2")
        XCTAssertEqual(table.seat("p2")?.botCovering, true)
        XCTAssertFalse(table.isPaused)
    }
}

@MainActor
final class NearbySessionTests: XCTestCase {
    private func waitFor(_ what: String, timeout: Duration = .seconds(60), _ condition: () -> Bool) async throws {
        let clock = ContinuousClock()
        let deadline = clock.now + timeout
        while !condition() {
            if clock.now > deadline {
                XCTFail("Timed out waiting for \(what)")
                throw CancellationError()
            }
            try await Task.sleep(for: .milliseconds(5))
        }
    }

    private func makeHost(_ hub: LoopbackHub, table: NearbyTable = NearbyTable(hostName: "Eric")) -> NearbyHost {
        let host = NearbyHost(table: table, transport: hub.host, chooseBotMove: heuristicBot)
        host.botDelay = .zero
        return host
    }

    /// Each phone plays its own seat from its own view, as a person would.
    private func playOneRound(host: NearbyHost, guests: [NearbyGuest]) -> Bool {
        var moved = false
        let hostView = host.view
        if let game = hostView.game, !hostView.legalActions.isEmpty {
            host.perform(Heuristic.choose(game, actorId: hostView.yourSeatId, legalActions: hostView.legalActions)?.action ?? hostView.legalActions[0].action)
            moved = true
        }
        for guest in guests {
            guard let view = guest.view, let game = view.game, !view.legalActions.isEmpty, guest.link == .connected else { continue }
            guest.perform(Heuristic.choose(game, actorId: view.yourSeatId, legalActions: view.legalActions)?.action ?? view.legalActions[0].action)
            moved = true
        }
        return moved
    }

    private func playToFinish(host: NearbyHost, guests: [NearbyGuest], each: () -> Void = {}, until stop: () -> Bool = { false }) async throws {
        var idle = 0
        while !host.table.isFinished, !stop() {
            each()
            idle = playOneRound(host: host, guests: guests) ? 0 : idle + 1
            if idle > 4000 {
                let game = host.table.game!
                let seats = host.table.seats.map { "\($0.id) connected \($0.connected) bot \($0.botCovering)" }
                return XCTFail("the game stalled at \(Engine.nextPrompt(game)), revision \(host.table.revision), seats \(seats)")
            }
            await Task.yield()
            if idle > 0 { try await Task.sleep(for: .milliseconds(1)) }
        }
    }

    private func assertNoHandsLeaked(_ guests: [NearbyGuest], file: StaticString = #filePath, line: UInt = #line) {
        for guest in guests {
            guard let view = guest.view, let game = view.game, !view.isFinished else { continue }
            for player in game.players where player.id != view.yourSeatId {
                XCTAssertTrue(player.hand.allSatisfy { $0 == Catalog.hiddenCardId }, "\(view.yourSeatId) saw \(player.id)'s hand", file: file, line: line)
            }
        }
    }

    func testThreePhonesAndABotPlayAWholeGame() async throws {
        let hub = LoopbackHub()
        let host = makeHost(hub)
        host.start()
        let anna = NearbyGuest(transport: hub.makeGuest(), name: "Anna")
        let sam = NearbyGuest(transport: hub.makeGuest(), name: "Sam")
        for guest in [anna, sam] {
            guest.start()
            try await waitFor("a table to show up") { !guest.tables.isEmpty }
            guest.join(guest.tables[0])
        }
        try await waitFor("both phones to sit down") { anna.view?.seats.count == 3 && sam.view?.seats.count == 3 }
        host.addBot(.easy)
        host.setVariant(.no_mercy)
        host.startGame(seed: 21)
        try await waitFor("the deal to reach the phones") { anna.view?.started == true && sam.view?.started == true }
        XCTAssertEqual(anna.view?.variant, .no_mercy)

        try await playToFinish(host: host, guests: [anna, sam], each: { self.assertNoHandsLeaked([anna, sam]) })
        try await waitFor("every phone to see the result") { anna.view?.isFinished == true && sam.view?.isFinished == true }
        let winner = host.table.game?.winnerId
        XCTAssertNotNil(winner)
        XCTAssertEqual(anna.view?.game?.winnerId, winner)
        XCTAssertEqual(sam.view?.game?.winnerId, winner)
        let log = try XCTUnwrap(anna.view?.log)
        var replayed = log.initial
        for action in log.actions { replayed = Engine.applyAction(replayed, action).state }
        XCTAssertEqual(replayed.winnerId, winner, "the replay plays back to the same result")

        host.startGame(seed: 22)
        try await waitFor("the rematch to reach the phones") { anna.view?.isFinished == false && anna.view?.started == true }
    }

    func testAPhoneThatDropsMidGameRejoinsItsSeat() async throws {
        let hub = LoopbackHub()
        let host = makeHost(hub)
        host.start()
        let annaLink = hub.makeGuest()
        var saved: NearbyGuestSession?
        let anna = NearbyGuest(transport: annaLink, name: "Anna")
        anna.onSessionChange = { saved = $0 }
        anna.start()
        try await waitFor("the table") { !anna.tables.isEmpty }
        anna.join(anna.tables[0])
        try await waitFor("Anna to sit down") { anna.view?.yourSeatId == "p2" }
        host.startGame(seed: 33)
        try await playToFinish(host: host, guests: [anna], until: { host.table.game!.turnCount >= 3 })

        annaLink.drop()
        try await waitFor("the host to pause") { host.table.isPaused }
        XCTAssertTrue(host.view.legalActions.isEmpty)
        try await waitFor("Anna to come back by herself") { anna.link == .connected && !host.table.isPaused }
        XCTAssertEqual(anna.view?.yourSeatId, "p2")

        // The app relaunched: a new guest with the saved seat token takes the same seat.
        anna.stop()
        try await waitFor("the host to pause") { host.table.isPaused }
        let relaunched = NearbyGuest(transport: hub.makeGuest(), name: "Anna", session: saved)
        relaunched.start()
        try await waitFor("the relaunched app to take its seat") { relaunched.view?.yourSeatId == "p2" && !host.table.isPaused }
        try await playToFinish(host: host, guests: [relaunched])
        XCTAssertTrue(host.table.isFinished)
    }

    func testTheHostCanCloseAndReopenWithASavedTable() async throws {
        let hub = LoopbackHub()
        var savedTable: NearbyTable?
        let host = makeHost(hub)
        host.onChange = { savedTable = $0 }
        host.start()
        let anna = NearbyGuest(transport: hub.makeGuest(), name: "Anna")
        anna.start()
        try await waitFor("the table") { !anna.tables.isEmpty }
        anna.join(anna.tables[0])
        try await waitFor("Anna to sit down") { anna.view?.seats.count == 2 }
        host.startGame(seed: 44)
        try await playToFinish(host: host, guests: [anna], until: { host.table.game!.turnCount >= 4 })

        // The host's app is closed. Its last save brings the table back, and Anna rejoins.
        host.stop()
        XCTAssertNotEqual(anna.link, .connected)
        var crashed = try XCTUnwrap(savedTable)
        // An app that was killed outright never recorded the drop.
        _ = crashed.join(NearbyJoinRequest(name: "Anna", seatToken: try XCTUnwrap(anna.session?.seatToken)), now: 0)
        let reopened = makeHost(hub, table: crashed)
        XCTAssertTrue(reopened.table.isPaused, "a restored table waits for its phones")
        reopened.start()
        try await waitFor("Anna to rejoin the reopened table") { anna.link == .connected && !reopened.table.isPaused }
        try await playToFinish(host: reopened, guests: [anna])
        XCTAssertTrue(reopened.table.isFinished)
    }

    func testAStaleMoveIsRefusedAndTheBoardRefreshed() async throws {
        let hub = LoopbackHub()
        let host = makeHost(hub)
        host.start()
        let annaLink = hub.makeGuest()
        let anna = NearbyGuest(transport: annaLink, name: "Anna")
        anna.start()
        try await waitFor("the table") { !anna.tables.isEmpty }
        anna.join(anna.tables[0])
        try await waitFor("Anna to sit down") { anna.view?.seats.count == 2 }
        host.startGame(seed: 55)
        try await playToFinish(host: host, guests: [], until: { anna.view?.legalActions.isEmpty == false })
        let view = try XCTUnwrap(anna.view)
        let data = try JSONEncoder().encode(NearbyGuestMessage.perform(view.legalActions[0].action, revision: view.revision - 1))
        annaLink.send(data)
        try await waitFor("the refusal") { anna.lastRejection != nil }
        XCTAssertEqual(host.table.revision, view.revision)
    }

    func testTheHostTurnsAwayARemovedPhone() async throws {
        let hub = LoopbackHub()
        let host = makeHost(hub)
        host.start()
        let anna = NearbyGuest(transport: hub.makeGuest(), name: "Anna")
        anna.start()
        try await waitFor("the table") { !anna.tables.isEmpty }
        anna.join(anna.tables[0])
        try await waitFor("Anna to sit down") { anna.view?.seats.count == 2 }
        host.remove("p2")
        try await waitFor("Anna to be told") { anna.refusal == .removed }
        XCTAssertNil(anna.session)
        XCTAssertEqual(host.table.seats.count, 1)
    }

    func testLeavingHandsTheSeatToABot() async throws {
        let hub = LoopbackHub()
        let host = makeHost(hub)
        host.start()
        let anna = NearbyGuest(transport: hub.makeGuest(), name: "Anna")
        anna.start()
        try await waitFor("the table") { !anna.tables.isEmpty }
        anna.join(anna.tables[0])
        try await waitFor("Anna to sit down") { anna.view?.seats.count == 2 }
        host.startGame(seed: 66)
        anna.leave()
        try await waitFor("a bot to take Anna's seat") { host.table.seat("p2")?.botCovering == true }
        try await playToFinish(host: host, guests: [])
        XCTAssertTrue(host.table.isFinished)
    }
}
