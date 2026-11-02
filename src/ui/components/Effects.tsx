import { useEffect, useRef } from 'react';

// Celebration effects, each drawn on one canvas so hundreds of pieces stay smooth.
// Mirrors apps/ios/App/Design/Effects.swift.

function splitMix(seed: number) {
  let state = BigInt(seed);
  const mask = (1n << 64n) - 1n;
  return () => {
    state = (state + 0x9e3779b97f4a7c15n) & mask;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & mask;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & mask;
    z ^= z >> 31n;
    return Number(z >> 11n) / 2 ** 53;
  };
}

const CONFETTI_COLORS = ['#f2c54f', '#e5484d', '#30b47f', '#22d3ee', '#ec4899', '#f97316'];

function useCanvasLoop(draw: (ctx: CanvasRenderingContext2D, width: number, height: number, elapsed: number) => boolean) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    // jsdom has no canvas.
    if (!canvas || import.meta.env.MODE === 'test') return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const { clientWidth: width, clientHeight: height } = canvas;
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const keepGoing = draw(ctx, width, height, (now - start) / 1000);
      if (keepGoing) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [draw]);
  return ref;
}

function drawConfetti(ctx: CanvasRenderingContext2D, width: number, height: number, elapsed: number): boolean {
  const random = splitMix(7);
  for (let index = 0; index < 160; index += 1) {
    const x = random();
    const speed = 0.7 + random() * 0.7;
    const delay = random() * 2.5;
    const sway = random() * 44 + 12;
    const phase = random() * Math.PI * 2;
    const spin = random() * 8 + 3;
    const time = elapsed - delay;
    if (time < 0) continue;
    const y = ((time * 190 * speed) % (height + 60)) - 30;
    const squash = Math.abs(Math.cos(time * spin));
    ctx.save();
    ctx.translate(x * width + Math.sin(time * 2.4 + phase) * sway, y);
    ctx.rotate(time * spin);
    ctx.fillStyle = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
    ctx.fillRect(-4, -6 * squash, 8, 12 * squash);
    ctx.restore();
  }
  return true;
}

export function Confetti() {
  const ref = useCanvasLoop(drawConfetti);
  return <canvas ref={ref} className="confetti-canvas" aria-hidden="true" />;
}

const BURST_SECONDS = 1.1;

function drawGoldBurst(ctx: CanvasRenderingContext2D, width: number, height: number, elapsed: number): boolean {
  if (elapsed >= BURST_SECONDS) return false;
  const progress = elapsed / BURST_SECONDS;
  const random = splitMix(19);
  const sparks = 64;
  for (let index = 0; index < sparks; index += 1) {
    const angle = (index / sparks) * 2 * Math.PI + random() * 0.4;
    const reach = (0.45 + random() * 0.55) * Math.min(width, height) * 0.62;
    const distance = reach * (1 - (1 - progress) ** 3);
    const radius = (2 + random() * 3.5) * (1 - progress * 0.7);
    ctx.globalAlpha = 1 - progress * progress;
    ctx.fillStyle = index % 3 === 0 ? '#ffffff' : '#f2c54f';
    ctx.beginPath();
    ctx.arc(width / 2 + Math.cos(angle) * distance, height / 2 + Math.sin(angle) * distance + 60 * progress * progress, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  return true;
}

export function GoldBurst() {
  const ref = useCanvasLoop(drawGoldBurst);
  return <canvas ref={ref} className="gold-burst-canvas" aria-hidden="true" />;
}
