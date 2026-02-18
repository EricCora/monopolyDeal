import { describe, expect, it } from 'vitest';
import type { PropertyColor } from '../cards/catalog';
import type { GameEvent, GameState, PlayerState } from '../engine';
import type { LifetimeStatsV1 } from '../stats';
import { buildPostGameSummary } from '../stats';

function emptyProperties(): PlayerState['properties'] {
  return {
    brown: [],
    light_blue: [],
    pink: [],
    orange: [],
    red: [],
    yellow: [],
    green: [],
    dark_blue: [],
    railroad: [],
    utility: [],
  };
}

function withProperty(player: PlayerState, color: PropertyColor, cardId: string): PlayerState {
  return {
    ...player,
    properties: {
      ...player.properties,
      [color]: [...player.properties[color], { cardId, assignedColor: color }],
    },
  };
}

function createPlayer(id: string, name: string): PlayerState {
  return {
    id,
    name,
    hand: [],
    bank: [],
    properties: emptyProperties(),
  };
}

function createState(players: PlayerState[], history: GameEvent[], winnerId?: string): GameState {
  return {
    version: 1,
    createdAt: 1_000,
    updatedAt: 13_000,
    deckVersion: 'v1',
    players,
    drawPile: [],
    discardPile: [],
    currentPlayerIndex: 0,
    turn: { phase: 'finished', playsUsed: 0, doubleRentMultiplier: 1 },
    pending: null,
    history,
    winnerId,
    turnCount: 14,
  };
}

describe('buildPostGameSummary', () => {
  it('extracts winner and aggregate metrics', () => {
    const p1 = withProperty(withProperty(withProperty(createPlayer('p1', 'Alpha'), 'brown', 'brown_1#a1'), 'brown', 'brown_1#a2'), 'dark_blue', 'dark_blue_1#a3');
    const p2 = withProperty(createPlayer('p2', 'Beta'), 'brown', 'brown_1#b1');
    p1.bank = ['money_5#a4'];
    p1.hand = ['money_1#a5'];
    p2.bank = ['money_2#b2'];
    p2.hand = ['money_1#b3', 'money_1#b4'];

    const history: GameEvent[] = [
      { timestamp: 10_000, type: 'draw', message: 'Alpha drew 2 cards.' },
      { timestamp: 11_500, type: 'action', message: 'Alpha played Rent.' },
      { timestamp: 12_000, type: 'rent_target', message: 'Alpha charged Beta $3 rent.' },
    ];

    const lifetime: LifetimeStatsV1 = {
      version: 1,
      players: {
        Alpha: {
          name: 'Alpha',
          gamesPlayed: 9,
          wins: 4,
          totalTurns: 0,
          totalDurationSec: 0,
          actionsByType: {},
        },
      },
    };

    const summary = buildPostGameSummary(createState([p1, p2], history, 'p1'), lifetime);

    expect(summary.winnerId).toBe('p1');
    expect(summary.winnerName).toBe('Alpha');
    expect(summary.durationSec).toBe(12);
    expect(summary.turnCount).toBe(14);
    expect(summary.totalEvents).toBe(3);
    expect(summary.players[0].name).toBe('Alpha');
    expect(summary.players[0].rank).toBe(1);
    expect(summary.players[0].lifetimeWins).toBe(4);
    expect(summary.winningMove).toBe('Alpha charged Beta $3 rent.');
    expect(summary.momentumShift).toContain('rent sequence');
    expect(summary.highlightCards).toContain('Rent');
    expect(summary.recentEvents).toHaveLength(3);
    expect(summary.recentEvents[0].message).toBe('Alpha charged Beta $3 rent.');
  });

  it('ranks players by sets, bank, property count, then hand count', () => {
    let p1 = createPlayer('p1', 'Alpha');
    let p2 = createPlayer('p2', 'Beta');
    let p3 = createPlayer('p3', 'Gamma');

    p1 = withProperty(withProperty(withProperty(withProperty(withProperty(withProperty(withProperty(p1, 'brown', 'brown_1#a1'), 'brown', 'brown_1#a2'), 'light_blue', 'light_blue_1#a3'), 'light_blue', 'light_blue_1#a4'), 'light_blue', 'light_blue_1#a5'), 'dark_blue', 'dark_blue_1#a6'), 'dark_blue', 'dark_blue_1#a7');
    p2 = withProperty(withProperty(withProperty(withProperty(p2, 'brown', 'brown_1#b1'), 'brown', 'brown_1#b2'), 'dark_blue', 'dark_blue_1#b3'), 'dark_blue', 'dark_blue_1#b4');
    p3 = withProperty(withProperty(withProperty(withProperty(p3, 'brown', 'brown_1#c1'), 'brown', 'brown_1#c2'), 'dark_blue', 'dark_blue_1#c3'), 'dark_blue', 'dark_blue_1#c4');

    p2.bank = ['money_5#b5'];
    p3.bank = ['money_5#c5'];
    p2.hand = ['money_1#b6', 'money_2#b7', 'money_1#b8'];
    p3.hand = ['money_1#c6'];

    const summary = buildPostGameSummary(createState([p1, p2, p3], [], 'p1'), { version: 1, players: {} });
    expect(summary.players.map((player) => player.playerId)).toEqual(['p1', 'p3', 'p2']);
  });

  it('uses the last impactful event as final swing highlight', () => {
    const p1 = createPlayer('p1', 'Alpha');
    const p2 = createPlayer('p2', 'Beta');
    const history: GameEvent[] = [
      { timestamp: 10_000, type: 'draw', message: 'Alpha drew cards.' },
      { timestamp: 10_200, type: 'turn_passed', message: 'Alpha ended turn.' },
      { timestamp: 10_500, type: 'action', message: 'Beta played Debt Collector.' },
      { timestamp: 10_900, type: 'pay', message: 'Alpha paid Beta $5.' },
      { timestamp: 11_000, type: 'turn_passed', message: 'Beta ended turn.' },
    ];

    const summary = buildPostGameSummary(createState([p1, p2], history, 'p2'), { version: 1, players: {} });
    expect(summary.finalSwing).toBe('Alpha paid Beta $5.');
  });

  it('extracts deterministic recap fields for a deal breaker finish', () => {
    const p1 = createPlayer('p1', 'Alpha');
    const p2 = createPlayer('p2', 'Beta');
    const history: GameEvent[] = [
      { timestamp: 10_100, type: 'action', message: 'Alpha played Deal Breaker on Beta.' },
      { timestamp: 10_200, type: 'deal_breaker', message: "Alpha stole Beta's dark_blue set." },
    ];

    const summary = buildPostGameSummary(createState([p1, p2], history, 'p1'), { version: 1, players: {} });
    expect(summary.winningMove).toBe("Alpha stole Beta's dark_blue set.");
    expect(summary.momentumShift).toContain('Deal Breaker');
    expect(summary.highlightCards).toContain('Deal Breaker');
  });

  it('extracts deterministic recap fields for a set-completion finish', () => {
    const p1 = createPlayer('p1', 'Alpha');
    const p2 = createPlayer('p2', 'Beta');
    const history: GameEvent[] = [
      { timestamp: 10_100, type: 'property', message: 'Alpha placed Dark Blue Property in Dark Blue.' },
      { timestamp: 10_250, type: 'property', message: 'Alpha placed Brown Property in Brown.' },
    ];

    const summary = buildPostGameSummary(createState([p1, p2], history, 'p1'), { version: 1, players: {} });
    expect(summary.winningMove).toBe('Alpha placed Brown Property in Brown.');
    expect(summary.momentumShift).toContain('property play');
    expect(summary.highlightCards).toContain('Brown Property');
  });
});
