import type { Action, GameState, LegalAction } from '../engine';

export interface LanPlayerSummary {
  id: string;
  name: string;
  handCount: number;
  bankCount: number;
  completeSets: number;
}

export interface LanRoomView {
  roomCode: string;
  started: boolean;
  winnerId?: string;
  yourPlayerId: string;
  players: LanPlayerSummary[];
  promptPlayerId?: string;
  legalActions: LegalAction[];
  gameState?: GameState;
}

export interface RoomSession {
  roomCode: string;
  playerId: string;
}

export interface CreateRoomResponse extends RoomSession {}
export interface JoinRoomResponse extends RoomSession {}

export interface ApplyRoomActionPayload {
  roomCode: string;
  playerId: string;
  action: Action;
}
