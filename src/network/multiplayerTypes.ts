import type { Action, GameState, LegalAction } from '../engine';

export type MultiplayerRoomStatus = 'lobby' | 'active' | 'finished';
export type MultiplayerRoomRuntimeState = 'active' | 'paused_disconnect' | 'paused_host_disconnect' | 'ended_timeout';
export type MultiplayerPausedReason = 'manual' | 'player_disconnect' | 'host_disconnect';
export type MultiplayerEndedReason = 'host_timeout' | 'disconnect_timeout';
export type MultiplayerConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type MultiplayerPushState = 'disabled' | 'unsupported' | 'connecting' | 'connected' | 'fallback';
export type MultiplayerConnectionUiState =
  | 'connected'
  | 'socket_disconnected'
  | 'reconnecting_attempting'
  | 'reconnect_handshake_pending'
  | 'resync_pending'
  | 'recovered'
  | 'resume_failed'
  | 'timed_out'
  | 'room_ended';
export type MultiplayerReaction = 'nice' | 'wow' | 'gg' | 'oops';
export type MultiplayerActivityKind = 'lobby' | 'connection' | 'host' | 'ready' | 'reaction' | 'chat' | 'match' | 'checkpoint' | 'system';

export interface MultiplayerPlayerSummary {
  id: string;
  name: string;
  handCount: number;
  bankCount: number;
  completeSets: number;
  connected: boolean;
  connectionState?: 'connected' | 'disconnected' | 'reconnecting' | 'timed_out';
  disconnectedAt?: number | null;
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
  roomRuntimeState?: MultiplayerRoomRuntimeState;
  pausedReason?: MultiplayerPausedReason;
  endedReason?: MultiplayerEndedReason;
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
  seatId?: string;
  resumeToken?: string;
  // Deprecated compatibility fields; remove after reconnect-v1 migration completes.
  playerId: string;
  sessionToken: string;
  playerName: string;
  reconnectDeadlineMs: number;
}

export interface MultiplayerRoomSessionResponse {
  roomCode: string;
  seatId?: string;
  resumeToken?: string;
  // Deprecated compatibility fields; remove after reconnect-v1 migration completes.
  playerId: string;
  sessionToken: string;
  reconnectDeadlineMs: number;
}

export type MultiplayerResumeResultStatus =
  | 'ok'
  | 'invalid_token'
  | 'seat_not_found'
  | 'room_closed'
  | 'seat_timed_out'
  | 'protocol_mismatch';

export interface MultiplayerResumeRoomResponse {
  status: MultiplayerResumeResultStatus;
  roomCode: string;
  seatId?: string;
  requiresFullResync: boolean;
  serverStateVersion?: number;
  snapshot?: MultiplayerRoomView;
  message?: string;
  resumeToken?: string;
  // Deprecated compatibility fields; remove after reconnect-v1 migration completes.
  playerId?: string;
  sessionToken?: string;
  reconnectDeadlineMs?: number;
}

export interface MultiplayerActionPayload {
  roomCode: string;
  playerId: string;
  sessionToken: string;
  action: Action;
  expectedRevision?: number;
  clientStateVersion?: number;
  actionId?: string;
}

export type MultiplayerActionRejectedReason =
  | 'stale_state'
  | 'not_your_turn'
  | 'invalid_action'
  | 'prompt_mismatch';

export interface MultiplayerActionRejectedResponse {
  error: 'action_rejected';
  reason: MultiplayerActionRejectedReason;
  serverStateVersion: number;
  requiresResync: boolean;
  message?: string;
}

export interface MultiplayerRoomEventEnvelope {
  roomCode: string;
  revision: number;
  reason: string;
  serverTime: number;
  eventId: number;
  seatId?: string;
  displayName?: string;
  graceExpiresAt?: number;
}
