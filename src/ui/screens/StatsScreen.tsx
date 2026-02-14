import { lazy, Suspense } from 'react';
import type { LifetimeStatsV1, MatchRecordV1 } from '../../stats';

const StatsDashboard = lazy(() =>
  import('../components/StatsDashboard').then((module) => ({ default: module.StatsDashboard })),
);

interface StatsScreenProps {
  history: MatchRecordV1[];
  lifetime: LifetimeStatsV1;
  onBack: () => void;
}

export function StatsScreen({ history, lifetime, onBack }: StatsScreenProps) {
  return (
    <Suspense
      fallback={
        <section className="panel card-enter stats-panel">
          <h2>Stats & History</h2>
          <p className="stats-empty">Loading analytics...</p>
        </section>
      }
    >
      <StatsDashboard history={history} lifetime={lifetime} onBack={onBack} />
    </Suspense>
  );
}
