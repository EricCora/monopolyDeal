import { useEffect, useMemo, useState } from 'react';
import type { GameVariant } from '../../cards/catalog';
import { getCardDisplayName } from '../../cards/catalog';
import { CardView } from '../components/CardView';
import { groupDeckForPicker } from './deckGroups';

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
  const sections = useMemo(() => groupDeckForPicker(pile, variant), [pile, variant]);

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
        <p className="deck-picker-hint">{pile.length} in the deck. {picked.length} of {needed} chosen.</p>
        <div className="sheet-body deck-picker-body" role="listbox" aria-multiselectable="true" aria-label="Deck">
          {sections.map((section) => (
            <section key={section.key} className="deck-picker-section" aria-label={`${section.title}, ${section.count}`}>
              <h4 className="deck-picker-section-title">{section.title} <span>{section.count}</span></h4>
              {section.groups.map((group) => (
                <div key={group.key} className="deck-picker-group" role="group" aria-label={group.label}>
                  <span className="deck-picker-group-label">{group.label}</span>
                  <div className="deck-picker-grid">
                    {group.cards.map(({ cardId }) => {
                      const order = picked.indexOf(cardId);
                      return (
                        <button
                          key={cardId}
                          type="button"
                          role="option"
                          aria-selected={order >= 0}
                          className={`deck-picker-card ${order >= 0 ? 'is-picked' : ''}`}
                          onClick={() => toggle(cardId)}
                          aria-label={getCardDisplayName(cardId, variant)}
                          data-deck-card={cardId}
                        >
                          <CardView cardId={cardId} width={68} gameVariant={variant} context="table" />
                          {order >= 0 ? <span className="deck-picker-badge">{order + 1}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </section>
          ))}
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
