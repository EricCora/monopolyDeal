import { describe, expect, it } from 'vitest';
import { pickNewReaction } from '../ui/table/newReaction';

const reaction = (id: number) => ({ id, kind: 'reaction' });

describe('which reaction flies', () => {
  it('leaves old reactions still when the table first opens', () => {
    expect(pickNewReaction([reaction(4)], undefined).reaction).toBeNull();
  });

  it('flies the first reaction of a room', () => {
    const opened = pickNewReaction([], undefined);
    expect(pickNewReaction([reaction(1)], opened.lastSeenId).reaction).toEqual(reaction(1));
  });

  it('flies a later reaction once, and ignores other activity', () => {
    const first = pickNewReaction([reaction(1)], undefined);
    const second = pickNewReaction([reaction(2), reaction(1)], first.lastSeenId);
    expect(second.reaction).toEqual(reaction(2));
    expect(pickNewReaction([{ id: 3, kind: 'chat' }, reaction(2), reaction(1)], second.lastSeenId).reaction).toBeNull();
  });
});
