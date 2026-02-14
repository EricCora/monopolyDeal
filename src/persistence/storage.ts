import type { GameState } from '../engine';
import type { GrowthMetricEvent, GrowthMetricsV1, LifetimeStatsV1, MatchRecordV1 } from '../stats/types';

const ACTIVE_GAME_KEY = 'monopolyDeal.activeGame.v1';
const SAVED_GAMES_KEY = 'monopolyDeal.savedGames.v1';
const MATCH_HISTORY_KEY = 'monopolyDeal.matchHistory.v1';
const LIFETIME_STATS_KEY = 'monopolyDeal.lifetimeStats.v1';
const GROWTH_METRICS_KEY = 'monopolyDeal.growthMetrics.v1';
const UI_PREFERENCES_KEY = 'monopolyDeal.uiPreferences.v1';
const MAX_SAVED_GAME_SLOTS = 5;

export interface SavedGameV1 {
  version: 1;
  timestamp: number;
  gameState: GameState;
}

export interface SavedGameSlotV1 {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  gameState: GameState;
}

export interface SavedGamesCollectionV1 {
  version: 1;
  slots: SavedGameSlotV1[];
}

export interface UiPreferencesV1 {
  version: 1;
  reducedEffects: boolean;
  tableDensity: 'cozy' | 'compact';
  textScale: 'normal' | 'large';
  confirmRiskyActions: boolean;
  showRulesDrawerHints: boolean;
  highContrast: boolean;
  soundEnabled: boolean;
  hapticsEnabled: boolean;
  experimental: {
    aiOpponents: boolean;
    aiCoach: boolean;
    replayTimeline: boolean;
    dailyChallenges: boolean;
    achievements: boolean;
    lanMultiplayer: boolean;
    customRules: boolean;
    enhancedEventLog: boolean;
    contextualActionPreviews: boolean;
  };
  devModeEnabled: boolean;
  gamePaused: boolean;
  pausedGameId: string | null;
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

function defaultSavedGamesCollection(): SavedGamesCollectionV1 {
  return { version: 1, slots: [] };
}

function sanitizeSavedGameSlots(rawSlots: unknown): SavedGameSlotV1[] {
  if (!Array.isArray(rawSlots)) return [];
  const sanitized: SavedGameSlotV1[] = [];
  for (const item of rawSlots) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<SavedGameSlotV1>;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue;
    if (typeof candidate.name !== 'string' || candidate.name.length === 0) continue;
    if (!candidate.gameState || typeof candidate.gameState !== 'object') continue;
    const createdAt = Number(candidate.createdAt);
    const updatedAt = Number(candidate.updatedAt);
    sanitized.push({
      id: candidate.id,
      name: candidate.name,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      gameState: candidate.gameState as GameState,
    });
  }
  return sanitized
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_SAVED_GAME_SLOTS);
}

function saveSlotNameFallback(): string {
  return `Saved Game ${new Date().toLocaleString()}`;
}

export function loadSavedGames(): SavedGamesCollectionV1 {
  const raw = localStorage.getItem(SAVED_GAMES_KEY);
  if (!raw) return defaultSavedGamesCollection();
  try {
    const parsed = JSON.parse(raw) as Partial<SavedGamesCollectionV1>;
    if (parsed.version !== 1) return defaultSavedGamesCollection();
    return {
      version: 1,
      slots: sanitizeSavedGameSlots(parsed.slots),
    };
  } catch {
    return defaultSavedGamesCollection();
  }
}

export function saveSavedGames(collection: SavedGamesCollectionV1): void {
  const sanitized: SavedGamesCollectionV1 = {
    version: 1,
    slots: sanitizeSavedGameSlots(collection.slots),
  };
  localStorage.setItem(SAVED_GAMES_KEY, JSON.stringify(sanitized));
}

function nextSlotId(): string {
  return `slot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertSavedGameSlot(input: { id?: string; name?: string; gameState: GameState }): SavedGamesCollectionV1 {
  const current = loadSavedGames();
  const now = Date.now();
  if (input.id) {
    const found = current.slots.find((slot) => slot.id === input.id);
    if (found) {
      const next: SavedGamesCollectionV1 = {
        version: 1,
        slots: current.slots.map((slot) => (slot.id === input.id
          ? {
              ...slot,
              name: input.name?.trim() || slot.name,
              updatedAt: now,
              gameState: input.gameState,
            }
          : slot)),
      };
      saveSavedGames(next);
      return loadSavedGames();
    }
  }

  if (current.slots.length >= MAX_SAVED_GAME_SLOTS) {
    throw new Error('save_slots_full');
  }

  const nextSlot: SavedGameSlotV1 = {
    id: nextSlotId(),
    name: input.name?.trim() || saveSlotNameFallback(),
    createdAt: now,
    updatedAt: now,
    gameState: input.gameState,
  };

  const next: SavedGamesCollectionV1 = {
    version: 1,
    slots: [nextSlot, ...current.slots],
  };
  saveSavedGames(next);
  return loadSavedGames();
}

export function deleteSavedGameSlot(id: string): SavedGamesCollectionV1 {
  const current = loadSavedGames();
  const next: SavedGamesCollectionV1 = {
    version: 1,
    slots: current.slots.filter((slot) => slot.id !== id),
  };
  saveSavedGames(next);
  return loadSavedGames();
}

export function renameSavedGameSlot(id: string, name: string): SavedGamesCollectionV1 {
  const trimmed = name.trim();
  if (!trimmed) return loadSavedGames();
  const current = loadSavedGames();
  const now = Date.now();
  const next: SavedGamesCollectionV1 = {
    version: 1,
    slots: current.slots.map((slot) => (slot.id === id ? { ...slot, name: trimmed, updatedAt: now } : slot)),
  };
  saveSavedGames(next);
  return loadSavedGames();
}

export function loadSavedGameSlot(id: string): SavedGameSlotV1 | null {
  const collection = loadSavedGames();
  return collection.slots.find((slot) => slot.id === id) ?? null;
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
      payment_auto_selected: 0,
      rules_drawer_opened: 0,
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
        payment_auto_selected: parseMetricCount(parsed.events?.payment_auto_selected),
        rules_drawer_opened: parseMetricCount(parsed.events?.rules_drawer_opened),
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
    confirmRiskyActions: true,
    showRulesDrawerHints: true,
    highContrast: false,
    soundEnabled: false,
    hapticsEnabled: false,
    experimental: {
      aiOpponents: false,
      aiCoach: false,
      replayTimeline: false,
      dailyChallenges: false,
      achievements: false,
      lanMultiplayer: false,
      customRules: false,
      enhancedEventLog: false,
      contextualActionPreviews: false,
    },
    devModeEnabled: false,
    gamePaused: false,
    pausedGameId: null,
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
    const experimentalParsed = parsed.experimental;
    return {
      version: 1,
      reducedEffects: Boolean(parsed.reducedEffects),
      tableDensity: density,
      textScale,
      confirmRiskyActions: parsed.confirmRiskyActions !== false,
      showRulesDrawerHints: parsed.showRulesDrawerHints !== false,
      highContrast: Boolean(parsed.highContrast),
      soundEnabled: Boolean(parsed.soundEnabled),
      hapticsEnabled: Boolean(parsed.hapticsEnabled),
      experimental: {
        aiOpponents: Boolean(experimentalParsed?.aiOpponents),
        aiCoach: Boolean(experimentalParsed?.aiCoach),
        replayTimeline: Boolean(experimentalParsed?.replayTimeline),
        dailyChallenges: Boolean(experimentalParsed?.dailyChallenges),
        achievements: Boolean(experimentalParsed?.achievements),
        lanMultiplayer: Boolean(experimentalParsed?.lanMultiplayer),
        customRules: Boolean(experimentalParsed?.customRules),
        enhancedEventLog: Boolean(experimentalParsed?.enhancedEventLog),
        contextualActionPreviews: Boolean(experimentalParsed?.contextualActionPreviews),
      },
      devModeEnabled: Boolean(parsed.devModeEnabled),
      gamePaused: Boolean(parsed.gamePaused),
      pausedGameId: typeof parsed.pausedGameId === 'string' ? parsed.pausedGameId : null,
    };
  } catch {
    return defaultUiPreferences();
  }
}

export function saveUiPreferences(preferences: UiPreferencesV1): void {
  localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences));
}

export function clearMatchHistory(): void {
  localStorage.removeItem(MATCH_HISTORY_KEY);
}

export function clearLifetimeStats(): void {
  localStorage.removeItem(LIFETIME_STATS_KEY);
}
