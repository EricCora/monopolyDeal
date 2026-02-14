import { useMemo, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  buildStatsDashboardModel,
  type LifetimeRowView,
  type LifetimeStatsV1,
  type MatchRecordV1,
  type MatchRowView,
} from '../../stats';

interface StatsDashboardProps {
  history: MatchRecordV1[];
  lifetime: LifetimeStatsV1;
  onBack: () => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function StatsDashboard({ history, lifetime, onBack }: StatsDashboardProps) {
  const [lifetimeSorting, setLifetimeSorting] = useState<SortingState>([{ id: 'wins', desc: true }]);
  const [matchSorting, setMatchSorting] = useState<SortingState>([{ id: 'endedAt', desc: true }]);
  const dashboard = useMemo(() => buildStatsDashboardModel(history, lifetime), [history, lifetime]);

  const lifetimeColumnHelper = createColumnHelper<LifetimeRowView>();
  const matchColumnHelper = createColumnHelper<MatchRowView>();

  const lifetimeColumns = useMemo(
    () => [
      lifetimeColumnHelper.accessor('name', { header: 'Player' }),
      lifetimeColumnHelper.accessor('wins', { header: 'Wins' }),
      lifetimeColumnHelper.accessor('gamesPlayed', { header: 'Games' }),
      lifetimeColumnHelper.accessor('winRate', {
        header: 'Win Rate',
        cell: (info) => formatPercent(info.getValue()),
      }),
      lifetimeColumnHelper.accessor('avgTurns', {
        header: 'Avg Turns',
        cell: (info) => info.getValue().toFixed(1),
      }),
      lifetimeColumnHelper.accessor('avgDurationSec', {
        header: 'Avg Duration',
        cell: (info) => formatDuration(info.getValue()),
      }),
      lifetimeColumnHelper.accessor('totalActions', { header: 'Total Actions' }),
    ],
    [lifetimeColumnHelper],
  );

  const matchColumns = useMemo(
    () => [
      matchColumnHelper.accessor('endedAt', {
        header: 'Ended At',
        cell: (info) => new Date(info.getValue()).toLocaleString(),
      }),
      matchColumnHelper.accessor('winnerName', { header: 'Winner' }),
      matchColumnHelper.accessor('playersCount', { header: 'Players' }),
      matchColumnHelper.accessor('turnCount', { header: 'Turns' }),
      matchColumnHelper.accessor('durationSec', {
        header: 'Duration',
        cell: (info) => formatDuration(info.getValue()),
      }),
      matchColumnHelper.accessor('totalEvents', { header: 'Total Events' }),
    ],
    [matchColumnHelper],
  );

  const lifetimeTable = useReactTable({
    data: dashboard.lifetimeRows,
    columns: lifetimeColumns,
    state: { sorting: lifetimeSorting },
    onSortingChange: setLifetimeSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const matchTable = useReactTable({
    data: dashboard.matchRows,
    columns: matchColumns,
    state: { sorting: matchSorting },
    onSortingChange: setMatchSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const hasAnyData = dashboard.matchRows.length > 0 || dashboard.lifetimeRows.length > 0;

  return (
    <section className="panel card-enter stats-panel">
      <h2>Stats & History</h2>
      <p className="stats-subtitle">Sortable tables, trend plots, and lifetime performance metrics.</p>

      <section className="stats-kpis" aria-label="Stats key performance indicators">
        <article className="stats-kpi">
          <h3>Total Matches</h3>
          <p>{dashboard.kpis.totalMatches}</p>
        </article>
        <article className="stats-kpi">
          <h3>Average Turns</h3>
          <p>{dashboard.kpis.avgTurns.toFixed(1)}</p>
        </article>
        <article className="stats-kpi">
          <h3>Average Duration</h3>
          <p>{formatDuration(dashboard.kpis.avgDurationSec)}</p>
        </article>
        <article className="stats-kpi">
          <h3>Top Winner</h3>
          <p>
            {dashboard.kpis.topWinnerName} ({dashboard.kpis.topWinnerWins})
          </p>
        </article>
        <article className="stats-kpi">
          <h3>Top Action</h3>
          <p>
            {dashboard.kpis.topActionType} ({dashboard.kpis.topActionCount})
          </p>
        </article>
      </section>

      {!hasAnyData && <p className="stats-empty">No data yet. Complete a match to unlock analytics.</p>}

      <section className="stats-chart-grid" aria-label="Stats charts">
        <article className="stats-chart-card">
          <h3>Wins by Player</h3>
          <p className="stats-chart-summary">
            {dashboard.winsByPlayer.length > 0
              ? `${dashboard.winsByPlayer[0]?.player ?? 'N/A'} currently leads in total wins.`
              : 'No data yet.'}
          </p>
          {dashboard.winsByPlayer.length > 0 ? (
            <div className="stats-chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dashboard.winsByPlayer}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="player" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="wins" fill="#2d7a5e" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="stats-empty">No data yet.</p>
          )}
        </article>
        <article className="stats-chart-card">
          <h3>Turns Trend by Match</h3>
          <p className="stats-chart-summary">Each point is one completed match, ordered oldest to newest.</p>
          {dashboard.matchTrends.length > 0 ? (
            <div className="stats-chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={dashboard.matchTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="turns" stroke="#174f7a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="stats-empty">No data yet.</p>
          )}
        </article>
        <article className="stats-chart-card">
          <h3>Duration Trend by Match</h3>
          <p className="stats-chart-summary">Lower trend lines indicate shorter rounds over time.</p>
          {dashboard.matchTrends.length > 0 ? (
            <div className="stats-chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={dashboard.matchTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis />
                  <Tooltip formatter={(value) => formatDuration(Number(value))} />
                  <Line type="monotone" dataKey="durationSec" stroke="#8a6118" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="stats-empty">No data yet.</p>
          )}
        </article>
        <article className="stats-chart-card">
          <h3>Action Distribution</h3>
          <p className="stats-chart-summary">Most frequent event types across all recorded matches.</p>
          {dashboard.actionDistribution.length > 0 ? (
            <div className="stats-chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dashboard.actionDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="actionType" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#5a8b3d" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="stats-empty">No data yet.</p>
          )}
        </article>
        <article className="stats-chart-card">
          <h3>Matches by Day</h3>
          <p className="stats-chart-summary">Match volume broken out by completion date.</p>
          {dashboard.matchesByDay.length > 0 ? (
            <div className="stats-chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dashboard.matchesByDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#7b4f86" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="stats-empty">No data yet.</p>
          )}
        </article>
        <article className="stats-chart-card">
          <h3>Turn Count Distribution</h3>
          <p className="stats-chart-summary">Distribution of match lengths by turn buckets.</p>
          {dashboard.turnBuckets.some((entry) => entry.count > 0) ? (
            <div className="stats-chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={dashboard.turnBuckets}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="bucket" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="count" fill="#9d6f2a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="stats-empty">No data yet.</p>
          )}
        </article>
      </section>

      <section className="stats-table-card">
        <h3>Lifetime Players</h3>
        <div className="stats-table-wrap">
          <table>
            <thead>
              {lifetimeTable.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                      >
                        <button type="button" onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {lifetimeTable.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                  ))}
                </tr>
              ))}
              {lifetimeTable.getRowModel().rows.length === 0 && (
                <tr>
                  <td colSpan={lifetimeColumns.length} className="stats-empty">
                    No data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stats-table-card">
        <h3>Match History</h3>
        <div className="stats-table-wrap">
          <table>
            <thead>
              {matchTable.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sorted = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                      >
                        <button type="button" onClick={header.column.getToggleSortingHandler()}>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? ' ▲' : sorted === 'desc' ? ' ▼' : ''}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {matchTable.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => {
                    const value = cell.column.id === 'endedAt' ? shortDate(Number(cell.getValue())) : null;
                    return (
                      <td key={cell.id} data-label={value ?? undefined}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {matchTable.getRowModel().rows.length === 0 && (
                <tr>
                  <td colSpan={matchColumns.length} className="stats-empty">
                    No data yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="actions">
        <button onClick={onBack}>Back</button>
      </div>
    </section>
  );
}
