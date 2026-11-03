import { getCardDefinition, formatPropertyColor, getSetSize, type GameVariant } from '../../cards/catalog';
import { isCompletePropertySet, propertySets } from '../../engine/core';
import type { PlayerState, PropertyCardPlacement } from '../../engine/types';
import { CardView } from '../components/CardView';
import { Icon } from '../components/icons';
import { PROPERTY_COLORS, bankTotal, cssColor, type BoardLane } from './boardModel';

const AVATAR_COLORS = ['#e5484d', '#3b82f6', '#30b47f', '#f59e0b', '#a855f7'];

export function PlayerAvatar({ name, isBot }: { name: string; isBot: boolean }) {
  const hash = Array.from(name).reduce((sum, char) => sum + (char.codePointAt(0) ?? 0), 0);
  return (
    <span className="player-avatar" style={{ background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }} aria-hidden="true">
      {isBot ? <Icon name="bot" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SetCountBadge({ count, needed }: { count: number; needed: number }) {
  return (
    <span className="set-count-badge" role="img" aria-label={`${count} of ${needed} sets complete`}>
      {Array.from({ length: Math.max(needed, 1) }, (_, index) => (
        <Icon key={index} name={index < count ? 'star' : 'starOutline'} className={index < count ? 'is-earned' : ''} />
      ))}
    </span>
  );
}

export function DebtBadge({ player }: { player: PlayerState }) {
  const owed = player.debts?.length ?? player.debtsOwed?.length ?? 0;
  return (
    <span className={`debt-badge ${owed > 0 ? 'is-owing' : ''}`} aria-label={`${owed} debts owed`}>
      <Icon name="forced_debt" /> {owed}
    </span>
  );
}

/** A row of small color tiles showing how close each color is to complete. */
export function SetProgressBar({ player, variant }: { player: PlayerState; variant: GameVariant }) {
  return (
    <span className="set-progress-bar" aria-hidden="true">
      {PROPERTY_COLORS.map((color) => {
        const sets = propertySets(player, color, variant);
        const best = sets.reduce((most, set) => Math.max(most, set.entries.filter((entry) => {
          const kind = getCardDefinition(entry.cardId, variant).kind;
          return kind === 'property' || kind === 'wild';
        }).length), 0);
        const complete = sets.some((set) => isCompletePropertySet(set.entries, color, variant));
        return (
          <span key={color} className={`set-progress-tile ${complete ? 'is-complete' : ''}`} style={{ ['--tile' as string]: cssColor(color) }}>
            <span style={{ width: `${Math.min(1, best / getSetSize(color)) * 100}%` }} />
          </span>
        );
      })}
    </span>
  );
}

/** What a tap on a table card does right now. */
export interface TableCardBehavior {
  interactive: boolean;
  selected?: boolean;
  targeted?: boolean;
  onClick?: () => void;
}

interface SetLaneProps {
  lane: BoardLane;
  variant: GameVariant;
  /** For an opponent's small board. */
  compact?: boolean;
  laneRef?: (node: HTMLDivElement | null) => void;
  extraClassName?: string;
  behavior: (entry: PropertyCardPlacement, lane: BoardLane) => TableCardBehavior;
  onInspect: (cardId: string) => void;
  /** Replaces the label under the set, for an opponent's seat at the table. */
  status?: string;
}

/** One physical set. A complete set gets a gold outline. */
export function SetLane({ lane, variant, compact = false, laneRef, extraClassName = '', behavior, onInspect, status: statusOverride }: SetLaneProps) {
  const propertyCount = lane.entries.filter((entry) => {
    const kind = getCardDefinition(entry.cardId, variant).kind;
    return kind === 'property' || kind === 'wild';
  }).length;
  const setSize = getSetSize(lane.color);
  const label = formatPropertyColor(lane.color);
  // A full lane of Wilds can still be incomplete, so "2/2" alone would look like a bug.
  const status = statusOverride ?? (lane.isComplete ? 'Complete' : propertyCount >= setSize ? `Needs a ${label}` : `${propertyCount}/${setSize}`);
  return (
    <div
      className={`property-lane ${compact ? 'is-compact' : ''} ${lane.isComplete ? 'is-complete' : ''} ${extraClassName}`}
      ref={laneRef}
      style={{ ['--lane-count' as string]: lane.entries.length }}
      aria-label={`${label} set, ${lane.isComplete ? 'complete' : 'incomplete'}`}
    >
      <div className="property-cards">
        {lane.entries.map((entry, index) => {
          const card = behavior(entry, lane);
          return (
            <div
              key={entry.cardId}
              className={`property-card-wrap ${card.targeted ? 'is-selection-target' : ''} ${card.selected ? 'is-selected' : ''}`}
              data-flip-id={entry.cardId}
              style={{ ['--i' as string]: index, zIndex: index }}
              onClick={card.interactive ? undefined : () => onInspect(entry.cardId)}
            >
              <CardView
                cardId={entry.cardId}
                size="sm"
                gameVariant={variant}
                assignedColor={entry.assignedColor}
                interactive={card.interactive}
                playable={card.interactive}
                selected={card.selected}
                onClick={card.onClick}
                annotation={`Set ${lane.setNumber} · ${lane.isComplete ? 'Complete' : 'Incomplete'}${entry.attachedToCardId ? ' · Shack attached' : ''}`}
              />
            </div>
          );
        })}
      </div>
      {compact ? null : <p className="property-lane-status">{status}</p>}
    </div>
  );
}

interface BankStackProps {
  player: PlayerState;
  variant: GameVariant;
  compact?: boolean;
  bankRef?: (node: HTMLDivElement | null) => void;
  extraClassName?: string;
  behavior: (cardId: string) => TableCardBehavior;
  onInspect: (cardId: string) => void;
  /** Replaces "Bank $N" under the stack. */
  totalLabel?: string;
}

/**
 * Only the newest cards are spread out, so a rich Bank doesn't crowd out the sets beside it.
 * The older ones stay stacked beneath, still in place for a payment to pick from.
 */
export function BankStack({ player, variant, compact = false, bankRef, extraClassName = '', behavior, onInspect, totalLabel }: BankStackProps) {
  const total = bankTotal(player, variant);
  const spreadFrom = Math.max(0, player.bank.length - (compact ? 4 : 5));
  return (
    <div className={`bank-stack ${compact ? 'is-compact' : ''} ${extraClassName}`} ref={bankRef} aria-label={`Bank, ${total} dollars`}>
      <div className="zone-bank" style={{ ['--bank-count' as string]: Math.min(player.bank.length, compact ? 4 : 5) }}>
        {player.bank.length === 0 ? (
          <span className="bank-empty" aria-hidden="true"><Icon name="banknote" /></span>
        ) : null}
        {player.bank.map((cardId, index) => {
          const card = behavior(cardId);
          return (
            <div
              key={cardId}
              className={`bank-card-wrap ${card.selected ? 'is-selected' : ''}`}
              data-flip-id={cardId}
              style={{ ['--i' as string]: Math.max(0, index - spreadFrom), zIndex: index }}
              onClick={card.interactive ? undefined : () => onInspect(cardId)}
            >
              <CardView
                cardId={cardId}
                size="sm"
                gameVariant={variant}
                interactive={card.interactive}
                playable={card.interactive}
                selected={card.selected}
                onClick={card.onClick}
              />
            </div>
          );
        })}
      </div>
      {compact ? null : <p className="bank-total">{totalLabel ?? `Bank $${total}`}</p>}
    </div>
  );
}
