import { createServer } from 'node:http';
import { parse } from 'node:url';
import {
  applyRoomAction,
  createRoom,
  joinRoom,
  leaveRoom,
  pruneInactiveRooms,
  reconnectRoom,
  roomView,
  startRoom,
  type MultiplayerRoom,
} from './gameService.ts';
import { loadSnapshots, saveSnapshots } from './persistence/snapshots.ts';
import type { Action } from '../../../src/engine/index.ts';

const PORT = Number(process.env.PORT ?? 8787);
const rooms = new Map<string, MultiplayerRoom>();

for (const room of loadSnapshots()) {
  rooms.set(room.code, room);
}

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
      writeJson(res, 200, { ok: true });
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

    const match = path.match(/^\/api\/multiplayer\/rooms\/([^/]+)\/(join|reconnect|start|action|leave|state)$/);
    if (!match) {
      writeJson(res, 404, { error: 'not_found' });
      return;
    }

    const roomCode = decodeURIComponent(match[1]).toUpperCase();
    const operation = match[2];
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
      const view = roomView(room, playerId, sessionToken);
      snapshotAll();
      writeJson(res, 200, view);
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
    };

    if (operation === 'join') {
      const session = joinRoom(room, payload.playerName ?? 'Player');
      snapshotAll();
      writeJson(res, 200, session);
      return;
    }

    if (!payload.playerId || !payload.sessionToken) {
      writeJson(res, 400, { error: 'invalid_payload' });
      return;
    }

    if (operation === 'reconnect') {
      const session = reconnectRoom(room, payload.playerId, payload.sessionToken);
      snapshotAll();
      writeJson(res, 200, session);
      return;
    }

    if (operation === 'start') {
      startRoom(room, payload.playerId, payload.sessionToken, payload.seed);
      snapshotAll();
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'leave') {
      leaveRoom(room, payload.playerId, payload.sessionToken);
      snapshotAll();
      writeJson(res, 200, { ok: true });
      return;
    }

    if (operation === 'action') {
      if (!payload.action) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      applyRoomAction(room, payload.playerId, payload.sessionToken, payload.action);
      snapshotAll();
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
