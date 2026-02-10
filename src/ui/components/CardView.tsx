import type { CSSProperties } from 'react';
import { getCardVisualModel } from '../cards';

type CardSize = 'sm' | 'md' | 'lg';

interface CardViewProps {
  cardId: string;
  faceUp?: boolean;
  size?: CardSize;
  interactive?: boolean;
  playable?: boolean;
  selected?: boolean;
  annotation?: string;
  onClick?: () => void;
}

export function CardView({
  cardId,
  faceUp = true,
  size = 'md',
  interactive = false,
  playable = false,
  selected = false,
  annotation,
  onClick,
}: CardViewProps) {
  if (!faceUp) {
    return (
      <button
        type="button"
        className={`card-view card-back card-size-${size} ${interactive ? 'is-interactive' : ''}`}
        onClick={onClick}
        disabled={!interactive || !onClick}
        aria-label="Hidden card"
      >
        <span className="card-back-mark">MD</span>
      </button>
    );
  }

  const model = getCardVisualModel(cardId);
  const style: CSSProperties = {
    ['--card-accent' as string]: model.accent,
    ['--card-accent-split' as string]: model.splitAccent ?? model.accent,
  };

  return (
    <button
      type="button"
      className={`card-view card-size-${size} ${model.themeClass} kind-${model.kindClass} ${interactive ? 'is-interactive' : ''} ${playable ? 'is-playable' : 'is-unplayable'} ${selected ? 'is-selected' : ''}`}
      style={style}
      onClick={onClick}
      disabled={!interactive || !onClick}
      aria-label={`${model.title} card`}
    >
      <span className="card-face">
        <span className="card-value">{model.valueBadge}</span>
        <span className="card-title">{model.title}</span>
        <span className="card-subtitle">{model.subtitle}</span>
        {model.setSize ? <span className="card-meta">Set {model.setSize}</span> : null}
        {model.rentScale && model.rentScale.length > 0 ? (
          <span className="card-meta">Rent ${model.rentScale.join('/$')}</span>
        ) : null}
        {annotation ? <span className="card-annotation">{annotation}</span> : null}
      </span>
    </button>
  );
}
