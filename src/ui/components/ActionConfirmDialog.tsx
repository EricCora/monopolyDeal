import { useEffect, useRef } from 'react';

interface ActionConfirmDialogProps {
  title: string;
  previewText: string;
  riskLevel: 'low' | 'medium' | 'high';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ActionConfirmDialog({ title, previewText, riskLevel, onConfirm, onCancel }: ActionConfirmDialogProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = root.querySelectorAll<HTMLButtonElement>('button');
    focusables[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancelRef.current();
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
    <div className="action-confirm-overlay" role="presentation" onClick={onCancel}>
      <div
        ref={containerRef}
        className={`action-confirm action-confirm-${riskLevel}`}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm risky action"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Confirm Action</h3>
        <p className="action-confirm-title">{title}</p>
        <p className="action-confirm-preview">{previewText}</p>
        <div className="actions">
          <button type="button" className="action-confirm-primary" onClick={onConfirm}>
            Confirm
          </button>
          <button type="button" className="action-confirm-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
