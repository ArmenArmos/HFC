"use client";
import {memberInstruction} from "@/lib/text-language";
import {run,problem,ShowCurrent,Confirm,Problem,sentOf,useRequestIds,sendNotice} from './zoe-card-controls';
import {ResultsBody,MessageBody} from './zoe-results-message';
import Link from "next/link";
import type { Route } from "next";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { CalendarDays, ClipboardList, FlaskConical, HeartPulse, List, MessageCircle, MessageCircleQuestion, Pill, Target, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bpSummary, readBp } from "@/components/patient/bp-entry-values";
import { BP_ROWS, useBpCard } from "./use-bp-card";
import { BpSafetyNotice } from "@/components/patient/bp-safety-notice";
import { bpSavedLine } from "@/lib/clinical/rules/bp-words";
import { LdlGoalCard } from "@/components/patient-care/ldl-goal-card";
import { MedicineAskCard } from "@/components/member-medicines/ask-card";
import { ZoeMedicines } from "@/components/patient/zoe-medicines";
import type {AccountSection} from "./zoe-account";
import {formatMemberDate} from "@/lib/patient/date-format";
import {LIVING_VISIT} from '@/lib/zoe-chat-actions/copy';
import { ZoeAccount } from "@/components/patient/zoe-account";
import { ZoeBooking } from "@/components/patient/zoe-booking";
import {ZoeEveryday,ShowEveryday,ZoePlanDetails} from './zoe-everyday';
import {EVERYDAY_TITLE} from '@/lib/zoe-chat-actions/everyday-contract';
import { ZoeNotice } from "@/components/patient/zoe-notice";
import type { Notice } from "@/components/patient/use-zoe-thread";
import type { MedicineAsk } from "@/lib/member-medicines/asks";
import { ASK_REASONS, MEDICINE_ASK_COPY, askWhen, type AskReason } from "@/lib/member-medicines/ask-copy";
import { askAnswered } from "@/lib/zoe-chat-actions/telegram";
import { acceptVisitFromCard, answerAskFromCard, logDoseFromCard, sendFromCard } from "@/lib/zoe-chat-actions/actions";
import { TELEGRAM_MENU_KINDS, doseItem, type CardActionResult, type CardKind, type ValidCard, type ZoeCard } from "@/lib/zoe-chat-actions/registry";
import { BP, CHIP, COMMON, DOSE, LDL, MESSAGE, NOTICE, PLAN, PROFILE, SIDE, SIDE_EFFECT, SIDE_EFFECTS, TELEGRAM, TITLE, VISIT, bpText, say, type CardLocale, type SideEffect } from "@/lib/zoe-chat-actions/copy";

type Done = (card: ZoeCard) => void;
type Act = CardActionResult & { ask?: MedicineAsk; send?: string };

const day = (iso: string, locale: CardLocale) => formatMemberDate(iso, locale, {timeZone:"Asia/Yerevan",dateStyle:"medium"});
const dayTime = (iso: string, locale: CardLocale) => formatMemberDate(iso, locale, {timeZone:"Asia/Yerevan",dateStyle:"medium",timeStyle:"short"});
/** Fired when a card action's reply was lost: the chat re-reads, so a card that did save shows it (chat-cards 6). */
export { CARD_REPLY_LOST } from "@/lib/zoe-chat-actions/thread-events";
const ICON: Record<CardKind, typeof Pill> = { dose: Pill, bp: HeartPulse, results: FlaskConical, plan: ClipboardList, visit: CalendarDays, side_effect: TriangleAlert, message: MessageCircle, ldl: Target, ask: MessageCircleQuestion, menu: List, medicines: Pill, account: List, repeat: HeartPulse, red_flags: TriangleAlert, profile: List, next_step: List, tests_needed: FlaskConical, review: ClipboardList, document: List, prep: List, fasting: List, symptom_gate: List, consult_questions: List, sams: TriangleAlert };
const link = "inline-flex min-h-12 items-center font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** One current card per kind in chat. Older snapshots remain quiet receipts; writes keep their server claims. */
export function ZoeCardView({ card, locale: l, focus, onCard, chatOnly = false, collapsed = false, accountSection }: { collapsed?: boolean; accountSection?: AccountSection; card: ZoeCard; locale: CardLocale; focus: boolean; onCard: Done; chatOnly?: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => { if (focus && !collapsed) heading.current?.focus({preventScroll:true}); }, [focus, collapsed]);
  if (collapsed && card.valid) return <p className="text-caption text-muted-foreground" data-zoe-card-collapsed>
    {card.kind === 'menu' && card.snapshot.view ? EVERYDAY_TITLE[card.snapshot.view][l] : say(l,TITLE[card.kind])}
    {" · "}{card.kind === 'bp' && card.outcome.bp
      ? say(l,BP.saved(bpText(l,card.outcome.bp as {systolic:number;diastolic:number;pulse:number|null})))
      : say(l,{en:"Updated below",hy:"Թարմացվածը՝ ներքևում",ru:"Обновлено ниже"})}
    {card.kind === 'dose' && card.snapshot.slots.filter(slot => card.outcome[doseItem(slot)]).map(slot =>
      ` · ${slot.name} ${slot.dose ?? ''}, ${slot.time}: ${say(l,(card.outcome[doseItem(slot)] as {status:string}).status === 'taken' ? DOSE.taken : DOSE.skipped)}`)}
  </p>;
  if (!card.valid) {
    return <CardFrame cardId={card.id} id={id} heading={heading} kind={null} title={say(l, COMMON.unreadable)} at={card.at} locale={l} done={false} page={null} />;
  }
  const done = card.state === "done";
  const body: ReactNode =
    card.kind === "medicines" ? <ZoeMedicines card={card} locale={l} onCard={onCard} />
    : card.kind === "profile" ? <p className="text-body2">{say(l, PROFILE.inChat)}</p>
    : card.kind === "account" ? <ZoeAccount initialSection={accountSection} card={card} locale={l} onCard={onCard} />
    : card.kind === "dose" ? <DoseBody card={card} locale={l} onCard={onCard} />
    : card.kind === "bp" ? <BpBody card={card} locale={l} onCard={onCard} />
    : card.kind === "results" ? <ResultsBody card={card} locale={l} onCard={onCard} />
    : card.kind === "plan" ? <PlanBody card={card} locale={l} onCard={onCard} chatOnly={chatOnly} />
    : card.kind === "visit" ? (chatOnly && card.snapshot.bookingToken ? <ZoeBooking card={card} locale={l} onCard={onCard} /> : <VisitBody card={card} locale={l} onCard={onCard} />)
    : card.kind === "ldl" ? (card.snapshot.data?.enabled && card.snapshot.data.inPathway ? <LdlGoalCard data={card.snapshot.data} locale={l} embedded /> : <div className="space-y-2"><p className="text-body2">{say(l, card.snapshot.data ? LDL.notStarted : TELEGRAM.unavailable)}</p><Link href="/patient/zoe?card=team" className={link}>{say(l,{en:"Ask your care team",hy:"Հարցնել խնամքի թիմին",ru:"Спросить вашу команду"})}</Link></div>)
    : card.kind === "ask" ? <AskBody card={card} locale={l} onCard={onCard} />
    : card.kind === "menu" ? (card.snapshot.view ? <ZoeEveryday card={card} locale={l} onCard={onCard}/> : <div className="flex flex-col gap-2">{card.snapshot.line && <p className="break-words text-body2">{memberInstruction(card.snapshot.line, l)}</p>}{(card.snapshot.kinds ?? TELEGRAM_MENU_KINDS).map(kind => <ShowCurrent key={kind} kind={kind} askId={card.snapshot.askId} label={say(l, kind === "ask" ? NOTICE.answer : CHIP[kind])} locale={l} onCard={onCard} />)}</div>)
    : card.kind === "repeat" || card.kind === "red_flags" || card.kind === "next_step" || card.kind === "tests_needed" || card.kind === "review" ? null
    : card.kind === "side_effect" ? <SideEffectBody card={card} locale={l} onCard={onCard} />
    : card.kind === "message" ? <MessageBody card={card} locale={l} onCard={onCard} /> : null;
  return (
    <CardFrame cardId={card.id} id={id} heading={heading} kind={card.kind} title={card.kind==='menu'&&card.snapshot.view?EVERYDAY_TITLE[card.snapshot.view][l]:say(l, TITLE[card.kind])} at={card.at} locale={l} done={done}
      page={null}
      current={card.kind==='menu'&&card.snapshot.view?<ShowEveryday view={card.snapshot.view} locale={l} onCard={onCard}/>:(card.kind !== "bp" || !!card.snapshot.latest || !!card.outcome.bp) && card.kind !== "side_effect" && card.kind !== "message" && card.kind !== "menu" && card.kind !== "ask" && card.kind !== "profile" ? <ShowCurrent kind={card.kind} locale={l} onCard={onCard} /> : null}>
      {body}
    </CardFrame>
  );
}

function CardFrame({ cardId, id, heading, kind, title, at, locale: l, done, page, current, children }: { cardId?: string; id: string; heading: React.RefObject<HTMLHeadingElement | null>; kind: CardKind | null; title: string; at: string; locale: CardLocale; done: boolean; page: string | null; current?: ReactNode; children?: ReactNode }) {
  const Icon = kind ? ICON[kind] : TriangleAlert;
  return (
    <div className="flex justify-start" data-chat-card-id={cardId} data-zoe-card={kind ?? "unreadable"} data-state={done ? "done" : "open"}>
      <section aria-labelledby={id} className={`w-full max-w-[min(100%,34rem)] space-y-3 rounded-2xl border p-4 shadow-sm ${done ? "bg-surface-subtle-teal" : "bg-card"}`}>
        <div className="flex items-start gap-3">
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted"><Icon className="size-5" /></span>
          <div className="min-w-0">
            <h2 id={id} ref={heading} tabIndex={-1} className="text-h3 outline-none">{title}</h2>
            <p className="text-caption text-muted-foreground" data-zoe-card-asof suppressHydrationWarning>{say(l, COMMON.asShown(dayTime(at, l)))}</p>
          </div>
        </div>
        {children}
        {page && <p><Link href={page as Route} className={link}>{say(l, COMMON.seeCurrent)}</Link></p>}
        {current}
      </section>
      {/* The kit's look shows the same line under the card, as the prototype's time. It always stays: a card is a snapshot. */}
      <p className="hidden" data-zoe-card-time suppressHydrationWarning>{say(l, COMMON.asShown(dayTime(at, l)))}</p>
    </div>
  );
}

function DoseBody({ card, locale: l, onCard }: { card: Extract<ValidCard, { kind: "dose" }>; locale: CardLocale; onCard: Done }) {
  const s = card.snapshot;
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const operations = useRef(new Map<string, string>());
  const sending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [asks, setAsks] = useState<Record<string, MedicineAsk>>({});
  const [busy, start] = useTransition();
  if (!s.enabled) return <p className="text-body2">{say(l, DOSE.off)}</p>;
  if (!s.slots.length) return <p className="text-body2">{say(l, DOSE.empty)}</p>;
  const keyOf = doseItem;
  // A retry of the same dose choice reuses its operation id (the database claim decides).
  const act = (slot: (typeof s.slots)[number], status: "taken" | "skipped") => {
    if (sending.current) return;
    sending.current = true;
    const operationKey = `${keyOf(slot)}:${status}`;
    let op = operations.current.get(operationKey);
    if (!op) { op = crypto.randomUUID(); operations.current.set(operationKey, op); }
    setActiveKey(keyOf(slot));
    start(async () => {
    setError(null);
    const r = await run(() => logDoseFromCard({ cardId: card.id, opId: op, medicineId: slot.medicineId, dueAt: slot.dueAt, status })) as Act | null;
    if (r?.card) onCard(r.card);
    if (r?.status === "ok") { if (r.ask) setAsks(a => ({ ...a, [keyOf(slot)]: r.ask! })); }
    else setError(r?.status === "stale" ? say(l, COMMON.staleInChat) : problem(l, r));
    sending.current = false;
  });
  };
  return (
    <ul className="divide-y" aria-label={say(l, TITLE.dose)}>
      {s.slots.map(slot => {
        const key = keyOf(slot);
        const logged = (card.outcome[key] as { status?: string } | undefined)?.status ?? (slot.status === "taken" || slot.status === "skipped" ? slot.status : null);
        const what = `${slot.name}${slot.dose ? ` ${slot.dose}` : ""}, ${slot.time}`;
        return (
          <li key={key} className="space-y-2 py-3 first:pt-0 last:pb-0" data-zoe-dose={slot.status}>
            <p className="break-words text-body2 font-semibold">{what}</p>
            {logged ? (
              <div className="space-y-2">
                <p className="text-body2" data-zoe-dose-logged={logged}>{say(l, logged === "taken" ? (card.outcome[key] ? DOSE.doneTaken : DOSE.taken) : (card.outcome[key] ? DOSE.doneMissed : DOSE.skipped))}</p>
                {card.outcome[key] ? (
                  // Receipts retain their original revision. Load the current snapshot before correcting it.
                  <ShowCurrent kind="dose" label={say(l, DOSE.change)} locale={l} onCard={onCard} />
                ) : (
                  <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" disabled={busy} onClick={() => act(slot, logged === "taken" ? "skipped" : "taken")}>{say(l, logged === "taken" ? DOSE.changeToMissed : DOSE.changeToTaken)}</Button>
                )}
              </div>
            ) : slot.status === "upcoming" ? (
              <p className="text-body2 text-muted-foreground">{say(l, slot.planId ? DOSE.laterPlan(slot.time) : DOSE.later(slot.time))}</p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label={what}>
                <Button type="button" className="h-auto min-h-12 whitespace-normal" disabled={busy} onClick={() => act(slot, "taken")}>{say(l, DOSE.markTaken)}</Button>
                <Button type="button" variant="outline" className="h-auto min-h-12 whitespace-normal" disabled={busy} onClick={() => act(slot, "skipped")}>{say(l, DOSE.markMissed)}</Button>
              </div>
            )}
            {activeKey === key && <Problem text={error} locale={l} />}
            {/* The medicines page's own missed-dose question: the reason goes where it always goes. */}
            {asks[key] && <MedicineAskCard ask={asks[key]} locale={l} now={new Date().toISOString()} />}
          </li>
        );
      })}
    </ul>
  );
}

function BpBody({ card, locale: l, onCard }: { card: Extract<ValidCard, { kind: "bp" }>; locale: CardLocale; onCard: Done }) {
  const { week, latest, typed } = card.snapshot;
  const { values, setValues, check, saved, error, busy, submitted, setSubmitted, save } = useBpCard(card, l, onCard);
  const safety = saved?.bp ? bpSavedLine(l, saved.bp, saved) : null;
  const reading = (v: { systolic: number; diastolic: number; pulse: number | null }) => bpText(l, v);
  const head = week && <p className="text-body2">{say(l, BP.week(week.day, week.days, week.slot === "evening"))}. {say(l, BP.weekProgress(week.saved, week.expected))}</p>;
  if (saved) return <div className="space-y-2" aria-live="polite">{head}<p className="text-body2 font-semibold" data-zoe-bp-saved>{say(l, BP.saved(reading(saved)))}</p>{safety ? <BpSafetyNotice text={safety} locale={l} /> : <><p className="text-body2">{say(l, BP.noNotify)}</p><p className="text-body2">{say(l, BP.worried)}</p></>}</div>;
  if (card.state === "done") return <p className="text-body2">{say(l, COMMON.closed)}</p>;
  return (
    <div className="space-y-3">
      {head}
      {latest && <p className="text-body2" data-zoe-bp-latest suppressHydrationWarning>{say(l, BP.last(reading(latest), dayTime(latest.measuredAt, l)))}</p>}
      <p className="text-body2 text-muted-foreground">{say(l, BP.guide)}</p>
        <form className="space-y-2" noValidate onSubmit={e => {
          e.preventDefault();
          setSubmitted(true);
          if (!check.ok) { document.getElementById(`${card.id}-${readBp("systolic", values.systolic).state === "set" ? "diastolic" : "systolic"}`)?.focus(); return; }
          // A prefilled chat reading keeps its own time; a manual entry is measured now. Retries keep the same time.
          save();
        }}>
          <div className="grid grid-cols-3 gap-3">
          {BP_ROWS.map(r => {
            const invalid = submitted && (readBp(r.field, values[r.field]).state === "invalid" || (!check.ok && check.problem === "order" && r.field !== "pulse"));
            return <label key={r.field} className="min-w-0 space-y-1 text-body2" htmlFor={`${card.id}-${r.field}`}>
              <span className="block whitespace-nowrap">{r.label[l]}</span>
              <input id={`${card.id}-${r.field}`} type="text" inputMode="numeric" autoComplete="off" value={values[r.field]} disabled={busy} aria-invalid={invalid} aria-describedby={check.ok || submitted ? `${card.id}-bp-summary` : undefined}
                onChange={e => setValues(v => ({ ...v, [r.field]: e.target.value }))}
                className="min-h-12 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-body1 tabular-nums focus-visible:outline-2 focus-visible:outline-ring" />
              <span className="block text-caption text-muted-foreground">{r.unit[l]}{r.field === "pulse" && <span className="block">{say(l,{en:"Optional",hy:"Ոչ պարտադիր",ru:"Необязательно"})}</span>}</span>
            </label>;
          })}
          </div>
          {(check.ok || submitted) && <p id={`${card.id}-bp-summary`} aria-live="polite" className={`rounded-md p-2 text-body2 font-semibold tabular-nums ${!check.ok ? "bg-destructive/10 text-destructive" : ""}`}>{bpSummary(l, values, check)}</p>}
          <p className="text-caption text-muted-foreground">{typed ? say(l, BP.measured(dayTime(typed.measuredAt, l))) : say(l, BP.now)} <Link href={"/patient/measurements/new" as Route} className="underline underline-offset-4">{say(l, BP.otherTime)}</Link></p>
          <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal" disabled={busy}>{say(l, {en:"Save reading",hy:"Պահել չափումը",ru:"Сохранить измерение"})}</Button>
        </form>
      <Problem text={error} locale={l} />
    </div>
  );
}

function PlanBody({ card, locale: l, onCard, chatOnly }: { card: Extract<ValidCard, { kind: "plan" }>; locale: CardLocale; onCard:Done; chatOnly:boolean }) {
  const p = card.snapshot.plan;
  if (!card.snapshot.available || !p) return <div className="space-y-2"><p className="text-body2">{say(l, PLAN.empty)}</p><Link href="/patient/zoe?card=team" className={link}>{say(l,{en:"Ask your care team about your next step",hy:"Հաջորդ քայլի մասին հարցնել խնամքի թիմին",ru:"Узнать у команды о следующем шаге"})}</Link></div>;
  if(chatOnly)return <ZoePlanDetails card={card} locale={l} onCard={onCard}/>;
  return (
    <div className="space-y-3">
      <p className="text-caption font-semibold text-muted-foreground" suppressHydrationWarning>{say(l, PLAN.approvedBy(p.clinician, day(p.publishedAt, l)))}{p.version ? `. ${say(l, PLAN.version(p.version))}` : ""}</p>
      {p.instructions && <p className="whitespace-pre-wrap break-words text-body2">{memberInstruction(p.instructions, l, p.medicines.map(m=>m.name))}</p>}
      {p.medicines.length > 0 && <div className="space-y-1">
        <h3 className="text-body2 font-semibold">{say(l, PLAN.medicines)}</h3>
        <ul className="space-y-1">{p.medicines.map((m, i) => <li key={i} className="break-words text-body2">{m.name}, {m.dose}{m.times.length ? `, ${m.times.join(", ")}` : ""}</li>)}</ul>
      </div>}
      <p className="text-caption text-muted-foreground">{say(l, PLAN.readOnly)}</p>
    </div>
  );
}

function VisitBody({ card, locale: l, onCard }: { card: Extract<ValidCard, { kind: "visit" }>; locale: CardLocale; onCard: Done }) {
  const s = card.snapshot;
  const [confirm, setConfirm] = useState(false);
  const [command] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const accepted = card.outcome.accepted !== undefined;
  const accept = () => start(async () => {
    setError(null);
    const r = await run(() => acceptVisitFromCard({ cardId: card.id, commandId: command })) as Act | null;
    if (r?.card) onCard(r.card);
    if (r?.status === "ok") setConfirm(false); else setError(problem(l, r));
  });
  if(s.living)return <div className="space-y-3"><p>{say(l,s.available?LIVING_VISIT[s.living.status]:LIVING_VISIT.unavailable)}</p><Link href="/patient/service">{say(l,LIVING_VISIT.details)}</Link></div>;
  return (
    <div className="space-y-3">
      {s.attention && <p className="text-body2">{say(l, VISIT.attention)}</p>}
      {s.next ? (
        <div className="space-y-1">
          <p className="text-body2 font-semibold" suppressHydrationWarning>{dayTime(s.next.startsAt, l)}</p>
          <p className="break-words text-body2">{say(l, s.next.mode === "home" ? VISIT.home : VISIT.clinic)}. {memberInstruction(s.next.location, l)}</p>
          <p className="text-caption text-muted-foreground">{say(l, s.next.status === "confirmed" ? VISIT.confirmed : VISIT.pending)}</p>
        </div>
      ) : !s.proposal && <p className="text-body2">{say(l, VISIT.empty)}</p>}
      {s.proposal && (accepted ? <p className="text-body2 font-semibold" aria-live="polite">{say(l, VISIT.accepted)}</p>
        : <div className="space-y-2">
          <p className="break-words text-body2" suppressHydrationWarning>{say(l, VISIT.proposed(dayTime(s.proposal.startsAt, l), s.proposal.clinicName))}</p>
          {confirm ? <Confirm locale={l} busy={busy} prompt={say(l, VISIT.confirmAccept(`${dayTime(s.proposal.startsAt, l)}, ${s.proposal.clinicName}`))} yes={say(l, VISIT.yes)} onYes={accept} onBack={() => setConfirm(false)} />
            : card.state === "open" && <Button type="button" className="h-auto min-h-12 whitespace-normal" onClick={() => setConfirm(true)}>{say(l, VISIT.accept)}</Button>}
        </div>)}
      {!accepted && <Problem text={error} locale={l} />}
      <p><Link href={"/patient/service" as Route} className={link}>{s.next || s.proposal ? say(l, VISIT.change) : say(l, VISIT.book)}</Link></p>
    </div>
  );
}

function SideEffectBody({ card, locale: l, onCard }: { card: Extract<ValidCard, { kind: "side_effect" }>; locale: CardLocale; onCard: Done }) {
  const [what, setWhat] = useState<SideEffect | null>(null);
  const [detail, setDetail] = useState("");
  const [confirm, setConfirm] = useState(false);
  const requestFor = useRequestIds();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, start] = useTransition();
  const name = useId();
  const sent = sentOf(card);
  if (sent?.urgent) return <p className="text-body2" aria-live="polite">{say(l, MESSAGE.urgent)}</p>;
  if (sent) return <p className="text-body2" aria-live="polite">{say(l, SIDE.confirm)} {sent.what && sent.what in SIDE_EFFECT ? say(l, SIDE_EFFECT[sent.what]) : ""}. {say(l, MESSAGE.sent)}</p>;
  if (card.state === "done") return <p className="text-body2">{say(l, COMMON.closed)}</p>;
  const shown = what ? (what === "other" ? detail.trim() : `${say(l, SIDE_EFFECT[what])}${detail.trim() ? `. ${detail.trim()}` : ""}`) : "";
  const send = () => what && start(async () => {
    setError(null); setNotice(null);
    const r = await run(() => sendFromCard({ kind: "side_effect", cardId: card.id, requestId: requestFor(`${what}\n${detail}`), locale: l, what, detail })) as Act | null;
    if (r?.card) onCard(r.card);
    if (r?.status !== "ok") { const n = sendNotice(r?.send); if (n) setNotice(n); else setError(problem(l, r)); }
  });
  return (
    <div className="space-y-3">
      {confirm && what ? (
        <Confirm locale={l} busy={busy} prompt={`${say(l, SIDE.confirm)} ${shown}`} yes={say(l, SIDE.send)} onYes={send} onBack={() => setConfirm(false)} />
      ) : (
        <form className="space-y-3" noValidate onSubmit={e => {
          e.preventDefault();
          if (!what) { setError(say(l, SIDE.pick)); return; }
          if (what === "other" && !detail.trim()) { setError(say(l, SIDE.needDetail)); document.getElementById(`${card.id}-detail`)?.focus(); return; }
          setError(null); setConfirm(true);
        }}>
          <fieldset className="space-y-2">
            <legend className="text-body2">{say(l, SIDE.pick)}</legend>
            <div className="flex flex-wrap gap-2">
              {SIDE_EFFECTS.map(x => (
                <label key={x} className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-4 text-body2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
                  <input type="radio" name={name} value={x} checked={what === x} onChange={() => { setWhat(x); setError(null); }} className="sr-only" />
                  {say(l, SIDE_EFFECT[x])}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1">
            <label htmlFor={`${card.id}-detail`} className="text-body2">{say(l, what === "other" ? SIDE.detailOther : SIDE.detail)}</label>
            <textarea id={`${card.id}-detail`} placeholder={say(l, what === "other" ? {en:"Tell your care team what happened.",hy:"Պատմեք ձեր խնամքի թիմին՝ ինչ է տեղի ունեցել։",ru:"Расскажите вашей команде, что произошло."} : {en:"Tell your care team what happened (optional).",hy:"Պատմեք ձեր խնամքի թիմին՝ ինչ է տեղի ունեցել (ոչ պարտադիր)։",ru:"Расскажите вашей команде, что произошло (необязательно)."})} rows={2} maxLength={1000} value={detail} onChange={e => setDetail(e.target.value)}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-body1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />
          </div>
          <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal" disabled={busy}>{say(l, SIDE.review)}</Button>
        </form>
      )}
      <Problem text={error} locale={l} />
      <div aria-live="polite"><ZoeNotice locale={l} notice={notice} /></div>
    </div>
  );
}

/** An ask posted as a card (from Telegram, or a sweep): the same question and reasons as the medicines page. */
function AskBody({ card, locale: l, onCard }: { card: Extract<ValidCard, { kind: "ask" }>; locale: CardLocale; onCard: Done }) {
  const c = MEDICINE_ASK_COPY[l], s = card.snapshot, when = askWhen(s.dueAt, new Date(card.at), l);
  const [op] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const done = (card.outcome.answer as { reason?: string } | undefined)?.reason;
  const answer = (reason: AskReason) => start(async () => {
    setError(null);
    const r = await run(() => answerAskFromCard({ cardId: card.id, opId: op, reason })) as Act | null;
    if (r?.card) onCard(r.card);
    if (r?.status !== "ok") setError(problem(l, r));
  });
  return (
    <div className="space-y-3" aria-live="polite">
      <p className="break-words text-body2">{s.trigger === "skipped" ? c.skipped(s.name, when) : c.missed(s.name, when)}</p>
      {done ? <p className="text-body2" data-zoe-ask-answered={done}>{askAnswered(c, done)}</p> : card.state === "done" ? <p className="text-body2">{say(l, COMMON.closed)}</p> : <>
        <p className="text-body2 text-muted-foreground">{c.why}</p>
        <div className="flex flex-col gap-2" role="group" aria-label={c.title}>
          {ASK_REASONS.map(reason => <Button key={reason} type="button" variant="outline" className="h-auto min-h-11 justify-start whitespace-normal text-left" disabled={busy} onClick={() => answer(reason)}>{c.reasons[reason]}</Button>)}
        </div>
      </>}
      <Problem text={error} locale={l} />
    </div>
  );
}

/** The chip label for a card kind (the strip and Zoe's offer). */
export const cardChipLabel = (l: CardLocale, kind: CardKind) => say(l, CHIP[kind]);
