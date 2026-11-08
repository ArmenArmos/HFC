let logoutGeneration = 0;
let signingOut = false;

/** Called only by the gated member chat, never the public or staff shells. */
export async function registerMemberPush(): Promise<ServiceWorkerRegistration> {
  signingOut = false;
  const registration = await navigator.serviceWorker.register('/patient/sw.js', { scope: '/patient/', updateViaCache: 'none' });
  if (!registration.active) {
    const worker = registration.installing ?? registration.waiting;
    if (!worker) throw new Error('Push worker unavailable');
    await new Promise<void>((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'activated' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', changed);
          if (worker.state === 'activated') resolve(); else reject(new Error('Push worker unavailable'));
        }
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
  }
  return registration;
}

export async function subscribeMemberPush(registration: ServiceWorkerRegistration, publicKey: string): Promise<void> {
  if (signingOut) throw new Error('Push session ended');
  const generation = logoutGeneration;
  const raw = window.atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'));
  const key = Uint8Array.from(raw, character => character.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  try {
    if (signingOut || generation !== logoutGeneration) throw new Error('Push session ended');
    const response = await fetch('/api/patient/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok || (await response.json()).ok !== true) throw new Error('Push subscription save failed');
    if (signingOut || generation !== logoutGeneration) throw new Error('Push session ended');
  } catch {
    // A failed save never removes the browser subscription: another tab may have saved it, and the next chat open saves it again.
    if (signingOut || generation !== logoutGeneration) {
      await subscription.unsubscribe().catch(() => false);
      await fetch('/api/patient/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }), signal: AbortSignal.timeout(4000) }).catch(() => {});
    }
    throw new Error('Push subscription save failed');
  }
}

/** Both cleanup attempts finish while the signed-in session still exists. */
export async function unsubscribeMemberPush(): Promise<void> {
  signingOut = true;
  logoutGeneration++;
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/patient/');
    if (!registration || new URL(registration.scope).pathname !== '/patient/') return;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      try {
        await fetch('/api/patient/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }), signal: AbortSignal.timeout(4000) });
      } catch { /* Browser cleanup must still happen when the server is unavailable. */ }
      await subscription.unsubscribe().catch(() => false);
    }
    const notifications = await registration.getNotifications();
    notifications.forEach(notification => notification.close());
  } catch { /* Signing out remains available if a browser API fails. */ }
}
