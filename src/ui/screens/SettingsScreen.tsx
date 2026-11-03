import { useState } from 'react';
import type { UiPreferencesV1 } from '../../persistence/storage';
import { Icon } from '../components/icons';
import { feedbackMailtoUrl } from '../feedbackMail';
import { cardBackOptions, tableStyleOptions } from '../unlockables';

type DevSeedStatus = 'seeded' | 'already-populated' | 'reseeded' | null;

interface SettingsScreenProps {
  uiPreferences: UiPreferencesV1;
  devSeedStatus: DevSeedStatus;
  onToggleReducedEffects: (enabled: boolean) => void;
  onToggleHighContrast: (enabled: boolean) => void;
  onToggleSound: (enabled: boolean) => void;
  onToggleHaptics: (enabled: boolean) => void;
  onChangeTextScale: (value: UiPreferencesV1['textScale']) => void;
  onChangeTableDensity: (value: UiPreferencesV1['tableDensity']) => void;
  onChangeTableStyle: (value: UiPreferencesV1['tableStyle']) => void;
  onChangeCardBack?: (value: string) => void;
  unlockProgress?: { wins: number; actions: number; quickWins: number };
  onToggleConfirmRiskyActions: (enabled: boolean) => void;
  onToggleRulesDrawerHints: (enabled: boolean) => void;
  onToggleExperimentalFlag: (flag: keyof UiPreferencesV1['experimental'], enabled: boolean) => void;
  onToggleHardCoach?: (enabled: boolean) => void;
  onToggleDevMode: (enabled: boolean) => void;
  onReseedDevData: () => void;
  onClearStatsData: () => void;
  onBack: () => void;
}

function devStatusMessage(status: DevSeedStatus): string | null {
  if (status === 'seeded') return 'Seeded medium sample stats and match history.';
  if (status === 'already-populated') return 'Skipped auto-seed because match history already contains data.';
  if (status === 'reseeded') return 'Replaced stats and match history with medium sample data.';
  return null;
}

export function SettingsScreen({
  uiPreferences,
  devSeedStatus,
  onToggleReducedEffects,
  onToggleHighContrast,
  onToggleSound,
  onToggleHaptics,
  onChangeTextScale,
  onChangeTableDensity,
  onChangeTableStyle,
  onChangeCardBack,
  unlockProgress = { wins: 0, actions: 0, quickWins: 0 },
  onToggleConfirmRiskyActions,
  onToggleRulesDrawerHints,
  onToggleExperimentalFlag,
  onToggleHardCoach,
  onToggleDevMode,
  onReseedDevData,
  onClearStatsData,
  onBack,
}: SettingsScreenProps) {
  const statusMessage = devStatusMessage(devSeedStatus);
  const [experimentalOpen, setExperimentalOpen] = useState(false);
  const [feedback, setFeedback] = useState('');

  const experimentalEnabledCount = Object.values(uiPreferences.experimental).filter(Boolean).length;

  const renderToggle = (
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void,
  ) => (
    <label className="settings-toggle-card">
      <span className="settings-toggle-label">{label}</span>
      <input
        className="settings-switch-input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="settings-switch-ui" aria-hidden="true">
        <span className="settings-switch-thumb" />
      </span>
    </label>
  );

  return (
    <section className="panel settings-screen card-enter">
      <header className="menu-nav">
        <button type="button" className="icon-button" onClick={onBack} aria-label="Back"><Icon name="back" /></button>
        <h2>Settings</h2>
      </header>

      <section className="settings-section" aria-label="Display settings">
        <h3>Table</h3>
        <div className="settings-select-grid">
          <label className="settings-field">
            <span>Table Style</span>
            <select value={uiPreferences.tableStyle} onChange={(event) => onChangeTableStyle(event.target.value as UiPreferencesV1['tableStyle'])}>
              {tableStyleOptions(unlockProgress).map((option) => (
                <option key={option.value} value={option.value} disabled={!option.unlocked}>
                  {option.unlocked ? option.label : `${option.label} (${option.needs})`}
                </option>
              ))}
            </select>
          </label>
          {onChangeCardBack ? (
            <label className="settings-field">
              <span>Card Back</span>
              <select value={uiPreferences.cardBack ?? 'classic_red'} onChange={(event) => onChangeCardBack(event.target.value)}>
                {cardBackOptions(unlockProgress).map((option) => (
                  <option key={option.value} value={option.value} disabled={!option.unlocked}>
                    {option.unlocked ? option.label : `${option.label} (${option.needs})`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="settings-field">
            <span>Text Scale</span>
            <select value={uiPreferences.textScale} onChange={(event) => onChangeTextScale(event.target.value as UiPreferencesV1['textScale'])}>
              <option value="normal">Normal</option>
              <option value="large">Large</option>
            </select>
          </label>
          <label className="settings-field">
            <span>Table Density</span>
            <select value={uiPreferences.tableDensity} onChange={(event) => onChangeTableDensity(event.target.value as UiPreferencesV1['tableDensity'])}>
              <option value="cozy">Cozy</option>
              <option value="compact">Compact</option>
            </select>
          </label>
        </div>
        <div className="settings-grid">
          {renderToggle('Reduce Effects', uiPreferences.reducedEffects, onToggleReducedEffects)}
          {renderToggle('High Contrast Mode', uiPreferences.highContrast, onToggleHighContrast)}
        </div>
      </section>

      <section className="settings-section" aria-label="Feedback settings">
        <h3>Feedback</h3>
        <div className="settings-grid">
          {renderToggle('Sound Effects', uiPreferences.soundEnabled, onToggleSound)}
          {renderToggle('Haptic Feedback (supported devices)', uiPreferences.hapticsEnabled, onToggleHaptics)}
        </div>
      </section>

      <section className="settings-section" aria-label="Gameplay preferences">
        <h3>Gameplay</h3>
        <div className="settings-grid">
          {renderToggle('Confirm Risky Actions', uiPreferences.confirmRiskyActions, onToggleConfirmRiskyActions)}
          {renderToggle('Coach Hints', uiPreferences.experimental.aiCoach, (enabled) => onToggleExperimentalFlag('aiCoach', enabled))}
          {uiPreferences.experimental.aiCoach && onToggleHardCoach
            ? renderToggle('Thorough Coach', Boolean(uiPreferences.hardCoach), onToggleHardCoach)
            : null}
          {renderToggle('Custom Classic Rules', uiPreferences.experimental.customRules, (enabled) => onToggleExperimentalFlag('customRules', enabled))}
          {renderToggle('Show Rules Hints', uiPreferences.showRulesDrawerHints, onToggleRulesDrawerHints)}
        </div>
        <p className="settings-subtitle settings-footnote">Custom rules add sets to win, hand limit and plays per turn to New Game. No Mercy always uses the official rules.</p>
      </section>

      <section className="settings-section" aria-label="Send feedback">
        <h3>Send Feedback</h3>
        <label className="settings-field">
          <span>Tell the developer what you think</span>
          <textarea
            rows={4}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Bugs, ideas, anything"
          />
        </label>
        <div className="actions">
          <button
            type="button"
            disabled={!feedback.trim()}
            onClick={() => { window.location.href = feedbackMailtoUrl(feedback); }}
          >
            Email the Developer
          </button>
        </div>
        <p className="settings-subtitle settings-footnote">Opens your email app with the message ready to send.</p>
      </section>

      <section className="settings-section settings-danger-zone" aria-label="Data controls">
        <h3>Data</h3>
        <div className="actions">
          <button type="button" className="settings-danger-action" onClick={onClearStatsData}>
            Clear Stats & History
          </button>
        </div>
        <p className="settings-subtitle settings-footnote">This removes local match history and stats.</p>
      </section>

      <section className="settings-section" aria-label="Experimental features">
        <button
          type="button"
          className="settings-accordion-button"
          aria-expanded={experimentalOpen}
          onClick={() => setExperimentalOpen((prev) => !prev)}
        >
          <span>Experimental Features</span>
          <small>{experimentalEnabledCount} enabled</small>
        </button>
        {experimentalOpen ? (
          <div className="settings-grid settings-grid-experimental">
            {renderToggle('AI Opponents', uiPreferences.experimental.aiOpponents, (enabled) => onToggleExperimentalFlag('aiOpponents', enabled))}
            {renderToggle('Replay Timeline', uiPreferences.experimental.replayTimeline, (enabled) => onToggleExperimentalFlag('replayTimeline', enabled))}
            {renderToggle('Daily Challenges', uiPreferences.experimental.dailyChallenges, (enabled) => onToggleExperimentalFlag('dailyChallenges', enabled))}
            {renderToggle('Achievements', uiPreferences.experimental.achievements, (enabled) => onToggleExperimentalFlag('achievements', enabled))}
            {renderToggle('Enhanced Event Log', uiPreferences.experimental.enhancedEventLog, (enabled) => onToggleExperimentalFlag('enhancedEventLog', enabled))}
            {renderToggle('Contextual Action Previews', uiPreferences.experimental.contextualActionPreviews, (enabled) => onToggleExperimentalFlag('contextualActionPreviews', enabled))}
            {renderToggle('Multiplayer Live Push Updates', uiPreferences.experimental.multiplayerPushEnabled, (enabled) => onToggleExperimentalFlag('multiplayerPushEnabled', enabled))}
            {renderToggle('Multiplayer Reactions', uiPreferences.experimental.multiplayerReactionsEnabled, (enabled) => onToggleExperimentalFlag('multiplayerReactionsEnabled', enabled))}
          </div>
        ) : null}
      </section>

      <section className="settings-section" aria-label="Development tools">
        <h3>Development Tools</h3>
        <div className="settings-grid">
          {renderToggle('Dev Mode', uiPreferences.devModeEnabled, onToggleDevMode)}
        </div>
        <div className="actions">
          <button type="button" onClick={onReseedDevData} disabled={!uiPreferences.devModeEnabled}>
            Reseed Stats & History
          </button>
        </div>
        {statusMessage ? <p className="settings-status">{statusMessage}</p> : null}
      </section>
    </section>
  );
}
