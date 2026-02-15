import type { TurnPhase, TurnPrompt } from '../../engine';
import type { LegalAction } from '../../engine';

interface ActionRailProps {
  isMandatoryPrompt: boolean;
  turnStatusText: string;
  turnPhase: TurnPhase;
  promptKind: TurnPrompt['kind'];
  playsUsed: number;
  discardOverLimitCount: number;
  showRulesHints: boolean;
  legalActions: LegalAction[];
  isPaused: boolean;
  showDebugActions: boolean;
  onToggleDebugActions: () => void;
}

export function ActionRail({
  isMandatoryPrompt,
  turnStatusText,
  turnPhase,
  promptKind,
  playsUsed,
  discardOverLimitCount,
  showRulesHints,
  legalActions,
  isPaused,
  showDebugActions,
  onToggleDebugActions,
}: ActionRailProps) {
  const drawStepState = turnPhase === 'draw' ? 'active' : 'done';
  const actionStepState = turnPhase === 'action' ? 'active' : turnPhase === 'finished' ? 'done' : 'pending';
  const endStepState = promptKind === 'discard' || turnPhase === 'finished' ? 'active' : 'pending';

  return (
    <aside className="panel action-rail card-enter" aria-label="Turn action rail">
      <h3>Turn Actions</h3>
      <ol className="turn-phase-steps" aria-label="Turn phase progress">
        <li className={`turn-phase-step is-${drawStepState}`}>
          <strong>1.</strong> Draw
        </li>
        <li className={`turn-phase-step is-${actionStepState}`}>
          <strong>2.</strong> Play up to 3 cards ({Math.min(playsUsed, 3)}/3)
        </li>
        <li className={`turn-phase-step is-${endStepState}`}>
          <strong>3.</strong> End turn{discardOverLimitCount > 0 ? ` (discard ${discardOverLimitCount})` : ''}
        </li>
      </ol>
      <p className={`turn-status ${isMandatoryPrompt ? 'is-required' : ''}`} aria-live="polite" aria-atomic="true">
        {isPaused ? 'Game is paused. Resume from the top bar to continue.' : turnStatusText}
      </p>
      {showRulesHints ? (
        <p className="action-rail-caption">
          {isMandatoryPrompt
            ? 'Resolve the required action in the active player panel.'
            : 'Use the active player panel below to play cards.'}
        </p>
      ) : null}
      <div className="debug-actions">
        <button type="button" onClick={onToggleDebugActions} disabled={isPaused}>
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
    </aside>
  );
}
