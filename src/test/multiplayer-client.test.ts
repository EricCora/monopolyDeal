import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyMultiplayerAction,
  getSocketProbeCooldownRemainingMs,
  isLanResolvableHost,
  listMultiplayerLanOrigins,
  multiplayerErrorMessage,
  reconnectMultiplayerRoom,
  resetMultiplayerTransportState,
  runWithTransportFallback,
  SOCKET_PROBE_COOLDOWN_MS,
  resolveMultiplayerApiBase,
} from '../network/multiplayerClient';

describe('resolveMultiplayerApiBase', () => {
  it('prefers env url over host/origin', () => {
    expect(resolveMultiplayerApiBase({
      envUrl: 'https://api.example.com/',
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    })).toBe('https://api.example.com');
  });

  it('uses localhost server for localhost hostname when env is empty', () => {
    expect(resolveMultiplayerApiBase({
      envUrl: '',
      hostname: 'localhost',
      origin: 'http://localhost:5173',
    })).toBe('http://localhost:8787');
  });

  it('uses localhost server for 127.0.0.1 hostname', () => {
    expect(resolveMultiplayerApiBase({
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:5173',
    })).toBe('http://localhost:8787');
  });

  it('uses localhost server for ::1 hostname', () => {
    expect(resolveMultiplayerApiBase({
      hostname: '::1',
      origin: 'http://[::1]:5173',
    })).toBe('http://localhost:8787');
  });

  it('uses origin for non-local hosts without env override', () => {
    expect(resolveMultiplayerApiBase({
      hostname: 'play.example.com',
      origin: 'https://play.example.com/',
    })).toBe('https://play.example.com');
  });

  it('falls back to localhost server without browser context', () => {
    expect(resolveMultiplayerApiBase({})).toBe('http://localhost:8787');
  });
});

describe('multiplayerErrorMessage', () => {
  it('maps revision conflict to refresh guidance', () => {
    expect(multiplayerErrorMessage('revision_conflict')).toMatch(/refresh/i);
  });

  it('maps room paused for user clarity', () => {
    expect(multiplayerErrorMessage('room_paused')).toMatch(/paused/i);
  });

  it('maps room started to reconnect guidance', () => {
    expect(multiplayerErrorMessage('room_started')).toMatch(/reconnect/i);
  });
});

describe('isLanResolvableHost', () => {
  it('returns false for localhost aliases', () => {
    expect(isLanResolvableHost('localhost')).toBe(false);
    expect(isLanResolvableHost('127.0.0.1')).toBe(false);
  });

  it('returns true for private LAN IPs and .local hosts', () => {
    expect(isLanResolvableHost('192.168.1.20')).toBe(true);
    expect(isLanResolvableHost('10.0.0.25')).toBe(true);
    expect(isLanResolvableHost('eric-macbook.local')).toBe(true);
  });
});

describe('listMultiplayerLanOrigins', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns LAN origins from dev endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ origins: ['http://192.168.86.243:5173'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await expect(listMultiplayerLanOrigins('http://localhost:8787', 5173)).resolves.toEqual(['http://192.168.86.243:5173']);
  });
});

describe('reconnectMultiplayerRoom response compatibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts legacy reconnect response shape', async () => {
    const session = {
      version: 1 as const,
      roomCode: 'ABCDE',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      playerName: 'Host',
      reconnectDeadlineMs: Date.now() + 30_000,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        roomCode: 'ABCDE',
        seatId: 'p1',
        resumeToken: 'token-1',
        playerId: 'p1',
        sessionToken: 'token-1',
        reconnectDeadlineMs: Date.now() + 30_000,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await reconnectMultiplayerRoom(session, 'http://localhost:8787', 7);
    expect('status' in response).toBe(false);
    expect(response.roomCode).toBe('ABCDE');
  });

  it('accepts handshake reconnect response shape with snapshot', async () => {
    const now = Date.now();
    const session = {
      version: 1 as const,
      roomCode: 'ABCDE',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      playerName: 'Host',
      reconnectDeadlineMs: now + 30_000,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        status: 'ok',
        roomCode: 'ABCDE',
        seatId: 'p1',
        resumeToken: 'token-1',
        playerId: 'p1',
        sessionToken: 'token-1',
        reconnectDeadlineMs: now + 30_000,
        requiresFullResync: true,
        serverStateVersion: 3,
        snapshot: {
          roomCode: 'ABCDE',
          status: 'lobby',
          started: false,
          hostPlayerId: 'p1',
          yourPlayerId: 'p1',
          players: [],
          legalActions: [],
          paused: false,
          revision: 3,
          turnSnapshotCount: 0,
          checkpointSlots: [],
          canStart: true,
          reconnectDeadlineMs: now + 30_000,
          serverTime: now,
          activityFeed: [],
          chatMessages: [],
          typingPlayerIds: [],
          lastEventId: 3,
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await reconnectMultiplayerRoom(session, 'http://localhost:8787', 7);
    expect('status' in response).toBe(true);
    if ('status' in response) {
      expect(response.status).toBe('ok');
      expect(response.snapshot?.revision).toBe(3);
    }
  });
});

describe('applyMultiplayerAction action_rejected error details', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('surfaces structured rejection details for stale-state recovery', async () => {
    const session = {
      version: 1 as const,
      roomCode: 'ABCDE',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      playerName: 'Host',
      reconnectDeadlineMs: Date.now() + 30_000,
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        error: 'action_rejected',
        reason: 'stale_state',
        serverStateVersion: 12,
        requiresResync: true,
      }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(applyMultiplayerAction(session, { type: 'draw_cards', playerId: 'p1' }, 'http://localhost:8787'))
      .rejects
      .toMatchObject({
        message: 'action_rejected',
        details: {
          reason: 'stale_state',
          serverStateVersion: 12,
          requiresResync: true,
        },
      });
  });
});

describe('transport fallback cooldown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-23T10:00:00.000Z'));
    resetMultiplayerTransportState();
  });

  afterEach(() => {
    resetMultiplayerTransportState();
    vi.useRealTimers();
  });

  it('enters cooldown after transport failure and skips repeated socket attempts during cooldown', async () => {
    let socketCalls = 0;
    let httpCalls = 0;
    const runSocket = async () => {
      socketCalls += 1;
      const error = new Error('request_failed') as Error & { transportFailure?: boolean };
      error.transportFailure = true;
      throw error;
    };
    const runHttp = async () => {
      httpCalls += 1;
      return 'ok';
    };

    await expect(runWithTransportFallback(runSocket, runHttp, { ignoreTransportGate: true })).resolves.toBe('ok');
    expect(socketCalls).toBe(1);
    expect(httpCalls).toBe(1);
    expect(getSocketProbeCooldownRemainingMs()).toBeGreaterThan(0);

    await expect(runWithTransportFallback(runSocket, runHttp)).resolves.toBe('ok');
    expect(socketCalls).toBe(1);
    expect(httpCalls).toBe(2);
  });

  it('allows probe retry after cooldown expiry and restores socket-first path on success', async () => {
    let socketCalls = 0;
    let httpCalls = 0;
    let failSocket = true;
    const runSocket = async () => {
      socketCalls += 1;
      if (failSocket) {
        const error = new Error('request_failed') as Error & { transportFailure?: boolean };
        error.transportFailure = true;
        throw error;
      }
      return 'socket_ok';
    };
    const runHttp = async () => {
      httpCalls += 1;
      return 'http_ok';
    };

    await expect(runWithTransportFallback(runSocket, runHttp, { ignoreTransportGate: true })).resolves.toBe('http_ok');
    expect(socketCalls).toBe(1);
    expect(httpCalls).toBe(1);

    vi.advanceTimersByTime(SOCKET_PROBE_COOLDOWN_MS + 1);
    failSocket = false;
    await expect(runWithTransportFallback(runSocket, runHttp, { ignoreTransportGate: true })).resolves.toBe('socket_ok');
    expect(socketCalls).toBe(2);
    expect(httpCalls).toBe(1);
    expect(getSocketProbeCooldownRemainingMs()).toBe(0);

    await expect(runWithTransportFallback(runSocket, runHttp, { ignoreTransportGate: true })).resolves.toBe('socket_ok');
    expect(socketCalls).toBe(3);
    expect(httpCalls).toBe(1);
  });
});
