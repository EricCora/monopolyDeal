import { describe, expect, it } from 'vitest';
import { createGame, type Action } from '../engine';
import { buildLogTurns, filterLogTurns } from '../ui/table/gameLog';
import { orderRentChoices } from '../ui/table/rentChoices';

describe('a rent card with several colors', () => {
  it('lists what earns most first, says how much, and leaves banking where it was', () => {
    const game = createGame({ seed: 1, players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: 'Bo' }] });
    const me = game.players[0];
    me.properties.brown = [{ cardId: 'brown_1#a', assignedColor: 'brown' }];
    me.properties.red = ['red_1#a', 'red_1#b'].map((cardId) => ({ cardId, assignedColor: 'red' as const }));
    me.properties.light_blue = [{ cardId: 'light_blue_1#a', assignedColor: 'light_blue' }];
    const rent = (color: 'brown' | 'red' | 'light_blue') => ({
      label: `Charge ${color}`,
      action: { type: 'play_action', playerId: 'p1', cardId: 'rent_color#a', color, targetPlayerId: 'p2' } as Action,
    });
    const bank: { label: string; action: Action; description?: string } = { label: 'Bank', action: { type: 'play_to_bank', playerId: 'p1', cardId: 'rent_color#a' } as Action };
    const ordered = orderRentChoices([bank, rent('brown'), rent('light_blue'), rent('red')], game, 'p1', 'classic');
    expect(ordered.map((choice) => choice.label)).toEqual(['Bank', 'Charge red', 'Charge brown', 'Charge light_blue']);
    const described = ordered as Array<{ description?: string }>;
    expect(described[1].description).toContain('$3');
    expect(described[0].description).toBeUndefined();
  });
});

describe('the game log', () => {
  const events = [
    { type: 'draw', message: 'Ann drew 2 cards.', timestamp: 1 },
    { type: 'bank', message: 'Ann banked M1.', timestamp: 2 },
    { type: 'turn_passed', message: 'Ann ended their turn.', timestamp: 3 },
    { type: 'draw', message: 'Bot 10 drew 2 cards.', timestamp: 4 },
  ] as Parameters<typeof buildLogTurns>[0];

  it('groups by turn, newest first, and names who played it', () => {
    const turns = buildLogTurns(events, ['Ann', 'Bot 1', 'Bot 10']);
    expect(turns.map((turn) => [turn.number, turn.playerName, turn.isCurrent])).toEqual([[2, 'Bot 10', true], [1, 'Ann', false]]);
    expect(turns[1].entries[0].message).toBe('Ann ended their turn.');
  });

  it('filters by kind and drops turns with nothing left', () => {
    const turns = filterLogTurns(buildLogTurns(events, ['Ann']), 'money');
    expect(turns).toHaveLength(1);
    expect(turns[0].entries.map((entry) => entry.message)).toEqual(['Ann banked M1.']);
  });
});
