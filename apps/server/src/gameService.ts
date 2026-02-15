import {
  applyAction,
  createGame,
  getLegalActions,
  getNextPrompt,
  getSetCompletionCount,
  isGameOver,
  type Action,
  type GameState,
  type PlayerConfig,
  type PlayerId,
} from '../../../src/engine/index.ts';
import type {
  MultiplayerPlayerSummary,
  MultiplayerRoomView,
  MultiplayerRoomStatus,
  RoomSessionResponse,
} from '../../../packages/shared/multiplayer.ts';

const RECONNECT_WINDOW_MS = 5 * 60 * 1000;
const STALE_CONNECTION_MS = 12_000;

interface RoomParticipant {
  id: PlayerId;
  name: string;
  sessionToken: string;
  connected: boolean;
  lastSeenAt: number;
  reconnectDeadlineMs: number;
}

export interface MultiplayerRoom {
  code: string;
  createdAt: number;
  updatedAt: number;
  hostPlayerId: PlayerId;
  status: MultiplayerRoomStatus;
  players: RoomParticipant[];
  game: GameState | null;
}

function nowMs(): number {
  return Date.now();
}

function nextRoomCode(existing: Map<string, MultiplayerRoom>): string {
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

function randomToken(): string {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function sanitizeName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 28) : fallback;
}

function touchPlayer(player: RoomParticipant): void {
  const now = nowMs();
  player.connected = true;
  player.lastSeenAt = now;
  player.reconnectDeadlineMs = now + RECONNECT_WINDOW_MS;
}

function findPlayer(room: MultiplayerRoom, playerId: PlayerId): RoomParticipant | undefined {
  return room.players.find((player) => player.id === playerId);
}

function requireSession(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string): RoomParticipant {
  const player = findPlayer(room, playerId);
  if (!player) {
    throw new Error('invalid_session');
  }
  if (player.sessionToken !== sessionToken) {
    throw new Error('invalid_session');
  }
  return player;
}

function migrateHost(room: MultiplayerRoom): void {
  const currentHost = findPlayer(room, room.hostPlayerId);
  if (currentHost?.connected) return;

  const connectedCandidate = room.players.find((player) => player.connected);
  if (connectedCandidate) {
    room.hostPlayerId = connectedCandidate.id;
    return;
  }

  const fallback = room.players[0];
  if (fallback) {
    room.hostPlayerId = fallback.id;
  }
}

function markDisconnected(room: MultiplayerRoom, player: RoomParticipant): void {
  const now = nowMs();
  player.connected = false;
  player.lastSeenAt = now;
  player.reconnectDeadlineMs = now + RECONNECT_WINDOW_MS;
  migrateHost(room);
  room.updatedAt = now;
}

function roomPlayerSummary(room: MultiplayerRoom): MultiplayerPlayerSummary[] {
  if (!room.game) {
    return room.players.map((entry) => ({
      id: entry.id,
      name: entry.name,
      handCount: 0,
      bankCount: 0,
      completeSets: 0,
      connected: entry.connected,
      isHost: entry.id === room.hostPlayerId,
    }));
  }

  return room.game.players.map((player) => {
    const entry = findPlayer(room, player.id);
    return {
      id: player.id,
      name: player.name,
      handCount: player.hand.length,
      bankCount: player.bank.length,
      completeSets: getSetCompletionCount(player),
      connected: Boolean(entry?.connected),
      isHost: player.id === room.hostPlayerId,
    };
  });
}

function maskForViewer(state: GameState, viewerId: PlayerId): GameState {
  const clone = structuredClone(state);
  for (const player of clone.players) {
    if (player.id === viewerId) continue;
    player.hand = Array.from({ length: player.hand.length }, () => '__hidden__');
  }
  return clone;
}

function connectedLobbyPlayers(room: MultiplayerRoom): RoomParticipant[] {
  return room.players.filter((player) => player.connected);
}

function bumpUpdatedAt(room: MultiplayerRoom): void {
  room.updatedAt = nowMs();
}

function updateStatusFromGame(room: MultiplayerRoom): void {
  if (!room.game) {
    room.status = 'lobby';
    return;
  }
  const status = isGameOver(room.game);
  room.status = status.done ? 'finished' : 'active';
}

export function createRoom(
  rooms: Map<string, MultiplayerRoom>,
  hostName: string,
): { room: MultiplayerRoom; session: RoomSessionResponse } {
  const code = nextRoomCode(rooms);
  const playerId: PlayerId = 'p1';
  const token = randomToken();
  const createdAt = nowMs();
  const room: MultiplayerRoom = {
    code,
    createdAt,
    updatedAt: createdAt,
    hostPlayerId: playerId,
    status: 'lobby',
    players: [{
      id: playerId,
      name: sanitizeName(hostName, 'Host'),
      sessionToken: token,
      connected: true,
      lastSeenAt: createdAt,
      reconnectDeadlineMs: createdAt + RECONNECT_WINDOW_MS,
    }],
    game: null,
  };
  rooms.set(code, room);
  return {
    room,
    session: {
      roomCode: code,
      playerId,
      sessionToken: token,
      reconnectDeadlineMs: createdAt + RECONNECT_WINDOW_MS,
    },
  };
}

export function joinRoom(room: MultiplayerRoom, playerName: string): RoomSessionResponse {
  if (room.status !== 'lobby' || room.game) {
    throw new Error('room_started');
  }
  if (room.players.length >= 4) {
    throw new Error('room_full');
  }
  const playerId = `p${room.players.length + 1}` as PlayerId;
  const token = randomToken();
  const now = nowMs();
  room.players.push({
    id: playerId,
    name: sanitizeName(playerName, `Player ${room.players.length + 1}`),
    sessionToken: token,
    connected: true,
    lastSeenAt: now,
    reconnectDeadlineMs: now + RECONNECT_WINDOW_MS,
  });
  bumpUpdatedAt(room);
  return {
    roomCode: room.code,
    playerId,
    sessionToken: token,
    reconnectDeadlineMs: now + RECONNECT_WINDOW_MS,
  };
}

export function reconnectRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string): RoomSessionResponse {
  const player = requireSession(room, playerId, sessionToken);
  const now = nowMs();
  if (!player.connected && now > player.reconnectDeadlineMs) {
    throw new Error('reconnect_expired');
  }
  touchPlayer(player);
  bumpUpdatedAt(room);
  return {
    roomCode: room.code,
    playerId: player.id,
    sessionToken: player.sessionToken,
    reconnectDeadlineMs: player.reconnectDeadlineMs,
  };
}

export function leaveRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string): void {
  const player = requireSession(room, playerId, sessionToken);
  markDisconnected(room, player);
}

export function startRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, seed?: number): MultiplayerRoom {
  requireSession(room, playerId, sessionToken);
  if (room.hostPlayerId !== playerId) {
    throw new Error('host_required');
  }
  if (room.status !== 'lobby') {
    throw new Error('room_started');
  }
  const activePlayers = connectedLobbyPlayers(room);
  if (activePlayers.length < 2) {
    throw new Error('minimum_players_required');
  }
  const players: PlayerConfig[] = activePlayers.map((player) => ({ id: player.id, name: player.name }));
  room.game = createGame({
    players,
    deckVersion: 'v1',
    seed,
  });
  room.status = 'active';
  bumpUpdatedAt(room);
  return room;
}

export function applyRoomAction(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  action: Action,
): MultiplayerRoom {
  const player = requireSession(room, playerId, sessionToken);
  if (!room.game) {
    throw new Error('room_not_started');
  }
  if (!player.connected) {
    throw new Error('invalid_session');
  }
  touchPlayer(player);
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
  updateStatusFromGame(room);
  bumpUpdatedAt(room);
  return room;
}

export function roomView(room: MultiplayerRoom, viewerId: PlayerId, sessionToken: string): MultiplayerRoomView {
  const viewer = requireSession(room, viewerId, sessionToken);
  touchPlayer(viewer);
  updateStatusFromGame(room);
  const started = Boolean(room.game);
  const promptPlayerId = room.game ? getNextPrompt(room.game).playerId : undefined;
  const legalActions = room.game && viewer.connected ? getLegalActions(room.game, viewerId) : [];
  const status = room.game ? isGameOver(room.game) : { done: false as const };
  const reconnectDeadlineMs = viewer.reconnectDeadlineMs;
  const serverTime = nowMs();

  return {
    roomCode: room.code,
    status: room.status,
    started,
    winnerId: status.done ? status.winnerId : undefined,
    hostPlayerId: room.hostPlayerId,
    yourPlayerId: viewerId,
    players: roomPlayerSummary(room),
    promptPlayerId,
    legalActions,
    gameState: room.game ? maskForViewer(room.game, viewerId) : undefined,
    canStart: room.status === 'lobby' && room.hostPlayerId === viewerId && connectedLobbyPlayers(room).length >= 2,
    reconnectDeadlineMs,
    serverTime,
  };
}

export function pruneInactiveRooms(rooms: Map<string, MultiplayerRoom>, now = nowMs()): void {
  for (const [code, room] of rooms) {
    for (const player of room.players) {
      if (!player.connected) continue;
      if (now - player.lastSeenAt <= STALE_CONNECTION_MS) continue;
      markDisconnected(room, player);
    }

    const inactiveForMs = now - room.updatedAt;
    const ttl = room.status === 'lobby' ? 30 * 60 * 1000 : room.status === 'finished' ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
    if (inactiveForMs > ttl) {
      rooms.delete(code);
    }
  }
}
