import XCTest

/// The bug button: it floats over the table, opens the report sheet with a screenshot, and a
/// build installed from the banner reopens the saved game.
final class ReportUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    private func startPractice() {
        let practice = app.buttons["home.practice"]
        XCTAssertTrue(practice.waitForExistence(timeout: 20))
        practice.tap()
        let button = app.buttons["Classic, Easy"].firstMatch
        XCTAssertTrue(button.waitForExistence(timeout: 5))
        button.tap()
        XCTAssertTrue(app.buttons["action.draw"].waitForExistence(timeout: 10))
        waitForPhoneTableToTurn(app)
    }

    func testButtonOpensTheReportSheetOverTheTable() throws {
        app.launchArguments = ["-seed", "7", "-botDelayMs", "30000", "-storeDirectory", "uitest-\(UUID().uuidString)", "-report.enabled", "YES"]
        app.launch()
        startPractice()
        let bug = app.buttons["report.button"]
        XCTAssertTrue(bug.waitForExistence(timeout: 5), "The bug button should float over the game table")
        sleep(2) // Let the deal settle, so the two screenshots can be compared.
        // It sits clear of the controls a player needs on the sideways table.
        let window = app.windows.firstMatch.frame
        XCTAssertTrue(window.contains(bug.frame), "The bug button should be on screen: \(bug.frame) in \(window)")
        XCTAssertFalse(bug.frame.intersects(app.buttons["action.draw"].frame), "The bug button covers Draw: \(bug.frame)")
        let hand = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'hand.'"))
        for index in 0..<hand.count {
            let card = hand.element(boundBy: index)
            XCTAssertFalse(bug.frame.intersects(card.frame), "The bug button covers \(card.identifier): \(bug.frame) vs \(card.frame)")
        }
        let before = XCTAttachment(screenshot: app.screenshot())
        before.name = "table-before-report"
        before.lifetime = .keepAlways
        add(before)
        bug.tap()
        XCTAssertTrue(app.navigationBars["Report a Problem"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.switches["Include screenshot"].exists || app.staticTexts["Include screenshot"].exists, "The sheet should offer the screenshot")
        let note = app.textFields["report.note"].exists ? app.textFields["report.note"] : app.textViews["report.note"]
        XCTAssertTrue(note.exists)

        // Sends a real report when a test run asks for one (see scripts/feedback/README.md).
        if let text = ProcessInfo.processInfo.environment["REPORT_E2E_NOTE"], !text.isEmpty {
            note.tap()
            note.typeText(text)
            app.buttons["report.send"].tap()
            // A sent report clears the note field.
            let cleared = expectation(for: NSPredicate(format: "NOT (value BEGINSWITH %@)", String(text.prefix(20))), evaluatedWith: note)
            wait(for: [cleared], timeout: 30)
        } else {
            app.buttons["Close"].tap()
            XCTAssertTrue(app.buttons["action.draw"].waitForExistence(timeout: 5), "Closing the sheet returns to the game")
        }
    }

    func testButtonStaysHiddenWhenSwitchedOff() throws {
        app.launchArguments = ["-seed", "7", "-storeDirectory", "uitest-\(UUID().uuidString)", "-report.enabled", "NO"]
        app.launch()
        XCTAssertTrue(app.buttons["home.practice"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["report.button"].exists)
    }

    func testInstalledBuildReopensTheSavedGame() throws {
        let folder = "uitest-\(UUID().uuidString)"
        app.launchArguments = ["-seed", "7", "-botDelayMs", "30000", "-storeDirectory", folder]
        app.launch()
        startPractice()
        app.buttons["action.draw"].tap()
        XCTAssertTrue(app.buttons["action.pass"].waitForExistence(timeout: 5))
        sleep(1)
        app.terminate()
        // What the install button leaves behind before the new build replaces the app.
        app.launchArguments = ["-seed", "7", "-botDelayMs", "30000", "-storeDirectory", folder, "-report.resumeAfterInstall", "YES"]
        app.launch()
        XCTAssertTrue(app.buttons["action.pass"].waitForExistence(timeout: 20), "The game should reopen without going through Home")
    }
}
