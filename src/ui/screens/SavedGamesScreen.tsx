import { useEffect, useState } from 'react';
import type { SavedGameSlotV1 } from '../../persistence/storage';
import { Icon } from '../components/icons';

export interface InProgressGame {
  variant?: string;
  players: string[];
  turn: number;
}

/** The last delete, which Undo can still put back. */
export interface PendingDeletion {
  id: string;
  label: string;
}

/** How long Undo stays offered after a delete. */
export const UNDO_SECONDS = 6;

interface SavedGamesScreenProps {
  slots: SavedGameSlotV1[];
  /** The autosaved game that Continue Playing resumes, when the screen is opened from home. */
  inProgress?: InProgressGame | null;
  onResumeInProgress?: () => void;
  onDeleteInProgress?: () => void;
  deletion?: PendingDeletion | null;
  onUndoDelete?: () => void;
  onDismissUndo?: () => void;
  canSaveCurrent: boolean;
  error: string | null;
  onSaveCurrentToNewSlot: () => void;
  onLoadSlot: (slotId: string) => void;
  onSaveToExistingSlot: (slotId: string) => void;
  onRenameSlot: (slotId: string) => void;
  onDeleteSlot: (slotId: string) => void;
  onBack: () => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function slotSummary(slot: SavedGameSlotV1): string {
  const names = slot.gameState.players.map((player) => player.name).join(', ');
  return `${names} | Turn ${slot.gameState.turnCount}`;
}

export function SavedGamesScreen({
  slots,
  inProgress = null,
  onResumeInProgress,
  onDeleteInProgress,
  deletion = null,
  onUndoDelete,
  onDismissUndo,
  canSaveCurrent,
  error,
  onSaveCurrentToNewSlot,
  onLoadSlot,
  onSaveToExistingSlot,
  onRenameSlot,
  onDeleteSlot,
  onBack,
}: SavedGamesScreenProps) {
  const slotsRemaining = Math.max(5 - slots.length, 0);
  const inProgressTitle = inProgress ? `${inProgress.variant === 'no_mercy' ? 'No Mercy' : 'Classic'} Game` : '';
  // The countdown waits while the pointer or keyboard focus is on the bar, so Undo can't vanish mid-reach.
  const [holdingUndo, setHoldingUndo] = useState(false);
  const deletionId = deletion?.id ?? null;
  useEffect(() => {
    if (!deletionId || holdingUndo || !onDismissUndo) return undefined;
    const handle = window.setTimeout(onDismissUndo, UNDO_SECONDS * 1000);
    return () => window.clearTimeout(handle);
  }, [deletionId, holdingUndo, onDismissUndo]);

  return (
    <section className="panel saved-games-screen card-enter">
      <header className="menu-nav">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <h2>Saved Games</h2>
      </header>
      <p className="saved-games-subtitle">Your game in progress is kept automatically. Save to a slot to keep up to 5 more.</p>

      {inProgress && onResumeInProgress ? (
        <section className="saved-game-slot saved-game-in-progress" aria-label="In Progress">
          <header>
            <p className="saved-game-kicker">In Progress</p>
            <h3>{inProgressTitle}</h3>
            <p>{inProgress.players.length} players · Turn {inProgress.turn}</p>
          </header>
          <div className="actions">
            <button type="button" className="cta-primary" onClick={onResumeInProgress} aria-label={`Resume ${inProgressTitle}`}>
              Resume
            </button>
            {onDeleteInProgress ? (
              <button type="button" className="saved-game-delete" onClick={onDeleteInProgress} aria-label={`Delete ${inProgressTitle}`}>
                Delete
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="saved-games-toolbar actions">
        <button type="button" className="cta-primary" onClick={onSaveCurrentToNewSlot} disabled={!canSaveCurrent || slotsRemaining === 0}>
          Save Current Game
        </button>
      </div>

      <p className="saved-games-capacity">
        Slots used: <strong>{slots.length}</strong>/5
      </p>

      {slots.length === 0 && !inProgress ? <p className="saved-games-empty">No saved slots yet.</p> : null}

      <div className="saved-games-list" aria-label="Saved game slots">
        {slots.map((slot) => (
          <article key={slot.id} className="saved-game-slot">
            <header>
              <h3 id={`saved-slot-name-${slot.id}`}>{slot.name}</h3>
              <p>Updated: {formatDate(slot.updatedAt)}</p>
              <p>{slotSummary(slot)}</p>
            </header>
            <div className="actions">
              <button type="button" onClick={() => onLoadSlot(slot.id)}>
                Load
              </button>
              <button type="button" onClick={() => onSaveToExistingSlot(slot.id)} disabled={!canSaveCurrent}>
                Save Here
              </button>
              <button type="button" onClick={() => onRenameSlot(slot.id)}>
                Rename
              </button>
              <button type="button" className="saved-game-delete" onClick={() => onDeleteSlot(slot.id)} aria-describedby={`saved-slot-name-${slot.id}`}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {deletion ? (
        <div
          className="saved-games-undo glass-panel"
          role="status"
          onPointerEnter={() => setHoldingUndo(true)}
          onPointerLeave={() => setHoldingUndo(false)}
          onFocus={() => setHoldingUndo(true)}
          onBlur={() => setHoldingUndo(false)}
        >
          <span>Deleted {deletion.label}</span>
          <button type="button" onClick={onUndoDelete}>Undo</button>
        </div>
      ) : null}
    </section>
  );
}
