import type { ReactNode } from 'react';

interface GameShellProps {
  children: ReactNode;
  screenClassName?: string;
  textScale?: 'normal' | 'large';
  highContrast?: boolean;
}

export function GameShell({ children, screenClassName, textScale = 'normal', highContrast = false }: GameShellProps) {
  return (
    <main className={`game-shell text-scale-${textScale} ${highContrast ? 'is-high-contrast' : ''} ${screenClassName ?? ''}`}>
      <div className="game-shell-inner">{children}</div>
      <footer className="game-shell-footer">
        <small>Monopoly Deal local pass-and-play.</small>
      </footer>
    </main>
  );
}
