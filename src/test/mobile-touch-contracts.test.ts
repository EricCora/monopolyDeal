/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/base.css'), 'utf8');
const setupCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/screens/setup.css'), 'utf8');
const layoutCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/components/layout.css'), 'utf8');

describe('mobile/touch layout contracts', () => {
  it('keeps core form controls at a touch-friendly minimum height', () => {
    expect(baseCss).toMatch(/input,\s*select\s*{[\s\S]*min-height:\s*44px;/);
    expect(baseCss).toMatch(/button\s*{[\s\S]*min-height:\s*44px;/);
  });

  it('keeps multiplayer action controls full-width on narrow screens', () => {
    expect(setupCss).toMatch(
      /@media\s*\(max-width:\s*620px\)\s*{[\s\S]*\.multiplayer-room-actions button,\s*[\s\S]*\.multiplayer-lobby-legal-actions button,\s*[\s\S]*\.multiplayer-ready-actions button\s*{[\s\S]*flex:\s*1 1 100%;/,
    );
  });

  it('keeps chat dock within viewport on phone breakpoints', () => {
    expect(layoutCss).toMatch(
      /@media\s*\(max-width:\s*720px\)\s*{[\s\S]*\.multiplayer-chat-dock\s*{[\s\S]*left:\s*0\.65rem;[\s\S]*right:\s*0\.65rem;[\s\S]*width:\s*auto;/,
    );
  });

  it('brings the main table surface ahead of the sidebar stack on narrow layouts', () => {
    expect(layoutCss).toMatch(
      /@media\s*\(max-width:\s*1120px\)\s*{[\s\S]*\.game-table-main\s*{[\s\S]*order:\s*1;[\s\S]*}[\s\S]*\.game-table-left-stack\s*{[\s\S]*order:\s*2;/,
    );
  });
});
