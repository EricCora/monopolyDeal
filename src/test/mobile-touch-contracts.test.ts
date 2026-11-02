/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/base.css'), 'utf8');
const setupCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/screens/setup.css'), 'utf8');
const layoutCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/components/layout.css'), 'utf8');
const cardsCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/components/cards.css'), 'utf8');
const tableCss = readFileSync(resolve(process.cwd(), 'src/ui/theme/table.css'), 'utf8');

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
      /@media\s*\(max-width:\s*720px\)\s*{[\s\S]*\.multiplayer-chat-dock\s*{[\s\S]*left:\s*max\(0\.65rem,\s*env\(safe-area-inset-left\)\);[\s\S]*right:\s*max\(0\.65rem,\s*env\(safe-area-inset-right\)\);[\s\S]*width:\s*auto;/,
    );
  });

  it('keeps the whole table on screen, with the player\'s board and hand in reach on narrow layouts', () => {
    expect(tableCss).toMatch(/\.game-table-screen\s*{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*overflow:\s*hidden;/);
    expect(tableCss).toMatch(/grid-template-areas:\s*'opponents'\s*'status'\s*'board'\s*'actions'\s*'hand';/);
  });

  it('leaves touches on the hand to its gestures, so holding and sliding never scrolls the page', () => {
    expect(tableCss).toMatch(/\.hand-fan\s*{[\s\S]*touch-action:\s*none;/);
    expect(`${tableCss}${cardsCss}`).not.toMatch(/\.hand-fan[^{]*{[^}]*overflow-x:\s*auto/);
  });

  it('keeps the hand lane shrinkable so card overflow becomes scrollable instead of clipped', () => {
    expect(layoutCss).toMatch(/\.player-zone\s*{[\s\S]*min-width:\s*0;/);
    expect(cardsCss).toMatch(/\.hand-zone\s*{[\s\S]*min-width:\s*0;/);
    expect(cardsCss).toMatch(/\.hand-fan\s*{[\s\S]*width:\s*100%;[\s\S]*max-width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*box-sizing:\s*border-box;/);
  });
});
