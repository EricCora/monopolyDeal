// Pure decisions for the report watcher, kept apart so they can be tested.

export const REPORT_ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/;
/** A report whose handling throws this many times is marked failed instead of tried again. */
export const MAX_ERRORS = 2;

/**
 * What the watcher should do next, in priority order: an install Eric is waiting on, a reply
 * to a question, then the oldest new report.
 * @param {{ reports: Record<string, any>, install: any }} index
 * @param {{ reportIds: string[], installRequests: string[], replies: Record<string, string[]>, platforms: Record<string, string> }} inbox
 */
export function nextWork(index, inbox) {
  const latestRequest = [...inbox.installRequests].sort().at(-1);
  if (latestRequest && latestRequest !== index.install?.request) return { kind: 'install', request: latestRequest };

  for (const [id, status] of Object.entries(index.reports)) {
    if (status.state !== 'needs_you') continue;
    const unread = (inbox.replies[id] ?? []).filter((name) => !(status.repliesSeen ?? []).includes(name)).sort();
    if (unread.length) return { kind: 'reply', id, replies: unread };
  }

  const fresh = inbox.reportIds
    .filter((id) => REPORT_ID.test(id) && !index.reports[id] && inbox.platforms[id] !== 'test')
    .sort();
  if (fresh.length) return { kind: 'report', id: fresh[0] };

  // A fix the watcher was part-way through when it stopped.
  const stuck = Object.entries(index.reports).find(([, status]) => status.state === 'fixing' && (status.errors ?? 0) < MAX_ERRORS);
  if (stuck) return { kind: 'report', id: stuck[0], resume: true };
  // An install waiting for the phone to come in range, tried again once the rest is done.
  if (index.install?.state === 'waiting') return { kind: 'install', request: index.install.request, retry: true };
  return null;
}

/** iOS needs its own verification when the change touches the app or the shared rules. */
export function needsIosVerify(changedFiles) {
  return changedFiles.some((file) => file.startsWith('apps/ios/') || file.startsWith('src/engine/'));
}

/** The result file the fix session writes, checked so a malformed one can't merge anything. */
export function readResult(json) {
  const outcome = json?.outcome;
  if (!['fixed', 'no_change', 'needs_you', 'failed'].includes(outcome)) return { outcome: 'failed', summary: 'The fix session ended without a result.' };
  return {
    outcome,
    summary: typeof json.summary === 'string' ? json.summary.slice(0, 600) : '',
    question: outcome === 'needs_you' && typeof json.question === 'string' ? json.question.slice(0, 1000) : undefined,
  };
}

/** The failures `ios:verify` names on its last line, or null when it failed before the UI tests. */
export function parseIosFailures(output) {
  const line = output.split('\n').reverse().find((row) => row.startsWith('IOS_VERIFY_UI_FAILURES '));
  if (!line) return null;
  try {
    return JSON.parse(line.slice('IOS_VERIFY_UI_FAILURES '.length));
  } catch {
    return null;
  }
}

/** Failures that aren't also failing on master. "*" (a run that named no tests) always counts. */
export function newFailures(branch, base) {
  const result = {};
  for (const [device, tests] of Object.entries(branch ?? {})) {
    const known = new Set(base?.[device] ?? []);
    const fresh = tests.filter((test) => test === '*' || !known.has(test));
    if (fresh.length) result[device] = fresh;
  }
  return result;
}

export function failedTestNames(failures) {
  return [...new Set(Object.values(failures ?? {}).flat())];
}

// MARK: Builds

/** How many master commits the inbox publishes, so a build made by hand can find itself. */
export const LOG_LENGTH = 60;

/** Code that ships in the app, as opposed to tests, docs and tooling. */
export function isAppChange(files) {
  return files.some((file) => (file.startsWith('src/') || file.startsWith('apps/ios/') || file.startsWith('public/') || file === 'index.html')
    && !file.startsWith('src/test/') && !file.startsWith('apps/ios/AppUITests/') && !file.startsWith('apps/ios/DealKit/Tests/'));
}

/** Reads `git log --format=%x1e%h%x09%cI%x09%s --name-only`. */
export function parseGitLog(output) {
  return output.split('\x1e').filter((chunk) => chunk.trim()).map((chunk) => {
    const [header, ...rest] = chunk.split('\n');
    const [commit, at, ...subject] = header.split('\t');
    return { commit, at, subject: subject.join('\t'), files: rest.map((line) => line.trim()).filter(Boolean) };
  });
}

/**
 * The build to offer: the newest commit that changed the app, plus the recent log the apps use to
 * place themselves and list what's new. Null when nothing in the log changed the app.
 */
export function buildFromLog(entries, reports, pendingReports) {
  const byCommit = new Map();
  for (const [id, status] of Object.entries(reports ?? {})) {
    for (const commit of status.commits ?? []) byCommit.set(commit.slice(0, 7), id);
  }
  const log = entries.map((entry) => ({
    commit: entry.commit,
    at: entry.at,
    subject: entry.subject.slice(0, 160),
    app: isAppChange(entry.files),
    report: byCommit.get(entry.commit.slice(0, 7)),
  }));
  const newest = log.find((entry) => entry.app);
  if (!newest) return null;
  return { commit: newest.commit, committedAt: newest.at, reports: pendingReports, log };
}

// MARK: Live progress

const fileName = (path) => (typeof path === 'string' ? path.split('/').pop() : '') || 'a file';

/** The command a shell line runs, skipping `FOO=bar` and paths. */
function commandOf(line) {
  const words = String(line ?? '').trim().split(/\s+/).filter((word) => !/^[A-Z_][A-Z0-9_]*=/.test(word));
  const name = (words[0] ?? '').split('/').pop();
  if (name === 'npm' && words[1] === 'run' && /^[\w:.-]+$/.test(words[2] ?? '')) return `Running npm run ${words[2]}`;
  if ((name === 'npx' && words[1] === 'vitest') || name === 'vitest') return 'Running tests';
  if (name === 'git') return 'Using git';
  if (/^[\w.-]+$/.test(name)) return `Running ${name}`;
  return 'Running a command';
}

const TOOL_STEPS = {
  Read: (input) => `Reading ${fileName(input.file_path)}`,
  Edit: (input) => `Editing ${fileName(input.file_path)}`,
  MultiEdit: (input) => `Editing ${fileName(input.file_path)}`,
  Write: (input) => `Writing ${fileName(input.file_path)}`,
  NotebookEdit: (input) => `Editing ${fileName(input.notebook_path)}`,
  Bash: (input) => commandOf(input.command),
  Grep: () => 'Searching the code',
  Glob: () => 'Searching the code',
  Task: () => 'Asking a helper agent',
  Agent: () => 'Asking a helper agent',
  TodoWrite: () => 'Planning',
  WebFetch: () => 'Looking something up',
  WebSearch: () => 'Looking something up',
};

/**
 * One line on what the fix session is doing, from a `stream-json` event. Only the action and a
 * file or command name: never arguments, file contents or output.
 */
export function stepFromEvent(event) {
  if (event?.type !== 'assistant') return null;
  const uses = (event.message?.content ?? []).filter((part) => part?.type === 'tool_use');
  const last = uses.at(-1);
  if (!last) return null;
  const describe = TOOL_STEPS[last.name];
  return describe ? describe(last.input ?? {}) : 'Working';
}

/** Passes on the latest step at most once per interval. `tick` sends one that was held back. */
export function makeThrottle(write, intervalMs, now = Date.now) {
  let lastAt = -Infinity;
  let latest = null;
  let sent = null;
  const flush = () => {
    if (latest === null || latest === sent || now() - lastAt < intervalMs) return;
    lastAt = now();
    sent = latest;
    write(latest);
  };
  return {
    push(step) {
      latest = step;
      flush();
    },
    tick: flush,
  };
}

/** Paths a fix must never commit: copied-in reports hold screenshots, and the repo is public. */
export function forbiddenPaths(changedFiles) {
  return changedFiles.filter((file) => file === '.feedback' || file.startsWith('.feedback/'));
}
