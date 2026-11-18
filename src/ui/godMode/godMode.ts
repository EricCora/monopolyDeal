import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** How long the table must be held, still, to switch god mode on or off. */
export const GOD_MODE_HOLD_MS = 10_000;
/** Moving further than this cancels the hold, so drags and scrolls never count. */
const HOLD_SLOP_PX = 14;
const STORAGE_KEY = 'monopolyDeal.tableHold';

/** Taps on these keep working as usual and never start a hold. */
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [role="dialog"], .card-view, .hand-fan, [data-card-id]';

function readStored(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeStored(on: boolean): void {
  try {
    if (on) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private windows can refuse storage; the mode still works until the page reloads.
  }
}

/** God mode is a setting on this device only. Nothing about it is sent to a room. */
export function useGodMode(): { on: boolean; toggle: () => void } {
  const [on, setOn] = useState(readStored);
  const toggle = useCallback(() => {
    setOn((current) => {
      writeStored(!current);
      return !current;
    });
  }, []);
  return { on, toggle };
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
