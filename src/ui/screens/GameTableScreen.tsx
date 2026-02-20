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
import type { MultiplayerActivityFeedItem, MultiplayerConnectionState } from '../../network/multiplayerTypes';

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

interface GameTableScreenProps {
  mode?: 'local' | 'multiplayer';
  game: GameState;
  prompt: TurnPrompt;
  isPaused: boolean;
  pauseReasonText?: string;
  connectionStatusLabel?: string;
  multiplayerConnectionState?: MultiplayerConnectionState;
  playerConnectionById?: Record<string, { connected: boolean; lastSeenAt: number; reconnectDeadlineMs: number }>;
  isMultiplayerHost?: boolean;
  checkpointSlots?: { id: string; name: string; savedAt: number }[];
  activityFeed?: MultiplayerActivityFeedItem[];
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
      detail: `${sourceName} played ${getCardDisplayName(pending.payload.actionCardId)}. Decide whether to play Just Say No or resolve the action.`,
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

export function GameTableScreen({
  mode = 'local',
  game,
  prompt,
  isPaused,
  pauseReasonText,
  connectionStatusLabel,
  multiplayerConnectionState,
  playerConnectionById = {},
  isMultiplayerHost = false,
  checkpointSlots = [],
  activityFeed = [],
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
  const drawPileDeckRef = useRef<HTMLDivElement | null>(null);
  const visibleHandZoneByPlayerIdRef = useRef<Record<string, HTMLDivElement | null>>({});
  const handledDrawEventKeyRef = useRef<string | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [drawGhostCards, setDrawGhostCards] = useState<DrawGhostCard[]>([]);
  const stealAlert = resolveStealAlert(game, clockNow);
  const latestEvent = game.history.length > 0 ? game.history[game.history.length - 1] : null;
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

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 450);
    return () => window.clearInterval(timer);
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

  return (
    <section className={`game-table-screen ${isPaused ? 'is-paused' : ''}`}>
      <TopBar
        title={isMultiplayer ? 'Multiplayer Table' : 'Game Table'}
        subtitle={prompt.text}
        meta={(
          <>
            <p>
              Turn {game.turnCount} | Draw pile: {game.drawPile.length} | Discard: {game.discardPile.length}
            </p>
            {game.turn.phase === 'action' ? <p>Plays used: {game.turn.playsUsed}/3</p> : null}
            {isMultiplayer && connectionStatusLabel ? (
              <p>Connection: {connectionStatusLabel}</p>
            ) : null}
            {isMultiplayer && checkpointSlots.length > 0 ? (
              <p>Checkpoints: {checkpointSlots.length}</p>
            ) : null}
          </>
        )}
        actions={(
          <>
            <button onClick={onNavigateHome}>Home</button>
            {isMultiplayer ? (
              <>
                <button onClick={onRefreshMultiplayer} disabled={isPaused || checkpointLoading}>Refresh</button>
                <button onClick={onExitMultiplayer} disabled={checkpointLoading}>Exit Match</button>
                <button onClick={onForgetMultiplayer} disabled={checkpointLoading}>Forget Room</button>
                {isMultiplayerHost ? (
                  <>
                    <button onClick={saveCheckpointInteractive} disabled={checkpointLoading || isPaused}>Save Checkpoint</button>
                    <button onClick={loadCheckpointInteractive} disabled={checkpointLoading || isPaused || checkpointSlots.length === 0}>Load Checkpoint</button>
                    <button onClick={deleteCheckpointInteractive} disabled={checkpointLoading || checkpointSlots.length === 0}>Delete Checkpoint</button>
                  </>
                ) : null}
              </>
            ) : (
              <button onClick={onOpenSavedGames}>Save Game</button>
            )}
            <button onClick={onOpenRules}>Rules Reference</button>
            <button onClick={onOpenSettings}>Settings</button>
            {(isMultiplayer ? isMultiplayerHost : true) ? (
              <button onClick={onPauseToggle}>{isPaused ? 'Resume' : 'Pause'}</button>
            ) : null}
          </>
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
        <ActionRail
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

        <div className="game-table-main">
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

          {isMultiplayer && activityFeed.length > 0 ? (
            <section className="panel multiplayer-social-panel" aria-label="Multiplayer social">
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

          {latestEvent ? (
            <section className="panel last-action-panel" aria-label="Last action">
              <h4>Last Action</h4>
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

          <section className="table-surface" aria-label="Table surface">
            <div className="table-pile-row" aria-label="Card piles">
              <article className="table-pile-card draw-pile-card">
                <h4>Draw Pile</h4>
                <p>{game.drawPile.length} cards</p>
                <div ref={drawPileDeckRef} className="table-draw-deck" aria-hidden="true">
                  <span className="table-draw-card table-draw-card-bottom" />
                  <span className="table-draw-card table-draw-card-top" />
                </div>
              </article>
              <article className="table-pile-card">
                <h4>Discard Pile</h4>
                <p>{game.discardPile.length} cards</p>
              </article>
            </div>

            <div className="players-grid">
              {game.players.map((player) => {
              const canSeeHand = revealedPlayerId === player.id;
              const isCurrent = game.players[game.currentPlayerIndex].id === player.id;
              const isPromptPlayer = prompt.playerId === player.id;
              const handFitMode = isPromptPlayer && prompt.kind === 'draw' ? 'rail' : 'auto';
              const handInteractive = Boolean(canSeeHand && prompt.playerId === player.id && !over.done && !isPaused);
              const isPaymentPayer = pendingPayment?.targetPlayerId === player.id;
              const paymentSelectionEnabled = Boolean(isPaymentPayer && revealedPlayerId === player.id && !over.done && !isPaused);
              const selectionCardPickingEnabled = Boolean(prompt.kind === 'selection' && revealedPlayerId === prompt.playerId && !over.done && !isPaused);
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
              const propertyColors = (Object.keys(player.properties) as PropertyColor[]).filter((color) => player.properties[color].length > 0);

              return (
                <article
                  className={`player ${isCurrent ? 'active' : ''} ${isPaymentPayer ? 'is-payment-requested' : ''} ${stealAlert?.sourcePlayerId === player.id ? 'is-steal-source' : ''} ${stealAlert?.targetPlayerId === player.id ? 'is-steal-target' : ''}`}
                  key={player.id}
                >
                  <header>
                    <h3>{player.name}</h3>
                    <p>{getSetCompletionCount(player)} complete sets</p>
                    {isMultiplayer ? (
                      <p className={`connection-pill ${playerConnectionById[player.id]?.connected ? 'is-online' : 'is-offline'}`}>
                        {playerConnectionById[player.id]?.connected ? 'Online' : 'Disconnected'}
                      </p>
                    ) : null}
                    {recentReactionsByPlayerId.get(player.id) ? (
                      <span className="player-reaction-burst" aria-label={`${player.name} sent a reaction`}>
                        {recentReactionsByPlayerId.get(player.id)}
                      </span>
                    ) : null}
                  </header>

                  {isPromptPlayer && canSeeHand && !over.done ? (
                    <section className="inline-action-panel">
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
                                <button type="button" onClick={onAutoSelectPayment} disabled={isPaused}>
                                  Auto-select Payment
                                </button>
                                <button type="button" onClick={onSubmitSelectedPayment} disabled={!paymentCanSubmit || isPaused}>
                                  {isShortfall ? 'Confirm Shortfall Payment' : 'Confirm Payment'}
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      ) : null}

                      <div className="actions action-list inline-actions">
                        {inlineActions.map((item, index) => (
                          <button
                            key={`inline-${item.label}-${index}`}
                            onClick={() => onRunAction(item.action, item)}
                            disabled={isPaused}
                          >
                            {item.label}
                            {actionDetailText(item) ? <span className="action-detail">{actionDetailText(item)}</span> : null}
                          </button>
                        ))}
                        {inlineActions.length === 0 && !pendingPayment ? (
                          <p>{prompt.kind === 'discard' ? 'Discard from your hand to continue.' : 'Play cards from your hand.'}</p>
                        ) : null}
                      </div>

                      {turnSnapshotsCount > 0 && (prompt.kind === 'main' || prompt.kind === 'discard' || prompt.kind === 'draw') ? (
                        <div className="actions inline-actions">
                          <button type="button" onClick={onUndoLastPlay} disabled={isPaused}>
                            Undo Last Play
                          </button>
                          <button type="button" onClick={onResetTurnPlays} disabled={isPaused}>
                            Reset Turn Plays
                          </button>
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  <section>
                    <strong>Hand</strong>
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

                  <section>
                    <strong>Bank</strong>
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

                  <section>
                    <strong>Properties</strong>
                    <div className="zone-properties">
                      {propertyColors.length > 0 ? (
                        propertyColors.map((color) => (
                          <div
                            className={`property-lane ${player.properties[color].some((entry) => stealHighlightCardIds.has(entry.cardId)) ? 'is-steal-lane' : ''} ${selectionCardPickingEnabled && selectionPendingKind === 'deal_breaker' && selectionTargetColors.has(color) ? 'is-selection-target' : ''}`}
                            key={`${player.id}-${color}`}
                          >
                            <p>
                              <span>{colorLabel(color)}:</span>
                            </p>
                            <div className="property-cards">
                              {player.properties[color].map((entry) => (
                                (() => {
                                  const selectionCardPlayable = selectionCardPickingEnabled && (
                                    selectionPendingKind === 'deal_breaker'
                                      ? selectionTargetColors.has(color)
                                      : selectionTargetCardIds.has(entry.cardId)
                                  );
                                  return (
                                <div
                                  key={`${player.id}-${color}-${entry.cardId}`}
                                  className={`property-card-wrap ${stealHighlightCardIds.has(entry.cardId) ? 'is-stolen-card' : ''} ${selectionCardPlayable ? 'is-selection-target' : ''}`}
                                >
                                  <CardView
                                    cardId={entry.cardId}
                                    size="sm"
                                    interactive={paymentSelectionEnabled || selectionCardPlayable}
                                    playable={paymentSelectionEnabled || selectionCardPlayable}
                                    selected={selectedPaymentCards.includes(entry.cardId) || selectedSelectionCardId === entry.cardId}
                                    onClick={() => {
                                      if (paymentSelectionEnabled) {
                                        onPaymentCardToggle(entry.cardId);
                                        return;
                                      }
                                      if (selectionCardPlayable) {
                                        onPropertySelectionClick(player.id, color, entry.cardId);
                                      }
                                    }}
                                    annotation={entry.assignedColor !== color ? `as ${colorLabel(entry.assignedColor)}` : undefined}
                                  />
                                </div>
                                  );
                                })()
                              ))}
                            </div>
                          </div>
                        ))
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

          <RecentEvents events={game.history} enhancedGrouping={enhancedEventLog} />
        </div>
      </div>

      {chooser && !isPaused ? (
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

      {shouldShowShield && !over.done && !isPaused ? (
        <div className="shield" role="dialog" aria-modal="true">
          <div className="shield-card card-enter">
            <h3>Pass Device</h3>
            <p>
              Next action: <strong>{game.players.find((player) => player.id === prompt.playerId)?.name ?? prompt.playerId}</strong>
            </p>
            <button onClick={onRevealTurn}>Reveal Turn</button>
          </div>
        </div>
      ) : null}

      {isMultiplayer && !over.done && (multiplayerConnectionState === 'reconnecting' || multiplayerConnectionState === 'disconnected') ? (
        <div className="network-overlay" role="dialog" aria-modal="true" aria-label="Multiplayer connection status">
          <div className="network-card card-enter">
            <h3>{multiplayerConnectionState === 'reconnecting' ? 'Reconnecting...' : 'Connection Lost'}</h3>
            <p>
              {multiplayerConnectionState === 'reconnecting'
                ? 'Trying to restore your room session. You can wait here while reconnect attempts continue.'
                : 'Unable to reconnect automatically. Refresh room state or exit the match.'}
            </p>
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
            <h3>Game Paused</h3>
            <p>{pauseReasonText ?? 'Gameplay is locked until you press Resume in the top bar.'}</p>
          </div>
        </div>
      ) : null}

      {isMultiplayer && over.done ? (
        <div className="winner-overlay" role="dialog" aria-modal="true" aria-label="Multiplayer winner">
          <div className="winner-card card-enter">
            <h3>Match Complete</h3>
            <p>
              Winner: <strong>{winnerName ?? 'Unknown player'}</strong>
            </p>
            <p>Use Exit Match to leave and keep reconnect access, or Forget Room to disconnect permanently.</p>
            <div className="winner-actions">
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
