import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LanRoom } from '../gameService';

const SNAPSHOT_PATH = resolve(process.cwd(), 'apps/server/.lan-room-snapshots.json');

export function loadSnapshots(): LanRoom[] {
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as LanRoom[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSnapshots(rooms: LanRoom[]): void {
  try {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(rooms, null, 2));
  } catch {
    // Snapshot persistence is best-effort in LAN mode.
  }
}
