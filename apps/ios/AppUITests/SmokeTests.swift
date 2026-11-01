import XCTest

/// Plays real games through the screen, tapping what a player would tap. The launch
/// arguments fix the deal, shorten the bot's pause and use a throwaway save folder.
final class GameplayUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    private func launch(seed: Int, winSets: Int? = nil) {
        var arguments = ["-seed", "\(seed)", "-botDelayMs", "60", "-storeDirectory", "uitest-\(UUID().uuidString)"]
        if let winSets { arguments += ["-winSets", "\(winSets)"] }
        app.launchArguments = arguments
        app.launch()
    }

    /// First available control of the given id prefixes, without waiting long on each.
    private func firstExisting(_ identifiers: [String]) -> XCUIElement? {
        for identifier in identifiers {
            let element = app.buttons[identifier]
            if element.exists && element.isHittable { return element }
        }
        return nil
    }

    private func playToFinish(maxSteps: Int = 900) throws {
        let winner = app.staticTexts["postgame.winner"]
        for _ in 0..<maxSteps {
            if winner.exists { return }
            if let control = firstExisting(["confirm.play", "chooser.0", "action.draw", "payment.auto"]) {
                // Read this before tapping, because the button may be gone afterward.
                let isAutoPay = control.identifier == "payment.auto"
                control.tap()
                if isAutoPay {
                    let submit = app.buttons["payment.submit"]
                    if submit.waitForExistence(timeout: 2) { submit.tap() }
                }
                continue
            }
            if let control = firstExisting(["payment.submit", "counter.jsn", "counter.allow", "forced.give.0", "forced.take.0", "prompt.0"]) {
                control.tap()
                continue
            }
            // Play a card if one is playable, otherwise end the turn.
            let playable = app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'hand\\\\.[0-9]+' AND value == 'playable'")).firstMatch
            if playable.exists {
                playable.tap()
                if firstExisting(["chooser.0", "confirm.play"]) != nil { continue }
                continue
            }
            if let pass = firstExisting(["action.pass"]) {
                pass.tap()
                continue
            }
            // The bot is thinking.
            _ = winner.waitForExistence(timeout: 0.2)
        }
        XCTAssertTrue(winner.exists, "The game didn't finish within \(maxSteps) steps")
    }

    private func startPractice(_ option: String) {
        let practice = app.buttons["home.practice"]
        XCTAssertTrue(practice.waitForExistence(timeout: 20))
        practice.tap()
        // The dialog can expose its button more than once, so take the first match.
        let button = app.buttons[option].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
        XCTAssertTrue(app.buttons["action.draw"].waitForExistence(timeout: 10))
    }

    func testClassicGamePlaysToAWinner() throws {
        launch(seed: 11, winSets: 2)
        startPractice("Classic, Easy")
        try playToFinish()
        XCTAssertTrue(app.buttons["postgame.primary"].exists)
    }

    func testNoMercyGamePlaysToAWinner() throws {
        launch(seed: 23)
        startPractice("No Mercy, Easy")
        try playToFinish(maxSteps: 1500)
    }

    func testPassAndPlayHidesHandsUntilRevealed() throws {
        launch(seed: 5)
        let newGame = app.buttons["home.newGame"]
        XCTAssertTrue(newGame.waitForExistence(timeout: 20))
        newGame.tap()
        app.buttons["setup.start"].tap()
        let reveal = app.buttons["shield.reveal"]
        XCTAssertTrue(reveal.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["action.draw"].isHittable)
        reveal.tap()
        let draw = app.buttons["action.draw"]
        XCTAssertTrue(draw.waitForExistence(timeout: 5))
        draw.tap()
        app.buttons["action.pass"].tap()
        // The turn may require a discard first; either way the next player sees a shield.
        XCTAssertTrue(reveal.waitForExistence(timeout: 5) || app.buttons["chooser.0"].exists)
    }

    func testSavedGameSurvivesRelaunch() throws {
        let folder = "uitest-\(UUID().uuidString)"
        app.launchArguments = ["-seed", "7", "-storeDirectory", folder]
        app.launch()
        startPractice("Classic, Easy")
        app.buttons["action.draw"].tap()
        sleep(1)
        app.terminate()
        app.launch()
        XCTAssertTrue(app.buttons["home.continue"].waitForExistence(timeout: 20))
        app.buttons["home.continue"].tap()
        XCTAssertTrue(app.buttons["action.pass"].waitForExistence(timeout: 5))
    }

    /// Holding spreads the hand to read it, sliding moves along it, and letting go plays nothing.
    func testHoldingTheHandDoesNotPlayACard() throws {
        launch(seed: 11)
        startPractice("Classic, Easy")
        app.buttons["action.draw"].tap()
        XCTAssertTrue(app.buttons["action.pass"].waitForExistence(timeout: 5))

        let hand = app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'hand\\\\.[0-9]+'"))
        let countBefore = hand.count
        XCTAssertGreaterThan(countBefore, 1)
        let start = hand.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        let end = hand.element(boundBy: countBefore - 1).coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.7))
        start.press(forDuration: 1.0, thenDragTo: end, withVelocity: 40, thenHoldForDuration: 6)

        XCTAssertEqual(hand.count, countBefore, "Holding must not play a card")
        XCTAssertFalse(app.buttons["chooser.0"].exists, "Holding must not open the play options")
        XCTAssertFalse(app.buttons["action.undo"].exists && hand.count != countBefore)
    }

    /// A quick tap still plays, so the hold gesture hasn't taken over the hand.
    func testTappingACardStillOpensItsOptions() throws {
        launch(seed: 11)
        startPractice("Classic, Easy")
        app.buttons["action.draw"].tap()
        XCTAssertTrue(app.buttons["action.pass"].waitForExistence(timeout: 5))
        let hand = app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'hand\\\\.[0-9]+'"))
        let countBefore = hand.count
        hand.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.5)).tap()
        let deadline = Date.now.addingTimeInterval(5)
        var played = false
        while !played && Date.now < deadline {
            played = app.buttons["chooser.0"].exists || hand.count != countBefore
        }
        XCTAssertTrue(played, "A tap should play the card or open its options")
    }

    /// iPad can turn sideways, and the table has to keep working when it does.
    func testIPadTableWorksInLandscape() throws {
        try XCTSkipUnless(UIDevice.current.userInterfaceIdiom == .pad, "iPhone stays in portrait.")
        launch(seed: 11)
        XCUIDevice.shared.orientation = .landscapeLeft
        defer { XCUIDevice.shared.orientation = .portrait }
        startPractice("Classic, Easy")
        let draw = app.buttons["action.draw"]
        XCTAssertTrue(draw.isHittable)
        draw.tap()
        let pass = app.buttons["action.pass"]
        XCTAssertTrue(pass.waitForExistence(timeout: 5))
        XCTAssertTrue(pass.isHittable)
        let hand = app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'hand\\\\.[0-9]+'"))
        XCTAssertGreaterThan(hand.count, 1)
        for index in 0..<hand.count {
            XCTAssertTrue(app.frame.contains(hand.element(boundBy: index).frame), "Card \(index) is off the screen")
        }
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "iPad landscape"
        shot.lifetime = .keepAlways
        add(shot)
    }

    /// The bot's legal moves must never appear as the player's buttons.
    func testOpponentsTurnOffersNoDrawOrEndTurn() throws {
        // A long pause keeps the bot's turn on screen for the whole check.
        app.launchArguments = ["-seed", "11", "-botDelayMs", "30000", "-storeDirectory", "uitest-\(UUID().uuidString)"]
        app.launch()
        startPractice("Classic, Easy")
        app.buttons["action.draw"].tap()
        let pass = app.buttons["action.pass"]
        XCTAssertTrue(pass.waitForExistence(timeout: 5))
        pass.tap()
        // Over the hand limit, the turn ends only after a discard.
        let discard = app.buttons["chooser.0"]
        let hand = app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'hand\\\\.[0-9]+' AND value == 'playable'"))
        for _ in 0..<4 where hand.firstMatch.exists {
            hand.firstMatch.tap()
            if discard.waitForExistence(timeout: 2) { discard.tap() }
        }
        XCTAssertTrue(app.staticTexts["House Bot's turn"].waitForExistence(timeout: 10), "It should be the bot's turn")
        XCTAssertFalse(app.buttons["action.pass"].exists, "End Turn was offered on the bot's turn")
        XCTAssertFalse(app.buttons["action.draw"].exists, "Draw was offered on the bot's turn")
    }

    func testMenusOpen() throws {
        launch(seed: 3)
        for (button, title) in [("home.saved", "Saved Games"), ("home.stats", "Stats"), ("home.settings", "Settings"), ("home.online", "Online")] {
            XCTAssertTrue(app.buttons[button].waitForExistence(timeout: 20), button)
            app.buttons[button].tap()
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5), title)
            app.navigationBars.buttons.element(boundBy: 0).tap()
        }
    }

    /// Needs a room server. `npm run ios:verify` passes its address in the environment.
    func testCreatesAnOnlineRoom() throws {
        guard let server = ProcessInfo.processInfo.environment["DEAL_TEST_SERVER_URL"] else {
            throw XCTSkip("No test server")
        }
        app.launchArguments = ["-serverURL", server, "-storeDirectory", "uitest-\(UUID().uuidString)"]
        app.launch()
        XCTAssertTrue(app.buttons["home.online"].waitForExistence(timeout: 20))
        app.buttons["home.online"].tap()
        let name = app.textFields["online.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Tester")
        app.buttons["online.host"].tap()
        XCTAssertTrue(app.staticTexts["room.code"].waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["room.start"].exists)
        app.buttons["room.forget"].tap()
        app.buttons["Forget Room"].firstMatch.tap()
    }
}
