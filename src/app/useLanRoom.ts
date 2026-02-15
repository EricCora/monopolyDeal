import { useCallback, useEffect, useState } from 'react';
import { applyLanRoomAction, createLanRoom, joinLanRoom, loadLanRoomState, startLanRoom } from '../network/lanClient';
import type { LanRoomView, RoomSession } from '../network/types';

interface UseLanRoomOptions {
  enabled: boolean;
  pollIntervalMs?: number;
}

export function useLanRoom({ enabled, pollIntervalMs = 2_000 }: UseLanRoomOptions) {
  const [lanServerUrl, setLanServerUrl] = useState('http://localhost:8787');
  const [lanPlayerName, setLanPlayerName] = useState('Player');
  const [lanJoinCode, setLanJoinCode] = useState('');
  const [lanSession, setLanSession] = useState<RoomSession | null>(null);
  const [lanRoomView, setLanRoomView] = useState<LanRoomView | null>(null);
  const [lanLoading, setLanLoading] = useState(false);
  const [lanError, setLanError] = useState<string | null>(null);

  const refreshLanState = useCallback(async () => {
    if (!lanSession) return;
    const next = await loadLanRoomState(lanServerUrl, lanSession);
    setLanRoomView(next);
  }, [lanServerUrl, lanSession]);

  const refreshLanStateInteractive = useCallback(async () => {
    setLanLoading(true);
    setLanError(null);
    try {
      await refreshLanState();
    } catch (refreshError) {
      setLanError(refreshError instanceof Error ? refreshError.message : 'Could not refresh room state.');
    } finally {
      setLanLoading(false);
    }
  }, [refreshLanState]);

  const hostLanRoom = useCallback(async (): Promise<boolean> => {
    setLanLoading(true);
    setLanError(null);
    try {
      const session = await createLanRoom(lanServerUrl, lanPlayerName);
      setLanSession(session);
      setLanJoinCode(session.roomCode);
      const next = await loadLanRoomState(lanServerUrl, session);
      setLanRoomView(next);
      return true;
    } catch (hostError) {
      setLanError(hostError instanceof Error ? hostError.message : 'Could not host room.');
      return false;
    } finally {
      setLanLoading(false);
    }
  }, [lanPlayerName, lanServerUrl]);

  const joinLanRoomSession = useCallback(async (): Promise<boolean> => {
    setLanLoading(true);
    setLanError(null);
    try {
      const session = await joinLanRoom(lanServerUrl, lanJoinCode, lanPlayerName);
      setLanSession(session);
      const next = await loadLanRoomState(lanServerUrl, session);
      setLanRoomView(next);
      return true;
    } catch (joinError) {
      setLanError(joinError instanceof Error ? joinError.message : 'Could not join room.');
      return false;
    } finally {
      setLanLoading(false);
    }
  }, [lanJoinCode, lanPlayerName, lanServerUrl]);

  const startLanRoomMatch = useCallback(async () => {
    if (!lanSession) return;
    setLanLoading(true);
    setLanError(null);
    try {
      await startLanRoom(lanServerUrl, lanSession.roomCode);
      await refreshLanState();
    } catch (startError) {
      setLanError(startError instanceof Error ? startError.message : 'Could not start room.');
    } finally {
      setLanLoading(false);
    }
  }, [lanServerUrl, lanSession, refreshLanState]);

  const runLanAction = useCallback(async (index: number) => {
    if (!lanSession || !lanRoomView) return;
    const selected = lanRoomView.legalActions[index];
    if (!selected) return;
    setLanLoading(true);
    setLanError(null);
    try {
      await applyLanRoomAction(lanServerUrl, lanSession.roomCode, lanSession.playerId, selected.action);
      await refreshLanState();
    } catch (actionError) {
      setLanError(actionError instanceof Error ? actionError.message : 'Could not apply room action.');
    } finally {
      setLanLoading(false);
    }
  }, [lanRoomView, lanServerUrl, lanSession, refreshLanState]);

  useEffect(() => {
    if (!enabled || !lanSession) return;
    const timer = window.setInterval(() => {
      refreshLanState().catch(() => {
        // Best-effort polling; manual refresh remains available in UI.
      });
    }, pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [enabled, lanSession, pollIntervalMs, refreshLanState]);

  return {
    lanServerUrl,
    setLanServerUrl,
    lanPlayerName,
    setLanPlayerName,
    lanJoinCode,
    setLanJoinCode,
    lanSession,
    lanRoomView,
    lanLoading,
    lanError,
    setLanError,
    hostLanRoom,
    joinLanRoomSession,
    startLanRoomMatch,
    refreshLanStateInteractive,
    runLanAction,
  };
}
