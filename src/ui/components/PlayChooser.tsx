import { useEffect, useRef } from 'react';
import type { GameVariant } from '../../cards/catalog';
import { ActionLabelText } from './ActionLabelText';
import { CardView } from './CardView';
import { Icon } from './icons';

export interface ActionVariantView {
  id: string;
  label: string;
  description?: string;
}

interface PlayChooserProps {
  cardId: string;
  cardLabel?: string;
  options: ActionVariantView[];
  title?: string;
  /** Why the card can't do what it's meant for, when only something lesser is on offer. */
  note?: string | null;
  gameVariant?: GameVariant;
  onChoose: (id: string) => void;
  onClose: () => void;
}

export function PlayChooser({ cardId, cardLabel, options, title, note, gameVariant = 'classic', onChoose, onClose }: PlayChooserProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = root.querySelectorAll<HTMLButtonElement>('button');
    focusables[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const items = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      priorFocusRef.current?.focus();
    };
  }, []);

  return (
    <div className="sheet-overlay play-chooser-overlay" role="presentation" onClick={onClose}>
      <div
        className="sheet play-chooser"
        role="dialog"
        aria-modal="true"
        aria-label={`Choose how to play ${cardLabel ?? cardId}`}
        ref={containerRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="play-chooser-head">
          <CardView cardId={cardId} width={124} gameVariant={gameVariant} decorative />
          <h3>{title ?? cardLabel ?? cardId}</h3>
        </header>
        {note ? (
          <p className="play-chooser-note"><Icon name="info" /> {note}</p>
        ) : null}
        <div className="play-options">
          {options.map((option, index) => (
            <button key={option.id} type="button" className="play-option" onClick={() => onChoose(option.id)}>
              <span className="play-option-label-row">
                <span className="play-option-index sr-only">{index + 1}.</span>
                <ActionLabelText text={option.label} />
              </span>
              {option.description ? <small>{option.description}</small> : null}
            </button>
          ))}
        </div>
        <button type="button" className="play-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
