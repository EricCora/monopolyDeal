import type { Action } from '../engine';
import type { MultiplayerRoomSessionResponse, MultiplayerRoomView, MultiplayerSession } from './multiplayerTypes';

function normalizeApiBase(input: string): string {
  return input.endsWith('/') ? input.slice(0, -1) : input;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export interface ResolveMultiplayerApiBaseOptions {
  envUrl?: string | null;
  hostname?: string | null;
  origin?: string | null;
}

export function resolveMultiplayerApiBase({ envUrl, hostname, origin }: ResolveMultiplayerApiBaseOptions): string {
  if (typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return normalizeApiBase(envUrl.trim());
  }
  if (typeof hostname === 'string' && isLocalHostname(hostname)) {
    return 'http://localhost:8787';
  }
  if (typeof origin === 'string' && origin.trim().length > 0) {
    return normalizeApiBase(origin.trim());
  }
  return 'http://localhost:8787';
}

export function getMultiplayerApiBase(): string {
  return resolveMultiplayerApiBase({
    envUrl: import.meta.env.VITE_MULTIPLAYER_API_URL,
    hostname: typeof window !== 'undefined' ? window.location?.hostname : undefined,
    origin: typeof window !== 'undefined' ? window.location?.origin : undefined,
  });
}

export function multiplayerErrorMessage(code: string): string {
  if (code === 'room_not_found') return 'Room code not found. Double-check the code and try again.';
  if (code === 'room_full') return 'This room is already full.';
  if (code === 'room_started') return 'This match already started. Ask the host for a fresh room code.';
  if (code === 'invalid_session') return 'Your multiplayer session expired. Please rejoin the room.';
  if (code === 'reconnect_expired') return 'Rejoin window expired. Please rejoin with the room code.';
  if (code === 'minimum_players_required') return 'At least 2 players are required to start.';
  if (code === 'host_required') return 'Only the host can start this room.';
  if (code === 'network_unavailable' || code === 'request_failed') return 'Couldn\'t connect right now. Retrying...';
  return 'Could not complete multiplayer request. Please try again.';
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'request_failed';
    throw new Error(message);
  }
  return payload as T;
}

async function request<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(input, init);
    return parseJson<T>(response);
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw error;
    }
    throw new Error('network_unavailable');
  }
}

export async function checkMultiplayerHealth(apiBase = getMultiplayerApiBase()): Promise<boolean> {
  const payload = await request<{ ok: true }>(`${apiBase}/api/multiplayer/health`);
  return payload.ok === true;
}

export async function createMultiplayerRoom(
  playerName: string,
  apiBase = getMultiplayerApiBase(),
): Promise<MultiplayerRoomSessionResponse> {
  return request<MultiplayerRoomSessionResponse>(`${apiBase}/api/multiplayer/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName }),
  });
}

export async function joinMultiplayerRoom(
  roomCode: string,
  playerName: string,
  apiBase = getMultiplayerApiBase(),
): Promise<MultiplayerRoomSessionResponse> {
  return request<MultiplayerRoomSessionResponse>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(roomCode)}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName }),
  });
}

export async function reconnectMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
): Promise<MultiplayerRoomSessionResponse> {
  return request<MultiplayerRoomSessionResponse>(
    `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/reconnect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
      }),
    },
  );
}

export async function leaveMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  keepalive = false,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
    }),
    keepalive,
  });
}

export async function startMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
    }),
  });
}

export async function loadMultiplayerRoomState(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
): Promise<MultiplayerRoomView> {
  const params = new URLSearchParams({
    playerId: session.playerId,
    sessionToken: session.sessionToken,
  });
  return request<MultiplayerRoomView>(
    `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/state?${params.toString()}`,
  );
}

export async function applyMultiplayerAction(
  session: MultiplayerSession,
  action: Action,
  apiBase = getMultiplayerApiBase(),
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      action,
    }),
  });
}
