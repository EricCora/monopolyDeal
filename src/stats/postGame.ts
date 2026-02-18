import { getCardDefinition, type PropertyColor } from '../cards/catalog';
import { getSetCompletionCount, type GameEvent, type GameState, type PlayerState } from '../engine';
import type { LifetimeStatsV1 } from './types';

export interface PostGamePlayerRow {
  playerId: string;
  name: string;
  rank: number;
  isWinner: boolean;
  completeSets: number;
  bankValue: number;
  propertyCardCount: number;
  handCount: number;
  totalCardValue: number;
  lifetimeWins: number;
  lifetimeGamesPlayed: number;
}

export interface PostGameSummary {
  winnerId?: string;
  winnerName?: string;
  endedAt: number;
  turnCount: number;
  durationSec: number;
  totalEvents: number;
  finalSwing: string;
  winningMove: string;
  momentumShift: string;
  highlightCards: string[];
  players: PostGamePlayerRow[];
  recentEvents: GameEvent[];
}

interface RankedPlayer {
  player: PlayerState;
  completeSets: number;
  bankValue: number;
  propertyCardCount: number;
  handCount: number;
  totalCardValue: number;
}

interface EventSelection {
  event: GameEvent | null;
  index: number;
}

const IMPACTFUL_EVENT_TYPES = new Set([
  'deal_breaker',
  'forced_deal',
  'sly_deal',
  'rent_target',
  'pay',
  'payment',
  'counter',
  'action',
  'property',
  'wild_move',
  'bank',
]);

const CARD_LABEL_ALIAS: Record<string, string> = {
  'deal breaker': 'Deal Breaker',
  'forced deal': 'Forced Deal',
  'sly deal': 'Sly Deal',
  'debt collector': 'Debt Collector',
  'its my birthday': "It's My Birthday",
  'pass go': 'Pass Go',
  'double rent': 'Double Rent',
  'just say no': 'Just Say No',
  rent: 'Rent',
  house: 'House',
  hotel: 'Hotel',
};

function normalizeAliasKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCardLabel(label: string): string | null {
  const cleaned = label.replace(/\s+/g, ' ').trim().replace(/[.!,:;]+$/, '');
  if (!cleaned) return null;
  const alias = CARD_LABEL_ALIAS[normalizeAliasKey(cleaned)];
  return alias ?? cleaned;
}

function isImpactfulEvent(event: GameEvent): boolean {
  return IMPACTFUL_EVENT_TYPES.has(event.type);
}

function addCardMention(target: string[], seen: Set<string>, label: string): void {
  const normalized = normalizeCardLabel(label);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  target.push(normalized);
}

function extractCardMentions(message: string): string[] {
  const mentions: string[] = [];
  const seen = new Set<string>();

  const played = message.match(/played (.+?)(?: and| on| for| at|\.|$)/i);
  if (played?.[1]) addCardMention(mentions, seen, played[1]);

  const banked = message.match(/banked (.+?)\./i);
  if (banked?.[1]) addCardMention(mentions, seen, banked[1]);

  const placed = message.match(/placed (.+?) in /i);
  if (placed?.[1]) addCardMention(mentions, seen, placed[1]);

  const moved = message.match(/moved (.+?) to /i);
  if (moved?.[1]) addCardMention(mentions, seen, moved[1]);

  const took = message.match(/took (.+?) from /i);
  if (took?.[1]) addCardMention(mentions, seen, took[1]);

  const swapped = message.match(/swapped (.+?) for (.+?)\./i);
  if (swapped?.[1]) addCardMention(mentions, seen, swapped[1]);
  if (swapped?.[2]) addCardMention(mentions, seen, swapped[2]);

  const paymentReason = message.match(/\((.+)\)/);
  if (paymentReason?.[1]) addCardMention(mentions, seen, paymentReason[1]);

  if (/charged .* rent/i.test(message) || /played rent/i.test(message)) {
    addCardMention(mentions, seen, 'Rent');
  }

  return mentions;
}

function cardMoneyValue(cardId: string): number {
  const definition = getCardDefinition(cardId);
  return definition.moneyValue ?? definition.value;
}

function totalZoneValue(cardIds: string[]): number {
  return cardIds.reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0);
}

function countPropertyCards(player: PlayerState): number {
  return (Object.keys(player.properties) as PropertyColor[]).reduce(
    (sum, color) => sum + player.properties[color].length,
    0,
  );
}

function totalPropertyValue(player: PlayerState): number {
  return (Object.keys(player.properties) as PropertyColor[]).reduce(
    (sum, color) => sum + totalZoneValue(player.properties[color].map((card) => card.cardId)),
    0,
  );
}

function rankPlayers(state: GameState): RankedPlayer[] {
  const ranked = state.players.map((player) => {
    const completeSets = getSetCompletionCount(player);
    const bankValue = totalZoneValue(player.bank);
    const propertyCardCount = countPropertyCards(player);
    const handCount = player.hand.length;
    const totalCardValue = bankValue + totalPropertyValue(player) + totalZoneValue(player.hand);
    return {
      player,
      completeSets,
      bankValue,
      propertyCardCount,
      handCount,
      totalCardValue,
    };
  });

  ranked.sort((left, right) => {
    if (right.completeSets !== left.completeSets) return right.completeSets - left.completeSets;
    if (right.bankValue !== left.bankValue) return right.bankValue - left.bankValue;
    if (right.propertyCardCount !== left.propertyCardCount) return right.propertyCardCount - left.propertyCardCount;
    if (left.handCount !== right.handCount) return left.handCount - right.handCount;
    return left.player.name.localeCompare(right.player.name);
  });

  return ranked;
}

function finalSwingMessage(events: GameEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isImpactfulEvent(event)) {
      return event.message;
    }
  }
  if (events.length === 0) return 'No key swing captured this match.';
  return events[events.length - 1].message;
}

function selectWinningMoveEvent(events: GameEvent[], winnerName?: string): EventSelection {
  const trimmedWinner = winnerName?.trim();
  if (trimmedWinner) {
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!isImpactfulEvent(event)) continue;
      if (event.message.includes(trimmedWinner)) return { event, index };
    }
  }

  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (isImpactfulEvent(event)) return { event, index };
  }

  if (events.length === 0) return { event: null, index: -1 };
  return { event: events[events.length - 1], index: events.length - 1 };
}

function selectMomentumShiftEvent(events: GameEvent[], winningMoveIndex: number): GameEvent | null {
  const maxIndex = winningMoveIndex >= 0 ? Math.min(winningMoveIndex - 1, events.length - 1) : events.length - 1;
  for (let index = maxIndex; index >= 0; index -= 1) {
    if (isImpactfulEvent(events[index])) return events[index];
  }
  if (winningMoveIndex >= 0 && winningMoveIndex < events.length) return events[winningMoveIndex];
  return events.length > 0 ? events[events.length - 1] : null;
}

function momentumShiftMessage(event: GameEvent | null, winnerName?: string): string {
  const actor = winnerName ?? 'The winner';
  if (!event) return `${actor} kept pressure up through the closing sequence.`;

  if (event.type === 'deal_breaker') return `${actor} flipped control by stealing a complete set.`;
  if (event.type === 'rent_target') return `${actor} converted board pressure into a major rent hit.`;
  if (event.type === 'action' && /debt collector/i.test(event.message)) return `${actor} forced a Debt Collector swing.`;
  if (event.type === 'action' && /rent/i.test(event.message)) return `${actor} set up the finishing rent sequence.`;
  if (event.type === 'property') return `${actor} locked in board position with a key property play.`;
  if (event.type === 'pay') return 'A high-value payment swung table economy right before the finish.';

  return event.message;
}

function highlightCards(events: GameEvent[], winningMoveEvent: GameEvent | null, momentumEvent: GameEvent | null): string[] {
  const orderedEvents: GameEvent[] = [];
  if (winningMoveEvent) orderedEvents.push(winningMoveEvent);
  if (momentumEvent && momentumEvent !== winningMoveEvent) orderedEvents.push(momentumEvent);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    orderedEvents.push(events[index]);
  }

  const highlights: string[] = [];
  const seen = new Set<string>();
  for (const event of orderedEvents) {
    const mentions = extractCardMentions(event.message);
    for (const mention of mentions) {
      if (seen.has(mention)) continue;
      seen.add(mention);
      highlights.push(mention);
      if (highlights.length >= 3) return highlights;
    }
  }

  return highlights;
}

export function buildPostGameSummary(state: GameState, lifetimeStats: LifetimeStatsV1): PostGameSummary {
  const ranked = rankPlayers(state);
  const winner = state.players.find((player) => player.id === state.winnerId);
  const winningMove = selectWinningMoveEvent(state.history, winner?.name);
  const momentumEvent = selectMomentumShiftEvent(state.history, winningMove.index);
  const fallbackSwing = finalSwingMessage(state.history);
  const winningMoveMessage = winningMove.event?.message ?? fallbackSwing;

  const players = ranked.map((entry, index) => {
    const lifetime = lifetimeStats.players[entry.player.name];
    return {
      playerId: entry.player.id,
      name: entry.player.name,
      rank: index + 1,
      isWinner: entry.player.id === state.winnerId,
      completeSets: entry.completeSets,
      bankValue: entry.bankValue,
      propertyCardCount: entry.propertyCardCount,
      handCount: entry.handCount,
      totalCardValue: entry.totalCardValue,
      lifetimeWins: lifetime?.wins ?? 0,
      lifetimeGamesPlayed: lifetime?.gamesPlayed ?? 0,
    };
  });

  return {
    winnerId: state.winnerId,
    winnerName: winner?.name,
    endedAt: state.updatedAt,
    turnCount: state.turnCount,
    durationSec: Math.max(1, Math.floor((state.updatedAt - state.createdAt) / 1000)),
    totalEvents: state.history.length,
    finalSwing: fallbackSwing,
    winningMove: winningMoveMessage,
    momentumShift: momentumShiftMessage(momentumEvent, winner?.name),
    highlightCards: highlightCards(state.history, winningMove.event, momentumEvent),
    players,
    recentEvents: state.history.slice(-6).reverse(),
  };
}
