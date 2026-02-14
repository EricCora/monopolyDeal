import type { SetupViewModel } from '../types';

interface SetupScreenProps {
  setup: SetupViewModel;
  onPlayerCountChange: (playerCount: number) => void;
  onPlayerNameChange: (index: number, value: string) => void;
  onStartMatch: () => void;
  onBack: () => void;
}

export function SetupScreen({
  setup,
  onPlayerCountChange,
  onPlayerNameChange,
  onStartMatch,
  onBack,
}: SetupScreenProps) {
  return (
    <section className="panel setup-screen card-enter">
      <h2>New Local Game</h2>
      <p className="setup-subtitle">Set your table and lock in each player before the first draw.</p>

      <label>
        Total Players
        <select value={setup.playerCount} onChange={(event) => onPlayerCountChange(Number(event.target.value))}>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>

      <div className="setup-player-grid">
        {setup.playerNames.slice(0, setup.playerCount).map((name, index) => (
          <label key={`player-name-${index + 1}`} className="setup-player-card">
            Player {index + 1} Name
            <input value={name} onChange={(event) => onPlayerNameChange(index, event.target.value)} />
          </label>
        ))}
      </div>

      <div className="actions">
        <button onClick={onStartMatch}>Start Match</button>
        <button onClick={onBack}>Back</button>
      </div>
    </section>
  );
}
