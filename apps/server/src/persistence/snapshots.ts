import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MultiplayerRoom } from '../gameService';

const SNAPSHOT_PATH = resolve(process.cwd(), 'apps/server/.multiplayer-room-snapshots.json');

export function loadSnapshots(): MultiplayerRoom[] {
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as MultiplayerRoom[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSnapshots(rooms: MultiplayerRoom[]): void {
  try {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(rooms, null, 2));
  } catch {
    // Snapshot persistence is best-effort in multiplayer mode.
  }
}
