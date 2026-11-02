import { describe, expect, it } from 'vitest';
import { applyAction, countCompleteSets, createGame, isGameOver, type GameState, type GameVariant } from '../engine';

function table(variant: GameVariant = 'classic'): GameState {
  const state = createGame({ seed: 3, variant, players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bo' }] });
  state.turn.phase = 'action';
  state.currentPlayerIndex = 0;
  state.players[0].hand = ['money_1#a'];
  return state;
}

const pile = (setId: string, ...cards: string[]) => cards.map((cardId) => ({ cardId, assignedColor: 'pink' as const, setId }));

describe('what completes a set', () => {
  it('counts a two-color Wild with an any-color Wild, in Classic', () => {
    const state = table();
    state.players[0].properties.brown = [
      { cardId: 'wild_brown_light_blue#a', assignedColor: 'brown' },
      { cardId: 'wild_all#a', assignedColor: 'brown' },
    ];
    expect(countCompleteSets(state.players[0], 'classic')).toBe(1);
  });

  it('still refuses two any-color Wilds', () => {
    const state = table();
    state.players[0].properties.brown = [
      { cardId: 'wild_all#a', assignedColor: 'brown' },
      { cardId: 'wild_all#b', assignedColor: 'brown' },
    ];
    expect(countCompleteSets(state.players[0], 'classic')).toBe(0);
  });

  it('wins on the set from the playtest', () => {
    const state = table();
    const me = state.players[0];
    me.properties.brown = [
      { cardId: 'wild_brown_light_blue#a', assignedColor: 'brown' },
      { cardId: 'wild_all#a', assignedColor: 'brown' },
    ];
    me.properties.dark_blue = [
      { cardId: 'dark_blue_1#a', assignedColor: 'dark_blue' },
      { cardId: 'wild_all#b', assignedColor: 'dark_blue' },
    ];
    me.properties.yellow = [
      { cardId: 'yellow_1#a', assignedColor: 'yellow' },
      { cardId: 'yellow_1#b', assignedColor: 'yellow' },
      { cardId: 'yellow_1#c', assignedColor: 'yellow' },
    ];
    const result = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#a' });
    expect(result.error).toBeUndefined();
    expect(isGameOver(result.state).winnerId).toBe('p1');
  });

  it('adds a standard property beside a complete Wild set without breaking it', () => {
    const state = table();
    const me = state.players[0];
    me.properties.brown = [
      { cardId: 'wild_brown_light_blue#a', assignedColor: 'brown' },
      { cardId: 'wild_all#a', assignedColor: 'brown' },
    ];
    me.hand = ['brown_1#a'];
    const result = applyAction(state, { type: 'play_property', playerId: 'p1', cardId: 'brown_1#a', color: 'brown' });
    expect(result.error).toBeUndefined();
    const piles = new Set(result.state.players[0].properties.brown.map((entry) => entry.setId));
    expect(piles.size).toBe(2);
    expect(countCompleteSets(result.state.players[0], 'classic')).toBe(1);
  });
});

describe('piles of one color', () => {
  it('rejoin once they hold a set between them', () => {
    const state = table();
    state.players[0].properties.pink = [...pile('a', 'pink_1#a', 'pink_1#b'), ...pile('b', 'pink_1#c')];
    const result = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#a' });
    expect(result.error).toBeUndefined();
    expect(countCompleteSets(result.state.players[0], 'classic')).toBe(1);
    expect(new Set(result.state.players[0].properties.pink.map((entry) => entry.setId)).size).toBe(1);
  });

  it('rejoin with a Shack riding on its property, and that wins', () => {
    const state = table('no_mercy');
    const me = state.players[0];
    me.properties.pink = [
      ...pile('a', 'pink_1#a', 'pink_1#b'),
      { cardId: 'shack#a', assignedColor: 'pink', setId: 'a', attachedToCardId: 'pink_1#b' },
      ...pile('b', 'pink_1#c'),
    ];
    me.properties.yellow = ['yellow_1#a', 'yellow_1#b', 'yellow_1#c'].map((cardId) => ({ cardId, assignedColor: 'yellow' as const }));
    me.properties.green = ['green_1#a', 'green_1#b', 'green_1#c'].map((cardId) => ({ cardId, assignedColor: 'green' as const }));
    me.debts = [];
    me.hand = ['money_1#a'];
    const result = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#a' });
    expect(result.error).toBeUndefined();
    expect(isGameOver(result.state).winnerId).toBe('p1');
  });

  it('top up one pile when there are too many cards for one set', () => {
    const state = table();
    state.players[0].properties.pink = [...pile('a', 'pink_1#a', 'pink_1#b'), ...pile('b', 'pink_1#c', 'pink_1#d')];
    const { state: next } = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#a' });
    const counts = [...new Set(next.players[0].properties.pink.map((entry) => entry.setId))]
      .map((id) => next.players[0].properties.pink.filter((entry) => entry.setId === id).length)
      .sort();
    expect(counts).toEqual([1, 3]);
  });

  it('stay apart when joining would put two Shacks on a complete set', () => {
    const state = table('no_mercy');
    const me = state.players[0];
    me.properties.pink = [
      ...pile('a', 'pink_1#a', 'pink_1#b'),
      { cardId: 'shack#a', assignedColor: 'pink', setId: 'a', attachedToCardId: 'pink_1#a' },
      { cardId: 'shack#b', assignedColor: 'pink', setId: 'a', attachedToCardId: 'pink_1#b' },
      ...pile('b', 'pink_1#c'),
    ];
    me.debts = [];
    me.hand = ['money_1#a'];
    const { state: next, error } = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#a' });
    expect(error).toBeUndefined();
    expect(countCompleteSets(next.players[0], 'no_mercy')).toBe(0);
  });

  it('swap a Wild out so a full pile of any-color Wilds becomes real', () => {
    const state = table();
    state.players[0].properties.brown = [
      { cardId: 'wild_all#a', assignedColor: 'brown', setId: 'a' },
      { cardId: 'wild_all#b', assignedColor: 'brown', setId: 'a' },
      { cardId: 'brown_1#a', assignedColor: 'brown', setId: 'b' },
    ];
    const { state: next } = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#a' });
    expect(countCompleteSets(next.players[0], 'classic')).toBe(1);
  });

  it("don't move while something is still being resolved", () => {
    const state = table();
    state.players[0].properties.pink = [...pile('a', 'pink_1#a', 'pink_1#b'), ...pile('b', 'pink_1#c')];
    state.players[1].hand = ['money_1#z'];
    state.players[0].hand = ['money_1#a', 'debt_collector#a'];
    const { state: next, error } = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: 'debt_collector#a', targetPlayerId: 'p2' });
    expect(error).toBeUndefined();
    expect(next.pending).not.toBeNull();
    expect(new Set(next.players[0].properties.pink.map((entry) => entry.setId)).size).toBe(2);
  });
});
