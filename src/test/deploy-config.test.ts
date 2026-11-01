import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Vercel deployment config', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    buildCommand: string;
    rewrites: Array<{ source: string; destination: string }>;
  };

  it('builds against the same backend its rewrites point at, whatever the dashboard says', () => {
    const backend = new URL(config.rewrites.find((rule) => rule.source.startsWith('/api/'))!.destination).origin;
    expect(config.buildCommand).toContain(`VITE_MULTIPLAYER_API_URL=${backend}`);
  });

  it('serves the app for invite links, which only the client knows how to route', () => {
    expect(config.rewrites).toContainEqual({ source: '/join/:roomCode', destination: '/index.html' });
  });
});
