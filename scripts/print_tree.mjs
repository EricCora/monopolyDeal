#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const requestedDepth = Number(process.argv[2] ?? 3);
const maxDepth = Number.isFinite(requestedDepth) && requestedDepth > 0 ? Math.floor(requestedDepth) : 3;

const command = [
  'find .',
  `-maxdepth ${maxDepth}`,
  "\\( -path './.git' -o -path './node_modules' -o -path './dist' -o -path './coverage' \\) -prune -o",
  '-print',
  '| sort',
].join(' ');

const result = spawnSync('bash', ['-lc', command], { stdio: 'inherit' });
process.exit(result.status ?? 1);
