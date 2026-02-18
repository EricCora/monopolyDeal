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
  };
}

function buildSvg(model: PostGameShareModel): string {
  const winningMoveLines = wrapLines(model.winningMove, 54, 2).map(xmlEscape);
  const momentumLines = wrapLines(model.momentumShift, 54, 2).map(xmlEscape);
  const highlightCardsLine = xmlEscape(model.highlightCards);
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#fff7e4"/>
      <stop offset="100%" stop-color="#e7efe9"/>
    </linearGradient>
    <radialGradient id="burstA" cx="0.2" cy="0.15" r="0.5">
      <stop offset="0%" stop-color="#f4c067" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#f4c067" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="burstB" cx="0.9" cy="0.05" r="0.45">
      <stop offset="0%" stop-color="#67b8aa" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#67b8aa" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#burstA)" />
  <rect width="1200" height="630" fill="url(#burstB)" />
  <rect x="50" y="50" width="1100" height="530" rx="26" fill="#fffdfa" stroke="#d9ccb5" stroke-width="3" />

  <text x="90" y="116" fill="#51606b" font-size="30" font-family="Avenir Next, Segoe UI, sans-serif" font-weight="700">Monopoly Deal Local</text>
  <text x="90" y="190" fill="#1f2f3c" font-size="68" font-family="Trebuchet MS, Gill Sans, sans-serif" font-weight="800">${xmlEscape(model.winnerName)} Wins!</text>

  <text x="90" y="256" fill="#4a5a66" font-size="34" font-family="Avenir Next, Segoe UI, sans-serif">Turns: ${model.turns}</text>
  <text x="330" y="256" fill="#4a5a66" font-size="34" font-family="Avenir Next, Segoe UI, sans-serif">Duration: ${xmlEscape(model.durationLabel)}</text>
  <text x="650" y="256" fill="#4a5a66" font-size="34" font-family="Avenir Next, Segoe UI, sans-serif">Finished: ${xmlEscape(model.endedAtLabel)}</text>

  <rect x="90" y="292" width="1020" height="212" rx="18" fill="#f8f2e4" stroke="#d7c8a9" stroke-dasharray="8 8" />
  <text x="120" y="338" fill="#2d3d49" font-size="30" font-family="Trebuchet MS, Gill Sans, sans-serif" font-weight="700">Winning move</text>
  ${winningMoveLines
    .map((line, index) => `<text x="120" y="${374 + index * 34}" fill="#465764" font-size="30" font-family="Avenir Next, Segoe UI, sans-serif">${line}</text>`)
    .join('\n')}
  <text x="120" y="440" fill="#2d3d49" font-size="30" font-family="Trebuchet MS, Gill Sans, sans-serif" font-weight="700">Momentum shift</text>
  ${momentumLines
    .map((line, index) => `<text x="120" y="${476 + index * 30}" fill="#465764" font-size="27" font-family="Avenir Next, Segoe UI, sans-serif">${line}</text>`)
    .join('\n')}
  <text x="120" y="534" fill="#2d3d49" font-size="24" font-family="Avenir Next, Segoe UI, sans-serif">Highlight cards: ${highlightCardsLine}</text>

  <text x="90" y="580" fill="#1d6b4f" font-size="31" font-family="Avenir Next, Segoe UI, sans-serif" font-weight="700">${xmlEscape(model.appUrl)}</text>
  <text x="90" y="610" fill="#51606b" font-size="24" font-family="Avenir Next, Segoe UI, sans-serif">Pass-and-play for 2-4 players</text>
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
    canvas.width = 1200;
    canvas.height = 630;
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
