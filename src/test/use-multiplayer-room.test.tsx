import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeReconnectDelayMs, mapConnectionUiState, useMultiplayerRoom } from '../app/useMultiplayerRoom';
import { createGame, type GameState, type LegalAction } from '../engine';
import type { MultiplayerResumeRoomResponse, MultiplayerRoomView } from '../network/multiplayerTypes';

const clientMocks = vi.hoisted(() => ({
  applyMultiplayerAction: vi.fn(async () => undefined),
  checkMultiplayerHealth: vi.fn(async () => true),
  createMultiplayerRoom: vi.fn(),
  deleteMultiplayerCheckpoint: vi.fn(async () => undefined),
  disconnectMultiplayerSocketTransport: vi.fn(() => undefined),
  getMultiplayerApiBase: vi.fn(() => 'http://localhost:8787'),
  getMultiplayerTransportMode: vi.fn(() => 'http_fallback' as const),
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
  subscribeMultiplayerTransportMode: vi.fn((listener: (mode: 'socket_primary' | 'http_fallback') => void) => {
    listener('http_fallback');
    return () => undefined;
  }),
  subscribeMultiplayerRoomEvents: vi.fn(),
  undoMultiplayerRoomAction: vi.fn(async () => undefined),
}));

vi.mock('../network/multiplayerClient', () => ({
  applyMultiplayerAction: clientMocks.applyMultiplayerAction,
  checkMultiplayerHealth: clientMocks.checkMultiplayerHealth,
  createMultiplayerRoom: clientMocks.createMultiplayerRoom,
  deleteMultiplayerCheckpoint: clientMocks.deleteMultiplayerCheckpoint,
  disconnectMultiplayerSocketTransport: clientMocks.disconnectMultiplayerSocketTransport,
  getMultiplayerApiBase: clientMocks.getMultiplayerApiBase,
  getMultiplayerTransportMode: clientMocks.getMultiplayerTransportMode,
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
  subscribeMultiplayerTransportMode: clientMocks.subscribeMultiplayerTransportMode,
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

function makeRoomView(revision = 1, overrides: Partial<MultiplayerRoomView> = {}): MultiplayerRoomView {
  const now = Date.now();
  return {
    roomCode: 'ABCDE',
    status: 'lobby',
    started: false,
    presetId: 'standard',
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
    canRematch: false,
    reconnectDeadlineMs: now + 30_000,
    serverTime: now,
    activityFeed: [],
    chatMessages: [],
    typingPlayerIds: [],
    lastEventId: revision,
    ...overrides,
  };
}

function makeActionRoomView(revision = 1): MultiplayerRoomView {
  return {
    ...makeRoomView(revision),
    started: true,
    promptPlayerId: 'p1',
    legalActions: [
      {
        label: 'Draw cards',
        action: {
          type: 'draw_cards',
          playerId: 'p1',
        },
      },
    ],
  };
}

function makePromptSnapshot(
  promptKind: 'payment' | 'response' | 'selection' | 'discard',
  revision = 9,
): MultiplayerRoomView {
  const game: GameState = createGame({
    seed: 777,
    players: [
      { id: 'p1', name: 'Host' },
      { id: 'p2', name: 'Guest' },
    ],
  });
  game.currentPlayerIndex = 0;
  game.turn.phase = 'action';
  game.turn.playsUsed = 1;
  game.pending = null;

  let action: LegalAction = {
    label: 'Pass turn',
    action: { type: 'pass_turn' as const, playerId: 'p1' },
  };

  if (promptKind === 'payment') {
    game.pending = {
      kind: 'payment',
      payload: {
        sourcePlayerId: 'p2',
        targetPlayerId: 'p1',
        amount: 3,
        reason: 'rent',
        actionCardId: 'rent_color#r1',
      },
    };
    action = {
      label: 'Pay with $3',
      action: { type: 'pay_request', playerId: 'p1', cards: ['money_1#a1', 'money_2#a2'] },
    };
  } else if (promptKind === 'response') {
    game.pending = {
      kind: 'counter',
      payload: {
        sourcePlayerId: 'p2',
        targetPlayerId: 'p1',
        actionCardId: 'debt_collector#dc1',
        effect: {
          kind: 'payment',
          payload: {
            sourcePlayerId: 'p2',
            targetPlayerId: 'p1',
            amount: 5,
            reason: 'debt_collector',
            actionCardId: 'debt_collector#dc1',
          },
        },
        chain: [],
        awaitingPlayerId: 'p1',
      },
    };
    action = {
      label: 'No counter',
      action: { type: 'counter_response', playerId: 'p1', useJustSayNo: false },
    };
  } else if (promptKind === 'selection') {
    game.pending = {
      kind: 'forced_deal',
      payload: {
        sourcePlayerId: 'p1',
        targetPlayerId: 'p2',
        actionCardId: 'forced_deal#fd1',
      },
    };
    action = {
      label: 'Trade property',
      action: {
        type: 'forced_deal_pick',
        playerId: 'p1',
        giveCardId: 'brown_1#b1',
        giveColor: 'brown',
        takeCardId: 'light_blue_1#l1',
        takeColor: 'light_blue',
        destinationColor: 'light_blue',
      },
    };
  } else if (promptKind === 'discard') {
    game.turn.phase = 'finished';
    game.players[0].hand = [
      'money_1#d1',
      'money_1#d2',
      'money_2#d3',
      'money_3#d4',
      'pass_go#d5',
      'rent_color#d6',
      'debt_collector#d7',
      'house#d8',
    ];
    action = {
      label: 'Discard $1',
      action: { type: 'discard_card', playerId: 'p1', cardId: 'money_1#d1' },
    };
  }

  return makeRoomView(revision, {
    status: 'active',
    started: true,
    promptPlayerId: 'p1',
    gameState: game,
    legalActions: [action],
  });
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
    window.history.pushState({}, '', '/');
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

  it('does not send an explicit leave during browser unload refresh', async () => {
    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: true,
      pollIntervalMs: 50,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });

    expect(clientMocks.leaveMultiplayerRoom).not.toHaveBeenCalled();
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

  it('falls back to polling when push stream never opens within bootstrap timeout', async () => {
    vi.useFakeTimers();
    const onMetricEvent = vi.fn();
    clientMocks.subscribeMultiplayerRoomEvents.mockReturnValue({ close: vi.fn() });

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: true,
      pollIntervalMs: 40,
      onMetricEvent,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();
    expect(result.current.pushState).toBe('connecting');

    await advanceAndFlush(5_100, 5);
    expect(result.current.pushState).toBe('fallback');

    const fallbackEvents = onMetricEvent.mock.calls.filter(([event]) => event === 'multiplayer_push_fallback');
    expect(fallbackEvents).toHaveLength(1);
  });

  it('treats first push event as connected even if onOpen is delayed', async () => {
    vi.useFakeTimers();
    const onMetricEvent = vi.fn();
    let onEventHandler: ((event: { eventId: number; revision: number }) => void) | null = null;

    clientMocks.subscribeMultiplayerRoomEvents.mockImplementation((_session, handlers) => {
      onEventHandler = handlers.onEvent as ((event: { eventId: number; revision: number }) => void);
      return { close: vi.fn() };
    });

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: true,
      pollIntervalMs: 40,
      onMetricEvent,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    expect(result.current.pushState).toBe('connecting');

    await act(async () => {
      onEventHandler?.({
        eventId: 0,
        revision: 0,
      });
      await Promise.resolve();
    });

    expect(result.current.pushState).toBe('connected');
    const fallbackEvents = onMetricEvent.mock.calls.filter(([event]) => event === 'multiplayer_push_fallback');
    expect(fallbackEvents).toHaveLength(0);
    const connectedEvents = onMetricEvent.mock.calls.filter(([event]) => event === 'multiplayer_push_connected');
    expect(connectedEvents).toHaveLength(1);
  });

  it('maps ended_timeout room runtime state to room_ended ui state', async () => {
    vi.useFakeTimers();
    clientMocks.loadMultiplayerRoomState.mockResolvedValue(
      makeRoomView(2, {
        started: true,
        roomRuntimeState: 'ended_timeout',
        endedReason: 'host_timeout',
      }),
    );

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    expect(result.current.connectionUiState).toBe('room_ended');
  });

  it('exposes reconnect diagnostics and updates client/server revision markers', async () => {
    vi.useFakeTimers();
    clientMocks.loadMultiplayerRoomState.mockResolvedValue(makeActionRoomView(7));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    expect(result.current.reconnectDiagnostics.roomCode).toBe('ABCDE');
    expect(result.current.reconnectDiagnostics.seatId).toBe('p1');
    expect(result.current.reconnectDiagnostics.lastServerVersion).toBe(7);
    expect(result.current.reconnectDiagnostics.lastReconnectError).toBeNull();

    await act(async () => {
      await result.current.runAction(0);
    });
    await flushMicrotasks();
    expect(result.current.reconnectDiagnostics.lastClientVersion).toBe(7);
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
    expect(reconnectArgs).toHaveLength(3);
  });

  it('does not auto-reconnect a stored session when the app was opened from an explicit join link', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    window.history.pushState({}, '', '/join/ABCDE');
    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'ZZZZZ',
      seatId: 'p9',
      resumeToken: 'token-9',
      playerId: 'p9',
      sessionToken: 'token-9',
      playerName: 'Existing Player',
      reconnectDeadlineMs: now + 30_000,
    }));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await advanceAndFlush(0, 4);
    expect(clientMocks.reconnectMultiplayerRoom).not.toHaveBeenCalled();
    expect(result.current.session).toBeNull();
    expect(result.current.joinCode).toBe('');
  });

  it('exposes a recovery entry from the registry and resumes it on demand', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    window.history.pushState({}, '', '/join/ABCDE');
    localStorage.setItem('monopolyDeal.multiplayerRecovery.v1', JSON.stringify({
      version: 1,
      entries: [{
        roomCode: 'ABCDE',
        playerName: 'Guest',
        seatId: 'p2',
        resumeToken: 'token-2',
        playerId: 'p2',
        sessionToken: 'token-2',
        reconnectDeadlineMs: now + 30_000,
        lastKnownStatus: 'active',
        lastKnownRuntimeState: 'paused_disconnect',
        recoveryState: 'resumable',
        lastSeenAt: now,
      }],
    }));
    clientMocks.reconnectMultiplayerRoom.mockResolvedValue(makeResumeResponse('ok', {
      playerId: 'p2',
      seatId: 'p2',
      sessionToken: 'token-2',
      resumeToken: 'token-2',
      snapshot: makeRoomView(3, { yourPlayerId: 'p2' }),
    }));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await advanceAndFlush(0, 4);
    expect(result.current.recoveryEntry?.roomCode).toBe('ABCDE');
    expect(result.current.recoveryEntry?.recoveryState).toBe('resumable');

    await act(async () => {
      const ok = await result.current.resumeStoredRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(1);
    expect(result.current.session?.playerId).toBe('p2');
  });

  it('forgets the stored recovery entry without attempting reconnect', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    window.history.pushState({}, '', '/join/ABCDE');
    localStorage.setItem('monopolyDeal.multiplayerRecovery.v1', JSON.stringify({
      version: 1,
      entries: [{
        roomCode: 'ABCDE',
        playerName: 'Guest',
        seatId: 'p2',
        resumeToken: 'token-2',
        playerId: 'p2',
        sessionToken: 'token-2',
        reconnectDeadlineMs: now + 30_000,
        recoveryState: 'resumable',
        lastSeenAt: now,
      }],
    }));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await advanceAndFlush(0, 4);
    expect(result.current.recoveryEntry?.roomCode).toBe('ABCDE');

    act(() => {
      result.current.forgetStoredRoom();
    });

    expect(result.current.recoveryEntry).toBeNull();
    expect(localStorage.getItem('monopolyDeal.multiplayerRecovery.v1')).toBeNull();
    expect(clientMocks.reconnectMultiplayerRoom).not.toHaveBeenCalled();
  });

  it('keeps terminal recovery entries visible without auto-retrying them', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem('monopolyDeal.multiplayerRecovery.v1', JSON.stringify({
      version: 1,
      entries: [{
        roomCode: 'ABCDE',
        playerName: 'Guest',
        reconnectDeadlineMs: now - 1_000,
        recoveryState: 'expired',
        lastSeenAt: now,
      }],
    }));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await advanceAndFlush(0, 4);

    expect(clientMocks.reconnectMultiplayerRoom).not.toHaveBeenCalled();
    expect(result.current.recoveryEntry?.recoveryState).toBe('expired');
    expect(result.current.joinCode).toBe('ABCDE');
  });

  it('retries reconnect instead of creating a new join seat when the room code matches stored session', async () => {
    vi.useFakeTimers();
    const now = Date.now();
    window.history.pushState({}, '', '/join/ABCDE');
    localStorage.setItem('monopolyDeal.multiplayerSession.v1', JSON.stringify({
      version: 1,
      roomCode: 'ABCDE',
      seatId: 'p2',
      resumeToken: 'token-2',
      playerId: 'p2',
      sessionToken: 'token-2',
      playerName: 'Guest',
      reconnectDeadlineMs: now + 30_000,
    }));
    clientMocks.reconnectMultiplayerRoom.mockResolvedValue(makeResumeResponse('ok', {
      playerId: 'p2',
      seatId: 'p2',
      sessionToken: 'token-2',
      resumeToken: 'token-2',
      snapshot: makeRoomView(3, {
        yourPlayerId: 'p2',
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
      }),
    }));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await advanceAndFlush(0, 4);
    act(() => {
      result.current.setJoinCode('ABCDE');
    });

    await act(async () => {
      const ok = await result.current.joinRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(1);
    expect(clientMocks.joinMultiplayerRoom).not.toHaveBeenCalled();
    expect(result.current.session?.playerId).toBe('p2');
    expect(result.current.roomView?.yourPlayerId).toBe('p2');
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
    }));

    await advanceAndFlush(0, 6);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(1);
    expect(clientMocks.loadMultiplayerRoomState).not.toHaveBeenCalled();
    expect(result.current.connectionState).toBe('connected');
    expect(result.current.roomView?.revision).toBe(3);
  });

  it.each([
    { promptKind: 'payment', pendingKind: 'payment' },
    { promptKind: 'response', pendingKind: 'counter' },
    { promptKind: 'selection', pendingKind: 'forced_deal' },
    { promptKind: 'discard', pendingKind: null },
  ] as const)('hydrates reconnect snapshot prompt flow ($promptKind) without extra /state fetch', async ({ promptKind, pendingKind }) => {
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
    const snapshot = makePromptSnapshot(promptKind, 11);
    clientMocks.loadMultiplayerRoomState.mockClear();
    clientMocks.reconnectMultiplayerRoom.mockResolvedValue(makeResumeResponse('ok', {
      serverStateVersion: snapshot.revision,
      snapshot,
    }));

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await advanceAndFlush(0, 6);
    expect(clientMocks.reconnectMultiplayerRoom).toHaveBeenCalledTimes(1);
    expect(clientMocks.loadMultiplayerRoomState).not.toHaveBeenCalled();
    expect(result.current.roomView?.promptPlayerId).toBe('p1');
    expect(result.current.roomView?.legalActions.length).toBeGreaterThan(0);
    if (pendingKind === null) {
      expect(result.current.roomView?.gameState?.pending).toBeNull();
    } else {
      expect(result.current.roomView?.gameState?.pending?.kind).toBe(pendingKind);
    }
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
    }));
    await advanceAndFlush(0, 6);
    expect(mismatch.result.current.connectionUiState).toBe('resume_failed');
    mismatch.unmount();
  });

  it('auto-resyncs on stale_state action rejection via always-on version guard', async () => {
    vi.useFakeTimers();
    const onMetricEvent = vi.fn();
    let revision = 1;
    clientMocks.loadMultiplayerRoomState.mockImplementation(async () => {
      revision += 1;
      return makeActionRoomView(revision);
    });
    const staleActionError = Object.assign(new Error('action_rejected'), {
      details: {
        error: 'action_rejected',
        reason: 'stale_state',
        serverStateVersion: 9,
        requiresResync: true,
      },
    });
    clientMocks.applyMultiplayerAction.mockRejectedValue(staleActionError);

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
      onMetricEvent,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    const refreshCallsBeforeAction = clientMocks.loadMultiplayerRoomState.mock.calls.length;
    await act(async () => {
      await result.current.runAction(0);
    });
    await flushMicrotasks(6);

    expect(clientMocks.applyMultiplayerAction).toHaveBeenCalledTimes(1);
    const applyArgs = (clientMocks.applyMultiplayerAction.mock.calls[0] ?? []) as unknown[];
    expect(applyArgs[4] as Record<string, unknown>).toMatchObject({
      clientStateVersion: expect.any(Number),
      actionId: expect.any(String),
    });
    expect(clientMocks.loadMultiplayerRoomState.mock.calls.length).toBeGreaterThan(refreshCallsBeforeAction);
    expect(result.current.connectionState).toBe('connected');

    const resyncStarted = onMetricEvent.mock.calls.filter(([event]) => event === 'multiplayer_resync_started');
    const resyncCompleted = onMetricEvent.mock.calls.filter(([event]) => event === 'multiplayer_resync_completed');
    expect(resyncStarted.length).toBeGreaterThan(0);
    expect(resyncCompleted.length).toBeGreaterThan(0);
  });

  it('surfaces non-stale action rejection without forced resync', async () => {
    vi.useFakeTimers();
    let revision = 1;
    clientMocks.loadMultiplayerRoomState.mockImplementation(async () => {
      revision += 1;
      return makeActionRoomView(revision);
    });
    const rejectedActionError = Object.assign(new Error('action_rejected'), {
      details: {
        error: 'action_rejected',
        reason: 'not_your_turn',
        serverStateVersion: 6,
        requiresResync: false,
      },
    });
    clientMocks.applyMultiplayerAction.mockRejectedValue(rejectedActionError);

    const { result } = renderHook(() => useMultiplayerRoom({
      enabled: true,
      pushEnabled: false,
    }));

    await act(async () => {
      const ok = await result.current.hostRoom();
      expect(ok).toBe(true);
    });
    await flushMicrotasks();

    const refreshCallsBeforeAction = clientMocks.loadMultiplayerRoomState.mock.calls.length;
    await act(async () => {
      await result.current.runAction(0);
    });
    await flushMicrotasks(4);

    expect(result.current.errorCode).toBe('not_your_turn');
    expect(clientMocks.loadMultiplayerRoomState.mock.calls.length).toBe(refreshCallsBeforeAction);
  });

  it('uses bounded reconnect backoff cadence with single-loop guard', async () => {
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

  it('enters terminal resume_failed state after reconnect budget exhaustion', async () => {
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
    expect(mapConnectionUiState('disconnected', null)).toBe('connected');
    expect(mapConnectionUiState('connecting', null)).toBe('reconnect_handshake_pending');
    expect(mapConnectionUiState('connected', 'reconnect_expired')).toBe('timed_out');
    expect(mapConnectionUiState('connected', 'seat_timed_out')).toBe('timed_out');
    expect(mapConnectionUiState('connected', 'room_not_found')).toBe('room_ended');
    expect(mapConnectionUiState('connected', 'room_closed')).toBe('room_ended');
    expect(mapConnectionUiState('connected', null, 'ended_timeout')).toBe('room_ended');
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
