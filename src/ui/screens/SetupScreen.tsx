import type { SetupViewModel } from '../types';
import type { BotDifficulty, GameVariant, PlayerController } from '../../engine';
import { Icon } from '../components/icons';
import { PlayerAvatar } from '../table/tablePieces';

interface SetupScreenProps {
  setup: SetupViewModel;
  allowAiOpponents: boolean;
  allowCustomRules: boolean;
  onPlayerCountChange: (playerCount: number) => void;
  onVariantChange?: (variant: GameVariant) => void;
  onPlayerNameChange: (index: number, value: string) => void;
  onPlayerControllerChange: (index: number, controller: PlayerController) => void;
  onPlayerDifficultyChange: (index: number, difficulty: BotDifficulty) => void;
  onChangeCustomRule: (rule: keyof SetupViewModel['customRules'], value: number) => void;
  onSpeedModeChange?: (enabled: boolean) => void;
  onBestOfChange?: (bestOf: 1 | 3) => void;
  onStartMatch: () => void;
  onBack: () => void;
}

interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

/** A segmented control over a real select, which stays focusable for the keyboard and screen readers. */
function Segmented<T extends string | number>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div className="segmented">
      <label className="sr-only">
        {label}
        <select
          value={value}
          onChange={(event) => {
            const chosen = options.find((option) => String(option.value) === event.target.value);
            if (chosen) onChange(chosen.value);
          }}
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? 'is-selected' : ''}
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface RuleStepperProps {
  title: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}

function RuleStepper({ title, label, value, min, max, onChange }: RuleStepperProps) {
  return (
    <div className="rule-stepper glass-panel">
      <label>
        <span>{title}: {value}</span>
        <input className="sr-only" aria-label={label} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </label>
      <div className="rule-stepper-buttons">
        <button type="button" aria-hidden="true" tabIndex={-1} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <button type="button" aria-hidden="true" tabIndex={-1} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </div>
    </div>
  );
}

export function SetupScreen({
  setup,
  allowAiOpponents,
  allowCustomRules,
  onPlayerCountChange,
  onVariantChange,
  onPlayerNameChange,
  onPlayerControllerChange,
  onPlayerDifficultyChange,
  onChangeCustomRule,
  onSpeedModeChange,
  onBestOfChange,
  onStartMatch,
  onBack,
}: SetupScreenProps) {
  const variant = setup.variant ?? 'classic';

  return (
    <section className="menu-screen setup-screen card-enter">
      <header className="menu-nav">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <h2 aria-label="Set The Table">New Game</h2>
      </header>

      <div className="sr-only" aria-label="Match snapshot">
        {variant === 'no_mercy' ? (
          <>
            <p>{setup.playerCount} seats · No Mercy rules</p>
            <p>3 sets to win · debt repayment before plays</p>
          </>
        ) : (
          <>
            <p>{setup.playerCount} seats · {setup.customRules.winCompleteSets} sets to win</p>
            <p>{setup.customRules.maxPlaysPerTurn} plays each turn · {setup.customRules.maxHandAtEndTurn} card hand limit</p>
          </>
        )}
        <p>Set The Table</p>
      </div>

      <section className="menu-section">
        <p className="section-title">Game</p>
        <Segmented<GameVariant>
          label="Game Variant"
          value={variant}
          options={[{ value: 'classic', label: 'Classic' }, { value: 'no_mercy', label: 'No Mercy' }]}
          onChange={(value) => onVariantChange?.(value)}
        />
        <p className="menu-note">
          {variant === 'classic'
            ? 'The original: 106 cards and three sets to win.'
            : '115 cards, debt chips, Shacks and far nastier action cards.'}
        </p>
      </section>

      <section className="menu-section" aria-label="Seat lineup">
        <p className="section-title">Players</p>
        <Segmented<number>
          label="Total Players"
          value={setup.playerCount}
          options={[2, 3, 4, 5].map((count) => ({ value: count, label: String(count) }))}
          onChange={onPlayerCountChange}
        />
        {setup.playerNames.slice(0, setup.playerCount).map((name, index) => {
          const controller = setup.playerControllers[index] ?? 'human';
          const difficulty = setup.botDifficulties[index] ?? 'easy';
          return (
            <div key={`player-name-${index + 1}`} className="setup-player-card glass-panel">
              <div className="setup-player-line">
                <PlayerAvatar name={name || `P${index + 1}`} isBot={controller === 'bot'} />
                <label className="setup-player-name">
                  <span className="sr-only">Player {index + 1} Name</span>
                  <input value={name} placeholder={`Player ${index + 1}`} onChange={(event) => onPlayerNameChange(index, event.target.value)} />
                </label>
                {allowAiOpponents ? (
                  <label className="setup-player-controller">
                    <span className="sr-only">Controller</span>
                    <select value={controller} onChange={(event) => onPlayerControllerChange(index, event.target.value as PlayerController)}>
                      <option value="human">Human</option>
                      <option value="bot">Bot</option>
                    </select>
                  </label>
                ) : null}
              </div>
              {allowAiOpponents && controller === 'bot' ? (
                <Segmented<BotDifficulty>
                  label="Bot Difficulty"
                  value={difficulty}
                  options={[{ value: 'easy', label: 'Easy' }, { value: 'hard', label: 'Hard' }]}
                  onChange={(value) => onPlayerDifficultyChange(index, value)}
                />
              ) : null}
            </div>
          );
        })}
      </section>

      {onSpeedModeChange || onBestOfChange ? (
        <section className="menu-section" aria-label="Match options">
          <p className="section-title">Pace</p>
          {onSpeedModeChange ? (
            <>
              <Segmented<'normal' | 'speed'>
                label="Turn Timer"
                value={setup.speedMode ? 'speed' : 'normal'}
                options={[{ value: 'normal', label: 'No Limit' }, { value: 'speed', label: 'Speed' }]}
                onChange={(value) => onSpeedModeChange(value === 'speed')}
              />
              <p className="menu-note">
                {setup.speedMode
                  ? '45 seconds a turn. When time runs out, a bot moves for you.'
                  : 'A clock shows how long each turn is taking, with no limit.'}
              </p>
            </>
          ) : null}
          {onBestOfChange ? (
            <Segmented<1 | 3>
              label="Match Length"
              value={setup.bestOf ?? 1}
              options={[{ value: 1, label: 'Single Game' }, { value: 3, label: 'Best of Three' }]}
              onChange={onBestOfChange}
            />
          ) : null}
        </section>
      ) : null}

      {allowCustomRules && variant !== 'no_mercy' ? (
        <section className="menu-section" aria-label="Custom rule options">
          <p className="section-title">House Rules</p>
          <RuleStepper title="Sets to win" label="Win Sets" value={setup.customRules.winCompleteSets} min={2} max={5} onChange={(value) => onChangeCustomRule('winCompleteSets', value)} />
          <RuleStepper title="Hand limit" label="Hand Limit At End Turn" value={setup.customRules.maxHandAtEndTurn} min={4} max={12} onChange={(value) => onChangeCustomRule('maxHandAtEndTurn', value)} />
          <RuleStepper title="Plays per turn" label="Max Plays Per Turn" value={setup.customRules.maxPlaysPerTurn} min={1} max={6} onChange={(value) => onChangeCustomRule('maxPlaysPerTurn', value)} />
        </section>
      ) : null}

      <button type="button" className="primary-button" onClick={onStartMatch} aria-label="Start Match: Deal the Cards">
        <Icon name="spade" /> Deal the Cards
      </button>
    </section>
  );
}
