// The source of the turn-by-turn room function. `npm run build:turn-api` bundles it into
// api/turn-rooms.js, because Vercel Functions can't run the engine's extensionless imports.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BlobNotFoundError, BlobPreconditionFailedError, del, get, head, put } from '@vercel/blob';
import webpush from 'web-push';
import { handleTurnRoomRequest, type TurnRoomNotifier, type TurnRoomStore } from '../apps/server/src/turnRooms.ts';
import type { MultiplayerRoom } from '../apps/server/src/gameService.ts';

const MAX_BODY_BYTES = 64 * 1024;

const pathname = (code: string) => `turn-rooms/${code}.json`;

const blobStore: TurnRoomStore = {
  async load(code, how = 'for_write') {
    // The tag has to come from `head`: after an overwrite, the one on `get` is refused by `ifMatch`.
    // Reading it first is safe, because a newer room in between just makes the save retry.
    let version = '';
    if (how === 'for_write') {
      try {
        version = (await head(pathname(code))).etag;
      } catch (error) {
        if (error instanceof BlobNotFoundError) return null;
        throw error;
      }
    }
    const result = await get(pathname(code), { access: 'private', useCache: how === 'cached' });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    return { room: JSON.parse(text) as MultiplayerRoom, version };
  },
  async save(room, version) {
    try {
      await put(pathname(room.code), JSON.stringify(room), {
        access: 'private',
        addRandomSuffix: false,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        ...(version === null ? { allowOverwrite: false } : { allowOverwrite: true, ifMatch: version }),
      });
      return true;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) return false;
      // A new room's code was already taken.
      if (version === null && error instanceof Error && /already exists/i.test(error.message)) return false;
      throw error;
    }
  },
  async remove(code) {
    try {
      await del(pathname(code));
    } catch (error) {
      if (!(error instanceof BlobNotFoundError)) throw error;
    }
  },
};

const publicKey = process.env.TURN_PUSH_PUBLIC_KEY ?? null;
const privateKey = process.env.TURN_PUSH_PRIVATE_KEY ?? null;

const notifier: TurnRoomNotifier = {
  publicKey: publicKey && privateKey ? publicKey : null,
  async send(subscription, notification) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(notification), {
        TTL: 24 * 60 * 60,
        vapidDetails: {
          subject: process.env.TURN_PUSH_SUBJECT ?? 'https://monopoly-deal-smoky.vercel.app',
          publicKey: publicKey as string,
          privateKey: privateKey as string,
        },
      });
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      // A failed send shouldn't lose the move that caused it.
      return status !== 404 && status !== 410;
    }
  },
};

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
    res.end(JSON.stringify(json));
  };
  try {
    const url = new URL(req.url ?? '/', 'https://turn.local');
    // vercel.json passes the rest of the path as ?path=api/multiplayer/rooms/...
    const rest = url.searchParams.get('path') ?? url.pathname.replace(/^\/api\/turn/, '').replace(/^\//, '');
    const query = Object.fromEntries(url.searchParams.entries());
    delete query.path;
    const result = await handleTurnRoomRequest({
      method: req.method ?? 'GET',
      path: `/${rest}`,
      query,
      body: req.method === 'POST' ? await readBody(req) : {},
    }, blobStore, notifier);
    send(result.status, result.json);
  } catch (error) {
    console.error('[turn_rooms] request failed', error);
    send(500, { error: 'server_error' });
  }
}
