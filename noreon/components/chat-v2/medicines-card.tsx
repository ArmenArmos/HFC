"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { zoeName } from "@/lib/brand";
import { Pill } from "lucide-react";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import { MEDICINE_ASK_COPY, type AskReason } from "@/lib/member-medicines/ask-copy";
import { readMedicinesForReview, restoreMedicineFromCard, reviewMedicinesFromCard, type ReviewRead } from "@/lib/zoe-chat-actions/onboarding-actions";
import { COMMON, MEDICINES, say, type CardLocale } from "@/lib/zoe-chat-actions/copy";
import type { ValidCard, ZoeCard } from "@/lib/zoe-chat-actions/registry";
import type { MedicineRow } from "@/lib/zoe-chat-actions/thread";
import { CARD_REPLY_LOST } from "@/lib/zoe-chat-actions/thread-events";
import { DialogTurn } from "./dialog-turn";
import {NO_TITRATION} from '@/lib/zoe-chat-actions/dose-copy';

const STATUSES = ["continuous", "course_stopped", "prn"] as const;
type Status = typeof STATUSES[number];
type Reason = AskReason | "values_normal";
const REASONS: Reason[] = ["side_effect", "values_normal", "decided_to_stop", "ran_out", "cost_or_availability", "forgot"];
const reasonText = (l: CardLocale, reason: string) => reason === "values_normal" ? say(l, MEDICINES.valuesNormal) : MEDICINE_ASK_COPY[l].reasons[reason as AskReason];
const statusText = (l: CardLocale, status: string) => say(l, MEDICINES[status as Status]);

function rowWords(l: CardLocale, row: MedicineRow) {
  const said = row.status === "restored" ? say(l, MEDICINES.restored) : row.status ? statusText(l, row.status) : say(l, MEDICINES.added);
  return `${row.name}: ${said}${row.stopReason ? `, ${reasonText(l, row.stopReason).toLocaleLowerCase(l)}` : ""}`;
}
export function SavedMedicinesTurn({ rows, locale: l, time, noTitration=false }: { rows: MedicineRow[]; locale: CardLocale; time: string;noTitration?:boolean }) {
  return <DialogTurn locale={l} action={rows.map(row => rowWords(l, row)).join("\n")} time={time}><p data-zoe-medicines-saved>{say(l, MEDICINES.reply)}</p>{rows.some(row => row.status === "course_stopped") && <p data-zoe-reminders-stopped>{say(l, MEDICINES.stoppedReply)}</p>}{noTitration&&<p data-no-titration>{say(l,NO_TITRATION)}</p>}</DialogTurn>;
}

type Choice = { status: Status | null; stopReason: Reason | null; stopConfirmed: boolean };
type New = Choice & { requestId: string; name: string; dose: string; time: string };
function Choices({ l, name, value, disabled, onChange }: { l: CardLocale; name: string; value: Choice; disabled: boolean; onChange: (next: Choice) => void }) {
  return <>
    <fieldset disabled={disabled}>
      <legend>{say(l, MEDICINES.statusLabel(name))}</legend>
      <div className="cv2-seg">{STATUSES.map(id => <button type="button" key={id} aria-pressed={value.status === id} onClick={() => onChange({ status: id, stopReason: null, stopConfirmed: false })}>{statusText(l, id)}</button>)}</div>
    </fieldset>
    {!value.status && <p className="cv2-hint" data-not-provided>{say(l, MEDICINES.notProvided)}</p>}
    {value.status === "course_stopped" && <fieldset disabled={disabled}>
      <legend>{say(l, MEDICINES.why)}</legend>
      <div className="cv2-seg">{REASONS.map(id => <button type="button" key={id} aria-pressed={value.stopReason === id} onClick={() => onChange({ ...value, stopReason: value.stopReason === id ? null : id })}>{reasonText(l, id)}</button>)}</div>
    </fieldset>}
    {value.status === "course_stopped" && <fieldset disabled={disabled} data-stop-confirm>
      <legend>{say(l, MEDICINES.stopWarning)}</legend>
      <div className="cv2-seg"><button type="button" aria-pressed={value.stopConfirmed} onClick={() => onChange({ ...value, stopConfirmed: !value.stopConfirmed })}>{say(l, MEDICINES.stopYes)}</button></div>
    </fieldset>}
  </>;
}

/** One list, one save: the member's message then says what they did, and the form leaves. Doctor plan rows are read-only. */
export function MedicinesCard({ card, locale: l, onCard, onAct }: { card: Extract<ValidCard, { kind: "medicines" }>; locale: CardLocale; onCard: (card: ZoeCard) => void; onAct: (id: string, acting: boolean) => void }) {
  const [read, setRead] = useState<ReviewRead | null>(null), [loadState, setLoad] = useState("loading");
  const [changes, setChanges] = useState<Record<string, Choice>>({}), [added, setAdded] = useState<New[]>([]);
  const [problem, setProblem] = useState<string | null>(null), [nameMissing, setNameMissing] = useState(false);
  const [busy, start] = useTransition();
  // One operation per list: a retry repeats it. It changes only once the server let go of a refused list.
  const [opId, setOpId] = useState(() => crypto.randomUUID());
  // The answer may have landed: only the same list can go again, so the form holds still until it has.
  const [unsure, setUnsure] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    let active = true;
    void readMedicinesForReview(card.id).then(r => { if (active) { setLoad(r.status); setRead(r.status === "ok" ? r.data : null); if ("card" in r && r.card) onCard(r.card); } }).catch(() => { if (active) setLoad("unavailable"); });
    return () => { active = false; };
  }, [card.id, onCard]);
  const frame = (body: React.ReactNode) => <article className="cv2-msg cv2-zoe" data-zoe-card="medicines" data-chat-card-id={card.id} data-state={loadState} onClick={event => event.stopPropagation()}>
    <p className="cv2-from"><i className="cv2-orb" aria-hidden />{zoeName(l)}</p>
    <section className="cv2-reading cv2-block" aria-label={say(l, { en: "Your medicines", hy: "Ձեր դեղերը", ru: "Ваши лекарства" })}>
      <h3><Pill size={18} aria-hidden />{say(l, { en: "Your medicines", hy: "Ձեր դեղերը", ru: "Ваши лекарства" })}</h3>
      {body}
    </section>
  </article>;
  if (loadState === "signed_out") return frame(<SignInEnded locale={l} />);
  if (!read) return frame(<p role={loadState === "loading" ? "status" : "alert"}>{say(l, loadState === "loading" ? MEDICINES.loading : loadState === "disabled" ? MEDICINES.off : loadState === "stale" ? COMMON.staleInChat : MEDICINES.failed)}</p>);
  const picked = read.own.filter(m => changes[m.id]?.status && (changes[m.id].status !== m.status || changes[m.id].stopReason !== m.stopReason));
  const settle = (r: Awaited<ReturnType<typeof restoreMedicineFromCard>> | null) => {
    if (r && "card" in r && r.card) onCard(r.card);
    if (r?.status === "ok") { sending.current = false; return; }
    setProblem(r === null ? say(l, COMMON.unconfirmed) : r.status === "signed_out" ? "signed_out" : r.status === "stale" ? say(l, COMMON.staleInChat) : r.status === "closed" ? say(l, COMMON.closed)
      : "restore" in r && r.restore === "duplicate" ? say(l, MEDICINES.duplicate) : "review" in r && r.review === "limit" ? say(l, MEDICINES.limit) : say(l, COMMON.saveFailed));
    if (r) onAct(card.id, false);
    const released = !!r && "released" in r && r.released;
    if (released) setOpId(crypto.randomUUID());
    setUnsure(!released);
    sending.current = false;
  };
  const lost = (error: unknown) => {
    if (String((error as { digest?: unknown })?.digest ?? "").startsWith("NEXT_REDIRECT")) throw error;
    window.dispatchEvent(new Event(CARD_REPLY_LOST));
  };
  const restore = (id: string) => {
    if (sending.current) return;
    sending.current = true;
    onAct(card.id, true);
    start(async () => {
      setProblem(null);
      let r: Awaited<ReturnType<typeof restoreMedicineFromCard>> | null = null;
      try { r = await restoreMedicineFromCard({ cardId: card.id, opId, id }); } catch (error) { lost(error); }
      settle(r);
    });
  };
  const locked = busy || unsure;
  const save = () => {
    if (sending.current) return;
    const missing = added.some(row => !row.name.trim());
    setNameMissing(missing);
    if (missing) { setProblem(say(l, MEDICINES.needName)); return; }
    if (!picked.length && !added.length) { setProblem(say(l, MEDICINES.nothing)); return; }
    if ([...picked.map(m => changes[m.id]), ...added].some(row => row.status === "course_stopped" && !row.stopConfirmed)) { setProblem(say(l, MEDICINES.needStop)); return; }
    sending.current = true;
    onAct(card.id, true);
    start(async () => {
      setProblem(null);
      let r: Awaited<ReturnType<typeof reviewMedicinesFromCard>> | null = null;
      try {
        r = await reviewMedicinesFromCard({ cardId: card.id, opId, changes: picked.map(m => ({ id: m.id, ...changes[m.id] })),
          added: added.map(row => ({ requestId: row.requestId, name: row.name.trim(), dose: row.dose.trim(), time: row.time, status: row.status, stopReason: row.stopReason, stopConfirmed: row.stopConfirmed })) });
      } catch (error) { lost(error); }
      settle(r);
    });
  };
  return frame(<>
    <p>{say(l, MEDICINES.lead)}</p>
    {read.plan.length > 0 && <div><h4>{say(l, MEDICINES.plan)}</h4>{read.plan.map(m => <div key={m.id} className="cv2-med"><p>{m.name}</p><p className="cv2-hint">{[m.dose, ...m.times].filter(Boolean).join(" · ")}</p></div>)}</div>}
    <div>
      <h4>{say(l, MEDICINES.own)}</h4>
      {!read.own.length && !added.length && <p className="cv2-hint">{say(l, MEDICINES.empty)}</p>}
      {read.own.map(m => <div key={m.id} className="cv2-med" data-medicine={m.name}>
        <p>{m.name}</p>
        <p className="cv2-hint">{[m.dose, ...m.times].filter(Boolean).join(" · ")}</p>
        <Choices l={l} name={m.name} disabled={locked} value={changes[m.id] ?? { status: m.status as Status | null, stopReason: m.stopReason as Reason | null, stopConfirmed: false }} onChange={next => setChanges(all => ({ ...all, [m.id]: next }))} />
      </div>)}
      {added.map(row => <div key={row.requestId} className="cv2-med" data-medicine-new>
        <label className="cv2-field">{say(l, MEDICINES.name)}<input type="text" autoComplete="off" maxLength={120} value={row.name} disabled={locked} aria-invalid={nameMissing && !row.name.trim()} onChange={event => setAdded(all => all.map(x => x === row ? { ...x, name: event.target.value } : x))} /></label>
        <div className="cv2-pair">
          <label className="cv2-field">{say(l, MEDICINES.dose)}<input type="text" autoComplete="off" maxLength={120} value={row.dose} disabled={locked} onChange={event => setAdded(all => all.map(x => x === row ? { ...x, dose: event.target.value } : x))} /></label>
          <label className="cv2-field">{say(l, MEDICINES.time)}<input type="time" value={row.time} disabled={locked} onChange={event => setAdded(all => all.map(x => x === row ? { ...x, time: event.target.value || x.time } : x))} /></label>
        </div>
        <Choices l={l} name={row.name.trim() || say(l, MEDICINES.add)} disabled={locked} value={row} onChange={next => setAdded(all => all.map(x => x === row ? { ...x, ...next } : x))} />
        <button type="button" className="cv2-link" disabled={locked} onClick={() => setAdded(all => all.filter(x => x !== row))}>{say(l, MEDICINES.remove)}</button>
      </div>)}
      <button type="button" className="cv2-link" disabled={locked} onClick={() => setAdded(all => [...all, { requestId: crypto.randomUUID(), name: "", dose: "", time: "08:00", status: null, stopReason: null, stopConfirmed: false }])}>{say(l, MEDICINES.add)}</button>
    </div>
    {read.stopped.length > 0 && <div data-medicines-stopped><h4>{say(l, MEDICINES.stopped)}</h4>{read.stopped.map(m => <div key={m.id} className="cv2-med" data-medicine-stopped={m.name}>
      <p>{m.name}</p>
      <button type="button" className="cv2-link" disabled={busy} onClick={() => restore(m.id)}>{say(l, MEDICINES.restore)}</button>
    </div>)}</div>}
    <button type="button" className="cv2-reading-save" disabled={busy || (!unsure && !picked.length && !added.length)} aria-busy={busy} onClick={save}>{say(l, MEDICINES.save)}</button>
    {problem === "signed_out" ? <SignInEnded locale={l} /> : problem && <p role="alert">{problem}</p>}
  </>);
}
