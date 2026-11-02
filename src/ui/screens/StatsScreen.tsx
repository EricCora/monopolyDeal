import { lazy, Suspense } from 'react';
import type { AchievementId, DailyChallengeV1, GrowthMetricsV1, LifetimeStatsV1, MatchRecordV1 } from '../../stats';
import type { StoredReplay } from '../../persistence/replays';
import { Icon, type IconName } from '../components/icons';

const StatsDashboard = lazy(() =>
  import('../components/StatsDashboard').then((module) => ({ default: module.StatsDashboard })),
);

interface StatsScreenProps {
  history: MatchRecordV1[];
  lifetime: LifetimeStatsV1;
  growthMetrics: GrowthMetricsV1;
  unlockedAchievements?: AchievementId[];
  dailyChallenge?: DailyChallengeV1;
  replays?: StoredReplay[];
  onWatchReplay?: (replay: StoredReplay) => void;
  onBack: () => void;
}

const ACHIEVEMENTS: Array<{ id: AchievementId; label: string; detail: string; icon: IconName }> = [
  { id: 'first_win', label: 'First Win', detail: 'Finish a game with a winner.', icon: 'trophy' },
  { id: 'ten_wins', label: 'Ten Wins', detail: 'Finish ten games with a winner.', icon: 'star' },
  { id: 'action_century', label: 'Action Century', detail: 'Play 100 actions across all games.', icon: 'deal_breaker' },
  { id: 'quick_win', label: 'Quick Win', detail: 'Win within 12 turns.', icon: 'pass_go' },
];

export function StatsScreen({ history, lifetime, growthMetrics, unlockedAchievements = [], dailyChallenge, replays = [], onWatchReplay, onBack }: StatsScreenProps) {
  const extras = (
    <>
      <section className="stats-progress" aria-label="Achievements">
        <p className="section-title">Achievements</p>
        {ACHIEVEMENTS.map((achievement) => {
          const unlocked = unlockedAchievements.includes(achievement.id);
          return (
            <div key={achievement.id} className={`stats-achievement ${unlocked ? 'is-unlocked' : ''}`}>
              <Icon name={achievement.icon} />
              <span>
                {achievement.label}
                <small>{achievement.detail}</small>
              </span>
              <span className="sr-only">{unlocked ? 'Unlocked' : 'Locked'}</span>
            </div>
          );
        })}
      </section>
      {dailyChallenge ? (
        <section className="stats-progress" aria-label="Today's challenge">
          <p className="section-title">Today&apos;s Challenge</p>
          <strong>Finish within {dailyChallenge.targetTurns} turns</strong>
          <small>
            {dailyChallenge.attempts} attempts · Best: {dailyChallenge.bestTurnCount != null ? `${dailyChallenge.bestTurnCount} turns` : 'none yet'} · {dailyChallenge.completed ? 'Done' : 'Not done yet'}
          </small>
        </section>
      ) : null}
      {replays.length > 0 && onWatchReplay ? (
        <section className="stats-progress" aria-label="Replays">
          <p className="section-title">Replays</p>
          {replays.map((replay) => (
            <button key={replay.id} type="button" className="stats-replay" onClick={() => onWatchReplay(replay)}>
              <Icon name="pass_go" />
              <span>{replay.title}<small>{new Date(replay.endedAt).toLocaleString()}</small></span>
            </button>
          ))}
        </section>
      ) : null}
    </>
  );
  return (
    <Suspense
      fallback={
        <section className="panel card-enter stats-panel">
          <h2>Stats & History</h2>
          <p className="stats-empty">Loading analytics...</p>
        </section>
      }
    >
      <StatsDashboard history={history} lifetime={lifetime} growthMetrics={growthMetrics} extras={extras} onBack={onBack} />
    </Suspense>
  );
}
