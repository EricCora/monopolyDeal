export function redactSensitiveToken(token: string): string {
  if (!token) return '***';
  if (token.length <= 6) return '***';
  return `${token.slice(0, 2)}***${token.slice(-2)}`;
}
