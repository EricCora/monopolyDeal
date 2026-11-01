import { formatPropertyColor, getCardDisplayName, type PropertyColor } from '../../cards/catalog';
import type { GameState } from '../../engine';

export interface PendingRequestBanner {
  title: string;
  detail: string;
  tone: 'payment' | 'selection' | 'response';
}

function colorLabel(color: PropertyColor): string {
  return formatPropertyColor(color);
}

export function pendingRequestBanner(game: GameState, playerId: string): PendingRequestBanner | null {
  const pending = game.pending;
  if (!pending) return null;

  if (pending.kind === 'payment' && pending.payload.targetPlayerId === playerId) {
    const sourceName = game.players.find((player) => player.id === pending.payload.sourcePlayerId)?.name ?? 'Another player';
    return {
      title: 'Payment Requested',
      detail: `${sourceName} is requesting $${pending.payload.amount} for ${pending.payload.reason}. Select cards from bank and properties to submit payment.`,
      tone: 'payment',
    };
  }

  if (pending.kind === 'counter' && pending.payload.awaitingPlayerId === playerId) {
    const sourceName = game.players.find((player) => player.id === pending.payload.sourcePlayerId)?.name ?? 'Another player';
    return {
      title: 'Counter Response Needed',
      detail: `${sourceName} played ${getCardDisplayName(pending.payload.actionCardId, game.variant ?? 'classic')}. Choose your response to continue.`,
      tone: 'response',
    };
  }

  if (pending.kind === 'rent' && pending.payload.sourcePlayerId === playerId) {
    return {
      title: 'Rent Target Required',
      detail: `Choose who pays $${pending.payload.amount} for ${colorLabel(pending.payload.color)} rent.`,
      tone: 'selection',
    };
  }

  if (pending.kind === 'sly_deal' && pending.payload.sourcePlayerId === playerId) {
    const targetName = game.players.find((player) => player.id === pending.payload.targetPlayerId)?.name ?? 'target player';
    return {
      title: 'Steal a Property',
      detail: `Pick one movable property from ${targetName}.`,
      tone: 'selection',
    };
  }

  if (pending.kind === 'forced_deal' && pending.payload.sourcePlayerId === playerId) {
    const targetName = game.players.find((player) => player.id === pending.payload.targetPlayerId)?.name ?? 'target player';
    return {
      title: 'Swap Required',
      detail: `Pick one of your properties, then a property from ${targetName} to complete the swap.`,
      tone: 'selection',
    };
  }

  if (pending.kind === 'deal_breaker' && pending.payload.sourcePlayerId === playerId) {
    const targetName = game.players.find((player) => player.id === pending.payload.targetPlayerId)?.name ?? 'target player';
    return {
      title: 'Choose Set to Steal',
      detail: `Pick a complete set to steal from ${targetName}.`,
      tone: 'selection',
    };
  }

  if (pending.kind === 'debt_card' && pending.payload.creditorPlayerId === playerId) {
    return {
      title: 'Debt Card Received',
      detail: 'Resolve the received card into your Bank, collection, or immediate action before the debtor continues.',
      tone: 'selection',
    };
  }

  if (pending.kind === 'no_mercy') {
    const req = pending.payload;
    const actorId = req.step === 'heist_pick' || req.step === 'market_crash_pick' || req.step === 'tough_luck_choice'
      ? req.sourcePlayerId : req.targetPlayerId;
    if (actorId === playerId) {
      return {
        title: 'No Mercy Selection',
        detail: req.step?.endsWith('_distribute')
          ? 'Choose which player receives the next redistributed card.'
          : 'Resolve the highlighted No Mercy effect to continue.',
        tone: 'selection',
      };
    }
  }

  return null;
}
