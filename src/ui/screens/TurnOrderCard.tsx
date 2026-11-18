import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { dropIndex, moveSeat } from './turnOrder';

export interface TurnOrderSeat {
  id: string;
  name: string;
  isBot?: boolean;
  isHost?: boolean;
}

interface TurnOrderCardProps {
  seats: TurnOrderSeat[];
  disabled?: boolean;
  /** Called once per drop, with every seat id in the new order. */
  onReorder: (seatOrder: string[]) => void | Promise<void>;
}

/** How long a finger rests on a row before it lifts, so a quick swipe still scrolls the page. */
const HOLD_MS = 300;
/** Moving further than this before the hold ends counts as a scroll, not a drag. */
const SLOP_PX = 8;

interface Drag {
  pointerId: number;
  id: string;
  startY: number;
  lifted: boolean;
  timer: number | null;
  /** Each row's vertical middle when the drag began, in page order. */
  middles: number[];
  from: number;
}

/**
 * The host's turn order for the next game. Hold a row (or press its grip) and drag it.
 * The arrows do the same from a keyboard.
 */
export function TurnOrderCard({ seats, disabled = false, onReorder }: TurnOrderCardProps) {
  const serverOrder = seats.map((seat) => seat.id);
  const serverKey = serverOrder.join(',');
  // The order just dropped, shown until the room answers. A new order from the room (a join,
  // a leave, or this move landing) replaces it.
  const [pending, setPending] = useState<{ order: string[]; base: string } | null>(null);
  const order = pending && pending.base === serverKey ? pending.order : serverOrder;
  /** The lifted row, for drawing: which one, where it started, and every row's middle at that moment. */
  const [live, setLive] = useState<{ id: string; from: number; middles: number[] } | null>(null);
  const [offset, setOffset] = useState(0);
  const drag = useRef<Drag | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // Once a row is lifted, the page mustn't scroll under the finger.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const block = (event: TouchEvent) => {
      if (drag.current?.lifted) event.preventDefault();
    };
    list.addEventListener('touchmove', block, { passive: false });
    return () => list.removeEventListener('touchmove', block);
  }, []);

  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const shown = order.filter((id) => byId.has(id));

  const commit = (next: string[]) => {
    if (next.join(',') === serverKey) return;
    const mine = { order: next, base: serverKey };
    setPending(mine);
    // Once the room has answered, stop showing the guess, whether it took the move or refused it.
    void Promise.resolve(onReorder(next)).finally(() => setPending((current) => (current === mine ? null : current)));
  };

  const lift = (state: Drag) => {
    state.lifted = true;
    const rows = Array.from(listRef.current?.children ?? []);
    state.middles = rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return rect.top + rect.height / 2;
    });
    setLive({ id: state.id, from: state.from, middles: state.middles });
    setOffset(0);
    navigator.vibrate?.(10);
  };

  const begin = (event: ReactPointerEvent<HTMLElement>, id: string, immediate: boolean) => {
    if (disabled || drag.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const state: Drag = { pointerId: event.pointerId, id, startY: event.clientY, lifted: false, timer: null, middles: [], from: shown.indexOf(id) };
    try {
      // Keeps the moves coming to this row even when the pointer leaves it.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer the browser isn't tracking can't be captured. The drag still works over the list.
    }
    drag.current = state;
    if (immediate || event.pointerType === 'mouse') lift(state);
    else state.timer = window.setTimeout(() => lift(state), HOLD_MS);
  };

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    if (!state.lifted) {
      if (Math.abs(event.clientY - state.startY) > SLOP_PX) cancel();
      return;
    }
    setOffset(event.clientY - state.startY);
  };

  const cancel = () => {
    const state = drag.current;
    if (state?.timer != null) window.clearTimeout(state.timer);
    drag.current = null;
    setLive(null);
    setOffset(0);
  };

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const lifted = state.lifted;
    const to = lifted ? dropIndex(state.middles, state.from, event.clientY - state.startY) : state.from;
    cancel();
    if (lifted) commit(moveSeat(shown, state.from, to));
  };

  // Where each row sits while one is being dragged: the others slide to open a gap.
  const liveTarget = live ? dropIndex(live.middles, live.from, offset) : -1;
  const rowShift = (index: number) => {
    if (!live || index === live.from) return 0;
    const step = live.middles.length > 1 ? (live.middles[live.middles.length - 1] - live.middles[0]) / (live.middles.length - 1) : 0;
    if (live.from < index && index <= liveTarget) return -step;
    if (liveTarget <= index && index < live.from) return step;
    return 0;
  };

  return (
    <section className="multiplayer-entry-card turn-order-card" aria-label="Turn order">
      <p className="setup-stage-label">Turn Order</p>
      <p className="menu-note">Hold a player and drag to change who goes when. The top player goes first.</p>
      <ol ref={listRef} className="turn-order-list" data-dragging={live ? 'true' : undefined}>
        {shown.map((id, index) => {
          const seat = byId.get(id)!;
          const dragging = live?.id === id;
          return (
            <li
              key={id}
              className={`turn-order-row${dragging ? ' is-dragging' : ''}`}
              style={{ transform: `translateY(${dragging ? offset : rowShift(index)}px)` }}
              onPointerDown={(event) => begin(event, id, false)}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={cancel}
              onContextMenu={(event) => event.preventDefault()}
              data-seat-id={id}
            >
              <span className="turn-order-position" aria-hidden="true">{index + 1}</span>
              <span className="turn-order-name">
                <strong>{seat.name}</strong>
                {seat.isHost ? <span className="multiplayer-player-tag">Host</span> : null}
                {seat.isBot ? <span className="multiplayer-player-tag">Bot</span> : null}
              </span>
              <span className="turn-order-arrows">
                <button
                  type="button"
                  className="glass-button"
                  aria-label={`Move ${seat.name} earlier`}
                  disabled={disabled || index === 0}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => commit(moveSeat(shown, index, index - 1))}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="glass-button"
                  aria-label={`Move ${seat.name} later`}
                  disabled={disabled || index === shown.length - 1}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => commit(moveSeat(shown, index, index + 1))}
                >
                  ↓
                </button>
              </span>
              <span
                className="turn-order-grip"
                aria-hidden="true"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  begin(event, id, true);
                }}
              >
                ≡
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
