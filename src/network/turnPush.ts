import type { MultiplayerSession } from './multiplayerTypes';
import { fetchTurnPushKey, saveTurnPushSubscription } from './roomFeatures';

export type TurnPushResult = 'enabled' | 'denied' | 'unsupported' | 'unavailable';

export function canUseTurnPush(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64Url}${'='.repeat((4 - (base64Url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Asks permission, and registers this device to hear when it's this seat's turn. */
export async function enableTurnPush(session: MultiplayerSession): Promise<TurnPushResult> {
  if (!canUseTurnPush()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const publicKey = await fetchTurnPushKey();
  if (!publicKey) return 'unavailable';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription()
    ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await saveTurnPushSubscription(session, subscription.toJSON());
  return 'enabled';
}
