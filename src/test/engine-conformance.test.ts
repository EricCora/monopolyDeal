import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playTrace, traceConfigs, TRACE_VERSION, type TraceGame } from './fixtures/engineTrace';

const fixture = JSON.parse(readFileSync(resolve('apps/ios/DealKit/Tests/DealKitTests/Fixtures/engine-traces.json'), 'utf8')) as {
  version: number;
  games: TraceGame[];
};

/**
 * The iOS engine is checked against these recordings. A rule change fails here until
 * `npm run traces:record` updates them, and then `npm run ios:verify` fails until the
 * Swift engine matches. A sample of the games keeps this quick; iOS replays all of them.
 */
describe('recorded engine traces', () => {
  it('cover every configured game', () => {
    expect(fixture.version).toBe(TRACE_VERSION);
    expect(fixture.games.map(({ variant, mode, seed, players, ruleset }) => ({ variant, mode, seed, players, ...(ruleset ? { ruleset } : {}) })))
      .toEqual(traceConfigs());
  });

  it('still match the TypeScript engine', () => {
    const sample = fixture.games.filter((_, index) => index % 10 === 0);
    for (const recorded of sample) {
      const { variant, mode, seed, players, ruleset } = recorded;
      expect(playTrace({ variant, mode, seed, players, ruleset })).toEqual(recorded);
    }
  }, 120_000);
});
