import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRoom,
  disconnectRoomSeat,
  joinRoom,
  nextRoomAutomation,
  reconnectRoom,
  rematchRoom,
  roomReplay,
  roomView,
  runRoomAutomation,
  setRoomOptions,
  setRoomReady,
  startRoom,
  undoRoomAction,
  applyRoomAction,
  watchRoom,
  leaveRoom,
  type MultiplayerRoom,
} from '../../apps/server/src/gameService';
import { createMemoryTurnStore, handleTurnRoomRequest, type TurnRoomNotifier } from '../../apps/server/src/turnRooms';
import { applyAction, getLegalActions, getNextPrompt, isGameOver, type Action } from '../engine';
import { replayStateFingerprint } from '../replay/serialize';

interface Seat { playerId: string; sessionToken: string }

function twoPlayerRoom(options: Partial<NonNullable<MultiplayerRoom['options']>> = {}) {
  const rooms = new Map<string, MultiplayerRoom>();
  const { room, session } = createRoom(rooms, 'Ann');
  const guest = joinRoom(room, 'Bob');
  const host: Seat = { playerId: session.playerId, sessionToken: session.sessionToken };
  const other: Seat = { playerId: guest.playerId, sessionToken: guest.sessionToken };
  if (Object.keys(options).length > 0) setRoomOptions(room, host.playerId, host.sessionToken, options);
  setRoomReady(room, host.playerId, host.sessionToken, true);
  setRoomReady(room, other.playerId, other.sessionToken, true);
  startRoom(room, host.playerId, host.sessionToken, 42);
  return { room, host, other };
}

function seatOf(room: MultiplayerRoom, host: Seat, other: Seat, playerId: string): Seat {
  void room;
  return playerId === host.playerId ? host : other;
}

/** Plays a room to its end by always taking the first legal move. */
function playToEnd(room: MultiplayerRoom, host: Seat, other: Seat, limit = 6000): void {
  for (let step = 0; step < limit && room.game && !isGameOver(room.game).done; step += 1) {
    const prompt = getNextPrompt(room.game);
    const legal = getLegalActions(room.game, prompt.playerId);
    const seat = seatOf(room, host, other, prompt.playerId);
    const choice = legal.find((entry) => entry.action.type === 'play_property')
      ?? legal.find((entry) => entry.action.type === 'draw_cards')
      ?? legal.find((entry) => entry.action.type === 'pass_turn')
      ?? legal[0];
    applyRoomAction(room, seat.playerId, seat.sessionToken, choice.action);
  }
}

describe('bot seats', () => {
  it('keeps the original pause when the option is off', () => {
    const { room, other } = twoPlayerRoom();
    disconnectRoomSeat(room, other.playerId, other.sessionToken);
    expect(room.paused).toBe(true);
    expect(nextRoomAutomation(room)).toBeNull();
  });

  it('plays on for a dropped seat without pausing, and hands it back', () => {
    const { room, host, other } = twoPlayerRoom({ botFill: true });
    const hostView = () => roomView(room, host.playerId, host.sessionToken);

    // Get to the dropped player's turn.
    const draw = getLegalActions(room.game!, host.playerId)[0];
    applyRoomAction(room, host.playerId, host.sessionToken, draw.action);
    const pass = getLegalActions(room.game!, host.playerId).find((entry) => entry.action.type === 'pass_turn')!;
    applyRoomAction(room, host.playerId, host.sessionToken, pass.action);
    expect(getNextPrompt(room.game!).playerId).toBe(other.playerId);

    disconnectRoomSeat(room, other.playerId, other.sessionToken);
    expect(room.paused).toBe(false);
    expect(hostView().botSeatIds).toEqual([other.playerId]);

    const next = nextRoomAutomation(room);
    expect(next?.reason).toBe('bot_seat');
    expect(next?.playerId).toBe(other.playerId);
    const before = room.game!.history.length;
    expect(runRoomAutomation(room, next!.at)).toBe(true);
    expect(room.game!.history.length).toBeGreaterThan(before);

    // It can't move before it's due.
    const due = nextRoomAutomation(room);
    if (due) expect(runRoomAutomation(room, due.at - 1)).toBe(false);

    reconnectRoom(room, other.playerId, other.sessionToken);
    expect(hostView().botSeatIds).toEqual([]);
    expect(nextRoomAutomation(room)).toBeNull();
  });

  it('finishes a whole game with bots playing the dropped seat', () => {
    const { room, host, other } = twoPlayerRoom({ botFill: true });
    disconnectRoomSeat(room, other.playerId, other.sessionToken);
    let safety = 0;
    while (room.game && !isGameOver(room.game).done && safety < 8000) {
      safety += 1;
      const next = nextRoomAutomation(room);
      if (next) {
        expect(runRoomAutomation(room, next.at)).toBe(true);
        continue;
      }
      const prompt = getNextPrompt(room.game);
      const legal = getLegalActions(room.game, prompt.playerId);
      applyRoomAction(room, host.playerId, host.sessionToken, (legal.find((entry) => entry.action.type === 'play_property') ?? legal.find((entry) => entry.action.type === 'draw_cards') ?? legal.find((entry) => entry.action.type === 'pass_turn') ?? legal[0]).action);
    }
    expect(isGameOver(room.game!).done).toBe(true);
  });

  it("doesn't let bots play on once everyone has gone", () => {
    const { room, host, other } = twoPlayerRoom({ botFill: true });
    disconnectRoomSeat(room, other.playerId, other.sessionToken);
    disconnectRoomSeat(room, host.playerId, host.sessionToken);
    expect(nextRoomAutomation(room)).toBeNull();
  });
});

describe('turn timers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows a count-up clock with no deadline by default', () => {
    const { room, host } = twoPlayerRoom();
    const clock = roomView(room, host.playerId, host.sessionToken).turnClock;
    expect(clock?.playerId).toBe(getNextPrompt(room.game!).playerId);
    expect(clock?.deadlineMs).toBeNull();
    expect(nextRoomAutomation(room)).toBeNull();
  });

  it('moves for the player when a timed turn runs out, with a legal move', () => {
    const { room, host } = twoPlayerRoom({ turnTimerSeconds: 45 });
    const clock = roomView(room, host.playerId, host.sessionToken).turnClock!;
    expect(clock.deadlineMs).toBe(clock.startedAt + 45_000);

    expect(runRoomAutomation(room, clock.startedAt + 44_999)).toBe(false);
    const before = room.game!.turn.phase;
    expect(before).toBe('draw');
    expect(runRoomAutomation(room, clock.deadlineMs!)).toBe(true);
    expect(room.game!.turn.phase).not.toBe('draw');
    expect(room.activityFeed.some((entry) => /time ran out/i.test(entry.message))).toBe(true);
  });

  it('restarts the clock when the game moves on to the next player', () => {
    const { room, host } = twoPlayerRoom({ turnTimerSeconds: 30 });
    const first = room.turnClock!;
    vi.advanceTimersByTime(5_000);
    applyRoomAction(room, host.playerId, host.sessionToken, getLegalActions(room.game!, host.playerId)[0].action);
    expect(room.turnClock!.startedAt).toBe(first.startedAt);
    const pass = getLegalActions(room.game!, host.playerId).find((entry) => entry.action.type === 'pass_turn')!;
    applyRoomAction(room, host.playerId, host.sessionToken, pass.action);
    expect(room.turnClock!.playerId).not.toBe(first.playerId);
    expect(room.turnClock!.deadlineMs).toBe(Date.now() + 30_000);
  });

  it('stops while paused', () => {
    const { room, host } = twoPlayerRoom({ turnTimerSeconds: 30 });
    void host;
    room.paused = true;
    expect(nextRoomAutomation(room)).toBeNull();
  });

  it('refuses a timer length nobody offered', () => {
    const rooms = new Map<string, MultiplayerRoom>();
    const { room, session } = createRoom(rooms, 'Ann');
    expect(() => setRoomOptions(room, session.playerId, session.sessionToken, { turnTimerSeconds: 3 })).toThrow('invalid_payload');
  });
});

describe('spectators', () => {
  it('sees every hand face down and has nothing to do', () => {
    const { room } = twoPlayerRoom();
    const watcher = watchRoom(room, 'Sam');
    const view = roomView(room, watcher.playerId, watcher.sessionToken);
    expect(view.role).toBe('spectator');
    expect(view.legalActions).toEqual([]);
    expect(view.gameState?.players.flatMap((player) => player.hand).every((card) => card === '__hidden__')).toBe(true);
    expect(view.gameState?.drawPile.every((card) => card === '__hidden__')).toBe(true);
    expect(view.canStart).toBe(false);
  });

  it("can't act, and their token doesn't work for a seat", () => {
    const { room, host } = twoPlayerRoom();
    const watcher = watchRoom(room, 'Sam');
    const action: Action = { type: 'draw_cards', playerId: host.playerId };
    expect(() => applyRoomAction(room, watcher.playerId, watcher.sessionToken, action)).toThrow('invalid_session');
    expect(() => applyRoomAction(room, host.playerId, watcher.sessionToken, action)).toThrow('invalid_session');
  });

  it('counts in the room and can leave and come back', () => {
    const { room, host } = twoPlayerRoom();
    const watcher = watchRoom(room, 'Sam');
    expect(roomView(room, host.playerId, host.sessionToken).spectatorCount).toBe(1);
    expect(reconnectRoom(room, watcher.playerId, watcher.sessionToken).playerId).toBe(watcher.playerId);
    leaveRoom(room, watcher.playerId, watcher.sessionToken);
    expect(roomView(room, host.playerId, host.sessionToken).spectatorCount).toBe(0);
  });

  it('refuses a ninth spectator', () => {
    const { room } = twoPlayerRoom();
    for (let index = 0; index < 8; index += 1) watchRoom(room, `Fan ${index}`);
    expect(() => watchRoom(room, 'One more')).toThrow('room_full');
  });
});

describe('best of three', () => {
  it('stays off unless chosen', () => {
    const { room, host } = twoPlayerRoom();
    expect(roomView(room, host.playerId, host.sessionToken).series).toBeUndefined();
  });

  it('counts wins across games and ends at two', () => {
    const { room, host, other } = twoPlayerRoom({ bestOf: 3 });
    const finishGame = () => {
      playToEnd(room, host, other);
      expect(isGameOver(room.game!).done).toBe(true);
    };
    finishGame();
    const firstWinner = isGameOver(room.game!).winnerId!;
    expect(room.series?.wins[firstWinner]).toBe(1);
    expect(room.series?.winnerId).toBeUndefined();

    setRoomReady(room, host.playerId, host.sessionToken, true);
    setRoomReady(room, other.playerId, other.sessionToken, true);
    rematchRoom(room, host.playerId, host.sessionToken);
    expect(room.series?.gameNumber).toBe(2);
    expect(room.series?.wins[firstWinner]).toBe(1);

    // Whoever wins, two wins end it: force the same winner by finishing with the series state.
    room.series!.wins[firstWinner] = 1;
    finishGame();
    const secondWinner = isGameOver(room.game!).winnerId!;
    if (secondWinner === firstWinner) {
      expect(room.series?.winnerId).toBe(firstWinner);
    } else {
      expect(room.series?.winnerId).toBeUndefined();
      setRoomReady(room, host.playerId, host.sessionToken, true);
      setRoomReady(room, other.playerId, other.sessionToken, true);
      rematchRoom(room, host.playerId, host.sessionToken);
      finishGame();
      expect(room.series?.winnerId).toBe(isGameOver(room.game!).winnerId);
    }

    // A rematch after a finished series starts a new one.
    setRoomReady(room, host.playerId, host.sessionToken, true);
    setRoomReady(room, other.playerId, other.sessionToken, true);
    rematchRoom(room, host.playerId, host.sessionToken);
    expect(room.series?.gameNumber).toBe(1);
    expect(room.series?.wins).toEqual({});
  });
});

describe('room replay', () => {
  function replayed(log: { initial: MultiplayerRoom['game']; actions: Action[] }) {
    let state = log.initial!;
    for (const action of log.actions) {
      const result = applyAction(state, action);
      expect(result.error).toBeUndefined();
      state = result.state;
    }
    return state;
  }

  it('rebuilds the exact final state of a finished game', () => {
    const { room, host, other } = twoPlayerRoom();
    playToEnd(room, host, other);
    const log = roomReplay(room, host.playerId, host.sessionToken);
    expect(replayStateFingerprint(replayed(log))).toBe(replayStateFingerprint(room.game!));
  });

  it("isn't available until the game is over", () => {
    const { room, host } = twoPlayerRoom();
    expect(roomView(room, host.playerId, host.sessionToken).replayAvailable).toBe(false);
    expect(() => roomReplay(room, host.playerId, host.sessionToken)).toThrow('replay_not_available');
  });

  it('forgets undone moves', () => {
    const { room, host } = twoPlayerRoom();
    applyRoomAction(room, host.playerId, host.sessionToken, getLegalActions(room.game!, host.playerId)[0].action);
    const afterDraw = room.replayLog!.actions.length;
    const play = getLegalActions(room.game!, host.playerId).find((entry) => entry.action.type === 'play_to_bank' || entry.action.type === 'play_property')!;
    applyRoomAction(room, host.playerId, host.sessionToken, play.action);
    expect(room.replayLog!.actions.length).toBe(afterDraw + 1);
    undoRoomAction(room, host.playerId, host.sessionToken);
    expect(room.replayLog!.actions.length).toBe(afterDraw);
  });
});

describe('turn-by-turn rooms', () => {
  const post = (path: string, body: Record<string, unknown> = {}) => ({ method: 'POST', path: `/api/multiplayer/rooms${path}`, query: {}, body });

  async function setup() {
    const store = createMemoryTurnStore();
    const created = await handleTurnRoomRequest(post('', { playerName: 'Ann' }), store);
    expect(created.status).toBe(200);
    const host = created.json as { roomCode: string; playerId: string; sessionToken: string };
    const joined = await handleTurnRoomRequest(post(`/${host.roomCode}/join`, { playerName: 'Bob' }), store);
    const guest = joined.json as { playerId: string; sessionToken: string };
    const code = host.roomCode;
    const seat = (who: { playerId: string; sessionToken: string }) => ({ playerId: who.playerId, sessionToken: who.sessionToken });
    await handleTurnRoomRequest(post(`/${code}/ready`, { ...seat(host), ready: true }), store);
    await handleTurnRoomRequest(post(`/${code}/ready`, { ...seat(guest), ready: true }), store);
    return { store, code, host: seat(host), guest: seat(guest) };
  }

  const state = (code: string, who: { playerId: string; sessionToken: string }) => ({
    method: 'GET',
    path: `/api/multiplayer/rooms/${code}/state`,
    query: who,
    body: {},
  });

  it('uses a six-letter code, so clients know where to find it', async () => {
    const { code } = await setup();
    expect(code).toHaveLength(6);
  });

  it('survives a "restart": every request reads the room from the store', async () => {
    const { store, code, host, guest } = await setup();
    expect((await handleTurnRoomRequest(post(`/${code}/start`, host), store)).status).toBe(200);
    const first = (await handleTurnRoomRequest(state(code, host), store)).json as { turnBased: boolean; revision: number; legalActions: Array<{ action: Action }>; gameState: { players: Array<{ hand: string[] }> } };
    expect(first.turnBased).toBe(true);
    const action = first.legalActions[0].action;
    expect((await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action, expectedRevision: first.revision }), store)).status).toBe(200);
    const guestView = (await handleTurnRoomRequest(state(code, guest), store)).json as { revision: number; gameState: { players: Array<{ hand: string[] }> } };
    expect(guestView.revision).toBeGreaterThan(first.revision);
    expect(guestView.gameState.players[0].hand[0]).toBe('__hidden__');
  });

  it('keeps a seat for days, without marking anyone disconnected', async () => {
    const { store, code, host, guest } = await setup();
    await handleTurnRoomRequest(post(`/${code}/start`, host), store);
    const before = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(before + 7 * 24 * 60 * 60_000);
    try {
      const view = await handleTurnRoomRequest(state(code, guest), store);
      expect(view.status).toBe(200);
      const parsed = view.json as { paused: boolean; players: Array<{ connected: boolean }> };
      expect(parsed.paused).toBe(false);
      expect(parsed.players.every((player) => player.connected)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a stale move without changing anything', async () => {
    const { store, code, host } = await setup();
    await handleTurnRoomRequest(post(`/${code}/start`, host), store);
    const view = (await handleTurnRoomRequest(state(code, host), store)).json as { revision: number; legalActions: Array<{ action: Action }> };
    const response = await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action: view.legalActions[0].action, expectedRevision: view.revision - 1 }), store);
    expect(response.status).toBe(409);
    const after = (await handleTurnRoomRequest(state(code, host), store)).json as { revision: number };
    expect(after.revision).toBe(view.revision);
  });

  it('retries on a conflicting save instead of losing either change', async () => {
    const { store, code, host, guest } = await setup();
    await handleTurnRoomRequest(post(`/${code}/start`, host), store);
    const realSave = store.save.bind(store);
    let interfered = false;
    store.save = async (room, version) => {
      if (!interfered) {
        // Someone else's chat message lands between this request's read and its save.
        interfered = true;
        await handleTurnRoomRequest(post(`/${code}/chat`, { ...guest, text: 'hurry up' }), store);
      }
      return realSave(room, version);
    };
    const view = (await handleTurnRoomRequest(state(code, host), store)).json as { legalActions: Array<{ action: Action }> };
    expect((await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action: view.legalActions[0].action }), store)).status).toBe(200);
    const after = (await handleTurnRoomRequest(state(code, host), store)).json as { chatMessages: unknown[]; gameState: { turn: { phase: string } } };
    expect(after.chatMessages).toHaveLength(1);
    expect(after.gameState.turn.phase).not.toBe('draw');
  });

  it("won't take bots or timers, which need a server that stays awake", async () => {
    const { store, code, host } = await setup();
    expect((await handleTurnRoomRequest(post(`/${code}/options`, { ...host, botFill: true }), store)).status).toBe(400);
    expect((await handleTurnRoomRequest(post(`/${code}/options`, { ...host, turnTimerSeconds: 45 }), store)).status).toBe(400);
    expect((await handleTurnRoomRequest(post(`/${code}/options`, { ...host, bestOf: 3 }), store)).status).toBe(200);
  });

  it('closing the app keeps the seat, and only Forget Room gives it up', async () => {
    const { store, code, host, guest } = await setup();
    await handleTurnRoomRequest(post(`/${code}/start`, host), store);
    await handleTurnRoomRequest(post(`/${code}/leave`, { ...guest, abandon: false }), store);
    const view = (await handleTurnRoomRequest(state(code, host), store)).json as { paused: boolean; players: Array<{ connected: boolean }> };
    expect(view.paused).toBe(false);
    expect(view.players.every((player) => player.connected)).toBe(true);
    await handleTurnRoomRequest(post(`/${code}/leave`, { ...guest, abandon: true }), store);
    const finished = (await handleTurnRoomRequest(state(code, host), store)).json as { status: string };
    expect(finished.status).toBe('finished');
  });

  it('tells the next player, never leaks addresses, and forgets dead ones', async () => {
    const { store, code, host, guest } = await setup();
    const sent: Array<{ endpoint: string; title: string }> = [];
    let alive = true;
    const notifier: TurnRoomNotifier = {
      publicKey: 'key',
      async send(subscription, notification) {
        sent.push({ endpoint: subscription.endpoint, title: notification.title });
        return alive;
      },
    };
    const subscription = { endpoint: 'https://push.example/guest', keys: { p256dh: 'a', auth: 'b' } };
    expect((await handleTurnRoomRequest(post(`/${code}/push`, { ...guest, subscription }), store, notifier)).status).toBe(200);
    await handleTurnRoomRequest(post(`/${code}/start`, host), store, notifier);

    const draw = (await handleTurnRoomRequest(state(code, host), store)).json as { legalActions: Array<{ action: Action }> };
    await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action: draw.legalActions[0].action }), store, notifier);
    expect(sent).toHaveLength(0);

    const main = (await handleTurnRoomRequest(state(code, host), store)).json as { legalActions: Array<{ action: Action }> };
    const pass = main.legalActions.find((entry) => entry.action.type === 'pass_turn')!;
    await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action: pass.action }), store, notifier);
    expect(sent).toEqual([{ endpoint: subscription.endpoint, title: "It's your turn" }]);

    const raw = JSON.stringify((await handleTurnRoomRequest(state(code, host), store)).json);
    expect(raw).not.toContain('push.example');

    // Bob's phone stops accepting pushes: the next send fails and the address is dropped.
    alive = false;
    const guestDraw = (await handleTurnRoomRequest(state(code, guest), store)).json as { legalActions: Array<{ action: Action }> };
    await handleTurnRoomRequest(post(`/${code}/action`, { ...guest, action: guestDraw.legalActions[0].action }), store, notifier);
    const guestMain = (await handleTurnRoomRequest(state(code, guest), store)).json as { legalActions: Array<{ action: Action }> };
    await handleTurnRoomRequest(post(`/${code}/action`, { ...guest, action: guestMain.legalActions.find((entry) => entry.action.type === 'pass_turn')!.action }), store, notifier);
    await handleTurnRoomRequest(post(`/${code}/undo`, host), store, notifier).catch(() => undefined);
    const room = (await store.load(code))!;
    room.room.game!.currentPlayerIndex = 0;
    const previousPrompt = getNextPrompt(room.room.game!).playerId;
    expect(previousPrompt).toBe(host.playerId);
    const hostDraw = (await handleTurnRoomRequest(state(code, host), store)).json as { legalActions: Array<{ action: Action }> };
    await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action: hostDraw.legalActions[0].action }), store, notifier);
    const hostMain = (await handleTurnRoomRequest(state(code, host), store)).json as { legalActions: Array<{ action: Action }> };
    const play = hostMain.legalActions.find((entry) => entry.action.type === 'play_to_bank' || entry.action.type === 'play_property');
    if (play) await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action: play.action }), store, notifier);
    const hostAgain = (await handleTurnRoomRequest(state(code, host), store)).json as { legalActions: Array<{ action: Action }> };
    const play2 = hostAgain.legalActions.find((entry) => entry.action.type === 'play_to_bank' || entry.action.type === 'play_property');
    if (play2) await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action: play2.action }), store, notifier);
    const hostEnd = (await handleTurnRoomRequest(state(code, host), store)).json as { legalActions: Array<{ action: Action }> };
    await handleTurnRoomRequest(post(`/${code}/action`, { ...host, action: hostEnd.legalActions.find((entry) => entry.action.type === 'pass_turn')!.action }), store, notifier);
    expect((await store.load(code))?.room.pushSubscriptions?.[guest.playerId]).toBeUndefined();
  });

  it("won't keep a push address for someone who doesn't hold the seat", async () => {
    const { store, code, guest } = await setup();
    const subscription = { endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } };
    const response = await handleTurnRoomRequest(post(`/${code}/push`, { playerId: guest.playerId, sessionToken: 'wrong', subscription }), store);
    expect(response.status).toBe(400);
  });

  it('gives a clean answer for an unknown room', async () => {
    const store = createMemoryTurnStore();
    expect((await handleTurnRoomRequest(post('/ZZZZZZ/join', { playerName: 'A' }), store)).status).toBe(404);
    expect((await handleTurnRoomRequest(post('/ZZZZZ/join', { playerName: 'A' }), store)).status).toBe(404);
    const resume = await handleTurnRoomRequest(post('/ZZZZZZ/reconnect', { playerId: 'p1', sessionToken: 'x' }), store);
    expect((resume.json as { status: string }).status).toBe('room_closed');
  });
});
