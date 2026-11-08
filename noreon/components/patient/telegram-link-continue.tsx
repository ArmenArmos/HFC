'use client';
import {startTransition, useEffect, useRef, useState, useTransition} from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import type {Route} from 'next';
import {useRouter} from 'next/navigation';
import {Button} from '@/components/ui/button';
import {continueTelegramLink} from '@/app/patient/telegram-link/actions';
import {signInContinuing} from '@/lib/patient/continue-path';

/**
 * One-tap sign-in from the bot's "Open Noreon" button: the token lives only in the #fragment and is removed
 * from the address bar. Opening the page signs in at once (the fragment never reaches a server or a link
 * preview); Continue stays as the retry. An expired, used or missing link goes straight to normal sign-in,
 * which then opens the page the link was for.
 */
export function TelegramLinkContinue({siteKey}: {siteKey: string}) {
  const router = useRouter();
  const captcha = useRef<HCaptcha>(null);
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  // Who is signed in: after a link sign-in (shown briefly before the page opens), or the other member already signed in here.
  const [signedInAs, setSignedInAs] = useState('');
  const [otherAccount, setOtherAccount] = useState('');
  const [busy, start] = useTransition();
  const [ios, setIos] = useState(false);
  const read = useRef(false);
  useEffect(() => {
    // Read once: the hash is cleared below, and effects may run twice in development.
    if (read.current) return;
    read.current = true;
    const t = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t');
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
    // iPadOS reports itself as a Mac; touch points tell them apart.
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    startTransition(() => { setToken(t && /^[A-Za-z0-9_-]{32}$/.test(t) ? t : null); setIos(apple); });
  }, []);
  function go(t: string, switchAccount = false) {
    start(async () => {
      setMessage('');
      setOtherAccount('');
      let captchaToken = '';
      try {
        if (siteKey) { captchaToken = (await captcha.current?.execute({async: true}))?.response ?? ''; captcha.current?.resetCaptcha(); }
        const r = await continueTelegramLink(t, captchaToken, switchAccount);
        if (r.ok) {
          setSignedInAs(r.maskedPhone);
          await new Promise(resolve => setTimeout(resolve, 1500));
          // A full load, so the tab binds to the account this link just signed in (QA a6-01).
          window.location.replace(r.path);
          return;
        }
        // Never swap accounts silently: ask (review F-1).
        if (r.reason === 'other_account') { setOtherAccount(r.maskedPhone); return; }
        // No dead end: normal sign-in, then on to the page the link was for.
        if (r.reason === 'expired') { router.replace(signInContinuing(r.path, true) as Route); return; }
        setMessage(r.reason === 'busy' ? 'Փորձեք մի քանի վայրկյանից։ / Try again in a few seconds. / Попробуйте снова через несколько секунд.' : 'Չհաջողվեց։ Փորձեք նորից։ / That did not work. Try again. / Не удалось. Попробуйте снова.');
      } catch { setMessage('Չհաջողվեց։ Փորձեք նորից։ / That did not work. Try again. / Не удалось. Попробуйте снова.'); }
    });
  }
  // Sign in as soon as the token is read (once; the captcha widget mounts in the same render).
  const started = useRef(false);
  useEffect(() => {
    if (token === undefined || started.current) return;
    started.current = true;
    if (token === null) router.replace(signInContinuing(null, true) as Route);
    else go(token);
  });
  if (!token) return null;
  return <section className="space-y-4">
    <h1 className="text-h1">Մուտք Noreon / Sign in to Noreon / Вход в Noreon</h1>
    {signedInAs ? <p role="status" data-signed-in-as className="text-body2">Դուք մուտք եք գործել որպես {signedInAs}։ Բացում ենք Ձեր էջը… / You are signed in as {signedInAs}. Opening your page… / Вы вошли как {signedInAs}. Открываем вашу страницу…</p>
    : otherAccount ? <div className="space-y-4" data-other-account>
      <p role="status" className="text-body2">Այս դիտարկիչում արդեն մուտք եք գործել որպես {otherAccount}։ Այս հղումը մեկ այլ հաշվի համար է։ / You are already signed in here as {otherAccount}. This link is for a different account. / Вы уже вошли в этом браузере как {otherAccount}. Эта ссылка предназначена для другой учётной записи.</p>
      <Button type="button" className="h-auto min-h-12 px-5 py-3" disabled={busy} onClick={() => go(token, true)}>Անցնել այդ հաշվին / Switch to that account / Перейти в эту учётную запись</Button>
      <a href="/patient/dashboard" className="inline-flex min-h-12 items-center underline">Մնալ {otherAccount} հաշվում / Stay signed in as {otherAccount} / Остаться в учётной записи {otherAccount}</a>
    </div>
    : <p role="status" className="text-body2">{busy || !message ? 'Մուտք ենք գործում… / Signing you in… / Выполняется вход…' : 'Սեղմեք «Շարունակել»՝ նորից փորձելու համար։ / Press Continue to try again. / Нажмите «Продолжить», чтобы попробовать снова.'}</p>}
    {message && <>
      <p role="alert" className="text-body2">{message}</p>
      <Button type="button" className="h-auto min-h-12 px-5 py-3" disabled={busy} onClick={() => go(token)}>{busy ? '…' : 'Շարունակել / Continue / Продолжить'}</Button>
      <a href="/patient" className="inline-flex min-h-12 items-center underline">Մուտք գործել / Sign in / Войти</a>
    </>}
    {ios && <IosLinkNote/>}
    {siteKey && <HCaptcha ref={captcha} sitekey={siteKey} size="invisible"/>}
  </section>;
}

/** STAGING draft copy, not yet signed off. On iPhone a Telegram link opens in Telegram's own browser or Safari, which do not share a session with the Home Screen app. */
function IosLinkNote() {
  return <aside data-ios-link-note className="space-y-2 rounded-xl border bg-muted/40 p-4 text-body2">
    <span className="inline-block rounded-md border px-1.5 text-caption text-muted-foreground">STAGING draft / Черновик для тестовой среды</span>
    <p lang="hy">iPhone-ում Telegram-ի հղումները բացվում են Telegram-ի ներքին դիտարկիչում կամ Safari-ում։ Այստեղ մուտք գործելը Գլխավոր էկրանի Noreon հավելվածում մուտք չի կատարում։ Եթե այնտեղ դուրս եք եկած, բացեք հավելվածը և նորից մուտք գործեք։</p>
    <p lang="ru">На iPhone ссылки из Telegram открываются во встроенном браузере Telegram или в Safari. Вход здесь не выполняет вход в приложение Noreon на вашем домашнем экране. Если вы вышли из учётной записи в приложении, откройте его и войдите снова.</p>
    <p lang="en">On iPhone, Telegram links open in Telegram&apos;s own browser or in Safari. Signing in here does not sign in the Noreon app on your Home Screen. If you are signed out there, open the app and sign in again.</p>
  </aside>;
}
