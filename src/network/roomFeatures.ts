import type {
  MultiplayerReplayLog,
  MultiplayerRoomOptions,
  MultiplayerRoomSessionResponse,
  MultiplayerSession,
} from './multiplayerTypes';
import { routeRoomRequest, turnRoomOrigin } from './roomRouting';

async function send<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(routeRoomRequest(url, init), init);
  const payload = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'request_failed');
  return payload as T;
}

function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  return send<T>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

const roomUrl = (apiBase: string, code: string, operation: string) => (
  `${apiBase}/api/multiplayer/rooms/${encodeURIComponent(code)}/${operation}`
);

export function createTurnBasedRoom(playerName: string): Promise<MultiplayerRoomSessionResponse> {
  return post(`${turnRoomOrigin()}/api/multiplayer/rooms`, { playerName });
}

export function watchMultiplayerRoom(roomCode: string, playerName: string, apiBase: string): Promise<MultiplayerRoomSessionResponse> {
  return post(roomUrl(apiBase, roomCode, 'watch'), { playerName });
}

export async function setMultiplayerRoomOptions(
  session: MultiplayerSession,
  changes: Partial<MultiplayerRoomOptions>,
  apiBase: string,
): Promise<void> {
  await post(roomUrl(apiBase, session.roomCode, 'options'), { playerId: session.playerId, sessionToken: session.sessionToken, ...changes });
}

export function fetchMultiplayerReplay(session: MultiplayerSession, apiBase: string): Promise<MultiplayerReplayLog> {
  const params = new URLSearchParams({ playerId: session.playerId, sessionToken: session.sessionToken });
  return send(`${roomUrl(apiBase, session.roomCode, 'replay')}?${params.toString()}`);
}

export async function fetchTurnPushKey(): Promise<string | null> {
  const config = await send<{ pushPublicKey: string | null }>(`${turnRoomOrigin()}/api/multiplayer/turn-config`);
  return config.pushPublicKey;
}

export async function saveTurnPushSubscription(session: MultiplayerSession, subscription: PushSubscriptionJSON | null): Promise<void> {
  await post(roomUrl('', session.roomCode, 'push'), { playerId: session.playerId, sessionToken: session.sessionToken, subscription });
}
