import type { PostGameSummary } from '../../stats';

export interface PostGameShareModel {
  winnerName: string;
  turns: number;
  durationLabel: string;
  winningMove: string;
  momentumShift: string;
  highlightCards: string;
  endedAtLabel: string;
  appUrl: string;
  players: Array<{ rank: number; name: string; completeSets: number; bankValue: number }>;
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return `${minutes}m ${rem}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['No key swing captured this match.'];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines - 1) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, maxCharsPerLine - 1))}…`;
  }
  return lines;
}

export function buildPostGameShareModel(summary: PostGameSummary): PostGameShareModel {
  const appUrl = typeof window === 'undefined' ? 'Play Monopoly Deal Local' : window.location.origin;
  return {
    winnerName: summary.winnerName ?? 'Unknown Player',
    turns: summary.turnCount,
    durationLabel: durationLabel(summary.durationSec),
    winningMove: summary.winningMove,
    momentumShift: summary.momentumShift,
    highlightCards: summary.highlightCards.length > 0 ? summary.highlightCards.join(' • ') : 'No standout cards recorded',
    endedAtLabel: new Date(summary.endedAt).toLocaleString(),
    appUrl,
    players: summary.players.map(({ rank, name, completeSets, bankValue }) => ({ rank, name, completeSets, bankValue })),
  };
}

// The brag image, matching `ShareCardView` in the iOS app: 380 x 420 points, drawn at three times that.
const SHARE_WIDTH = 1140;
const SHARE_HEIGHT = 1260;
const ROUNDED_FONT = "ui-rounded, 'SF Pro Rounded', 'Nunito Variable', -apple-system, 'Segoe UI', sans-serif";
const BODY_FONT = "-apple-system, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif";

function buildSvg(model: PostGameShareModel): string {
  const headline = model.winnerName === 'You' ? 'I won Monopoly Deal' : `${model.winnerName} won Monopoly Deal`;
  const headlineLines = wrapLines(headline, 22, 2).map(xmlEscape);
  const moveLines = wrapLines(model.winningMove.replaceAll('_', ' '), 52, 2).map(xmlEscape);
  const plural = (count: number) => `${count} ${count === 1 ? 'set' : 'sets'}`;
  const standingsTop = 440 + headlineLines.length * 90;
  const rows = model.players.slice(0, 5).map((player, index) => {
    const y = standingsTop + 150 + index * 66;
    return `
    <text x="110" y="${y}" fill="#fff" font-size="45" font-family="${BODY_FONT}" font-weight="700">${player.rank}. ${xmlEscape(player.name)}</text>
    <text x="1030" y="${y}" fill="#fff" font-size="45" font-family="${BODY_FONT}" text-anchor="end">${plural(player.completeSets)} · $${player.bankValue}</text>`;
  }).join('');
  const moveTop = standingsTop + 180 + Math.min(model.players.length, 5) * 66;
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" viewBox="0 0 ${SHARE_WIDTH} ${SHARE_HEIGHT}">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d1726"/>
      <stop offset="100%" stop-color="#09121f"/>
    </linearGradient>
    <radialGradient id="center" cx="0.5" cy="0.45" r="0.6">
      <stop offset="0%" stop-color="#17495a"/>
      <stop offset="100%" stop-color="#17495a" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="url(#base)"/>
  <rect width="${SHARE_WIDTH}" height="${SHARE_HEIGHT}" fill="url(#center)"/>
  <g transform="translate(450 120) scale(10)" fill="#f2c54f">
    <path d="M7 3h10v2h4v3a4 4 0 0 1-4 4h-.4a5 5 0 0 1-3.600 2.900V18h3v3H8v-3h3v-3.100A5 5 0 0 1 7.400 12H7a4 4 0 0 1-4-4V5h4zm0 4H5v1a2 2 0 0 0 2 2zm10 0v3a2 2 0 0 0 2-2V7z"/>
  </g>
  ${headlineLines.map((line, index) => `<text x="570" y="${450 + index * 90}" fill="#fff" font-size="78" font-weight="900" text-anchor="middle" font-family="${ROUNDED_FONT}">${line}</text>`).join('')}
  <text x="570" y="${standingsTop + 50}" fill="#fff" opacity="0.8" font-size="45" font-weight="600" text-anchor="middle" font-family="${BODY_FONT}">${model.turns} turns · ${xmlEscape(model.durationLabel)}</text>
  ${rows}
  ${moveLines.map((line, index) => `<text x="570" y="${moveTop + index * 50}" fill="#fff" opacity="0.8" font-size="39" font-weight="500" text-anchor="middle" font-family="${BODY_FONT}">${line}</text>`).join('')}
</svg>`.trim();
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load share preview image.'));
    image.src = url;
  });
}

export async function generatePostGameSharePng(summary: PostGameSummary): Promise<Blob> {
  const model = buildPostGameShareModel(summary);
  const svg = buildSvg(model);
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(svgUrl);
    const canvas = document.createElement('canvas');
    canvas.width = SHARE_WIDTH;
    canvas.height = SHARE_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas rendering is unavailable.');
    context.drawImage(image, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/png', 0.95);
    });
    if (!pngBlob) throw new Error('Unable to create PNG share image.');
    return pngBlob;
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export function postGameShareFilename(summary: PostGameSummary): string {
  const winner = (summary.winnerName ?? 'winner').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');
  return `monopoly-deal-${winner || 'winner'}-${summary.endedAt}.png`;
}
