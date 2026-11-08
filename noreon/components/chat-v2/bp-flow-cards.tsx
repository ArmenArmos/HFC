"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { zoeName } from "@/lib/brand";
import { CheckCircle2, Info, PhoneCall, ShieldAlert, TriangleAlert } from "lucide-react";
import { cardProblem, runCardAction } from "@/components/patient/use-bp-card";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import { ZoeEmergencyCard } from "@/components/patient/zoe-emergency-card";
import { answerRedFlagFromCard } from "@/lib/zoe-chat-actions/actions";
import { answersOn, chipState, nextQuestion, redOutcome, RED_FLAG_QUESTIONS, type BpFlow, type ContextStrip, type RedFlagQuestion } from "@/lib/zoe-chat-actions/bp-flow";
import { BP, FLAG_QUESTION, FLOW, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import type { ValidCard, ZoeCard, ZoeCards } from "@/lib/zoe-chat-actions/registry";
import { DialogTurn } from "./dialog-turn";
import { Speaker } from "./speaker";

type Zone = NonNullable<BpFlow["zone"]>;
const ZONE: Record<Zone, { icon: typeof Info; label: keyof typeof FLOW }> = {
  green: { icon: CheckCircle2, label: "zoneGreen" }, yellow: { icon: Info, label: "zoneYellow" },
  orange: { icon: TriangleAlert, label: "zoneOrange" }, red: { icon: ShieldAlert, label: "zoneRed" },
};
/** Never a colour alone: always the icon and the words. */
function ZoneTag({ zone, locale: l }: { zone: Zone; locale: CardLocale }) {
  const { icon: Icon, label } = ZONE[zone];
  return <span className="cv2-zone" data-zone={zone}><Icon size={15} aria-hidden />{say(l, FLOW[label] as { hy: string; en: string; ru: string })}</span>;
}

/** Zoe's reply to a reading the rules have read. "Sent" words appear only for a task that really landed. */
export function FlowWords({ flow, locale: l, tasks }: { flow: BpFlow; locale: CardLocale; tasks?: ZoeCards["tasks"] }) {
  const { zone, provisional, sentTo, next } = flow;
  const raised = zone === "yellow" || zone === "orange";
  const line = (text: { hy: string; en: string; ru: string }) => <p key={text.en}>{say(l, text)}</p>;
  const lines = zone === "red" ? [FLOW.call103]
    : flow.alertId && sentTo === "physician" ? [flow.alertReason === "bp_doctor_today" ? FLOW.doctorToday : FLOW.doctor48]
    : provisional && !sentTo ? [FLOW.thanks, ...(next ? [FLOW.checking] : [FLOW.notSent])]
    : !raised ? [FLOW.thanks, ...(zone === null ? [BP.worried] : [])]
    : !sentTo ? [FLOW.thanks, FLOW.notSent]
    : [zone === "orange" ? (sentTo === "physician" ? FLOW.doctorToday : FLOW.nurseToday) : (sentTo === "physician" ? FLOW.doctor48 : FLOW.nurse48)];
  const state = chipState(flow.taskIds, tasks ?? []);
  const word = state === "answered" ? FLOW.answered : state === "seen_nurse" ? FLOW.seenNurse : state === "seen_doctor" ? FLOW.seenDoctor : FLOW.sent;
  return <>
    {lines.map(line)}
    {zone === "orange" && line(FLOW.noDouble)}
    {flow.outOfHours && <p data-zoe-out-of-hours>{say(l, flow.nurseTask ? FLOW.outOfHours : FLOW.clinicClosed)}</p>}
    {state && <p className="cv2-chip" data-zoe-chip={state}>{say(l, word)}{state !== "answered" && flow.slaHours ? ` · ${say(l, FLOW.within(flow.slaHours))}` : ""}</p>}
  </>;
}

/** The zone beside a reading's reply, for yellow and orange. */
export const FlowZone = ({ flow, locale }: { flow: BpFlow; locale: CardLocale }) =>
  flow.zone === "yellow" || flow.zone === "orange" ? <ZoneTag zone={flow.zone} locale={locale} /> : null;

/** Finished safety questions. A yes shows 103 from the saved outcome; once the message is in the thread, the 103 card sits under it. */
export function FlagsTurn({ card, locale: l, time, stored, tasks, flow }: { card: ZoeCard; locale: CardLocale; time: string; stored: boolean; tasks?: ZoeCards["tasks"]; flow: BpFlow | null }) {
  const red = redOutcome(card);
  if (red) return stored ? null : <>
    <article className="cv2-msg cv2-me" data-turn-action><p className="cv2-say">{red.text}</p><p className="cv2-time" suppressHydrationWarning>{time}</p></article>
    {!red.cleared && <ZoeEmergencyCard locale={l} request={red.requestId} initial={{ alerted: red.alerted, pending: false }} contained />}
  </>;
  return <DialogTurn locale={l} action={say(l, FLOW.allNo)} time={time}>{flow ? <><FlowZone flow={flow} locale={l} /><FlowWords flow={flow} locale={l} tasks={tasks} /></> : <p>{say(l, FLOW.thanks)}</p>}</DialogTurn>;
}

/** One yes or no at a time. A yes shows 103 on the tap, before any IO: nothing the network does can delay it. */
export function RedFlagCard({ card, locale: l, onCard, onAct }: { card: Extract<ValidCard, { kind: "red_flags" }>; locale: CardLocale; onCard: (card: ZoeCard) => void; onAct: (id: string, acting: boolean) => void }) {
  const answers = answersOn(card);
  const question = nextQuestion(answers);
  const [yes, setYes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const ids = useRef<Partial<Record<RedFlagQuestion, string>>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = RED_FLAG_QUESTIONS.filter(q => answers[q] !== undefined).length;
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [question]);
  if (!question) return null;
  const answer = (value: boolean) => {
    if (value) setYes(true);
    onAct(card.id, true);
    start(async () => {
      setError(null);
      const opId = ids.current[question] ??= crypto.randomUUID();
      const r = await runCardAction(() => answerRedFlagFromCard({ cardId: card.id, opId, question, answer: value, locale: l }));
      if (r?.card) onCard(r.card);
      if (r?.status === "ok" && r.next) onCard(r.next);
      if (r?.status !== "ok") { setError(cardProblem(l, r)); onAct(card.id, false); }
    });
  };
  return <article className="cv2-msg cv2-zoe" data-zoe-card="red_flags" data-chat-card-id={card.id} data-state="open" onClick={event => event.stopPropagation()}>
    <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
    <section className="cv2-reading cv2-flags" aria-label={say(l, { en: "Safety questions", hy: "Անվտանգության հարցեր", ru: "Вопросы безопасности" })}>
      <p className="cv2-dots" role="img" aria-label={say(l, FLOW.progress(shown + 1, RED_FLAG_QUESTIONS.length))}>
        {RED_FLAG_QUESTIONS.map((q, i) => <i key={q} data-on={i <= shown ? true : undefined} />)}
      </p>
      <h3 ref={heading} tabIndex={-1}>{say(l, FLAG_QUESTION[question])}</h3>
      <Speaker locale={l} text={say(l, FLAG_QUESTION[question])} />
      <div className="cv2-flag-actions">
        <button type="button" disabled={busy} data-flag-answer="yes" onClick={() => answer(true)}>{say(l, FLOW.yes)}</button>
        <button type="button" disabled={busy} data-flag-answer="no" onClick={() => answer(false)}>{say(l, FLOW.no)}</button>
      </div>
      {error === "signed_out" ? <SignInEnded locale={l} /> : error && <p role="alert">{error}</p>}
    </section>
    {yes && <ZoeEmergencyCard locale={l} request={null} initial={null} contained />}
  </article>;
}

/** Above the composer: the zone and what is pending, in words. */
export function ContextStripView({ strip, locale: l }: { strip: ContextStrip; locale: CardLocale }) {
  const { pending, zone } = strip;
  const action = pending?.kind === "red_flags" ? FLOW.stripAnswer(pending.left) : pending?.kind === "repeat" ? FLOW.stripRepeat : pending?.kind === "call103" ? FLOW.zoneRedAction : null;
  return <p className="cv2-strip" data-zoe-strip data-zone={zone ?? undefined}>
    {zone ? <ZoneTag zone={zone} locale={l} /> : <PhoneCall size={15} aria-hidden />}
    {action && <span>{say(l, action)}</span>}
  </p>;
}
