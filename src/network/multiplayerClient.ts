import type { Action } from '../engine';
import { io, type Socket } from 'socket.io-client';
import type {
  MultiplayerActionRejectedResponse,
  MultiplayerCheckpointSummary,
  MultiplayerReaction,
  MultiplayerResumeRoomResponse,
  MultiplayerRoomEventEnvelope,
  MultiplayerRoomSessionResponse,
  MultiplayerSocketAck,
  MultiplayerSocketCommandName,
  MultiplayerSocketCommandPayloadMap,
  MultiplayerSocketCommandResponseMap,
  MultiplayerSocketError,
  MultiplayerTransportMode,
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
  mpReconnectDebugEnabled: boolean;
}

export interface MultiplayerLanOriginsResponse {
  origins: string[];
}

export const MULTIPLAYER_REACTION_OPTIONS: MultiplayerReaction[] = ['nice', 'wow', 'gg', 'oops'];

const SOCKET_ACK_TIMEOUT_MS = 3_500;
const SOCKET_CONNECT_TIMEOUT_MS = 3_500;
const SOCKET_TRANSPORT_ENABLED = import.meta.env.MODE !== 'test'
  && import.meta.env.VITE_MULTIPLAYER_SOCKET_ENABLED !== 'false';

type MultiplayerTransportError = Error & {
  details?: MultiplayerActionRejectedResponse | Record<string, unknown>;
  transportFailure?: boolean;
};

interface SocketTransportState {
  socket: Socket | null;
  sessionKey: string | null;
}

const socketTransportState: SocketTransportState = {
  socket: null,
  sessionKey: null,
};

let multiplayerTransportMode: MultiplayerTransportMode = 'http_fallback';
const transportModeListeners = new Set<(mode: MultiplayerTransportMode) => void>();

function setMultiplayerTransportMode(mode: MultiplayerTransportMode): void {
  if (multiplayerTransportMode === mode) return;
  multiplayerTransportMode = mode;
  for (const listener of transportModeListeners) {
    listener(mode);
  }
}

export function getMultiplayerTransportMode(): MultiplayerTransportMode {
  return multiplayerTransportMode;
}

export function subscribeMultiplayerTransportMode(
  listener: (mode: MultiplayerTransportMode) => void,
): () => void {
  transportModeListeners.add(listener);
  listener(multiplayerTransportMode);
  return () => {
    transportModeListeners.delete(listener);
  };
}

function createTransportError(
  code: string,
  options: {
    details?: MultiplayerActionRejectedResponse | Record<string, unknown>;
    transportFailure?: boolean;
  } = {},
): MultiplayerTransportError {
  const error = new Error(code) as MultiplayerTransportError;
  if (options.details) {
    error.details = options.details;
  }
  if (options.transportFailure) {
    error.transportFailure = true;
  }
  return error;
}

function isTransportFailure(error: unknown): boolean {
  return Boolean((error as MultiplayerTransportError | undefined)?.transportFailure);
}

function normalizeSocketError(
  error: MultiplayerSocketError,
): MultiplayerTransportError {
  if (error.code === 'action_rejected') {
    const reason = error.message === 'stale_state'
      || error.message === 'not_your_turn'
      || error.message === 'prompt_mismatch'
      ? error.message
      : 'invalid_action';
    return createTransportError('action_rejected', {
      details: {
        error: 'action_rejected',
        reason,
        serverStateVersion: Number.isFinite(error.serverStateVersion) ? Number(error.serverStateVersion) : 0,
        requiresResync: Boolean(error.requiresResync),
      },
    });
  }
  return createTransportError(error.code || 'request_failed', {
    details: error.serverStateVersion != null || error.requiresResync != null
      ? {
          serverStateVersion: error.serverStateVersion,
          requiresResync: error.requiresResync,
        }
      : undefined,
  });
}

function socketSessionKey(session: MultiplayerSession, apiBase: string): string {
  const seatId = session.seatId ?? session.playerId;
  const resumeToken = session.resumeToken ?? session.sessionToken;
  return `${apiBase}|${session.roomCode}|${seatId}|${resumeToken}`;
}

function clearSocketTransport(): void {
  socketTransportState.socket?.removeAllListeners();
  socketTransportState.socket?.disconnect();
  socketTransportState.socket = null;
  socketTransportState.sessionKey = null;
}

export function disconnectMultiplayerSocketTransport(): void {
  clearSocketTransport();
  setMultiplayerTransportMode('http_fallback');
}

function getSocketAuth(session: MultiplayerSession): Record<string, unknown> {
  return {
    roomCode: session.roomCode,
    seatId: session.seatId,
    resumeToken: session.resumeToken,
    playerId: session.playerId,
    sessionToken: session.sessionToken,
  };
}

function ensureSocket(
  session: MultiplayerSession,
  apiBase: string,
): Socket {
  const key = socketSessionKey(session, apiBase);
  if (socketTransportState.socket && socketTransportState.sessionKey === key) {
    return socketTransportState.socket;
  }
  clearSocketTransport();

  const socket = io(apiBase, {
    transports: ['websocket', 'polling'],
    autoConnect: false,
    timeout: SOCKET_CONNECT_TIMEOUT_MS,
    auth: getSocketAuth(session),
  });

  socket.on('connect', () => {
    setMultiplayerTransportMode('socket_primary');
  });
  socket.on('connect_error', () => {
    setMultiplayerTransportMode('http_fallback');
  });
  socket.on('disconnect', () => {
    setMultiplayerTransportMode('http_fallback');
  });

  socketTransportState.socket = socket;
  socketTransportState.sessionKey = key;
  return socket;
}

function ensureSocketReady(socket: Socket): Promise<void> {
  if (socket.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      if (timeoutId != null) {
        globalThis.clearTimeout(timeoutId);
      }
    };
    const onConnect = () => {
      cleanup();
      resolve();
    };
    const onConnectError = (error: unknown) => {
      cleanup();
      const code = error instanceof Error ? error.message : 'request_failed';
      reject(createTransportError(code || 'request_failed', { transportFailure: true }));
    };
    timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(createTransportError('request_failed', { transportFailure: true }));
    }, SOCKET_CONNECT_TIMEOUT_MS);
    socket.once('connect', onConnect);
    socket.once('connect_error', onConnectError);
    socket.connect();
  });
}

async function runSocketCommand<Name extends MultiplayerSocketCommandName>(
  session: MultiplayerSession,
  apiBase: string,
  command: Name,
  payload: MultiplayerSocketCommandPayloadMap[Name],
): Promise<MultiplayerSocketCommandResponseMap[Name]> {
  if (!SOCKET_TRANSPORT_ENABLED) {
    throw createTransportError('request_failed', { transportFailure: true });
  }
  if (typeof window === 'undefined') {
    throw createTransportError('request_failed', { transportFailure: true });
  }
  const socket = ensureSocket(session, apiBase);
  await ensureSocketReady(socket);

  return new Promise((resolve, reject) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = (fn: () => void) => {
      if (timeoutId != null) {
        globalThis.clearTimeout(timeoutId);
      }
      fn();
    };
    timeoutId = globalThis.setTimeout(() => {
      finish(() => {
        setMultiplayerTransportMode('http_fallback');
        reject(createTransportError('request_failed', { transportFailure: true }));
      });
    }, SOCKET_ACK_TIMEOUT_MS);

    socket.emit(
      command,
      payload,
      (ack: MultiplayerSocketAck<MultiplayerSocketCommandResponseMap[Name]>) => {
        finish(() => {
          if (!ack || typeof ack !== 'object') {
            setMultiplayerTransportMode('http_fallback');
            reject(createTransportError('request_failed', { transportFailure: true }));
            return;
          }
          if (!ack.ok) {
            reject(normalizeSocketError(ack.error));
            return;
          }
          setMultiplayerTransportMode('socket_primary');
          resolve(ack.payload);
        });
      },
    );
  });
}

async function withSocketFallback<T>(
  runSocket: () => Promise<T>,
  runHttp: () => Promise<T>,
): Promise<T> {
  try {
    return await runSocket();
  } catch (error) {
    if (!isTransportFailure(error)) {
      throw error;
    }
    setMultiplayerTransportMode('http_fallback');
    return runHttp();
  }
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

export function resolveMultiplayerFeatureFlags(): MultiplayerFeatureFlags {
  return {
    multiplayerPushEnabled: import.meta.env.VITE_MULTIPLAYER_PUSH_ENABLED !== 'false',
    multiplayerReactionsEnabled: import.meta.env.VITE_MULTIPLAYER_REACTIONS_ENABLED !== 'false',
    mpReconnectDebugEnabled: import.meta.env.VITE_MP_RECONNECT_DEBUG === 'true',
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
  if (code === 'room_closed') return 'This room is no longer available.';
  if (code === 'room_full') return 'This room is already full.';
  if (code === 'room_started') return 'This match already started. Re-enter from Multiplayer to reconnect, or ask the host for a fresh room.';
  if (code === 'invalid_session') return 'Your multiplayer session expired. Please rejoin the room.';
  if (code === 'invalid_token') return 'Could not verify your reconnect credentials. Please rejoin the room.';
  if (code === 'reconnect_expired') return 'Rejoin window expired. Please rejoin with the room code.';
  if (code === 'seat_timed_out') return 'Your reconnect window expired. Rejoin with the room code.';
  if (code === 'protocol_mismatch') return 'Reconnect protocol mismatch. Please refresh and try again.';
  if (code === 'minimum_players_required') return 'At least 2 players are required to start.';
  if (code === 'host_required') return 'Only the host can start this room.';
  if (code === 'room_paused') return 'The host paused this match.';
  if (code === 'revision_conflict') return 'Room state changed. Refreshing now.';
  if (code === 'action_rejected') return 'Action no longer applies to the latest room state. Syncing now.';
  if (code === 'stale_state') return 'Room state changed. Syncing to latest state now.';
  if (code === 'not_your_turn') return 'It is no longer your turn to act.';
  if (code === 'prompt_mismatch') return 'That prompt changed before your action was processed.';
  if (code === 'invalid_action') return 'That action is no longer valid in the current room state.';
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
    const error = new Error(message) as Error & {
      details?: MultiplayerActionRejectedResponse | Record<string, unknown>;
    };
    if (payload && typeof payload === 'object') {
      error.details = payload as MultiplayerActionRejectedResponse | Record<string, unknown>;
    }
    throw error;
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
): Promise<MultiplayerRoomSessionResponse | MultiplayerResumeRoomResponse> {
  const useCanonicalIdentity = Boolean(session.seatId && session.resumeToken);
  return withSocketFallback<MultiplayerRoomSessionResponse | MultiplayerResumeRoomResponse>(
    () => runSocketCommand(session, apiBase, 'mp:cmd:reconnect', { expectedRevision }),
    () => request<MultiplayerRoomSessionResponse>(
      `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/reconnect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(useCanonicalIdentity
            ? {
                seatId: session.seatId,
                resumeToken: session.resumeToken,
              }
            : {
                playerId: session.playerId,
                sessionToken: session.sessionToken,
              }),
          // Send compatibility identity fields while the server migration is in-flight.
          playerId: session.playerId,
          sessionToken: session.sessionToken,
          expectedRevision,
        }),
      },
    ),
  );
}

export async function leaveMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  keepalive = false,
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:leave', { expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        expectedRevision,
      }),
      keepalive,
    }).then(() => undefined),
  );
}

export async function startMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
  checkpointId?: string,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:start', { expectedRevision, checkpointId }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        expectedRevision,
        checkpointId,
      }),
    }).then(() => undefined),
  );
}

export async function loadMultiplayerRoomState(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
): Promise<MultiplayerRoomView> {
  const params = new URLSearchParams({
    playerId: session.playerId,
    sessionToken: session.sessionToken,
  });
  return withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:state', {}),
    () => request<MultiplayerRoomView>(
      `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/state?${params.toString()}`,
    ),
  );
}

export async function applyMultiplayerAction(
  session: MultiplayerSession,
  action: Action,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
  options?: {
    clientStateVersion?: number;
    actionId?: string;
  },
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:action', {
      action,
      expectedRevision,
      clientStateVersion: options?.clientStateVersion,
      actionId: options?.actionId,
    }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        action,
        expectedRevision,
        clientStateVersion: options?.clientStateVersion,
        actionId: options?.actionId,
      }),
    }).then(() => undefined),
  );
}

export async function pauseMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:pause', { expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export async function resumeMultiplayerRoom(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:resume', { expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export async function undoMultiplayerRoomAction(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:undo', { expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/undo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export async function resetMultiplayerRoomTurn(
  session: MultiplayerSession,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:reset_turn', { expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/reset-turn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
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
  return withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:checkpoint_save', { name, expectedRevision })
      .then((payload) => payload.checkpoint),
    async () => {
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
    },
  );
}

export async function loadMultiplayerCheckpoint(
  session: MultiplayerSession,
  checkpointId: string,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:checkpoint_load', { checkpointId, expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/checkpoints/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        checkpointId,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export async function deleteMultiplayerCheckpoint(
  session: MultiplayerSession,
  checkpointId: string,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:checkpoint_delete', { checkpointId, expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/checkpoints/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        checkpointId,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export async function setMultiplayerReady(
  session: MultiplayerSession,
  ready: boolean,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:ready', { ready, expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        ready,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export async function sendMultiplayerReaction(
  session: MultiplayerSession,
  reaction: MultiplayerReaction,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:reaction', { reaction, expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        reaction,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export async function sendMultiplayerChatMessage(
  session: MultiplayerSession,
  text: string,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:chat', { text, expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        text,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export async function setMultiplayerTyping(
  session: MultiplayerSession,
  typing: boolean,
  apiBase = getMultiplayerApiBase(),
  expectedRevision?: number,
): Promise<void> {
  await withSocketFallback(
    () => runSocketCommand(session, apiBase, 'mp:cmd:typing', { typing, expectedRevision }).then(() => undefined),
    () => request<{ ok: true }>(`${apiBase}/api/multiplayer/rooms/${encodeURIComponent(session.roomCode)}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerId: session.playerId,
        sessionToken: session.sessionToken,
        typing,
        expectedRevision,
      }),
    }).then(() => undefined),
  );
}

export interface MultiplayerRoomEventSubscription {
  close: () => void;
}

export interface MultiplayerRoomEventHandlers {
  onOpen?: () => void;
  onEvent: (event: MultiplayerRoomEventEnvelope) => void;
  onDisconnect?: () => void;
}

function subscribeRoomEventsViaEventSource(
  session: MultiplayerSession,
  handlers: MultiplayerRoomEventHandlers,
  apiBase: string,
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

export function subscribeMultiplayerRoomEvents(
  session: MultiplayerSession,
  handlers: MultiplayerRoomEventHandlers,
  apiBase = getMultiplayerApiBase(),
  lastEventId?: number,
): MultiplayerRoomEventSubscription {
  if (!SOCKET_TRANSPORT_ENABLED) {
    return subscribeRoomEventsViaEventSource(session, handlers, apiBase, lastEventId);
  }
  if (typeof window === 'undefined') {
    throw new Error('push_not_supported');
  }

  let fallbackSubscription: MultiplayerRoomEventSubscription | null = null;
  let socket: Socket | null = null;
  let closed = false;
  let fallbackActivated = false;
  let connectedViaSocket = false;
  let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;

  const handleSocketEvent = (event: MultiplayerRoomEventEnvelope) => {
    if (!event || typeof event !== 'object') return;
    if (typeof event.eventId !== 'number' || typeof event.revision !== 'number') return;
    handlers.onEvent(event);
  };

  const clearBootstrapTimer = () => {
    if (bootstrapTimer != null) {
      globalThis.clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
    }
  };

  const activateFallback = () => {
    if (closed || fallbackActivated) return;
    fallbackActivated = true;
    clearBootstrapTimer();
    setMultiplayerTransportMode('http_fallback');
    if (socket) {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('room_update', handleSocketEvent);
    }
    try {
      fallbackSubscription = subscribeRoomEventsViaEventSource(session, handlers, apiBase, lastEventId);
    } catch {
      handlers.onDisconnect?.();
    }
  };

  const onConnect = () => {
    if (closed || fallbackActivated) return;
    connectedViaSocket = true;
    clearBootstrapTimer();
    setMultiplayerTransportMode('socket_primary');
    handlers.onOpen?.();
  };

  const onDisconnect = () => {
    if (closed) return;
    if (!connectedViaSocket) {
      activateFallback();
      return;
    }
    setMultiplayerTransportMode('http_fallback');
    handlers.onDisconnect?.();
  };

  const onConnectError = () => {
    if (closed) return;
    activateFallback();
  };

  try {
    socket = ensureSocket(session, apiBase);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('room_update', handleSocketEvent);
    bootstrapTimer = globalThis.setTimeout(() => {
      if (connectedViaSocket || closed) return;
      activateFallback();
    }, SOCKET_CONNECT_TIMEOUT_MS);
    socket.connect();
  } catch {
    activateFallback();
  }

  return {
    close: () => {
      closed = true;
      clearBootstrapTimer();
      if (fallbackSubscription) {
        fallbackSubscription.close();
      }
      if (socket) {
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onConnectError);
        socket.off('room_update', handleSocketEvent);
      }
    },
  };
}
