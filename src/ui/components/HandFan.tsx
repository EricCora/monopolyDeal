import { CardView } from './CardView';

interface HandFanProps {
  cards: string[];
  playableCardIds: Set<string>;
  selectedCardId: string | null;
  onCardClick: (cardId: string) => void;
  interactive: boolean;
  layout?: 'fan' | 'rail';
}

export function HandFan({
  cards,
  playableCardIds,
  selectedCardId,
  onCardClick,
  interactive,
  layout = 'fan',
}: HandFanProps) {
  const midpoint = (cards.length - 1) / 2;
  const spread = Math.max(3.8, Math.min(11, 34 / Math.max(cards.length, 2)));
  const isRailLayout = layout === 'rail';

  return (
    <div className={`hand-fan ${isRailLayout ? 'is-rail' : ''}`} aria-label="Player hand">
      {cards.map((cardId, index) => {
        const distance = index - midpoint;
        const rotate = isRailLayout ? 0 : distance * spread;
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
