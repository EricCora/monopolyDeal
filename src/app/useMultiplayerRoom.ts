import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMultiplayerAction,
  checkMultiplayerHealth,
  createMultiplayerRoom,
  deleteMultiplayerCheckpoint,
  disconnectMultiplayerSocketTransport,
  getMultiplayerApiBase,
  getMultiplayerTransportMode,
  joinMultiplayerRoom,
  loadMultiplayerCheckpoint,
  leaveMultiplayerRoom,
  listMultiplayerCheckpoints,
  loadMultiplayerRoomState,
  multiplayerErrorMessage,
  pauseMultiplayerRoom,
  reconnectMultiplayerRoom,
  resetMultiplayerRoomTurn,
  resumeMultiplayerRoom,
  saveMultiplayerCheckpoint,
  sendMultiplayerChatMessage,
  sendMultiplayerReaction,
  setMultiplayerTyping,
  setMultiplayerReady,
  startMultiplayerRoom,
  subscribeMultiplayerTransportMode,
  subscribeMultiplayerRoomEvents,
  undoMultiplayerRoomAction,
} from '../network/multiplayerClient';
import type {
  MultiplayerActionRejectedReason,
  MultiplayerCheckpointSummary,
  MultiplayerConnectionState,
  MultiplayerConnectionUiState,
  MultiplayerEndedReason,
  MultiplayerPausedReason,
  MultiplayerPushState,
  MultiplayerReaction,
  MultiplayerResumeRoomResponse,
  MultiplayerRoomRuntimeState,
  MultiplayerRoomView,
  MultiplayerRoomSessionResponse,
  MultiplayerSession,
  MultiplayerTransportMode,
} from '../network/multiplayerTypes';
import type { GrowthMetricEvent } from '../stats';

interface UseMultiplayerRoomOptions {
  enabled: boolean;
  pollIntervalMs?: number;
  pushEnabled?: boolean;
  reactionsEnabled?: boolean;
  onMetricEvent?: (event: GrowthMetricEvent) => void;
}

export type MultiplayerRecoveryReason = 'room_not_found' | 'reconnect_expired';

export interface MultiplayerRecoveryNotice {
  roomCode: string;
  reason: MultiplayerRecoveryReason;
}

export interface MultiplayerReconnectDiagnostics {
  roomCode: string | null;
  seatId: string | null;
  pushState: MultiplayerPushState;
  transportMode: MultiplayerTransportMode;
  reconnectAttempt: number;
  lastClientVersion: number | null;
  lastServerVersion: number | null;
  lastReconnectError: string | null;
  roomRuntimeState: MultiplayerRoomRuntimeState | null;
  pausedReason: MultiplayerPausedReason | null;
  endedReason: MultiplayerEndedReason | null;
}

const SESSION_KEY = 'monopolyDeal.multiplayerSession.v1';
const RECONNECT_BACKOFF_BASE_MS = 500;
const RECONNECT_BACKOFF_MAX_MS = 8_000;
const RECONNECT_JITTER_RATIO = 0.2;
const RECONNECT_TOTAL_BUDGET_MS = 30_000;
const PUSH_CONNECT_TIMEOUT_MS = 5_000;

export function isTransportReconnectableError(code: string): boolean {
  return code === 'request_failed' || code === 'network_unavailable';
}

export function computeReconnectDelayMs(
  attemptIndex: number,
  random: () => number = Math.random,
): number {
  if (attemptIndex <= 1) return 0;
  const exponent = Math.max(0, attemptIndex - 2);
  const baseDelay = Math.min(RECONNECT_BACKOFF_MAX_MS, RECONNECT_BACKOFF_BASE_MS * (2 ** exponent));
  const sampled = random();
  const normalizedSample = Number.isFinite(sampled) ? Math.min(1, Math.max(0, sampled)) : 0.5;
  const jitterMultiplier = 1 + ((normalizedSample * 2) - 1) * RECONNECT_JITTER_RATIO;
  return Math.max(0, Math.round(baseDelay * jitterMultiplier));
}

function sanitizeName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'Player';
  return trimmed.slice(0, 28);
}

function sanitizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function createClientActionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

interface ActionRejectedErrorPayload {
  error: 'action_rejected';
  reason: MultiplayerActionRejectedReason;
  serverStateVersion: number;
  requiresResync: boolean;
  message?: string;
}

function parseActionRejectedError(error: unknown): ActionRejectedErrorPayload | null {
  if (!(error instanceof Error) || error.message !== 'action_rejected') return null;
  const details = (error as Error & { details?: unknown }).details;
  if (!details || typeof details !== 'object') return null;
  const payload = details as Partial<ActionRejectedErrorPayload>;
  if (payload.error !== 'action_rejected') return null;
  if (
    payload.reason !== 'stale_state'
    && payload.reason !== 'not_your_turn'
    && payload.reason !== 'invalid_action'
    && payload.reason !== 'prompt_mismatch'
  ) {
    return null;
  }
  if (!Number.isFinite(payload.serverStateVersion) || typeof payload.requiresResync !== 'boolean') return null;
  return payload as ActionRejectedErrorPayload;
}

function loadStoredSession(): MultiplayerSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MultiplayerSession>;
    if (parsed.version !== 1) return null;
    const seatId = parsed.seatId ?? parsed.playerId;
    const resumeToken = parsed.resumeToken ?? parsed.sessionToken;
    if (!parsed.roomCode || !seatId || !resumeToken || !parsed.playerName) return null;
    const reconnectDeadlineMs = Number(parsed.reconnectDeadlineMs);
    return {
      version: 1,
      roomCode: parsed.roomCode,
      seatId,
      resumeToken,
      playerId: parsed.playerId ?? seatId,
      sessionToken: parsed.sessionToken ?? resumeToken,
      playerName: parsed.playerName,
      reconnectDeadlineMs: Number.isFinite(reconnectDeadlineMs) ? reconnectDeadlineMs : 0,
    };
  } catch {
    return null;
  }
}

function saveStoredSession(session: MultiplayerSession | null): void {
  if (typeof window === 'undefined') return;
  if (!session) {
    window.localStorage.removeItem(SESSION_KEY);
    return;
  }
  const persisted: MultiplayerSession = {
    ...session,
    seatId: session.seatId ?? session.playerId,
    resumeToken: session.resumeToken ?? session.sessionToken,
    playerId: session.playerId ?? session.seatId ?? '',
    sessionToken: session.sessionToken ?? session.resumeToken ?? '',
  };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(persisted));
}

function isLocalApiBase(apiBase: string): boolean {
  try {
    const parsed = new URL(apiBase);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  } catch {
    return false;
  }
}

function isStaleSessionCode(code: string): code is MultiplayerRecoveryReason {
  return code === 'room_not_found' || code === 'reconnect_expired';
}

function normalizeRoomViewPayload(loaded: MultiplayerRoomView): MultiplayerRoomView {
  return {
    ...loaded,
    players: loaded.players.map((player) => ({
      ...player,
      ready: Boolean(player.ready),
    })),
    activityFeed: Array.isArray(loaded.activityFeed) ? loaded.activityFeed : [],
    chatMessages: Array.isArray(loaded.chatMessages) ? loaded.chatMessages : [],
    typingPlayerIds: Array.isArray(loaded.typingPlayerIds) ? loaded.typingPlayerIds : [],
    lastEventId: Number.isFinite(loaded.lastEventId) ? loaded.lastEventId : loaded.revision,
  };
}

function isResumeHandshakeResponse(
  response: MultiplayerRoomSessionResponse | MultiplayerResumeRoomResponse,
): response is MultiplayerResumeRoomResponse {
  return typeof (response as MultiplayerResumeRoomResponse).status === 'string'
    && typeof (response as MultiplayerResumeRoomResponse).requiresFullResync === 'boolean';
}

function resolveSessionIdentityFields(response: {
  seatId?: string;
  resumeToken?: string;
  playerId?: string;
  sessionToken?: string;
}): {
  seatId: string;
  resumeToken: string;
  playerId: string;
  sessionToken: string;
} | null {
  const seatId = response.seatId ?? response.playerId;
  const resumeToken = response.resumeToken ?? response.sessionToken;
  const playerId = response.playerId ?? seatId;
  const sessionToken = response.sessionToken ?? resumeToken;
  if (!seatId || !resumeToken || !playerId || !sessionToken) return null;
  return { seatId, resumeToken, playerId, sessionToken };
}

export function mapConnectionUiState(
  connectionState: MultiplayerConnectionState,
  errorCode: string | null,
  roomRuntimeState?: MultiplayerRoomRuntimeState,
): MultiplayerConnectionUiState {
  if (roomRuntimeState === 'ended_timeout') return 'room_ended';
  if (errorCode === 'reconnect_expired' || errorCode === 'seat_timed_out') return 'timed_out';
  if (errorCode === 'room_not_found' || errorCode === 'room_closed') return 'room_ended';
  if (errorCode === 'invalid_token' || errorCode === 'protocol_mismatch') return 'resume_failed';
  if (connectionState === 'disconnected') return 'resume_failed';
  if (connectionState === 'reconnecting') return 'reconnecting_attempting';
  if (connectionState === 'connecting') return 'reconnect_handshake_pending';
  return 'connected';
}

export function useMultiplayerRoom({
  enabled,
  pollIntervalMs = 2_000,
  pushEnabled = true,
  reactionsEnabled = true,
  onMetricEvent,
}: UseMultiplayerRoomOptions) {
  const [apiBase] = useState(() => getMultiplayerApiBase());
  const [isLocalDevApi] = useState(() => isLocalApiBase(apiBase));
  const [playerName, setPlayerName] = useState('Player');
  const [joinCode, setJoinCode] = useState('');
  const [session, setSession] = useState<MultiplayerSession | null>(null);
  const [roomView, setRoomView] = useState<MultiplayerRoomView | null>(null);
  const [connectionState, setConnectionState] = useState<MultiplayerConnectionState>('idle');
  const [pushState, setPushState] = useState<MultiplayerPushState>(pushEnabled ? 'connecting' : 'disabled');
  const [transportMode, setTransportMode] = useState<MultiplayerTransportMode>(() => getMultiplayerTransportMode());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<MultiplayerRecoveryNotice | null>(null);
  const [connectionUiStateOverride, setConnectionUiStateOverride] = useState<MultiplayerConnectionUiState | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const legacyReconnectAttemptRef = useRef(0);
  const reconnectLoopActiveRef = useRef(false);
  const reconnectLoopAttemptRef = useRef(0);
  const reconnectLoopStartedAtRef = useRef<number | null>(null);
  const reconnectLoopTimerRef = useRef<number | null>(null);
  const reconnectLoopRunnerRef = useRef<((activeSession?: MultiplayerSession | null) => void) | null>(null);
  const reconnectLastErrorCodeRef = useRef<string | null>(null);
  const reconnectAutoRetryBlockedRef = useRef(false);
  const autoReconnectAttemptedRef = useRef(false);
  const sessionOperationVersionRef = useRef(0);
  const [checkpointLoading, setCheckpointLoading] = useState(false);
  const [hostChangeNotice, setHostChangeNotice] = useState<string | null>(null);
  const lastHostPlayerIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef(0);
  const pushRefreshInFlightRef = useRef(false);
  const pushRefreshQueuedRef = useRef(false);
  const pushFallbackMetricSentRef = useRef(false);
  const reconnectInFlightRef = useRef<Promise<boolean> | null>(null);
  const recoveredUiTimerRef = useRef<number | null>(null);
  const diagnosticsClientVersionRef = useRef<number | null>(null);

  const expectedRevision = roomView?.revision;

  const clearReconnectLoopTimer = useCallback(() => {
    if (reconnectLoopTimerRef.current != null) {
      window.clearTimeout(reconnectLoopTimerRef.current);
      reconnectLoopTimerRef.current = null;
    }
  }, []);

  const stopReconnectLoop = useCallback(() => {
    clearReconnectLoopTimer();
    reconnectLoopActiveRef.current = false;
    reconnectLoopAttemptRef.current = 0;
    reconnectLoopStartedAtRef.current = null;
  }, [clearReconnectLoopTimer]);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);

  const clearRecoveredUiTimer = useCallback(() => {
    if (recoveredUiTimerRef.current != null) {
      window.clearTimeout(recoveredUiTimerRef.current);
      recoveredUiTimerRef.current = null;
    }
  }, []);

  const setRecoveredUiState = useCallback(() => {
    clearRecoveredUiTimer();
    setConnectionUiStateOverride('recovered');
    recoveredUiTimerRef.current = window.setTimeout(() => {
      setConnectionUiStateOverride(null);
      recoveredUiTimerRef.current = null;
    }, 1_250);
  }, [clearRecoveredUiTimer]);

  const setErrorFromCode = useCallback((code: string) => {
    setErrorCode(code);
    setError(multiplayerErrorMessage(code));
  }, []);

  const nextSessionOperationVersion = useCallback(() => {
    sessionOperationVersionRef.current += 1;
    return sessionOperationVersionRef.current;
  }, []);

  const clearSession = useCallback(() => {
    nextSessionOperationVersion();
    stopReconnectLoop();
    reconnectLastErrorCodeRef.current = null;
    reconnectAutoRetryBlockedRef.current = false;
    setSession(null);
    setRoomView(null);
    setHostChangeNotice(null);
    clearRecoveredUiTimer();
    setConnectionUiStateOverride(null);
    lastHostPlayerIdRef.current = null;
    lastEventIdRef.current = 0;
    disconnectMultiplayerSocketTransport();
    saveStoredSession(null);
  }, [clearRecoveredUiTimer, nextSessionOperationVersion, stopReconnectLoop]);

  const recoverStaleSession = useCallback((reason: MultiplayerRecoveryReason, staleSession?: MultiplayerSession | null) => {
    const roomCode = staleSession?.roomCode ?? '';
    clearSession();
    clearError();
    setConnectionState('idle');
    setConnectionUiStateOverride(reason === 'reconnect_expired' ? 'timed_out' : 'room_ended');
    if (roomCode) {
      setJoinCode(roomCode);
      setRecoveryNotice({ roomCode, reason });
    } else {
      setRecoveryNotice(null);
    }
  }, [clearError, clearSession]);

  const applyHydratedRoomView = useCallback((loaded: MultiplayerRoomView, activeSession: MultiplayerSession) => {
    if (lastHostPlayerIdRef.current && lastHostPlayerIdRef.current !== loaded.hostPlayerId) {
      const hostName = loaded.players.find((player) => player.id === loaded.hostPlayerId)?.name ?? loaded.hostPlayerId;
      setHostChangeNotice(`${hostName} is now host.`);
    }
    lastHostPlayerIdRef.current = loaded.hostPlayerId;
    lastEventIdRef.current = Math.max(lastEventIdRef.current, loaded.lastEventId ?? loaded.revision);

    setRoomView(loaded);
    diagnosticsClientVersionRef.current = loaded.revision;
    setConnectionState('connected');
    reconnectAutoRetryBlockedRef.current = false;
    clearError();
    setRecoveryNotice(null);
    return activeSession;
  }, [clearError]);

  const refreshRoom = useCallback(async (activeSession?: MultiplayerSession | null): Promise<MultiplayerRoomView | null> => {
    const current = activeSession ?? session;
    if (!current) return null;
    const operationVersion = sessionOperationVersionRef.current;
    let loaded: MultiplayerRoomView;
    try {
      loaded = await loadMultiplayerRoomState(current, apiBase);
    } catch (refreshError) {
      const code = refreshError instanceof Error ? refreshError.message : 'request_failed';
      setErrorFromCode(code);
      if (isStaleSessionCode(code)) {
        recoverStaleSession(code, current);
        return null;
      }
      throw refreshError;
    }
    if (operationVersion !== sessionOperationVersionRef.current) return null;
    const next = normalizeRoomViewPayload(loaded);
    applyHydratedRoomView(next, current);
    return next;
  }, [apiBase, applyHydratedRoomView, recoverStaleSession, session, setErrorFromCode]);

  interface ReconnectSessionOptions {
    suppressTerminalUi?: boolean;
    suppressReconnectMetrics?: boolean;
  }

  const reconnectSession = useCallback(async (
    activeSession?: MultiplayerSession | null,
    options: ReconnectSessionOptions = {},
  ): Promise<boolean> => {
    const current = activeSession ?? session;
    if (!current) return false;
    const operationVersion = sessionOperationVersionRef.current;
    onMetricEvent?.('multiplayer_resume_attempt');
    setConnectionUiStateOverride('reconnect_handshake_pending');
    diagnosticsClientVersionRef.current = expectedRevision ?? roomView?.revision ?? diagnosticsClientVersionRef.current;
    try {
      const reconnected = await reconnectMultiplayerRoom(current, apiBase, expectedRevision);
      reconnectLastErrorCodeRef.current = null;
      if (operationVersion !== sessionOperationVersionRef.current) return false;

      if (isResumeHandshakeResponse(reconnected)) {
        if (reconnected.status !== 'ok') {
          if (reconnected.status === 'seat_timed_out') {
            reconnectLastErrorCodeRef.current = 'reconnect_expired';
            setErrorFromCode('seat_timed_out');
            recoverStaleSession('reconnect_expired', current);
          } else if (reconnected.status === 'room_closed' || reconnected.status === 'seat_not_found') {
            reconnectLastErrorCodeRef.current = 'room_not_found';
            setErrorFromCode('room_closed');
            recoverStaleSession('room_not_found', current);
          } else {
            reconnectLastErrorCodeRef.current = reconnected.status;
            setErrorFromCode(reconnected.status);
            if (!options.suppressTerminalUi) {
              setConnectionUiStateOverride('resume_failed');
            }
          }
          onMetricEvent?.('multiplayer_resume_failure');
          if (!options.suppressReconnectMetrics) {
            onMetricEvent?.('multiplayer_reconnect_failed');
          }
          return false;
        }

        const identities = resolveSessionIdentityFields(reconnected);
        if (!identities) {
          reconnectLastErrorCodeRef.current = 'invalid_token';
          setErrorFromCode('invalid_token');
          if (!options.suppressTerminalUi) {
            setConnectionUiStateOverride('resume_failed');
          }
          onMetricEvent?.('multiplayer_resume_failure');
          if (!options.suppressReconnectMetrics) {
            onMetricEvent?.('multiplayer_reconnect_failed');
          }
          return false;
        }

        const nextSession: MultiplayerSession = {
          version: 1,
          roomCode: reconnected.roomCode,
          seatId: identities.seatId,
          resumeToken: identities.resumeToken,
          playerId: identities.playerId,
          sessionToken: identities.sessionToken,
          playerName: current.playerName,
          reconnectDeadlineMs: reconnected.reconnectDeadlineMs ?? current.reconnectDeadlineMs,
        };
        setSession(nextSession);
        saveStoredSession(nextSession);
        setConnectionUiStateOverride('resync_pending');
        onMetricEvent?.('multiplayer_resync_started');
        if (reconnected.snapshot) {
          const normalizedSnapshot = normalizeRoomViewPayload(reconnected.snapshot);
          applyHydratedRoomView(normalizedSnapshot, nextSession);
        } else {
          await refreshRoom(nextSession);
        }
        onMetricEvent?.('multiplayer_resync_completed');
        if (operationVersion !== sessionOperationVersionRef.current) return false;
        setConnectionState('connected');
        setRecoveryNotice(null);
        onMetricEvent?.('multiplayer_resume_success');
        setRecoveredUiState();
        if (!options.suppressReconnectMetrics) {
          onMetricEvent?.('multiplayer_reconnect_success');
        }
        return true;
      }

      const identities = resolveSessionIdentityFields(reconnected);
      if (!identities) {
        throw new Error('invalid_session');
      }
      const nextSession: MultiplayerSession = {
        version: 1,
        roomCode: reconnected.roomCode,
        seatId: identities.seatId,
        resumeToken: identities.resumeToken,
        playerId: identities.playerId,
        sessionToken: identities.sessionToken,
        playerName: current.playerName,
        reconnectDeadlineMs: reconnected.reconnectDeadlineMs,
      };
      setSession(nextSession);
      saveStoredSession(nextSession);
      setConnectionUiStateOverride('resync_pending');
      onMetricEvent?.('multiplayer_resync_started');
      await refreshRoom(nextSession);
      onMetricEvent?.('multiplayer_resync_completed');
      if (operationVersion !== sessionOperationVersionRef.current) return false;
      setConnectionState('connected');
      setRecoveryNotice(null);
      onMetricEvent?.('multiplayer_resume_success');
      setRecoveredUiState();
      if (!options.suppressReconnectMetrics) {
        onMetricEvent?.('multiplayer_reconnect_success');
      }
      return true;
    } catch (reconnectError) {
      const code = reconnectError instanceof Error ? reconnectError.message : 'request_failed';
      reconnectLastErrorCodeRef.current = code;
      setErrorFromCode(code);
      if (isStaleSessionCode(code)) {
        recoverStaleSession(code, current);
      } else if (!options.suppressTerminalUi) {
        setConnectionUiStateOverride('resume_failed');
      }
      onMetricEvent?.('multiplayer_resume_failure');
      if (!options.suppressReconnectMetrics) {
        onMetricEvent?.('multiplayer_reconnect_failed');
      }
      return false;
    }
  }, [
    apiBase,
    applyHydratedRoomView,
    expectedRevision,
    onMetricEvent,
    recoverStaleSession,
    refreshRoom,
    roomView?.revision,
    session,
    setErrorFromCode,
    setRecoveredUiState,
  ]);

  const reconnectSessionSingleFlight = useCallback((
    activeSession?: MultiplayerSession | null,
    options?: ReconnectSessionOptions,
  ): Promise<boolean> => {
    if (reconnectInFlightRef.current) {
      return reconnectInFlightRef.current;
    }
    const run = reconnectSession(activeSession, options)
      .finally(() => {
        reconnectInFlightRef.current = null;
      });
    reconnectInFlightRef.current = run;
    return run;
  }, [reconnectSession]);

  const scheduleReconnectAttempt = useCallback((delayMs: number, activeSession?: MultiplayerSession | null) => {
    if (!reconnectLoopActiveRef.current) return;
    clearReconnectLoopTimer();
    reconnectLoopTimerRef.current = window.setTimeout(() => {
      reconnectLoopTimerRef.current = null;
      reconnectLoopRunnerRef.current?.(activeSession);
    }, Math.max(0, Math.floor(delayMs)));
  }, [clearReconnectLoopTimer]);

  const markReconnectLoopTerminalFailure = useCallback((code: string) => {
    stopReconnectLoop();
    reconnectAutoRetryBlockedRef.current = true;
    setConnectionState('disconnected');
    setConnectionUiStateOverride('resume_failed');
    setErrorFromCode(code);
    onMetricEvent?.('multiplayer_reconnect_failed');
  }, [onMetricEvent, setErrorFromCode, stopReconnectLoop]);

  const runReconnectAttempt = useCallback(async (activeSession?: MultiplayerSession | null) => {
    if (!reconnectLoopActiveRef.current) return;
    const current = activeSession ?? session;
    if (!current) {
      stopReconnectLoop();
      return;
    }
    const startedAt = reconnectLoopStartedAtRef.current ?? Date.now();
    if (reconnectLoopStartedAtRef.current == null) {
      reconnectLoopStartedAtRef.current = startedAt;
    }
    const elapsedBeforeAttempt = Date.now() - startedAt;
    if (elapsedBeforeAttempt >= RECONNECT_TOTAL_BUDGET_MS) {
      markReconnectLoopTerminalFailure(reconnectLastErrorCodeRef.current ?? 'request_failed');
      return;
    }

    reconnectLoopAttemptRef.current += 1;
    setConnectionState('reconnecting');
    setConnectionUiStateOverride('reconnecting_attempting');

    const recovered = await reconnectSessionSingleFlight(current, {
      suppressTerminalUi: true,
      suppressReconnectMetrics: true,
    });
    if (!reconnectLoopActiveRef.current) return;
    if (recovered) {
      stopReconnectLoop();
      reconnectAutoRetryBlockedRef.current = false;
      onMetricEvent?.('multiplayer_reconnect_success');
      return;
    }

    const failureCode = reconnectLastErrorCodeRef.current;
    if (failureCode && isStaleSessionCode(failureCode)) {
      stopReconnectLoop();
      return;
    }
    if (failureCode && !isTransportReconnectableError(failureCode)) {
      markReconnectLoopTerminalFailure(failureCode);
      return;
    }

    const elapsedAfterAttempt = Date.now() - startedAt;
    const remainingBudgetMs = RECONNECT_TOTAL_BUDGET_MS - elapsedAfterAttempt;
    if (remainingBudgetMs <= 0) {
      markReconnectLoopTerminalFailure(failureCode ?? 'request_failed');
      return;
    }
    const nextAttemptIndex = reconnectLoopAttemptRef.current + 1;
    const nextDelayMs = Math.min(remainingBudgetMs, computeReconnectDelayMs(nextAttemptIndex));
    scheduleReconnectAttempt(nextDelayMs, current);
  }, [
    markReconnectLoopTerminalFailure,
    onMetricEvent,
    reconnectSessionSingleFlight,
    scheduleReconnectAttempt,
    session,
    stopReconnectLoop,
  ]);

  useEffect(() => {
    reconnectLoopRunnerRef.current = (activeSession?: MultiplayerSession | null) => {
      void runReconnectAttempt(activeSession);
    };
    return () => {
      reconnectLoopRunnerRef.current = null;
    };
  }, [runReconnectAttempt]);

  const startReconnectLoop = useCallback((activeSession?: MultiplayerSession | null) => {
    if (reconnectAutoRetryBlockedRef.current) return;
    if (reconnectLoopActiveRef.current || reconnectInFlightRef.current) return;
    const current = activeSession ?? session;
    if (!current) return;
    reconnectLoopRunnerRef.current = (nextSession?: MultiplayerSession | null) => {
      void runReconnectAttempt(nextSession);
    };
    reconnectLoopActiveRef.current = true;
    reconnectLoopAttemptRef.current = 0;
    reconnectLoopStartedAtRef.current = Date.now();
    setConnectionState('reconnecting');
    setConnectionUiStateOverride('socket_disconnected');
    void runReconnectAttempt(current);
  }, [runReconnectAttempt, session]);

  const refreshFromPush = useCallback(() => {
    if (pushRefreshInFlightRef.current) {
      pushRefreshQueuedRef.current = true;
      return;
    }
    pushRefreshInFlightRef.current = true;
    refreshRoom()
      .catch((refreshError) => {
        const code = refreshError instanceof Error ? refreshError.message : 'request_failed';
        if (connectionState !== 'disconnected' && isTransportReconnectableError(code)) {
          startReconnectLoop();
          return;
        }
        setConnectionState('reconnecting');
      })
      .finally(() => {
        pushRefreshInFlightRef.current = false;
        if (pushRefreshQueuedRef.current) {
          pushRefreshQueuedRef.current = false;
          refreshFromPush();
        }
      });
  }, [connectionState, refreshRoom, startReconnectLoop]);

  const refreshOnRevisionConflict = useCallback(async (code: string, activeSession: MultiplayerSession) => {
    if (code !== 'revision_conflict') return;
    await refreshRoom(activeSession).catch(() => {
      // Keep original conflict message if refresh fails.
    });
  }, [refreshRoom]);

  const hostRoom = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setConnectionState('connecting');
    setConnectionUiStateOverride(null);
    clearError();
    try {
      reconnectAutoRetryBlockedRef.current = false;
      const nextName = sanitizeName(playerName);
      const created = await createMultiplayerRoom(nextName, apiBase);
      const identities = resolveSessionIdentityFields(created);
      if (!identities) {
        throw new Error('invalid_session');
      }
      const nextSession: MultiplayerSession = {
        version: 1,
        roomCode: created.roomCode,
        seatId: identities.seatId,
        resumeToken: identities.resumeToken,
        playerId: identities.playerId,
        sessionToken: identities.sessionToken,
        playerName: nextName,
        reconnectDeadlineMs: created.reconnectDeadlineMs,
      };
      setPlayerName(nextName);
      setJoinCode(created.roomCode);
      setSession(nextSession);
      saveStoredSession(nextSession);
      setRecoveryNotice(null);
      await refreshRoom(nextSession);
      onMetricEvent?.('multiplayer_host_started');
      onMetricEvent?.('lan_room_hosted');
      return true;
    } catch (hostError) {
      const code = hostError instanceof Error ? hostError.message : 'request_failed';
      setErrorFromCode(code);
      setConnectionState('disconnected');
      return false;
    } finally {
      setLoading(false);
    }
  }, [apiBase, clearError, onMetricEvent, playerName, refreshRoom, setErrorFromCode]);

  const joinRoom = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setConnectionState('connecting');
    setConnectionUiStateOverride(null);
    clearError();
    try {
      reconnectAutoRetryBlockedRef.current = false;
      const nextName = sanitizeName(playerName);
      const roomCode = sanitizeRoomCode(joinCode);
      const joined = await joinMultiplayerRoom(roomCode, nextName, apiBase);
      const identities = resolveSessionIdentityFields(joined);
      if (!identities) {
        throw new Error('invalid_session');
      }
      const nextSession: MultiplayerSession = {
        version: 1,
        roomCode: joined.roomCode,
        seatId: identities.seatId,
        resumeToken: identities.resumeToken,
        playerId: identities.playerId,
        sessionToken: identities.sessionToken,
        playerName: nextName,
        reconnectDeadlineMs: joined.reconnectDeadlineMs,
      };
      setPlayerName(nextName);
      setJoinCode(joined.roomCode);
      setSession(nextSession);
      saveStoredSession(nextSession);
      setRecoveryNotice(null);
      await refreshRoom(nextSession);
      onMetricEvent?.('multiplayer_join_success');
      onMetricEvent?.('lan_room_joined');
      return true;
    } catch (joinError) {
      const code = joinError instanceof Error ? joinError.message : 'request_failed';
      setErrorFromCode(code);
      setConnectionState('disconnected');
      onMetricEvent?.('multiplayer_join_failed');
      return false;
    } finally {
      setLoading(false);
    }
  }, [apiBase, clearError, joinCode, onMetricEvent, playerName, refreshRoom, setErrorFromCode]);

  const leaveRoomInternal = useCallback(async (forgetSession: boolean) => {
    const current = session;
    if (!current) {
      if (forgetSession) {
        clearSession();
      }
      return;
    }
    stopReconnectLoop();
    setLoading(true);
    const operationVersion = forgetSession ? nextSessionOperationVersion() : sessionOperationVersionRef.current;
    try {
      await leaveMultiplayerRoom(current, apiBase, false, expectedRevision);
    } catch {
      // Best-effort leave; local cleanup still proceeds.
    } finally {
      const staleOperation = operationVersion !== sessionOperationVersionRef.current;
      if (!staleOperation) {
        if (forgetSession) {
          clearSession();
          setRecoveryNotice(null);
        } else {
          setRoomView(null);
        }
        setConnectionState('idle');
        setConnectionUiStateOverride(null);
        clearError();
      }
      setLoading(false);
    }
  }, [apiBase, clearError, clearSession, expectedRevision, nextSessionOperationVersion, session, stopReconnectLoop]);

  const exitRoom = useCallback(async () => {
    await leaveRoomInternal(false);
  }, [leaveRoomInternal]);

  const leaveRoom = useCallback(async () => {
    await leaveRoomInternal(true);
  }, [leaveRoomInternal]);

  const startMatch = useCallback(async (checkpointId?: string) => {
    const current = session;
    if (!current) return;
    setLoading(true);
    clearError();
    try {
      await startMultiplayerRoom(current, apiBase, expectedRevision, checkpointId);
      await refreshRoom(current);
    } catch (startError) {
      const code = startError instanceof Error ? startError.message : 'request_failed';
      setErrorFromCode(code);
      await refreshOnRevisionConflict(code, current);
    } finally {
      setLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshOnRevisionConflict, refreshRoom, session, setErrorFromCode]);

  const runAction = useCallback(async (index: number) => {
    const current = session;
    if (!current || !roomView) return;
    const selected = roomView.legalActions[index];
    if (!selected) return;
    setLoading(true);
    clearError();
    try {
      diagnosticsClientVersionRef.current = roomView.revision;
      await applyMultiplayerAction(
        current,
        selected.action,
        apiBase,
        expectedRevision,
        {
          clientStateVersion: roomView.revision,
          actionId: createClientActionId(),
        },
      );
      await refreshRoom(current);
    } catch (actionError) {
      const actionRejected = parseActionRejectedError(actionError);
      if (actionRejected) {
        if (actionRejected.reason === 'stale_state' || actionRejected.requiresResync) {
          setConnectionUiStateOverride('resync_pending');
          onMetricEvent?.('multiplayer_resync_started');
          try {
            await refreshRoom(current);
            setRecoveredUiState();
          } catch (resyncError) {
            const resyncCode = resyncError instanceof Error ? resyncError.message : 'request_failed';
            setErrorFromCode(resyncCode);
            await refreshOnRevisionConflict(resyncCode, current);
          } finally {
            onMetricEvent?.('multiplayer_resync_completed');
          }
          return;
        }
        setErrorFromCode(actionRejected.reason);
        return;
      }
      const code = actionError instanceof Error ? actionError.message : 'request_failed';
      setErrorFromCode(code);
      await refreshOnRevisionConflict(code, current);
    } finally {
      setLoading(false);
    }
  }, [
    apiBase,
    clearError,
    expectedRevision,
    onMetricEvent,
    refreshOnRevisionConflict,
    refreshRoom,
    roomView,
    session,
    setErrorFromCode,
    setRecoveredUiState,
  ]);

  const setReady = useCallback(async (ready: boolean) => {
    const current = session;
    if (!current) return;
    setLoading(true);
    clearError();
    try {
      await setMultiplayerReady(current, ready, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (readyError) {
      const code = readyError instanceof Error ? readyError.message : 'request_failed';
      setErrorFromCode(code);
      await refreshOnRevisionConflict(code, current);
    } finally {
      setLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshOnRevisionConflict, refreshRoom, session, setErrorFromCode]);

  const sendReaction = useCallback(async (reaction: MultiplayerReaction) => {
    const current = session;
    if (!current || !reactionsEnabled) return;
    clearError();
    try {
      await sendMultiplayerReaction(current, reaction, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (reactionError) {
      const code = reactionError instanceof Error ? reactionError.message : 'request_failed';
      setErrorFromCode(code);
      await refreshOnRevisionConflict(code, current);
    }
  }, [apiBase, clearError, expectedRevision, reactionsEnabled, refreshOnRevisionConflict, refreshRoom, session, setErrorFromCode]);

  const sendChatMessage = useCallback(async (text: string) => {
    const current = session;
    if (!current) return;
    clearError();
    try {
      await sendMultiplayerChatMessage(current, text, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (chatError) {
      const code = chatError instanceof Error ? chatError.message : 'request_failed';
      setErrorFromCode(code);
      await refreshOnRevisionConflict(code, current);
    }
  }, [apiBase, clearError, expectedRevision, refreshOnRevisionConflict, refreshRoom, session, setErrorFromCode]);

  const setTyping = useCallback(async (typing: boolean) => {
    const current = session;
    if (!current) return;
    try {
      await setMultiplayerTyping(current, typing, apiBase, expectedRevision);
    } catch {
      // Typing indicators are best-effort and should not interrupt gameplay.
    }
  }, [apiBase, expectedRevision, session]);

  const pauseMatch = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    clearError();
    try {
      await pauseMultiplayerRoom(current, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (pauseError) {
      const code = pauseError instanceof Error ? pauseError.message : 'request_failed';
      setErrorFromCode(code);
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshRoom, session, setErrorFromCode]);

  const resumeMatch = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    clearError();
    try {
      await resumeMultiplayerRoom(current, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (resumeError) {
      const code = resumeError instanceof Error ? resumeError.message : 'request_failed';
      setErrorFromCode(code);
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshRoom, session, setErrorFromCode]);

  const undoLastAction = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    clearError();
    try {
      await undoMultiplayerRoomAction(current, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (undoError) {
      const code = undoError instanceof Error ? undoError.message : 'request_failed';
      setErrorFromCode(code);
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshRoom, session, setErrorFromCode]);

  const resetTurn = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    clearError();
    try {
      await resetMultiplayerRoomTurn(current, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (resetError) {
      const code = resetError instanceof Error ? resetError.message : 'request_failed';
      setErrorFromCode(code);
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshRoom, session, setErrorFromCode]);

  const saveCheckpoint = useCallback(async (name: string) => {
    const current = session;
    if (!current) return;
    setCheckpointLoading(true);
    clearError();
    try {
      await saveMultiplayerCheckpoint(current, name, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (saveError) {
      const code = saveError instanceof Error ? saveError.message : 'request_failed';
      setErrorFromCode(code);
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setCheckpointLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshRoom, session, setErrorFromCode]);

  const loadCheckpoint = useCallback(async (checkpointId: string) => {
    const current = session;
    if (!current) return;
    setCheckpointLoading(true);
    clearError();
    try {
      await loadMultiplayerCheckpoint(current, checkpointId, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : 'request_failed';
      setErrorFromCode(code);
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setCheckpointLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshRoom, session, setErrorFromCode]);

  const deleteCheckpoint = useCallback(async (checkpointId: string) => {
    const current = session;
    if (!current) return;
    setCheckpointLoading(true);
    clearError();
    try {
      await deleteMultiplayerCheckpoint(current, checkpointId, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (deleteError) {
      const code = deleteError instanceof Error ? deleteError.message : 'request_failed';
      setErrorFromCode(code);
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setCheckpointLoading(false);
    }
  }, [apiBase, clearError, expectedRevision, refreshRoom, session, setErrorFromCode]);

  const refreshCheckpoints = useCallback(async (): Promise<MultiplayerCheckpointSummary[]> => {
    const current = session;
    if (!current) return [];
    try {
      return await listMultiplayerCheckpoints(current, apiBase);
    } catch (listError) {
      const code = listError instanceof Error ? listError.message : 'request_failed';
      setErrorFromCode(code);
      return [];
    }
  }, [apiBase, session, setErrorFromCode]);

  const mappedConnectionUiState = useMemo(
    () => mapConnectionUiState(connectionState, errorCode, roomView?.roomRuntimeState),
    [connectionState, errorCode, roomView?.roomRuntimeState],
  );

  const connectionUiState = useMemo<MultiplayerConnectionUiState>(() => {
    return connectionUiStateOverride ?? mappedConnectionUiState;
  }, [connectionUiStateOverride, mappedConnectionUiState]);

  useEffect(() => {
    return () => {
      clearRecoveredUiTimer();
      stopReconnectLoop();
    };
  }, [clearRecoveredUiTimer, stopReconnectLoop]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    checkMultiplayerHealth(apiBase)
      .then((ok) => {
        if (!cancelled) setHealthOk(ok);
      })
      .catch(() => {
        if (!cancelled) setHealthOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiBase, enabled]);

  useEffect(() => {
    if (enabled) return;
    stopReconnectLoop();
  }, [enabled, stopReconnectLoop]);

  useEffect(() => {
    if (!enabled || autoReconnectAttemptedRef.current) return;
    autoReconnectAttemptedRef.current = true;
    const stored = loadStoredSession();
    if (!stored) return;
    setPlayerName(stored.playerName);
    setJoinCode(stored.roomCode);
    setSession(stored);
    setConnectionState('reconnecting');
    startReconnectLoop(stored);
  }, [enabled, startReconnectLoop]);

  useEffect(() => {
    if (!enabled || !session || !pushEnabled) {
      setPushState(pushEnabled ? 'connecting' : 'disabled');
      return;
    }

    pushFallbackMetricSentRef.current = false;
    setPushState('connecting');
    let cancelled = false;
    let subscription: { close: () => void } | null = null;
    let opened = false;
    let connectTimeoutId: number | null = null;
    const clearConnectTimeout = () => {
      if (connectTimeoutId != null) {
        window.clearTimeout(connectTimeoutId);
        connectTimeoutId = null;
      }
    };
    const enterPushFallback = () => {
      if (cancelled) return;
      setPushState('fallback');
      onMetricEvent?.('multiplayer_push_disconnected');
      if (!pushFallbackMetricSentRef.current) {
        onMetricEvent?.('multiplayer_push_fallback');
        pushFallbackMetricSentRef.current = true;
      }
    };
    const markPushConnected = () => {
      if (cancelled || opened) return;
      opened = true;
      clearConnectTimeout();
      setPushState('connected');
      onMetricEvent?.('multiplayer_push_connected');
    };

    try {
      subscription = subscribeMultiplayerRoomEvents(
        session,
        {
          onOpen: () => {
            markPushConnected();
          },
          onEvent: (event) => {
            if (cancelled) return;
            // Some environments can deliver room events before an explicit onOpen callback.
            // Accepting the first event as stream readiness avoids false polling fallback.
            markPushConnected();
            if (event.eventId <= lastEventIdRef.current) return;
            lastEventIdRef.current = event.eventId;
            refreshFromPush();
          },
          onDisconnect: () => {
            clearConnectTimeout();
            enterPushFallback();
          },
        },
        apiBase,
        lastEventIdRef.current,
      );
      connectTimeoutId = window.setTimeout(() => {
        if (cancelled || opened) return;
        subscription?.close();
        enterPushFallback();
      }, PUSH_CONNECT_TIMEOUT_MS);
    } catch (pushError) {
      clearConnectTimeout();
      if (cancelled) return;
      const code = pushError instanceof Error ? pushError.message : 'push_not_supported';
      if (code === 'push_not_supported') {
        setPushState('unsupported');
      } else {
        setPushState('fallback');
      }
      if (!pushFallbackMetricSentRef.current) {
        onMetricEvent?.('multiplayer_push_fallback');
        pushFallbackMetricSentRef.current = true;
      }
    }

    return () => {
      cancelled = true;
      clearConnectTimeout();
      subscription?.close();
    };
  }, [apiBase, enabled, onMetricEvent, pushEnabled, refreshFromPush, session]);

  useEffect(() => {
    return subscribeMultiplayerTransportMode((mode) => {
      setTransportMode(mode);
    });
  }, []);

  useEffect(() => {
    if (!enabled || !session) return;
    const effectivePollIntervalMs = pushState === 'connected' ? Math.max(pollIntervalMs, 8_000) : pollIntervalMs;
    const timer = window.setInterval(() => {
      refreshRoom().catch(async (refreshError) => {
        const code = refreshError instanceof Error ? refreshError.message : 'request_failed';
        if (connectionState !== 'disconnected' && isTransportReconnectableError(code)) {
          startReconnectLoop();
          return;
        }
        setConnectionState('reconnecting');
        setConnectionUiStateOverride('reconnecting_attempting');
        if (reconnectInFlightRef.current) return;
        legacyReconnectAttemptRef.current += 1;
        const recovered = await reconnectSessionSingleFlight();
        if (!recovered) {
          if (legacyReconnectAttemptRef.current > 4) {
            setConnectionState('disconnected');
            setConnectionUiStateOverride('resume_failed');
          }
          return;
        }
        legacyReconnectAttemptRef.current = 0;
      });
    }, effectivePollIntervalMs);
    return () => window.clearInterval(timer);
  }, [
    enabled,
    connectionState,
    pollIntervalMs,
    pushState,
    reconnectSessionSingleFlight,
    refreshRoom,
    session,
    startReconnectLoop,
  ]);

  useEffect(() => {
    if (!enabled || !session) return;
    const onBeforeUnload = () => {
      void leaveMultiplayerRoom(session, apiBase, true);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [apiBase, enabled, session]);

  const isHost = useMemo(() => {
    if (!roomView || !session) return false;
    return roomView.hostPlayerId === session.playerId;
  }, [roomView, session]);

  const reconnectDiagnostics = useMemo<MultiplayerReconnectDiagnostics>(() => ({
    roomCode: session?.roomCode ?? null,
    seatId: session?.seatId ?? session?.playerId ?? null,
    pushState,
    transportMode,
    reconnectAttempt: reconnectLoopAttemptRef.current,
    lastClientVersion: diagnosticsClientVersionRef.current,
    lastServerVersion: roomView?.revision ?? null,
    lastReconnectError: reconnectLastErrorCodeRef.current ?? errorCode,
    roomRuntimeState: roomView?.roomRuntimeState ?? null,
    pausedReason: roomView?.pausedReason ?? null,
    endedReason: roomView?.endedReason ?? null,
  }), [
    errorCode,
    pushState,
    transportMode,
    roomView?.endedReason,
    roomView?.pausedReason,
    roomView?.revision,
    roomView?.roomRuntimeState,
    session?.playerId,
    session?.roomCode,
    session?.seatId,
  ]);

  return {
    apiBase,
    isLocalDevApi,
    healthOk,
    playerName,
    setPlayerName,
    joinCode,
    setJoinCode: (value: string) => setJoinCode(sanitizeRoomCode(value)),
    session,
    roomView,
    revision: roomView?.revision ?? 0,
    loading,
    checkpointLoading,
    error,
    errorCode,
    recoveryNotice,
    connectionState,
    connectionUiState,
    pushState,
    transportMode,
    reconnectDiagnostics,
    reactionsEnabled,
    hostChangeNotice,
    clearHostChangeNotice: () => setHostChangeNotice(null),
    isHost,
    hostRoom,
    joinRoom,
    startMatch,
    runAction,
    setReady,
    sendReaction,
    sendChatMessage,
    setTyping,
    pauseMatch,
    resumeMatch,
    undoLastAction,
    resetTurn,
    saveCheckpoint,
    loadCheckpoint,
    deleteCheckpoint,
    refreshCheckpoints,
    leaveRoom,
    exitRoom,
    refreshRoom: () => refreshRoom(),
    reconnectSession: () => reconnectSessionSingleFlight(),
    clearSession,
    clearRecoveryNotice: () => {
      setRecoveryNotice(null);
      clearError();
    },
    setError: (nextError: string | null) => {
      setError(nextError);
      if (nextError == null) setErrorCode(null);
    },
  };
}
