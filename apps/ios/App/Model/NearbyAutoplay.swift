#if DEBUG
import DealAI
import DealEngine
import DealNearby
import Foundation

/// Plays a nearby seat by itself, for testing two real phones over Multipeer. Each phone
/// prints its result and writes it to `Documents/nearby-autoplay.txt`, so a test run can
/// compare the two: `xcrun devicectl device copy from --domain-type appDataContainer`.
/// Launch with `-storeDirectory` too, so the test game stays out of the phone's own stats.
@MainActor
enum NearbyAutoplay {
    static func watchHost(_ app: AppModel) {
        report("host started")
        Task {
            var started = false
            while let match = app.nearbyHost {
                if !started, match.host.table.seats.count >= 2 {
                    started = true
                    report("seated \(match.host.table.seats.map(\.name)), dealing")
                    match.host.startGame()
                }
                if started, finish(match.view, role: "host") {
                    // Give the other phone time to see the result, then leave nothing behind.
                    try? await Task.sleep(for: .seconds(5))
                    app.closeNearbyTable()
                    return
                }
                play(match, revision: match.view.revision)
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
    }

    static func watchGuest(_ app: AppModel) {
        report("guest looking for a table")
        Task {
            while app.nearbyGuest == nil {
                if let table = app.nearbyBrowser?.tables.first {
                    report("joining \(table.hostName)")
                    app.joinNearby(table)
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
            while let match = app.nearbyGuest {
                if let view = match.view, view.started, finish(view, role: "guest") {
                    app.leaveNearbyTable()
                    return
                }
                play(match, revision: match.view?.revision ?? -1)
                try? await Task.sleep(for: .milliseconds(250))
            }
        }
    }

    private static var lastTry: [ObjectIdentifier: (revision: Int, at: Date)] = [:]

    private static func play(_ session: some TableSession & AnyObject, revision: Int) {
        guard let game = session.game, let viewerId = session.viewerId, !session.legalActions.isEmpty else { return }
        let key = ObjectIdentifier(session)
        // One try per board, so a refused move isn't sent over and over. A move lost in a drop is tried again after a while.
        if let last = lastTry[key], last.revision == revision, Date().timeIntervalSince(last.at) < 5 { return }
        lastTry[key] = (revision, Date())
        let legal = session.legalActions
        session.perform(Heuristic.choose(game, actorId: viewerId, legalActions: legal)?.action ?? legal[0].action)
    }

    private static func finish(_ view: NearbyView, role: String) -> Bool {
        guard view.isFinished, let game = view.game else { return false }
        report("finished role=\(role) table=\(view.tableId) winner=\(game.winnerId ?? "none") turns=\(game.turnCount) revision=\(view.revision)")
        return true
    }

    private static func report(_ line: String) {
        let stamped = "NEARBY-AUTOPLAY \(Date().ISO8601Format()) \(line)"
        print(stamped)
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("nearby-autoplay.txt")
        let existing = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
        try? (existing + stamped + "\n").write(to: url, atomically: true, encoding: .utf8)
    }
}
#endif
