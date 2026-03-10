import { DEFAULT_RULESET, type RulesetV1 } from '../engine';

export const TABLE_STYLE_OPTIONS = [
  { value: 'premium_tabletop', label: 'Premium Tabletop' },
  { value: 'classic_green', label: 'Classic Felt' },
  { value: 'neon_arcade', label: 'Neon Arcade' },
] as const;

export type TableStylePreset = typeof TABLE_STYLE_OPTIONS[number]['value'];

export const DEFAULT_TABLE_STYLE: TableStylePreset = 'premium_tabletop';

export function normalizeTableStyle(input: unknown): TableStylePreset {
  if (typeof input !== 'string') return DEFAULT_TABLE_STYLE;
  return TABLE_STYLE_OPTIONS.some((option) => option.value === input)
    ? input as TableStylePreset
    : DEFAULT_TABLE_STYLE;
}

export const MULTIPLAYER_SESSION_PRESET_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'fast', label: 'Fast' },
  { value: 'teaching', label: 'Teaching' },
] as const;

export type MultiplayerSessionPresetId = typeof MULTIPLAYER_SESSION_PRESET_OPTIONS[number]['value'];

export const DEFAULT_MULTIPLAYER_SESSION_PRESET: MultiplayerSessionPresetId = 'standard';

interface MultiplayerSessionPresetDefinition {
  id: MultiplayerSessionPresetId;
  label: string;
  shortDescription: string;
  lobbyBadge: string;
  readySummary: string;
  tableSummary: string;
  supportHints: boolean;
  ruleset: Partial<RulesetV1>;
}

export const MULTIPLAYER_SESSION_PRESET_DEFINITIONS: Record<MultiplayerSessionPresetId, MultiplayerSessionPresetDefinition> = {
  standard: {
    id: 'standard',
    label: 'Standard',
    shortDescription: 'Classic three-set race with the full normal room pace.',
    lobbyBadge: 'Standard Room',
    readySummary: 'Standard rules, three complete sets to win.',
    tableSummary: 'Standard rules',
    supportHints: false,
    ruleset: {},
  },
  fast: {
    id: 'fast',
    label: 'Fast',
    shortDescription: 'Shorter live session with the same actions but only two complete sets needed.',
    lobbyBadge: 'Fast Room',
    readySummary: 'Fast preset, two complete sets to win.',
    tableSummary: 'Fast: 2 sets to win',
    supportHints: false,
    ruleset: {
      winCompleteSets: 2,
    },
  },
  teaching: {
    id: 'teaching',
    label: 'Teaching',
    shortDescription: 'Standard rules with clearer support copy for mixed-skill groups.',
    lobbyBadge: 'Teaching Room',
    readySummary: 'Teaching preset, standard rules with extra guidance copy.',
    tableSummary: 'Teaching preset',
    supportHints: true,
    ruleset: {},
  },
};

export function getMultiplayerSessionPresetDefinition(presetId: MultiplayerSessionPresetId): MultiplayerSessionPresetDefinition {
  return MULTIPLAYER_SESSION_PRESET_DEFINITIONS[presetId];
}

export function normalizeMultiplayerSessionPreset(
  input: unknown,
  fallback: MultiplayerSessionPresetId = DEFAULT_MULTIPLAYER_SESSION_PRESET,
): MultiplayerSessionPresetId {
  if (typeof input !== 'string') return fallback;
  return input in MULTIPLAYER_SESSION_PRESET_DEFINITIONS
    ? input as MultiplayerSessionPresetId
    : fallback;
}

export function getMultiplayerSessionPresetRuleset(presetId: MultiplayerSessionPresetId): RulesetV1 {
  return {
    ...DEFAULT_RULESET,
    ...MULTIPLAYER_SESSION_PRESET_DEFINITIONS[presetId].ruleset,
  };
}

export function multiplayerSessionPresetRulesMatch(presetId: MultiplayerSessionPresetId, ruleset?: Partial<RulesetV1>): boolean {
  const expected = getMultiplayerSessionPresetRuleset(presetId);
  const normalized = {
    ...DEFAULT_RULESET,
    ...ruleset,
  };
  return normalized.winCompleteSets === expected.winCompleteSets
    && normalized.maxHandAtEndTurn === expected.maxHandAtEndTurn
    && normalized.maxPlaysPerTurn === expected.maxPlaysPerTurn;
}

export const HOME_PRIMARY_MATCH_MODES = ['hot_seat', 'practice', 'live_online'] as const;

export type MatchMode = 'hot_seat' | 'practice' | 'daily_challenge' | 'live_online';

interface MatchModeDefinition {
  id: MatchMode;
  badge: string;
  homeTitle: string;
  homeDescription: string;
  homeCta: string;
  tableKicker: string;
}

export const MATCH_MODE_DEFINITIONS: Record<MatchMode, MatchModeDefinition> = {
  hot_seat: {
    id: 'hot_seat',
    badge: 'Hot Seat',
    homeTitle: 'New local game',
    homeDescription: 'Pass one device around the table, tune the seats, and start fast without lobby setup.',
    homeCta: 'New Game (Hot Seat)',
    tableKicker: 'Hot Seat',
  },
  practice: {
    id: 'practice',
    badge: 'Practice',
    homeTitle: 'Quick solo warmup',
    homeDescription: 'Jump straight into a short local match against a bot to test openings and reactions.',
    homeCta: 'Practice vs Bots',
    tableKicker: 'Practice',
  },
  daily_challenge: {
    id: 'daily_challenge',
    badge: 'Daily Challenge',
    homeTitle: 'Daily challenge',
    homeDescription: 'Play the featured seed with a fast replayable goal for today.',
    homeCta: 'Start Daily Challenge',
    tableKicker: 'Daily Challenge',
  },
  live_online: {
    id: 'live_online',
    badge: 'Live Online',
    homeTitle: 'Private room with friends',
    homeDescription: 'Create a room code, invite the group, and keep the live session in sync across devices.',
    homeCta: 'Play Multiplayer (Live Online)',
    tableKicker: 'Live Online',
  },
};

export function getMatchModeDefinition(mode: MatchMode): MatchModeDefinition {
  return MATCH_MODE_DEFINITIONS[mode];
}

export function normalizeMatchMode(input: unknown, fallback: MatchMode = 'hot_seat'): MatchMode {
  if (typeof input !== 'string') return fallback;
  return input in MATCH_MODE_DEFINITIONS
    ? input as MatchMode
    : fallback;
}
