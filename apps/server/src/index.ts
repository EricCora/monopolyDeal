import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { parse } from 'node:url';
import {
  applyRoomAction,
  createRoom,
  deleteRoomCheckpoint,
  getSeatConnectionSnapshot,
  joinRoom,
  leaveRoom,
  listSeatConnectionSnapshots,
  listRoomCheckpoints,
  loadRoomCheckpoint,
  markSeatTimedOutIfExpired,
  pauseRoom,
  pruneInactiveRooms,
  reconnectRoom,
  resetTurnRoomActions,
  roomView,
  ROOM_REACTION_OPTIONS,
  saveRoomCheckpoint,
  sendRoomChat,
  sendRoomReaction,
  setRoomTyping,
  setRoomReady,
  startRoom,
  resumeRoom,
  undoRoomAction,
  type MultiplayerRoom,
} from './gameService.ts';
import { DisconnectTimerRegistry, disconnectTimerKey } from './disconnectTimers.ts';
import { loadSnapshots, saveSnapshots } from './persistence/snapshots.ts';
import { redactSensitiveToken } from './logging.ts';
import type { PlayerId } from '../../../src/engine/index.ts';
import type {
  ActionRejectedReason,
  ActionRejectedResponse,
  MultiplayerReaction,
  MultiplayerRoomEventEnvelope,
  ResumeResultStatus,
  ResumeRoomResponse,
} from '../../../packages/shared/multiplayer.ts';
import {
  isNonEmptyTrimmedString,
  isOptionalFiniteNumber,
  isOptionalNonNegativeInteger,
  isValidMultiplayerAction,
  optionalTrimmedString,
} from './validation.ts';

const PORT = Number(process.env.PORT ?? 8787);
const MULTIPLAYER_PUSH_ENABLED = process.env.MULTIPLAYER_PUSH_ENABLED !== 'false';
const MULTIPLAYER_REACTIONS_ENABLED = process.env.MULTIPLAYER_REACTIONS_ENABLED !== 'false';
const MP_RECONNECT_V1_ENABLED = process.env.MP_RECONNECT_V1 === 'true';
const MP_VERSION_GUARD_V1_ENABLED = process.env.MP_VERSION_GUARD_V1 === 'true';
const MP_PAUSE_ON_DISCONNECT_V1_ENABLED = process.env.MP_PAUSE_ON_DISCONNECT_V1 === 'true';
const SSE_HEARTBEAT_MS = 25_000;

const rooms = new Map<string, MultiplayerRoom>();

for (const room of loadSnapshots()) {
  rooms.set(room.code, room);
}

type EventStreamClient = {
  res: ServerResponse<IncomingMessage>;
  heartbeat: NodeJS.Timeout;
};

const roomEventStreams = new Map<string, Set<EventStreamClient>>();
const reconnectCounters = {
  resume_request_total: 0,
  resume_success_total: 0,
  resume_failure_total: 0,
  disconnect_timeout_total: 0,
  stale_action_reject_total: 0,
};

type SessionIdentity = {
  playerId: PlayerId;
  sessionToken: string;
};

function resolveSessionIdentity(
  input: {
    seatId?: unknown;
    resumeToken?: unknown;
    playerId?: unknown;
    sessionToken?: unknown;
  },
): SessionIdentity | null {
  const seatId = optionalTrimmedString(input.seatId);
  const resumeToken = optionalTrimmedString(input.resumeToken);
  const playerId = optionalTrimmedString(input.playerId);
  const sessionToken = optionalTrimmedString(input.sessionToken);

  if (MP_RECONNECT_V1_ENABLED && seatId && resumeToken) {
    return {
      playerId: seatId as PlayerId,
      sessionToken: resumeToken,
    };
  }

  if (playerId && sessionToken) {
    return {
      playerId: playerId as PlayerId,
      sessionToken,
    };
  }

  return null;
}

function mapReconnectErrorToStatus(code: string): ResumeResultStatus {
  if (code === 'invalid_session') return 'invalid_token';
  if (code === 'reconnect_expired') return 'seat_timed_out';
  if (code === 'revision_conflict') return 'protocol_mismatch';
  if (code === 'room_not_found') return 'room_closed';
  return 'invalid_token';
}

function mapActionErrorToRejectedReason(code: string): ActionRejectedReason {
  if (code === 'stale_state' || code === 'revision_conflict') return 'stale_state';
  if (code === 'not_your_turn' || code === 'invalid_turn' || code === 'player_action_mismatch') return 'not_your_turn';
  if (code === 'unresolved_pending') return 'prompt_mismatch';
  return 'invalid_action';
}

function isActionRejectionCandidate(code: string): boolean {
  return code === 'stale_state'
    || code === 'revision_conflict'
    || code === 'not_your_turn'
    || code === 'invalid_turn'
    || code === 'illegal_action'
    || code === 'invalid_action'
    || code === 'unresolved_pending'
    || code === 'player_action_mismatch';
}

function listLanOrigins(uiPort: number): string[] {
  const nets = networkInterfaces();
  const origins = new Set<string>();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (!entry || entry.family !== 'IPv4' || entry.internal) continue;
      const address = entry.address;
      if (address.startsWith('10.')
        || address.startsWith('192.168.')
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) {
        origins.add(`http://${address}:${uiPort}`);
      }
    }
  }
  return Array.from(origins);
}

const disconnectTimers = new DisconnectTimerRegistry((roomCode, seatId) => {
  handleDisconnectTimeout(roomCode, seatId).catch((error) => {
    const message = error instanceof Error ? error.message : 'unknown_error';
    console.info(`[mp][disconnect_timeout_handler_error] room=${roomCode} seat=${seatId} error=${message}`);
  });
});

function writeJson(
  res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void },
  code: number,
  payload: unknown,
): void {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

function collectBody(req: { on: (event: string, handler: (chunk?: Buffer) => void) => void }): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk?: Buffer) => {
      if (chunk) chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function snapshotAll(): void {
  saveSnapshots(Array.from(rooms.values()));
}

function writeSseEvent(client: EventStreamClient, event: MultiplayerRoomEventEnvelope): void {
  client.res.write(`id: ${event.eventId}\n`);
  client.res.write('event: room_update\n');
  client.res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function removeEventStreamClient(roomCode: string, client: EventStreamClient): void {
  clearInterval(client.heartbeat);
  const existing = roomEventStreams.get(roomCode);
  if (!existing) return;
  existing.delete(client);
  if (existing.size === 0) {
    roomEventStreams.delete(roomCode);
  }
}

function addEventStreamClient(roomCode: string, client: EventStreamClient): void {
  const existing = roomEventStreams.get(roomCode) ?? new Set<EventStreamClient>();
  existing.add(client);
  roomEventStreams.set(roomCode, existing);
}

function broadcastRoomEvent(
  room: MultiplayerRoom,
  reason: string,
  details?: { seatId?: PlayerId; displayName?: string; graceExpiresAt?: number },
): void {
  if (!MULTIPLAYER_PUSH_ENABLED) return;
  const clients = roomEventStreams.get(room.code);
  if (!clients || clients.size === 0) return;
  const event: MultiplayerRoomEventEnvelope = {
    roomCode: room.code,
    revision: room.revision,
    reason,
    serverTime: Date.now(),
    eventId: room.revision,
    seatId: details?.seatId,
    displayName: details?.displayName,
    graceExpiresAt: details?.graceExpiresAt,
  };

  for (const client of clients) {
    try {
      writeSseEvent(client, event);
    } catch {
      removeEventStreamClient(room.code, client);
    }
  }
}

function emitRoomRuntimeTransition(
  room: MultiplayerRoom,
  previousRuntimeState: string | undefined,
): void {
  if (!MP_PAUSE_ON_DISCONNECT_V1_ENABLED) return;
  const nextRuntimeState = room.roomRuntimeState;
  if (previousRuntimeState === nextRuntimeState) return;
  if (nextRuntimeState === 'paused_disconnect' || nextRuntimeState === 'paused_host_disconnect') {
    console.info(
      `[mp][room_runtime] room=${room.code} status=paused_disconnect pausedReason=${room.pausedReason ?? 'unknown'} from=${previousRuntimeState ?? 'none'}`,
    );
    broadcastRoomEvent(room, 'mp:room_paused_disconnect');
    return;
  }
  if (previousRuntimeState === 'paused_disconnect' || previousRuntimeState === 'paused_host_disconnect') {
    if (nextRuntimeState === 'active') {
      console.info(`[mp][room_runtime] room=${room.code} status=resumed_disconnect from=${previousRuntimeState}`);
      broadcastRoomEvent(room, 'mp:room_resumed_disconnect');
    }
  }
  if (nextRuntimeState === 'ended_timeout') {
    console.info(
      `[mp][room_runtime] room=${room.code} status=ended_timeout endedReason=${room.endedReason ?? 'unknown'} from=${previousRuntimeState ?? 'none'}`,
    );
    broadcastRoomEvent(room, 'mp:room_ended_timeout');
  }
}

function syncDisconnectTimersForRoom(room: MultiplayerRoom): void {
  if (!MP_RECONNECT_V1_ENABLED) return;
  const now = Date.now();
  for (const seat of listSeatConnectionSnapshots(room)) {
    if (seat.connected || seat.connectionState === 'timed_out') {
      disconnectTimers.cancel(room.code, seat.seatId);
      continue;
    }
    if (seat.reconnectDeadlineMs <= now) {
      void handleDisconnectTimeout(room.code, seat.seatId);
      continue;
    }
    disconnectTimers.schedule(room.code, seat.seatId, seat.reconnectDeadlineMs);
  }
}

function syncDisconnectTimersForAllRooms(): void {
  if (!MP_RECONNECT_V1_ENABLED) return;
  const validKeys = new Set<string>();
  for (const room of rooms.values()) {
    syncDisconnectTimersForRoom(room);
    for (const seat of listSeatConnectionSnapshots(room)) {
      if (seat.connected || seat.connectionState === 'timed_out') continue;
      validKeys.add(disconnectTimerKey(room.code, seat.seatId));
    }
  }
  disconnectTimers.syncValidKeys(validKeys);
}

async function handleDisconnectTimeout(roomCode: string, seatId: string): Promise<void> {
  if (!MP_RECONNECT_V1_ENABLED) {
    disconnectTimers.cancel(roomCode, seatId);
    return;
  }
  const room = rooms.get(roomCode);
  if (!room) {
    disconnectTimers.cancel(roomCode, seatId);
    return;
  }
  const previousRuntimeState = room.roomRuntimeState;
  const result = markSeatTimedOutIfExpired(room, seatId as PlayerId, Date.now());
  if (!result.transitioned) {
    syncDisconnectTimersForRoom(room);
    return;
  }
  reconnectCounters.disconnect_timeout_total += 1;
  console.info(
    `[mp][disconnect_timeout] room=${roomCode} seat=${result.seatId} runtime=${room.roomRuntimeState ?? 'none'} endedReason=${room.endedReason ?? 'none'}`,
  );
  snapshotAll();
  broadcastRoomEvent(room, 'mp:player_timed_out', {
    seatId: result.seatId,
    displayName: result.displayName,
    graceExpiresAt: result.graceExpiresAt,
  });
  emitRoomRuntimeTransition(room, previousRuntimeState);
  syncDisconnectTimersForRoom(room);
}

function openEventStream(
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  room: MultiplayerRoom,
  playerId: string,
  sessionToken: string,
  lastEventId: number,
): void {
  // Validate session and keep reconnect window fresh.
  roomView(room, playerId as PlayerId, sessionToken);
  snapshotAll();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const client: EventStreamClient = {
    res,
    heartbeat: setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        removeEventStreamClient(room.code, client);
      }
    }, SSE_HEARTBEAT_MS),
  };
  addEventStreamClient(room.code, client);

  // Emit an immediate bootstrap frame so clients/proxies can confirm stream readiness
  // without waiting for the first room mutation or heartbeat.
  writeSseEvent(client, {
    roomCode: room.code,
    revision: room.revision,
    reason: 'stream_bootstrap',
    serverTime: Date.now(),
    eventId: room.revision,
  });

  if (room.revision > lastEventId) {
    writeSseEvent(client, {
      roomCode: room.code,
      revision: room.revision,
      reason: 'sync',
      serverTime: Date.now(),
      eventId: room.revision,
    });
  }

  const cleanup = () => {
    removeEventStreamClient(room.code, client);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

setInterval(() => {
  const pruneResult = pruneInactiveRooms(rooms);
  if (MP_RECONNECT_V1_ENABLED) {
    for (const disconnected of pruneResult.disconnectedSeats) {
      const room = rooms.get(disconnected.roomCode);
      if (!room) continue;
      broadcastRoomEvent(room, 'mp:player_disconnected', {
        seatId: disconnected.seatId,
        displayName: disconnected.displayName,
        graceExpiresAt: disconnected.graceExpiresAt,
      });
    }
  }
  syncDisconnectTimersForAllRooms();
  snapshotAll();
}, 60_000);

createServer(async (req, res) => {
  if (!req.url || !req.method) {
    writeJson(res, 400, { error: 'bad_request' });
    return;
  }

  if (req.method === 'OPTIONS') {
    writeJson(res, 200, { ok: true });
    return;
  }

  const parsed = parse(req.url, true);
  const path = parsed.pathname ?? '';
  const pruneResult = pruneInactiveRooms(rooms);
  if (MP_RECONNECT_V1_ENABLED) {
    for (const disconnected of pruneResult.disconnectedSeats) {
      const room = rooms.get(disconnected.roomCode);
      if (!room) continue;
      broadcastRoomEvent(room, 'mp:player_disconnected', {
        seatId: disconnected.seatId,
        displayName: disconnected.displayName,
        graceExpiresAt: disconnected.graceExpiresAt,
      });
    }
  }
  syncDisconnectTimersForAllRooms();

  try {
    if (req.method === 'GET' && path === '/api/multiplayer/health') {
      writeJson(res, 200, {
        ok: true,
        pushEnabled: MULTIPLAYER_PUSH_ENABLED,
        reactionsEnabled: MULTIPLAYER_REACTIONS_ENABLED,
      });
      return;
    }

    if (req.method === 'GET' && path === '/api/multiplayer/dev/lan-origins') {
      const requestedPort = Number(parsed.query.uiPort ?? 5173);
      const uiPort = Number.isFinite(requestedPort) && requestedPort > 0 ? Math.floor(requestedPort) : 5173;
      writeJson(res, 200, { origins: listLanOrigins(uiPort) });
      return;
    }

    if (req.method === 'POST' && path === '/api/multiplayer/rooms') {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw || '{}') as { playerName?: unknown };
      const created = createRoom(rooms, optionalTrimmedString(payload.playerName) ?? 'Host');
      syncDisconnectTimersForRoom(created.room);
      snapshotAll();
      writeJson(res, 200, created.session);
      return;
    }

    const match = path.match(
      /^\/api\/multiplayer\/rooms\/([^/]+)(?:\/(join|reconnect|start|action|leave|state|pause|resume|undo|reset-turn|checkpoints|events|ready|reaction|chat|typing))?(?:\/(save|load|delete))?$/,
    );
    if (!match) {
      writeJson(res, 404, { error: 'not_found' });
      return;
    }

    const roomCode = decodeURIComponent(match[1]).toUpperCase();
    const operation = match[2] ?? null;
    const checkpointOperation = match[3] ?? null;
    const room = rooms.get(roomCode);

    if (req.method === 'POST' && operation === 'reconnect' && MP_RECONNECT_V1_ENABLED) {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw || '{}') as {
        seatId?: unknown;
        resumeToken?: unknown;
        playerId?: unknown;
        sessionToken?: unknown;
        expectedRevision?: unknown;
      };

      if (!isNonEmptyTrimmedString(payload.playerId)
        && !isNonEmptyTrimmedString(payload.seatId)
        || !isOptionalNonNegativeInteger(payload.expectedRevision)) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const identity = resolveSessionIdentity(payload);
      if (!identity) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const playerId = identity.playerId;
      const sessionToken = identity.sessionToken;
      const expectedRevision = payload.expectedRevision;

      reconnectCounters.resume_request_total += 1;
      console.info(
        `[mp][resume_request] room=${roomCode} seat=${playerId} token=${redactSensitiveToken(sessionToken)} revision=${String(expectedRevision ?? '')}`,
      );

      if (!room) {
        reconnectCounters.resume_failure_total += 1;
        console.info(`[mp][resume_result] room=${roomCode} seat=${playerId} status=room_closed`);
        const response: ResumeRoomResponse = {
          status: 'room_closed',
          roomCode,
          seatId: playerId,
          requiresFullResync: false,
        };
        writeJson(res, 200, response);
        return;
      }

      try {
        const previousRuntimeState = room.roomRuntimeState;
        const session = reconnectRoom(room, playerId, sessionToken, expectedRevision);
        const snapshot = roomView(room, session.playerId, session.sessionToken);
        reconnectCounters.resume_success_total += 1;
        console.info(
          `[mp][resume_result] room=${roomCode} seat=${playerId} status=ok runtime=${room.roomRuntimeState ?? 'none'} endedReason=${room.endedReason ?? 'none'}`,
        );
        const seat = getSeatConnectionSnapshot(room, playerId);
        syncDisconnectTimersForRoom(room);
        snapshotAll();
        broadcastRoomEvent(room, 'mp:player_reconnected', {
          seatId: seat?.seatId ?? playerId,
          displayName: seat?.displayName,
          graceExpiresAt: seat?.reconnectDeadlineMs,
        });
        emitRoomRuntimeTransition(room, previousRuntimeState);
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
        writeJson(res, 200, response);
      } catch (resumeError) {
        reconnectCounters.resume_failure_total += 1;
        const reason = resumeError instanceof Error ? resumeError.message : 'server_error';
        const status = mapReconnectErrorToStatus(reason);
        console.info(`[mp][resume_result] room=${roomCode} seat=${playerId} status=${status}`);
        const response: ResumeRoomResponse = {
          status,
          roomCode,
          seatId: playerId,
          requiresFullResync: false,
        };
        writeJson(res, 200, response);
      }
      return;
    }

    if (!room) {
      writeJson(res, 404, { error: 'room_not_found' });
      return;
    }

    if (req.method === 'GET' && operation === 'state') {
      const identity = resolveSessionIdentity({
        seatId: parsed.query.seatId,
        resumeToken: parsed.query.resumeToken,
        playerId: parsed.query.playerId,
        sessionToken: parsed.query.sessionToken,
      });
      if (!identity) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const view = roomView(room, identity.playerId, identity.sessionToken);
      snapshotAll();
      writeJson(res, 200, view);
      return;
    }

    if (req.method === 'GET' && operation === 'checkpoints' && !checkpointOperation) {
      const identity = resolveSessionIdentity({
        seatId: parsed.query.seatId,
        resumeToken: parsed.query.resumeToken,
        playerId: parsed.query.playerId,
        sessionToken: parsed.query.sessionToken,
      });
      if (!identity) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const checkpoints = listRoomCheckpoints(room, identity.playerId, identity.sessionToken);
      snapshotAll();
      writeJson(res, 200, { checkpoints });
      return;
    }

    if (req.method === 'GET' && operation === 'events') {
      if (!MULTIPLAYER_PUSH_ENABLED) {
        writeJson(res, 400, { error: 'push_disabled' });
        return;
      }
      const identity = resolveSessionIdentity({
        seatId: parsed.query.seatId,
        resumeToken: parsed.query.resumeToken,
        playerId: parsed.query.playerId,
        sessionToken: parsed.query.sessionToken,
      });
      const lastEventIdValue = parsed.query.lastEventId == null ? 0 : Number(parsed.query.lastEventId);
      if (!identity || !isOptionalNonNegativeInteger(lastEventIdValue)) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      openEventStream(req, res, room, identity.playerId, identity.sessionToken, lastEventIdValue ?? 0);
      return;
    }

    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const raw = await collectBody(req);
    const payload = JSON.parse(raw || '{}') as {
      playerName?: unknown;
      seatId?: unknown;
      resumeToken?: unknown;
      playerId?: unknown;
      sessionToken?: unknown;
      action?: unknown;
      clientStateVersion?: unknown;
      actionId?: unknown;
      seed?: unknown;
      name?: unknown;
      checkpointId?: unknown;
      expectedRevision?: unknown;
      ready?: unknown;
      reaction?: unknown;
      text?: unknown;
      typing?: unknown;
    };

    if (operation === 'join') {
      const session = joinRoom(room, optionalTrimmedString(payload.playerName) ?? 'Player');
      syncDisconnectTimersForRoom(room);
      snapshotAll();
      broadcastRoomEvent(room, 'join');
      writeJson(res, 200, session);
      return;
    }

    if (!isNonEmptyTrimmedString(payload.playerId)
      && !isNonEmptyTrimmedString(payload.seatId)
      || !isOptionalNonNegativeInteger(payload.expectedRevision)) {
      writeJson(res, 400, { error: 'invalid_payload' });
      return;
    }

    const identity = resolveSessionIdentity(payload);
    if (!identity) {
      writeJson(res, 400, { error: 'invalid_payload' });
      return;
    }
    const playerId = identity.playerId;
    const sessionToken = identity.sessionToken;
    const expectedRevision = payload.expectedRevision;

    if (operation === 'reconnect') {
      reconnectCounters.resume_request_total += 1;
      console.info(
        `[mp][resume_request] room=${roomCode} seat=${playerId} token=${redactSensitiveToken(sessionToken)} revision=${String(expectedRevision ?? '')}`,
      );
      try {
        const previousRuntimeState = room.roomRuntimeState;
        const session = reconnectRoom(room, playerId, sessionToken, expectedRevision);
        reconnectCounters.resume_success_total += 1;
        console.info(
          `[mp][resume_result] room=${roomCode} seat=${playerId} status=ok runtime=${room.roomRuntimeState ?? 'none'} endedReason=${room.endedReason ?? 'none'}`,
        );
        const seat = getSeatConnectionSnapshot(room, playerId);
        syncDisconnectTimersForRoom(room);
        snapshotAll();
        broadcastRoomEvent(room, MP_RECONNECT_V1_ENABLED ? 'mp:player_reconnected' : 'reconnect', MP_RECONNECT_V1_ENABLED
          ? {
              seatId: seat?.seatId ?? playerId,
              displayName: seat?.displayName,
              graceExpiresAt: seat?.reconnectDeadlineMs,
            }
          : undefined);
        emitRoomRuntimeTransition(room, previousRuntimeState);
        writeJson(res, 200, session);
      } catch (resumeError) {
        reconnectCounters.resume_failure_total += 1;
        const reason = resumeError instanceof Error ? resumeError.message : 'server_error';
        console.info(`[mp][resume_result] room=${roomCode} seat=${playerId} status=${reason}`);
        throw resumeError;
      }
      return;
    }

    if (operation === 'start') {
      if (!isOptionalFiniteNumber(payload.seed)) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const checkpointId = optionalTrimmedString(payload.checkpointId);
      const previousRuntimeState = room.roomRuntimeState;
      startRoom(room, playerId, sessionToken, payload.seed, expectedRevision, checkpointId);
      snapshotAll();
      broadcastRoomEvent(room, checkpointId ? 'start_from_checkpoint' : 'start');
      emitRoomRuntimeTransition(room, previousRuntimeState);
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'leave') {
      const preStatus = room.status;
      const previousRuntimeState = room.roomRuntimeState;
      leaveRoom(room, playerId, sessionToken, expectedRevision);
      const seat = getSeatConnectionSnapshot(room, playerId);
      syncDisconnectTimersForRoom(room);
      snapshotAll();
      if (MP_RECONNECT_V1_ENABLED && preStatus !== 'lobby' && seat && !seat.connected) {
        broadcastRoomEvent(room, 'mp:player_disconnected', {
          seatId: seat.seatId,
          displayName: seat.displayName,
          graceExpiresAt: seat.reconnectDeadlineMs,
        });
      } else {
        broadcastRoomEvent(room, 'leave');
      }
      emitRoomRuntimeTransition(room, previousRuntimeState);
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'pause') {
      const previousRuntimeState = room.roomRuntimeState;
      pauseRoom(room, playerId, sessionToken, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'pause');
      emitRoomRuntimeTransition(room, previousRuntimeState);
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'resume') {
      const previousRuntimeState = room.roomRuntimeState;
      resumeRoom(room, playerId, sessionToken, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'resume');
      emitRoomRuntimeTransition(room, previousRuntimeState);
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'undo') {
      undoRoomAction(room, playerId, sessionToken, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'undo');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'reset-turn') {
      resetTurnRoomActions(room, playerId, sessionToken, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'reset_turn');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'action') {
      if (!isValidMultiplayerAction(payload.action)) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const clientStateVersion = payload.clientStateVersion;
      const actionId = optionalTrimmedString(payload.actionId);
      if (!isOptionalNonNegativeInteger(clientStateVersion)) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const revisionBeforeAction = room.revision;
      try {
        applyRoomAction(
          room,
          playerId,
          sessionToken,
          payload.action,
          expectedRevision,
          MP_VERSION_GUARD_V1_ENABLED
            ? {
                clientStateVersion,
                actionId,
              }
            : {},
        );
      } catch (actionError) {
        const code = actionError instanceof Error ? actionError.message : 'server_error';
        if (MP_VERSION_GUARD_V1_ENABLED && isActionRejectionCandidate(code)) {
          const reason = mapActionErrorToRejectedReason(code);
          if (reason === 'stale_state') {
            reconnectCounters.stale_action_reject_total += 1;
          }
          const response: ActionRejectedResponse = {
            error: 'action_rejected',
            reason,
            serverStateVersion: room.revision,
            requiresResync: reason === 'stale_state',
          };
          console.info(
            `[mp][action_rejected] room=${room.code} seat=${playerId} reason=${reason} serverStateVersion=${room.revision}`,
          );
          writeJson(res, 409, response);
          return;
        }
        throw actionError;
      }
      if (room.revision !== revisionBeforeAction) {
        snapshotAll();
        broadcastRoomEvent(room, 'action');
      }
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'ready') {
      if (typeof payload.ready !== 'boolean') {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      setRoomReady(room, playerId, sessionToken, payload.ready, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'ready_changed');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'reaction') {
      if (!MULTIPLAYER_REACTIONS_ENABLED) {
        writeJson(res, 400, { error: 'reactions_disabled' });
        return;
      }
      const reaction = optionalTrimmedString(payload.reaction);
      if (!reaction || !ROOM_REACTION_OPTIONS.includes(reaction as MultiplayerReaction)) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      sendRoomReaction(room, playerId, sessionToken, reaction as MultiplayerReaction, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'reaction');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'chat') {
      if (!isNonEmptyTrimmedString(payload.text)) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      sendRoomChat(room, playerId, sessionToken, payload.text.trim(), expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'chat');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'typing') {
      if (typeof payload.typing !== 'boolean') {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      setRoomTyping(room, playerId, sessionToken, payload.typing, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'typing');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'checkpoints' && checkpointOperation === 'save') {
      const checkpointName = optionalTrimmedString(payload.name);
      if (!checkpointName) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const checkpoint = saveRoomCheckpoint(room, playerId, sessionToken, checkpointName, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'checkpoint_saved');
      writeJson(res, 200, { checkpoint });
      return;
    }

    if (operation === 'checkpoints' && checkpointOperation === 'load') {
      const checkpointId = optionalTrimmedString(payload.checkpointId);
      if (!checkpointId) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      loadRoomCheckpoint(room, playerId, sessionToken, checkpointId, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'checkpoint_loaded');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'checkpoints' && checkpointOperation === 'delete') {
      const checkpointId = optionalTrimmedString(payload.checkpointId);
      if (!checkpointId) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      deleteRoomCheckpoint(room, playerId, sessionToken, checkpointId, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'checkpoint_deleted');
      writeJson(res, 200, { ok: true });
      return;
    }

    writeJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'server_error';
    writeJson(res, 400, { error: message });
  }
}).listen(PORT, () => {
  console.log(`Multiplayer server listening on http://0.0.0.0:${PORT}`);
});
