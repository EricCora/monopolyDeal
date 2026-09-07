import type { PropertyColor } from '../cards/catalog';

export type PlayerId = string;
export type ZoneType = 'hand' | 'bank' | 'property';
export type PlayerController = 'human' | 'bot';
export type BotDifficulty = 'easy' | 'hard';

export interface PlayerConfig {
  id: PlayerId;
  name: string;
  controller?: PlayerController;
  botDifficulty?: BotDifficulty;
}

export interface GameConfig {
  players: PlayerConfig[];
  seed?: number;
  deckVersion?: 'v1';
  ruleset?: Partial<RulesetV1>;
}

export interface RulesetV1 {
  winCompleteSets: number;
  maxHandAtEndTurn: number;
  maxPlaysPerTurn: number;
}

export interface PropertyCardPlacement {
  cardId: string;
  assignedColor: PropertyColor;
  /** Stable membership for one physical property set. Omitted in legacy v1 snapshots. */
  setId?: string;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  controller?: PlayerController;
  botDifficulty?: BotDifficulty;
  hand: string[];
  bank: string[];
  properties: Record<PropertyColor, PropertyCardPlacement[]>;
}

export type TurnPhase = 'draw' | 'action' | 'finished';

export interface TurnState {
  phase: TurnPhase;
  playsUsed: number;
  doubleRentMultiplier: number;
  endingTurn?: boolean;
}

export interface GameEvent {
  timestamp: number;
  type: string;
  message: string;
  details?: GameEventDetails;
}

export interface PropertyStealEventDetails {
  kind: 'property_steal';
  sourcePlayerId: PlayerId;
  targetPlayerId: PlayerId;
  cardIds: string[];
  mode: 'sly_deal' | 'forced_deal' | 'deal_breaker';
}

export interface DrawEventDetails {
  kind: 'draw';
  playerId: PlayerId;
  count: number;
  reason: 'turn_draw' | 'pass_go' | 'effect';
}

export type GameEventDetails = PropertyStealEventDetails | DrawEventDetails;

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
  ruleset?: RulesetV1;
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
  | 'hand_limit'
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
  | { type: 'play_property'; playerId: PlayerId; cardId: string; color: PropertyColor; setId?: string }
  | { type: 'move_wild'; playerId: PlayerId; cardId: string; fromColor: PropertyColor; toColor: PropertyColor; fromSetId?: string; setId?: string }
  | { type: 'play_action'; playerId: PlayerId; cardId: string; targetPlayerId?: PlayerId; color?: PropertyColor }
  | { type: 'discard_card'; playerId: PlayerId; cardId: string }
  | { type: 'counter_response'; playerId: PlayerId; useJustSayNo: boolean; cardId?: string }
  | { type: 'pay_request'; playerId: PlayerId; cards: string[] }
  | { type: 'sly_deal_pick'; playerId: PlayerId; cardId: string; sourceColor: PropertyColor; destinationColor: PropertyColor; sourceSetId?: string; setId?: string }
  | { type: 'forced_deal_pick'; playerId: PlayerId; giveCardId: string; giveColor: PropertyColor; takeCardId: string; takeColor: PropertyColor; destinationColor: PropertyColor; giveSetId?: string; takeSetId?: string; setId?: string }
  | { type: 'deal_breaker_pick'; playerId: PlayerId; color: PropertyColor; setId?: string };

export interface LegalAction {
  label: string;
  action: Action;
  targetPlayerId?: PlayerId;
  requestedAmount?: number;
  collectibleCap?: number;
  requiresPropertyTransfer?: boolean;
  requiresConfirmation?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  previewText?: string;
}

export interface ApplyResult {
  state: GameState;
  events: GameEvent[];
  error?: RuleError;
}

export interface TurnPrompt {
  playerId: PlayerId;
  text: string;
  kind: 'draw' | 'main' | 'response' | 'payment' | 'selection' | 'discard';
}
