import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeReconnectDelayMs, mapConnectionUiState, useMultiplayerRoom } from '../app/useMultiplayerRoom';
import type { MultiplayerResumeRoomResponse, MultiplayerRoomView } from '../network/multiplayerTypes';

const clientMocks = vi.hoisted(() => ({
  applyMultiplayerAction: vi.fn(async () => undefined),
  checkMultiplayerHealth: vi.fn(async () => true),
  createMultiplayerRoom: vi.fn(),
  deleteMultiplayerCheckpoint: vi.fn(async () => undefined),
  getMultiplayerApiBase: vi.fn(() => 'http://localhost:8787'),
  joinMultiplayerRoom: vi.fn(async () => {
    throw new Error('not_implemented');
  }),
  leaveMultiplayerRoom: vi.fn(async () => undefined),
  listMultiplayerCheckpoints: vi.fn(async () => []),
  loadMultiplayerCheckpoint: vi.fn(async () => undefined),
  loadMultiplayerRoomState: vi.fn(),
  multiplayerErrorMessage: vi.fn((code: string) => code),
  pauseMultiplayerRoom: vi.fn(async () => undefined),
  reconnectMultiplayerRoom: vi.fn(),
  resetMultiplayerRoomTurn: vi.fn(async () => undefined),
  resumeMultiplayerRoom: vi.fn(async () => undefined),
  saveMultiplayerCheckpoint: vi.fn(async () => ({ id: 'cp1', name: 'Checkpoint', savedAt: Date.now() })),
  sendMultiplayerChatMessage: vi.fn(async () => undefined),
  sendMultiplayerReaction: vi.fn(async () => undefined),
  setMultiplayerTyping: vi.fn(async () => undefined),
  setMultiplayerReady: vi.fn(async () => undefined),
  startMultiplayerRoom: vi.fn(async () => undefined),
  subscribeMultiplayerRoomEvents: vi.fn(),
  undoMultiplayerRoomAction: vi.fn(async () => undefined),
}));

vi.mock('../network/multiplayerClient', () => ({
  applyMultiplayerAction: clientMocks.applyMultiplayerAction,
  checkMultiplayerHealth: clientMocks.checkMultiplayerHealth,
  createMultiplayerRoom: clientMocks.createMultiplayerRoom,
  deleteMultiplayerCheckpoint: clientMocks.deleteMultiplayerCheckpoint,
  getMultiplayerApiBase: clientMocks.getMultiplayerApiBase,
  joinMultiplayerRoom: clientMocks.joinMultiplayerRoom,
  leaveMultiplayerRoom: clientMocks.leaveMultiplayerRoom,
  listMultiplayerCheckpoints: clientMocks.listMultiplayerCheckpoints,
  loadMultiplayerCheckpoint: clientMocks.loadMultiplayerCheckpoint,
  loadMultiplayerRoomState: clientMocks.loadMultiplayerRoomState,
  multiplayerErrorMessage: clientMocks.multiplayerErrorMessage,
  pauseMultiplayerRoom: clientMocks.pauseMultiplayerRoom,
  reconnectMultiplayerRoom: clientMocks.reconnectMultiplayerRoom,
  resetMultiplayerRoomTurn: clientMocks.resetMultiplayerRoomTurn,
  resumeMultiplayerRoom: clientMocks.resumeMultiplayerRoom,
  saveMultiplayerCheckpoint: clientMocks.saveMultiplayerCheckpoint,
  sendMultiplayerChatMessage: clientMocks.sendMultiplayerChatMessage,
  sendMultiplayerReaction: clientMocks.sendMultiplayerReaction,
  setMultiplayerTyping: clientMocks.setMultiplayerTyping,
  setMultiplayerReady: clientMocks.setMultiplayerReady,
  startMultiplayerRoom: clientMocks.startMultiplayerRoom,
  subscribeMultiplayerRoomEvents: clientMocks.subscribeMultiplayerRoomEvents,
  undoMultiplayerRoomAction: clientMocks.undoMultiplayerRoomAction,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(times = 3): Promise<void> {
  await act(async () => {
    for (let index = 0; index < times; index += 1) {
      await Promise.resolve();
    }
  });
}

async function advanceAndFlush(ms: number, flushCount = 4): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await flushMicrotasks(flushCount);
}

function makeSessionResponse(overrides: Partial<{ roomCode: string; playerId: string; sessionToken: string; reconnectDeadlineMs: number }> = {}) {
  return {
    roomCode: 'ABCDE',
    seatId: 'p1',
    resumeToken: 'token-1',
    playerId: 'p1',
    sessionToken: 'token-1',
    reconnectDeadlineMs: Date.now() + 30_000,
    ...overrides,
  };
}

function makeRoomView(revision = 1): MultiplayerRoomView {
  const now = Date.now();
  return {
    roomCode: 'ABCDE',
    status: 'lobby',
    started: false,
    hostPlayerId: 'p1',
    yourPlayerId: 'p1',
    players: [
      {
        id: 'p1',
        name: 'Host',
        handCount: 0,
        bankCount: 0,
        completeSets: 0,
        connected: true,
        lastSeenAt: now,
        reconnectDeadlineMs: now + 30_000,
        isHost: true,
        ready: false,
      },
      {
        id: 'p2',
        name: 'Guest',
        handCount: 0,
        bankCount: 0,
        completeSets: 0,
        connected: true,
        lastSeenAt: now,
        reconnectDeadlineMs: now + 30_000,
        isHost: false,
        ready: false,
      },
    ],
    promptPlayerId: undefined,
    legalActions: [],
    gameState: undefined,
    paused: false,
    pausedByPlayerId: undefined,
    revision,
    turnSnapshotCount: 0,
    checkpointSlots: [],
    canStart: true,
    reconnectDeadlineMs: now + 30_000,
    serverTime: now,
    activityFeed: [],
    chatMessages: [],
    typingPlayerIds: [],
    lastEventId: revision,
  };
}

function makeResumeResponse(
  status: MultiplayerResumeRoomResponse['status'],
  overrides: Partial<MultiplayerResumeRoomResponse> = {},
): MultiplayerResumeRoomResponse {
  const snapshot = makeRoomView(3);
  return {
    status,
    roomCode: 'ABCDE',
    seatId: 'p1',
    resumeToken: 'token-1',
    playerId: 'p1',
    sessionToken: 'token-1',
    reconnectDeadlineMs: Date.now() + 30_000,
    requiresFullResync: status === 'ok',
    serverStateVersion: snapshot.revision,
    snapshot: status === 'ok' ? snapshot : undefined,
    ...overrides,
  };
}

describe('useMultiplayerRoom reconnect + sync behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    clientMocks.multiplayerErrorMessage.mockImplementation((code: string) => code);
    clientMocks.createMultiplayerRoom.mockResolvedValue(makeSessionResponse());
    clientMocks.reconnectMultiplayerRoom.mockResolvedValue(makeSessionResponse());
    clientMocks.loadMultiplayerRoomState.mockResolvedValue(makeRoomView(1));
    clientMocks.subscribeMultiplayerRoomEvents.mockReturnValue({ close: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('switches to fallback push mode and emits fallback metric only once per session', async () => {
    vi.useFakeTimers();
    const onMetricEvent = vi.fn();
    let disconnectHandler: (() => void) | null = null;
    let openHandler: (() => void) | null = null;

    clientMocks.subscribeMultiplayerRoomEvents.mockImplementation((_session, handlers) => {
      disconnectHandler = handlers.onDisconnect ?? null;
      openHandler = handlers.onOpen ?? null;
      return { close: vi.fn() };
    });

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: true,
      pollIntervalMs: 50,
      onMetricEvent,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    expect(clientMocks.subscribeMultiplayerRoomEvents).toHaveBeenCalledTimes(1);
    act(() => {
      openHandler?.();
    });
    expect(result.current.pushState).toBe('connected');

    act(() => {
      disconnectHandler?.();
      disconnectHandler?.();
    });
    expect(result.current.pushState).toBe('fallback');

    const fallbackCount = onMetricEvent.mock.calls.filter(([event]) => event === 'multiplayer_push_fallback').length;
    expect(fallbackCount).toBe(1);

    const refreshCountBeforeTick = clientMocks.loadMultiplayerRoomState.mock.calls.length;
    await act(async () => {
      vi.advanceTimersByTime(120);
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(clientMocks.loadMultiplayerRoomState.mock.calls.length).toBeGreaterThan(refreshCountBeforeTick);
  });

  it('keeps reconnect single-flight during repeated poll failures', async () => {
    vi.useFakeTimers();
    const reconnectPending = deferred<ReturnType<typeof makeSessionResponse>>();
    let failRefresh = false;
    let revision = 1;

    clientMocks.loadMultiplayerRoomState.mockImplementation(async () => {
      if (failRefresh) throw new Error('request_failed');
      revision += 1;
      return makeRoomView(revision);
    });
    clientMocks.reconnectMultiplayerRoom.mockImplementation(() => reconnectPending.promise);

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      pollIntervalMs: 40,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    failRefresh = true;
    await act(async () => {
      vi.advanceTimersByTime(220);
      await Promise.resolve();
    });
    await flushMicrotasks();
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(1);
    expect(result.current.connectionState).toBe('reconnecting');

    failRefresh = false;
    await act(async () => {
      reconnectPending.resolve(makeSessionResponse({ reconnectDeadlineMs: Date.now() + 60_000 }));
      await Promise.resolve();
    });
    await flushMicrotasks(5);
    expect(result.current.connectionState).toBe('connected');
  });

  it('migrates legacy stored session shape to canonical seat credentials on bootstrap reconnect', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'ABCDE',
      playerId: 'p1',
      sessionToken: 'legacy-token',
      playerName: 'Host',
      reconnectDeadlineMs: now + 30_000,
    }));
    clientMocks.reconnectMultiplayerRoom.mockResolvedValue(makeSessionResponse({
      playerId: 'p1',
      sessionToken: 'legacy-token',
    }));

    renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      reconnectV1Enabled: true,
    }));

    await advanceAndFlush(0, 6);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalled();
    const reconnectArgs = clientMocks.reconnectMultiplayerRoom.mock.calls[0] ?? [];
    expect(reconnectArgs[0]).toMatchObject({
      seatId: 'p1',
      resumeToken: 'legacy-token',
      playerId: 'p1',
      sessionToken: 'legacy-token',
    });
    expect(reconnectArgs[3]).toBe(true);
  });

  it('hydrates from reconnect handshake snapshot without issuing extra /state fetch', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'ABCDE',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      playerName: 'Host',
      reconnectDeadlineMs: now + 30_000,
    }));
    clientMocks.loadMultiplayerRoomState.mockClear();
    clientMocks.reconnectMultiplayerRoom.mockResolvedValue(makeResumeResponse('ok'));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      reconnectV1Enabled: true,
      reconnectV1UiEnabled: true,
    }));

    await advanceAndFlush(0, 6);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(1);
    expect(clientMocks.loadMultiplayerRoomState).not.toHaveBeenCalled();
    expect(result.current.connectionState).toBe('connected');
    expect(result.current.roomView?.revision).toBe(3);
  });

  it('maps seat_timed_out handshake status to timed_out recovery path', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'ABCDE',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      playerName: 'Host',
      reconnectDeadlineMs: now + 30_000,
    }));
    clientMocks.reconnectMultiplayerRoom.mockResolvedValue(makeResumeResponse('seat_timed_out', {
      requiresFullResync: false,
      snapshot: undefined,
    }));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      reconnectV1Enabled: true,
      reconnectV1UiEnabled: true,
    }));

    await advanceAndFlush(0, 6);
    expect(result.current.connectionUiState).toBe('timed_out');
    expect(result.current.recoveryNotice?.reason).toBe('reconnect_expired');
  });

  it('maps room_closed handshake status to room_ended recovery path', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'ABCDE',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      playerName: 'Host',
      reconnectDeadlineMs: now + 30_000,
    }));
    clientMocks.reconnectMultiplayerRoom.mockResolvedValue(makeResumeResponse('room_closed', {
      requiresFullResync: false,
      snapshot: undefined,
    }));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      reconnectV1Enabled: true,
      reconnectV1UiEnabled: true,
    }));

    await advanceAndFlush(0, 6);
    expect(result.current.connectionUiState).toBe('room_ended');
    expect(result.current.recoveryNotice?.reason).toBe('room_not_found');
  });

  it('maps invalid_token and protocol_mismatch handshake statuses to resume_failed', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'ABCDE',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      playerName: 'Host',
      reconnectDeadlineMs: now + 30_000,
    }));
    clientMocks.reconnectMultiplayerRoom.mockResolvedValueOnce(makeResumeResponse('invalid_token', {
      requiresFullResync: false,
      snapshot: undefined,
    }));

    const invalid = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      reconnectV1Enabled: true,
      reconnectV1UiEnabled: true,
    }));
    await advanceAndFlush(0, 6);
    expect(invalid.result.current.connectionUiState).toBe('resume_failed');
    invalid.unmount();

    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'ABCDE',
      seatId: 'p1',
      resumeToken: 'token-1',
      playerId: 'p1',
      sessionToken: 'token-1',
      playerName: 'Host',
      reconnectDeadlineMs: now + 30_000,
    }));
    clientMocks.reconnectMultiplayerRoom.mockResolvedValueOnce(makeResumeResponse('protocol_mismatch', {
      requiresFullResync: false,
      snapshot: undefined,
    }));
    const mismatch = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      reconnectV1Enabled: true,
      reconnectV1UiEnabled: true,
    }));
    await advanceAndFlush(0, 6);
    expect(mismatch.result.current.connectionUiState).toBe('resume_failed');
    mismatch.unmount();
  });

  it('uses bounded reconnect-v1 backoff cadence with single-loop guard', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    let failRefresh = false;
    let revision = 1;

    clientMocks.loadMultiplayerRoomState.mockImplementation(async () => {
      if (failRefresh) throw new Error('request_failed');
      revision += 1;
      return makeRoomView(revision);
    });
    clientMocks.reconnectMultiplayerRoom.mockRejectedValue(new Error('request_failed'));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      pollIntervalMs: 40,
      reconnectV1Enabled: true,
      reconnectV1UiEnabled: true,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    failRefresh = true;
    await advanceAndFlush(40);
    await advanceAndFlush(0);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(1);
    expect(result.current.connectionState).toBe('reconnecting');
    expect(['reconnecting_attempting', 'reconnect_handshake_pending']).toContain(result.current.connectionUiState);

    await advanceAndFlush(499);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(1);

    await advanceAndFlush(1);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(2);

    await advanceAndFlush(1_000);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(3);

    await advanceAndFlush(2_000);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(4);
    randomSpy.mockRestore();
  });

  it('enters terminal resume_failed state after reconnect-v1 budget exhaustion', async () => {
    vi.useFakeTimers();
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const onMetricEvent = vi.fn();
    let failRefresh = false;
    let revision = 1;

    clientMocks.loadMultiplayerRoomState.mockImplementation(async () => {
      if (failRefresh) throw new Error('request_failed');
      revision += 1;
      return makeRoomView(revision);
    });
    clientMocks.reconnectMultiplayerRoom.mockRejectedValue(new Error('request_failed'));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      pollIntervalMs: 40,
      reconnectV1Enabled: true,
      reconnectV1UiEnabled: true,
      onMetricEvent,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    failRefresh = true;
    await advanceAndFlush(40);
    await advanceAndFlush(0);
    await advanceAndFlush(31_500, 8);

    expect(result.current.connectionState).toBe('disconnected');
    expect(result.current.connectionUiState).toBe('resume_failed');
    const reconnectFailedEvents = onMetricEvent.mock.calls
      .filter(([event]) => event === 'multiplayer_reconnect_failed');
    expect(reconnectFailedEvents).toHaveLength(1);

    await advanceAndFlush(5_000, 6);
    const reconnectCallsAfterSettle = clientMocks.reconnectMultiplayerRoom.mock.calls.length;
    await advanceAndFlush(5_000, 6);
    expect(clientMocks.reconnectMultiplayerRoom.mock.calls.length).toBe(reconnectCallsAfterSettle);
    randomSpy.mockRestore();
  });
});

describe('mapConnectionUiState', () => {
  it('maps transport/error states to reconnect ui states', () => {
    expect(mapConnectionUiState('connected', null)).toBe('connected');
    expect(mapConnectionUiState('reconnecting', null)).toBe('reconnecting_attempting');
    expect(mapConnectionUiState('disconnected', null)).toBe('resume_failed');
    expect(mapConnectionUiState('connecting', null)).toBe('reconnect_handshake_pending');
    expect(mapConnectionUiState('connected', 'reconnect_expired')).toBe('timed_out');
    expect(mapConnectionUiState('connected', 'seat_timed_out')).toBe('timed_out');
    expect(mapConnectionUiState('connected', 'room_not_found')).toBe('room_ended');
    expect(mapConnectionUiState('connected', 'room_closed')).toBe('room_ended');
    expect(mapConnectionUiState('connected', 'invalid_token')).toBe('resume_failed');
    expect(mapConnectionUiState('connected', 'protocol_mismatch')).toBe('resume_failed');
  });
});

describe('computeReconnectDelayMs', () => {
  it('returns immediate first-attempt and capped exponential delays with jitter', () => {
    expect(computeReconnectDelayMs(1, () => 0.5)).toBe(0);
    expect(computeReconnectDelayMs(2, () => 0.5)).toBe(500);
    expect(computeReconnectDelayMs(3, () => 0.5)).toBe(1_000);
    expect(computeReconnectDelayMs(4, () => 0.5)).toBe(2_000);
    expect(computeReconnectDelayMs(5, () => 0.5)).toBe(4_000);
    expect(computeReconnectDelayMs(6, () => 0.5)).toBe(8_000);
    expect(computeReconnectDelayMs(7, () => 0.5)).toBe(8_000);
    expect(computeReconnectDelayMs(3, () => 0)).toBe(800);
    expect(computeReconnectDelayMs(3, () => 1)).toBe(1_200);
  });
});
