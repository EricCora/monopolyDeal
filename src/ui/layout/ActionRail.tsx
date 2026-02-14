import type { LegalAction } from '../../engine';

interface ActionRailProps {
  isMandatoryPrompt: boolean;
  turnStatusText: string;
  legalActions: LegalAction[];
  showDebugActions: boolean;
  onToggleDebugActions: () => void;
}

export function ActionRail({
  isMandatoryPrompt,
  turnStatusText,
  legalActions,
  showDebugActions,
  onToggleDebugActions,
}: ActionRailProps) {
  return (
    <aside className="panel action-rail card-enter" aria-label="Turn action rail">
      <h3>Turn Actions</h3>
      <p className={`turn-status ${isMandatoryPrompt ? 'is-required' : ''}`}>{turnStatusText}</p>
      <p className="action-rail-caption">
        {isMandatoryPrompt
          ? 'Resolve the required action in the active player panel.'
          : 'Use the active player panel below to play cards.'}
      </p>
      <div className="debug-actions">
        <button type="button" onClick={onToggleDebugActions}>
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
