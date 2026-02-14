import { useEffect, useRef } from 'react';

export interface ActionVariantView {
  id: string;
  label: string;
}

interface PlayChooserProps {
  cardId: string;
  cardLabel?: string;
  options: ActionVariantView[];
  title?: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}

export function PlayChooser({ cardId, cardLabel, options, title = 'Choose Play', onChoose, onClose }: PlayChooserProps) {
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
    <div className="play-chooser-overlay" role="presentation" onClick={onClose}>
      <div
        className="play-chooser"
        role="dialog"
        aria-modal="true"
        aria-label={`Choose how to play ${cardLabel ?? cardId}`}
        ref={containerRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="play-chooser-head">
          <h3>{title}</h3>
          <p>{cardLabel ?? cardId}</p>
        </header>
        <div className="play-options">
          {options.map((option) => (
            <button key={option.id} type="button" className="play-option" onClick={() => onChoose(option.id)}>
              {option.label}
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
