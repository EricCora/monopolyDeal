import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatPropertyColor, getCardDefinition, getCardDisplayName, type PropertyColor } from './cards/catalog';
import {
  applyAction,
  createGame,
  getLegalActions,
  getNextPrompt,
  getSetCompletionCount,
  isGameOver,
  type Action,
  type GameState,
  type LegalAction,
  type PlayerConfig,
} from './engine';
import {
  clearActiveGame,
  loadActiveGame,
  loadLifetimeStats,
  loadMatchHistory,
  saveActiveGame,
  saveLifetimeStats,
  saveMatchHistory,
} from './persistence/storage';
import { applyMatchToLifetime, buildMatchRecord, type LifetimeStatsV1, type MatchRecordV1 } from './stats';
import { CardView } from './ui/components/CardView';
import { HandFan } from './ui/components/HandFan';
import { PlayChooser, type ActionVariantView } from './ui/components/PlayChooser';
import { RecentEvents } from './ui/components/RecentEvents';
import './App.css';

type Screen = 'home' | 'setup' | 'game' | 'stats';

interface SetupState {
  playerCount: number;
  playerNames: string[];
}

interface CardActionVariant extends ActionVariantView {
  action: Action;
}

interface PlayChooserState {
  cardId: string;
  cardLabel: string;
  variants: CardActionVariant[];
}

type ReversibleActionType = 'play_to_bank' | 'play_property' | 'play_action' | 'move_wild';

function initialSetup(): SetupState {
  return {
    playerCount: 2,
    playerNames: ['Player 1', 'Player 2', 'Player 3', 'Player 4'],
  };
}

function colorLabel(color: PropertyColor): string {
  return formatPropertyColor(color);
}

function actionToCardId(action: Action): string | null {
  if (action.type === 'play_to_bank') return action.cardId;
  if (action.type === 'play_property') return action.cardId;
  if (action.type === 'play_action') return action.cardId;
  if (action.type === 'discard_card') return action.cardId;
  if (action.type === 'counter_response' && action.useJustSayNo && action.cardId) return action.cardId;
  return null;
}

function actionVariantId(action: Action): string {
  return JSON.stringify(action);
}

function cardMoneyValue(cardId: string): number {
  const def = getCardDefinition(cardId);
  return def.moneyValue ?? def.value;
}

function isReversibleActionType(actionType: Action['type']): actionType is ReversibleActionType {
  return actionType === 'play_to_bank' || actionType === 'play_property' || actionType === 'play_action' || actionType === 'move_wild';
}

function shouldRetainTurnSnapshots(nextState: GameState, nextPromptPlayerId: string): boolean {
  if (isGameOver(nextState).done) return false;
  if (nextState.turn.phase !== 'action') return false;
  if (nextState.players[nextState.currentPlayerIndex]?.id !== nextPromptPlayerId) return false;
  if (!nextState.pending) return true;
  return nextState.pending.kind === 'rent' || nextState.pending.kind === 'sly_deal' || nextState.pending.kind === 'forced_deal' || nextState.pending.kind === 'deal_breaker';
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [game, setGame] = useState<GameState | null>(null);
  const [setup, setSetup] = useState<SetupState>(initialSetup);
  const [error, setError] = useState<string | null>(null);
  const [revealedPlayerId, setRevealedPlayerId] = useState<string | null>(null);
  const [history, setHistory] = useState<MatchRecordV1[]>(() => loadMatchHistory());
  const [lifetime, setLifetime] = useState<LifetimeStatsV1>(() => loadLifetimeStats());
  const [chooser, setChooser] = useState<PlayChooserState | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedPaymentCards, setSelectedPaymentCards] = useState<string[]>([]);
  const [showDebugActions, setShowDebugActions] = useState(false);
  const [turnSnapshots, setTurnSnapshots] = useState<GameState[]>([]);
  const finalizedMatchRef = useRef<string | null>(null);

  useEffect(() => {
    if (!game) return;
    const handle = window.setTimeout(() => {
      saveActiveGame(game);
    }, 220);
    return () => window.clearTimeout(handle);
  }, [game]);

  const prompt = useMemo(() => (game ? getNextPrompt(game) : null), [game]);

  useEffect(() => {
    if (!game || !prompt) {
      if (turnSnapshots.length > 0) setTurnSnapshots([]);
      return;
    }
    if (turnSnapshots.length === 0) return;
    if (!shouldRetainTurnSnapshots(game, prompt.playerId)) {
      setTurnSnapshots([]);
    }
  }, [game, prompt, turnSnapshots.length]);

  const shouldShowShield = Boolean(game && prompt && !isGameOver(game).done && revealedPlayerId !== prompt.playerId);

  const legalActions = useMemo(() => {
    if (!game || !prompt) return [];
    return getLegalActions(game, prompt.playerId);
  }, [game, prompt]);

  const playerNameById = useCallback((playerId: string): string => {
    if (!game) return playerId;
    return game.players.find((player) => player.id === playerId)?.name ?? playerId;
  }, [game]);

  const describeCardAction = useCallback((action: Action): string => {
    if (action.type === 'play_to_bank') {
      const def = getCardDefinition(action.cardId);
      return `Bank as $${def.moneyValue ?? def.value}`;
    }

    if (action.type === 'play_property') {
      return `Play to ${colorLabel(action.color)}`;
    }

    if (action.type === 'play_action') {
      const targetName = action.targetPlayerId ? playerNameById(action.targetPlayerId) : null;
      if (action.color && targetName) return `Use on ${targetName} (${colorLabel(action.color)} rent)`;
      if (targetName) return `Use on ${targetName}`;
      if (action.color) return `Charge rent on ${colorLabel(action.color)}`;
      return `Play ${getCardDefinition(action.cardId).name}`;
    }

    if (action.type === 'counter_response' && action.useJustSayNo) {
      return 'Play Just Say No';
    }

    return 'Play card';
  }, [playerNameById]);

  const cardActionVariants = useMemo(() => {
    const variants = new Map<string, CardActionVariant[]>();
    legalActions.forEach((item, index) => {
      const cardId = actionToCardId(item.action);
      if (!cardId) return;
      const option: CardActionVariant = {
        id: `${actionVariantId(item.action)}-${index}`,
        label: describeCardAction(item.action),
        action: item.action,
      };
      const existing = variants.get(cardId) ?? [];
      existing.push(option);
      variants.set(cardId, existing);
    });
    return variants;
  }, [describeCardAction, legalActions]);

  const playableCardIds = useMemo(() => new Set(cardActionVariants.keys()), [cardActionVariants]);

  const contextualActions = useMemo(
    () => legalActions.filter((item) => !actionToCardId(item.action)),
    [legalActions],
  );
  const isMandatoryPrompt = Boolean(
    prompt && (prompt.kind === 'payment' || prompt.kind === 'selection' || prompt.kind === 'response' || prompt.kind === 'discard'),
  );
  const mainPhaseExhausted = Boolean(
    game && prompt?.kind === 'main' && game.turn.phase === 'action' && game.turn.playsUsed >= 3 && !game.pending,
  );
  const discardOverLimitCount = useMemo(() => {
    if (!game || !prompt || prompt.kind !== 'discard') return 0;
    const activePlayer = game.players.find((player) => player.id === prompt.playerId);
    if (!activePlayer) return 0;
    return Math.max(activePlayer.hand.length - 7, 0);
  }, [game, prompt]);
  const turnStatusText = useMemo(() => {
    if (!prompt) return '';
    if (prompt.kind === 'discard') {
      return discardOverLimitCount > 0
        ? `Discard ${discardOverLimitCount} card${discardOverLimitCount === 1 ? '' : 's'} to end turn.`
        : 'Discard step complete. You can pass turn.';
    }
    if (prompt.kind === 'payment') return 'Payment is required before any other action.';
    if (prompt.kind === 'response') return 'Respond to Just Say No chain.';
    if (prompt.kind === 'selection') return 'Resolve the pending card effect.';
    if (prompt.kind === 'draw') return 'Draw to start the turn.';
    if (mainPhaseExhausted) return '3/3 plays used. Pass turn or use non-play actions.';
    return 'Play cards from hand or pass turn.';
  }, [discardOverLimitCount, mainPhaseExhausted, prompt]);

  const pendingPayment = game?.pending?.kind === 'payment' ? game.pending.payload : null;
  const pendingPaymentPlayer = useMemo(() => {
    if (!game || !pendingPayment) return null;
    return game.players.find((player) => player.id === pendingPayment.targetPlayerId) ?? null;
  }, [game, pendingPayment]);

  const pendingPaymentCardIds = useMemo(() => {
    if (!pendingPaymentPlayer) return [];
    const propertyCards = (Object.keys(pendingPaymentPlayer.properties) as PropertyColor[]).flatMap((color) =>
      pendingPaymentPlayer.properties[color].map((entry) => entry.cardId),
    );
    return [...pendingPaymentPlayer.bank, ...propertyCards];
  }, [pendingPaymentPlayer]);

  const selectedPaymentTotal = useMemo(
    () => selectedPaymentCards.reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0),
    [selectedPaymentCards],
  );
  const totalPayableValue = useMemo(
    () => pendingPaymentCardIds.reduce((sum, cardId) => sum + cardMoneyValue(cardId), 0),
    [pendingPaymentCardIds],
  );
  const paymentCanSubmit = pendingPayment
    ? selectedPaymentCards.length > 0 && (selectedPaymentTotal >= pendingPayment.amount || totalPayableValue < pendingPayment.amount)
    : false;

  const startNewGame = () => {
    const players: PlayerConfig[] = setup.playerNames.slice(0, setup.playerCount).map((name, index) => ({
      id: `p${index + 1}`,
      name: name.trim() || `Player ${index + 1}`,
    }));

    const nextGame = createGame({ players, deckVersion: 'v1' });
    setGame(nextGame);
    setRevealedPlayerId(null);
    setScreen('game');
    setError(null);
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setTurnSnapshots([]);
  };

  const resumeGame = () => {
    const saved = loadActiveGame();
    if (!saved) {
      setError('No active saved game found.');
      return;
    }
    setGame(saved.gameState);
    setRevealedPlayerId(null);
    setScreen('game');
    setError(null);
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setTurnSnapshots([]);
  };

  const finalizeIfGameOver = (nextState: GameState) => {
    const status = isGameOver(nextState);
    if (!status.done || !status.winnerId) return;
    const matchId = `${nextState.createdAt}-${nextState.updatedAt}`;
    if (finalizedMatchRef.current === `final:${matchId}`) return;
    finalizedMatchRef.current = `final:${matchId}`;
    const matchRecord = buildMatchRecord(nextState);
    const nextHistory = [matchRecord, ...loadMatchHistory()].slice(0, 50);
    saveMatchHistory(nextHistory);
    setHistory(nextHistory);
    const nextLifetime = applyMatchToLifetime(loadLifetimeStats(), matchRecord);
    saveLifetimeStats(nextLifetime);
    setLifetime(nextLifetime);
    clearActiveGame();
  };

  const runAction = (action: Action) => {
    if (!game) return;
    const shouldSnapshot = isReversibleActionType(action.type) && prompt?.playerId === action.playerId;
    const snapshotBeforeAction = shouldSnapshot ? structuredClone(game) : null;
    const result = applyAction(game, action);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setError(null);
    const previousPromptPlayerId = prompt?.playerId ?? null;
    const nextPromptPlayerId = getNextPrompt(result.state).playerId;
    if (previousPromptPlayerId && previousPromptPlayerId !== nextPromptPlayerId) {
      setRevealedPlayerId(null);
    }
    if (snapshotBeforeAction) {
      setTurnSnapshots((prev) => [...prev, snapshotBeforeAction]);
    }
    if (!shouldRetainTurnSnapshots(result.state, nextPromptPlayerId)) {
      setTurnSnapshots([]);
    }
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setGame(result.state);
    finalizeIfGameOver(result.state);
  };

  const undoLastPlay = () => {
    if (turnSnapshots.length === 0) return;
    const previousState = turnSnapshots[turnSnapshots.length - 1];
    setGame(previousState);
    setTurnSnapshots((prev) => prev.slice(0, -1));
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setError(null);
  };

  const resetTurnPlays = () => {
    if (turnSnapshots.length === 0) return;
    const firstState = turnSnapshots[0];
    setGame(firstState);
    setTurnSnapshots([]);
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setError(null);
  };

  const handleCardClick = (cardId: string) => {
    if (!game || !prompt) return;
    if (isGameOver(game).done) return;
    if (revealedPlayerId !== prompt.playerId) return;
    if (!playableCardIds.has(cardId)) return;

    const variants = cardActionVariants.get(cardId) ?? [];
    if (variants.length === 0) return;

    setSelectedCardId(cardId);

    if (variants.length === 1) {
      runAction(variants[0].action);
      return;
    }

    const def = getCardDefinition(cardId);
    const cardLabel = def.kind === 'money' ? `$${def.value}` : def.name;
    setChooser({ cardId, cardLabel, variants });
  };

  const handlePaymentCardToggle = (cardId: string) => {
    if (!pendingPayment || !pendingPaymentCardIds.includes(cardId)) return;
    setSelectedPaymentCards((prev) => (prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]));
  };

  const submitSelectedPayment = () => {
    if (!pendingPayment || !paymentCanSubmit) return;
    runAction({
      type: 'pay_request',
      playerId: pendingPayment.targetPlayerId,
      cards: selectedPaymentCards,
    });
  };

  const actionDetailText = (item: LegalAction): string | null => {
    if (item.requestedAmount == null || item.collectibleCap == null) return null;
    const detail = `Ask $${item.requestedAmount}, likely collect up to $${item.collectibleCap}`;
    return item.requiresPropertyTransfer ? `${detail} (likely requires property transfer)` : detail;
  };

  const renderHome = () => (
    <section className="panel card-enter">
      <h1>Monopoly Deal Local</h1>
      <p>Pass-and-play on one laptop for 2-4 players.</p>
      <div className="actions">
        <button onClick={() => setScreen('setup')}>New Game</button>
        <button onClick={resumeGame}>Resume Saved Game</button>
        <button onClick={() => setScreen('stats')}>Stats & History</button>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );

  const renderSetup = () => (
    <section className="panel card-enter">
      <h2>New Local Game</h2>
      <label>
        Total Players
        <select
          value={setup.playerCount}
          onChange={(event) =>
            setSetup((prev) => ({
              ...prev,
              playerCount: Number(event.target.value),
            }))
          }
        >
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>
      {setup.playerNames.slice(0, setup.playerCount).map((name, index) => (
        <label key={`player-name-${index + 1}`}>
          Player {index + 1} Name
          <input
            value={name}
            onChange={(event) => {
              const value = event.target.value;
              setSetup((prev) => {
                const nextNames = [...prev.playerNames];
                nextNames[index] = value;
                return { ...prev, playerNames: nextNames };
              });
            }}
          />
        </label>
      ))}
      <div className="actions">
        <button onClick={startNewGame}>Start Match</button>
        <button onClick={() => setScreen('home')}>Back</button>
      </div>
    </section>
  );

  const renderHiddenHand = (cardCount: number) => {
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
  };

  const renderPlayerBoard = (state: GameState) =>
    state.players.map((player) => {
      const canSeeHand = revealedPlayerId === player.id;
      const isCurrent = state.players[state.currentPlayerIndex].id === player.id;
      const isPromptPlayer = prompt?.playerId === player.id;
      const handInteractive = Boolean(canSeeHand && prompt?.playerId === player.id && !isGameOver(state).done);
      const isPaymentPayer = pendingPayment?.targetPlayerId === player.id;
      const paymentSelectionEnabled = Boolean(isPaymentPayer && revealedPlayerId === player.id && !isGameOver(state).done);
      const inlineActions = isPromptPlayer
        ? (
            pendingPayment
              ? contextualActions.filter((item) => item.action.type !== 'pay_request')
              : prompt?.kind === 'selection'
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

          {isPromptPlayer && canSeeHand && !isGameOver(state).done ? (
            <section className="inline-action-panel">
              {isMandatoryPrompt && <p className="inline-must-act">Required: resolve this step before anything else.</p>}
              {mainPhaseExhausted && (
                <p className="inline-must-act">3/3 plays used. Pass turn or use non-play actions.</p>
              )}
              {prompt?.kind === 'discard' && (
                <p className="inline-discard-hint">
                  Hand size: <strong>{player.hand.length}</strong> | Limit: <strong>7</strong> | Need to discard:{' '}
                  <strong>{Math.max(player.hand.length - 7, 0)}</strong>
                </p>
              )}
              {prompt && <p className="inline-prompt-text">{prompt.text}</p>}
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
                  {selectedPaymentCards.length > 0 ? (
                    <p className="payment-selected">Selected: {selectedPaymentCards.map(getCardDisplayName).join(', ')}</p>
                  ) : (
                    <p className="payment-selected">Click cards in {player.name}&apos;s bank/properties to pay.</p>
                  )}
                  <button type="button" onClick={submitSelectedPayment} disabled={!paymentCanSubmit}>
                    Confirm Payment
                  </button>
                </div>
              ) : null}
              <div className="actions action-list inline-actions">
                {inlineActions.map((item, index) => (
                  <button key={`inline-${item.label}-${index}`} onClick={() => runAction(item.action)}>
                    {item.label}
                    {actionDetailText(item) ? <span className="action-detail">{actionDetailText(item)}</span> : null}
                  </button>
                ))}
                {inlineActions.length === 0 && !pendingPayment && (
                  <p>{prompt?.kind === 'discard' ? 'Discard from your hand to continue.' : 'Play cards from your hand.'}</p>
                )}
              </div>
              {turnSnapshots.length > 0 && prompt?.kind === 'main' ? (
                <div className="actions inline-actions">
                  <button type="button" onClick={undoLastPlay}>
                    Undo Last Play
                  </button>
                  <button type="button" onClick={resetTurnPlays}>
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
                  onCardClick={handleCardClick}
                  interactive={handInteractive}
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
                    onClick={() => handlePaymentCardToggle(cardId)}
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
                          onClick={() => handlePaymentCardToggle(entry.cardId)}
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
    });

  const renderGame = () => {
    if (!game || !prompt) return null;
    const over = isGameOver(game);
    const winner = game.players.find((player) => player.id === over.winnerId);
    return (
      <section className="panel game-panel">
        <div className="game-top">
          <div>
            <h2>Game Table</h2>
            <p>{prompt.text}</p>
            <p>
              Turn {game.turnCount} | Draw pile: {game.drawPile.length} | Discard: {game.discardPile.length}
            </p>
            {game.turn.phase === 'action' && <p>Plays used: {game.turn.playsUsed}/3</p>}
            {over.done && <p className="winner">Winner: {winner?.name ?? 'Unknown'}</p>}
          </div>
          <div className="actions">
            <button onClick={() => setScreen('home')}>Home</button>
            <button
              onClick={() => {
                clearActiveGame();
                setGame(null);
                setScreen('home');
              }}
            >
              End Match
            </button>
          </div>
        </div>

        <section className="action-panel">
          <h3>Turn Actions</h3>
          <p className={`turn-status ${isMandatoryPrompt ? 'is-required' : ''}`}>{turnStatusText}</p>
          <p>{isMandatoryPrompt ? 'Resolve the required action in the active player panel.' : 'Use the active player panel below to play cards.'}</p>
          <div className="debug-actions">
            <button type="button" onClick={() => setShowDebugActions((prev) => !prev)}>
              {showDebugActions ? 'Hide' : 'Show'} All Legal Actions ({legalActions.length})
            </button>
            {showDebugActions && (
              <ul className="debug-action-list">
                {legalActions.map((item, index) => (
                  <li key={`debug-${item.label}-${index}`}>{item.label}</li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <div className="players-grid">{renderPlayerBoard(game)}</div>

        <RecentEvents events={game.history} />

        {chooser && (
          <PlayChooser
            cardId={chooser.cardId}
            cardLabel={chooser.cardLabel}
            options={chooser.variants}
            onChoose={(id) => {
              const selected = chooser.variants.find((variant) => variant.id === id);
              if (!selected) return;
              runAction(selected.action);
            }}
            onClose={() => {
              setChooser(null);
              setSelectedCardId(null);
            }}
          />
        )}

        {shouldShowShield && !over.done && (
          <div className="shield" role="dialog" aria-modal="true">
            <div className="shield-card card-enter">
              <h3>Pass Device</h3>
              <p>
                Next action: <strong>{game.players.find((player) => player.id === prompt.playerId)?.name ?? prompt.playerId}</strong>
              </p>
              <button
                onClick={() => {
                  setRevealedPlayerId(prompt.playerId);
                }}
              >
                Reveal Turn
              </button>
            </div>
          </div>
        )}
      </section>
    );
  };

  const renderStats = () => {
    const lifetimeEntries = Object.values(lifetime.players).sort((a, b) => b.wins - a.wins);
    return (
      <section className="panel card-enter">
        <h2>Stats & History</h2>
        <div className="stats-grid">
          <article>
            <h3>Lifetime</h3>
            <ul>
              {lifetimeEntries.map((entry) => (
                <li key={entry.name}>
                  <strong>{entry.name}</strong>: {entry.wins} wins / {entry.gamesPlayed} games
                </li>
              ))}
              {lifetimeEntries.length === 0 && <li>No lifetime stats yet.</li>}
            </ul>
          </article>
          <article>
            <h3>Recent Matches</h3>
            <ul>
              {history.slice(0, 10).map((match) => (
                <li key={match.id}>
                  {new Date(match.endedAt).toLocaleString()} - Winner: {match.winnerName ?? 'N/A'} ({match.turnCount} turns)
                </li>
              ))}
              {history.length === 0 && <li>No completed matches yet.</li>}
            </ul>
          </article>
        </div>
        <div className="actions">
          <button onClick={() => setScreen('home')}>Back</button>
        </div>
      </section>
    );
  };

  return (
    <main>
      {screen === 'home' && renderHome()}
      {screen === 'setup' && renderSetup()}
      {screen === 'game' && renderGame()}
      {screen === 'stats' && renderStats()}

      <footer>
        <small>Monopoly Deal local pass-and-play.</small>
      </footer>
    </main>
  );
}

export default App;
