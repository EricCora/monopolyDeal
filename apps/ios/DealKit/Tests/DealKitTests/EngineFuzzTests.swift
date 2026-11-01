import XCTest
@testable import DealEngine

/// Port of `src/test/engine-fuzz.test.ts`: random legal play with invariants checked
/// after every action, at the 2,000-game scale the spec asks for.
final class EngineFuzzTests: XCTestCase {
    private func allCards(_ state: GameState) -> [String] {
        var cards = state.drawPile + state.discardPile
        for player in state.players {
            cards += player.hand + player.bank
            for color in PropertyColor.allCases { cards += player.properties[color].map(\.cardId) }
        }
        switch state.pending {
        case .debtCard(let payload): cards.append(payload.cardId)
        case .noMercy(let payload): cards += (payload.redistribution ?? []).map(\.cardId)
        default: break
        }
        return cards
    }

    private func playOut(_ variant: GameVariant, players: Int, seed: Int) -> String? {
        var random = FuzzRandom(seed: seed)
        var state = Engine.createGame(GameConfig(
            players: (1...players).map { PlayerConfig(id: "p\($0)", name: "P\($0)") },
            seed: seed,
            variant: variant
        ))
        let count = allCards(state).count
        for step in 0..<6000 {
            if Engine.isGameOver(state).done { return nil }
            let options = state.players.flatMap { Engine.getLegalActions(state, $0.id) }
            if options.isEmpty { return "soft-lock at step \(step): \(state.turn)" }
            let preferred = options.filter { $0.action.type != .pass_turn && $0.action.type != .move_wild }
            let pool = !preferred.isEmpty && random.next() < 0.9 ? preferred : options
            let choice = pool[Int((random.next() * Double(pool.count)).rounded(.down))]
            let result = Engine.applyAction(state, choice.action)
            if let error = result.error { return "legal action rejected: \(choice.label): \(error.message)" }
            state = result.state
            let cards = allCards(state)
            if cards.count != count || Set(cards).count != count { return "card count changed after \(choice.label)" }
        }
        return "no finish after 6000 steps"
    }

    private func fuzz(_ variant: GameVariant) {
        // The first seeds are the games that exposed past failures on the web.
        let known = [1120, 36, 5644, 1181, 1987, 4066]
        var failures: [String] = []
        for index in 0..<2000 {
            let seed = index < known.count ? known[index] : index * 31 + 7
            if let failure = playOut(variant, players: 2 + index % 4, seed: seed) {
                failures.append("seed \(seed): \(failure)")
            }
        }
        XCTAssertEqual(failures, [])
    }

    func testClassicKeepsItsInvariants() { fuzz(.classic) }
    func testNoMercyKeepsItsInvariants() { fuzz(.no_mercy) }

    func testDeckSizesMatchTheCatalog() {
        XCTAssertEqual(Catalog.deckSize(.classic), 106)
        XCTAssertEqual(Catalog.deckSize(.no_mercy), 115)
    }

    func testPlayLimitAndTurnOwnershipAreEnforced() {
        var state = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "A"), PlayerConfig(id: "b", name: "B")], seed: 4))
        XCTAssertEqual(Engine.applyAction(state, Action(.draw_cards, playerId: "b")).error?.code, .invalid_turn)
        state = Engine.applyAction(state, Action(.draw_cards, playerId: "a")).state
        XCTAssertEqual(state.turn.phase, .action)
        state.turn.playsUsed = 3
        var play = Action(.play_to_bank, playerId: "a")
        play.cardId = "money_1#1"
        XCTAssertEqual(Engine.applyAction(state, play).error?.code, .illegal_play_limit)
    }

    func testPeekingAtTheDeckCannotBeUndone() {
        let before = Engine.createGame(GameConfig(players: [PlayerConfig(id: "a", name: "A"), PlayerConfig(id: "b", name: "B")], seed: 4))
        var after = before
        after.drawPile.removeLast(2)
        XCTAssertTrue(Engine.actionRevealedDeckCards(before: before, after: after, actionType: .play_action))
        XCTAssertFalse(Engine.actionRevealedDeckCards(before: before, after: after, actionType: .draw_cards))
    }
}
