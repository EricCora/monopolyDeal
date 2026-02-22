import { describe, expect, it } from 'vitest';
import { buildCoachHint, chooseHeuristicAction, chooseMonteCarloAction } from '../ai';
import { createGame, getLegalActions, type Action, type GameState } from '../engine';

function sameAction(left: Action, right: Action): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function makeBaseState(seed: number): GameState {
  const state = createGame({
    seed,
    players: [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ],
  });
  state.currentPlayerIndex = 0;
  state.turn.phase = 'action';
  state.turn.playsUsed = 0;
  state.pending = null;
  state.players[0].hand = ['rent_color#r1', 'debt_collector#d1', 'just_say_no#j1', 'money_2#m1'];
  state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];
  state.players[1].bank = ['money_3#p2m1'];
  state.players[1].properties.light_blue = [{ cardId: 'light_blue_1#p2l1', assignedColor: 'light_blue' }];
  return state;
}

function makeCounterPromptState(seed: number): GameState {
  const state = makeBaseState(seed);
  state.pending = {
    kind: 'counter',
    payload: {
      sourcePlayerId: 'p2',
      targetPlayerId: 'p1',
      actionCardId: 'debt_collector#dc1',
      effect: {
        kind: 'payment',
        payload: {
          sourcePlayerId: 'p2',
          targetPlayerId: 'p1',
          amount: 5,
          reason: 'debt_collector',
          actionCardId: 'debt_collector#dc1',
        },
      },
      chain: [],
      awaitingPlayerId: 'p1',
    },
  };
  return state;
}

function makeForcedDealPromptState(seed: number): GameState {
  const state = makeBaseState(seed);
  state.pending = {
    kind: 'forced_deal',
    payload: {
      sourcePlayerId: 'p1',
      targetPlayerId: 'p2',
      actionCardId: 'forced_deal#fd1',
    },
  };
  state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];
  state.players[1].properties.light_blue = [{ cardId: 'light_blue_1#p2l1', assignedColor: 'light_blue' }];
  return state;
}

function makePaymentPromptState(seed: number): GameState {
  const state = makeBaseState(seed);
  state.pending = {
    kind: 'payment',
    payload: {
      sourcePlayerId: 'p2',
      targetPlayerId: 'p1',
      amount: 4,
      reason: 'rent',
      actionCardId: 'rent_color#r2',
    },
  };
  state.players[0].bank = ['money_2#m2', 'money_3#m3'];
  return state;
}

const MATRIX = [
  { id: 'action-rent-pressure', state: () => makeBaseState(111), rolloutSeed: 9001 },
  { id: 'counter-response-window', state: () => makeCounterPromptState(222), rolloutSeed: 9002 },
  { id: 'forced-deal-selection', state: () => makeForcedDealPromptState(333), rolloutSeed: 9003 },
  { id: 'payment-prompt', state: () => makePaymentPromptState(444), rolloutSeed: 9004 },
];

describe('AI tier matrix invariants', () => {
  it.each(MATRIX)('keeps heuristic and rollout output legal for $id', ({ state, rolloutSeed }) => {
    const snapshot = state();
    const legal = getLegalActions(snapshot, 'p1');
    expect(legal.length).toBeGreaterThan(0);

    const easy = chooseHeuristicAction(snapshot, 'p1', legal);
    const hard = chooseMonteCarloAction(snapshot, 'p1', legal, { seed: rolloutSeed, simulations: 12, depth: 8 });
    expect(easy).not.toBeNull();
    expect(hard).not.toBeNull();
    if (!easy || !hard) return;

    expect(legal.some((entry) => sameAction(entry.action, easy.action))).toBe(true);
    expect(legal.some((entry) => sameAction(entry.action, hard.action))).toBe(true);
  });

  it.each(MATRIX)('keeps rollout deterministic for same seed in $id', ({ state, rolloutSeed }) => {
    const snapshot = state();
    const legal = getLegalActions(snapshot, 'p1');
    const first = chooseMonteCarloAction(snapshot, 'p1', legal, { seed: rolloutSeed, simulations: 12, depth: 8 });
    const second = chooseMonteCarloAction(snapshot, 'p1', legal, { seed: rolloutSeed, simulations: 12, depth: 8 });
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    expect(sameAction(first.action, second.action)).toBe(true);
  });

  it.each(MATRIX)('coach hints remain non-empty and actionable for easy/hard in $id', ({ state }) => {
    const snapshot = state();
    const legal = getLegalActions(snapshot, 'p1');
    const labels = new Set(legal.map((entry) => entry.label));

    const easyHint = buildCoachHint(snapshot, 'p1', legal, 'easy');
    const hardHint = buildCoachHint(snapshot, 'p1', legal, 'hard');

    expect(easyHint).not.toBeNull();
    expect(hardHint).not.toBeNull();
    if (!easyHint || !hardHint) return;

    expect(easyHint.summary.length).toBeGreaterThan(0);
    expect(hardHint.summary.length).toBeGreaterThan(0);
    expect(labels.has(easyHint.topActionLabel)).toBe(true);
    expect(labels.has(hardHint.topActionLabel)).toBe(true);
  });
});
