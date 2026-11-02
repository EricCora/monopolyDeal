import { useCallback, useRef } from 'react';

export type FeedbackTone = 'tap' | 'success' | 'error' | 'turn' | 'win';

interface UseFeedbackOptions {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

const VIBRATION: Record<FeedbackTone, number | number[]> = {
  tap: 8,
  success: 16,
  error: [18, 25, 18],
  turn: [12, 40, 12],
  win: [16, 30, 16, 30, 40],
};

// Frequency in hertz and length in seconds for each note.
const NOTES: Record<FeedbackTone, Array<[number, number]>> = {
  tap: [[880, 0.03]],
  success: [[520, 0.07]],
  error: [[220, 0.09]],
  turn: [[660, 0.07], [880, 0.09]],
  win: [[660, 0.08], [880, 0.08], [1175, 0.16]],
};

export function useFeedback({ soundEnabled, hapticsEnabled }: UseFeedbackOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);

  const emitFeedback = useCallback((tone: FeedbackTone) => {
    if (hapticsEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(VIBRATION[tone]);
    }
    if (!soundEnabled || typeof window === 'undefined') return;
    if (typeof window.AudioContext !== 'function') return;
    if (audioContextRef.current == null) {
      audioContextRef.current = new window.AudioContext();
    }
    const ctx = audioContextRef.current;
    let start = ctx.currentTime;
    NOTES[tone].forEach(([frequency, length]) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = tone === 'error' ? 'square' : 'triangle';
      oscillator.frequency.value = frequency;
      gain.gain.value = tone === 'tap' ? 0.025 : 0.05;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + length);
      start += length;
    });
  }, [hapticsEnabled, soundEnabled]);

  return { emitFeedback };
}
