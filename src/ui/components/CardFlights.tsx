import { Component, createRef, type ReactNode } from 'react';

interface CardFlightsProps {
  /** Changes whenever the game does. Cards are only measured across a change. */
  flightKey: number;
  enabled: boolean;
  className?: string;
  children: ReactNode;
}

interface Measured {
  x: number;
  y: number;
  width: number;
  zone: string | null;
}

type Snapshot = Map<string, Measured> | null;

const FLIGHT_MS = 420;
// A big reshuffle snaps its shortest moves, so a crowded board stays smooth.
const MAX_FLIGHTS = 28;
const EASING = 'cubic-bezier(0.2, 0.85, 0.25, 1)';

function measure(element: HTMLElement): Measured | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    width: element.offsetWidth || rect.width,
    zone: element.dataset.flipZone ?? null,
  };
}

/**
 * Glides every card to its new place after a game update, whoever made the move: the iOS
 * app's matched-geometry animation. Each card that moved is hidden while a copy flies from
 * its old spot, in a layer above everything, so scrolling boards can't clip it. Cards mark
 * themselves with `data-flip-id`; an unseen card arrives from its `data-flip-origin` owner.
 * The hand animates its own cards, so moves within it are left alone.
 */
export class CardFlights extends Component<CardFlightsProps> {
  private root = createRef<HTMLDivElement>();
  private layer = createRef<HTMLDivElement>();

  getSnapshotBeforeUpdate(previous: CardFlightsProps): Snapshot {
    if (previous.flightKey === this.props.flightKey || !this.props.enabled || !this.root.current) return null;
    const rects = new Map<string, Measured>();
    this.root.current.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((element) => {
      const measured = measure(element);
      if (measured) rects.set(element.dataset.flipId as string, measured);
    });
    return rects;
  }

  componentDidUpdate(_previous: CardFlightsProps, _state: unknown, snapshot: Snapshot) {
    if (!snapshot || !this.root.current) return;
    const flights: Array<{ element: HTMLElement; from: Pick<Measured, 'x' | 'y' | 'width'>; to: Measured; distance: number }> = [];
    this.root.current.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((element) => {
      const now = measure(element);
      if (!now) return;
      let from: Pick<Measured, 'x' | 'y' | 'width'> | null = snapshot.get(element.dataset.flipId as string) ?? null;
      if (from && (snapshot.get(element.dataset.flipId as string) as Measured).zone === 'hand' && now.zone === 'hand') return;
      if (!from) {
        if (now.zone === 'hand') return;
        const origin = element.closest<HTMLElement>('[data-flip-origin]');
        if (!origin) return;
        const rect = origin.getBoundingClientRect();
        from = { x: rect.left + rect.width / 2, y: rect.top + 24, width: now.width * 0.4 };
      }
      const distance = Math.hypot(from.x - now.x, from.y - now.y);
      if (distance < 3 && from.width === now.width) return;
      flights.push({ element, from, to: now, distance });
    });
    flights
      .sort((left, right) => right.distance - left.distance)
      .slice(0, MAX_FLIGHTS)
      .forEach(({ element, from, to }) => this.fly(element, from, to));
  }

  private fly(element: HTMLElement, from: Pick<Measured, 'x' | 'y' | 'width'>, to: Measured) {
    const layer = this.layer.current;
    const card = element.querySelector<HTMLElement>('.card-view');
    if (!layer || !card || typeof card.animate !== 'function') return;
    const copy = card.cloneNode(true) as HTMLElement;
    copy.removeAttribute('id');
    copy.setAttribute('aria-hidden', 'true');
    copy.setAttribute('tabindex', '-1');
    copy.style.setProperty('--card-w', `${to.width}px`);
    copy.style.position = 'absolute';
    copy.style.left = `${to.x - to.width / 2}px`;
    copy.style.top = `${to.y - (to.width * 1.4) / 2}px`;
    layer.appendChild(copy);
    element.style.visibility = 'hidden';
    const flight = copy.animate(
      [
        { transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.width / to.width})`, boxShadow: '0 18px 30px rgba(0,0,0,0.5)' },
        { transform: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.3)' },
      ],
      { duration: FLIGHT_MS, easing: EASING },
    );
    const finish = () => {
      element.style.visibility = '';
      copy.remove();
    };
    flight.onfinish = finish;
    flight.oncancel = finish;
  }

  render() {
    return (
      <div ref={this.root} className={this.props.className}>
        {this.props.children}
        <div ref={this.layer} className="card-flight-layer" aria-hidden="true" />
      </div>
    );
  }
}
