import type { GameEvent } from '../../engine';

export type LogFilter = 'all' | 'action' | 'money' | 'property';
export type LogTone = 'action' | 'money' | 'property' | 'turn' | 'neutral';

export interface LogEntry {
  id: string;
  message: string;
  tone: LogTone;
  filter: Exclude<LogFilter, 'all'> | 'turn';
  /** A symbol name, shared by meaning with the iOS log. */
  icon: 'draw' | 'dollar' | 'stack' | 'sparkles' | 'just_say_no' | 'check' | 'info' | 'trophy';
  /** Whoever the entry starts with, so the name can stand out. */
  actor: string | null;
  timestamp: number;
}

export interface LogTurn {
  id: string;
  /** Counted from the start of the log, so a label doesn't change as the game goes on. */
  number: number;
  playerName: string | null;
  entries: LogEntry[];
  /** Whether this is the turn still being played. */
  isCurrent: boolean;
}

function describe(type: string): Pick<LogEntry, 'tone' | 'filter' | 'icon'> {
  switch (type) {
    case 'turn_passed': return { tone: 'turn', filter: 'turn', icon: 'check' };
    case 'draw': return { tone: 'turn', filter: 'turn', icon: 'draw' };
    case 'bank': case 'pay': case 'payment': return { tone: 'money', filter: 'money', icon: 'dollar' };
    case 'property': case 'wild_move': return { tone: 'property', filter: 'property', icon: 'stack' };
    case 'counter': return { tone: 'action', filter: 'action', icon: 'just_say_no' };
    case 'action': case 'rent_target': return { tone: 'action', filter: 'action', icon: 'sparkles' };
    case 'game_over': return { tone: 'neutral', filter: 'turn', icon: 'trophy' };
    default: return { tone: 'neutral', filter: 'action', icon: 'info' };
  }
}

function actorOf(message: string, names: string[]): string | null {
  // Longest first, so "Bot 10" isn't read as "Bot 1".
  return [...names].sort((left, right) => right.length - left.length).find((name) => message.startsWith(`${name} `)) ?? null;
}

/** The game's events by turn, newest turn first and newest entry first within it. */
export function buildLogTurns(events: GameEvent[], playerNames: string[]): LogTurn[] {
  const turns: LogTurn[] = [];
  let current: LogTurn | null = null;
  events.forEach((event, index) => {
    if (!current) {
      current = { id: `turn-${turns.length + 1}`, number: turns.length + 1, playerName: null, entries: [], isCurrent: false };
      turns.push(current);
    }
    const actor = actorOf(event.message, playerNames);
    current.playerName ??= actor;
    current.entries.push({
      id: `${index}`,
      message: event.message,
      actor,
      timestamp: event.timestamp,
      ...describe(event.type),
    });
    if (event.type === 'turn_passed') current = null;
  });
  const reversed = turns.reverse().map((turn) => ({ ...turn, entries: [...turn.entries].reverse() }));
  if (reversed[0] && current) reversed[0].isCurrent = true;
  return reversed;
}

export function filterLogTurns(turns: LogTurn[], filter: LogFilter): LogTurn[] {
  if (filter === 'all') return turns;
  return turns
    .map((turn) => ({ ...turn, entries: turn.entries.filter((entry) => entry.filter === filter) }))
    .filter((turn) => turn.entries.length > 0);
}
