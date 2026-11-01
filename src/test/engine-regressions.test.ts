import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getLegalActions, isGameOver, type GameState } from '../engine';

function game(variant: 'classic' | 'no_mercy', players = 2, seed = 7301): GameState {
  return createGame({
    seed,
    variant,
    players: Array.from({ length: players }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` })),
  } as Parameters<typeof createGame>[0]);
}

function debtTurn(state: GameState, debts: number, playsUsed: number, hand: string[]): void {
  const debtor = state.players[0];
  const creditor = state.players[1];
  state.currentPlayerIndex = 0;
  state.pending = null;
  state.turn = { phase: 'debt', playsUsed, doubleRentMultiplier: 1, endingTurn: false };
  debtor.hand = hand;
  debtor.debtsOwed = Array.from({ length: debts }, (_, index) => ({ id: `d${index}`, chipId: `d${index}`, creditorPlayerId: creditor.id }));
  creditor.debtChipsHeld = [...debtor.debtsOwed];
  creditor.debtChips = creditor.debtChipsHeld;
}

function moneyInHand(state: GameState, count: number): string[] {
  const money = state.drawPile.filter((id) => id.startsWith('money_')).slice(0, count);
  state.drawPile = state.drawPile.filter((id) => !money.includes(id));
  return money;
}

describe('No Mercy debt phase cannot soft-lock', () => {
  it('lets the player pass when the last play is spent with a debt still owed', () => {
    const state = game('no_mercy');
    const hand = moneyInHand(state, 2);
    debtTurn(state, 2, 2, hand);
    const result = applyAction(state, { type: 'repay_debt', playerId: 'p1', debtId: 'd0', cardId: hand[0] });
    expect(result.error).toBeUndefined();
    expect(result.state.players[0].debtsOwed).toHaveLength(1);
    expect(getLegalActions(result.state, 'p1').map((entry) => entry.action.type)).toContain('pass_turn');
  });

  it('lets the player pass when the hand runs out with a debt still owed', () => {
    const state = game('no_mercy');
    const hand = moneyInHand(state, 1);
    debtTurn(state, 2, 0, hand);
    const result = applyAction(state, { type: 'repay_debt', playerId: 'p1', debtId: 'd0', cardId: hand[0] });
    expect(result.error).toBeUndefined();
    expect(getLegalActions(result.state, 'p1').map((entry) => entry.action.type)).toContain('pass_turn');
  });

  it('still requires repayment while the player can pay', () => {
    const state = game('no_mercy');
    const hand = moneyInHand(state, 2);
    debtTurn(state, 2, 0, hand);
    const result = applyAction(state, { type: 'repay_debt', playerId: 'p1', debtId: 'd0', cardId: hand[0] });
    expect(result.state.turn.phase).toBe('debt');
    expect(getLegalActions(result.state, 'p1').every((entry) => entry.action.type === 'repay_debt')).toBe(true);
  });
});

describe('No Mercy Shack placement', () => {
  it('accepts an offered property play that would complete a set holding two Shacks', () => {
    const state = game('no_mercy');
    const player = state.players[0];
    state.currentPlayerIndex = 0;
    state.pending = null;
    state.turn = { phase: 'action', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
    player.properties.red = [
      { cardId: 'red_1#1', assignedColor: 'red', setId: 'red-1' },
      { cardId: 'red_1#2', assignedColor: 'red', setId: 'red-1' },
      { cardId: 'shack#1', assignedColor: 'red', setId: 'red-1', attachedToCardId: 'red_1#1' },
      { cardId: 'shack#2', assignedColor: 'red', setId: 'red-1', attachedToCardId: 'red_1#2' },
    ];
    player.hand = ['red_1#3'];
    const offered = getLegalActions(state, 'p1').find((entry) => entry.action.type === 'play_property' && entry.action.cardId === 'red_1#3');
    expect(offered).toBeDefined();
    const result = applyAction(state, offered!.action);
    expect(result.error).toBeUndefined();
    const placed = result.state.players[0].properties.red.find((entry) => entry.cardId === 'red_1#3');
    expect(placed?.setId).not.toBe('red-1');
  });
});

describe('winning during a No Mercy redistribution', () => {
  it('keeps the undistributed cards in the game', () => {
    const state = game('no_mercy');
    const [recipient, target] = state.players;
    state.currentPlayerIndex = 0;
    state.turn = { phase: 'action', playsUsed: 1, doubleRentMultiplier: 1, endingTurn: false };
    recipient.properties.brown = [
      { cardId: 'brown_1#1', assignedColor: 'brown', setId: 'brown-1' },
      { cardId: 'brown_1#2', assignedColor: 'brown', setId: 'brown-1' },
    ];
    recipient.properties.dark_blue = [
      { cardId: 'dark_blue_1#1', assignedColor: 'dark_blue', setId: 'dark-1' },
      { cardId: 'dark_blue_1#2', assignedColor: 'dark_blue', setId: 'dark-1' },
    ];
    recipient.properties.green = [
      { cardId: 'green_1#1', assignedColor: 'green', setId: 'green-1' },
      { cardId: 'green_1#2', assignedColor: 'green', setId: 'green-1' },
    ];
    state.pending = {
      kind: 'no_mercy',
      payload: {
        sourcePlayerId: recipient.id,
        actionCardId: 'repossession#1',
        effect: 'repossession',
        step: 'repossession_distribute',
        targetPlayerId: target.id,
        targetPlayerIds: [target.id],
        redistribution: [{ cardId: 'green_1#3', color: 'green' }, { cardId: 'money_1#1' }],
      },
    } as GameState['pending'];
    const result = applyAction(state, {
      type: 'no_mercy_pick',
      playerId: target.id,
      actionCardId: 'repossession#1',
      targetPlayerId: target.id,
      cardId: 'green_1#3',
      recipientPlayerId: recipient.id,
    });
    expect(result.error).toBeUndefined();
    expect(result.state.winnerId).toBe(recipient.id);
    expect(result.state.pending).toBeNull();
    expect(result.state.discardPile).toContain('money_1#1');
  });
});

describe('deck exhaustion', () => {
  it('ends the game when no player can ever act again', () => {
    const state = game('classic', 3);
    state.drawPile = [];
    state.discardPile = [];
    state.pending = null;
    state.currentPlayerIndex = 0;
    state.turn = { phase: 'action', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
    state.players.forEach((player) => { player.hand = []; });
    state.players[1].bank = ['money_10#1'];
    const result = applyAction(state, { type: 'pass_turn', playerId: 'p1' });
    expect(result.error).toBeUndefined();
    expect(isGameOver(result.state).done).toBe(true);
    expect(result.state.winnerId).toBe('p2');
    expect(result.state.history.at(-1)?.message).toMatch(/deck/i);
  });

  it('does not end the game while a player still holds a card', () => {
    const state = game('classic', 3);
    state.drawPile = [];
    state.discardPile = [];
    state.pending = null;
    state.currentPlayerIndex = 0;
    state.turn = { phase: 'action', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
    state.players.forEach((player) => { player.hand = []; });
    state.players[2].hand = ['money_1#1'];
    const result = applyAction(state, { type: 'pass_turn', playerId: 'p1' });
    expect(isGameOver(result.state).done).toBe(false);
  });
});
