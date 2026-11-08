/*
 * Push, plus one static offline page (WP R). Never intercept or cache member pages, API responses, or health data.
 * The only response this worker ever stores is /patient/offline.html, a static page with no member data, fetched at
 * install without credentials. It is served only when a navigation inside /patient/ fails because there is no network;
 * every other request (API, data, scripts, images, Server Actions) goes to the network untouched.
 */
const NOTICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFLINE_CACHE = 'noreon-offline-shell-v1';
const OFFLINE_URL = '/patient/offline.html';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Push must keep working even if the page cannot be stored now: a failed fetch never fails the install.
    try {
      const response = await fetch(new Request(OFFLINE_URL, { cache: 'reload', credentials: 'omit', redirect: 'error' }));
      if (response.ok && response.type === 'basic' && (response.headers.get('content-type') || '').startsWith('text/html')) {
        await (await caches.open(OFFLINE_CACHE)).put(OFFLINE_URL, response);
      }
    } catch { /* The next install tries again. */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Only this worker's own offline page cache exists; older versions of it are removed.
    for (const name of await caches.keys()) if (name.startsWith('noreon-offline-shell-') && name !== OFFLINE_CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  // Navigations only. API, data, RSC and asset requests are never touched, cached or answered by this worker.
  if (request.mode !== 'navigate' || request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/patient/') || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      // The page itself always comes from the network and is never stored.
      return await fetch(request);
    } catch {
      const shell = await caches.match(OFFLINE_URL, { cacheName: OFFLINE_CACHE });
      return shell || Response.error();
    }
  })());
});

self.addEventListener('push', event => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (!payload || Object.keys(payload).sort().join(',') !== 'noticeId,text' || typeof payload.noticeId !== 'string' || !NOTICE_ID.test(payload.noticeId) || typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 240) return;
  // iPhone removes a subscription whose pushes show nothing, so every valid push shows. The tag collapses a repeat.
  event.waitUntil(self.registration.showNotification('Noreon', { body: payload.text, tag: payload.noticeId, renotify: false, data: { noticeId: payload.noticeId } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const id = event.notification.data?.noticeId;
  if (typeof id !== 'string' || !NOTICE_ID.test(id)) return;
  const url = new URL('/patient/chat', self.location.origin);
  url.searchParams.set('notice', id);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => new URL(client.url).origin === url.origin && new URL(client.url).pathname.startsWith('/patient/'));
    // navigate() refuses a page this worker does not control, so a new window is the fallback.
    try {
      if (existing) { await (await existing.navigate(url.href))?.focus(); return; }
    } catch { /* Open it below. */ }
    await self.clients.openWindow(url.href);
  })());
});
