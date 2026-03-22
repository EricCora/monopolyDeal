import { useEffect, useMemo, useRef, useState } from 'react';
import { formatPropertyColor, getCardDisplayName, type PropertyColor } from '../../cards/catalog';
import {
  getSetCompletionCount,
  isGameOver,
  type Action,
  type GameEvent,
  type GameState,
  type LegalAction,
  type PaymentRequest,
  type TurnPrompt,
} from '../../engine';
import { CardView } from '../components/CardView';
import { HandFan } from '../components/HandFan';
import { PlayChooser, type ActionVariantView } from '../components/PlayChooser';
import { RecentEvents } from '../components/RecentEvents';
import { ActionRail } from '../layout/ActionRail';
import { TopBar } from '../layout/TopBar';
import {
  MULTIPLAYER_SESSION_PRESET_OPTIONS,
  getMatchModeDefinition,
  getMultiplayerSessionPresetDefinition,
  type MatchMode,
  type MultiplayerSessionPresetId,
} from '../experience';
import type {
  MultiplayerActivityFeedItem,
  MultiplayerConnectionState,
  MultiplayerConnectionUiState,
  MultiplayerPushState,
} from '../../network/multiplayerTypes';

interface CardActionVariant extends ActionVariantView {
  action: Action;
  requiresConfirmation?: boolean;
  riskLevel?: 'low' | 'medium' | 'high';
  previewText?: string;
}

interface PlayChooserState {
  cardId: string;
  cardLabel: string;
  variants: CardActionVariant[];
}

interface PendingRequestBanner {
  title: string;
  detail: string;
  tone: 'payment' | 'selection' | 'response';
}

interface TablePriorityNotice {
  title: string;
  detail: string;
  tone: 'required' | 'warning' | 'info' | 'positive';
}

interface GameTableScreenProps {
  mode?: 'local' | 'multiplayer';
  matchMode?: MatchMode;
  game: GameState;
  prompt: TurnPrompt;
  isPaused: boolean;
  pauseReasonText?: string;
  disconnectDeadlineMs?: number | null;
  connectionStatusLabel?: string;
  multiplayerConnectionState?: MultiplayerConnectionState;
  multiplayerConnectionUiState?: MultiplayerConnectionUiState;
  multiplayerPushState?: MultiplayerPushState;
  multiplayerRoomCode?: string | null;
  multiplayerSeatPlayerId?: string | null;
  forceInputBlocked?: boolean;
  showDevStatusChip?: boolean;
  devStatus?: {
    reconnectPolicyActive: boolean;
    versionGuardActive: boolean;
    disconnectPausePolicyActive: boolean;
    transportMode: 'socket_primary' | 'http_fallback';
    pushState: 'disabled' | 'unsupported' | 'connecting' | 'connected' | 'fallback';
    roomRuntimeState: 'active' | 'paused_disconnect' | 'paused_host_disconnect' | 'ended_timeout' | null;
  };
  playerConnectionById?: Record<string, { connected: boolean; lastSeenAt: number; reconnectDeadlineMs: number }>;
  isMultiplayerHost?: boolean;
  checkpointSlots?: { id: string; name: string; savedAt: number }[];
  activityFeed?: MultiplayerActivityFeedItem[];
  multiplayerPresetId?: MultiplayerSessionPresetId;
  canRematchMultiplayer?: boolean;
  rematchStatusText?: string | null;
  hostChangeNotice?: string | null;
  onDismissHostChangeNotice?: () => void;
  reducedMotion?: boolean;
  checkpointLoading?: boolean;
  legalActions: LegalAction[];
  contextualActions: LegalAction[];
  revealedPlayerId: string | null;
  playableCardIds: Set<string>;
  selectedCardId: string | null;
  selectedSelectionCardId?: string | null;
  selectedPaymentCards: string[];
  selectedPaymentTotal: number;
  totalPayableValue: number;
  paymentCanSubmit: boolean;
  pendingPayment: PaymentRequest | null;
  chooser: PlayChooserState | null;
  shouldShowShield: boolean;
  turnStatusText: string;
  isMandatoryPrompt: boolean;
  mainPhaseExhausted: boolean;
  discardOverLimitCount: number;
  showRulesHints: boolean;
  enhancedEventLog: boolean;
  coachHint: {
    title: string;
    summary: string;
    topActionLabel: string;
    alternatives: string[];
  } | null;
  turnSnapshotsCount: number;
  showDebugActions: boolean;
  actionDetailText: (item: LegalAction) => string | null;
  onPauseToggle: () => void;
  onRefreshMultiplayer?: () => void;
  onExitMultiplayer?: () => void;
  onForgetMultiplayer?: () => void;
  onSetMultiplayerPreset?: (presetId: MultiplayerSessionPresetId) => void;
  onRematchMultiplayer?: () => void;
  onSaveCheckpoint?: (name: string) => void;
  onLoadCheckpoint?: (checkpointId: string) => void;
  onDeleteCheckpoint?: (checkpointId: string) => void;
  onOpenRules: () => void;
  onOpenSavedGames: () => void;
  onOpenSettings: () => void;
  onToggleDebugActions: () => void;
  onRunAction: (action: Action, source?: LegalAction) => void;
  onCardClick: (cardId: string) => void;
  onPropertySelectionClick: (ownerPlayerId: string, color: PropertyColor, cardId: string) => void;
  onPaymentCardToggle: (cardId: string) => void;
  onAutoSelectPayment: () => void;
  onSubmitSelectedPayment: () => void;
  onUndoLastPlay: () => void;
  onResetTurnPlays: () => void;
  onCloseChooser: () => void;
  onRevealTurn: () => void;
  onNavigateHome: () => void;
}

const RECONNECT_BLOCKING_UI_STATES = new Set<MultiplayerConnectionUiState>([
  'reconnecting_attempting',
  'reconnect_handshake_pending',
  'resync_pending',
  'resume_failed',
  'timed_out',
  'room_ended',
]);

function colorLabel(color: PropertyColor): string {
  return formatPropertyColor(color);
}

function pendingRequestBanner(game: GameState, playerId: string): PendingRequestBanner | null {
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
      detail: `${sourceName} played ${getCardDisplayName(pending.payload.actionCardId)}. Choose your response to continue.`,
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

  return null;
}

function renderHiddenHand(cardCount: number) {
  const visibleBacks = Math.min(5, cardCount);
  return (
    <div className="hidden-hand-wrap">
      <div className="hidden-hand" aria-label={`Hidden hand with ${cardCount} cards`}>
        {Array.from({ length: visibleBacks }, (_, index) => (
          <div key={`hidden-${index}`} className="hidden-hand-card" style={{ left: `${index * 18}px`, zIndex: index + 1 }}>
            <CardView cardId="money_1#0" faceUp={false} size="md" />
          </div>
        ))}
      </div>
      <p>{cardCount} cards</p>
    </div>
  );
}

interface TableStealAlert {
  key: string;
  mode: 'sly_deal' | 'forced_deal' | 'deal_breaker';
  sourcePlayerId: string;
  targetPlayerId: string;
  sourceName: string;
  targetName: string;
  cardIds: string[];
}

interface DrawGhostCard {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  delayMs: number;
}

function reactionEmoji(reaction: string | undefined): string {
  if (reaction === 'nice') return '👏';
  if (reaction === 'wow') return '😮';
  if (reaction === 'gg') return '🏁';
  if (reaction === 'oops') return '😅';
  return '💬';
}

function stealModeLabel(mode: TableStealAlert['mode']): string {
  if (mode === 'sly_deal') return 'Sly Deal';
  if (mode === 'forced_deal') return 'Forced Deal';
  return 'Deal Breaker';
}

function stealEventKey(event: GameEvent): string | null {
  const details = event.details;
  if (!details || details.kind !== 'property_steal') return null;
  return `${event.timestamp}:${details.mode}:${details.cardIds.join('|')}`;
}

function drawEventKey(event: GameEvent): string | null {
  const details = event.details;
  if (!details || details.kind !== 'draw') return null;
  return `${event.timestamp}:${details.playerId}:${details.reason}:${details.count}`;
}

function promptKindLabel(kind: TurnPrompt['kind']): string {
  if (kind === 'draw') return 'Draw Step';
  if (kind === 'main') return 'Main Step';
  if (kind === 'response') return 'Response Step';
  if (kind === 'payment') return 'Payment Step';
  if (kind === 'selection') return 'Selection Step';
  return 'Discard Step';
}

function promptSpotlightLabel(kind: TurnPrompt['kind']): string {
  if (kind === 'draw') return 'Draw cards to open the turn';
  if (kind === 'main') return 'Play cards from the active hand';
  if (kind === 'response') return 'Resolve the interrupt window';
  if (kind === 'payment') return 'Pay with bank or property cards';
  if (kind === 'selection') return 'Choose a valid target on the table';
  return 'Discard down before passing the turn';
}

function tableSurfaceFocusLabel(kind: TurnPrompt['kind']): string {
  if (kind === 'draw') return 'Deck Focus';
  if (kind === 'main') return 'Hand In Motion';
  if (kind === 'response') return 'Interrupt Window';
  if (kind === 'payment') return 'Settlement Pressure';
  if (kind === 'selection') return 'Target Lock';
  return 'Hand Cleanup';
}

function tableSurfaceFocusNote(kind: TurnPrompt['kind']): string {
  if (kind === 'draw') return 'Open the turn from the deck, then settle the new hand before the table spreads back out.';
  if (kind === 'main') return 'Card play is open. The active hand should stay louder than the rest of the table.';
  if (kind === 'response') return 'An interrupt is on the stack. Resolve the counter window before the turn resumes.';
  if (kind === 'payment') return 'Bank and property lanes now carry the decision weight while the payment total updates.';
  if (kind === 'selection') return 'Highlighted lanes and cards are the valid targets until this effect resolves.';
  return 'Trim the hand back to seven cards so the table can hand control to the next seat.';
}

function multiplayerUpdatesLabel(state: MultiplayerPushState | undefined): string {
  if (state === 'connected') return 'Live push';
  if (state === 'connecting') return 'Syncing';
  if (state === 'fallback') return 'Polling fallback';
  if (state === 'unsupported') return 'Browser fallback';
  return 'Manual refresh';
}

function pendingKindLabel(pending: GameState['pending']): string {
  if (!pending) return 'None';
  if (pending.kind === 'counter') return 'Counter';
  if (pending.kind === 'payment') return 'Payment';
  if (pending.kind === 'rent') return 'Rent Target';
  if (pending.kind === 'sly_deal') return 'Sly Deal';
  if (pending.kind === 'forced_deal') return 'Forced Deal';
  return 'Deal Breaker';
}

function eventTypeLabel(type: string): string {
  return type
    .split('_')
    .map((chunk) => `${chunk.slice(0, 1).toUpperCase()}${chunk.slice(1)}`)
    .join(' ');
}

function eventAgeLabel(timestamp: number, clockNow: number): string {
  const ageSeconds = Math.max(0, Math.floor((clockNow - timestamp) / 1000));
  if (ageSeconds < 3) return 'Just now';
  if (ageSeconds < 60) return `${ageSeconds}s ago`;
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function resolveStealAlert(game: GameState, clockNow: number): TableStealAlert | null {
  for (let index = game.history.length - 1; index >= 0; index -= 1) {
    const event = game.history[index];
    const details = event.details;
    if (!details || details.kind !== 'property_steal') continue;
    if (clockNow - event.timestamp > 3_200) return null;
    const key = stealEventKey(event);
    if (!key) return null;
    const sourceName = game.players.find((entry) => entry.id === details.sourcePlayerId)?.name ?? details.sourcePlayerId;
    const targetName = game.players.find((entry) => entry.id === details.targetPlayerId)?.name ?? details.targetPlayerId;
    return {
      key,
      mode: details.mode,
      sourcePlayerId: details.sourcePlayerId,
      targetPlayerId: details.targetPlayerId,
      sourceName,
      targetName,
      cardIds: [...details.cardIds],
    };
  }
  return null;
}

interface DiscardPileCardProps {
  discardCount: number;
  discardPreviewCardIds: string[];
  discardBrowserCardIds: string[];
}

function DiscardPileCard({ discardCount, discardPreviewCardIds, discardBrowserCardIds }: DiscardPileCardProps) {
  const [discardBrowserOpen, setDiscardBrowserOpen] = useState(false);
  const hasCards = discardCount > 0;

  return (
    <article className={`table-pile-card discard-pile-card ${discardBrowserOpen ? 'is-expanded' : ''}`}>
      <div className="table-pile-head">
        <div>
          <h4>Discard Pile</h4>
          <p>{discardCount} cards</p>
        </div>
        <button
          type="button"
          className="table-pile-toggle"
          aria-expanded={discardBrowserOpen}
          onClick={() => setDiscardBrowserOpen((open) => !open)}
          disabled={!hasCards}
        >
          {discardBrowserOpen ? 'Hide Pile' : 'Browse Pile'}
        </button>
      </div>
      <div className="table-discard-preview" aria-label="Discard pile preview">
        {discardPreviewCardIds.length > 0 ? (
          discardPreviewCardIds.map((cardId, index) => (
            <div
              key={`discard-preview-${cardId}-${index}`}
              className={`table-discard-preview-card ${index === 0 ? 'is-top' : 'is-back'}`}
              style={{ ['--discard-index' as string]: String(index) }}
            >
              <CardView cardId={cardId} size="sm" faceUp={index === 0} />
            </div>
          ))
        ) : (
          <p className="table-discard-empty">No cards discarded yet.</p>
        )}
      </div>
      {discardBrowserOpen ? (
        <div className="table-discard-browser" aria-label="Discard pile browser">
          <p className="table-discard-browser-caption">Newest to oldest</p>
          <div className="table-discard-browser-scroll">
            {discardBrowserCardIds.map((cardId, index) => (
              <div key={`discard-browser-${cardId}-${index}`} className="table-discard-browser-item">
                <CardView cardId={cardId} size="sm" />
                <span className="table-discard-browser-index">#{index + 1}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function GameTableScreen({
  mode = 'local',
  matchMode = mode === 'multiplayer' ? 'live_online' : 'hot_seat',
  game,
  prompt,
  isPaused,
  pauseReasonText,
  disconnectDeadlineMs = null,
  connectionStatusLabel,
  multiplayerConnectionState,
  multiplayerConnectionUiState,
  multiplayerPushState,
  multiplayerRoomCode = null,
  multiplayerSeatPlayerId = null,
  forceInputBlocked = false,
  showDevStatusChip = false,
  devStatus,
  playerConnectionById = {},
  isMultiplayerHost = false,
  checkpointSlots = [],
  activityFeed = [],
  multiplayerPresetId = undefined,
  canRematchMultiplayer = false,
  rematchStatusText = null,
  hostChangeNotice = null,
  onDismissHostChangeNotice,
  reducedMotion = false,
  checkpointLoading = false,
  legalActions,
  contextualActions,
  revealedPlayerId,
  playableCardIds,
  selectedCardId,
  selectedSelectionCardId = null,
  selectedPaymentCards,
  selectedPaymentTotal,
  totalPayableValue,
  paymentCanSubmit,
  pendingPayment,
  chooser,
  shouldShowShield,
  turnStatusText,
  isMandatoryPrompt,
  mainPhaseExhausted,
  discardOverLimitCount,
  showRulesHints,
  enhancedEventLog,
  coachHint,
  turnSnapshotsCount,
  showDebugActions,
  actionDetailText,
  onPauseToggle,
  onRefreshMultiplayer,
  onExitMultiplayer,
  onForgetMultiplayer,
  onSetMultiplayerPreset,
  onRematchMultiplayer,
  onSaveCheckpoint,
  onLoadCheckpoint,
  onDeleteCheckpoint,
  onOpenRules,
  onOpenSavedGames,
  onOpenSettings,
  onToggleDebugActions,
  onRunAction,
  onCardClick,
  onPropertySelectionClick,
  onPaymentCardToggle,
  onAutoSelectPayment,
  onSubmitSelectedPayment,
  onUndoLastPlay,
  onResetTurnPlays,
  onCloseChooser,
  onRevealTurn,
  onNavigateHome,
}: GameTableScreenProps) {
  const over = isGameOver(game);
  const isMultiplayer = mode === 'multiplayer';
  const multiplayerUiState = multiplayerConnectionUiState ?? 'connected';
  const reconnectBlockingState = isMultiplayer
    && (
      RECONNECT_BLOCKING_UI_STATES.has(multiplayerUiState)
      || multiplayerConnectionState === 'reconnecting'
      || multiplayerConnectionState === 'disconnected'
    );
  const inputBlocked = isPaused || reconnectBlockingState || forceInputBlocked;
  const drawPileDeckRef = useRef<HTMLDivElement | null>(null);
  const visibleHandZoneByPlayerIdRef = useRef<Record<string, HTMLDivElement | null>>({});
  const handledDrawEventKeyRef = useRef<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const hasDisconnectDeadline = Number.isFinite(disconnectDeadlineMs) && Number(disconnectDeadlineMs) > clockNow;
  const disconnectSecondsRemaining = hasDisconnectDeadline
    ? Math.max(0, Math.ceil((Number(disconnectDeadlineMs) - clockNow) / 1000))
    : 0;
  const disconnectCountdownText = hasDisconnectDeadline
    ? ` Timeout in ${disconnectSecondsRemaining}s.`
    : '';
  const [drawGhostCards, setDrawGhostCards] = useState<DrawGhostCard[]>([]);
  const [narrowLayout, setNarrowLayout] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth <= 980 : false
  ));
  const [controlsExpanded, setControlsExpanded] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth > 980 : true
  ));
  const [insightsExpanded, setInsightsExpanded] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth > 980 : true
  ));
  const [timelineExpanded, setTimelineExpanded] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth > 760 : true
  ));
  const stealAlert = resolveStealAlert(game, clockNow);
  const latestEvent = game.history.length > 0 ? game.history[game.history.length - 1] : null;
  const hasInsightsPanels = Boolean(
    coachHint
      || latestEvent
      || stealAlert
      || (isMultiplayer && activityFeed.length > 0),
  );
  const activePlayer = game.players.find((player) => player.id === prompt.playerId) ?? game.players[game.currentPlayerIndex];
  const activePlayerName = activePlayer?.name ?? prompt.playerId;
  const playsRemaining = Math.max(0, 3 - game.turn.playsUsed);
  const pendingLabel = pendingKindLabel(game.pending);
  const discardPreviewCardIds = game.discardPile.slice(-3).reverse();
  const discardBrowserCardIds = useMemo(() => [...game.discardPile].reverse(), [game.discardPile]);
  const winnerName = over.done && over.winnerId
    ? game.players.find((player) => player.id === over.winnerId)?.name ?? over.winnerId
    : null;
  const stealHighlightCardIds = new Set(stealAlert?.cardIds ?? []);
  const recentReactionsByPlayerId = useMemo(() => {
    const map = new Map<string, string>();
    if (!isMultiplayer) return map;
    activityFeed
      .filter((item) => item.kind === 'reaction' && item.playerId && clockNow - item.createdAt <= 2_400)
      .sort((left, right) => right.createdAt - left.createdAt)
      .forEach((item) => {
        if (!item.playerId || map.has(item.playerId)) return;
        map.set(item.playerId, reactionEmoji(item.reaction));
      });
    return map;
  }, [activityFeed, clockNow, isMultiplayer]);
  const selectionPendingKind = prompt.kind === 'selection' ? game.pending?.kind ?? null : null;
  const multiplayerPreset = isMultiplayer && multiplayerPresetId
    ? getMultiplayerSessionPresetDefinition(multiplayerPresetId)
    : null;
  const multiplayerSeatPlayer = isMultiplayer && multiplayerSeatPlayerId
    ? game.players.find((player) => player.id === multiplayerSeatPlayerId) ?? null
    : null;
  const multiplayerRemoteSeatCount = isMultiplayer
    ? Math.max(game.players.length - (multiplayerSeatPlayer ? 1 : 0), 0)
    : 0;
  const selectionTargetCardIds = useMemo(() => {
    const targets = new Set<string>();
    if (prompt.kind !== 'selection') return targets;

    if (selectionPendingKind === 'sly_deal') {
      legalActions.forEach((item) => {
        if (item.action.type === 'sly_deal_pick') {
          targets.add(item.action.cardId);
        }
      });
      return targets;
    }

    if (selectionPendingKind === 'forced_deal') {
      legalActions.forEach((item) => {
        if (item.action.type !== 'forced_deal_pick') return;
        if (selectedSelectionCardId) {
          if (item.action.giveCardId === selectedSelectionCardId) {
            targets.add(item.action.takeCardId);
          }
          return;
        }
        targets.add(item.action.giveCardId);
      });
      return targets;
    }

    return targets;
  }, [legalActions, prompt.kind, selectedSelectionCardId, selectionPendingKind]);
  const selectionTargetColors = useMemo(() => {
    const colors = new Set<PropertyColor>();
    if (prompt.kind !== 'selection') return colors;
    if (selectionPendingKind !== 'deal_breaker') return colors;

    legalActions.forEach((item) => {
      if (item.action.type === 'deal_breaker_pick') {
        colors.add(item.action.color);
      }
    });
    return colors;
  }, [legalActions, prompt.kind, selectionPendingKind]);
  const moveWildActionsByCard = useMemo(() => {
    const map = new Map<string, LegalAction[]>();
    if (prompt.kind !== 'main' || game.pending) return map;
    legalActions.forEach((item) => {
      if (item.action.type !== 'move_wild') return;
      const existing = map.get(item.action.cardId) ?? [];
      existing.push(item);
      map.set(item.action.cardId, existing);
    });
    return map;
  }, [game.pending, legalActions, prompt.kind]);
  const moveWildSourceCardIds = useMemo(() => new Set(moveWildActionsByCard.keys()), [moveWildActionsByCard]);
  const canDirectWildMove = !inputBlocked
    && !over.done
    && prompt.kind === 'main'
    && !game.pending
    && revealedPlayerId === prompt.playerId;
  const [selectedMoveWildCardId, setSelectedMoveWildCardId] = useState<string | null>(null);
  const activeMoveWildCardId = canDirectWildMove && selectedMoveWildCardId && moveWildSourceCardIds.has(selectedMoveWildCardId)
    ? selectedMoveWildCardId
    : null;
  const moveWildDestinationColors = useMemo(() => {
    const colors = new Set<PropertyColor>();
    if (!activeMoveWildCardId) return colors;
    const options = moveWildActionsByCard.get(activeMoveWildCardId) ?? [];
    options.forEach((item) => {
      if (item.action.type === 'move_wild') {
        colors.add(item.action.toColor);
      }
    });
    return colors;
  }, [activeMoveWildCardId, moveWildActionsByCard]);
  const turnPriorityNotice = useMemo<TablePriorityNotice | null>(() => {
    if (isPaused) {
      return {
        title: 'Match Paused',
        detail: `${pauseReasonText ?? 'Gameplay is paused. Resume when ready.'}${disconnectCountdownText}`,
        tone: 'warning',
      };
    }
    if (over.done) {
      return {
        title: winnerName ? `${winnerName} won the match` : 'Match Complete',
        detail: 'Review the final board state or return home to start a new game.',
        tone: 'positive',
      };
    }
    if (prompt.kind === 'payment' && pendingPayment) {
      const targetName = game.players.find((player) => player.id === pendingPayment.targetPlayerId)?.name ?? 'Target player';
      return {
        title: `${targetName} owes $${pendingPayment.amount}`,
        detail: `Resolve payment for ${pendingPayment.reason} before the turn can continue.`,
        tone: 'required',
      };
    }
    if (prompt.kind === 'response') {
      return {
        title: 'Counter Response Pending',
        detail: 'A counter response is blocking this turn. Resolve it to continue.',
        tone: 'required',
      };
    }
    if (prompt.kind === 'selection') {
      return {
        title: 'Target Selection Required',
        detail: 'Pick one of the highlighted targets to resolve the current action.',
        tone: 'required',
      };
    }
    if (prompt.kind === 'discard') {
      const discardNeeded = Math.max(discardOverLimitCount, 0);
      return {
        title: 'Discard Required',
        detail: `Discard ${discardNeeded} card${discardNeeded === 1 ? '' : 's'} before ending the turn.`,
        tone: 'required',
      };
    }
    if (prompt.kind === 'draw') {
      return {
        title: 'Draw Step',
        detail: `${activePlayerName} must draw before taking other actions.`,
        tone: 'info',
      };
    }
    if (mainPhaseExhausted) {
      return {
        title: 'Play Limit Reached',
        detail: '3/3 plays used. Pass turn or use non-play options.',
        tone: 'warning',
      };
    }
    return {
      title: 'Main Step Active',
      detail: `${activePlayerName} can make ${playsRemaining} more ${playsRemaining === 1 ? 'play' : 'plays'} this turn.`,
      tone: 'info',
    };
  }, [
    disconnectCountdownText,
    activePlayerName,
    discardOverLimitCount,
    game.players,
    isPaused,
    mainPhaseExhausted,
    over.done,
    pauseReasonText,
    pendingPayment,
    playsRemaining,
    prompt.kind,
    winnerName,
  ]);
  const matchModeLabel = getMatchModeDefinition(matchMode).tableKicker;
  const matchHeaderTitle = isMultiplayer ? 'Multiplayer Table' : 'Game Table';
  const matchHeaderSubtitle = turnPriorityNotice?.detail ?? turnStatusText;
  const showControlsPanel = !narrowLayout || controlsExpanded;
  const showRoomActions = Boolean(isMultiplayer);
  const showHostTools = Boolean(isMultiplayer && isMultiplayerHost);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 450);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => {
      const nextIsNarrow = window.innerWidth <= 980;
      setNarrowLayout(nextIsNarrow);
      if (!nextIsNarrow) {
        setControlsExpanded(true);
        setInsightsExpanded(true);
      }
      if (window.innerWidth > 760) {
        setTimelineExpanded(true);
      }
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    for (let index = game.history.length - 1; index >= 0; index -= 1) {
      const event = game.history[index];
      const details = event.details;
      if (!details || details.kind !== 'draw') continue;
      const nextKey = drawEventKey(event);
      if (!nextKey || nextKey === handledDrawEventKeyRef.current) return;
      handledDrawEventKeyRef.current = nextKey;
      if (reducedMotion || details.count <= 0) return;
      if (revealedPlayerId !== details.playerId) return;
      const sourceElement = drawPileDeckRef.current;
      const destinationElement = visibleHandZoneByPlayerIdRef.current[details.playerId];
      if (!sourceElement || !destinationElement) return;

      const sourceRect = sourceElement.getBoundingClientRect();
      const destinationRect = destinationElement.getBoundingClientRect();
      const sourceCenterX = sourceRect.left + sourceRect.width / 2;
      const sourceCenterY = sourceRect.top + sourceRect.height / 2;
      const destinationCenterX = destinationRect.left + destinationRect.width / 2;
      const destinationCenterY = destinationRect.top + destinationRect.height / 2;
      const ghosts = Array.from({ length: Math.min(3, details.count) }, (_, ghostIndex) => ({
        id: `${nextKey}:${ghostIndex}`,
        x: sourceCenterX - 34 + ghostIndex * 4,
        y: sourceCenterY - 46 - ghostIndex * 2,
        dx: destinationCenterX - sourceCenterX + ghostIndex * 12,
        dy: destinationCenterY - sourceCenterY - ghostIndex * 8,
        delayMs: ghostIndex * 75,
      }));
      setDrawGhostCards(ghosts);
      const clearTimer = window.setTimeout(() => {
        setDrawGhostCards((existing) => existing.filter((item) => !ghosts.some((ghost) => ghost.id === item.id)));
      }, 960);
      return () => window.clearTimeout(clearTimer);
    }
    return undefined;
  }, [game.history, reducedMotion, revealedPlayerId]);

  const saveCheckpointInteractive = () => {
    if (!onSaveCheckpoint || !isMultiplayerHost || isPaused) return;
    if (typeof window === 'undefined') return;
    const nextName = window.prompt('Checkpoint name', `Turn ${game.turnCount}`);
    if (!nextName) return;
    onSaveCheckpoint(nextName);
  };

  const loadCheckpointInteractive = () => {
    if (!onLoadCheckpoint || !isMultiplayerHost || checkpointSlots.length === 0 || isPaused) return;
    if (typeof window === 'undefined') return;
    const options = checkpointSlots.map((slot, index) => `${index + 1}. ${slot.name}`).join('\n');
    const chosen = window.prompt(`Load which checkpoint?\n${options}`, '1');
    const index = Number(chosen) - 1;
    if (!Number.isFinite(index) || index < 0 || index >= checkpointSlots.length) return;
    onLoadCheckpoint(checkpointSlots[index].id);
  };

  const deleteCheckpointInteractive = () => {
    if (!onDeleteCheckpoint || !isMultiplayerHost || checkpointSlots.length === 0) return;
    if (typeof window === 'undefined') return;
    const options = checkpointSlots.map((slot, index) => `${index + 1}. ${slot.name}`).join('\n');
    const chosen = window.prompt(`Delete which checkpoint?\n${options}`, '1');
    const index = Number(chosen) - 1;
    if (!Number.isFinite(index) || index < 0 || index >= checkpointSlots.length) return;
    const confirmed = window.confirm(`Delete checkpoint "${checkpointSlots[index].name}"?`);
    if (!confirmed) return;
    onDeleteCheckpoint(checkpointSlots[index].id);
  };

  const showReconnectOverlay = isMultiplayer
    && !over.done
    && (
      reconnectBlockingState
    );

  const reconnectOverlayTitle = (() => {
    if (multiplayerUiState === 'room_ended') return 'Room Ended';
    if (multiplayerUiState === 'timed_out') return 'Reconnect Window Expired';
    if (multiplayerUiState === 'resume_failed') return 'Could Not Resume Seat';
    if (multiplayerUiState === 'reconnect_handshake_pending') return 'Restoring Seat...';
    if (multiplayerUiState === 'resync_pending') return 'Syncing Game State...';
    return multiplayerConnectionState === 'reconnecting' ? 'Reconnecting...' : 'Connection Lost';
  })();

  const reconnectOverlayDetail = (() => {
    if (multiplayerUiState === 'room_ended') {
      return pauseReasonText ?? 'This room is no longer available. Create or join a new room to continue.';
    }
    if (multiplayerUiState === 'timed_out') {
      return 'Your reconnect window expired. Rejoin with the room code to continue.';
    }
    if (multiplayerUiState === 'resume_failed') {
      return 'Automatic resume failed. Refresh room state or rejoin manually.';
    }
    if (multiplayerUiState === 'reconnect_handshake_pending') {
      return 'Re-authenticating your room seat before state recovery.';
    }
    if (multiplayerUiState === 'resync_pending') {
      return 'Applying the latest authoritative room snapshot. Inputs stay disabled until sync finishes.';
    }
    return multiplayerConnectionState === 'reconnecting'
      ? 'Trying to restore your room session. You can wait here while reconnect attempts continue.'
      : `Unable to reconnect automatically. Refresh room state or exit the match.${disconnectCountdownText}`;
  })();

  const tableSurfaceModeLabel = isMultiplayer ? 'Live Table' : 'Local Table';
  const tableSurfaceNote = isMultiplayer
    ? 'Live room felt with shared turn state and hidden hands for the other seats.'
    : 'Pass-and-play felt. Reveal only the active hand, then pass the device on.';
  const rejoinWindowLabel = hasDisconnectDeadline ? `${disconnectSecondsRemaining}s left` : reconnectBlockingState ? 'Recovering' : 'Standing by';
  const tableSurfaceClassName = [
    'table-surface',
    isMultiplayer ? 'is-live-room' : 'is-local-table',
    `state-${prompt.kind}`,
  ].join(' ');

  return (
    <section className={`game-table-screen ${isPaused ? 'is-paused' : ''} ${isMultiplayer ? 'is-live-room' : 'is-local-table'}`}>
      <TopBar
        kicker={matchModeLabel}
        title={matchHeaderTitle}
        subtitle={matchHeaderSubtitle}
        meta={(
          <div className="table-command-strip">
            {turnPriorityNotice ? (
              <section className={`table-priority-banner tone-${turnPriorityNotice.tone}`} aria-label="Turn priority">
                <p className="table-priority-title">{turnPriorityNotice.title}</p>
                <p className="table-priority-detail">{turnPriorityNotice.detail}</p>
              </section>
            ) : null}
            <div className="table-command-grid table-match-meta">
              <article className="table-match-chip">
                <p className="table-match-chip-label">Turn</p>
                <p className="table-match-chip-value">{activePlayerName}</p>
              </article>
              <article className="table-match-chip">
                <p className="table-match-chip-label">Step</p>
                <p className="table-match-chip-value">{promptKindLabel(prompt.kind)}</p>
              </article>
              <article className="table-match-chip">
                <p className="table-match-chip-label">Pressure</p>
                <p className="table-match-chip-value">
                  {prompt.kind === 'discard'
                    ? `${Math.max(discardOverLimitCount, 0)} discard needed`
                    : `${playsRemaining} plays left`}
                </p>
              </article>
              <article className="table-match-chip">
                <p className="table-match-chip-label">Pending</p>
                <p className="table-match-chip-value">{pendingLabel}</p>
              </article>
              <article className="table-match-chip">
                <p className="table-match-chip-label">Table</p>
                <p className="table-match-chip-value">Turn {game.turnCount} | Draw {game.drawPile.length} | Discard {game.discardPile.length}</p>
              </article>
              {multiplayerPreset ? (
                <article className="table-match-chip">
                  <p className="table-match-chip-label">Preset</p>
                  <p className="table-match-chip-value">{multiplayerPreset.tableSummary}</p>
                </article>
              ) : null}
              {isMultiplayer && connectionStatusLabel ? (
                <article className="table-match-chip">
                  <p className="table-match-chip-label">Connection</p>
                  <p className="table-match-chip-value">{connectionStatusLabel}</p>
                </article>
              ) : null}
              {isMultiplayer && checkpointSlots.length > 0 ? (
                <article className="table-match-chip">
                  <p className="table-match-chip-label">Checkpoints</p>
                  <p className="table-match-chip-value">{checkpointSlots.length} saved</p>
                </article>
              ) : null}
            </div>
            {isMultiplayer && connectionStatusLabel ? (
              <p className="table-match-summary">Connection: {connectionStatusLabel}</p>
            ) : null}
            {multiplayerPreset?.supportHints ? (
              <p className="table-match-summary">Teaching preset: standard rules with clearer setup and support copy.</p>
            ) : null}
            {showDevStatusChip ? (
              <p className="table-match-debug">
                Dev: reconnect {devStatus?.reconnectPolicyActive ? 'on' : 'off'} | version guard {devStatus?.versionGuardActive ? 'on' : 'off'} | pause policy {devStatus?.disconnectPausePolicyActive ? 'on' : 'off'} | transport {devStatus?.transportMode ?? 'http_fallback'} | push {devStatus?.pushState ?? 'n/a'} | runtime {devStatus?.roomRuntimeState ?? 'n/a'}
              </p>
            ) : null}
          </div>
        )}
        actions={(
          <div className={`table-top-actions ${narrowLayout ? 'is-narrow' : ''}`}>
            <div className="table-quick-actions">
              <button onClick={onNavigateHome}>Home</button>
              <button onClick={onPauseToggle}>{isPaused ? 'Resume' : 'Pause'}</button>
              <button
                type="button"
                onClick={() => setTimelineExpanded((open) => !open)}
              >
                {timelineExpanded ? 'Hide History' : 'Show History'}
              </button>
              {narrowLayout ? (
                <button
                  type="button"
                  className="table-controls-toggle"
                  aria-expanded={controlsExpanded}
                  onClick={() => setControlsExpanded((open) => !open)}
                >
                  {controlsExpanded ? 'Hide Table Tools' : 'More Tools'}
                </button>
              ) : null}
            </div>

            <div className={`table-top-panels ${showControlsPanel ? '' : 'is-hidden'}`}>
              <div className="table-top-group">
                <p className="table-top-group-label">Table</p>
                <div className="table-top-group-actions">
                  {!isMultiplayer ? <button onClick={onOpenSavedGames}>Save Game</button> : null}
                  <button onClick={onOpenRules}>Rules Reference</button>
                  <button onClick={onOpenSettings}>Settings</button>
                </div>
              </div>
              <div className="table-top-group">
                <p className="table-top-group-label">Focus</p>
                <div className="table-top-group-actions">
                  {hasInsightsPanels ? (
                    <button
                      type="button"
                      onClick={() => setInsightsExpanded((open) => !open)}
                    >
                      {insightsExpanded ? 'Hide Social' : 'Show Social'}
                    </button>
                  ) : (
                    <p className="table-top-group-note">No side panels active right now.</p>
                  )}
                </div>
              </div>
              {showRoomActions ? (
                <div className="table-top-group">
                  <p className="table-top-group-label">Room</p>
                  <div className="table-top-group-actions">
                    <button onClick={onRefreshMultiplayer} disabled={checkpointLoading}>Refresh</button>
                    <button onClick={onExitMultiplayer} disabled={checkpointLoading}>Exit Match</button>
                    <button onClick={onForgetMultiplayer} disabled={checkpointLoading}>Forget Room</button>
                  </div>
                </div>
              ) : null}
              {showHostTools ? (
                <div className="table-top-group">
                  <p className="table-top-group-label">Host Tools</p>
                  <div className="table-top-group-actions">
                    <button onClick={saveCheckpointInteractive} disabled={checkpointLoading || isPaused}>Save Checkpoint</button>
                    <button onClick={loadCheckpointInteractive} disabled={checkpointLoading || isPaused || checkpointSlots.length === 0}>Load Checkpoint</button>
                    <button onClick={deleteCheckpointInteractive} disabled={checkpointLoading || checkpointSlots.length === 0}>Delete Checkpoint</button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      />

      {isMultiplayer && hostChangeNotice ? (
        <section className="multiplayer-host-notice" aria-label="Host change notice">
          <p>{hostChangeNotice}</p>
          {onDismissHostChangeNotice ? (
            <button type="button" onClick={onDismissHostChangeNotice}>
              Dismiss
            </button>
          ) : null}
        </section>
      ) : null}

      <div className="game-table-grid">
        <div className="game-table-left-stack">
          <ActionRail
            isMultiplayer={isMultiplayer}
            isMandatoryPrompt={isMandatoryPrompt}
            turnStatusText={turnStatusText}
            turnPhase={game.turn.phase}
            promptKind={prompt.kind}
            playsUsed={game.turn.playsUsed}
            discardOverLimitCount={discardOverLimitCount}
            showRulesHints={showRulesHints}
            legalActions={legalActions}
            isPaused={isPaused}
            showDebugActions={showDebugActions}
            onToggleDebugActions={onToggleDebugActions}
          />
          {hasInsightsPanels && insightsExpanded ? (
            <aside
              className={`table-insights-stack ${narrowLayout ? 'is-narrow' : ''} ${isMultiplayer ? 'is-live-room' : ''}`}
              aria-label="Table insights"
            >
              {isMultiplayer ? (
                <div className="table-insights-head">
                  <p className="table-surface-focus-kicker">Room Activity</p>
                  <p className="table-insights-note">
                    Latest action, reactions, and the match log stay grouped here so the live room remains legible.
                  </p>
                </div>
              ) : null}
              {coachHint ? (
                <section className="panel inline-action-panel" aria-label="AI coach hint">
                  <h3>{coachHint.title}</h3>
                  <p className="inline-prompt-text">
                    <strong>Recommended:</strong> {coachHint.topActionLabel}
                  </p>
                  <p className="inline-prompt-text">{coachHint.summary}</p>
                  {coachHint.alternatives.length > 0 ? (
                    <p className="inline-prompt-text">Alternatives: {coachHint.alternatives.join(' | ')}</p>
                  ) : null}
                </section>
              ) : null}

              {latestEvent ? (
                <section className="panel last-action-panel" aria-label="Last action">
                  <h4>Last Action</h4>
                  <p className="last-action-meta">{eventTypeLabel(latestEvent.type)} | {eventAgeLabel(latestEvent.timestamp, clockNow)}</p>
                  <p>{latestEvent.message}</p>
                </section>
              ) : null}

              {stealAlert ? (
                <section className="table-steal-banner card-enter" role="status" aria-live="polite" aria-label="Property steal update">
                  <p className="table-steal-banner-title">
                    {stealAlert.sourceName} played {stealModeLabel(stealAlert.mode)} on {stealAlert.targetName}
                  </p>
                  <p className="table-steal-banner-detail">
                    Moved cards: {stealAlert.cardIds.slice(0, 3).map(getCardDisplayName).join(', ')}
                    {stealAlert.cardIds.length > 3 ? ` +${stealAlert.cardIds.length - 3} more` : ''}
                  </p>
                </section>
              ) : null}

              {isMultiplayer && activityFeed.length > 0 ? (
                <section className="panel multiplayer-social-panel" aria-label="Multiplayer social">
                  <h4>Social Pulse</h4>
                  <ul className="multiplayer-activity-feed">
                    {activityFeed.slice(0, 6).map((entry) => (
                      <li key={entry.id} className={entry.kind === 'reaction' ? 'is-reaction' : undefined}>
                        {entry.kind === 'reaction' ? <span className="multiplayer-activity-emoji">{reactionEmoji(entry.reaction)}</span> : null}
                        <span>{entry.message}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </aside>
          ) : null}
        </div>

        <div className="game-table-main">
          <div className="table-main-layout">
            <div className="table-play-column">
              <section className={tableSurfaceClassName} aria-label="Table surface">
            <div className="table-surface-head">
              <div className="table-surface-copy">
                <p className="table-surface-kicker">{tableSurfaceModeLabel}</p>
                <h3>Playable Surface</h3>
                <p className="table-surface-note">{tableSurfaceNote}</p>
              </div>
              <div className="table-surface-glance" aria-label="Table overview">
                <article className="table-surface-chip">
                  <p className="table-surface-chip-label">Active</p>
                  <p className="table-surface-chip-value">{activePlayerName}</p>
                </article>
                <article className="table-surface-chip">
                  <p className="table-surface-chip-label">Seats</p>
                  <p className="table-surface-chip-value">{game.players.length}</p>
                </article>
              </div>
            </div>

            <div className="table-surface-staging">
              <article className="table-surface-focus">
                <p className="table-surface-focus-kicker">Table Focus</p>
                <h4>{tableSurfaceFocusLabel(prompt.kind)}</h4>
                <p>{tableSurfaceFocusNote(prompt.kind)}</p>
              </article>
              {isMultiplayer ? (
                <section className="table-live-pulse" aria-label="Live room pulse">
                  <p className="table-surface-focus-kicker">Live Room Pulse</p>
                  <div className="table-live-pulse-grid">
                    {multiplayerRoomCode ? (
                      <article className="table-live-pulse-item">
                        <p className="table-live-pulse-label">Room</p>
                        <p className="table-live-pulse-value">{multiplayerRoomCode}</p>
                      </article>
                    ) : null}
                    {multiplayerSeatPlayer ? (
                      <article className="table-live-pulse-item">
                        <p className="table-live-pulse-label">Seat</p>
                        <p className="table-live-pulse-value">{multiplayerSeatPlayer.name}</p>
                      </article>
                    ) : null}
                    <article className="table-live-pulse-item">
                      <p className="table-live-pulse-label">Connection</p>
                      <p className="table-live-pulse-value">{connectionStatusLabel ?? 'Connected'}</p>
                    </article>
                    <article className="table-live-pulse-item">
                      <p className="table-live-pulse-label">Rejoin Window</p>
                      <p className="table-live-pulse-value">{rejoinWindowLabel}</p>
                    </article>
                    <article className="table-live-pulse-item">
                      <p className="table-live-pulse-label">Updates</p>
                      <p className="table-live-pulse-value">{multiplayerUpdatesLabel(multiplayerPushState)}</p>
                    </article>
                    <article className="table-live-pulse-item">
                      <p className="table-live-pulse-label">Remote Seats</p>
                      <p className="table-live-pulse-value">{multiplayerRemoteSeatCount}</p>
                    </article>
                  </div>
                </section>
              ) : null}
            </div>

            <div className="table-pile-row" aria-label="Card piles">
              <article className="table-pile-card draw-pile-card">
                <h4>Draw Pile</h4>
                <p>{game.drawPile.length} cards</p>
                <div ref={drawPileDeckRef} className="table-draw-deck" aria-hidden="true">
                  <span className="table-draw-card table-draw-card-bottom" />
                  <span className="table-draw-card table-draw-card-top" />
                </div>
              </article>
              <DiscardPileCard
                key={game.discardPile.length === 0 ? 'empty' : 'non-empty'}
                discardCount={game.discardPile.length}
                discardPreviewCardIds={discardPreviewCardIds}
                discardBrowserCardIds={discardBrowserCardIds}
              />
            </div>

            <div className="players-grid">
              {game.players.map((player) => {
              const canSeeHand = revealedPlayerId === player.id;
              const isCurrent = game.players[game.currentPlayerIndex].id === player.id;
              const isPromptPlayer = prompt.playerId === player.id;
              const isSelfSeat = isMultiplayer && multiplayerSeatPlayerId === player.id;
              const isRemoteSeat = isMultiplayer && !isSelfSeat;
              const playerConnected = playerConnectionById[player.id]?.connected ?? true;
              const handFitMode = isPromptPlayer && prompt.kind === 'draw' ? 'rail' : 'auto';
              const handInteractive = Boolean(canSeeHand && prompt.playerId === player.id && !over.done && !inputBlocked);
              const isPaymentPayer = pendingPayment?.targetPlayerId === player.id;
              const paymentSelectionEnabled = Boolean(isPaymentPayer && revealedPlayerId === player.id && !over.done && !inputBlocked);
              const selectionCardPickingEnabled = Boolean(prompt.kind === 'selection' && revealedPlayerId === prompt.playerId && !over.done && !inputBlocked);
              const requestBanner = isPromptPlayer ? pendingRequestBanner(game, player.id) : null;
              const inlineActions = isPromptPlayer
                ? (
                    pendingPayment
                      ? contextualActions.filter((item) => item.action.type !== 'pay_request')
                      : prompt.kind === 'selection'
                        ? legalActions
                        : contextualActions
                  )
                : [];
              const orderedInlineActions = (
                isPromptPlayer
                && prompt.kind === 'main'
                && (mainPhaseExhausted || playsRemaining <= 0)
              )
                ? [
                    ...inlineActions.filter((item) => item.action.type === 'pass_turn'),
                    ...inlineActions.filter((item) => item.action.type !== 'pass_turn'),
                  ]
                : inlineActions;
              const propertyColors = (Object.keys(player.properties) as PropertyColor[]).filter((color) => player.properties[color].length > 0);
              const visiblePropertyColors = (Object.keys(player.properties) as PropertyColor[]).filter((color) => {
                if (player.properties[color].length > 0) return true;
                return canDirectWildMove
                  && player.id === prompt.playerId
                  && activeMoveWildCardId !== null
                  && moveWildDestinationColors.has(color);
              });
              const hasSelectionTarget = selectionCardPickingEnabled && propertyColors.some((color) => (
                selectionPendingKind === 'deal_breaker'
                  ? selectionTargetColors.has(color)
                  : player.properties[color].some((entry) => selectionTargetCardIds.has(entry.cardId))
              ));
              const playerStatusSummary = (() => {
                if (isPromptPlayer && !over.done && !inputBlocked) return 'Acting now';
                if (isPaymentPayer) return 'Payment requested';
                if (isCurrent) return 'Current turn seat';
                if (hasSelectionTarget) return 'Valid target for this effect';
                if (isMultiplayer) {
                  return playerConnectionById[player.id]?.connected ? 'Connected to room' : 'Reconnect pending';
                }
                return 'Waiting for the next turn window';
              })();
              const playerStatusTags: string[] = [];
              if (isPromptPlayer && !over.done && !inputBlocked) playerStatusTags.push('Priority');
              if (isCurrent && playerStatusSummary !== 'Current turn seat') playerStatusTags.push('Turn Seat');
              if (isPaymentPayer) playerStatusTags.push('Payment Requested');
              if (hasSelectionTarget && playerStatusSummary !== 'Valid target for this effect') playerStatusTags.push('Valid Target');
              const seatEyebrow = isPromptPlayer && !over.done && !inputBlocked
                ? 'Active Seat'
                : isCurrent
                  ? 'Current Turn'
                  : isMultiplayer
                    ? 'Remote Seat'
                    : 'Waiting Seat';
              const seatToplineClassName = isPromptPlayer && !over.done && !inputBlocked
                ? 'player-seat-topline is-live'
                : isCurrent
                  ? 'player-seat-topline is-current'
                  : 'player-seat-topline';
              const handZoneSpotlight = isPromptPlayer && canSeeHand && !over.done && (
                prompt.kind === 'draw'
                || prompt.kind === 'main'
                || prompt.kind === 'discard'
              );
              const bankZoneSpotlight = isPaymentPayer && !over.done;
              const propertyZoneSpotlight = !over.done && (
                selectionCardPickingEnabled
                || paymentSelectionEnabled
                || (canDirectWildMove && moveWildSourceCardIds.size > 0)
              );
              const handZoneSpotlightText = handZoneSpotlight
                ? (prompt.kind === 'draw'
                    ? 'New cards arrive here first as the turn opens.'
                    : prompt.kind === 'discard'
                      ? 'Discard from this hand until you return to seven cards.'
                      : 'Primary plays launch directly from this hand.')
                : null;
              const bankZoneSpotlightText = bankZoneSpotlight
                ? 'Bank cards contribute to the active payment total.'
                : null;
              const propertyZoneSpotlightText = propertyZoneSpotlight
                ? (selectionCardPickingEnabled
                    ? 'Highlighted lanes are valid targets for the current effect.'
                    : paymentSelectionEnabled
                      ? 'Property cards can be tapped to cover the payment request.'
                      : 'Tap a movable wild card, then choose its destination lane.')
                : null;

              return (
                <article
                  className={`player ${isCurrent ? 'active' : ''} ${isPaymentPayer ? 'is-payment-requested' : ''} ${stealAlert?.sourcePlayerId === player.id ? 'is-steal-source' : ''} ${stealAlert?.targetPlayerId === player.id ? 'is-steal-target' : ''} ${isSelfSeat ? 'is-self-seat' : ''} ${isRemoteSeat ? 'is-remote-seat' : ''} ${isMultiplayer && !playerConnected ? 'is-offline-seat' : ''}`}
                  key={player.id}
                >
                  <header>
                    <div className={seatToplineClassName}>
                      <p className="player-seat-eyebrow">{seatEyebrow}</p>
                      <p className="player-seat-metrics">{player.hand.length} hand · {player.bank.length} bank · {getSetCompletionCount(player)} sets</p>
                    </div>
                    <h3>{player.name}</h3>
                    <p>{getSetCompletionCount(player)} complete sets</p>
                    <p className="player-status-summary">{playerStatusSummary}</p>
                    {playerStatusTags.length > 0 ? (
                      <ul className="player-status-tags" aria-label={`${player.name} status`}>
                        {playerStatusTags.map((tag) => (
                          <li key={`${player.id}-${tag}`} className="player-status-tag">{tag}</li>
                        ))}
                      </ul>
                    ) : null}
                    {isMultiplayer ? (
                      <p className={`connection-pill ${playerConnected ? 'is-online' : 'is-offline'}`}>
                        {isSelfSeat ? 'Your Seat' : playerConnected ? 'Online' : 'Disconnected'}
                      </p>
                    ) : null}
                    {recentReactionsByPlayerId.get(player.id) ? (
                      <span className="player-reaction-burst" aria-label={`${player.name} sent a reaction`}>
                        {recentReactionsByPlayerId.get(player.id)}
                      </span>
                    ) : null}
                  </header>

                  {isPromptPlayer && canSeeHand && !over.done ? (
                    <section className={`inline-action-panel prompt-tone-${prompt.kind}`}>
                      <div className="inline-panel-head">
                        <div className="inline-panel-copy">
                          <p className="inline-panel-kicker">{promptKindLabel(prompt.kind)}</p>
                          <h4>{promptSpotlightLabel(prompt.kind)}</h4>
                        </div>
                        <div className="inline-panel-status">
                          {isMandatoryPrompt ? <span className="inline-panel-pill is-required">Required</span> : null}
                          {mainPhaseExhausted ? <span className="inline-panel-pill">Plays Used</span> : null}
                        </div>
                      </div>
                      {isMandatoryPrompt ? <p className="inline-must-act">Required: resolve this step before anything else.</p> : null}
                      {mainPhaseExhausted ? <p className="inline-must-act">3/3 plays used. Pass turn or use non-play actions.</p> : null}
                      {prompt.kind === 'discard' ? (
                        <p className="inline-discard-hint">
                          Hand size: <strong>{player.hand.length}</strong> | Limit: <strong>7</strong> | Need to discard:{' '}
                          <strong>{Math.max(player.hand.length - 7, 0)}</strong>
                        </p>
                      ) : null}
                      {requestBanner ? (
                        <div className={`action-request-banner tone-${requestBanner.tone}`} role="status" aria-live="polite">
                          <p className="action-request-title">{requestBanner.title}</p>
                          <p className="action-request-detail">{requestBanner.detail}</p>
                        </div>
                      ) : null}
                      <p className="inline-prompt-text">{prompt.text}</p>
                      {selectionCardPickingEnabled ? (
                        <p className="inline-target-hint">Valid selection targets are highlighted on the table.</p>
                      ) : null}
                      {canDirectWildMove && moveWildSourceCardIds.size > 0 ? (
                        <p className="inline-target-hint">
                          {activeMoveWildCardId
                            ? 'Wild selected. Tap a highlighted property lane to move it.'
                            : 'Tap a movable wild card, then tap a highlighted property lane to move it.'}
                        </p>
                      ) : null}

                      {isPaymentPayer && pendingPayment ? (
                        <div className="payment-panel">
                          {(() => {
                            const isShortfall = totalPayableValue < pendingPayment.amount;
                            const remainingOwed = Math.max(pendingPayment.amount - selectedPaymentTotal, 0);
                            return (
                              <>
                                <p>
                                  <strong>{player.name}</strong> owes <strong>${pendingPayment.amount}</strong> for{' '}
                                  <strong>{pendingPayment.reason}</strong>.
                                </p>
                                <p>
                                  Selected total: <strong>${selectedPaymentTotal}</strong> of ${pendingPayment.amount}
                                  {isShortfall ? ' (not enough assets available)' : ''}
                                </p>
                                <p>
                                  Remaining owed: <strong>${remainingOwed}</strong>
                                  {isShortfall ? ` (max payable now: $${totalPayableValue})` : ''}
                                </p>
                                {selectedPaymentTotal > pendingPayment.amount ? (
                                  <p className="payment-selected">Overpay: ${selectedPaymentTotal - pendingPayment.amount}</p>
                                ) : null}
                                {selectedPaymentTotal < pendingPayment.amount && isShortfall ? (
                                  <p className="payment-selected">
                                    Shortfall accepted: payer only has ${totalPayableValue} total available.
                                  </p>
                                ) : null}
                                {totalPayableValue === 0 ? (
                                  <p className="payment-selected">
                                    No payable cards available. Confirm shortfall payment to continue.
                                  </p>
                                ) : selectedPaymentCards.length > 0 ? (
                                  <p className="payment-selected">Selected: {selectedPaymentCards.map(getCardDisplayName).join(', ')}</p>
                                ) : (
                                  <p className="payment-selected">Click cards in {player.name}&apos;s bank/properties to pay.</p>
                                )}
                                <button type="button" onClick={onAutoSelectPayment} disabled={inputBlocked}>
                                  Auto-select Payment
                                </button>
                                <button type="button" onClick={onSubmitSelectedPayment} disabled={!paymentCanSubmit || inputBlocked}>
                                  {isShortfall ? 'Confirm Shortfall Payment' : 'Confirm Payment'}
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      ) : null}

                      <div className="actions action-list inline-actions">
                        {orderedInlineActions.map((item, index) => (
                          <button
                            key={`inline-${item.label}-${index}`}
                            onClick={() => onRunAction(item.action, item)}
                            disabled={inputBlocked}
                          >
                            {item.label}
                            {actionDetailText(item) ? <span className="action-detail">{actionDetailText(item)}</span> : null}
                          </button>
                        ))}
                        {orderedInlineActions.length === 0 && !pendingPayment ? (
                          <p>{prompt.kind === 'discard' ? 'Discard from your hand to continue.' : 'Play cards from your hand.'}</p>
                        ) : null}
                      </div>

                      {turnSnapshotsCount > 0 && (prompt.kind === 'main' || prompt.kind === 'discard' || prompt.kind === 'draw') ? (
                        <div className="actions inline-actions">
                          <button type="button" onClick={onUndoLastPlay} disabled={inputBlocked}>
                            Undo Last Play
                          </button>
                          <button type="button" onClick={onResetTurnPlays} disabled={inputBlocked}>
                            Reset Turn Plays
                          </button>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <section className={`player-zone ${handZoneSpotlight ? `is-spotlight tone-${prompt.kind}` : ''}`}>
                    <div className="player-zone-head">
                      <strong>Hand</strong>
                      <span className="player-zone-meta">{player.hand.length} cards</span>
                    </div>
                    {handZoneSpotlightText ? <p className="player-zone-spotlight">{handZoneSpotlightText}</p> : null}
                    <div
                      className="hand-zone"
                      ref={(node) => {
                        visibleHandZoneByPlayerIdRef.current[player.id] = node;
                      }}
                    >
                      {canSeeHand ? (
                        player.hand.length > 0 ? (
                          <HandFan
                            cards={player.hand}
                            playableCardIds={playableCardIds}
                            selectedCardId={selectedCardId}
                            onCardClick={onCardClick}
                            interactive={handInteractive}
                            fitMode={handFitMode}
                          />
                        ) : (
                          <p>Empty</p>
                        )
                      ) : (
                        renderHiddenHand(player.hand.length)
                      )}
                    </div>
                  </section>

                  <section className={`player-zone ${bankZoneSpotlight ? 'is-spotlight tone-payment' : ''}`}>
                    <div className="player-zone-head">
                      <strong>
                        Bank
                        {paymentSelectionEnabled ? <span className="zone-hint">Tap cards to pay</span> : null}
                      </strong>
                      <span className="player-zone-meta">{player.bank.length} cards</span>
                    </div>
                    {bankZoneSpotlightText ? <p className="player-zone-spotlight">{bankZoneSpotlightText}</p> : null}
                    <div className="zone-bank">
                      {player.bank.length > 0 ? (
                        player.bank.map((cardId) => (
                          <CardView
                            key={`${player.id}-bank-${cardId}`}
                            cardId={cardId}
                            size="sm"
                            interactive={paymentSelectionEnabled}
                            playable={paymentSelectionEnabled}
                            selected={selectedPaymentCards.includes(cardId)}
                            onClick={() => onPaymentCardToggle(cardId)}
                          />
                        ))
                      ) : (
                        <p>Empty</p>
                      )}
                    </div>
                  </section>

                  <section className={`player-zone ${propertyZoneSpotlight ? `is-spotlight tone-${prompt.kind === 'payment' ? 'payment' : 'selection'}` : ''}`}>
                    <div className="player-zone-head">
                      <strong>
                        Properties
                        {paymentSelectionEnabled ? <span className="zone-hint">Tap cards to pay</span> : null}
                        {selectionCardPickingEnabled ? <span className="zone-hint">Tap highlighted cards</span> : null}
                        {canDirectWildMove && moveWildSourceCardIds.size > 0 ? <span className="zone-hint">Tap wild, then lane</span> : null}
                      </strong>
                      <span className="player-zone-meta">{propertyColors.reduce((total, color) => total + player.properties[color].length, 0)} cards</span>
                    </div>
                    {propertyZoneSpotlightText ? <p className="player-zone-spotlight">{propertyZoneSpotlightText}</p> : null}
                    <div className="zone-properties">
                      {visiblePropertyColors.length > 0 ? (
                        visiblePropertyColors.map((color) => {
                          const laneHasSelectionTarget = selectionCardPickingEnabled && (
                            selectionPendingKind === 'deal_breaker'
                              ? selectionTargetColors.has(color)
                              : player.properties[color].some((entry) => selectionTargetCardIds.has(entry.cardId))
                          );
                          const laneIsMoveTarget = canDirectWildMove
                            && player.id === prompt.playerId
                            && activeMoveWildCardId !== null
                            && moveWildDestinationColors.has(color);
                          const laneHasMoveSource = activeMoveWildCardId !== null
                            && player.properties[color].some((entry) => entry.cardId === activeMoveWildCardId);
                          return (
                            <div
                              className={`property-lane ${player.properties[color].some((entry) => stealHighlightCardIds.has(entry.cardId)) ? 'is-steal-lane' : ''} ${laneHasSelectionTarget ? 'is-selection-target' : ''} ${laneIsMoveTarget ? 'is-move-target' : ''} ${laneHasMoveSource ? 'is-move-source-lane' : ''}`}
                              key={`${player.id}-${color}`}
                            >
                              <p>
                                <span>{colorLabel(color)}:</span>
                                {laneHasSelectionTarget ? <span className="property-lane-chip">Valid target</span> : null}
                                {laneIsMoveTarget ? (
                                  <button
                                    type="button"
                                    className="property-lane-chip property-lane-chip-button"
                                    onClick={() => {
                                      if (!activeMoveWildCardId) return;
                                      const match = (moveWildActionsByCard.get(activeMoveWildCardId) ?? []).find((item) => (
                                        item.action.type === 'move_wild' && item.action.toColor === color
                                      ));
                                      if (!match) return;
                                      onRunAction(match.action, match);
                                      setSelectedMoveWildCardId(null);
                                    }}
                                  >
                                    Move Here
                                  </button>
                                ) : null}
                              </p>
                              <div className="property-cards">
                                {player.properties[color].length === 0 && laneIsMoveTarget ? (
                                  <p className="property-lane-empty">Empty lane</p>
                                ) : null}
                                {player.properties[color].map((entry) => {
                                  const selectionCardPlayable = selectionCardPickingEnabled && (
                                    selectionPendingKind === 'deal_breaker'
                                      ? selectionTargetColors.has(color)
                                      : selectionTargetCardIds.has(entry.cardId)
                                  );
                                  const moveWildSourcePlayable = canDirectWildMove
                                    && player.id === prompt.playerId
                                    && moveWildSourceCardIds.has(entry.cardId);
                                  const moveWildSourceSelected = activeMoveWildCardId === entry.cardId;
                                  return (
                                    <div
                                      key={`${player.id}-${color}-${entry.cardId}`}
                                      className={`property-card-wrap ${stealHighlightCardIds.has(entry.cardId) ? 'is-stolen-card' : ''} ${selectionCardPlayable ? 'is-selection-target' : ''} ${moveWildSourceSelected ? 'is-move-source' : ''}`}
                                    >
                                      <CardView
                                        cardId={entry.cardId}
                                        size="sm"
                                        interactive={paymentSelectionEnabled || selectionCardPlayable || moveWildSourcePlayable}
                                        playable={paymentSelectionEnabled || selectionCardPlayable || moveWildSourcePlayable}
                                        selected={selectedPaymentCards.includes(entry.cardId) || selectedSelectionCardId === entry.cardId || moveWildSourceSelected}
                                        onClick={() => {
                                          if (paymentSelectionEnabled) {
                                            onPaymentCardToggle(entry.cardId);
                                            return;
                                          }
                                          if (selectionCardPlayable) {
                                            onPropertySelectionClick(player.id, color, entry.cardId);
                                            return;
                                          }
                                          if (moveWildSourcePlayable) {
                                            setSelectedMoveWildCardId((prev) => (prev === entry.cardId ? null : entry.cardId));
                                          }
                                        }}
                                        annotation={entry.assignedColor !== color ? `as ${colorLabel(entry.assignedColor)}` : undefined}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <p>Empty</p>
                      )}
                    </div>
                  </section>
                </article>
              );
              })}
            </div>
            {drawGhostCards.length > 0 ? (
              <div className="draw-animation-layer" aria-hidden="true">
                {drawGhostCards.map((ghost) => (
                  <div
                    key={ghost.id}
                    className="draw-ghost-card"
                    style={{
                      left: `${ghost.x}px`,
                      top: `${ghost.y}px`,
                      ['--draw-dx' as string]: `${ghost.dx}px`,
                      ['--draw-dy' as string]: `${ghost.dy}px`,
                      ['--draw-delay' as string]: `${ghost.delayMs}ms`,
                    }}
                  />
                ))}
              </div>
            ) : null}
              </section>

              {timelineExpanded ? (
                <RecentEvents events={game.history} enhancedGrouping={enhancedEventLog} />
              ) : (
                <section className={`panel timeline-collapsed-panel ${isMultiplayer ? 'is-live-room' : ''}`} aria-label="Event timeline hidden">
                  <p className="timeline-collapsed-kicker">Match Log</p>
                  <h3>{isMultiplayer ? 'Room Activity Collapsed' : 'Event Timeline Hidden'}</h3>
                  <p>
                    {isMultiplayer
                      ? 'Expand the log to inspect the live room timeline turn by turn.'
                      : 'Expand timeline to inspect the full turn-by-turn event history.'}
                    {latestEvent ? ` Latest: ${latestEvent.message}` : ''}
                  </p>
                </section>
              )}
            </div>

          </div>
        </div>
      </div>

      {chooser && !inputBlocked ? (
        <PlayChooser
          cardId={chooser.cardId}
          cardLabel={chooser.cardLabel}
          options={chooser.variants}
          onChoose={(id) => {
            const selected = chooser.variants.find((variant) => variant.id === id);
            if (!selected) return;
            onRunAction(selected.action, selected);
          }}
          onClose={onCloseChooser}
        />
      ) : null}

      {shouldShowShield && !over.done && !inputBlocked ? (
        <div className="shield" role="dialog" aria-modal="true">
          <div className="shield-card card-enter">
            <p className="overlay-kicker">Pass And Play</p>
            <h3>Pass Device</h3>
            <p>
              Next action: <strong>{game.players.find((player) => player.id === prompt.playerId)?.name ?? prompt.playerId}</strong>
            </p>
            <button onClick={onRevealTurn}>Reveal Turn</button>
          </div>
        </div>
      ) : null}

      {showReconnectOverlay ? (
        <div className="network-overlay" role="dialog" aria-modal="true" aria-label="Multiplayer connection status">
          <div className="network-card card-enter">
            <p className="overlay-kicker">Live Room Status</p>
            <h3>{reconnectOverlayTitle}</h3>
            <p>{reconnectOverlayDetail}</p>
            <div className="winner-actions">
              {onRefreshMultiplayer ? (
                <button type="button" onClick={onRefreshMultiplayer}>
                  Refresh
                </button>
              ) : null}
              {onExitMultiplayer ? (
                <button type="button" onClick={onExitMultiplayer}>
                  Exit Match
                </button>
              ) : null}
              {onForgetMultiplayer ? (
                <button type="button" onClick={onForgetMultiplayer}>
                  Forget Room
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isPaused && !over.done ? (
        <div className="paused-overlay" role="dialog" aria-modal="true" aria-label="Game paused">
          <div className="paused-card card-enter">
            <p className="overlay-kicker">Table Paused</p>
            <h3>Game Paused</h3>
            <p>{`${pauseReasonText ?? 'Gameplay is locked until you press Resume in the top bar.'}${disconnectCountdownText}`}</p>
          </div>
        </div>
      ) : null}

      {isMultiplayer && over.done ? (
        <div className="winner-overlay" role="dialog" aria-modal="true" aria-label="Multiplayer winner">
          <div className="winner-card card-enter">
            <p className="overlay-kicker">Room Complete</p>
            <h3>Match Complete</h3>
            <p>
              Winner: <strong>{winnerName ?? 'Unknown player'}</strong>
            </p>
            {multiplayerPreset ? <p>Selected preset: <strong>{multiplayerPreset.label}</strong>. {multiplayerPreset.readySummary}</p> : null}
            <p>Use Exit Match to leave and keep reconnect access, or Forget Room to disconnect permanently.</p>
            {onSetMultiplayerPreset ? (
              <div className="winner-actions">
                {MULTIPLAYER_SESSION_PRESET_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => onSetMultiplayerPreset(option.value)}
                    disabled={checkpointLoading}
                  >
                    {getMultiplayerSessionPresetDefinition(option.value).label}
                  </button>
                ))}
              </div>
            ) : null}
            {rematchStatusText ? <p>{rematchStatusText}</p> : null}
            <div className="winner-actions">
              {onRematchMultiplayer ? (
                <button type="button" onClick={onRematchMultiplayer} disabled={checkpointLoading || !canRematchMultiplayer}>
                  Play Rematch
                </button>
              ) : null}
              <button type="button" onClick={onExitMultiplayer} disabled={checkpointLoading}>
                Exit Match
              </button>
              <button type="button" onClick={onForgetMultiplayer} disabled={checkpointLoading}>
                Forget Room
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
