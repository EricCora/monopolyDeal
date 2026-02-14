import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { GameState } from '../../engine';
import type { PostGameSummary } from '../../stats';
import type { ShareStatus } from '../types';

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
  titleRef: RefObject<HTMLHeadingElement | null>;
  formatDuration: (seconds: number) => string;
  onToggleReduceEffects: (enabled: boolean) => void;
  onStartRematch: () => void;
  onShareImage: () => void;
  onOpenSetup: () => void;
  onOpenStats: () => void;
  onGoHome: () => void;
}

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

  useEffect(() => {
    setTimelineIndex(Math.max(0, timelineEvents.length - 1));
  }, [postGameSummary.endedAt, timelineEvents.length]);

  const timelineEvent = timelineEvents[timelineIndex] ?? null;

  return (
    <section className={`panel postgame-panel card-enter ${celebrationEnabled ? 'has-celebration' : ''}`} aria-labelledby="postgame-title">
      {celebrationEnabled && (
        <div className="postgame-celebration" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <span key={`confetti-${index}`} className="confetti-dot" />
          ))}
        </div>
      )}

      <header className="postgame-hero">
        <p className="postgame-kicker">Match Complete</p>
        <h2 id="postgame-title" ref={titleRef} tabIndex={-1}>
          {postGameSummary.winnerName ?? 'Unknown Player'} Wins!
        </h2>
        <p>
          {postGameSummary.winnerName ?? 'The winner'} completed three full property sets and closed out the match.
        </p>
        <p className="postgame-meta">Finished {endedLabel}</p>
      </header>

      <section className="postgame-kpis" aria-label="Match stats">
        <article className="postgame-kpi">
          <h3>Turns</h3>
          <p>{postGameSummary.turnCount}</p>
        </article>
        <article className="postgame-kpi">
          <h3>Duration</h3>
          <p>{formatDuration(postGameSummary.durationSec)}</p>
        </article>
        <article className="postgame-kpi">
          <h3>Total Events</h3>
          <p>{postGameSummary.totalEvents}</p>
        </article>
      </section>

      <section className="postgame-standings" aria-labelledby="standings-title">
        <div className="postgame-heading-row">
          <h3 id="standings-title">Final Standings</h3>
        </div>
        <ul className="postgame-standing-list">
          {postGameSummary.players.map((row) => (
            <li key={row.playerId} className={`postgame-standing ${row.isWinner ? 'is-winner' : ''}`}>
              <div className="postgame-standing-head">
                <p className="postgame-rank">#{row.rank}</p>
                <p className="postgame-name">{row.name}</p>
              </div>
              <div className="postgame-standing-stats">
                <span>{row.completeSets} complete sets</span>
                <span>${row.bankValue} bank value</span>
                <span>{row.propertyCardCount} property cards</span>
                <span>{row.handCount} cards in hand</span>
                <span>${row.totalCardValue} total card value</span>
                <span>
                  Lifetime: {row.lifetimeWins} wins / {row.lifetimeGamesPlayed} games
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="postgame-highlights" aria-labelledby="highlights-title">
        <h3 id="highlights-title">Highlights</h3>
        <p>
          <strong>Final swing:</strong> {postGameSummary.finalSwing}
        </p>
        <ul>
          {postGameSummary.recentEvents.map((event, index) => (
            <li key={`${event.timestamp}-${event.type}-${index}`}>{event.message}</li>
          ))}
        </ul>
      </section>

      {showReplayTimeline ? (
        <section className="postgame-highlights" aria-labelledby="replay-title">
          <h3 id="replay-title">Replay Timeline</h3>
          {timelineEvents.length > 0 && timelineEvent ? (
            <>
              <label>
                Event {timelineIndex + 1} / {timelineEvents.length}
                <input
                  type="range"
                  min={0}
                  max={timelineEvents.length - 1}
                  value={timelineIndex}
                  onChange={(event) => setTimelineIndex(Number(event.target.value))}
                />
              </label>
              <div className="actions">
                <button type="button" onClick={() => setTimelineIndex((prev) => Math.max(0, prev - 1))} disabled={timelineIndex <= 0}>
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setTimelineIndex((prev) => Math.min(timelineEvents.length - 1, prev + 1))}
                  disabled={timelineIndex >= timelineEvents.length - 1}
                >
                  Next
                </button>
              </div>
              <p>
                <strong>{timelineEvent.type}</strong> at {new Date(timelineEvent.timestamp).toLocaleTimeString()}: {timelineEvent.message}
              </p>
            </>
          ) : (
            <p>No replay events available for this match.</p>
          )}
        </section>
      ) : null}

      <section className="postgame-accessibility">
        <label className="postgame-toggle">
          <input
            type="checkbox"
            checked={reduceCelebrationEffects}
            onChange={(event) => onToggleReduceEffects(event.target.checked)}
          />
          Reduce celebration effects
        </label>
        {prefersReducedMotion && <small>System reduced-motion preference is enabled.</small>}
      </section>

      <div className="actions postgame-actions">
        <button className="postgame-primary-action" onClick={onStartRematch} disabled={!game}>
          Play Rematch
        </button>
        <button onClick={onShareImage} disabled={isSharing}>
          {isSharing ? 'Preparing...' : 'Share Brag Image'}
        </button>
        <button onClick={onOpenSetup}>New Match Setup</button>
        <button onClick={onOpenStats}>View Stats</button>
        <button onClick={onGoHome}>Home</button>
      </div>

      {shareStatus ? (
        <p className={`postgame-share-status ${shareStatus.tone === 'error' ? 'is-error' : 'is-success'}`}>{shareStatus.message}</p>
      ) : null}
    </section>
  );
}
