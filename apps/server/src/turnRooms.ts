import { randomInt } from 'node:crypto';
import { getNextPrompt, isGameOver, type BotDifficulty, type PlayerId } from '../../../src/engine/index.ts';
import type { MultiplayerSessionPresetId } from '../../../src/ui/experience.ts';
import type { ActionRejectedResponse, ResumeRoomResponse } from '../../../packages/shared/multiplayer.ts';
import {
  applyRoomAction,
  createRoom,
  deleteRoomCheckpoint,
  joinRoom,
  leaveRoom,
  loadRoomCheckpoint,
  normalizeRoomForRuntime,
  pauseRoom,
  reconnectRoom,
  rematchRoom,
  resetTurnRoomActions,
  resumeRoom,
  ROOM_REACTION_OPTIONS,
  roomReplay,
  roomView,
  saveRoomCheckpoint,
  sendRoomChat,
  sendRoomReaction,
  setRoomOptions,
  setRoomPreset,
  setRoomReady,
  setRoomVariant,
  startRoom,
  addRoomBot,
  playTurnRoomBots,
  removeRoomBot,
  setSeatBotDifficulty,
  TURN_ROOM_CODE_LENGTH,
  undoRoomAction,
  watchRoom,
  type MultiplayerRoom,
  type RoomPushSubscription,
} from './gameService.ts';
import {
  isActionRejectionCandidate,
  isNonEmptyTrimmedString,
  isOptionalNonNegativeInteger,
  isValidGameVariant,
  isValidMultiplayerAction,
  mapActionErrorToRejectedReason,
  optionalTrimmedString,
} from './validation.ts';

// Turn-by-turn rooms outlast any server, so nothing lives in memory between requests. Each
// request loads the room, runs the same room functions as a live room, and saves it only if
// nobody else saved first.

const MATCH_SEED_RANGE = 1_000_000_000;
/** A room nobody has touched for this long is gone. */
const TURN_ROOM_TTL_MS = 60 * 24 * 60 * 60_000;
const MAX_SAVE_ATTEMPTS = 3;

export interface StoredTurnRoom {
  room: MultiplayerRoom;
  /** Whatever the store needs to detect that someone else saved in between. */
  version: string;
}

/**
 * Blob's free plan allows 10,000 reads a month, and going over locks storage for 30 days.
 * `cached` costs nothing on a cache hit but can be up to a minute old, so routine polls use it.
 * `fresh` costs one read. `for_write` costs two, because the save needs the version too.
 */
export type TurnRoomRead = 'cached' | 'fresh' | 'for_write';

export interface TurnRoomStore {
  load(code: string, how?: TurnRoomRead): Promise<StoredTurnRoom | null>;
  /** Returns false when the room changed since `version` was read. Null means a new room. */
  save(room: MultiplayerRoom, version: string | null): Promise<boolean>;
  remove(code: string): Promise<void>;
}

export interface TurnNotification {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface TurnRoomNotifier {
  publicKey: string | null;
  /** Returns false when the address no longer works and should be forgotten. */
  send(subscription: RoomPushSubscription, notification: TurnNotification): Promise<boolean>;
}

export interface TurnRoomRequest {
  method: string;
  /** The path after the turn-room prefix, starting with /api/multiplayer. */
  path: string;
  query: Record<string, string | undefined>;
  body: Record<string, unknown>;
}

export interface TurnRoomResponse {
  status: number;
  json: unknown;
}

class TurnRoomConflict extends Error {}

function ok(json: unknown): TurnRoomResponse {
  return { status: 200, json };
}

function fail(status: number, error: string): TurnRoomResponse {
  return { status, json: { error } };
}

function isValidSubscription(value: unknown): value is RoomPushSubscription {
  const candidate = value as RoomPushSubscription | null;
  return Boolean(candidate)
    && typeof candidate?.endpoint === 'string'
    && candidate.endpoint.startsWith('https://')
    && typeof candidate.keys?.p256dh === 'string'
    && typeof candidate.keys?.auth === 'string';
}

function identityFrom(source: Record<string, unknown>): { playerId: PlayerId; sessionToken: string } | null {
  const playerId = source.seatId ?? source.playerId;
  const sessionToken = source.resumeToken ?? source.sessionToken;
  return isNonEmptyTrimmedString(playerId) && isNonEmptyTrimmedString(sessionToken)
    ? { playerId: playerId as PlayerId, sessionToken }
    : null;
}

function promptPlayerId(room: MultiplayerRoom): PlayerId | null {
  if (!room.game || isGameOver(room.game).done) return null;
  return getNextPrompt(room.game).playerId;
}

async function createTurnRoom(store: TurnRoomStore, hostName: string): Promise<TurnRoomResponse> {
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
    const rooms = new Map<string, MultiplayerRoom>();
    const created = createRoom(rooms, hostName, { turnBased: true });
    // A new room only saves if its code is free.
    if (await store.save(created.room, null)) return ok(created.session);
  }
  return fail(503, 'room_capacity_reached');
}

async function tellNextPlayer(
  room: MultiplayerRoom,
  previousPrompt: PlayerId | null,
  store: TurnRoomStore,
  notifier: TurnRoomNotifier | undefined,
): Promise<void> {
  if (!notifier?.publicKey || !room.pushSubscriptions) return;
  const url = `/join/${room.code}`;
  const targets: Array<[PlayerId, TurnNotification]> = [];
  const nextPrompt = promptPlayerId(room);
  if (nextPrompt && nextPrompt !== previousPrompt) {
    targets.push([nextPrompt, { title: "It's your turn", body: `Your move in Monopoly Deal room ${room.code}.`, url, tag: `turn-${room.code}` }]);
  } else if (!nextPrompt && previousPrompt && room.game) {
    const winnerId = isGameOver(room.game).winnerId;
    const winner = room.players.find((player) => player.id === winnerId)?.name ?? 'Nobody';
    for (const player of room.players) {
      targets.push([player.id, { title: 'Game over', body: `${winner} won room ${room.code}.`, url, tag: `turn-${room.code}` }]);
    }
  }
  const gone: PlayerId[] = [];
  await Promise.all(targets.map(async ([playerId, notification]) => {
    const subscription = room.pushSubscriptions?.[playerId];
    if (subscription && !(await notifier.send(subscription, notification))) gone.push(playerId);
  }));
  if (gone.length > 0) {
    // Forgetting a dead address is housekeeping, so losing this save to a newer one is fine.
    gone.forEach((playerId) => delete room.pushSubscriptions?.[playerId]);
    const latest = await store.load(room.code);
    if (latest) {
      gone.forEach((playerId) => delete latest.room.pushSubscriptions?.[playerId]);
      await store.save(latest.room, latest.version);
    }
  }
}

async function loadLiveRoom(store: TurnRoomStore, code: string, how: TurnRoomRead): Promise<StoredTurnRoom | null> {
  const stored = await store.load(code, how);
  if (!stored) return null;
  if (Date.now() - stored.room.updatedAt > TURN_ROOM_TTL_MS) {
    await store.remove(code);
    return null;
  }
  normalizeRoomForRuntime(stored.room);
  return stored;
}

/** Runs a change against the newest copy of the room, starting over if another save got in first. */
async function mutateRoom(
  store: TurnRoomStore,
  notifier: TurnRoomNotifier | undefined,
  code: string,
  change: (room: MultiplayerRoom) => unknown,
): Promise<TurnRoomResponse> {
  for (let attempt = 0; attempt < MAX_SAVE_ATTEMPTS; attempt += 1) {
    const stored = await loadLiveRoom(store, code, 'for_write');
    if (!stored) return fail(404, 'room_not_found');
    const previousPrompt = promptPlayerId(stored.room);
    const result = change(stored.room);
    playTurnRoomBots(stored.room);
    if (await store.save(stored.room, stored.version)) {
      await tellNextPlayer(stored.room, previousPrompt, store, notifier);
      return ok(result ?? { ok: true });
    }
  }
  throw new TurnRoomConflict('revision_conflict');
}

export async function handleTurnRoomRequest(
  request: TurnRoomRequest,
  store: TurnRoomStore,
  notifier?: TurnRoomNotifier,
): Promise<TurnRoomResponse> {
  const { method, path, query, body } = request;
  try {
    if (method === 'GET' && path === '/api/multiplayer/health') {
      return ok({ ok: true, pushEnabled: false, reactionsEnabled: true, socketEnabled: false });
    }
    if (method === 'GET' && path === '/api/multiplayer/turn-config') {
      return ok({ pushPublicKey: notifier?.publicKey ?? null });
    }
    if (method === 'POST' && path === '/api/multiplayer/rooms') {
      return await createTurnRoom(store, optionalTrimmedString(body.playerName) ?? 'Host');
    }

    const match = path.match(
      /^\/api\/multiplayer\/rooms\/([^/]+)\/(join|watch|reconnect|start|preset|variant|options|bots|rematch|action|leave|state|replay|pause|resume|undo|reset-turn|checkpoints|ready|reaction|chat|typing|push)(?:\/(save|load|delete))?$/,
    );
    if (!match) return fail(404, 'not_found');
    const code = decodeURIComponent(match[1]).toUpperCase();
    if (code.length !== TURN_ROOM_CODE_LENGTH) return fail(404, 'room_not_found');
    const operation = match[2];
    const checkpointOperation = match[3];

    if (method === 'GET') {
      if (operation !== 'state' && operation !== 'replay') return fail(405, 'method_not_allowed');
      const identity = identityFrom(query);
      if (!identity) return fail(400, 'invalid_payload');
      const stored = await loadLiveRoom(store, code, query.fresh === '1' ? 'fresh' : 'cached');
      if (!stored) return fail(404, 'room_not_found');
      return ok(operation === 'state'
        ? roomView(stored.room, identity.playerId, identity.sessionToken)
        : roomReplay(stored.room, identity.playerId, identity.sessionToken));
    }
    if (method !== 'POST') return fail(405, 'method_not_allowed');

    if (operation === 'join') {
      return await mutateRoom(store, notifier, code, (room) => joinRoom(room, optionalTrimmedString(body.playerName) ?? 'Player'));
    }
    if (operation === 'watch') {
      return await mutateRoom(store, notifier, code, (room) => watchRoom(room, optionalTrimmedString(body.playerName) ?? 'Spectator'));
    }

    const identity = identityFrom(body);
    if (!identity || !isOptionalNonNegativeInteger(body.expectedRevision)) return fail(400, 'invalid_payload');
    const { playerId, sessionToken } = identity;
    const expectedRevision = body.expectedRevision as number | undefined;

    if (operation === 'reconnect') {
      const stored = await loadLiveRoom(store, code, 'cached');
      if (!stored) {
        const response: ResumeRoomResponse = { status: 'room_closed', roomCode: code, seatId: playerId, requiresFullResync: false };
        return ok(response);
      }
      try {
        // Presence doesn't exist here, so reconnecting has nothing to save.
        const session = reconnectRoom(stored.room, playerId, sessionToken);
        const snapshot = roomView(stored.room, session.playerId, session.sessionToken);
        const response: ResumeRoomResponse = {
          status: 'ok',
          roomCode: session.roomCode,
          seatId: session.seatId,
          resumeToken: session.resumeToken,
          playerId: session.playerId,
          sessionToken: session.sessionToken,
          reconnectDeadlineMs: session.reconnectDeadlineMs,
          requiresFullResync: true,
          serverStateVersion: snapshot.revision,
          snapshot,
        };
        return ok(response);
      } catch {
        const response: ResumeRoomResponse = { status: 'invalid_token', roomCode: code, seatId: playerId, requiresFullResync: false };
        return ok(response);
      }
    }

    if (operation === 'typing') return ok({ ok: true });

    return await mutateRoom(store, notifier, code, (room) => {
      switch (operation) {
        case 'start':
          startRoom(room, playerId, sessionToken, randomInt(MATCH_SEED_RANGE), expectedRevision, optionalTrimmedString(body.checkpointId));
          return null;
        case 'preset': {
          const presetId = optionalTrimmedString(body.presetId);
          if (!presetId) throw new Error('invalid_payload');
          setRoomPreset(room, playerId, sessionToken, presetId as MultiplayerSessionPresetId, expectedRevision);
          return null;
        }
        case 'variant':
          if (!isValidGameVariant(body.variant)) throw new Error('invalid_payload');
          setRoomVariant(room, playerId, sessionToken, body.variant, expectedRevision);
          return null;
        case 'options':
          setRoomOptions(room, playerId, sessionToken, {
            ...(body.botFill !== undefined ? { botFill: body.botFill === true } : {}),
            ...(body.botDifficulty !== undefined ? { botDifficulty: body.botDifficulty as BotDifficulty } : {}),
            ...(body.turnTimerSeconds !== undefined ? { turnTimerSeconds: body.turnTimerSeconds as number | null } : {}),
            ...(body.bestOf !== undefined ? { bestOf: body.bestOf as 1 | 3 } : {}),
          }, expectedRevision);
          return null;
        case 'bots': {
          const op = optionalTrimmedString(body.op);
          const difficulty = (optionalTrimmedString(body.difficulty) ?? 'easy') as BotDifficulty;
          const seatId = optionalTrimmedString(body.seatId) as PlayerId | undefined;
          if (op === 'add') addRoomBot(room, playerId, sessionToken, difficulty);
          else if (op === 'remove' && seatId) removeRoomBot(room, playerId, sessionToken, seatId);
          else if (op === 'difficulty' && seatId) setSeatBotDifficulty(room, playerId, sessionToken, seatId, difficulty);
          else throw new Error('invalid_payload');
          return null;
        }
        case 'rematch':
          rematchRoom(room, playerId, sessionToken, expectedRevision);
          return null;
        case 'action':
          if (!isValidMultiplayerAction(body.action) || !isOptionalNonNegativeInteger(body.clientStateVersion)) throw new Error('invalid_payload');
          applyRoomAction(room, playerId, sessionToken, body.action, expectedRevision, {
            clientStateVersion: body.clientStateVersion,
            actionId: optionalTrimmedString(body.actionId),
          });
          return null;
        case 'leave':
          // Closing the app doesn't give up a seat here. Only Forget Room does.
          if (body.abandon === true || room.status === 'lobby' || room.spectators?.some((entry) => entry.id === playerId)) {
            leaveRoom(room, playerId, sessionToken, expectedRevision, { abandon: body.abandon === true });
          }
          return null;
        case 'pause':
          pauseRoom(room, playerId, sessionToken, expectedRevision);
          return null;
        case 'resume':
          resumeRoom(room, playerId, sessionToken, expectedRevision);
          return null;
        case 'undo':
          undoRoomAction(room, playerId, sessionToken, expectedRevision);
          return null;
        case 'reset-turn':
          resetTurnRoomActions(room, playerId, sessionToken, expectedRevision);
          return null;
        case 'ready':
          if (typeof body.ready !== 'boolean') throw new Error('invalid_payload');
          setRoomReady(room, playerId, sessionToken, body.ready, expectedRevision);
          return null;
        case 'reaction': {
          const reaction = optionalTrimmedString(body.reaction);
          if (!reaction || !ROOM_REACTION_OPTIONS.includes(reaction as (typeof ROOM_REACTION_OPTIONS)[number])) throw new Error('invalid_payload');
          sendRoomReaction(room, playerId, sessionToken, reaction as (typeof ROOM_REACTION_OPTIONS)[number], expectedRevision);
          return null;
        }
        case 'chat':
          if (!isNonEmptyTrimmedString(body.text)) throw new Error('invalid_payload');
          sendRoomChat(room, playerId, sessionToken, body.text.trim(), expectedRevision);
          return null;
        case 'push': {
          // Proves the caller holds this seat before keeping an address for it.
          roomView(room, playerId, sessionToken);
          if (body.subscription === null) {
            if (room.pushSubscriptions) delete room.pushSubscriptions[playerId];
            return null;
          }
          if (!isValidSubscription(body.subscription)) throw new Error('invalid_payload');
          room.pushSubscriptions = { ...room.pushSubscriptions, [playerId]: body.subscription };
          return null;
        }
        case 'checkpoints': {
          if (checkpointOperation === 'save') {
            const name = optionalTrimmedString(body.name);
            if (!name) throw new Error('invalid_payload');
            return { checkpoint: saveRoomCheckpoint(room, playerId, sessionToken, name, expectedRevision) };
          }
          const checkpointId = optionalTrimmedString(body.checkpointId);
          if (!checkpointId) throw new Error('invalid_payload');
          if (checkpointOperation === 'load') {
            loadRoomCheckpoint(room, playerId, sessionToken, checkpointId, expectedRevision);
            return null;
          }
          if (checkpointOperation === 'delete') {
            deleteRoomCheckpoint(room, playerId, sessionToken, checkpointId, expectedRevision);
            return null;
          }
          throw new Error('not_found');
        }
        default:
          throw new Error('not_found');
      }
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'server_error';
    if (operationRejected(code)) {
      const response: ActionRejectedResponse = {
        error: 'action_rejected',
        reason: mapActionErrorToRejectedReason(code),
        serverStateVersion: 0,
        requiresResync: true,
      };
      return { status: 409, json: response };
    }
    return fail(code === 'not_found' ? 404 : 400, code);
  }

  function operationRejected(code: string): boolean {
    return /\/action$/.test(path) && isActionRejectionCandidate(code);
  }
}

/** An in-process store for local development and tests. */
export function createMemoryTurnStore(): TurnRoomStore {
  const rooms = new Map<string, { serialized: string; version: number }>();
  let nextVersion = 1;
  return {
    async load(code) {
      const entry = rooms.get(code);
      return entry ? { room: JSON.parse(entry.serialized) as MultiplayerRoom, version: String(entry.version) } : null;
    },
    async save(room, version) {
      const current = rooms.get(room.code);
      if (version === null ? current != null : String(current?.version) !== version) return false;
      rooms.set(room.code, { serialized: JSON.stringify(room), version: nextVersion });
      nextVersion += 1;
      return true;
    },
    async remove(code) {
      rooms.delete(code);
    },
  };
}
