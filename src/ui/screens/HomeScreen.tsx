import { useState } from 'react';
import type { GameVariant } from '../../cards/catalog';
import type { BotDifficulty } from '../../engine/types';
import { CardView } from '../components/CardView';
import { Icon } from '../components/icons';
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
  /** The game autosave would resume, when there is one. */
  activeGame?: { players: string[]; turn: number } | null;
  reducedEffects?: boolean;
  onNewGame: () => void;
  onStartPracticeGame: (variant?: GameVariant, difficulty?: BotDifficulty) => void;
  onStartDailyChallenge: () => void;
  onResumeGame: () => void;
  onOpenSavedGames: () => void;
  onOpenStats: () => void;
  onOpenSettings: () => void;
  onOpenMultiplayer: () => void;
  onOpenRules?: () => void;
}

const HERO_CARDS = [
  { id: 'rent_color#1', angle: -24, x: -82, y: 22, lift: 3 },
  { id: 'wild_all#1', angle: -11, x: -41, y: 6, lift: -3 },
  { id: 'deal_breaker#1', angle: 13, x: 41, y: 6, lift: 4 },
  { id: 'money_10#1', angle: 25, x: 82, y: 24, lift: -4 },
  { id: 'red_1#1', angle: 0, x: 0, y: 0, lift: 6 },
];

const PRACTICE_OPTIONS: Array<{ label: string; variant: GameVariant; difficulty: BotDifficulty }> = [
  { label: 'Classic, Easy', variant: 'classic', difficulty: 'easy' },
  { label: 'Classic, Hard', variant: 'classic', difficulty: 'hard' },
  { label: 'No Mercy, Easy', variant: 'no_mercy', difficulty: 'easy' },
  { label: 'No Mercy, Hard', variant: 'no_mercy', difficulty: 'hard' },
];

export function HomeScreen({
  error,
  showDailyChallenge,
  dailyChallenge,
  showAchievements,
  achievementSummary,
  showMultiplayer,
  activeGame,
  reducedEffects = false,
  onNewGame,
  onStartPracticeGame,
  onStartDailyChallenge,
  onResumeGame,
  onOpenSavedGames,
  onOpenStats,
  onOpenSettings,
  onOpenMultiplayer,
  onOpenRules,
}: HomeScreenProps) {
  const [practiceOpen, setPracticeOpen] = useState(false);
  const modes = HOME_PRIMARY_MATCH_MODES.filter((mode) => showMultiplayer || mode !== 'live_online').map((mode) => getMatchModeDefinition(mode));
  const dailyDetail = dailyChallenge.completed
    ? `Beaten today in ${dailyChallenge.bestTurnCount ?? 0} turns.`
    : dailyChallenge.bestTurnCount != null
      ? `Win within ${dailyChallenge.targetTurns} turns. Best so far: ${dailyChallenge.bestTurnCount}.`
      : `Today's deal: win within ${dailyChallenge.targetTurns} turns.`;

  return (
    <section className={`home-screen card-enter ${reducedEffects ? 'is-still' : ''}`}>
      <div className="home-hero">
        <div className="home-hero-cards" aria-hidden="true">
          {HERO_CARDS.map((card) => (
            <span
              key={card.id}
              className="home-hero-card"
              style={{
                ['--angle' as string]: `${card.angle}deg`,
                ['--x' as string]: `${card.x}px`,
                ['--y' as string]: `${card.y}px`,
                ['--lift' as string]: `${card.lift}px`,
                ['--lift-angle' as string]: `${card.lift * 0.25}deg`,
              }}
            >
              <CardView cardId={card.id} width={116} decorative />
            </span>
          ))}
        </div>
        <h1 aria-label="Monopoly Deal Local">Monopoly Deal</h1>
        <p className="home-subtitle">Collect three sets. Trust no one.</p>
      </div>

      <div className="sr-only">
        <p>Premium Tabletop Match Night</p>
        <p>Choose your format</p>
        <div aria-label="Quick match facts">
          <p>2-5 seats around one device</p>
          <p>3 card plays each turn</p>
          <p>Resume: jump back into active tables</p>
        </div>
        <ul aria-label="Featured play modes">
          {modes.map((mode) => <li key={mode.badge}>{mode.badge}: {mode.homeDescription}</li>)}
        </ul>
      </div>

      {activeGame ? (
        <button type="button" className="home-continue glass-card" onClick={onResumeGame} aria-label="Resume Saved Game: Continue Game">
          <span className="home-continue-icon"><Icon name="play" /></span>
          <span className="home-card-copy">
            <strong>Continue Game</strong>
            <small>{activeGame.players.join(', ')} · Turn {activeGame.turn}</small>
          </span>
          <Icon name="chevron" className="home-chevron" />
        </button>
      ) : (
        <button type="button" className="sr-only" onClick={onResumeGame}>Resume Saved Game</button>
      )}

      <div className="home-play">
        <button type="button" className="primary-button" onClick={onNewGame} aria-label="New Game (Hot Seat): Start Hot Seat">
          <Icon name="people" /> New Game
        </button>
        <div className="home-play-row">
          <div className="home-practice">
            <button type="button" className="secondary-button" onClick={() => onStartPracticeGame()} aria-label="Practice vs Bots">
              <Icon name="bot" /> Practice
            </button>
            <button type="button" className="secondary-button home-practice-more" aria-label="More practice options" aria-expanded={practiceOpen} onClick={() => setPracticeOpen(true)}>
              <Icon name="chevron" />
            </button>
          </div>
          {showMultiplayer ? (
            <button type="button" className="secondary-button" onClick={onOpenMultiplayer} aria-label="Play Multiplayer: Open Live Room">
              <Icon name="globe" /> Online
            </button>
          ) : null}
        </div>
      </div>

      {showDailyChallenge ? (
        <section className="home-daily" aria-label="Daily challenge summary">
          <button type="button" className="glass-card home-daily-button" onClick={onStartDailyChallenge} aria-label={`Start Daily Challenge. ${dailyDetail}`}>
            <span className="home-daily-icon"><Icon name={dailyChallenge.completed ? 'seal' : 'calendar'} /></span>
            <span className="home-card-copy">
              <strong>Daily Challenge</strong>
              <small>{dailyDetail}</small>
            </span>
          </button>
        </section>
      ) : null}

      <div className="home-menu">
        <button type="button" className="secondary-button" onClick={onOpenSavedGames} aria-label="Saved Games"><Icon name="stack" /> Saved Games</button>
        <button type="button" className="secondary-button" onClick={onOpenStats} aria-label="Stats & History"><Icon name="chart" /> Stats</button>
        <button type="button" className="secondary-button" onClick={onOpenRules} aria-label="Rules"><Icon name="book" /> Rules</button>
        <button type="button" className="secondary-button" onClick={onOpenSettings} aria-label="Settings"><Icon name="gear" /> Settings</button>
      </div>

      {showAchievements ? (
        <p className="home-achievements" aria-label="Achievements summary">
          <Icon name="seal" /> {achievementSummary.unlocked} of {achievementSummary.total} achievements
        </p>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      {practiceOpen ? (
        <div className="sheet-overlay is-centered" role="presentation" onClick={() => setPracticeOpen(false)}>
          <div className="action-sheet" role="dialog" aria-modal="true" aria-label="Practice against a bot" onClick={(event) => event.stopPropagation()}>
            <p className="action-sheet-title">Practice Against a Bot</p>
            {PRACTICE_OPTIONS.map((option) => (
              <button key={option.label} type="button" onClick={() => onStartPracticeGame(option.variant, option.difficulty)}>
                {option.label}
              </button>
            ))}
            <button type="button" className="is-cancel" onClick={() => setPracticeOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
