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

export type MultiplayerTransportMode = 'socket_primary' | 'http_fallback';

export interface MultiplayerSocketAuthPayload {
  roomCode: string;
  seatId?: string;
  resumeToken?: string;
  // Deprecated compatibility fields; remove after alias cleanup ticket lands.
  playerId?: string;
  sessionToken?: string;
}

export type MultiplayerSocketCommandName =
  | 'mp:cmd:reconnect'
  | 'mp:cmd:state'
  | 'mp:cmd:start'
  | 'mp:cmd:action'
  | 'mp:cmd:leave'
  | 'mp:cmd:pause'
  | 'mp:cmd:resume'
  | 'mp:cmd:undo'
  | 'mp:cmd:reset_turn'
  | 'mp:cmd:ready'
  | 'mp:cmd:reaction'
  | 'mp:cmd:chat'
  | 'mp:cmd:typing'
  | 'mp:cmd:checkpoint_save'
  | 'mp:cmd:checkpoint_load'
  | 'mp:cmd:checkpoint_delete';

export type MultiplayerSocketEventName =
  | 'mp:evt:connected'
  | 'mp:evt:session_replaced'
  | 'room_update';

export interface MultiplayerSocketError {
  code: string;
  message?: string;
  serverStateVersion?: number;
  requiresResync?: boolean;
}

export interface MultiplayerSocketAckSuccess<TPayload> {
  ok: true;
  transport: 'socket';
  serverStateVersion?: number;
  payload: TPayload;
}

export interface MultiplayerSocketAckFailure {
  ok: false;
  transport: 'socket';
  error: MultiplayerSocketError;
}

export type MultiplayerSocketAck<TPayload> =
  | MultiplayerSocketAckSuccess<TPayload>
  | MultiplayerSocketAckFailure;

export interface MultiplayerSocketCommandPayloadMap {
  'mp:cmd:reconnect': { expectedRevision?: number };
  'mp:cmd:state': { expectedRevision?: number };
  'mp:cmd:start': { seed?: number; checkpointId?: string; expectedRevision?: number };
  'mp:cmd:action': { action: Action; expectedRevision?: number; clientStateVersion?: number; actionId?: string };
  'mp:cmd:leave': { expectedRevision?: number };
  'mp:cmd:pause': { expectedRevision?: number };
  'mp:cmd:resume': { expectedRevision?: number };
  'mp:cmd:undo': { expectedRevision?: number };
  'mp:cmd:reset_turn': { expectedRevision?: number };
  'mp:cmd:ready': { ready: boolean; expectedRevision?: number };
  'mp:cmd:reaction': { reaction: MultiplayerReaction; expectedRevision?: number };
  'mp:cmd:chat': { text: string; expectedRevision?: number };
  'mp:cmd:typing': { typing: boolean; expectedRevision?: number };
  'mp:cmd:checkpoint_save': { name: string; expectedRevision?: number };
  'mp:cmd:checkpoint_load': { checkpointId: string; expectedRevision?: number };
  'mp:cmd:checkpoint_delete': { checkpointId: string; expectedRevision?: number };
}

export interface MultiplayerSocketCommandResponseMap {
  'mp:cmd:reconnect': MultiplayerResumeRoomResponse;
  'mp:cmd:state': MultiplayerRoomView;
  'mp:cmd:start': { ok: true };
  'mp:cmd:action': { ok: true };
  'mp:cmd:leave': { ok: true };
  'mp:cmd:pause': { ok: true };
  'mp:cmd:resume': { ok: true };
  'mp:cmd:undo': { ok: true };
  'mp:cmd:reset_turn': { ok: true };
  'mp:cmd:ready': { ok: true };
  'mp:cmd:reaction': { ok: true };
  'mp:cmd:chat': { ok: true };
  'mp:cmd:typing': { ok: true };
  'mp:cmd:checkpoint_save': { checkpoint: MultiplayerCheckpointSummary };
  'mp:cmd:checkpoint_load': { ok: true };
  'mp:cmd:checkpoint_delete': { ok: true };
}
