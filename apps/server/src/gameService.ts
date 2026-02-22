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
  MultiplayerActivityFeedItem,
  MultiplayerChatMessage,
  MultiplayerCheckpointSummary,
  MultiplayerPlayerSummary,
  MultiplayerReaction,
  MultiplayerRoomView,
  MultiplayerRoomStatus,
  RoomSessionResponse,
} from '../../../packages/shared/multiplayer.ts';

const RECONNECT_WINDOW_LEGACY_MS = 5 * 60 * 1000;
const RECONNECT_WINDOW_V1_DEFAULT_MS = 90_000;
const MP_RECONNECT_V1_ENABLED = process.env.MP_RECONNECT_V1 === 'true';
const MP_VERSION_GUARD_V1_ENABLED = process.env.MP_VERSION_GUARD_V1 === 'true';
const RECONNECT_WINDOW_MS = resolveReconnectWindowMs(MP_RECONNECT_V1_ENABLED, process.env.MP_RECONNECT_GRACE_MS);
// Keep lobby heartbeat grace long enough for frequent tab switching during local beta sessions.
const STALE_CONNECTION_MS = 1.5 * 60 * 1000;
const MAX_CHECKPOINTS = 5;
const MAX_ACTIVITY_FEED = 24;
const MAX_CHAT_MESSAGES = 150;
const MAX_TRACKED_ACTION_IDS = 128;
const REACTION_COOLDOWN_MS = 1_500;
const CHAT_COOLDOWN_MS = 700;
const MAX_CHAT_MESSAGE_LENGTH = 280;
const TYPING_TTL_MS = 4_500;
export const ROOM_REACTION_OPTIONS: MultiplayerReaction[] = ['nice', 'wow', 'gg', 'oops'];

export function resolveReconnectWindowMs(mpReconnectV1Enabled: boolean, configuredGraceMs?: string): number {
  if (!mpReconnectV1Enabled) return RECONNECT_WINDOW_LEGACY_MS;
  const parsed = Number(configuredGraceMs);
  if (Number.isFinite(parsed) && parsed >= 1_000) {
    return Math.floor(parsed);
  }
  return RECONNECT_WINDOW_V1_DEFAULT_MS;
}

type ReversibleActionType = 'draw_cards' | 'play_to_bank' | 'play_property' | 'play_action' | 'move_wild';

interface RoomParticipant {
  id: PlayerId;
  name: string;
  sessionToken: string;
  connected: boolean;
  connectionState: 'connected' | 'disconnected' | 'reconnecting' | 'timed_out';
  disconnectedAt: number | null;
  lastSeenAt: number;
  reconnectDeadlineMs: number;
  ready: boolean;
  lastReactionAt: number;
  lastChatAt: number;
}

interface RoomCheckpoint {
  id: string;
  name: string;
  savedAt: number;
  game: GameState;
}

export interface ApplyRoomActionOptions {
  clientStateVersion?: number;
  actionId?: string;
}

type RoomActivityEntry = MultiplayerActivityFeedItem;

export interface MultiplayerRoom {
  code: string;
  createdAt: number;
  updatedAt: number;
  originalHostPlayerId: PlayerId;
  hostPlayerId: PlayerId;
  status: MultiplayerRoomStatus;
  players: RoomParticipant[];
  game: GameState | null;
  paused: boolean;
  pausedByPlayerId?: PlayerId;
  revision: number;
  recentActionIds: string[];
  turnSnapshots: GameState[];
  checkpoints: RoomCheckpoint[];
  activityFeed: RoomActivityEntry[];
  nextActivityId: number;
  chatMessages: MultiplayerChatMessage[];
  nextChatId: number;
  typingByPlayerId: Record<string, number>;
}

export interface SeatConnectionSnapshot {
  seatId: PlayerId;
  displayName: string;
  connected: boolean;
  connectionState: 'connected' | 'disconnected' | 'reconnecting' | 'timed_out';
  disconnectedAt: number | null;
  reconnectDeadlineMs: number;
}

export interface TimeoutTransitionResult {
  transitioned: boolean;
  seatId: PlayerId;
  displayName: string;
  graceExpiresAt: number;
}

export interface PruneInactiveRoomsResult {
  disconnectedSeats: Array<{
    roomCode: string;
    seatId: PlayerId;
    displayName: string;
    graceExpiresAt: number;
  }>;
  removedRoomCodes: string[];
}

export function normalizeRoomForRuntime(room: MultiplayerRoom): MultiplayerRoom {
  room.activityFeed = Array.isArray(room.activityFeed) ? room.activityFeed : [];
  room.nextActivityId = Number.isFinite(room.nextActivityId)
    ? Math.max(Number(room.nextActivityId), room.activityFeed.length + 1)
    : (room.activityFeed.length + 1);
  room.chatMessages = Array.isArray(room.chatMessages)
    ? room.chatMessages
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.playerId === 'string' && typeof entry.playerName === 'string')
      .map((entry, index) => ({
        id: Number.isFinite(entry.id) ? Number(entry.id) : index + 1,
        createdAt: Number.isFinite(entry.createdAt) ? Number(entry.createdAt) : nowMs(),
        playerId: entry.playerId,
        playerName: entry.playerName.slice(0, 28),
        text: sanitizeChatText(String(entry.text ?? '')),
      }))
      .filter((entry) => entry.text.length > 0)
      .slice(-MAX_CHAT_MESSAGES)
    : [];
  room.nextChatId = Number.isFinite(room.nextChatId)
    ? Math.max(Number(room.nextChatId), room.chatMessages.length + 1)
    : (room.chatMessages.length + 1);
  room.typingByPlayerId = room.typingByPlayerId && typeof room.typingByPlayerId === 'object'
    ? room.typingByPlayerId
    : {};
  const players = Array.isArray(room.players) ? room.players : [];
  room.players = players.map((player) => ({
    ...player,
    connectionState: player.connectionState === 'connected'
      || player.connectionState === 'disconnected'
      || player.connectionState === 'reconnecting'
      || player.connectionState === 'timed_out'
      ? player.connectionState
      : (player.connected ? 'connected' : 'disconnected'),
    disconnectedAt: Number.isFinite(player.disconnectedAt)
      ? Number(player.disconnectedAt)
      : (player.connected ? null : (Number.isFinite(player.lastSeenAt) ? Number(player.lastSeenAt) : null)),
    ready: Boolean(player.ready),
    lastReactionAt: Number.isFinite(player.lastReactionAt) ? Number(player.lastReactionAt) : 0,
    lastChatAt: Number.isFinite(player.lastChatAt) ? Number(player.lastChatAt) : 0,
  }));
  room.recentActionIds = Array.isArray(room.recentActionIds)
    ? room.recentActionIds.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).slice(-MAX_TRACKED_ACTION_IDS)
    : [];
  return room;
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

function sanitizeChatText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.slice(0, MAX_CHAT_MESSAGE_LENGTH);
}

function pruneExpiredTyping(room: MultiplayerRoom, now = nowMs()): void {
  const entries = Object.entries(room.typingByPlayerId);
  if (entries.length === 0) return;
  for (const [playerId, deadline] of entries) {
    if (!Number.isFinite(deadline) || deadline <= now) {
      delete room.typingByPlayerId[playerId];
    }
  }
}

function reactionLabel(reaction: MultiplayerReaction): string {
  if (reaction === 'nice') return 'Nice play';
  if (reaction === 'wow') return 'Wow';
  if (reaction === 'gg') return 'GG';
  return 'Oops';
}

function appendActivity(
  room: MultiplayerRoom,
  kind: RoomActivityEntry['kind'],
  message: string,
  options?: { playerId?: PlayerId; reaction?: MultiplayerReaction },
): void {
  const entry: RoomActivityEntry = {
    id: room.nextActivityId,
    createdAt: nowMs(),
    kind,
    message,
    playerId: options?.playerId,
    reaction: options?.reaction,
  };
  room.nextActivityId += 1;
  room.activityFeed = [entry, ...room.activityFeed].slice(0, MAX_ACTIVITY_FEED);
}

function playerDisplayName(room: MultiplayerRoom, playerId: PlayerId): string {
  return findPlayer(room, playerId)?.name ?? playerId;
}

function touchPlayer(player: RoomParticipant): void {
  const now = nowMs();
  player.connected = true;
  player.connectionState = 'connected';
  player.disconnectedAt = null;
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
  if (!player.connected && (now > player.reconnectDeadlineMs || player.connectionState === 'timed_out')) {
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

function migrateHost(room: MultiplayerRoom): { previousHostId: PlayerId; nextHostId: PlayerId } | null {
  const previousHostId = room.hostPlayerId;
  const currentHost = findPlayer(room, room.hostPlayerId);
  if (currentHost?.connected) return null;

  const connectedCandidate = room.players.find((player) => player.connected);
  if (connectedCandidate) {
    room.hostPlayerId = connectedCandidate.id;
    return room.hostPlayerId === previousHostId ? null : { previousHostId, nextHostId: room.hostPlayerId };
  }

  const fallback = room.players[0];
  if (fallback) {
    room.hostPlayerId = fallback.id;
    return room.hostPlayerId === previousHostId ? null : { previousHostId, nextHostId: room.hostPlayerId };
  }
  return null;
}

function markDisconnected(room: MultiplayerRoom, player: RoomParticipant): void {
  if (!player.connected) return;
  const now = nowMs();
  player.connected = false;
  player.connectionState = 'disconnected';
  player.disconnectedAt = now;
  player.lastSeenAt = now;
  player.reconnectDeadlineMs = now + RECONNECT_WINDOW_MS;
  delete room.typingByPlayerId[player.id];
  appendActivity(room, 'connection', `${player.name} disconnected.`, { playerId: player.id });
  const migrated = migrateHost(room);
  if (migrated) {
    appendActivity(
      room,
      'host',
      `${playerDisplayName(room, migrated.nextHostId)} is now host.`,
      { playerId: migrated.nextHostId },
    );
  }
  bumpUpdatedAt(room);
}

export function getSeatConnectionSnapshot(room: MultiplayerRoom, seatId: PlayerId): SeatConnectionSnapshot | null {
  const player = findPlayer(room, seatId);
  if (!player) return null;
  return {
    seatId: player.id,
    displayName: player.name,
    connected: player.connected,
    connectionState: player.connectionState,
    disconnectedAt: player.disconnectedAt,
    reconnectDeadlineMs: player.reconnectDeadlineMs,
  };
}

export function listSeatConnectionSnapshots(room: MultiplayerRoom): SeatConnectionSnapshot[] {
  return room.players.map((player) => ({
    seatId: player.id,
    displayName: player.name,
    connected: player.connected,
    connectionState: player.connectionState,
    disconnectedAt: player.disconnectedAt,
    reconnectDeadlineMs: player.reconnectDeadlineMs,
  }));
}

export function markSeatTimedOutIfExpired(
  room: MultiplayerRoom,
  seatId: PlayerId,
  now = nowMs(),
): TimeoutTransitionResult {
  const player = findPlayer(room, seatId);
  if (!player) {
    return {
      transitioned: false,
      seatId,
      displayName: seatId,
      graceExpiresAt: now,
    };
  }
  if (player.connected || player.reconnectDeadlineMs > now || player.connectionState === 'timed_out') {
    return {
      transitioned: false,
      seatId: player.id,
      displayName: player.name,
      graceExpiresAt: player.reconnectDeadlineMs,
    };
  }
  player.connected = false;
  player.connectionState = 'timed_out';
  player.lastSeenAt = now;
  appendActivity(room, 'connection', `${player.name} timed out.`, { playerId: player.id });
  incrementRevision(room);
  bumpUpdatedAt(room);
  return {
    transitioned: true,
    seatId: player.id,
    displayName: player.name,
    graceExpiresAt: player.reconnectDeadlineMs,
  };
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
      connectionState: entry.connectionState,
      disconnectedAt: entry.disconnectedAt,
      lastSeenAt: entry.lastSeenAt,
      reconnectDeadlineMs: entry.reconnectDeadlineMs,
      isHost: entry.id === room.hostPlayerId,
      ready: entry.ready,
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
      connectionState: entry?.connectionState ?? (entry?.connected ? 'connected' : 'disconnected'),
      disconnectedAt: entry?.disconnectedAt ?? null,
      lastSeenAt: entry?.lastSeenAt ?? room.updatedAt,
      reconnectDeadlineMs: entry?.reconnectDeadlineMs ?? room.updatedAt,
      isHost: player.id === room.hostPlayerId,
      ready: Boolean(entry?.ready),
    };
  });
}

function canonicalizeCardIds(cardIds: string[]): string[] {
  return [...cardIds].sort((left, right) => left.localeCompare(right));
}

function normalizeActionForComparison(action: Action): Action {
  if (action.type !== 'pay_request') return action;
  return {
    ...action,
    cards: canonicalizeCardIds(action.cards),
  };
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

function removeLobbyParticipant(room: MultiplayerRoom, playerId: PlayerId): boolean {
  if (room.status !== 'lobby') return false;
  const player = findPlayer(room, playerId);
  if (!player) return false;
  const nextPlayers = room.players.filter((entry) => entry.id !== playerId);
  if (nextPlayers.length === room.players.length) return false;
  delete room.typingByPlayerId[player.id];
  appendActivity(room, 'connection', `${player.name} left the lobby.`, { playerId: player.id });
  room.players = nextPlayers;
  if (room.players.length === 0) {
    room.hostPlayerId = 'p1';
  } else {
    const migrated = migrateHost(room);
    if (migrated) {
      appendActivity(room, 'host', `${playerDisplayName(room, migrated.nextHostId)} is now host.`, { playerId: migrated.nextHostId });
    }
  }
  bumpUpdatedAt(room);
  return true;
}

function reclaimDisconnectedLobbyParticipants(
  room: MultiplayerRoom,
  now = nowMs(),
  reclaimMode: 'expired' | 'all' = 'expired',
): void {
  if (room.status !== 'lobby') return;
  const disconnected = room.players.filter((player) => !player.connected);
  const reclaimable = reclaimMode === 'all'
    ? disconnected
    : disconnected.filter((player) => player.reconnectDeadlineMs <= now);
  if (reclaimable.length === 0) return;
  reclaimable.forEach((player) => {
    removeLobbyParticipant(room, player.id);
  });
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

function hasTrackedActionId(room: MultiplayerRoom, actionId: string): boolean {
  if (!actionId) return false;
  return room.recentActionIds.includes(actionId);
}

function trackActionId(room: MultiplayerRoom, actionId?: string): void {
  if (!actionId) return;
  room.recentActionIds = [...room.recentActionIds.filter((entry) => entry !== actionId), actionId]
    .slice(-MAX_TRACKED_ACTION_IDS);
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
    originalHostPlayerId: playerId,
    hostPlayerId: playerId,
    status: 'lobby',
    players: [{
      id: playerId,
      name: sanitizeName(hostName, 'Host'),
      sessionToken: token,
      connected: true,
      connectionState: 'connected',
      disconnectedAt: null,
      lastSeenAt: createdAt,
      reconnectDeadlineMs: createdAt + RECONNECT_WINDOW_MS,
      ready: false,
      lastReactionAt: 0,
      lastChatAt: 0,
    }],
    game: null,
    paused: false,
    revision: 0,
    recentActionIds: [],
    turnSnapshots: [],
    checkpoints: [],
    activityFeed: [],
    nextActivityId: 1,
    chatMessages: [],
    nextChatId: 1,
    typingByPlayerId: {},
  };
  appendActivity(room, 'lobby', `${room.players[0].name} created the room.`, { playerId });
  rooms.set(code, room);
  return {
    room,
    session: {
      roomCode: code,
      seatId: playerId,
      resumeToken: token,
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
  reclaimDisconnectedLobbyParticipants(room, nowMs(), 'all');
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
    connectionState: 'connected',
    disconnectedAt: null,
    lastSeenAt: now,
    reconnectDeadlineMs: now + RECONNECT_WINDOW_MS,
    ready: false,
    lastReactionAt: 0,
    lastChatAt: 0,
  });
  appendActivity(room, 'lobby', `${sanitizeName(playerName, `Player ${playerId.slice(1)}`)} joined the lobby.`, { playerId });
  commitMutation(room);
  return {
    roomCode: room.code,
    seatId: playerId,
    resumeToken: token,
    playerId,
    sessionToken: token,
    reconnectDeadlineMs: now + RECONNECT_WINDOW_MS,
  };
}

export function reconnectRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): RoomSessionResponse {
  void expectedRevision;
  const player = requireSession(room, playerId, sessionToken);
  const now = nowMs();
  assertReconnectWindowOpen(player, now);
  const wasConnected = player.connected;
  const previousHostId = room.hostPlayerId;
  touchPlayer(player);
  if (!wasConnected) {
    appendActivity(room, 'connection', `${player.name} reconnected.`, { playerId: player.id });
  }
  if (player.id === room.originalHostPlayerId && room.hostPlayerId !== player.id) {
    room.hostPlayerId = player.id;
    appendActivity(room, 'host', `${player.name} is now host.`, { playerId: player.id });
  } else if (previousHostId !== room.hostPlayerId) {
    appendActivity(room, 'host', `${playerDisplayName(room, room.hostPlayerId)} is now host.`, { playerId: room.hostPlayerId });
  }
  commitMutation(room);
  return {
    roomCode: room.code,
    seatId: player.id,
    resumeToken: player.sessionToken,
    playerId: player.id,
    sessionToken: player.sessionToken,
    reconnectDeadlineMs: player.reconnectDeadlineMs,
  };
}

export function leaveRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): void {
  void expectedRevision;
  const player = requireSession(room, playerId, sessionToken);
  if (room.status === 'lobby') {
    if (removeLobbyParticipant(room, player.id)) {
      incrementRevision(room);
    }
    return;
  }
  markDisconnected(room, player);
  incrementRevision(room);
}

export function startRoom(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  seed?: number,
  expectedRevision?: number,
  checkpointId?: string,
): MultiplayerRoom {
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
  if (checkpointId) {
    const checkpoint = findCheckpoint(room, checkpointId);
    const lobbyPlayerById = new Map(activePlayers.map((entry) => [entry.id, entry.name]));
    const sameParticipants = checkpoint.game.players.length === activePlayers.length
      && checkpoint.game.players.every((entry) => lobbyPlayerById.get(entry.id) === entry.name);
    if (!sameParticipants) {
      throw new Error('checkpoint_player_mismatch');
    }
    room.game = structuredClone(checkpoint.game);
  } else {
    room.game = createGame({
      players,
      deckVersion: 'v1',
      seed,
    });
  }
  room.paused = false;
  room.pausedByPlayerId = undefined;
  room.turnSnapshots = [];
  room.recentActionIds = [];
  room.players.forEach((entry) => {
    entry.ready = false;
  });
  appendActivity(room, 'match', checkpointId ? 'Match started from checkpoint.' : 'Match started.');
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
  appendActivity(room, 'match', `${player.name} paused the match.`, { playerId });
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
  appendActivity(room, 'match', `${player.name} resumed the match.`, { playerId });
  commitMutation(room);
  return room;
}

export function applyRoomAction(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  action: Action,
  expectedRevision?: number,
  options: ApplyRoomActionOptions = {},
): MultiplayerRoom {
  const actionId = options.actionId?.trim();
  const versionGuardEnabled = MP_VERSION_GUARD_V1_ENABLED
    || options.clientStateVersion != null
    || Boolean(actionId);
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  const game = requireGame(room);
  requireConnectedPlayer(player);
  ensureNotPaused(room);
  touchPlayer(player);
  if (versionGuardEnabled && actionId && hasTrackedActionId(room, actionId)) {
    return room;
  }
  if (
    versionGuardEnabled
    && Number.isFinite(options.clientStateVersion)
    && Number(options.clientStateVersion) !== room.revision
  ) {
    throw new Error('stale_state');
  }
  const activePromptPlayerId = getNextPrompt(game).playerId;
  if (versionGuardEnabled && activePromptPlayerId !== playerId) {
    throw new Error('not_your_turn');
  }
  if (action.playerId !== playerId) {
    throw new Error('player_action_mismatch');
  }
  const legal = getLegalActions(game, playerId);
  const normalizedAction = JSON.stringify(normalizeActionForComparison(action));
  const isLegal = action.type === 'pay_request'
    ? legal.some((entry) => entry.action.type === 'pay_request')
    : legal.some((entry) => JSON.stringify(normalizeActionForComparison(entry.action)) === normalizedAction);
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
  if (isGameOver(result.state).done) {
    appendActivity(room, 'match', 'Match completed.');
  }
  updateStatusFromGame(room);
  commitMutation(room);
  if (versionGuardEnabled && actionId) {
    trackActionId(room, actionId);
  }
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
  appendActivity(room, 'checkpoint', `${player.name} saved checkpoint "${checkpoint.name}".`, { playerId });
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
  room.recentActionIds = [];
  room.paused = false;
  room.pausedByPlayerId = undefined;
  appendActivity(room, 'checkpoint', `${player.name} loaded checkpoint "${checkpoint.name}".`, { playerId });
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
  appendActivity(room, 'checkpoint', `${player.name} deleted checkpoint "${existing.name}".`, { playerId });
  commitMutation(room);
}

export function setRoomReady(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  ready: boolean,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  if (room.status !== 'lobby' || room.game) {
    throw new Error('room_started');
  }
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  touchPlayer(player);
  if (player.ready === ready) return room;
  player.ready = ready;
  appendActivity(room, 'ready', ready ? `${player.name} is ready.` : `${player.name} is not ready.`, { playerId });
  commitMutation(room);
  return room;
}

export function sendRoomReaction(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  reaction: MultiplayerReaction,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  requireConnectedPlayer(player);
  const now = nowMs();
  if (now - player.lastReactionAt < REACTION_COOLDOWN_MS) {
    throw new Error('reaction_rate_limited');
  }
  player.lastReactionAt = now;
  appendActivity(room, 'reaction', `${player.name}: ${reactionLabel(reaction)}`, { playerId, reaction });
  commitMutation(room);
  return room;
}

export function sendRoomChat(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  text: string,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  requireConnectedPlayer(player);
  touchPlayer(player);
  const now = nowMs();
  const raw = text.trim();
  if (!raw) {
    throw new Error('chat_empty');
  }
  if (raw.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new Error('chat_too_long');
  }
  if (now - player.lastChatAt < CHAT_COOLDOWN_MS) {
    throw new Error('chat_rate_limited');
  }

  player.lastChatAt = now;
  delete room.typingByPlayerId[player.id];
  room.chatMessages = [
    ...room.chatMessages,
    {
      id: room.nextChatId,
      createdAt: now,
      playerId: player.id,
      playerName: player.name,
      text: sanitizeChatText(text),
    },
  ].slice(-MAX_CHAT_MESSAGES);
  room.nextChatId += 1;
  commitMutation(room);
  return room;
}

export function setRoomTyping(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  typing: boolean,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  requireConnectedPlayer(player);
  touchPlayer(player);
  pruneExpiredTyping(room);

  if (!typing) {
    if (!room.typingByPlayerId[player.id]) return room;
    delete room.typingByPlayerId[player.id];
    commitMutation(room);
    return room;
  }

  room.typingByPlayerId[player.id] = nowMs() + TYPING_TTL_MS;
  commitMutation(room);
  return room;
}

export function roomView(room: MultiplayerRoom, viewerId: PlayerId, sessionToken: string): MultiplayerRoomView {
  const viewer = requireSession(room, viewerId, sessionToken);
  assertReconnectWindowOpen(viewer);
  if (viewer.connected) {
    touchPlayer(viewer);
  } else {
    viewer.lastSeenAt = nowMs();
  }
  updateStatusFromGame(room);
  bumpUpdatedAt(room);
  pruneExpiredTyping(room);
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
    activityFeed: room.activityFeed,
    chatMessages: room.chatMessages,
    typingPlayerIds: Object.keys(room.typingByPlayerId),
    lastEventId: room.revision,
  };
}

export function pruneInactiveRooms(rooms: Map<string, MultiplayerRoom>, now = nowMs()): PruneInactiveRoomsResult {
  const disconnectedSeats: PruneInactiveRoomsResult['disconnectedSeats'] = [];
  const removedRoomCodes: string[] = [];
  for (const [code, room] of rooms) {
    pruneExpiredTyping(room, now);
    const staleConnectedPlayers = room.players.filter((player) => (
      player.connected && now - player.lastSeenAt > STALE_CONNECTION_MS
    ));
    for (const player of staleConnectedPlayers) {
      if (room.status === 'lobby') {
        removeLobbyParticipant(room, player.id);
      } else {
        markDisconnected(room, player);
        disconnectedSeats.push({
          roomCode: room.code,
          seatId: player.id,
          displayName: player.name,
          graceExpiresAt: player.reconnectDeadlineMs,
        });
      }
      incrementRevision(room);
    }
    reclaimDisconnectedLobbyParticipants(room, now, room.status === 'lobby' ? 'all' : 'expired');

    const inactiveForMs = now - room.updatedAt;
    const ttl = room.status === 'lobby' ? 30 * 60 * 1000 : room.status === 'finished' ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
    if (inactiveForMs > ttl) {
      rooms.delete(code);
      removedRoomCodes.push(code);
    }
  }
  return { disconnectedSeats, removedRoomCodes };
}
