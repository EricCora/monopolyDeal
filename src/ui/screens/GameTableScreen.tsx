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

interface GameTableScreenProps {
  game: GameState;
  prompt: TurnPrompt;
  isPaused: boolean;
  legalActions: LegalAction[];
  contextualActions: LegalAction[];
  revealedPlayerId: string | null;
  playableCardIds: Set<string>;
  selectedCardId: string | null;
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
  turnSnapshotsCount: number;
  showDebugActions: boolean;
  actionDetailText: (item: LegalAction) => string | null;
  onPauseToggle: () => void;
  onOpenRules: () => void;
  onOpenSavedGames: () => void;
  onOpenSettings: () => void;
  onToggleDebugActions: () => void;
  onRunAction: (action: Action, source?: LegalAction) => void;
  onCardClick: (cardId: string) => void;
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

export function GameTableScreen({
  game,
  prompt,
  isPaused,
  legalActions,
  contextualActions,
  revealedPlayerId,
  playableCardIds,
  selectedCardId,
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
  turnSnapshotsCount,
  showDebugActions,
  actionDetailText,
  onPauseToggle,
  onOpenRules,
  onOpenSavedGames,
  onOpenSettings,
  onToggleDebugActions,
  onRunAction,
  onCardClick,
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

  return (
    <section className={`game-table-screen ${isPaused ? 'is-paused' : ''}`}>
      <TopBar
        title="Game Table"
        subtitle={prompt.text}
        meta={(
          <>
            <p>
              Turn {game.turnCount} | Draw pile: {game.drawPile.length} | Discard: {game.discardPile.length}
            </p>
            {game.turn.phase === 'action' ? <p>Plays used: {game.turn.playsUsed}/3</p> : null}
          </>
        )}
        actions={(
          <>
            <button onClick={onNavigateHome}>Home</button>
            <button onClick={onOpenRules}>Rules Reference</button>
            <button onClick={onOpenSavedGames}>Save Game</button>
            <button onClick={onOpenSettings}>Settings</button>
            <button onClick={onPauseToggle}>{isPaused ? 'Resume' : 'Pause'}</button>
          </>
        )}
      />

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
          <div className="players-grid">
            {game.players.map((player) => {
              const canSeeHand = revealedPlayerId === player.id;
              const isCurrent = game.players[game.currentPlayerIndex].id === player.id;
              const isPromptPlayer = prompt.playerId === player.id;
              const handFitMode = isPromptPlayer && prompt.kind === 'draw' ? 'rail' : 'auto';
              const handInteractive = Boolean(canSeeHand && prompt.playerId === player.id && !over.done && !isPaused);
              const isPaymentPayer = pendingPayment?.targetPlayerId === player.id;
              const paymentSelectionEnabled = Boolean(isPaymentPayer && revealedPlayerId === player.id && !over.done && !isPaused);
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
                <article className={`player ${isCurrent ? 'active' : ''}`} key={player.id}>
                  <header>
                    <h3>{player.name}</h3>
                    <p>{getSetCompletionCount(player)} complete sets</p>
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
                                  interactive={paymentSelectionEnabled}
                                  playable={paymentSelectionEnabled}
                                  selected={selectedPaymentCards.includes(entry.cardId)}
                                  onClick={() => onPaymentCardToggle(entry.cardId)}
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

          <RecentEvents events={game.history} />
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

      {isPaused && !over.done ? (
        <div className="paused-overlay" role="dialog" aria-modal="true" aria-label="Game paused">
          <div className="paused-card card-enter">
            <h3>Game Paused</h3>
            <p>Gameplay is locked until you press Resume in the top bar.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
