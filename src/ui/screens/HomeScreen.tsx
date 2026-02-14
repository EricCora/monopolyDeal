interface HomeScreenProps {
  error: string | null;
  onNewGame: () => void;
  onResumeGame: () => void;
  onOpenSavedGames: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
}

export function HomeScreen({ error, onNewGame, onResumeGame, onOpenSavedGames, onOpenStats, onOpenSettings }: HomeScreenProps) {
  return (
    <section className="panel home-screen card-enter">
      <div className="home-hero">
        <p className="home-kicker">Competitive Local Card Table</p>
        <h1>Monopoly Deal Local</h1>
        <p className="home-subtitle">Pass-and-play on one laptop for 2-4 players.</p>
      </div>

      <div className="home-actions actions" aria-label="Home actions">
        <button onClick={onNewGame}>New Game</button>
        <button onClick={onResumeGame}>Resume Saved Game</button>
        <button onClick={onOpenSavedGames}>Saved Games</button>
        <button onClick={onOpenStats}>Stats & History</button>
        <button onClick={onOpenSettings}>Settings</button>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
