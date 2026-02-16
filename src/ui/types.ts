import type { Action, BotDifficulty, LegalAction, PlayerController } from '../engine';

export interface SetupViewModel {
  playerCount: number;
  playerNames: string[];
  playerControllers: PlayerController[];
  botDifficulties: BotDifficulty[];
  customRules: {
    winCompleteSets: number;
    maxHandAtEndTurn: number;
    maxPlaysPerTurn: number;
  };
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
