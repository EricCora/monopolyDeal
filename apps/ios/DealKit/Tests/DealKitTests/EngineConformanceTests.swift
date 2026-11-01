import XCTest
@testable import DealEngine
@testable import DealAI

/// Replays games recorded from the TypeScript engine (`npm run traces:record`).
/// A mismatch names the game. To see where it diverged:
///   npm run traces:record -- --dump <game> /tmp/ts.txt
///   DEAL_DUMP_GAME=<game> DEAL_DUMP_PATH=/tmp/swift.txt swift test --filter EngineConformanceTests
///   diff /tmp/ts.txt /tmp/swift.txt
final class EngineConformanceTests: XCTestCase {
    private struct TraceFile: Decodable {
        var version: Int
        var games: [TraceGame]
    }

    private struct TraceGame: Decodable {
        var variant: GameVariant
        var mode: String
        var seed: Int
        var players: Int
        var ruleset: PartialRuleset?
        var steps: Int
        var winnerId: String?
        var checkpoints: [String]
        var picks: [Int]?
    }

    private struct PartialRuleset: Decodable {
        var winCompleteSets: Int?
        var maxHandAtEndTurn: Int?
        var maxPlaysPerTurn: Int?
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
        return try Data(contentsOf: url)
    }

    private func stepText(_ state: GameState, eventsFrom: Int) throws -> String {
        let prompt = Engine.nextPrompt(state)
        let legal = Engine.getLegalActions(state, prompt.playerId)
        let counts = state.players.map { String(Engine.getLegalActions(state, $0.id).count) }.joined(separator: ",")
        return [
            try CanonicalJSON.string(state),
            try CanonicalJSON.string(Array(state.history[eventsFrom...])),
            try CanonicalJSON.string(prompt),
            try CanonicalJSON.string(legal),
            legal.map(\.action.wireJSON).joined(separator: "\n"),
            counts,
        ].joined(separator: "\n")
    }

    private func replay(_ game: TraceGame, index: Int, dump: inout [String]?) throws -> (checkpoints: [String], steps: Int, winner: String?, botMismatch: String?) {
        var rules: Ruleset?
        if let partial = game.ruleset {
            rules = Ruleset(
                winCompleteSets: partial.winCompleteSets ?? 3,
                maxHandAtEndTurn: partial.maxHandAtEndTurn ?? 7,
                maxPlaysPerTurn: partial.maxPlaysPerTurn ?? 3
            )
        }
        var state = Engine.createGame(GameConfig(
            players: (1...game.players).map { PlayerConfig(id: "p\($0)", name: "P\($0)") },
            seed: game.seed,
            variant: game.variant,
            ruleset: rules
        ))
        var random = FuzzRandom(seed: game.seed)
        var hash = FNV1a()
        var eventsFrom = 0
        var checkpoints: [String] = []
        var steps = 0
        var botMismatch: String?

        while true {
            let text = try stepText(state, eventsFrom: eventsFrom)
            dump?.append("--- step \(steps)")
            dump?.append(text)
            hash.add(text)
            eventsFrom = state.history.count
            if steps % 10 == 0 { checkpoints.append(hash.base36) }
            if Engine.isGameOver(state).done || steps >= 6000 { break }

            let choice: LegalAction
            if game.mode == "bot" {
                let prompt = Engine.nextPrompt(state)
                let options = Engine.getLegalActions(state, prompt.playerId)
                let pick = try XCTUnwrap(game.picks?[steps], "game \(index) ran past its recorded picks")
                let chosen = pick < 0 ? -(pick + 1) : pick
                choice = options[chosen]
                if pick >= 0 && botMismatch == nil {
                    let top = Heuristic.rank(state, actorId: prompt.playerId, legalActions: options)[0]
                    if top.action != choice.action {
                        botMismatch = "step \(steps): TypeScript chose \(choice.label), Swift chose \(top.label)"
                    }
                }
            } else {
                let options = state.players.flatMap { Engine.getLegalActions(state, $0.id) }
                let preferred = options.filter { $0.action.type != .pass_turn && $0.action.type != .move_wild }
                let pool = !preferred.isEmpty && random.next() < 0.9 ? preferred : options
                choice = pool[Int((random.next() * Double(pool.count)).rounded(.down))]
            }
            let result = Engine.applyAction(state, choice.action)
            if let error = result.error {
                XCTFail("game \(index) step \(steps): legal action rejected: \(choice.label): \(error.message)")
                break
            }
            state = result.state
            steps += 1
        }
        checkpoints.append(hash.base36)
        return (checkpoints, steps, state.winnerId, botMismatch)
    }

    func testRecordedGamesReplayIdentically() throws {
        let file = try JSONDecoder().decode(TraceFile.self, from: fixture("engine-traces"))
        XCTAssertEqual(file.games.count, 1000)
        let environment = ProcessInfo.processInfo.environment
        if let dumpIndex = environment["DEAL_DUMP_GAME"].flatMap(Int.init), let path = environment["DEAL_DUMP_PATH"] {
            var dump: [String]? = []
            _ = try replay(file.games[dumpIndex], index: dumpIndex, dump: &dump)
            try (dump!.joined(separator: "\n") + "\n").write(toFile: path, atomically: true, encoding: .utf8)
        }

        var failures: [String] = []
        var botMismatches: [String] = []
        var comparablePicks = 0
        // DEAL_CONFORMANCE_LIMIT replays only the first games of each kind, for a quick check.
        let limit = environment["DEAL_CONFORMANCE_LIMIT"].flatMap(Int.init)
        for (index, game) in file.games.enumerated() where limit == nil || index % 250 < limit! {
            var noDump: [String]?
            let outcome = try replay(game, index: index, dump: &noDump)
            if outcome.checkpoints != game.checkpoints {
                let firstDifferent = zip(outcome.checkpoints, game.checkpoints).enumerated().first { $0.element.0 != $0.element.1 }?.offset ?? -1
                failures.append("game \(index) (\(game.variant.rawValue), \(game.mode), seed \(game.seed)): differs by step \(firstDifferent * 10)")
            } else if outcome.steps != game.steps || outcome.winner != game.winnerId {
                failures.append("game \(index): finished differently")
            }
            if let mismatch = outcome.botMismatch { botMismatches.append("game \(index) \(mismatch)") }
            comparablePicks += game.picks?.filter { $0 >= 0 }.count ?? 0
        }
        XCTAssertEqual(failures, [], "\(failures.count) games diverged")
        XCTAssertEqual(botMismatches, [], "\(botMismatches.count) bot games chose a different top move")
        if limit == nil { XCTAssertGreaterThan(comparablePicks, 5000, "Bot choices should be compared across thousands of positions") }
    }

    func testSavedGamesFromTheWebAppLoadAndContinue() throws {
        struct SampleFile: Decodable {
            var samples: [Sample]
        }
        struct Sample: Decodable {
            var name: String
            var state: GameState
            var legalByPlayer: [String]
        }
        let file = try JSONDecoder().decode(SampleFile.self, from: fixture("engine-sample-states"))
        XCTAssertEqual(file.samples.count, 6)
        for sample in file.samples {
            for (index, player) in sample.state.players.enumerated() {
                XCTAssertEqual(try CanonicalJSON.string(Engine.getLegalActions(sample.state, player.id)), sample.legalByPlayer[index], "\(sample.name): legal actions for \(player.name)")
            }
            // A decoded save must round-trip and keep playing to a finish.
            let encoded = try JSONEncoder().encode(sample.state)
            let reloaded = try JSONDecoder().decode(GameState.self, from: encoded)
            XCTAssertEqual(reloaded, sample.state, sample.name)
            var state = Engine.normalizeGameState(reloaded)
            var random = FuzzRandom(seed: 99)
            for _ in 0..<6000 where !Engine.isGameOver(state).done {
                let options = state.players.flatMap { Engine.getLegalActions(state, $0.id) }
                let choice = options[Int((random.next() * Double(options.count)).rounded(.down))]
                let result = Engine.applyAction(state, choice.action)
                XCTAssertNil(result.error, "\(sample.name): \(choice.label)")
                state = result.state
            }
        }
    }
}

struct FuzzRandom {
    private var current: UInt64

    init(seed: Int) { current = UInt64(seed) }

    mutating func next() -> Double {
        current = (current &* 1664525 &+ 1013904223) & 0xFFFF_FFFF
        return Double(current) / 4294967296
    }
}

struct FNV1a {
    private var value: UInt32 = 2166136261

    mutating func add(_ text: String) {
        for byte in text.utf8 {
            value ^= UInt32(byte)
            value = value &* 16777619
        }
    }

    var base36: String { String(value, radix: 36) }
}

/// Matches `canonicalJson` in `src/test/fixtures/engineTrace.ts`.
enum CanonicalJSON {
    static func string<T: Encodable>(_ value: T) throws -> String {
        let data = try JSONEncoder().encode(value)
        let object = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        var output = ""
        write(object, into: &output)
        return output
    }

    private static func write(_ value: Any, into output: inout String) {
        switch value {
        case let array as [Any]:
            output += "["
            for (index, item) in array.enumerated() {
                if index > 0 { output += "," }
                write(item, into: &output)
            }
            output += "]"
        case let dictionary as [String: Any]:
            output += "{"
            var first = true
            for key in dictionary.keys.sorted(by: { Array($0.utf16).lexicographicallyPrecedes(Array($1.utf16)) }) {
                if ["createdAt", "updatedAt", "history", "timestamp"].contains(key) { continue }
                if !first { output += "," }
                first = false
                write(key, into: &output)
                output += ":"
                write(dictionary[key]!, into: &output)
            }
            output += "}"
        case let text as String:
            output += "\""
            for scalar in text.unicodeScalars {
                switch scalar {
                case "\"": output += "\\\""
                case "\\": output += "\\\\"
                default: output.unicodeScalars.append(scalar)
                }
            }
            output += "\""
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                output += number.boolValue ? "true" : "false"
            } else {
                output += number.stringValue
            }
        default:
            output += "null"
        }
    }
}
