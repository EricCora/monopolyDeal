import { describe, expect, it } from 'vitest';
import { handleFeedbackRequest, memoryFeedbackStore, newReportId } from '../../apps/server/src/feedbackInbox';

const KEY = 'test-key-123';
const at = new Date('2026-11-12T15:30:12.000Z');
const call = (store: ReturnType<typeof memoryFeedbackStore>, method: string, path: string, body = {}, key: string | null = KEY) =>
  handleFeedbackRequest({ method, path, key, body }, store, KEY, () => at);

describe('feedback inbox', () => {
  it('refuses requests without the right key, and says when no key is set up', async () => {
    const store = memoryFeedbackStore();
    expect((await call(store, 'GET', '/status', {}, null)).status).toBe(401);
    expect((await call(store, 'GET', '/status', {}, 'wrong')).status).toBe(401);
    expect((await handleFeedbackRequest({ method: 'GET', path: '/status', key: KEY, body: {} }, store, undefined)).status).toBe(503);
  });

  it('stores a report with its screenshot and lists it as received', async () => {
    const store = memoryFeedbackStore();
    const sent = await call(store, 'POST', '/report', {
      note: '  The rent button is too small ',
      platform: 'ios',
      meta: { commit: 'abc123' },
      game: { initial: {}, actions: [] },
      logs: ['one', 'two'],
      screenshot: Buffer.from('jpeg').toString('base64'),
    });
    expect(sent.status).toBe(201);
    const { id } = sent.json as { id: string };
    expect(id).toMatch(/^20261112-153012-[a-z0-9]{4}$/);
    const report = JSON.parse(store.files.get(`reports/${id}/report.json`)!);
    expect(report).toMatchObject({ note: 'The rent button is too small', platform: 'ios', logs: ['one', 'two'], hasScreenshot: true });
    expect(store.files.get(`reports/${id}/screenshot.jpg`)).toBe(Buffer.from('jpeg').toString('base64'));

    const status = await call(store, 'GET', '/status');
    expect((status.json as { reports: Record<string, unknown> }).reports[id]).toEqual({ state: 'received' });
  });

  it('refuses an empty note or an oversized screenshot', async () => {
    const store = memoryFeedbackStore();
    expect((await call(store, 'POST', '/report', { note: '   ' })).status).toBe(400);
    const huge = Buffer.alloc(2_600_000).toString('base64');
    expect((await call(store, 'POST', '/report', { note: 'x', screenshot: huge })).status).toBe(413);
    expect(store.files.size).toBe(0);
  });

  it('merges the watcher index with reports it has not seen yet', async () => {
    const store = memoryFeedbackStore({
      'index.json': JSON.stringify({
        reports: { '20261112-100000-aaaa': { state: 'fixed', commit: 'def456' } },
        build: { commit: 'def456', at: '2026-11-12T10:05:00Z', reports: ['20261112-100000-aaaa'] },
        install: null,
      }),
      'reports/20261112-100000-aaaa/report.json': '{}',
      'reports/20261112-110000-bbbb/report.json': '{}',
    });
    const status = (await call(store, 'GET', '/status')).json as { reports: Record<string, { state: string }>; build: { commit: string } };
    expect(status.reports['20261112-100000-aaaa'].state).toBe('fixed');
    expect(status.reports['20261112-110000-bbbb'].state).toBe('received');
    expect(status.build.commit).toBe('def456');
  });

  it('stores replies only for known reports', async () => {
    const store = memoryFeedbackStore({ 'reports/20261112-100000-aaaa/report.json': '{}' });
    expect((await call(store, 'POST', '/reply', { id: '20261112-100000-aaaa', text: 'Make it blue' })).status).toBe(201);
    expect((await call(store, 'POST', '/reply', { id: '20261112-100000-zzzz', text: 'x' })).status).toBe(404);
    expect((await call(store, 'POST', '/reply', { id: '../etc', text: 'x' })).status).toBe(400);
    const replies = [...store.files.keys()].filter((path) => path.includes('/replies/'));
    expect(replies).toHaveLength(1);
  });

  it('records install requests as new files and reports the latest', async () => {
    const store = memoryFeedbackStore();
    expect((await call(store, 'POST', '/install', { commit: 'def456' })).status).toBe(201);
    const status = (await call(store, 'GET', '/status')).json as { lastInstallRequest: string };
    expect(status.lastInstallRequest).toBe('2026-11-12T15-30-12-000Z');
  });

  it('makes ids that sort by time', () => {
    expect(newReportId(new Date('2026-01-02T03:04:05Z'), () => 0)).toBe('20260102-030405-0000');
  });
});
