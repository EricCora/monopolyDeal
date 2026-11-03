import { describe, expect, it } from 'vitest';
import { createGame, getLegalActions, type GameState, type LegalAction } from '../engine';
import { collapseShackPlacements } from '../ui/shackOptions';

function shackTurn(): GameState {
  const state = createGame({
    seed: 7301,
    variant: 'no_mercy',
    players: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
  } as Parameters<typeof createGame>[0]);
  const player = state.players[0];
  state.currentPlayerIndex = 0;
  state.pending = null;
  state.turn = { phase: 'action', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
  player.hand = ['shack#1'];
  player.properties.orange = [
    { cardId: 'orange_1#1', assignedColor: 'orange', setId: 'orange-1' },
    { cardId: 'orange_1#2', assignedColor: 'orange', setId: 'orange-1' },
    { cardId: 'orange_1#3', assignedColor: 'orange', setId: 'orange-1' },
  ];
  player.properties.light_blue = [
    { cardId: 'light_blue_1#1', assignedColor: 'light_blue', setId: 'light-1' },
    { cardId: 'light_blue_1#2', assignedColor: 'light_blue', setId: 'light-1' },
    { cardId: 'light_blue_1#3', assignedColor: 'light_blue', setId: 'light-1' },
  ];
  return state;
}

const placements = (actions: LegalAction[]) => actions.filter((item) => item.action.type === 'play_property');

describe('Shack choices', () => {
  it('has one placement per property in the engine', () => {
    expect(placements(getLegalActions(shackTurn(), 'p1'))).toHaveLength(6);
  });

  it('shows one choice per set, not one per card in it', () => {
    const collapsed = collapseShackPlacements(getLegalActions(shackTurn(), 'p1'));
    const colors = placements(collapsed).map((item) => (item.action.type === 'play_property' ? item.action.color : null));
    expect(colors.sort()).toEqual(['light_blue', 'orange']);
  });

  it('keeps every other action, in order', () => {
    const all = getLegalActions(shackTurn(), 'p1');
    const collapsed = collapseShackPlacements(all);
    expect(collapsed.filter((item) => item.action.type !== 'play_property')).toEqual(all.filter((item) => item.action.type !== 'play_property'));
    expect(collapsed.every((item) => all.includes(item))).toBe(true);
  });

  it('leaves ordinary property plays alone', () => {
    const state = shackTurn();
    state.players[0].hand = ['orange_1#4', 'brown_1#1'];
    const all = getLegalActions(state, 'p1');
    expect(collapseShackPlacements(all)).toEqual(all);
  });
});
