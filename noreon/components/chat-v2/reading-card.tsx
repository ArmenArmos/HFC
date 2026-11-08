"use client";
import { useEffect, useRef, useState } from "react";
import { zoeName } from "@/lib/brand";
import { BpPhotoInput } from "@/components/patient/bp-photo-input";
import { HeartPulse, Mic } from "lucide-react";
import { BP_ROWS, useBpCard, type ReadingFormCard } from "@/components/patient/use-bp-card";
import { bpSummary, readBp } from "@/components/patient/bp-entry-values";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import { Call103 } from "@/components/patient/use-hydrated";
import { offlineText } from "@/lib/offline/copy";
import { BP, COMMON, FLOW, bpText, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import {unverifiedBpLabel} from "@/lib/patient/bp-provenance";
import { flowOf } from "@/lib/zoe-chat-actions/bp-flow";
import type { ZoeCard, ZoeCards } from "@/lib/zoe-chat-actions/registry";
import type { BpReading } from "@/lib/zoe-chat-actions/thread";
import { Speaker } from "./speaker";
import { DialogTurn } from "./dialog-turn";
import { FlowWords, FlowZone } from "./bp-flow-cards";

const REPEAT_WAIT_S = 60;

/** The reading block's words for the shared dialog turn. */
export function SavedReading({ card, reading, said, locale: l, time, tasks }: { card: ReadingFormCard; reading: BpReading; said: boolean; locale: CardLocale; time: string; tasks?: ZoeCards["tasks"] }) {
  const week = card.kind === "bp" ? card.snapshot.week : null;
  const flow = flowOf(card);
  const voice=card.kind==='bp'?card.snapshot.typed?.entrySource:undefined;
  const entrySource=reading.entrySource??(reading.photoConfirmed?'patient_photo_confirmed':voice==='patient_voice_confirmed'||voice==='patient_voice_live_confirmed'?voice:'patient_text_entry');
  return <DialogTurn locale={l} action={said ? null : bpText(l, {...reading,entrySource})} time={time}>
    {(entrySource==='patient_text_entry'||entrySource==='patient_voice_live_confirmed')&&<p data-bp-provenance>{unverifiedBpLabel(l)}</p>}
    {week && <p className="cv2-reading-week">{say(l, BP.week(week.day, week.days, week.slot === "evening"))}. {say(l, BP.weekProgress(Math.min(week.saved + 1, week.expected), week.expected))}</p>}
    {flow ? <><FlowZone flow={flow} locale={l} /><FlowWords flow={flow} locale={l} tasks={tasks} /></> : <>
      <p data-zoe-bp-saved>{say(l, BP.saved(bpText(l, {...reading,entrySource})))}</p>
      <p>{say(l, BP.noNotify)}</p><p>{say(l, BP.worried)}</p>
    </>}
  </DialogTurn>;
}

/** The wait before a second reading. It counts from when the card was posted, so a reload does not start it over. */
function RepeatWait({ at, locale: l, onDone }: { at: string; locale: CardLocale; onDone: () => void }) {
  const left = () => Math.max(0, REPEAT_WAIT_S - Math.floor((Date.now() - Date.parse(at)) / 1000));
  const [seconds, setSeconds] = useState(left);
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = left();
      setSeconds(now);
      if (now === 0) { window.clearInterval(id); onDone(); }
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one timer per card
  }, [at]);
  return <div className="cv2-wait" aria-live="off">
    <svg viewBox="0 0 64 64" role="img" aria-label={say(l, FLOW.wait(seconds))}>
      <circle cx="32" cy="32" r="28" pathLength={100} />
      <circle cx="32" cy="32" r="28" pathLength={100} data-ring strokeDasharray={100} strokeDashoffset={100 - seconds * 100 / REPEAT_WAIT_S} />
    </svg>
    <span suppressHydrationWarning aria-hidden>{seconds}</span>
    <button type="button" data-skip-wait onClick={onDone}>{say(l, FLOW.skipWait)}</button>
  </div>;
}

export function ReadingCard({ card, locale: l, focus, canFocus, superseded, onCard, onAct, photoEnabled = false }: {
  photoEnabled?: boolean;
  card: ReadingFormCard; locale: CardLocale; focus: boolean; canFocus: () => boolean; superseded: boolean; onCard: (card: ZoeCard) => void; onAct: (id: string, acting: boolean) => void;
}) {
  const { values, setValues, fillFromPhoto, photoConfirmed, check, error, busy, submitted, setSubmitted, save, queued } = useBpCard(card, l, onCard, () => onAct(card.id, false));
  const [photoBusy, setPhotoBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // Someone reading older messages keeps their place: the keyboard does not open under them.
    if (focus && canFocus()) form.current?.querySelector<HTMLInputElement>('input[value=""]')?.focus({ preventScroll: true });
  }, [focus, canFocus]);
  const repeat = card.kind === "repeat";
  const week = repeat ? null : card.snapshot.week;
  const typed = repeat ? undefined : card.snapshot.typed;
  const [waited, setWaited] = useState(!repeat);
  // WP V: a dictated reading waits for a yes; a spoken yes confirms exactly these numbers (the server binds it to this card).
  const dictated = card.state === "open" && (typed?.entrySource === "patient_voice_confirmed" || typed?.entrySource === "patient_voice_live_confirmed");
  useEffect(() => {
    if (!dictated) return;
    window.dispatchEvent(new CustomEvent("cv2-voice-pending", { detail: { cardId: card.id, action: { kind: "bp" } } }));
    return () => { window.dispatchEvent(new CustomEvent("cv2-voice-pending-clear", { detail: { cardId: card.id } })); };
  }, [dictated, card.id]);
  const untouched = !photoConfirmed && values.systolic === (typed ? String(typed.systolic) : "") && values.diastolic === (typed ? String(typed.diastolic) : "") && values.pulse === (typed?.pulse ? String(typed.pulse) : "");
  // Stays mounted while hidden, so nothing the member typed is ever lost.
  if (superseded && card.state === "open" && untouched && !error && !photoBusy) return null;
  // Inside the anamnesis a button click follows to the end. Here that would take the member away from a field that needs fixing.
  return <article className="cv2-msg cv2-zoe" data-zoe-card={card.kind} data-chat-card-id={card.id} data-state={card.state === "done" ? "done" : "open"} onClick={event => event.stopPropagation()}>
    <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
    <section className="cv2-reading" aria-label={say(l, {en:"Blood pressure reading",hy:"Ճնշման չափում",ru:"Измерение давления"})}>
      <h3>{typed?.entrySource === "patient_voice_confirmed" || typed?.entrySource === "patient_voice_live_confirmed" ? <Mic size={18} role="img" aria-label={say(l, {en:"From your recording",hy:"Ձեր ձայնագրությունից",ru:"Из вашей записи"})} /> : <HeartPulse size={18} aria-hidden />}{repeat ? say(l, FLOW.enterSecond) : say(l, {en:"Enter your reading",hy:"Մուտքագրեք ձեր չափումը",ru:"Введите ваше измерение"})}</h3>
      {typed&&typed.entrySource!=="patient_voice_confirmed"&&<p data-bp-provenance>{unverifiedBpLabel(l)}</p>}
      {/* WP V: a dictated reading waits for an explicit yes: spoken (bound to this card on the server) or this button. Shown only where voice is on. */}
      {card.state !== "done" && (typed?.entrySource === "patient_voice_confirmed" || typed?.entrySource === "patient_voice_live_confirmed") && <p className="cv2-voice-hint">{say(l, {en:"Say yes to save",hy:"Ասեք «այո»՝ պահպանելու համար",ru:"Скажите «да», чтобы сохранить"})}</p>}
      {week && <p className="cv2-reading-week">{say(l, BP.week(week.day, week.days, week.slot === "evening"))}. {say(l, BP.weekProgress(week.saved, week.expected))}</p>}
      {repeat && card.state !== "done" && <>
        <p>{say(l, FLOW.repeatWhy)}</p>
        <ul className="cv2-technique"><li>{say(l, FLOW.techRest)}</li><li>{say(l, FLOW.techArm)}</li><li>{say(l, FLOW.techTwo)}</li></ul>
        {!waited && <RepeatWait at={card.at} locale={l} onDone={() => setWaited(true)} />}
      </>}
      {card.state === "done" ? <p>{say(l, COMMON.closed)}</p> : waited && <>
        {!repeat && <p>{say(l, BP.guide)}</p>}
        <form ref={form} noValidate onSubmit={event => {
          event.preventDefault(); if (photoBusy) return; setSubmitted(true);
          if (!check.ok) {
            const field = check.problem === "order" ? "systolic"
              : BP_ROWS.find(row => readBp(row.field, values[row.field]).state !== "set" && (row.field !== "pulse" || values.pulse))?.field;
            form.current?.querySelector<HTMLInputElement>(`[name="${field}"]`)?.focus({ preventScroll: true });
            return;
          }
          onAct(card.id, true);
          save();
        }}>
          {photoEnabled && <BpPhotoInput locale={l} disabled={busy} onRead={fillFromPhoto} onBusy={setPhotoBusy} />}
          <div className="cv2-reading-grid">
            {BP_ROWS.map(row => {
              const invalid = submitted && !check.ok && (readBp(row.field, values[row.field]).state !== "set" && (row.field !== "pulse" || !!values.pulse) || check.problem === "order" && row.field !== "pulse");
              return <label key={row.field} className="cv2-reading-field">
                <span>{row.label[l]}</span>
                <input name={row.field} type="text" inputMode="numeric" autoComplete="off" placeholder="…" value={values[row.field]} disabled={busy || photoBusy}
                  aria-label={row.label[l]} aria-invalid={invalid} aria-describedby={`${card.id}-${row.field}-hint${check.ok || submitted ? ` ${card.id}-bp-summary` : ""}`}
                  onChange={event => setValues(v => ({...v, [row.field]:event.target.value}))} />
                <small id={`${card.id}-${row.field}-hint`}>{row.field === "pulse" ? say(l, {en:"Optional",hy:"Ոչ պարտադիր",ru:"Необязательно"}) : row.unit[l]}</small>
              </label>;
            })}
          </div>
          {(check.ok || submitted) && <p id={`${card.id}-bp-summary`} data-bp-summary role={check.ok ? "status" : "alert"}>{bpSummary(l, values, check)}</p>}
          <button type="submit" className="cv2-reading-save" disabled={busy || photoBusy} aria-busy={busy}>{say(l, {en:"Save reading",hy:"Պահել չափումը",ru:"Сохранить измерение"})}</button>
        </form>
      </>}
      {/* WP R: confirmed offline, waiting in the outbox; a very high reading says at once that it has not reached the team. */}
      {queued && <p role="status" data-bp-queued>{offlineText(l, "queued")}</p>}
      {queued?.veryHigh && <div role="alert" data-bp-queued-urgent><p>{offlineText(l, "veryHighQueued")}</p><Call103 size="call" className="emergency-call flex min-h-14 items-center justify-center rounded-md px-5 py-3">{offlineText(l, "call103")}</Call103></div>}
      {error === "signed_out" ? <SignInEnded locale={l} /> : error && <p role="alert">{error}</p>}
    </section>
    <Speaker locale={l} text={`${say(l, repeat ? FLOW.enterSecond : BP.guide)} ${check.ok ? bpSummary(l, values, check) : ""}`} />
  </article>;
}
