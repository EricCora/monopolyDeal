import { describe, expect, it } from 'vitest';
import { feedbackMailtoUrl } from '../ui/feedbackMail';

describe('feedbackMailtoUrl', () => {
  it('addresses the developer and encodes the message', () => {
    const url = feedbackMailtoUrl('Love it & more?\nSecond line');
    expect(url.startsWith('mailto:tblsemail@gmail.com?subject=')).toBe(true);
    expect(decodeURIComponent(url.split('body=')[1])).toContain('Love it & more?\nSecond line');
  });
});
