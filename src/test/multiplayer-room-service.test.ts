import { describe, expect, it } from 'vitest';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  pruneInactiveRooms,
  roomView,
  type MultiplayerRoom,
} from '../../apps/server/src/gameService.ts';

function findParticipant(room: MultiplayerRoom, playerId: string) {
  const participant = room.players.find((player) => player.id === playerId);
  expect(participant).toBeDefined();
  if (!participant) {
    throw new Error(`Missing participant ${playerId}`);
  }
  return participant;
}

function fillLobby(room: MultiplayerRoom) {
  const p2 = joinRoom(room, 'Player 2');
  const p3 = joinRoom(room, 'Player 3');
  const p4 = joinRoom(room, 'Player 4');
  return [p2, p3, p4];
}

describe('multiplayer room service lifecycle', () => {
  it('refreshes room activity timestamp on state polls', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    room.updatedAt = Date.now() - 31 * 60 * 1000;
    const previousUpdatedAt = room.updatedAt;

    roomView(room, session.playerId, session.sessionToken);

    expect(room.updatedAt).toBeGreaterThan(previousUpdatedAt);
  });

  it('keeps active room alive when poll heartbeat precedes prune', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Host');
    const now = Date.now();
    room.updatedAt = now - 31 * 60 * 1000;

    roomView(room, session.playerId, session.sessionToken);
    pruneInactiveRooms(rooms, now + 1_000);

    expect(rooms.has(room.code)).toBe(true);
  });

  it('reclaims expired disconnected lobby seats before enforcing room capacity', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const [playerTwo] = fillLobby(room);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.connected = false;
    disconnected.reconnectDeadlineMs = Date.now() - 1;

    const joined = joinRoom(room, 'Replacement');

    expect(joined.playerId).toBe(playerTwo.playerId);
    expect(room.players).toHaveLength(4);
    expect(new Set(room.players.map((player) => player.id)).size).toBe(4);
  });

  it('still rejects joins when disconnected seats are inside reconnect grace window', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const [playerTwo] = fillLobby(room);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.connected = false;
    disconnected.reconnectDeadlineMs = Date.now() + 60_000;

    expect(() => joinRoom(room, 'Replacement')).toThrowError('room_full');
  });

  it('rejects room state access after reconnect window expiration', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.reconnectDeadlineMs = Date.now() - 1;

    expect(() => roomView(room, playerTwo.playerId, playerTwo.sessionToken)).toThrowError('reconnect_expired');
    expect(disconnected.connected).toBe(false);
  });

  it('allows room state access for disconnected players within reconnect grace window', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room } = createRoom(rooms, 'Host');
    const playerTwo = joinRoom(room, 'Player 2');
    leaveRoom(room, playerTwo.playerId, playerTwo.sessionToken);
    const disconnected = findParticipant(room, playerTwo.playerId);
    disconnected.reconnectDeadlineMs = Date.now() + 60_000;

    const view = roomView(room, playerTwo.playerId, playerTwo.sessionToken);

    expect(view.yourPlayerId).toBe(playerTwo.playerId);
    expect(disconnected.connected).toBe(true);
  });
});
