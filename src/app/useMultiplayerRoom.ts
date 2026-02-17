import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMultiplayerAction,
  checkMultiplayerHealth,
  createMultiplayerRoom,
  deleteMultiplayerCheckpoint,
  getMultiplayerApiBase,
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
  sendMultiplayerReaction,
  setMultiplayerReady,
  startMultiplayerRoom,
  subscribeMultiplayerRoomEvents,
  undoMultiplayerRoomAction,
} from '../network/multiplayerClient';
import type {
  MultiplayerCheckpointSummary,
  MultiplayerConnectionState,
  MultiplayerPushState,
  MultiplayerReaction,
  MultiplayerRoomView,
  MultiplayerSession,
} from '../network/multiplayerTypes';
import type { GrowthMetricEvent } from '../stats';

interface UseMultiplayerRoomOptions {
  enabled: boolean;
  pollIntervalMs?: number;
  pushEnabled?: boolean;
  reactionsEnabled?: boolean;
  onMetricEvent?: (event: GrowthMetricEvent) => void;
}

const SESSION_KEY = 'monopolyDeal.multiplayerSession.v1';

function sanitizeName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'Player';
  return trimmed.slice(0, 28);
}

function sanitizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function loadStoredSession(): MultiplayerSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MultiplayerSession>;
    if (parsed.version !== 1) return null;
    if (!parsed.roomCode || !parsed.playerId || !parsed.sessionToken || !parsed.playerName) return null;
    const reconnectDeadlineMs = Number(parsed.reconnectDeadlineMs);
    return {
      version: 1,
      roomCode: parsed.roomCode,
      playerId: parsed.playerId,
      sessionToken: parsed.sessionToken,
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
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function isLocalApiBase(apiBase: string): boolean {
  try {
    const parsed = new URL(apiBase);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  } catch {
    return false;
  }
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const reconnectAttemptRef = useRef(0);
  const autoReconnectAttemptedRef = useRef(false);
  const [checkpointLoading, setCheckpointLoading] = useState(false);
  const [hostChangeNotice, setHostChangeNotice] = useState<string | null>(null);
  const lastHostPlayerIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef(0);
  const pushRefreshInFlightRef = useRef(false);
  const pushRefreshQueuedRef = useRef(false);
  const pushFallbackMetricSentRef = useRef(false);

  const expectedRevision = roomView?.revision;

  const clearSession = useCallback(() => {
    setSession(null);
    setRoomView(null);
    setHostChangeNotice(null);
    lastHostPlayerIdRef.current = null;
    lastEventIdRef.current = 0;
    saveStoredSession(null);
  }, []);

  const refreshRoom = useCallback(async (activeSession?: MultiplayerSession | null): Promise<MultiplayerRoomView | null> => {
    const current = activeSession ?? session;
    if (!current) return null;
    const loaded = await loadMultiplayerRoomState(current, apiBase);
    const next: MultiplayerRoomView = {
      ...loaded,
      players: loaded.players.map((player) => ({
        ...player,
        ready: Boolean(player.ready),
      })),
      activityFeed: Array.isArray(loaded.activityFeed) ? loaded.activityFeed : [],
      lastEventId: Number.isFinite(loaded.lastEventId) ? loaded.lastEventId : loaded.revision,
    };

    if (lastHostPlayerIdRef.current && lastHostPlayerIdRef.current !== next.hostPlayerId) {
      const hostName = next.players.find((player) => player.id === next.hostPlayerId)?.name ?? next.hostPlayerId;
      setHostChangeNotice(`${hostName} is now host.`);
    }
    lastHostPlayerIdRef.current = next.hostPlayerId;
    lastEventIdRef.current = Math.max(lastEventIdRef.current, next.lastEventId ?? next.revision);

    setRoomView(next);
    setConnectionState('connected');
    setError(null);
    const nextSession: MultiplayerSession = {
      ...current,
      reconnectDeadlineMs: next.reconnectDeadlineMs,
    };
    setSession(nextSession);
    saveStoredSession(nextSession);
    return next;
  }, [apiBase, session]);

  const refreshFromPush = useCallback(() => {
    if (pushRefreshInFlightRef.current) {
      pushRefreshQueuedRef.current = true;
      return;
    }
    pushRefreshInFlightRef.current = true;
    refreshRoom()
      .catch(() => {
        setConnectionState('reconnecting');
      })
      .finally(() => {
        pushRefreshInFlightRef.current = false;
        if (pushRefreshQueuedRef.current) {
          pushRefreshQueuedRef.current = false;
          refreshFromPush();
        }
      });
  }, [refreshRoom]);

  const reconnectSession = useCallback(async (activeSession?: MultiplayerSession | null): Promise<boolean> => {
    const current = activeSession ?? session;
    if (!current) return false;
    try {
      const reconnected = await reconnectMultiplayerRoom(current, apiBase, expectedRevision);
      const nextSession: MultiplayerSession = {
        version: 1,
        roomCode: reconnected.roomCode,
        playerId: reconnected.playerId,
        sessionToken: reconnected.sessionToken,
        playerName: current.playerName,
        reconnectDeadlineMs: reconnected.reconnectDeadlineMs,
      };
      setSession(nextSession);
      saveStoredSession(nextSession);
      await refreshRoom(nextSession);
      setConnectionState('connected');
      onMetricEvent?.('multiplayer_reconnect_success');
      return true;
    } catch (reconnectError) {
      const code = reconnectError instanceof Error ? reconnectError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      onMetricEvent?.('multiplayer_reconnect_failed');
      return false;
    }
  }, [apiBase, expectedRevision, onMetricEvent, refreshRoom, session]);

  const hostRoom = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setConnectionState('connecting');
    setError(null);
    try {
      const nextName = sanitizeName(playerName);
      const created = await createMultiplayerRoom(nextName, apiBase);
      const nextSession: MultiplayerSession = {
        version: 1,
        roomCode: created.roomCode,
        playerId: created.playerId,
        sessionToken: created.sessionToken,
        playerName: nextName,
        reconnectDeadlineMs: created.reconnectDeadlineMs,
      };
      setPlayerName(nextName);
      setJoinCode(created.roomCode);
      setSession(nextSession);
      saveStoredSession(nextSession);
      await refreshRoom(nextSession);
      onMetricEvent?.('multiplayer_host_started');
      onMetricEvent?.('lan_room_hosted');
      return true;
    } catch (hostError) {
      const code = hostError instanceof Error ? hostError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      setConnectionState('disconnected');
      return false;
    } finally {
      setLoading(false);
    }
  }, [apiBase, onMetricEvent, playerName, refreshRoom]);

  const joinRoom = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setConnectionState('connecting');
    setError(null);
    try {
      const nextName = sanitizeName(playerName);
      const roomCode = sanitizeRoomCode(joinCode);
      const joined = await joinMultiplayerRoom(roomCode, nextName, apiBase);
      const nextSession: MultiplayerSession = {
        version: 1,
        roomCode: joined.roomCode,
        playerId: joined.playerId,
        sessionToken: joined.sessionToken,
        playerName: nextName,
        reconnectDeadlineMs: joined.reconnectDeadlineMs,
      };
      setPlayerName(nextName);
      setJoinCode(joined.roomCode);
      setSession(nextSession);
      saveStoredSession(nextSession);
      await refreshRoom(nextSession);
      onMetricEvent?.('multiplayer_join_success');
      onMetricEvent?.('lan_room_joined');
      return true;
    } catch (joinError) {
      const code = joinError instanceof Error ? joinError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      setConnectionState('disconnected');
      onMetricEvent?.('multiplayer_join_failed');
      return false;
    } finally {
      setLoading(false);
    }
  }, [apiBase, joinCode, onMetricEvent, playerName, refreshRoom]);

  const leaveRoomInternal = useCallback(async (forgetSession: boolean) => {
    const current = session;
    if (!current) {
      if (forgetSession) {
        clearSession();
      }
      return;
    }
    setLoading(true);
    try {
      await leaveMultiplayerRoom(current, apiBase, false, expectedRevision);
    } catch {
      // Best-effort leave; local cleanup still proceeds.
    } finally {
      if (forgetSession) {
        clearSession();
      } else {
        setRoomView(null);
      }
      setConnectionState('idle');
      setError(null);
      setLoading(false);
    }
  }, [apiBase, clearSession, expectedRevision, session]);

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
    setError(null);
    try {
      await startMultiplayerRoom(current, apiBase, expectedRevision, checkpointId);
      await refreshRoom(current);
    } catch (startError) {
      const code = startError instanceof Error ? startError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
    } finally {
      setLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const runAction = useCallback(async (index: number) => {
    const current = session;
    if (!current || !roomView) return;
    const selected = roomView.legalActions[index];
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      await applyMultiplayerAction(current, selected.action, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (actionError) {
      const code = actionError instanceof Error ? actionError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
    } finally {
      setLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, roomView, session]);

  const setReady = useCallback(async (ready: boolean) => {
    const current = session;
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      await setMultiplayerReady(current, ready, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (readyError) {
      const code = readyError instanceof Error ? readyError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
    } finally {
      setLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const sendReaction = useCallback(async (reaction: MultiplayerReaction) => {
    const current = session;
    if (!current || !reactionsEnabled) return;
    setError(null);
    try {
      await sendMultiplayerReaction(current, reaction, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (reactionError) {
      const code = reactionError instanceof Error ? reactionError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
    }
  }, [apiBase, expectedRevision, reactionsEnabled, refreshRoom, session]);

  const pauseMatch = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      await pauseMultiplayerRoom(current, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (pauseError) {
      const code = pauseError instanceof Error ? pauseError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const resumeMatch = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      await resumeMultiplayerRoom(current, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (resumeError) {
      const code = resumeError instanceof Error ? resumeError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const undoLastAction = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      await undoMultiplayerRoomAction(current, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (undoError) {
      const code = undoError instanceof Error ? undoError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const resetTurn = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      await resetMultiplayerRoomTurn(current, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (resetError) {
      const code = resetError instanceof Error ? resetError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const saveCheckpoint = useCallback(async (name: string) => {
    const current = session;
    if (!current) return;
    setCheckpointLoading(true);
    setError(null);
    try {
      await saveMultiplayerCheckpoint(current, name, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (saveError) {
      const code = saveError instanceof Error ? saveError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setCheckpointLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const loadCheckpoint = useCallback(async (checkpointId: string) => {
    const current = session;
    if (!current) return;
    setCheckpointLoading(true);
    setError(null);
    try {
      await loadMultiplayerCheckpoint(current, checkpointId, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (loadError) {
      const code = loadError instanceof Error ? loadError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setCheckpointLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const deleteCheckpoint = useCallback(async (checkpointId: string) => {
    const current = session;
    if (!current) return;
    setCheckpointLoading(true);
    setError(null);
    try {
      await deleteMultiplayerCheckpoint(current, checkpointId, apiBase, expectedRevision);
      await refreshRoom(current);
    } catch (deleteError) {
      const code = deleteError instanceof Error ? deleteError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      if (code === 'revision_conflict') {
        await refreshRoom(current).catch(() => {
          // leave the existing error for UI.
        });
      }
    } finally {
      setCheckpointLoading(false);
    }
  }, [apiBase, expectedRevision, refreshRoom, session]);

  const refreshCheckpoints = useCallback(async (): Promise<MultiplayerCheckpointSummary[]> => {
    const current = session;
    if (!current) return [];
    try {
      return await listMultiplayerCheckpoints(current, apiBase);
    } catch (listError) {
      const code = listError instanceof Error ? listError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      return [];
    }
  }, [apiBase, session]);

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
    if (!enabled || autoReconnectAttemptedRef.current) return;
    autoReconnectAttemptedRef.current = true;
    const stored = loadStoredSession();
    if (!stored) return;
    setPlayerName(stored.playerName);
    setJoinCode(stored.roomCode);
    setSession(stored);
    setConnectionState('reconnecting');
    reconnectSession(stored).catch(() => {
      // reconnectSession sets error state.
    });
  }, [enabled, reconnectSession]);

  useEffect(() => {
    if (!enabled || !session || !pushEnabled) {
      setPushState(pushEnabled ? 'connecting' : 'disabled');
      return;
    }

    pushFallbackMetricSentRef.current = false;
    setPushState('connecting');
    let cancelled = false;
    let subscription: { close: () => void } | null = null;

    try {
      subscription = subscribeMultiplayerRoomEvents(
        session,
        {
          onOpen: () => {
            if (cancelled) return;
            setPushState('connected');
            onMetricEvent?.('multiplayer_push_connected');
          },
          onEvent: (event) => {
            if (cancelled) return;
            if (event.eventId <= lastEventIdRef.current) return;
            lastEventIdRef.current = event.eventId;
            refreshFromPush();
          },
          onDisconnect: () => {
            if (cancelled) return;
            setPushState('fallback');
            onMetricEvent?.('multiplayer_push_disconnected');
            if (!pushFallbackMetricSentRef.current) {
              onMetricEvent?.('multiplayer_push_fallback');
              pushFallbackMetricSentRef.current = true;
            }
          },
        },
        apiBase,
        lastEventIdRef.current,
      );
    } catch (pushError) {
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
      subscription?.close();
    };
  }, [apiBase, enabled, onMetricEvent, pushEnabled, refreshFromPush, session]);

  useEffect(() => {
    if (!enabled || !session) return;
    const effectivePollIntervalMs = pushState === 'connected' ? Math.max(pollIntervalMs, 8_000) : pollIntervalMs;
    const timer = window.setInterval(() => {
      refreshRoom().catch(async () => {
        setConnectionState('reconnecting');
        reconnectAttemptRef.current += 1;
        const recovered = await reconnectSession();
        if (!recovered) {
          if (reconnectAttemptRef.current > 4) {
            setConnectionState('disconnected');
          }
          return;
        }
        reconnectAttemptRef.current = 0;
      });
    }, effectivePollIntervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, pollIntervalMs, pushState, reconnectSession, refreshRoom, session]);

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
    connectionState,
    pushState,
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
    reconnectSession: () => reconnectSession(),
    clearSession,
    setError,
  };
}
