import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const snapshotPathEnvironmentVariable = 'MONOPOLY_DEAL_SNAPSHOT_PATH';
const previousSnapshotPath = process.env[snapshotPathEnvironmentVariable];
const temporaryDirectories: string[] = [];

async function loadSnapshotsModule() {
  const directory = await mkdtemp(join(tmpdir(), 'monopoly-deal-snapshots-'));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, 'apps/server'), { recursive: true });
  process.env[snapshotPathEnvironmentVariable] = join(directory, 'apps/server/.multiplayer-room-snapshots.json');
  vi.resetModules();
  return {
    directory,
    module: await import('./snapshots.ts'),
  };
}

afterEach(async () => {
  if (previousSnapshotPath === undefined) {
    delete process.env[snapshotPathEnvironmentVariable];
  } else {
    process.env[snapshotPathEnvironmentVariable] = previousSnapshotPath;
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('multiplayer room snapshots', () => {
  it('treats a missing snapshot as an empty first-run store', async () => {
    const { module } = await loadSnapshotsModule();

    expect(module.loadSnapshots()).toEqual([]);
  });

  it('reads legacy room snapshots and fills newer runtime defaults', async () => {
    const { directory, module } = await loadSnapshotsModule();
    await writeFile(
      join(directory, 'apps/server/.multiplayer-room-snapshots.json'),
      JSON.stringify([{ code: 'LEGACY', players: [], game: null }]),
      'utf8',
    );

    const [room] = module.loadSnapshots();

    expect(room.code).toBe('LEGACY');
    expect(room.players).toEqual([]);
    expect(room.activityFeed).toEqual([]);
    expect(room.chatMessages).toEqual([]);
  });

  it('surfaces unreadable JSON instead of silently starting with zero rooms', async () => {
    const { directory, module } = await loadSnapshotsModule();
    await writeFile(join(directory, 'apps/server/.multiplayer-room-snapshots.json'), '{not-json', 'utf8');

    expect(() => module.loadSnapshots()).toThrow(/Unable to parse multiplayer room snapshots/);
  });

  it('rejects a valid JSON value that is not the snapshot array', async () => {
    const { directory, module } = await loadSnapshotsModule();
    await writeFile(join(directory, 'apps/server/.multiplayer-room-snapshots.json'), '{"room":"A"}', 'utf8');

    expect(() => module.loadSnapshots()).toThrow(/expected a JSON array/);
  });

  it('coalesces rapid saves and atomically persists the newest snapshot', async () => {
    const { directory, module } = await loadSnapshotsModule();
    const stringifySpy = vi.spyOn(JSON, 'stringify');
    const firstSave = module.saveSnapshots([{ code: 'FIRST' }] as never);
    const secondSave = module.saveSnapshots([{ code: 'SECOND' }] as never);

    await module.flushSnapshots();
    await expect(firstSave).resolves.toBeUndefined();
    await expect(secondSave).resolves.toBeUndefined();

    const persisted = JSON.parse(await readFile(join(directory, 'apps/server/.multiplayer-room-snapshots.json'), 'utf8')) as Array<{ code: string }>;
    expect(persisted).toEqual([{ code: 'SECOND' }]);
    expect(stringifySpy).toHaveBeenCalledTimes(1);
  });

  it('rejects and logs when the snapshot cannot be persisted', async () => {
    const { directory, module } = await loadSnapshotsModule();
    await rm(join(directory, 'apps/server'), { recursive: true, force: true });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const save = module.saveSnapshots([{ code: 'UNWRITABLE' }] as never);
    await expect(module.flushSnapshots()).rejects.toThrow(/Unable to persist multiplayer room snapshots/);
    await expect(save).rejects.toThrow(/Unable to persist multiplayer room snapshots/);
    expect(errorSpy).toHaveBeenCalled();
  });
});
