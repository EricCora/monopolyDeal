import {
  applyAction,
  createGame,
  DEFAULT_RULESET,
  getLegalActions,
  getNextPrompt,
  getSetCompletionCount,
  isGameOver,
  type Action,
  type GameState,
  type PlayerConfig,
  type PlayerId,
} from '../../../src/engine/index.ts';
import {
  DEFAULT_MULTIPLAYER_SESSION_PRESET,
  getMultiplayerSessionPresetDefinition,
  getMultiplayerSessionPresetRuleset,
  multiplayerSessionPresetRulesMatch,
  normalizeMultiplayerSessionPreset,
  type MultiplayerSessionPresetId,
} from '../../../src/ui/experience.ts';
import type {
  MultiplayerActivityFeedItem,
  MultiplayerChatMessage,
  MultiplayerCheckpointSummary,
  MultiplayerEndedReason,
  MultiplayerPausedReason,
  MultiplayerPlayerSummary,
  MultiplayerReaction,
  MultiplayerRoomView,
  MultiplayerRoomRuntimeState,
  MultiplayerRoomStatus,
  RoomSessionResponse,
} from '../../../packages/shared/multiplayer.ts';

const RECONNECT_WINDOW_V1_DEFAULT_MS = 90_000;
const RECONNECT_WINDOW_MS = resolveReconnectWindowMs(process.env.MP_RECONNECT_GRACE_MS);
// Keep lobby heartbeat grace long enough for frequent tab switching during local beta sessions.
const STALE_CONNECTION_LOBBY_MS = 1.5 * 60 * 1000;
// Active/finished matches should reflect disconnect presence quickly even if unload signals are dropped.
const STALE_CONNECTION_MATCH_MS = 20 * 1000;
const MAX_CHECKPOINTS = 5;
const MAX_ACTIVITY_FEED = 24;
const MAX_CHAT_MESSAGES = 150;
const MAX_TRACKED_ACTION_IDS = 128;
const REACTION_COOLDOWN_MS = 1_500;
const CHAT_COOLDOWN_MS = 700;
const MAX_CHAT_MESSAGE_LENGTH = 280;
const TYPING_TTL_MS = 4_500;
export const ROOM_REACTION_OPTIONS: MultiplayerReaction[] = ['nice', 'wow', 'gg', 'oops'];

export function resolveReconnectWindowMs(configuredGraceMs?: string): number {
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

interface DisconnectPauseRestoreState {
  paused: boolean;
  pausedByPlayerId?: PlayerId;
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
  presetId: MultiplayerSessionPresetId;
  players: RoomParticipant[];
  game: GameState | null;
  paused: boolean;
  pausedByPlayerId?: PlayerId;
  roomRuntimeState?: MultiplayerRoomRuntimeState;
  pausedReason?: MultiplayerPausedReason;
  endedReason?: MultiplayerEndedReason;
  disconnectPauseRestore?: DisconnectPauseRestoreState;
  revision: number;
  /** Monotonic stream sequence; unlike revision, social/presence events do not invalidate gameplay clients. */
  eventId: number;
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
  room.presetId = normalizeMultiplayerSessionPreset(room.presetId, DEFAULT_MULTIPLAYER_SESSION_PRESET);
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
  room.eventId = Number.isFinite(room.eventId) ? Math.max(Number(room.eventId), room.revision) : room.revision;
  room.roomRuntimeState = room.roomRuntimeState === 'active'
    || room.roomRuntimeState === 'paused_disconnect'
    || room.roomRuntimeState === 'paused_host_disconnect'
    || room.roomRuntimeState === 'ended_timeout'
    ? room.roomRuntimeState
    : (room.game ? 'active' : undefined);
  room.pausedReason = room.pausedReason === 'manual'
    || room.pausedReason === 'player_disconnect'
    || room.pausedReason === 'host_disconnect'
    ? room.pausedReason
    : (room.paused ? 'manual' : undefined);
  room.endedReason = room.endedReason === 'host_timeout'
    || room.endedReason === 'disconnect_timeout'
    ? room.endedReason
    : undefined;
  room.disconnectPauseRestore = room.disconnectPauseRestore?.paused
    ? {
        paused: true,
        pausedByPlayerId: typeof room.disconnectPauseRestore.pausedByPlayerId === 'string'
          ? room.disconnectPauseRestore.pausedByPlayerId as PlayerId
          : undefined,
      }
    : undefined;
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

function isHostSeat(room: MultiplayerRoom, seatId: PlayerId): boolean {
  return room.hostPlayerId === seatId;
}

function hasDisconnectedSeatAwaitingReconnect(room: MultiplayerRoom): boolean {
  return room.players.some((player) => player.connectionState === 'disconnected');
}

function clearDisconnectPauseRestore(room: MultiplayerRoom): void {
  room.disconnectPauseRestore = undefined;
}

function restorePauseStateAfterDisconnect(room: MultiplayerRoom): void {
  const restoreState = room.disconnectPauseRestore;
  clearDisconnectPauseRestore(room);
  room.roomRuntimeState = 'active';
  if (restoreState?.paused) {
    room.paused = true;
    room.pausedByPlayerId = restoreState.pausedByPlayerId;
    room.pausedReason = 'manual';
    return;
  }
  room.paused = false;
  room.pausedByPlayerId = undefined;
  room.pausedReason = undefined;
}

function applyDisconnectPauseState(room: MultiplayerRoom, disconnectedSeatId: PlayerId): void {
  if (room.status !== 'active' && room.status !== 'finished') return;
  if (room.roomRuntimeState === 'ended_timeout') return;
  if (room.roomRuntimeState !== 'paused_disconnect' && room.roomRuntimeState !== 'paused_host_disconnect') {
    room.disconnectPauseRestore = room.paused
      ? {
          paused: true,
          pausedByPlayerId: room.pausedByPlayerId,
        }
      : undefined;
  }
  const hostSeatDisconnected = isHostSeat(room, disconnectedSeatId);
  room.paused = true;
  room.pausedByPlayerId = undefined;
  room.roomRuntimeState = hostSeatDisconnected ? 'paused_host_disconnect' : 'paused_disconnect';
  room.pausedReason = hostSeatDisconnected ? 'host_disconnect' : 'player_disconnect';
}

function resolveDisconnectPauseStateAfterReconnect(room: MultiplayerRoom): void {
  if (room.roomRuntimeState !== 'paused_disconnect' && room.roomRuntimeState !== 'paused_host_disconnect') return;
  if (hasDisconnectedSeatAwaitingReconnect(room)) return;
  restorePauseStateAfterDisconnect(room);
}

function resolveDisconnectPauseStateAfterTimeout(room: MultiplayerRoom): void {
  if (room.roomRuntimeState !== 'paused_disconnect' && room.roomRuntimeState !== 'paused_host_disconnect') return;
  if (hasDisconnectedSeatAwaitingReconnect(room)) return;
  restorePauseStateAfterDisconnect(room);
}

function pendingReferencesPlayer(pending: GameState['pending'], playerId: PlayerId): boolean {
  if (!pending) return false;
  const visit = (value: unknown, key?: string): boolean => {
    if (typeof value === 'string') {
      return Boolean(key && (
        key.endsWith('PlayerId')
        || key === 'awaitingPlayerId'
        || key === 'remainingTargetPlayerIds'
      ) && value === playerId);
    }
    if (Array.isArray(value)) return value.some((entry) => visit(entry, key));
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([entryKey, entryValue]) => visit(entryValue, entryKey));
  };
  return visit(pending);
}

/**
 * Remove an expired seat from the engine state while preserving turn order.
 * Cards held by a retired seat are discarded; an interaction involving that
 * seat is canceled because its source/target can no longer legally respond.
 */
function retireTimedOutPlayerFromGame(room: MultiplayerRoom, playerId: PlayerId): boolean {
  const game = room.game;
  if (!game) return false;
  const playerIndex = game.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) return false;
  const wasCurrent = playerIndex === game.currentPlayerIndex;
  const oldCurrentIndex = game.currentPlayerIndex;
  const retired = game.players[playerIndex];

  game.discardPile.push(
    ...retired.hand,
    ...retired.bank,
    ...Object.values(retired.properties).flat().map((entry) => entry.cardId),
  );
  game.players.splice(playerIndex, 1);
  // A snapshot/checkpoint containing the retired seat must never be restorable.
  room.turnSnapshots = [];
  room.checkpoints = [];
  if (pendingReferencesPlayer(game.pending, playerId)) {
    game.pending = null;
  }

  if (game.players.length === 0) {
    game.currentPlayerIndex = 0;
    game.turn.phase = 'finished';
    game.winnerId = undefined;
  } else if (wasCurrent) {
    game.currentPlayerIndex = playerIndex >= game.players.length ? 0 : playerIndex;
    game.turn = { phase: 'draw', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
    game.turnCount += 1;
  } else {
    game.currentPlayerIndex = playerIndex < oldCurrentIndex ? oldCurrentIndex - 1 : oldCurrentIndex;
    if (game.currentPlayerIndex >= game.players.length) game.currentPlayerIndex = 0;
  }
  game.updatedAt = nowMs();
  return true;
}

function endMatchAfterLastOpponentTimeout(room: MultiplayerRoom, expiredPlayerId: PlayerId): void {
  const game = room.game;
  if (!game || game.players.length > 2) return;
  retireTimedOutPlayerFromGame(room, expiredPlayerId);
  const survivor = game.players[0];
  if (survivor) {
    game.winnerId = survivor.id;
  }
  game.pending = null;
  game.turn.phase = 'finished';
  room.status = 'finished';
  room.paused = false;
  room.pausedByPlayerId = undefined;
  room.roomRuntimeState = 'ended_timeout';
  room.pausedReason = undefined;
  room.endedReason = isHostSeat(room, expiredPlayerId) ? 'host_timeout' : 'disconnect_timeout';
  clearDisconnectPauseRestore(room);
  appendActivity(
    room,
    'system',
    `${playerDisplayName(room, expiredPlayerId)} timed out. Match ended.`,
    { playerId: expiredPlayerId },
  );
}

function migrateHost(room: MultiplayerRoom): { previousHostId: PlayerId; nextHostId: PlayerId } | null {
  if (room.status !== 'lobby') return null;
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
  applyDisconnectPauseState(room, player.id);
  const migrated = migrateHost(room);
  if (migrated) {
    appendActivity(
      room,
      'host',
      `${playerDisplayName(room, migrated.nextHostId)} is now host.`,
      { playerId: migrated.nextHostId },
    );
  }
  incrementEventId(room);
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
  if (room.status === 'active') {
    const gamePlayerCount = room.game?.players.length ?? 0;
    if (gamePlayerCount <= 2) {
      // A manually paused match stays paused when its disconnected opponent
      // times out; the surviving player can still inspect the final board and
      // resume or leave it deliberately.
      if (room.disconnectPauseRestore?.paused) {
        retireTimedOutPlayerFromGame(room, player.id);
        resolveDisconnectPauseStateAfterTimeout(room);
      } else {
        endMatchAfterLastOpponentTimeout(room, player.id);
      }
    } else {
      retireTimedOutPlayerFromGame(room, player.id);
      // An expired host cannot resume host-only controls. Promote a connected
      // survivor so a 3-4 player match remains operable.
      if (isHostSeat(room, player.id)) {
        const nextHost = room.players.find((candidate) => candidate.id !== player.id && candidate.connected);
        if (nextHost) {
          room.hostPlayerId = nextHost.id;
          appendActivity(room, 'host', `${nextHost.name} is now host.`, { playerId: nextHost.id });
        }
      }
      resolveDisconnectPauseStateAfterTimeout(room);
    }
  }
  incrementRevision(room);
  incrementEventId(room);
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
  // The draw pile is ordered hidden information too. Preserve its length for
  // deck-count UI while never exposing card identities or order to clients.
  clone.drawPile = Array.from({ length: clone.drawPile.length }, () => '__hidden__');
  return clone;
}

function connectedLobbyPlayers(room: MultiplayerRoom): RoomParticipant[] {
  return room.players.filter((player) => player.connected);
}

function allConnectedPlayersReady(room: MultiplayerRoom): boolean {
  const connectedPlayers = connectedLobbyPlayers(room);
  return connectedPlayers.length >= 2 && connectedPlayers.every((player) => player.ready);
}

function allRoomPlayersConnectedAndReady(room: MultiplayerRoom): boolean {
  return room.players.length >= 2 && room.players.every((player) => player.connected && player.ready);
}

function allRoomPlayersConnected(room: MultiplayerRoom): boolean {
  return room.players.length >= 2 && room.players.every((player) => player.connected);
}

function clearAllReadyStates(room: MultiplayerRoom): void {
  room.players.forEach((player) => {
    player.ready = false;
  });
}

function canViewerStartRoom(room: MultiplayerRoom, viewerId: PlayerId): boolean {
  return room.status === 'lobby'
    && room.hostPlayerId === viewerId
    && allConnectedPlayersReady(room);
}

function canViewerRematchRoom(room: MultiplayerRoom, viewerId: PlayerId): boolean {
  return room.status === 'finished'
    && room.hostPlayerId === viewerId
    && allRoomPlayersConnectedAndReady(room);
}

function checkpointRulesMatchPreset(room: MultiplayerRoom, checkpoint: RoomCheckpoint): boolean {
  return multiplayerSessionPresetRulesMatch(room.presetId, checkpoint.game.ruleset ?? DEFAULT_RULESET);
}

function resetRoomForFreshMatch(room: MultiplayerRoom): void {
  room.paused = false;
  room.pausedByPlayerId = undefined;
  room.roomRuntimeState = 'active';
  room.pausedReason = undefined;
  room.endedReason = undefined;
  clearDisconnectPauseRestore(room);
  room.turnSnapshots = [];
  room.recentActionIds = [];
  clearAllReadyStates(room);
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
  incrementEventId(room);
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
  for (let index = 1; index <= 5; index += 1) {
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

function actionDedupeKey(playerId: PlayerId, actionId: string, action: Action): string {
  return JSON.stringify([playerId, actionId, normalizeActionForComparison(action)]);
}

function hasTrackedAction(room: MultiplayerRoom, playerId: PlayerId, actionId: string, action: Action): boolean {
  if (!actionId) return false;
  return room.recentActionIds.includes(actionDedupeKey(playerId, actionId, action));
}

function trackActionId(room: MultiplayerRoom, playerId: PlayerId, actionId: string, action: Action): void {
  if (!actionId) return;
  const key = actionDedupeKey(playerId, actionId, action);
  room.recentActionIds = [...room.recentActionIds.filter((entry) => entry !== key), key]
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
  if (room.roomRuntimeState === 'ended_timeout') {
    throw new Error('room_closed');
  }
  if (room.paused) {
    throw new Error('room_paused');
  }
}

function incrementRevision(room: MultiplayerRoom): void {
  room.revision += 1;
  room.eventId = Math.max(room.eventId, room.revision);
  room.eventId += 1;
}

function incrementEventId(room: MultiplayerRoom): void {
  room.eventId = Math.max(room.eventId, room.revision) + 1;
}

function bumpUpdatedAt(room: MultiplayerRoom): void {
  room.updatedAt = nowMs();
}

function commitMutation(room: MultiplayerRoom): void {
  incrementRevision(room);
  bumpUpdatedAt(room);
  incrementEventId(room);
}

function updateStatusFromGame(room: MultiplayerRoom): void {
  if (!room.game) {
    room.status = 'lobby';
    room.roomRuntimeState = undefined;
    room.pausedReason = undefined;
    room.endedReason = undefined;
    clearDisconnectPauseRestore(room);
    return;
  }
  const status = isGameOver(room.game);
  room.status = status.done ? 'finished' : 'active';
  if (room.roomRuntimeState !== 'paused_disconnect'
    && room.roomRuntimeState !== 'paused_host_disconnect'
    && room.roomRuntimeState !== 'ended_timeout') {
    room.roomRuntimeState = 'active';
  }
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
    presetId: DEFAULT_MULTIPLAYER_SESSION_PRESET,
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
    roomRuntimeState: undefined,
    pausedReason: undefined,
    endedReason: undefined,
    disconnectPauseRestore: undefined,
    revision: 0,
    eventId: 0,
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
  if (room.players.length >= 5) {
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
  if (room.status === 'lobby' && player.id === room.originalHostPlayerId && room.hostPlayerId !== player.id) {
    room.hostPlayerId = player.id;
    appendActivity(room, 'host', `${player.name} is now host.`, { playerId: player.id });
  } else if (room.status === 'lobby' && previousHostId !== room.hostPlayerId) {
    appendActivity(room, 'host', `${playerDisplayName(room, room.hostPlayerId)} is now host.`, { playerId: room.hostPlayerId });
  }
  resolveDisconnectPauseStateAfterReconnect(room);
  // Reconnect is presence, not a gameplay mutation. A stale client must still
  // receive the authoritative snapshot without invalidating another player's
  // in-flight gameplay action.
  bumpUpdatedAt(room);
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
  const player = requireSession(room, playerId, sessionToken);
  ensureExpectedRevision(room, expectedRevision);
  if (room.status === 'lobby') {
    if (removeLobbyParticipant(room, player.id)) {
      incrementRevision(room);
    }
    return;
  }
  markDisconnected(room, player);
  bumpUpdatedAt(room);
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
  if (!allConnectedPlayersReady(room)) {
    throw new Error('players_not_ready');
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
    if (!checkpointRulesMatchPreset(room, checkpoint)) {
      throw new Error('checkpoint_preset_mismatch');
    }
    room.game = structuredClone(checkpoint.game);
  } else {
    room.game = createGame({
      players,
      deckVersion: 'v1',
      seed,
      ruleset: getMultiplayerSessionPresetRuleset(room.presetId),
    });
  }
  resetRoomForFreshMatch(room);
  const presetLabel = getMultiplayerSessionPresetDefinition(room.presetId).label;
  appendActivity(
    room,
    'match',
    checkpointId ? `Match started from checkpoint with ${presetLabel}.` : `Match started with ${presetLabel}.`,
  );
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
  if (room.roomRuntimeState === 'ended_timeout') {
    throw new Error('room_closed');
  }
  if (hasDisconnectedSeatAwaitingReconnect(room)) {
    // Keep the disconnect pause as the controlling guard. Otherwise a manual
    // pause could overwrite its restore state and let the host resume around
    // an unresolved disconnect.
    throw new Error('room_paused');
  }
  room.paused = true;
  room.pausedByPlayerId = playerId;
  room.pausedReason = 'manual';
  room.roomRuntimeState = 'active';
  clearDisconnectPauseRestore(room);
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
  if (room.roomRuntimeState === 'ended_timeout') {
    throw new Error('room_closed');
  }
  if (
    hasDisconnectedSeatAwaitingReconnect(room)
  ) {
    throw new Error('room_paused');
  }
  room.paused = false;
  room.pausedByPlayerId = undefined;
  room.pausedReason = undefined;
  room.roomRuntimeState = 'active';
  clearDisconnectPauseRestore(room);
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
  const versionGuardEnabled = true;
  const player = requireSession(room, playerId, sessionToken);
  // Authenticate first, then accept an exact retry before applying any stale
  // revision guard. Retries are bound to the seat and canonical action payload
  // so a reused id cannot suppress a different action.
  if (versionGuardEnabled && actionId && hasTrackedAction(room, playerId, actionId, action)) {
    return room;
  }
  ensureExpectedRevision(room, expectedRevision);
  const game = requireGame(room);
  requireConnectedPlayer(player);
  ensureNotPaused(room);
  touchPlayer(player);
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
    trackActionId(room, playerId, actionId, action);
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
  room.roomRuntimeState = 'active';
  room.pausedReason = undefined;
  room.endedReason = undefined;
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

export function setRoomPreset(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  presetId: MultiplayerSessionPresetId,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  requireConnectedPlayer(player);
  requireHost(room, playerId);
  if (room.status === 'active') {
    throw new Error('room_started');
  }
  const nextPresetId = normalizeMultiplayerSessionPreset(presetId, room.presetId);
  if (room.presetId === nextPresetId) {
    return room;
  }
  room.presetId = nextPresetId;
  clearAllReadyStates(room);
  appendActivity(
    room,
    'lobby',
    `${player.name} switched the room preset to ${getMultiplayerSessionPresetDefinition(nextPresetId).label}.`,
    { playerId },
  );
  commitMutation(room);
  return room;
}

export function setRoomReady(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  ready: boolean,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  if (room.status === 'active') {
    throw new Error('room_started');
  }
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  touchPlayer(player);
  if (player.ready === ready) return room;
  player.ready = ready;
  appendActivity(
    room,
    'ready',
    ready
      ? `${player.name} is ready for ${getMultiplayerSessionPresetDefinition(room.presetId).label}.`
      : `${player.name} is not ready.`,
    { playerId },
  );
  commitMutation(room);
  return room;
}

export function rematchRoom(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  requireConnectedPlayer(player);
  requireHost(room, playerId);
  if (room.status !== 'finished') {
    throw new Error('room_not_finished');
  }
  if (!allRoomPlayersConnected(room)) {
    throw new Error('rematch_requires_connected_players');
  }
  if (!allRoomPlayersConnectedAndReady(room)) {
    throw new Error('players_not_ready');
  }
  room.game = createGame({
    players: room.players.map((entry) => ({ id: entry.id, name: entry.name })),
    deckVersion: 'v1',
    ruleset: getMultiplayerSessionPresetRuleset(room.presetId),
  });
  resetRoomForFreshMatch(room);
  appendActivity(room, 'match', `Rematch started with ${getMultiplayerSessionPresetDefinition(room.presetId).label}.`);
  updateStatusFromGame(room);
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
  void expectedRevision;
  // Chat is a social event and must not invalidate a gameplay action retry.
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
  incrementEventId(room);
  bumpUpdatedAt(room);
  return room;
}

export function setRoomTyping(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  typing: boolean,
  expectedRevision?: number,
): MultiplayerRoom {
  void expectedRevision;
  // Typing presence is deliberately outside the gameplay revision stream.
  const player = requireSession(room, playerId, sessionToken);
  assertReconnectWindowOpen(player);
  requireConnectedPlayer(player);
  touchPlayer(player);
  pruneExpiredTyping(room);

  if (!typing) {
    if (!room.typingByPlayerId[player.id]) return room;
    delete room.typingByPlayerId[player.id];
    incrementEventId(room);
    bumpUpdatedAt(room);
    return room;
  }

  room.typingByPlayerId[player.id] = nowMs() + TYPING_TTL_MS;
  incrementEventId(room);
  bumpUpdatedAt(room);
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
  const legalActions = room.game
    && viewer.connected
    && !room.paused
    && room.roomRuntimeState !== 'ended_timeout'
    ? getLegalActions(room.game, viewerId)
    : [];
  const status = room.game ? isGameOver(room.game) : { done: false as const };
  const reconnectDeadlineMs = viewer.reconnectDeadlineMs;
  const serverTime = nowMs();

  return {
    roomCode: room.code,
    status: room.status,
    started,
    winnerId: status.done ? status.winnerId : undefined,
    presetId: room.presetId,
    hostPlayerId: room.hostPlayerId,
    yourPlayerId: viewerId,
    players: roomPlayerSummary(room),
    promptPlayerId,
    legalActions,
    gameState: room.game ? maskForViewer(room.game, viewerId) : undefined,
    paused: room.paused,
    pausedByPlayerId: room.pausedByPlayerId,
    roomRuntimeState: room.roomRuntimeState,
    pausedReason: room.pausedReason,
    endedReason: room.endedReason,
    revision: room.revision,
    turnSnapshotCount: room.turnSnapshots.length,
    checkpointSlots: room.checkpoints.map(checkpointSummary),
    canStart: canViewerStartRoom(room, viewerId),
    canRematch: canViewerRematchRoom(room, viewerId),
    reconnectDeadlineMs,
    serverTime,
    activityFeed: room.activityFeed,
    chatMessages: room.chatMessages,
    typingPlayerIds: Object.keys(room.typingByPlayerId),
    lastEventId: room.eventId,
  };
}

export function pruneInactiveRooms(rooms: Map<string, MultiplayerRoom>, now = nowMs()): PruneInactiveRoomsResult {
  const disconnectedSeats: PruneInactiveRoomsResult['disconnectedSeats'] = [];
  const removedRoomCodes: string[] = [];
  for (const [code, room] of rooms) {
    pruneExpiredTyping(room, now);
    const staleConnectionMs = room.status === 'lobby' ? STALE_CONNECTION_LOBBY_MS : STALE_CONNECTION_MATCH_MS;
    const staleConnectedPlayers = room.players.filter((player) => (
      player.connected && now - player.lastSeenAt > staleConnectionMs
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
      if (room.status === 'lobby') incrementRevision(room);
      else bumpUpdatedAt(room);
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
