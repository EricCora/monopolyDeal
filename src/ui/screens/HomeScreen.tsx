import { getMatchModeDefinition, HOME_PRIMARY_MATCH_MODES } from '../experience';

interface HomeScreenProps {
  error: string | null;
  showDailyChallenge: boolean;
  dailyChallenge: {
    targetTurns: number;
    completed: boolean;
    attempts: number;
    bestTurnCount: number | null;
  };
  showAchievements: boolean;
  achievementSummary: {
    unlocked: number;
    total: number;
  };
  showMultiplayer: boolean;
  onNewGame: () => void;
  onStartPracticeGame: () => void;
  onStartDailyChallenge: () => void;
  onResumeGame: () => void;
  onOpenSavedGames: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onOpenMultiplayer: () => void;
}

export function HomeScreen({
  error,
  showDailyChallenge,
  dailyChallenge,
  showAchievements,
  achievementSummary,
  showMultiplayer,
  onNewGame,
  onStartPracticeGame,
  onStartDailyChallenge,
  onResumeGame,
  onOpenSavedGames,
  onOpenStats,
  onOpenSettings,
  onOpenMultiplayer,
}: HomeScreenProps) {
  const modeActions = {
    hot_seat: onNewGame,
    practice: onStartPracticeGame,
    live_online: onOpenMultiplayer,
  } as const;
  const primaryModes = HOME_PRIMARY_MATCH_MODES
    .filter((mode) => showMultiplayer || mode !== 'live_online')
    .map((mode) => ({
      ...getMatchModeDefinition(mode),
      onClick: modeActions[mode],
      buttonClassName: mode === 'hot_seat'
        ? 'home-primary-action'
        : mode === 'practice'
          ? 'home-secondary-accent'
          : 'home-online-action',
      cardClassName: mode === 'hot_seat' ? 'home-mode-card is-primary' : 'home-mode-card',
      ariaLabel: `${getMatchModeDefinition(mode).badge.toLowerCase()} mode`,
    }));

  return (
    <section className="panel home-screen card-enter">
      <div className="home-hero">
        <p className="home-kicker">Premium Tabletop Match Night</p>
        <h1>Monopoly Deal Local</h1>
        <p className="home-subtitle">A cleaner card-night table for hot-seat games, live online rooms, and quick solo warmups.</p>
        <div className="home-hero-badges" aria-label="Featured play modes">
          {primaryModes.map((mode) => (
            <span key={mode.id} className="home-hero-badge">{mode.badge}</span>
          ))}
        </div>
      </div>

      <div className="home-mode-grid" aria-label="Primary play modes">
        {primaryModes.map((mode) => (
          <section key={mode.id} className={mode.cardClassName} aria-label={mode.ariaLabel}>
            <p className="home-mode-label">{mode.badge}</p>
            <h3>{mode.homeTitle}</h3>
            <p>{mode.homeDescription}</p>
            <div className="actions">
              <button className={mode.buttonClassName} onClick={mode.onClick}>{mode.homeCta}</button>
            </div>
          </section>
        ))}
      </div>

      <section className="home-utility-shell" aria-label="More ways to play">
        <div className="home-utility-copy">
          <h3>Table tools</h3>
          <p>Pick up where you left off, review stats, or tune the look and feel before your next round.</p>
        </div>
        <div className="home-actions actions">
          {showDailyChallenge ? <button onClick={onStartDailyChallenge}>Start Daily Challenge</button> : null}
          <button onClick={onResumeGame}>Resume Saved Game</button>
          <button onClick={onOpenSavedGames}>Saved Games</button>
          <button onClick={onOpenStats}>Stats & History</button>
          <button onClick={onOpenSettings}>Settings</button>
        </div>
      </section>

      {showDailyChallenge ? (
        <section className="settings-section home-summary-card" aria-label="Daily challenge summary">
          <h3>Daily Challenge</h3>
          <p>Win in {dailyChallenge.targetTurns} turns or fewer.</p>
          <p>
            {dailyChallenge.completed
              ? 'Completed today.'
              : 'Not completed yet.'}{' '}
            Attempts: {dailyChallenge.attempts}
            {dailyChallenge.bestTurnCount != null ? ` | Best: ${dailyChallenge.bestTurnCount} turns` : ''}
          </p>
        </section>
      ) : null}

      {showAchievements ? (
        <section className="settings-section home-summary-card" aria-label="Achievements summary">
          <h3>Achievements</h3>
          <p>
            Unlocked {achievementSummary.unlocked} / {achievementSummary.total}
          </p>
        </section>
      ) : null}

      <section className="home-roadmap-note" aria-label="Upcoming modes">
        <h3>Next Up</h3>
        <p>Async online rooms, guided first-match onboarding, and spectator seats are planned on top of this live-table foundation.</p>
      </section>

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
