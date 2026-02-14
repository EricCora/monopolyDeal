import type { GameState } from '../engine';
import type { GrowthMetricEvent, GrowthMetricsV1, LifetimeStatsV1, MatchRecordV1 } from '../stats/types';

const ACTIVE_GAME_KEY = 'monopolyDeal.activeGame.v1';
const MATCH_HISTORY_KEY = 'monopolyDeal.matchHistory.v1';
const LIFETIME_STATS_KEY = 'monopolyDeal.lifetimeStats.v1';
const GROWTH_METRICS_KEY = 'monopolyDeal.growthMetrics.v1';
const UI_PREFERENCES_KEY = 'monopolyDeal.uiPreferences.v1';

export interface SavedGameV1 {
  version: 1;
  timestamp: number;
  gameState: GameState;
}

export interface UiPreferencesV1 {
  version: 1;
  reducedEffects: boolean;
  tableDensity: 'cozy' | 'compact';
  textScale: 'normal' | 'large';
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

function defaultGrowthMetrics(): GrowthMetricsV1 {
  return {
    version: 1,
    events: {
      share_image_clicked: 0,
      share_image_success: 0,
    },
  };
}

function parseMetricCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function loadGrowthMetrics(): GrowthMetricsV1 {
  const raw = localStorage.getItem(GROWTH_METRICS_KEY);
  if (!raw) return defaultGrowthMetrics();
  try {
    const parsed = JSON.parse(raw) as Partial<GrowthMetricsV1>;
    if (parsed.version !== 1) return defaultGrowthMetrics();
    return {
      version: 1,
      events: {
        share_image_clicked: parseMetricCount(parsed.events?.share_image_clicked),
        share_image_success: parseMetricCount(parsed.events?.share_image_success),
      },
    };
  } catch {
    return defaultGrowthMetrics();
  }
}

export function saveGrowthMetrics(metrics: GrowthMetricsV1): void {
  localStorage.setItem(GROWTH_METRICS_KEY, JSON.stringify(metrics));
}

export function incrementGrowthMetric(event: GrowthMetricEvent): GrowthMetricsV1 {
  const current = loadGrowthMetrics();
  const next: GrowthMetricsV1 = {
    version: 1,
    events: {
      ...current.events,
      [event]: current.events[event] + 1,
    },
  };
  saveGrowthMetrics(next);
  return next;
}

function defaultUiPreferences(): UiPreferencesV1 {
  return {
    version: 1,
    reducedEffects: false,
    tableDensity: 'cozy',
    textScale: 'normal',
  };
}

export function loadUiPreferences(): UiPreferencesV1 {
  const raw = localStorage.getItem(UI_PREFERENCES_KEY);
  if (!raw) return defaultUiPreferences();
  try {
    const parsed = JSON.parse(raw) as Partial<UiPreferencesV1>;
    if (parsed.version !== 1) return defaultUiPreferences();
    const density = parsed.tableDensity === 'compact' ? 'compact' : 'cozy';
    const textScale = parsed.textScale === 'large' ? 'large' : 'normal';
    return {
      version: 1,
      reducedEffects: Boolean(parsed.reducedEffects),
      tableDensity: density,
      textScale,
    };
  } catch {
    return defaultUiPreferences();
  }
}

export function saveUiPreferences(preferences: UiPreferencesV1): void {
  localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences));
}
