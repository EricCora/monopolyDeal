#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const hasTsxLoader = process.execArgv.some((arg) => arg.includes('tsx/esm'));
if (!hasTsxLoader) {
  const scriptPath = fileURLToPath(import.meta.url);
  const rerun = spawnSync(process.execPath, ['--import', 'tsx/esm', scriptPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
  process.exit(rerun.status ?? 1);
}

const [{ applyAction, createGame }, { replayStateFingerprint }] = await Promise.all([
  import('../src/engine/index.ts'),
  import('../src/replay/serialize.ts'),
]);

function defaultReplaySpec() {
  return {
    seed: 1337,
    runs: 3,
    players: [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
    ],
    commands: [
      { type: 'draw_cards', playerId: 'p1' },
      { type: 'pass_turn', playerId: 'p1' },
      { type: 'draw_cards', playerId: 'p2' },
      { type: 'pass_turn', playerId: 'p2' },
    ],
  };
}

function loadReplaySpec() {
  const argPath = process.argv[2];
  if (!argPath) return defaultReplaySpec();
  const absolutePath = resolve(process.cwd(), argPath);
  const raw = readFileSync(absolutePath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    ...parsed,
    runs: Number.isFinite(parsed.runs) && parsed.runs > 0 ? Math.floor(parsed.runs) : 3,
  };
}

function runReplay(spec) {
  let state = createGame({
    seed: spec.seed,
    players: spec.players,
  });

  for (let index = 0; index < spec.commands.length; index += 1) {
    const command = spec.commands[index];
    const result = applyAction(state, command);
    if (result.error) {
      throw new Error(`Command ${index + 1} failed (${result.error.code}): ${result.error.message}`);
    }
    state = result.state;
  }

  return {
    state,
    finalHash: replayStateFingerprint(state),
  };
}

function main() {
  const spec = loadReplaySpec();
  const runs = spec.runs ?? 3;
  if (!Array.isArray(spec.commands) || spec.commands.length === 0) {
    throw new Error('Replay spec requires a non-empty commands array.');
  }

  const runHashes = [];
  let finalHash = '';
  for (let index = 0; index < runs; index += 1) {
    const result = runReplay(spec);
    finalHash = result.finalHash;
    runHashes.push(result.finalHash);
  }

  const uniqueHashes = new Set(runHashes);
  if (uniqueHashes.size !== 1) {
    throw new Error(`Replay nondeterminism detected. Hashes: ${runHashes.join(', ')}`);
  }

  if (typeof spec.expectedFinalHash === 'string' && spec.expectedFinalHash.length > 0 && spec.expectedFinalHash !== finalHash) {
    throw new Error(`Replay hash mismatch. expected=${spec.expectedFinalHash} actual=${finalHash}`);
  }

  console.log('Replay verification passed.');
  console.log(`finalHash=${finalHash}`);
  console.log(`runs=${runs}`);
}

main();
