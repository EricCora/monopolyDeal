export type DisconnectTimeoutHandler = (roomCode: string, seatId: string) => void;

interface DisconnectTimerEntry {
  deadlineMs: number;
  timeout: NodeJS.Timeout;
}

export function disconnectTimerKey(roomCode: string, seatId: string): string {
  return `${roomCode}:${seatId}`;
}

export class DisconnectTimerRegistry {
  private readonly timers = new Map<string, DisconnectTimerEntry>();
  private readonly onTimeout: DisconnectTimeoutHandler;

  constructor(onTimeout: DisconnectTimeoutHandler) {
    this.onTimeout = onTimeout;
  }

  schedule(roomCode: string, seatId: string, deadlineMs: number): boolean {
    const key = disconnectTimerKey(roomCode, seatId);
    const existing = this.timers.get(key);
    if (existing && existing.deadlineMs === deadlineMs) {
      return false;
    }
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const delayMs = Math.max(0, deadlineMs - Date.now());
    const timeout = setTimeout(() => {
      this.timers.delete(key);
      this.onTimeout(roomCode, seatId);
    }, delayMs);

    this.timers.set(key, { deadlineMs, timeout });
    return true;
  }

  cancel(roomCode: string, seatId: string): boolean {
    return this.cancelByKey(disconnectTimerKey(roomCode, seatId));
  }

  has(roomCode: string, seatId: string): boolean {
    return this.timers.has(disconnectTimerKey(roomCode, seatId));
  }

  cancelRoom(roomCode: string): void {
    for (const key of this.timers.keys()) {
      if (!key.startsWith(`${roomCode}:`)) continue;
      this.cancelByKey(key);
    }
  }

  size(): number {
    return this.timers.size;
  }

  syncValidKeys(validKeys: Set<string>): void {
    for (const key of this.timers.keys()) {
      if (validKeys.has(key)) continue;
      this.cancelByKey(key);
    }
  }

  dispose(): void {
    for (const entry of this.timers.values()) {
      clearTimeout(entry.timeout);
    }
    this.timers.clear();
  }

  private cancelByKey(key: string): boolean {
    const existing = this.timers.get(key);
    if (!existing) return false;
    clearTimeout(existing.timeout);
    this.timers.delete(key);
    return true;
  }
}
