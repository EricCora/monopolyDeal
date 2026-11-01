import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Vercel deployment config', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    buildCommand: string;
    rewrites: Array<{ destination: string }>;
  };

  it('builds against the same backend its rewrites point at, whatever the dashboard says', () => {
    const backend = new URL(config.rewrites[0].destination).origin;
    expect(config.buildCommand).toContain(`VITE_MULTIPLAYER_API_URL=${backend}`);
  });
});
