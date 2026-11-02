import { describe, expect, it } from 'vitest';
import { chooseHeuristicAction } from '../ai';
import { createGame, getLegalActions, getSuggestedPaymentCards, type GameState } from '../engine';

function table(): GameState {
  const state = createGame({ seed: 3, players: [{ id: 'p1', name: 'Ann', controller: 'bot' }, { id: 'p2', name: 'Bo' }] });
  state.turn.phase = 'action';
  state.currentPlayerIndex = 0;
  const me = state.players[0];
  me.hand = [];
  me.bank = [];
  return state;
}

const place = (color: 'red' | 'pink' | 'green', ...cards: string[]) => cards.map((cardId) => ({ cardId, assignedColor: color }));

describe('Auto-Select', () => {
  it('pays from the bank before giving up a property, even overpaying', () => {
    const state = table();
    state.players[0].bank = ['money_5#a'];
    state.players[0].properties.red = place('red', 'red_1#a');
    expect(getSuggestedPaymentCards(state, 'p1', 3)).toEqual(['money_5#a']);
  });

  it('adds bank cards up rather than hand over an exact property', () => {
    const state = table();
    state.players[0].bank = ['money_1#a', 'money_2#a'];
    state.players[0].properties.red = place('red', 'red_1#a');
    expect(getSuggestedPaymentCards(state, 'p1', 3).sort()).toEqual(['money_1#a', 'money_2#a']);
  });

  it('spends plain money before a banked action card of the same value', () => {
    const state = table();
    state.players[0].bank = ['deal_breaker#a', 'money_5#a'];
    expect(getSuggestedPaymentCards(state, 'p1', 5)).toEqual(['money_5#a']);
  });

  it('breaks a complete set only when nothing else covers it', () => {
    const state = table();
    state.players[0].properties.red = place('red', 'red_1#a', 'red_1#b', 'red_1#c');
    state.players[0].properties.pink = place('pink', 'pink_1#a');
    expect(getSuggestedPaymentCards(state, 'p1', 2)).toEqual(['pink_1#a']);
    const short = table();
    short.players[0].properties.red = place('red', 'red_1#a', 'red_1#b', 'red_1#c');
    short.players[0].properties.pink = place('pink', 'pink_1#a');
    expect(getSuggestedPaymentCards(short, 'p1', 4)).toContain('pink_1#a');
  });

  it('hands over everything when the debt is more than the player has', () => {
    const state = table();
    state.players[0].bank = ['money_1#a'];
    state.players[0].properties.pink = place('pink', 'pink_1#a');
    expect(getSuggestedPaymentCards(state, 'p1', 10).sort()).toEqual(['money_1#a', 'pink_1#a']);
  });
});

describe('bots and a timed-out turn', () => {
  it('keeps a Deal Breaker in hand rather than bank it', () => {
    const state = table();
    state.players[0].hand = ['deal_breaker#a'];
    const choice = chooseHeuristicAction(state, 'p1', getLegalActions(state, 'p1'));
    expect(choice?.action.type).toBe('pass_turn');
  });

  it('keeps a Just Say No too', () => {
    const state = table();
    state.players[0].hand = ['just_say_no#a'];
    expect(chooseHeuristicAction(state, 'p1', getLegalActions(state, 'p1'))?.action.type).toBe('pass_turn');
  });

  it('banks ordinary money', () => {
    const state = table();
    state.players[0].hand = ['money_5#a'];
    expect(chooseHeuristicAction(state, 'p1', getLegalActions(state, 'p1'))?.action.type).toBe('play_to_bank');
  });

  it('banks a premium card when the hand is over the limit', () => {
    const state = table();
    state.players[0].hand = ['deal_breaker#a', ...Array.from({ length: 8 }, (_, index) => `just_say_no#${index}`)];
    expect(chooseHeuristicAction(state, 'p1', getLegalActions(state, 'p1'))?.action.type).toBe('play_to_bank');
  });

  it('pays a rent the sensible way', () => {
    const state = table();
    state.players[0].bank = ['money_1#a', 'money_2#a'];
    state.players[0].properties.red = place('red', 'red_1#a');
    state.pending = {
      kind: 'payment',
      payload: { sourcePlayerId: 'p2', targetPlayerId: 'p1', amount: 3, reason: 'Rent', remainingTargets: [] },
    } as unknown as GameState['pending'];
    const choice = chooseHeuristicAction(state, 'p1', getLegalActions(state, 'p1'));
    expect(choice?.action.type).toBe('pay_request');
    expect((choice?.action as { cards: string[] }).cards.sort()).toEqual(['money_1#a', 'money_2#a']);
  });
});
