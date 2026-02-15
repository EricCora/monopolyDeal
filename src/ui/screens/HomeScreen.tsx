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
  onStartDailyChallenge,
  onResumeGame,
  onOpenSavedGames,
  onOpenStats,
  onOpenSettings,
  onOpenMultiplayer,
}: HomeScreenProps) {
  return (
    <section className="panel home-screen card-enter">
      <div className="home-hero">
        <p className="home-kicker">Competitive Local Card Table</p>
        <h1>Monopoly Deal Local</h1>
        <p className="home-subtitle">Pass-and-play locally, or jump into private multiplayer with a room code.</p>
      </div>

      <div className="home-actions actions" aria-label="Home actions">
        <button onClick={onNewGame}>New Game</button>
        {showDailyChallenge ? <button onClick={onStartDailyChallenge}>Start Daily Challenge</button> : null}
        <button onClick={onResumeGame}>Resume Saved Game</button>
        {showMultiplayer ? <button onClick={onOpenMultiplayer}>Play Multiplayer</button> : null}
        <button onClick={onOpenSavedGames}>Saved Games</button>
        <button onClick={onOpenStats}>Stats & History</button>
        <button onClick={onOpenSettings}>Settings</button>
      </div>

      {showDailyChallenge ? (
        <section className="settings-section" aria-label="Daily challenge summary">
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
        <section className="settings-section" aria-label="Achievements summary">
          <h3>Achievements</h3>
          <p>
            Unlocked {achievementSummary.unlocked} / {achievementSummary.total}
          </p>
        </section>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
