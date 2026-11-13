import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import { needsIosVerify, nextWork, readResult } from '../../scripts/feedback/plan.mjs';

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
});
