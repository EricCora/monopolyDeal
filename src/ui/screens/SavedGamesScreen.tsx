import type { SavedGameSlotV1 } from '../../persistence/storage';
import { Icon } from '../components/icons';

export interface InProgressGame {
  variant?: string;
  players: string[];
  turn: number;
}

interface SavedGamesScreenProps {
  slots: SavedGameSlotV1[];
  /** The autosaved game that Continue Playing resumes, when the screen is opened from home. */
  inProgress?: InProgressGame | null;
  onResumeInProgress?: () => void;
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
              <h3>{slot.name}</h3>
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
              <button type="button" onClick={() => onDeleteSlot(slot.id)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
