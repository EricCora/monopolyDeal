#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';

const UI_PORT = 5173;
const SERVER_PORT = 8787;

function listListeners(port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  const listeners = [];
  let currentPid = null;
  let currentCommand = null;
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('p')) {
      currentPid = Number(line.slice(1));
    } else if (line.startsWith('c')) {
      currentCommand = line.slice(1);
    }
    if (currentPid && currentCommand) {
      listeners.push({ pid: currentPid, command: currentCommand });
      currentPid = null;
      currentCommand = null;
    }
  }
  return listeners;
}

function isSafeDevProcess(command) {
  const value = command.toLowerCase();
  return value.includes('node') || value.includes('vite') || value.includes('tsx') || value.includes('npm');
}

function killPid(pid, signal) {
  const result = spawnSync('kill', [`-${signal}`, String(pid)], { stdio: 'ignore' });
  return result.status === 0;
}

function waitForPortRelease(port, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (listListeners(port).length === 0) return true;
    spawnSync('sleep', ['0.1'], { stdio: 'ignore' });
  }
  return listListeners(port).length === 0;
}

function ensurePortAvailable(port) {
  const listeners = listListeners(port);
  if (listeners.length === 0) return true;
  for (const listener of listeners) {
    if (!isSafeDevProcess(listener.command)) {
      console.error(
        `[dev:lan:all] Port ${port} is in use by PID ${listener.pid} (${listener.command}). ` +
        `Please stop that process manually and retry.`,
      );
      return false;
    }
  }

  for (const listener of listeners) {
    console.log(`[dev:lan:all] Stopping stale process on port ${port}: PID ${listener.pid} (${listener.command})`);
    killPid(listener.pid, 'TERM');
  }
  if (waitForPortRelease(port)) return true;
  for (const listener of listeners) {
    killPid(listener.pid, 'KILL');
  }
  if (waitForPortRelease(port)) return true;

  console.error(`[dev:lan:all] Could not clear port ${port}. Please run: lsof -nP -iTCP:${port} -sTCP:LISTEN`);
  return false;
}

function run() {
  if (!ensurePortAvailable(UI_PORT) || !ensurePortAvailable(SERVER_PORT)) {
    process.exit(1);
  }

  const ui = spawn('npm', ['run', 'dev:lan'], { stdio: 'inherit' });
  const server = spawn('npm', ['run', 'dev:multiplayer-server'], { stdio: 'inherit' });

  let shuttingDown = false;
  const shutdown = (code = 0) => {
    if (shuttingDown) return;
    shuttingDown = true;
    ui.kill('SIGTERM');
    server.kill('SIGTERM');
    process.exit(code);
  };

  ui.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' && shuttingDown) return;
    if (code === 0) {
      shutdown(0);
      return;
    }
    shutdown(typeof code === 'number' ? code : 1);
  });
  server.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' && shuttingDown) return;
    if (code === 0) {
      shutdown(0);
      return;
    }
    shutdown(typeof code === 'number' ? code : 1);
  });

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}

run();
