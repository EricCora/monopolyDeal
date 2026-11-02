import { spawn, type ChildProcess } from 'node:child_process';
import { io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PORT = 18791;
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(`${BASE}/api/multiplayer/health`)).ok;
  } catch {
    return false;
  }
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out');
}

async function hostRoom() {
  const response = await fetch(`${BASE}/api/multiplayer/rooms`, { method: 'POST', body: JSON.stringify({ playerName: 'Ann' }) });
  return await response.json() as { roomCode: string; playerId: string; sessionToken: string; resumeToken: string };
}

const BAD_ACTION = { type: 'pass_turn', playerId: 'p1' };

// Runs the real server process: a mistake here would otherwise only show up on the live one.
describe('a move the server rejects', () => {
  beforeAll(async () => {
    server = spawn('node', ['--import', 'tsx/esm', 'apps/server/src/index.ts'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: 'ignore',
    });
    await waitUntil(serverUp, 20_000);
  }, 30_000);

  afterAll(() => {
    server.kill();
  });

  it('gets an answer over a socket and leaves the server running', async () => {
    const session = await hostRoom();
    const socket = io(BASE, { transports: ['websocket'], auth: { roomCode: session.roomCode, playerId: session.playerId, sessionToken: session.sessionToken, resumeToken: session.resumeToken } });
    await new Promise<void>((resolve, reject) => {
      socket.once('mp:evt:connected', () => resolve());
      socket.once('connect_error', reject);
    });
    const answer = await socket.timeout(4_000).emitWithAck('mp:cmd:action', { action: BAD_ACTION }).catch(() => null);
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await serverUp()).toBe(true);
    expect(answer).toMatchObject({ ok: false });
  }, 15_000);

  it('gets an answer over a plain request and leaves the server running', async () => {
    const session = await hostRoom();
    const response = await fetch(`${BASE}/api/multiplayer/rooms/${session.roomCode}/action`, {
      method: 'POST',
      body: JSON.stringify({ playerId: session.playerId, sessionToken: session.sessionToken, action: BAD_ACTION }),
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(await serverUp()).toBe(true);
  }, 15_000);
});
