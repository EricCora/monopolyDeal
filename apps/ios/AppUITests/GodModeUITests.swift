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

        holdTable(seconds: 5.5)
        app.buttons["action.draw"].tap()
        let picker = app.descendants(matching: .any)["deckPicker"]
        XCTAssertTrue(picker.waitForExistence(timeout: 5), "With god mode on, Draw shows the deck")
        let draw = app.buttons["deckPicker.draw"]
        XCTAssertFalse(draw.isEnabled)
        let cards = app.buttons.matching(identifier: "deckPicker.card")
        XCTAssertGreaterThan(cards.count, 10)
        // Grouped: actions, then money, then properties.
        let headers = app.descendants(matching: .any).matching(identifier: "deckPicker.section")
        XCTAssertGreaterThanOrEqual(headers.count, 1)
        XCTAssertTrue(headers.element(boundBy: 0).label.localizedCaseInsensitiveContains("Actions"), "Actions come first: \(headers.element(boundBy: 0).label)")
        let pass = cards.matching(NSPredicate(format: "label CONTAINS 'Pass Go'")).firstMatch
        XCTAssertTrue(pass.exists)
        pass.tap()
        // Properties come last, further down the sheet.
        let property = cards.matching(NSPredicate(format: "label CONTAINS 'property'")).firstMatch
        for _ in 0..<8 where !property.isHittable { app.swipeUp() }
        XCTAssertTrue(property.isHittable)
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
        holdTable(seconds: 5.5)
        XCTAssertFalse(picker.exists)
        shot("god-mode-off")
    }
}
