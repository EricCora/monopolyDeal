import { getCardDefinition, formatPropertyColor, type GameVariant, type PropertyColor } from '../../cards/catalog';
import type { Action, CounterRequest, GameState, LegalAction, PaymentRequest, PlayerState, TurnPrompt } from '../../engine/types';
import { ActionLabelText } from '../components/ActionLabelText';
import { CardView } from '../components/CardView';
import { Icon } from '../components/icons';
import { boardLanes, PROPERTY_COLORS } from './boardModel';

export interface PanelChoice {
  id: string;
  label: string;
  item: LegalAction;
}

interface PromptPanelProps {
  game: GameState;
  prompt: TurnPrompt;
  viewer: PlayerState;
  legalActions: LegalAction[];
  contextualActions: LegalAction[];
  disabled: boolean;
  pendingPayment: PaymentRequest | null;
  selectedPaymentCards: string[];
  selectedPaymentTotal: number;
  totalPayableValue: number;
  paymentCanSubmit: boolean;
  selectedSelectionCardId: string | null;
  actionDetailText: (item: LegalAction) => string | null;
  onRunAction: (action: Action, source?: LegalAction) => void;
  onPropertySelectionClick: (ownerPlayerId: string, color: PropertyColor, cardId: string) => void;
  onPaymentCardToggle: (cardId: string) => void;
  onAutoSelectPayment: () => void;
  onSubmitSelectedPayment: () => void;
  onOpenChoices: (cardId: string, title: string, choices: PanelChoice[]) => void;
}

const nameOf = (game: GameState, playerId: string | undefined) => (
  game.players.find((player) => player.id === playerId)?.name ?? playerId ?? 'Someone'
);

const readable = (text: string) => text.replace(/_/g, ' ');

const assignedColorOf = (game: GameState, cardId: string): PropertyColor | undefined => {
  for (const player of game.players) {
    for (const color of PROPERTY_COLORS) {
      const entry = player.properties[color].find((placement) => placement.cardId === cardId);
      if (entry) return entry.assignedColor;
    }
  }
  return undefined;
};

function PanelHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="panel-header">
      <h4>{title}</h4>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}

function PaymentPanel(props: PromptPanelProps & { request: PaymentRequest; variant: GameVariant }) {
  const { game, viewer, request, variant, selectedPaymentCards, selectedPaymentTotal, totalPayableValue, paymentCanSubmit, disabled } = props;
  // Bank first, then properties, without the cards No Mercy forbids as payment.
  const payable = [
    ...viewer.bank,
    ...PROPERTY_COLORS.flatMap((color) => viewer.properties[color].map((entry) => entry.cardId)),
  ].filter((cardId) => {
    if (variant !== 'no_mercy') return true;
    const card = getCardDefinition(cardId, variant);
    return !(card.kind === 'wild' && (card.colors?.length ?? 0) > 2);
  });
  const isShortfall = totalPayableValue < request.amount;
  const covered = selectedPaymentTotal >= request.amount;
  return (
    <>
      <PanelHeader
        title={`Pay ${nameOf(game, request.sourcePlayerId)} $${request.amount}`}
        subtitle={readable(isShortfall ? `${request.reason}. You can't cover it, so everything you have goes.` : request.reason)}
      />
      <div className="payment-summary">
        <span>Selected</span>
        <strong className={covered ? 'is-covered' : ''}>${selectedPaymentTotal}</strong>
        <span>of ${request.amount}</span>
        <button type="button" className="glass-button payment-auto" onClick={props.onAutoSelectPayment} disabled={disabled} aria-label="Auto-select Payment">
          Auto-Select
        </button>
      </div>
      {totalPayableValue === 0 ? (
        <p className="panel-empty">No payable cards available. You have nothing to pay with.</p>
      ) : (
        <div className="panel-card-row">
          {payable.map((cardId) => {
            const selected = selectedPaymentCards.includes(cardId);
            const card = getCardDefinition(cardId, variant);
            return (
              <button
                key={cardId}
                type="button"
                className={`panel-card-button ${selected ? 'is-selected' : ''}`}
                aria-pressed={selected}
                aria-label={`Pay with ${card.kind === 'money' ? `$${card.moneyValue ?? card.value}` : card.name}`}
                onClick={() => props.onPaymentCardToggle(cardId)}
                disabled={disabled}
              >
                <CardView cardId={cardId} width={78} gameVariant={variant} assignedColor={assignedColorOf(game, cardId)} decorative />
                {selected ? <span className="panel-card-check"><Icon name="check" /></span> : null}
              </button>
            );
          })}
        </div>
      )}
      <button
        type="button"
        className="primary-button"
        onClick={props.onSubmitSelectedPayment}
        disabled={!paymentCanSubmit || disabled}
        aria-label={isShortfall ? `Confirm Shortfall Payment of $${selectedPaymentTotal}` : `Confirm Payment of $${selectedPaymentTotal}`}
      >
        {totalPayableValue === 0 ? 'Pay Nothing' : `Pay $${selectedPaymentTotal}`}
      </button>
    </>
  );
}

function counterDetail(request: CounterRequest, variant: GameVariant): string {
  const { effect } = request;
  switch (effect.kind) {
    case 'payment': return readable(`${effect.payload.reason}: pay $${effect.payload.amount} unless you stop it.`);
    case 'sly_deal': return "They'll take one of your properties.";
    case 'forced_deal': return "They'll swap a property with you.";
    case 'deal_breaker': return "They'll take a complete set.";
    case 'no_mercy': return `${getCardDefinition(effect.payload.actionCardId, variant).name} will affect you.`;
    case 'rent': return "They'll choose who pays rent.";
    default: return '';
  }
}

function CounterPanel(props: PromptPanelProps & { request: CounterRequest; variant: GameVariant }) {
  const { game, request, variant, legalActions, disabled, onRunAction } = props;
  const justSayNo = legalActions.find((item) => item.action.type === 'counter_response' && item.action.useJustSayNo);
  const allow = legalActions.find((item) => item.action.type === 'counter_response' && !item.action.useJustSayNo);
  const last = request.chain[request.chain.length - 1];
  const heading = last ? `${nameOf(game, last.playerId)} said Just Say No` : `${nameOf(game, request.sourcePlayerId)} played on you`;
  return (
    <>
      <div className="counter-summary">
        <CardView cardId={last?.cardId ?? request.actionCardId} width={78} gameVariant={variant} decorative />
        <div>
          <h4>{heading}</h4>
          <p>{counterDetail(request, variant)}</p>
        </div>
      </div>
      <div className="panel-button-row">
        {allow ? (
          <button type="button" className="secondary-button" aria-label={allow.label} onClick={() => onRunAction(allow.action, allow)} disabled={disabled}>
            {last ? 'Let It Stand' : 'Accept'}
          </button>
        ) : null}
        {justSayNo ? (
          <button type="button" className="primary-button is-danger" aria-label={justSayNo.label} onClick={() => onRunAction(justSayNo.action, justSayNo)} disabled={disabled}>
            <Icon name="just_say_no" /> Just Say No
          </button>
        ) : null}
      </div>
    </>
  );
}

function ChoiceList({ items, props }: { items: LegalAction[]; props: PromptPanelProps }) {
  return (
    <div className="panel-choice-list">
      {items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          className="secondary-button"
          onClick={() => props.onRunAction(item.action, item)}
          disabled={props.disabled}
        >
          <ActionLabelText text={item.label} />
          {props.actionDetailText(item) ? <small className="action-detail">{props.actionDetailText(item)}</small> : null}
        </button>
      ))}
    </div>
  );
}

interface CardGroup {
  cardId: string;
  items: LegalAction[];
}

function groupByCard(legalActions: LegalAction[], key: (action: Action) => string | undefined): CardGroup[] {
  const groups = new Map<string, LegalAction[]>();
  legalActions.forEach((item) => {
    const cardId = key(item.action);
    if (!cardId) return;
    groups.set(cardId, [...(groups.get(cardId) ?? []), item]);
  });
  return [...groups].map(([cardId, items]) => ({ cardId, items }));
}

function destinationLabel(item: LegalAction): string {
  const { action } = item;
  const color = 'destinationColor' in action ? action.destinationColor : action.type === 'no_mercy_pick' ? action.color : undefined;
  return color ? `Put in ${formatPropertyColor(color)}` : item.label;
}

/** Shows the available cards. If a card can go to more than one place, a chooser follows. */
function CardPickPanel({ title, subtitle, groups, props, variant }: { title: string; subtitle: string; groups: CardGroup[]; props: PromptPanelProps; variant: GameVariant }) {
  return (
    <>
      <PanelHeader title={title} subtitle={subtitle} />
      <div className="panel-card-row">
        {groups.map(({ cardId, items }) => {
          const card = getCardDefinition(cardId, variant);
          return (
            <button
              key={cardId}
              type="button"
              className="panel-card-button"
              aria-label={`Take ${card.kind === 'money' ? `$${card.moneyValue ?? card.value}` : card.name}`}
              disabled={props.disabled}
              onClick={() => {
                if (items.length === 1) {
                  props.onRunAction(items[0].action, items[0]);
                  return;
                }
                props.onOpenChoices(cardId, card.name, items.map((item, index) => ({ id: String(index), label: destinationLabel(item), item })));
              }}
            >
              <CardView cardId={cardId} width={88} gameVariant={variant} assignedColor={assignedColorOf(props.game, cardId)} decorative />
            </button>
          );
        })}
      </div>
    </>
  );
}

function ForcedDealPanel({ props, targetId, variant }: { props: PromptPanelProps; targetId: string; variant: GameVariant }) {
  const { game, viewer, legalActions, selectedSelectionCardId, disabled, onPropertySelectionClick } = props;
  const picks = legalActions.flatMap((item) => (item.action.type === 'forced_deal_pick' ? [item.action] : []));
  const seenGive = new Set<string>();
  const give = picks.filter((pick) => !seenGive.has(pick.giveCardId) && seenGive.add(pick.giveCardId));
  const seenTake = new Set<string>();
  const take = picks.filter((pick) => pick.giveCardId === selectedSelectionCardId && !seenTake.has(pick.takeCardId) && seenTake.add(pick.takeCardId));
  return (
    <>
      <PanelHeader
        title="Forced Deal"
        subtitle={selectedSelectionCardId ? `Now choose what to take from ${nameOf(game, targetId)}.` : "First, choose the property you'll give up."}
      />
      <p className="section-title">You give</p>
      <div className="panel-card-row">
        {give.map((pick) => (
          <button
            key={pick.giveCardId}
            type="button"
            className={`panel-card-button ${selectedSelectionCardId === pick.giveCardId ? 'is-selected' : ''}`}
            aria-label={`Give ${getCardDefinition(pick.giveCardId, variant).name}`}
            disabled={disabled}
            onClick={() => onPropertySelectionClick(viewer.id, pick.giveColor, pick.giveCardId)}
          >
            <CardView cardId={pick.giveCardId} width={70} gameVariant={variant} assignedColor={pick.giveColor} decorative />
          </button>
        ))}
      </div>
      {selectedSelectionCardId ? (
        <>
          <p className="section-title">You take</p>
          <div className="panel-card-row">
            {take.map((pick) => (
              <button
                key={pick.takeCardId}
                type="button"
                className="panel-card-button"
                aria-label={`Take ${getCardDefinition(pick.takeCardId, variant).name}`}
                disabled={disabled}
                onClick={() => onPropertySelectionClick(targetId, pick.takeColor, pick.takeCardId)}
              >
                <CardView cardId={pick.takeCardId} width={70} gameVariant={variant} assignedColor={pick.takeColor} decorative />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function DealBreakerPanel({ props, targetId, variant }: { props: PromptPanelProps; targetId: string; variant: GameVariant }) {
  const target = props.game.players.find((player) => player.id === targetId);
  const lanes = target ? boardLanes(target, variant) : [];
  return (
    <>
      <PanelHeader title="Deal Breaker" subtitle={`Take a complete set from ${nameOf(props.game, targetId)}.`} />
      <div className="panel-card-row is-sets">
        {props.legalActions.map((item, index) => {
          if (item.action.type !== 'deal_breaker_pick') return null;
          const { color, setId } = item.action;
          const lane = lanes.find((entry) => entry.color === color && (!setId || entry.setId === setId));
          if (!lane) return null;
          return (
            <button
              key={`${color}-${setId ?? index}`}
              type="button"
              className="panel-set-button"
              aria-label={`Take the ${formatPropertyColor(color)} set`}
              disabled={props.disabled}
              onClick={() => props.onRunAction(item.action, item)}
            >
              {lane.entries.map((entry, stackIndex) => (
                <span key={entry.cardId} style={{ ['--i' as string]: stackIndex }}>
                  <CardView cardId={entry.cardId} width={58} gameVariant={variant} assignedColor={entry.assignedColor} decorative />
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </>
  );
}

/**
 * The floating panel for anything that interrupts normal play: paying, responding and
 * choosing targets. Every case is built from the legal action list, and the last case lists
 * them plainly, so a player can never be stuck without a button. Mirrors `PromptPanel.swift`.
 */
export function PromptPanel(props: PromptPanelProps) {
  const { game, prompt, legalActions, contextualActions } = props;
  const variant: GameVariant = game.variant ?? 'classic';
  const { pending } = game;

  const content = (() => {
    if (pending?.kind === 'payment' && props.pendingPayment) {
      return <PaymentPanel {...props} request={props.pendingPayment} variant={variant} />;
    }
    if (pending?.kind === 'counter') {
      return <CounterPanel {...props} request={pending.payload} variant={variant} />;
    }
    if (pending?.kind === 'rent') {
      return (
        <>
          <PanelHeader
            title={`Charge $${pending.payload.amount} rent`}
            subtitle={`Choose who pays for your ${formatPropertyColor(pending.payload.color)} set.`}
          />
          <div className="panel-choice-list">
            {legalActions.map((item, index) => (
              <button
                key={`${item.label}-${index}`}
                type="button"
                className="glass-button panel-target"
                aria-label={item.label}
                onClick={() => props.onRunAction(item.action, item)}
                disabled={props.disabled}
              >
                <strong>{item.targetPlayerId ? nameOf(game, item.targetPlayerId) : item.label}</strong>
                {item.requiresPropertyTransfer ? <small>Can only pay with property</small> : null}
              </button>
            ))}
          </div>
        </>
      );
    }
    if (pending?.kind === 'sly_deal') {
      const targetId = pending.payload.targetPlayerId;
      const groups = groupByCard(legalActions, (action) => (action.type === 'sly_deal_pick' ? action.cardId : undefined));
      return <CardPickPanel title="Sly Deal" subtitle={`Take a property from ${nameOf(game, targetId)}.`} groups={groups} props={props} variant={variant} />;
    }
    if (pending?.kind === 'forced_deal') {
      return <ForcedDealPanel props={props} targetId={pending.payload.targetPlayerId} variant={variant} />;
    }
    if (pending?.kind === 'deal_breaker') {
      return <DealBreakerPanel props={props} targetId={pending.payload.targetPlayerId} variant={variant} />;
    }
    if (pending?.kind === 'debt_card') {
      return (
        <>
          <PanelHeader title="Debt Repaid" subtitle={`${nameOf(game, pending.payload.debtorPlayerId)} gave you this card. Decide what to do with it.`} />
          <div className="panel-single-card"><CardView cardId={pending.payload.cardId} width={88} gameVariant={variant} decorative /></div>
          <ChoiceList items={legalActions} props={props} />
        </>
      );
    }
    if (pending?.kind === 'no_mercy') {
      const { step, targetPlayerId, redistribution } = pending.payload;
      const byCard = groupByCard(legalActions, (action) => (action.type === 'no_mercy_pick' ? action.cardId : undefined));
      const pick = (title: string, subtitle: string) => <CardPickPanel title={title} subtitle={subtitle} groups={byCard} props={props} variant={variant} />;
      if (step === 'heist_pick') return pick('Heist', `Take a Bank card from ${nameOf(game, targetPlayerId)}.`);
      if (step === 'market_crash_pick') return pick('Market Crash', `Take a property from ${nameOf(game, targetPlayerId)}.`);
      if (step === 'repossession_keep') return pick('Repossession', 'Choose the one property you keep. The rest go to other players.');
      if (step === 'tax_collector_keep') return pick('Tax Collector', 'Choose the one Bank card you keep. The rest go to other players.');
      if (step === 'repossession_distribute' || step === 'tax_collector_distribute') {
        const cardId = redistribution?.[0]?.cardId;
        return (
          <>
            <PanelHeader title="Give This Card Away" subtitle="Choose who receives it." />
            {cardId ? <div className="panel-single-card"><CardView cardId={cardId} width={88} gameVariant={variant} decorative /></div> : null}
            <div className="panel-choice-list">
              {legalActions.map((item, index) => (
                <button
                  key={`${item.label}-${index}`}
                  type="button"
                  className="secondary-button"
                  aria-label={item.label}
                  onClick={() => props.onRunAction(item.action, item)}
                  disabled={props.disabled}
                >
                  {item.action.type === 'no_mercy_pick' && item.action.recipientPlayerId ? nameOf(game, item.action.recipientPlayerId) : item.label}
                </button>
              ))}
            </div>
          </>
        );
      }
      const title = step === 'tough_luck_choice' ? 'Tough Luck' : 'Your Move';
      const subtitle = step === 'tough_luck_choice' ? `Choose which cards to take from ${nameOf(game, targetPlayerId)}'s hand.` : readable(prompt.text);
      return (
        <>
          <PanelHeader title={title} subtitle={subtitle} />
          <ChoiceList items={legalActions} props={props} />
        </>
      );
    }
    // Nothing recognized: list whatever the rules allow.
    if (prompt.kind === 'selection' || prompt.kind === 'response' || prompt.kind === 'payment') {
      return (
        <>
          <PanelHeader title="Your Move" subtitle={readable(prompt.text)} />
          <ChoiceList items={legalActions} props={props} />
        </>
      );
    }
    // Wild moves start from a tap on the Wild itself, so they don't need a panel.
    const others = contextualActions.filter((item) => !['draw_cards', 'pass_turn', 'move_wild'].includes(item.action.type));
    return others.length > 0 ? <ChoiceList items={others} props={props} /> : null;
  })();

  if (!content) return null;
  return <section key={pending?.kind ?? prompt.kind} className="prompt-panel glass-panel" aria-label="Your move">{content}</section>;
}
