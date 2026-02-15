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
  onToggleConfirmRiskyActions,
  onToggleRulesDrawerHints,
  onToggleExperimentalFlag,
  onToggleDevMode,
  onReseedDevData,
  onClearStatsData,
  onBack,
}: SettingsScreenProps) {
  const statusMessage = devStatusMessage(devSeedStatus);

  return (
    <section className="panel settings-screen card-enter">
      <h2>Settings</h2>
      <p className="settings-subtitle">Control local display options, pause behavior, and development data tools.</p>

      <section className="settings-section" aria-label="Display settings">
        <h3>Display</h3>

        <label className="settings-field settings-toggle">
          <span>Reduced Celebration Effects</span>
          <input
            type="checkbox"
            checked={uiPreferences.reducedEffects}
            onChange={(event) => onToggleReducedEffects(event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>High Contrast Mode</span>
          <input
            type="checkbox"
            checked={uiPreferences.highContrast}
            onChange={(event) => onToggleHighContrast(event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Sound Effects</span>
          <input
            type="checkbox"
            checked={uiPreferences.soundEnabled}
            onChange={(event) => onToggleSound(event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Haptic Feedback (supported devices)</span>
          <input
            type="checkbox"
            checked={uiPreferences.hapticsEnabled}
            onChange={(event) => onToggleHaptics(event.target.checked)}
          />
        </label>

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

        <label className="settings-field settings-toggle">
          <span>Confirm Risky Actions</span>
          <input
            type="checkbox"
            checked={uiPreferences.confirmRiskyActions}
            onChange={(event) => onToggleConfirmRiskyActions(event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Show Rules Hints</span>
          <input
            type="checkbox"
            checked={uiPreferences.showRulesDrawerHints}
            onChange={(event) => onToggleRulesDrawerHints(event.target.checked)}
          />
        </label>
      </section>

      <section className="settings-section" aria-label="Development tools">
        <h3>Development Tools</h3>
        <label className="settings-field settings-toggle">
          <span>Dev Mode</span>
          <input
            type="checkbox"
            checked={uiPreferences.devModeEnabled}
            onChange={(event) => onToggleDevMode(event.target.checked)}
          />
        </label>
        <div className="actions">
          <button type="button" onClick={onReseedDevData} disabled={!uiPreferences.devModeEnabled}>
            Reseed Stats & History
          </button>
        </div>
        {statusMessage ? <p className="settings-status">{statusMessage}</p> : null}
      </section>

      <section className="settings-section" aria-label="Experimental features">
        <h3>Experimental Features</h3>
        <p className="settings-subtitle">
          Advanced features under active development. Leave off for the most stable experience.
        </p>

        <label className="settings-field settings-toggle">
          <span>AI Opponents</span>
          <input
            type="checkbox"
            checked={uiPreferences.experimental.aiOpponents}
            onChange={(event) => onToggleExperimentalFlag('aiOpponents', event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>AI Coach Hints</span>
          <input
            type="checkbox"
            checked={uiPreferences.experimental.aiCoach}
            onChange={(event) => onToggleExperimentalFlag('aiCoach', event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Replay Timeline</span>
          <input
            type="checkbox"
            checked={uiPreferences.experimental.replayTimeline}
            onChange={(event) => onToggleExperimentalFlag('replayTimeline', event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Daily Challenges</span>
          <input
            type="checkbox"
            checked={uiPreferences.experimental.dailyChallenges}
            onChange={(event) => onToggleExperimentalFlag('dailyChallenges', event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Achievements</span>
          <input
            type="checkbox"
            checked={uiPreferences.experimental.achievements}
            onChange={(event) => onToggleExperimentalFlag('achievements', event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Custom Rules</span>
          <input
            type="checkbox"
            checked={uiPreferences.experimental.customRules}
            onChange={(event) => onToggleExperimentalFlag('customRules', event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Enhanced Event Log</span>
          <input
            type="checkbox"
            checked={uiPreferences.experimental.enhancedEventLog}
            onChange={(event) => onToggleExperimentalFlag('enhancedEventLog', event.target.checked)}
          />
        </label>

        <label className="settings-field settings-toggle">
          <span>Contextual Action Previews</span>
          <input
            type="checkbox"
            checked={uiPreferences.experimental.contextualActionPreviews}
            onChange={(event) => onToggleExperimentalFlag('contextualActionPreviews', event.target.checked)}
          />
        </label>
      </section>

      <section className="settings-section" aria-label="Data controls">
        <h3>Data Controls</h3>
        <div className="actions">
          <button type="button" onClick={onClearStatsData}>
            Clear Stats & History
          </button>
        </div>
      </section>

      <div className="actions">
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </section>
  );
}
