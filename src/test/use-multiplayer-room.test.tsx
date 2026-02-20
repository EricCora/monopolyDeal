import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMultiplayerRoom } from '../app/useMultiplayerRoom';
import type { MultiplayerRoomView } from '../network/multiplayerTypes';

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

function makeSessionResponse(overrides: Partial<{ roomCode: string; playerId: string; sessionToken: string; reconnectDeadlineMs: number }> = {}) {
  return {
    roomCode: 'ABCDE',
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
});
