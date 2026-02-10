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
});
