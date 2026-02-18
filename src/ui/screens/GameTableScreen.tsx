import { formatPropertyColor, getCardDisplayName, type PropertyColor } from '../../cards/catalog';
import {
  getSetCompletionCount,
  isGameOver,
  type Action,
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
import type { MultiplayerActivityFeedItem, MultiplayerConnectionState, MultiplayerReaction } from '../../network/multiplayerTypes';

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
  reactionsEnabled?: boolean;
  onSendReaction?: (reaction: MultiplayerReaction) => void;
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

const REACTIONS: Array<{ id: MultiplayerReaction; label: string }> = [
  { id: 'nice', label: 'Nice' },
  { id: 'wow', label: 'Wow' },
  { id: 'gg', label: 'GG' },
  { id: 'oops', label: 'Oops' },
];

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
  reactionsEnabled = false,
  onSendReaction,
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
  const winnerName = over.done && over.winnerId
    ? game.players.find((player) => player.id === over.winnerId)?.name ?? over.winnerId
    : null;

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

          {isMultiplayer && (reactionsEnabled || activityFeed.length > 0) ? (
            <section className="panel multiplayer-social-panel" aria-label="Multiplayer social">
              {reactionsEnabled && onSendReaction ? (
                <div className="actions multiplayer-reaction-actions">
                  {REACTIONS.map((reaction) => (
                    <button key={`reaction-${reaction.id}`} type="button" onClick={() => onSendReaction(reaction.id)} disabled={isPaused}>
                      {reaction.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {activityFeed.length > 0 ? (
                <ul className="multiplayer-activity-feed">
                  {activityFeed.slice(0, 6).map((entry) => (
                    <li key={entry.id}>{entry.message}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          <section className="table-surface" aria-label="Table surface">
            <div className="table-pile-row" aria-label="Card piles">
              <article className="table-pile-card">
                <h4>Draw Pile</h4>
                <p>{game.drawPile.length} cards</p>
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
                <article className={`player ${isCurrent ? 'active' : ''} ${isPaymentPayer ? 'is-payment-requested' : ''}`} key={player.id}>
                  <header>
                    <h3>{player.name}</h3>
                    <p>{getSetCompletionCount(player)} complete sets</p>
                    {isMultiplayer ? (
                      <p className={`connection-pill ${playerConnectionById[player.id]?.connected ? 'is-online' : 'is-offline'}`}>
                        {playerConnectionById[player.id]?.connected ? 'Online' : 'Disconnected'}
                      </p>
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

                      {isPaymentPayer && pendingPayment ? (
                        <div className="payment-panel">
                          <p>
                            <strong>{player.name}</strong> owes <strong>${pendingPayment.amount}</strong> for{' '}
                            <strong>{pendingPayment.reason}</strong>.
                          </p>
                          <p>
                            Selected total: <strong>${selectedPaymentTotal}</strong> of ${pendingPayment.amount}
                            {totalPayableValue < pendingPayment.amount ? ' (not enough assets available)' : ''}
                          </p>
                          {selectedPaymentTotal > pendingPayment.amount ? (
                            <p className="payment-selected">Overpay: ${selectedPaymentTotal - pendingPayment.amount}</p>
                          ) : null}
                          {selectedPaymentTotal < pendingPayment.amount && totalPayableValue < pendingPayment.amount ? (
                            <p className="payment-selected">
                              Shortfall accepted: payer only has ${totalPayableValue} total available.
                            </p>
                          ) : null}
                          {selectedPaymentCards.length > 0 ? (
                            <p className="payment-selected">Selected: {selectedPaymentCards.map(getCardDisplayName).join(', ')}</p>
                          ) : (
                            <p className="payment-selected">Click cards in {player.name}&apos;s bank/properties to pay.</p>
                          )}
                          <button type="button" onClick={onAutoSelectPayment} disabled={isPaused}>
                            Auto-select Payment
                          </button>
                          <button type="button" onClick={onSubmitSelectedPayment} disabled={!paymentCanSubmit || isPaused}>
                            Confirm Payment
                          </button>
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
                          <div className="property-lane" key={`${player.id}-${color}`}>
                            <p>
                              <span>{colorLabel(color)}:</span>
                            </p>
                            <div className="property-cards">
                              {player.properties[color].map((entry) => (
                                <CardView
                                  key={`${player.id}-${color}-${entry.cardId}`}
                                  cardId={entry.cardId}
                                  size="sm"
                                  interactive={paymentSelectionEnabled || selectionCardPickingEnabled}
                                  playable={paymentSelectionEnabled || selectionCardPickingEnabled}
                                  selected={selectedPaymentCards.includes(entry.cardId) || selectedSelectionCardId === entry.cardId}
                                  onClick={() => {
                                    if (paymentSelectionEnabled) {
                                      onPaymentCardToggle(entry.cardId);
                                      return;
                                    }
                                    if (selectionCardPickingEnabled) {
                                      onPropertySelectionClick(player.id, color, entry.cardId);
                                    }
                                  }}
                                  annotation={entry.assignedColor !== color ? `as ${colorLabel(entry.assignedColor)}` : undefined}
                                />
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
