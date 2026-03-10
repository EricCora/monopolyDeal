import type { LifetimeStatsV1, MatchRecordV1 } from './types';

export interface DevStatsFixture {
  history: MatchRecordV1[];
  lifetime: LifetimeStatsV1;
}

function mediumFixture(): DevStatsFixture {
  const history: MatchRecordV1[] = [
    {
      id: 'm-3',
      startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_060_000,
      players: ['Alpha', 'Beta'],
      winnerId: 'p1',
      winnerName: 'Alpha',
      turnCount: 16,
      durationSec: 600,
      actionsByType: { action: 8, pay: 3, draw: 5 },
      mode: 'hot_seat',
      surface: 'local',
    },
    {
      id: 'm-2',
      startedAt: 1_700_000_100_000,
      endedAt: 1_700_000_130_000,
      players: ['Alpha', 'Beta', 'Gamma'],
      winnerId: 'p2',
      winnerName: 'Beta',
      turnCount: 12,
      durationSec: 300,
      actionsByType: { action: 7, pay: 2, draw: 4 },
      mode: 'live_online',
      surface: 'multiplayer',
      presetId: 'teaching',
      roomCode: 'ROOM2',
    },
    {
      id: 'm-1',
      startedAt: 1_700_000_200_000,
      endedAt: 1_700_000_270_000,
      players: ['Alpha', 'Gamma'],
      winnerId: 'p1',
      winnerName: 'Alpha',
      turnCount: 24,
      durationSec: 700,
      actionsByType: { action: 11, pay: 4, draw: 6 },
      mode: 'practice',
      surface: 'local',
    },
  ];

  const lifetime: LifetimeStatsV1 = {
    version: 1,
    players: {
      Alpha: {
        name: 'Alpha',
        gamesPlayed: 3,
        wins: 2,
        totalTurns: 52,
        totalDurationSec: 1600,
        actionsByType: { action: 26, pay: 9, draw: 15 },
      },
      Beta: {
        name: 'Beta',
        gamesPlayed: 2,
        wins: 1,
        totalTurns: 28,
        totalDurationSec: 900,
        actionsByType: { action: 15, pay: 5, draw: 8 },
      },
      Gamma: {
        name: 'Gamma',
        gamesPlayed: 2,
        wins: 0,
        totalTurns: 36,
        totalDurationSec: 1000,
        actionsByType: { action: 18, pay: 6, draw: 10 },
      },
    },
  };

  return { history, lifetime };
}

export function createDevStatsFixture(kind: 'medium' = 'medium'): DevStatsFixture {
  if (kind === 'medium') {
    return mediumFixture();
  }
  return mediumFixture();
}
