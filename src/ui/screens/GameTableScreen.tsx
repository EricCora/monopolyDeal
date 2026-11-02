import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatPropertyColor, getCardDefinition, getCardDisplayName, type GameVariant, type PropertyColor } from '../../cards/catalog';
import { pendingRequestBanner } from './pendingRequestBanner';
import {
  getSetCompletionCount,
  isGameOver,
  type Action,
  type GameEvent,
  type GameState,
  type LegalAction,
  type PaymentRequest,
  type PlayerState,
  type PropertyCardPlacement,
  type TurnPrompt,
} from '../../engine';
import { playRestriction } from '../../engine/playRestriction';
import { CardFlights } from '../components/CardFlights';
import { cardSummary } from '../cards';
import { CardView } from '../components/CardView';
import { Confetti, GoldBurst } from '../components/Effects';
import { HandFan } from '../components/HandFan';
import { Icon } from '../components/icons';
import { PlayChooser, type ActionVariantView } from '../components/PlayChooser';
import { RecentEvents } from '../components/RecentEvents';
import { ActionRail } from '../layout/ActionRail';
import {
  MULTIPLAYER_SESSION_PRESET_OPTIONS,
  getMatchModeDefinition,
  getMultiplayerSessionPresetDefinition,
  type MatchMode,
  type MultiplayerSessionPresetId,
} from '../experience';
import type { FeedbackTone } from '../../app/useFeedback';
import { pickNewReaction } from '../table/newReaction';
import type { PostGameSummary } from '../../stats';
import { formatClock } from '../table/boardModel';
import { PromptPanel, type PanelChoice } from '../table/PromptPanel';
import { bankTotal, boardLanes, type BoardLane } from '../table/boardModel';
import {
  BankStack,
  DebtBadge,
  PlayerAvatar,
  SetCountBadge,
  SetLane,
  SetProgressBar,
  type TableCardBehavior,
} from '../table/tablePieces';
import type { CardInput } from '../tapPolicy';
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

interface TablePriorityNotice {
  title: string;
  detail: string;
  tone: 'required' | 'warning' | 'info' | 'positive';
}

interface TableActionHint {
  token: number;
  action: Extract<Action, { type: 'play_to_bank' | 'play_property' | 'discard_card' | 'move_wild' }>;
  source: 'local' | 'multiplayer';
}

interface GameTableScreenProps {
  mode?: 'local' | 'multiplayer';
  matchMode?: MatchMode;
  game: GameState;
  prompt: TurnPrompt;
  tableActionHint?: TableActionHint | null;
  isMultiplayerChatOpen?: boolean;
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
  enhancedEventLog?: boolean;
  coachHint: {
    title: string;
    summary: string;
    topActionLabel: string;
    alternatives: string[];
  } | null;
  turnSnapshotsCount: number;
  showDebugActions: boolean;
  actionDetailText: (item: LegalAction) => string | null;
  onFeedback?: (tone: FeedbackTone) => void;
  multiplayerSummary?: PostGameSummary | null;
  isSharingResult?: boolean;
  shareResultStatus?: string | null;
  onShareResult?: () => void;
  /** Null shows no clock, as in a game that hasn't started it yet. */
  turnClock?: { playerId: string; startedAt: number; deadlineMs: number | null } | null;
  series?: { bestOf: number; wins: Record<string, number>; gameNumber: number; winnerId?: string } | null;
  botSeatIds?: string[];
  isSpectator?: boolean;
  isTurnBased?: boolean;
  spectatorCount?: number;
  onWatchReplay?: () => void;
  /** Replays step the card flights by move, since their timestamps aren't meaningful. */
  flightKey?: number;
  /** Replays swap the action bar and hand controls for these. */
  replayBar?: ReactNode;
  onPauseToggle: () => void;
  /** Leaves the results for the room, where chat and the next game's setup are. */
  onBackToLobby?: () => void;
  onSetBotDifficulty?: (seatId: string, difficulty: 'easy' | 'hard') => void;
  seatDifficulties?: Record<string, 'easy' | 'hard'>;
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
  onCardClick: (cardId: string, input?: CardInput) => void;
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

interface TableStealAlert {
  key: string;
  mode: 'sly_deal' | 'forced_deal' | 'deal_breaker';
  sourcePlayerId: string;
  targetPlayerId: string;
  sourceName: string;
  targetName: string;
  cardIds: string[];
}

interface TableGhostCard {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  delayMs: number;
  kind: 'draw' | 'bank' | 'property' | 'discard' | 'wild';
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
  if (kind === 'debt') return 'Debt Repayment';
  return 'Discard Step';
}

function promptSpotlightLabel(kind: TurnPrompt['kind']): string {
  if (kind === 'draw') return 'Draw cards to open the turn';
  if (kind === 'main') return 'Play cards from the active hand';
  if (kind === 'response') return 'Resolve the interrupt window';
  if (kind === 'payment') return 'Pay with bank or property cards';
  if (kind === 'selection') return 'Choose a valid target on the table';
  if (kind === 'debt') return 'Repay outstanding debt before playing';
  return 'Discard down before passing the turn';
}

function shieldDetail(kind: TurnPrompt['kind'], turn: number): string {
  if (kind === 'draw') return `Turn ${turn}: start by drawing.`;
  if (kind === 'payment') return `Turn ${turn}: a payment is due.`;
  if (kind === 'response') return `Turn ${turn}: respond to an action.`;
  if (kind === 'selection') return `Turn ${turn}: a choice is waiting.`;
  if (kind === 'discard') return `Turn ${turn}: discard to end the turn.`;
  if (kind === 'debt') return `Turn ${turn}: a debt is due.`;
  return `Turn ${turn}`;
}

function statusIcon(kind: TurnPrompt['kind'], yours: boolean) {
  if (!yours) return 'hourglass';
  if (kind === 'draw') return 'draw';
  if (kind === 'debt') return 'forced_debt';
  if (kind === 'main') return 'tap';
  if (kind === 'response') return 'alert';
  if (kind === 'payment') return 'dollar';
  if (kind === 'selection') return 'sly_deal';
  return 'trash';
}

function multiplayerUpdatesLabel(state: MultiplayerPushState | undefined): string {
  if (state === 'connected') return 'Live';
  if (state === 'connecting') return 'Connecting';
  if (state === 'fallback' || state === 'unsupported') return 'Every few seconds';
  return 'When you refresh';
}

function pendingKindLabel(pending: GameState['pending']): string {
  if (!pending) return 'None';
  if (pending.kind === 'counter') return 'Counter';
  if (pending.kind === 'payment') return 'Payment';
  if (pending.kind === 'rent') return 'Rent Target';
  if (pending.kind === 'sly_deal') return 'Sly Deal';
  if (pending.kind === 'forced_deal') return 'Forced Deal';
  if (pending.kind === 'deal_breaker') return 'Deal Breaker';
  if (pending.kind === 'debt_card') return 'Debt Repayment';
  return 'No Mercy';
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

const readable = (text: string) => text.replace(/_/g, ' ');

interface SheetProps {
  label: string;
  title?: string;
  tall?: boolean;
  onClose: () => void;
  children: ReactNode;
}

function Sheet({ label, title, tall = false, onClose, children }: SheetProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return (
    <div className="sheet-overlay" role="presentation" onClick={onClose}>
      <div className={`sheet ${tall ? 'is-tall' : ''}`} role="dialog" aria-modal="true" aria-label={label} onClick={(event) => event.stopPropagation()}>
        <span className="sheet-grabber" aria-hidden="true" />
        {title ? <h3 className="sheet-title">{title}</h3> : null}
        <button type="button" className="sheet-close icon-button" onClick={onClose} aria-label={`Close ${label}`}><Icon name="close" /></button>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function PlaysPips({ used, total }: { used: number; total: number }) {
  return (
    <span className="plays-pips" role="img" aria-label={`${used} of ${total} plays used`}>
      {Array.from({ length: Math.max(total, 0) }, (_, index) => (
        <span key={index} className={index < used ? 'is-used' : ''} />
      ))}
    </span>
  );
}

function TurnClockPill({ clock, now, paused }: { clock: { startedAt: number; deadlineMs: number | null }; now: number; paused: boolean }) {
  const remaining = clock.deadlineMs == null ? null : clock.deadlineMs - now;
  const urgent = remaining != null && remaining <= 10_000;
  const shown = remaining == null ? now - clock.startedAt : Math.ceil(remaining / 1000) * 1000;
  return (
    <span
      className={`turn-clock ${remaining != null ? 'is-countdown' : ''} ${urgent ? 'is-urgent' : ''} ${paused ? 'is-paused' : ''}`}
      role="timer"
      aria-label={remaining != null ? `${formatClock(shown)} left this turn` : `This turn has taken ${formatClock(shown)}`}
    >
      <Icon name="hourglass" /> {formatClock(shown)}
    </span>
  );
}

const CONNECTION_TONE: Record<string, string> = { connected: 'is-good', reconnecting: 'is-warn', connecting: 'is-warn', disconnected: 'is-bad' };

/** A bank laid out so every card can be read. Tapping the pile spreads it, and the row scrolls. */
function BankFan({ player, variant, startOpen = false }: { player: PlayerState; variant: GameVariant; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const total = bankTotal(player, variant);
  return (
    <section className="bank-fan" aria-label={`Bank, ${total} dollars`}>
      <p className="section-title">Bank ${total}</p>
      {player.bank.length === 0 ? <p className="sheet-empty">Nothing banked.</p> : (
        <button
          type="button"
          className={`bank-fan-cards ${open ? 'is-open' : ''}`}
          aria-expanded={open}
          aria-label={open ? 'Stack the bank' : `Spread out all ${player.bank.length} bank cards`}
          style={{ ['--bank-count' as string]: player.bank.length }}
          onClick={() => setOpen((current) => !current)}
        >
          {player.bank.map((cardId, index) => (
            <span key={cardId} className="bank-fan-card" style={{ ['--i' as string]: index }}>
              <CardView cardId={cardId} width={open ? 104 : 88} gameVariant={variant} decorative />
            </span>
          ))}
        </button>
      )}
    </section>
  );
}

export function GameTableScreen({
  mode = 'local',
  matchMode = mode === 'multiplayer' ? 'live_online' : 'hot_seat',
  game,
  prompt,
  tableActionHint = null,
  isMultiplayerChatOpen = false,
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
  coachHint,
  turnSnapshotsCount,
  showDebugActions,
  actionDetailText,
  onFeedback,
  multiplayerSummary = null,
  isSharingResult = false,
  shareResultStatus = null,
  onShareResult,
  turnClock = null,
  series = null,
  botSeatIds = [],
  isSpectator = false,
  isTurnBased = false,
  spectatorCount = 0,
  onWatchReplay,
  flightKey,
  replayBar,
  onPauseToggle,
  onBackToLobby,
  onSetBotDifficulty,
  seatDifficulties,
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
  const variant: GameVariant = game.variant ?? 'classic';
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
  const deckRef = useRef<HTMLDivElement | null>(null);
  const discardPileRef = useRef<HTMLElement | null>(null);
  const visibleHandZoneByPlayerIdRef = useRef<Record<string, HTMLDivElement | null>>({});
  const visibleBankZoneByPlayerIdRef = useRef<Record<string, HTMLDivElement | null>>({});
  const propertyLaneByKeyRef = useRef<Record<string, HTMLDivElement | null>>({});
  const handledDrawEventKeyRef = useRef<string | null>(null);
  const handledActionHintTokenRef = useRef<number | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const hasDisconnectDeadline = Number.isFinite(disconnectDeadlineMs) && Number(disconnectDeadlineMs) > clockNow;
  const disconnectSecondsRemaining = hasDisconnectDeadline
    ? Math.max(0, Math.ceil((Number(disconnectDeadlineMs) - clockNow) / 1000))
    : 0;
  const disconnectCountdownText = hasDisconnectDeadline
    ? ` Timeout in ${disconnectSecondsRemaining}s.`
    : '';
  const [tableGhostCards, setTableGhostCards] = useState<TableGhostCard[]>([]);
  const [transitionTargetKey, setTransitionTargetKey] = useState<string | null>(null);
  const [transitionTargetTone, setTransitionTargetTone] = useState<'bank' | 'property' | 'discard' | 'wild' | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [discardsOpen, setDiscardsOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(null);
  const [inspectedOpponentId, setInspectedOpponentId] = useState<string | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [panelChoices, setPanelChoices] = useState<{ cardId: string; title: string; choices: PanelChoice[] } | null>(null);
  const [moveWildCardId, setMoveWildCardId] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<{ id: number; cardId: string; playerName: string } | null>(null);
  const [setBanner, setSetBanner] = useState<{ token: number; text: string } | null>(null);
  const [noStamp, setNoStamp] = useState<{ id: number; playerName: string } | null>(null);
  const [flyingReactions, setFlyingReactions] = useState<Array<{ id: number; emoji: string; x: number; y: number; dx: number; dy: number }>>([]);
  const screenRef = useRef<HTMLElement | null>(null);
  const lastReactionIdRef = useRef<number | null | undefined>(undefined);
  const stealAlert = resolveStealAlert(game, clockNow);
  const latestEvent = game.history.length > 0 ? game.history[game.history.length - 1] : null;
  const roomWatchFeed = useMemo(() => {
    if (!isMultiplayer) return [];
    const recentDockActivityIds = isMultiplayerChatOpen
      ? new Set(activityFeed.slice(0, 4).map((item) => item.id))
      : null;
    return activityFeed
      .filter((item) => item.kind !== 'chat' && item.kind !== 'reaction')
      .filter((item) => !recentDockActivityIds?.has(item.id))
      .slice(0, isMultiplayerChatOpen ? 2 : 4);
  }, [activityFeed, isMultiplayer, isMultiplayerChatOpen]);
  const activePlayer = game.players.find((player) => player.id === prompt.playerId) ?? game.players[game.currentPlayerIndex];
  const activePlayerName = activePlayer?.name ?? prompt.playerId;
  const maxPlaysPerTurn = game.ruleset?.maxPlaysPerTurn ?? 3;
  const maxHandAtEndTurn = game.ruleset?.maxHandAtEndTurn ?? 7;
  const winCompleteSets = game.ruleset?.winCompleteSets ?? 3;
  const playsRemaining = Math.max(0, maxPlaysPerTurn - game.turn.playsUsed);
  const playsRemainingLabel = `${playsRemaining} ${playsRemaining === 1 ? 'play' : 'plays'} left`;
  const pendingLabel = pendingKindLabel(game.pending);
  const discardNewestFirst = useMemo(() => [...game.discardPile].reverse(), [game.discardPile]);
  const winnerName = over.done && over.winnerId
    ? game.players.find((player) => player.id === over.winnerId)?.name ?? over.winnerId
    : null;
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

  // The player whose hand and board fill the bottom of the screen. With a single human
  // there is nobody to hide them from, even during a bot's turn.
  const humans = game.players.filter((player) => player.controller !== 'bot');
  const viewerId = isMultiplayer
    ? multiplayerSeatPlayerId
    : revealedPlayerId ?? (humans.length === 1 ? humans[0].id : null);
  const viewer = game.players.find((player) => player.id === viewerId) ?? null;
  const opponents = game.players.filter((player) => player.id !== viewerId);
  const revealedPlayerIdMatches = isMultiplayer || revealedPlayerId === prompt.playerId;
  const isViewersPrompt = Boolean(viewer && prompt.playerId === viewer.id && !over.done && revealedPlayerIdMatches);

  const selectionTargetCardIds = useMemo(() => {
    const targets = new Set<string>();
    if (prompt.kind !== 'selection') return targets;
    if (selectionPendingKind === 'sly_deal') {
      legalActions.forEach((item) => {
        if (item.action.type === 'sly_deal_pick') targets.add(item.action.cardId);
      });
      return targets;
    }
    if (selectionPendingKind === 'forced_deal') {
      legalActions.forEach((item) => {
        if (item.action.type !== 'forced_deal_pick') return;
        if (selectedSelectionCardId) {
          if (item.action.giveCardId === selectedSelectionCardId) targets.add(item.action.takeCardId);
          return;
        }
        targets.add(item.action.giveCardId);
      });
    }
    return targets;
  }, [legalActions, prompt.kind, selectedSelectionCardId, selectionPendingKind]);
  const moveWildActionsByCard = useMemo(() => {
    const map = new Map<string, LegalAction[]>();
    if (prompt.kind !== 'main' || game.pending) return map;
    legalActions.forEach((item) => {
      if (item.action.type !== 'move_wild') return;
      map.set(item.action.cardId, [...(map.get(item.action.cardId) ?? []), item]);
    });
    return map;
  }, [game.pending, legalActions, prompt.kind]);
  const canDirectWildMove = !inputBlocked && !over.done && prompt.kind === 'main' && !game.pending && revealedPlayerIdMatches;

  const turnPriorityNotice = useMemo<TablePriorityNotice | null>(() => {
    if (isPaused) {
      return { title: 'Match Paused', detail: `${pauseReasonText ?? 'Gameplay is paused. Resume when ready.'}${disconnectCountdownText}`, tone: 'warning' };
    }
    if (over.done) {
      return { title: winnerName ? `${winnerName} won the match` : 'Match Complete', detail: 'Review the final board state or return home to start a new game.', tone: 'positive' };
    }
    if (prompt.kind === 'payment' && pendingPayment) {
      const targetName = game.players.find((player) => player.id === pendingPayment.targetPlayerId)?.name ?? 'Target player';
      return { title: `${targetName} owes $${pendingPayment.amount}`, detail: `Resolve payment for ${pendingPayment.reason} before the turn can continue.`, tone: 'required' };
    }
    if (prompt.kind === 'response') {
      return { title: 'Counter Response Pending', detail: 'A counter response is blocking this turn. Resolve it to continue.', tone: 'required' };
    }
    if (prompt.kind === 'selection') {
      return { title: 'Target Selection Required', detail: 'Pick one of the highlighted targets to resolve the current action.', tone: 'required' };
    }
    if (prompt.kind === 'discard') {
      const discardNeeded = Math.max(discardOverLimitCount, 0);
      return { title: 'Discard Required', detail: `Discard ${discardNeeded} card${discardNeeded === 1 ? '' : 's'} before ending the turn.`, tone: 'required' };
    }
    if (prompt.kind === 'draw') {
      return { title: 'Draw Step', detail: `${activePlayerName} must draw before taking other actions.`, tone: 'info' };
    }
    if (mainPhaseExhausted) {
      return { title: 'Play Limit Reached', detail: `${maxPlaysPerTurn}/${maxPlaysPerTurn} plays used. Pass turn or use non-play options.`, tone: 'warning' };
    }
    return { title: 'Main Step Active', detail: `${activePlayerName} can make ${playsRemaining} more ${playsRemaining === 1 ? 'play' : 'plays'} this turn.`, tone: 'info' };
  }, [disconnectCountdownText, activePlayerName, discardOverLimitCount, game.players, isPaused, mainPhaseExhausted, maxPlaysPerTurn, over.done, pauseReasonText, pendingPayment, playsRemaining, prompt.kind, winnerName]);
  const matchModeLabel = getMatchModeDefinition(matchMode).tableKicker;
  const shieldPlayerName = game.players.find((player) => player.id === prompt.playerId)?.name ?? prompt.playerId;

  // Coming from a long lobby or setup page shouldn't open the table scrolled.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!transitionTargetKey) return undefined;
    const clearTimer = window.setTimeout(() => {
      setTransitionTargetKey((current) => (current === transitionTargetKey ? null : current));
      setTransitionTargetTone(null);
    }, 820);
    return () => window.clearTimeout(clearTimer);
  }, [transitionTargetKey]);

  // A soft glow runs ahead of a drawn card, from the deck toward the hand.
  useEffect(() => {
    for (let index = game.history.length - 1; index >= 0; index -= 1) {
      const event = game.history[index];
      const details = event.details;
      if (!details || details.kind !== 'draw') continue;
      const nextKey = drawEventKey(event);
      if (!nextKey || nextKey === handledDrawEventKeyRef.current) return undefined;
      handledDrawEventKeyRef.current = nextKey;
      if (reducedMotion || details.count <= 0) return undefined;
      if (revealedPlayerId !== details.playerId) return undefined;
      const sourceElement = deckRef.current;
      const destinationElement = visibleHandZoneByPlayerIdRef.current[details.playerId];
      if (!sourceElement || !destinationElement) return undefined;
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
        kind: 'draw' as const,
      }));
      setTableGhostCards(ghosts);
      const clearTimer = window.setTimeout(() => {
        setTableGhostCards((existing) => existing.filter((item) => !ghosts.some((ghost) => ghost.id === item.id)));
      }, 960);
      return () => window.clearTimeout(clearTimer);
    }
    return undefined;
  }, [game.history, reducedMotion, revealedPlayerId]);

  useEffect(() => {
    if (!tableActionHint || handledActionHintTokenRef.current === tableActionHint.token) return undefined;
    handledActionHintTokenRef.current = tableActionHint.token;
    if (reducedMotion) return undefined;

    const action = tableActionHint.action;
    const handElement = visibleHandZoneByPlayerIdRef.current[action.playerId];
    let sourceElement: HTMLElement | null = handElement;
    let destinationElement: HTMLElement | null = null;
    let nextTargetKey: string | null = null;
    let kind: TableGhostCard['kind'] = 'bank';
    let targetTone: 'bank' | 'property' | 'discard' | 'wild' = 'bank';

    if (action.type === 'play_to_bank') {
      destinationElement = visibleBankZoneByPlayerIdRef.current[action.playerId];
      nextTargetKey = `bank:${action.playerId}`;
    } else if (action.type === 'play_property') {
      destinationElement = propertyLaneByKeyRef.current[`${action.playerId}:${action.color}`];
      nextTargetKey = `property:${action.playerId}:${action.color}`;
      kind = 'property';
      targetTone = 'property';
    } else if (action.type === 'discard_card') {
      destinationElement = discardPileRef.current;
      nextTargetKey = 'discard';
      kind = 'discard';
      targetTone = 'discard';
    } else if (action.type === 'move_wild') {
      sourceElement = propertyLaneByKeyRef.current[`${action.playerId}:${action.fromColor}`];
      destinationElement = propertyLaneByKeyRef.current[`${action.playerId}:${action.toColor}`];
      nextTargetKey = `property:${action.playerId}:${action.toColor}`;
      kind = 'wild';
      targetTone = 'wild';
    }

    if (!destinationElement) return undefined;
    const sourceRect = (sourceElement ?? destinationElement).getBoundingClientRect();
    const destinationRect = destinationElement.getBoundingClientRect();
    const ghostId = `${tableActionHint.token}:${action.type}:${action.cardId}`;
    const ghost: TableGhostCard = {
      id: ghostId,
      x: sourceRect.left + sourceRect.width / 2 - 34,
      y: sourceRect.top + sourceRect.height / 2 - 46,
      dx: destinationRect.left + destinationRect.width / 2 - (sourceRect.left + sourceRect.width / 2),
      dy: destinationRect.top + destinationRect.height / 2 - (sourceRect.top + sourceRect.height / 2),
      delayMs: 0,
      kind,
    };
    setTransitionTargetKey(nextTargetKey);
    setTransitionTargetTone(targetTone);
    setTableGhostCards((existing) => [...existing, ghost]);
    const clearTimer = window.setTimeout(() => {
      setTableGhostCards((existing) => existing.filter((item) => item.id !== ghostId));
    }, 940);
    return () => window.clearTimeout(clearTimer);
  }, [reducedMotion, tableActionHint]);

  // Shows the card someone else just played, large enough to read across the table.
  const discardTop = game.discardPile[game.discardPile.length - 1] ?? null;
  const previousDiscardTopRef = useRef(discardTop);
  useEffect(() => {
    const previous = previousDiscardTopRef.current;
    previousDiscardTopRef.current = discardTop;
    if (!discardTop || discardTop === previous || reducedMotion) return undefined;
    if (getCardDefinition(discardTop, variant).kind !== 'action') return undefined;
    const lastLink = game.pending?.kind === 'counter' ? game.pending.payload.chain[game.pending.payload.chain.length - 1] : undefined;
    const actorId = lastLink?.playerId ?? game.players[game.currentPlayerIndex].id;
    if (getCardDefinition(discardTop, variant).actionKind === 'just_say_no') {
      // Anyone's Just Say No lands on the whole table, including your own.
      const name = lastLink ? game.players.find((player) => player.id === lastLink.playerId)?.name ?? '' : '';
      setNoStamp({ id: Date.now(), playerName: name });
      return undefined;
    }
    if (actorId === viewerId) return undefined;
    const name = game.players.find((player) => player.id === actorId)?.name ?? actorId;
    setSpotlight({ id: Date.now(), cardId: discardTop, playerName: name });
    return undefined;
  }, [discardTop, game.currentPlayerIndex, game.pending, game.players, reducedMotion, variant, viewerId]);

  useEffect(() => {
    if (!noStamp) return undefined;
    const timer = window.setTimeout(() => setNoStamp(null), 1300);
    return () => window.clearTimeout(timer);
  }, [noStamp]);

  // A reaction flies from whoever sent it to the middle of the table.
  useEffect(() => {
    const { reaction: latest, lastSeenId } = pickNewReaction(activityFeed, lastReactionIdRef.current);
    lastReactionIdRef.current = lastSeenId;
    if (!latest || reducedMotion) return undefined;
    const seat = latest.playerId
      ? screenRef.current?.querySelector(`[data-flip-origin="${latest.playerId}"]`) ?? screenRef.current?.querySelector('.player-board')
      : null;
    const start = seat?.getBoundingClientRect();
    const x = start ? start.left + start.width / 2 : window.innerWidth / 2;
    const y = start ? start.top + 24 : window.innerHeight / 2;
    const flight = { id: latest.id, emoji: reactionEmoji(latest.reaction), x, y, dx: window.innerWidth / 2 - x, dy: window.innerHeight * 0.4 - y };
    setFlyingReactions((current) => [...current, flight]);
    const timer = window.setTimeout(() => setFlyingReactions((current) => current.filter((entry) => entry.id !== flight.id)), 1300);
    return () => window.clearTimeout(timer);
  }, [activityFeed, reducedMotion]);

  useEffect(() => {
    if (!spotlight) return undefined;
    const timer = window.setTimeout(() => setSpotlight(null), 1500);
    return () => window.clearTimeout(timer);
  }, [spotlight]);

  // Completing a set gets a gold burst and a banner.
  const viewerCompleteSets = viewer ? getSetCompletionCount(viewer, variant) : 0;
  const previousSetsRef = useRef({ viewerId, count: viewerCompleteSets });
  useEffect(() => {
    const previous = previousSetsRef.current;
    previousSetsRef.current = { viewerId, count: viewerCompleteSets };
    if (previous.viewerId !== viewerId || viewerCompleteSets <= previous.count) return undefined;
    onFeedback?.('win');
    setSetBanner({ token: Date.now(), text: `Set complete! ${viewerCompleteSets} of ${winCompleteSets}` });
    return undefined;
  }, [onFeedback, viewerCompleteSets, viewerId, winCompleteSets]);

  useEffect(() => {
    if (!setBanner) return undefined;
    const timer = window.setTimeout(() => setSetBanner(null), 1600);
    return () => window.clearTimeout(timer);
  }, [setBanner]);

  // A nudge when the game comes round to you.
  const previousYoursRef = useRef(isViewersPrompt);
  useEffect(() => {
    if (isViewersPrompt && !previousYoursRef.current) onFeedback?.('turn');
    previousYoursRef.current = isViewersPrompt;
  }, [isViewersPrompt, onFeedback]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const promptSignature = `${prompt.playerId}:${prompt.kind}:${game.pending?.kind ?? ''}:${game.updatedAt}`;
  const [lastPromptSignature, setLastPromptSignature] = useState(promptSignature);
  if (promptSignature !== lastPromptSignature) {
    setLastPromptSignature(promptSignature);
    setNotice(null);
    setCoachOpen(false);
    setPanelChoices(null);
    setMoveWildCardId(null);
  }

  const saveCheckpointInteractive = () => {
    if (!onSaveCheckpoint || !isMultiplayerHost || isPaused) return;
    const nextName = window.prompt('Checkpoint name', `Turn ${game.turnCount}`);
    if (!nextName) return;
    onSaveCheckpoint(nextName);
  };

  const loadCheckpointInteractive = () => {
    if (!onLoadCheckpoint || !isMultiplayerHost || checkpointSlots.length === 0 || isPaused) return;
    const options = checkpointSlots.map((slot, index) => `${index + 1}. ${slot.name}`).join('\n');
    const chosen = window.prompt(`Load which checkpoint?\n${options}`, '1');
    const index = Number(chosen) - 1;
    if (!Number.isFinite(index) || index < 0 || index >= checkpointSlots.length) return;
    onLoadCheckpoint(checkpointSlots[index].id);
  };

  const deleteCheckpointInteractive = () => {
    if (!onDeleteCheckpoint || !isMultiplayerHost || checkpointSlots.length === 0) return;
    const options = checkpointSlots.map((slot, index) => `${index + 1}. ${slot.name}`).join('\n');
    const chosen = window.prompt(`Delete which checkpoint?\n${options}`, '1');
    const index = Number(chosen) - 1;
    if (!Number.isFinite(index) || index < 0 || index >= checkpointSlots.length) return;
    if (!window.confirm(`Delete checkpoint "${checkpointSlots[index].name}"?`)) return;
    onDeleteCheckpoint(checkpointSlots[index].id);
  };

  const showReconnectOverlay = isMultiplayer && !over.done && reconnectBlockingState;

  const reconnectOverlayTitle = (() => {
    if (multiplayerUiState === 'room_ended') return 'Room Ended';
    if (multiplayerUiState === 'timed_out') return 'Reconnect Window Expired';
    if (multiplayerUiState === 'resume_failed') return 'Could Not Resume Seat';
    if (multiplayerUiState === 'reconnect_handshake_pending') return 'Restoring Seat...';
    if (multiplayerUiState === 'resync_pending') return 'Syncing Game State...';
    return multiplayerConnectionState === 'reconnecting' ? 'Reconnecting...' : 'Connection Lost';
  })();

  const reconnectOverlayDetail = (() => {
    if (multiplayerUiState === 'room_ended') return pauseReasonText ?? 'This room is no longer available. Create or join a new room to continue.';
    if (multiplayerUiState === 'timed_out') return 'Your reconnect window expired. Rejoin with the room code to continue.';
    if (multiplayerUiState === 'resume_failed') return 'Automatic resume failed. Refresh room state or rejoin manually.';
    if (multiplayerUiState === 'reconnect_handshake_pending') return 'Re-authenticating your room seat before state recovery.';
    if (multiplayerUiState === 'resync_pending') return 'Applying the latest authoritative room snapshot. Inputs stay disabled until sync finishes.';
    return multiplayerConnectionState === 'reconnecting'
      ? 'Trying to restore your room session. You can wait here while reconnect attempts continue.'
      : `Unable to reconnect automatically. Refresh room state or exit the match.${disconnectCountdownText}`;
  })();

  const rejoinWindowLabel = hasDisconnectDeadline ? `${disconnectSecondsRemaining}s left` : reconnectBlockingState ? 'Recovering' : 'Standing by';
  const roomWatchSummaryItems = isMultiplayer && isMultiplayerChatOpen
    ? [
        { id: 'connection', label: 'Connection', value: connectionStatusLabel ?? 'Connected' },
        { id: 'remote-seats', label: 'Remote Seats', value: String(multiplayerRemoteSeatCount) },
        { id: 'rejoin-window', label: 'Rejoin Window', value: rejoinWindowLabel },
      ]
    : [];

  // Top bar text
  const currentPlayer = game.players[game.currentPlayerIndex];
  const turnTitle = currentPlayer.id === viewerId ? 'Your turn' : `${currentPlayer.name}'s turn`;
  const variantLabel = variant === 'no_mercy' ? 'No Mercy' : 'Classic';
  const seriesScore = series
    ? ` · Game ${series.gameNumber} · ${game.players.map((player) => series.wins[player.id] ?? 0).join('–')}`
    : '';
  const turnSubtitle = `Turn ${game.turnCount} · ${variantLabel}${seriesScore || ` · ${winCompleteSets} sets to win`}`;

  const statusText = (() => {
    if (over.done) return winnerName ? `${winnerName} won the match.` : 'Match complete.';
    if (!isViewersPrompt) {
      const thinking = game.players.find((player) => player.id === prompt.playerId && player.controller === 'bot');
      if (thinking) return `${thinking.name} is thinking…`;
      if (latestEvent && viewer) return readable(latestEvent.message);
      return `Waiting for ${shieldPlayerName}.`;
    }
    if (prompt.kind === 'draw') return 'Draw to start your turn.';
    if (prompt.kind === 'main') {
      return playsRemaining > 0
        ? `Play up to ${playsRemaining} more card${playsRemaining === 1 ? '' : 's'}, or end your turn.`
        : 'No plays left. End your turn.';
    }
    if (prompt.kind === 'discard') {
      const count = Math.max((viewer?.hand.length ?? 0) - maxHandAtEndTurn, 0);
      return `Discard ${count} card${count === 1 ? '' : 's'} before you can finish.`;
    }
    if (prompt.kind === 'debt') return 'Repay your debt: tap a card from your hand.';
    // Engine prompts start with the player's name, which reads oddly on your own screen.
    const prefix = `${shieldPlayerName}: `;
    const text = prompt.text.startsWith(prefix) ? prompt.text.slice(prefix.length) : prompt.text;
    return readable(text.slice(0, 1).toUpperCase() + text.slice(1));
  })();

  const latestEventLine = isViewersPrompt && latestEvent
    ? {
        text: readable(latestEvent.message),
        againstYou: latestEvent.details?.kind === 'property_steal' && latestEvent.details.targetPlayerId === viewerId,
      }
    : null;

  const drawAction = isViewersPrompt ? legalActions.find((item) => item.action.type === 'draw_cards') : undefined;
  const passAction = isViewersPrompt ? legalActions.find((item) => item.action.type === 'pass_turn') : undefined;
  const handOverLimit = Math.max((viewer?.hand.length ?? 0) - maxHandAtEndTurn, 0);
  const showUndo = turnSnapshotsCount > 0 && isViewersPrompt && (prompt.kind === 'main' || prompt.kind === 'discard' || prompt.kind === 'draw');

  const closeInspectors = () => {
    setInspectedCardId(null);
    setInspectedOpponentId(null);
  };

  const explainBlockedCard = (cardId: string) => {
    onFeedback?.('error');
    if (!viewer) return;
    let reason: string | null = null;
    try {
      reason = playRestriction(game, viewer.id, cardId);
    } catch {
      // An online snapshot can hide what the check needs. A shake alone still says no.
    }
    setNotice(reason);
  };

  const paymentSelectionEnabled = Boolean(pendingPayment && viewer && pendingPayment.targetPlayerId === viewer.id && revealedPlayerIdMatches && !over.done && !inputBlocked);
  const selectionCardPickingEnabled = Boolean(prompt.kind === 'selection' && revealedPlayerIdMatches && !over.done && !inputBlocked);

  const propertyBehavior = (player: PlayerState) => (entry: PropertyCardPlacement, lane: BoardLane): TableCardBehavior => {
    const color = lane.color;
    if (paymentSelectionEnabled && player.id === pendingPayment?.targetPlayerId) {
      return { interactive: true, selected: selectedPaymentCards.includes(entry.cardId), onClick: () => onPaymentCardToggle(entry.cardId) };
    }
    if (selectionCardPickingEnabled) {
      const playable = selectionPendingKind === 'deal_breaker'
        ? lane.isComplete && legalActions.some((item) => item.action.type === 'deal_breaker_pick' && item.action.color === color && (!item.action.setId || item.action.setId === lane.setId))
        : selectionTargetCardIds.has(entry.cardId);
      if (playable) {
        return {
          interactive: true,
          targeted: true,
          selected: selectedSelectionCardId === entry.cardId,
          onClick: () => onPropertySelectionClick(player.id, color, entry.cardId),
        };
      }
    }
    if (canDirectWildMove && player.id === prompt.playerId && moveWildActionsByCard.has(entry.cardId)) {
      return { interactive: true, selected: moveWildCardId === entry.cardId, onClick: () => { onFeedback?.('tap'); setMoveWildCardId(entry.cardId); } };
    }
    return { interactive: false, selected: selectedPaymentCards.includes(entry.cardId) };
  };

  const bankBehavior = (player: PlayerState) => (cardId: string): TableCardBehavior => {
    if (paymentSelectionEnabled && player.id === pendingPayment?.targetPlayerId) {
      return { interactive: true, selected: selectedPaymentCards.includes(cardId), onClick: () => onPaymentCardToggle(cardId) };
    }
    return { interactive: false };
  };

  const laneClassFor = (playerId: string, color: PropertyColor) => {
    const key = `property:${playerId}:${color}`;
    return transitionTargetKey === key ? `is-transition-target transition-tone-${transitionTargetTone ?? 'property'}` : '';
  };

  const renderLanes = (player: PlayerState, compact: boolean) => {
    const lanes = boardLanes(player, variant);
    const seen = new Set<PropertyColor>();
    return lanes.map((lane) => {
      const firstOfColor = !seen.has(lane.color);
      seen.add(lane.color);
      return (
        <SetLane
          key={lane.id}
          lane={lane}
          variant={variant}
          compact={compact}
          extraClassName={laneClassFor(player.id, lane.color)}
          laneRef={firstOfColor ? (node) => { propertyLaneByKeyRef.current[`${player.id}:${lane.color}`] = node; } : undefined}
          behavior={propertyBehavior(player)}
          onInspect={setInspectedCardId}
        />
      );
    });
  };

  const seatStatus = (player: PlayerState) => {
    const isCurrent = currentPlayer.id === player.id;
    const isPromptPlayer = prompt.playerId === player.id && !over.done && !inputBlocked;
    const isPaymentPayer = pendingPayment?.targetPlayerId === player.id;
    const tags: string[] = [];
    if (isPromptPlayer) tags.push('Priority');
    if (isCurrent && !isPromptPlayer) tags.push('Turn Seat');
    if (isPaymentPayer) tags.push('Payment Requested');
    return tags;
  };

  const inspectedOpponent = game.players.find((player) => player.id === inspectedOpponentId) ?? null;
  const inspectedCard = inspectedCardId ? getCardDefinition(inspectedCardId, variant) : null;
  const requestBanner = viewer ? pendingRequestBanner(game, viewer.id) : null;
  const moveWildOptions = moveWildCardId ? moveWildActionsByCard.get(moveWildCardId) ?? [] : [];
  const chooserNote = (() => {
    if (!chooser || !viewer) return null;
    try {
      return playRestriction(game, viewer.id, chooser.cardId);
    } catch {
      return null;
    }
  })();

  return (
    <section
      ref={screenRef}
      className={`game-table-screen state-${prompt.kind} ${isPaused ? 'is-paused' : ''} ${isMultiplayer ? 'is-live-room' : 'is-local-table'} ${isViewersPrompt ? 'is-your-move' : ''}`}
    >
      <h2 className="sr-only">{isMultiplayer ? 'Multiplayer Table' : 'Game Table'}</h2>
      <p className="sr-only">{matchModeLabel}</p>

      <header className="table-topbar">
        <div className="table-menu-wrap">
          <button
            type="button"
            className="icon-button"
            aria-label="Game menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <Icon name="menu" />
          </button>
          <div className={`table-menu ${menuOpen ? 'is-open' : ''}`} onClick={() => setMenuOpen(false)}>
            {(!isMultiplayer || isMultiplayerHost) ? (
              <button type="button" onClick={onPauseToggle}><Icon name={isPaused ? 'pass_go' : 'pause'} />{isPaused ? 'Resume' : 'Pause'}</button>
            ) : null}
            <button type="button" onClick={onOpenRules}><Icon name="book" />Rules Reference</button>
            <button type="button" onClick={() => setLogOpen(true)}><Icon name="list" />Game Log</button>
            {!isMultiplayer ? <button type="button" onClick={onOpenSavedGames}><Icon name="save" />Save Game</button> : null}
            <button type="button" onClick={onOpenSettings}><Icon name="gear" />Settings</button>
            {isMultiplayer ? (
              <>
                <hr />
                <button type="button" onClick={onRefreshMultiplayer} disabled={checkpointLoading}><Icon name="refresh" />Refresh</button>
                <button type="button" onClick={onExitMultiplayer} disabled={checkpointLoading}><Icon name="back" />Exit Match</button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    if (window.confirm('Forget this room? You give up your seat and cannot rejoin this match.')) onForgetMultiplayer?.();
                  }}
                  disabled={checkpointLoading}
                >
                  <Icon name="trash" />Forget Room
                </button>
              </>
            ) : null}
            {isMultiplayer && isMultiplayerHost ? (
              <>
                <hr />
                <button type="button" onClick={saveCheckpointInteractive} disabled={checkpointLoading || isPaused}>Save Checkpoint</button>
                <button type="button" onClick={loadCheckpointInteractive} disabled={checkpointLoading || isPaused || checkpointSlots.length === 0}>Load Checkpoint</button>
                <button type="button" onClick={deleteCheckpointInteractive} disabled={checkpointLoading || checkpointSlots.length === 0}>Delete Checkpoint</button>
              </>
            ) : null}
            <hr />
            <button type="button" onClick={onNavigateHome}><Icon name="back" />Home</button>
          </div>
        </div>

        <div className="table-title">
          <strong>{turnTitle}</strong>
          <span>{turnSubtitle}</span>
        </div>

        {turnClock && !over.done ? <TurnClockPill clock={turnClock} now={clockNow} paused={isPaused} /> : null}

        <PlaysPips used={game.turn.playsUsed} total={maxPlaysPerTurn} />

        <div className="pile-stack" aria-label="Card piles">
          <article className="draw-pile-card" aria-label={`${game.drawPile.length} cards in the deck`}>
            <div ref={deckRef} className="table-draw-deck">
              {Array.from({ length: Math.min(3, game.drawPile.length) }, (_, index) => (
                <span key={index} style={{ ['--i' as string]: index }}><CardView cardId="money_1#0" faceUp={false} width={26} decorative /></span>
              ))}
            </div>
            <span className="pile-count">{game.drawPile.length}</span>
          </article>
          <article
            ref={discardPileRef}
            className={`discard-pile-card ${transitionTargetKey === 'discard' ? `is-transition-target transition-tone-${transitionTargetTone ?? 'discard'}` : ''}`}
          >
            <button
              type="button"
              className="discard-pile-button"
              aria-label={`Discard pile, ${game.discardPile.length} cards`}
              onClick={() => setDiscardsOpen(true)}
            >
              {discardTop ? (
                <span data-flip-id={discardTop}><CardView cardId={discardTop} width={28} gameVariant={variant} decorative /></span>
              ) : (
                <span className="discard-empty" />
              )}
            </button>
          </article>
        </div>
      </header>

      {isMultiplayer ? (
        <div className="room-bar" aria-label="Room">
          <span className={`connection-pill ${CONNECTION_TONE[multiplayerConnectionState ?? 'connected'] ?? 'is-good'}`}>
            <span className="connection-dot" aria-hidden="true" />
            <span className="sr-only">{`Connection: ${connectionStatusLabel ?? 'Connected'}`}</span>
            <span aria-hidden="true">{isTurnBased ? 'Turn-by-Turn' : (connectionStatusLabel ?? 'Connected').replace(/^Connected \(Live\)$/, 'Live')}</span>
          </span>
          {multiplayerRoomCode ? <span className="room-bar-code">Room {multiplayerRoomCode}</span> : null}
          {isSpectator ? <span className="room-bar-tag">Watching</span> : null}
          {spectatorCount > 0 && !isSpectator ? <span className="room-bar-tag"><Icon name="eye" /> {spectatorCount}</span> : null}
        </div>
      ) : null}

      {isMultiplayer && hostChangeNotice ? (
        <section className="multiplayer-host-notice glass-panel" aria-label="Host change notice">
          <p>{hostChangeNotice}</p>
          {onDismissHostChangeNotice ? (
            <button type="button" className="glass-button" onClick={onDismissHostChangeNotice}>Dismiss</button>
          ) : null}
        </section>
      ) : null}

      <CardFlights className="table-main" flightKey={flightKey ?? game.updatedAt} enabled={!reducedMotion}>
        <div className={`opponents-area count-${opponents.length}`}>
          {opponents.map((player) => {
            const isPrompted = prompt.playerId === player.id;
            const isCurrent = currentPlayer.id === player.id;
            const connected = playerConnectionById[player.id]?.connected ?? true;
            const tags = seatStatus(player);
            const hasCards = player.bank.length > 0 || boardLanes(player, variant).length > 0;
            return (
              <article
                key={player.id}
                className={`player opponent-summary glass-panel ${isPrompted ? 'is-prompted' : ''} ${isCurrent ? 'active' : ''} ${stealAlert?.sourcePlayerId === player.id ? 'is-steal-source' : ''} ${stealAlert?.targetPlayerId === player.id ? 'is-steal-target' : ''} ${isMultiplayer && !connected ? 'is-offline-seat' : ''}`}
                data-flip-origin={player.id}
              >
                <button type="button" className="opponent-open" aria-label={`Show ${player.name}'s whole board`} onClick={() => setInspectedOpponentId(player.id)} />
                <header className="opponent-head">
                  <PlayerAvatar name={player.name} isBot={player.controller === 'bot' || botSeatIds.includes(player.id)} />
                  <h3>{player.name}</h3>
                  {botSeatIds.includes(player.id) ? <span className="opponent-bot-tag">Bot playing</span> : null}
                  {isMultiplayer && !connected && !isTurnBased ? (
                    <span className="opponent-offline" title="Disconnected" role="img" aria-label="Disconnected"><Icon name="wifiOff" /></span>
                  ) : null}
                  {recentReactionsByPlayerId.get(player.id) ? (
                    <span className="player-reaction-burst" aria-label={`${player.name} sent a reaction`}>
                      {recentReactionsByPlayerId.get(player.id)}
                    </span>
                  ) : null}
                  <SetCountBadge count={getSetCompletionCount(player, variant)} needed={winCompleteSets} />
                </header>
                <p className="opponent-stats">
                  <span aria-label={`${player.hand.length} cards in hand`}><Icon name="cards" /> {player.hand.length}</span>
                  <span aria-label={`Bank ${bankTotal(player, variant)} dollars`}><Icon name="banknote" /> ${bankTotal(player, variant)}</span>
                  {variant === 'no_mercy' ? <DebtBadge player={player} /> : null}
                </p>
                <span className="sr-only">{tags.join(', ')}</span>
                {hasCards ? (
                  <div className="mini-board">
                    {renderLanes(player, true)}
                    {player.bank.length > 0 ? (
                      <BankStack
                        player={player}
                        variant={variant}
                        compact
                        extraClassName={transitionTargetKey === `bank:${player.id}` ? `is-transition-target transition-tone-${transitionTargetTone ?? 'bank'}` : ''}
                        bankRef={(node) => { visibleBankZoneByPlayerIdRef.current[player.id] = node; }}
                        behavior={bankBehavior(player)}
                        onInspect={() => setInspectedOpponentId(player.id)}
                      />
                    ) : null}
                  </div>
                ) : null}
                <SetProgressBar player={player} variant={variant} />
              </article>
            );
          })}
        </div>

        <button
          type="button"
          className={`table-status ${isViewersPrompt ? 'is-yours' : ''}`}
          onClick={() => setLogOpen(true)}
          aria-label={`${statusText} Open game log`}
        >
          <span className="table-status-icon"><Icon name={statusIcon(prompt.kind, isViewersPrompt)} /></span>
          <span className="table-status-copy">
            <strong>{statusText}</strong>
            {latestEventLine ? <small className={latestEventLine.againstYou ? 'is-against-you' : ''}>{latestEventLine.text}</small> : null}
          </span>
        </button>

        {viewer ? (
          <article className={`player viewer-seat ${currentPlayer.id === viewer.id ? 'active' : ''} ${pendingPayment?.targetPlayerId === viewer.id ? 'is-payment-requested' : ''} is-self-seat`}>
            <div className="player-board glass-panel">
              <header className="player-board-head">
                <h3>{viewer.name}</h3>
                <SetCountBadge count={viewerCompleteSets} needed={winCompleteSets} />
                {variant === 'no_mercy' ? <DebtBadge player={viewer} /> : null}
              </header>
              {isMultiplayer ? <span className="sr-only">Your Seat</span> : null}
              <span className="sr-only">{seatStatus(viewer).join(', ')}</span>
              <div className="player-board-scroll">
                <div className="player-board-lanes">
                  <BankStack
                    player={viewer}
                    variant={variant}
                    extraClassName={transitionTargetKey === `bank:${viewer.id}` ? `is-transition-target transition-tone-${transitionTargetTone ?? 'bank'}` : ''}
                    bankRef={(node) => { visibleBankZoneByPlayerIdRef.current[viewer.id] = node; }}
                    behavior={bankBehavior(viewer)}
                    onInspect={() => setBankOpen(true)}
                  />
                  {renderLanes(viewer, false)}
                </div>
                {viewer.bank.length === 0 && boardLanes(viewer, variant).length === 0 ? (
                  <p className="player-board-empty">Your Bank and properties go here.</p>
                ) : null}
              </div>
            </div>

            <div className="action-bar">
              {replayBar ?? (<>
              {showUndo ? (
                <>
                  <button type="button" className="secondary-button is-icon" aria-label="Undo Last Play" onClick={onUndoLastPlay} disabled={inputBlocked}><Icon name="undo" /></button>
                  <button type="button" className="secondary-button is-icon" aria-label="Reset Turn Plays" onClick={onResetTurnPlays} disabled={inputBlocked}><Icon name="reset" /></button>
                </>
              ) : null}
              {coachHint && isViewersPrompt ? (
                <button type="button" className="secondary-button is-icon" aria-label="Coach hint" aria-expanded={coachOpen} onClick={() => setCoachOpen((open) => !open)}><Icon name="bulb" /></button>
              ) : null}
              {drawAction ? (
                <button type="button" className="primary-button is-accent" aria-label={drawAction.label} onClick={() => onRunAction(drawAction.action, drawAction)} disabled={inputBlocked}>
                  <Icon name="draw" /> Draw
                </button>
              ) : passAction ? (
                <button
                  type="button"
                  className={`primary-button ${playsRemaining === 0 ? 'is-accent' : 'is-quiet'}`}
                  aria-label={passAction.label}
                  onClick={() => onRunAction(passAction.action, passAction)}
                  disabled={inputBlocked}
                >
                  <Icon name="check" /> {handOverLimit > 0 ? `End Turn (${handOverLimit} over)` : 'End Turn'}
                </button>
              ) : (
                <span className="action-bar-spacer" />
              )}
              {coachOpen && coachHint ? (
                <aside className="coach-bubble glass-panel" aria-label="Coach bubble">
                  <div className="coach-bubble-head">
                    <span><Icon name="bulb" /> {coachHint.title}</span>
                    <button type="button" className="coach-close" aria-label="Close hint" onClick={() => setCoachOpen(false)}><Icon name="close" /></button>
                  </div>
                  <strong>{coachHint.topActionLabel}</strong>
                  <p>{coachHint.summary}</p>
                </aside>
              ) : null}
              </>)}
            </div>

            <section
              className="player-zone hand-zone"
              ref={(node) => { visibleHandZoneByPlayerIdRef.current[viewer.id] = node as HTMLDivElement | null; }}
            >
              <HandFan
                key={viewer.id}
                cards={viewer.hand}
                playableCardIds={isViewersPrompt ? playableCardIds : new Set()}
                selectedCardId={selectedCardId}
                onCardClick={(cardId, input) => {
                  onFeedback?.('tap');
                  onCardClick(cardId, input);
                }}
                onBlockedCard={explainBlockedCard}
                interactive={Boolean(isViewersPrompt && !inputBlocked)}
                fitMode={isViewersPrompt && prompt.kind === 'draw' ? 'rail' : 'auto'}
                gameVariant={variant}
                dealOpening={game.history.length === 0}
                reducedMotion={reducedMotion}
              />
            </section>
          </article>
        ) : (
          <div className="viewer-hidden">
            <Icon name="eyeOff" />
            <p>{isSpectator ? "You're watching. Every hand stays hidden." : 'Hands are hidden until the next player takes the device.'}</p>
          </div>
        )}
      </CardFlights>

      {viewer && isViewersPrompt && !isPaused && !replayBar ? (
        <PromptPanel
          game={game}
          prompt={prompt}
          viewer={viewer}
          legalActions={legalActions}
          contextualActions={contextualActions}
          disabled={inputBlocked}
          pendingPayment={pendingPayment}
          selectedPaymentCards={selectedPaymentCards}
          selectedPaymentTotal={selectedPaymentTotal}
          totalPayableValue={totalPayableValue}
          paymentCanSubmit={paymentCanSubmit}
          selectedSelectionCardId={selectedSelectionCardId}
          actionDetailText={actionDetailText}
          onRunAction={onRunAction}
          onPropertySelectionClick={onPropertySelectionClick}
          onPaymentCardToggle={onPaymentCardToggle}
          onAutoSelectPayment={onAutoSelectPayment}
          onSubmitSelectedPayment={onSubmitSelectedPayment}
          onOpenChoices={(cardId, title, choices) => setPanelChoices({ cardId, title, choices })}
        />
      ) : null}

      {notice ? (
        <button type="button" className="table-notice glass-panel" onClick={() => setNotice(null)} role="status">
          <Icon name="info" /> {notice}
        </button>
      ) : null}

      <div className="table-moments" aria-live="polite">
        {noStamp ? (
          <div key={noStamp.id} className="jsn-stamp" role="status">
            <span className="jsn-stamp-mark"><Icon name="just_say_no" /> Just Say No!</span>
            <span className="jsn-stamp-name">{noStamp.playerName}</span>
          </div>
        ) : null}
        {spotlight ? (
          <div key={spotlight.id} className="play-spotlight">
            <span className="play-spotlight-label glass-panel">{spotlight.playerName} played<span className="sr-only"> {getCardDisplayName(spotlight.cardId, variant)}</span></span>
            <CardView cardId={spotlight.cardId} width={210} gameVariant={variant} decorative />
          </div>
        ) : null}
        {setBanner ? (
          <div key={setBanner.token} className="set-banner-wrap">
            {!reducedMotion ? <GoldBurst /> : null}
            <span className="set-banner"><Icon name="star" /> {setBanner.text}</span>
          </div>
        ) : null}
      </div>

      {flyingReactions.length > 0 ? (
        <div className="reaction-layer" aria-hidden="true">
          {flyingReactions.map((flight) => (
            <span
              key={flight.id}
              className="reaction-flight"
              style={{
                left: `${flight.x}px`,
                top: `${flight.y}px`,
                ['--fly-x' as string]: `${flight.dx}px`,
                ['--fly-y' as string]: `${flight.dy}px`,
              }}
            >
              {flight.emoji}
            </span>
          ))}
        </div>
      ) : null}

      {tableGhostCards.length > 0 ? (
        <div className="draw-animation-layer" aria-hidden="true">
          {tableGhostCards.map((ghost) => (
            <div
              key={ghost.id}
              className={`draw-ghost-card kind-${ghost.kind}`}
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

      {/* The full record of the table. Everything here is one tap away through the status line. */}
      <aside className={`table-details ${logOpen ? 'is-open' : ''}`} aria-label="Table details">
        <div className="table-details-scrim" onClick={() => setLogOpen(false)} />
        <div className="table-details-sheet">
          <header className="table-details-head">
            <h3>Game Log</h3>
            <button type="button" className="icon-button" aria-label="Close game log" onClick={() => setLogOpen(false)}><Icon name="close" /></button>
          </header>
          <div className="table-details-body">
            <RecentEvents events={game.history} playerNames={game.players.map((player) => player.name)} />
            <details className="table-details-more">
            <summary>Turn Details</summary>
            {turnPriorityNotice ? (
              <section className={`table-priority-banner tone-${turnPriorityNotice.tone}`} aria-label="Turn priority">
                <p className="table-priority-title">{turnPriorityNotice.title}</p>
                <p className="table-priority-detail">{turnPriorityNotice.detail}</p>
              </section>
            ) : null}
            <div className="table-match-meta">
              <article className="table-match-chip"><p>Turn</p><p>{activePlayerName}</p></article>
              <article className="table-match-chip"><p>Step</p><p>{promptKindLabel(prompt.kind)}</p></article>
              <article className="table-match-chip">
                <p>Pressure</p>
                <p>{prompt.kind === 'discard' ? `${Math.max(discardOverLimitCount, 0)} discard needed` : playsRemainingLabel}</p>
              </article>
              <article className="table-match-chip"><p>Pending</p><p>{pendingLabel}</p></article>
              <article className="table-match-chip"><p>Table</p><p>Turn {game.turnCount} | Draw {game.drawPile.length} | Discard {game.discardPile.length}</p></article>
              {multiplayerPreset ? <article className="table-match-chip"><p>Preset</p><p>{multiplayerPreset.tableSummary}</p></article> : null}
              {isMultiplayer && checkpointSlots.length > 0 ? <article className="table-match-chip"><p>Checkpoints</p><p>{checkpointSlots.length} saved</p></article> : null}
            </div>
            {multiplayerPreset?.supportHints ? <p className="table-match-summary">Teaching preset: standard rules with clearer setup and support copy.</p> : null}
            {showDevStatusChip ? (
              <p className="table-match-debug">
                Dev: reconnect {devStatus?.reconnectPolicyActive ? 'on' : 'off'} | version guard {devStatus?.versionGuardActive ? 'on' : 'off'} | pause policy {devStatus?.disconnectPausePolicyActive ? 'on' : 'off'} | transport {devStatus?.transportMode ?? 'http_fallback'} | push {devStatus?.pushState ?? 'n/a'} | runtime {devStatus?.roomRuntimeState ?? 'n/a'}
              </p>
            ) : null}

            {isViewersPrompt ? (
              <section className="turn-brief" aria-label="This turn">
                <p className="section-title">{promptKindLabel(prompt.kind)}</p>
                <h4>{promptSpotlightLabel(prompt.kind)}</h4>
                {isMandatoryPrompt ? <p className="inline-must-act">Required: resolve this step before anything else.</p> : null}
                {mainPhaseExhausted ? <p className="inline-must-act">{maxPlaysPerTurn}/{maxPlaysPerTurn} plays used. Pass turn or use non-play actions.</p> : null}
                {prompt.kind === 'discard' && viewer ? (
                  <p className="inline-discard-hint">
                    Hand size: <strong>{viewer.hand.length}</strong> | Limit: <strong>{maxHandAtEndTurn}</strong> | Need to discard:{' '}
                    <strong>{Math.max(viewer.hand.length - maxHandAtEndTurn, 0)}</strong>
                  </p>
                ) : null}
                {requestBanner ? (
                  <div className={`action-request-banner tone-${requestBanner.tone}`}>
                    <p className="action-request-title">{requestBanner.title}</p>
                    <p className="action-request-detail">{requestBanner.detail}</p>
                  </div>
                ) : null}
                <p className="inline-prompt-text">{prompt.text}</p>
              </section>
            ) : null}

            <ActionRail
              isMultiplayer={isMultiplayer}
              isMandatoryPrompt={isMandatoryPrompt}
              turnStatusText={turnStatusText}
              turnPhase={game.turn.phase}
              promptKind={prompt.kind}
              playsUsed={game.turn.playsUsed}
              maxPlaysPerTurn={maxPlaysPerTurn}
              discardOverLimitCount={discardOverLimitCount}
              showRulesHints={showRulesHints}
              legalActions={legalActions}
              isPaused={isPaused}
              showDebugActions={showDebugActions}
              onToggleDebugActions={onToggleDebugActions}
            />

            {isMultiplayer ? (
              <section className="table-live-pulse" aria-label="Live room pulse">
                <p className="section-title">Live Room Pulse</p>
                <div className="table-match-meta">
                  {multiplayerRoomCode ? <article className="table-match-chip"><p>Room</p><p>{multiplayerRoomCode}</p></article> : null}
                  {multiplayerSeatPlayer ? <article className="table-match-chip"><p>Seat</p><p>{multiplayerSeatPlayer.name}</p></article> : null}
                  <article className="table-match-chip"><p>Connection</p><p>{connectionStatusLabel ?? 'Connected'}</p></article>
                  <article className="table-match-chip"><p>Rejoin Window</p><p>{rejoinWindowLabel}</p></article>
                  <article className="table-match-chip"><p>Updates</p><p>{multiplayerUpdatesLabel(multiplayerPushState)}</p></article>
                  <article className="table-match-chip"><p>Remote Seats</p><p>{multiplayerRemoteSeatCount}</p></article>
                </div>
              </section>
            ) : null}

            {coachHint ? (
              <section className="turn-brief" aria-label="AI coach hint">
                <h4>{coachHint.title}</h4>
                <p><strong>Recommended:</strong> {coachHint.topActionLabel}</p>
                <p>{coachHint.summary}</p>
                {coachHint.alternatives.length > 0 ? <p>Alternatives: {coachHint.alternatives.join(' | ')}</p> : null}
              </section>
            ) : null}

            {latestEvent ? (
              <section className="turn-brief last-action-panel" aria-label="Last action">
                <h4>Last Action</h4>
                <p className="last-action-meta">{eventTypeLabel(latestEvent.type)} | {eventAgeLabel(latestEvent.timestamp, clockNow)}</p>
                <p>{latestEvent.message}</p>
              </section>
            ) : null}

            {stealAlert ? (
              <section className="turn-brief table-steal-banner" aria-label="Property steal update">
                <p className="table-steal-banner-title">{stealAlert.sourceName} played {stealModeLabel(stealAlert.mode)} on {stealAlert.targetName}</p>
                <p className="table-steal-banner-detail">
                  Moved cards: {stealAlert.cardIds.slice(0, 3).map((cardId) => getCardDisplayName(cardId, variant)).join(', ')}
                  {stealAlert.cardIds.length > 3 ? ` +${stealAlert.cardIds.length - 3} more` : ''}
                </p>
              </section>
            ) : null}

            {isMultiplayer && (roomWatchFeed.length > 0 || roomWatchSummaryItems.length > 0) ? (
              <section className="turn-brief multiplayer-social-panel" aria-label="Room watch">
                <h4>Room Watch</h4>
                {isMultiplayerChatOpen ? <p className="multiplayer-social-note">Chat rail is covering live chatter. Room Watch stays on match-state signals.</p> : null}
                {roomWatchSummaryItems.length > 0 ? (
                  <div className="table-match-meta" aria-label="Room watch summary">
                    {roomWatchSummaryItems.map((item) => (
                      <article key={item.id} className="table-match-chip"><p>{item.label}</p><p>{item.value}</p></article>
                    ))}
                  </div>
                ) : null}
                {roomWatchFeed.length > 0 ? (
                  <ul className="multiplayer-activity-feed">
                    {roomWatchFeed.map((entry) => (
                      <li key={entry.id}><span>{entry.message}</span></li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}

            </details>
          </div>
        </div>
      </aside>

      {discardsOpen ? (
        <Sheet label="Discard pile" title="Discard Pile" onClose={() => setDiscardsOpen(false)}>
          <p className="sheet-subtitle">{game.discardPile.length} {game.discardPile.length === 1 ? 'card' : 'cards'}, newest first</p>
          {game.discardPile.length === 0 ? (
            <p className="sheet-empty">Nothing yet. Cards played as actions and discards land here.</p>
          ) : (
            <div className="discard-browser">
              {discardNewestFirst.map((cardId) => <CardView key={cardId} cardId={cardId} width={132} gameVariant={variant} decorative />)}
            </div>
          )}
        </Sheet>
      ) : null}

      {inspectedCardId && inspectedCard ? (
        <Sheet label={`Card: ${inspectedCard.name}`} onClose={closeInspectors}>
          <div className="card-inspector">
            <CardView cardId={inspectedCardId} width={190} gameVariant={variant} decorative />
            {inspectedCard.kind === 'action' || inspectedCard.kind === 'building' ? <p>{cardSummary(inspectedCard)}</p> : null}
          </div>
        </Sheet>
      ) : null}

      {bankOpen && viewer ? (
        <Sheet label="Your bank" onClose={() => setBankOpen(false)}>
          <BankFan player={viewer} variant={variant} startOpen />
        </Sheet>
      ) : null}

      {inspectedOpponent && !inspectedCardId ? (
        <Sheet label={`${inspectedOpponent.name}'s board`} tall onClose={closeInspectors}>
          <header className="opponent-sheet-head">
            <PlayerAvatar name={inspectedOpponent.name} isBot={inspectedOpponent.controller === 'bot'} />
            <strong>{inspectedOpponent.name}</strong>
            <span><Icon name="cards" /> {inspectedOpponent.hand.length} in hand</span>
          </header>
          {onSetBotDifficulty && (botSeatIds?.includes(inspectedOpponent.id) || inspectedOpponent.controller === 'bot') ? (
            <div className="sheet-bot-difficulty">
              <p className="section-title">Bot Difficulty</p>
              <div className="difficulty-picker" role="group" aria-label={`${inspectedOpponent.name}'s bot difficulty`}>
                {(['easy', 'hard'] as const).map((difficulty) => (
                  <button
                    key={difficulty}
                    type="button"
                    aria-pressed={seatDifficulties?.[inspectedOpponent.id] === difficulty}
                    className={seatDifficulties?.[inspectedOpponent.id] === difficulty ? 'is-selected' : ''}
                    onClick={() => onSetBotDifficulty(inspectedOpponent.id, difficulty)}
                  >
                    {difficulty === 'easy' ? 'Easy' : 'Hard'}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <BankFan player={inspectedOpponent} variant={variant} />
          <p className="section-title">Properties</p>
          <div className="opponent-sheet-lanes">
            {boardLanes(inspectedOpponent, variant).length === 0 ? <p className="sheet-empty">No properties yet.</p> : null}
            {boardLanes(inspectedOpponent, variant).map((lane) => (
              <div key={lane.id} className={`sheet-lane ${lane.isComplete ? 'is-complete' : ''}`} style={{ ['--lane-count' as string]: lane.entries.length }}>
                {lane.entries.map((entry, index) => (
                  <span key={entry.cardId} style={{ ['--i' as string]: index }}>
                    <CardView cardId={entry.cardId} width={78} gameVariant={variant} assignedColor={entry.assignedColor} decorative />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </Sheet>
      ) : null}

      {panelChoices ? (
        <PlayChooser
          cardId={panelChoices.cardId}
          cardLabel={panelChoices.title}
          gameVariant={variant}
          options={panelChoices.choices}
          onChoose={(id) => {
            const selected = panelChoices.choices.find((choice) => choice.id === id);
            setPanelChoices(null);
            if (selected) onRunAction(selected.item.action, selected.item);
          }}
          onClose={() => setPanelChoices(null)}
        />
      ) : null}

      {moveWildCardId && moveWildOptions.length > 0 ? (
        <PlayChooser
          cardId={moveWildCardId}
          cardLabel="Move Wild"
          gameVariant={variant}
          options={moveWildOptions.map((item, index) => {
            const action = item.action as Extract<Action, { type: 'move_wild' }>;
            const suffix = action.setId && !action.setId.includes('auto') ? ' (new set)' : '';
            return { id: String(index), label: `Move here: ${formatPropertyColor(action.toColor)}${suffix}` };
          })}
          onChoose={(id) => {
            const selected = moveWildOptions[Number(id)];
            setMoveWildCardId(null);
            if (selected) onRunAction(selected.action, selected);
          }}
          onClose={() => setMoveWildCardId(null)}
        />
      ) : null}

      {chooser && !inputBlocked ? (
        <PlayChooser
          cardId={chooser.cardId}
          cardLabel={chooser.cardLabel}
          options={chooser.variants}
          note={chooserNote}
          gameVariant={variant}
          onChoose={(id) => {
            const selected = chooser.variants.find((option) => option.id === id);
            if (!selected) return;
            onRunAction(selected.action, selected);
          }}
          onClose={onCloseChooser}
        />
      ) : null}

      {shouldShowShield && !over.done && !inputBlocked ? (
        <div className="shield" role="dialog" aria-modal="true" aria-label="Pass the device">
          <div className="shield-card card-enter">
            <div className="shield-cards" aria-hidden="true">
              <CardView cardId="money_1#0" faceUp={false} width={92} decorative />
              <CardView cardId="money_1#0" faceUp={false} width={92} decorative />
            </div>
            <p className="shield-kicker">Pass the device to</p>
            <h3>{shieldPlayerName}</h3>
            <p className="shield-detail">{shieldDetail(prompt.kind, game.turnCount)}</p>
            <div className="sr-only" aria-label="Next turn overview">
              <p>Next up: {shieldPlayerName}</p>
              <p>Opening step: {promptKindLabel(prompt.kind)}</p>
              <p>Turn: {game.turnCount}</p>
              <p>{promptSpotlightLabel(prompt.kind)}</p>
            </div>
            <button type="button" className="primary-button" onClick={onRevealTurn} aria-label={`Reveal Turn for ${shieldPlayerName}`}>
              <Icon name="eye" /> Show My Hand
            </button>
          </div>
        </div>
      ) : null}

      {showReconnectOverlay ? (
        <div className="network-overlay full-overlay" role="dialog" aria-modal="true" aria-label="Multiplayer connection status">
          <div className="overlay-card card-enter">
            <p className="section-title">Live Room Status</p>
            <h3>{reconnectOverlayTitle}</h3>
            <p>{reconnectOverlayDetail}</p>
            <div className="overlay-actions">
              {onRefreshMultiplayer ? <button type="button" className="secondary-button" onClick={onRefreshMultiplayer}>Refresh</button> : null}
              {onExitMultiplayer ? <button type="button" className="secondary-button" onClick={onExitMultiplayer}>Exit Match</button> : null}
              {onForgetMultiplayer ? <button type="button" className="secondary-button is-danger-text" onClick={onForgetMultiplayer}>Forget Room</button> : null}
            </div>
          </div>
        </div>
      ) : null}

      {isPaused && !over.done ? (
        <div className="paused-overlay full-overlay" role="dialog" aria-modal="true" aria-label="Game paused">
          <div className="overlay-card card-enter">
            <span className="overlay-icon"><Icon name="pause" /></span>
            <h3>Game Paused</h3>
            <p>{`${pauseReasonText ?? 'Gameplay is locked until you resume.'}${disconnectCountdownText}`}</p>
            {!isMultiplayer || isMultiplayerHost ? (
              <button type="button" className="primary-button" aria-label="Resume game" onClick={onPauseToggle}>Resume</button>
            ) : null}
            <button type="button" className="secondary-button" aria-label={isMultiplayer ? 'Leave the match' : 'Back to menu'} onClick={isMultiplayer ? onExitMultiplayer : onNavigateHome}>
              {isMultiplayer ? 'Exit Match' : 'Back to Menu'}
            </button>
          </div>
        </div>
      ) : null}

      {isMultiplayer && over.done ? (
        <div className="winner-overlay full-overlay" role="dialog" aria-modal="true" aria-label="Multiplayer winner">
          {!reducedMotion ? <Confetti /> : null}
          <div className="overlay-card card-enter">
            <span className="overlay-icon is-gold"><Icon name="trophy" /></span>
            <h3>{winnerName === viewer?.name ? 'You win!' : `${winnerName ?? 'Nobody'} wins!`}</h3>
            {series ? (
              <p className="series-score">
                {series.winnerId
                  ? `${series.winnerId === viewer?.id ? 'You win' : `${game.players.find((player) => player.id === series.winnerId)?.name ?? 'Someone'} wins`} the series `
                  : `Game ${series.gameNumber} of up to ${series.bestOf}: `}
                {game.players.map((player) => `${player.name} ${series.wins[player.id] ?? 0}`).join(', ')}
              </p>
            ) : null}
            <p className="sr-only">Match Complete</p>
            <p className="winner-line">Winner: <strong>{winnerName ?? 'Unknown player'}</strong></p>
            {multiplayerSummary ? (
              <>
                <p className="postgame-meta">{multiplayerSummary.turnCount} turns</p>
                <section className="glass-panel postgame-recap" aria-label="Recap highlights">
                  <div className="recap-row">
                    <span className="recap-icon"><Icon name="flag" /></span>
                    <div><p className="recap-title">Winning Move</p><p className="recap-text">{readable(multiplayerSummary.winningMove)}</p></div>
                  </div>
                  <div className="recap-row">
                    <span className="recap-icon"><Icon name="trend" /></span>
                    <div><p className="recap-title">Momentum Shift</p><p className="recap-text">{readable(multiplayerSummary.momentumShift)}</p></div>
                  </div>
                </section>
                <section className="glass-panel postgame-standings" aria-label="Final standings">
                  <ul className="postgame-standing-list">
                    {multiplayerSummary.players.map((row) => (
                      <li key={row.playerId} className={`postgame-standing ${row.isWinner ? 'is-winner' : ''}`}>
                        <span className="postgame-rank">{row.rank}</span>
                        <span className="postgame-who"><strong>{row.name}</strong></span>
                        <span className="postgame-score"><strong>{row.completeSets} {row.completeSets === 1 ? 'set' : 'sets'}</strong><small>Bank ${row.bankValue}</small></span>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            ) : null}
            {rematchStatusText ? <p>{rematchStatusText}</p> : null}
            {onBackToLobby ? (
              <button type="button" className="glass-button" onClick={onBackToLobby}>Back to Lobby</button>
            ) : null}
            {onRematchMultiplayer ? (
              <button type="button" className="primary-button" onClick={onRematchMultiplayer} disabled={checkpointLoading || !canRematchMultiplayer}>
                {series && !series.winnerId ? 'Next Game' : 'Play Rematch'}
              </button>
            ) : null}
            {onSetMultiplayerPreset ? (
              <div className="overlay-actions" aria-label="Next match preset">
                {MULTIPLAYER_SESSION_PRESET_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`glass-button ${multiplayerPresetId === option.value ? 'is-chosen' : ''}`}
                    onClick={() => onSetMultiplayerPreset(option.value)}
                    disabled={checkpointLoading}
                  >
                    {getMultiplayerSessionPresetDefinition(option.value).label}
                  </button>
                ))}
              </div>
            ) : null}
            {multiplayerPreset ? <p className="overlay-note">Selected preset: <strong>{multiplayerPreset.label}</strong>. {multiplayerPreset.readySummary}</p> : null}
            <div className="overlay-actions">
              {onShareResult && multiplayerSummary ? (
                <button type="button" className="secondary-button" onClick={onShareResult} disabled={isSharingResult} aria-label="Share Brag Image">
                  <Icon name="share" /> {isSharingResult ? 'Preparing...' : 'Share'}
                </button>
              ) : null}
              {onWatchReplay ? (
                <button type="button" className="secondary-button" onClick={onWatchReplay}><Icon name="pass_go" /> Watch Replay</button>
              ) : null}
              <button type="button" className="secondary-button" onClick={onExitMultiplayer} disabled={checkpointLoading}>Exit Match</button>
              <button type="button" className="secondary-button is-danger-text" onClick={onForgetMultiplayer} disabled={checkpointLoading}>Forget Room</button>
            </div>
            {shareResultStatus ? <p className="overlay-note">{shareResultStatus}</p> : null}
            <p className="overlay-note">Use Exit Match to leave and keep reconnect access, or Forget Room to disconnect permanently.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
