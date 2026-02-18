import { useState } from 'react';
import type { UiPreferencesV1 } from '../../persistence/storage';

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
  onToggleConfirmRiskyActions: (enabled: boolean) => void;
  onToggleRulesDrawerHints: (enabled: boolean) => void;
  onToggleExperimentalFlag: (flag: keyof UiPreferencesV1['experimental'], enabled: boolean) => void;
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
  onToggleConfirmRiskyActions,
  onToggleRulesDrawerHints,
  onToggleExperimentalFlag,
  onToggleDevMode,
  onReseedDevData,
  onClearStatsData,
  onBack,
}: SettingsScreenProps) {
  const statusMessage = devStatusMessage(devSeedStatus);
  const [experimentalOpen, setExperimentalOpen] = useState(false);

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
      <h2>Settings</h2>
      <p className="settings-subtitle">Tune visuals, controls, and experimentation without leaving your current table flow.</p>

      <div className="actions settings-top-actions">
        <button type="button" onClick={onBack}>Back</button>
      </div>

      <section className="settings-section" aria-label="Display settings">
        <h3>Display</h3>
        <div className="settings-grid">
          {renderToggle('Reduced Celebration Effects', uiPreferences.reducedEffects, onToggleReducedEffects)}
          {renderToggle('High Contrast Mode', uiPreferences.highContrast, onToggleHighContrast)}
          {renderToggle('Sound Effects', uiPreferences.soundEnabled, onToggleSound)}
          {renderToggle('Haptic Feedback (supported devices)', uiPreferences.hapticsEnabled, onToggleHaptics)}
        </div>

        <div className="settings-select-grid">
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
          <label className="settings-field">
            <span>Table Style</span>
            <select value={uiPreferences.tableStyle} onChange={(event) => onChangeTableStyle(event.target.value as UiPreferencesV1['tableStyle'])}>
              <option value="classic_green">Classic Green</option>
              <option value="neon_arcade">Neon Arcade</option>
            </select>
          </label>
        </div>
      </section>

      <section className="settings-section" aria-label="Gameplay preferences">
        <h3>Gameplay Preferences</h3>
        <div className="settings-grid">
          {renderToggle('Confirm Risky Actions', uiPreferences.confirmRiskyActions, onToggleConfirmRiskyActions)}
          {renderToggle('Show Rules Hints', uiPreferences.showRulesDrawerHints, onToggleRulesDrawerHints)}
        </div>
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
        <p className="settings-subtitle">
          Advanced features under active development. Leave off for the most stable experience.
        </p>
        {experimentalOpen ? (
          <div className="settings-grid settings-grid-experimental">
            {renderToggle('AI Opponents', uiPreferences.experimental.aiOpponents, (enabled) => onToggleExperimentalFlag('aiOpponents', enabled))}
            {renderToggle('AI Coach Hints', uiPreferences.experimental.aiCoach, (enabled) => onToggleExperimentalFlag('aiCoach', enabled))}
            {renderToggle('Replay Timeline', uiPreferences.experimental.replayTimeline, (enabled) => onToggleExperimentalFlag('replayTimeline', enabled))}
            {renderToggle('Daily Challenges', uiPreferences.experimental.dailyChallenges, (enabled) => onToggleExperimentalFlag('dailyChallenges', enabled))}
            {renderToggle('Achievements', uiPreferences.experimental.achievements, (enabled) => onToggleExperimentalFlag('achievements', enabled))}
            {renderToggle('Custom Rules', uiPreferences.experimental.customRules, (enabled) => onToggleExperimentalFlag('customRules', enabled))}
            {renderToggle('Enhanced Event Log', uiPreferences.experimental.enhancedEventLog, (enabled) => onToggleExperimentalFlag('enhancedEventLog', enabled))}
            {renderToggle('Contextual Action Previews', uiPreferences.experimental.contextualActionPreviews, (enabled) => onToggleExperimentalFlag('contextualActionPreviews', enabled))}
            {renderToggle('Multiplayer Live Push Updates', uiPreferences.experimental.multiplayerPushEnabled, (enabled) => onToggleExperimentalFlag('multiplayerPushEnabled', enabled))}
            {renderToggle('Multiplayer Reactions', uiPreferences.experimental.multiplayerReactionsEnabled, (enabled) => onToggleExperimentalFlag('multiplayerReactionsEnabled', enabled))}
          </div>
        ) : null}
      </section>

      <section className="settings-section settings-danger-zone" aria-label="Data controls">
        <h3>Data Controls</h3>
        <p className="settings-subtitle">Use carefully. This removes local match history and stats telemetry.</p>
        <div className="actions">
          <button type="button" className="settings-danger-action" onClick={onClearStatsData}>
            Clear Stats & History
          </button>
        </div>
      </section>

    </section>
  );
}
