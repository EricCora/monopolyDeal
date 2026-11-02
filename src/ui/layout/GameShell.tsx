import type { ReactNode } from 'react';
import { DEFAULT_TABLE_STYLE, type TableStylePreset } from '../experience';

interface GameShellProps {
  children: ReactNode;
  screenClassName?: string;
  textScale?: 'normal' | 'large';
  highContrast?: boolean;
  tableStyle?: TableStylePreset;
  cardBack?: string;
}

export function GameShell({
  children,
  screenClassName,
  textScale = 'normal',
  highContrast = false,
  tableStyle = DEFAULT_TABLE_STYLE,
  cardBack = 'classic_red',
}: GameShellProps) {
  return (
    <main
      className={`game-shell text-scale-${textScale} table-style-${tableStyle.replace('_', '-')} card-back-${cardBack.replace('_', '-')} ${highContrast ? 'is-high-contrast' : ''} ${screenClassName ?? ''}`}
    >
      <div className="game-shell-inner">{children}</div>
      <footer className="game-shell-footer">
        <small>Monopoly Deal local pass-and-play.</small>
      </footer>
    </main>
  );
}
