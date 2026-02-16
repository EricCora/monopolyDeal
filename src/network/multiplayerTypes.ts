import type { Action, GameState, LegalAction } from '../engine';

export type MultiplayerRoomStatus = 'lobby' | 'active' | 'finished';
export type MultiplayerConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

export interface MultiplayerPlayerSummary {
  id: string;
  name: string;
  handCount: number;
  bankCount: number;
  completeSets: number;
  connected: boolean;
  lastSeenAt: number;
  reconnectDeadlineMs: number;
  isHost: boolean;
}

export interface MultiplayerRoomView {
  roomCode: string;
  status: MultiplayerRoomStatus;
  started: boolean;
  winnerId?: string;
  hostPlayerId: string;
  yourPlayerId: string;
  players: MultiplayerPlayerSummary[];
  promptPlayerId?: string;
  legalActions: LegalAction[];
  gameState?: GameState;
  paused: boolean;
  pausedByPlayerId?: string;
  revision: number;
  turnSnapshotCount: number;
  checkpointSlots: MultiplayerCheckpointSummary[];
  canStart: boolean;
  reconnectDeadlineMs: number;
  serverTime: number;
}

export interface MultiplayerCheckpointSummary {
  id: string;
  name: string;
  savedAt: number;
}

export interface MultiplayerSession {
  version: 1;
  roomCode: string;
  playerId: string;
  sessionToken: string;
  playerName: string;
  reconnectDeadlineMs: number;
}

export interface MultiplayerRoomSessionResponse {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  reconnectDeadlineMs: number;
}

export interface MultiplayerActionPayload {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  action: Action;
  expectedRevision?: number;
}
