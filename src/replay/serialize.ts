import type { GameState } from '../engine';

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function toStableJsonValue(input: unknown): JsonValue {
  if (input == null) return null;
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') {
    return input;
  }
  if (Array.isArray(input)) {
    return input.map((entry) => toStableJsonValue(entry));
  }

  if (typeof input === 'object') {
    const entries = Object.entries(input as Record<string, unknown>)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));

    const next: { [key: string]: JsonValue } = {};
    for (const [key, value] of entries) {
      next[key] = toStableJsonValue(value);
    }
    return next;
  }

  return String(input);
}

export function stableStringify(input: unknown): string {
  return JSON.stringify(toStableJsonValue(input));
}

export function normalizeReplayState(state: GameState): GameState {
  return {
    ...state,
    createdAt: 0,
    updatedAt: 0,
    history: state.history.map((event) => ({
      ...event,
      timestamp: 0,
    })),
  };
}

export function replayStateFingerprint(state: GameState): string {
  const text = stableStringify(normalizeReplayState(state));
  // FNV-1a 32-bit hash for deterministic replay fingerprinting.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
