import { randomBytes, randomInt } from 'node:crypto';
import { chooseHeuristicAction } from '../../../src/ai/heuristic.ts';
import { chooseMonteCarloAction } from '../../../src/ai/rollout.ts';
import { actionRevealedDeckCards, appendTurnSnapshot } from '../../../src/engine/undoPolicy.ts';
import {
  applyAction,
  createGame,
  discardCardsHeldByPending,
  releaseDebtsInvolving,
  settleDebtPhase,
  DEFAULT_RULESET,
  getLegalActions,
  getNextPrompt,
  getSetCompletionCount,
  isGameOver,
  normalizeGameState,
  type Action,
  type GameState,
  type GameVariant,
  type PlayerConfig,
  type PlayerId,
  type BotDifficulty,
  type LegalAction,
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
  MultiplayerReplayLog,
  MultiplayerRoomOptions,
  MultiplayerSeriesState,
  MultiplayerTurnClock,
} from '../../../packages/shared/multiplayer.ts';

const RECONNECT_WINDOW_V1_DEFAULT_MS = 90_000;
const RECONNECT_WINDOW_MS = resolveReconnectWindowMs(process.env.MP_RECONNECT_GRACE_MS);
// A refresh must not cost a lobby seat, and Start briefly waits for a returning player. An absent player
// keeps the seat for the full window so a host can leave to share the invite, but stops blocking the others.
const MATCH_SEED_RANGE = 1_000_000_000;
const LOBBY_START_HOLD_MS = 30_000;
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
const DEFAULT_GAME_VARIANT: GameVariant = 'classic';
const MAX_SPECTATORS = 8;
const SPECTATOR_STALE_MS = 10 * 60_000;
/** How long a bot seems to think before it moves for a dropped seat. */
const BOT_SEAT_DELAY_MS = 1_500;
/** Long enough that a bot-played seat can always come back while the room is open. */
const BOT_SEAT_RECLAIM_MS = 7 * 24 * 60 * 60_000;
/** A turn-by-turn room has no presence to track, and lasts for weeks. */
const TURN_ROOM_SEAT_MS = 60 * 24 * 60 * 60_000;
const ALLOWED_TURN_TIMERS = [30, 45, 60, 90];
export const TURN_ROOM_CODE_LENGTH = 6;
const LIVE_ROOM_CODE_LENGTH = 5;

export function resolveReconnectWindowMs(configuredGraceMs?: string): number {
  const parsed = Number(configuredGraceMs);
  if (Number.isFinite(parsed) && parsed >= 1_000) {
    return Math.floor(parsed);
  }
  return RECONNECT_WINDOW_V1_DEFAULT_MS;
}

type ReversibleActionType = 'draw_cards' | 'play_to_bank' | 'play_property' | 'play_action' | 'move_wild' | 'repay_debt';

interface RoomParticipant {
  /** Sits at the table from the start. It's always connected and ready, and nobody holds its token. */
  isBot?: boolean;
  /** How a bot plays this seat, whether it was added as one or is covering for a dropped player. */
  botDifficulty?: BotDifficulty;
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
  variant: GameVariant;
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
  /** All optional, so snapshots from before these features still load. */
  options?: MultiplayerRoomOptions;
  turnBased?: boolean;
  turnClock?: MultiplayerTurnClock | null;
  series?: MultiplayerSeriesState | null;
  /** Web push addresses per seat, for turn-by-turn rooms. Never sent to clients. */
  pushSubscriptions?: Record<string, RoomPushSubscription>;
  spectators?: RoomSpectator[];
  replayLog?: MultiplayerReplayLog | null;
  /** Length of the action log when each turn snapshot was taken, so undo can rewind it. */
  replayMarks?: number[];
}

export interface RoomPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface RoomSpectator {
  id: string;
  name: string;
  sessionToken: string;
  lastSeenAt: number;
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
  // A started game's variant is authoritative. Lobby snapshots use the room
  // field, while legacy snapshots with neither field default to Classic.
  // Between matches the host may already have picked the next game's variant.
  const pickedForNextGame = room.status === 'finished' && room.variant;
  room.variant = normalizeGameVariant(pickedForNextGame ? room.variant : room.game?.variant ?? room.variant, DEFAULT_GAME_VARIANT);
  if (room.variant === 'no_mercy') room.presetId = DEFAULT_MULTIPLAYER_SESSION_PRESET;
  if (room.game) {
    room.game = normalizeGameState({ ...room.game, variant: pickedForNextGame ? room.game.variant : room.variant });
  }
  room.turnSnapshots = Array.isArray(room.turnSnapshots)
    ? room.turnSnapshots.map((snapshot) => normalizeGameState(snapshot))
    : [];
  room.checkpoints = Array.isArray(room.checkpoints)
    ? room.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        game: normalizeGameState(checkpoint.game),
      }))
    : [];
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

function normalizeGameVariant(input: unknown, fallback: GameVariant = DEFAULT_GAME_VARIANT): GameVariant {
  return input === 'no_mercy' ? 'no_mercy' : input === 'classic' ? 'classic' : fallback;
}

function nowMs(): number {
  return Date.now();
}

function nextRoomCode(existing: Map<string, MultiplayerRoom>, length = LIVE_ROOM_CODE_LENGTH): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < length; i += 1) {
      const index = randomInt(alphabet.length);
      code += alphabet[index];
    }
    if (!existing.has(code)) return code;
  }
}

function randomToken(): string {
  return randomBytes(32).toString('hex');
}

function randomCheckpointId(): string {
  return randomBytes(8).toString('hex');
}

function sanitizeName(name: string, fallback: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 28) : fallback;
}

/** Players in a room can't tell each other apart by seat, so names stay distinct. */
function uniqueSeatName(room: MultiplayerRoom, name: string): string {
  const taken = new Set(room.players.map((player) => player.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${name.slice(0, 24)} (${suffix})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
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

function touchRoomPlayer(room: MultiplayerRoom, player: RoomParticipant): void {
  touchPlayer(player);
  if (room.turnBased) player.reconnectDeadlineMs = nowMs() + TURN_ROOM_SEAT_MS;
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
  // A bot is playing those seats, so nobody is waiting on them.
  if (room.options?.botFill) return false;
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
  if (room.options?.botFill) return;
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

  releaseDebtsInvolving(game, playerId);
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
    discardCardsHeldByPending(game);
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
    settleDebtPhase(game);
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
  discardCardsHeldByPending(game);
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

  const connectedCandidate = room.players.find((player) => player.connected && !player.isBot);
  if (connectedCandidate) {
    room.hostPlayerId = connectedCandidate.id;
    return room.hostPlayerId === previousHostId ? null : { previousHostId, nextHostId: room.hostPlayerId };
  }

  const fallback = room.players.find((player) => !player.isBot);
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
  player.reconnectDeadlineMs = now + (room.options?.botFill && room.status !== 'lobby' ? BOT_SEAT_RECLAIM_MS : RECONNECT_WINDOW_MS);
  delete room.typingByPlayerId[player.id];
  appendActivity(
    room,
    'connection',
    room.options?.botFill && room.status === 'active' ? `${player.name} disconnected. A bot is playing their seat.` : `${player.name} disconnected.`,
    { playerId: player.id },
  );
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
        const nextHost = room.players.find((candidate) => candidate.id !== player.id && candidate.connected && !candidate.isBot);
        if (nextHost) {
          room.hostPlayerId = nextHost.id;
          appendActivity(room, 'host', `${nextHost.name} is now host.`, { playerId: nextHost.id });
        }
      }
      resolveDisconnectPauseStateAfterTimeout(room);
    }
  } else if (room.status === 'finished') {
    resolveDisconnectPauseStateAfterTimeout(room);
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

function botSummary(room: MultiplayerRoom, entry: RoomParticipant | undefined): Pick<MultiplayerPlayerSummary, 'isBot' | 'botDifficulty'> {
  if (!entry) return {};
  return { isBot: entry.isBot === true, botDifficulty: seatBotDifficulty(room, entry) };
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
      ...botSummary(room, entry),
    }));
  }

  const inGame = room.game.players.map((player) => {
    const entry = findPlayer(room, player.id);
    return {
      id: player.id,
      name: player.name,
      handCount: player.hand.length,
      bankCount: player.bank.length,
      completeSets: getSetCompletionCount(player, room.game?.variant ?? room.variant),
      connected: Boolean(entry?.connected),
      connectionState: entry?.connectionState ?? (entry?.connected ? 'connected' : 'disconnected'),
      disconnectedAt: entry?.disconnectedAt ?? null,
      lastSeenAt: entry?.lastSeenAt ?? room.updatedAt,
      reconnectDeadlineMs: entry?.reconnectDeadlineMs ?? room.updatedAt,
      isHost: player.id === room.hostPlayerId,
      ready: Boolean(entry?.ready),
      ...botSummary(room, entry),
    };
  });
  // Someone who joined between matches isn't in the finished game yet.
  const joined = room.players.filter((entry) => !room.game?.players.some((player) => player.id === entry.id));
  return [...inGame, ...joined.map((entry) => ({
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
    ...botSummary(room, entry),
  }))];
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
  // A debt repayment card is still a private hand choice until the receiving
  // player resolves it. The debtor and creditor need the identity; every other
  // multiplayer client only needs to know that a resolution is pending.
  if (clone.pending?.kind === 'debt_card') {
    const { debtorPlayerId, creditorPlayerId } = clone.pending.payload;
    if (viewerId !== debtorPlayerId && viewerId !== creditorPlayerId) {
      clone.pending.payload.cardId = '__hidden__';
    }
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
  const now = nowMs();
  const seatReconnecting = room.players.some((player) => !player.connected
    && player.reconnectDeadlineMs > now
    && now - (player.disconnectedAt ?? 0) < LOBBY_START_HOLD_MS);
  return !seatReconnecting && connectedPlayers.length >= 2 && connectedPlayers.every((player) => player.ready);
}

function allRoomPlayersConnectedAndReady(room: MultiplayerRoom): boolean {
  // A seat a bot is playing doesn't hold up the next game.
  const seats = rematchSeats(room);
  const covered = (player: RoomParticipant) => !player.connected && room.options?.botFill === true;
  return seats.length >= 2 && seats.every((player) => covered(player) || (player.connected && player.ready));
}

/** Who plays the next game. Someone who left a finished room a while ago doesn't hold it up. */
function rematchSeats(room: MultiplayerRoom, now = nowMs()): RoomParticipant[] {
  if (room.options?.botFill) return room.players;
  return room.players.filter((player) => player.connected || now - (player.disconnectedAt ?? 0) < LOBBY_START_HOLD_MS);
}

function allRoomPlayersConnected(room: MultiplayerRoom): boolean {
  if (room.options?.botFill) return room.players.length >= 2;
  const seats = rematchSeats(room);
  return seats.length >= 2 && seats.every((player) => player.connected);
}

function gameSeats(players: RoomParticipant[]): PlayerConfig[] {
  return players.map((entry) => ({
    id: entry.id,
    name: entry.name,
    ...(entry.isBot ? { controller: 'bot' as const, botDifficulty: entry.botDifficulty ?? 'easy' } : {}),
  }));
}

function seatBotDifficulty(room: MultiplayerRoom, seat: RoomParticipant): BotDifficulty {
  return seat.botDifficulty ?? room.options?.botDifficulty ?? 'easy';
}

function clearAllReadyStates(room: MultiplayerRoom): void {
  room.players.forEach((player) => {
    player.ready = player.isBot === true;
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

function checkpointMatchesVariant(room: MultiplayerRoom, checkpoint: RoomCheckpoint): boolean {
  return normalizeGameVariant(checkpoint.game.variant) === room.variant;
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
  if (room.status !== 'lobby' && room.status !== 'finished') return false;
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
    || actionType === 'move_wild'
    || actionType === 'repay_debt';
}

function shouldRetainTurnSnapshots(nextState: GameState, nextPromptPlayerId: string): boolean {
  if (isGameOver(nextState).done) return false;
  if (nextState.turn.phase !== 'action' && !(nextState.variant === 'no_mercy' && nextState.turn.phase === 'debt')) return false;
  if (nextState.players[nextState.currentPlayerIndex]?.id !== nextPromptPlayerId) return false;
  if (!nextState.pending) return true;
  return nextState.pending.kind === 'rent'
    || nextState.pending.kind === 'sly_deal'
    || nextState.pending.kind === 'forced_deal'
    || nextState.pending.kind === 'deal_breaker'
    || nextState.pending.kind === 'debt_card'
    || nextState.pending.kind === 'no_mercy';
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
  syncTurnClock(room);
}

/** The clock restarts whenever the game starts waiting on someone else. */
function syncTurnClock(room: MultiplayerRoom, restart = false): void {
  if (!room.game || isGameOver(room.game).done) {
    room.turnClock = null;
    return;
  }
  const playerId = getNextPrompt(room.game).playerId;
  if (!restart && room.turnClock?.playerId === playerId) return;
  const startedAt = nowMs();
  const seconds = room.options?.turnTimerSeconds ?? null;
  room.turnClock = { playerId, startedAt, deadlineMs: seconds ? startedAt + seconds * 1000 : null };
}

function newSeries(room: MultiplayerRoom): MultiplayerSeriesState {
  return { bestOf: room.options?.bestOf ?? 1, wins: {}, gameNumber: 1 };
}

function recordSeriesResult(room: MultiplayerRoom, winnerId: PlayerId | undefined): void {
  const series = room.series;
  if (!series || !winnerId || series.winnerId) return;
  series.wins[winnerId] = (series.wins[winnerId] ?? 0) + 1;
  if (series.wins[winnerId] > series.bestOf / 2) {
    series.winnerId = winnerId;
    appendActivity(room, 'match', `${playerDisplayName(room, winnerId)} won the series.`, { playerId: winnerId });
  }
}

/** A checkpoint starts partway through a game, so there's no complete log to replay. */
function beginReplayLog(room: MultiplayerRoom, fromCheckpoint: boolean): void {
  room.replayLog = !fromCheckpoint && room.game ? { initial: structuredClone(room.game), actions: [] } : null;
  room.replayMarks = [];
}

/** Applies a legal action to the game, for a player or for the bot acting in their place. */
function applyGameAction(room: MultiplayerRoom, game: GameState, action: Action): void {
  const playerId = action.playerId;
  const shouldSnapshot = isReversibleActionType(action.type) && getNextPrompt(game).playerId === playerId;
  if (shouldSnapshot) {
    room.turnSnapshots = appendTurnSnapshot(room.turnSnapshots, structuredClone(game));
    room.replayMarks = [...(room.replayMarks ?? []), room.replayLog?.actions.length ?? 0];
  }

  const result = applyAction(game, action);
  if (result.error) {
    throw new Error(result.error.code);
  }
  room.game = result.state;
  room.replayLog?.actions.push(action);
  const nextPromptPlayerId = getNextPrompt(result.state).playerId;
  if (!shouldRetainTurnSnapshots(result.state, nextPromptPlayerId)
    || actionRevealedDeckCards(game, result.state, action.type)) {
    room.turnSnapshots = [];
    room.replayMarks = [];
  }
  const outcome = isGameOver(result.state);
  if (outcome.done) {
    appendActivity(room, 'match', 'Match completed.');
    recordSeriesResult(room, outcome.winnerId);
  }
  updateStatusFromGame(room);
}

export interface RoomAutomation {
  at: number;
  playerId: PlayerId;
  reason: 'bot_seat' | 'timer';
}

/** The next move the server should make by itself, if any. */
export function nextRoomAutomation(room: MultiplayerRoom): RoomAutomation | null {
  const game = room.game;
  if (!game || room.turnBased || room.paused || room.roomRuntimeState === 'ended_timeout') return null;
  if (isGameOver(game).done) return null;
  // With nobody left at the table, the bots wait rather than finish the game alone.
  if (!room.players.some((player) => player.connected && !player.isBot)) return null;
  const playerId = getNextPrompt(game).playerId;
  const seat = findPlayer(room, playerId);
  if (seat?.isBot || (room.options?.botFill && seat && !seat.connected)) {
    return { at: (room.turnClock?.playerId === playerId ? room.turnClock.startedAt : nowMs()) + BOT_SEAT_DELAY_MS, playerId, reason: 'bot_seat' };
  }
  if (room.turnClock?.playerId === playerId && room.turnClock.deadlineMs) {
    return { at: room.turnClock.deadlineMs, playerId, reason: 'timer' };
  }
  return null;
}

/** The search gets a time limit because the room server runs everything on one thread. */
const HARD_BOT_BUDGET_MS = 900;

function chooseBotAction(game: GameState, playerId: PlayerId, legal: LegalAction[], difficulty: BotDifficulty): Action {
  const choice = difficulty === 'hard'
    ? chooseMonteCarloAction(game, playerId, legal, { simulations: 18, depth: 11, timeBudgetMs: HARD_BOT_BUDGET_MS })
    : chooseHeuristicAction(game, playerId, legal);
  return choice && legal.some((entry) => JSON.stringify(entry.action) === JSON.stringify(choice.action))
    ? choice.action
    : legal[0].action;
}

/**
 * Plays any bot seats that are up, for a turn-by-turn room. Nothing runs between requests there,
 * so bots move as part of the request that reached them, and all of it costs one save.
 */
export function playTurnRoomBots(room: MultiplayerRoom): void {
  if (!room.turnBased) return;
  const startedAt = nowMs();
  for (let step = 0; step < 400; step += 1) {
    const game = room.game;
    if (!game || room.paused || isGameOver(game).done) return;
    const playerId = getNextPrompt(game).playerId;
    const seat = findPlayer(room, playerId);
    if (!seat?.isBot) return;
    const legal = getLegalActions(game, playerId);
    if (legal.length === 0) return;
    // The function has a hard time limit, so a long run of hard moves finishes on easy ones.
    const difficulty = nowMs() - startedAt < 6_000 ? seatBotDifficulty(room, seat) : 'easy';
    applyGameAction(room, game, chooseBotAction(game, playerId, legal, difficulty));
    commitMutation(room);
  }
}

/**
 * Makes the due move, if one is due. A bot seat or an expired clock plays one legal move at a
 * time, so a turn with several decisions runs through the same schedule as a person's would.
 */
export function runRoomAutomation(room: MultiplayerRoom, now = nowMs()): boolean {
  const next = nextRoomAutomation(room);
  if (!next || next.at > now || !room.game) return false;
  const game = room.game;
  const legal = getLegalActions(game, next.playerId);
  if (legal.length === 0) return false;
  const seat = findPlayer(room, next.playerId);
  const action = chooseBotAction(game, next.playerId, legal, next.reason === 'bot_seat' && seat ? seatBotDifficulty(room, seat) : 'easy');
  if (next.reason === 'timer') {
    appendActivity(room, 'system', `Time ran out, so a bot moved for ${playerDisplayName(room, next.playerId)}.`, { playerId: next.playerId });
  }
  applyGameAction(room, game, action);
  commitMutation(room);
  // Still the same player's decision: the next step of a timed-out turn comes straight after.
  if (next.reason === 'timer' && room.turnClock?.playerId === next.playerId && room.turnClock.deadlineMs) {
    room.turnClock.deadlineMs = now + BOT_SEAT_DELAY_MS;
  } else if (next.reason === 'bot_seat' && room.turnClock?.playerId === next.playerId) {
    room.turnClock.startedAt = now;
  }
  return true;
}

export function setRoomOptions(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  changes: Partial<MultiplayerRoomOptions>,
  expectedRevision?: number,
): MultiplayerRoom {
  ensureExpectedRevision(room, expectedRevision);
  requireSession(room, playerId, sessionToken);
  requireHost(room, playerId);
  if (room.status === 'active') throw new Error('room_started');
  if (room.turnBased && (changes.botFill || changes.turnTimerSeconds)) throw new Error('option_not_supported');
  if (changes.turnTimerSeconds != null && !ALLOWED_TURN_TIMERS.includes(changes.turnTimerSeconds)) throw new Error('invalid_payload');
  if (changes.bestOf != null && changes.bestOf !== 1 && changes.bestOf !== 3) throw new Error('invalid_payload');
  if (changes.botDifficulty != null && !BOT_DIFFICULTIES.includes(changes.botDifficulty)) throw new Error('invalid_payload');
  room.options = {
    botFill: changes.botFill ?? room.options?.botFill ?? false,
    botDifficulty: changes.botDifficulty ?? room.options?.botDifficulty ?? 'easy',
    turnTimerSeconds: changes.turnTimerSeconds !== undefined ? changes.turnTimerSeconds : room.options?.turnTimerSeconds ?? null,
    bestOf: changes.bestOf ?? room.options?.bestOf ?? 1,
  };
  commitMutation(room);
  return room;
}

const BOT_DIFFICULTIES: BotDifficulty[] = ['easy', 'hard'];

/** Seats a bot beside the people in the room, before the match or between matches. */
export function addRoomBot(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  difficulty: BotDifficulty = 'easy',
): MultiplayerRoom {
  requireSession(room, playerId, sessionToken);
  requireHost(room, playerId);
  if (room.status === 'active') throw new Error('room_started');
  if (!BOT_DIFFICULTIES.includes(difficulty)) throw new Error('invalid_payload');
  if (room.players.length >= 5) throw new Error('room_full');
  const id = nextAvailableLobbyPlayerId(room);
  const now = nowMs();
  const name = uniqueSeatName(room, `Bot ${room.players.filter((entry) => entry.isBot).length + 1}`);
  room.players.push({
    id,
    name,
    sessionToken: randomToken(),
    isBot: true,
    botDifficulty: difficulty,
    connected: true,
    connectionState: 'connected',
    disconnectedAt: null,
    lastSeenAt: now,
    reconnectDeadlineMs: now + BOT_SEAT_RECLAIM_MS,
    ready: true,
    lastReactionAt: 0,
    lastChatAt: 0,
  });
  appendActivity(room, 'lobby', `${name} joined the table.`, { playerId: id });
  commitMutation(room);
  return room;
}

export function removeRoomBot(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, botId: PlayerId): MultiplayerRoom {
  requireSession(room, playerId, sessionToken);
  requireHost(room, playerId);
  if (room.status === 'active') throw new Error('room_started');
  const bot = findPlayer(room, botId);
  if (!bot?.isBot) throw new Error('seat_not_found');
  room.players = room.players.filter((entry) => entry.id !== botId);
  appendActivity(room, 'lobby', `${bot.name} left the table.`, { playerId: botId });
  commitMutation(room);
  return room;
}

/** Works during a match too, for a bot seat or for a bot covering a dropped player. */
export function setSeatBotDifficulty(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  seatId: PlayerId,
  difficulty: BotDifficulty,
): MultiplayerRoom {
  requireSession(room, playerId, sessionToken);
  requireHost(room, playerId);
  if (!BOT_DIFFICULTIES.includes(difficulty)) throw new Error('invalid_payload');
  const seat = findPlayer(room, seatId);
  if (!seat) throw new Error('seat_not_found');
  seat.botDifficulty = difficulty;
  commitMutation(room);
  return room;
}

function findSpectator(room: MultiplayerRoom, id: string): RoomSpectator | undefined {
  return room.spectators?.find((entry) => entry.id === id);
}

function spectatorSession(room: MultiplayerRoom, spectator: RoomSpectator): RoomSessionResponse {
  return {
    roomCode: room.code,
    seatId: spectator.id,
    resumeToken: spectator.sessionToken,
    playerId: spectator.id,
    sessionToken: spectator.sessionToken,
    reconnectDeadlineMs: spectator.lastSeenAt + SPECTATOR_STALE_MS,
  };
}

export function watchRoom(room: MultiplayerRoom, name: string): RoomSessionResponse {
  const now = nowMs();
  room.spectators = (room.spectators ?? []).filter((entry) => now - entry.lastSeenAt < SPECTATOR_STALE_MS);
  if (room.spectators.length >= MAX_SPECTATORS) throw new Error('room_full');
  let index = 1;
  while (room.spectators.some((entry) => entry.id === `s${index}`)) index += 1;
  const spectator: RoomSpectator = { id: `s${index}`, name: sanitizeName(name, 'Spectator'), sessionToken: randomToken(), lastSeenAt: now };
  room.spectators.push(spectator);
  incrementEventId(room);
  bumpUpdatedAt(room);
  return spectatorSession(room, spectator);
}

/** The finished game's opening state and every move, for replay. Hands are no longer secret. */
export function roomReplay(room: MultiplayerRoom, viewerId: string, sessionToken: string): MultiplayerReplayLog {
  const spectator = findSpectator(room, viewerId);
  if (!(spectator && spectator.sessionToken === sessionToken)) requireSession(room, viewerId as PlayerId, sessionToken);
  if (room.status !== 'finished' || !room.replayLog) throw new Error('replay_not_available');
  return room.replayLog;
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
  createOptions: { turnBased?: boolean } = {},
): { room: MultiplayerRoom; session: RoomSessionResponse } {
  const turnBased = createOptions.turnBased === true;
  const code = nextRoomCode(rooms, turnBased ? TURN_ROOM_CODE_LENGTH : LIVE_ROOM_CODE_LENGTH);
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
    variant: DEFAULT_GAME_VARIANT,
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
    ...(turnBased ? { turnBased: true } : {}),
  };
  if (turnBased) room.players[0].reconnectDeadlineMs = createdAt + TURN_ROOM_SEAT_MS;
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
      reconnectDeadlineMs: room.players[0].reconnectDeadlineMs,
    },
  };
}

export function joinRoom(room: MultiplayerRoom, playerName: string): RoomSessionResponse {
  // Between matches a finished room works like a lobby, so friends can still join.
  if (room.status === 'active' || (room.status === 'lobby' && room.game)) {
    throw new Error('room_started');
  }
  reclaimDisconnectedLobbyParticipants(room, nowMs(), room.players.length >= 5 ? 'all' : 'expired');
  if (room.players.length >= 5) {
    throw new Error('room_full');
  }
  const playerId = nextAvailableLobbyPlayerId(room);
  const token = randomToken();
  const now = nowMs();
  room.players.push({
    id: playerId,
    name: uniqueSeatName(room, sanitizeName(playerName, `Player ${playerId.slice(1)}`)),
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
  const seatDeadline = now + (room.turnBased ? TURN_ROOM_SEAT_MS : RECONNECT_WINDOW_MS);
  room.players[room.players.length - 1].reconnectDeadlineMs = seatDeadline;
  appendActivity(room, 'lobby', `${sanitizeName(playerName, `Player ${playerId.slice(1)}`)} joined the lobby.`, { playerId });
  commitMutation(room);
  return {
    roomCode: room.code,
    seatId: playerId,
    resumeToken: token,
    playerId,
    sessionToken: token,
    reconnectDeadlineMs: seatDeadline,
  };
}

export function reconnectRoom(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string, expectedRevision?: number): RoomSessionResponse {
  void expectedRevision;
  const spectator = findSpectator(room, playerId);
  if (spectator && spectator.sessionToken === sessionToken) {
    spectator.lastSeenAt = nowMs();
    return spectatorSession(room, spectator);
  }
  const player = requireSession(room, playerId, sessionToken);
  const now = nowMs();
  assertReconnectWindowOpen(player, now);
  const wasConnected = player.connected;
  const previousHostId = room.hostPlayerId;
  touchRoomPlayer(room, player);
  if (!wasConnected) {
    appendActivity(room, 'connection', `${player.name} reconnected.`, { playerId: player.id });
    // Clients drop events whose id they have already seen, so the resume
    // broadcast needs a new one or they wait for their next poll.
    incrementEventId(room);
  }
  if (room.status === 'lobby' && player.id === room.originalHostPlayerId && room.hostPlayerId !== player.id) {
    room.hostPlayerId = player.id;
    appendActivity(room, 'host', `${player.name} is now host.`, { playerId: player.id });
  } else if (room.status === 'lobby' && previousHostId !== room.hostPlayerId) {
    appendActivity(room, 'host', `${playerDisplayName(room, room.hostPlayerId)} is now host.`, { playerId: room.hostPlayerId });
  }
  resolveDisconnectPauseStateAfterReconnect(room);
  if (!wasConnected && room.options?.botFill && room.status === 'active') {
    appendActivity(room, 'connection', `${player.name} took their seat back from the bot.`, { playerId: player.id });
    room.revision += 1;
    syncTurnClock(room, true);
  }
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

export function leaveRoom(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  expectedRevision?: number,
  options: { abandon?: boolean } = {},
): void {
  const spectator = findSpectator(room, playerId);
  if (spectator && spectator.sessionToken === sessionToken) {
    room.spectators = (room.spectators ?? []).filter((entry) => entry.id !== playerId);
    incrementEventId(room);
    bumpUpdatedAt(room);
    return;
  }
  const player = requireSession(room, playerId, sessionToken);
  ensureExpectedRevision(room, expectedRevision);
  // Leaving for good between matches frees the seat, the same as leaving a lobby.
  if (room.status === 'lobby' || (room.status === 'finished' && options.abandon)) {
    if (removeLobbyParticipant(room, player.id)) {
      incrementRevision(room);
    }
    return;
  }
  markDisconnected(room, player);
  if (options.abandon) {
    // The player won't return, so the others shouldn't wait out the grace period.
    const now = nowMs();
    player.reconnectDeadlineMs = now;
    markSeatTimedOutIfExpired(room, player.id, now);
  }
  bumpUpdatedAt(room);
}

/** A dropped connection, unlike leaving on purpose, keeps the seat for the reconnect window. */
export function disconnectRoomSeat(room: MultiplayerRoom, playerId: PlayerId, sessionToken: string): void {
  const player = requireSession(room, playerId, sessionToken);
  markDisconnected(room, player);
  if (room.status === 'lobby') incrementRevision(room);
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
  // A seat left behind here would block every rematch, since prune skips started rooms.
  reclaimDisconnectedLobbyParticipants(room, nowMs(), 'all');
  const players = gameSeats(activePlayers);
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
    if (!checkpointMatchesVariant(room, checkpoint)) {
      throw new Error('checkpoint_variant_mismatch');
    }
    room.game = structuredClone(checkpoint.game);
  } else {
    room.game = createGame({
      players,
      deckVersion: 'v1',
      seed: seed ?? randomInt(MATCH_SEED_RANGE),
      ruleset: getMultiplayerSessionPresetRuleset(room.presetId),
      variant: room.variant,
    });
  }
  resetRoomForFreshMatch(room);
  beginReplayLog(room, Boolean(checkpointId));
  room.series = (room.options?.bestOf ?? 1) > 1 ? newSeries(room) : null;
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
  touchRoomPlayer(room, player);
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

  applyGameAction(room, game, action);
  commitMutation(room);
  if (versionGuardEnabled && actionId) {
    trackActionId(room, playerId, actionId, action);
  }
  return room;
}

function rewindReplayLog(room: MultiplayerRoom, length: number | undefined): void {
  if (room.replayLog && length != null) room.replayLog.actions = room.replayLog.actions.slice(0, length);
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
  rewindReplayLog(room, (room.replayMarks ?? []).pop());
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
  rewindReplayLog(room, room.replayMarks?.[0]);
  room.replayMarks = [];
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
    game: normalizeGameState(structuredClone(game)),
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
  if (!checkpointMatchesVariant(room, checkpoint)) {
    throw new Error('checkpoint_variant_mismatch');
  }
  if (!checkpointRulesMatchPreset(room, checkpoint)) {
    throw new Error('checkpoint_preset_mismatch');
  }
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
  if (room.variant === 'no_mercy') throw new Error('variant_rules_locked');
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

export function setRoomVariant(
  room: MultiplayerRoom,
  playerId: PlayerId,
  sessionToken: string,
  variant: GameVariant,
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
  const nextVariant = normalizeGameVariant(variant, room.variant);
  if (room.variant === nextVariant) return room;
  room.variant = nextVariant;
  if (nextVariant === 'no_mercy') room.presetId = DEFAULT_MULTIPLAYER_SESSION_PRESET;
  clearAllReadyStates(room);
  appendActivity(room, 'lobby', `${player.name} switched the room variant to ${nextVariant}.`, { playerId });
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
  room.players = rematchSeats(room);
  room.game = createGame({
    players: gameSeats(room.players),
    deckVersion: 'v1',
    seed: randomInt(MATCH_SEED_RANGE),
    ruleset: getMultiplayerSessionPresetRuleset(room.presetId),
    variant: room.variant,
  });
  resetRoomForFreshMatch(room);
  beginReplayLog(room, false);
  if ((room.options?.bestOf ?? 1) > 1) {
    room.series = !room.series || room.series.winnerId
      ? newSeries(room)
      : { ...room.series, gameNumber: room.series.gameNumber + 1 };
  } else {
    room.series = null;
  }
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
  const spectator = findSpectator(room, viewerId);
  if (spectator && spectator.sessionToken === sessionToken) {
    spectator.lastSeenAt = nowMs();
    return spectatorView(room, spectator);
  }
  const viewer = requireSession(room, viewerId, sessionToken);
  assertReconnectWindowOpen(viewer);
  if (viewer.connected) {
    touchRoomPlayer(room, viewer);
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
    variant: room.variant,
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
    ...roomViewExtras(room),
    role: 'player',
  };
}

function roomViewExtras(room: MultiplayerRoom): Partial<MultiplayerRoomView> {
  return {
    options: { botDifficulty: 'easy', ...(room.options ?? { botFill: false, turnTimerSeconds: null, bestOf: 1 }) },
    turnClock: room.turnClock ?? undefined,
    series: room.series ?? undefined,
    botSeatIds: room.options?.botFill && room.status === 'active'
      ? room.players.filter((player) => !player.connected && !player.isBot).map((player) => player.id)
      : [],
    spectatorCount: room.spectators?.length ?? 0,
    turnBased: room.turnBased === true,
    replayAvailable: room.status === 'finished' && Boolean(room.replayLog),
  };
}

/** What someone watching sees: the table with every hand face down, and nothing to do. */
function spectatorView(room: MultiplayerRoom, spectator: RoomSpectator): MultiplayerRoomView {
  updateStatusFromGame(room);
  pruneExpiredTyping(room);
  const status = room.game ? isGameOver(room.game) : { done: false as const };
  return {
    roomCode: room.code,
    status: room.status,
    started: Boolean(room.game),
    winnerId: status.done ? status.winnerId : undefined,
    presetId: room.presetId,
    variant: room.variant,
    hostPlayerId: room.hostPlayerId,
    yourPlayerId: spectator.id,
    players: roomPlayerSummary(room),
    promptPlayerId: room.game ? getNextPrompt(room.game).playerId : undefined,
    legalActions: [],
    gameState: room.game ? maskForViewer(room.game, spectator.id) : undefined,
    paused: room.paused,
    pausedByPlayerId: room.pausedByPlayerId,
    roomRuntimeState: room.roomRuntimeState,
    pausedReason: room.pausedReason,
    endedReason: room.endedReason,
    revision: room.revision,
    turnSnapshotCount: 0,
    checkpointSlots: [],
    canStart: false,
    canRematch: false,
    reconnectDeadlineMs: spectator.lastSeenAt + SPECTATOR_STALE_MS,
    serverTime: nowMs(),
    activityFeed: room.activityFeed.filter((entry) => entry.kind !== 'chat'),
    chatMessages: [],
    typingPlayerIds: [],
    lastEventId: room.eventId,
    ...roomViewExtras(room),
    role: 'spectator',
  };
}

export function pruneInactiveRooms(rooms: Map<string, MultiplayerRoom>, now = nowMs()): PruneInactiveRoomsResult {
  const disconnectedSeats: PruneInactiveRoomsResult['disconnectedSeats'] = [];
  const removedRoomCodes: string[] = [];
  for (const [code, room] of rooms) {
    pruneExpiredTyping(room, now);
    const staleConnectionMs = room.status === 'lobby' ? STALE_CONNECTION_LOBBY_MS : STALE_CONNECTION_MATCH_MS;
    const staleConnectedPlayers = room.players.filter((player) => (
      player.connected && !player.isBot && now - player.lastSeenAt > staleConnectionMs
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
    reclaimDisconnectedLobbyParticipants(room, now, 'expired');

    const inactiveForMs = now - room.updatedAt;
    const ttl = room.status === 'lobby' ? 30 * 60 * 1000 : room.status === 'finished' ? 24 * 60 * 60 * 1000 : 2 * 60 * 60 * 1000;
    if (inactiveForMs > ttl) {
      rooms.delete(code);
      removedRoomCodes.push(code);
    }
  }
  return { disconnectedSeats, removedRoomCodes };
}
