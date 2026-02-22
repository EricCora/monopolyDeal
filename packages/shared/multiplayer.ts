import type { Action, GameState, LegalAction, PlayerId } from '../../src/engine';

export type MultiplayerRoomStatus = 'lobby' | 'active' | 'finished';
export type MultiplayerReaction = 'nice' | 'wow' | 'gg' | 'oops';
export type MultiplayerActivityKind = 'lobby' | 'connection' | 'host' | 'ready' | 'reaction' | 'chat' | 'match' | 'checkpoint' | 'system';

export interface MultiplayerPlayerSummary {
  id: PlayerId;
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
  playerId?: PlayerId;
  reaction?: MultiplayerReaction;
}

export interface MultiplayerChatMessage {
  id: number;
  createdAt: number;
  playerId: PlayerId;
  playerName: string;
  text: string;
}

export interface MultiplayerRoomView {
  roomCode: string;
  status: MultiplayerRoomStatus;
  started: boolean;
  winnerId?: PlayerId;
  hostPlayerId: PlayerId;
  yourPlayerId: PlayerId;
  players: MultiplayerPlayerSummary[];
  promptPlayerId?: PlayerId;
  legalActions: LegalAction[];
  gameState?: GameState;
  paused: boolean;
  pausedByPlayerId?: PlayerId;
  revision: number;
  turnSnapshotCount: number;
  checkpointSlots: MultiplayerCheckpointSummary[];
  canStart: boolean;
  reconnectDeadlineMs: number;
  serverTime: number;
  activityFeed: MultiplayerActivityFeedItem[];
  chatMessages: MultiplayerChatMessage[];
  typingPlayerIds: PlayerId[];
  lastEventId: number;
}

export interface MultiplayerCheckpointSummary {
  id: string;
  name: string;
  savedAt: number;
}

export interface RoomSessionResponse {
  roomCode: string;
  seatId: PlayerId;
  resumeToken: string;
  // Deprecated compatibility fields; remove after reconnect-v1 migration completes.
  playerId: PlayerId;
  sessionToken: string;
  reconnectDeadlineMs: number;
}

export interface CreateRoomRequest {
  playerName: string;
}

export interface JoinRoomRequest {
  playerName: string;
}

export interface ReconnectRoomRequest {
  seatId?: PlayerId;
  resumeToken?: string;
  // Deprecated compatibility fields; remove after reconnect-v1 migration completes.
  playerId?: PlayerId;
  sessionToken?: string;
  expectedRevision?: number;
}

export interface StartRoomRequest extends ReconnectRoomRequest {
  seed?: number;
  checkpointId?: string;
}

export type LeaveRoomRequest = ReconnectRoomRequest;

export interface ApplyRoomActionRequest extends ReconnectRoomRequest {
  action: Action;
}

export interface SaveCheckpointRequest extends ReconnectRoomRequest {
  name: string;
}

export interface LoadCheckpointRequest extends ReconnectRoomRequest {
  checkpointId: string;
}

export interface DeleteCheckpointRequest extends ReconnectRoomRequest {
  checkpointId: string;
}

export interface SetReadyRequest extends ReconnectRoomRequest {
  ready: boolean;
}

export interface SendReactionRequest extends ReconnectRoomRequest {
  reaction: MultiplayerReaction;
}

export interface SendChatMessageRequest extends ReconnectRoomRequest {
  text: string;
}

export interface SetTypingRequest extends ReconnectRoomRequest {
  typing: boolean;
}

export interface MultiplayerRoomEventEnvelope {
  roomCode: string;
  revision: number;
  reason: string;
  serverTime: number;
  eventId: number;
}
