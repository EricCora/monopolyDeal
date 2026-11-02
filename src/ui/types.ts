import type { Action, BotDifficulty, GameVariant, LegalAction, PlayerController } from '../engine';

export interface SetupViewModel {
  variant?: GameVariant;
  playerCount: number;
  playerNames: string[];
  playerControllers: PlayerController[];
  botDifficulties: BotDifficulty[];
  customRules: {
    winCompleteSets: number;
    maxHandAtEndTurn: number;
    maxPlaysPerTurn: number;
  };
  /** 45 seconds a turn, then a bot moves. Without it the clock only counts up. */
  speedMode?: boolean;
  /** How long a Speed turn lasts: 30, 45 or 60. */
  speedSeconds?: number;
  bestOf?: 1 | 3;
}

export interface ActionRailEntry {
  id: string;
  label: string;
  detail?: string;
  action: Action;
}

export interface TurnBadgeView {
  label: string;
  value: string;
}

export interface ZoneSummaryView {
  label: string;
  value: string;
}

export interface LegalActionDetailView {
  action: LegalAction;
  detailText: string | null;
}

export interface RiskyActionConfirmation {
  action: Action;
  mode: 'local' | 'multiplayer';
  label: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewText: string;
}

export type ShareStatus = { tone: 'success' | 'error'; message: string } | null;
