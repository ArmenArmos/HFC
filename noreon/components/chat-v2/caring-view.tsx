"use client";
import { useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRealtimeSignals, useSignalNotices } from "@/components/realtime/use-realtime-signals";
import { SignalNotices } from "@/components/realtime/signal-notices";
import { UsersRound } from "lucide-react";
import type { CaredMember, CaregiverInvitation } from "@/lib/caregivers/schema";
import { RELATIONSHIP_LABEL, SCOPE_LABEL } from "@/lib/consents/copy";
import { CARING, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import { formatMemberDate } from "@/lib/patient/date-format";
import { noreonName, zoeName } from "@/lib/brand";
import { tx } from "@/lib/patient/copy";
import { CaregiverInvitations } from "./caregiver-invitations";

/**
 * The caregiver's minimal chat surface (WP F): invitations to accept or decline, then the members this account helps,
 * each as a Zoe message. The caregiver assistant conversation is built here by a later work package.
 */
export function CaringView({ locale: l, status, invitations, members }: { locale: CardLocale; status: "ok" | "unavailable" | "disabled"; invitations: CaregiverInvitation[]; members: CaredMember[] }) {
  const router = useRouter();
  // WP R: a caregiver_notice signal (ids only) re-reads this page and says so at the top; the action shows the list.
  const { notices, push, dismiss } = useSignalNotices();
  const list = useRef<HTMLElement>(null);
  useRealtimeSignals({ plane: "member", enabled: status === "ok", onSignal: useCallback((kind, ref) => {
    if (kind !== "caregiver_notice") return;
    router.refresh();
    push(kind, ref);
  }, [router, push]), onResync: useCallback(() => router.refresh(), [router]) });
  return <main className="cv2-root" lang={l} data-caring>
    <header className="cv2-header"><h1><i className="cv2-orb" aria-hidden />{noreonName(l)}</h1></header>
    <div className="cv2-greet"><h2>{zoeName(l)}</h2><p>{tx(l, "ԱԲ օգնական, ոչ բժիշկ", "AI assistant, not a doctor", "ИИ-помощник, не врач")}</p></div>
    <section className="cv2-thread" role="log" aria-live="polite" aria-label={say(l, CARING.title)} tabIndex={0}>
      <div className="cv2-messages">
        <SignalNotices notices={notices} locale={l} onDismiss={dismiss} actions={{ caregiver_notice: () => { list.current?.scrollIntoView({ block: "start" }); list.current?.focus({ preventScroll: true }); } }} />
        {status !== "ok" ? <article className="cv2-msg cv2-zoe"><p className="cv2-say" role="status">{say(l, status === "disabled" ? CARING.disabled : CARING.unavailable)}</p></article> : <>
          <CaregiverInvitations invitations={invitations} locale={l} onAnswered={() => router.refresh()} />
          <article className="cv2-msg cv2-zoe" data-cared-members>
            <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
            <section ref={list} tabIndex={-1} className="cv2-reading cv2-block" aria-label={say(l, CARING.title)}>
              <h3><UsersRound size={18} aria-hidden />{say(l, CARING.title)}</h3>
              {members.length ? <ul>{members.map(m => <li key={m.linkId} data-cared-member={m.linkId}>
                <p><strong>{m.firstName ?? say(l, RELATIONSHIP_LABEL[m.relationship])}</strong>, {say(l, RELATIONSHIP_LABEL[m.relationship])}</p>
                <p className="cv2-hint">{say(l, CARING.since(formatMemberDate(m.since, l, { timeZone: "Asia/Yerevan", day: "numeric", month: "short", year: "numeric" })))}</p>
                <ul>{m.scopes.map(scope => <li key={scope}>{say(l, SCOPE_LABEL[scope])}</li>)}</ul>
              </li>)}</ul> : <p>{say(l, CARING.none)}</p>}
            </section>
          </article>
        </>}
      </div>
    </section>
  </main>;
}
