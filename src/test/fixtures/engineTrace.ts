import { rankHeuristicActions } from '../../ai/heuristic';
import { getCardDefinition } from '../../cards/catalog';
import { applyAction, createGame, getLegalActions, getNextPrompt, isGameOver, type GameState, type GameVariant, type LegalAction, type RulesetV1 } from '../../engine';

/**
 * Plays seeded games and reduces each to a chain of hashes. The Swift engine in
 * apps/ios/DealKit replays the same games and must produce the same hashes, so a
 * rule change here fails until both engines agree. See DECISIONS.md.
 */
export const TRACE_VERSION = 2;
const CHECKPOINT_EVERY = 10;
const MAX_STEPS = 6000;
const GAMES_PER_VARIANT = { random: 400, bot: 100 };

export type TraceMode = 'random' | 'bot';

export interface TraceGameConfig {
  variant: GameVariant;
  mode: TraceMode;
  seed: number;
  players: number;
  ruleset?: Partial<RulesetV1>;
}

export interface TraceGame extends TraceGameConfig {
  steps: number;
  winnerId: string | null;
  checkpoints: string[];
  /**
   * Bot games only: the option chosen at each step. A value below zero means the
   * chosen option is -(value + 1) and the top pick can't be compared across engines,
   * because It's My Birthday scores NaN in `rankHeuristicActions`. See DECISIONS.md.
   */
  picks?: number[];
}

export function traceConfigs(): TraceGameConfig[] {
  const configs: TraceGameConfig[] = [];
  for (const variant of ['classic', 'no_mercy'] as const) {
    for (const mode of ['random', 'bot'] as const) {
      for (let index = 0; index < GAMES_PER_VARIANT[mode]; index += 1) {
        const players = 2 + (index % 4);
        let ruleset: Partial<RulesetV1> | undefined;
        if (variant === 'classic' && index % 5 === 3) ruleset = { winCompleteSets: 2 };
        if (variant === 'classic' && index % 5 === 4) ruleset = { maxPlaysPerTurn: 4, maxHandAtEndTurn: 5 };
        configs.push({ variant, mode, seed: index * 37 + 11 + (mode === 'bot' ? 5000 : 0), players, ...(ruleset ? { ruleset } : {}) });
      }
    }
  }
  return configs;
}

/** JSON with sorted keys and without clock values, so both engines can produce it. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (key === 'createdAt' || key === 'updatedAt' || key === 'history' || key === 'timestamp') continue;
      if (source[key] !== undefined) sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

function fnv1a(hash: number, text: string): number {
  let next = hash;
  for (const byte of Buffer.from(text, 'utf8')) {
    next ^= byte;
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next;
}

/** Everything one step exposes: state, new events, prompt, and the legal actions. */
export function stepText(state: GameState, eventsFrom: number): string {
  const prompt = getNextPrompt(state);
  const legal = getLegalActions(state, prompt.playerId);
  const counts = state.players.map((player) => getLegalActions(state, player.id).length);
  return [
    canonicalJson(state),
    canonicalJson(state.history.slice(eventsFrom)),
    canonicalJson(prompt),
    canonicalJson(legal),
    // Key order is part of the protocol: the server compares these strings.
    legal.map((entry) => JSON.stringify(entry.action)).join('\n'),
    counts.join(','),
  ].join('\n');
}

function fuzzRandom(seed: number): () => number {
  let current = seed;
  return () => {
    current = (current * 1664525 + 1013904223) >>> 0;
    return current / 2 ** 32;
  };
}

function birthdayIsLegal(state: GameState, options: LegalAction[]): boolean {
  return options.some((option) => option.action.type === 'play_action'
    && getCardDefinition(option.action.cardId, state.variant ?? 'classic').actionKind === 'its_my_birthday');
}

/** The option a bot game plays: the prompted player's top heuristic choice. */
function botChoice(state: GameState, options: LegalAction[], playerId: string): number {
  const top = rankHeuristicActions(state, playerId, options)[0];
  const wanted = JSON.stringify(top.action);
  return options.findIndex((option) => JSON.stringify(option.action) === wanted);
}

export function playTrace(config: TraceGameConfig, onStep?: (step: number, text: string) => void): TraceGame {
  const random = fuzzRandom(config.seed);
  let state = createGame({
    seed: config.seed,
    variant: config.variant,
    ruleset: config.ruleset,
    players: Array.from({ length: config.players }, (_, index) => ({ id: `p${index + 1}`, name: `P${index + 1}` })),
  });
  let hash = 2166136261;
  let eventsFrom = 0;
  const checkpoints: string[] = [];
  const picks: number[] = [];
  let steps = 0;

  for (;;) {
    const text = stepText(state, eventsFrom);
    onStep?.(steps, text);
    hash = fnv1a(hash, text);
    eventsFrom = state.history.length;
    if (steps % CHECKPOINT_EVERY === 0) checkpoints.push(hash.toString(36));
    if (isGameOver(state).done || steps >= MAX_STEPS) break;

    let choice: LegalAction;
    if (config.mode === 'bot') {
      const prompt = getNextPrompt(state);
      const options = getLegalActions(state, prompt.playerId);
      if (options.length === 0) throw new Error(`soft-lock at step ${steps} of seed ${config.seed}`);
      const index = botChoice(state, options, prompt.playerId);
      picks.push(birthdayIsLegal(state, options) ? -(index + 1) : index);
      choice = options[index];
    } else {
      const options = state.players.flatMap((player) => getLegalActions(state, player.id));
      if (options.length === 0) throw new Error(`soft-lock at step ${steps} of seed ${config.seed}`);
      const preferred = options.filter((option) => option.action.type !== 'pass_turn' && option.action.type !== 'move_wild');
      const pool = preferred.length > 0 && random() < 0.9 ? preferred : options;
      choice = pool[Math.floor(random() * pool.length)];
    }
    const result = applyAction(state, choice.action);
    if (result.error) throw new Error(`legal action rejected at step ${steps} of seed ${config.seed}: ${result.error.message}`);
    state = result.state;
    steps += 1;
  }

  return {
    ...config,
    steps,
    winnerId: state.winnerId ?? null,
    checkpoints: [...checkpoints, hash.toString(36)],
    ...(config.mode === 'bot' ? { picks } : {}),
  };
}
