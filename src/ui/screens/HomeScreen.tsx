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
  activeGame?: { players: string[]; turn: number; variant?: GameVariant } | null;
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

const HAND_CARDS = [
  { id: 'rent_color#1', angle: -30, x: -46, y: 18, lift: 3 },
  { id: 'wild_all#1', angle: -16, x: -22, y: 6, lift: -3 },
  { id: 'deal_breaker#1', angle: -2, x: 4, y: 0, lift: 4 },
  { id: 'red_1#1', angle: 13, x: 30, y: 4, lift: -4 },
];

const THUMB_CARDS = [
  { id: 'wild_all#1', angle: -16, x: -12 },
  { id: 'deal_breaker#1', angle: -2, x: 0 },
  { id: 'red_1#1', angle: 14, x: 12 },
];

/** City towers behind the hero, from the same seed as the iOS skyline. */
const SKYLINE = (() => {
  let state = 7n;
  const mask = (1n << 64n) - 1n;
  const next = () => {
    state = (state + 0x9e3779b97f4a7c15n) & mask;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    z ^= z >> 31n;
    return Number(z >> 11n) / 2 ** 53;
  };
  const height = 150;
  const towers: Array<{ x: number; y: number; w: number; h: number; spire: boolean }> = [];
  const windows: Array<{ x: number; y: number }> = [];
  for (let x = -6; x < 600;) {
    const w = 16 + next() * 26;
    const h = height * (0.25 + next() * 0.75);
    const tower = { x, y: height - h, w, h, spire: next() > 0.6 };
    towers.push(tower);
    for (let wy = tower.y + 8; wy < height - 6; wy += 9) {
      for (let wx = x + 4; wx < x + w - 6; wx += 7) {
        if (next() > 0.72) windows.push({ x: wx, y: wy });
      }
    }
    x += w + 2 + next() * 8;
  }
  return { towers, windows };
})();

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
        <svg className="home-skyline" viewBox="0 0 600 150" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
          {SKYLINE.towers.map((tower) => (
            <g key={tower.x}>
              <rect x={tower.x} y={tower.y} width={tower.w} height={tower.h} />
              {tower.spire ? <rect x={tower.x + tower.w / 2 - 1.5} y={tower.y - 14} width={3} height={14} /> : null}
            </g>
          ))}
          {SKYLINE.windows.map((window) => (
            <rect key={`${window.x}-${window.y}`} className="home-skyline-window" x={window.x} y={window.y} width={3} height={4} />
          ))}
        </svg>
        <div className="home-hand" aria-hidden="true">
          {HAND_CARDS.map((card) => (
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
              <CardView cardId={card.id} width={88} decorative />
            </span>
          ))}
          <span className="home-sparks"><i /><i /><i /></span>
        </div>
        <div className="home-brand">
          <div className="home-logo" aria-hidden="true">
            <span className="home-logo-card is-gold" />
            <span className="home-logo-card is-red" />
            <span className="home-logo-card is-brown" />
            <span className="home-logo-banner">MONOPOLY</span>
            <span className="home-logo-plate">DEAL</span>
          </div>
          <h1 className="sr-only" aria-label="Monopoly Deal Local">Monopoly Deal</h1>
          <p className="home-subtitle">Collect three sets. Trust no one.</p>
        </div>
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

      <button type="button" className="home-new-game" onClick={onNewGame} aria-label="New Game (Hot Seat): Start Hot Seat">
        <Icon name="playFill" /> New Game
      </button>

      <div className="home-modes">
        <div className="home-mode-wrap">
          <button type="button" className="home-mode is-practice" onClick={() => onStartPracticeGame()} aria-label="Practice vs Bots">
            <Icon name="people" />
            <strong>Practice</strong>
            <small>Learn &amp; refine</small>
          </button>
          <button type="button" className="home-mode-badge is-quiet" aria-label="More practice options" aria-expanded={practiceOpen} onClick={() => setPracticeOpen(true)}>
            <Icon name="chevron" />
          </button>
        </div>
        {showMultiplayer ? (
          <button type="button" className="home-mode is-online" onClick={onOpenMultiplayer} aria-label="Play Multiplayer: Open Live Room">
            <Icon name="globe" />
            <strong>Online</strong>
            <small><span className="home-live-dot" />Play with friends</small>
          </button>
        ) : null}
        {showDailyChallenge ? (
          <div className="home-mode-wrap" aria-label="Daily challenge summary" role="group">
            <button type="button" className="home-mode is-daily" onClick={onStartDailyChallenge} aria-label={`Start Daily Challenge. ${dailyDetail}`}>
              <Icon name={dailyChallenge.completed ? 'seal' : 'calendar'} />
              <strong>Daily Challenge</strong>
              <small>{dailyChallenge.completed ? `Beaten in ${dailyChallenge.bestTurnCount ?? 0} turns` : `Win within ${dailyChallenge.targetTurns} turns`}</small>
            </button>
            <span className="home-mode-badge" aria-hidden="true"><Icon name={dailyChallenge.completed ? 'check' : 'sparkles'} /></span>
          </div>
        ) : null}
      </div>

      {activeGame ? (
        <section className="home-continue-panel" aria-label="Continue Playing">
          <header>
            <span className="home-continue-title"><Icon name="clock" /> Continue Playing</span>
            <button type="button" className="home-see-all" onClick={onOpenSavedGames} aria-label="See All Saved Games">
              See All <Icon name="chevron" />
            </button>
          </header>
          <button type="button" className="home-continue" onClick={onResumeGame} aria-label="Resume Saved Game: Continue Game">
            <span className="home-continue-thumb" aria-hidden="true">
              {THUMB_CARDS.map((card) => (
                <span key={card.id} style={{ transform: `translateX(${card.x}px) rotate(${card.angle}deg)` }}>
                  <CardView cardId={card.id} width={30} decorative />
                </span>
              ))}
            </span>
            <span className="home-card-copy">
              <strong>{activeGame.variant === 'no_mercy' ? 'No Mercy' : 'Classic'} Game</strong>
              <small>{activeGame.players.length} players · Turn {activeGame.turn}</small>
            </span>
            <span className="home-resume"><Icon name="playFill" /> Resume</span>
          </button>
        </section>
      ) : (
        <button type="button" className="sr-only" onClick={onResumeGame}>Resume Saved Game</button>
      )}

      <div className="home-menu">
        <button type="button" className="home-menu-tile" onClick={onOpenSavedGames} aria-label="Saved Games"><Icon name="archive" /><span className="is-long">Saved Games</span></button>
        <button type="button" className="home-menu-tile" onClick={onOpenStats} aria-label="Stats & History"><Icon name="chart" /><span>Stats</span></button>
        <button type="button" className="home-menu-tile" onClick={onOpenRules} aria-label="Rules"><Icon name="book" /><span>Rules</span></button>
        <button type="button" className="home-menu-tile" onClick={onOpenSettings} aria-label="Settings"><Icon name="gear" /><span>Settings</span></button>
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
