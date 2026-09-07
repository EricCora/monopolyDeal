/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readProjectFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('PWA install contracts', () => {
  it('publishes a standalone manifest with install icons', () => {
    const manifest = JSON.parse(readProjectFile('public/manifest.webmanifest')) as {
      display?: string;
      start_url?: string;
      icons?: Array<{ sizes?: string; purpose?: string }>;
    };

    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    expect(manifest.icons?.some((icon) => icon.sizes === '192x192')).toBe(true);
    expect(manifest.icons?.some((icon) => icon.sizes === '512x512')).toBe(true);
    expect(manifest.icons?.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('provides iPhone install metadata and registers the worker only in production', () => {
    const html = readProjectFile('index.html');
    const main = readProjectFile('src/main.tsx');

    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(main).toContain("'serviceWorker' in navigator && import.meta.env.PROD");
    expect(main).toContain("navigator.serviceWorker.register('/sw.js')");
  });

  it('keeps live multiplayer traffic out of the offline cache', () => {
    const worker = readProjectFile('public/sw.js');

    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("url.pathname.startsWith('/socket.io/')");
  });
});
