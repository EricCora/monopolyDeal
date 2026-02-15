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

export type AchievementId = 'first_win' | 'ten_wins' | 'action_century' | 'quick_win';

export interface AchievementStateV1 {
  version: 1;
  counters: {
    wins: number;
    actions: number;
    gamesPlayed: number;
    quickWins: number;
  };
  unlockedAt: Partial<Record<AchievementId, number>>;
}

export interface DailyChallengeV1 {
  version: 1;
  day: string;
  seed: number;
  targetTurns: number;
  completed: boolean;
  attempts: number;
  bestTurnCount: number | null;
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
