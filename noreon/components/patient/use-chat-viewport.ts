"use client";
import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * The page fills the screen with 100dvh. Safari's visual viewport can report too small a height even
 * with the keyboard closed, so it's used only while a field has focus, when the keyboard covers the page.
 */
export function useChatViewport(enabled: boolean) {
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const view = window.visualViewport;
    if (!enabled || !view) return;
    const root = document.documentElement;
    const editing = () => document.activeElement?.matches("input, textarea, select, [contenteditable]") === true;
    const clear = () => {
      root.style.removeProperty("--chat-view-height");
      root.style.removeProperty("--chat-view-top");
    };
    const sync = () => {
      setKeyboardOpen(editing() && window.innerHeight - view.height > 100);
      if (editing()) {
        root.style.setProperty("--chat-view-height", `${view.height}px`);
        root.style.setProperty("--chat-view-top", `${view.offsetTop}px`);
      } else clear();
      // Safari may leave the document or an outer layer scrolled after the keyboard closes.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      const thread = document.querySelector("[data-zoe-thread]");
      for (let layer = thread?.parentElement; layer; layer = layer.parentElement) {
        if (layer.scrollTop !== 0) layer.scrollTop = 0;
      }
    };
    // Don't resize on blur: the page would jump under the finger and the press would miss its button.
    // The keyboard closing fires a viewport event; the timer is for when it doesn't.
    const onFocusIn = () => requestAnimationFrame(sync);
    let settle = 0;
    const onFocusOut = () => { window.clearTimeout(settle); settle = window.setTimeout(sync, 500); };
    sync();
    view.addEventListener("resize", sync);
    view.addEventListener("scroll", sync);
    window.addEventListener("pageshow", sync);
    document.addEventListener("visibilitychange", sync);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      view.removeEventListener("resize", sync);
      view.removeEventListener("scroll", sync);
      window.removeEventListener("pageshow", sync);
      document.removeEventListener("visibilitychange", sync);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      window.clearTimeout(settle);
      clear();
    };
  }, [enabled]);
  return keyboardOpen;
}

/** Stays on the newest message when anything changes height, until the member scrolls up to read. */
export function useChatFollow(enabled: boolean, content: RefObject<HTMLElement | null>, { returnToNewest = false, startAtNewest = true } = {}) {
  const following = useRef(true);
  useEffect(() => {
    const box = content.current;
    if (!enabled || !box) return;
    following.current = startAtNewest;
    // Content settles once after opening. Later cards keep their own focus and scroll position.
    const settledAt = performance.now() + 3000;
    const stick = () => { if (following.current) box.scrollTop = box.scrollHeight; };
    const settle = () => { if (performance.now() < settledAt) stick(); };
    // Only the member can leave the newest message. While the page opens or returns, Safari restoring an old position can't.
    let reading = false;
    let guardUntil = settledAt;
    const onReading = () => { reading = true; };
    const onScroll = () => {
      if (reading) following.current = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
      else if (performance.now() < guardUntil) stick();
    };
    const reads = ["touchstart", "wheel", "pointerdown", "keydown"] as const;
    for (const type of reads) box.addEventListener(type, onReading, { passive: true });
    box.addEventListener("scroll", onScroll, { passive: true });
    const onReturn = () => {
      if (document.hidden) return;
      if (returnToNewest) following.current = true;
      reading = false;
      guardUntil = performance.now() + 1500;
      requestAnimationFrame(stick);
    };
    window.addEventListener("pageshow", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const frame = new ResizeObserver(stick);
    frame.observe(box);
    const contents = new ResizeObserver(settle);
    for (const child of Array.from(box.children)) contents.observe(child);
    return () => {
      for (const type of reads) box.removeEventListener(type, onReading);
      box.removeEventListener("scroll", onScroll);
      window.removeEventListener("pageshow", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      frame.disconnect();
      contents.disconnect();
    };
  }, [enabled, content, returnToNewest, startAtNewest]);
}
