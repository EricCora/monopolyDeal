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
  type HomePrimaryMode = (typeof HOME_PRIMARY_MATCH_MODES)[number];
  const modeActions = {
    hot_seat: onNewGame,
    practice: onStartPracticeGame,
    live_online: onOpenMultiplayer,
  } as const;
  const primaryModes = HOME_PRIMARY_MATCH_MODES
    .filter((mode) => showMultiplayer || mode !== 'live_online')
    .map((mode) => ({
      ...getMatchModeDefinition(mode),
      id: mode,
      onClick: modeActions[mode],
      buttonClassName: mode === 'hot_seat'
        ? 'home-primary-action'
        : mode === 'practice'
          ? 'home-secondary-accent'
          : 'home-online-action',
      cardClassName: mode === 'hot_seat' ? 'home-mode-card is-primary' : 'home-mode-card',
      ariaLabel: `${getMatchModeDefinition(mode).badge.toLowerCase()} mode`,
    }));
  const heroPrimaryMode = primaryModes[0];
  const heroSecondaryMode = primaryModes.find((mode) => mode.id === 'live_online') ?? primaryModes[1] ?? primaryModes[0];
  const heroSceneModes = primaryModes.slice(0, 3);
  const heroSceneGlyphs: Record<HomePrimaryMode, string> = {
    hot_seat: 'HS',
    practice: 'PR',
    live_online: 'LO',
  };
  const heroQuickFacts = [
    { value: '2-4', label: 'Seats around one device' },
    { value: '3', label: 'Card plays each turn' },
    { value: 'Resume', label: 'Jump back into active tables' },
  ] as const;
  const modeNotes: Record<HomePrimaryMode, string> = {
    hot_seat: 'Best for one shared screen around the table.',
    practice: 'Fast solo reps for openings and action timing.',
    live_online: 'Private room flow for remote game night.',
  };
  const heroActionLabels: Record<HomePrimaryMode, string> = {
    hot_seat: 'Start Hot Seat',
    practice: 'Practice Instantly',
    live_online: 'Open Live Room',
  };

  return (
    <section className="panel home-screen card-enter">
      <div className="home-hero">
        <div className="home-hero-copy">
          <p className="home-kicker">Premium Tabletop Match Night</p>
          <h1>Monopoly Deal Local</h1>
          <p className="home-subtitle">A sharper card-night table for hot-seat games, live rooms, and quick solo warmups.</p>
          <div className="home-hero-badges" aria-label="Featured play modes">
            {primaryModes.map((mode) => (
              <span key={mode.id} className="home-hero-badge">{mode.badge}</span>
            ))}
          </div>
          <div className="home-hero-actions actions">
            <button className={heroPrimaryMode.buttonClassName} onClick={heroPrimaryMode.onClick}>{heroActionLabels[heroPrimaryMode.id]}</button>
            {heroSecondaryMode.id !== heroPrimaryMode.id ? (
              <button className={heroSecondaryMode.buttonClassName} onClick={heroSecondaryMode.onClick}>{heroActionLabels[heroSecondaryMode.id]}</button>
            ) : null}
          </div>
          <div className="home-hero-stats" aria-label="Quick match facts">
            {heroQuickFacts.map((fact) => (
              <article key={fact.label} className="home-hero-stat">
                <p className="home-hero-stat-value">{fact.value}</p>
                <p className="home-hero-stat-label">{fact.label}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="home-hero-visual">
          <div className="home-hero-scene" aria-hidden="true">
            <div className="home-scene-table">
              <div className="home-scene-hand is-left">
                {heroSceneModes.map((mode) => (
                  <span key={`left-${mode.id}`} className={`home-scene-card scene-tone-${mode.id}`}>
                    <span className="home-scene-card-glyph">{heroSceneGlyphs[mode.id]}</span>
                    <span className="home-scene-card-tag">{mode.badge}</span>
                  </span>
                ))}
              </div>
              <div className="home-scene-center">
                <div className="home-scene-status">
                  <p className="home-scene-status-label">Table Ready</p>
                  <p className="home-scene-status-value">{heroPrimaryMode.badge}</p>
                </div>
                <span className="home-scene-deck" />
                <span className="home-scene-discard" />
              </div>
              <div className="home-scene-hand is-right">
                {heroSceneModes.slice().reverse().map((mode) => (
                  <span key={`right-${mode.id}`} className={`home-scene-card scene-tone-${mode.id}`}>
                    <span className="home-scene-card-glyph">{heroSceneGlyphs[mode.id]}</span>
                    <span className="home-scene-card-tag">{mode.badge}</span>
                  </span>
                ))}
              </div>
            </div>
            <p className="home-scene-caption">Pass. Draw. Play. Reveal.</p>
          </div>

          <aside className="home-hero-aside" aria-label="Match night overview">
            <p className="home-detail-label">Choose your format</p>
            <div className="home-hero-mode-list">
              {primaryModes.map((mode) => (
                <article key={`hero-${mode.id}`} className="home-hero-mode-item">
                  <p className="home-mode-label">{mode.badge}</p>
                  <h3>{mode.homeTitle}</h3>
                  <p>{modeNotes[mode.id]}</p>
                </article>
              ))}
            </div>
          </aside>
        </div>
      </div>

      <div className="home-mode-grid" aria-label="Primary play modes">
        {primaryModes.map((mode) => (
          <section key={mode.id} className={mode.cardClassName} aria-label={mode.ariaLabel}>
            <p className="home-mode-label">{mode.badge}</p>
            <h3>{mode.homeTitle}</h3>
            <p>{mode.homeDescription}</p>
            <p className="home-mode-note">{modeNotes[mode.id]}</p>
            <div className="actions">
              <button className={mode.buttonClassName} onClick={mode.onClick}>{mode.homeCta}</button>
            </div>
          </section>
        ))}
      </div>

      <div className="home-support-grid">
        <section className="home-utility-shell" aria-label="More ways to play">
          <div className="home-utility-copy">
            <p className="home-detail-label">Table tools</p>
            <h3>Keep the night moving</h3>
            <p>Resume a saved table, review stats, or tune the room before the next deal.</p>
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
            <p className="home-detail-label">Daily Challenge</p>
            <h3>{dailyChallenge.targetTurns} turns or fewer</h3>
            <p>
              {dailyChallenge.completed ? 'Completed today.' : 'Not completed yet.'}
            </p>
            <p>
              Attempts: {dailyChallenge.attempts}
              {dailyChallenge.bestTurnCount != null ? ` | Best: ${dailyChallenge.bestTurnCount} turns` : ''}
            </p>
          </section>
        ) : null}

        {showAchievements ? (
          <section className="settings-section home-summary-card" aria-label="Achievements summary">
            <p className="home-detail-label">Achievements</p>
            <h3>{achievementSummary.unlocked} / {achievementSummary.total}</h3>
            <p>Unlocked across all local and live-table sessions.</p>
          </section>
        ) : null}
      </div>

      <section className="home-roadmap-note" aria-label="Upcoming modes">
        <p className="home-detail-label">Next Up</p>
        <h3>Async rooms, guided onboarding, and spectator seats</h3>
        <p>Planned on top of this live-table foundation without losing the fast local game-night feel.</p>
      </section>

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
