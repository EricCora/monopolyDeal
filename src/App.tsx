import { useEffect, useMemo, useRef, useState } from 'react';
import { type PropertyColor } from './cards/catalog';
import {
  applyAction,
  createGame,
  getLegalActions,
  getNextPrompt,
  getSetCompletionCount,
  isGameOver,
  type Action,
  type GameState,
  type PlayerConfig,
} from './engine';
import {
  clearActiveGame,
  loadActiveGame,
  loadLifetimeStats,
  loadMatchHistory,
  saveActiveGame,
  saveLifetimeStats,
  saveMatchHistory,
} from './persistence/storage';
import { applyMatchToLifetime, buildMatchRecord, type LifetimeStatsV1, type MatchRecordV1 } from './stats';
import './App.css';

type Screen = 'home' | 'setup' | 'game' | 'stats';

interface SetupState {
  playerCount: number;
  playerNames: string[];
}

function initialSetup(): SetupState {
  return {
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
  };
}

function colorLabel(color: PropertyColor): string {
  return color.replace('_', ' ');
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [game, setGame] = useState<GameState | null>(null);
  const [setup, setSetup] = useState<SetupState>(initialSetup);
  const [error, setError] = useState<string | null>(null);
  const [revealedPlayerId, setRevealedPlayerId] = useState<string | null>(null);
  const [history, setHistory] = useState<MatchRecordV1[]>(() => loadMatchHistory());
  const [lifetime, setLifetime] = useState<LifetimeStatsV1>(() => loadLifetimeStats());
  const finalizedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (!game) return;
    const handle = window.setTimeout(() => {
      saveActiveGame(game);
    }, 220);
    return () => window.clearTimeout(handle);
  }, [game]);

  const prompt = useMemo(() => (game ? getNextPrompt(game) : null), [game]);

  const shouldShowShield = Boolean(game && prompt && !isGameOver(game).done && revealedPlayerId !== prompt.playerId);

  const legalActions = useMemo(() => {
    if (!game || !prompt) return [];
    return getLegalActions(game, prompt.playerId);
  }, [game, prompt]);

  const startNewGame = () => {
    const players: PlayerConfig[] = setup.playerNames.slice(0, setup.playerCount).map((name, index) => ({
      id: `p${index + 1}`,
      name: name.trim() || `Player ${index + 1}`,
    }));

    const nextGame = createGame({ players, deckVersion: 'v1' });
    setGame(nextGame);
    setRevealedPlayerId(null);
    setScreen('game');
    setError(null);
  };

  const resumeGame = () => {
    const saved = loadActiveGame();
    if (!saved) {
      setError('No active saved game found.');
      return;
    }
    setGame(saved.gameState);
    setRevealedPlayerId(null);
    setScreen('game');
    setError(null);
  };

  const finalizeIfGameOver = (nextState: GameState) => {
    const status = isGameOver(nextState);
    if (!status.done || !status.winnerId) return;
    const matchId = `${nextState.createdAt}-${nextState.updatedAt}`;
    if (finalizedMatchRef.current === `final:${matchId}`) return;
    finalizedMatchRef.current = `final:${matchId}`;
    const matchRecord = buildMatchRecord(nextState);
    const nextHistory = [matchRecord, ...loadMatchHistory()].slice(0, 50);
    saveMatchHistory(nextHistory);
    setHistory(nextHistory);
    const nextLifetime = applyMatchToLifetime(loadLifetimeStats(), matchRecord);
    saveLifetimeStats(nextLifetime);
    setLifetime(nextLifetime);
    clearActiveGame();
  };

  const runAction = (action: Action) => {
    if (!game) return;
    const result = applyAction(game, action);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setError(null);
    setRevealedPlayerId(null);
    setGame(result.state);
    finalizeIfGameOver(result.state);
  };

  const renderHome = () => (
    <section className="panel card-enter">
      <h1>Monopoly Deal Local</h1>
      <p>Pass-and-play on one laptop for 2-4 players.</p>
      <div className="actions">
        <button onClick={() => setScreen('setup')}>New Game</button>
        <button onClick={resumeGame}>Resume Saved Game</button>
        <button onClick={() => setScreen('stats')}>Stats & History</button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );

  const renderSetup = () => (
    <section className="panel card-enter">
      <h2>New Local Game</h2>
      <label>
        Total Players
        <select
          value={setup.playerCount}
          onChange={(event) =>
            setSetup((prev) => ({
              ...prev,
              playerCount: Number(event.target.value),
            }))
          }
        >
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>
      {setup.playerNames.slice(0, setup.playerCount).map((name, index) => (
        <label key={`player-name-${index + 1}`}>
          Player {index + 1} Name
          <input
            value={name}
            onChange={(event) => {
              const value = event.target.value;
              setSetup((prev) => {
                const nextNames = [...prev.playerNames];
                nextNames[index] = value;
                return { ...prev, playerNames: nextNames };
              });
            }}
          />
        </label>
      ))}
      <div className="actions">
        <button onClick={startNewGame}>Start Match</button>
        <button onClick={() => setScreen('home')}>Back</button>
      </div>
    </section>
  );

  const renderPlayerBoard = (state: GameState) =>
    state.players.map((player) => {
      const canSeeHand = revealedPlayerId === player.id;
      return (
        <article className={`player ${state.players[state.currentPlayerIndex].id === player.id ? 'active' : ''}`} key={player.id}>
          <header>
            <h3>{player.name}</h3>
            <p>{getSetCompletionCount(player)} complete sets</p>
          </header>
          <section>
            <strong>Hand</strong>
            <p>{canSeeHand ? player.hand.join(', ') || 'Empty' : `${player.hand.length} cards`}</p>
          </section>
          <section>
            <strong>Bank</strong>
            <p>{player.bank.join(', ') || 'Empty'}</p>
          </section>
          <section>
            <strong>Properties</strong>
            <ul>
              {(Object.keys(player.properties) as PropertyColor[])
                .filter((color) => player.properties[color].length > 0)
                .map((color) => (
                  <li key={`${player.id}-${color}`}>
                    <span>{colorLabel(color)}:</span> {player.properties[color].map((card) => card.cardId).join(', ')}
                  </li>
                ))}
            </ul>
          </section>
        </article>
      );
    });

  const renderGame = () => {
    if (!game || !prompt) return null;
    const over = isGameOver(game);
    const winner = game.players.find((player) => player.id === over.winnerId);

    return (
      <section className="panel game-panel">
        <div className="game-top">
          <div>
            <h2>Game Table</h2>
            <p>{prompt.text}</p>
            <p>
              Turn {game.turnCount} | Draw pile: {game.drawPile.length} | Discard: {game.discardPile.length}
            </p>
            {game.turn.phase === 'action' && <p>Plays used: {game.turn.playsUsed}/3</p>}
            {over.done && <p className="winner">Winner: {winner?.name ?? 'Unknown'}</p>}
          </div>
          <div className="actions">
            <button onClick={() => setScreen('home')}>Home</button>
            <button
              onClick={() => {
                clearActiveGame();
                setGame(null);
                setScreen('home');
              }}
            >
              End Match
            </button>
          </div>
        </div>

        <div className="players-grid">{renderPlayerBoard(game)}</div>

        <section className="action-panel">
          <h3>Legal Actions ({legalActions.length})</h3>
          <div className="actions action-list">
            {legalActions.map((item, index) => (
              <button key={`${item.label}-${index}`} onClick={() => runAction(item.action)} disabled={over.done}>
                {item.label}
              </button>
            ))}
            {legalActions.length === 0 && <p>No available actions for current prompt.</p>}
          </div>
        </section>

        <section>
          <h3>Recent Events</h3>
          <ul className="log-list">
            {game.history
              .slice(-12)
              .reverse()
              .map((event, index) => (
                <li key={`${event.timestamp}-${index}`}>
                  <strong>{event.type}</strong> {event.message}
                </li>
              ))}
          </ul>
        </section>

        {shouldShowShield && !over.done && (
          <div className="shield" role="dialog" aria-modal="true">
            <div className="shield-card card-enter">
              <h3>Pass Device</h3>
              <p>
                Next action: <strong>{game.players.find((player) => player.id === prompt.playerId)?.name ?? prompt.playerId}</strong>
              </p>
              <button
                onClick={() => {
                  setRevealedPlayerId(prompt.playerId);
                }}
              >
                Reveal Turn
              </button>
            </div>
          </div>
        )}
      </section>
    );
  };

  const renderStats = () => {
    const lifetimeEntries = Object.values(lifetime.players).sort((a, b) => b.wins - a.wins);
    return (
      <section className="panel card-enter">
        <h2>Stats & History</h2>
        <div className="stats-grid">
          <article>
            <h3>Lifetime</h3>
            <ul>
              {lifetimeEntries.map((entry) => (
                <li key={entry.name}>
                  <strong>{entry.name}</strong>: {entry.wins} wins / {entry.gamesPlayed} games
                </li>
              ))}
              {lifetimeEntries.length === 0 && <li>No lifetime stats yet.</li>}
            </ul>
          </article>
          <article>
            <h3>Recent Matches</h3>
            <ul>
              {history.slice(0, 10).map((match) => (
                <li key={match.id}>
                  {new Date(match.endedAt).toLocaleString()} - Winner: {match.winnerName ?? 'N/A'} ({match.turnCount} turns)
                </li>
              ))}
              {history.length === 0 && <li>No completed matches yet.</li>}
            </ul>
          </article>
        </div>
        <div className="actions">
          <button onClick={() => setScreen('home')}>Back</button>
        </div>
      </section>
    );
  };

  return (
    <main>
      {screen === 'home' && renderHome()}
      {screen === 'setup' && renderSetup()}
      {screen === 'game' && renderGame()}
      {screen === 'stats' && renderStats()}

      <footer>
        <small>Deck cards resolve by instance id.</small>
      </footer>
    </main>
  );
}

export default App;
