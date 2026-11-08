/* Push only. Never intercept or cache member pages, responses, or health data. */
const NOTICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
