import { createServer } from 'node:http';
import { parse } from 'node:url';
import { applyRoomAction, createRoom, joinRoom, roomView, startRoom, type LanRoom } from './gameService';
import { loadSnapshots, saveSnapshots } from './persistence/snapshots';
import type { Action } from '../../../src/engine';

const PORT = Number(process.env.PORT ?? 8787);
const rooms = new Map<string, LanRoom>();

for (const room of loadSnapshots()) {
  rooms.set(room.code, room);
}

function writeJson(res: { writeHead: (code: number, headers: Record<string, string>) => void; end: (body: string) => void }, code: number, payload: unknown): void {
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

  try {
    if (req.method === 'POST' && path === '/api/rooms/create') {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw || '{}') as { playerName?: string };
      const created = createRoom(rooms, payload.playerName ?? 'Host');
      snapshotAll();
      writeJson(res, 200, { roomCode: created.room.code, playerId: created.playerId });
      return;
    }

    if (req.method === 'POST' && path === '/api/rooms/join') {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw || '{}') as { roomCode?: string; playerName?: string };
      const roomCode = payload.roomCode?.toUpperCase() ?? '';
      const room = rooms.get(roomCode);
      if (!room) {
        writeJson(res, 404, { error: 'room_not_found' });
        return;
      }
      const playerId = joinRoom(room, payload.playerName ?? 'Player');
      snapshotAll();
      writeJson(res, 200, { roomCode, playerId });
      return;
    }

    if (req.method === 'POST' && path === '/api/rooms/start') {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw || '{}') as { roomCode?: string; seed?: number };
      const roomCode = payload.roomCode?.toUpperCase() ?? '';
      const room = rooms.get(roomCode);
      if (!room) {
        writeJson(res, 404, { error: 'room_not_found' });
        return;
      }
      startRoom(room, payload.seed);
      snapshotAll();
      writeJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && path === '/api/rooms/action') {
      const raw = await collectBody(req);
      const payload = JSON.parse(raw || '{}') as { roomCode?: string; playerId?: string; action?: Action };
      const roomCode = payload.roomCode?.toUpperCase() ?? '';
      const room = rooms.get(roomCode);
      if (!room) {
        writeJson(res, 404, { error: 'room_not_found' });
        return;
      }
      if (!payload.playerId || !payload.action) {
        writeJson(res, 400, { error: 'invalid_payload' });
        return;
      }
      applyRoomAction(room, payload.playerId, payload.action);
      snapshotAll();
      writeJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && path === '/api/rooms/state') {
      const roomCode = String(parsed.query.roomCode ?? '').toUpperCase();
      const playerId = String(parsed.query.playerId ?? '');
      const room = rooms.get(roomCode);
      if (!room) {
        writeJson(res, 404, { error: 'room_not_found' });
        return;
      }
      if (!playerId) {
        writeJson(res, 400, { error: 'player_required' });
        return;
      }
      writeJson(res, 200, roomView(room, playerId));
      return;
    }

    writeJson(res, 404, { error: 'not_found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'server_error';
    writeJson(res, 400, { error: message });
  }
}).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`LAN server listening on http://0.0.0.0:${PORT}`);
});
