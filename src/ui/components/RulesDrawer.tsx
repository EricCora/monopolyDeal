import { useEffect, useMemo, useRef } from 'react';
import { PROPERTY_RENT_SCALES, PROPERTY_SET_SIZES, formatPropertyColor, type PropertyColor } from '../../cards/catalog';

interface RulesDrawerProps {
  onClose: () => void;
}

export function RulesDrawer({ onClose }: RulesDrawerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = root.querySelectorAll<HTMLButtonElement>('button');
    focusables[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      priorFocusRef.current?.focus();
    };
  }, []);

  const rows = useMemo(
    () =>
      (Object.keys(PROPERTY_SET_SIZES) as PropertyColor[]).map((color) => ({
        color: formatPropertyColor(color),
        setSize: PROPERTY_SET_SIZES[color],
        rent: PROPERTY_RENT_SCALES[color].join(' / '),
      })),
    [],
  );

  return (
    <div className="rules-drawer-overlay" role="presentation" onClick={onClose}>
      <div
        className="rules-drawer panel"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Rules reference"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="rules-drawer-head">
          <h3>Rules Reference</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="rules-drawer-subtitle">Quick lookup for sets, rent ladders, and pending interaction meanings.</p>

        <section className="rules-drawer-section">
          <h4>Your Turn</h4>
          <ul>
            <li>Draw 2 cards, or 5 if your hand is empty.</li>
            <li>Play up to 3 cards: to your Bank, your properties, or as actions.</li>
            <li>End with no more than 7 cards. Discard any extra.</li>
            <li>The first player with 3 complete sets of different colors wins.</li>
          </ul>
        </section>

        <section className="rules-drawer-section">
          <h4>Property Sets And Rent</h4>
          <p>Classic supports 2–5 players. Property cards, including Wilds, cannot be banked. A complete set needs at least one standard Property card; an any-color Wild alone earns no rent.</p>
          <p>Two-color Rent charges all opponents; any-color Rent charges one opponent. Each complete set except Railroads and Utilities can hold one House and one Hotel. A Hotel requires a House.</p>
          <div className="rules-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Color</th>
                  <th>Set Size</th>
                  <th>Rent Ladder</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.color}>
                    <td>{row.color}</td>
                    <td>{row.setSize}</td>
                    <td>{row.rent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rules-drawer-section">
          <h4>No Mercy</h4>
          <ul>
            <li>Everyone starts with 3 debt chips. If you can&apos;t pay in full, you pay all you can and take a chip.</li>
            <li>After drawing, repay debts before other plays. Each repayment card uses one of your plays.</li>
            <li>Every-color Wilds can&apos;t complete a set on their own or be used as payment.</li>
            <li>Shacks add $5 rent and move with the property they&apos;re on. A complete set can hold one Shack.</li>
            <li>Each player gets their own Just Say No chance against effects that hit everyone.</li>
          </ul>
        </section>

        <section className="rules-drawer-section">
          <h4>Interruptions</h4>
          <ul>
            <li>Just Say No: cancel an action against you, or answer another player&apos;s Just Say No.</li>
            <li>Payment: the target chooses which Bank cards and properties to pay with, and gets no change back.</li>
            <li>Complete sets are safe from Sly Deal and Forced Deal, but not from Deal Breaker.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
