import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CardView } from './CardView';

interface HandFanProps {
  cards: string[];
  playableCardIds: Set<string>;
  selectedCardId: string | null;
  onCardClick: (cardId: string) => void;
  interactive: boolean;
  fitMode?: 'auto' | 'fan' | 'rail';
}

const MIN_CARD_WIDTH = 88;
const MAX_CARD_WIDTH = 108;
const CARD_ASPECT_RATIO = 152 / 108;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function HandFan({
  cards,
  playableCardIds,
  selectedCardId,
  onCardClick,
  interactive,
  fitMode = 'auto',
}: HandFanProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const preferredMeasurementElement = element.closest('.player-zone') as HTMLElement | null;
    const fallbackMeasurementElement = element.parentElement ?? element;

    const syncWidth = () => {
      const candidateElements = [
        preferredMeasurementElement,
        fallbackMeasurementElement,
        element,
      ].filter((candidate): candidate is HTMLElement => Boolean(candidate));
      const nextWidth = candidateElements
        .map((candidate) => candidate.getBoundingClientRect().width)
        .find((width) => width > 0) ?? 0;
      setContainerWidth(Math.round(nextWidth));
    };

    syncWidth();
    const observer = new ResizeObserver(syncWidth);
    if (preferredMeasurementElement) {
      observer.observe(preferredMeasurementElement);
    }
    if (fallbackMeasurementElement !== preferredMeasurementElement) {
      observer.observe(fallbackMeasurementElement);
    }
    return () => observer.disconnect();
  }, []);

  const fitModel = useMemo(() => {
    const count = Math.max(cards.length, 1);
    const baseCardWidth = clamp(MAX_CARD_WIDTH - Math.max(0, count - 7) * 2, MIN_CARD_WIDTH, MAX_CARD_WIDTH);
    const fanOverlap = clamp(baseCardWidth * 0.3, 16, 30);
    const visiblePerCard = Math.max(baseCardWidth - fanOverlap, 30);
    const neededFanWidth = baseCardWidth + (count - 1) * visiblePerCard + 24;
    const availableWidth = Math.max(containerWidth - 12, 0);

    let resolvedLayout: 'fan' | 'rail';
    if (fitMode === 'fan') {
      resolvedLayout = 'fan';
    } else if (fitMode === 'rail') {
      resolvedLayout = 'rail';
    } else {
      const roomyFanLayout = count <= 5 || (count <= 7 && availableWidth >= 540);
      resolvedLayout = roomyFanLayout ? 'fan' : 'rail';
    }

    if (resolvedLayout === 'rail') {
      const targetRailWidth = availableWidth > 0 ? availableWidth * 0.34 : baseCardWidth;
      const railCardWidth = clamp(Math.round(targetRailWidth), 108, 132);
      const railGap = clamp(Math.round(railCardWidth * 0.12), 12, 18);
      return {
        layout: resolvedLayout,
        cardWidth: railCardWidth,
        cardHeight: Math.round(railCardWidth * CARD_ASPECT_RATIO),
        overlap: 0,
        railGap,
        spread: 0,
      };
    }

    // Keep small hands more readable before the draw step by avoiding aggressive fan down-scaling.
    const minFanScale = count <= 5 ? 0.94 : 0.84;
    const scale = availableWidth > 0 ? clamp(availableWidth / Math.max(neededFanWidth, 1), minFanScale, 1) : 1;
    const cardWidth = Math.round(baseCardWidth * scale);
    const overlap = clamp(fanOverlap * scale, count <= 5 ? 14 : 18, 40);
    const spread = clamp((34 / Math.max(count, 2)) * scale, 3.2, 10.5);
    return {
      layout: resolvedLayout,
      cardWidth,
      cardHeight: Math.round(cardWidth * CARD_ASPECT_RATIO),
      overlap,
      railGap: 0,
      spread,
    };
  }, [cards.length, containerWidth, fitMode]);

  const midpoint = (cards.length - 1) / 2;
  const isRailLayout = fitModel.layout === 'rail';
  const style: CSSProperties = {
    ['--hand-card-w' as string]: `${fitModel.cardWidth}px`,
    ['--hand-card-h' as string]: `${fitModel.cardHeight}px`,
    ['--fan-overlap' as string]: `${fitModel.overlap}px`,
    ['--rail-gap' as string]: `${fitModel.railGap}px`,
  };

  return (
    <div
      ref={containerRef}
      className={`hand-fan ${isRailLayout ? 'is-rail' : 'is-fan'} ${interactive ? 'is-interactive' : 'is-static'}`}
      style={style}
      aria-label="Player hand"
      data-layout={fitModel.layout}
    >
      {cards.map((cardId, index) => {
        const distance = index - midpoint;
        const rotate = isRailLayout ? 0 : distance * fitModel.spread;
        const raise = isRailLayout ? 0 : Math.abs(distance) * Math.max(2, 18 / Math.max(cards.length, 2));
        return (
          <div
            key={cardId}
            className="hand-fan-card"
            style={{
              transform: `translateY(${raise}px) rotate(${rotate}deg)`,
              zIndex: index + 1,
            }}
          >
            <CardView
              cardId={cardId}
              size="lg"
              context="hand"
              interactive={interactive}
              playable={playableCardIds.has(cardId)}
              selected={selectedCardId === cardId}
              onClick={() => onCardClick(cardId)}
            />
          </div>
        );
      })}
    </div>
  );
}
