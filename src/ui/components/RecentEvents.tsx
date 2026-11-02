import { useMemo, useState } from 'react';
import type { GameEvent } from '../../engine';
import { buildLogTurns, filterLogTurns, type LogEntry, type LogFilter } from '../table/gameLog';
import { Icon } from './icons';
import { PlayerAvatar } from '../table/tablePieces';

interface RecentEventsProps {
  events: GameEvent[];
  playerNames: string[];
  /** The game is over, so no turn is still being played. */
  finished?: boolean;
}

const FILTERS: { id: LogFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'action', label: 'Actions' },
  { id: 'money', label: 'Money' },
  { id: 'property', label: 'Property' },
];

const TURNS_PER_PAGE = 8;

function EntryText({ entry }: { entry: LogEntry }) {
  if (!entry.actor) return <>{entry.message}</>;
  return <><strong>{entry.actor}</strong>{entry.message.slice(entry.actor.length)}</>;
}

/** The game so far, one card per turn, newest first. */
export function RecentEvents({ events, playerNames, finished = false }: RecentEventsProps) {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [visibleTurns, setVisibleTurns] = useState(TURNS_PER_PAGE);
  const turns = useMemo(() => filterLogTurns(buildLogTurns(events, playerNames, finished), filter), [events, filter, finished, playerNames]);

  return (
    <section className="game-log" aria-label="Game log">
      <div className="game-log-filters" role="group" aria-label="Filter the game log">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            className={filter === option.id ? 'is-active' : ''}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {turns.length === 0 ? <p className="game-log-empty">Nothing here yet.</p> : null}
      {turns.slice(0, visibleTurns).map((turn) => (
        <article key={turn.id} className={`game-log-turn ${turn.isCurrent ? 'is-current' : ''}`}>
          <header>
            {turn.playerName ? <PlayerAvatar name={turn.playerName} isBot={false} /> : null}
            <strong>{turn.playerName ?? 'Table'}</strong>
            <span>{turn.isCurrent ? 'Now' : `Turn ${turn.number}`}</span>
          </header>
          <ol>
            {turn.entries.map((entry) => (
              <li key={entry.id} className={`tone-${entry.tone}`}>
                <span className="game-log-icon" aria-hidden="true"><Icon name={entry.icon} /></span>
                <p><EntryText entry={entry} /></p>
              </li>
            ))}
          </ol>
        </article>
      ))}
      {turns.length > visibleTurns ? (
        <button type="button" className="glass-button game-log-more" onClick={() => setVisibleTurns((count) => count + TURNS_PER_PAGE)}>
          Show Earlier Turns
        </button>
      ) : null}
    </section>
  );
}
