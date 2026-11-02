import type { MultiplayerSession } from './multiplayerTypes';

/** Turn-by-turn rooms have longer codes, and live on the website instead of the room server. */
export const TURN_ROOM_CODE_LENGTH = 6;

export function isTurnRoomCode(code: string): boolean {
  return code.trim().length === TURN_ROOM_CODE_LENGTH;
}

export function turnRoomOrigin(): string {
  return `${typeof window === 'undefined' ? '' : window.location.origin}/api/turn`;
}

export function routeRoomRequest(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== 'string') return input;
  const match = input.match(/\/api\/multiplayer\/rooms\/([^/?]+)/);
  if (!match || !isTurnRoomCode(decodeURIComponent(match[1]))) return input;
  return `${turnRoomOrigin()}${input.slice(input.indexOf('/api/multiplayer'))}`;
}

/** These sessions use plain requests: turn rooms have no socket server, and spectators hold no seat. */
export function usesRequestsOnly(session: MultiplayerSession): boolean {
  return isTurnRoomCode(session.roomCode) || session.playerId.startsWith('s');
}
