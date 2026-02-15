import { applyAction, createGame, getLegalActions, getNextPrompt, getSetCompletionCount, isGameOver, type Action, type GameState, type PlayerConfig, type PlayerId } from '../../../src/engine';
import type { LanPlayerSummary, LanRoomView } from '../../../packages/shared/protocol';

export interface LanRoom {
  code: string;
  createdAt: number;
  players: Array<{ id: PlayerId; name: string }>;
  game: GameState | null;
}

function nextRoomCode(existing: Map<string, LanRoom>): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i += 1) {
      const index = Math.floor(Math.random() * alphabet.length);
      code += alphabet[index];
    }
    if (!existing.has(code)) return code;
  }
}

function sanitizeName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 28) : fallback;
}

function roomPlayerSummary(room: LanRoom): LanPlayerSummary[] {
  if (!room.game) {
    return room.players.map((entry) => ({
      id: entry.id,
      name: entry.name,
      handCount: 0,
      bankCount: 0,
      completeSets: 0,
    }));
  }

  return room.game.players.map((player) => ({
    id: player.id,
    name: player.name,
    handCount: player.hand.length,
    bankCount: player.bank.length,
    completeSets: getSetCompletionCount(player),
  }));
}

function maskForViewer(state: GameState, viewerId: PlayerId): GameState {
  const clone = structuredClone(state);
  for (const player of clone.players) {
    if (player.id === viewerId) continue;
    player.hand = Array.from({ length: player.hand.length }, () => '__hidden__');
  }
  return clone;
}

export function createRoom(rooms: Map<string, LanRoom>, hostName: string): { room: LanRoom; playerId: PlayerId } {
  const code = nextRoomCode(rooms);
  const playerId = 'p1';
  const room: LanRoom = {
    code,
    createdAt: Date.now(),
    players: [{ id: playerId, name: sanitizeName(hostName, 'Host') }],
    game: null,
  };
  rooms.set(code, room);
  return { room, playerId };
}

export function joinRoom(room: LanRoom, playerName: string): PlayerId {
  if (room.players.length >= 4) {
    throw new Error('room_full');
  }
  const playerId = `p${room.players.length + 1}`;
  room.players.push({ id: playerId, name: sanitizeName(playerName, `Player ${room.players.length + 1}`) });
  return playerId;
}

export function startRoom(room: LanRoom, seed?: number): LanRoom {
  if (room.players.length < 2) {
    throw new Error('minimum_players_required');
  }
  const players: PlayerConfig[] = room.players.map((player) => ({ id: player.id, name: player.name }));
  room.game = createGame({
    players,
    deckVersion: 'v1',
    seed,
  });
  return room;
}

export function applyRoomAction(room: LanRoom, playerId: PlayerId, action: Action): LanRoom {
  if (!room.game) {
    throw new Error('room_not_started');
  }
  if (action.playerId !== playerId) {
    throw new Error('player_action_mismatch');
  }
  const legal = getLegalActions(room.game, playerId);
  const isLegal = legal.some((entry) => JSON.stringify(entry.action) === JSON.stringify(action));
  if (!isLegal) {
    throw new Error('illegal_action');
  }

  const result = applyAction(room.game, action);
  if (result.error) {
    throw new Error(result.error.code);
  }
  room.game = result.state;
  return room;
}

export function roomView(room: LanRoom, viewerId: PlayerId): LanRoomView {
  const started = Boolean(room.game);
  const promptPlayerId = room.game ? getNextPrompt(room.game).playerId : undefined;
  const legalActions = room.game ? getLegalActions(room.game, viewerId) : [];
  const status = room.game ? isGameOver(room.game) : { done: false as const };

  return {
    roomCode: room.code,
    started,
    winnerId: status.done ? status.winnerId : undefined,
    yourPlayerId: viewerId,
    players: roomPlayerSummary(room),
    promptPlayerId,
    legalActions,
    gameState: room.game ? maskForViewer(room.game, viewerId) : undefined,
  };
}
