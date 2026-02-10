import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getLegalActions, isGameOver, type GameState } from '../engine';

function mkState(): GameState {
  const state = createGame({
    seed: 42,
    players: [
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
    ],
  });
  state.players[0].hand = ['money_1#x1', 'money_2#x2', 'money_3#x3', 'money_4#x4', 'money_5#x5'];
  state.players[1].hand = ['money_1#y1'];
  state.turn.phase = 'action';
  state.turn.playsUsed = 0;
  state.currentPlayerIndex = 0;
  state.pending = null;
  return state;
}

describe('engine basics', () => {
  it('creates a game with starting hands', () => {
    const state = createGame({
      seed: 99,
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
        { id: 'p3', name: 'C' },
      ],
    });

    expect(state.players).toHaveLength(3);
    expect(state.players.every((player) => player.hand.length === 5)).toBe(true);
  });

  it('enforces max 3 plays per turn', () => {
    let state = mkState();

    state = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_1#x1' }).state;
    state = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_2#x2' }).state;
    state = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_3#x3' }).state;

    const fourth = applyAction(state, { type: 'play_to_bank', playerId: 'p1', cardId: 'money_4#x4' });
    expect(fourth.error?.code).toBe('illegal_play_limit');
  });

  it('supports just say no chain and cancellation', () => {
    const state = mkState();
    state.players[0].hand = ['debt_collector#d1', 'just_say_no#j2'];
    state.players[1].hand = ['just_say_no#j1'];

    let next = applyAction(state, {
      type: 'play_action',
      playerId: 'p1',
      cardId: 'debt_collector#d1',
      targetPlayerId: 'p2',
    }).state;

    expect(next.pending?.kind).toBe('counter');

    next = applyAction(next, {
      type: 'counter_response',
      playerId: 'p2',
      useJustSayNo: true,
      cardId: 'just_say_no#j1',
    }).state;

    next = applyAction(next, {
      type: 'counter_response',
      playerId: 'p1',
      useJustSayNo: true,
      cardId: 'just_say_no#j2',
    }).state;

    next = applyAction(next, {
      type: 'counter_response',
      playerId: 'p2',
      useJustSayNo: false,
    }).state;

    expect(next.pending?.kind).toBe('payment');
  });

  it('detects winner at 3 complete sets', () => {
    const state = mkState();
    state.players[0].properties.brown = [
      { cardId: 'brown_1#a', assignedColor: 'brown' },
      { cardId: 'brown_1#b', assignedColor: 'brown' },
    ];
    state.players[0].properties.dark_blue = [
      { cardId: 'dark_blue_1#a', assignedColor: 'dark_blue' },
      { cardId: 'dark_blue_1#b', assignedColor: 'dark_blue' },
    ];
    state.players[0].properties.utility = [
      { cardId: 'utility_1#a', assignedColor: 'utility' },
      { cardId: 'utility_1#b', assignedColor: 'utility' },
    ];

    const legal = getLegalActions(state, 'p1');
    expect(legal.length).toBeGreaterThan(0);

    const result = applyAction(state, { type: 'pass_turn', playerId: 'p1' });
    expect(isGameOver(result.state).done).toBe(true);
    expect(isGameOver(result.state).winnerId).toBe('p1');
  });

  it("resolves It's My Birthday against all opponents in sequence", () => {
    const state = createGame({
      seed: 7,
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
        { id: 'p3', name: 'C' },
      ],
    });
    state.currentPlayerIndex = 0;
    state.turn.phase = 'action';
    state.turn.playsUsed = 0;
    state.pending = null;
    state.players[0].hand = ['its_my_birthday#b1'];
    state.players[0].bank = [];
    state.players[1].bank = ['money_2#p2m1'];
    state.players[2].bank = ['money_2#p3m1'];

    let next = applyAction(state, {
      type: 'play_action',
      playerId: 'p1',
      cardId: 'its_my_birthday#b1',
    }).state;

    expect(next.pending?.kind).toBe('payment');
    if (!next.pending || next.pending.kind !== 'payment') {
      throw new Error('Expected payment pending after birthday.');
    }
    expect(next.pending.payload.targetPlayerId).toBe('p2');
    expect(next.turn.playsUsed).toBe(1);

    next = applyAction(next, {
      type: 'pay_request',
      playerId: 'p2',
      cards: ['money_2#p2m1'],
    }).state;

    expect(next.pending?.kind).toBe('payment');
    if (!next.pending || next.pending.kind !== 'payment') {
      throw new Error('Expected second payment pending after first birthday payment.');
    }
    expect(next.pending.payload.targetPlayerId).toBe('p3');

    next = applyAction(next, {
      type: 'pay_request',
      playerId: 'p3',
      cards: ['money_2#p3m1'],
    }).state;

    expect(next.pending).toBeNull();
    expect(next.currentPlayerIndex).toBe(0);
    expect(next.turn.phase).toBe('action');
    expect(next.turn.playsUsed).toBe(1);
    expect(next.players[0].bank).toEqual(expect.arrayContaining(['money_2#p2m1', 'money_2#p3m1']));
  });

  it("continues It's My Birthday chain after Just Say No cancellation", () => {
    const state = createGame({
      seed: 11,
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
        { id: 'p3', name: 'C' },
      ],
    });
    state.currentPlayerIndex = 0;
    state.turn.phase = 'action';
    state.turn.playsUsed = 0;
    state.pending = null;
    state.players[0].hand = ['its_my_birthday#b1'];
    state.players[1].hand = ['just_say_no#j1'];
    state.players[1].bank = ['money_2#p2m1'];
    state.players[2].bank = ['money_2#p3m1'];

    let next = applyAction(state, {
      type: 'play_action',
      playerId: 'p1',
      cardId: 'its_my_birthday#b1',
    }).state;

    expect(next.pending?.kind).toBe('counter');
    if (!next.pending || next.pending.kind !== 'counter') {
      throw new Error('Expected counter pending.');
    }

    next = applyAction(next, {
      type: 'counter_response',
      playerId: 'p2',
      useJustSayNo: true,
      cardId: 'just_say_no#j1',
    }).state;

    next = applyAction(next, {
      type: 'counter_response',
      playerId: 'p1',
      useJustSayNo: false,
    }).state;

    expect(next.pending?.kind).toBe('payment');
    if (!next.pending || next.pending.kind !== 'payment') {
      throw new Error('Expected payment for the next target after cancellation.');
    }
    expect(next.pending.payload.targetPlayerId).toBe('p3');

    next = applyAction(next, {
      type: 'pay_request',
      playerId: 'p3',
      cards: ['money_2#p3m1'],
    }).state;

    expect(next.pending).toBeNull();
    expect(next.players[0].bank).toEqual(expect.arrayContaining(['money_2#p3m1']));
    expect(next.currentPlayerIndex).toBe(0);
  });

  it('does not expose hand play actions after 3 plays are used', () => {
    const state = mkState();
    state.turn.playsUsed = 3;
    state.players[0].hand = ['money_1#x1', 'debt_collector#x2'];

    const legal = getLegalActions(state, 'p1');
    const handPlayActions = legal.filter((item) =>
      item.action.type === 'play_to_bank' || item.action.type === 'play_property' || item.action.type === 'play_action',
    );

    expect(handPlayActions).toHaveLength(0);
    expect(legal.some((item) => item.action.type === 'pass_turn')).toBe(true);
  });

  it('filters impossible targeted action options from legal actions', () => {
    const state = createGame({
      seed: 22,
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
      ],
    });
    state.currentPlayerIndex = 0;
    state.turn.phase = 'action';
    state.turn.playsUsed = 0;
    state.pending = null;
    state.players[0].hand = ['sly_deal#s1', 'forced_deal#f1', 'deal_breaker#d1'];
    state.players[0].properties.brown = [];
    state.players[1].properties.brown = [];

    const legal = getLegalActions(state, 'p1');
    const targeted = legal.filter((item) => item.action.type === 'play_action');

    expect(targeted).toHaveLength(0);
  });

  it('rejects invalid targeted action before consuming action card', () => {
    const state = createGame({
      seed: 23,
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
      ],
    });
    state.currentPlayerIndex = 0;
    state.turn.phase = 'action';
    state.turn.playsUsed = 0;
    state.pending = null;
    state.players[0].hand = ['forced_deal#f1'];
    state.players[0].properties.brown = [];
    state.players[1].properties.brown = [];

    const result = applyAction(state, {
      type: 'play_action',
      playerId: 'p1',
      cardId: 'forced_deal#f1',
      targetPlayerId: 'p2',
    });

    expect(result.error?.code).toBe('invalid_action');
    expect(result.state.players[0].hand).toContain('forced_deal#f1');
    expect(result.state.discardPile).not.toContain('forced_deal#f1');
  });

  it('includes rent metadata for each target and flags likely property transfer', () => {
    const state = createGame({
      seed: 24,
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
        { id: 'p3', name: 'C' },
      ],
    });
    state.currentPlayerIndex = 0;
    state.turn.phase = 'action';
    state.turn.playsUsed = 0;
    state.pending = null;
    state.players[0].hand = ['rent_color#r1'];
    state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];
    state.players[1].bank = ['money_1#p2m1'];
    state.players[1].properties.brown = [];
    state.players[2].bank = [];
    state.players[2].properties.brown = [{ cardId: 'brown_1#p3b1', assignedColor: 'brown' }];

    const afterRent = applyAction(state, {
      type: 'play_action',
      playerId: 'p1',
      cardId: 'rent_color#r1',
      color: 'brown',
    }).state;

    const legal = getLegalActions(afterRent, 'p1').filter((item) => item.action.type === 'play_action');
    const targetB = legal.find((item) => item.targetPlayerId === 'p2');
    const targetC = legal.find((item) => item.targetPlayerId === 'p3');

    expect(targetB?.requestedAmount).toBe(1);
    expect(targetB?.collectibleCap).toBe(1);
    expect(targetB?.requiresPropertyTransfer).toBe(false);

    expect(targetC?.requestedAmount).toBe(1);
    expect(targetC?.collectibleCap).toBe(1);
    expect(targetC?.requiresPropertyTransfer).toBe(true);
  });

  it('requires discard when ending a turn above hand limit', () => {
    const state = createGame({
      seed: 29,
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
      ],
    });
    state.currentPlayerIndex = 0;
    state.turn.phase = 'action';
    state.turn.playsUsed = 3;
    state.pending = null;
    state.players[0].hand = [
      'money_1#x1',
      'money_2#x2',
      'money_3#x3',
      'money_4#x4',
      'money_5#x5',
      'pass_go#x6',
      'rent_color#x7',
      'debt_collector#x8',
    ];

    const blockedPass = applyAction(state, { type: 'pass_turn', playerId: 'p1' });
    expect(blockedPass.error?.code).toBe('hand_limit');

    const legal = getLegalActions(state, 'p1');
    expect(legal.length).toBe(8);
    expect(legal.every((item) => item.action.type === 'discard_card')).toBe(true);

    const afterDiscard = applyAction(state, { type: 'discard_card', playerId: 'p1', cardId: 'money_1#x1' }).state;
    expect(afterDiscard.players[0].hand.length).toBe(7);
    expect(afterDiscard.discardPile).toContain('money_1#x1');

    const passAfterDiscard = applyAction(afterDiscard, { type: 'pass_turn', playerId: 'p1' });
    expect(passAfterDiscard.error).toBeUndefined();
    expect(passAfterDiscard.state.currentPlayerIndex).toBe(1);
  });

  it('uses friendly labels in forced deal pending actions', () => {
    const state = createGame({
      seed: 25,
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
      ],
    });
    state.currentPlayerIndex = 0;
    state.turn.phase = 'action';
    state.pending = {
      kind: 'forced_deal',
      payload: { sourcePlayerId: 'p1', targetPlayerId: 'p2', actionCardId: 'forced_deal#fd1' },
    };
    state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];
    state.players[1].properties.light_blue = [{ cardId: 'light_blue_1#p2l1', assignedColor: 'light_blue' }];

    const legal = getLegalActions(state, 'p1');
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((item) => !item.label.includes('#'))).toBe(true);
  });

  it('does not allow double rent without a playable rent follow-up', () => {
    const state = mkState();
    state.players[0].hand = ['double_rent#d1', 'money_1#m1'];
    state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];

    const legal = getLegalActions(state, 'p1');
    expect(legal.some((item) => item.action.type === 'play_action' && item.action.cardId === 'double_rent#d1')).toBe(false);

    const result = applyAction(state, {
      type: 'play_action',
      playerId: 'p1',
      cardId: 'double_rent#d1',
    });
    expect(result.error?.code).toBe('invalid_action');
    expect(result.state.players[0].hand).toContain('double_rent#d1');
  });

  it('does not allow double rent when only one play remains', () => {
    const state = mkState();
    state.turn.playsUsed = 2;
    state.players[0].hand = ['double_rent#d1', 'rent_color#r1'];
    state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];

    const legal = getLegalActions(state, 'p1');
    expect(legal.some((item) => item.action.type === 'play_action' && item.action.cardId === 'double_rent#d1')).toBe(false);
  });

  it('allows double rent only when a rent card can still be played this turn', () => {
    const state = mkState();
    state.players[0].hand = ['double_rent#d1', 'rent_color#r1'];
    state.players[0].properties.brown = [{ cardId: 'brown_1#p1b1', assignedColor: 'brown' }];

    const legal = getLegalActions(state, 'p1');
    expect(legal.some((item) => item.action.type === 'play_action' && item.action.cardId === 'double_rent#d1')).toBe(true);
  });
});
