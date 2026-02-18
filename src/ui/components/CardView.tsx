import type { CSSProperties } from 'react';
import { getCardVisualModel } from '../cards';

type CardSize = 'sm' | 'md' | 'lg';
type CardVariant = 'standard' | 'premium';
type CardElevation = 'base' | 'raised';
type CardStatusTone = 'neutral' | 'success' | 'warning';

interface CardViewProps {
  cardId: string;
  faceUp?: boolean;
  size?: CardSize;
  context?: 'hand' | 'table';
  variant?: CardVariant;
  elevation?: CardElevation;
  statusTone?: CardStatusTone;
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
  context = 'table',
  variant = 'premium',
  elevation = 'base',
  statusTone = 'neutral',
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
        className={`card-view card-back card-size-${size} card-variant-${variant} card-elevation-${elevation} tone-${statusTone} ${interactive ? 'is-interactive' : ''}`}
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
  const isProperty = model.cardRole === 'property';
  const isCompactRent = size === 'sm';
  const isHandRentSummary = isProperty && context === 'hand';
  const isHandCard = context === 'hand';
  const shouldShowSubtitle = !(isHandCard && size === 'lg' && (model.cardRole === 'money' || model.cardRole === 'property'));

  return (
    <button
      type="button"
      className={`card-view card-size-${size} card-context-${context} card-variant-${variant} card-elevation-${elevation} tone-${statusTone} ${model.themeClass} kind-${model.kindClass} role-${model.cardRole} ${model.motifClass ?? ''} ${interactive ? 'is-interactive' : ''} ${playable ? 'is-playable' : 'is-unplayable'} ${selected ? 'is-selected' : ''}`}
      style={style}
      onClick={onClick}
      disabled={!interactive || !onClick}
      aria-label={`${model.title} card`}
    >
      <span className="card-face">
        <span className="card-head">
          <span className="card-value">{model.valueBadge}</span>
          {model.actionBadge ? (
            <span className="card-badge">
              {model.actionIcon ? <img className="card-badge-icon" src={model.actionIcon} alt="" aria-hidden="true" /> : null}
              <span>{model.actionBadge}</span>
            </span>
          ) : null}
        </span>
        <span className={`card-role-pill role-${model.roleTagClass}`} aria-label="Card type">
          {model.roleTag}
        </span>
        <span className="card-title" title={model.title}>{model.title}</span>
        {shouldShowSubtitle ? <span className="card-subtitle" title={model.subtitle}>{model.subtitle}</span> : null}
        {model.colorLabel ? <span className="card-color-label">{model.colorLabel}</span> : null}

        {isProperty && model.rentSteps && !isHandRentSummary ? (
          <span className={`card-rent ${isCompactRent ? 'is-compact' : ''}`} aria-label="Rent ladder">
            <span className="card-rent-label">Rent</span>
            <span className="card-rent-grid">
              {model.rentSteps.map((step) => (
                <span
                  key={`${model.cardId}-rent-${step.setCount}`}
                  className={`card-rent-step ${step.setCount === model.setSize ? 'is-fullset' : ''}`}
                >
                  <span className="card-rent-count">{step.setCount}</span>
                  <span className="card-rent-value">${step.rent}</span>
                </span>
              ))}
            </span>
          </span>
        ) : null}

        {isHandRentSummary && model.rentSteps ? (
          <span className="card-rent-hand-summary" aria-label="Rent summary">
            Rent {model.rentSteps.map((step) => `$${step.rent}`).join('/')}
          </span>
        ) : null}

        {model.rentActionLines && model.rentActionLines.length > 0 ? (
          <span className={`card-rent-action ${isCompactRent ? 'is-compact' : ''}`} aria-label="Rent action summary">
            {model.rentActionLines.map((line) => (
              <span key={`${model.cardId}-${line}`} className="card-rent-action-line">{line}</span>
            ))}
          </span>
        ) : null}

        {annotation ? <span className="card-annotation">{annotation}</span> : null}
      </span>
    </button>
  );
}
