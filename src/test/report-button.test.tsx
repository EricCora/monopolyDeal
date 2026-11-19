import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportButton } from '../ui/report/ReportButton';

vi.mock('html-to-image', () => ({ toJpeg: vi.fn(async () => 'data:image/jpeg;base64,U0hPVA==') }));

const snapshot = () => ({ screen: 'game', game: { kind: 'local', state: { turnCount: 3 } } });

describe('web report button', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/status')) {
        return new Response(JSON.stringify({ reports: {}, build: { commit: 'newer', at: '', reports: ['x'] }, install: null, lastInstallRequest: null }));
      }
      if (url.endsWith('/report')) return new Response(JSON.stringify({ id: '20261112-153012-abcd' }), { status: 201 });
      throw new Error(`unexpected ${url} ${init?.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays hidden until switched on', () => {
    render(<ReportButton getSnapshot={snapshot} />);
    expect(screen.queryByTestId('report-button')).toBeNull();
  });

  it('sends the note, screenshot and game, and offers the newer version', async () => {
    localStorage.setItem('report.enabled', 'true');
    localStorage.setItem('report.key', 'secret');
    render(<ReportButton getSnapshot={snapshot} />);
    expect(await screen.findByText(/New version ready \(1 fix\)/)).toBeInTheDocument();

    const button = screen.getByTestId('report-button');
    await act(async () => {
      fireEvent.pointerDown(button, { clientX: 5, clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(button, { clientX: 5, clientY: 100, pointerId: 1 });
    });
    const note = await screen.findByLabelText("What's wrong");
    fireEvent.change(note, { target: { value: 'Rent chooser is cramped' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/report'))).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/report'))!;
    expect((init.headers as Record<string, string>)['X-Report-Key']).toBe('secret');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ note: 'Rent chooser is cramped', platform: 'web', screenshot: 'U0hPVA==', game: { kind: 'local' } });
    expect(body.meta.screenName).toBe('game');
    expect(await screen.findByText('Rent chooser is cramped')).toBeInTheDocument();
  });

  it('shows how far a fix has got, and what the new version brings', async () => {
    localStorage.setItem('report.enabled', 'true');
    localStorage.setItem('report.key', 'secret');
    localStorage.setItem('report.sent', JSON.stringify([
      { id: '20261118-235940-rno7', note: 'Show All opens saved games', sentAt: '2026-11-18T23:59:40Z' },
      { id: '20261118-100000-aaaa', note: 'Rent chooser is cramped', sentAt: '2026-11-18T10:00:00Z' },
    ]));
    const stepAt = new Date(Date.now() - 20_000).toISOString();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      reports: {
        '20261118-235940-rno7': { state: 'fixing', phase: 'checks', step: 'Running npm run quality', stepAt },
        '20261118-100000-aaaa': { state: 'fixed', summary: 'Gave the chooser more room.' },
      },
      build: {
        commit: '132fe35', at: '', committedAt: '2026-11-18T13:36:04-08:00', reports: [],
        log: [
          { commit: '132fe35', at: '2026-11-18T13:36:04-08:00', subject: 'Group the deck picker by kind', app: true },
          { commit: 'bbbb111', at: '2026-11-18T13:00:00-08:00', subject: 'Widen the rent chooser', app: true, report: '20261118-100000-aaaa' },
          { commit: '53115cf', at: '2026-11-18T12:50:00-08:00', subject: 'Test the lobby', app: false },
        ],
      },
      install: null,
      lastInstallRequest: null,
    })));
    render(<ReportButton getSnapshot={snapshot} />);
    expect(await screen.findByText(/New version ready \(1 fix\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "What's New" }));
    expect(screen.getByText('Fixed from your reports')).toBeInTheDocument();
    expect(screen.getByText('Gave the chooser more room.')).toBeInTheDocument();
    expect(screen.getByText('Group the deck picker by kind')).toBeInTheDocument();
    expect(screen.queryByText('Test the lobby')).toBeNull();

    const button = screen.getByTestId('report-button');
    await act(async () => {
      fireEvent.pointerDown(button, { clientX: 5, clientY: 100, pointerId: 1 });
      fireEvent.pointerUp(button, { clientX: 5, clientY: 100, pointerId: 1 });
    });
    expect(await screen.findByText(/^Running checks · Running npm run quality · 2\ds ago$/)).toBeInTheDocument();
  });
});
