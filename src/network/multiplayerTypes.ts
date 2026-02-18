import type { Action, GameState, LegalAction } from '../engine';

export type MultiplayerRoomStatus = 'lobby' | 'active' | 'finished';
export type MultiplayerConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type MultiplayerPushState = 'disabled' | 'unsupported' | 'connecting' | 'connected' | 'fallback';
export type MultiplayerReaction = 'nice' | 'wow' | 'gg' | 'oops';
export type MultiplayerActivityKind = 'lobby' | 'connection' | 'host' | 'ready' | 'reaction' | 'chat' | 'match' | 'checkpoint' | 'system';

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
  ready: boolean;
}

export interface MultiplayerActivityFeedItem {
  id: number;
  createdAt: number;
  kind: MultiplayerActivityKind;
  message: string;
  playerId?: string;
  reaction?: MultiplayerReaction;
}

export interface MultiplayerChatMessage {
  id: number;
  createdAt: number;
  playerId: string;
  playerName: string;
  text: string;
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
  activityFeed: MultiplayerActivityFeedItem[];
  chatMessages: MultiplayerChatMessage[];
  typingPlayerIds: string[];
  lastEventId: number;
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

export interface MultiplayerRoomEventEnvelope {
  roomCode: string;
  revision: number;
  reason: string;
  serverTime: number;
  eventId: number;
}
