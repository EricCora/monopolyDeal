/**
 * Records the games the Swift engine must reproduce.
 *
 *   npm run traces:record                        rewrites the fixture after a rule change
 *   npm run traces:record -- --dump 417 out.txt  writes every step of one game, for diffing
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { canonicalJson, playTrace, traceConfigs, TRACE_VERSION } from '../src/test/fixtures/engineTrace';
import { applyAction, createGame, getLegalActions } from '../src/engine';

const fixturePath = resolve('apps/ios/DealKit/Tests/DealKitTests/Fixtures/engine-traces.json');
const samplesPath = resolve('apps/ios/DealKit/Tests/DealKitTests/Fixtures/engine-sample-states.json');

const dumpAt = process.argv.indexOf('--dump');
if (dumpAt >= 0) {
  const index = Number(process.argv[dumpAt + 1]);
  const out = process.argv[dumpAt + 2];
  const lines: string[] = [];
  playTrace(traceConfigs()[index], (step, text) => lines.push(`--- step ${step}`, text));
  writeFileSync(out, `${lines.join('\n')}\n`);
  console.log(`Wrote game ${index} to ${out}`);
  process.exit(0);
}

const games = traceConfigs().map((config) => playTrace(config));
mkdirSync(dirname(fixturePath), { recursive: true });
writeFileSync(fixturePath, `${JSON.stringify({ version: TRACE_VERSION, games })}\n`);
console.log(`Recorded ${games.length} games, ${games.reduce((sum, game) => sum + game.steps, 0)} steps.`);

/** Saved games the app must load, including the oldest shape the web app still reads. */
function advance(seed: number, variant: 'classic' | 'no_mercy', steps: number) {
  let state = createGame({ seed, variant, players: [{ id: 'p1', name: 'Ann' }, { id: 'p2', name: "O'Brien" }, { id: 'p3', name: 'Bot', controller: 'bot', botDifficulty: 'hard' }] });
  for (let step = 0; step < steps && !state.winnerId; step += 1) {
    const options = state.players.flatMap((player) => getLegalActions(state, player.id));
    const pool = options.filter((option) => option.action.type !== 'pass_turn' && option.action.type !== 'move_wild');
    const choice = (pool.length > 0 ? pool : options)[(seed + step) % (pool.length > 0 ? pool.length : options.length)];
    state = applyAction(state, choice.action).state;
  }
  return state;
}

const samples = [
  { name: 'classic-opening', state: advance(3, 'classic', 2) },
  { name: 'classic-midgame', state: advance(21, 'classic', 60) },
  { name: 'no-mercy-opening', state: advance(5, 'no_mercy', 2) },
  { name: 'no-mercy-midgame', state: advance(34, 'no_mercy', 90) },
  { name: 'no-mercy-late', state: advance(55, 'no_mercy', 160) },
];

// The oldest shape: no variant field, and placements without set ids.
const legacy = structuredClone(advance(8, 'classic', 40)) as unknown as Record<string, unknown> & { players: Array<{ properties: Record<string, Array<Record<string, unknown>>> }> };
delete legacy.variant;
delete legacy.ruleset;
for (const player of legacy.players) {
  for (const lane of Object.values(player.properties)) {
    for (const entry of lane) delete entry.setId;
  }
}

writeFileSync(samplesPath, `${JSON.stringify({
  samples: [...samples, { name: 'legacy-untagged', state: legacy }].map((sample) => ({
    ...sample,
    legalByPlayer: (sample.state as { players: Array<{ id: string }> }).players
      .map((player) => canonicalJson(getLegalActions(sample.state as never, player.id))),
  })),
}, null, 1)}\n`);
console.log(`Wrote ${samples.length + 1} sample saves.`);
