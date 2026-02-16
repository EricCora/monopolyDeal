import type { Action, GameState, LegalAction, PlayerId } from '../../src/engine';

export interface LanPlayerSummary {
  id: PlayerId;
  name: string;
  handCount: number;
  bankCount: number;
  completeSets: number;
}

export interface LanRoomView {
  roomCode: string;
  started: boolean;
  winnerId?: PlayerId;
  yourPlayerId: PlayerId;
  players: LanPlayerSummary[];
  promptPlayerId?: PlayerId;
  legalActions: LegalAction[];
  gameState?: GameState;
}

export interface CreateRoomRequest {
  playerName: string;
}

export interface JoinRoomRequest {
  roomCode: string;
  playerName: string;
}

export interface StartRoomRequest {
  roomCode: string;
  seed?: number;
}

export interface ApplyRoomActionRequest {
  roomCode: string;
  playerId: PlayerId;
  action: Action;
}

export interface RoomSession {
  roomCode: string;
  playerId: PlayerId;
}
