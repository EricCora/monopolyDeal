import { useEffect, useMemo, useState } from 'react';
import type { GameEvent } from '../../engine';

type EventFilter = 'all' | 'action' | 'money' | 'property' | 'turn';
type EventTone = 'action' | 'money' | 'property' | 'turn' | 'neutral';

interface RecentEventsProps {
  events: GameEvent[];
  enhancedGrouping?: boolean;
}

interface DecoratedEvent extends GameEvent {
  filter: Exclude<EventFilter, 'all'>;
  tone: EventTone;
  icon: string;
  label: string;
}

interface EventGroup {
  id: string;
  title: string;
  events: DecoratedEvent[];
}

const FILTERS: { id: EventFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'action', label: 'Actions' },
  { id: 'money', label: 'Money' },
  { id: 'property', label: 'Property' },
  { id: 'turn', label: 'Turns' },
];

function formatEventType(type: string): string {
  return type
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function eventMeta(type: string): Pick<DecoratedEvent, 'filter' | 'tone' | 'icon' | 'label'> {
  if (type === 'turn_passed') return { filter: 'turn', tone: 'turn', icon: 'TRN', label: 'Turn End' };
  if (type === 'draw') return { filter: 'action', tone: 'action', icon: 'DRW', label: 'Draw' };
  if (type === 'bank' || type === 'pay' || type === 'payment') return { filter: 'money', tone: 'money', icon: '$', label: 'Money' };
  if (type === 'property' || type === 'wild_move') return { filter: 'property', tone: 'property', icon: 'PRP', label: 'Property' };
  if (type === 'action' || type === 'rent_target' || type === 'counter') return { filter: 'action', tone: 'action', icon: 'ACT', label: 'Action' };
  return { filter: 'action', tone: 'neutral', icon: 'LOG', label: formatEventType(type) };
}

function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function groupEvents(events: DecoratedEvent[]): EventGroup[] {
  if (events.length === 0) return [];
  const groups: EventGroup[] = [];
  let current: DecoratedEvent[] = [];
  let index = 0;
  const pushGroup = () => {
    if (current.length === 0) return;
    const title = index === 0 ? 'Current Turn' : index === 1 ? 'Previous Turn' : `${index} Turns Ago`;
    groups.push({ id: `event-group-${index}`, title, events: current });
    current = [];
    index += 1;
  };

  for (const event of events) {
    current.push(event);
    if (event.type === 'turn_passed') pushGroup();
  }

  pushGroup();
  return groups;
}

function collapseActionChains(events: DecoratedEvent[]): DecoratedEvent[] {
  const chainTypes = new Set(['action', 'counter', 'rent_target', 'pay', 'payment']);
  const collapsed: DecoratedEvent[] = [];

  for (const event of events) {
    const previous = collapsed[collapsed.length - 1];
    const inChain = chainTypes.has(event.type);
    const previousInChain = previous ? chainTypes.has(previous.type) : false;
    const closeInTime = previous ? Math.abs(previous.timestamp - event.timestamp) <= 8_000 : false;

    if (previous && inChain && previousInChain && closeInTime) {
      collapsed[collapsed.length - 1] = {
        ...previous,
        type: 'action_chain',
        label: 'Chain',
        icon: 'CHN',
        tone: 'action',
        filter: 'action',
        message: `${previous.message} -> ${event.message}`,
      };
      continue;
    }

    collapsed.push(event);
  }

  return collapsed;
}

export function RecentEvents({ events, enhancedGrouping = false }: RecentEventsProps) {
  const [filter, setFilter] = useState<EventFilter>('all');
  const [visibleCount, setVisibleCount] = useState(12);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const decoratedDesc = useMemo(() => {
    const base = [...events]
      .reverse()
      .slice(0, visibleCount)
      .map((event) => ({ ...event, ...eventMeta(event.type) }));
    return enhancedGrouping ? collapseActionChains(base) : base;
  }, [enhancedGrouping, events, visibleCount]);

  const grouped = useMemo(() => {
    const groupedAll = groupEvents(decoratedDesc);
    if (filter === 'all') return groupedAll;
    return groupedAll
      .map((group) => ({ ...group, events: group.events.filter((event) => event.filter === filter) }))
      .filter((group) => group.events.length > 0);
  }, [decoratedDesc, filter]);

  const canShowMore = events.length > visibleCount;
  const visibleEventsCount = grouped.reduce((total, group) => total + group.events.length, 0);

  return (
    <section className="events-panel panel card-enter">
      <div className="events-head">
        <div>
          <p className="events-kicker">Match Log</p>
          <h3>Recent Events</h3>
          <small>Turn-by-turn timeline</small>
        </div>
        <small>{visibleEventsCount} shown · {events.length} total</small>
      </div>
      <div className="events-filters" role="tablist" aria-label="Filter recent events">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={filter === option.id}
            aria-pressed={filter === option.id}
            className={`events-filter ${filter === option.id ? 'is-active' : ''}`}
            onClick={() => setFilter(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="events-scroll">
        {grouped.length > 0 ? (
          grouped.map((group) => (
            <section className="event-group" key={group.id}>
              <h4>{group.title}</h4>
              <ul className="event-list">
                {group.events.map((event, index) => (
                  <li key={`${event.timestamp}-${event.type}-${index}`} className={`event-item tone-${event.tone}`}>
                    <span className="event-icon" aria-hidden="true">
                      {event.icon}
                    </span>
                    <div className="event-copy">
                      <p>
                        <span className="event-badge">{event.label}</span> {event.message}
                      </p>
                      <small>{relativeTime(event.timestamp, now)}</small>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ) : (
          <p className="events-empty">No events for this filter yet.</p>
        )}
      </div>

      <div className="events-actions">
        <button type="button" onClick={() => setVisibleCount((count) => count + 12)} disabled={!canShowMore}>
          {canShowMore ? 'Show Older Events' : 'All Events Visible'}
        </button>
      </div>
    </section>
  );
}
