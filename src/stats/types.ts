import type { MatchMode, MultiplayerSessionPresetId } from '../ui/experience';

export type MatchSurface = 'local' | 'multiplayer';

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
  mode: MatchMode;
  surface: MatchSurface;
  presetId?: MultiplayerSessionPresetId;
  roomCode?: string;
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

export type GrowthMetricEvent =
  | 'share_image_clicked'
  | 'share_image_success'
  | 'payment_auto_selected'
  | 'rules_drawer_opened'
  | 'game_started'
  | 'game_completed'
  | 'rematch_started'
  | 'lan_room_hosted'
  | 'lan_room_joined'
  | 'coach_hint_viewed'
  | 'multiplayer_host_started'
  | 'multiplayer_join_success'
  | 'multiplayer_join_failed'
  | 'multiplayer_invite_copied'
  | 'multiplayer_deep_link_opened'
  | 'multiplayer_resume_attempt'
  | 'multiplayer_resume_success'
  | 'multiplayer_resume_failure'
  | 'multiplayer_resync_started'
  | 'multiplayer_resync_completed'
  | 'multiplayer_reconnect_success'
  | 'multiplayer_reconnect_failed'
  | 'multiplayer_match_completed'
  | 'multiplayer_push_connected'
  | 'multiplayer_push_disconnected'
  | 'multiplayer_push_fallback';

export interface GrowthMetricsV1 {
  version: 1;
  events: {
    share_image_clicked: number;
    share_image_success: number;
    payment_auto_selected: number;
    rules_drawer_opened: number;
    game_started: number;
    game_completed: number;
    rematch_started: number;
    lan_room_hosted: number;
    lan_room_joined: number;
    coach_hint_viewed: number;
    multiplayer_host_started: number;
    multiplayer_join_success: number;
    multiplayer_join_failed: number;
    multiplayer_invite_copied: number;
    multiplayer_deep_link_opened: number;
    multiplayer_resume_attempt: number;
    multiplayer_resume_success: number;
    multiplayer_resume_failure: number;
    multiplayer_resync_started: number;
    multiplayer_resync_completed: number;
    multiplayer_reconnect_success: number;
    multiplayer_reconnect_failed: number;
    multiplayer_match_completed: number;
    multiplayer_push_connected: number;
    multiplayer_push_disconnected: number;
    multiplayer_push_fallback: number;
  };
}
