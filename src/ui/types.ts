import type { Action, LegalAction } from '../engine';

export interface SetupViewModel {
  playerCount: number;
  playerNames: string[];
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
  label: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewText: string;
}

export type ShareStatus = { tone: 'success' | 'error'; message: string } | null;
