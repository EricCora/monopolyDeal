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
  const impactful = new Set(['deal_breaker', 'forced_deal', 'sly_deal', 'rent_target', 'pay', 'payment', 'counter', 'action', 'property']);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (impactful.has(event.type)) {
      return event.message;
    }
  }
  if (events.length === 0) return 'No key swing captured this match.';
  return events[events.length - 1].message;
}

export function buildPostGameSummary(state: GameState, lifetimeStats: LifetimeStatsV1): PostGameSummary {
  const ranked = rankPlayers(state);
  const winner = state.players.find((player) => player.id === state.winnerId);

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
    finalSwing: finalSwingMessage(state.history),
    players,
    recentEvents: state.history.slice(-6).reverse(),
  };
}
