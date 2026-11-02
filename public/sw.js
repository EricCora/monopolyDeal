const CACHE_VERSION = 'monopoly-deal-shell-v3';
const APP_SHELL = ['/', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response.ok || response.type !== 'basic') return response;
        const copy = response.clone();
        void caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});

// Turn-by-turn rooms: "it's your turn" notifications.
self.addEventListener('push', (event) => {
  let notification = { title: "It's your turn", body: 'Your move in Monopoly Deal.', url: '/', tag: 'turn' };
  try {
    notification = { ...notification, ...event.data.json() };
  } catch {
    // Show the general message.
  }
  event.waitUntil(self.registration.showNotification(notification.title, {
    body: notification.body,
    tag: notification.tag,
    icon: '/icons/app-icon-192.png',
    data: { url: notification.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const open = windows.find((entry) => new URL(entry.url).origin === self.location.origin);
    if (open) {
      open.navigate(url);
      return open.focus();
    }
    return self.clients.openWindow(url);
  }));
});
