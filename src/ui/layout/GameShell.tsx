import type { ReactNode } from 'react';

interface GameShellProps {
  children: ReactNode;
  screenClassName?: string;
  textScale?: 'normal' | 'large';
}

export function GameShell({ children, screenClassName, textScale = 'normal' }: GameShellProps) {
  return (
    <main className={`game-shell text-scale-${textScale} ${screenClassName ?? ''}`}>
      <div className="game-shell-inner">{children}</div>
      <footer className="game-shell-footer">
        <small>Monopoly Deal local pass-and-play.</small>
      </footer>
    </main>
  );
}
