// Problem reports from the web app: the same inbox and flow as the iOS bug button
// (apps/ios/App/Report). Off unless switched on in Settings with the report key.

export interface ReportStatus {
  state: 'received' | 'fixing' | 'needs_you' | 'fixed' | 'failed';
  summary?: string;
  question?: string;
  commit?: string;
}

export interface InboxStatus {
  reports: Record<string, ReportStatus>;
  build: { commit: string; at: string; reports: string[] } | null;
  install: { state: string; commit?: string; request?: string; message?: string } | null;
  lastInstallRequest: string | null;
}

export interface SentReport {
  id: string;
  note: string;
  sentAt: string;
}

const KEYS = { enabled: 'report.enabled', key: 'report.key', sent: 'report.sent', dismissed: 'report.dismissedBuild' };
const MAX_LOG_LINES = 400;
const logLines: string[] = [];

export const buildCommit: string = import.meta.env.VITE_BUILD_COMMIT || 'dev';
const apiBase: string = import.meta.env.VITE_REPORT_API || '/api/feedback';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode: settings last for this visit only.
  }
}

export const reportSettings = {
  get enabled() {
    return readStorage(KEYS.enabled) === 'true';
  },
  set enabled(value: boolean) {
    writeStorage(KEYS.enabled, value ? 'true' : null);
  },
  get key() {
    return readStorage(KEYS.key) ?? '';
  },
  set key(value: string) {
    writeStorage(KEYS.key, value.trim() || null);
  },
  get dismissedBuild() {
    return readStorage(KEYS.dismissed);
  },
  set dismissedBuild(value: string | null) {
    writeStorage(KEYS.dismissed, value);
  },
  get active() {
    return this.enabled && this.key.length > 0;
  },
};

export function sentReports(): SentReport[] {
  try {
    const parsed = JSON.parse(readStorage(KEYS.sent) ?? '[]') as SentReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rememberSent(report: SentReport) {
  writeStorage(KEYS.sent, JSON.stringify([report, ...sentReports()].slice(0, 50)));
}

/** Records a line for the next report. */
export function devLog(line: string) {
  logLines.push(`${new Date().toISOString().slice(11, 23)} ${line}`);
  if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
}

let consoleHooked = false;
/** Keeps the browser's warnings and errors for reports. */
export function captureConsole() {
  if (consoleHooked || typeof window === 'undefined') return;
  consoleHooked = true;
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      devLog(`${level}: ${args.map((arg) => (arg instanceof Error ? arg.stack ?? arg.message : typeof arg === 'string' ? arg : safeJson(arg))).join(' ').slice(0, 400)}`);
      original(...args);
    };
  }
  window.addEventListener('error', (event) => devLog(`uncaught: ${event.message}`));
  window.addEventListener('unhandledrejection', (event) => devLog(`unhandled rejection: ${String(event.reason).slice(0, 300)}`));
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function recentLogs(): string[] {
  return [...logLines];
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase}/${path}`, {
    method,
    headers: { 'X-Report-Key': reportSettings.key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    if (response.status === 401) throw new Error("The report key isn't right. Check it in Settings.");
    if (response.status === 503) throw new Error("The report inbox isn't set up on the server yet.");
    throw new Error(`The inbox said ${response.status} (${json.error ?? 'unknown'}).`);
  }
  return json as T;
}

export const fetchStatus = () => call<InboxStatus>('GET', 'status');

export async function sendReport(report: { note: string; screenshot: string | null; game: unknown; meta: Record<string, unknown> }) {
  const { id } = await call<{ id: string }>('POST', 'report', {
    note: report.note,
    platform: 'web',
    meta: { commit: buildCommit, ...report.meta },
    game: report.game,
    logs: recentLogs(),
    screenshot: report.screenshot,
  });
  rememberSent({ id, note: report.note, sentAt: new Date().toISOString() });
  devLog(`report sent ${id}`);
  return id;
}

export const sendReply = (id: string, text: string) => call<{ ok: boolean }>('POST', 'reply', { id, text });

/** Draws the page as a JPEG, as base64 without the data: prefix. */
export async function captureScreenshot(): Promise<string | null> {
  try {
    const { toJpeg } = await import('html-to-image');
    const url = await toJpeg(document.body, {
      quality: 0.6,
      pixelRatio: Math.min(2, window.devicePixelRatio || 1),
      filter: (node) => !(node instanceof HTMLElement && node.dataset.reportUi === 'true'),
    });
    return url.replace(/^data:image\/jpeg;base64,/, '');
  } catch (error) {
    devLog(`screenshot failed: ${String(error)}`);
    return null;
  }
}

/** The newest build has fixes this page doesn't. */
export function buildReady(status: InboxStatus | null): InboxStatus['build'] {
  const build = status?.build ?? null;
  return build && build.commit !== buildCommit ? build : null;
}
