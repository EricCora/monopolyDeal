import type { SetupViewModel } from '../types';
import type { BotDifficulty, PlayerController } from '../../engine';

interface SetupScreenProps {
  setup: SetupViewModel;
  allowAiOpponents: boolean;
  allowCustomRules: boolean;
  onPlayerCountChange: (playerCount: number) => void;
  onPlayerNameChange: (index: number, value: string) => void;
  onPlayerControllerChange: (index: number, controller: PlayerController) => void;
  onPlayerDifficultyChange: (index: number, difficulty: BotDifficulty) => void;
  onChangeCustomRule: (rule: keyof SetupViewModel['customRules'], value: number) => void;
  onStartMatch: () => void;
  onBack: () => void;
}

export function SetupScreen({
  setup,
  allowAiOpponents,
  allowCustomRules,
  onPlayerCountChange,
  onPlayerNameChange,
  onPlayerControllerChange,
  onPlayerDifficultyChange,
  onChangeCustomRule,
  onStartMatch,
  onBack,
}: SetupScreenProps) {
  const activeSeats = setup.playerNames.slice(0, setup.playerCount).map((name, index) => ({
    name: name.trim() || `Player ${index + 1}`,
    index,
  }));

  return (
    <section className="panel setup-screen card-enter">
      <div className="setup-header">
        <div className="setup-header-copy">
          <p className="setup-kicker">Hot Seat</p>
          <h2>Set The Table</h2>
          <p className="setup-subtitle">Build your local pass-and-play table, assign each seat, and lock the pace before the first draw.</p>
        </div>
        <aside className="setup-stage-note" aria-label="Match snapshot">
          <p className="setup-stage-label">Tonight&apos;s table</p>
          <p>{setup.playerCount} seats · {setup.customRules.winCompleteSets} sets to win</p>
          <p>{setup.customRules.maxPlaysPerTurn} plays each turn · {setup.customRules.maxHandAtEndTurn} card hand limit</p>
          <div className="setup-seat-preview" aria-label="Seat preview">
            {activeSeats.map((seat) => (
              <div key={`seat-preview-${seat.index + 1}`} className="setup-seat-chip">
                <span className="setup-seat-chip-number">{seat.index + 1}</span>
                <span className="setup-seat-chip-name">{seat.name}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      <div className="setup-workspace">
        <section className="setup-stage-panel" aria-label="Seat lineup">
          <div className="setup-stage-bar">
            <label className="setup-player-count">
              Total Players
              <select value={setup.playerCount} onChange={(event) => onPlayerCountChange(Number(event.target.value))}>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
              </select>
            </label>
            <p className="setup-stage-helper">Pass one device around the table and reveal only the active seat when it is time to act.</p>
          </div>

          <div className="setup-player-grid">
            {setup.playerNames.slice(0, setup.playerCount).map((name, index) => {
              const controller = setup.playerControllers[index] ?? 'human';
              const difficulty = setup.botDifficulties[index] ?? 'easy';
              return (
                <div key={`player-name-${index + 1}`} className="setup-player-card">
                  <p className="setup-seat-label">Seat {index + 1}</p>
                  <label>
                    Player {index + 1} Name
                    <input value={name} onChange={(event) => onPlayerNameChange(index, event.target.value)} />
                  </label>

                  {allowAiOpponents ? (
                    <>
                      <label>
                        Controller
                        <select
                          value={controller}
                          onChange={(event) => onPlayerControllerChange(index, event.target.value as PlayerController)}
                        >
                          <option value="human">Human</option>
                          <option value="bot">Bot</option>
                        </select>
                      </label>

                      {controller === 'bot' ? (
                        <label>
                          Bot Difficulty
                          <select
                            value={difficulty}
                            onChange={(event) => onPlayerDifficultyChange(index, event.target.value as BotDifficulty)}
                          >
                            <option value="easy">Easy (Heuristic)</option>
                            <option value="hard">Hard (Rollout)</option>
                          </select>
                        </label>
                      ) : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        {allowCustomRules ? (
          <section className="settings-section setup-rules-panel" aria-label="Custom rule options">
            <p className="setup-stage-label">House Rules</p>
            <h3>Dial the pace without changing the core flow.</h3>
            <p className="setup-rules-copy">Use the defaults for a standard match night or tweak the limits for shorter, sharper rounds.</p>
            <div className="setup-rules-grid">
              <label>
                Win Sets
                <input
                  type="number"
                  min={2}
                  max={5}
                  value={setup.customRules.winCompleteSets}
                  onChange={(event) => onChangeCustomRule('winCompleteSets', Number(event.target.value))}
                />
              </label>
              <label>
                Hand Limit At End Turn
                <input
                  type="number"
                  min={4}
                  max={12}
                  value={setup.customRules.maxHandAtEndTurn}
                  onChange={(event) => onChangeCustomRule('maxHandAtEndTurn', Number(event.target.value))}
                />
              </label>
              <label>
                Max Plays Per Turn
                <input
                  type="number"
                  min={1}
                  max={6}
                  value={setup.customRules.maxPlaysPerTurn}
                  onChange={(event) => onChangeCustomRule('maxPlaysPerTurn', Number(event.target.value))}
                />
              </label>
            </div>
          </section>
        ) : null}
      </div>

      <div className="setup-launch-bar">
        <div className="setup-launch-copy">
          <p className="setup-stage-label">Ready to deal</p>
          <p>{setup.playerCount} seats are staged for a {setup.customRules.winCompleteSets}-set match.</p>
        </div>
        <div className="actions setup-footer-actions">
          <button onClick={onStartMatch}>Start Match</button>
          <button onClick={onBack}>Back</button>
        </div>
      </div>
    </section>
  );
}
