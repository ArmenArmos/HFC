"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Only a deliberate return to the bottom resumes following. Polls and app returns never do. */
export function useThreadScroll(revision: string, firstUnseenKey?: string | null) {
  const thread = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const reading = useRef(false);
  const firstUnseen = useRef(firstUnseenKey);
  const previousRevision = useRef(revision);
  const [unread, setUnread] = useState(false);
  const newest = useCallback(() => {
    const box = thread.current;
    if (!box) return;
    following.current = true;
    // This jump's own scroll event can arrive after new content grew the thread. It is not a reader leaving.
    reading.current = false;
    box.scrollTop = box.scrollHeight;
    setUnread(false);
  }, []);
  const isFollowing = useCallback(() => following.current, []);
  const stopFollowing = useCallback(() => { following.current = false; }, []);
  useLayoutEffect(() => {
    const box = thread.current;
    const body = content.current;
    if (!box || !body) return;
    const intent = () => { reading.current = true; };
    const scroll = () => {
      if (!reading.current) return;
      following.current = box.scrollHeight - box.clientHeight - box.scrollTop < 4;
      if (following.current) setUnread(false);
    };
    const settle = () => { if (following.current) box.scrollTop = box.scrollHeight; };
    const back = () => { if (!document.hidden) requestAnimationFrame(settle); };
    for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) box.addEventListener(event, intent, { passive: true });
    box.addEventListener("scroll", scroll, { passive: true });
    const observer = new ResizeObserver(settle);
    observer.observe(box);
    observer.observe(body);
    window.addEventListener("pageshow", back);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    const first = firstUnseen.current ? box.querySelector<HTMLElement>(`[data-message-key="${firstUnseen.current}"]`) : null;
    if (first) {
      box.scrollTop += first.getBoundingClientRect().top - box.getBoundingClientRect().top - 12;
      following.current = box.scrollHeight - box.clientHeight - box.scrollTop < 4;
      setUnread(!following.current);
    } else settle();
    return () => {
      observer.disconnect();
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) box.removeEventListener(event, intent);
      box.removeEventListener("scroll", scroll);
      window.removeEventListener("pageshow", back);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);
  useLayoutEffect(() => {
    if (previousRevision.current === revision) return;
    previousRevision.current = revision;
    if (following.current) newest();
    // An actual message change, rather than a poll or a resize, announces unread content.
    else setUnread(true);
  }, [revision, newest]);
  return { threadRef: thread, contentRef: content, unread, newest, isFollowing, stopFollowing };
}
