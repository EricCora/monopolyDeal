#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (existsSync('playwright.config.ts') || existsSync('playwright.config.js')) {
  run('npx', ['playwright', 'test']);
  process.exit(0);
}

if (existsSync('cypress.config.ts') || existsSync('cypress.config.js')) {
  run('npx', ['cypress', 'run']);
  process.exit(0);
}

console.log('[run_e2e] No Playwright/Cypress config found. Running smoke UI tests instead.');
run('npm', ['run', 'test', '--', 'src/test/app.test.tsx', 'src/test/multiplayer-screen.test.tsx']);
