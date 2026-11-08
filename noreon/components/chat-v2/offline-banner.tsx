"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Call103 } from "@/components/patient/use-hydrated";
import { useBpOutboxReplay } from "@/components/patient/use-bp-card";
import type { ZoeCard } from "@/lib/zoe-chat-actions/registry";
import { offlineText } from "@/lib/offline/copy";
import type { Locale } from "@/lib/locale";

/** WP R: whether the browser says it is online (true on the server and before hydration). */
const subscribe = (changed: () => void) => {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed); };
};
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

/**
 * WP R: the member app's service worker (public/patient/sw.js, scope /patient/): push, plus a static offline page for
 * navigations that fail. Registered here when the member chat opens and none is registered yet; the push prompt
 * registers the same script and scope, so either order is one registration.
 */
export function useMemberServiceWorker() {
  useEffect(() => {
    const worker = typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
    if (!worker || typeof worker.getRegistration !== "function") return;
    worker.getRegistration("/patient/")
      .then(existing => existing && new URL(existing.scope).pathname === "/patient/" ? existing : worker.register("/patient/sw.js", { scope: "/patient/", updateViaCache: "none" }))
      .catch(() => undefined);
  }, []);
}

/**
 * WP R: the offline banner at the top of the member chat. Polite status, never a modal: the composer keeps working and
 * queues what is sent; the 103 line stays one tap away. `queued` counts what is waiting to go. It also owns the replay of
 * BP readings confirmed offline (saved in order with their own submission ids once back online; cards go to onCard).
 */
export function OfflineBanner({ locale: l, queued = 0, onCard }: { locale: Locale; queued?: number; onCard: (card: ZoeCard) => void }) {
  const online = useOnline();
  useMemberServiceWorker();
  useBpOutboxReplay(onCard);
  if (online && !queued) return null;
  return <div className="cv2-offline" role="status" aria-live="polite" data-offline-banner={online ? "sending" : "offline"}>
    <p>{online ? offlineText(l, "back") : offlineText(l, "banner")}</p>
    {!online && <p>{offlineText(l, "emergency")} <Call103 size="pill" className="cv2-offline-call" label={offlineText(l, "call103")}>103</Call103></p>}
  </div>;
}
