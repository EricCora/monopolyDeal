import { describe, expect, it } from 'vitest';
import { buildCoachHint, chooseHeuristicAction, chooseMonteCarloAction } from '../ai';
import { createGame, getLegalActions, type Action, type GameState } from '../engine';

function sameAction(left: Action, right: Action): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function makeAiState(): GameState {
  const state = createGame({
    seed: 909,
    players: [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ],
  });
  state.currentPlayerIndex = 0;
  state.turn.phase = 'action';
  state.turn.playsUsed = 0;
  state.pending = null;
  state.players[0].hand = ['rent_color#r1', 'debt_collector#d1', 'money_1#m1'];
  state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];
  state.players[1].bank = ['money_2#p2m1'];
  return state;
}

describe('AI command contract', () => {
  it('heuristic AI always returns a legal engine command', () => {
    const state = makeAiState();
    const legal = getLegalActions(state, 'p1');
    const decision = chooseHeuristicAction(state, 'p1', legal);

    expect(decision).not.toBeNull();
    if (!decision) return;
    expect(legal.some((item) => sameAction(item.action, decision.action))).toBe(true);
  });

  it('rollout AI is deterministic with a fixed seed and returns legal command output', () => {
    const state = makeAiState();
    const legal = getLegalActions(state, 'p1');
    const first = chooseMonteCarloAction(state, 'p1', legal, { seed: 1234, simulations: 10, depth: 6 });
    const second = chooseMonteCarloAction(state, 'p1', legal, { seed: 1234, simulations: 10, depth: 6 });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;

    expect(sameAction(first.action, second.action)).toBe(true);
    expect(legal.some((item) => sameAction(item.action, first.action))).toBe(true);
  });

  it('coach hints resolve from legal command candidates', () => {
    const state = makeAiState();
    const legal = getLegalActions(state, 'p1');
    const hint = buildCoachHint(state, 'p1', legal, 'hard');

    expect(hint).not.toBeNull();
    if (!hint) return;
    expect(typeof hint.topActionLabel).toBe('string');
    expect(hint.topActionLabel.length).toBeGreaterThan(0);
  });
});
