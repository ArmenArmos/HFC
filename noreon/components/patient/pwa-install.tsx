"use client";

import { useEffect, useState } from "react";
import { Copy, Download, ExternalLink } from "lucide-react";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import {
  INSTALL_DISMISS_DAYS,
  INSTALL_DISMISS_KEY,
  chromeIntentUrl,
  installDismissed,
  readInstallEnvironment,
  type InstallEnvironment,
} from "@/lib/patient/install-environment";

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-body2 font-medium disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const primary = `${button} bg-primary text-primary-foreground`;
const secondary = `${button} border border-border bg-card text-foreground`;
const quiet = `${button} px-2 text-muted-foreground`;

function readDismissed() {
  try { return installDismissed(window.localStorage.getItem(INSTALL_DISMISS_KEY), Date.now()); } catch { return false; }
}

/**
 * The "Get the Noreon app" card. On Home it is dismissible ("Not now" hides it
 * for 14 days) and only shows where there is something to do; on Account it
 * always explains the steps.
 *
 * Installation is optional; this does not promise offline records or push delivery.
 */
export function PwaInstall({ locale, dismissible = false }: { locale: PatientLocale; dismissible?: boolean }) {
  const [env, setEnv] = useState<InstallEnvironment | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const update = () => { setEnv(readInstallEnvironment()); setDismissed(dismissible && readDismissed()); };
    const available = (event: Event) => {
      const candidate = event as InstallEvent;
      if (typeof candidate.prompt !== "function" || !candidate.userChoice) return;
      event.preventDefault();
      setPrompt(candidate);
      setError(false);
    };
    const complete = () => { setEnv((current) => current && { ...current, surface: "installed" }); setPrompt(null); };
    update();
    display.addEventListener("change", update);
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", complete);
    return () => {
      display.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", complete);
    };
  }, [dismissible]);

  async function install() {
    if (!prompt || pending) return;
    const current = prompt;
    setPrompt(null); // Browser prompts are single-use, including after dismissal.
    setPending(true);
    setError(false);
    try {
      await current.prompt();
      await current.userChoice;
      // Only appinstalled / standalone confirms installation, not prompt acceptance.
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  function notNow() {
    setDismissed(true);
    try { window.localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now() + INSTALL_DISMISS_DAYS * 86_400_000)); } catch { /* Hidden for this visit only. */ }
  }

  if (!env || env.surface === "installed" || dismissed) return null;
  const canPrompt = !!prompt || pending;
  // On Home a desktop browser without an install prompt has nothing to offer.
  if (dismissible && env.surface === "desktop" && !canPrompt) return null;
  const leave = env.surface === "telegram" || env.surface === "in-app";
  const browser = env.os === "android" ? "Chrome" : "Safari";

  return <section className="journey-card space-y-4" aria-labelledby="pwa-install-title" data-install-surface={env.surface}>
    <div className="flex items-start gap-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- the manifest icon, already a fixed small PNG */}
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className="size-11 shrink-0 rounded-lg" />
      <div className="min-w-0 space-y-1">
        <h2 id="pwa-install-title" className="text-h2">{leave
          ? tx(locale, `Բացեք Noreon-ը ${browser}-ում`, `Open Noreon in ${browser}`, `Откройте Noreon в ${browser}`)
          : tx(locale, "Տեղադրեք Noreon հավելվածը", "Get the Noreon app", "Установите приложение Noreon")}</h2>
        <p className="text-caption text-muted-foreground">{leave
          ? (env.surface === "telegram"
            ? tx(locale, `Telegram-ի դիտարկիչը չի կարող հավելվածներ ավելացնել գլխավոր էկրանին։ Բացեք այս էջը ${browser}-ում, և այնտեղ կտեսնեք, թե ինչպես ավելացնել Noreon-ը։`, `Telegram's browser can't add apps to your home screen. Open this page in ${browser} and you'll see how to add Noreon there.`, `В браузере Telegram нельзя добавлять приложения на главный экран. Откройте эту страницу в ${browser}, чтобы увидеть, как добавить Noreon.`)
            : tx(locale, `Այս հավելվածի դիտարկիչը չի կարող հավելվածներ ավելացնել գլխավոր էկրանին։ Բացեք այս էջը ${browser}-ում, և այնտեղ կտեսնեք, թե ինչպես ավելացնել Noreon-ը։`, `This app's browser can't add apps to your home screen. Open this page in ${browser} and you'll see how to add Noreon there.`, `В браузере этого приложения нельзя добавлять приложения на главный экран. Откройте эту страницу в ${browser}, чтобы увидеть, как добавить Noreon.`))
          : tx(locale, "Բացեք Noreon-ը գլխավոր էկրանից մեկ հպումով։ Ձեր տվյալները թարմացնելու համար դեռ անհրաժեշտ է ինտերնետ։", "Open Noreon from your home screen in one tap. Your records still need an internet connection.", "Открывайте Noreon с главного экрана одним касанием. Для доступа к вашим данным по-прежнему нужен интернет.")}</p>
      </div>
    </div>

    {leave ? <LeaveInAppBrowser locale={locale} env={env} browser={browser} />
      : env.surface === "ios" ? <IosSteps locale={locale} />
      : canPrompt ? null
      : <p className="text-body2">{env.surface === "android"
          ? tx(locale, "Բացեք դիտարկիչի ընտրացանկը (⋮) և ընտրեք «Install app» կամ «Add to Home screen»։", "Open your browser menu (⋮) and choose Install app or Add to Home screen.", "Откройте меню браузера (⋮) и выберите «Установить приложение» или «Добавить на главный экран».")
          : tx(locale, "Chrome-ում կամ Edge-ում օգտագործեք հասցեի տողի տեղադրման պատկերակը։ Այլ դիտարկիչներում շարունակեք օգտագործել Noreon-ը որպես կայք։", "In Chrome or Edge, use the install icon in the address bar. In other browsers, keep using Noreon as a website.", "В Chrome или Edge используйте значок установки в адресной строке. В других браузерах продолжайте пользоваться сайтом Noreon.")}</p>}

    {error && <p role="status" className="text-caption">{tx(locale, "Օգտագործեք դիտարկիչի ընտրացանկը՝ Noreon-ը գլխավոր էկրանին ավելացնելու համար։", "Use your browser menu to add Noreon to your home screen.", "Добавьте Noreon на главный экран через меню браузера.")}</p>}
    {(dismissible || (canPrompt && !leave && env.surface !== "ios")) && <div className="flex flex-wrap items-center gap-2">
      {canPrompt && !leave && env.surface !== "ios" && <button type="button" onClick={install} disabled={pending} className={primary}>
        <Download className="size-4" aria-hidden />{pending ? tx(locale, "Սպասում ենք դիտարկիչին", "Waiting for your browser", "Ожидаем ответа браузера") : tx(locale, "Տեղադրել Noreon-ը", "Install Noreon", "Установить Noreon")}
      </button>}
      {dismissible && <button type="button" onClick={notNow} className={`${quiet} ml-auto`}>{tx(locale, "Ոչ հիմա", "Not now", "Не сейчас")}</button>}
    </div>}
  </section>;
}

function LeaveInAppBrowser({ locale, env, browser }: { locale: PatientLocale; env: InstallEnvironment; browser: string }) {
  // Only mounted after the parent has read the browser, so window is defined.
  const [href] = useState(() => window.location.href);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const intent = env.os === "android" && href ? chromeIntentUrl(href) : null;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(href);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return <div className="space-y-3">
    <p className="text-body2">{env.os === "android"
      ? tx(locale, "Եթե «Բացել Chrome-ում» կոճակը ոչինչ չանի, բացեք ընտրացանկը (⋮) և ընտրեք «Open in browser», կամ պատճենեք հղումը։", "If Open in Chrome does nothing, open the menu (⋮) and choose Open in browser, or copy the link.", "Если кнопка «Открыть в Chrome» не работает, откройте меню (⋮) и выберите «Открыть в браузере» или скопируйте ссылку.")
      : tx(locale, `Դիտարկիչի ընտրացանկում ընտրեք «Open in Safari», կամ պատճենեք հղումը և տեղադրեք այն ${browser}-ի հասցեի տողում։`, `Choose Open in Safari from this browser's menu, or copy the link and paste it into ${browser}'s address bar.`, `В меню браузера выберите «Открыть в Safari» или скопируйте ссылку и вставьте её в адресную строку ${browser}.`)}</p>
    <div className="flex flex-wrap gap-2">
      {intent && <a href={intent} className={primary}><ExternalLink className="size-4" aria-hidden />{tx(locale, "Բացել Chrome-ում", "Open in Chrome", "Открыть в Chrome")}</a>}
      <button type="button" onClick={copyLink} disabled={!href} className={intent ? secondary : primary}>
        <Copy className="size-4" aria-hidden />{tx(locale, "Պատճենել հղումը", "Copy link", "Скопировать ссылку")}
      </button>
    </div>
    {copied === "done" && <p role="status" className="text-caption text-muted-foreground">{tx(locale, `Հղումը պատճենված է։ Տեղադրեք այն ${browser}-ում։ Այնտեղ գուցե պետք լինի նորից մուտք գործել։`, `Link copied. Paste it into ${browser}. You may need to sign in again there.`, `Ссылка скопирована. Вставьте её в ${browser}. Возможно, там понадобится войти снова.`)}</p>}
    {copied === "failed" && <div role="status" className="space-y-2">
      <p className="text-caption text-muted-foreground">{tx(locale, "Չհաջողվեց պատճենել։ Պահեք մատը հղման վրա՝ այն պատճենելու համար։", "Couldn't copy. Press and hold the link to copy it.", "Не удалось скопировать. Нажмите и удерживайте ссылку, чтобы скопировать её.")}</p>
      <input readOnly value={href} aria-label={tx(locale, "Էջի հղումը", "Link to this page", "Ссылка на эту страницу")} onFocus={(event) => event.currentTarget.select()} className="w-full rounded-md border border-border bg-card px-3 py-2 text-caption" />
    </div>}
  </div>;
}

function IosSteps({ locale }: { locale: PatientLocale }) {
  return <ol className="grid gap-3 sm:grid-cols-2">
    <li className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
      <ShareStep />
      <div className="space-y-1">
        <p className="text-body2 font-medium">{tx(locale, "1. Հպեք «Share»", "1. Tap Share", "1. Нажмите «Поделиться»")}</p>
        <p className="text-caption text-muted-foreground">{tx(locale, "Սլաքով քառակուսին է։ Նոր iPhone-ներում նախ հպեք •••։", "It's the square with an arrow. On newer iPhones, tap ••• first.", "Это квадрат со стрелкой. На новых iPhone сначала нажмите •••.")}</p>
      </div>
    </li>
    <li className="flex items-center gap-3 rounded-lg bg-muted/60 p-3">
      <AddStep />
      <div className="space-y-1">
        <p className="text-body2 font-medium">{tx(locale, "2. Ընտրեք «Add to Home Screen»", "2. Choose Add to Home Screen", "2. Выберите «На экран Домой»")}</p>
        <p className="text-caption text-muted-foreground">{tx(locale, "Եթե չեք տեսնում, թերթեք ներքև, ապա հպեք «Add»։", "Scroll down if you don't see it, then tap Add.", "Если вы не видите этот пункт, прокрутите вниз, затем нажмите «Добавить».")}</p>
      </div>
    </li>
  </ol>;
}

/** A phone's bottom toolbar with the Share button ringed. */
function ShareStep() {
  return <svg viewBox="0 0 64 64" className="size-16 shrink-0" aria-hidden>
    <rect x="6" y="2" width="52" height="60" rx="8" className="fill-card stroke-border" strokeWidth="2" />
    <rect x="12" y="10" width="40" height="7" rx="3.5" className="fill-muted" />
    <line x1="6" y1="44" x2="58" y2="44" className="stroke-border" strokeWidth="1.5" />
    <path d="M15 50l-3 3 3 3" className="fill-none stroke-muted-foreground" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="32" cy="53" r="8" className="fill-none stroke-brand-teal" strokeWidth="2" />
    <path d="M29 51.5v5h6v-5M32 48.5v5M30 50.5l2-2 2 2" className="fill-none stroke-primary" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="46" cy="53" r="1.2" className="fill-muted-foreground" />
    <circle cx="50" cy="53" r="1.2" className="fill-muted-foreground" />
    <circle cx="54" cy="53" r="1.2" className="fill-muted-foreground" />
  </svg>;
}

/** The share sheet with the Add to Home Screen row ringed. */
function AddStep() {
  return <svg viewBox="0 0 64 64" className="size-16 shrink-0" aria-hidden>
    <rect x="6" y="2" width="52" height="60" rx="8" className="fill-card stroke-border" strokeWidth="2" />
    <rect x="12" y="10" width="40" height="8" rx="2" className="fill-muted" />
    <rect x="10" y="24" width="44" height="14" rx="4" className="fill-none stroke-brand-teal" strokeWidth="2" />
    <rect x="15" y="27" width="8" height="8" rx="2" className="fill-none stroke-primary" strokeWidth="1.6" />
    <path d="M19 29v4M17 31h4" className="stroke-primary" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="27" y="29.5" width="22" height="3" rx="1.5" className="fill-primary" />
    <rect x="12" y="44" width="40" height="6" rx="2" className="fill-muted" />
    <rect x="12" y="53" width="40" height="5" rx="2" className="fill-muted" />
  </svg>;
}
