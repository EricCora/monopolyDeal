import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CardView } from './CardView';
import type { GameVariant } from '../../cards/catalog';
import type { CardInput } from '../tapPolicy';

interface HandFanProps {
  cards: string[];
  playableCardIds: Set<string>;
  selectedCardId: string | null;
  /** A card was activated. Whether it can be played is up to the handler. */
  onCardClick: (cardId: string, input?: CardInput) => void;
  /** A touch or click landed on a card that can't be played right now. */
  onBlockedCard?: (cardId: string) => void;
  interactive: boolean;
  fitMode?: 'auto' | 'fan' | 'rail';
  gameVariant?: GameVariant;
  /** Deals the first cards one at a time, for a brand new game. */
  dealOpening?: boolean;
  reducedMotion?: boolean;
}

const CARD_ASPECT_RATIO = 1.4;
// How soon the hand starts to spread, and how long a touch can last and still count as a
// tap. Spreading starts well before a tap has ended, so it feels immediate.
const HOLD_DELAY_MS = 60;
const TAP_WINDOW_MS = 250;
const MOVE_TOLERANCE = 12;
const FOCUS_SCALE = 1.5;
const HOVER_SCALE = 1.14;
const DRAG_TO_PLAY = 90;
const DEAL_STAGGER_MS = 95;

interface Gesture {
  pointerId: number;
  card: string | null;
  startX: number;
  startY: number;
  startTime: number;
  isTouch: boolean;
}

/**
 * The viewer's hand as an arc of cards that overlap more as the hand grows, so it always
 * fits. Tap to play, or drag a card up onto the table. Hold to spread the hand and slide
 * along it: the card under your finger lifts up, large enough to read. With a mouse, a card
 * lifts on hover. Mirrors `HandFan` in `TablePieces.swift`.
 */
export function HandFan({
  cards,
  playableCardIds,
  selectedCardId,
  onCardClick,
  onBlockedCard,
  interactive,
  fitMode = 'auto',
  gameVariant = 'classic',
  dealOpening = false,
  reducedMotion = false,
}: HandFanProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [isFanned, setIsFanned] = useState(false);
  const [focusedCard, setFocusedCard] = useState<string | null>(null);
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ card: string; x: number; y: number } | null>(null);
  const [shake, setShake] = useState<{ card: string; token: number } | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  // Cards present at first draw don't fly in, unless this is the opening deal.
  const [initialCards] = useState(() => new Set(cards));
  const [opening] = useState(() => dealOpening && !reducedMotion);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;
    const preferred = element.closest('.player-zone') as HTMLElement | null;
    const fallback = element.parentElement ?? element;
    const syncWidth = () => {
      const width = [preferred, fallback, element]
        .filter((candidate): candidate is HTMLElement => Boolean(candidate))
        .map((candidate) => candidate.getBoundingClientRect().width)
        .find((value) => value > 0) ?? 0;
      setContainerWidth(Math.round(width));
    };
    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    if (preferred) observer.observe(preferred);
    if (fallback !== preferred) observer.observe(fallback);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current);
  }, []);

  const layout = useMemo(() => {
    const count = Math.max(cards.length, 1);
    const cardWidth = containerWidth > 700 ? 170 : Math.round(Math.min(118, (containerWidth || 400) * 0.27));
    const width = containerWidth || 400;
    // The outer cards tilt, so they need some margin to stay on screen.
    const available = width - cardWidth - (isFanned ? 12 : 34);
    const spacing = count > 1 ? Math.min(cardWidth * (isFanned ? 0.95 : 0.8), available / (count - 1)) : 0;
    const total = spacing * (count - 1);
    const centers = cards.map((_, index) => (width - total) / 2 + index * spacing);
    const tight = fitMode === 'rail' || (fitMode === 'auto' && (count > 7 || spacing < cardWidth * 0.25));
    return { width, cardWidth, centers, tight };
  }, [cards, containerWidth, fitMode, isFanned]);
  const { width, cardWidth, centers } = layout;

  const localPoint = (event: ReactPointerEvent) => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  };

  /** The topmost card under a pointer. Later cards overlap earlier ones. */
  const cardAt = (x: number): string | null => {
    for (let index = centers.length - 1; index >= 0; index -= 1) {
      if (Math.abs(centers[index] - x) <= cardWidth / 2) return cards[index];
    }
    return null;
  };

  /** While the hand is held, every point along it belongs to the nearest card. */
  const nearestCard = (x: number): string | null => {
    let best: string | null = null;
    let bestDistance = Infinity;
    centers.forEach((center, index) => {
      const distance = Math.abs(center - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cards[index];
      }
    });
    return best;
  };

  const clearHoldTimer = () => {
    if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
  };

  const activate = (card: string, input: CardInput) => {
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 400);
    if (!interactive || !playableCardIds.has(card)) {
      setShake((current) => ({ card, token: (current?.token ?? 0) + 1 }));
      onBlockedCard?.(card);
      return;
    }
    onCardClick(card, input);
  };

  const endGesture = () => {
    clearHoldTimer();
    gestureRef.current = null;
    setIsFanned(false);
    setFocusedCard(null);
    setDrag(null);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || gestureRef.current) return;
    const { x, y } = localPoint(event);
    suppressClickRef.current = false;
    const isTouch = event.pointerType !== 'mouse';
    gestureRef.current = {
      pointerId: event.pointerId,
      card: cardAt(x),
      startX: x,
      startY: y,
      startTime: performance.now(),
      isTouch,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (isTouch) {
      clearHoldTimer();
      holdTimerRef.current = window.setTimeout(() => {
        setIsFanned(true);
        setFocusedCard(nearestCard(x));
      }, HOLD_DELAY_MS);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const { x, y } = localPoint(event);
    const gesture = gestureRef.current;
    if (!gesture) {
      if (event.pointerType === 'mouse') setHoveredCard(cardAt(x));
      return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    if (isFanned) {
      setFocusedCard(nearestCard(x));
      return;
    }
    const dx = x - gesture.startX;
    const dy = y - gesture.startY;
    if (Math.hypot(dx, dy) <= MOVE_TOLERANCE) return;
    clearHoldTimer();
    if (gesture.card && interactive && playableCardIds.has(gesture.card)) {
      setHoveredCard(null);
      setDrag({ card: gesture.card, x: dx, y: dy });
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const { x, y } = localPoint(event);
    const dx = x - gesture.startX;
    const dy = y - gesture.startY;
    const distance = Math.hypot(dx, dy);
    const input: CardInput = gesture.isTouch ? 'touch' : 'pointer';
    const { card, startTime } = gesture;
    if (isFanned) {
      endGesture();
      const wasTap = performance.now() - startTime < TAP_WINDOW_MS && distance <= MOVE_TOLERANCE;
      if (wasTap && card) activate(card, input);
      suppressClickRef.current = true;
      return;
    }
    const released = drag != null && dy < -DRAG_TO_PLAY;
    endGesture();
    if (card && (released || distance <= MOVE_TOLERANCE)) activate(card, input);
    suppressClickRef.current = true;
  };

  const midpoint = (cards.length - 1) / 2;
  const maxTilt = isFanned ? 1.2 : (cards.length > 7 || layout.tight ? 2.2 : 3.2);
  const style: CSSProperties = {
    ['--hand-card-w' as string]: `${cardWidth}px`,
    height: Math.round(cardWidth * CARD_ASPECT_RATIO) + 8,
  };

  return (
    <div
      ref={containerRef}
      className={`hand-fan ${layout.tight ? 'is-rail' : 'is-fan'} ${interactive ? 'is-interactive' : 'is-static'} ${isFanned ? 'is-held' : ''} ${drag ? 'is-dragging' : ''}`}
      style={style}
      aria-label="Player hand"
      data-layout={layout.tight ? 'rail' : 'fan'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={endGesture}
      onPointerLeave={() => setHoveredCard(null)}
    >
      {cards.map((cardId, index) => {
        const offset = index - midpoint;
        const selected = selectedCardId === cardId;
        const isFocused = focusedCard === cardId;
        const isHovered = hoveredCard === cardId && !isFanned && !drag;
        const isDragging = drag?.card === cardId;
        const playable = playableCardIds.has(cardId);
        let x = centers[index] ?? 0;
        if (isFocused) {
          // Keeps the enlarged card on screen at either end of the hand.
          const half = (cardWidth * FOCUS_SCALE) / 2 + 6;
          x = Math.min(Math.max(x, half), Math.max(half, width - half));
        }
        const lift = isFocused
          ? -18
          : isHovered
            ? -14
            : isFanned
              ? -6
              : offset * offset * 0.7;
        const y = lift + (selected && !isFanned ? -24 : 0) + (isDragging ? drag.y : 0);
        const tilt = isDragging || isFocused || isHovered ? 0 : offset * maxTilt;
        const scale = isFocused ? FOCUS_SCALE : isHovered ? HOVER_SCALE : 1;
        const arrives = opening || !initialCards.has(cardId);
        const arrivalIndex = opening ? index : 0;
        return (
          <div
            key={cardId}
            className={`hand-fan-card ${isFocused ? 'is-focused' : ''} ${isDragging ? 'is-dragged' : ''} ${selected ? 'is-selected' : ''} ${interactive && !playable && !isFocused ? 'is-dimmed' : ''}`}
            data-flip-id={cardId}
            data-flip-zone="hand"
            style={{
              transform: `translateX(${x - cardWidth / 2 + (isDragging ? drag.x : 0)}px) translateY(${y}px) rotate(${tilt}deg) scale(${scale})`,
              zIndex: isFocused ? 200 : isDragging || selected ? 100 : isHovered ? 150 : index + 1,
            }}
          >
            <div
              key={shake?.card === cardId ? shake.token : 0}
              className={`hand-fan-card-inner ${arrives && !reducedMotion ? 'is-arriving' : ''} ${shake?.card === cardId ? 'is-shaking' : ''}`}
              style={arrives ? { animationDelay: `${arrivalIndex * DEAL_STAGGER_MS}ms` } : undefined}
            >
              <CardView
                cardId={cardId}
                size="lg"
                width={cardWidth}
                context="hand"
                interactive={interactive}
                playable={playable}
                selected={selected}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  onCardClick(cardId, 'pointer');
                }}
                gameVariant={gameVariant}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
