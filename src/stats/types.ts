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

export type GrowthMetricEvent = 'share_image_clicked' | 'share_image_success' | 'payment_auto_selected' | 'rules_drawer_opened';

export interface GrowthMetricsV1 {
  version: 1;
  events: {
    share_image_clicked: number;
    share_image_success: number;
    payment_auto_selected: number;
    rules_drawer_opened: number;
  };
}
