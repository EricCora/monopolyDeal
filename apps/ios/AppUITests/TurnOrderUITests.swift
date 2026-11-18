import XCTest

/// The host holds a player in the lobby and drags them to change the turn order.
final class TurnOrderUITests: XCTestCase {
    func testTheHostHoldsABotAndDragsItToTheTop() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["-storeDirectory", "uitest-\(UUID().uuidString)"]
        addUIInterruptionMonitor(withDescription: "Local network") { alert in
            for title in ["Allow", "OK"] where alert.buttons[title].exists {
                alert.buttons[title].tap()
                return true
            }
            return false
        }
        app.launch()

        let nearby = app.buttons["home.nearby"]
        XCTAssertTrue(nearby.waitForExistence(timeout: 10))
        nearby.tap()
        let name = app.textFields["nearby.name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        if (name.value as? String ?? "").isEmpty || name.value as? String == "Name" {
            for _ in 0..<3 where !app.keyboards.firstMatch.exists {
                name.tap()
                _ = app.keyboards.firstMatch.waitForExistence(timeout: 3)
            }
            app.typeText("Eric\n")
        }
        // A table left open by an earlier run comes back as Continue.
        let resume = app.buttons["nearby.continue"]
        if resume.waitForExistence(timeout: 2) { resume.tap() } else { app.buttons["nearby.host"].tap() }
        app.tap()
        let addBot = app.buttons["nearby.addBot"]
        XCTAssertTrue(addBot.waitForExistence(timeout: 15))

        let seats = app.descendants(matching: .any).matching(identifier: "nearby.seat")
        while seats.count < 3 {
            addBot.tap()
            let easy = app.buttons["Easy Bot"]
            XCTAssertTrue(easy.waitForExistence(timeout: 3))
            easy.tap()
        }
        XCTAssertTrue(seats.element(boundBy: 2).waitForExistence(timeout: 5))
        let host = seats.element(boundBy: 0).label
        let lastIndex = seats.count - 1
        let lastBot = seats.element(boundBy: lastIndex).label
        XCTAssertTrue(host.contains("Host"), host)
        XCTAssertNotEqual(lastBot, host)

        let screenshotBefore = XCTAttachment(screenshot: app.screenshot())
        screenshotBefore.name = "before"
        screenshotBefore.lifetime = .keepAlways
        add(screenshotBefore)

        // Drop it on the middle of the first row: it lands in that row's place.
        let from = seats.element(boundBy: lastIndex).coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.5))
        let to = seats.element(boundBy: 0).coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.5))
        from.press(forDuration: 1.0, thenDragTo: to, withVelocity: .slow, thenHoldForDuration: 1.0)

        let moved = NSPredicate { _, _ in seats.element(boundBy: 0).label == lastBot }
        expectation(for: moved, evaluatedWith: nil)
        waitForExpectations(timeout: 5)
        XCTAssertEqual(seats.element(boundBy: 1).label, host)

        let screenshotAfter = XCTAttachment(screenshot: app.screenshot())
        screenshotAfter.name = "after"
        screenshotAfter.lifetime = .keepAlways
        add(screenshotAfter)
    }
}
