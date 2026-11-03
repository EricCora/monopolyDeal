export const FEEDBACK_EMAIL = 'tblsemail@gmail.com';

export function feedbackMailtoUrl(message: string, platform = 'Web'): string {
  const subject = encodeURIComponent('Monopoly Deal feedback');
  const body = encodeURIComponent(`${message.trim()}\n\n---\nSent from the ${platform} app`);
  return `mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`;
}
