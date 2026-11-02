#!/usr/bin/env node
/**
 * Plays a short turn-by-turn game against the real function and Blob storage:
 *   npm run verify:turn-live [-- https://site.example]
 *
 * Tests use an in-memory store, which can't show how real storage behaves, so run this
 * after changing the store or deploying the function. It leaves no room behind.
 */
const origin = process.argv[2] ?? 'https://monopoly-deal-smoky.vercel.app';
const rooms = `${origin}/api/turn/api/multiplayer/rooms`;

async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}

function must(what, result) {
  if (result.status !== 200) {
    console.error(`FAILED: ${what}: ${result.status} ${JSON.stringify(result.json).slice(0, 200)}`);
    process.exit(1);
  }
  return result.json;
}

const identity = (seat) => ({ playerId: seat.playerId, sessionToken: seat.sessionToken, seatId: seat.seatId, resumeToken: seat.resumeToken });

const host = must('create a room', await post(rooms, { playerName: 'Live Check A' }));
const code = host.roomCode;
const room = `${rooms}/${code}`;
const guest = must('join', await post(`${room}/join`, { playerName: 'Live Check B' }));

async function view(seat) {
  const response = await fetch(`${room}/state?playerId=${seat.playerId}&sessionToken=${seat.sessionToken}`);
  return must('read the room', { status: response.status, json: await response.json() });
}

for (const seat of [guest, host]) {
  must('mark ready', await post(`${room}/ready`, { ...identity(seat), ready: true, expectedRevision: (await view(seat)).revision }));
}
must('start', await post(`${room}/start`, { ...identity(host), expectedRevision: (await view(host)).revision }));

let moves = 0;
for (let round = 0; round < 12; round += 1) {
  for (const seat of [host, guest]) {
    const seen = await view(seat);
    if (seen.promptPlayerId !== seen.yourPlayerId || seen.legalActions.length === 0) continue;
    const pick = seen.legalActions.find((entry) => entry.action.type === 'draw_cards')
      ?? seen.legalActions.find((entry) => entry.action.type === 'pass_turn')
      ?? seen.legalActions[0];
    must('play a move', await post(`${room}/action`, { ...identity(seat), action: pick.action, expectedRevision: seen.revision, clientStateVersion: seen.revision }));
    moves += 1;
  }
}
const final = await view(guest);
if (moves < 6 || final.gameState.turnCount < 2) {
  console.error(`FAILED: the game didn't move on: ${moves} moves, turn ${final.gameState.turnCount}`);
  process.exit(1);
}
for (const seat of [host, guest]) must('leave', await post(`${room}/leave`, { ...identity(seat), abandon: true }));
console.log(`OK: room ${code} played ${moves} moves to turn ${final.gameState.turnCount} on ${origin}`);
