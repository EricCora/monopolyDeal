#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const commands = [
  ['npm', ['run', 'lint']],
  ['npm', ['run', 'test']],
  ['npm', ['run', 'build']],
];

for (const [command, args] of commands) {
  const run = spawnSync(command, args, { stdio: 'inherit' });
  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }
}
