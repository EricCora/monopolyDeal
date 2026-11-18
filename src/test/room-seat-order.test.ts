import { describe, expect, it } from 'vitest';
import {
  addRoomBot,
  createRoom,
  joinRoom,
  rematchRoom,
  roomView,
  setRoomReady,
  setSeatOrder,
  startRoom,
  type MultiplayerRoom,
} from '../../apps/server/src/gameService';
import { createMemoryTurnStore, handleTurnRoomRequest } from '../../apps/server/src/turnRooms';

function lobby() {
  const rooms = new Map<string, MultiplayerRoom>();
  const { room, session: host } = createRoom(rooms, 'Eric');
  return { room, host };
}

const names = (room: MultiplayerRoom) => room.players.map((entry) => entry.name);

describe('the host setting the turn order', () => {
  it('moves a bot added early to after a friend who joined later, and the game follows it', () => {
    const { room, host } = lobby();
    addRoomBot(room, host.playerId, host.sessionToken);
    const anna = joinRoom(room, 'Anna');
    const bot = room.players[1];
    expect(room.players.map((entry) => entry.id)).toEqual([host.playerId, bot.id, anna.playerId]);

    setSeatOrder(room, host.playerId, host.sessionToken, [host.playerId, anna.playerId, bot.id]);
    expect(names(room)).toEqual(['Eric', 'Anna', bot.name]);
    expect(roomView(room, anna.playerId, anna.sessionToken).players.map((entry) => entry.id)).toEqual([host.playerId, anna.playerId, bot.id]);

    setRoomReady(room, host.playerId, host.sessionToken, true);
    setRoomReady(room, anna.playerId, anna.sessionToken, true);
    startRoom(room, host.playerId, host.sessionToken);
    expect(room.game?.players.map((entry) => entry.id)).toEqual([host.playerId, anna.playerId, bot.id]);
  });

  it('can put someone other than the host first, and keeps ready states', () => {
    const { room, host } = lobby();
    const anna = joinRoom(room, 'Anna');
    setRoomReady(room, anna.playerId, anna.sessionToken, true);
    setSeatOrder(room, host.playerId, host.sessionToken, [anna.playerId, host.playerId]);
    expect(names(room)).toEqual(['Anna', 'Eric']);
    expect(room.players[0].ready).toBe(true);
    expect(room.hostPlayerId).toBe(host.playerId);
    setRoomReady(room, host.playerId, host.sessionToken, true);
    startRoom(room, host.playerId, host.sessionToken);
    expect(room.game?.players[room.game.currentPlayerIndex].id).toBe(anna.playerId);
  });

  it('works between matches, and the rematch uses it', () => {
    const { room, host } = lobby();
    const anna = joinRoom(room, 'Anna');
    for (const seat of [host, anna]) setRoomReady(room, seat.playerId, seat.sessionToken, true);
    startRoom(room, host.playerId, host.sessionToken);
    room.game!.winnerId = host.playerId;
    room.game!.turn.phase = 'finished';
    room.status = 'finished';
    setSeatOrder(room, host.playerId, host.sessionToken, [anna.playerId, host.playerId]);
    for (const seat of [host, anna]) setRoomReady(room, seat.playerId, seat.sessionToken, true);
    rematchRoom(room, host.playerId, host.sessionToken);
    expect(room.game?.players.map((entry) => entry.id)).toEqual([anna.playerId, host.playerId]);
  });

  it('only lets the host do it', () => {
    const { room, host } = lobby();
    const anna = joinRoom(room, 'Anna');
    expect(() => setSeatOrder(room, anna.playerId, anna.sessionToken, [anna.playerId, host.playerId])).toThrow();
    expect(names(room)).toEqual(['Eric', 'Anna']);
  });

  it('refuses an order that drops, repeats or invents a seat', () => {
    const { room, host } = lobby();
    const anna = joinRoom(room, 'Anna');
    const refuse = (order: unknown) => expect(() => setSeatOrder(room, host.playerId, host.sessionToken, order)).toThrow();
    refuse([host.playerId]);
    refuse([host.playerId, host.playerId]);
    refuse([host.playerId, anna.playerId, 'p5']);
    refuse([host.playerId, 'p5']);
    refuse('p1,p2');
    refuse([1, 2]);
    expect(names(room)).toEqual(['Eric', 'Anna']);
  });

  it("can't change during a match", () => {
    const { room, host } = lobby();
    const anna = joinRoom(room, 'Anna');
    for (const seat of [host, anna]) setRoomReady(room, seat.playerId, seat.sessionToken, true);
    startRoom(room, host.playerId, host.sessionToken);
    expect(() => setSeatOrder(room, host.playerId, host.sessionToken, [anna.playerId, host.playerId])).toThrow('room_started');
  });

  it('records nothing when the order is unchanged', () => {
    const { room, host } = lobby();
    joinRoom(room, 'Anna');
    const revision = room.revision;
    setSeatOrder(room, host.playerId, host.sessionToken, room.players.map((entry) => entry.id));
    expect(room.revision).toBe(revision);
  });

  it('goes through the bots route of a turn-by-turn room', async () => {
    const store = createMemoryTurnStore();
    const base = '/api/multiplayer/rooms';
    const post = (path: string, body: Record<string, unknown>) => ({ method: 'POST', path: `${base}${path}`, query: {}, body });
    const host = (await handleTurnRoomRequest(post('', { playerName: 'Eric' }), store)).json as { roomCode: string; playerId: string; sessionToken: string };
    const seat = { playerId: host.playerId, sessionToken: host.sessionToken };
    await handleTurnRoomRequest(post(`/${host.roomCode}/bots`, { ...seat, op: 'add', difficulty: 'easy' }), store);
    const read = async () => ((await handleTurnRoomRequest({ method: 'GET', path: `${base}/${host.roomCode}/state`, query: seat, body: {} }, store)).json as { players: Array<{ id: string }> }).players.map((entry) => entry.id);
    const [first, second] = await read();
    const moved = await handleTurnRoomRequest(post(`/${host.roomCode}/bots`, { ...seat, op: 'order', seatOrder: [second, first] }), store);
    expect(moved.status).toBe(200);
    expect(await read()).toEqual([second, first]);
    const refused = await handleTurnRoomRequest(post(`/${host.roomCode}/bots`, { ...seat, op: 'order', seatOrder: [first] }), store);
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await read()).toEqual([second, first]);
  });
});
