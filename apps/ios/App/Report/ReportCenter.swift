import DealEngine
import DealStats
import SwiftUI
import UIKit

/// The last few hundred things the app did, sent along with a problem report.
@MainActor
enum DevLog {
    private static var lines: [String] = []
    private static let limit = 400
    private static let stamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withTime, .withColonSeparatorInTime, .withFractionalSeconds]
        return formatter
    }()

    static func add(_ line: String) {
        lines.append("\(stamp.string(from: Date())) \(line)")
        if lines.count > limit { lines.removeFirst(lines.count - limit) }
    }

    static var recent: [String] { lines }
}

/// What the inbox says about Eric's reports, the latest build and the latest install.
struct ReportInboxStatus: Decodable, Equatable {
    struct Report: Decodable, Equatable {
        var state: String
        var summary: String?
        var question: String?
        var commit: String?
    }
    struct Build: Decodable, Equatable {
        var commit: String
        var at: String
        var reports: [String]
    }
    struct Install: Decodable, Equatable {
        var state: String
        var commit: String?
        var request: String?
        var message: String?
    }
    var reports: [String: Report]
    var build: Build?
    var install: Install?
    var lastInstallRequest: String?
}

/// A report this phone sent, kept so the list can show the note next to its status.
struct SentReport: Codable, Identifiable, Hashable {
    var id: String
    var note: String
    var sentAt: Date
}

/// Problem reports: capturing, sending, and following each one until it's fixed and installed.
@MainActor
@Observable
final class ReportCenter {
    static let shared = ReportCenter()

    private let defaults = UserDefaults.standard
    private(set) var status: ReportInboxStatus?
    private(set) var sent: [SentReport] = []
    var lastError: String?
    /// The commit Eric dismissed the "new build" banner for.
    var dismissedBuild: String? {
        didSet { defaults.set(dismissedBuild, forKey: "report.dismissedBuild") }
    }
    /// Set when this phone asked for an install, until the inbox shows it finished.
    private(set) var pendingInstall: String?
    weak var app: AppModel?

    /// Shows the bug button. On by default only in builds the report watcher made for Eric.
    var enabled: Bool {
        didSet {
            defaults.set(enabled, forKey: "report.enabled")
            ReportOverlay.shared.refreshVisibility()
        }
    }
    /// A key typed in Settings, for builds made without one.
    var typedKey: String {
        didSet { defaults.set(typedKey, forKey: "report.key") }
    }

    let buildCommit: String
    private let builtInKey: String
    private let apiBase: URL

    private init() {
        let info = Bundle.main.infoDictionary ?? [:]
        func plist(_ key: String) -> String { (info[key] as? String)?.trimmingCharacters(in: .whitespaces) ?? "" }
        buildCommit = plist("DealBuildCommit").isEmpty ? "dev" : plist("DealBuildCommit")
        builtInKey = plist("DealReportKey")
        apiBase = URL(string: plist("DealReportAPI")) ?? URL(string: "https://monopoly-deal-smoky.vercel.app/api/feedback")!
        typedKey = defaults.string(forKey: "report.key") ?? ""
        enabled = defaults.object(forKey: "report.enabled") == nil ? !builtInKey.isEmpty : defaults.bool(forKey: "report.enabled")
        dismissedBuild = defaults.string(forKey: "report.dismissedBuild")
        pendingInstall = defaults.string(forKey: "report.pendingInstall")
        if let data = defaults.data(forKey: "report.sent"), let list = try? JSONDecoder().decode([SentReport].self, from: data) { sent = list }
    }

    var key: String { typedKey.isEmpty ? builtInKey : typedKey }
    var hasBuiltInKey: Bool { !builtInKey.isEmpty }
    var isActive: Bool { enabled && !key.isEmpty }

    /// A newer build than this one has fixes waiting.
    var buildReady: ReportInboxStatus.Build? {
        guard let build = status?.build, build.commit != buildCommit else { return nil }
        return build
    }

    var needsAnswer: Bool { sent.contains { status?.reports[$0.id]?.state == "needs_you" } }

    // MARK: Requests

    private func request(_ method: String, _ path: String, body: [String: Any]? = nil) async throws -> Data {
        var request = URLRequest(url: apiBase.appendingPathComponent(path))
        request.httpMethod = method
        request.timeoutInterval = 30
        request.setValue(key, forHTTPHeaderField: "X-Report-Key")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            let reason = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw ReportError.server(code, reason ?? "unknown")
        }
        return data
    }

    enum ReportError: LocalizedError {
        case server(Int, String)
        var errorDescription: String? {
            switch self {
            case .server(401, _): "The report key isn't right. Check it in Settings."
            case .server(503, _): "The report inbox isn't set up on the server yet."
            case let .server(code, reason): "The inbox said \(code) (\(reason))."
            }
        }
    }

    func refresh() async {
        guard isActive else { return }
        do {
            let data = try await request("GET", "status")
            let next = try JSONDecoder().decode(ReportInboxStatus.self, from: data)
            if next != status {
                status = next
                ReportOverlay.shared.refreshVisibility()
            }
            if let pending = pendingInstall, let install = next.install, install.request == pending, install.state == "installed" || install.state == "failed" {
                setPendingInstall(nil)
            }
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// Sends a report. Returns true once the inbox has it.
    func send(note: String, screenshot: UIImage?) async -> Bool {
        var body: [String: Any] = [
            "note": note,
            "platform": "ios",
            "meta": meta(),
            "logs": DevLog.recent,
        ]
        if let game = app.flatMap(Self.gameSnapshot) { body["game"] = game }
        if let jpeg = screenshot.flatMap(Self.jpeg) { body["screenshot"] = jpeg.base64EncodedString() }
        do {
            let data = try await request("POST", "report", body: body)
            guard let id = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["id"] as? String else { return false }
            sent.insert(SentReport(id: id, note: note, sentAt: Date()), at: 0)
            sent = Array(sent.prefix(50))
            saveSent()
            DevLog.add("report sent \(id)")
            lastError = nil
            await refresh()
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    func reply(to id: String, text: String) async -> Bool {
        do {
            _ = try await request("POST", "reply", body: ["id": id, "text": text])
            await refresh()
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    /// Saves the game, then asks the Mac to install the newest build.
    func requestInstall() async {
        app?.prepareForInstall()
        do {
            let data = try await request("POST", "install", body: ["commit": buildReady?.commit ?? "", "platform": "ios"])
            let name = (try JSONSerialization.jsonObject(with: data) as? [String: Any])?["request"] as? String
            setPendingInstall(name)
            ReportOverlay.shared.refreshVisibility()
            DevLog.add("install requested \(name ?? "?")")
            await refresh()
        } catch {
            lastError = error.localizedDescription
        }
    }

    /// The install this phone asked for, as the inbox reports it.
    var installProgress: ReportInboxStatus.Install? {
        guard let pending = pendingInstall else { return nil }
        guard let install = status?.install, install.request == pending else {
            return ReportInboxStatus.Install(state: "requested", commit: nil, request: pending, message: nil)
        }
        return install
    }

    private func setPendingInstall(_ value: String?) {
        pendingInstall = value
        defaults.set(value, forKey: "report.pendingInstall")
    }

    private func saveSent() {
        if let data = try? JSONEncoder().encode(sent) { defaults.set(data, forKey: "report.sent") }
    }

    // MARK: Capture

    private func meta() -> [String: Any] {
        let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first?.windows.first
        let size = window?.bounds.size ?? .zero
        var meta: [String: Any] = [
            "commit": buildCommit,
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "device": Self.deviceModel,
            "system": "iOS \(UIDevice.current.systemVersion)",
            "screen": "\(Int(size.width))x\(Int(size.height))",
            "orientation": size.width > size.height ? "landscape" : "portrait",
        ]
        if let app {
            meta["screenName"] = app.currentScreenName
            meta["tableStyle"] = app.preferences.tableStyle.rawValue
            meta["landscapeTablePreference"] = app.preferences.landscapeTable
            meta["reducedEffects"] = app.preferences.reducedEffects
        }
        return meta
    }

    private static var deviceModel: String {
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: &info.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }

    /// The game on screen, in the same JSON the web app and the replay tools read.
    static func gameSnapshot(_ app: AppModel) -> [String: Any]? {
        func json<T: Encodable>(_ value: T) -> Any? {
            (try? JSONEncoder().encode(value)).flatMap { try? JSONSerialization.jsonObject(with: $0) }
        }
        var snapshot: [String: Any] = [:]
        if let match = app.localMatch {
            snapshot["kind"] = "local"
            snapshot["mode"] = match.mode.rawValue
            snapshot["state"] = match.game.flatMap(json)
            snapshot["log"] = match.log.flatMap(json)
        } else if let match = app.onlineMatch {
            snapshot["kind"] = "online"
            snapshot["state"] = match.game.flatMap(json)
            snapshot["viewerId"] = match.viewerId
        } else if let match = app.nearbyHost {
            snapshot["kind"] = "nearby_host"
            snapshot["state"] = match.game.flatMap(json)
        } else if let match = app.nearbyGuest {
            snapshot["kind"] = "nearby_guest"
            snapshot["state"] = match.game.flatMap(json)
        } else {
            return nil
        }
        return snapshot
    }

    private static func jpeg(_ image: UIImage) -> Data? {
        // Phone-sized screenshots at 2x and 60% quality stay well under the inbox's limit.
        image.jpegData(compressionQuality: 0.6)
    }

    /// Draws every app window except the report overlay, so sheets and covers are included.
    static func captureScreen(excluding overlay: UIWindow?) -> UIImage? {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive })
            ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return nil }
        let windows = scene.windows.filter { $0 !== overlay && !$0.isHidden }.sorted { $0.windowLevel < $1.windowLevel }
        guard let bounds = windows.first?.bounds else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = min(2, scene.traitCollection.displayScale)
        return UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
            for window in windows { window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        }
    }
}
