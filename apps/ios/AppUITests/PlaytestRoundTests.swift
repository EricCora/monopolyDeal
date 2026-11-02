import XCTest

/// Walks the screens from the two-phone playtest: the timer, the log, banks, bots and the room between matches.
final class PlaytestRoundTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func firstExisting(_ identifiers: [String]) -> XCUIElement? {
        for identifier in identifiers {
            let element = app.buttons[identifier]
            if element.exists && element.isHittable { return element }
        }
        return nil
    }

    /// One move for this seat, if it has one.
    private func playAStep() {
        if let control = firstExisting(["confirm.play", "chooser.0", "action.draw", "payment.auto", "payment.submit", "counter.allow", "forced.give.0", "forced.take.0"]) {
            control.tap()
            return
        }
        let playable = app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'hand\\\\.[0-9]+'")).firstMatch
        if playable.exists && playable.isHittable {
            playable.tap()
            return
        }
        if let pass = firstExisting(["action.pass", "discard.0"]) { pass.tap() }
    }

    private func playUntil(_ done: XCUIElement, steps: Int) {
        for _ in 0..<steps {
            if done.exists { return }
            playAStep()
        }
    }

    func testLocalGameScreens() throws {
        app.launchArguments = ["-seed", "5", "-botDelayMs", "60", "-speedTurnSeconds", "600", "-storeDirectory", "uitest-\(UUID().uuidString)"]
        app.launch()
        let newGame = app.buttons["home.newGame"]
        XCTAssertTrue(newGame.waitForExistence(timeout: 20))
        newGame.tap()
        app.segmentedControls["setup.speed"].buttons["Speed"].tap()
        XCTAssertTrue(app.sliders["timer.slider"].waitForExistence(timeout: 3))
        app.sliders["timer.slider"].adjust(toNormalizedSliderPosition: 0)
        shot("setup-slider")
        let controller = app.buttons["setup.controller.1"]
        if controller.waitForExistence(timeout: 2) {
            controller.tap()
            app.buttons["Bot"].firstMatch.tap()
        }
        app.swipeUp()
        app.buttons["setup.start"].tap()
        XCTAssertTrue(app.descendants(matching: .any)["table.clock"].waitForExistence(timeout: 10))
        for _ in 0..<40 { playAStep() }
        shot("table")
        let bank = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Bank,'")).firstMatch
        if bank.exists {
            bank.tap()
            sleep(1)
            shot("my-bank")
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.12)).tap()
            sleep(1)
        }
        app.buttons["table.menu"].tap()
        app.buttons["Game Log"].tap()
        XCTAssertTrue(app.segmentedControls["log.filter"].waitForExistence(timeout: 5))
        shot("game-log")
    }

    func testRoomWithABotAndTheLobbyBetweenMatches() throws {
        let server = try XCTUnwrap(ProcessInfo.processInfo.environment["DEAL_TEST_SERVER_URL"], "Set TEST_RUNNER_DEAL_TEST_SERVER_URL.")
        app.launchArguments = ["-serverURL", server, "-route", "online", "-storeDirectory", "uitest-\(UUID().uuidString)"]
        app.launch()
        let name = app.textFields["online.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 20))
        name.tap()
        name.typeText("Eric")
        // The system's first-run keyboard tip can cover the screen.
        let tip = app.buttons["Continue"]
        if tip.waitForExistence(timeout: 1) { tip.tap() }
        app.buttons["online.host"].tap()
        let addBot = app.buttons["room.addBot"]
        for _ in 0..<8 where !addBot.isHittable { app.swipeUp() }
        XCTAssertTrue(addBot.waitForExistence(timeout: 20))
        addBot.tap()
        let difficulty = app.segmentedControls["room.botDifficulty"]
        XCTAssertTrue(difficulty.waitForExistence(timeout: 5))
        difficulty.buttons["Hard"].tap()
        sleep(1)
        XCTAssertTrue(difficulty.buttons["Hard"].isSelected, "The bot should now play hard")
        shot("lobby-bot")
        // A short game: the Fast preset needs two sets.
        app.segmentedControls["room.preset"].buttons["Fast"].tap()
        let speed = app.switches["room.speed"]
        XCTAssertTrue(speed.waitForExistence(timeout: 3))
        speed.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
        XCTAssertTrue(app.sliders["timer.slider"].waitForExistence(timeout: 5))
        app.sliders["timer.slider"].adjust(toNormalizedSliderPosition: 1)
        sleep(1)
        shot("lobby-speed")
        for _ in 0..<4 where !app.buttons["room.ready"].isHittable { app.swipeUp() }
        app.buttons["room.ready"].tap()
        let start = app.buttons["room.start"]
        let enabled = NSPredicate(format: "isEnabled == true")
        expectation(for: enabled, evaluatedWith: start)
        waitForExpectations(timeout: 15)
        start.tap()
        XCTAssertTrue(app.buttons["table.menu"].waitForExistence(timeout: 15))
        sleep(2)
        shot("online-table")

        let finished = app.buttons["postgame.done"]
        for _ in 0..<1500 {
            if finished.exists { break }
            playAStep()
        }
        XCTAssertTrue(finished.waitForExistence(timeout: 60))
        shot("online-results")
        finished.tap()
        let startNext = app.buttons["room.start"]
        XCTAssertTrue(startNext.waitForExistence(timeout: 5))
        sleep(1)
        shot("lobby-between-matches")
        for _ in 0..<4 where !app.buttons["room.ready"].isHittable { app.swipeUp() }
        app.buttons["room.ready"].tap()
        expectation(for: enabled, evaluatedWith: startNext)
        waitForExpectations(timeout: 15)
        startNext.tap()
        XCTAssertTrue(app.buttons["table.menu"].waitForExistence(timeout: 15))
        sleep(1)
        shot("next-game")
    }
}
