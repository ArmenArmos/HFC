/**
 * Where the member is reading Noreon, as far as installing it goes.
 *
 * - `installed`: already running from the home screen.
 * - `telegram`: Telegram's in-app browser. It cannot install a web app, so the
 *   only honest step is to leave it for Safari or Chrome.
 * - `in-app`: another app's embedded browser (an Android WebView, Instagram,
 *   Facebook). Same limit as Telegram.
 * - `ios`: Safari or another iOS browser. iOS has no install API; the member
 *   adds Noreon from the Share menu by hand.
 * - `android`: an Android browser. Chromium offers `beforeinstallprompt`; the
 *   others have an item in their own menu.
 * - `desktop`: anything else. Only Chromium's prompt is worth offering there.
 */
export type InstallSurface = "installed" | "telegram" | "in-app" | "ios" | "android" | "desktop";
export type InstallOs = "ios" | "android" | "other";
export type InstallEnvironment = { surface: InstallSurface; os: InstallOs };

export type InstallSignals = {
  userAgent: string;
  /** iPadOS reports a Mac user agent; touch points tell the two apart. */
  maxTouchPoints?: number;
  /** `display-mode: standalone` or Safari's `navigator.standalone`. */
  standalone?: boolean;
  /**
   * Objects Telegram injects into its in-app browser: `TelegramWebviewProxy` on
   * iOS, `TelegramWebview` on Android, or a Mini App's non-empty `initData`.
   * iOS Telegram does not mark its user agent, so this is the only signal there.
   */
  telegramBridge?: boolean;
};

export function detectInstallEnvironment(signals: InstallSignals): InstallEnvironment {
  const ua = signals.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (signals.maxTouchPoints ?? 0) > 1);
  const android = !ios && /Android/i.test(ua);
  const os: InstallOs = ios ? "ios" : android ? "android" : "other";
  if (signals.standalone) return { surface: "installed", os };
  if (signals.telegramBridge || /Telegram/i.test(ua)) return { surface: "telegram", os };
  // `; wv)` is the Android WebView marker; FBAN/FBAV/Instagram/Line are the
  // common iOS and Android embedded browsers that name themselves.
  if (/FBAN|FBAV|FB_IAB|Instagram|\bLine\/|; wv\)/i.test(ua)) return { surface: "in-app", os };
  if (ios) return { surface: "ios", os };
  if (android) return { surface: "android", os };
  return { surface: "desktop", os };
}

/** Reads the live browser. Client only. */
export function readInstallEnvironment(): InstallEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  const win = window as Window & {
    TelegramWebviewProxy?: unknown;
    TelegramWebview?: unknown;
    Telegram?: { WebApp?: { initData?: string } };
  };
  return detectInstallEnvironment({
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    telegramBridge: win.TelegramWebviewProxy !== undefined || win.TelegramWebview !== undefined || !!win.Telegram?.WebApp?.initData,
  });
}

/**
 * An Android intent that asks the system to open this page in Chrome. Some
 * in-app browsers hand it on, others ignore it, so the card always offers
 * copying the link as well. Returns null for anything that is not http(s).
 */
export function chromeIntentUrl(href: string): string | null {
  let url: URL;
  try { url = new URL(href); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const scheme = url.protocol.slice(0, -1);
  return `intent://${url.host}${url.pathname}${url.search}#Intent;scheme=${scheme};package=com.android.chrome;end`;
}

export const INSTALL_DISMISS_KEY = "noreon.install-card.dismissed-until";
export const INSTALL_DISMISS_DAYS = 14;

/** Whether a "Not now" stored at `stored` still hides the card at `now`. */
export function installDismissed(stored: string | null, now: number): boolean {
  const until = stored ? Number(stored) : NaN;
  return Number.isFinite(until) && until > now;
}
