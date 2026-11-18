import XCTest

/// The hidden table hold: five seconds on the table turns god mode on, a draw then shows the
/// deck to choose from, and the same hold turns it off again.
final class GodModeUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-seed", "11", "-botDelayMs", "60", "-storeDirectory", "uitest-\(UUID().uuidString)"]
        app.launch()
        let practice = app.buttons["home.practice"]
        XCTAssertTrue(practice.waitForExistence(timeout: 20))
        practice.tap()
        let easy = app.buttons["Classic, Easy"].firstMatch
        XCTAssertTrue(easy.waitForExistence(timeout: 5))
        easy.tap()
        XCTAssertTrue(app.buttons["action.draw"].waitForExistence(timeout: 10))
        waitForPhoneTableToTurn(app)
    }

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// Open felt, clear of the hand, the buttons and the piles in the middle.
    private func holdTable(seconds: TimeInterval) {
        let spot = UIDevice.current.userInterfaceIdiom == .pad ? CGVector(dx: 0.09, dy: 0.45) : CGVector(dx: 0.5, dy: 0.42)
        app.windows.firstMatch.coordinate(withNormalizedOffset: spot).press(forDuration: seconds)
    }

    func testHoldingTheTableTogglesChoosingTheDraw() throws {
        // A shorter hold does nothing: the draw goes ahead as usual.
        holdTable(seconds: 2)
        XCTAssertFalse(app.descendants(matching: .any)["deckPicker"].exists)

        holdTable(seconds: 6.5)
        app.buttons["action.draw"].tap()
        let picker = app.descendants(matching: .any)["deckPicker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 5), "With god mode on, Draw shows the deck")
        let draw = app.buttons["deckPicker.draw"]
        XCTAssertFalse(draw.isEnabled)
        let cards = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'deckPicker.card.'"))
        // The list only builds the cards on screen, so check the whole deck through its count.
        let hint = app.staticTexts.matching(NSPredicate(format: "label CONTAINS ' in the deck.'")).firstMatch
        XCTAssertTrue(hint.exists)
        XCTAssertGreaterThan(Int(hint.label.components(separatedBy: " ").first ?? "") ?? 0, 80, hint.label)
        XCTAssertGreaterThan(cards.count, 0)
        // Grouped: actions, then money, then properties.
        let headers = app.descendants(matching: .any).matching(identifier: "deckPicker.section")
        XCTAssertGreaterThanOrEqual(headers.count, 1)
        XCTAssertTrue(headers.element(boundBy: 0).label.localizedCaseInsensitiveContains("Actions"), "Actions come first: \(headers.element(boundBy: 0).label)")
        let pass = cards.matching(NSPredicate(format: "label CONTAINS 'Pass Go'")).firstMatch
        XCTAssertTrue(pass.exists)
        pass.tap()
        // Properties come last: scroll the picker to the end and take one on screen.
        let list = app.scrollViews.containing(NSPredicate(format: "identifier BEGINSWITH 'deckPicker.card.'")).firstMatch
        let anyColor = app.staticTexts["Any color"]
        for _ in 0..<20 where !anyColor.isHittable { list.swipeUp(velocity: .fast) }
        shot("god-mode-picker-properties")
        let properties = cards.matching(NSPredicate(format: "label CONTAINS 'property'"))
        let onScreen = try XCTUnwrap((0..<properties.count).map { properties.element(boundBy: $0) }.first { $0.isHittable }, "Scrolling the picker reaches the properties")
        // A lazy list can reuse positions, so tap the card by its own identifier.
        let property = app.buttons[onScreen.identifier]
        let propertyName = property.label
        property.tap()
        shot("god-mode-picker")
        XCTAssertTrue(draw.isEnabled)
        draw.tap()
        XCTAssertTrue(app.buttons["action.pass"].waitForExistence(timeout: 5))
        XCTAssertFalse(picker.exists)
        let hand = app.descendants(matching: .any).matching(NSPredicate(format: "identifier MATCHES 'hand\\\\.[0-9]+'"))
        let labels = (0..<hand.count).map { hand.element(boundBy: $0).label }
        XCTAssertTrue(labels.contains { $0.contains("Pass Go") }, "Drew the chosen Pass Go: \(labels)")
        XCTAssertTrue(labels.contains { $0.contains(propertyName) }, "Drew the chosen \(propertyName): \(labels)")

        // Holding again turns it off, and nothing else on the table changed.
        holdTable(seconds: 6.5)
        XCTAssertFalse(picker.exists)
        shot("god-mode-off")
    }
}
