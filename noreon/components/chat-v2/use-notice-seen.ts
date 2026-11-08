"use client";
import { useEffect, useRef, type RefObject } from "react";
import type { ZoeThread } from "@/lib/zoe/app-chat-contracts";

/** Seen receipts use ordinary fetch, so they never queue behind a send or an urgent action. */
export function useNoticeSeen(thread: RefObject<HTMLElement | null>, notices: ZoeThread["notices"]) {
  const sent = useRef(new Set<string>());
  useEffect(() => {
    const root = thread.current;
    if (!root || !notices?.length || typeof IntersectionObserver === "undefined") return;
    const order = new Map(notices.map((notice, index) => [notice.id, index]));
    const visible = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        if (document.visibilityState !== "visible") return;
        const id = [...visible].filter(id => !sent.current.has(id)).sort((a, b) => order.get(b)! - order.get(a)!)[0];
        if (!id) return;
        const covered = notices.slice(0, order.get(id)! + 1).map(notice => notice.id);
        for (const seen of covered) sent.current.add(seen);
        // A lost receipt goes again at the next observation or return, so reopening never lands on read notices.
        const retry = () => { for (const seen of covered) sent.current.delete(seen); };
        void fetch("/api/patient/zoe/notices/seen", {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        }).then(response => { if (!response.ok) retry(); }, retry);
      }, 300);
    };
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.notice;
        if (!id || !order.has(id)) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) visible.add(id);
        else visible.delete(id);
      }
      schedule();
    }, { root, threshold: [0, 0.6] });
    for (const notice of root.querySelectorAll<HTMLElement>("[data-notice]")) observer.observe(notice);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [thread, notices]);
}
