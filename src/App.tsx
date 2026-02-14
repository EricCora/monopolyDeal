import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatPropertyColor, getCardDefinition, type PropertyColor } from './cards/catalog';
import {
  applyAction,
  createGame,
  getLegalActions,
  getNextPrompt,
  getSuggestedPaymentCards,
  isGameOver,
  type Action,
  type GameState,
  type LegalAction,
  type PlayerConfig,
} from './engine';
import {
  clearLifetimeStats,
  clearMatchHistory,
  clearActiveGame,
  incrementGrowthMetric,
  loadActiveGame,
  loadLifetimeStats,
  loadMatchHistory,
  loadUiPreferences,
  saveActiveGame,
  saveLifetimeStats,
  saveMatchHistory,
  saveUiPreferences,
  type UiPreferencesV1,
} from './persistence/storage';
import {
  applyMatchToLifetime,
  buildMatchRecord,
  createDevStatsFixture,
  buildPostGameSummary,
  type LifetimeStatsV1,
  type MatchRecordV1,
  type PostGameSummary,
} from './stats';
import type { ActionVariantView } from './ui/components/PlayChooser';
import { GameShell } from './ui/layout/GameShell';
import { ActionConfirmDialog } from './ui/components/ActionConfirmDialog';
import { RulesDrawer } from './ui/components/RulesDrawer';
import { GameTableScreen } from './ui/screens/GameTableScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { PostGameScreen } from './ui/screens/PostGameScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { SetupScreen } from './ui/screens/SetupScreen';
import { StatsScreen } from './ui/screens/StatsScreen';
import { generatePostGameSharePng, postGameShareFilename } from './ui/share/postGameShare';
import type { RiskyActionConfirmation, SetupViewModel, ShareStatus } from './ui/types';
import './App.css';

type Screen = 'home' | 'setup' | 'game' | 'stats' | 'settings' | 'game_over';
type SettingsBackScreen = 'home' | 'game';
type DevSeedStatus = 'seeded' | 'already-populated' | 'reseeded' | null;

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

type ReversibleActionType = 'play_to_bank' | 'play_property' | 'play_action' | 'move_wild';

function initialSetup(): SetupViewModel {
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

function actionCardName(action: Action): string {
  if (action.type !== 'play_action') return 'Action';
  return getCardDefinition(action.cardId).name;
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function gameIdentity(game: GameState): string {
  return `${game.createdAt}`;
}

function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [settingsBackScreen, setSettingsBackScreen] = useState<SettingsBackScreen>('home');
  const [game, setGame] = useState<GameState | null>(null);
  const [postGameSummary, setPostGameSummary] = useState<PostGameSummary | null>(null);
  const [setup, setSetup] = useState<SetupViewModel>(initialSetup);
  const [error, setError] = useState<string | null>(null);
  const [revealedPlayerId, setRevealedPlayerId] = useState<string | null>(null);
  const [history, setHistory] = useState<MatchRecordV1[]>(() => loadMatchHistory());
  const [lifetime, setLifetime] = useState<LifetimeStatsV1>(() => loadLifetimeStats());
  const [chooser, setChooser] = useState<PlayChooserState | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedPaymentCards, setSelectedPaymentCards] = useState<string[]>([]);
  const [showDebugActions, setShowDebugActions] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<ShareStatus>(null);
  const [riskyActionConfirmation, setRiskyActionConfirmation] = useState<RiskyActionConfirmation | null>(null);
  const [showRulesDrawer, setShowRulesDrawer] = useState(false);
  const [turnSnapshots, setTurnSnapshots] = useState<GameState[]>([]);
  const [uiPreferences, setUiPreferences] = useState<UiPreferencesV1>(() => loadUiPreferences());
  const [devSeedStatus, setDevSeedStatus] = useState<DevSeedStatus>(null);
  const postGameTitleRef = useRef<HTMLHeadingElement | null>(null);
  const finalizedMatchRef = useRef<string | null>(null);
  const devAutoSeedAttemptedRef = useRef(false);

  useEffect(() => {
    if (!game || isGameOver(game).done) return;
    const handle = window.setTimeout(() => {
      saveActiveGame(game);
    }, 220);
    return () => window.clearTimeout(handle);
  }, [game]);

  useEffect(() => {
    saveUiPreferences(uiPreferences);
  }, [uiPreferences]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => {
      setPrefersReducedMotion(query.matches);
    };
    syncPreference();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', syncPreference);
      return () => query.removeEventListener('change', syncPreference);
    }
    query.addListener(syncPreference);
    return () => query.removeListener(syncPreference);
  }, []);

  useEffect(() => {
    if (screen !== 'game_over') return;
    postGameTitleRef.current?.focus();
  }, [screen, postGameSummary?.endedAt]);

  useEffect(() => {
    setIsSharing(false);
    setShareStatus(null);
  }, [postGameSummary?.endedAt, screen]);

  const applyDevFixture = useCallback((status: Exclude<DevSeedStatus, 'already-populated' | null>) => {
    const fixture = createDevStatsFixture('medium');
    const nextHistory = structuredClone(fixture.history);
    const nextLifetime = structuredClone(fixture.lifetime);
    saveMatchHistory(nextHistory);
    saveLifetimeStats(nextLifetime);
    setHistory(nextHistory);
    setLifetime(nextLifetime);
    setDevSeedStatus(status);
  }, []);

  useEffect(() => {
    if (!uiPreferences.devModeEnabled) {
      devAutoSeedAttemptedRef.current = false;
      return;
    }
    if (devAutoSeedAttemptedRef.current) return;
    devAutoSeedAttemptedRef.current = true;
    if (history.length > 0) return;
    applyDevFixture('seeded');
  }, [applyDevFixture, history.length, uiPreferences.devModeEnabled]);

  const prompt = useMemo(() => (game ? getNextPrompt(game) : null), [game]);
  const currentGameId = game ? gameIdentity(game) : null;
  const isPaused = Boolean(game && uiPreferences.gamePaused && uiPreferences.pausedGameId === currentGameId);
  const reduceCelebrationEffects = uiPreferences.reducedEffects;
  const celebrationEnabled = Boolean(postGameSummary && !prefersReducedMotion && !reduceCelebrationEffects);

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
        requiresConfirmation: item.requiresConfirmation,
        riskLevel: item.riskLevel,
        previewText: item.previewText,
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

  const openSettings = useCallback((backScreen: SettingsBackScreen) => {
    setSettingsBackScreen(backScreen);
    setScreen('settings');
    setError(null);
  }, []);

  const closeSettings = useCallback(() => {
    if (settingsBackScreen === 'game' && game) {
      setScreen('game');
      return;
    }
    setScreen('home');
  }, [game, settingsBackScreen]);

  const togglePause = useCallback(() => {
    if (!currentGameId) return;
    setUiPreferences((prev) => {
      if (prev.gamePaused && prev.pausedGameId === currentGameId) {
        return { ...prev, gamePaused: false, pausedGameId: null };
      }
      return { ...prev, gamePaused: true, pausedGameId: currentGameId };
    });
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setError(null);
  }, [currentGameId]);

  const onToggleDevMode = useCallback((enabled: boolean) => {
    setUiPreferences((prev) => ({ ...prev, devModeEnabled: enabled }));
    if (!enabled) {
      setDevSeedStatus(null);
      devAutoSeedAttemptedRef.current = false;
      return;
    }
    devAutoSeedAttemptedRef.current = true;
    if (history.length > 0) {
      setDevSeedStatus('already-populated');
      return;
    }
    applyDevFixture('seeded');
  }, [applyDevFixture, history.length]);

  const onReseedDevData = useCallback(() => {
    applyDevFixture('reseeded');
  }, [applyDevFixture]);

  const openGame = useCallback((nextGame: GameState) => {
    finalizedMatchRef.current = null;
    setGame(nextGame);
    setPostGameSummary(null);
    setRevealedPlayerId(null);
    setScreen('game');
    setError(null);
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setTurnSnapshots([]);
  }, []);

  const startGameWithPlayers = useCallback((players: PlayerConfig[]) => {
    const nextGame = createGame({ players, deckVersion: 'v1' });
    setUiPreferences((prev) => ({ ...prev, gamePaused: false, pausedGameId: null }));
    openGame(nextGame);
  }, [openGame]);

  const startNewGame = () => {
    const players: PlayerConfig[] = setup.playerNames.slice(0, setup.playerCount).map((name, index) => ({
      id: `p${index + 1}`,
      name: name.trim() || `Player ${index + 1}`,
    }));
    startGameWithPlayers(players);
  };

  const resumeGame = () => {
    const saved = loadActiveGame();
    if (!saved) {
      setError('No active saved game found.');
      return;
    }
    if (isGameOver(saved.gameState).done) {
      const loadedLifetime = loadLifetimeStats();
      setLifetime(loadedLifetime);
      setGame(saved.gameState);
      setPostGameSummary(buildPostGameSummary(saved.gameState, loadedLifetime));
      setScreen('game_over');
      setError(null);
      clearActiveGame();
      return;
    }
    openGame(saved.gameState);
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
    setPostGameSummary(buildPostGameSummary(nextState, nextLifetime));
    setRevealedPlayerId(null);
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setTurnSnapshots([]);
    setScreen('game_over');
    clearActiveGame();
  };

  const runAction = (action: Action) => {
    if (!game || isPaused) return;
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
    setRiskyActionConfirmation(null);
    setGame(result.state);
    finalizeIfGameOver(result.state);
  };

  const queueRiskyAction = (
    action: Action,
    source?: Partial<Pick<RiskyActionConfirmation, 'riskLevel' | 'previewText'>> & { requiresConfirmation?: boolean },
  ): boolean => {
    if (!uiPreferences.confirmRiskyActions) return false;
    if (action.type !== 'play_action') return false;
    const highImpactActionKinds = new Set(['rent', 'rent_wild', 'debt_collector', 'sly_deal', 'forced_deal', 'deal_breaker']);
    const cardDef = getCardDefinition(action.cardId);
    const kind = cardDef.actionKind ?? null;
    const shouldConfirm = source ? Boolean(source.requiresConfirmation) : kind != null && highImpactActionKinds.has(kind);
    if (!shouldConfirm) return false;
    setRiskyActionConfirmation({
      action,
      label: actionCardName(action),
      riskLevel: source?.riskLevel ?? (kind === 'forced_deal' || kind === 'deal_breaker' ? 'high' : 'medium'),
      previewText:
        source?.previewText ??
        (kind === 'deal_breaker'
          ? 'This can steal an opponent complete set.'
          : kind === 'forced_deal'
            ? 'This swaps properties and can shift both players progress.'
            : kind === 'sly_deal'
              ? 'This steals a property from an opponent.'
              : kind === 'debt_collector'
                ? 'This demands payment from the selected opponent.'
                : 'This can trigger a high-impact rent payment sequence.'),
    });
    return true;
  };

  const runActionWithConfirmation = (action: Action, source?: LegalAction) => {
    if (isPaused) return;
    if (
      queueRiskyAction(
        action,
        source
          ? {
              requiresConfirmation: source.requiresConfirmation,
              riskLevel: source.riskLevel,
              previewText: source.previewText,
            }
          : undefined,
      )
    ) {
      return;
    }
    runAction(action);
  };

  const undoLastPlay = () => {
    if (isPaused) return;
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
    if (isPaused) return;
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
    if (isPaused) return;
    if (!game || !prompt) return;
    if (isGameOver(game).done) return;
    if (revealedPlayerId !== prompt.playerId) return;
    if (!playableCardIds.has(cardId)) return;

    const variants = cardActionVariants.get(cardId) ?? [];
    if (variants.length === 0) return;

    setSelectedCardId(cardId);

    if (variants.length === 1) {
      runActionWithConfirmation(variants[0].action, variants[0]);
      return;
    }

    const def = getCardDefinition(cardId);
    const cardLabel = def.kind === 'money' ? `$${def.value}` : def.name;
    setChooser({ cardId, cardLabel, variants });
  };

  const handlePaymentCardToggle = (cardId: string) => {
    if (isPaused) return;
    if (!pendingPayment || !pendingPaymentCardIds.includes(cardId)) return;
    setSelectedPaymentCards((prev) => (prev.includes(cardId) ? prev.filter((id) => id !== cardId) : [...prev, cardId]));
  };

  const submitSelectedPayment = () => {
    if (isPaused) return;
    if (!pendingPayment || !paymentCanSubmit) return;
    runAction({
      type: 'pay_request',
      playerId: pendingPayment.targetPlayerId,
      cards: selectedPaymentCards,
    });
  };

  const autoSelectPayment = () => {
    if (isPaused) return;
    if (!game || !pendingPayment) return;
    const suggested = getSuggestedPaymentCards(game, pendingPayment.targetPlayerId, pendingPayment.amount);
    setSelectedPaymentCards(suggested);
    incrementGrowthMetric('payment_auto_selected');
  };

  const clearStatsData = () => {
    if (typeof window !== 'undefined') {
      const shouldClear = window.confirm('Clear all local stats and match history data?');
      if (!shouldClear) return;
    }
    clearMatchHistory();
    clearLifetimeStats();
    setHistory([]);
    setLifetime({ version: 1, players: {} });
    setError(null);
  };

  const actionDetailText = (item: LegalAction): string | null => {
    if (item.requestedAmount == null || item.collectibleCap == null) return null;
    const detail = `Ask $${item.requestedAmount}, likely collect up to $${item.collectibleCap}`;
    return item.requiresPropertyTransfer ? `${detail} (likely requires property transfer)` : detail;
  };

  const syncSetupPlayerNames = useCallback((names: string[]) => {
    setSetup((prev) => {
      const nextNames = [...prev.playerNames];
      for (let index = 0; index < 4; index += 1) {
        if (index < names.length) {
          nextNames[index] = names[index];
        } else if (!nextNames[index]?.trim()) {
          nextNames[index] = `Player ${index + 1}`;
        }
      }
      return {
        ...prev,
        playerCount: Math.min(4, Math.max(2, names.length)),
        playerNames: nextNames,
      };
    });
  }, []);

  const goHome = useCallback(() => {
    clearActiveGame();
    setUiPreferences((prev) => ({ ...prev, gamePaused: false, pausedGameId: null }));
    setGame(null);
    setPostGameSummary(null);
    setScreen('home');
    setError(null);
    setChooser(null);
    setSelectedCardId(null);
    setSelectedPaymentCards([]);
    setTurnSnapshots([]);
    setShowDebugActions(false);
    setShowRulesDrawer(false);
    setIsSharing(false);
    setShareStatus(null);
    setRiskyActionConfirmation(null);
  }, []);

  const startRematch = useCallback(() => {
    if (!game) return;
    const playerNames = game.players.map((player) => player.name);
    syncSetupPlayerNames(playerNames);
    startGameWithPlayers(
      playerNames.map((name, index) => ({
        id: `p${index + 1}`,
        name,
      })),
    );
    setIsSharing(false);
    setShareStatus(null);
  }, [game, startGameWithPlayers, syncSetupPlayerNames]);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  const copyImageToClipboard = async (blob: Blob): Promise<boolean> => {
    const clipboardWithWrite = (navigator.clipboard as Clipboard & { write?: (items: ClipboardItem[]) => Promise<void> } | undefined);
    if (!clipboardWithWrite?.write || typeof window.ClipboardItem !== 'function') {
      return false;
    }
    const item = new window.ClipboardItem({ 'image/png': blob });
    await clipboardWithWrite.write([item]);
    return true;
  };

  const sharePostGameImage = async () => {
    if (!postGameSummary || isSharing) return;
    incrementGrowthMetric('share_image_clicked');
    setIsSharing(true);
    setShareStatus(null);
    try {
      const blob = await generatePostGameSharePng(postGameSummary);
      const copied = await copyImageToClipboard(blob).catch(() => false);
      if (copied) {
        incrementGrowthMetric('share_image_success');
        setShareStatus({ tone: 'success', message: 'Brag image copied to your clipboard.' });
        return;
      }
      downloadBlob(blob, postGameShareFilename(postGameSummary));
      incrementGrowthMetric('share_image_success');
      setShareStatus({ tone: 'success', message: 'Brag image downloaded. Share it in your group chat.' });
    } catch {
      setShareStatus({ tone: 'error', message: 'Could not generate the share image. Please try again.' });
    } finally {
      setIsSharing(false);
    }
  };

  return (
    <GameShell screenClassName={`screen-${screen}`} textScale={uiPreferences.textScale}>
      {screen === 'home' ? (
        <HomeScreen
          error={error}
          onNewGame={() => setScreen('setup')}
          onResumeGame={resumeGame}
          onOpenStats={() => setScreen('stats')}
          onOpenSettings={() => openSettings('home')}
        />
      ) : null}

      {screen === 'setup' ? (
        <SetupScreen
          setup={setup}
          onPlayerCountChange={(playerCount) => setSetup((prev) => ({ ...prev, playerCount }))}
          onPlayerNameChange={(index, value) => {
            setSetup((prev) => {
              const nextNames = [...prev.playerNames];
              nextNames[index] = value;
              return { ...prev, playerNames: nextNames };
            });
          }}
          onStartMatch={startNewGame}
          onBack={() => setScreen('home')}
        />
      ) : null}

      {screen === 'game' && game && prompt ? (
        <GameTableScreen
          game={game}
          prompt={prompt}
          isPaused={isPaused}
          legalActions={legalActions}
          contextualActions={contextualActions}
          revealedPlayerId={revealedPlayerId}
          playableCardIds={playableCardIds}
          selectedCardId={selectedCardId}
          selectedPaymentCards={selectedPaymentCards}
          selectedPaymentTotal={selectedPaymentTotal}
          totalPayableValue={totalPayableValue}
          paymentCanSubmit={paymentCanSubmit}
          pendingPayment={pendingPayment}
          chooser={chooser}
          shouldShowShield={shouldShowShield}
          turnStatusText={turnStatusText}
          isMandatoryPrompt={isMandatoryPrompt}
          mainPhaseExhausted={mainPhaseExhausted}
          discardOverLimitCount={discardOverLimitCount}
          turnSnapshotsCount={turnSnapshots.length}
          showDebugActions={showDebugActions}
          actionDetailText={actionDetailText}
          onPauseToggle={togglePause}
          onOpenRules={() => {
            setShowRulesDrawer(true);
            incrementGrowthMetric('rules_drawer_opened');
          }}
          onOpenSettings={() => openSettings('game')}
          onToggleDebugActions={() => {
            if (isPaused) return;
            setShowDebugActions((prev) => !prev);
          }}
          onRunAction={runActionWithConfirmation}
          onCardClick={handleCardClick}
          onPaymentCardToggle={handlePaymentCardToggle}
          onAutoSelectPayment={autoSelectPayment}
          onSubmitSelectedPayment={submitSelectedPayment}
          onUndoLastPlay={undoLastPlay}
          onResetTurnPlays={resetTurnPlays}
          onCloseChooser={() => {
            if (isPaused) return;
            setChooser(null);
            setSelectedCardId(null);
          }}
          onRevealTurn={() => {
            if (isPaused) return;
            setRevealedPlayerId(prompt.playerId);
          }}
          onNavigateHome={() => setScreen('home')}
        />
      ) : null}

      {screen === 'stats' ? <StatsScreen history={history} lifetime={lifetime} onBack={() => setScreen('home')} /> : null}

      {screen === 'settings' ? (
        <SettingsScreen
          uiPreferences={uiPreferences}
          devSeedStatus={devSeedStatus}
          onToggleReducedEffects={(enabled) => setUiPreferences((prev) => ({ ...prev, reducedEffects: enabled }))}
          onChangeTextScale={(value) => setUiPreferences((prev) => ({ ...prev, textScale: value }))}
          onChangeTableDensity={(value) => setUiPreferences((prev) => ({ ...prev, tableDensity: value }))}
          onToggleConfirmRiskyActions={(enabled) => setUiPreferences((prev) => ({ ...prev, confirmRiskyActions: enabled }))}
          onToggleRulesDrawerHints={(enabled) => setUiPreferences((prev) => ({ ...prev, showRulesDrawerHints: enabled }))}
          onToggleDevMode={onToggleDevMode}
          onReseedDevData={onReseedDevData}
          onClearStatsData={clearStatsData}
          onBack={closeSettings}
        />
      ) : null}

      {screen === 'game_over' && postGameSummary ? (
        <PostGameScreen
          postGameSummary={postGameSummary}
          game={game}
          celebrationEnabled={celebrationEnabled}
          reduceCelebrationEffects={reduceCelebrationEffects}
          prefersReducedMotion={prefersReducedMotion}
          isSharing={isSharing}
          shareStatus={shareStatus}
          titleRef={postGameTitleRef}
          formatDuration={formatDuration}
          onToggleReduceEffects={(enabled) => setUiPreferences((prev) => ({ ...prev, reducedEffects: enabled }))}
          onStartRematch={startRematch}
          onShareImage={sharePostGameImage}
          onOpenSetup={() => {
            const names = game?.players.map((player) => player.name);
            if (names && names.length > 0) {
              syncSetupPlayerNames(names);
            }
            setScreen('setup');
            setPostGameSummary(null);
            setError(null);
          }}
          onOpenStats={() => setScreen('stats')}
          onGoHome={goHome}
        />
      ) : null}

      {riskyActionConfirmation ? (
        <ActionConfirmDialog
          title={riskyActionConfirmation.label}
          previewText={riskyActionConfirmation.previewText}
          riskLevel={riskyActionConfirmation.riskLevel}
          onConfirm={() => runAction(riskyActionConfirmation.action)}
          onCancel={() => setRiskyActionConfirmation(null)}
        />
      ) : null}

      {screen === 'game' && showRulesDrawer ? <RulesDrawer onClose={() => setShowRulesDrawer(false)} /> : null}

    </GameShell>
  );
}

export default App;
