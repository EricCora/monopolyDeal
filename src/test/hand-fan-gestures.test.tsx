import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HandFan } from '../ui/components/HandFan';

const CARDS = ['money_1#a', 'money_2#b', 'money_3#c', 'money_4#d', 'money_5#e'];

function renderHand(overrides: Partial<Parameters<typeof HandFan>[0]> = {}) {
  const onCardClick = vi.fn();
  const onBlockedCard = vi.fn();
  render(
    <HandFan
      cards={CARDS}
      playableCardIds={new Set(CARDS)}
      selectedCardId={null}
      onCardClick={onCardClick}
      onBlockedCard={onBlockedCard}
      interactive
      {...overrides}
    />,
  );
  return { hand: screen.getByLabelText(/player hand/i), onCardClick, onBlockedCard };
}

// A hand 400 points wide at this test's rect, with the last card centered near x = 330.
const touchAt = (x: number, y = 100) => ({ pointerId: 1, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
const mouseAt = (x: number, y = 100) => ({ pointerId: 2, pointerType: 'mouse', clientX: x, clientY: y, button: 0 });

describe('HandFan gestures', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
      x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 160, width: 400, height: 160, toJSON: () => ({}),
    }) as DOMRect);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('plays a card on a quick tap, and tells the handler it was a touch', () => {
    const { hand, onCardClick } = renderHand();
    fireEvent.pointerDown(hand, touchAt(330));
    fireEvent.pointerUp(hand, touchAt(330));
    expect(onCardClick).toHaveBeenCalledTimes(1);
    expect(onCardClick.mock.calls[0]).toEqual(['money_5#e', 'touch']);
  });

  it("doesn't play a card twice when the browser's click follows the tap", () => {
    const { hand, onCardClick } = renderHand();
    fireEvent.pointerDown(hand, touchAt(330));
    fireEvent.pointerUp(hand, touchAt(330));
    fireEvent.click(screen.getByRole('button', { name: /\$5 card/i }));
    expect(onCardClick).toHaveBeenCalledTimes(1);
  });

  it('still responds to a plain click from a keyboard or assistive technology', () => {
    const { onCardClick } = renderHand();
    fireEvent.click(screen.getByRole('button', { name: /\$1 card/i }));
    expect(onCardClick).toHaveBeenCalledWith('money_1#a', 'pointer');
  });

  it('spreads the hand 60 ms into a hold and enlarges the card under the finger', () => {
    const { hand, onCardClick } = renderHand();
    fireEvent.pointerDown(hand, touchAt(330));
    act(() => { vi.advanceTimersByTime(59); });
    expect(hand).not.toHaveClass('is-held');
    act(() => { vi.advanceTimersByTime(1); });
    expect(hand).toHaveClass('is-held');
    expect(document.querySelector('.hand-fan-card.is-focused')).toHaveAttribute('data-flip-id', 'money_5#e');
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('moves the enlarged card as the finger slides, and plays nothing on a slow release', () => {
    const { hand, onCardClick } = renderHand();
    fireEvent.pointerDown(hand, touchAt(330));
    act(() => { vi.advanceTimersByTime(80); });
    fireEvent.pointerMove(hand, touchAt(70));
    expect(document.querySelector('.hand-fan-card.is-focused')).toHaveAttribute('data-flip-id', 'money_1#a');
    act(() => { vi.advanceTimersByTime(400); });
    fireEvent.pointerUp(hand, touchAt(70));
    expect(onCardClick).not.toHaveBeenCalled();
    expect(hand).not.toHaveClass('is-held');
    expect(document.querySelector('.hand-fan-card.is-focused')).toBeNull();
  });

  it('still counts as a tap when the spread started but the finger lifted within 250 ms', () => {
    const { hand, onCardClick } = renderHand();
    fireEvent.pointerDown(hand, touchAt(330));
    act(() => { vi.advanceTimersByTime(100); });
    fireEvent.pointerUp(hand, touchAt(330));
    expect(onCardClick).toHaveBeenCalledWith('money_5#e', 'touch');
  });

  it('plays a card dragged up past the threshold', () => {
    const { hand, onCardClick } = renderHand();
    fireEvent.pointerDown(hand, touchAt(330, 100));
    fireEvent.pointerMove(hand, touchAt(330, 40));
    expect(hand).toHaveClass('is-dragging');
    fireEvent.pointerMove(hand, touchAt(330, 0));
    fireEvent.pointerUp(hand, touchAt(330, 0));
    expect(onCardClick).toHaveBeenCalledWith('money_5#e', 'touch');
  });

  it('returns a card that was dragged up only a little', () => {
    const { hand, onCardClick } = renderHand();
    fireEvent.pointerDown(hand, touchAt(330, 100));
    fireEvent.pointerMove(hand, touchAt(330, 60));
    fireEvent.pointerUp(hand, touchAt(330, 60));
    expect(onCardClick).not.toHaveBeenCalled();
    expect(hand).not.toHaveClass('is-dragging');
  });

  it("won't drag a card that can't be played", () => {
    const { hand, onCardClick, onBlockedCard } = renderHand({ playableCardIds: new Set() });
    fireEvent.pointerDown(hand, touchAt(330, 100));
    fireEvent.pointerMove(hand, touchAt(330, 0));
    expect(hand).not.toHaveClass('is-dragging');
    fireEvent.pointerUp(hand, touchAt(330, 0));
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onBlockedCard).not.toHaveBeenCalled();
  });

  it('shakes a card that cannot be played and reports it, instead of playing it', () => {
    const { hand, onCardClick, onBlockedCard } = renderHand({ playableCardIds: new Set(), interactive: false });
    fireEvent.pointerDown(hand, touchAt(330));
    fireEvent.pointerUp(hand, touchAt(330));
    expect(onCardClick).not.toHaveBeenCalled();
    expect(onBlockedCard).toHaveBeenCalledWith('money_5#e');
    expect(document.querySelector('.hand-fan-card-inner.is-shaking')).not.toBeNull();
  });

  it('lifts a card on mouse hover without spreading the hand, and a click is not a touch', () => {
    const { hand, onCardClick } = renderHand();
    fireEvent.pointerMove(hand, mouseAt(330));
    const hovered = document.querySelector('[data-flip-id="money_5#e"]') as HTMLElement;
    expect(hovered.style.transform).toContain('scale(1.14)');
    fireEvent.pointerDown(hand, mouseAt(330));
    act(() => { vi.advanceTimersByTime(100); });
    expect(hand).not.toHaveClass('is-held');
    fireEvent.pointerUp(hand, mouseAt(330));
    expect(onCardClick).toHaveBeenCalledWith('money_5#e', 'pointer');
  });

  it('deals the opening hand one card at a time, and only the opening hand', () => {
    const { unmount } = render(
      <HandFan cards={CARDS} playableCardIds={new Set()} selectedCardId={null} onCardClick={vi.fn()} interactive={false} dealOpening />,
    );
    const inners = [...document.querySelectorAll<HTMLElement>('.hand-fan-card-inner')];
    expect(inners.every((inner) => inner.classList.contains('is-arriving'))).toBe(true);
    expect(inners.map((inner) => inner.style.animationDelay)).toEqual(['0ms', '95ms', '190ms', '285ms', '380ms']);
    unmount();

    render(<HandFan cards={CARDS} playableCardIds={new Set()} selectedCardId={null} onCardClick={vi.fn()} interactive={false} />);
    expect(document.querySelector('.is-arriving')).toBeNull();
  });

  it('leaves out the deal under reduced motion', () => {
    render(<HandFan cards={CARDS} playableCardIds={new Set()} selectedCardId={null} onCardClick={vi.fn()} interactive={false} dealOpening reducedMotion />);
    expect(document.querySelector('.is-arriving')).toBeNull();
  });
});
