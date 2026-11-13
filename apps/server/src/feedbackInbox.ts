// The inbox for in-app problem reports. It only ever creates new files, so two requests can't
// overwrite each other. The Mac-side watcher (scripts/feedback/watcher.mjs) writes `index.json`
// with each report's status, the latest build and the latest install.
import { timingSafeEqual } from 'node:crypto';

export interface FeedbackStore {
  /** Returns the file's text, or null when it doesn't exist. */
  read(path: string): Promise<string | null>;
  /** Names directly inside a directory, or [] when it doesn't exist. */
  list(dir: string): Promise<string[]>;
  /** Creates new files. Content is text, or base64 when `base64` is set. */
  create(files: { path: string; content: string; base64?: boolean }[], message: string): Promise<void>;
}

export type ReportState = 'received' | 'fixing' | 'needs_you' | 'fixed' | 'failed';

export interface ReportStatus {
  state: ReportState;
  summary?: string;
  question?: string;
  commit?: string;
  branch?: string;
  updatedAt?: string;
}

export interface FeedbackIndex {
  reports: Record<string, ReportStatus>;
  build: { commit: string; at: string; reports: string[] } | null;
  install: { state: 'requested' | 'installing' | 'installed' | 'failed'; commit?: string; at: string; message?: string } | null;
}

export interface FeedbackRequest {
  method: string;
  path: string;
  key: string | null;
  body: Record<string, unknown>;
}

export interface FeedbackResponse {
  status: number;
  json: unknown;
}

export const MAX_NOTE_CHARS = 4000;
export const MAX_SCREENSHOT_BYTES = 2_500_000;
export const MAX_REPORT_JSON_BYTES = 1_000_000;

export function keyMatches(expected: string | undefined, given: string | null): boolean {
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newReportId(now: Date, random: () => number = Math.random): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const tail = Math.floor(random() * 36 ** 4).toString(36).padStart(4, '0');
  return `${stamp}-${tail}`;
}

const ID_PATTERN = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

async function loadIndex(store: FeedbackStore): Promise<FeedbackIndex> {
  const text = await store.read('index.json');
  const parsed = text ? JSON.parse(text) as Partial<FeedbackIndex> : {};
  return { reports: parsed.reports ?? {}, build: parsed.build ?? null, install: parsed.install ?? null };
}

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

export async function handleFeedbackRequest(
  request: FeedbackRequest,
  store: FeedbackStore,
  expectedKey: string | undefined,
  now: () => Date = () => new Date(),
): Promise<FeedbackResponse> {
  if (!expectedKey) return { status: 503, json: { error: 'not_configured' } };
  if (!keyMatches(expectedKey, request.key)) return { status: 401, json: { error: 'bad_key' } };
  const route = `${request.method.toUpperCase()} ${request.path.replace(/\/+$/, '') || '/'}`;

  if (route === 'GET /status') {
    const index = await loadIndex(store);
    // A report the watcher hasn't seen yet still counts as received.
    for (const id of await store.list('reports')) {
      if (ID_PATTERN.test(id) && !index.reports[id]) index.reports[id] = { state: 'received' };
    }
    const requests = (await store.list('control/install-requests')).sort();
    const lastRequest = requests.at(-1)?.replace(/\.json$/, '') ?? null;
    return { status: 200, json: { ...index, lastInstallRequest: lastRequest } };
  }

  if (route === 'POST /report') {
    const note = text(request.body.note, MAX_NOTE_CHARS).trim();
    if (!note) return { status: 400, json: { error: 'note_required' } };
    const screenshot = typeof request.body.screenshot === 'string' ? request.body.screenshot : null;
    if (screenshot && Buffer.byteLength(screenshot, 'base64') > MAX_SCREENSHOT_BYTES) {
      return { status: 413, json: { error: 'screenshot_too_large' } };
    }
    const at = now();
    const id = newReportId(at);
    const report = {
      id,
      receivedAt: at.toISOString(),
      note,
      platform: text(request.body.platform, 20) || 'unknown',
      meta: request.body.meta ?? {},
      game: request.body.game ?? null,
      logs: Array.isArray(request.body.logs) ? request.body.logs.slice(-500).map((line) => text(line, 500)) : [],
      hasScreenshot: Boolean(screenshot),
    };
    const reportJson = JSON.stringify(report, null, 2);
    if (Buffer.byteLength(reportJson) > MAX_REPORT_JSON_BYTES) return { status: 413, json: { error: 'report_too_large' } };
    const files = [{ path: `reports/${id}/report.json`, content: reportJson }];
    if (screenshot) files.push({ path: `reports/${id}/screenshot.jpg`, content: screenshot, base64: true } as typeof files[number]);
    await store.create(files, `Report ${id}`);
    return { status: 201, json: { id } };
  }

  if (route === 'POST /reply') {
    const id = text(request.body.id, 40);
    const reply = text(request.body.text, MAX_NOTE_CHARS).trim();
    if (!ID_PATTERN.test(id) || !reply) return { status: 400, json: { error: 'bad_reply' } };
    if ((await store.read(`reports/${id}/report.json`)) === null) return { status: 404, json: { error: 'unknown_report' } };
    const at = now().toISOString();
    await store.create([{ path: `reports/${id}/replies/${at.replace(/[:.]/g, '-')}.json`, content: JSON.stringify({ at, text: reply }) }], `Reply to ${id}`);
    return { status: 201, json: { ok: true } };
  }

  if (route === 'POST /install') {
    const at = now().toISOString();
    const name = at.replace(/[:.]/g, '-');
    await store.create([{
      path: `control/install-requests/${name}.json`,
      content: JSON.stringify({ at, commit: text(request.body.commit, 64) || null, platform: text(request.body.platform, 20) || null }),
    }], `Install request ${name}`);
    return { status: 201, json: { ok: true, request: name } };
  }

  return { status: 404, json: { error: 'not_found' } };
}

/** Keeps files in memory, for tests and local runs. */
export function memoryFeedbackStore(initial: Record<string, string> = {}): FeedbackStore & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async read(path) {
      return files.get(path) ?? null;
    },
    async list(dir) {
      const prefix = `${dir.replace(/\/$/, '')}/`;
      const names = new Set<string>();
      for (const path of files.keys()) {
        if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0]);
      }
      return [...names];
    },
    async create(newFiles) {
      for (const file of newFiles) {
        if (files.has(file.path)) throw new Error(`exists: ${file.path}`);
      }
      for (const file of newFiles) files.set(file.path, file.content);
    },
  };
}
