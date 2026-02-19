import type { Action } from '../engine';
import type {
  MultiplayerCheckpointSummary,
  MultiplayerReaction,
  MultiplayerRoomEventEnvelope,
  MultiplayerRoomSessionResponse,
  MultiplayerRoomView,
  MultiplayerSession,
} from './multiplayerTypes';

function normalizeApiBase(input: string): string {
  return input.endsWith('/') ? input.slice(0, -1) : input;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isPrivateIpv4(hostname: string): boolean {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export interface ResolveMultiplayerApiBaseOptions {
  envUrl?: string | null;
  hostname?: string | null;
  origin?: string | null;
}

export interface MultiplayerFeatureFlags {
  multiplayerPushEnabled: boolean;
  multiplayerReactionsEnabled: boolean;
}

export interface MultiplayerLanOriginsResponse {
  origins: string[];
}

export const MULTIPLAYER_REACTION_OPTIONS: MultiplayerReaction[] = ['nice', 'wow', 'gg', 'oops'];

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

export function resolveMultiplayerFeatureFlags(): MultiplayerFeatureFlags {
  return {
    multiplayerPushEnabled: import.meta.env.VITE_MULTIPLAYER_PUSH_ENABLED !== 'false',
    multiplayerReactionsEnabled: import.meta.env.VITE_MULTIPLAYER_REACTIONS_ENABLED !== 'false',
  };
}

export function getMultiplayerApiBase(): string {
  return resolveMultiplayerApiBase({
    envUrl: import.meta.env.VITE_MULTIPLAYER_API_URL,
    hostname: typeof window !== 'undefined' ? window.location?.hostname : undefined,
    origin: typeof window !== 'undefined' ? window.location?.origin : undefined,
  });
}

export function isLanResolvableHost(hostname: string): boolean {
  return !isLocalHostname(hostname) && (isPrivateIpv4(hostname) || hostname.endsWith('.local'));
}

export function multiplayerErrorMessage(code: string): string {
  if (code === 'room_not_found') return 'Room code not found. Double-check the code and try again.';
  if (code === 'room_full') return 'This room is already full.';
  if (code === 'room_started') return 'This match already started. Re-enter from Multiplayer to reconnect, or ask the host for a fresh room.';
  if (code === 'invalid_session') return 'Your multiplayer session expired. Please rejoin the room.';
  if (code === 'reconnect_expired') return 'Rejoin window expired. Please rejoin with the room code.';
  if (code === 'minimum_players_required') return 'At least 2 players are required to start.';
  if (code === 'host_required') return 'Only the host can start this room.';
  if (code === 'room_paused') return 'The host paused this match.';
  if (code === 'revision_conflict') return 'Room state changed. Refreshing now.';
  if (code === 'no_turn_snapshot') return 'No undo snapshots are available for this turn.';
  if (code === 'checkpoint_slots_full') return 'Checkpoint slots are full. Delete one and try again.';
  if (code === 'checkpoint_not_found') return 'Checkpoint not found. Refresh the room and try again.';
  if (code === 'checkpoint_player_mismatch') return 'Checkpoint players do not match the current lobby lineup.';
  if (code === 'reaction_rate_limited') return 'Reaction sent too quickly. Please wait a moment.';
  if (code === 'reactions_disabled') return 'Reactions are disabled for this room.';
  if (code === 'chat_rate_limited') return 'Chat message sent too quickly. Please wait a moment.';
  if (code === 'chat_too_long') return 'Chat message is too long.';
  if (code === 'chat_empty') return 'Chat message cannot be empty.';
  if (code === 'push_disabled') return 'Live room updates are disabled for this server.';
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

export async function listMultiplayerLanOrigins(
  apiBase = getMultiplayerApiBase(),
  uiPort?: number,
): Promise<string[]> {
  const params = new URLSearchParams();
  if (typeof uiPort === 'number' && Number.isFinite(uiPort) && uiPort > 0) {
    params.set('uiPort', String(Math.floor(uiPort)));
  }
  const suffix = params.toString();
  const payload = await request<MultiplayerLanOriginsResponse>(
    `${apiBase}/api/multiplayer/dev/lan-origins${suffix ? `?${suffix}` : ''}`,
  );
  return Array.isArray(payload.origins) ? payload.origins.filter((origin) => typeof origin === 'string') : [];
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
  expectedRevision?: number,
): Promise<MultiplayerRoomSessionResponse> {
  return request<MultiplayerRoomSessionResponse>(
    `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/reconnect`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        expectedRevision,
      }),
    },
  );
}

export async function leaveMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  keepalive = false,
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/leave`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      expectedRevision,
    }),
    keepalive,
  });
}

export async function startMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
  checkpointId?: string,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      expectedRevision,
      checkpointId,
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
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      action,
      expectedRevision,
    }),
  });
}

export async function pauseMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      expectedRevision,
    }),
  });
}

export async function resumeMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/resume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      expectedRevision,
    }),
  });
}

export async function undoMultiplayerRoomAction(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      expectedRevision,
    }),
  });
}

export async function resetMultiplayerRoomTurn(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/reset-turn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      expectedRevision,
    }),
  });
}

export async function listMultiplayerCheckpoints(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
): Promise<MultiplayerCheckpointSummary[]> {
  const params = new URLSearchParams({
    playerId: session.playerId,
    sessionToken: session.sessionToken,
  });
  const payload = await request<{ checkpoints: MultiplayerCheckpointSummary[] }>(
    `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/checkpoints?${params.toString()}`,
  );
  return payload.checkpoints ?? [];
}

export async function saveMultiplayerCheckpoint(
  session: MultiplayerSession,
  name: string,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<MultiplayerCheckpointSummary> {
  const payload = await request<{ checkpoint: MultiplayerCheckpointSummary }>(
    `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/checkpoints/save`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        name,
        expectedRevision,
      }),
    },
  );
  return payload.checkpoint;
}

export async function loadMultiplayerCheckpoint(
  session: MultiplayerSession,
  checkpointId: string,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/checkpoints/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      checkpointId,
      expectedRevision,
    }),
  });
}

export async function deleteMultiplayerCheckpoint(
  session: MultiplayerSession,
  checkpointId: string,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/checkpoints/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      checkpointId,
      expectedRevision,
    }),
  });
}

export async function setMultiplayerReady(
  session: MultiplayerSession,
  ready: boolean,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/ready`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      ready,
      expectedRevision,
    }),
  });
}

export async function sendMultiplayerReaction(
  session: MultiplayerSession,
  reaction: MultiplayerReaction,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/reaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      reaction,
      expectedRevision,
    }),
  });
}

export async function sendMultiplayerChatMessage(
  session: MultiplayerSession,
  text: string,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      text,
      expectedRevision,
    }),
  });
}

export async function setMultiplayerTyping(
  session: MultiplayerSession,
  typing: boolean,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/typing`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerId: session.playerId,
      sessionToken: session.sessionToken,
      typing,
      expectedRevision,
    }),
  });
}

export interface MultiplayerRoomEventSubscription {
  close: () => void;
}

export interface MultiplayerRoomEventHandlers {
  onOpen?: () => void;
  onEvent: (event: MultiplayerRoomEventEnvelope) => void;
  onDisconnect?: () => void;
}

export function subscribeMultiplayerRoomEvents(
  session: MultiplayerSession,
  handlers: MultiplayerRoomEventHandlers,
  apiBase = getMultiplayerApiBase(),
  lastEventId?: number,
): MultiplayerRoomEventSubscription {
  if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
    throw new Error('push_not_supported');
  }
  const params = new URLSearchParams({
    playerId: session.playerId,
    sessionToken: session.sessionToken,
  });
  if (typeof lastEventId === 'number' && Number.isFinite(lastEventId) && lastEventId > 0) {
    params.set('lastEventId', String(lastEventId));
  }

  const source = new window.EventSource(
    `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/events?${params.toString()}`,
  );
  let closed = false;

  const handleEvent = (payload: string) => {
    try {
      const parsed = JSON.parse(payload) as MultiplayerRoomEventEnvelope;
      if (!parsed || typeof parsed !== 'object') return;
      if (typeof parsed.eventId !== 'number' || typeof parsed.revision !== 'number') return;
      handlers.onEvent(parsed);
    } catch {
      // ignore malformed event payloads
    }
  };

  source.addEventListener('open', () => {
    handlers.onOpen?.();
  });
  source.addEventListener('room_update', (event) => {
    const message = event as MessageEvent;
    if (typeof message.data === 'string') {
      handleEvent(message.data);
    }
  });
  source.onmessage = (event) => {
    if (typeof event.data === 'string') {
      handleEvent(event.data);
    }
  };
  source.onerror = () => {
    if (closed) return;
    handlers.onDisconnect?.();
    source.close();
  };

  return {
    close: () => {
      closed = true;
      source.close();
    },
  };
}
