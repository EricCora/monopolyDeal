import { useEffect, useState } from 'react';
import type { GameVariant } from '../../cards/catalog';
import { CardView } from '../components/CardView';

interface DeckPickerProps {
  /** The pile from the next card to be drawn to the last. */
  pile: string[];
  count: number;
  variant: GameVariant;
  onConfirm: (pick: string[]) => void;
  onCancel: () => void;
}

/** God mode's view of the deck: pick the cards this draw takes, in any order. */
export function DeckPicker({ pile, count, variant, onConfirm, onCancel }: DeckPickerProps) {
  const needed = Math.min(count, pile.length);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const toggle = (cardId: string) => {
    setPicked((current) => {
      if (current.includes(cardId)) return current.filter((id) => id !== cardId);
      if (current.length >= needed) return [...current.slice(1), cardId];
      return [...current, cardId];
    });
  };

  return (
    <div className="sheet-overlay deck-picker-overlay" role="presentation" onClick={onCancel}>
      <div className="sheet is-tall deck-picker" role="dialog" aria-modal="true" aria-label="Choose your draw" onClick={(event) => event.stopPropagation()}>
        <span className="sheet-grabber" aria-hidden="true" />
        <h3 className="sheet-title">Choose {needed} {needed === 1 ? 'card' : 'cards'}</h3>
        <p className="deck-picker-hint">{pile.length} in the deck, next card first. {picked.length} of {needed} chosen.</p>
        <div className="sheet-body deck-picker-grid" role="listbox" aria-multiselectable="true" aria-label="Deck">
          {pile.map((cardId, index) => {
            const order = picked.indexOf(cardId);
            return (
              <button
                key={cardId}
                type="button"
                role="option"
                aria-selected={order >= 0}
                className={`deck-picker-card ${order >= 0 ? 'is-picked' : ''}`}
                onClick={() => toggle(cardId)}
                aria-label={`Deck card ${index + 1}`}
              >
                <CardView cardId={cardId} width={68} gameVariant={variant} context="table" />
                {order >= 0 ? <span className="deck-picker-badge">{order + 1}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="deck-picker-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
          <button type="button" className="primary-button is-accent" disabled={picked.length !== needed} onClick={() => onConfirm(picked)}>
            Draw {needed}
          </button>
        </div>
      </div>
    </div>
  );
}
