import type { PropertyColor } from '../cards/catalog';

export type PlayerId = string;
export type ZoneType = 'hand' | 'bank' | 'property';

export interface PlayerConfig {
  id: PlayerId;
  name: string;
}

export interface GameConfig {
  players: PlayerConfig[];
  seed?: number;
  deckVersion?: 'v1';
}

export interface PropertyCardPlacement {
  cardId: string;
  assignedColor: PropertyColor;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  hand: string[];
  bank: string[];
  properties: Record<PropertyColor, PropertyCardPlacement[]>;
}

export type TurnPhase = 'draw' | 'action' | 'finished';

export interface TurnState {
  phase: TurnPhase;
  playsUsed: number;
  doubleRentMultiplier: number;
}

export interface GameEvent {
  timestamp: number;
  type: string;
  message: string;
}

export interface PaymentRequest {
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  amount: number;
  reason: string;
  actionCardId: string;
  remainingTargetPlayerIds?: PlayerId[];
}

export interface CounterRequest {
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  actionCardId: string;
  effect: PendingEffect;
  chain: { playerId: PlayerId; cardId: string }[];
  awaitingPlayerId: PlayerId;
}

export interface PendingSlyDeal {
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  actionCardId: string;
}

export interface PendingForcedDeal {
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  actionCardId: string;
}

export interface PendingDealBreaker {
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  actionCardId: string;
}

export interface PendingRent {
  sourcePlayerId: PlayerId;
  actionCardId: string;
  color: PropertyColor;
  amount: number;
}

export type PendingEffect =
  | { kind: 'payment'; payload: PaymentRequest }
  | { kind: 'sly_deal'; payload: PendingSlyDeal }
  | { kind: 'forced_deal'; payload: PendingForcedDeal }
  | { kind: 'deal_breaker'; payload: PendingDealBreaker }
  | { kind: 'rent'; payload: PendingRent };

export type PendingInteraction =
  | { kind: 'counter'; payload: CounterRequest }
  | { kind: 'payment'; payload: PaymentRequest }
  | { kind: 'sly_deal'; payload: PendingSlyDeal }
  | { kind: 'forced_deal'; payload: PendingForcedDeal }
  | { kind: 'deal_breaker'; payload: PendingDealBreaker }
  | { kind: 'rent'; payload: PendingRent };

export interface GameState {
  version: 1;
  createdAt: number;
  updatedAt: number;
  deckVersion: 'v1';
  players: PlayerState[];
  drawPile: string[];
  discardPile: string[];
  currentPlayerIndex: number;
  turn: TurnState;
  pending: PendingInteraction | null;
  history: GameEvent[];
  winnerId?: PlayerId;
  turnCount: number;
}

export type RuleErrorCode =
  | 'invalid_phase'
  | 'invalid_turn'
  | 'invalid_action'
  | 'invalid_target'
  | 'illegal_play_limit'
  | 'insufficient_cards'
  | 'unresolved_pending'
  | 'unknown_card';

export interface RuleError {
  code: RuleErrorCode;
  message: string;
}

export type Action =
  | { type: 'draw_cards'; playerId: PlayerId }
  | { type: 'pass_turn'; playerId: PlayerId }
  | { type: 'play_to_bank'; playerId: PlayerId; cardId: string }
  | { type: 'play_property'; playerId: PlayerId; cardId: string; color: PropertyColor }
  | { type: 'move_wild'; playerId: PlayerId; cardId: string; fromColor: PropertyColor; toColor: PropertyColor }
  | { type: 'play_action'; playerId: PlayerId; cardId: string; targetPlayerId?: PlayerId; color?: PropertyColor }
  | { type: 'counter_response'; playerId: PlayerId; useJustSayNo: boolean; cardId?: string }
  | { type: 'pay_request'; playerId: PlayerId; cards: string[] }
  | { type: 'sly_deal_pick'; playerId: PlayerId; cardId: string; sourceColor: PropertyColor; destinationColor: PropertyColor }
  | { type: 'forced_deal_pick'; playerId: PlayerId; giveCardId: string; giveColor: PropertyColor; takeCardId: string; takeColor: PropertyColor; destinationColor: PropertyColor }
  | { type: 'deal_breaker_pick'; playerId: PlayerId; color: PropertyColor };

export interface LegalAction {
  label: string;
  action: Action;
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  error?: RuleError;
}

export interface TurnPrompt {
  playerId: PlayerId;
  text: string;
  kind: 'draw' | 'main' | 'response' | 'payment' | 'selection';
}
