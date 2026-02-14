import type { SavedGameSlotV1 } from '../../persistence/storage';

interface SavedGamesScreenProps {
  slots: SavedGameSlotV1[];
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

  return (
    <section className="panel saved-games-screen card-enter">
      <h2>Saved Games</h2>
      <p className="saved-games-subtitle">Manage up to 5 manual save slots. Quick Resume still uses active autosave.</p>

      <div className="saved-games-toolbar actions">
        <button type="button" onClick={onSaveCurrentToNewSlot} disabled={!canSaveCurrent || slotsRemaining === 0}>
          Save Current Game
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>

      <p className="saved-games-capacity">
        Slots used: <strong>{slots.length}</strong>/5
      </p>

      {slots.length === 0 ? <p className="saved-games-empty">No saved slots yet.</p> : null}

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
