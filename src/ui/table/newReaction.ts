/**
 * Picks the reaction to animate, if the feed's newest one hasn't been seen.
 * `undefined` means the table hasn't looked at the feed yet, so old reactions stay still.
 */
export function pickNewReaction<T extends { id: number; kind: string }>(feed: T[], lastSeenId: number | null | undefined): { reaction: T | null; lastSeenId: number | null } {
  const latest = feed.find((item) => item.kind === 'reaction') ?? null;
  if (!latest) return { reaction: null, lastSeenId: lastSeenId ?? null };
  const isNew = lastSeenId !== undefined && latest.id !== lastSeenId;
  return { reaction: isNew ? latest : null, lastSeenId: latest.id };
}
