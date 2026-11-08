"use client";
import { forwardRef, type ReactNode } from "react";
import { KIT, t, type KitLocale } from "./copy";

/**
 * The thread's pieces (DESIGN.md §4): Zoe's turns, the member's bubbles, day dividers, notes and the typing dots.
 * The thread is a polite live log, so new Zoe text is announced without taking focus.
 */
export function Thread({ label, children }: { label: string; children: ReactNode }) {
  return <div className="zk-thread" role="log" aria-live="polite" aria-label={label}>{children}</div>;
}

type Voice = "zoe" | "nurse" | "doctor";
/**
 * One Zoe (or nurse, or doctor) turn: the "from" row only at the start of a run, then bubbles, an optional card
 * and the answer control, then the time. `lead` (a done row, say) comes before the bubbles. `heading` is focused by the caller when the turn asks something.
 */
export const ZoeTurn = forwardRef<HTMLDivElement, {
  locale: KitLocale; voice?: Voice; name?: string; initials?: string; role?: string; run?: boolean;
  progress?: string; lead?: ReactNode; say?: string[]; urgent?: boolean; at?: string; children?: ReactNode;
}>(function ZoeTurn({ locale: l, voice = "zoe", name, initials, role, run = false, progress, lead, say = [], urgent = false, at, children }, ref) {
  return (
    <div className="zk-turn" data-run={run} data-voice={voice}>
      {!run && (
        <p className="zk-from">
          {voice === "zoe" ? <span className="zk-orb" aria-hidden /> : <span className="zk-avatar" aria-hidden>{initials}</span>}
          {voice === "zoe" ? t(l, KIT.zoe) : name}
          <span>{voice === "zoe" ? t(l, KIT.role) : role}</span>
        </p>
      )}
      {progress && <p className="zk-progress">{progress}</p>}
      {lead}
      {say.map((text, i) => (
        <div key={i} ref={i === say.length - 1 ? ref : undefined} tabIndex={i === say.length - 1 ? -1 : undefined}
          className="zk-bubble" data-voice={urgent ? "urgent" : voice === "doctor" ? "doctor" : undefined}>{text}</div>
      ))}
      {children}
      {at && <p className="zk-time">{at}</p>}
    </div>
  );
});

export function MemberBubble({ locale: l, text, at, state = "sent", onRetry }: { locale: KitLocale; text: string; at?: string; state?: "sending" | "sent" | "failed"; onRetry?: () => void }) {
  return (
    <div className="zk-me" data-state={state}>
      <span className="sr-only">{t(l, KIT.you)}: </span>{text}
      <span className="zk-time">
        {state === "sending" ? t(l, KIT.sending) : state === "failed" ? t(l, KIT.notSent) : at}
        {state === "failed" && onRetry && <> <button type="button" className="zk-link" onClick={onRetry}>{t(l, KIT.retry)}</button></>}
      </span>
    </div>
  );
}

export function DayDivider({ label }: { label: string }) {
  return <p className="zk-day">{label}</p>;
}
export function Note({ children }: { children: ReactNode }) {
  return <p className="zk-note">{children}</p>;
}
export function Typing({ locale: l }: { locale: KitLocale }) {
  return (
    <div className="zk-turn" data-run="true">
      <span className="zk-typing" role="status" aria-label={t(l, KIT.writing)}><i /><i /><i /></span>
    </div>
  );
}
