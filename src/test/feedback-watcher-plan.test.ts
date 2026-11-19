import { describe, expect, it } from 'vitest';
import {
  buildFromLog, failedTestNames, forbiddenPaths, isAppChange, makeThrottle, needsIosVerify, newFailures, nextWork, parseGitLog, parseIosFailures, readResult, stepFromEvent,
// @ts-expect-error plain JS module without types
} from '../../scripts/feedback/plan.mjs';

const empty = { reportIds: [], installRequests: [], replies: {}, platforms: {} };

describe('report watcher planning', () => {
  it('has nothing to do on an empty inbox', () => {
    expect(nextWork({ reports: {}, install: null }, empty)).toBeNull();
  });

  it('takes the oldest new report and skips test reports', () => {
    const work = nextWork({ reports: { '20261112-090000-aaaa': { state: 'fixed' } }, install: null }, {
      ...empty,
      reportIds: ['20261112-110000-cccc', '20261112-090000-aaaa', '20261112-100000-bbbb', '20261112-080000-tttt', 'README.md'],
      platforms: { '20261112-080000-tttt': 'test' },
    });
    expect(work).toEqual({ kind: 'report', id: '20261112-100000-bbbb' });
  });

  it('puts a new install request ahead of reports, and only once', () => {
    const inbox = { ...empty, reportIds: ['20261112-100000-bbbb'], installRequests: ['2026-11-12T10-00-00-000Z'] };
    expect(nextWork({ reports: {}, install: null }, inbox)).toEqual({ kind: 'install', request: '2026-11-12T10-00-00-000Z' });
    const done = { reports: {}, install: { state: 'installed', request: '2026-11-12T10-00-00-000Z' } };
    expect(nextWork(done, inbox)).toEqual({ kind: 'report', id: '20261112-100000-bbbb' });
  });

  it('retries an install that is waiting for the phone, after any new reports', () => {
    const index = { reports: {}, install: { state: 'waiting', request: 'r1' } };
    expect(nextWork(index, { ...empty, installRequests: ['r1'] })).toEqual({ kind: 'install', request: 'r1', retry: true });
    expect(nextWork(index, { ...empty, installRequests: ['r1'], reportIds: ['20261112-100000-bbbb'] }))
      .toEqual({ kind: 'report', id: '20261112-100000-bbbb' });
  });

  it('answers unread replies to a question before new reports', () => {
    const index = { reports: { '20261112-090000-aaaa': { state: 'needs_you', repliesSeen: ['a.json'] } }, install: null };
    const inbox = { ...empty, reportIds: ['20261112-090000-aaaa', '20261112-100000-bbbb'], replies: { '20261112-090000-aaaa': ['a.json', 'b.json'] } };
    expect(nextWork(index, inbox)).toEqual({ kind: 'reply', id: '20261112-090000-aaaa', replies: ['b.json'] });
  });

  it('stops resuming a fix that keeps hitting errors', () => {
    expect(nextWork({ reports: { '20261112-090000-aaaa': { state: 'fixing', errors: 1 } }, install: null }, empty))
      .toEqual({ kind: 'report', id: '20261112-090000-aaaa', resume: true });
    expect(nextWork({ reports: { '20261112-090000-aaaa': { state: 'fixing', errors: 2 } }, install: null }, empty)).toBeNull();
  });

  it('picks a half-finished fix back up', () => {
    expect(nextWork({ reports: { '20261112-090000-aaaa': { state: 'fixing' } }, install: null }, empty))
      .toEqual({ kind: 'report', id: '20261112-090000-aaaa', resume: true });
  });

  it('runs iOS checks only for app or rule changes', () => {
    expect(needsIosVerify(['src/ui/table/Hand.tsx'])).toBe(false);
    expect(needsIosVerify(['src/engine/rules.ts'])).toBe(true);
    expect(needsIosVerify(['apps/ios/App/Views/Table/TableView.swift'])).toBe(true);
  });

  it('treats a missing or malformed result as a failure', () => {
    expect(readResult(null).outcome).toBe('failed');
    expect(readResult({ outcome: 'merged' }).outcome).toBe('failed');
    expect(readResult({ outcome: 'needs_you', question: 'Blue or green?' })).toEqual({ outcome: 'needs_you', summary: '', question: 'Blue or green?' });
  });

  it('keeps a "no change needed" result apart from a failure', () => {
    expect(readResult({ outcome: 'no_change', summary: 'Looks like a test of the button.' }))
      .toEqual({ outcome: 'no_change', summary: 'Looks like a test of the button.', question: undefined });
  });

  it('does not pick a no-change report up again', () => {
    expect(nextWork({ reports: { '20261118-200336-7561': { state: 'no_change' } }, install: null }, {
      ...empty, reportIds: ['20261118-200336-7561'],
    })).toBeNull();
  });
});

describe('report watcher iOS gate', () => {
  it('reads the failures ios:verify names', () => {
    {
      const out = 'noise\nIOS_VERIFY_UI_FAILURES {"iPhone 18 Pro Max":["PlaytestRoundTests/testA","SmokeTests/testB"]}\n';
      const branch = parseIosFailures(out);
      expect(branch).toEqual({ 'iPhone 18 Pro Max': ['PlaytestRoundTests/testA', 'SmokeTests/testB'] });
      expect(parseIosFailures('swift test failed')).toBeNull();
      expect(newFailures(branch, { 'iPhone 18 Pro Max': ['PlaytestRoundTests/testA'] })).toEqual({ 'iPhone 18 Pro Max': ['SmokeTests/testB'] });
      expect(newFailures({ iPad: ['*'] }, { iPad: ['*'] })).toEqual({ iPad: ['*'] });
      expect(newFailures(branch, branch)).toEqual({});
      expect(failedTestNames({ a: ['x', 'y'], b: ['x'] })).toEqual(['x', 'y']);
      expect(forbiddenPaths(['src/a.ts', '.feedback/1/screenshot.jpg'])).toEqual(['.feedback/1/screenshot.jpg']);
    }
  });
});

describe('report watcher build notes', () => {
  // `git log --format=%x1e%h%x09%cI%x09%s --name-only`, as the watcher runs it.
  const raw = [
    '\x1e132fe35\t2026-11-18T13:36:04-08:00\tGive each deck picker card its own identifier\n\napps/ios/App/Views/DeckPicker.swift\n',
    '\x1e53115cf\t2026-11-18T13:35:13-08:00\tTest holding and dragging a seat\n\napps/ios/AppUITests/NearbyTests.swift\n',
    '\x1eaaaa111\t2026-11-18T12:30:00-08:00\tOpen the match in progress\n\nsrc/ui/Home.tsx\nsrc/test/home.test.tsx\n',
    '\x1e6291017\t2026-11-18T12:13:03-08:00\tShow "No change needed"\n\nscripts/feedback/watcher.mjs\n',
  ].join('');

  it('counts only app code, not tests or tooling, as an app change', () => {
    expect(isAppChange(['src/ui/Home.tsx'])).toBe(true);
    expect(isAppChange(['apps/ios/App/Views/Home.swift'])).toBe(true);
    expect(isAppChange(['src/test/home.test.tsx', 'apps/ios/AppUITests/A.swift', 'apps/ios/DealKit/Tests/B.swift'])).toBe(false);
    expect(isAppChange(['scripts/feedback/watcher.mjs', 'docs/a.md'])).toBe(false);
  });

  it('reads the log with each commit\'s files', () => {
    const entries = parseGitLog(raw);
    expect(entries).toHaveLength(4);
    expect(entries[2]).toEqual({ commit: 'aaaa111', at: '2026-11-18T12:30:00-08:00', subject: 'Open the match in progress', files: ['src/ui/Home.tsx', 'src/test/home.test.tsx'] });
  });

  it('offers the newest app change, tagging commits that fixed a report', () => {
    const reports = { '20261118-235940-rno7': { state: 'fixed', commits: ['aaaa111'] } };
    const build = buildFromLog(parseGitLog(raw), reports, ['20261118-235940-rno7']);
    expect(build).toMatchObject({ commit: '132fe35', committedAt: '2026-11-18T13:36:04-08:00', reports: ['20261118-235940-rno7'] });
    expect(build.log.map((entry: { commit: string; app: boolean; report?: string }) => [entry.commit, entry.app, entry.report])).toEqual([
      ['132fe35', true, undefined], ['53115cf', false, undefined], ['aaaa111', true, '20261118-235940-rno7'], ['6291017', false, undefined],
    ]);
    expect(buildFromLog(parseGitLog(raw).slice(3), {}, [])).toBeNull();
  });
});

describe('report watcher live progress', () => {
  const tool = (name: string, input: Record<string, unknown>) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });

  it('turns agent tool calls into short steps, without paths, arguments or output', () => {
    expect(stepFromEvent(tool('Edit', { file_path: '/Users/x/fix/apps/ios/App/Views/HomeView.swift', old_string: 'secret' }))).toBe('Editing HomeView.swift');
    expect(stepFromEvent(tool('Read', { file_path: '/a/b/src/ui/Home.tsx' }))).toBe('Reading Home.tsx');
    expect(stepFromEvent(tool('Bash', { command: 'npm run quality 2>&1 | tail', description: 'Run checks' }))).toBe('Running npm run quality');
    expect(stepFromEvent(tool('Bash', { command: 'npx vitest run src/test/home.test.tsx' }))).toBe('Running tests');
    expect(stepFromEvent(tool('Bash', { command: 'git commit -m "token=abc"' }))).toBe('Using git');
    expect(stepFromEvent(tool('Bash', { command: 'FOO=bar /usr/bin/xcrun simctl list' }))).toBe('Running xcrun');
    expect(stepFromEvent(tool('Grep', { pattern: 'x' }))).toBe('Searching the code');
    expect(stepFromEvent({ type: 'user', message: { content: [{ type: 'tool_result', content: 'output' }] } })).toBeNull();
    expect(stepFromEvent({ type: 'result', result: 'done' })).toBeNull();
  });

  it('writes at most once per interval, and always the latest step', () => {
    let clock = 0;
    const written: string[] = [];
    const throttle = makeThrottle((step: string) => written.push(step), 30_000, () => clock);
    throttle.push('Reading a.ts');
    clock = 5_000;
    throttle.push('Editing a.ts');
    throttle.push('Editing b.ts');
    expect(written).toEqual(['Reading a.ts']);
    clock = 31_000;
    throttle.tick();
    expect(written).toEqual(['Reading a.ts', 'Editing b.ts']);
    clock = 70_000;
    throttle.tick();
    expect(written).toHaveLength(2);
  });
});
