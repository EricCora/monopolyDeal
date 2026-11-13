import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  buildReady,
  captureConsole,
  captureScreenshot,
  fetchStatus,
  reportSettings,
  sendReply,
  sendReport,
  sentReports,
  type InboxStatus,
  type SentReport,
} from './reportClient';
import './report.css';

export interface ReportSnapshot {
  screen: string;
  game: unknown;
  meta?: Record<string, unknown>;
}

const POSITION_KEY = 'report.buttonPosition';
const SETTINGS_EVENT = 'report-settings-changed';
const STATE_LABELS: Record<string, string> = {
  received: 'Received', fixing: 'Fixing', needs_you: 'Needs you', fixed: 'Fixed', failed: 'Failed',
};

function savedPosition(): { side: 'left' | 'right'; y: number } {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(POSITION_KEY) ?? 'null') as { side: 'left' | 'right'; y: number } | null;
    if (parsed && (parsed.side === 'left' || parsed.side === 'right') && typeof parsed.y === 'number') return parsed;
  } catch {
    // fall through
  }
  return { side: 'left', y: 0.42 };
}

/**
 * The bug button and the "new version" banner, over every screen. Matches the iOS overlay in
 * apps/ios/App/Report/ReportOverlay.swift. Renders nothing unless switched on in Settings.
 */
export function ReportButton({ getSnapshot }: { getSnapshot: () => ReportSnapshot }) {
  const [active, setActive] = useState(() => reportSettings.enabled);
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [sheet, setSheet] = useState<{ screenshot: string | null } | null>(null);
  const [position, setPosition] = useState(savedPosition);
  const [dragY, setDragY] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startX: number; moved: boolean } | null>(null);
  const [dismissed, setDismissed] = useState(() => reportSettings.dismissedBuild);

  useEffect(() => {
    const sync = () => setActive(reportSettings.enabled);
    window.addEventListener(SETTINGS_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_EVENT, sync);
  }, []);

  useEffect(() => {
    if (active) captureConsole();
  }, [active]);

  const refresh = useCallback(async () => {
    if (!reportSettings.active) return;
    try {
      setStatus(await fetchStatus());
    } catch {
      // The sheet shows errors; the banner just waits for the next check.
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active, refresh]);

  const [capturing, setCapturing] = useState(false);
  const open = async () => {
    if (capturing) return;
    // Taken before the sheet appears, so it shows what was on screen. It can take a couple of
    // seconds on a busy table, so the button shows it's working.
    setCapturing(true);
    const screenshot = await captureScreenshot();
    setCapturing(false);
    setSheet({ screenshot });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = { startY: event.clientY, startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    if (Math.abs(event.clientY - drag.current.startY) + Math.abs(event.clientX - drag.current.startX) > 6) drag.current.moved = true;
    if (drag.current.moved) setDragY(Math.min(0.95, Math.max(0.05, event.clientY / window.innerHeight)));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    if (!state.moved) {
      void open();
      return;
    }
    const next = { side: event.clientX < window.innerWidth / 2 ? 'left' : 'right', y: dragY ?? position.y } as const;
    setPosition(next);
    setDragY(null);
    try {
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {
      // Not remembered in private mode.
    }
  };

  if (!active) return null;
  const build = buildReady(status);
  const needsAnswer = sentReports().some((report) => status?.reports[report.id]?.state === 'needs_you');

  return (
    <div data-report-ui="true">
      {build && build.commit !== dismissed ? (
        <div className="report-banner" role="status">
          <span>New version ready{build.reports.length ? ` (${build.reports.length} fix${build.reports.length === 1 ? '' : 'es'})` : ''}.</span>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
          <button type="button" className="report-banner-later" onClick={() => {
            reportSettings.dismissedBuild = build.commit;
            setDismissed(build.commit);
          }}>Later</button>
        </div>
      ) : null}
      <button
        type="button"
        className={`report-fab report-fab-${position.side}${capturing ? ' report-fab-busy' : ''}`}
        aria-busy={capturing}
        style={{ top: `${(dragY ?? position.y) * 100}%` }}
        aria-label="Report a problem"
        data-testid="report-button"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path fill="currentColor" d="M12 4a3 3 0 0 1 3 3h1.5l1.8-1.8 1.4 1.4L18 8.3c.6.8 1 1.7 1.1 2.7H22v2h-2.9a7 7 0 0 1-.6 2.1l2.2 2.2-1.4 1.4-1.9-1.9A7 7 0 0 1 13 19.9V11h-2v8.9a7 7 0 0 1-4.4-3.1l-1.9 1.9-1.4-1.4 2.2-2.2a7 7 0 0 1-.6-2.1H2v-2h2.9c.1-1 .5-1.9 1.1-2.7L4.3 7l1.4-1.4L7.5 7H9a3 3 0 0 1 3-3Z" />
        </svg>
        {needsAnswer ? <span className="report-fab-dot" /> : null}
      </button>
      {sheet ? (
        <ReportSheet
          screenshot={sheet.screenshot}
          status={status}
          getSnapshot={getSnapshot}
          onRefresh={refresh}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

function ReportSheet({ screenshot, status, getSnapshot, onRefresh, onClose }: {
  screenshot: string | null;
  status: InboxStatus | null;
  getSnapshot: () => ReportSnapshot;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SentReport[]>(sentReports);
  const [replies, setReplies] = useState<Record<string, string>>({});

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const snapshot = getSnapshot();
      await sendReport({
        note: note.trim(),
        screenshot: includeScreenshot ? screenshot : null,
        game: snapshot.game,
        meta: {
          screenName: snapshot.screen,
          screen: `${window.innerWidth}x${window.innerHeight}`,
          orientation: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
          userAgent: navigator.userAgent,
          ...snapshot.meta,
        },
      });
      setNote('');
      setSent(sentReports());
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSending(false);
    }
  };

  const reply = async (id: string) => {
    try {
      await sendReply(id, (replies[id] ?? '').trim());
      setReplies((prev) => ({ ...prev, [id]: '' }));
      await onRefresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="report-backdrop" role="dialog" aria-modal="true" aria-label="Report a problem">
      <div className="report-sheet">
        <header>
          <button type="button" onClick={onClose}>Close</button>
          <h2>Report a Problem</h2>
          <button type="button" className="report-send" disabled={sending || !note.trim() || !reportSettings.active} onClick={() => void send()}>
            {sending ? 'Sending...' : 'Send'}
          </button>
        </header>
        <textarea
          autoFocus
          rows={4}
          value={note}
          placeholder="What's wrong, or what should change?"
          aria-label="What's wrong"
          onChange={(event) => setNote(event.target.value)}
        />
        {screenshot ? (
          <label className="report-shot">
            <input type="checkbox" checked={includeScreenshot} onChange={(event) => setIncludeScreenshot(event.target.checked)} />
            <img src={`data:image/jpeg;base64,${screenshot}`} alt="Screenshot of the screen" />
            <span>Include screenshot</span>
          </label>
        ) : null}
        <p className="report-footnote">Sends the screenshot, the game on screen and recent logs. Claude fixes it, ships it, and tells you here when a new version is ready.</p>
        {!reportSettings.active ? <p className="report-error">Add the report key in Settings first.</p> : null}
        {error ? <p className="report-error">{error}</p> : null}
        {sent.length ? (
          <section>
            <h3>Your Reports</h3>
            <ul className="report-list">
              {sent.slice(0, 15).map((report) => {
                const reportStatus = status?.reports[report.id];
                const state = reportStatus?.state ?? 'received';
                return (
                  <li key={report.id}>
                    <div className="report-row">
                      <span className="report-note">{report.note}</span>
                      <span className={`report-chip report-chip-${state}`}>{STATE_LABELS[state] ?? state}</span>
                    </div>
                    {reportStatus?.summary ? <p className="report-summary">{reportStatus.summary}</p> : null}
                    {state === 'needs_you' && reportStatus?.question ? (
                      <div className="report-question">
                        <p>{reportStatus.question}</p>
                        <input
                          value={replies[report.id] ?? ''}
                          placeholder="Your answer"
                          aria-label="Your answer"
                          onChange={(event) => setReplies((prev) => ({ ...prev, [report.id]: event.target.value }))}
                        />
                        <button type="button" disabled={!(replies[report.id] ?? '').trim()} onClick={() => void reply(report.id)}>Send</button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** The developer switch and key, in Settings. */
export function ReportSettingsSection() {
  const onChange = () => window.dispatchEvent(new Event(SETTINGS_EVENT));
  const [enabled, setEnabled] = useState(() => reportSettings.enabled);
  const [key, setKey] = useState(() => reportSettings.key);
  return (
    <section className="settings-section" aria-label="Developer">
      <h3>Developer</h3>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            reportSettings.enabled = event.target.checked;
            setEnabled(event.target.checked);
            onChange();
          }}
        />
        <span>Report Button</span>
      </label>
      {enabled ? (
        <label className="settings-field">
          <span>Report key</span>
          <input
            type="password"
            value={key}
            autoComplete="off"
            onChange={(event) => {
              reportSettings.key = event.target.value;
              setKey(event.target.value);
              onChange();
            }}
          />
        </label>
      ) : null}
      <p className="settings-subtitle settings-footnote">Shows a small bug button on every screen. Drag it to either side. Reports go to Claude, which fixes them and offers a new version here.</p>
    </section>
  );
}
