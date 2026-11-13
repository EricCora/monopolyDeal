import SwiftUI
import UIKit

/// A window above the app that holds the bug button and the "new build" banner. Touches
/// anywhere else fall through to the game.
@MainActor
final class ReportOverlay {
    static let shared = ReportOverlay()
    private var window: PassthroughWindow?
    private var controller: ReportOverlayController?
    private var pollTask: Task<Void, Never>?

    func install(in scene: UIWindowScene) {
        guard window == nil else { return }
        let controller = ReportOverlayController()
        let window = PassthroughWindow(windowScene: scene)
        window.windowLevel = .normal + 10
        window.rootViewController = controller
        window.backgroundColor = .clear
        window.isHidden = false
        self.window = window
        self.controller = controller
        startPolling()
    }

    var overlayWindow: UIWindow? { window }

    func refreshVisibility() {
        controller?.update()
    }

    /// Checks the inbox every minute, or every 10 seconds while an install is under way.
    private func startPolling() {
        pollTask?.cancel()
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                let center = ReportCenter.shared
                if center.isActive, UIApplication.shared.applicationState == .active {
                    await center.refresh()
                }
                self?.controller?.update()
                let seconds: UInt64 = center.installProgress != nil ? 10 : 60
                try? await Task.sleep(nanoseconds: seconds * 1_000_000_000)
            }
        }
    }
}

final class PassthroughWindow: UIWindow {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let root = rootViewController else { return nil }
        // While the report sheet is up, this window takes every touch.
        if root.presentedViewController != nil { return super.hitTest(point, with: event) }
        let hit = super.hitTest(point, with: event)
        return hit === root.view ? nil : hit
    }
}

@MainActor
final class ReportOverlayController: UIViewController {
    private let button = UIButton(type: .custom)
    private let dot = UIView()
    private let banner = UIButton(type: .system)
    private var dragStart: CGPoint = .zero
    private let positionKey = "report.buttonPosition"

    override func loadView() {
        view = UIView()
        view.backgroundColor = .clear
    }

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    override func viewDidLoad() {
        super.viewDidLoad()
        var config = UIButton.Configuration.filled()
        config.image = UIImage(systemName: "ladybug.fill", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
        config.baseBackgroundColor = UIColor.black.withAlphaComponent(0.55)
        config.baseForegroundColor = UIColor.white.withAlphaComponent(0.9)
        config.cornerStyle = .capsule
        button.configuration = config
        button.frame = CGRect(x: 0, y: 0, width: 38, height: 38)
        button.alpha = 0.7
        button.accessibilityLabel = "Report a problem"
        button.accessibilityIdentifier = "report.button"
        button.addTarget(self, action: #selector(openReport), for: .touchUpInside)
        button.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(drag(_:))))
        dot.backgroundColor = .systemRed
        dot.layer.cornerRadius = 5
        dot.frame = CGRect(x: 28, y: 0, width: 10, height: 10)
        dot.isUserInteractionEnabled = false
        button.addSubview(dot)
        view.addSubview(button)

        var bannerConfig = UIButton.Configuration.filled()
        bannerConfig.cornerStyle = .capsule
        bannerConfig.baseBackgroundColor = UIColor(red: 0.93, green: 0.75, blue: 0.27, alpha: 0.96)
        bannerConfig.baseForegroundColor = .black
        bannerConfig.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 14, bottom: 7, trailing: 14)
        banner.configuration = bannerConfig
        banner.accessibilityIdentifier = "report.buildBanner"
        banner.addTarget(self, action: #selector(bannerTapped), for: .touchUpInside)
        view.addSubview(banner)
        update()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        placeButton()
        layoutBanner()
    }

    func update() {
        let center = ReportCenter.shared
        button.isHidden = !center.enabled
        dot.isHidden = !center.needsAnswer
        let text: String?
        if let progress = center.installProgress {
            text = switch progress.state {
            case "installing": "Installing the new build..."
            case "waiting": "Waiting for your phone near the Mac"
            case "failed": "Install failed. Tap for details"
            default: "Install requested..."
            }
        } else if let build = center.buildReady, center.isActive, build.commit != center.dismissedBuild {
            let count = build.reports.count
            text = count > 0 ? "New build ready (\(count) fix\(count == 1 ? "" : "es")). Install" : "New build ready. Install"
        } else {
            text = nil
        }
        banner.isHidden = text == nil
        if let text {
            var attributed = AttributedString(text)
            attributed.font = .systemFont(ofSize: 13, weight: .semibold)
            banner.configuration?.attributedTitle = attributed
        }
        layoutBanner()
    }

    private func layoutBanner() {
        let size = banner.sizeThatFits(CGSize(width: view.bounds.width - 32, height: 40))
        let top = view.safeAreaInsets.top + 6
        banner.frame = CGRect(x: (view.bounds.width - size.width) / 2, y: top, width: size.width, height: size.height)
    }

    private func placeButton() {
        let bounds = view.bounds.inset(by: view.safeAreaInsets).insetBy(dx: 4, dy: 4)
        guard bounds.width > 40, bounds.height > 40 else { return }
        let saved = UserDefaults.standard.array(forKey: positionKey) as? [Double]
        let fx = saved?.first ?? 0
        let fy = saved?.last ?? 0.42
        button.center = CGPoint(
            x: bounds.minX + 19 + CGFloat(fx) * (bounds.width - 38),
            y: bounds.minY + 19 + CGFloat(fy) * (bounds.height - 38)
        )
    }

    @objc private func drag(_ gesture: UIPanGestureRecognizer) {
        let bounds = view.bounds.inset(by: view.safeAreaInsets).insetBy(dx: 4, dy: 4)
        switch gesture.state {
        case .began:
            dragStart = button.center
        case .changed:
            let move = gesture.translation(in: view)
            button.center = CGPoint(
                x: min(max(dragStart.x + move.x, bounds.minX + 19), bounds.maxX - 19),
                y: min(max(dragStart.y + move.y, bounds.minY + 19), bounds.maxY - 19)
            )
        case .ended, .cancelled:
            // Snap to the nearer side, out of the way of the cards.
            let fx: Double = button.center.x < bounds.midX ? 0 : 1
            let fy = Double((button.center.y - bounds.minY - 19) / max(1, bounds.height - 38))
            UserDefaults.standard.set([fx, min(max(fy, 0), 1)], forKey: positionKey)
            UIView.animate(withDuration: 0.2) { self.placeButton() }
        default:
            break
        }
    }

    @objc private func openReport() {
        guard presentedViewController == nil else { return }
        // Taken before anything of the report appears, so it shows what Eric was looking at.
        let screenshot = ReportCenter.captureScreen(excluding: view.window)
        DevLog.add("report opened")
        present(sheet(ReportSheet(screenshot: screenshot)), animated: true)
    }

    @objc private func bannerTapped() {
        guard presentedViewController == nil else { return }
        present(sheet(InstallSheet()), animated: true)
    }

    private func sheet<Content: View>(_ content: Content) -> UIViewController {
        let host = UIHostingController(rootView: content.preferredColorScheme(.dark))
        host.modalPresentationStyle = .pageSheet
        host.sheetPresentationController?.detents = [.large()]
        host.presentationController?.delegate = self
        return host
    }
}

extension ReportOverlayController: UIAdaptivePresentationControllerDelegate {
    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        update()
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
