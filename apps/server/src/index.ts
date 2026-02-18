import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { parse } from 'node:url';
import {
  applyRoomAction,
  createRoom,
  deleteRoomCheckpoint,
  joinRoom,
  leaveRoom,
  listRoomCheckpoints,
  loadRoomCheckpoint,
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
import { loadSnapshots, saveSnapshots } from './persistence/snapshots.ts';
import type { Action, PlayerId } from '../../../src/engine/index.ts';
import type { MultiplayerReaction, MultiplayerRoomEventEnvelope } from '../../../packages/shared/multiplayer.ts';

const PORT = Number(process.env.PORT ?? 8787);
const MULTIPLAYER_PUSH_ENABLED = process.env.MULTIPLAYER_PUSH_ENABLED !== 'false';
const MULTIPLAYER_REACTIONS_ENABLED = process.env.MULTIPLAYER_REACTIONS_ENABLED !== 'false';
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

function broadcastRoomEvent(room: MultiplayerRoom, reason: string): void {
  if (!MULTIPLAYER_PUSH_ENABLED) return;
  const clients = roomEventStreams.get(room.code);
  if (!clients || clients.size === 0) return;
  const event: MultiplayerRoomEventEnvelope = {
    roomCode: room.code,
    revision: room.revision,
    reason,
    serverTime: Date.now(),
    eventId: room.revision,
  };

  for (const client of clients) {
    try {
      writeSseEvent(client, event);
    } catch {
      removeEventStreamClient(room.code, client);
    }
  }
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
  pruneInactiveRooms(rooms);
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
  pruneInactiveRooms(rooms);

  try {
    if (req.method === 'GET' && path === '/api/multiplayer/health') {
      writeJson(res, 200, {
        ok: true,
        pushEnabled: MULTIPLAYER_PUSH_ENABLED,
        reactionsEnabled: MULTIPLAYER_REACTIONS_ENABLED,
      });
      return;
    }

    if (req.method === 'POST' && path === '/api/multiplayer/rooms') {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw || '{}') as { playerName?: string };
      const created = createRoom(rooms, payload.playerName ?? 'Host');
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
    if (!room) {
      writeJson(res, 404, { error: 'room_not_found' });
      return;
    }

    if (req.method === 'GET' && operation === 'state') {
      const playerId = String(parsed.query.playerId ?? '');
      const sessionToken = String(parsed.query.sessionToken ?? '');
      if (!playerId || !sessionToken) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const view = roomView(room, playerId as PlayerId, sessionToken);
      snapshotAll();
      writeJson(res, 200, view);
      return;
    }

    if (req.method === 'GET' && operation === 'checkpoints' && !checkpointOperation) {
      const playerId = String(parsed.query.playerId ?? '');
      const sessionToken = String(parsed.query.sessionToken ?? '');
      if (!playerId || !sessionToken) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const checkpoints = listRoomCheckpoints(room, playerId as PlayerId, sessionToken);
      snapshotAll();
      writeJson(res, 200, { checkpoints });
      return;
    }

    if (req.method === 'GET' && operation === 'events') {
      if (!MULTIPLAYER_PUSH_ENABLED) {
        writeJson(res, 400, { error: 'push_disabled' });
        return;
      }
      const playerId = String(parsed.query.playerId ?? '');
      const sessionToken = String(parsed.query.sessionToken ?? '');
      const lastEventId = Number(parsed.query.lastEventId ?? 0);
      if (!playerId || !sessionToken) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      openEventStream(req, res, room, playerId, sessionToken, Number.isFinite(lastEventId) ? lastEventId : 0);
      return;
    }

    if (req.method !== 'POST') {
      writeJson(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const raw = await collectBody(req);
    const payload = JSON.parse(raw || '{}') as {
      playerName?: string;
      playerId?: string;
      sessionToken?: string;
      action?: Action;
      seed?: number;
      name?: string;
      checkpointId?: string;
      expectedRevision?: number;
      ready?: boolean;
      reaction?: MultiplayerReaction;
      text?: string;
      typing?: boolean;
    };

    if (operation === 'join') {
      const session = joinRoom(room, payload.playerName ?? 'Player');
      snapshotAll();
      broadcastRoomEvent(room, 'join');
      writeJson(res, 200, session);
      return;
    }

    if (!payload.playerId || !payload.sessionToken) {
      writeJson(res, 400, { error: 'invalid_payload' });
      return;
    }

    const playerId = payload.playerId as PlayerId;

    if (operation === 'reconnect') {
      const session = reconnectRoom(room, playerId, payload.sessionToken, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'reconnect');
      writeJson(res, 200, session);
      return;
    }

    if (operation === 'start') {
      startRoom(room, playerId, payload.sessionToken, payload.seed, payload.expectedRevision, payload.checkpointId);
      snapshotAll();
      broadcastRoomEvent(room, payload.checkpointId ? 'start_from_checkpoint' : 'start');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'leave') {
      leaveRoom(room, playerId, payload.sessionToken, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'leave');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'pause') {
      pauseRoom(room, playerId, payload.sessionToken, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'pause');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'resume') {
      resumeRoom(room, playerId, payload.sessionToken, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'resume');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'undo') {
      undoRoomAction(room, playerId, payload.sessionToken, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'undo');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'reset-turn') {
      resetTurnRoomActions(room, playerId, payload.sessionToken, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'reset_turn');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'action') {
      if (!payload.action) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      applyRoomAction(room, playerId, payload.sessionToken, payload.action, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'action');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'ready') {
      if (typeof payload.ready !== 'boolean') {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      setRoomReady(room, playerId, payload.sessionToken, payload.ready, payload.expectedRevision);
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
      const reaction = payload.reaction;
      if (!reaction || !ROOM_REACTION_OPTIONS.includes(reaction)) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      sendRoomReaction(room, playerId, payload.sessionToken, reaction, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'reaction');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'chat') {
      if (typeof payload.text !== 'string' || payload.text.trim().length === 0) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      sendRoomChat(room, playerId, payload.sessionToken, payload.text, payload.expectedRevision);
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
      setRoomTyping(room, playerId, payload.sessionToken, payload.typing, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'typing');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'checkpoints' && checkpointOperation === 'save') {
      if (!payload.name) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      const checkpoint = saveRoomCheckpoint(room, playerId, payload.sessionToken, payload.name, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'checkpoint_saved');
      writeJson(res, 200, { checkpoint });
      return;
    }

    if (operation === 'checkpoints' && checkpointOperation === 'load') {
      if (!payload.checkpointId) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      loadRoomCheckpoint(room, playerId, payload.sessionToken, payload.checkpointId, payload.expectedRevision);
      snapshotAll();
      broadcastRoomEvent(room, 'checkpoint_loaded');
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'checkpoints' && checkpointOperation === 'delete') {
      if (!payload.checkpointId) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      deleteRoomCheckpoint(room, playerId, payload.sessionToken, payload.checkpointId, payload.expectedRevision);
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
