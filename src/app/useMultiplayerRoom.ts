import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyMultiplayerAction,
  checkMultiplayerHealth,
  createMultiplayerRoom,
  getMultiplayerApiBase,
  joinMultiplayerRoom,
  leaveMultiplayerRoom,
  loadMultiplayerRoomState,
  multiplayerErrorMessage,
  reconnectMultiplayerRoom,
  startMultiplayerRoom,
} from '../network/multiplayerClient';
import type { MultiplayerConnectionState, MultiplayerRoomView, MultiplayerSession } from '../network/multiplayerTypes';

interface UseMultiplayerRoomOptions {
  enabled: boolean;
  pollIntervalMs?: number;
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

export function useMultiplayerRoom({ enabled, pollIntervalMs = 2_000 }: UseMultiplayerRoomOptions) {
  const [apiBase] = useState(() => getMultiplayerApiBase());
  const [playerName, setPlayerName] = useState('Player');
  const [joinCode, setJoinCode] = useState('');
  const [session, setSession] = useState<MultiplayerSession | null>(null);
  const [roomView, setRoomView] = useState<MultiplayerRoomView | null>(null);
  const [connectionState, setConnectionState] = useState<MultiplayerConnectionState>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const reconnectAttemptRef = useRef(0);
  const autoReconnectAttemptedRef = useRef(false);

  const clearSession = useCallback(() => {
    setSession(null);
    setRoomView(null);
    saveStoredSession(null);
  }, []);

  const refreshRoom = useCallback(async (activeSession?: MultiplayerSession | null): Promise<MultiplayerRoomView | null> => {
    const current = activeSession ?? session;
    if (!current) return null;
    const next = await loadMultiplayerRoomState(current, apiBase);
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

  const reconnectSession = useCallback(async (activeSession?: MultiplayerSession | null): Promise<boolean> => {
    const current = activeSession ?? session;
    if (!current) return false;
    try {
      const reconnected = await reconnectMultiplayerRoom(current, apiBase);
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
      return true;
    } catch (reconnectError) {
      const code = reconnectError instanceof Error ? reconnectError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      return false;
    }
  }, [apiBase, refreshRoom, session]);

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
      return true;
    } catch (hostError) {
      const code = hostError instanceof Error ? hostError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      setConnectionState('disconnected');
      return false;
    } finally {
      setLoading(false);
    }
  }, [apiBase, playerName, refreshRoom]);

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
      return true;
    } catch (joinError) {
      const code = joinError instanceof Error ? joinError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
      setConnectionState('disconnected');
      return false;
    } finally {
      setLoading(false);
    }
  }, [apiBase, joinCode, playerName, refreshRoom]);

  const leaveRoom = useCallback(async () => {
    const current = session;
    if (!current) {
      clearSession();
      return;
    }
    setLoading(true);
    try {
      await leaveMultiplayerRoom(current, apiBase);
    } catch {
      // Best-effort leave; local cleanup still proceeds.
    } finally {
      clearSession();
      setConnectionState('idle');
      setLoading(false);
    }
  }, [apiBase, clearSession, session]);

  const startMatch = useCallback(async () => {
    const current = session;
    if (!current) return;
    setLoading(true);
    setError(null);
    try {
      await startMultiplayerRoom(current, apiBase);
      await refreshRoom(current);
    } catch (startError) {
      const code = startError instanceof Error ? startError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
    } finally {
      setLoading(false);
    }
  }, [apiBase, refreshRoom, session]);

  const runAction = useCallback(async (index: number) => {
    const current = session;
    if (!current || !roomView) return;
    const selected = roomView.legalActions[index];
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      await applyMultiplayerAction(current, selected.action, apiBase);
      await refreshRoom(current);
    } catch (actionError) {
      const code = actionError instanceof Error ? actionError.message : 'request_failed';
      setError(multiplayerErrorMessage(code));
    } finally {
      setLoading(false);
    }
  }, [apiBase, refreshRoom, roomView, session]);

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
    if (!enabled || !session) return;
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
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, pollIntervalMs, reconnectSession, refreshRoom, session]);

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
    healthOk,
    playerName,
    setPlayerName,
    joinCode,
    setJoinCode: (value: string) => setJoinCode(sanitizeRoomCode(value)),
    session,
    roomView,
    loading,
    error,
    connectionState,
    isHost,
    hostRoom,
    joinRoom,
    startMatch,
    runAction,
    leaveRoom,
    refreshRoom: () => refreshRoom(),
    reconnectSession: () => reconnectSession(),
    clearSession,
    setError,
  };
}
