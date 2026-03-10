import type { ReactNode } from 'react';
import { DEFAULT_TABLE_STYLE, type TableStylePreset } from '../experience';

interface GameShellProps {
  children: ReactNode;
  screenClassName?: string;
  textScale?: 'normal' | 'large';
  highContrast?: boolean;
  tableStyle?: TableStylePreset;
}

export function GameShell({
  children,
  screenClassName,
  textScale = 'normal',
  highContrast = false,
  tableStyle = DEFAULT_TABLE_STYLE,
}: GameShellProps) {
  return (
    <main
      className={`game-shell text-scale-${textScale} table-style-${tableStyle.replace('_', '-')} ${highContrast ? 'is-high-contrast' : ''} ${screenClassName ?? ''}`}
    >
      <div className="game-shell-inner">{children}</div>
      <footer className="game-shell-footer">
        <small>Monopoly Deal local pass-and-play.</small>
      </footer>
    </main>
  );
}
