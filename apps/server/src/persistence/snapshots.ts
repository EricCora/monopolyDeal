import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeRoomForRuntime, type MultiplayerRoom } from '../gameService.ts';

const SNAPSHOT_PATH = resolve(
  process.env.MONOPOLY_DEAL_SNAPSHOT_PATH ?? resolve(process.cwd(), 'apps/server/.multiplayer-room-snapshots.json'),
);
const SNAPSHOT_DEBOUNCE_MS = 100;

type SaveWaiter = {
  resolve: () => void;
  reject: (error: unknown) => void;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRooms: MultiplayerRoom[] | null = null;
let pendingWaiters: SaveWaiter[] = [];
let activeWrite: Promise<void> = Promise.resolve();
let lastWrite: Promise<void> | null = null;

function snapshotError(message: string, cause: unknown): Error {
  return new Error(`${message}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
}

export function loadSnapshots(): MultiplayerRoom[] {
  let raw: string;
  try {
    raw = readFileSync(SNAPSHOT_PATH, 'utf8');
  } catch (error) {
    // A missing snapshot is the normal first-run state. Other read failures must
    // stop startup rather than silently discarding every saved room.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw snapshotError(`Unable to read multiplayer room snapshots at ${SNAPSHOT_PATH}`, error);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw snapshotError(`Unable to parse multiplayer room snapshots at ${SNAPSHOT_PATH}`, error);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Unable to load multiplayer room snapshots at ${SNAPSHOT_PATH}: expected a JSON array`);
  }

  return parsed.map((room, index) => {
    if (!room || typeof room !== 'object' || Array.isArray(room) || typeof (room as { code?: unknown }).code !== 'string') {
      throw new Error(`Unable to load multiplayer room snapshots at ${SNAPSHOT_PATH}: invalid room at index ${index}`);
    }

    const candidate = room as Partial<MultiplayerRoom>;
    return normalizeRoomForRuntime({
      ...candidate,
      paused: Boolean(candidate.paused),
      revision: Number.isFinite(candidate.revision) ? Number(candidate.revision) : 0,
      turnSnapshots: Array.isArray(candidate.turnSnapshots) ? candidate.turnSnapshots : [],
      checkpoints: Array.isArray(candidate.checkpoints) ? candidate.checkpoints : [],
    } as MultiplayerRoom);
  });
}

async function writeSnapshot(serialized: string): Promise<void> {
  const temporaryPath = `${SNAPSHOT_PATH}.${process.pid}.${randomUUID()}.tmp`;
  try {
    // Write and rename in the same directory so readers see either the old
    // complete file or the new complete file, never a partial JSON document.
    await writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, SNAPSHOT_PATH);
  } catch (error) {
    try {
      await unlink(temporaryPath);
    } catch {
      // Cleanup is best effort; preserve and report the original write error.
    }
    throw snapshotError(`Unable to persist multiplayer room snapshots at ${SNAPSHOT_PATH}`, error);
  }
}

function reportWriteError(error: unknown): void {
  // saveSnapshots is called from synchronous request handlers. Keep those
  // handlers non-blocking, but make asynchronous persistence failures visible.
  console.error(error);
}

function flushPending(): Promise<void> | null {
  if (pendingRooms === null) return null;

  const rooms = pendingRooms;
  pendingRooms = null;
  const waiters = pendingWaiters;
  pendingWaiters = [];
  const operation = activeWrite.then(() => {
    let serialized: string;
    try {
      serialized = JSON.stringify(rooms, null, 2);
    } catch (error) {
      throw snapshotError(`Unable to serialize multiplayer room snapshots for ${SNAPSHOT_PATH}`, error);
    }
    return writeSnapshot(serialized);
  });
  lastWrite = operation;
  activeWrite = operation.catch((error) => {
    reportWriteError(error);
  });
  void operation.then(
    () => waiters.forEach(({ resolve }) => resolve()),
    (error) => waiters.forEach(({ reject }) => reject(error)),
  );
  return operation;
}

function scheduleFlush(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushPending();
  }, SNAPSHOT_DEBOUNCE_MS);
}

/**
 * Queue a debounced, atomic snapshot write. The returned promise resolves once
 * this call's snapshot (or a newer coalesced snapshot) is durable and rejects
 * when persistence fails. Callers that do not await it still receive a visible
 * console error from the asynchronous write path.
 */
export function saveSnapshots(rooms: MultiplayerRoom[]): Promise<void> {
  // Clone before queueing so callers cannot mutate the array while it waits for
  // the debounce window. JSON serialization itself is deferred until flush so
  // rapid saves coalesce both the pending data and the expensive conversion.
  pendingRooms = structuredClone(rooms);
  const promise = new Promise<void>((resolveWaiter, rejectWaiter) => {
    pendingWaiters.push({ resolve: resolveWaiter, reject: rejectWaiter });
  });
  // Ignored promises (the existing server call sites intentionally do not
  // await persistence) should still be reported by reportWriteError without
  // creating a process-level unhandled rejection.
  void promise.catch(() => undefined);
  scheduleFlush();
  return promise;
}

/** Flush pending writes, primarily for graceful shutdown and deterministic tests. */
export async function flushSnapshots(): Promise<void> {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const pending = flushPending();
  if (pending) {
    await pending;
    return;
  }
  if (lastWrite) await lastWrite;
}
