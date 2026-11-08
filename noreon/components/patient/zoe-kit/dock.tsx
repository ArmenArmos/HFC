"use client";
import { ArrowUp } from "lucide-react";
import { KIT, t, type KitLocale } from "./copy";

/**
 * The bottom of the chat: the quick strip (what members usually do next; scrolls sideways, never wraps into a
 * wall) and the composer. `typing={false}` shows the composer read-only with the reason in its placeholder.
 */
export function Dock({ locale: l, label, chips, typing = true, onChip }: {
  locale: KitLocale; label: string; chips: { key: string; label: string }[]; typing?: boolean; onChip: (key: string) => void;
}) {
  return (
    <div className="zk-dock">
      {chips.length > 0 && (
        <div className="zk-strip" role="group" aria-label={label}>
          {chips.map(c => <button key={c.key} type="button" className="zk-reply" onClick={() => onChip(c.key)}>{c.label}</button>)}
        </div>
      )}
      <form className="zk-composer" onSubmit={e => e.preventDefault()}>
        <input aria-label={t(l, KIT.message)} placeholder={typing ? t(l, KIT.message) : t(l, KIT.typingOff)} disabled={!typing} />
        <button type="submit" className="zk-send" aria-label={t(l, KIT.sendMessage)} disabled={!typing}><ArrowUp className="size-5" aria-hidden /></button>
      </form>
    </div>
  );
}
