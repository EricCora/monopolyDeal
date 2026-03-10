import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { parse } from 'node:url';
import { Server as SocketIOServer, type Socket } from 'socket.io';
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
  rematchRoom,
  resetTurnRoomActions,
  roomView,
  ROOM_REACTION_OPTIONS,
  saveRoomCheckpoint,
  sendRoomChat,
  sendRoomReaction,
  setRoomPreset,
  setRoomTyping,
  setRoomReady,
  startRoom,
  resumeRoom,
  undoRoomAction,
  type MultiplayerRoom,
} from './gameService.ts';
import { DisconnectTimerRegistry, disconnectTimerKey } from './disconnectTimers.ts';
import { SocketSessionRegistry, type SocketSeatBinding } from './socketSessionRegistry.ts';
import { loadSnapshots, saveSnapshots } from './persistence/snapshots.ts';
import { redactSensitiveToken } from './logging.ts';
import type { PlayerId } from '../../../src/engine/index.ts';
import type {
  ActionRejectedReason,
  ActionRejectedResponse,
  MultiplayerSocketAck,
  MultiplayerSessionPresetId,
  MultiplayerSocketAuthPayload,
  MultiplayerSocketCommandName,
  MultiplayerSocketCommandPayloadMap,
  MultiplayerSocketCommandResponseMap,
  MultiplayerSocketError,
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
const MULTIPLAYER_SOCKET_ENABLED = process.env.MULTIPLAYER_SOCKET_ENABLED !== 'false';
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
const socketSessions = new SocketSessionRegistry();
const reconnectCounters = {
  resume_request_total: 0,
  resume_success_total: 0,
  resume_failure_total: 0,
  disconnect_timeout_total: 0,
  stale_action_reject_total: 0,
};
let io: SocketIOServer | null = null;

type SessionIdentity = {
  playerId: PlayerId;
  sessionToken: string;
};

type SocketCommandPayload<Name extends MultiplayerSocketCommandName> = MultiplayerSocketCommandPayloadMap[Name];
type SocketCommandResponse<Name extends MultiplayerSocketCommandName> = MultiplayerSocketCommandResponseMap[Name];
type SocketAckCallback<Name extends MultiplayerSocketCommandName> = (ack: MultiplayerSocketAck<SocketCommandResponse<Name>>) => void;

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

  if (seatId && resumeToken) {
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

function resolveSocketAuthPayload(socket: Socket): {
  roomCode: string;
  identity: SessionIdentity;
} | null {
  const raw = (socket.handshake.auth ?? {}) as MultiplayerSocketAuthPayload & { roomCode?: unknown };
  const roomCode = optionalTrimmedString(raw.roomCode)?.toUpperCase();
  if (!roomCode) return null;
  const identity = resolveSessionIdentity(raw);
  if (!identity) return null;
  return { roomCode, identity };
}

function socketAckSuccess<TPayload>(payload: TPayload, serverStateVersion?: number): MultiplayerSocketAck<TPayload> {
  return {
    ok: true,
    transport: 'socket',
    serverStateVersion,
    payload,
  };
}

function socketAckFailure(error: MultiplayerSocketError): MultiplayerSocketAck<never> {
  return {
    ok: false,
    transport: 'socket',
    error,
  };
}

function bindSocketToSeat(socket: Socket, binding: SocketSeatBinding): string | null {
  return socketSessions.bind(socket.id, binding);
}

function unbindSocket(socketId: string): SocketSeatBinding | null {
  return socketSessions.unbind(socketId);
}

function clearSocketBindingsForRoom(roomCode: string): void {
  socketSessions.clearRoom(roomCode);
}

function disconnectSocketForSeat(roomCode: string, seatId: PlayerId, reason: string, exceptSocketId?: string): void {
  const socketId = socketSessions.getActiveSocketId(roomCode, seatId);
  if (!socketId || socketId === exceptSocketId) return;
  const existing = io?.sockets.sockets.get(socketId);
  if (!existing) return;
  socketSessions.markServerInitiatedDisconnect(socketId);
  existing.emit('mp:evt:session_replaced', { reason });
  existing.disconnect(true);
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

  io?.to(room.code).emit('room_update', event);

  if (MULTIPLAYER_PUSH_ENABLED) {
    const clients = roomEventStreams.get(room.code);
    if (!clients || clients.size === 0) return;
    for (const client of clients) {
      try {
        writeSseEvent(client, event);
      } catch {
        removeEventStreamClient(room.code, client);
      }
    }
  }
}

function emitRoomRuntimeTransition(
  room: MultiplayerRoom,
  previousRuntimeState: string | undefined,
): void {
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

function getActiveSocketBinding(socket: Socket): SocketSeatBinding | null {
  return socketSessions.getBinding(socket.id);
}

async function handleSocketDisconnect(socket: Socket, reason?: string): Promise<void> {
  if (socketSessions.consumeServerInitiatedDisconnect(socket.id)) {
    unbindSocket(socket.id);
    return;
  }
  const binding = unbindSocket(socket.id);
  if (!binding) return;

  const room = rooms.get(binding.roomCode);
  if (!room) return;
  console.info(
    `[mp][transport] mode=socket event=disconnect room=${binding.roomCode} seat=${binding.seatId} reason=${reason ?? 'unknown'}`,
  );

  const previousRuntimeState = room.roomRuntimeState;
  const preStatus = room.status;
  try {
    leaveRoom(room, binding.seatId, binding.sessionToken);
  } catch {
    return;
  }
  const seat = getSeatConnectionSnapshot(room, binding.seatId);
  syncDisconnectTimersForRoom(room);
  snapshotAll();
  if (preStatus !== 'lobby' && seat && !seat.connected) {
    broadcastRoomEvent(room, 'mp:player_disconnected', {
      seatId: seat.seatId,
      displayName: seat.displayName,
      graceExpiresAt: seat.reconnectDeadlineMs,
    });
  } else {
    broadcastRoomEvent(room, 'leave');
  }
  emitRoomRuntimeTransition(room, previousRuntimeState);
}

function registerSocketCommand<Name extends MultiplayerSocketCommandName>(
  socket: Socket,
  commandName: Name,
  handler: (
    room: MultiplayerRoom,
    binding: SocketSeatBinding,
    payload: SocketCommandPayload<Name>,
  ) => Promise<SocketCommandResponse<Name>> | SocketCommandResponse<Name>,
): void {
  socket.on(commandName, async (payload: SocketCommandPayload<Name>, ack?: SocketAckCallback<Name>) => {
    const commandStartedAt = Date.now();
    const respond = typeof ack === 'function' ? ack : null;
    if (!respond) return;
    const binding = getActiveSocketBinding(socket);
    if (!binding) {
      respond(socketAckFailure({ code: 'invalid_session' }) as MultiplayerSocketAck<SocketCommandResponse<Name>>);
      return;
    }
    const room = rooms.get(binding.roomCode);
    if (!room) {
      respond(socketAckFailure({ code: 'room_not_found' }) as MultiplayerSocketAck<SocketCommandResponse<Name>>);
      return;
    }
    try {
      const payloadResult = await handler(room, binding, payload);
      console.info(
        `[mp][transport_cmd] mode=socket command=${commandName} room=${room.code} seat=${binding.seatId} status=ok latencyMs=${Date.now() - commandStartedAt}`,
      );
      respond(socketAckSuccess(payloadResult, room.revision));
      if (commandName === 'mp:cmd:leave') {
        unbindSocket(socket.id);
        socket.disconnect(true);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'server_error';
      if (commandName === 'mp:cmd:action' && isActionRejectionCandidate(code)) {
        const reason = mapActionErrorToRejectedReason(code);
        if (reason === 'stale_state') {
          reconnectCounters.stale_action_reject_total += 1;
        }
        console.info(
          `[mp][transport_cmd] mode=socket command=${commandName} room=${room.code} seat=${binding.seatId} status=error code=action_rejected reason=${reason} latencyMs=${Date.now() - commandStartedAt}`,
        );
        respond(socketAckFailure({
          code: 'action_rejected',
          message: reason,
          serverStateVersion: room.revision,
          requiresResync: reason === 'stale_state',
        }) as MultiplayerSocketAck<SocketCommandResponse<Name>>);
        return;
      }
      console.info(
        `[mp][transport_cmd] mode=socket command=${commandName} room=${room.code} seat=${binding.seatId} status=error code=${code} latencyMs=${Date.now() - commandStartedAt}`,
      );
      respond(socketAckFailure({
        code,
        serverStateVersion: room.revision,
      }) as MultiplayerSocketAck<SocketCommandResponse<Name>>);
    }
  });
}

function registerSocketCommands(socket: Socket): void {
  registerSocketCommand(socket, 'mp:cmd:state', (room, binding) => {
    const snapshot = roomView(room, binding.seatId, binding.sessionToken);
    return snapshot;
  });

  registerSocketCommand(socket, 'mp:cmd:reconnect', (room, binding, payload) => {
    reconnectCounters.resume_request_total += 1;
    const previousRuntimeState = room.roomRuntimeState;
    const session = reconnectRoom(room, binding.seatId, binding.sessionToken, payload?.expectedRevision);
    const snapshot = roomView(room, session.playerId, session.sessionToken);
    const seat = getSeatConnectionSnapshot(room, session.playerId);
    syncDisconnectTimersForRoom(room);
    snapshotAll();
    broadcastRoomEvent(room, 'mp:player_reconnected', {
      seatId: seat?.seatId ?? session.playerId,
      displayName: seat?.displayName,
      graceExpiresAt: seat?.reconnectDeadlineMs,
    });
    emitRoomRuntimeTransition(room, previousRuntimeState);
    reconnectCounters.resume_success_total += 1;
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
    return response;
  });

  registerSocketCommand(socket, 'mp:cmd:start', (room, binding, payload) => {
    const previousRuntimeState = room.roomRuntimeState;
    startRoom(room, binding.seatId, binding.sessionToken, payload?.seed, payload?.expectedRevision, payload?.checkpointId);
    snapshotAll();
    broadcastRoomEvent(room, payload?.checkpointId ? 'start_from_checkpoint' : 'start');
    emitRoomRuntimeTransition(room, previousRuntimeState);
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:preset', (room, binding, payload) => {
    const presetId = optionalTrimmedString(payload?.presetId);
    if (!presetId) {
      throw new Error('invalid_payload');
    }
    setRoomPreset(room, binding.seatId, binding.sessionToken, presetId as MultiplayerSessionPresetId, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'preset_changed');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:rematch', (room, binding, payload) => {
    const previousRuntimeState = room.roomRuntimeState;
    rematchRoom(room, binding.seatId, binding.sessionToken, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'rematch');
    emitRoomRuntimeTransition(room, previousRuntimeState);
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:leave', (room, binding, payload) => {
    const preStatus = room.status;
    const previousRuntimeState = room.roomRuntimeState;
    leaveRoom(room, binding.seatId, binding.sessionToken, payload?.expectedRevision);
    const seat = getSeatConnectionSnapshot(room, binding.seatId);
    syncDisconnectTimersForRoom(room);
    snapshotAll();
    if (preStatus !== 'lobby' && seat && !seat.connected) {
      broadcastRoomEvent(room, 'mp:player_disconnected', {
        seatId: seat.seatId,
        displayName: seat.displayName,
        graceExpiresAt: seat.reconnectDeadlineMs,
      });
    } else {
      broadcastRoomEvent(room, 'leave');
    }
    emitRoomRuntimeTransition(room, previousRuntimeState);
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:pause', (room, binding, payload) => {
    const previousRuntimeState = room.roomRuntimeState;
    pauseRoom(room, binding.seatId, binding.sessionToken, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'pause');
    emitRoomRuntimeTransition(room, previousRuntimeState);
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:resume', (room, binding, payload) => {
    const previousRuntimeState = room.roomRuntimeState;
    resumeRoom(room, binding.seatId, binding.sessionToken, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'resume');
    emitRoomRuntimeTransition(room, previousRuntimeState);
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:undo', (room, binding, payload) => {
    undoRoomAction(room, binding.seatId, binding.sessionToken, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'undo');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:reset_turn', (room, binding, payload) => {
    resetTurnRoomActions(room, binding.seatId, binding.sessionToken, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'reset_turn');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:ready', (room, binding, payload) => {
    if (typeof payload?.ready !== 'boolean') {
      throw new Error('invalid_payload');
    }
    setRoomReady(room, binding.seatId, binding.sessionToken, payload.ready, payload.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'ready_changed');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:action', (room, binding, payload) => {
    if (!payload || !isValidMultiplayerAction(payload.action)) {
      throw new Error('invalid_payload');
    }
    applyRoomAction(room, binding.seatId, binding.sessionToken, payload.action, payload.expectedRevision, {
      clientStateVersion: payload.clientStateVersion,
      actionId: optionalTrimmedString(payload.actionId),
    });
    snapshotAll();
    broadcastRoomEvent(room, 'action');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:reaction', (room, binding, payload) => {
    if (!MULTIPLAYER_REACTIONS_ENABLED) {
      throw new Error('reactions_disabled');
    }
    const reaction = optionalTrimmedString(payload?.reaction);
    if (!reaction || !ROOM_REACTION_OPTIONS.includes(reaction as MultiplayerReaction)) {
      throw new Error('invalid_payload');
    }
    sendRoomReaction(room, binding.seatId, binding.sessionToken, reaction as MultiplayerReaction, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'reaction');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:chat', (room, binding, payload) => {
    const text = optionalTrimmedString(payload?.text);
    if (!text) {
      throw new Error('invalid_payload');
    }
    sendRoomChat(room, binding.seatId, binding.sessionToken, text, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'chat');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:typing', (room, binding, payload) => {
    if (typeof payload?.typing !== 'boolean') {
      throw new Error('invalid_payload');
    }
    setRoomTyping(room, binding.seatId, binding.sessionToken, payload.typing, payload.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'typing');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:checkpoint_save', (room, binding, payload) => {
    const name = optionalTrimmedString(payload?.name);
    if (!name) {
      throw new Error('invalid_payload');
    }
    const checkpoint = saveRoomCheckpoint(room, binding.seatId, binding.sessionToken, name, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'checkpoint_saved');
    return { checkpoint };
  });

  registerSocketCommand(socket, 'mp:cmd:checkpoint_load', (room, binding, payload) => {
    const checkpointId = optionalTrimmedString(payload?.checkpointId);
    if (!checkpointId) {
      throw new Error('invalid_payload');
    }
    loadRoomCheckpoint(room, binding.seatId, binding.sessionToken, checkpointId, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'checkpoint_loaded');
    return { ok: true };
  });

  registerSocketCommand(socket, 'mp:cmd:checkpoint_delete', (room, binding, payload) => {
    const checkpointId = optionalTrimmedString(payload?.checkpointId);
    if (!checkpointId) {
      throw new Error('invalid_payload');
    }
    deleteRoomCheckpoint(room, binding.seatId, binding.sessionToken, checkpointId, payload?.expectedRevision);
    snapshotAll();
    broadcastRoomEvent(room, 'checkpoint_deleted');
    return { ok: true };
  });
}

function registerSocketTransport(server: ReturnType<typeof createServer>): void {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    const resolved = resolveSocketAuthPayload(socket);
    if (!resolved) {
      socket.emit('mp:evt:session_replaced', { reason: 'invalid_payload' });
      socket.disconnect(true);
      return;
    }
    const room = rooms.get(resolved.roomCode);
    if (!room) {
      socket.emit('mp:evt:session_replaced', { reason: 'room_not_found' });
      socket.disconnect(true);
      return;
    }
    const seatBefore = getSeatConnectionSnapshot(room, resolved.identity.playerId);
    const wasDisconnected = seatBefore ? !seatBefore.connected : false;
    if (!wasDisconnected && socketSessions.hasActiveConflict(resolved.roomCode, resolved.identity.playerId, socket.id)) {
      socket.emit('mp:evt:session_replaced', { reason: 'seat_already_connected' });
      socket.disconnect(true);
      return;
    }
    const previousRuntimeState = room.roomRuntimeState;

    try {
      if (wasDisconnected) {
        reconnectRoom(room, resolved.identity.playerId, resolved.identity.sessionToken);
      } else {
        roomView(room, resolved.identity.playerId, resolved.identity.sessionToken);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : 'invalid_session';
      socket.emit('mp:evt:session_replaced', { reason: code });
      socket.disconnect(true);
      return;
    }

    const seat = getSeatConnectionSnapshot(room, resolved.identity.playerId);
    if (!seat) {
      socket.emit('mp:evt:session_replaced', { reason: 'seat_not_found' });
      socket.disconnect(true);
      return;
    }
    const previousSocketId = bindSocketToSeat(socket, {
      roomCode: resolved.roomCode,
      seatId: resolved.identity.playerId,
      sessionToken: resolved.identity.sessionToken,
    });
    console.info(
      `[mp][transport] mode=socket event=connect room=${resolved.roomCode} seat=${resolved.identity.playerId} replaced=${Boolean(previousSocketId)}`,
    );
    socket.join(resolved.roomCode);
    if (previousSocketId) {
      socketSessions.markServerInitiatedDisconnect(previousSocketId);
      io?.sockets.sockets.get(previousSocketId)?.emit('mp:evt:session_replaced', { reason: 'newest_socket_wins' });
      io?.sockets.sockets.get(previousSocketId)?.disconnect(true);
    }

    syncDisconnectTimersForRoom(room);
    snapshotAll();
    if (wasDisconnected) {
      broadcastRoomEvent(room, 'mp:player_reconnected', {
        seatId: seat.seatId,
        displayName: seat.displayName,
        graceExpiresAt: seat.reconnectDeadlineMs,
      });
      emitRoomRuntimeTransition(room, previousRuntimeState);
    }
    socket.emit('mp:evt:connected', {
      roomCode: room.code,
      seatId: seat.seatId,
      revision: room.revision,
      serverTime: Date.now(),
    });
    socket.emit('room_update', {
      roomCode: room.code,
      revision: room.revision,
      reason: 'stream_bootstrap',
      serverTime: Date.now(),
      eventId: room.revision,
    } satisfies MultiplayerRoomEventEnvelope);

    registerSocketCommands(socket);
    socket.on('disconnect', (reason) => {
      void handleSocketDisconnect(socket, reason);
    });
  });
}

setInterval(() => {
  const pruneResult = pruneInactiveRooms(rooms);
  for (const disconnected of pruneResult.disconnectedSeats) {
    const room = rooms.get(disconnected.roomCode);
    if (!room) continue;
    broadcastRoomEvent(room, 'mp:player_disconnected', {
      seatId: disconnected.seatId,
      displayName: disconnected.displayName,
      graceExpiresAt: disconnected.graceExpiresAt,
    });
  }
  for (const removedRoomCode of pruneResult.removedRoomCodes) {
    disconnectTimers.cancelRoom(removedRoomCode);
    clearSocketBindingsForRoom(removedRoomCode);
  }
  syncDisconnectTimersForAllRooms();
  snapshotAll();
}, 60_000);

const httpServer = createServer(async (req, res) => {
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
  for (const disconnected of pruneResult.disconnectedSeats) {
    const room = rooms.get(disconnected.roomCode);
    if (!room) continue;
    broadcastRoomEvent(room, 'mp:player_disconnected', {
      seatId: disconnected.seatId,
      displayName: disconnected.displayName,
      graceExpiresAt: disconnected.graceExpiresAt,
    });
  }
  for (const removedRoomCode of pruneResult.removedRoomCodes) {
    disconnectTimers.cancelRoom(removedRoomCode);
    clearSocketBindingsForRoom(removedRoomCode);
  }
  syncDisconnectTimersForAllRooms();

  try {
    if (req.method === 'GET' && path === '/api/multiplayer/health') {
      writeJson(res, 200, {
        ok: true,
        pushEnabled: MULTIPLAYER_PUSH_ENABLED,
        reactionsEnabled: MULTIPLAYER_REACTIONS_ENABLED,
        socketEnabled: MULTIPLAYER_SOCKET_ENABLED,
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
      /^\/api\/multiplayer\/rooms\/([^/]+)(?:\/(join|reconnect|start|preset|rematch|action|leave|state|pause|resume|undo|reset-turn|checkpoints|events|ready|reaction|chat|typing))?(?:\/(save|load|delete))?$/,
    );
    if (!match) {
      writeJson(res, 404, { error: 'not_found' });
      return;
    }

    const roomCode = decodeURIComponent(match[1]).toUpperCase();
    const operation = match[2] ?? null;
    const checkpointOperation = match[3] ?? null;
    const room = rooms.get(roomCode);

    if (req.method === 'POST' && operation === 'reconnect') {
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
        disconnectSocketForSeat(room.code, session.playerId, 'http_reconnect_newest_wins');
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
      presetId?: unknown;
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
      writeJson(res, 404, { error: 'not_found' });
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

    if (operation === 'preset') {
      const presetId = optionalTrimmedString(payload.presetId);
      if (!presetId) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      setRoomPreset(room, playerId, sessionToken, presetId as MultiplayerSessionPresetId, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'preset_changed');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'rematch') {
      const previousRuntimeState = room.roomRuntimeState;
      rematchRoom(room, playerId, sessionToken, expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'rematch');
      emitRoomRuntimeTransition(room, previousRuntimeState);
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'leave') {
      const preStatus = room.status;
      const previousRuntimeState = room.roomRuntimeState;
      leaveRoom(room, playerId, sessionToken, expectedRevision);
      disconnectSocketForSeat(room.code, playerId, 'session_left_room');
      const seat = getSeatConnectionSnapshot(room, playerId);
      syncDisconnectTimersForRoom(room);
      snapshotAll();
      if (preStatus !== 'lobby' && seat && !seat.connected) {
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
          {
            clientStateVersion,
            actionId,
          },
        );
      } catch (actionError) {
        const code = actionError instanceof Error ? actionError.message : 'server_error';
        if (isActionRejectionCandidate(code)) {
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
});

if (MULTIPLAYER_SOCKET_ENABLED) {
  registerSocketTransport(httpServer);
}

httpServer.listen(PORT, () => {
  console.log(`Multiplayer server listening on http://0.0.0.0:${PORT}`);
});
