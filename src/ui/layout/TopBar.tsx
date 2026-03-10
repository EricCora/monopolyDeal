import type { ReactNode } from 'react';

interface TopBarProps {
  title: string;
  kicker?: string;
  subtitle?: string;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function TopBar({ title, kicker = 'Local Match', subtitle, meta, actions }: TopBarProps) {
  return (
    <header className="top-bar panel card-enter">
      <div className="top-bar-copy">
        <p className="top-bar-kicker">{kicker}</p>
        <h2>{title}</h2>
        {subtitle ? <p className="top-bar-subtitle">{subtitle}</p> : null}
        {meta ? <div className="top-bar-meta">{meta}</div> : null}
      </div>
      {actions ? <div className="actions top-bar-actions">{actions}</div> : null}
    </header>
  );
}
