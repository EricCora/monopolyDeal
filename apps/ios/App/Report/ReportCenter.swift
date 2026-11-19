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
        /// While fixing: how far it has got, and the session's latest action.
        var phase: String?
        var step: String?
        var stepAt: String?
    }
    /// One master commit, newest first, as the watcher publishes it.
    struct LogEntry: Decodable, Equatable {
        var commit: String
        var at: String
        var subject: String
        var app: Bool
        var report: String?
    }
    struct Build: Decodable, Equatable {
        var commit: String
        var at: String
        var committedAt: String?
        var reports: [String]
        var log: [LogEntry]?
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

/// Which build is newer, what it brings, and how far a fix has got. The same rules as
/// src/ui/report/buildNotes.ts, which has the tests for them.
enum BuildNotes {
    struct Notes: Codable, Equatable {
        struct Fix: Codable, Equatable, Hashable {
            var id: String
            var note: String
            var summary: String
        }
        var fixes: [Fix]
        var changes: [String]
        var more: Int
    }

    static let maxChanges = 15

    static func sameCommit(_ a: String?, _ b: String?) -> Bool {
        guard let a, let b, a != "dev", b != "dev" else { return false }
        let (short, long) = a.count <= b.count ? (a, b) : (b, a)
        return short.count >= 7 && long.hasPrefix(short)
    }

    static func date(_ iso: String?) -> Date? {
        guard let iso else { return nil }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: iso) { return date }
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: iso)
    }

    /// Position in the published log decides first (builds made by hand carry no date), then
    /// commit dates. When neither can tell, the build is offered, as it always was.
    static func isNewer(_ build: ReportInboxStatus.Build?, than ownCommit: String, ownDate: String?) -> Bool {
        guard let build, !sameCommit(build.commit, ownCommit) else { return false }
        let log = build.log ?? []
        if let mine = log.firstIndex(where: { sameCommit($0.commit, ownCommit) }),
           let theirs = log.firstIndex(where: { sameCommit($0.commit, build.commit) }) {
            return theirs < mine
        }
        if let own = date(ownDate), let theirs = date(build.committedAt) { return theirs > own }
        return true
    }

    /// Report ids fixed, and other app changes, in the build but not in the running one.
    static func notes(_ build: ReportInboxStatus.Build?, ownCommit: String, ownDate: String?) -> (fixes: [String], changes: [String], more: Int) {
        let log = build?.log ?? []
        let newer: [ReportInboxStatus.LogEntry]
        if let mine = log.firstIndex(where: { sameCommit($0.commit, ownCommit) }) {
            newer = Array(log.prefix(mine))
        } else if let own = date(ownDate) {
            newer = log.filter { (date($0.at) ?? .distantPast) > own }
        } else {
            newer = log
        }
        var fixes: [String] = []
        for id in newer.compactMap(\.report) where !fixes.contains(id) { fixes.append(id) }
        let changes = newer.filter { $0.app && $0.report == nil }.map(\.subject)
        return (fixes, Array(changes.prefix(maxChanges)), max(0, changes.count - maxChanges))
    }

    static let phaseLabels = [
        "starting": "Starting", "working": "Working on it", "checks": "Running checks",
        "ios_checks": "Running iOS checks", "merging": "Merging",
    ]

    /// "Running checks · Editing HomeView.swift · 30s ago", or nil when the report isn't being fixed.
    static func progressLine(_ report: ReportInboxStatus.Report?, now: Date = Date()) -> String? {
        guard let report, report.state == "fixing", let phase = report.phase else { return nil }
        var parts = [phaseLabels[phase] ?? phase]
        if let step = report.step {
            parts.append(step)
            if let at = date(report.stepAt) {
                let seconds = max(0, now.timeIntervalSince(at))
                parts.append(seconds < 60 ? "\(Int(seconds.rounded()))s ago" : seconds < 3600 ? "\(Int(seconds / 60))m ago" : "\(Int(seconds / 3600))h ago")
            }
        }
        return parts.joined(separator: " · ")
    }
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

    private(set) var buildCommit: String
    /// When this build's commit was made: stamped by the watcher, or found in the inbox's log.
    private let stampedDate: String
    private let builtInKey: String
    private let apiBase: URL

    private init() {
        let info = Bundle.main.infoDictionary ?? [:]
        func plist(_ key: String) -> String { (info[key] as? String)?.trimmingCharacters(in: .whitespaces) ?? "" }
        buildCommit = plist("DealBuildCommit").isEmpty ? "dev" : plist("DealBuildCommit")
        stampedDate = plist("DealBuildDate")
        builtInKey = plist("DealReportKey")
        apiBase = URL(string: plist("DealReportAPI")) ?? URL(string: "https://monopoly-deal-smoky.vercel.app/api/feedback")!
        typedKey = defaults.string(forKey: "report.key") ?? ""
        enabled = defaults.object(forKey: "report.enabled") == nil ? !builtInKey.isEmpty : defaults.bool(forKey: "report.enabled")
        dismissedBuild = defaults.string(forKey: "report.dismissedBuild")
        pendingInstall = defaults.string(forKey: "report.pendingInstall")
        if let data = defaults.data(forKey: "report.sent"), let list = try? JSONDecoder().decode([SentReport].self, from: data) { sent = list }
        #if DEBUG
        // UI tests hand in a running commit, sent reports and an inbox status, as base64 JSON.
        func testJSON(_ key: String) -> Data? { defaults.string(forKey: key).flatMap { Data(base64Encoded: $0) } }
        if let commit = defaults.string(forKey: "report.testBuildCommit") { buildCommit = commit }
        if let data = testJSON("report.testSent"), let list = try? JSONDecoder().decode([TestSent].self, from: data) {
            sent = list.map { SentReport(id: $0.id, note: $0.note, sentAt: Date()) }
        }
        testStatus = testJSON("report.testStatus").flatMap { try? JSONDecoder().decode(ReportInboxStatus.self, from: $0) }
        status = testStatus
        #endif
    }

    #if DEBUG
    private struct TestSent: Decodable { var id: String; var note: String }
    private var testStatus: ReportInboxStatus?
    #endif

    var ownBuildDate: String? {
        if !stampedDate.isEmpty { return stampedDate }
        return status?.build?.log?.first { BuildNotes.sameCommit($0.commit, buildCommit) }?.at
    }

    /// What the offered build brings, with each fix shown by the note Eric wrote.
    var whatsNew: BuildNotes.Notes {
        guard let build = buildReady else { return BuildNotes.Notes(fixes: [], changes: [], more: 0) }
        var notes = BuildNotes.notes(build, ownCommit: buildCommit, ownDate: ownBuildDate)
        // An inbox written before build logs existed lists only the fixed reports.
        if build.log == nil { notes.fixes = build.reports }
        let fixes = notes.fixes.map { id in
            BuildNotes.Notes.Fix(id: id, note: sent.first { $0.id == id }?.note ?? "A report", summary: status?.reports[id]?.summary ?? "")
        }
        return BuildNotes.Notes(fixes: fixes, changes: notes.changes, more: notes.more)
    }

    /// The notes kept when Install was tapped, once a different build is running.
    var lastInstallNotes: BuildNotes.Notes? {
        guard let from = defaults.string(forKey: "report.lastNotesFrom"), from != buildCommit,
              let data = defaults.data(forKey: "report.lastNotes") else { return nil }
        return try? JSONDecoder().decode(BuildNotes.Notes.self, from: data)
    }

    /// True while one of this phone's reports is being fixed, so the app checks more often.
    var isFixing: Bool { sent.contains { status?.reports[$0.id]?.state == "fixing" } }

    var key: String { typedKey.isEmpty ? builtInKey : typedKey }
    var hasBuiltInKey: Bool { !builtInKey.isEmpty }
    var isActive: Bool { enabled && !key.isEmpty }

    /// A newer build than this one has fixes waiting.
    var buildReady: ReportInboxStatus.Build? {
        guard let build = status?.build, BuildNotes.isNewer(build, than: buildCommit, ownDate: ownBuildDate) else { return nil }
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
        #if DEBUG
        if testStatus != nil { return }
        #endif
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
        // Kept so Settings can say what came with the new build. The Mac installs master as it
        // is then, which holds at least this build.
        if buildReady != nil, let data = try? JSONEncoder().encode(whatsNew) {
            defaults.set(data, forKey: "report.lastNotes")
            defaults.set(buildCommit, forKey: "report.lastNotesFrom")
        }
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
    static func captureScreen(excluding overlays: [UIWindow]) -> UIImage? {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive })
            ?? UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return nil }
        let windows = scene.windows.filter { window in !window.isHidden && !overlays.contains { $0 === window } }.sorted { $0.windowLevel < $1.windowLevel }
        guard let bounds = windows.first?.bounds else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = min(2, scene.traitCollection.displayScale)
        return UIGraphicsImageRenderer(bounds: bounds, format: format).image { _ in
            for window in windows { window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        }
    }
}
