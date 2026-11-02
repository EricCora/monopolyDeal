import { useEffect, useMemo, useState } from 'react';
import { getNextPrompt, type TurnPrompt } from '../../engine';
import { replayPositions } from '../../replay/positions';
import { Icon } from '../components/icons';
import type { GameReplayLog } from '../../persistence/replays';
import { GameTableScreen } from './GameTableScreen';

const SPEEDS = [1, 2, 4];
const STEP_MS = 1100;

interface ReplayScreenProps {
  log: GameReplayLog;
  reducedMotion: boolean;
  onClose: () => void;
}

const noop = () => undefined;

/** Plays a finished game back on the real table, following whoever is deciding at each step. */
export function ReplayScreen({ log, reducedMotion, onClose }: ReplayScreenProps) {
  const positions = useMemo(() => replayPositions(log), [log]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const last = positions.length - 1;
  const game = positions[Math.min(index, last)];
  const prompt: TurnPrompt = getNextPrompt(game);
  // A finished game, so anyone's hand is fair. Without a choice it follows whoever is deciding.
  const [revealedSeat, setRevealedSeat] = useState<string | null>(null);

  useEffect(() => {
    if (!playing || index >= last) return undefined;
    const timer = window.setTimeout(() => setIndex((current) => Math.min(current + 1, last)), STEP_MS / speed);
    return () => window.clearTimeout(timer);
  }, [index, last, playing, speed]);

  const isPlaying = playing && index < last;

  return (
    <GameTableScreen
      game={game}
      prompt={prompt}
      flightKey={index}
      replayBar={(openLog) => (
        <div className="replay-bar glass-panel" role="group" aria-label="Replay controls">
          <div className="replay-buttons">
            <button type="button" className="icon-button" aria-label="Close replay" onClick={onClose}><Icon name="close" /></button>
            <button type="button" className="icon-button" aria-label="Previous move" disabled={index === 0} onClick={() => { setPlaying(false); setIndex((current) => Math.max(current - 1, 0)); }}><Icon name="back" /></button>
            <button
              type="button"
              className="primary-button replay-play"
              onClick={() => {
                if (index >= last) setIndex(0);
                setPlaying(!isPlaying);
              }}
            >
              <Icon name={isPlaying ? 'pause' : 'pass_go'} /> {isPlaying ? 'Pause' : index >= last ? 'Watch Again' : 'Play'}
            </button>
            <button type="button" className="icon-button" aria-label="Next move" disabled={index >= last} onClick={() => { setPlaying(false); setIndex((current) => Math.min(current + 1, last)); }}><Icon name="chevron" /></button>
            <button type="button" className="icon-button" aria-label="Game log" onClick={openLog}><Icon name="list" /></button>
            <button type="button" className="icon-button replay-speed" aria-label={`Playback speed ${speed} times`} onClick={() => setSpeed((current) => SPEEDS[(SPEEDS.indexOf(current) + 1) % SPEEDS.length])}>{speed}x</button>
          </div>
          <label className="replay-hand">
            <Icon name="eye" />
            <span className="sr-only">Whose hand to show</span>
            <select value={revealedSeat ?? ''} onChange={(event) => setRevealedSeat(event.target.value || null)}>
              <option value="">Follow Play</option>
              {game.players.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
            </select>
          </label>
          <label className="replay-scrub">
            <span className="sr-only">Move</span>
            <input type="range" min={0} max={last} value={Math.min(index, last)} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }} />
            <small>Move {Math.min(index, last)} of {last}</small>
          </label>
        </div>
      )}
      isPaused={false}
      reducedMotion={reducedMotion}
      legalActions={[]}
      contextualActions={[]}
      revealedPlayerId={revealedSeat ?? prompt.playerId}
      playableCardIds={new Set()}
      selectedCardId={null}
      selectedPaymentCards={[]}
      selectedPaymentTotal={0}
      totalPayableValue={0}
      paymentCanSubmit={false}
      pendingPayment={null}
      chooser={null}
      shouldShowShield={false}
      turnStatusText=""
      isMandatoryPrompt={false}
      mainPhaseExhausted={false}
      discardOverLimitCount={0}
      showRulesHints={false}
      enhancedEventLog={false}
      coachHint={null}
      turnSnapshotsCount={0}
      showDebugActions={false}
      actionDetailText={() => null}
      onPauseToggle={noop}
      onOpenRules={noop}
      onOpenSavedGames={noop}
      onOpenSettings={noop}
      onToggleDebugActions={noop}
      onRunAction={noop}
      onCardClick={noop}
      onPropertySelectionClick={noop}
      onPaymentCardToggle={noop}
      onAutoSelectPayment={noop}
      onSubmitSelectedPayment={noop}
      onUndoLastPlay={noop}
      onResetTurnPlays={noop}
      onCloseChooser={noop}
      onRevealTurn={noop}
      onNavigateHome={onClose}
    />
  );
}
