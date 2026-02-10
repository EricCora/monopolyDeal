export interface MatchRecordV1 {
  id: string;
  startedAt: number;
  endedAt: number;
  players: string[];
  winnerId?: string;
  winnerName?: string;
  turnCount: number;
  durationSec: number;
  actionsByType: Record<string, number>;
}

export interface LifetimePlayerStats {
  name: string;
  gamesPlayed: number;
  wins: number;
  totalTurns: number;
  totalDurationSec: number;
  actionsByType: Record<string, number>;
}

export interface LifetimeStatsV1 {
  version: 1;
  players: Record<string, LifetimePlayerStats>;
}
