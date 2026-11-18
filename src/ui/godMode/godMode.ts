import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** How long the table must be held, still, to switch god mode on or off. */
export const GOD_MODE_HOLD_MS = 5_000;
/** Moving further than this cancels the hold, so drags and scrolls never count. */
const HOLD_SLOP_PX = 14;
const STORAGE_KEY = 'monopolyDeal.tableHold';

/** Taps on these keep working as usual and never start a hold. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="dialog"], .card-view, .hand-fan, [data-card-id]';

/**
 * What this device remembers: whose god mode it is. `owner` is the normalized name of the
 * seat that switched it on, so on a shared device only that player ever sees the picker.
 * `null` means it was switched on before owners were kept: it then works only in games
 * with a single human seat.
 */
export interface GodModeState {
  on: boolean;
  owner: string | null;
}

export function normalizeOwner(name: string | undefined | null): string | null {
  const trimmed = name?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

function readStored(): GodModeState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { on: false, owner: null };
    if (raw === '1') return { on: true, owner: null };
    const parsed = JSON.parse(raw) as { owner?: unknown };
    return { on: true, owner: typeof parsed.owner === 'string' ? normalizeOwner(parsed.owner) : null };
  } catch {
    return { on: false, owner: null };
  }
}

function writeStored(state: GodModeState): void {
  try {
    if (state.on) window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ owner: state.owner }));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private windows can refuse storage; the mode still works until the page reloads.
  }
}

/** God mode is a setting on this device only. Nothing about it is sent to a room. */
export function useGodMode(): GodModeState & { toggle: (owner: string | null) => boolean } {
  const [state, setState] = useState(readStored);
  const toggle = useCallback((owner: string | null) => {
    const next: GodModeState = state.on ? { on: false, owner: null } : { on: true, owner: normalizeOwner(owner) };
    writeStored(next);
    setState(next);
    return next.on;
  }, [state.on]);
  return { ...state, toggle };
}

interface SeatLike {
  id: string;
  name: string;
  controller?: 'human' | 'bot';
}

/**
 * The seat a hold switches god mode on for, in a game played on this device: the player
 * whose turn it is, or, while a bot is moving, the first human seat.
 */
export function godModeOwnerForLocalGame(players: SeatLike[], currentPlayerIndex: number): string | null {
  const current = players[currentPlayerIndex];
  if (current && current.controller !== 'bot') return normalizeOwner(current.name);
  return normalizeOwner(players.find((player) => player.controller !== 'bot')?.name);
}

/** Whether a draw by `playerId`, in a game played on this device, may show the deck. */
export function godModeAppliesToLocalSeat(owner: string | null, players: SeatLike[], playerId: string): boolean {
  const drawer = players.find((player) => player.id === playerId);
  if (!drawer || drawer.controller === 'bot') return false;
  if (owner) return normalizeOwner(drawer.name) === owner;
  return players.filter((player) => player.controller !== 'bot').length === 1;
}

/**
 * Pointer handlers for a long, still hold on the table's background. `onHold` fires once
 * the hold reaches `holdMs`; lifting, moving or touching a card or button first cancels it.
 */
export function useTableHold(onHold: () => void, holdMs = GOD_MODE_HOLD_MS) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const onHoldRef = useRef(onHold);
  useEffect(() => {
    onHoldRef.current = onHold;
  }, [onHold]);

  const cancel = useCallback(() => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    cancel();
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target as Element | null;
    if (target?.closest?.(INTERACTIVE)) return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    timer.current = window.setTimeout(() => {
      timer.current = null;
      start.current = null;
      onHoldRef.current();
    }, holdMs);
  }, [cancel, holdMs]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const origin = start.current;
    if (!origin || origin.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > HOLD_SLOP_PX) cancel();
  }, [cancel]);

  return { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel };
}

/** A short buzz where the device supports it: two pulses on, one off. */
export function godModeHaptic(on: boolean): void {
  try {
    navigator.vibrate?.(on ? [40, 60, 40] : 60);
  } catch {
    // No vibration support.
  }
}
