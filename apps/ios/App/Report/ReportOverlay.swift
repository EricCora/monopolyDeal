import SwiftUI
import UIKit

/// The bug button and the "new build" banner, each in its own small window above the app.
/// Small on purpose: a full-screen window over the app takes part in deciding which way the
/// app turns, and stopped the table turning sideways.
@MainActor
final class ReportOverlay {
    static let shared = ReportOverlay()
    private weak var scene: UIWindowScene?
    private var buttonWindow: UIWindow?
    private var bannerWindow: UIWindow?
    private let buttonController = ReportButtonController()
    private let bannerController = ReportBannerController()
    private var geometryObservation: NSKeyValueObservation?
    private var pollTask: Task<Void, Never>?
    private static let buttonSize: CGFloat = 38

    func install(in scene: UIWindowScene) {
        guard buttonWindow == nil else { return }
        self.scene = scene
        buttonWindow = makeWindow(scene, root: buttonController)
        bannerWindow = makeWindow(scene, root: bannerController)
        geometryObservation = scene.observe(\.effectiveGeometry, options: [.new]) { _, _ in
            Task { @MainActor in ReportOverlay.shared.update() }
        }
        update()
        startPolling()
    }

    private func makeWindow(_ scene: UIWindowScene, root: UIViewController) -> UIWindow {
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .normal + 10
        window.rootViewController = root
        window.backgroundColor = .clear
        window.isHidden = true
        return window
    }

    var overlayWindows: [UIWindow] { [buttonWindow, bannerWindow].compactMap { $0 } }

    /// The app's own window and the screen showing on top of it.
    private var appWindow: UIWindow? {
        scene?.windows.first { window in !overlayWindows.contains { $0 === window } }
    }

    private var topController: UIViewController? {
        var controller = appWindow?.rootViewController
        while let presented = controller?.presentedViewController, !presented.isBeingDismissed { controller = presented }
        return controller
    }

    func refreshVisibility() {
        update()
    }

    /// Places both windows for the current screen size and shows or hides them.
    func update() {
        guard let appWindow, let buttonWindow, let bannerWindow else { return }
        let center = ReportCenter.shared
        let area = appWindow.bounds.inset(by: appWindow.safeAreaInsets).insetBy(dx: 4, dy: 4)

        buttonController.showsDot = center.needsAnswer
        buttonWindow.isHidden = !center.enabled || area.width < 60
        if !buttonWindow.isHidden, !buttonController.isDragging {
            buttonWindow.frame = buttonFrame(in: area, landscape: appWindow.bounds.width > appWindow.bounds.height)
        }

        let text = bannerText(center)
        bannerController.text = text
        bannerWindow.isHidden = text == nil
        if text != nil {
            let size = bannerController.fittingSize(maxWidth: area.width - 24)
            bannerWindow.frame = CGRect(x: appWindow.bounds.midX - size.width / 2, y: appWindow.safeAreaInsets.top + 6, width: size.width, height: size.height)
        }
    }

    private func bannerText(_ center: ReportCenter) -> String? {
        if let progress = center.installProgress {
            return switch progress.state {
            case "installing": "Installing the new build..."
            case "waiting": "Waiting for your phone near the Mac"
            case "failed": "Install failed. Tap for details"
            default: "Install requested..."
            }
        }
        if let build = center.buildReady, center.isActive, build.commit != center.dismissedBuild {
            let count = build.reports.count
            return count > 0 ? "New build ready (\(count) fix\(count == 1 ? "" : "es")). Install" : "New build ready. Install"
        }
        return nil
    }

    // MARK: Button position

    private func positionKey(landscape: Bool) -> String {
        landscape ? "report.buttonPosition.landscape" : "report.buttonPosition.portrait"
    }

    private func buttonFrame(in area: CGRect, landscape: Bool) -> CGRect {
        // Defaults: the left edge of the upright table; on the sideways table, the right edge between
        // the turn card and the Draw button, clear of the draw pile and the hand.
        let saved = UserDefaults.standard.array(forKey: positionKey(landscape: landscape)) as? [Double]
        let fx = saved?.first ?? (landscape ? 1 : 0)
        let fy = saved?.last ?? (landscape ? 0.3 : 0.42)
        let size = Self.buttonSize
        return CGRect(
            x: area.minX + CGFloat(fx) * (area.width - size),
            y: area.minY + CGFloat(fy) * (area.height - size),
            width: size, height: size
        )
    }

    func moveButton(by translation: CGPoint, from start: CGRect) {
        guard let appWindow, let buttonWindow else { return }
        let area = appWindow.bounds.inset(by: appWindow.safeAreaInsets).insetBy(dx: 4, dy: 4)
        buttonWindow.frame.origin = CGPoint(
            x: min(max(start.minX + translation.x, area.minX), area.maxX - Self.buttonSize),
            y: min(max(start.minY + translation.y, area.minY), area.maxY - Self.buttonSize)
        )
    }

    /// Snaps to the nearer side, out of the way of the cards, and remembers the spot.
    func finishMove() {
        guard let appWindow, let buttonWindow else { return }
        let area = appWindow.bounds.inset(by: appWindow.safeAreaInsets).insetBy(dx: 4, dy: 4)
        let fx: Double = buttonWindow.frame.midX < area.midX ? 0 : 1
        let fy = Double((buttonWindow.frame.minY - area.minY) / max(1, area.height - Self.buttonSize))
        UserDefaults.standard.set([fx, min(max(fy, 0), 1)], forKey: positionKey(landscape: appWindow.bounds.width > appWindow.bounds.height))
        UIView.animate(withDuration: 0.2) { self.update() }
    }

    var currentButtonFrame: CGRect { buttonWindow?.frame ?? .zero }

    // MARK: Sheets

    func openReport() {
        guard let top = topController, !(top is ReportSheetHost) else { return }
        // Taken before anything of the report appears, so it shows what Eric was looking at.
        let screenshot = ReportCenter.captureScreen(excluding: overlayWindows)
        DevLog.add("report opened")
        top.present(ReportSheetHost(rootView: AnyView(ReportSheet(screenshot: screenshot))), animated: true)
    }

    func openInstall() {
        guard let top = topController, !(top is ReportSheetHost) else { return }
        top.present(ReportSheetHost(rootView: AnyView(InstallSheet())), animated: true)
    }

    /// Checks the inbox every minute, or every 10 seconds while an install is under way.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { @MainActor in
            while !Task.isCancelled {
                let center = ReportCenter.shared
                if center.isActive, UIApplication.shared.applicationState == .active {
                    await center.refresh()
                }
                ReportOverlay.shared.update()
                let seconds: UInt64 = center.installProgress != nil ? 10 : 60
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            }
        }
    }
}

/// The report and install sheets, presented over whatever the app is showing.
final class ReportSheetHost: UIHostingController<AnyView>, UIAdaptivePresentationControllerDelegate {
    override init(rootView: AnyView) {
        super.init(rootView: AnyView(rootView.preferredColorScheme(.dark)))
        modalPresentationStyle = .pageSheet
        sheetPresentationController?.detents = [.large()]
        presentationController?.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        ReportOverlay.shared.update()
    }
}

@MainActor
final class ReportButtonController: UIViewController {
    private let button = UIButton(type: .custom)
    private let dot = UIView()
    private var dragStart: CGRect = .zero
    private(set) var isDragging = false

    var showsDot = false {
        didSet { dot.isHidden = !showsDot }
    }

    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        var config = UIButton.Configuration.filled()
        config.image = UIImage(systemName: "ladybug.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
        config.baseBackgroundColor = UIColor.black.withAlphaComponent(0.55)
        config.baseForegroundColor = UIColor.white.withAlphaComponent(0.9)
        config.cornerStyle = .capsule
        button.configuration = config
        button.alpha = 0.7
        button.accessibilityLabel = "Report a problem"
        button.accessibilityIdentifier = "report.button"
        button.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        button.frame = view.bounds
        button.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        button.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(drag(_:))))
        view.addSubview(button)
        dot.backgroundColor = .systemRed
        dot.layer.cornerRadius = 5
        dot.frame = CGRect(x: 28, y: 0, width: 10, height: 10)
        dot.isUserInteractionEnabled = false
        dot.isHidden = true
        view.addSubview(dot)
    }

    @objc private func tapped() {
        ReportOverlay.shared.openReport()
    }

    @objc private func drag(_ gesture: UIPanGestureRecognizer) {
        switch gesture.state {
        case .began:
            isDragging = true
            dragStart = ReportOverlay.shared.currentButtonFrame
        case .changed:
            // In screen points, because the window itself moves under the finger.
            ReportOverlay.shared.moveButton(by: gesture.translation(in: nil), from: dragStart)
        case .ended, .cancelled, .failed:
            isDragging = false
            ReportOverlay.shared.finishMove()
        default:
            break
        }
    }
}

@MainActor
final class ReportBannerController: UIViewController {
    private let banner = UIButton(type: .system)

    var text: String? {
        didSet {
            guard let text else { return }
            loadViewIfNeeded()
            var attributed = AttributedString(text)
            attributed.font = .systemFont(ofSize: 13, weight: .semibold)
            banner.configuration?.attributedTitle = attributed
        }
    }

    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        var config = UIButton.Configuration.filled()
        config.cornerStyle = .capsule
        config.baseBackgroundColor = UIColor(red: 0.93, green: 0.75, blue: 0.27, alpha: 0.96)
        config.baseForegroundColor = .black
        config.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 14, bottom: 7, trailing: 14)
        banner.configuration = config
        banner.accessibilityIdentifier = "report.buildBanner"
        banner.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        banner.frame = view.bounds
        banner.addTarget(self, action: #selector(tapped), for: .touchUpInside)
        view.addSubview(banner)
    }

    func fittingSize(maxWidth: CGFloat) -> CGSize {
        loadViewIfNeeded()
        let size = banner.sizeThatFits(CGSize(width: maxWidth, height: 44))
        return CGSize(width: min(size.width, maxWidth), height: size.height)
    }

    @objc private func tapped() {
        ReportOverlay.shared.openInstall()
    }
}

// MARK: Sheets

struct ReportSheet: View {
    let screenshot: UIImage?
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var sending = false
    @State private var includeScreenshot = true
    @State private var replies: [String: String] = [:]
    @FocusState private var noteFocused: Bool
    private var center: ReportCenter { ReportCenter.shared }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("What's wrong, or what should change?", text: $note, axis: .vertical)
                        .lineLimit(3...10)
                        .focused($noteFocused)
                        .accessibilityIdentifier("report.note")
                    if let screenshot {
                        Toggle(isOn: $includeScreenshot) {
                            HStack(spacing: 12) {
                                Image(uiImage: screenshot).resizable().scaledToFit().frame(maxHeight: 90)
                                    .clipShape(RoundedRectangle(cornerRadius: 6))
                                Text("Include screenshot").font(.subheadline)
                            }
                        }
                    }
                } footer: {
                    Text("Sends the screenshot, the game on screen and recent app logs. Claude fixes it, ships it, and tells you here when a new build is ready.")
                }
                if !center.isActive {
                    Section { Text("Add the report key in Settings first.").foregroundStyle(.orange) }
                }
                if let error = center.lastError {
                    Section { Text(error).foregroundStyle(.red).font(.footnote) }
                }
                if !center.sent.isEmpty {
                    Section("Your Reports") {
                        ForEach(center.sent.prefix(15)) { report in reportRow(report) }
                    }
                }
            }
            .navigationTitle("Report a Problem")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(sending ? "Sending..." : "Send") {
                        sending = true
                        Task {
                            let ok = await center.send(note: note.trimmingCharacters(in: .whitespacesAndNewlines), screenshot: includeScreenshot ? screenshot : nil)
                            sending = false
                            if ok { note = "" }
                        }
                    }
                    .disabled(sending || !center.isActive || note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .accessibilityIdentifier("report.send")
                }
            }
            .task { noteFocused = true; await center.refresh() }
        }
    }

    @ViewBuilder
    private func reportRow(_ report: SentReport) -> some View {
        let status = center.status?.reports[report.id]
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(report.note).font(.subheadline).lineLimit(2)
                Spacer()
                stateChip(status?.state ?? "sending")
            }
            if let summary = status?.summary, !summary.isEmpty {
                Text(summary).font(.caption).foregroundStyle(.secondary)
            }
            if status?.state == "needs_you", let question = status?.question {
                Text(question).font(.footnote.weight(.semibold)).foregroundStyle(.yellow)
                HStack {
                    TextField("Your answer", text: Binding(get: { replies[report.id] ?? "" }, set: { replies[report.id] = $0 }), axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                    Button("Send") {
                        let text = replies[report.id, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
                        Task { if await center.reply(to: report.id, text: text) { replies[report.id] = "" } }
                    }
                    .disabled(replies[report.id, default: ""].trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .padding(.vertical, 2)
    }

    private func stateChip(_ state: String) -> some View {
        let (label, color): (String, Color) = switch state {
        case "received": ("Received", .gray)
        case "fixing": ("Fixing", .blue)
        case "needs_you": ("Needs you", .yellow)
        case "fixed": ("Fixed", .green)
        case "failed": ("Failed", .red)
        default: ("Sent", .gray)
        }
        return Text(label).font(.caption2.weight(.bold)).padding(.horizontal, 7).padding(.vertical, 3)
            .background(color.opacity(0.25), in: Capsule()).foregroundStyle(color)
    }
}

struct InstallSheet: View {
    @Environment(\.dismiss) private var dismiss
    private var center: ReportCenter { ReportCenter.shared }

    var body: some View {
        NavigationStack {
            Form {
                if let progress = center.installProgress {
                    Section("Install") {
                        Text(progressText(progress))
                        if let message = progress.message { Text(message).font(.footnote).foregroundStyle(.secondary) }
                        if progress.state == "failed" || progress.state == "waiting" {
                            Button("Try Again") { Task { await center.requestInstall() } }
                        }
                    }
                } else if let build = center.buildReady {
                    Section {
                        Button("Install Now") { Task { await center.requestInstall() } }
                            .accessibilityIdentifier("report.install")
                        Button("Later") {
                            center.dismissedBuild = build.commit
                            dismiss()
                        }
                    } footer: {
                        Text("Your game is saved first. The app closes, the Mac installs the new build, and it reopens where you were. Your phone needs to be on the same Wi-Fi as the Mac.")
                    }
                    let fixed = center.sent.filter { build.reports.contains($0.id) }
                    if !fixed.isEmpty {
                        Section("In This Build") {
                            ForEach(fixed) { report in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(report.note).font(.subheadline).lineLimit(2)
                                    if let summary = center.status?.reports[report.id]?.summary {
                                        Text(summary).font(.caption).foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                } else {
                    Text("You're on the newest build.")
                }
            }
            .navigationTitle("New Build")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
        }
    }

    private func progressText(_ install: ReportInboxStatus.Install) -> String {
        switch install.state {
        case "installing": "The Mac is building and installing it now. The app will close and reopen."
        case "waiting": "Waiting for your phone to be near the Mac."
        case "failed": "The install didn't work."
        case "installed": "Installed."
        default: "Asked the Mac to install it."
        }
    }
}

/// The developer switch for the bug button, in Settings.
struct ReportSettingsSection: View {
    @State private var center = ReportCenter.shared

    var body: some View {
        @Bindable var center = center
        Section {
            Toggle("Report Button", isOn: $center.enabled)
                .accessibilityIdentifier("settings.reportButton")
            if center.enabled && !center.hasBuiltInKey {
                SecureField("Report key", text: $center.typedKey)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            LabeledContent("Build", value: String(center.buildCommit.prefix(8)))
        } header: {
            Text("Developer")
        } footer: {
            Text("Shows a small bug button on every screen. Drag it to either side. Reports go to Claude, which fixes them and offers a new build here.")
        }
    }
}
