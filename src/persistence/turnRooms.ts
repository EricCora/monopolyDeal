import type { MultiplayerSession } from '../network/multiplayerTypes';

// Turn-by-turn rooms last for days and a player can be in several, so this browser remembers
// each seat separately from the single live room it can return to.

const TURN_ROOMS_KEY = 'monopolyDeal.turnRooms.v1';
const MAX_TURN_ROOMS = 12;

export function loadTurnRooms(): MultiplayerSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(TURN_ROOMS_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is MultiplayerSession => (
      Boolean(entry) && typeof entry.roomCode === 'string' && typeof entry.sessionToken === 'string'
    )) : [];
  } catch {
    return [];
  }
}

export function rememberTurnRoom(session: MultiplayerSession): void {
  const others = loadTurnRooms().filter((entry) => entry.roomCode !== session.roomCode);
  localStorage.setItem(TURN_ROOMS_KEY, JSON.stringify([session, ...others].slice(0, MAX_TURN_ROOMS)));
}

export function forgetTurnRoom(roomCode: string): void {
  localStorage.setItem(TURN_ROOMS_KEY, JSON.stringify(loadTurnRooms().filter((entry) => entry.roomCode !== roomCode)));
}
