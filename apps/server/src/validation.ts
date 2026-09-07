import type { Action } from '../../../src/engine/index.ts';

const PROPERTY_COLORS = new Set([
  'brown',
  'light_blue',
  'pink',
  'orange',
  'red',
  'yellow',
  'green',
  'dark_blue',
  'railroad',
  'utility',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isPropertyColor(value: unknown): boolean {
  return typeof value === 'string' && PROPERTY_COLORS.has(value);
}

function isCardIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isNonEmptyTrimmedString(item));
}

export function isNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

export function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === 'number' && Number.isFinite(value));
}

export function optionalTrimmedString(value: unknown): string | undefined {
  if (!isNonEmptyTrimmedString(value)) return undefined;
  return value.trim();
}

export function isValidMultiplayerAction(value: unknown): value is Action {
  if (!isRecord(value)) return false;
  if (typeof value.type !== 'string') return false;
  if (!isNonEmptyTrimmedString(value.playerId)) return false;
  for (const field of ['setId', 'fromSetId', 'sourceSetId', 'giveSetId', 'takeSetId']) {
    if (value[field] !== undefined && !isNonEmptyTrimmedString(value[field])) return false;
  }

  if (value.type === 'draw_cards' || value.type === 'pass_turn') {
    return true;
  }

  if (value.type === 'play_to_bank' || value.type === 'discard_card') {
    return isNonEmptyTrimmedString(value.cardId);
  }

  if (value.type === 'play_property') {
    return isNonEmptyTrimmedString(value.cardId) && isPropertyColor(value.color);
  }

  if (value.type === 'move_wild') {
    return isNonEmptyTrimmedString(value.cardId)
      && isPropertyColor(value.fromColor)
      && isPropertyColor(value.toColor);
  }

  if (value.type === 'play_action') {
    if (!isNonEmptyTrimmedString(value.cardId)) return false;
    if (value.targetPlayerId !== undefined && !isNonEmptyTrimmedString(value.targetPlayerId)) return false;
    if (value.color !== undefined && !isPropertyColor(value.color)) return false;
    return true;
  }

  if (value.type === 'counter_response') {
    if (typeof value.useJustSayNo !== 'boolean') return false;
    if (value.cardId !== undefined && !isNonEmptyTrimmedString(value.cardId)) return false;
    return true;
  }

  if (value.type === 'pay_request') {
    return isCardIdList(value.cards);
  }

  if (value.type === 'sly_deal_pick') {
    return isNonEmptyTrimmedString(value.cardId)
      && isPropertyColor(value.sourceColor)
      && isPropertyColor(value.destinationColor);
  }

  if (value.type === 'forced_deal_pick') {
    return isNonEmptyTrimmedString(value.giveCardId)
      && isPropertyColor(value.giveColor)
      && isNonEmptyTrimmedString(value.takeCardId)
      && isPropertyColor(value.takeColor)
      && isPropertyColor(value.destinationColor);
  }

  if (value.type === 'deal_breaker_pick') {
    return isPropertyColor(value.color);
  }

  return false;
}
