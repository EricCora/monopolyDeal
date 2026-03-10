import type {
  MultiplayerRoomRuntimeState,
  MultiplayerRoomStatus,
  MultiplayerSession,
} from '../network/multiplayerTypes';

const RECOVERY_KEY = 'monopolyDeal.multiplayerRecovery.v1';
const LEGACY_SESSION_KEY = 'monopolyDeal.multiplayerSession.v1';
const TERMINAL_ENTRY_RETENTION_MS = 24 * 60 * 60 * 1000;

export type MultiplayerRecoveryState =
  | 'resumable'
  | 'reconnecting'
  | 'expired'
  | 'room_closed'
  | 'resume_failed';

export interface MultiplayerRecoveryEntry {
  roomCode: string;
  playerName: string;
  seatId?: string;
  resumeToken?: string;
  playerId?: string;
  sessionToken?: string;
  reconnectDeadlineMs?: number;
  lastKnownStatus?: MultiplayerRoomStatus;
  lastKnownRuntimeState?: MultiplayerRoomRuntimeState | null;
  recoveryState: MultiplayerRecoveryState;
  lastSeenAt: number;
}

interface MultiplayerRecoveryCollectionV1 {
  version: 1;
  entries: MultiplayerRecoveryEntry[];
}

function canonicalRoomCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return normalized.length >= 4 ? normalized : null;
}

function normalizeTimestamp(value: unknown, fallback = Date.now()): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeCredential(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizeRecoveryState(value: unknown): MultiplayerRecoveryState {
  if (value === 'reconnecting') return 'reconnecting';
  if (value === 'expired') return 'expired';
  if (value === 'room_closed') return 'room_closed';
  if (value === 'resume_failed') return 'resume_failed';
  return 'resumable';
}

function recoveryEntryKey(entry: Pick<MultiplayerRecoveryEntry, 'roomCode' | 'seatId' | 'playerId'>): string {
  return `${entry.roomCode}::${entry.seatId ?? entry.playerId ?? ''}`;
}

function sortRecoveryEntries(entries: MultiplayerRecoveryEntry[]): MultiplayerRecoveryEntry[] {
  return [...entries].sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}

function isTerminalRecoveryState(state: MultiplayerRecoveryState): boolean {
  return state === 'expired' || state === 'room_closed';
}

function shouldRetainEntry(entry: MultiplayerRecoveryEntry, now: number): boolean {
  if (!isTerminalRecoveryState(entry.recoveryState)) return true;
  const deadline = entry.reconnectDeadlineMs ?? entry.lastSeenAt;
  return now - deadline <= TERMINAL_ENTRY_RETENTION_MS;
}

function normalizeRecoveryEntry(raw: unknown): MultiplayerRecoveryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<MultiplayerRecoveryEntry>;
  const roomCode = canonicalRoomCode(candidate.roomCode);
  if (!roomCode) return null;
  if (typeof candidate.playerName !== 'string' || candidate.playerName.trim().length === 0) return null;
  return {
    roomCode,
    playerName: candidate.playerName.trim(),
    seatId: normalizeCredential(candidate.seatId),
    resumeToken: normalizeCredential(candidate.resumeToken),
    playerId: normalizeCredential(candidate.playerId),
    sessionToken: normalizeCredential(candidate.sessionToken),
    reconnectDeadlineMs: normalizeOptionalTimestamp(candidate.reconnectDeadlineMs),
    lastKnownStatus:
      candidate.lastKnownStatus === 'lobby' || candidate.lastKnownStatus === 'active' || candidate.lastKnownStatus === 'finished'
        ? candidate.lastKnownStatus
        : undefined,
    lastKnownRuntimeState:
      candidate.lastKnownRuntimeState === 'active'
      || candidate.lastKnownRuntimeState === 'paused_disconnect'
      || candidate.lastKnownRuntimeState === 'paused_host_disconnect'
      || candidate.lastKnownRuntimeState === 'ended_timeout'
        ? candidate.lastKnownRuntimeState
        : null,
    recoveryState: normalizeRecoveryState(candidate.recoveryState),
    lastSeenAt: normalizeTimestamp(candidate.lastSeenAt),
  };
}

function defaultCollection(): MultiplayerRecoveryCollectionV1 {
  return { version: 1, entries: [] };
}

function readLegacySessionEntry(): MultiplayerRecoveryEntry | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(LEGACY_SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<MultiplayerSession>;
    const roomCode = canonicalRoomCode(parsed.roomCode);
    const seatId = normalizeCredential(parsed.seatId ?? parsed.playerId);
    const resumeToken = normalizeCredential(parsed.resumeToken ?? parsed.sessionToken);
    const playerName = typeof parsed.playerName === 'string' ? parsed.playerName.trim() : '';
    if (!roomCode || !seatId || !resumeToken || !playerName) return null;
    return {
      roomCode,
      playerName,
      seatId,
      resumeToken,
      playerId: normalizeCredential(parsed.playerId) ?? seatId,
      sessionToken: normalizeCredential(parsed.sessionToken) ?? resumeToken,
      reconnectDeadlineMs: normalizeOptionalTimestamp(parsed.reconnectDeadlineMs),
      lastKnownStatus: undefined,
      lastKnownRuntimeState: null,
      recoveryState: 'resumable',
      lastSeenAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function readCollection(): MultiplayerRecoveryCollectionV1 {
  if (typeof window === 'undefined') return defaultCollection();
  const raw = window.localStorage.getItem(RECOVERY_KEY);
  if (!raw) {
    const legacyEntry = readLegacySessionEntry();
    if (!legacyEntry) return defaultCollection();
    const migrated = { version: 1 as const, entries: [legacyEntry] };
    window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(migrated));
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    return migrated;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MultiplayerRecoveryCollectionV1>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return defaultCollection();
    const normalized = sortRecoveryEntries(
      parsed.entries
        .map((entry) => normalizeRecoveryEntry(entry))
        .filter((entry): entry is MultiplayerRecoveryEntry => entry !== null),
    );
    return {
      version: 1,
      entries: normalized,
    };
  } catch {
    return defaultCollection();
  }
}

function writeCollection(entries: MultiplayerRecoveryEntry[]): MultiplayerRecoveryEntry[] {
  if (typeof window === 'undefined') return sortRecoveryEntries(entries);
  const sanitized = sortRecoveryEntries(entries);
  const payload: MultiplayerRecoveryCollectionV1 = {
    version: 1,
    entries: sanitized,
  };
  if (payload.entries.length === 0) {
    window.localStorage.removeItem(RECOVERY_KEY);
    window.localStorage.removeItem(LEGACY_SESSION_KEY);
    return [];
  }
  window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(payload));
  window.localStorage.removeItem(LEGACY_SESSION_KEY);
  return payload.entries;
}

export function loadRecoveryEntries(now = Date.now()): MultiplayerRecoveryEntry[] {
  const collection = readCollection();
  const retained = collection.entries.filter((entry) => shouldRetainEntry(entry, now));
  if (retained.length !== collection.entries.length) {
    return writeCollection(retained);
  }
  return retained;
}

export function saveRecoveryEntry(entry: MultiplayerRecoveryEntry): MultiplayerRecoveryEntry[] {
  const normalized = normalizeRecoveryEntry(entry);
  if (!normalized) return loadRecoveryEntries();
  const current = loadRecoveryEntries();
  const nextKey = recoveryEntryKey(normalized);
  const merged = [
    normalized,
    ...current.filter((existing) => recoveryEntryKey(existing) !== nextKey),
  ];
  return writeCollection(merged);
}

export function removeRecoveryEntry(identity: { roomCode: string; seatId?: string; playerId?: string }): MultiplayerRecoveryEntry[] {
  const roomCode = canonicalRoomCode(identity.roomCode);
  if (!roomCode) return loadRecoveryEntries();
  const current = loadRecoveryEntries();
  const targetKey = recoveryEntryKey({ roomCode, seatId: identity.seatId, playerId: identity.playerId });
  const filtered = current.filter((entry) => recoveryEntryKey(entry) !== targetKey);
  return writeCollection(filtered);
}

export function clearExpiredRecoveryEntries(now = Date.now()): MultiplayerRecoveryEntry[] {
  const current = readCollection().entries;
  const filtered = current.filter((entry) => shouldRetainEntry(entry, now));
  return writeCollection(filtered);
}

export function createRecoveryEntryFromSession(
  session: MultiplayerSession,
  overrides: Partial<MultiplayerRecoveryEntry> = {},
): MultiplayerRecoveryEntry {
  return {
    roomCode: canonicalRoomCode(overrides.roomCode ?? session.roomCode) ?? session.roomCode,
    playerName: (overrides.playerName ?? session.playerName).trim() || 'Player',
    seatId: overrides.seatId ?? session.seatId ?? session.playerId,
    resumeToken: overrides.resumeToken ?? session.resumeToken ?? session.sessionToken,
    playerId: overrides.playerId ?? session.playerId ?? session.seatId,
    sessionToken: overrides.sessionToken ?? session.sessionToken ?? session.resumeToken,
    reconnectDeadlineMs: overrides.reconnectDeadlineMs ?? session.reconnectDeadlineMs,
    lastKnownStatus: overrides.lastKnownStatus,
    lastKnownRuntimeState: overrides.lastKnownRuntimeState ?? null,
    recoveryState: overrides.recoveryState ?? 'resumable',
    lastSeenAt: overrides.lastSeenAt ?? Date.now(),
  };
}

export function recoveryEntryToSession(entry: MultiplayerRecoveryEntry): MultiplayerSession | null {
  const seatId = entry.seatId ?? entry.playerId;
  const resumeToken = entry.resumeToken ?? entry.sessionToken;
  const playerId = entry.playerId ?? entry.seatId;
  const sessionToken = entry.sessionToken ?? entry.resumeToken;
  if (!seatId || !resumeToken || !playerId || !sessionToken) return null;
  return {
    version: 1,
    roomCode: entry.roomCode,
    seatId,
    resumeToken,
    playerId,
    sessionToken,
    playerName: entry.playerName,
    reconnectDeadlineMs: entry.reconnectDeadlineMs ?? 0,
  };
}

export function canResumeRecoveryEntry(entry: MultiplayerRecoveryEntry | null | undefined): boolean {
  if (!entry) return false;
  if (entry.recoveryState === 'expired' || entry.recoveryState === 'room_closed') return false;
  return recoveryEntryToSession(entry) !== null;
}
