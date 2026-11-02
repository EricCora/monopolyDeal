import { lazy, Suspense, useMemo, useState } from 'react';
import type { AchievementId, DailyChallengeV1, GrowthMetricsV1, LifetimeStatsV1, MatchRecordV1 } from '../../stats';
import type { StoredReplay } from '../../persistence/replays';
import { replayPositions } from '../../replay/positions';
import { Icon, type IconName } from '../components/icons';
import { RecentEvents } from '../components/RecentEvents';
import { Sheet } from './GameTableScreen';

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
  { id: 'first_win', label: 'First Win', detail: 'Win a game.', icon: 'trophy' },
  { id: 'ten_wins', label: 'Ten Wins', detail: 'Win ten games.', icon: 'star' },
  { id: 'action_century', label: 'Action Century', detail: 'Play 100 actions across all games.', icon: 'deal_breaker' },
  { id: 'quick_win', label: 'Quick Win', detail: 'Win within 12 turns.', icon: 'pass_go' },
];

/** One game from the history: its log, and a way to watch it back. */
function MatchDetail({ match, replay, onWatch, onClose }: {
  match: MatchRecordV1;
  replay: StoredReplay;
  onWatch: () => void;
  onClose: () => void;
}) {
  const final = useMemo(() => {
    const positions = replayPositions(replay);
    return positions[positions.length - 1];
  }, [replay]);
  return (
    <Sheet label="Match details" title={match.winnerName ? `${match.winnerName} won` : 'No winner'} tall onClose={onClose}>
      <p className="menu-note">{match.players.join(', ')} · {match.turnCount} turns</p>
      <button type="button" className="primary-button" onClick={onWatch}><Icon name="pass_go" /> Watch Replay</button>
      <p className="section-title">Game Log</p>
      <RecentEvents events={final.history} playerNames={final.players.map((player) => player.name)} />
    </Sheet>
  );
}

export function StatsScreen({ history, lifetime, growthMetrics, unlockedAchievements = [], dailyChallenge, replays = [], onWatchReplay, onBack }: StatsScreenProps) {
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);
  const replayIds = useMemo(() => new Set(replays.map((replay) => replay.id)), [replays]);
  const openMatch = history.find((match) => match.id === openMatchId);
  const openReplay = replays.find((replay) => replay.id === openMatchId);
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
      <StatsDashboard history={history} lifetime={lifetime} growthMetrics={growthMetrics} extras={extras} onOpenMatch={(id) => setOpenMatchId(id)} replayIds={replayIds} onBack={onBack} />
      {openMatch && openReplay && onWatchReplay ? (
        <MatchDetail match={openMatch} replay={openReplay} onWatch={() => onWatchReplay(openReplay)} onClose={() => setOpenMatchId(null)} />
      ) : null}
    </Suspense>
  );
}
