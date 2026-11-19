// Which build is newer, what it brings, and how far a fix has got. Pure, so the same rules can
// be tested here and mirrored in apps/ios/App/Report/ReportCenter.swift.

/** One master commit as the report watcher publishes it, newest first. */
export interface BuildLogEntry {
  commit: string;
  at: string;
  subject: string;
  /** Touches app code (not only tests or tooling). */
  app: boolean;
  /** The report this commit fixed. */
  report?: string;
}

export interface InboxBuild {
  commit: string;
  at: string;
  committedAt?: string;
  reports: string[];
  log?: BuildLogEntry[];
}

export interface FixProgress {
  state: string;
  phase?: string;
  step?: string;
  stepAt?: string;
}

const MAX_CHANGES = 15;

/** A short and a full hash of the same commit match. "dev" and empty never do. */
export function sameCommit(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b || a === 'dev' || b === 'dev') return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 7 && long.startsWith(short);
}

const indexOf = (log: BuildLogEntry[], commit: string) => log.findIndex((entry) => sameCommit(entry.commit, commit));

/**
 * True when the offered build is newer than the running one. Position in the published log
 * decides first (builds made by hand carry no date), then commit dates. When neither can tell,
 * it offers the build, as it always did.
 */
export function isNewerBuild(build: InboxBuild | null | undefined, ownCommit: string, ownDate: string | null): boolean {
  if (!build) return false;
  if (sameCommit(build.commit, ownCommit)) return false;
  const log = build.log ?? [];
  const mine = indexOf(log, ownCommit);
  const theirs = indexOf(log, build.commit);
  if (mine >= 0 && theirs >= 0) return theirs < mine;
  if (ownDate && build.committedAt) return Date.parse(build.committedAt) > Date.parse(ownDate);
  return true;
}

/** What the offered build has that the running one doesn't: reports it fixed, then other app changes. */
export function buildNotes(build: InboxBuild | null | undefined, ownCommit: string, ownDate: string | null) {
  const log = build?.log ?? [];
  const mine = indexOf(log, ownCommit);
  const newer = mine >= 0
    ? log.slice(0, mine)
    : ownDate ? log.filter((entry) => Date.parse(entry.at) > Date.parse(ownDate)) : log;
  const fixes = [...new Set(newer.flatMap((entry) => (entry.report ? [entry.report] : [])))];
  const changes = newer.filter((entry) => entry.app && !entry.report).map((entry) => entry.subject);
  return { fixes, changes: changes.slice(0, MAX_CHANGES), more: Math.max(0, changes.length - MAX_CHANGES) };
}

export const PHASE_LABELS: Record<string, string> = {
  starting: 'Starting',
  working: 'Working on it',
  checks: 'Running checks',
  ios_checks: 'Running iOS checks',
  merging: 'Merging',
};

function age(seconds: number) {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

/** "Running checks · Editing HomeView.swift · 30s ago", or null when the report isn't being fixed. */
export function progressLine(status: FixProgress | undefined, now: number): string | null {
  if (status?.state !== 'fixing' || !status.phase) return null;
  const parts = [PHASE_LABELS[status.phase] ?? status.phase];
  if (status.step) parts.push(status.step);
  if (status.step && status.stepAt) parts.push(age((now - Date.parse(status.stepAt)) / 1000));
  return parts.join(' · ');
}
