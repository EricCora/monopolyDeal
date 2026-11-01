import type { GameVariant, PropertyColor } from '../cards/catalog';

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
  variant?: GameVariant;
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
  /** No Mercy Shack attachment; a Shack is transferred with this card. */
  attachedToCardId?: string;
}

export interface DebtRecord {
  id?: string;
  /** Physical chip identity; retained as an alias for persisted clients. */
  chipId?: string;
  debtorPlayerId?: PlayerId;
  creditorPlayerId: PlayerId;
  /** A debt chip represents one card owed; amount is retained for audit/UI. */
  amount?: number;
  createdTurn?: number;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  controller?: PlayerController;
  botDifficulty?: BotDifficulty;
  hand: string[];
  bank: string[];
  properties: Record<PropertyColor, PropertyCardPlacement[]>;
  /** Debts owed by this player. Optional for compatibility with legacy snapshots. */
  debts?: DebtRecord[];
  /** Legacy/test-facing alias for debts. */
  debtsOwed?: DebtRecord[];
  /** No Mercy debt chips still held by this player. */
  debtChipsRemaining?: number;
  /** Public ledger of physical debt chips currently held from other players. */
  debtChipsHeld?: DebtRecord[];
  /** Compatibility alias used by older clients. */
  debtChips?: DebtRecord[];
}

export type TurnPhase = 'draw' | 'debt' | 'action' | 'finished';

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

export interface PendingDebtCard {
  debtorPlayerId: PlayerId;
  creditorPlayerId: PlayerId;
  debtId: string;
  cardId: string;
}
export interface PendingNoMercy {
  sourcePlayerId: PlayerId;
  actionCardId: string;
  effect: string;
  targetPlayerIds?: PlayerId[];
  targetPlayerId?: PlayerId;
  color?: PropertyColor;
  step?: string;
  /** Card selected during a multi-step No Mercy effect. */
  cardId?: string;
  /** Player selected as the recipient during redistribution. */
  recipientPlayerId?: PlayerId;
  /** Card type requested by Tough Luck (property, money, or action). */
  choice?: 'property' | 'money' | 'action';
  /** Remaining cards awaiting a recipient in Repossession/Tax Collector. */
  redistribution?: Array<{
    cardId: string;
    color?: PropertyColor;
    setId?: string;
    attachedToCardId?: string;
  }>;
}

export type PendingEffect =
  | { kind: 'payment'; payload: PaymentRequest }
  | { kind: 'sly_deal'; payload: PendingSlyDeal }
  | { kind: 'forced_deal'; payload: PendingForcedDeal }
  | { kind: 'deal_breaker'; payload: PendingDealBreaker }
  | { kind: 'rent'; payload: PendingRent }
  | { kind: 'no_mercy'; payload: PendingNoMercy };

export type PendingInteraction =
  | { kind: 'counter'; payload: CounterRequest }
  | { kind: 'payment'; payload: PaymentRequest }
  | { kind: 'sly_deal'; payload: PendingSlyDeal }
  | { kind: 'forced_deal'; payload: PendingForcedDeal }
  | { kind: 'deal_breaker'; payload: PendingDealBreaker }
  | { kind: 'rent'; payload: PendingRent }
  | { kind: 'debt_card'; payload: PendingDebtCard }
  | { kind: 'no_mercy'; payload: PendingNoMercy };

export interface GameState {
  version: 1;
  createdAt: number;
  updatedAt: number;
  deckVersion: 'v1';
  /** Omitted by legacy v1 saves; omitted means Classic. */
  variant?: GameVariant;
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
  | { type: 'play_property'; playerId: PlayerId; cardId: string; color: PropertyColor; setId?: string; attachedToCardId?: string }
  | { type: 'move_wild'; playerId: PlayerId; cardId: string; fromColor: PropertyColor; toColor: PropertyColor; fromSetId?: string; setId?: string }
  | { type: 'play_action'; playerId: PlayerId; cardId: string; targetPlayerId?: PlayerId; color?: PropertyColor }
  | { type: 'discard_card'; playerId: PlayerId; cardId: string }
  | { type: 'counter_response'; playerId: PlayerId; useJustSayNo: boolean; cardId?: string }
  | { type: 'pay_request'; playerId: PlayerId; cards: string[] }
  | { type: 'repay_debt'; playerId: PlayerId; debtId?: string; chipId?: string; creditorPlayerId?: PlayerId; cardId: string }
  | { type: 'resolve_debt_card'; playerId: PlayerId; debtId: string; cardId: string; mode: 'bank' | 'property' | 'action'; color?: PropertyColor; setId?: string; targetPlayerId?: PlayerId }
  | { type: 'no_mercy_pick'; playerId: PlayerId; actionCardId: string; targetPlayerId?: PlayerId; recipientPlayerId?: PlayerId; cardId?: string; color?: PropertyColor; setId?: string; choice?: 'property' | 'money' | 'action' }
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
  kind: 'draw' | 'debt' | 'main' | 'response' | 'payment' | 'selection' | 'discard';
}
