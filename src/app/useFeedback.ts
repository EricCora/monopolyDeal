import { useCallback, useRef } from 'react';

interface UseFeedbackOptions {
  soundEnabled: boolean;
  hapticsEnabled: boolean;
}

export function useFeedback({ soundEnabled, hapticsEnabled }: UseFeedbackOptions) {
  const audioContextRef = useRef<AudioContext | null>(null);

  const emitFeedback = useCallback((tone: 'success' | 'error') => {
    if (hapticsEnabled && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(tone === 'error' ? [18, 25, 18] : 16);
    }
    if (!soundEnabled || typeof window === 'undefined') return;
    if (typeof window.AudioContext !== 'function') return;
    if (audioContextRef.current == null) {
      audioContextRef.current = new window.AudioContext();
    }
    const ctx = audioContextRef.current;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = tone === 'error' ? 'square' : 'triangle';
    oscillator.frequency.value = tone === 'error' ? 220 : 520;
    gain.gain.value = 0.05;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.07);
  }, [hapticsEnabled, soundEnabled]);

  return { emitFeedback };
}
