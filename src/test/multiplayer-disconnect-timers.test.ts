import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisconnectTimerRegistry, disconnectTimerKey } from '../../apps/server/src/disconnectTimers.ts';

describe('DisconnectTimerRegistry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('schedules a seat timeout only once for the same deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-22T12:00:00.000Z'));
    const onTimeout = vi.fn();
    const registry = new DisconnectTimerRegistry(onTimeout);

    const deadline = Date.now() + 1_000;
    expect(registry.schedule('ROOM1', 'p2', deadline)).toBe(true);
    expect(registry.schedule('ROOM1', 'p2', deadline)).toBe(false);
    expect(registry.size()).toBe(1);

    vi.advanceTimersByTime(1_100);

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith('ROOM1', 'p2');
    expect(registry.size()).toBe(0);
  });

  it('cancels a scheduled timeout when reconnect occurs', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-22T12:00:00.000Z'));
    const onTimeout = vi.fn();
    const registry = new DisconnectTimerRegistry(onTimeout);

    registry.schedule('ROOM1', 'p2', Date.now() + 3_000);
    expect(registry.has('ROOM1', 'p2')).toBe(true);

    expect(registry.cancel('ROOM1', 'p2')).toBe(true);
    expect(registry.has('ROOM1', 'p2')).toBe(false);

    vi.advanceTimersByTime(5_000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('syncValidKeys removes orphan timers', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const registry = new DisconnectTimerRegistry(onTimeout);

    registry.schedule('ROOM1', 'p1', Date.now() + 5_000);
    registry.schedule('ROOM1', 'p2', Date.now() + 5_000);

    registry.syncValidKeys(new Set([disconnectTimerKey('ROOM1', 'p2')]));
    expect(registry.has('ROOM1', 'p1')).toBe(false);
    expect(registry.has('ROOM1', 'p2')).toBe(true);
    expect(registry.size()).toBe(1);
  });

  it('fires immediately when deadline already passed', () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const registry = new DisconnectTimerRegistry(onTimeout);

    registry.schedule('ROOM1', 'p4', Date.now() - 1);
    vi.runOnlyPendingTimers();

    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout).toHaveBeenCalledWith('ROOM1', 'p4');
  });
});
