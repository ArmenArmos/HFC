"use client";
import { useRef, useState, useTransition } from "react";
import { ShieldCheck } from "lucide-react";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import { setConsentFromCard } from "@/lib/consents/actions";
import { CONSENT_TITLE, MEMBER_CONSENT_KINDS, consentLines, type MemberConsentKind } from "@/lib/consents/copy";
import { consentItem, type ConsentDecision, type ConsentRow } from "@/lib/consents/schema";
import { COMMON, CONSENTS, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import type { ValidCard, ZoeCard } from "@/lib/zoe-chat-actions/registry";
import { CARD_REPLY_LOST } from "@/lib/zoe-chat-actions/thread-events";
import { formatMemberDate } from "@/lib/patient/date-format";
import { zoeName } from "@/lib/brand";

type Card = Extract<ValidCard, { kind: "consents" }>;
type Props = { card: Card; locale: CardLocale; onCard: (card: ZoeCard) => void; onAct: (id: string, acting: boolean) => void };
const when = (at: string, l: CardLocale) => formatMemberDate(at, l, { timeZone: "Asia/Yerevan", day: "numeric", month: "short", year: "numeric" });

/** One statement: what is recorded now, the full text, and an explicit two-step decision. */
function ConsentRowView({ card, kind, current, locale: l, onCard, onAct }: Props & { kind: MemberConsentKind; current: ConsentRow | undefined }) {
  const decided = card.outcome[consentItem(kind)] as ConsentDecision | undefined;
  const granted = decided ? decided.granted : current?.granted;
  const [pending, setPending] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [opId] = useState(() => crypto.randomUUID());
  const sending = useRef(false);
  const [title, ...lines] = consentLines(kind, l);
  const confirm = () => {
    if (pending === null || sending.current) return;
    sending.current = true; onAct(card.id, true);
    start(async () => {
      setProblem(null);
      let r: Awaited<ReturnType<typeof setConsentFromCard>> | null = null;
      try { r = await setConsentFromCard({ cardId: card.id, opId, kind, granted: pending, locale: l, method: "tap" }); }
      catch (error) {
        if (String((error as { digest?: unknown })?.digest ?? "").startsWith("NEXT_REDIRECT")) throw error;
        window.dispatchEvent(new Event(CARD_REPLY_LOST));
      }
      if (r?.card) onCard(r.card);
      if (r?.status === "ok") setPending(null);
      else {
        setProblem(r === null ? say(l, COMMON.unconfirmed) : r.status === "signed_out" ? "signed_out" : r.status === "stale" ? say(l, COMMON.staleInChat) : r.status === "closed" ? say(l, COMMON.closed) : say(l, COMMON.saveFailed));
        if (r) onAct(card.id, false);
      }
      sending.current = false;
    });
  };
  return <li data-consent-kind={kind}>
    <p><strong>{say(l, CONSENT_TITLE[kind])}</strong></p>
    <p className="cv2-hint">{granted === undefined ? say(l, CONSENTS.notDecided) : granted ? say(l, CONSENTS.granted) : say(l, CONSENTS.withdrawn)}</p>
    {decided && <p role="status">{say(l, CONSENTS.saved)}</p>}
    <details open={pending !== null || undefined}>
      <summary>{say(l, CONSENTS.read)}</summary>
      <div data-consent-statement><p><strong>{title}</strong></p>{lines.map((line, i) => <p key={i}>{line}</p>)}<p className="cv2-hint">{say(l, CONSENTS.draft)}</p></div>
    </details>
    {!decided && card.state === "open" && pending === null && <div className="cv2-seg">
      {granted !== true && <button type="button" onClick={() => setPending(true)}>{say(l, CONSENTS.grant)}</button>}
      {granted === true && <button type="button" onClick={() => setPending(false)}>{say(l, CONSENTS.withdraw)}</button>}
    </div>}
    {!decided && pending !== null && <div className="cv2-block">
      <button type="button" className="cv2-reading-save" disabled={busy} aria-busy={busy} onClick={confirm}>{say(l, pending ? CONSENTS.confirmGrant : CONSENTS.confirmWithdraw)}</button>
      <button type="button" className="cv2-link" disabled={busy} onClick={() => setPending(null)}>{say(l, CONSENTS.cancel)}</button>
    </div>}
    {problem === "signed_out" ? <SignInEnded locale={l} /> : problem && <p role="alert">{problem}</p>}
  </li>;
}

/** The member's consents: current choices, the full statements, decisions on an explicit confirm, and the history. */
export function ConsentsCard({ card, locale: l, onCard, onAct }: Props) {
  const current = new Map(card.snapshot.current.map(row => [row.kind, row]));
  return <article className="cv2-msg cv2-zoe" data-zoe-card="consents" data-chat-card-id={card.id} data-state={card.state} onClick={event => event.stopPropagation()}>
    <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
    <section className="cv2-reading cv2-block" aria-label={say(l, CONSENTS.title)}>
      <h3><ShieldCheck size={18} aria-hidden />{say(l, CONSENTS.title)}</h3>
      <p>{say(l, CONSENTS.lead)}</p>
      <ul>{MEMBER_CONSENT_KINDS.map(kind => <ConsentRowView key={kind} kind={kind} current={current.get(kind)} card={card} locale={l} onCard={onCard} onAct={onAct} />)}</ul>
      <details>
        <summary>{say(l, CONSENTS.history)}</summary>
        {card.snapshot.history.length ? <ol>{card.snapshot.history.map((row, i) => <li key={`${row.kind}:${row.recordedAt}:${i}`}>
          {say(l, CONSENT_TITLE[row.kind])}: {row.granted ? say(l, CONSENTS.granted) : say(l, CONSENTS.withdrawn)}, {say(l, row.method === "voice" ? CONSENTS.byVoice : CONSENTS.byTap)}, <time dateTime={row.recordedAt}>{when(row.recordedAt, l)}</time>
        </li>)}</ol> : <p>{say(l, CONSENTS.noHistory)}</p>}
      </details>
    </section>
  </article>;
}
