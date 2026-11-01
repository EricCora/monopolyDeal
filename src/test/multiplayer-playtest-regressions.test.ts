import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyRoomAction,
  createRoom,
  disconnectRoomSeat,
  joinRoom,
  leaveRoom,
  pruneInactiveRooms,
  reconnectRoom,
  setRoomReady,
  startRoom,
  undoRoomAction,
  type MultiplayerRoom,
} from '../../apps/server/src/gameService.ts';
import { getLegalActions } from '../engine';
import { resolveMatchSeed } from '../../apps/server/src/validation.ts';

function lobby(guests = 2) {
  const rooms = new Map<string, MultiplayerRoom>();
  const { room, session } = createRoom(rooms, 'Host');
  const others = Array.from({ length: guests }, (_, index) => joinRoom(room, `Guest ${index + 1}`));
  return { rooms, room, session, others };
}

function started(guests = 1) {
  const context = lobby(guests);
  for (const seat of [context.session, ...context.others]) {
    setRoomReady(context.room, seat.playerId, seat.sessionToken, true);
  }
  startRoom(context.room, context.session.playerId, context.session.sessionToken);
  return context;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lobby seats survive a dropped connection', () => {
  it('keeps the seat, ready state and credentials through a socket drop', () => {
    const { room, others: [guest] } = lobby();
    setRoomReady(room, guest.playerId, guest.sessionToken, true);
    disconnectRoomSeat(room, guest.playerId, guest.sessionToken);
    expect(room.players.find((player) => player.id === guest.playerId)?.connected).toBe(false);

    reconnectRoom(room, guest.playerId, guest.sessionToken);
    const seat = room.players.find((player) => player.id === guest.playerId);
    expect(seat?.connected).toBe(true);
    expect(seat?.ready).toBe(true);
  });

  it('holds the seat across a prune inside the grace window and frees it afterwards', () => {
    const { rooms, room, others: [guest] } = lobby();
    disconnectRoomSeat(room, guest.playerId, guest.sessionToken);
    const seat = room.players.find((player) => player.id === guest.playerId)!;
    pruneInactiveRooms(rooms, Date.now() + 1000);
    expect(room.players.some((player) => player.id === guest.playerId)).toBe(true);
    pruneInactiveRooms(rooms, seat.reconnectDeadlineMs + 1);
    expect(room.players.some((player) => player.id === guest.playerId)).toBe(false);
  });

  it('does not let the host start without a seat that is reconnecting', () => {
    const { room, session, others: [first, second] } = lobby();
    for (const seat of [session, first, second]) setRoomReady(room, seat.playerId, seat.sessionToken, true);
    disconnectRoomSeat(room, second.playerId, second.sessionToken);
    expect(() => startRoom(room, session.playerId, session.sessionToken)).toThrowError('players_not_ready');
  });

  it('does not evict a reconnecting seat when a new player joins a room with space', () => {
    const { room, others: [guest] } = lobby();
    disconnectRoomSeat(room, guest.playerId, guest.sessionToken);
    joinRoom(room, 'Newcomer');
    expect(room.players.some((player) => player.id === guest.playerId)).toBe(true);
  });

  it('still removes a player who leaves on purpose', () => {
    const { room, others: [guest] } = lobby();
    leaveRoom(room, guest.playerId, guest.sessionToken);
    expect(room.players.some((player) => player.id === guest.playerId)).toBe(false);
  });
});

describe('reconnect visibility', () => {
  it('advances the event id so other clients do not discard the resume broadcast', () => {
    const { room, others: [guest] } = started();
    disconnectRoomSeat(room, guest.playerId, guest.sessionToken);
    const before = room.eventId;
    reconnectRoom(room, guest.playerId, guest.sessionToken);
    expect(room.eventId).toBeGreaterThan(before);
    expect(room.paused).toBe(false);
  });
});

describe('abandoning a seat', () => {
  it('retires the player at once instead of pausing everyone for the grace period', () => {
    const { room, session, others: [guest] } = started(2);
    leaveRoom(room, session.playerId, session.sessionToken, undefined, { abandon: true });
    expect(room.paused).toBe(false);
    expect(room.roomRuntimeState).toBe('active');
    expect(room.hostPlayerId).toBe(guest.playerId);
    expect(room.players.find((player) => player.id === session.playerId)?.connectionState).toBe('timed_out');
  });
});

describe('undo', () => {
  function actionTurn(room: MultiplayerRoom, hand: string[]) {
    const game = room.game!;
    game.currentPlayerIndex = 0;
    game.pending = null;
    game.turn = { phase: 'action', playsUsed: 0, doubleRentMultiplier: 1, endingTurn: false };
    game.players[0].hand = hand;
  }

  it('cannot take back a play that revealed cards from the deck', () => {
    const { room, session } = started();
    actionTurn(room, ['pass_go#1', 'money_1#1']);
    applyRoomAction(room, session.playerId, session.sessionToken, { type: 'play_to_bank', playerId: session.playerId, cardId: 'money_1#1' });
    expect(room.turnSnapshots.length).toBe(1);
    applyRoomAction(room, session.playerId, session.sessionToken, { type: 'play_action', playerId: session.playerId, cardId: 'pass_go#1' });
    expect(room.game?.players[0].hand.length).toBe(2);
    expect(() => undoRoomAction(room, session.playerId, session.sessionToken)).toThrowError('no_turn_snapshot');
  });

  it('keeps ordinary plays undoable', () => {
    const { room, session } = started();
    actionTurn(room, ['money_1#1']);
    applyRoomAction(room, session.playerId, session.sessionToken, { type: 'play_to_bank', playerId: session.playerId, cardId: 'money_1#1' });
    undoRoomAction(room, session.playerId, session.sessionToken);
    expect(room.game?.players[0].hand).toEqual(['money_1#1']);
  });

  it('bounds the history from free moves and keeps the start of the turn', () => {
    const { room, session } = started();
    actionTurn(room, []);
    const player = room.game!.players[0];
    player.properties.light_blue = [{ cardId: 'wild_light_blue_railroad#1', assignedColor: 'light_blue', setId: 'g-1' }];
    const turnStart = structuredClone(room.game);
    for (let move = 0; move < 80; move += 1) {
      const moveWild = getLegalActions(room.game!, session.playerId).find((entry) => entry.action.type === 'move_wild');
      applyRoomAction(room, session.playerId, session.sessionToken, moveWild!.action);
    }
    expect(room.turnSnapshots.length).toBeLessThanOrEqual(32);
    expect(room.turnSnapshots[0].players[0].properties.light_blue).toEqual(turnStart!.players[0].properties.light_blue);
  });
});

describe('room secrets', () => {
  it('builds session tokens from a secure source, not Math.random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const { room, session } = lobby(0);
    const guest = joinRoom(room, 'Guest');
    expect(session.sessionToken).not.toBe(guest.sessionToken);
    expect(session.sessionToken).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ignores a client-supplied seed unless explicitly allowed', () => {
    expect(resolveMatchSeed(1234, false)).not.toBe(1234);
    expect(Number.isInteger(resolveMatchSeed(1234, false))).toBe(true);
    expect(resolveMatchSeed(1234, true)).toBe(1234);
    expect(Number.isInteger(resolveMatchSeed(undefined, true))).toBe(true);
  });
});

describe('player names', () => {
  it('keeps names distinct within a room', () => {
    const { room } = lobby(0);
    joinRoom(room, 'host');
    const third = joinRoom(room, 'Host');
    const names = room.players.map((player) => player.name);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    expect(third.playerId).toBe('p3');
  });

  it('gives a blank name the seat default', () => {
    const { room } = lobby(0);
    joinRoom(room, '   ');
    expect(room.players[1].name).toBe('Player 2');
  });
});
