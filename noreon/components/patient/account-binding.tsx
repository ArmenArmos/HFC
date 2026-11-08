"use client";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { PhoneIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { boundFetch } from "@/lib/patient/account-binding";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { parseLocale } from "@/lib/locale";

// One tab, one page's account. Module state, so the fetch wrapper and the component share it.
let bound: string | null = null;
// What stopped the tab: a write is told nothing was saved; a read saved nothing and lost nothing, so it is not told that.
let refused: "read" | "write" | null = null;
let installed = false;
const listeners = new Set<() => void>();
function refuse(request: "read" | "write") {
  refused = refused === "write" ? refused : request;
  for (const listener of listeners) listener();
}
/** The account this tab was rendered for, or null while that is unknown. Anything kept in the tab is kept per account. */
export const boundAccount = () => bound;
function install() {
  if (installed) return;
  installed = true;
  window.fetch = boundFetch(window.fetch.bind(window), {
    origin: window.location.origin,
    bound: () => bound,
    signInPage: () => window.location.pathname === "/patient",
    onRefused: refuse,
    fullLoad: (url) => window.location.assign(url),
  });
}
// At load, not at hydration: a navigation before the first commit would otherwise land in a tab that cannot tell whose it is.
if (typeof window !== "undefined") install();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

/**
 * Binds this tab to the account its page was rendered for, and covers the page when that stops being true (QA a6-01).
 * The account is kept through a refresh: forms and their typed values survive one, so a refresh that brings another
 * member's page must stop the tab rather than quietly rebind it. Only the sign-in page, where no member's form is left
 * on screen, releases it; everything else about the page is untouched.
 */
export function AccountBinding({ userId }: { userId: string | null }) {
  const path = usePathname();
  const lastPath = useRef(path);
  const blocked = useSyncExternalStore(subscribe, () => refused, () => null);
  useLayoutEffect(() => () => { bound = null; }, []);
  useLayoutEffect(() => {
    if (userId) {
      if (bound && bound !== userId) refuse("read");
      else bound = userId;
    } else if (path === "/patient") bound = null;
    // A page that opens without auth (103, help) can load during an outage, and the layout stays as it was across later
    // navigations. A full load gets the page and its account from one request, which a refresh could not: it may come
    // back after someone else signed in. Until it lands, this tab's writes say they have no account and are refused.
    else if (!bound && lastPath.current !== path) window.location.reload();
    lastPath.current = path;
  }, [userId, path]);
  if (!blocked) return null;
  // UNAPPROVED v1: Armenian and Russian wording for Tatevik.
  const l: PatientLocale = parseLocale(document.documentElement.lang, "hy");
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="account-changed-title" aria-describedby="account-changed-text" className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background p-5 text-foreground">
      <div className="w-full max-w-md space-y-4">
        <h1 id="account-changed-title" className="text-h2">
          {tx(l, "Այս դիտարկիչում մուտք է գործվել այլ հաշիվ", "Another account is signed in on this browser", "В этом браузере выполнен вход в другой аккаунт")}
        </h1>
        <p id="account-changed-text" className="text-body1">
          {blocked === "write" && `${tx(l, "Այս էջից ոչինչ չի պահպանվել։", "Nothing from this page was saved.", "С этой страницы ничего не сохранено.")} `}
          {tx(
            l,
            "Թարմացրեք էջը՝ շարունակելու համար այն հաշվով, որով հիմա մուտք է գործված։",
            "Reload to continue with the account that is signed in now.",
            "Обновите страницу, чтобы продолжить в аккаунте, вход в который выполнен сейчас.",
          )}
        </p>
        <Button className="h-auto min-h-11 w-full whitespace-normal" autoFocus onClick={() => window.location.reload()}>
          {tx(l, "Թարմացնել էջը", "Reload this page", "Обновить страницу")}
        </Button>
        <a href="tel:103" className="emergency-pill">
          <PhoneIcon className="size-4" aria-hidden />
          {tx(l, "Շտապ օգնություն 103", "Emergency 103", "Скорая помощь 103")}
        </a>
      </div>
    </div>
  );
}
