import type { MultiplayerSession } from './multiplayerTypes';

/** Turn-by-turn rooms have longer codes, and live on the website instead of the room server. */
export const TURN_ROOM_CODE_LENGTH = 6;

export function isTurnRoomCode(code: string): boolean {
  return code.trim().length === TURN_ROOM_CODE_LENGTH;
}

export function turnRoomOrigin(): string {
  return `${typeof window === 'undefined' ? '' : window.location.origin}/api/turn`;
}

/** How long after opening a room or changing it this client reads past the storage cache. */
const FRESH_READ_MS = 15_000;
const freshReadsUntil = new Map<string, number>();

/** Routine polls can be a minute old. Your own move, and a room you've just opened, can't. */
function withFreshRead(url: string, code: string, init?: RequestInit): string {
  const now = Date.now();
  if ((init?.method ?? 'GET') !== 'GET') {
    freshReadsUntil.set(code, now + FRESH_READ_MS);
    return url;
  }
  if (!/\/state(\?|$)/.test(url)) return url;
  if (!freshReadsUntil.has(code)) freshReadsUntil.set(code, now + FRESH_READ_MS);
  if (now >= (freshReadsUntil.get(code) ?? 0)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}fresh=1`;
}

export function routeRoomRequest(input: RequestInfo | URL, init?: RequestInit): RequestInfo | URL {
  if (typeof input !== 'string') return input;
  const match = input.match(/\/api\/multiplayer\/rooms\/([^/?]+)/);
  if (!match) return input;
  const code = decodeURIComponent(match[1]);
  if (!isTurnRoomCode(code)) return input;
  return withFreshRead(`${turnRoomOrigin()}${input.slice(input.indexOf('/api/multiplayer'))}`, code.toUpperCase(), init);
}

/** These sessions use plain requests: turn rooms have no socket server, and spectators hold no seat. */
export function usesRequestsOnly(session: MultiplayerSession): boolean {
  return isTurnRoomCode(session.roomCode) || session.playerId.startsWith('s');
}
