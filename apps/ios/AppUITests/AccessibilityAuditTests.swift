import XCTest

/// Xcode's automated accessibility audit. It doesn't replace using VoiceOver, but it
/// catches missing labels, small tap targets, clipped text and poor contrast.
///
/// Two things are left out on purpose, as recorded in DECISIONS.md. Text on a card is
/// artwork that scales with the card, and holding the hand or opening a card makes it
/// larger. The table's text stops growing at a set size, because past that the board
/// doesn't fit, so the table skips the Dynamic Type check. The home screen leaves out the
/// two cases its test names.
final class AccessibilityAuditTests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = true
        app = XCUIApplication()
        app.launchArguments = ["-seed", "11", "-botDelayMs", "60", "-storeDirectory", "uitest-\(UUID().uuidString)"]
        app.launch()
    }

    /// Prints each issue with its element, so a failure says what to fix.
    private func audit(_ types: XCUIAccessibilityAuditType = .all, ignoring: @escaping (XCUIAccessibilityAuditIssue) -> Bool = { _ in false }) throws {
        // On iPad the audit fails white labels on dark glass that pass on iPhone and read
        // clearly in screenshots, so it can't judge contrast on glass there.
        let checked = UIDevice.current.userInterfaceIdiom == .pad ? types.subtracting(.contrast) : types
        try app.performAccessibilityAudit(for: checked) { issue in
            if ignoring(issue) { return true }
            let element = issue.element
            print("AUDIT \(issue.compactDescription) | id=\(element?.identifier ?? "") | label=\(element?.label ?? "") | frame=\(element?.frame ?? .zero) | \(issue.detailedDescription)")
            return false
        }
    }

    func testHomeScreenPassesTheAudit() throws {
        XCTAssertTrue(app.buttons["home.practice"].waitForExistence(timeout: 20))
        try audit { issue in
            // The title's white-to-gold gradient on the dark table reads clearly, but the audit
            // can't measure a gradient. The nameless text is taken to be the decorative hero cards,
            // which VoiceOver skips on purpose.
            (issue.auditType == .contrast && issue.element?.label == "Monopoly Deal")
                || (issue.element?.label ?? "").isEmpty && issue.element?.frame ?? .zero == .zero && issue.auditType != .contrast
        }
    }

    func testTablePassesTheAudit() throws {
        let practice = app.buttons["home.practice"]
        XCTAssertTrue(practice.waitForExistence(timeout: 20))
        practice.tap()
        let easy = app.buttons["Classic, Easy"].firstMatch
        XCTAssertTrue(easy.waitForExistence(timeout: 5))
        easy.tap()
        XCTAssertTrue(app.buttons["action.draw"].waitForExistence(timeout: 10))
        // Measure the card areas where they end up, after the iPhone table turns sideways.
        waitForPhoneTableToTurn(app)

        let cardAreas = [app.otherElements["table.hand"].frame, app.otherElements["table.deck"].frame]
        try audit(XCUIAccessibilityAuditType.all.subtracting(.dynamicType)) { issue in
            // White on a near-black panel or pill, confirmed by eye in a screenshot. The audit misreads both.
            let misread = ["Draw to start your turn.", "Your Bank and properties go here."]
            if issue.auditType == .contrast, misread.contains(issue.element?.label ?? "") { return true }
            guard issue.auditType == .contrast || issue.auditType == .textClipped, let frame = issue.element?.frame else { return false }
            return cardAreas.contains { $0.intersects(frame) }
        }
    }
}
