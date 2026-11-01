import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyAction,
  createGame,
  getLegalActions,
  isGameOver,
  type Action,
  type GameState,
  type PlayerState,
} from '../engine';
import { CARD_DEFINITIONS } from '../cards/catalog';
import { loadActiveGame, saveActiveGame } from '../persistence/storage';
import { replayStateFingerprint } from '../replay/serialize';

/**
 * No Mercy is deliberately tested through the public engine API.  These
 * narrow structural types let this contract file land before the production
 * variant types do, while still making the expected persisted shape explicit.
 */
type DebtRecord = {
  creditorPlayerId: string;
  chipId: string;
};

type VariantPlayer = PlayerState & {
  debtsOwed?: DebtRecord[];
};

type VariantState = GameState & {
  variant?: 'classic' | 'no_mercy';
};

type CardLike = {
  id: string;
  name: string;
  kind: string;
  value: number;
  moneyValue?: number;
  color?: string;
  colors?: string[];
  actionKind?: string;
  rentMatrix?: Record<string, number[]>;
  quantity: number;
};

type CatalogModule = typeof import('../cards/catalog') & {
  NO_MERCY_CARD_DEFINITIONS?: CardLike[];
};

import * as cardCatalog from '../cards/catalog';
const catalog = cardCatalog as CatalogModule;

function noMercyDefinitions(): CardLike[] {
  const definitions = catalog.NO_MERCY_CARD_DEFINITIONS;
  if (!definitions) throw new Error('NO_MERCY_CARD_DEFINITIONS has not been implemented yet.');
  return definitions;
}

function card(definition: CardLike, suffix: string): string {
  return `${definition.id}#${suffix}`;
}

function noMercyCard(predicate: (definition: CardLike) => boolean, label: string): CardLike {
  const definition = noMercyDefinitions().find(predicate);
  if (!definition) throw new Error(`No Mercy catalog is missing ${label}.`);
  return definition;
}

function cardNameMatches(definition: CardLike, expression: RegExp): boolean {
  return expression.test(definition.name);
}

function quantityOf(predicate: (definition: CardLike) => boolean): number {
  return noMercyDefinitions()
    .filter(predicate)
    .reduce((total, definition) => total + definition.quantity, 0);
}

function player(state: GameState, id: string): VariantPlayer {
  const result = state.players.find((entry) => entry.id === id);
  if (!result) throw new Error(`Missing player ${id}.`);
  return result as VariantPlayer;
}

function noMercyState(playerCount = 2): GameState {
  return createGame({
    seed: 7301,
    variant: 'no_mercy',
    players: Array.from({ length: playerCount }, (_, index) => ({
      id: `p${index + 1}`,
      name: `Player ${index + 1}`,
    })),
  } as Parameters<typeof createGame>[0]);
}

function prepareActionTurn(state: GameState, currentPlayerIndex = 0): void {
  state.currentPlayerIndex = currentPlayerIndex;
  state.turn.phase = 'action';
  state.turn.playsUsed = 0;
  state.turn.doubleRentMultiplier = 1;
  state.turn.endingTurn = false;
  state.pending = null;
}

function actionAsAction(input: object): Action {
  return input as Action;
}

function moneyCard(value: number, suffix: string): string {
  const definition = noMercyCard(
    (candidate) => candidate.kind === 'money' && (candidate.moneyValue ?? candidate.value) === value,
    `$${value} money card`,
  );
  return card(definition, suffix);
}

function propertyCard(color: string, suffix: string): string {
  const definition = noMercyCard(
    (candidate) => candidate.kind === 'property' && candidate.color === color,
    `${color} property card`,
  );
  return card(definition, suffix);
}

function firstRentColor(definition: CardLike): string {
  const color = Object.keys(definition.rentMatrix ?? {})[0];
  if (!color) throw new Error(`${definition.name} has no rent color.`);
  return color;
}

/** Build an intentionally underfunded No Mercy rent payment. */
function underfundedRentState(): { state: GameState; rentCardId: string; color: string } {
  const state = noMercyState();
  prepareActionTurn(state);
  const rentDefinition = noMercyCard(
    (candidate) => candidate.kind === 'action'
      && /^rent/i.test(candidate.name)
      && !/^rent \(any color\)/i.test(candidate.name),
    'a Rent card',
  );
  const color = firstRentColor(rentDefinition);
  const rentCardId = card(rentDefinition, 'rent-underfunded');
  const source = player(state, 'p1');
  const target = player(state, 'p2');
  source.hand = [rentCardId];
  source.properties[color as keyof typeof source.properties] = [
    { cardId: propertyCard(color, 'source-a'), assignedColor: color as keyof typeof source.properties },
    { cardId: propertyCard(color, 'source-b'), assignedColor: color as keyof typeof source.properties },
  ];
  target.hand = [];
  target.bank = [moneyCard(1, 'target-one')];
  return { state, rentCardId, color };
}

function resolveOptionalRentTarget(state: GameState, rentCardId: string): GameState {
  if (state.pending?.kind !== 'rent') return state;
  return applyAction(state, actionAsAction({
    type: 'play_action',
    playerId: 'p1',
    cardId: rentCardId,
    targetPlayerId: 'p2',
  })).state;
}

function declineCounter(state: GameState, playerId: string): GameState {
  return applyAction(state, {
    type: 'counter_response',
    playerId,
    useJustSayNo: false,
  }).state;
}

describe('No Mercy variant and deck contracts', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults new and legacy-compatible games to Classic', () => {
    const state = createGame({
      seed: 7302,
      players: [
        { id: 'p1', name: 'Player 1' },
        { id: 'p2', name: 'Player 2' },
      ],
    }) as VariantState;
    expect(state.variant).toBe('classic');

    const legacy = structuredClone(state) as Partial<VariantState> & { version: 1 };
    delete legacy.variant;
    localStorage.setItem('monopolyDeal.activeGame.v1', JSON.stringify({
      version: 1,
      timestamp: Date.now(),
      gameState: legacy,
    }));

    expect((loadActiveGame()?.gameState as VariantState | undefined)?.variant).toBe('classic');
  });

  it('keeps the Classic catalog intact and uses an independent 115-card No Mercy deck', () => {
    expect(CARD_DEFINITIONS.reduce((total, definition) => total + definition.quantity, 0)).toBe(106);

    const definitions = noMercyDefinitions();
    expect(definitions.reduce((total, definition) => total + definition.quantity, 0)).toBe(115);
    expect(quantityOf((definition) => definition.kind === 'money')).toBe(18);
    expect(quantityOf((definition) => definition.kind === 'property')).toBe(28);
    expect(quantityOf((definition) => definition.kind === 'wild')).toBe(11);

    expect(quantityOf((definition) => /^rent(?! \(any color\))/i.test(definition.name))).toBe(5);
    expect(quantityOf((definition) => /^double rent(?! \(any color\))/i.test(definition.name))).toBe(5);
    expect(quantityOf((definition) => /^rent \(any color\)$/i.test(definition.name))).toBe(3);
    expect(quantityOf((definition) => /^double rent \(any color\)$/i.test(definition.name))).toBe(3);

    const expectedUniqueCards: Array<[RegExp, number]> = [
      [/^Deal Breaker$/i, 3],
      [/^Forced Debt$/i, 3],
      [/^Go Again$/i, 3],
      [/^Heist$/i, 3],
      [/^Just Say No$/i, 5],
      [/^Market Crash$/i, 3],
      [/^Pass Go,? Go Go!?$/i, 4],
      [/^Repossession$/i, 2],
      [/^Shack$/i, 3],
      [/^Super Sly Deal$/i, 3],
      [/^Tax Collector$/i, 2],
      [/^Tough Luck$/i, 3],
      [/^Unfair Trade$/i, 2],
      [/^Yoink!?$/i, 3],
    ];
    for (const [expression, quantity] of expectedUniqueCards) {
      expect(quantityOf((definition) => cardNameMatches(definition, expression))).toBe(quantity);
    }

    const moneyValues = definitions
      .filter((definition) => definition.kind === 'money')
      .map((definition) => definition.moneyValue ?? definition.value);
    expect(moneyValues).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 10, 15]));
    expect(quantityOf((definition) => definition.kind === 'money' && (definition.moneyValue ?? definition.value) === 10)).toBe(1);
    expect(quantityOf((definition) => definition.kind === 'money' && (definition.moneyValue ?? definition.value) === 15)).toBe(1);
  });

  it('selects the No Mercy deck and preserves deterministic deck identity by seed', () => {
    const first = noMercyState(3) as VariantState;
    const second = noMercyState(3) as VariantState;
    expect(first.variant).toBe('no_mercy');
    expect(first.drawPile).toEqual(second.drawPile);
    expect(first.drawPile.length).toBe(115 - (3 * 5));
    expect(first.drawPile.every((instanceId) => noMercyDefinitions().some((definition) => instanceId.startsWith(`${definition.id}#`)))).toBe(true);
  });

  it('preserves the empty-hand draw-five rule for both variants', () => {
    const classic = createGame({
      seed: 7305,
      players: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }],
    });
    classic.players[0].hand = [];
    classic.currentPlayerIndex = 0;
    classic.turn.phase = 'draw';
    const classicDraw = applyAction(classic, { type: 'draw_cards', playerId: 'p1' });
    expect(classicDraw.state.players[0].hand).toHaveLength(5);

    const noMercy = noMercyState();
    noMercy.players[0].hand = [];
    noMercy.currentPlayerIndex = 0;
    noMercy.turn.phase = 'draw';
    const noMercyDraw = applyAction(noMercy, { type: 'draw_cards', playerId: 'p1' });
    expect(noMercyDraw.state.players[0].hand).toHaveLength(5);
  });

  it('treats No Mercy Double Rent as a standalone global rent card', () => {
    const state = noMercyState();
    prepareActionTurn(state);
    const definition = noMercyCard(
      (candidate) => candidate.actionKind === 'double_rent'
        && Boolean(candidate.rentMatrix)
        && !/^double rent \(any color\)$/i.test(candidate.name),
      'a two-color Double Rent card',
    );
    const doubleRentId = card(definition, 'double-rent');
    const source = player(state, 'p1');
    const target = player(state, 'p2');
    source.hand = [doubleRentId];
    source.properties.brown = [
      { cardId: propertyCard('brown', 'source-a'), assignedColor: 'brown' },
      { cardId: propertyCard('brown', 'source-b'), assignedColor: 'brown' },
    ];
    target.bank = [moneyCard(5, 'target-five')];

    const legal = getLegalActions(state, 'p1').filter((item) => item.action.type === 'play_action' && item.action.cardId === doubleRentId);
    expect(legal.some((item) => item.action.type === 'play_action' && item.action.color === 'brown')).toBe(true);
    let next = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: doubleRentId, color: 'brown' }).state;
    expect(next.pending?.kind).toBe('counter');
    next = declineCounter(next, 'p2');
    expect(next.pending?.kind).toBe('payment');
    const paid = applyAction(next, { type: 'pay_request', playerId: 'p2', cards: ['money_5#target-five'] });
    expect(paid.error).toBeUndefined();
    expect(player(paid.state, 'p1').bank).toContain('money_5#target-five');
  });
});

describe('No Mercy debt contracts', () => {
  it('creates one debt record after transferring all available payment', () => {
    const { state, rentCardId, color } = underfundedRentState();
    let next = applyAction(state, {
      type: 'play_action',
      playerId: 'p1',
      cardId: rentCardId,
      color: color as never,
    }).state;
    next = resolveOptionalRentTarget(next, rentCardId);
    if (next.pending?.kind === 'counter') next = declineCounter(next, 'p2');

    expect(next.pending?.kind).toBe('payment');
    const paid = applyAction(next, {
      type: 'pay_request',
      playerId: 'p2',
      cards: [moneyCard(1, 'target-one')],
    });
    expect(paid.error).toBeUndefined();
    expect(player(paid.state, 'p1').bank).toContain(moneyCard(1, 'target-one'));
    expect(player(paid.state, 'p2').debtsOwed).toHaveLength(1);
    expect(player(paid.state, 'p2').debtsOwed?.[0].creditorPlayerId).toBe('p1');
    expect(player(paid.state, 'p2').debtsOwed?.[0].chipId).toBeTruthy();
    expect(paid.state.pending).toBeNull();
  });

  it('does not issue a fourth debt chip when the debtor has exhausted the physical limit', () => {
    const { state, rentCardId, color } = underfundedRentState();
    player(state, 'p2').debtsOwed = [
      { creditorPlayerId: 'p1', chipId: 'p2-chip-1' },
      { creditorPlayerId: 'p1', chipId: 'p2-chip-2' },
      { creditorPlayerId: 'p1', chipId: 'p2-chip-3' },
    ];
    let next = applyAction(state, {
      type: 'play_action',
      playerId: 'p1',
      cardId: rentCardId,
      color: color as never,
    }).state;
    next = resolveOptionalRentTarget(next, rentCardId);
    if (next.pending?.kind === 'counter') next = declineCounter(next, 'p2');
    expect(next.pending?.kind).toBe('payment');

    const paid = applyAction(next, {
      type: 'pay_request',
      playerId: 'p2',
      cards: [moneyCard(1, 'target-one')],
    });
    expect(paid.error).toBeUndefined();
    expect(player(paid.state, 'p2').debtsOwed).toHaveLength(3);
    expect(paid.state.pending).toBeNull();
  });

  it('opens repayment after draw, resolves a hand card into the creditor bank, and consumes one play', () => {
    const state = noMercyState();
    prepareActionTurn(state, 1);
    state.turn.phase = 'draw';
    const debtor = player(state, 'p2');
    debtor.hand = [moneyCard(2, 'repayment')];
    debtor.debtsOwed = [{ creditorPlayerId: 'p1', chipId: 'p2-chip-1' }];

    const drawn = applyAction(state, { type: 'draw_cards', playerId: 'p2' });
    expect(drawn.error).toBeUndefined();
    const repayment = getLegalActions(drawn.state, 'p2').find((entry) => entry.action.type === 'repay_debt');
    expect(repayment).toBeDefined();
    if (!repayment) return;

    const result = applyAction(drawn.state, repayment.action);
    expect(result.error).toBeUndefined();
    expect(player(result.state, 'p2').debtsOwed).toEqual([]);
    expect(player(result.state, 'p2').hand).not.toContain(moneyCard(2, 'repayment'));
    const resolved = result.state.pending?.kind === 'debt_card'
      ? applyAction(result.state, { type: 'resolve_debt_card', playerId: 'p1', debtId: result.state.pending.payload.debtId, cardId: moneyCard(2, 'repayment'), mode: 'bank' }).state
      : result.state;
    expect(player(resolved, 'p1').bank).toContain(moneyCard(2, 'repayment'));
    expect(resolved.turn.playsUsed).toBe(1);
  });

  it('counts debt repayment against the normal three-play allowance', () => {
    const state = noMercyState();
    prepareActionTurn(state, 1);
    state.turn.phase = 'debt';
    const debtor = player(state, 'p2');
    debtor.hand = [moneyCard(2, 'repayment'), moneyCard(1, 'play-one'), moneyCard(1, 'play-two'), moneyCard(1, 'play-three')];
    debtor.debtsOwed = [{ creditorPlayerId: 'p1', chipId: 'p2-chip-1' }];

    const repayment = applyAction(state, actionAsAction({
      type: 'repay_debt',
      playerId: 'p2',
      cardId: moneyCard(2, 'repayment'),
      creditorPlayerId: 'p1',
      chipId: 'p2-chip-1',
    }));
    expect(repayment.error).toBeUndefined();
    expect(repayment.state.turn.playsUsed).toBe(1);
    let next = applyAction(repayment.state, { type: 'play_to_bank', playerId: 'p2', cardId: moneyCard(1, 'play-one') });
    next = applyAction(next.state, { type: 'play_to_bank', playerId: 'p2', cardId: moneyCard(1, 'play-two') });
    const fourth = applyAction(next.state, { type: 'play_to_bank', playerId: 'p2', cardId: moneyCard(1, 'play-three') });
    expect(fourth.error?.code).toBe('illegal_play_limit');
  });

  it('lets a creditor immediately play a received action card, except Go Again which must be banked', () => {
    const state = noMercyState();
    prepareActionTurn(state, 1);
    state.turn.phase = 'debt';
    const debtCard = noMercyCard((candidate) => /^Pass Go,? Go Go!?$/i.test(candidate.name), 'Pass Go, Go Go!');
    const debtCardId = card(debtCard, 'received-action');
    const debtor = player(state, 'p2');
    const creditor = player(state, 'p1');
    debtor.hand = [debtCardId];
    debtor.debts = [{ id: 'p2-chip-1', chipId: 'p2-chip-1', debtorPlayerId: 'p2', creditorPlayerId: 'p1' }];
    creditor.debtChipsHeld = [{ id: 'p2-chip-1', chipId: 'p2-chip-1', debtorPlayerId: 'p2', creditorPlayerId: 'p1' }];

    const repayment = applyAction(state, { type: 'repay_debt', playerId: 'p2', debtId: 'p2-chip-1', cardId: debtCardId });
    expect(repayment.error).toBeUndefined();
    expect(repayment.state.pending?.kind).toBe('debt_card');
    if (repayment.state.pending?.kind !== 'debt_card') return;
    const immediate = getLegalActions(repayment.state, 'p1').find((entry) => (
      entry.action.type === 'resolve_debt_card' && entry.action.mode === 'action'
    ));
    expect(immediate).toBeDefined();
    if (!immediate) return;
    const resolved = applyAction(repayment.state, immediate.action);
    expect(resolved.error).toBeUndefined();
    expect(resolved.state.pending).toBeNull();
    expect(resolved.state.turn.phase).toBe('action');
    expect(creditor.bank).not.toContain(debtCardId);
    expect(resolved.state.discardPile).toContain(debtCardId);
  });
});

describe('No Mercy global effects and property contracts', () => {
  it('gives each target an independent Just Say No opportunity for a global effect', () => {
    const state = noMercyState(3);
    prepareActionTurn(state);
    const heist = noMercyCard((candidate) => /^Heist$/i.test(candidate.name), 'Heist');
    const justSayNo = noMercyCard((candidate) => /^Just Say No$/i.test(candidate.name), 'Just Say No');
    const heistId = card(heist, 'heist');
    const p2BankCard = moneyCard(3, 'p2-bank');
    const p3BankCard = moneyCard(4, 'p3-bank');
    player(state, 'p1').hand = [heistId];
    player(state, 'p2').hand = [card(justSayNo, 'p2-jsn')];
    player(state, 'p3').hand = [];
    player(state, 'p2').bank = [p2BankCard];
    player(state, 'p3').bank = [p3BankCard];

    let next = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: heistId });
    expect(next.error).toBeUndefined();
    expect(next.state.pending?.kind).toBe('counter');
    if (next.state.pending?.kind !== 'counter') return;
    expect(next.state.pending.payload.targetPlayerId).toBe('p2');

    next = applyAction(next.state, {
      type: 'counter_response',
      playerId: 'p2',
      useJustSayNo: true,
      cardId: card(justSayNo, 'p2-jsn'),
    });
    expect(next.error).toBeUndefined();
    expect(next.state.pending?.kind).toBe('counter');
    if (next.state.pending?.kind !== 'counter') return;
    expect(next.state.pending.payload.awaitingPlayerId).toBe('p1');

    const afterSourceDecline = declineCounter(next.state, 'p1');
    expect(afterSourceDecline.pending?.kind).toBe('counter');
    if (afterSourceDecline.pending?.kind !== 'counter') return;
    expect(afterSourceDecline.pending.payload.targetPlayerId).toBe('p3');

    const resolved = declineCounter(afterSourceDecline, 'p3');
    let finalState = resolved;
    if (resolved.pending?.kind === 'no_mercy') {
      const pick = getLegalActions(resolved, 'p1').find((entry) => entry.action.type === 'no_mercy_pick' && entry.action.cardId === p3BankCard);
      expect(pick).toBeDefined();
      if (pick) finalState = applyAction(resolved, pick.action).state;
    }
    expect(finalState.pending).toBeNull();
    expect(player(finalState, 'p2').bank).toContain(p2BankCard);
    expect(player(finalState, 'p3').bank).not.toContain(p3BankCard);
    expect(player(finalState, 'p1').bank).toContain(p3BankCard);
  });

  it('keeps a Shack attached to its physical set when Deal Breaker transfers that set', () => {
    const state = noMercyState();
    prepareActionTurn(state, 1);
    const shack = noMercyCard((candidate) => /^Shack$/i.test(candidate.name), 'Shack');
    const dealBreaker = noMercyCard((candidate) => /^Deal Breaker$/i.test(candidate.name), 'Deal Breaker');
    const setId = 'brown-set-with-shack';
    const p1 = player(state, 'p1');
    const p2 = player(state, 'p2');
    p1.properties.brown = [
      { cardId: propertyCard('brown', 'set-a'), assignedColor: 'brown', setId },
      { cardId: propertyCard('brown', 'set-b'), assignedColor: 'brown', setId },
      { cardId: card(shack, 'attached'), assignedColor: 'brown', setId },
    ];
    p2.hand = [card(dealBreaker, 'breaker')];

    let next = applyAction(state, {
      type: 'play_action',
      playerId: 'p2',
      cardId: card(dealBreaker, 'breaker'),
      targetPlayerId: 'p1',
    });
    expect(next.error).toBeUndefined();
    if (next.state.pending?.kind === 'counter') next = applyAction(next.state, {
      type: 'counter_response', playerId: 'p1', useJustSayNo: false,
    });
    expect(next.state.pending?.kind).toBe('deal_breaker');
    next = applyAction(next.state, {
      type: 'deal_breaker_pick', playerId: 'p2', color: 'brown', setId,
    });
    expect(next.error).toBeUndefined();
    expect(player(next.state, 'p2').properties.brown.map((entry) => entry.cardId)).toEqual(expect.arrayContaining([
      propertyCard('brown', 'set-a'), propertyCard('brown', 'set-b'), card(shack, 'attached'),
    ]));
    const transferred = player(next.state, 'p2').properties.brown.filter((entry) => entry.cardId.startsWith(`${shack.id}#`));
    expect(transferred).toHaveLength(1);
    expect(transferred[0].setId).toBeTruthy();
    expect(player(next.state, 'p1').properties.brown).toHaveLength(0);
  });

  it('allows only one Shack on a completed physical set', () => {
    const state = noMercyState();
    prepareActionTurn(state);
    const shack = noMercyCard((candidate) => /^Shack$/i.test(candidate.name), 'Shack');
    const p1 = player(state, 'p1');
    const setId = 'brown-complete';
    p1.hand = [card(shack, 'first'), card(shack, 'second')];
    p1.properties.brown = [
      { cardId: propertyCard('brown', 'a'), assignedColor: 'brown', setId },
      { cardId: propertyCard('brown', 'b'), assignedColor: 'brown', setId },
    ];

    const first = getLegalActions(state, 'p1').find((entry) => entry.action.type === 'play_property' && entry.action.cardId === card(shack, 'first'));
    expect(first).toBeDefined();
    if (!first) return;
    const placed = applyAction(state, first.action);
    expect(placed.error).toBeUndefined();
    expect(getLegalActions(placed.state, 'p1').some((entry) => entry.action.type === 'play_property' && entry.action.cardId === card(shack, 'second'))).toBe(false);
  });

  it('swaps entire Banks for Unfair Trade', () => {
    const state = noMercyState();
    prepareActionTurn(state);
    const unfairTrade = noMercyCard((candidate) => /^Unfair Trade$/i.test(candidate.name), 'Unfair Trade');
    const unfairTradeId = card(unfairTrade, 'unfair');
    const p1 = player(state, 'p1');
    const p2 = player(state, 'p2');
    p1.hand = [unfairTradeId];
    p1.bank = [moneyCard(1, 'p1-bank')];
    p2.bank = [moneyCard(5, 'p2-bank')];

    let next = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: unfairTradeId, targetPlayerId: 'p2' });
    expect(next.error).toBeUndefined();
    if (next.state.pending?.kind === 'counter') next = applyAction(next.state, { type: 'counter_response', playerId: 'p2', useJustSayNo: false });
    expect(player(next.state, 'p1').bank).toEqual([moneyCard(5, 'p2-bank')]);
    expect(player(next.state, 'p2').bank).toEqual([moneyCard(1, 'p1-bank')]);
    expect(next.state.pending).toBeNull();
  });

  it('lets the targeted player redistribute Tax Collector cards', () => {
    const state = noMercyState();
    prepareActionTurn(state);
    const taxCollector = noMercyCard((candidate) => /^Tax Collector$/i.test(candidate.name), 'Tax Collector');
    const taxCollectorId = card(taxCollector, 'tax');
    const p1 = player(state, 'p1');
    const p2 = player(state, 'p2');
    p1.hand = [taxCollectorId];
    p2.hand = [];
    p2.bank = [moneyCard(1, 'tax-a'), moneyCard(2, 'tax-b'), moneyCard(3, 'tax-c')];

    let next = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: taxCollectorId, targetPlayerId: 'p2' });
    if (next.state.pending?.kind === 'counter') next = applyAction(next.state, { type: 'counter_response', playerId: 'p2', useJustSayNo: false });
    expect(next.state.pending?.kind).toBe('no_mercy');
    if (next.state.pending?.kind !== 'no_mercy') return;
    const keep = getLegalActions(next.state, 'p2').find((entry) => entry.action.type === 'no_mercy_pick' && entry.action.cardId === moneyCard(3, 'tax-c'));
    expect(keep).toBeDefined();
    if (!keep) return;
    next = applyAction(next.state, keep.action);
    while (next.state.pending?.kind === 'no_mercy') {
      const give = getLegalActions(next.state, 'p2').find((entry) => entry.action.type === 'no_mercy_pick' && entry.action.recipientPlayerId === 'p1');
      expect(give).toBeDefined();
      if (!give) return;
      next = applyAction(next.state, give.action);
    }
    expect(next.error).toBeUndefined();
    expect(player(next.state, 'p2').bank).toEqual([moneyCard(3, 'tax-c')]);
    expect(player(next.state, 'p1').bank).toEqual(expect.arrayContaining([moneyCard(1, 'tax-a'), moneyCard(2, 'tax-b')]));
  });

  it('redistributes Repossession properties through the target player and keeps buildings with parents', () => {
    const state = noMercyState();
    prepareActionTurn(state);
    const repossession = noMercyCard((candidate) => /^Repossession$/i.test(candidate.name), 'Repossession');
    const shack = noMercyCard((candidate) => /^Shack$/i.test(candidate.name), 'Shack');
    const repossessionId = card(repossession, 'repo');
    const p1 = player(state, 'p1');
    const p2 = player(state, 'p2');
    p1.hand = [repossessionId];
    p2.hand = [];
    p2.properties.brown = [
      { cardId: propertyCard('brown', 'repo-a'), assignedColor: 'brown', setId: 'repo-set' },
      { cardId: propertyCard('brown', 'repo-b'), assignedColor: 'brown', setId: 'repo-set' },
      { cardId: card(shack, 'repo-shack'), assignedColor: 'brown', setId: 'repo-set', attachedToCardId: propertyCard('brown', 'repo-b') },
    ];

    let next = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: repossessionId, targetPlayerId: 'p2' });
    if (next.state.pending?.kind === 'counter') next = applyAction(next.state, { type: 'counter_response', playerId: 'p2', useJustSayNo: false });
    expect(next.state.pending?.kind).toBe('no_mercy');
    if (next.state.pending?.kind !== 'no_mercy') return;
    const keep = getLegalActions(next.state, 'p2').find((entry) => entry.action.type === 'no_mercy_pick' && entry.action.cardId === propertyCard('brown', 'repo-a'));
    expect(keep).toBeDefined();
    if (!keep) return;
    next = applyAction(next.state, keep.action);
    while (next.state.pending?.kind === 'no_mercy') {
      const give = getLegalActions(next.state, 'p2').find((entry) => entry.action.type === 'no_mercy_pick' && entry.action.recipientPlayerId === 'p1');
      expect(give).toBeDefined();
      if (!give) return;
      next = applyAction(next.state, give.action);
    }
    expect(next.error).toBeUndefined();
    expect(player(next.state, 'p2').properties.brown.map((entry) => entry.cardId)).toEqual([propertyCard('brown', 'repo-a')]);
    expect(player(next.state, 'p1').properties.brown.map((entry) => entry.cardId)).toEqual(expect.arrayContaining([propertyCard('brown', 'repo-b'), card(shack, 'repo-shack')]));
    const movedShack = player(next.state, 'p1').properties.brown.find((entry) => entry.cardId === card(shack, 'repo-shack'));
    const movedBase = player(next.state, 'p1').properties.brown.find((entry) => entry.cardId === propertyCard('brown', 'repo-b'));
    expect(movedShack?.setId).toBe(movedBase?.setId);
  });
  it('lets Super Sly Deal take a selected color from every opponent, including complete sets and Wilds', () => {
    const state = noMercyState(3);
    prepareActionTurn(state);
    const superSly = noMercyCard((candidate) => /^Super Sly Deal$/i.test(candidate.name), 'Super Sly Deal');
    const superSlyId = card(superSly, 'super-sly');
    player(state, 'p1').hand = [superSlyId];
    player(state, 'p2').properties.green = [
      { cardId: propertyCard('green', 'p2-a'), assignedColor: 'green', setId: 'p2-green' },
      { cardId: propertyCard('green', 'p2-b'), assignedColor: 'green', setId: 'p2-green' },
      { cardId: propertyCard('green', 'p2-c'), assignedColor: 'green', setId: 'p2-green' },
    ];
    player(state, 'p3').properties.green = [{ cardId: card(noMercyCard((candidate) => candidate.id === 'wild_blue_green', 'two-color Wild'), 'wild'), assignedColor: 'green' }];
    let next = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: superSlyId, color: 'green' });
    expect(next.error).toBeUndefined();
    next = applyAction(next.state, { type: 'counter_response', playerId: 'p2', useJustSayNo: false });
    next = applyAction(next.state, { type: 'counter_response', playerId: 'p3', useJustSayNo: false });
    expect(next.error).toBeUndefined();
    expect(player(next.state, 'p1').properties.green.map((entry) => entry.cardId)).toEqual(expect.arrayContaining([
      'green_1#p2-a', 'green_1#p2-b', 'green_1#p2-c', 'wild_blue_green#wild',
    ]));
  });

  it('keeps Tough Luck hand choices hidden while transferring only the requested type', () => {
    const state = noMercyState();
    prepareActionTurn(state);
    const toughLuck = noMercyCard((candidate) => /^Tough Luck$/i.test(candidate.name), 'Tough Luck');
    const toughLuckId = card(toughLuck, 'tough');
    player(state, 'p1').hand = [toughLuckId];
    player(state, 'p2').hand = [moneyCard(3, 'money'), propertyCard('brown', 'property'), card(noMercyCard((candidate) => candidate.id === 'heist', 'Heist'), 'action')];
    let next = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: toughLuckId, targetPlayerId: 'p2' });
    next = applyAction(next.state, { type: 'counter_response', playerId: 'p2', useJustSayNo: false });
    const choices = getLegalActions(next.state, 'p1').filter((entry) => entry.action.type === 'no_mercy_pick');
    expect(choices.map((entry) => (entry.action.type === 'no_mercy_pick' ? entry.action.choice : undefined))).toEqual(expect.arrayContaining(['property', 'money', 'action']));
    const result = applyAction(next.state, { type: 'no_mercy_pick', playerId: 'p1', actionCardId: toughLuckId, targetPlayerId: 'p2', choice: 'property' });
    expect(result.error).toBeUndefined();
    expect(player(result.state, 'p1').hand).toContain(propertyCard('brown', 'property'));
    expect(player(result.state, 'p2').hand).toEqual(expect.arrayContaining([moneyCard(3, 'money'), card(noMercyCard((candidate) => candidate.id === 'heist', 'Heist'), 'action')]));
  });

  it('persists variant/debt state and changes deterministic replay fingerprints', () => {
    const state = noMercyState();
    player(state, 'p2').debts = [{ id: 'p2-chip-1', chipId: 'p2-chip-1', debtorPlayerId: 'p2', creditorPlayerId: 'p1', amount: 4 }];
    saveActiveGame(state);
    const loaded = loadActiveGame();
    expect(loaded?.gameState.variant).toBe('no_mercy');
    expect(loaded?.gameState.players[1].debts?.[0].creditorPlayerId).toBe('p1');
    const classic = createGame({ seed: 7301, players: [{ id: 'p1', name: 'Player 1' }, { id: 'p2', name: 'Player 2' }] });
    expect(replayStateFingerprint(state)).not.toBe(replayStateFingerprint(classic));
  });
});

describe('No Mercy turn and Wild contracts', () => {
  it('starts a fresh draw phase for the same player after Go Again', () => {
    const state = noMercyState();
    prepareActionTurn(state);
    const goAgain = noMercyCard((candidate) => /^Go Again$/i.test(candidate.name), 'Go Again');
    const goAgainId = card(goAgain, 'go-again');
    player(state, 'p1').hand = [goAgainId];

    const result = applyAction(state, { type: 'play_action', playerId: 'p1', cardId: goAgainId });
    expect(result.error).toBeUndefined();
    expect(result.state.currentPlayerIndex).toBe(0);
    expect(result.state.turn.phase).toBe('draw');
    expect(result.state.turn.playsUsed).toBe(0);
    expect(getLegalActions(result.state, 'p1').map((entry) => entry.action.type)).toContain('draw_cards');
  });

  it('does not let the No Mercy every-color Wild complete a set by itself or pay a debt', () => {
    const state = noMercyState();
    prepareActionTurn(state);
    const allColorWild = noMercyCard(
      (candidate) => candidate.kind === 'wild' && (candidate.colors?.length ?? 0) > 4,
      'every-color Wild',
    );
    const allColorWildId = card(allColorWild, 'all-color');
    player(state, 'p1').hand = [allColorWildId];

    const placed = applyAction(state, {
      type: 'play_property', playerId: 'p1', cardId: allColorWildId, color: 'brown',
    });
    expect(placed.error).toBeUndefined();
    expect(isGameOver(placed.state).done).toBe(false);
    expect(placed.state.players[0].properties.brown).toHaveLength(1);

    const payer = player(placed.state, 'p2');
    payer.properties.brown = [{ cardId: allColorWildId, assignedColor: 'brown' }];
    placed.state.pending = {
      kind: 'payment',
      payload: {
        sourcePlayerId: 'p1',
        targetPlayerId: 'p2',
        amount: 1,
        reason: 'Wild restriction contract',
        actionCardId: 'rent-contract#1',
      },
    };
    const payment = applyAction(placed.state, {
      type: 'pay_request', playerId: 'p2', cards: [allColorWildId],
    });
    expect(payment.error?.code).toBe('invalid_action');
    expect(player(payment.state, 'p2').properties.brown).toEqual([{ cardId: allColorWildId, assignedColor: 'brown' }]);
  });
});
