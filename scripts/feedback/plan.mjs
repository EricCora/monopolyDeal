// Pure decisions for the report watcher, kept apart so they can be tested.

export const REPORT_ID = /^\d{8}-\d{6}-[a-z0-9]{4}$/;

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
  const stuck = Object.entries(index.reports).find(([, status]) => status.state === 'fixing');
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
  if (!['fixed', 'needs_you', 'failed'].includes(outcome)) return { outcome: 'failed', summary: 'The fix session ended without a result.' };
  return {
    outcome,
    summary: typeof json.summary === 'string' ? json.summary.slice(0, 600) : '',
    question: outcome === 'needs_you' && typeof json.question === 'string' ? json.question.slice(0, 1000) : undefined,
  };
}
