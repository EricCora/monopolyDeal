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
  MultiplayerCheckpointSummary,
  MultiplayerPlayerSummary,
  MultiplayerRoomView,
  MultiplayerRoomStatus,
  RoomSessionResponse,
} from '../../../packages/shared/multiplayer.ts';

const RECONNECT_WINDOW_MS = 5 * 60 * 1000;
const STALE_CONNECTION_MS = 12_000;
const MAX_CHECKPOINTS = 5;

type ReversibleActionType = 'draw_cards' | 'play_to_bank' | 'play_property' | 'play_action' | 'move_wild';

interface RoomParticipant {
  id: PlayerId;
  name: string;
  sessionToken: string;
  connected: boolean;
  lastSeenAt: number;
  reconnectDeadlineMs: number;
}

interface RoomCheckpoint {
  id: string;
  name: string;
  savedAt: number;
  game: GameState;
}

export interface MultiplayerRoom {
  code: string;
  createdAt: number;
  updatedAt: number;
  hostPlayerId: PlayerId;
  status: MultiplayerRoomStatus;
  players: RoomParticipant[];
  game: GameState | null;
  paused: boolean;
  pausedByPlayerId?: PlayerId;
  revision: number;
  turnSnapshots: GameState[];
  checkpoints: RoomCheckpoint[];
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

function randomCheckpointId(): string {
  return `${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function sanitizeName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 28) : fallback;
}

function sanitizeCheckpointName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 48) : 'Checkpoint';
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

function assertReconnectWindowOpen(player: RoomParticipant, now = nowMs()): void {
  if (!player.connected && now > player.reconnectDeadlineMs) {
    throw new Error('reconnect_expired');
  }
}

function ensureExpectedRevision(room: MultiplayerRoom, expectedRevision?: number): void {
  if (expectedRevision == null) return;
  if (!Number.isFinite(expectedRevision)) {
    throw new Error('invalid_revision');
  }
  if (room.revision !== expectedRevision) {
    throw new Error('revision_conflict');
  }
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
  bumpUpdatedAt(room);
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

function reclaimExpiredLobbyParticipants(room: MultiplayerRoom, now = nowMs()): void {
  if (room.status !== 'lobby') return;
  const nextPlayers = room.players.filter((player) => player.connected || player.reconnectDeadlineMs > now);
  if (nextPlayers.length === room.players.length) return;
  room.players = nextPlayers;
  if (room.players.length === 0) {
    room.hostPlayerId = 'p1';
  } else {
    migrateHost(room);
  }
  bumpUpdatedAt(room);
}

function nextAvailableLobbyPlayerId(room: MultiplayerRoom): PlayerId {
  const taken = new Set(room.players.map((player) => player.id));
  for (let index = 1; index <= 4; index += 1) {
    const candidate = `p${index}` as PlayerId;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error('room_full');
}

function isReversibleActionType(actionType: Action['type']): actionType is ReversibleActionType {
  return actionType === 'draw_cards'
    || actionType === 'play_to_bank'
    || actionType === 'play_property'
    || actionType === 'play_action'
    || actionType === 'move_wild';
}

function shouldRetainTurnSnapshots(nextState: GameState, nextPromptPlayerId: string): boolean {
  if (isGameOver(nextState).done) return false;
  if (nextState.turn.phase !== 'action') return false;
  if (nextState.players[nextState.currentPlayerIndex]?.id !== nextPromptPlayerId) return false;
  if (!nextState.pending) return true;
  return nextState.pending.kind === 'rent'
    || nextState.pending.kind === 'sly_deal'
    || nextState.pending.kind === 'forced_deal'
    || nextState.pending.kind === 'deal_breaker';
}

function checkpointSummary(checkpoint: RoomCheckpoint): MultiplayerCheckpointSummary {
  return {
    id: checkpoint.id,
    name: checkpoint.name,
    savedAt: checkpoint.savedAt,
  };
}

function requireHost(room: MultiplayerRoom, playerId: PlayerId): void {
  if (room.hostPlayerId !== playerId) {
    throw new Error('host_required');
  }
}

function requireGame(room: MultiplayerRoom): GameState {
  if (!room.game) {
    throw new Error('room_not_started');
  }
  return room.game;
}

function requireConnectedPlayer(player: RoomParticipant): void {
  if (!player.connected) {
    throw new Error('invalid_session');
  }
}

function ensureNotPaused(room: MultiplayerRoom): void {
  if (room.paused) {
    throw new Error('room_paused');
  }
}

function incrementRevision(room: MultiplayerRoom): void {
  room.revision += 1;
}

function bumpUpdatedAt(room: MultiplayerRoom): void {
  room.updatedAt = nowMs();
}

function commitMutation(room: MultiplayerRoom): void {
  incrementRevision(room);
  bumpUpdatedAt(room);
}

function updateStatusFromGame(room: MultiplayerRoom): void {
  if (!room.game) {
    room.status = 'lobby';
    return;
  }
  const status = isGameOver(room.game);
  room.status = status.done ? 'finished' : 'active';
}

function findCheckpoint(room: MultiplayerRoom, checkpointId: string): RoomCheckpoint {
  const checkpoint = room.checkpoints.find((entry) => entry.id === checkpointId);
  if (!checkpoint) {
    throw new Error('checkpoint_not_found');
  }
  return checkpoint;
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
    paused: false,
    revision: 0,
    turnSnapshots: [],
    checkpoints: [],
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
  reclaimExpiredLobbyParticipants(room);
  if (room.players.length >= 4) {
    throw new Error('room_full');
  }
  const playerId = nextAvailableLobbyPlayerId(room);
  const token = randomToken();
  const now = nowMs();
  room.players.push({
    id: playerId,
    name: sanitizeName(playerName, `Player ${playerId.slice(1)}`),
    sessionToken: token,
    connected: true,
    lastSeenAt: now,
    reconnectDeadlineMs: now + RECONNECT_WINDOW_MS,
  });
  commitMutation(room);
  return {
    roomCode: room.code,
    playerId,
    sessionToken: token,
    reconnectDeadlineMs: now + RECONNECT_WINDOW_MS,
  };
}

export function reconnectRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): RoomSessionResponse {
  const player = requireSession(room, playerId, sessionToken);
  const now = nowMs();
  ensureExpectedRevision(room, expectedRevision);
  assertReconnectWindowOpen(player, now);
  touchPlayer(player);
  commitMutation(room);
  return {
    roomCode: room.code,
    playerId: player.id,
    sessionToken: player.sessionToken,
    reconnectDeadlineMs: player.reconnectDeadlineMs,
  };
}

export function leaveRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): void {
  void expectedRevision;
  const player = requireSession(room, playerId, sessionToken);
  markDisconnected(room, player);
  incrementRevision(room);
}

export function startRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, seed?: number, expectedRevision?: number): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  requireSession(room, playerId, sessionToken);
  requireHost(room, playerId);
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
  room.paused = false;
  room.pausedByPlayerId = undefined;
  room.turnSnapshots = [];
  updateStatusFromGame(room);
  commitMutation(room);
  return room;
}

export function pauseRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  requireConnectedPlayer(player);
  requireHost(room, playerId);
  requireGame(room);
  room.paused = true;
  room.pausedByPlayerId = playerId;
  commitMutation(room);
  return room;
}

export function resumeRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  requireConnectedPlayer(player);
  requireHost(room, playerId);
  requireGame(room);
  room.paused = false;
  room.pausedByPlayerId = undefined;
  commitMutation(room);
  return room;
}

export function applyRoomAction(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  action: Action,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  const game = requireGame(room);
  requireConnectedPlayer(player);
  ensureNotPaused(room);
  touchPlayer(player);
  if (action.playerId !== playerId) {
    throw new Error('player_action_mismatch');
  }
  const legal = getLegalActions(game, playerId);
  const isLegal = legal.some((entry) => JSON.stringify(entry.action) === JSON.stringify(action));
  if (!isLegal) {
    throw new Error('illegal_action');
  }

  const shouldSnapshot = isReversibleActionType(action.type) && getNextPrompt(game).playerId === playerId;
  if (shouldSnapshot) {
    room.turnSnapshots.push(structuredClone(game));
  }

  const result = applyAction(game, action);
  if (result.error) {
    throw new Error(result.error.code);
  }
  room.game = result.state;
  const nextPromptPlayerId = getNextPrompt(result.state).playerId;
  if (!shouldRetainTurnSnapshots(result.state, nextPromptPlayerId)) {
    room.turnSnapshots = [];
  }
  updateStatusFromGame(room);
  commitMutation(room);
  return room;
}

export function undoRoomAction(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  const game = requireGame(room);
  requireConnectedPlayer(player);
  ensureNotPaused(room);
  if (isGameOver(game).done) {
    throw new Error('room_finished');
  }
  if (getNextPrompt(game).playerId !== playerId) {
    throw new Error('invalid_turn');
  }
  if (room.turnSnapshots.length === 0) {
    throw new Error('no_turn_snapshot');
  }
  const previous = room.turnSnapshots[room.turnSnapshots.length - 1];
  room.turnSnapshots = room.turnSnapshots.slice(0, -1);
  room.game = previous;
  updateStatusFromGame(room);
  commitMutation(room);
  return room;
}

export function resetTurnRoomActions(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  const game = requireGame(room);
  requireConnectedPlayer(player);
  ensureNotPaused(room);
  if (isGameOver(game).done) {
    throw new Error('room_finished');
  }
  if (getNextPrompt(game).playerId !== playerId) {
    throw new Error('invalid_turn');
  }
  if (room.turnSnapshots.length === 0) {
    throw new Error('no_turn_snapshot');
  }
  const first = room.turnSnapshots[0];
  room.game = first;
  room.turnSnapshots = [];
  updateStatusFromGame(room);
  commitMutation(room);
  return room;
}

export function listRoomCheckpoints(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string): MultiplayerCheckpointSummary[] {
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  touchPlayer(player);
  return room.checkpoints.map(checkpointSummary);
}

export function saveRoomCheckpoint(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  name: string,
  expectedRevision?: number,
): MultiplayerCheckpointSummary {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  const game = requireGame(room);
  requireConnectedPlayer(player);
  requireHost(room, playerId);
  if (room.checkpoints.length >= MAX_CHECKPOINTS) {
    throw new Error('checkpoint_slots_full');
  }
  const checkpoint: RoomCheckpoint = {
    id: randomCheckpointId(),
    name: sanitizeCheckpointName(name),
    savedAt: nowMs(),
    game: structuredClone(game),
  };
  room.checkpoints.push(checkpoint);
  commitMutation(room);
  return checkpointSummary(checkpoint);
}

export function loadRoomCheckpoint(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  checkpointId: string,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  requireConnectedPlayer(player);
  requireHost(room, playerId);
  requireGame(room);
  const checkpoint = findCheckpoint(room, checkpointId);
  room.game = structuredClone(checkpoint.game);
  room.turnSnapshots = [];
  room.paused = false;
  room.pausedByPlayerId = undefined;
  updateStatusFromGame(room);
  commitMutation(room);
  return room;
}

export function deleteRoomCheckpoint(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  checkpointId: string,
  expectedRevision?: number,
): void {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  requireConnectedPlayer(player);
  requireHost(room, playerId);
  const existing = findCheckpoint(room, checkpointId);
  room.checkpoints = room.checkpoints.filter((entry) => entry.id !== existing.id);
  commitMutation(room);
}

export function roomView(room: MultiplayerRoom, viewerId: PlayerId, sessionToken: string): MultiplayerRoomView {
  const viewer = requireSession(room, viewerId, sessionToken);
  assertReconnectWindowOpen(viewer);
  touchPlayer(viewer);
  updateStatusFromGame(room);
  bumpUpdatedAt(room);
  const started = Boolean(room.game);
  const promptPlayerId = room.game ? getNextPrompt(room.game).playerId : undefined;
  const legalActions = room.game && viewer.connected && !room.paused ? getLegalActions(room.game, viewerId) : [];
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
    paused: room.paused,
    pausedByPlayerId: room.pausedByPlayerId,
    revision: room.revision,
    turnSnapshotCount: room.turnSnapshots.length,
    checkpointSlots: room.checkpoints.map(checkpointSummary),
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
      incrementRevision(room);
    }
    reclaimExpiredLobbyParticipants(room, now);

    const inactiveForMs = now - room.updatedAt;
    const ttl = room.status === 'lobby' ? 30 * 60 * 1000 : room.status === 'finished' ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
    if (inactiveForMs > ttl) {
      rooms.delete(code);
    }
  }
}
