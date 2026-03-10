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
  return (
    <section className="panel setup-screen card-enter">
      <h2>Hot Seat Setup</h2>
      <p className="setup-subtitle">Build your local pass-and-play table, then lock the seats before the first draw.</p>

      <label>
        Total Players
        <select value={setup.playerCount} onChange={(event) => onPlayerCountChange(Number(event.target.value))}>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>

      <div className="setup-player-grid">
        {setup.playerNames.slice(0, setup.playerCount).map((name, index) => {
          const controller = setup.playerControllers[index] ?? 'human';
          const difficulty = setup.botDifficulties[index] ?? 'easy';
          return (
            <div key={`player-name-${index + 1}`} className="setup-player-card">
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

      {allowCustomRules ? (
        <section className="settings-section" aria-label="Custom rule options">
          <h3>Custom Rules</h3>
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
        </section>
      ) : null}

      <div className="actions">
        <button onClick={onStartMatch}>Start Match</button>
        <button onClick={onBack}>Back</button>
      </div>
    </section>
  );
}
