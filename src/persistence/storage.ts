import type { GameState } from '../engine';
import { defaultAchievementState, defaultDailyChallenge, ensureTodayDailyChallenge } from '../stats/retention';
import type { AchievementStateV1, DailyChallengeV1, GrowthMetricEvent, GrowthMetricsV1, LifetimeStatsV1, MatchRecordV1 } from '../stats/types';

const ACTIVE_GAME_KEY = 'monopolyDeal.activeGame.v1';
const SAVED_GAMES_KEY = 'monopolyDeal.savedGames.v1';
const MATCH_HISTORY_KEY = 'monopolyDeal.matchHistory.v1';
const LIFETIME_STATS_KEY = 'monopolyDeal.lifetimeStats.v1';
const GROWTH_METRICS_KEY = 'monopolyDeal.growthMetrics.v1';
const ACHIEVEMENTS_KEY = 'monopolyDeal.achievements.v1';
const DAILY_CHALLENGE_KEY = 'monopolyDeal.dailyChallenge.v1';
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
    multiplayerPushEnabled: boolean;
    multiplayerReactionsEnabled: boolean;
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

function parseNonNegative(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function loadAchievementState(): AchievementStateV1 {
  const raw = localStorage.getItem(ACHIEVEMENTS_KEY);
  if (!raw) return defaultAchievementState();
  try {
    const parsed = JSON.parse(raw) as Partial<AchievementStateV1>;
    if (parsed.version !== 1) return defaultAchievementState();
    return {
      version: 1,
      counters: {
        wins: parseNonNegative(parsed.counters?.wins),
        actions: parseNonNegative(parsed.counters?.actions),
        gamesPlayed: parseNonNegative(parsed.counters?.gamesPlayed),
        quickWins: parseNonNegative(parsed.counters?.quickWins),
      },
      unlockedAt: {
        first_win: parseNonNegative(parsed.unlockedAt?.first_win) || undefined,
        ten_wins: parseNonNegative(parsed.unlockedAt?.ten_wins) || undefined,
        action_century: parseNonNegative(parsed.unlockedAt?.action_century) || undefined,
        quick_win: parseNonNegative(parsed.unlockedAt?.quick_win) || undefined,
      },
    };
  } catch {
    return defaultAchievementState();
  }
}

export function saveAchievementState(state: AchievementStateV1): void {
  localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(state));
}

export function loadDailyChallenge(): DailyChallengeV1 {
  const raw = localStorage.getItem(DAILY_CHALLENGE_KEY);
  if (!raw) return defaultDailyChallenge();
  try {
    const parsed = JSON.parse(raw) as Partial<DailyChallengeV1>;
    if (parsed.version !== 1) return defaultDailyChallenge();
    return ensureTodayDailyChallenge({
      version: 1,
      day: typeof parsed.day === 'string' ? parsed.day : defaultDailyChallenge().day,
      seed: parseNonNegative(parsed.seed),
      targetTurns: Math.max(1, parseNonNegative(parsed.targetTurns)),
      completed: Boolean(parsed.completed),
      attempts: parseNonNegative(parsed.attempts),
      bestTurnCount: parsed.bestTurnCount == null ? null : Math.max(1, parseNonNegative(parsed.bestTurnCount)),
    });
  } catch {
    return defaultDailyChallenge();
  }
}

export function saveDailyChallenge(challenge: DailyChallengeV1): void {
  localStorage.setItem(DAILY_CHALLENGE_KEY, JSON.stringify(challenge));
}

function defaultGrowthMetrics(): GrowthMetricsV1 {
  return {
    version: 1,
    events: {
      share_image_clicked: 0,
      share_image_success: 0,
      payment_auto_selected: 0,
      rules_drawer_opened: 0,
      game_started: 0,
      game_completed: 0,
      rematch_started: 0,
      lan_room_hosted: 0,
      lan_room_joined: 0,
      coach_hint_viewed: 0,
      multiplayer_host_started: 0,
      multiplayer_join_success: 0,
      multiplayer_join_failed: 0,
      multiplayer_invite_copied: 0,
      multiplayer_deep_link_opened: 0,
      multiplayer_reconnect_success: 0,
      multiplayer_reconnect_failed: 0,
      multiplayer_match_completed: 0,
      multiplayer_push_connected: 0,
      multiplayer_push_disconnected: 0,
      multiplayer_push_fallback: 0,
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
        game_started: parseMetricCount(parsed.events?.game_started),
        game_completed: parseMetricCount(parsed.events?.game_completed),
        rematch_started: parseMetricCount(parsed.events?.rematch_started),
        lan_room_hosted: parseMetricCount(parsed.events?.lan_room_hosted),
        lan_room_joined: parseMetricCount(parsed.events?.lan_room_joined),
        coach_hint_viewed: parseMetricCount(parsed.events?.coach_hint_viewed),
        multiplayer_host_started: parseMetricCount(parsed.events?.multiplayer_host_started),
        multiplayer_join_success: parseMetricCount(parsed.events?.multiplayer_join_success),
        multiplayer_join_failed: parseMetricCount(parsed.events?.multiplayer_join_failed),
        multiplayer_invite_copied: parseMetricCount(parsed.events?.multiplayer_invite_copied),
        multiplayer_deep_link_opened: parseMetricCount(parsed.events?.multiplayer_deep_link_opened),
        multiplayer_reconnect_success: parseMetricCount(parsed.events?.multiplayer_reconnect_success),
        multiplayer_reconnect_failed: parseMetricCount(parsed.events?.multiplayer_reconnect_failed),
        multiplayer_match_completed: parseMetricCount(parsed.events?.multiplayer_match_completed),
        multiplayer_push_connected: parseMetricCount(parsed.events?.multiplayer_push_connected),
        multiplayer_push_disconnected: parseMetricCount(parsed.events?.multiplayer_push_disconnected),
        multiplayer_push_fallback: parseMetricCount(parsed.events?.multiplayer_push_fallback),
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
      multiplayerPushEnabled: true,
      multiplayerReactionsEnabled: true,
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
        multiplayerPushEnabled: experimentalParsed?.multiplayerPushEnabled !== false,
        multiplayerReactionsEnabled: experimentalParsed?.multiplayerReactionsEnabled !== false,
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

export function clearGrowthMetrics(): void {
  localStorage.removeItem(GROWTH_METRICS_KEY);
}
