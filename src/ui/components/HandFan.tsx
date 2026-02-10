import { CardView } from './CardView';

interface HandFanProps {
  cards: string[];
  playableCardIds: Set<string>;
  selectedCardId: string | null;
  onCardClick: (cardId: string) => void;
  interactive: boolean;
}

export function HandFan({ cards, playableCardIds, selectedCardId, onCardClick, interactive }: HandFanProps) {
  const midpoint = (cards.length - 1) / 2;
  const spread = Math.min(12, Math.max(5, 26 / Math.max(cards.length, 2)));

  return (
    <div className="hand-fan" aria-label="Player hand">
      {cards.map((cardId, index) => {
        const distance = index - midpoint;
        const rotate = distance * spread;
        const raise = Math.abs(distance) * 3;
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
