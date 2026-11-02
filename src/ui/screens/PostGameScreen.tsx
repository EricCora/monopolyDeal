import { useMemo, useState, type RefObject } from 'react';
import type { GameState } from '../../engine';
import type { PostGameSummary } from '../../stats';
import type { ShareStatus } from '../types';
import { Confetti } from '../components/Effects';
import { Icon, type IconName } from '../components/icons';

interface PostGameScreenProps {
  postGameSummary: PostGameSummary;
  game: GameState | null;
  celebrationEnabled: boolean;
  reduceCelebrationEffects: boolean;
  prefersReducedMotion: boolean;
  isSharing: boolean;
  shareStatus: ShareStatus;
  replayEvents: Array<{ timestamp: number; type: string; message: string }>;
  showReplayTimeline: boolean;
  showAchievements: boolean;
  recentAchievementUnlockLabels: string[];
  titleRef: RefObject<HTMLHeadingElement | null>;
  formatDuration: (seconds: number) => string;
  onToggleReduceEffects: (enabled: boolean) => void;
  onStartRematch: () => void;
  onShareImage: () => void;
  onOpenSetup: () => void;
  onOpenStats: () => void;
  onGoHome: () => void;
}

const readable = (text: string) => text.replace(/_/g, ' ');

function RecapRow({ icon, title, children }: { icon: IconName; title: string; children: React.ReactNode }) {
  return (
    <div className="recap-row">
      <span className="recap-icon"><Icon name={icon} /></span>
      <div>
        <p className="recap-title">{title}</p>
        <div className="recap-text">{children}</div>
      </div>
    </div>
  );
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function PostGameScreen({
  postGameSummary,
  game,
  celebrationEnabled,
  reduceCelebrationEffects,
  prefersReducedMotion,
  isSharing,
  shareStatus,
  replayEvents,
  showReplayTimeline,
  showAchievements,
  recentAchievementUnlockLabels,
  titleRef,
  formatDuration,
  onToggleReduceEffects,
  onStartRematch,
  onShareImage,
  onOpenSetup,
  onOpenStats,
  onGoHome,
}: PostGameScreenProps) {
  const endedLabel = new Date(postGameSummary.endedAt).toLocaleString();
  const timelineEvents = useMemo(() => replayEvents.slice(), [replayEvents]);
  const [timelineIndex, setTimelineIndex] = useState(() => Math.max(0, timelineEvents.length - 1));
  const timelineEvent = timelineEvents[timelineIndex] ?? null;
  const winner = postGameSummary.winnerName;

  return (
    <section className={`menu-screen postgame-panel card-enter ${celebrationEnabled ? 'has-celebration' : ''}`} aria-labelledby="postgame-title">
      {celebrationEnabled ? <Confetti /> : null}

      <header className="postgame-hero">
        <span className="postgame-trophy" aria-hidden="true"><Icon name="trophy" /></span>
        <h2 id="postgame-title" ref={titleRef} tabIndex={-1}>
          {winner === 'You' ? 'You win!' : `${winner ?? 'Unknown Player'} Wins!`}
        </h2>
        <p className="postgame-meta">{plural(postGameSummary.turnCount, 'turn')} · {formatDuration(postGameSummary.durationSec)}</p>
      </header>

      {showAchievements && recentAchievementUnlockLabels.length > 0 ? (
        <section className="postgame-achievements" aria-labelledby="achievements-title">
          <h3 id="achievements-title" className="sr-only">New Achievements</h3>
          <ul>
            {recentAchievementUnlockLabels.map((label) => <li key={label}><Icon name="seal" /> {label}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="glass-panel postgame-recap" aria-label="Recap highlights">
        <RecapRow icon="flag" title="Winning Move"><p>{readable(postGameSummary.winningMove)}</p></RecapRow>
        <RecapRow icon="trend" title="Momentum Shift"><p>{readable(postGameSummary.momentumShift)}</p></RecapRow>
        {postGameSummary.highlightCards.length > 0 ? (
          <RecapRow icon="sparkles" title="Highlight Cards"><p>{postGameSummary.highlightCards.join(', ')}</p></RecapRow>
        ) : null}
      </section>

      <section className="glass-panel postgame-standings" aria-labelledby="standings-title">
        <h3 id="standings-title" className="sr-only">Final Standings</h3>
        <ul className="postgame-standing-list">
          {postGameSummary.players.map((row) => (
            <li key={row.playerId} className={`postgame-standing ${row.isWinner ? 'is-winner' : ''}`}>
              <span className="postgame-rank">{row.rank}</span>
              <span className="postgame-who">
                <strong>{row.name}</strong>
                <small>{plural(row.lifetimeWins, 'win')} in {plural(row.lifetimeGamesPlayed, 'game')}</small>
              </span>
              <span className="postgame-score">
                <strong>{plural(row.completeSets, 'set')}</strong>
                <small>Bank ${row.bankValue}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="postgame-actions">
        <button type="button" className="primary-button postgame-primary-action" onClick={onStartRematch} disabled={!game}>Play Rematch</button>
        <div className="postgame-action-row">
          <button type="button" className="secondary-button" onClick={onShareImage} disabled={isSharing} aria-label={isSharing ? 'Preparing...' : 'Share Brag Image'}>
            <Icon name="share" /> {isSharing ? 'Preparing...' : 'Share'}
          </button>
          <button type="button" className="secondary-button" onClick={onGoHome}>Home</button>
        </div>
        <div className="postgame-action-row">
          <button type="button" className="secondary-button" onClick={onOpenSetup}>New Match Setup</button>
          <button type="button" className="secondary-button" onClick={onOpenStats}>View Stats</button>
        </div>
      </div>

      {shareStatus ? (
        <p className={`postgame-share-status ${shareStatus.tone === 'error' ? 'is-error' : 'is-success'}`}>{shareStatus.message}</p>
      ) : null}

      <section className="glass-panel postgame-more" aria-label="Match stats">
        <p className="section-title">Match Details</p>
        <div className="postgame-kpis">
          <article><h3>Turns</h3><p>{postGameSummary.turnCount}</p></article>
          <article><h3>Duration</h3><p>{formatDuration(postGameSummary.durationSec)}</p></article>
          <article><h3>Total Events</h3><p>{postGameSummary.totalEvents}</p></article>
        </div>
        <p className="postgame-finished">Finished {endedLabel}</p>
        <p><strong>Final swing:</strong> {readable(postGameSummary.finalSwing)}</p>
        <ul className="postgame-events">
          {postGameSummary.recentEvents.map((event, index) => (
            <li key={`${event.timestamp}-${event.type}-${index}`}>{readable(event.message)}</li>
          ))}
        </ul>
      </section>

      {showReplayTimeline ? (
        <section className="glass-panel postgame-more" aria-labelledby="replay-title">
          <h3 id="replay-title" className="section-title">Replay Timeline</h3>
          {timelineEvents.length > 0 && timelineEvent ? (
            <>
              <label>
                Event {timelineIndex + 1} / {timelineEvents.length}
                <input type="range" min={0} max={timelineEvents.length - 1} value={timelineIndex} onChange={(event) => setTimelineIndex(Number(event.target.value))} />
              </label>
              <div className="postgame-action-row">
                <button type="button" className="secondary-button" onClick={() => setTimelineIndex((prev) => Math.max(0, prev - 1))} disabled={timelineIndex <= 0}>Previous</button>
                <button type="button" className="secondary-button" onClick={() => setTimelineIndex((prev) => Math.min(timelineEvents.length - 1, prev + 1))} disabled={timelineIndex >= timelineEvents.length - 1}>Next</button>
              </div>
              <p><strong>{timelineEvent.type}</strong> at {new Date(timelineEvent.timestamp).toLocaleTimeString()}: {timelineEvent.message}</p>
            </>
          ) : (
            <p>No replay events available for this match.</p>
          )}
        </section>
      ) : null}

      <section className="postgame-accessibility">
        <label className="postgame-toggle">
          <input type="checkbox" checked={reduceCelebrationEffects} onChange={(event) => onToggleReduceEffects(event.target.checked)} />
          Reduce celebration effects
        </label>
        {prefersReducedMotion ? <small>System reduced-motion preference is enabled.</small> : null}
      </section>
    </section>
  );
}
