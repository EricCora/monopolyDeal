import type { Action } from '../engine';
import type { CreateRoomResponse, JoinRoomResponse, LanRoomView, RoomSession } from './types';

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'request_failed';
    throw new Error(message);
  }
  return payload as T;
}

export async function createLanRoom(serverUrl: string, playerName: string): Promise<CreateRoomResponse> {
  const response = await fetch(`${serverUrl}/api/rooms/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerName }),
  });
  return parseJson<CreateRoomResponse>(response);
}

export async function joinLanRoom(serverUrl: string, roomCode: string, playerName: string): Promise<JoinRoomResponse> {
  const response = await fetch(`${serverUrl}/api/rooms/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, playerName }),
  });
  return parseJson<JoinRoomResponse>(response);
}

export async function startLanRoom(serverUrl: string, roomCode: string): Promise<void> {
  const response = await fetch(`${serverUrl}/api/rooms/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode }),
  });
  await parseJson<{ ok: true }>(response);
}

export async function loadLanRoomState(serverUrl: string, session: RoomSession): Promise<LanRoomView> {
  const params = new URLSearchParams({ roomCode: session.roomCode, playerId: session.playerId });
  const response = await fetch(`${serverUrl}/api/rooms/state?${params.toString()}`);
  return parseJson<LanRoomView>(response);
}

export async function applyLanRoomAction(serverUrl: string, roomCode: string, playerId: string, action: Action): Promise<void> {
  const response = await fetch(`${serverUrl}/api/rooms/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ roomCode, playerId, action }),
  });
  await parseJson<{ ok: true }>(response);
}
