import { describe, expect, it } from 'vitest';
import {
  addRoomBot,
  createRoom,
  joinRoom,
  leaveRoom,
  nextRoomAutomation,
  pruneInactiveRooms,
  rematchRoom,
  removeRoomBot,
  roomView,
  runRoomAutomation,
  setRoomOptions,
  setRoomReady,
  setRoomVariant,
  setSeatBotDifficulty,
  startRoom,
  disconnectRoomSeat,
  type MultiplayerRoom,
} from '../../apps/server/src/gameService';
import { createMemoryTurnStore, handleTurnRoomRequest } from '../../apps/server/src/turnRooms';
import { getNextPrompt, isGameOver } from '../engine';
import { BOT_NAMES } from '../ai/botNames';

function room() {
  const rooms = new Map<string, MultiplayerRoom>();
  const { room: created, session: host } = createRoom(rooms, 'Eric');
  return { rooms, room: created, host };
}

function playBotsOut(target: MultiplayerRoom) {
  let clock = Date.now() + 10 ** 9;
  for (let step = 0; step < 5000 && !isGameOver(target.game!).done; step += 1) {
    clock += 60_000;
    if (!runRoomAutomation(target, clock)) break;
  }
}

describe('bots in a room', () => {
  it('seats a bot that is always ready, with its own difficulty', () => {
    const { room: target, host } = room();
    addRoomBot(target, host.playerId, host.sessionToken, 'hard');
    const view = roomView(target, host.playerId, host.sessionToken);
    expect(view.players).toHaveLength(2);
    expect(view.players[1]).toMatchObject({ isBot: true, botDifficulty: 'hard', ready: true, connected: true });
  });

  it('gives each bot a name nobody at the table has', () => {
    const { room: target, host } = room();
    joinRoom(target, 'Ada');
    addRoomBot(target, host.playerId, host.sessionToken);
    addRoomBot(target, host.playerId, host.sessionToken);
    const names = roomView(target, host.playerId, host.sessionToken).players.map((player) => player.name);
    expect(names.slice(0, 2)).toEqual(['Eric', 'Ada']);
    expect(BOT_NAMES).toContain(names[2]);
    expect(BOT_NAMES).toContain(names[3]);
    expect(new Set(names).size).toBe(4);
  });

  it('lets one person and a bot play a whole game', () => {
    const { room: target, host } = room();
    addRoomBot(target, host.playerId, host.sessionToken);
    // A timer on the person's seat lets the test run the whole game through automation.
    setRoomOptions(target, host.playerId, host.sessionToken, { turnTimerSeconds: 30 });
    setRoomReady(target, host.playerId, host.sessionToken, true);
    expect(roomView(target, host.playerId, host.sessionToken).canStart).toBe(true);
    startRoom(target, host.playerId, host.sessionToken, 5);
    expect(target.game?.players[1]).toMatchObject({ controller: 'bot', botDifficulty: 'easy' });
    playBotsOut(target);
    expect(isGameOver(target.game!).done).toBe(true);
  });

  it('moves for a bot seat, and leaves a person alone', () => {
    const { room: target, host } = room();
    addRoomBot(target, host.playerId, host.sessionToken);
    setRoomReady(target, host.playerId, host.sessionToken, true);
    startRoom(target, host.playerId, host.sessionToken, 5);
    const prompt = getNextPrompt(target.game!).playerId;
    if (prompt === host.playerId) expect(nextRoomAutomation(target)).toBeNull();
    else expect(nextRoomAutomation(target)?.reason).toBe('bot_seat');
  });

  it('has a host control for removing a bot, and stops others using it', () => {
    const { room: target, host } = room();
    const guest = joinRoom(target, 'Ann');
    addRoomBot(target, host.playerId, host.sessionToken);
    const bot = target.players.find((entry) => entry.isBot)!;
    expect(() => addRoomBot(target, guest.playerId, guest.sessionToken)).toThrow();
    expect(() => removeRoomBot(target, guest.playerId, guest.sessionToken, bot.id)).toThrow();
    removeRoomBot(target, host.playerId, host.sessionToken, bot.id);
    expect(target.players).toHaveLength(2);
  });

  it('stops at five seats', () => {
    const { room: target, host } = room();
    for (let index = 0; index < 4; index += 1) addRoomBot(target, host.playerId, host.sessionToken);
    expect(() => addRoomBot(target, host.playerId, host.sessionToken)).toThrow('room_full');
  });

  it("isn't dropped for going quiet, and doesn't become host", () => {
    const { rooms, room: target, host } = room();
    addRoomBot(target, host.playerId, host.sessionToken);
    const guest = joinRoom(target, 'Ann');
    target.players.forEach((entry) => {
      if (!entry.isBot) entry.lastSeenAt = Date.now() + 5 * 60_000;
    });
    pruneInactiveRooms(rooms, Date.now() + 5 * 60_000);
    expect(target.players.some((entry) => entry.isBot)).toBe(true);
    leaveRoom(target, host.playerId, host.sessionToken);
    expect(target.hostPlayerId).toBe(guest.playerId);
  });

  it('stops moving once only bots are left', () => {
    const { room: target, host } = room();
    addRoomBot(target, host.playerId, host.sessionToken);
    addRoomBot(target, host.playerId, host.sessionToken);
    setRoomReady(target, host.playerId, host.sessionToken, true);
    startRoom(target, host.playerId, host.sessionToken, 5);
    disconnectRoomSeat(target, host.playerId, host.sessionToken);
    expect(nextRoomAutomation(target)).toBeNull();
  });
});

describe('a bot covering a dropped player', () => {
  it('plays at the room default, then at what the host picks for that seat', () => {
    const { room: target, host } = room();
    const guest = joinRoom(target, 'Ann');
    setRoomOptions(target, host.playerId, host.sessionToken, { botFill: true, botDifficulty: 'hard' });
    setRoomReady(target, guest.playerId, guest.sessionToken, true);
    setRoomReady(target, host.playerId, host.sessionToken, true);
    startRoom(target, host.playerId, host.sessionToken, 5);
    disconnectRoomSeat(target, guest.playerId, guest.sessionToken);
    const seat = () => roomView(target, host.playerId, host.sessionToken).players.find((entry) => entry.id === guest.playerId);
    expect(seat()?.botDifficulty).toBe('hard');
    setSeatBotDifficulty(target, host.playerId, host.sessionToken, guest.playerId, 'easy');
    expect(seat()?.botDifficulty).toBe('easy');
    expect(roomView(target, host.playerId, host.sessionToken).botSeatIds).toEqual([guest.playerId]);
  });
});

describe('the room between matches', () => {
  function finished() {
    const made = room();
    const guest = joinRoom(made.room, 'Ann');
    setRoomReady(made.room, guest.playerId, guest.sessionToken, true);
    setRoomReady(made.room, made.host.playerId, made.host.sessionToken, true);
    startRoom(made.room, made.host.playerId, made.host.sessionToken, 5);
    made.room.game!.winnerId = made.host.playerId;
    made.room.game!.turn.phase = 'finished';
    made.room.status = 'finished';
    return { ...made, guest };
  }

  it('lets a friend join, and seats them in the next game', () => {
    const { room: target, host, guest } = finished();
    const late = joinRoom(target, 'Sam');
    const view = roomView(target, host.playerId, host.sessionToken);
    expect(view.players.map((entry) => entry.name)).toContain('Sam');
    for (const seat of [host, guest, late]) setRoomReady(target, seat.playerId, seat.sessionToken, true);
    expect(roomView(target, host.playerId, host.sessionToken).canRematch).toBe(true);
    rematchRoom(target, host.playerId, host.sessionToken);
    expect(target.game?.players).toHaveLength(3);
  });

  it('lets the host change the game and add a bot', () => {
    const { room: target, host, guest } = finished();
    setRoomVariant(target, host.playerId, host.sessionToken, 'no_mercy');
    addRoomBot(target, host.playerId, host.sessionToken);
    setRoomOptions(target, host.playerId, host.sessionToken, { turnTimerSeconds: 30 });
    for (const seat of [host, guest]) setRoomReady(target, seat.playerId, seat.sessionToken, true);
    rematchRoom(target, host.playerId, host.sessionToken);
    expect(target.game?.variant).toBe('no_mercy');
    expect(target.game?.players).toHaveLength(3);
    expect(target.turnClock?.deadlineMs).not.toBeNull();
  });

  it("isn't held up by someone who left for good", () => {
    const { room: target, host, guest } = finished();
    addRoomBot(target, host.playerId, host.sessionToken);
    leaveRoom(target, guest.playerId, guest.sessionToken, undefined, { abandon: true });
    setRoomReady(target, host.playerId, host.sessionToken, true);
    expect(roomView(target, host.playerId, host.sessionToken).canRematch).toBe(true);
  });

  it("isn't held up for long by someone who just went quiet", () => {
    const { room: target, host, guest } = finished();
    addRoomBot(target, host.playerId, host.sessionToken);
    setRoomReady(target, host.playerId, host.sessionToken, true);
    disconnectRoomSeat(target, guest.playerId, guest.sessionToken);
    expect(roomView(target, host.playerId, host.sessionToken).canRematch).toBe(false);
    target.players.find((entry) => entry.id === guest.playerId)!.disconnectedAt = Date.now() - 10 * 60_000;
    expect(roomView(target, host.playerId, host.sessionToken).canRematch).toBe(true);
    rematchRoom(target, host.playerId, host.sessionToken);
    expect(target.game?.players).toHaveLength(2);
  });

  it('keeps bots ready across games', () => {
    const { room: target, host, guest } = finished();
    addRoomBot(target, host.playerId, host.sessionToken);
    for (const seat of [host, guest]) setRoomReady(target, seat.playerId, seat.sessionToken, true);
    rematchRoom(target, host.playerId, host.sessionToken);
    expect(target.players.find((entry) => entry.isBot)?.ready).toBe(true);
    expect(target.players.find((entry) => entry.id === guest.playerId)?.ready).toBe(false);
  });
});

describe('bots in a turn-by-turn room', () => {
  it('move inside the request that reached them', async () => {
    const store = createMemoryTurnStore();
    const rooms = '/api/multiplayer/rooms';
    const post = (path: string, body: Record<string, unknown>) => ({ method: 'POST', path: `${rooms}${path}`, query: {}, body });
    const host = (await handleTurnRoomRequest(post('', { playerName: 'Eric' }), store)).json as { roomCode: string; playerId: string; sessionToken: string };
    const seat = { playerId: host.playerId, sessionToken: host.sessionToken };
    const code = host.roomCode;
    expect((await handleTurnRoomRequest(post(`/${code}/bots`, { ...seat, op: 'add', difficulty: 'easy' }), store)).status).toBe(200);
    await handleTurnRoomRequest(post(`/${code}/ready`, { ...seat, ready: true }), store);
    await handleTurnRoomRequest(post(`/${code}/start`, seat), store);
    const read = async () => (await handleTurnRoomRequest({ method: 'GET', path: `${rooms}/${code}/state`, query: seat, body: {} }, store)).json as {
      promptPlayerId: string; yourPlayerId: string; legalActions: Array<{ action: { type: string } }>; revision: number; gameState: { turnCount: number };
    };
    let seen = await read();
    // After every request it's the person's move: nothing is left waiting on the bot.
    for (let step = 0; step < 20; step += 1) {
      expect(seen.promptPlayerId).toBe(seen.yourPlayerId);
      const action = seen.legalActions.find((entry) => entry.action.type === 'draw_cards')
        ?? seen.legalActions.find((entry) => entry.action.type === 'pass_turn')
        ?? seen.legalActions[0];
      const result = await handleTurnRoomRequest(post(`/${code}/action`, { ...seat, action: action.action, expectedRevision: seen.revision }), store);
      expect(result.status).toBe(200);
      seen = await read();
    }
    expect(seen.gameState.turnCount).toBeGreaterThan(2);
  });
});
