"use client";
import { useEffect, useRef, useState } from 'react';
import { tx, type PatientLocale } from '@/lib/patient/copy';
import { registerMemberPush, subscribeMemberPush } from '@/lib/member-push/client';

const DISMISSED = 'noreon:member-push:not-now';
/** quiet: health questions come first, one thing at a time. A device that already said yes is still saved. */
export function MemberPushPrompt({ locale: l, publicKey, quiet = false }: { locale: PatientLocale; publicKey: string; quiet?: boolean }) {
  const [mode, setMode] = useState<'hidden' | 'install' | 'ask'>('hidden');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const registration = useRef<Promise<ServiceWorkerRegistration> | null>(null);
  useEffect(() => {
    const supported = window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    if (supported && Notification.permission === 'granted') {
      // A shared browser may now belong to another signed-in member. Reconcile ownership
      // without asking permission or depending on this device's previous prompt choice.
      registration.current = registerMemberPush();
      void registration.current.then(ready => subscribeMemberPush(ready, publicKey)).catch(() => {});
      return;
    }
    try { if (localStorage.getItem(DISMISSED)) return; } catch { /* Private browsing may deny storage. */ }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if ('Notification' in window && Notification.permission !== 'default') return;
    if (window.isSecureContext && ios && !standalone) { queueMicrotask(() => setMode('install')); return; }
    if (!supported) return;
    registration.current = registerMemberPush();
    // Install independently of permission, so the tap can call requestPermission immediately.
    void registration.current.then(() => setMode('ask'), () => {});
  }, [publicKey]);
  const dismiss = () => {
    try { localStorage.setItem(DISMISSED, '1'); } catch { /* Still dismiss for this visit. */ }
    setMode('hidden');
  };
  async function enable() {
    // Choosing the permission sheet also counts as this device's one-time prompt,
    // including when the browser sheet is dismissed with permission still default.
    try { localStorage.setItem(DISMISSED, '1'); } catch { /* Safe in private browsing. */ }
    // The browser requires this call in the original tap stack, before any await.
    const permission = Notification.requestPermission();
    setBusy(true); setFailed(false);
    try {
      if (await permission !== 'granted') { setMode('hidden'); return; }
      const ready = await registration.current;
      if (!ready) throw new Error('Push worker unavailable');
      await subscribeMemberPush(ready, publicKey);
      setMode('hidden');
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  if (mode === 'hidden' || quiet) return null;
  return <article className="cv2-msg cv2-zoe cv2-push" data-member-push>
    <p className="cv2-from"><i className="cv2-orb" aria-hidden />Zoe</p>
    <div className="cv2-say">
      <p>{mode === 'install'
        ? tx(l, 'Թարմացումների մասին ծանուցումներ ստանալու համար Safari-ի «Կիսվել» մենյուից ընտրեք «Ավելացնել գլխավոր էկրանին», ապա բացեք Noreon-ը այնտեղից։', 'To receive updates, open Safari’s Share menu, choose Add to Home Screen, then open Noreon from there.', 'Чтобы получать уведомления, в меню «Поделиться» Safari выберите «На экран Домой», затем откройте Noreon оттуда.')
        : tx(l, 'Ցանկանո՞ւմ եք ծանուցում ստանալ, երբ ձեր խնամքի թիմից թարմացում կա։ Ծանուցման մեջ առողջական տվյալներ չեն ցուցադրվի։', 'Would you like a notification when your care team has an update? Your health details will stay inside Noreon.', 'Хотите получать уведомления об обновлениях от вашей медицинской команды? Данные о здоровье останутся внутри Noreon.')}</p>
      {mode === 'ask' && <button type="button" disabled={busy} onClick={() => void enable()}>{tx(l, 'Միացնել ծանուցումները', 'Turn on notifications', 'Включить уведомления')}</button>}
      <button type="button" disabled={busy} onClick={dismiss}>{tx(l, 'Ոչ հիմա', 'Not now', 'Не сейчас')}</button>
      {failed && <p role="status">{tx(l, 'Չհաջողվեց միացնել ծանուցումները։ Փորձեք ավելի ուշ։', 'Could not turn on notifications. Try again later.', 'Не удалось включить уведомления. Попробуйте позже.')}</p>}
    </div>
  </article>;
}
