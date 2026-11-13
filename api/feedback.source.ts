// The source of the problem-report function. `npm run build:turn-api` bundles it into
// api/feedback.js. Reports go to a private GitHub repo, not Vercel Blob, so they can't use up
// the Blob limits that turn rooms depend on.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleFeedbackRequest, type FeedbackStore } from '../apps/server/src/feedbackInbox.ts';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const BRANCH = 'main';

export function githubStore(repo: string, token: string, fetcher: typeof fetch = fetch): FeedbackStore {
  const api = async (path: string, init: RequestInit = {}, accept = 'application/vnd.github+json') => fetcher(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'monopolydeal-feedback',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const json = async (response: Response) => {
    if (!response.ok) throw new Error(`github ${response.status}: ${(await response.text()).slice(0, 200)}`);
    return response.json() as Promise<Record<string, unknown>>;
  };
  const encode = (path: string) => path.split('/').map(encodeURIComponent).join('/');

  return {
    async read(path) {
      const response = await api(`/contents/${encode(path)}?ref=${BRANCH}`, {}, 'application/vnd.github.raw+json');
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`github ${response.status}`);
      return response.text();
    },
    async list(dir) {
      const response = await api(`/contents/${encode(dir)}?ref=${BRANCH}`);
      if (response.status === 404) return [];
      const entries = await json(response) as unknown;
      return Array.isArray(entries) ? entries.map((entry: { name: string }) => entry.name) : [];
    },
    async create(files, message) {
      // One commit for all the files, retried if the watcher pushed in between.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const ref = await json(await api(`/git/ref/heads/${BRANCH}`));
        const parent = (ref.object as { sha: string }).sha;
        const parentCommit = await json(await api(`/git/commits/${parent}`));
        const tree = [];
        for (const file of files) {
          const blob = await json(await api('/git/blobs', {
            method: 'POST',
            body: JSON.stringify({ content: file.content, encoding: file.base64 ? 'base64' : 'utf-8' }),
          }));
          tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const newTree = await json(await api('/git/trees', {
          method: 'POST',
          body: JSON.stringify({ base_tree: (parentCommit.tree as { sha: string }).sha, tree }),
        }));
        const commit = await json(await api('/git/commits', {
          method: 'POST',
          body: JSON.stringify({ message, tree: newTree.sha, parents: [parent] }),
        }));
        const update = await api(`/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
        if (update.ok) return;
        if (update.status !== 422 && update.status !== 409) await json(update);
      }
      throw new Error('github: could not commit after retries');
    },
  };
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk as Uint8Array);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('body_too_large');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) as Record<string, unknown> : {};
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const send = (status: number, json: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Report-Key');
    res.end(JSON.stringify(json));
  };
  if (req.method === 'OPTIONS') {
    send(204, {});
    return;
  }
  try {
    const url = new URL(req.url ?? '/', 'https://feedback.local');
    // vercel.json passes the rest of the path as ?path=status, ?path=report and so on.
    const rest = url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/feedback/, '').replace(/^\//, '');
    const token = process.env.FEEDBACK_GITHUB_TOKEN;
    const repo = process.env.FEEDBACK_GITHUB_REPO ?? 'EricCora/monopolyDeal-feedback';
    if (!token) {
      send(503, { error: 'not_configured' });
      return;
    }
    const keyHeader = req.headers['x-report-key'];
    const result = await handleFeedbackRequest({
      method: req.method ?? 'GET',
      path: `/${rest}`,
      key: typeof keyHeader === 'string' ? keyHeader : null,
      body: req.method === 'POST' ? await readBody(req) : {},
    }, githubStore(repo, token), process.env.FEEDBACK_REPORT_KEY);
    send(result.status, result.json);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'body_too_large';
    if (!tooLarge) console.error('[feedback] request failed', error);
    send(tooLarge ? 413 : 500, { error: tooLarge ? 'too_large' : 'server_error' });
  }
}
