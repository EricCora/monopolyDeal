import { describe, expect, it } from 'vitest';
import { createGame, getLegalActions, getNextPrompt, type GameState, type PlayerState } from '../engine';
import { playRestriction } from '../engine/playRestriction';
import { shouldAskFirst } from '../ui/tapPolicy';

const EMPTY_PROPERTIES = (): PlayerState['properties'] => ({
  brown: [], light_blue: [], pink: [], orange: [], red: [], yellow: [], green: [], dark_blue: [], railroad: [], utility: [],
});

function mainPhaseGame(hand: string[], variant: 'classic' | 'no_mercy' = 'classic'): GameState {
  const game = createGame({ players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bob' }], seed: 7, variant });
  game.players[0].hand = hand;
  game.players.forEach((player) => {
    player.properties = EMPTY_PROPERTIES();
    player.bank = [];
  });
  game.turn.phase = 'action';
  game.turn.playsUsed = 0;
  return game;
}

describe('playRestriction', () => {
  it('names whose turn it is when it is not yours', () => {
    const game = mainPhaseGame(['money_1#x']);
    expect(playRestriction(game, 'p2', 'money_1#x')).toBe("It's Ann's turn.");
  });

  it('asks for the draw first', () => {
    const game = mainPhaseGame(['house#x']);
    game.turn.phase = 'draw';
    expect(getNextPrompt(game).kind).toBe('draw');
    expect(playRestriction(game, 'p1', 'house#x')).toBe('Draw your cards first.');
  });

  it('says when the plays are used up', () => {
    const game = mainPhaseGame(['house#x']);
    game.turn.playsUsed = 3;
    expect(playRestriction(game, 'p1', 'house#x')).toBe("You've used all 3 plays this turn.");
  });

  it('explains a House with no complete set, and has nothing to say once one is buildable', () => {
    const game = mainPhaseGame(['house#x']);
    expect(playRestriction(game, 'p1', 'house#x')).toBe('A House needs a complete set.');

    game.players[0].properties.brown = [
      { cardId: 'brown_1#1', assignedColor: 'brown' },
      { cardId: 'brown_1#2', assignedColor: 'brown' },
    ];
    expect(getLegalActions(game, 'p1').some(({ action }) => action.type === 'play_property' && action.cardId === 'house#x')).toBe(true);
    expect(playRestriction(game, 'p1', 'house#x')).toBeNull();
  });

  it("explains Sly Deal with nothing to take, and has nothing to say when there's a target", () => {
    const game = mainPhaseGame(['sly_deal#x']);
    expect(playRestriction(game, 'p1', 'sly_deal#x')).toBe('No opponent has a property outside a complete set.');

    game.players[1].properties.brown = [{ cardId: 'brown_1#1', assignedColor: 'brown' }];
    expect(playRestriction(game, 'p1', 'sly_deal#x')).toBeNull();
  });

  it('explains Just Say No and Deal Breaker when they have no use', () => {
    const game = mainPhaseGame(['just_say_no#x', 'deal_breaker#x']);
    expect(playRestriction(game, 'p1', 'just_say_no#x')).toBe('Save Just Say No to block an action against you.');
    expect(playRestriction(game, 'p1', 'deal_breaker#x')).toBe('No opponent has a complete set.');
  });

  it('has nothing to say about money, or during a discard', () => {
    const game = mainPhaseGame(['money_1#x']);
    expect(playRestriction(game, 'p1', 'money_1#x')).toBeNull();
  });
});

describe('shouldAskFirst', () => {
  const bank = { type: 'play_to_bank', playerId: 'p1', cardId: 'x' } as const;
  const discard = { type: 'discard_card', playerId: 'p1', cardId: 'x' } as const;

  it('lets one touch play money and properties', () => {
    expect(shouldAskFirst('money_1#x', bank, 'touch', 'classic')).toBe(false);
    expect(shouldAskFirst('brown_1#x', { type: 'play_property', playerId: 'p1', cardId: 'x', color: 'brown' }, 'touch', 'classic')).toBe(false);
  });

  it('asks first on a touch screen for an action card with one option', () => {
    expect(shouldAskFirst('deal_breaker#x', bank, 'touch', 'classic')).toBe(true);
  });

  it('asks first on a touch screen for a discard or a debt repayment, even of money', () => {
    expect(shouldAskFirst('money_1#x', discard, 'touch', 'classic')).toBe(true);
    expect(shouldAskFirst('money_1#x', { type: 'repay_debt', playerId: 'p1', cardId: 'x' }, 'touch', 'no_mercy')).toBe(true);
  });

  it('never asks a mouse or keyboard player, who can\'t mis-tap', () => {
    expect(shouldAskFirst('deal_breaker#x', bank, 'pointer', 'classic')).toBe(false);
    expect(shouldAskFirst('money_1#x', discard, 'pointer', 'classic')).toBe(false);
  });
});
