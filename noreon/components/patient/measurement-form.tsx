"use client";
import { useState, useEffect, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { recordMeasurement } from "@/app/patient/actions";
import { safeRequest } from "@/lib/patient/transport";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BpValueRow } from "./bp-value-row";
import { bpSummary, checkBp, readBp, type BpField } from "./bp-entry-values";
import { armeniaLocalNow, isFutureMeasurement } from "@/lib/patient/measured-at";
import { SignInEnded } from "./sign-in-ended";
import { keepDraft, readDraft } from "./tab-draft";
import { BpSafetyNotice } from "./bp-safety-notice";
import { bpNeedsAction, type BpStep } from "@/lib/clinical/rules/bp-check";
import { bpSavedLine } from "@/lib/clinical/rules/bp-words";
// datetime-local gives "YYYY-MM-DDTHH:mm" (seconds optional); read it as Armenia time.
const armeniaInstant = (local: string) => new Date(`${local.length === 16 ? `${local}:00` : local}+04:00`);

const HY_MONTHS = ["հունվարի", "փետրվարի", "մարտի", "ապրիլի", "մայիսի", "հունիսի", "հուլիսի", "օգոստոսի", "սեպտեմբերի", "հոկտեմբերի", "նոյեմբերի", "դեկտեմբերի"];
const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "today at 08:04" or "17 Oct at 08:04" for an Armenia-time datetime-local value. */
function timeLabel(local: string, locale: PatientLocale) {
  if (local.length < 16) return "";
  const [date, clock] = [local.slice(0, 10), local.slice(11, 16)];
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const month = Number(date.slice(5, 7)) - 1, day = Number(date.slice(8, 10));
  if (date === today) return tx(locale, `այսօր, ${clock}`, `today at ${clock}`, `сегодня в ${clock}`);
  return tx(locale, `${day} ${HY_MONTHS[month]}, ${clock}`, `${day} ${EN_MONTHS[month]} at ${clock}`, `${day} ${RU_MONTHS[month]} в ${clock}`);
}
/** The reading being typed, kept with its time and submission id: it never comes back as measured later or as a second reading. */
export const BP_DRAFT = "bp";
export type MeasurementReady = { canSave: boolean; summary: string; problem: boolean };
const NEXT: Partial<Record<BpField, BpField>> = { systolic: "diastolic", diastolic: "pulse" };

export type MeasurementSave = (input: { submissionId: string; systolic: number; diastolic: number; pulse?: number; measuredAt: string }) => Promise<{ ok: boolean; reason?: string; message?: string; bp?: BpStep }>;
/** save/doneHref: another owner of the reading (the BP week) saves it and says where to go next. */
export function MeasurementForm({ locale, onDraftChange, onBusyChange, onReadyChange, formId, externalSubmit = false, prototype = false, save, doneHref = "/patient/measurements", onSaved, idPrefix="" }: { locale: PatientLocale; onDraftChange?: (dirty: boolean) => void; onBusyChange?: (busy: boolean) => void; onReadyChange?: (ready: MeasurementReady) => void; formId?: string; externalSubmit?: boolean; prototype?: boolean; save?: MeasurementSave; doneHref?: string; onSaved?:()=>void; idPrefix?:string }) {
  const [values, setValues] = useState<Record<BpField, string>>({ systolic: "", diastolic: "", pulse: "" }),
    [time, setTime] = useState(""),
    [id, setId] = useState(() => crypto.randomUUID()),
    [error, setError] = useState(""),
    [conflict, setConflict] = useState(false),
    [signedOut, setSignedOut] = useState(false),
    [busy, start] = useTransition();
  // A very high reading stays on this screen: the check's next step, and the form ready for the repeat.
  const [safety, setSafety] = useState<string | null>(null);
  // An unedited time is the moment of saving, kept for a retry of the same submission (BP-04: a repeat six minutes later is six minutes later).
  const sentTime = useRef<{ id: string; time: string } | null>(null);
  const [timeError, setTimeError] = useState(false);
  const [timeEdited, setTimeEdited] = useState(false);
  const [editTime, setEditTime] = useState(false);
  const router = useRouter();
  const check = checkBp(values);
  const summary = bpSummary(locale, values, check);
  // Only a value the member typed out of range is flagged on the row; the order problem names both rows in the summary.
  const invalid = (field: BpField) => readBp(field, values[field]).state === "invalid" || (!check.ok && check.problem === "order" && field !== "pulse");
  const anySet = Boolean(values.systolic || values.diastolic || values.pulse);
  useEffect(() => { onDraftChange?.(anySet || timeEdited); }, [anySet, timeEdited, onDraftChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  // Still typing is guidance, not an error: the summary stays neutral until the number cannot fit.
  const problem = !check.ok && check.problem !== "need-both" && !check.problem.startsWith("typing-");
  useEffect(() => { onReadyChange?.({ canSave: check.ok, summary, problem }); }, [check.ok, summary, problem, onReadyChange]);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: "nearest" }); }
  }, [error]);
  useEffect(() => {
    const timer = setTimeout(() => {
      // Armenia keeps UTC+4 all year, matching the times shown elsewhere on Home.
      setTime(kept => kept || new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 16));
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  // Nothing is kept until the draft has been read: the first pass must not delete it before it is back in the form.
  const [draftRead, setDraftRead] = useState(false);
  useEffect(() => {
    try {
      const kept = JSON.parse(readDraft(BP_DRAFT) ?? "null") as { values: Record<BpField, string>; time: string; id: string } | null;
      if (kept) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of browser storage after hydration
        setValues(kept.values);
        setTime(kept.time);
        setTimeEdited(true);
        setId(kept.id);
      }
    } catch {}
    setDraftRead(true);
  }, []);
  useEffect(() => { if (draftRead) keepDraft(BP_DRAFT, anySet ? JSON.stringify({ values, time, id }) : ""); }, [draftRead, anySet, values, time, id]);
  const update = (field: BpField) => (raw: string) => setValues(previous => previous[field] === raw ? previous : { ...previous, [field]: raw });
  const row = (field: BpField, label: string, unit: string) => <BpValueRow idPrefix={idPrefix} compact={prototype} field={field} locale={locale} label={label} unit={unit}
    value={values[field]} disabled={busy} invalid={invalid(field)} onChange={update(field)}
    onEnter={() => { const next = NEXT[field]; if (next) document.getElementById(idPrefix+next)?.focus(); }} />;
  const done = () => { if (onSaved) onSaved(); else { router.replace(doneHref as "/patient/measurements"); router.refresh(); } };
  const setTimeValue = (raw: string) => { setTime(raw); setTimeEdited(true); setTimeError(false); };
  const fields = <>
      {row("systolic", tx(locale, "Վերին թիվ (սիստոլիկ)", "Upper number (systolic)", "Верхнее число (систолическое)"), "mmHg")}
      {row("diastolic", tx(locale, "Ստորին թիվ (դիաստոլիկ)", "Lower number (diastolic)", "Нижнее число (диастолическое)"), "mmHg")}
      {row("pulse", tx(locale, "Զարկերակ (ոչ պարտադիր)", "Pulse (optional)", "Пульс (необязательно)"), tx(locale, "զարկ/րոպե", "beats/min", "уд/мин"))}
  </>;
  return (
    <form
      id={formId}
      className="space-y-2.5"
      data-bp-form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        setError("");
        setSignedOut(false);
        // Save is disabled until this passes; the check stays here for Enter and assistive submits.
        if (!check.ok) { document.getElementById(idPrefix+(readBp("systolic", values.systolic).state === "set" ? "diastolic" : "systolic"))?.focus(); return; }
        const measured = timeEdited ? time : sentTime.current?.id === id ? sentTime.current.time : new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 16);
        if (!measured || !Number.isFinite(armeniaInstant(measured).getTime()) || isFutureMeasurement(armeniaInstant(measured).toISOString())) { setTimeError(true); setEditTime(true); return; }
        sentTime.current = { id, time: measured };
        const { systolic, diastolic, pulse } = check;
        start(async () => {
          const result = await safeRequest(() =>
            (save ?? (recordMeasurement as MeasurementSave))({
              submissionId: id,
              systolic,
              diastolic,
              pulse,
              measuredAt: armeniaInstant(measured).toISOString(),
            }),
          );
          if (result?.ok) {
            keepDraft(BP_DRAFT, "");
            if (bpNeedsAction(result.bp)) {
              setSafety(bpSavedLine(locale, result.bp!, { systolic, diastolic }));
              setValues({ systolic: "", diastolic: "", pulse: "" });
              setId(crypto.randomUUID());
              setTime(new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 16));
              setTimeEdited(false);
              setEditTime(false);
              return;
            }
            done();
          } else if (result?.reason === "signed_out") {
            setSignedOut(true);
          } else {
            setConflict(result?.reason === "conflict");
            setError(result && "message" in result && typeof result.message === "string" ? result.message :
              result?.reason === "conflict"
                ? tx(
                    locale,
                    "Այս գրառումն արդեն պահպանված է այլ արժեքներով։ Ստուգեք ձեր պատմությունը։",
                    "This submission was saved with different values. Check your history.", "Это измерение уже сохранено с другими значениями. Проверьте историю.",
                  )
                : result == null ? tx(locale,
                    "Չհաջողվեց հաստատել պահպանումը։ Տվյալները մնում են այստեղ։ Ստուգեք պատմությունը կամ կրկին փորձեք։",
                    "We couldn’t confirm your save. Your reading stays here. Check your history or try again.", "Не удалось подтвердить сохранение. Ваше измерение остаётся здесь. Проверьте историю или попробуйте снова.") : tx(
                    locale,
                    "Չհաջողվեց պահել։ Ստուգեք տվյալները և կրկին փորձեք։",
                    "We couldn’t save. Check the details and try again.", "Не удалось сохранить. Проверьте данные и попробуйте снова.",
                  ),
            );
          }
        });
      }}
    >
      {safety && <div className="space-y-2"><BpSafetyNotice text={safety} locale={locale} /><Button type="button" variant="secondary" className="h-auto min-h-12 w-full whitespace-normal" disabled={busy} onClick={done}>{tx(locale, "Փակել", "Close", "Закрыть")}</Button></div>}
      {prototype ? <div className="ms-bp-grid" data-bp-grid>{fields}</div> : fields}
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 border-t border-border pt-1">
        {editTime ? <div className="w-full space-y-1 pb-1">
          <Label htmlFor={idPrefix+"measured-time"}>{tx(locale, "Չափման ամսաթիվն ու ժամը (Հայաստանի ժամանակով)", "Measurement date and time (Armenia time)", "Дата и время измерения (по времени Армении)")}</Label>
          <Input id={idPrefix+"measured-time"} className="h-12 min-w-0 bg-background text-base" type="datetime-local" max={armeniaLocalNow()} suppressHydrationWarning value={time}
            onValueChange={setTimeValue} onInput={event => setTimeValue(event.currentTarget.value)} required
            aria-invalid={timeError || undefined} aria-describedby={timeError ? idPrefix+"measured-time-error" : undefined} disabled={busy} />
          {timeError && <p id={idPrefix+"measured-time-error"} role="alert" className="text-caption text-destructive">{tx(locale, "Ստուգեք չափման ամսաթիվն ու ժամը։", "Check the measurement date and time.", "Проверьте дату и время измерения.")}</p>}
        </div> : <>
          <p className="text-body2 text-muted-foreground">{tx(locale, `Չափվել է՝ ${timeLabel(time, locale)}`, `Measured ${timeLabel(time, locale)}`, `Измерено ${timeLabel(time, locale)}`)}</p>
          <Button type="button" variant="ghost" className="min-h-12 px-3 text-body2 underline underline-offset-4" disabled={busy} onClick={() => setEditTime(true)}>
            {tx(locale, "Փոխել ժամը", "Change time", "Изменить время")}
          </Button>
        </>}
      </div>
      {error && (
        <p ref={errorRef} tabIndex={-1} id={idPrefix+"measurement-error"} role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {signedOut && <SignInEnded locale={locale} />}
      {conflict && (
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (busy) return;
            setId(crypto.randomUUID());
            setConflict(false);
            setError("");
          }}
        >
          {tx(locale, "Պահել որպես նոր չափում", "Save as a new measurement", "Сохранить как новое измерение")}
        </Button>
      )}
      {!externalSubmit && <p id={idPrefix+"bp-summary"} aria-live="polite" className="text-body2 font-semibold tabular-nums">{summary}</p>}
      {!externalSubmit && <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal" disabled={busy || !check.ok}>
        {busy
          ? tx(locale, "Պահվում է…", "Saving…", "Сохраняется…")
          : tx(locale, "Պահել չափումը", "Save measurement", "Сохранить измерение")}
      </Button>}
      <p className="text-caption leading-relaxed text-muted-foreground">
        {tx(
          locale,
          "Սովորական չափումը պահվում է պատմության մեջ և բժշկին չի ծանուցում։ Շատ բարձր չափման դեպքում կխնդրենք հանգստանալ և նորից չափել։",
          "An ordinary reading is saved in your history and does not notify a doctor. If it is very high, we'll ask you to rest and measure again.", "Обычное измерение сохраняется в истории и не уведомляет врача. Если оно очень высокое, мы попросим вас отдохнуть и измерить снова.",
        )}
      </p>
    </form>
  );
}
