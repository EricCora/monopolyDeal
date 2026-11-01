import { describe, expect, it } from 'vitest';
import { buildCoachHint, chooseHeuristicAction, chooseMonteCarloAction, rankHeuristicActions } from '../ai';
import { getCardDefinition } from '../cards/catalog';
import { applyAction, createGame, getLegalActions, getNextPrompt, type Action, type GameState, type LegalAction } from '../engine';

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

function makePaymentPromptState(): GameState {
  const state = makeAiState();
  state.pending = {
    kind: 'payment',
    payload: {
      sourcePlayerId: 'p2',
      targetPlayerId: 'p1',
      amount: 3,
      reason: 'rent',
      actionCardId: 'rent_color#r2',
    },
  };
  state.players[0].bank = ['money_2#m2', 'money_1#m3'];
  return state;
}

function makeSelectionPromptState(): GameState {
  const state = makeAiState();
  state.pending = {
    kind: 'forced_deal',
    payload: {
      sourcePlayerId: 'p1',
      targetPlayerId: 'p2',
      actionCardId: 'forced_deal#f1',
    },
  };
  state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];
  state.players[1].properties.light_blue = [{ cardId: 'light_blue_1#p2l1', assignedColor: 'light_blue' }];
  return state;
}

const AI_SCENARIOS = [
  { name: 'action phase pressure', makeState: makeAiState },
  { name: 'payment prompt', makeState: makePaymentPromptState },
  { name: 'selection prompt', makeState: makeSelectionPromptState },
];

describe('AI command contract', () => {
  it.each(AI_SCENARIOS)('heuristic AI returns legal engine commands for $name', ({ makeState }) => {
    const state = makeState();
    const legal = getLegalActions(state, 'p1');
    expect(legal.length).toBeGreaterThan(0);
    const decision = chooseHeuristicAction(state, 'p1', legal);

    expect(decision).not.toBeNull();
    if (!decision) return;
    expect(legal.some((item) => sameAction(item.action, decision.action))).toBe(true);
  });

  it.each(AI_SCENARIOS)('rollout AI is deterministic with fixed rollout seed for $name', ({ makeState }) => {
    const state = makeState();
    const legal = getLegalActions(state, 'p1');
    expect(legal.length).toBeGreaterThan(0);

    const first = chooseMonteCarloAction(state, 'p1', legal, { seed: 1234, simulations: 10, depth: 6 });
    const second = chooseMonteCarloAction(state, 'p1', legal, { seed: 1234, simulations: 10, depth: 6 });

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) return;
    expect(sameAction(first.action, second.action)).toBe(true);
    expect(legal.some((item) => sameAction(item.action, first.action))).toBe(true);
  });

  it.each(AI_SCENARIOS)('rollout AI remains legal across varied rollout seeds for $name', ({ makeState }) => {
    const state = makeState();
    const legal = getLegalActions(state, 'p1');
    const decisions = [
      chooseMonteCarloAction(state, 'p1', legal, { seed: 11, simulations: 10, depth: 6 }),
      chooseMonteCarloAction(state, 'p1', legal, { seed: 77, simulations: 10, depth: 6 }),
      chooseMonteCarloAction(state, 'p1', legal, { seed: 404, simulations: 10, depth: 6 }),
    ];
    for (const decision of decisions) {
      expect(decision).not.toBeNull();
      if (!decision) continue;
      expect(legal.some((item) => sameAction(item.action, decision.action))).toBe(true);
    }
  });

  it.each(AI_SCENARIOS)('coach hints remain actionable in easy and hard modes for $name', ({ makeState }) => {
    const state = makeState();
    const legal = getLegalActions(state, 'p1');
    const legalLabels = new Set(legal.map((entry) => entry.label));

    const easy = buildCoachHint(state, 'p1', legal, 'easy');
    const hard = buildCoachHint(state, 'p1', legal, 'hard');

    expect(easy).not.toBeNull();
    expect(hard).not.toBeNull();
    if (!easy || !hard) return;

    expect(easy.topActionLabel.length).toBeGreaterThan(0);
    expect(hard.topActionLabel.length).toBeGreaterThan(0);
    expect(legalLabels.has(easy.topActionLabel)).toBe(true);
    expect(legalLabels.has(hard.topActionLabel)).toBe(true);
  });

  it('scores pass as early when custom play budget is still available', () => {
    const state = makeAiState();
    state.ruleset = {
      winCompleteSets: 3,
      maxHandAtEndTurn: 7,
      maxPlaysPerTurn: 5,
    };
    state.turn.playsUsed = 3;
    const legal: LegalAction[] = [
      {
        label: 'Pass turn',
        action: { type: 'pass_turn', playerId: 'p1' },
      },
    ];

    const [passScore] = rankHeuristicActions(state, 'p1', legal);

    expect(passScore.score).toBe(20);
    expect(passScore.reason).toMatch(/passing early/i);
  });
});

describe('action card scores', () => {
  it("scores It's My Birthday as intended", () => {
    const state = makeAiState();
    const birthday = state.players.flatMap((player) => player.hand).concat(state.drawPile)
      .find((cardId) => cardId.startsWith('its_my_birthday'));
    expect(birthday).toBeDefined();
    const [scored] = rankHeuristicActions(state, 'p1', [
      { action: { type: 'play_action', playerId: 'p1', cardId: birthday! }, label: 'Birthday' },
    ]);
    expect(scored.score).toBe(430);
  });

  it.each(['classic', 'no_mercy'] as const)('gives every %s card a real score', (variant) => {
    const state = createGame({ seed: 1, variant, players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] });
    const cards = state.players.flatMap((player) => player.hand).concat(state.drawPile)
      .filter((cardId) => getCardDefinition(cardId, variant).kind === 'action');
    expect(cards.length).toBeGreaterThan(0);
    for (const cardId of cards) {
      const [scored] = rankHeuristicActions(state, 'p1', [
        { action: { type: 'play_action', playerId: 'p1', cardId }, label: cardId },
      ]);
      expect(Number.isFinite(scored.score), cardId).toBe(true);
    }
  });
});

describe('hard bot and Wilds', () => {
  /** A position where the hard bot's first choice is to move a Wild, which costs no play. */
  function wildMovePosition(): { state: GameState; actor: string; legal: LegalAction[] } {
    let state = createGame({ seed: 1, players: [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }] });
    for (let step = 0; step < 52; step += 1) {
      const prompt = getNextPrompt(state);
      state = applyAction(state, chooseHeuristicAction(state, prompt.playerId, getLegalActions(state, prompt.playerId))!.action).state;
    }
    const actor = getNextPrompt(state).playerId;
    return { state, actor, legal: getLegalActions(state, actor) };
  }

  const options = { simulations: 6, depth: 8, seed: 7 };

  it('may reposition a Wild early in a turn', () => {
    const { state, actor, legal } = wildMovePosition();
    expect(chooseMonteCarloAction(state, actor, legal, options)?.action.type).toBe('move_wild');
  });

  it('stops moving Wilds after two moves in a turn, so a game cannot freeze', () => {
    const { state, actor, legal } = wildMovePosition();
    const moved = { timestamp: 0, type: 'wild_move', message: 'Moved a Wild.' };
    const pick = chooseMonteCarloAction({ ...state, history: [...state.history, moved, moved] }, actor, legal, options);
    expect(pick?.action.type).not.toBe('move_wild');
  });

  it('counts only the current turn', () => {
    const { state, actor, legal } = wildMovePosition();
    const moved = { timestamp: 0, type: 'wild_move', message: 'Moved a Wild.' };
    const passed = { timestamp: 0, type: 'turn_passed', message: 'Ended the turn.' };
    const history = [...state.history, moved, moved, passed];
    expect(chooseMonteCarloAction({ ...state, history }, actor, legal, options)?.action.type).toBe('move_wild');
  });
});
