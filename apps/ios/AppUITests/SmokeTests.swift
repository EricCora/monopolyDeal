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
                control.tap()
                if control.identifier == "payment.auto" {
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
            let playable = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'hand.' AND value == 'playable'")).firstMatch
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
        let button = app.buttons[option]
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
