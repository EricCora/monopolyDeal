import Charts
import DealStats
import SwiftUI

/// Match history, lifetime stats, achievements and the daily challenge.
struct StatsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dynamicTypeSize) private var typeSize
    @State private var playerFilter: String?
    @State private var winnerFilter: String?
    @State private var range = DateRange.all

    enum DateRange: String, CaseIterable, Identifiable {
        case all = "All Time", month = "30 Days", week = "7 Days", today = "Today"
        var id: String { rawValue }

        var cutoff: Date? {
            let calendar = Calendar.current
            switch self {
            case .all: return nil
            case .month: return calendar.date(byAdding: .day, value: -30, to: .now)
            case .week: return calendar.date(byAdding: .day, value: -7, to: .now)
            case .today: return calendar.startOfDay(for: .now)
            }
        }
    }

    @State private var replays: [String: StoredReplay] = [:]

    private var matches: [MatchRecord] {
        app.history.filter { match in
            (playerFilter == nil || match.players.contains(playerFilter!))
                && (winnerFilter == nil || match.winnerName == winnerFilter)
                && (range.cutoff == nil || match.endedDate >= range.cutoff!)
        }
    }

    private var allPlayers: [String] { Array(Set(app.history.flatMap(\.players))).sorted() }

    private struct WinRow: Identifiable {
        var id: String { name }
        var name: String
        var wins: Int
        var games: Int
    }

    private var winRows: [WinRow] {
        var rows: [String: WinRow] = [:]
        for match in matches {
            for player in match.players {
                var row = rows[player] ?? WinRow(name: player, wins: 0, games: 0)
                row.games += 1
                if match.winnerName == player { row.wins += 1 }
                rows[player] = row
            }
        }
        return rows.values.sorted { $0.wins != $1.wins ? $0.wins > $1.wins : $0.name < $1.name }
    }

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            ScrollView {
                VStack(spacing: 14) {
                    filters
                    kpis
                    if !winRows.isEmpty { winsChart }
                    if matches.count > 1 { lengthChart }
                    achievements
                    daily
                    history
                }
                .padding(18)
                .frame(maxWidth: 620)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Stats")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: MatchRecord.self) { match in
            MatchDetailView(match: match, replay: replays[match.id])
        }
        .onAppear {
            app.reloadStoredData()
            replays = Dictionary(app.store.replays().map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        }
    }

    private var filters: some View {
        (typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))) {
            Menu {
                Picker("Player", selection: $playerFilter) {
                    Text("All Players").tag(String?.none)
                    ForEach(allPlayers, id: \.self) { Text($0).tag(String?.some($0)) }
                }
            } label: { filterLabel(playerFilter ?? "All Players", icon: "person.fill") }
            Menu {
                Picker("Winner", selection: $winnerFilter) {
                    Text("Any Winner").tag(String?.none)
                    ForEach(allPlayers, id: \.self) { Text($0).tag(String?.some($0)) }
                }
            } label: { filterLabel(winnerFilter ?? "Any Winner", icon: "trophy.fill") }
            Menu {
                Picker("Dates", selection: $range) {
                    ForEach(DateRange.allCases) { Text($0.rawValue).tag($0) }
                }
            } label: { filterLabel(range.rawValue, icon: "calendar") }
        }
    }

    private func filterLabel(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.caption.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 36)
            .dealGlass(interactive: true, in: Capsule())
    }

    private var kpis: some View {
        let games = matches.count
        let turns = games == 0 ? 0 : matches.reduce(0) { $0 + $1.turnCount } / games
        let duration = games == 0 ? 0 : matches.reduce(0) { $0 + $1.durationSec } / games
        return HStack(spacing: 8) {
            kpi("\(games)", "Games")
            kpi("\(turns)", "Avg Turns")
            kpi(formatDuration(duration), "Avg Length")
        }
    }

    private func kpi(_ value: String, _ title: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title2.weight(.black))
                .foregroundStyle(.white)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(SoftWhite(0.65))
        }
        .frame(maxWidth: .infinity, minHeight: 66)
        .glassPanel(cornerRadius: 14)
        .accessibilityElement(children: .combine)
    }

    private var winsChart: some View {
        let most = max(winRows.map(\.wins).max() ?? 1, 1)
        return VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: "Wins by Player")
            ForEach(winRows) { row in
                HStack(spacing: 10) {
                    Text(row.name)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(SoftWhite(0.9))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(width: 84, alignment: .leading)
                    GeometryReader { bar in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Color.white.opacity(0.08))
                            if row.wins > 0 {
                                Capsule()
                                    .fill(Palette.gold)
                                    .frame(width: bar.size.width * CGFloat(row.wins) / CGFloat(most))
                            }
                        }
                    }
                    .frame(height: 16)
                    Text("\(row.wins) of \(row.games)")
                        .font(.caption2.weight(.semibold).monospacedDigit())
                        .foregroundStyle(SoftWhite(0.75))
                        .frame(width: 48, alignment: .trailing)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(cornerRadius: 18)
    }

    private var lengthChart: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: "Turns per Game")
            Chart(Array(matches.reversed().enumerated()), id: \.element.id) { index, match in
                LineMark(x: .value("Game", index + 1), y: .value("Turns", match.turnCount))
                    .foregroundStyle(Palette.gold)
                    .interpolationMethod(.monotone)
                PointMark(x: .value("Game", index + 1), y: .value("Turns", match.turnCount))
                    .foregroundStyle(Palette.gold)
            }
            .chartXAxis(.hidden)
            .chartYAxis {
                AxisMarks(position: .leading) { _ in
                    AxisGridLine().foregroundStyle(SoftWhite(0.1))
                    AxisValueLabel().foregroundStyle(SoftWhite(0.7))
                }
            }
            .frame(height: 130)
        }
        .padding(14)
        .glassPanel(cornerRadius: 18)
    }

    private var achievements: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: "Achievements")
            ForEach(AchievementId.allCases, id: \.self) { id in
                let unlocked = app.achievements.isUnlocked(id)
                HStack(spacing: 10) {
                    Image(systemName: id.symbol)
                        .foregroundStyle(unlocked ? Palette.gold : .white.opacity(0.3))
                        .frame(width: 26)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(id.label).font(.subheadline.weight(.bold)).foregroundStyle(.white)
                        Text(id.detail).font(.caption).foregroundStyle(SoftWhite(0.65))
                    }
                    Spacer()
                    if unlocked {
                        Image(systemName: "checkmark.seal.fill").foregroundStyle(Palette.gold)
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityValue(unlocked ? "Unlocked" : "Locked")
            }
        }
        .padding(14)
        .glassPanel(cornerRadius: 18)
    }

    private var daily: some View {
        let challenge = app.dailyChallenge
        return VStack(alignment: .leading, spacing: 6) {
            SectionTitle(text: "Today's Challenge")
            Text("Finish within \(challenge.targetTurns) turns")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
            Text("\(challenge.attempts) attempts · Best: \(challenge.bestTurnCount.map { "\($0) turns" } ?? "none yet") · \(challenge.completed ? "Done" : "Not done yet")")
                .font(.caption)
                .foregroundStyle(SoftWhite(0.7))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(cornerRadius: 18)
    }

    private var history: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: "Match History")
            if matches.isEmpty {
                Text("Finished games will appear here.")
                    .font(.subheadline)
                    .foregroundStyle(SoftWhite(0.7))
            }
            ForEach(matches) { match in
                NavigationLink(value: match) {
                    HStack(spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(match.winnerName.map { "\($0) won" } ?? "No winner")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                Spacer()
                                Text(match.mode.label)
                                    .font(.caption2.weight(.heavy))
                                    .foregroundStyle(Palette.gold)
                            }
                            Text(match.players.joined(separator: ", "))
                                .font(.caption)
                                .foregroundStyle(SoftWhite(0.75))
                            Text("\(match.turnCount) turns · \(formatDuration(match.durationSec)) · \(match.endedDate.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption2)
                                .foregroundStyle(SoftWhite(0.55))
                        }
                                Image(systemName: "chevron.right")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(SoftWhite(0.5))
                    }
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("stats.match")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(cornerRadius: 18)
    }
}
