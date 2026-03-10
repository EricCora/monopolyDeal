import { createDevStatsFixture, type LifetimeStatsV1, type MatchRecordV1 } from '../../stats';

export interface StatsFixture {
  history: MatchRecordV1[];
  lifetime: LifetimeStatsV1;
}

function edgeFixture(): StatsFixture {
  return {
    history: [
      {
        id: 'edge-1',
        startedAt: 1_700_100_000_000,
        endedAt: 1_700_100_005_000,
        players: ['Solo'],
        turnCount: 5,
        durationSec: 5,
        actionsByType: {},
        mode: 'hot_seat',
        surface: 'local',
      },
    ],
    lifetime: {
      version: 1,
      players: {
        Solo: {
          name: 'Solo',
          gamesPlayed: 1,
          wins: 0,
          totalTurns: 5,
          totalDurationSec: 5,
          actionsByType: {},
        },
      },
    },
  };
}

export function createStatsFixture(kind: 'medium' | 'edge' | 'empty' = 'medium'): StatsFixture {
  if (kind === 'medium') return createDevStatsFixture('medium');
  if (kind === 'edge') return edgeFixture();
  return { history: [], lifetime: { version: 1, players: {} } };
}
