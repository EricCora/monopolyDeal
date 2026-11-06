import { useEffect, useState } from 'react';

/** A phone on its side: wider than tall and short. Mirrors `isLandscape` in `TableView.swift`. */
export const LANDSCAPE_PHONE_QUERY = '(orientation: landscape) and (max-height: 520px)';

/** Whether the table should use the landscape layout: opponents along the top, a large hand at the bottom. */
export function useLandscapePhone(): boolean {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(LANDSCAPE_PHONE_QUERY) : null;
  const [matches, setMatches] = useState(() => query?.matches ?? false);
  useEffect(() => {
    if (!query) return undefined;
    const sync = () => setMatches(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
    // The query string never changes, so one listener is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return matches;
}

/** How much of each hand card hangs below the screen in landscape. */
export const LANDSCAPE_HAND_OVERHANG = 0.27;

/** The hand's card width in landscape: 128 px on a large phone, less on a smaller one. */
export function landscapeHandWidth(height: number): number {
  return Math.min(128, Math.round(height * 0.29));
}
