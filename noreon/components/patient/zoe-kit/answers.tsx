"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, RotateCcw } from "lucide-react";
import { BP_FIELDS, checkBp, readBp, typedBp, type BpField } from "@/components/patient/bp-entry-values";
import { KIT, t, type KitLocale } from "./copy";

/**
 * The answer controls (DESIGN.md §4). They live only in the newest Zoe turn. Each one hands its answer to
 * `onAnswer` with the text of the member's bubble; a write returns null when it worked or the error line to show,
 * and the control keeps what was entered so Retry sends the same answer.
 */
export type Submit<T> = (value: T, said: string) => Promise<string | null> | void;

function useSubmit<T>(onAnswer: Submit<T>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (value: T, said: string) => {
    setBusy(true); setError(null);
    try { const problem = await onAnswer(value, said); if (problem) setError(problem); }
    finally { setBusy(false); }
  };
  return { busy, error, run };
}

/** The primary button: one per turn, full width, busy with a spinner; disabled always says why beside it. */
export function Primary({ children, busy = false, disabled = false, why, tone, onClick, type = "button" }: {
  children: ReactNode; busy?: boolean; disabled?: boolean; why?: string; tone?: "line" | "ok"; onClick?: () => void; type?: "button" | "submit";
}) {
  const id = useId();
  return (
    <>
      <button type={type} className="zk-btn" data-tone={tone} disabled={disabled || busy} aria-busy={busy || undefined}
        aria-describedby={disabled && why ? id : undefined} onClick={onClick}>
        {busy && <span className="zk-spin" aria-hidden />}{children}
      </button>
      {disabled && why && <p id={id} className="zk-why">{why}</p>}
    </>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (text) ref.current?.focus(); }, [text]);
  return text ? <p ref={ref} tabIndex={-1} role="alert" className="zk-alertline">{text}</p> : null;
}

/** Two to four short answers that need no confirmation. The tapped label becomes the member's message. */
export function QuickReplies({ label, options, onAnswer }: { label: string; options: { value: string; label: string }[]; onAnswer: Submit<string> }) {
  const { busy, run } = useSubmit(onAnswer);
  return (
    <div className="zk-replies" role="group" aria-label={label}>
      {options.map(o => <button key={o.value} type="button" className="zk-reply" disabled={busy} onClick={() => run(o.value, o.label)}>{o.label}</button>)}
    </div>
  );
}

type Option = { value: string; label: string };
/** One of a list, as native radios styled as pills (a vertical list when labels are long or there are many). */
export function SingleSelect({ locale: l, legend, options, next, onAnswer }: { locale: KitLocale; legend: string; options: Option[]; next?: string; onAnswer: Submit<string> }) {
  const [value, setValue] = useState<string | null>(null);
  const { busy, error, run } = useSubmit(onAnswer);
  const name = useId();
  const list = options.length > 6 || options.some(o => o.label.length > 28);
  const chosen = options.find(o => o.value === value);
  return (
    <form className="zk-card" onSubmit={e => { e.preventDefault(); if (chosen) run(chosen.value, chosen.label); }}>
      <fieldset className="zk-fieldset" disabled={busy}>
        <legend className="zk-legend">{legend}</legend>
        <div className="zk-options" data-layout={list ? "list" : "pills"}>
          {options.map(o => (
            <label key={o.value} className="zk-opt" data-kind="single">
              <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => setValue(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorLine text={error} />
      <div className="zk-actions"><Primary type="submit" busy={busy} disabled={!chosen} why={t(l, KIT.chooseOne)}>{error ? t(l, KIT.retry) : next ?? t(l, KIT.next)}</Primary></div>
    </form>
  );
}

/** Any of a list plus an exclusive "none" option; Done shows the count. */
export function MultiSelect({ locale: l, legend, options, none, onAnswer }: { locale: KitLocale; legend: string; options: Option[]; none?: Option; onAnswer: Submit<string[]> }) {
  const [values, setValues] = useState<string[]>([]);
  const { busy, error, run } = useSubmit(onAnswer);
  const all = none ? [...options, none] : options;
  const toggle = (v: string) => setValues(cur => {
    if (none && v === none.value) return cur.includes(v) ? [] : [v];
    const rest = cur.filter(x => x !== none?.value);
    return rest.includes(v) ? rest.filter(x => x !== v) : [...rest, v];
  });
  const said = all.filter(o => values.includes(o.value)).map(o => o.label).join(", ");
  return (
    <form className="zk-card" onSubmit={e => { e.preventDefault(); if (values.length) run(values, said); }}>
      <fieldset className="zk-fieldset" disabled={busy}>
        <legend className="zk-legend">{legend}</legend>
        <div className="zk-options" data-layout={all.length > 6 ? "list" : "pills"}>
          {all.map(o => (
            <label key={o.value} className="zk-opt" data-kind="multi">
              <input type="checkbox" value={o.value} checked={values.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorLine text={error} />
      <div className="zk-actions">
        <Primary type="submit" busy={busy} disabled={!values.length} why={t(l, KIT.chooseAny)}>{error ? t(l, KIT.retry) : values.length ? t(l, KIT.doneCount(values.length)) : t(l, KIT.done)}</Primary>
      </div>
    </form>
  );
}

/** One number with its unit, common values as chips, and "I don't know" where the question allows unknown. */
export function NumberEntry({ locale: l, label, unit, min, max, taps = [], unknown, onAnswer }: {
  locale: KitLocale; label: string; unit: string; min: number; max: number; taps?: number[]; unknown?: { label: string; said: string }; onAnswer: Submit<number | null>;
}) {
  const [raw, setRaw] = useState("");
  const { busy, error, run } = useSubmit(onAnswer);
  const id = useId();
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  const ok = n >= min && n <= max;
  // Too long to grow into range is wrong now; shorter may still be on its way ("5" before "52").
  const wrong = raw !== "" && !ok && (raw.length >= String(max).length || n > max);
  return (
    <form className="zk-card" onSubmit={e => { e.preventDefault(); if (ok) run(n, `${n} ${unit}`); }}>
      <label htmlFor={id} className="zk-legend">{label}</label>
      <div className="zk-numrow">
        <input id={id} className="zk-big" inputMode="numeric" autoComplete="off" placeholder="–" value={raw} disabled={busy}
          aria-invalid={wrong || undefined} aria-describedby={`${id}-unit ${id}-err`}
          onChange={e => setRaw(e.target.value.replace(/\D/g, "").slice(0, String(max).length))} />
        <span id={`${id}-unit`} className="zk-unit">{unit}</span>
      </div>
      <p id={`${id}-err`} className="zk-error" aria-live="polite">{wrong ? t(l, KIT.range(min, max, unit)) : ""}</p>
      {taps.length > 0 && (
        <div className="zk-taps" role="group" aria-label={t(l, KIT.orTap)}>
          <span aria-hidden>{t(l, KIT.orTap)}</span>
          {taps.map(v => <button key={v} type="button" className="zk-chip" disabled={busy} onClick={() => run(v, `${v} ${unit}`)}>{v}</button>)}
        </div>
      )}
      <ErrorLine text={error} />
      <div className="zk-actions">
        <Primary type="submit" busy={busy} disabled={!ok} why={t(l, KIT.enterNumber)}>{error ? t(l, KIT.retry) : t(l, KIT.next)}</Primary>
        {unknown && <Primary tone="line" disabled={busy} onClick={() => run(null, unknown.said)}>{unknown.label}</Primary>}
      </div>
    </form>
  );
}

const BP_LABEL: Record<BpField, typeof KIT.top> = { systolic: KIT.top, diastolic: KIT.bottom, pulse: KIT.pulse };
export type BpValue = { systolic: number; diastolic: number; pulse: number | null };
/**
 * A blood pressure reading: three big fields in one row (no sliders), the app's own entry bounds
 * (bp-entry-values.ts), a read-back in words, and a button that names the reading it saves.
 */
export function BpEntry({ locale: l, intro, unknown, onAnswer }: { locale: KitLocale; intro?: ReactNode; unknown?: { label: string; said: string }; onAnswer: Submit<BpValue | null> }) {
  const [v, setV] = useState<Record<BpField, string>>({ systolic: "", diastolic: "", pulse: "" });
  const { busy, error, run } = useSubmit(onAnswer);
  const id = useId();
  const refs = { systolic: useRef<HTMLInputElement>(null), diastolic: useRef<HTMLInputElement>(null), pulse: useRef<HTMLInputElement>(null) };
  const check = checkBp(v);
  const reading = check.ok ? `${check.systolic}/${check.diastolic}` : "";
  const said = check.ok ? `${reading}${check.pulse ? `, ${t(l, KIT.pulse).toLowerCase()} ${check.pulse}` : ""}` : "";
  const bad = (f: BpField) => readBp(f, v[f]).state === "invalid" || (!check.ok && check.problem === "order" && f !== "pulse");
  const problem = !check.ok && check.problem === "order" ? t(l, KIT.bpOrder)
    : !check.ok && check.problem.startsWith("range-") ? (() => { const f = check.problem.slice(6) as BpField; return t(l, KIT.bpRange(BP_LABEL[f], BP_FIELDS[f].min, BP_FIELDS[f].max)); })()
    : "";
  const set = (f: BpField, raw: string) => {
    const next = typedBp(raw, v[f]);
    setV(cur => ({ ...cur, [f]: next }));
    if (f === "systolic" && next.length === 3 && readBp(f, next).state === "set") refs.diastolic.current?.focus();
  };
  return (
    <form className="zk-card" onSubmit={e => { e.preventDefault(); if (check.ok) run({ systolic: check.systolic, diastolic: check.diastolic, pulse: check.pulse ?? null }, said); }}>
      {intro}
      <div className="zk-bp">
        {(["systolic", "diastolic", "pulse"] as const).map(f => (
          <label key={f}>
            <span>{t(l, BP_LABEL[f])}{f === "pulse" && <small> ({t(l, KIT.optional)})</small>}</span>
            <input ref={refs[f]} className="zk-big" inputMode="numeric" autoComplete="off" placeholder="–" value={v[f]} disabled={busy}
              aria-invalid={bad(f) || undefined} aria-describedby={`${id}-read ${id}-err`} onChange={e => set(f, e.target.value)} />
          </label>
        ))}
      </div>
      <p id={`${id}-read`} className="zk-readback" aria-live="polite">
        {check.ok ? t(l, KIT.bpReadback(String(check.systolic), String(check.diastolic), check.pulse ? String(check.pulse) : null)) : ""}
      </p>
      <p id={`${id}-err`} className="zk-error" aria-live="polite">{problem}</p>
      <ErrorLine text={error} />
      <div className="zk-actions">
        <Primary type="submit" busy={busy} disabled={!check.ok} why={t(l, KIT.bpEnter)}>{error ? t(l, KIT.retry) : check.ok ? t(l, KIT.bpSave(reading)) : t(l, KIT.bpSaveIdle)}</Primary>
        {unknown && <Primary tone="line" disabled={busy} onClick={() => run(null, unknown.said)}>{unknown.label}</Primary>}
      </div>
    </form>
  );
}

export type Slot = { id: string; at: string };
export type SlotDay = { key: string; weekday: string; day: string; today?: boolean; slots: Slot[] };
/** Day row, then that day's times, then a button that names the chosen time. */
export function SlotPicker({ locale: l, days, label, onAnswer }: { locale: KitLocale; days: SlotDay[]; label: (day: SlotDay, slot: Slot) => string; onAnswer: Submit<Slot> }) {
  const [dayKey, setDayKey] = useState(days.find(d => d.slots.length)?.key ?? days[0]?.key);
  const [slotId, setSlotId] = useState<string | null>(null);
  const { busy, error, run } = useSubmit(onAnswer);
  const day = days.find(d => d.key === dayKey);
  const slot = day?.slots.find(s => s.id === slotId);
  return (
    <form className="zk-card" onSubmit={e => { e.preventDefault(); if (day && slot) run(slot, label(day, slot)); }}>
      <div role="group" aria-label={t(l, KIT.pickDay)} className="zk-days">
        {days.map(d => (
          <button key={d.key} type="button" className="zk-day-btn" aria-pressed={d.key === dayKey} disabled={busy}
            onClick={() => { setDayKey(d.key); setSlotId(null); }}>
            <small>{d.today ? t(l, KIT.today) : d.weekday}</small><strong>{d.day}</strong>
          </button>
        ))}
      </div>
      {day && !day.slots.length ? <p className="zk-plain">{t(l, KIT.noTimes)}</p> : (
        <div role="radiogroup" aria-label={t(l, KIT.pickTime)} className="zk-times">
          {day?.slots.map(s => (
            <button key={s.id} type="button" role="radio" className="zk-chip" aria-checked={s.id === slotId} disabled={busy} onClick={() => setSlotId(s.id)}>{s.at}</button>
          ))}
        </div>
      )}
      <ErrorLine text={error} />
      <div className="zk-actions">
        <Primary type="submit" busy={busy} disabled={!slot} why={t(l, KIT.chooseOne)}>{day && slot ? t(l, KIT.book(label(day, slot))) : t(l, KIT.next)}</Primary>
      </div>
    </form>
  );
}

/** Free text Zoe asked for, then a review line naming exactly what goes to the care team before Send. */
export function TextThenConfirm({ locale: l, label, placeholder, optional = false, compose, onAnswer }: {
  locale: KitLocale; label: string; placeholder?: string; optional?: boolean; compose: (text: string) => string; onAnswer: Submit<string>;
}) {
  const [text, setText] = useState("");
  const [review, setReview] = useState(false);
  const { busy, error, run } = useSubmit(onAnswer);
  const id = useId();
  const message = compose(text.trim());
  if (review) return <ConfirmBar locale={l} text={message} busy={busy} error={error} onSend={() => run(message, message)} onEdit={() => setReview(false)} />;
  return (
    <form className="zk-card" onSubmit={e => { e.preventDefault(); if (optional || text.trim()) setReview(true); }}>
      <label htmlFor={id} className="zk-legend">{label}</label>
      <textarea id={id} className="zk-text" value={text} placeholder={placeholder} maxLength={1000} onChange={e => setText(e.target.value)} />
      <div className="zk-actions"><Primary type="submit" disabled={!optional && !text.trim()} why={label}>{t(l, KIT.next)}</Primary></div>
    </form>
  );
}

/** The review step before something goes to a person: the exact text, Send, and Edit. */
export function ConfirmBar({ locale: l, text, busy, error, onSend, onEdit }: { locale: KitLocale; text: string; busy: boolean; error: string | null; onSend: () => void; onEdit: () => void }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="zk-card" data-tone="action">
      <div className="zk-review">
        <p ref={ref} tabIndex={-1}>{t(l, KIT.goesTo)}</p>
        <blockquote>{text}</blockquote>
      </div>
      <ErrorLine text={error} />
      <div className="zk-actions">
        <Primary busy={busy} onClick={onSend}>{error ? t(l, KIT.retry) : t(l, KIT.send)}</Primary>
        <button type="button" className="zk-link self-center" disabled={busy} onClick={onEdit}>{t(l, KIT.edit)}</button>
      </div>
    </div>
  );
}

/** After a reversible routine save: the done row with Undo for ten seconds. */
export function UndoRow({ locale: l, text, onUndo }: { locale: KitLocale; text: string; onUndo?: () => void }) {
  const [open, setOpen] = useState(!!onUndo);
  const [undone, setUndone] = useState(false);
  useEffect(() => { if (!open) return; const id = setTimeout(() => setOpen(false), 10_000); return () => clearTimeout(id); }, [open]);
  return (
    <p className="zk-done" role="status">
      {undone ? <RotateCcw className="size-5" aria-hidden /> : <Check className="size-5" aria-hidden />}
      {undone ? t(l, KIT.undone) : text}
      {open && !undone && <button type="button" className="zk-link" onClick={() => { setUndone(true); setOpen(false); onUndo?.(); }}>{t(l, KIT.undo)}</button>}
    </p>
  );
}
