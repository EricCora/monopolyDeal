import type { GameState } from '../engine';
import type { LifetimeStatsV1, MatchRecordV1 } from '../stats/types';

const ACTIVE_GAME_KEY = 'monopolyDeal.activeGame.v1';
const MATCH_HISTORY_KEY = 'monopolyDeal.matchHistory.v1';
const LIFETIME_STATS_KEY = 'monopolyDeal.lifetimeStats.v1';

export interface SavedGameV1 {
  version: 1;
  timestamp: number;
  gameState: GameState;
}

export function saveActiveGame(state: GameState): void {
  const snapshot: SavedGameV1 = {
    version: 1,
    timestamp: Date.now(),
    gameState: state,
  };
  localStorage.setItem(ACTIVE_GAME_KEY, JSON.stringify(snapshot));
}

export function loadActiveGame(): SavedGameV1 | null {
  const raw = localStorage.getItem(ACTIVE_GAME_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SavedGameV1;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearActiveGame(): void {
  localStorage.removeItem(ACTIVE_GAME_KEY);
}

export function loadMatchHistory(): MatchRecordV1[] {
  const raw = localStorage.getItem(MATCH_HISTORY_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as MatchRecordV1[];
  } catch {
    return [];
  }
}

export function saveMatchHistory(records: MatchRecordV1[]): void {
  localStorage.setItem(MATCH_HISTORY_KEY, JSON.stringify(records));
}

export function loadLifetimeStats(): LifetimeStatsV1 {
  const raw = localStorage.getItem(LIFETIME_STATS_KEY);
  if (!raw) return { version: 1, players: {} };
  try {
    return JSON.parse(raw) as LifetimeStatsV1;
  } catch {
    return { version: 1, players: {} };
  }
}

export function saveLifetimeStats(stats: LifetimeStatsV1): void {
  localStorage.setItem(LIFETIME_STATS_KEY, JSON.stringify(stats));
}
