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

    // MARK: Build notes and fix progress (inbox status handed in, see ReportCenter's DEBUG hooks)

    private static let log: [[String: Any]] = [
        ["commit": "132fe35", "at": "2026-11-18T13:36:04-08:00", "subject": "Group the deck picker by kind", "app": true],
        ["commit": "bbbb111", "at": "2026-11-18T13:00:00-08:00", "subject": "Widen the rent chooser", "app": true, "report": "20261118-100000-aaaa"],
        ["commit": "53115cf", "at": "2026-11-18T12:50:00-08:00", "subject": "Test the lobby", "app": false],
        ["commit": "6291017", "at": "2026-11-18T12:13:03-08:00", "subject": "Show No change needed", "app": true],
    ]

    private func base64(_ value: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: value))?.base64EncodedString() ?? ""
    }

    private func launch(running commit: String, offering build: String) {
        let status: [String: Any] = [
            "reports": [
                "20261118-235940-rno7": ["state": "fixing", "phase": "checks", "step": "Running npm run quality", "stepAt": ISO8601DateFormatter().string(from: Date())],
                "20261118-100000-aaaa": ["state": "fixed", "summary": "Gave the chooser more room."],
            ],
            "build": ["commit": build, "at": "", "committedAt": "2026-11-18T13:36:04-08:00", "reports": [], "log": Self.log],
        ]
        let sent = [["id": "20261118-235940-rno7", "note": "Show All opens saved games"], ["id": "20261118-100000-aaaa", "note": "Rent chooser is cramped"]]
        app.launchArguments = [
            "-seed", "7", "-storeDirectory", "uitest-\(UUID().uuidString)", "-report.enabled", "YES", "-report.key", "uitest",
            "-report.testBuildCommit", commit, "-report.testSent", base64(sent), "-report.testStatus", base64(status),
        ]
        app.launch()
        XCTAssertTrue(app.buttons["home.practice"].waitForExistence(timeout: 20))
    }

    func testOlderBuildIsNotOfferedAndAFixShowsItsProgress() throws {
        // The phone on 2026-11-18: built by hand from 132fe35, offered the older 6291017.
        launch(running: "132fe35", offering: "6291017")
        sleep(2)
        XCTAssertFalse(app.buttons["report.buildBanner"].exists, "An older build must not be offered")
        app.buttons["report.button"].tap()
        XCTAssertTrue(app.navigationBars["Report a Problem"].waitForExistence(timeout: 5))
        let progress = app.staticTexts["report.progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 5), "A report being fixed shows how far it has got")
        XCTAssertTrue(progress.label.hasPrefix("Running checks · Running npm run quality · "), progress.label)
    }

    func testNewerBuildListsWhatItBrings() throws {
        launch(running: "6291017", offering: "132fe35")
        let banner = app.buttons["report.buildBanner"]
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertEqual(banner.label, "New build ready (1 fix). Install")
        banner.tap()
        XCTAssertTrue(app.navigationBars["New Build"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Rent chooser is cramped"].exists)
        XCTAssertTrue(app.staticTexts["Gave the chooser more room."].exists)
        XCTAssertTrue(app.staticTexts["Group the deck picker by kind"].exists)
        XCTAssertFalse(app.staticTexts["Test the lobby"].exists, "Test-only commits aren't app changes")
        XCTAssertFalse(app.staticTexts["Widen the rent chooser"].exists, "A fix is listed by its report, not again by its commit")
    }
}

