import type { Action, GameState, LegalAction, PlayerId } from '../../src/engine';

export type MultiplayerRoomStatus = 'lobby' | 'active' | 'finished';

export interface MultiplayerPlayerSummary {
  id: PlayerId;
  name: string;
  handCount: number;
  bankCount: number;
  completeSets: number;
  connected: boolean;
  isHost: boolean;
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
  canStart: boolean;
  reconnectDeadlineMs: number;
  serverTime: number;
}

export interface RoomSessionResponse {
  roomCode: string;
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
  playerId: PlayerId;
  sessionToken: string;
}

export type StartRoomRequest = ReconnectRoomRequest;

export type LeaveRoomRequest = ReconnectRoomRequest;

export interface ApplyRoomActionRequest extends ReconnectRoomRequest {
  action: Action;
}
