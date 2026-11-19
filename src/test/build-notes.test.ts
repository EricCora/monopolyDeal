import { describe, expect, it } from 'vitest';
import { buildNotes, isNewerBuild, progressLine, sameCommit, type InboxBuild } from '../ui/report/buildNotes';

// master as the watcher publishes it, newest first. Real hashes and times from 2026-11-18.
const log = [
  { commit: '132fe35', at: '2026-11-18T13:36:04-08:00', subject: 'Give each deck picker card its own identifier', app: true },
  { commit: '55a0123', at: '2026-11-18T13:36:04-08:00', subject: 'Group the deck picker by kind', app: true },
  { commit: '53115cf', at: '2026-11-18T13:35:13-08:00', subject: 'Test holding and dragging a seat', app: false },
  { commit: '5602deb', at: '2026-11-18T12:40:16-08:00', subject: 'Let the host set the turn order in the lobby', app: true },
  { commit: 'aaaa111', at: '2026-11-18T12:30:00-08:00', subject: 'Open the match in progress from Show All', app: true, report: '20261118-235940-rno7' },
  { commit: 'aaaa222', at: '2026-11-18T12:31:00-08:00', subject: 'Test Show All', app: false, report: '20261118-235940-rno7' },
  { commit: '6291017', at: '2026-11-18T12:13:03-08:00', subject: 'Show "No change needed"', app: true },
];
const old: InboxBuild = { commit: '629101732381ed56b37231542e843e87d596fcb3', at: '', committedAt: '2026-11-18T12:13:03-08:00', reports: [], log };
const latest: InboxBuild = { commit: '132fe35aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', at: '', committedAt: '2026-11-18T13:36:04-08:00', reports: ['20261118-235940-rno7'], log };

describe('which build is newer', () => {
  it('matches short and full hashes, never "dev"', () => {
    expect(sameCommit('132fe35', '132fe35aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(sameCommit('132fe35', '132fe36')).toBe(false);
    expect(sameCommit('dev', 'dev')).toBe(false);
  });

  it('does not offer an older build to a phone built by hand from a newer commit', () => {
    expect(isNewerBuild(old, '132fe35', null)).toBe(false);
  });

  it('offers a newer build, found by position in the log or by date', () => {
    expect(isNewerBuild(latest, '6291017', null)).toBe(true);
    expect(isNewerBuild(latest, 'fffffff', '2026-11-18T12:00:00-08:00')).toBe(true);
    expect(isNewerBuild(latest, 'fffffff', '2026-11-18T14:00:00-08:00')).toBe(false);
  });

  it('never offers the build the phone already runs', () => {
    expect(isNewerBuild(latest, '132fe35', null)).toBe(false);
    expect(isNewerBuild(null, '132fe35', null)).toBe(false);
  });

  it('still offers when it cannot tell, as before', () => {
    expect(isNewerBuild({ commit: 'newer', at: '', reports: [] }, 'dev', null)).toBe(true);
  });
});

describe('build notes', () => {
  it('lists fixes from reports and other app changes since the running build', () => {
    const notes = buildNotes(latest, '6291017', null);
    expect(notes.fixes).toEqual(['20261118-235940-rno7']);
    expect(notes.changes).toEqual([
      'Give each deck picker card its own identifier',
      'Group the deck picker by kind',
      'Let the host set the turn order in the lobby',
    ]);
    expect(notes.more).toBe(0);
  });

  it('is empty for the running build', () => {
    expect(buildNotes(latest, '132fe35', null)).toEqual({ fixes: [], changes: [], more: 0 });
  });

  it('shows at most 15 changes', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ commit: `c${String(index).padStart(6, '0')}`, at: '2026-11-18T12:00:00Z', subject: `Change ${index}`, app: true }));
    const notes = buildNotes({ commit: many[0].commit, at: '', reports: [], log: many }, 'fffffff', '2026-11-01T00:00:00Z');
    expect(notes.changes).toHaveLength(15);
    expect(notes.more).toBe(5);
  });
});

describe('fix progress line', () => {
  const now = Date.parse('2026-11-18T16:00:30Z');
  it('names the phase, the step and how old it is', () => {
    expect(progressLine({ state: 'fixing', phase: 'checks', step: 'Running npm run quality', stepAt: '2026-11-18T16:00:00Z' }, now))
      .toBe('Running checks · Running npm run quality · 30s ago');
    expect(progressLine({ state: 'fixing', phase: 'working', step: 'Editing HomeView.swift', stepAt: '2026-11-18T15:57:30Z' }, now))
      .toBe('Working on it · Editing HomeView.swift · 3m ago');
    expect(progressLine({ state: 'fixing', phase: 'starting' }, now)).toBe('Starting');
  });

  it('is empty once the report is no longer being fixed', () => {
    expect(progressLine({ state: 'fixed', phase: 'merging', step: 'x' }, now)).toBeNull();
  });
});
