import { describe, expect, it } from 'vitest';
import { applyAction, createGame, type GameState } from '../engine';
import { drawCountForAction, drawPileInDrawOrder } from '../engine/drawPick';

function drawState(variant: 'classic' | 'no_mercy' = 'classic'): GameState {
  const state = createGame({ seed: 7, variant, players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] });
  state.currentPlayerIndex = 0;
  state.turn.phase = 'draw';
  return state;
}

describe('choosing drawn cards (god mode)', () => {
  it('draws the chosen cards from anywhere in the pile', () => {
    const state = drawState();
    const [first, second] = [state.drawPile[0], state.drawPile[5]];
    const result = applyAction(state, { type: 'draw_cards', playerId: 'p1', pick: [first, second] });
    expect(result.error).toBeUndefined();
    expect(result.state.players[0].hand.slice(-2)).toEqual([first, second]);
    expect(result.state.drawPile).toHaveLength(state.drawPile.length - 2);
    expect(result.state.drawPile).not.toContain(first);
    expect(result.events[0]?.message).toBe('A drew 2 cards.');
  });

  it('tops up a short pick with the normal next cards', () => {
    const state = drawState();
    const chosen = state.drawPile[3];
    const next = state.drawPile.filter((id) => id !== chosen).at(-1);
    const result = applyAction(state, { type: 'draw_cards', playerId: 'p1', pick: [chosen] });
    expect(result.error).toBeUndefined();
    expect(result.state.players[0].hand.slice(-2)).toEqual([chosen, next]);
  });

  it('rejects a pick that is too long, repeated or not in the pile', () => {
    const state = drawState();
    const pile = state.drawPile;
    for (const pick of [[pile[0], pile[1], pile[2]], [pile[0], pile[0]], [state.players[1].hand[0]]]) {
      const result = applyAction(state, { type: 'draw_cards', playerId: 'p1', pick });
      expect(result.error?.code).toBe('invalid_target');
      expect(result.state).toBe(state);
    }
  });

  it('lets Pass Go choose its two cards', () => {
    const state = drawState();
    state.turn.phase = 'action';
    state.players[0].hand = ['pass_go#pg1'];
    const pick = [state.drawPile[1], state.drawPile[2]];
    const action = { type: 'play_action' as const, playerId: 'p1', cardId: 'pass_go#pg1', pick };
    expect(drawCountForAction(state, action)).toBe(2);
    const result = applyAction(state, action);
    expect(result.error).toBeUndefined();
    expect(result.state.players[0].hand).toEqual(pick);
  });

  it('counts Pass Go Go Go up to seven cards after it leaves the hand', () => {
    const state = drawState('no_mercy');
    state.turn.phase = 'action';
    state.players[0].hand = ['pass_go_go_go#g1', 'money_1#m1'];
    const action = { type: 'play_action' as const, playerId: 'p1', cardId: 'pass_go_go_go#g1' };
    expect(drawCountForAction(state, action)).toBe(6);
    const pick = drawPileInDrawOrder(state).slice(-6);
    const result = applyAction(state, { ...action, pick });
    expect(result.error).toBeUndefined();
    expect(result.state.players[0].hand).toEqual(['money_1#m1', ...pick]);
  });

  it('rejects a pick on a play that draws nothing', () => {
    const state = drawState();
    state.turn.phase = 'action';
    state.players[0].hand = ['debt_collector#d1'];
    const action = { type: 'play_action' as const, playerId: 'p1', cardId: 'debt_collector#d1', targetPlayerId: 'p2', pick: [state.drawPile[0]] };
    expect(drawCountForAction(state, action)).toBeNull();
    expect(applyAction(state, action).error?.code).toBe('invalid_action');
  });

  it('lists the pile in draw order', () => {
    const state = drawState();
    expect(drawPileInDrawOrder(state)[0]).toBe(state.drawPile.at(-1));
  });
});
