import type { CSSProperties, ReactNode } from 'react';
import {
  formatPropertyColor,
  getCardDefinition,
  getRentScale,
  getSetSize,
  type ActionKind,
  type CardDefinition,
  type GameVariant,
  type PropertyColor,
} from '../../cards/catalog';
import { cardSummary, getCardVisualModel } from '../cards';
import { Icon } from './icons';

type CardSize = 'sm' | 'md' | 'lg';
type CardVariant = 'standard' | 'premium';
type CardElevation = 'base' | 'raised';
type CardStatusTone = 'neutral' | 'success' | 'warning';

interface CardViewProps {
  cardId: string;
  faceUp?: boolean;
  size?: CardSize;
  /** A fixed width in pixels, instead of the size's width. */
  width?: number;
  context?: 'hand' | 'table';
  variant?: CardVariant;
  elevation?: CardElevation;
  statusTone?: CardStatusTone;
  interactive?: boolean;
  playable?: boolean;
  selected?: boolean;
  annotation?: string;
  onClick?: () => void;
  gameVariant?: GameVariant;
  /** The color a Wild is assigned to, shown on the table. */
  assignedColor?: PropertyColor;
  /** Artwork only, for a card inside a labeled control or used as decoration. */
  decorative?: boolean;
}

const cssColor = (color: PropertyColor) => `var(--card-color-${color.replace('_', '-')})`;
const onTintClass = (color: PropertyColor) => (
  color === 'light_blue' || color === 'yellow' || color === 'utility' || color === 'orange' ? 'on-light' : 'on-dark'
);

function actionAccent(kind: ActionKind | undefined): string {
  switch (kind) {
    case 'just_say_no': return '#c42b35';
    case 'deal_breaker':
    case 'super_sly_deal':
    case 'market_crash': return '#6b21a8';
    case 'sly_deal':
    case 'forced_deal':
    case 'heist':
    case 'yoink': return '#0f766e';
    case 'debt_collector':
    case 'forced_debt':
    case 'tax_collector':
    case 'repossession': return '#b45309';
    case 'pass_go':
    case 'go_again': return '#15803d';
    case 'its_my_birthday': return '#db2777';
    case 'house':
    case 'hotel':
    case 'shack': return '#1d4ed8';
    case 'tough_luck':
    case 'unfair_trade': return '#475569';
    default: return '#1f3a5f';
  }
}

function ValueBadge({ value }: { value: number }) {
  return <span className="card-value">${value}</span>;
}

function RentLadder({ color, label }: { color: PropertyColor; label?: string }) {
  const scale = getRentScale(color);
  const setSize = getSetSize(color);
  return (
    <span className="card-rent" {...(label ? { 'aria-label': label } : { 'aria-hidden': true })}>
      {label ? <span className="sr-only">Rent</span> : null}
      {scale.map((rent, index) => (
        <span key={index} className={`card-rent-step ${index + 1 === setSize ? 'is-fullset' : ''}`}>
          <span className="card-rent-pips">
            {Array.from({ length: index + 1 }, (_, pip) => <span key={pip} className="card-rent-pip" />)}
          </span>
          <span className="card-rent-value">${rent}</span>
        </span>
      ))}
    </span>
  );
}

function PropertyFace({ card, inHand }: { card: CardDefinition; inHand: boolean }) {
  const color = card.color ?? 'brown';
  const scale = getRentScale(color);
  return (
    <span className="card-face face-property">
      <span className={`card-property-band ${onTintClass(color)}`}>
        <span className="card-title" title={card.name}>{formatPropertyColor(color)}</span>
      </span>
      <span className="card-set-size">SET OF {getSetSize(color)}</span>
      <RentLadder color={color} label={inHand ? undefined : 'Rent ladder'} />
      {inHand ? (
        <span className="sr-only" aria-label="Rent summary">Rent {scale.map((rent) => `$${rent}`).join('/')}</span>
      ) : null}
      <span className="card-foot"><ValueBadge value={card.moneyValue ?? card.value} /></span>
    </span>
  );
}

function WildBand({ color, flipped }: { color: PropertyColor; flipped?: boolean }) {
  return (
    <span className={`card-wild-band ${onTintClass(color)} ${flipped ? 'is-flipped' : ''}`} style={{ ['--band' as string]: cssColor(color) }}>
      <span className="card-wild-band-copy">
        <span className="card-wild-color">{formatPropertyColor(color)}</span>
        <span className="card-wild-rent">{getRentScale(color).map((rent) => `$${rent}`).join(' · ')}</span>
      </span>
    </span>
  );
}

function WildFace({ card, assigned }: { card: CardDefinition; assigned?: PropertyColor }) {
  const colors = card.colors ?? [];
  const value = card.moneyValue ?? card.value;
  if (colors.length > 2) {
    return (
      <span className="card-face face-wild face-wild-any">
        <span className="card-wild-disc">
          <Icon name="sparkles" />
          <span className="card-wild-word">WILD</span>
          <span className="card-wild-any">ANY COLOR</span>
        </span>
        {assigned ? <span className="card-wild-assigned" style={{ background: cssColor(assigned) }} /> : null}
        <span className="card-foot is-floating"><ValueBadge value={value} /></span>
      </span>
    );
  }
  // The chosen color sits upright, like turning a real card around.
  const isFlipped = assigned != null && assigned === colors[colors.length - 1];
  const first = (isFlipped ? colors[colors.length - 1] : colors[0]) ?? 'brown';
  const second = (isFlipped ? colors[0] : colors[colors.length - 1]) ?? 'brown';
  return (
    <span className="card-face face-wild">
      <WildBand color={first} />
      <WildBand color={second} flipped />
      <span className="card-wild-pill">WILD</span>
      <span className="card-foot is-floating"><ValueBadge value={value} /></span>
    </span>
  );
}

function MoneyFace({ card }: { card: CardDefinition }) {
  const value = card.moneyValue ?? card.value;
  return (
    <span className={`card-face face-money money-${value}`}>
      <span className="card-money-ring ring-3" />
      <span className="card-money-ring ring-2" />
      <span className="card-money-ring ring-1" />
      <span className="card-money-ring ring-0" />
      <span className="card-money-disc">
        <span className={`card-title card-money-amount ${value >= 10 ? 'is-long' : ''}`}>${value}</span>
      </span>
      <span className="card-money-corner is-top" aria-hidden="true">${value}</span>
      <span className="card-money-corner is-bottom" aria-hidden="true">${value}</span>
    </span>
  );
}

function Emblem({ card }: { card: CardDefinition }) {
  const rentColors = Object.keys(card.rentMatrix ?? {}) as PropertyColor[];
  const isRent = card.actionKind === 'rent' || card.actionKind === 'rent_wild' || (card.actionKind === 'double_rent' && rentColors.length > 0);
  if (isRent) {
    const step = 360 / Math.max(rentColors.length, 1);
    const wheel = rentColors.map((color, index) => `${cssColor(color)} ${index * step}deg ${(index + 1) * step}deg`).join(', ');
    return (
      <span className="card-emblem is-rent card-badge-icon" style={{ background: `conic-gradient(${wheel})` }}>
        <span className={`card-emblem-rent-word ${card.actionKind === 'double_rent' ? 'is-double' : ''}`}>
          {card.actionKind === 'double_rent' ? 'x2' : 'RENT'}
        </span>
      </span>
    );
  }
  return (
    <span className="card-emblem card-badge-icon">
      {card.actionKind === 'double_rent' ? <span className="card-emblem-double">x2</span> : <Icon name={card.actionKind ?? 'star'} />}
    </span>
  );
}

function ActionFace({ card, rentLines }: { card: CardDefinition; rentLines?: string[] }) {
  return (
    <span className="card-face face-action" style={{ ['--action-accent' as string]: actionAccent(card.actionKind) }}>
      <span className="card-head">
        <ValueBadge value={card.moneyValue ?? card.value} />
        <span className="card-kind-word">{card.kind === 'building' ? 'BUILD' : 'ACTION'}</span>
      </span>
      <Emblem card={card} />
      <span className="card-title" title={card.name}>{card.name}</span>
      <span className="card-subtitle">{cardSummary(card)}</span>
      {rentLines && rentLines.length > 0 ? (
        <span className="sr-only" aria-label="Rent action summary">
          {rentLines.map((line) => <span key={line}>{line} </span>)}
        </span>
      ) : null}
    </span>
  );
}

export function CardView({
  cardId,
  faceUp = true,
  size = 'md',
  width,
  context = 'table',
  variant = 'premium',
  elevation = 'base',
  statusTone = 'neutral',
  interactive = false,
  playable = false,
  selected = false,
  annotation,
  onClick,
  gameVariant = 'classic',
  assignedColor,
  decorative = false,
}: CardViewProps) {
  const widthStyle: CSSProperties = width ? { ['--card-w' as string]: `${width}px` } : {};

  const shell = (className: string, label: string, style: CSSProperties, content: ReactNode) => (
    decorative ? (
      <span className={className} style={style} aria-hidden="true">{content}</span>
    ) : (
      <button
        type="button"
        className={className}
        style={style}
        onClick={onClick}
        disabled={!interactive || !onClick}
        aria-label={label}
      >
        {content}
      </button>
    )
  );

  if (!faceUp) {
    return shell(
      `card-view card-back card-size-${size} card-elevation-${elevation} tone-${statusTone} ${interactive ? 'is-interactive' : ''}`,
      'Hidden card',
      widthStyle,
      <span className="card-back-frame"><span className="card-back-mark">DEAL</span></span>,
    );
  }

  const model = getCardVisualModel(cardId, gameVariant);
  const card = getCardDefinition(cardId, gameVariant);
  const style: CSSProperties = {
    ['--card-accent' as string]: model.accent,
    ['--card-accent-split' as string]: model.splitAccent ?? model.accent,
    ...(card.color ? { ['--card-tint' as string]: cssColor(card.color) } : {}),
    ...widthStyle,
  };

  return shell(
    `card-view card-size-${size} card-context-${context} card-variant-${variant} card-elevation-${elevation} tone-${statusTone} ${model.themeClass} kind-${model.kindClass} role-${model.cardRole} ${interactive ? 'is-interactive' : ''} ${playable ? 'is-playable' : 'is-unplayable'} ${selected ? 'is-selected' : ''}`,
    `${model.title} card`,
    style,
    <>
      {card.kind === 'money' ? <MoneyFace card={card} /> : null}
      {card.kind === 'property' ? <PropertyFace card={card} inHand={context === 'hand'} /> : null}
      {card.kind === 'wild' ? <WildFace card={card} assigned={assignedColor} /> : null}
      {card.kind === 'action' || card.kind === 'building' ? <ActionFace card={card} rentLines={model.rentActionLines} /> : null}
      <span className="sr-only" aria-label="Card type">{model.roleTag}</span>
      {annotation ? <span className="card-annotation sr-only">{annotation}</span> : null}
    </>,
  );
}
