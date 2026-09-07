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
          <h4>Pending Flow Meanings</h4>
          <ul>
            <li>`counter`: resolve a Just Say No chain before card effect applies.</li>
            <li>`payment`: selected target must pay (bank first, then properties as needed).</li>
            <li>`selection`: source player must choose card/target details to continue.</li>
            <li>`discard`: active player must discard to 7 cards before ending turn.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
