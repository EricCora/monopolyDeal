import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MultiplayerRoom } from '../gameService.ts';

const SNAPSHOT_PATH = resolve(process.cwd(), 'apps/server/.multiplayer-room-snapshots.json');

export function loadSnapshots(): MultiplayerRoom[] {
  try {
    const raw = readFileSync(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MultiplayerRoom>[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((room): room is Partial<MultiplayerRoom> & { code: string } => typeof room?.code === 'string')
      .map((room) => ({
        ...room,
        paused: Boolean(room.paused),
        revision: Number.isFinite(room.revision) ? Number(room.revision) : 0,
        turnSnapshots: Array.isArray(room.turnSnapshots) ? room.turnSnapshots : [],
        checkpoints: Array.isArray(room.checkpoints) ? room.checkpoints : [],
      })) as MultiplayerRoom[];
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
