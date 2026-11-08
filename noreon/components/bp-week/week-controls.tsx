"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/components/patient-care/common";
import type { PatientLocale } from "@/lib/patient/copy";
import { setMyBpWeekReminders, startMyBpWeek, stopMyBpWeek, type BpWeekResult } from "@/lib/bp-week/actions";
import { recordBpWeekReading } from "@/lib/bp-week/actions";
import type { MeasurementSave } from "@/components/patient/measurement-form";

/** Real members only (off in the demo), so no demo save lock is needed; a thrown request reads as "not saved". */
const run = async <T,>(op: () => Promise<T>): Promise<T | null> => { try { return await op(); } catch { return null; } };

export function bpWeekMessage(l: PatientLocale, r: BpWeekResult | null | undefined): string {
  switch (r?.status) {
    case "open-week": return copy(l, "You already have a week planned or running.", "Դուք արդեն ունեք պլանավորված կամ ընթացիկ շաբաթ։", "У вас уже есть запланированная или начатая неделя.");
    case "slot-full": return copy(l, "This slot already has its two readings.", "Այս ժամի երկու չափումներն արդեն պահված են։", "Для этого времени уже сохранены два измерения.");
    case "outside-week": return copy(l, "The date and time are outside your week. Check them and try again.", "Ամսաթիվը և ժամը ձեր շաբաթից դուրս են։ Ստուգեք և կրկին փորձեք։", "Дата и время выходят за пределы вашей недели. Проверьте их и попробуйте снова.");
    case "not-today": return copy(l, "Enter today's readings with today's date and time. A missed reading stays missed: no blame.", "Մուտքագրեք այսօրվա չափումները այսօրվա ամսաթվով և ժամով։ Բաց թողնված չափումը մնում է բաց թողնված, ոչինչ։", "Введите сегодняшние измерения с сегодняшней датой и временем. Пропущенное измерение останется пропущенным. Ничего страшного.");
    case "not-open": return copy(l, "This week is no longer open.", "Այս շաբաթն այլևս բաց չէ։", "Эта неделя уже закрыта.");
    case "conflict": return copy(l, "This reading was already saved with different values. Check your week.", "Այս չափումն արդեն պահված է այլ արժեքներով։ Ստուգեք ձեր շաբաթը։", "Это измерение уже сохранено с другими значениями. Проверьте вашу неделю.");
    case "disabled": return copy(l, "The 7-day week is not available right now.", "7-օրյա շաբաթն այս պահին հասանելի չէ։", "Программа измерений на 7 дней сейчас недоступна.");
    case "busy": return copy(l, "Noreon is busy. Try again in a moment.", "Noreon-ը զբաղված է։ Մի փոքր ուշ կրկին փորձեք։", "Noreon сейчас занят. Попробуйте чуть позже.");
    case "invalid": return copy(l, "Check the details and try again.", "Ստուգեք տվյալները և կրկին փորձեք։", "Проверьте данные и попробуйте снова.");
    default: return copy(l, "We couldn’t save. Try again.", "Չհաջողվեց պահել։ Կրկին փորձեք։", "Не удалось сохранить. Попробуйте снова.");
  }
}

/** The member starts their own week (only when the care team allows it). */
export function StartWeekForm({ locale: l, today, onSaved }: { locale: PatientLocale; today: string; onSaved?:()=>void }) {
  const router = useRouter();
  const sending=useRef(false);
  const id=useId();
  const [startsOn, setStartsOn] = useState(today), [morning, setMorning] = useState("08:00"), [evening, setEvening] = useState("20:00");
  const [error, setError] = useState(""), [busy, start] = useTransition();
  return (
    <form className="space-y-4" onSubmit={e => {
      e.preventDefault();
      start(async () => {
        if(sending.current)return; sending.current=true;
        setError("");
        const r = await run(() => startMyBpWeek({ startsOn, morning, evening }));
        sending.current=false;
        if (r?.status === "started") { if(onSaved)onSaved(); else router.refresh(); } else setError(bpWeekMessage(l, r));
      });
    }}>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2"><Label htmlFor={`${id}-start`}>{copy(l, "First day", "Առաջին օրը", "Первый день")}</Label>
          <Input id={`${id}-start`} type="date" className="h-12 bg-background" min={today} value={startsOn} onValueChange={setStartsOn} disabled={busy} required /></div>
        <div className="space-y-2"><Label htmlFor={`${id}-morning`}>{copy(l, "Morning time", "Առավոտյան ժամը", "Время утром")}</Label>
          <Input id={`${id}-morning`} type="time" className="h-12 bg-background" min="05:00" max="11:30" value={morning} onValueChange={setMorning} disabled={busy} required /></div>
        <div className="space-y-2"><Label htmlFor={`${id}-evening`}>{copy(l, "Evening time", "Երեկոյան ժամը", "Время вечером")}</Label>
          <Input id={`${id}-evening`} type="time" className="h-12 bg-background" min="17:00" max="22:30" value={evening} onValueChange={setEvening} disabled={busy} required /></div>
      </div>
      <p className="text-caption text-muted-foreground">{copy(l, "Pick times you can keep every day, for example before breakfast and before bed. Armenia time (UTC+4). Telegram reminders are not sent during your quiet hours (set on the Reminders page).", "Ընտրեք ժամեր, որոնք կարող եք պահել ամեն օր, օրինակ՝ նախաճաշից և քնելուց առաջ։ Հայաստանի ժամանակով (UTC+4)։ Telegram հիշեցումները չեն ուղարկվում ձեր հանգստի ժամերին (կարգավորվում են «Հիշեցումներ» էջում)։", "Выберите время, которого сможете придерживаться каждый день, например перед завтраком и перед сном. Время Армении (UTC+4). Напоминания в Telegram не отправляются в ваши часы тишины, заданные на странице «Напоминания».")}</p>
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-body2 text-destructive">{error}</p>}
      <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal sm:w-auto" disabled={busy}><Play className="size-4" aria-hidden />{busy ? copy(l, "Starting…", "Սկսվում է…", "Начинаем…") : copy(l, "Start my 7-day week", "Սկսել իմ 7-օրյա շաբաթը", "Начать мои 7 дней измерений")}</Button>
    </form>
  );
}

export function WeekReminderToggle({ locale: l, weekId, on, onSaved }: { locale: PatientLocale; weekId: string; on: boolean; onSaved?:()=>void }) {
  const router = useRouter();
  const sending=useRef(false);
  const [busy, start] = useTransition(), [error, setError] = useState("");
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={busy} aria-pressed={on}
        onClick={() => start(async () => {
          if(sending.current)return; sending.current=true;
          setError("");
          const r = await run(() => setMyBpWeekReminders(weekId, !on));
          sending.current=false;
          if (r?.status === "saved") { if(onSaved)onSaved(); else router.refresh(); } else setError(bpWeekMessage(l, r));
        })}>
        {on ? <BellOff className="size-4" aria-hidden /> : <Bell className="size-4" aria-hidden />}
        {on ? copy(l, "Stop Telegram reminders for this week", "Դադարեցնել Telegram հիշեցումները այս շաբաթվա համար", "Отключить напоминания в Telegram на эту неделю") : copy(l, "Remind me in Telegram at these times", "Հիշեցնել ինձ Telegram-ում այս ժամերին", "Напоминать мне в Telegram в это время")}
      </Button>
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </div>
  );
}

export function StopWeekButton({ locale: l, weekId, onSaved }: { locale: PatientLocale; weekId: string; onSaved?:()=>void }) {
  const router = useRouter();
  const sending=useRef(false);
  const [confirm, setConfirm] = useState(false), [busy, start] = useTransition(), [error, setError] = useState("");
  if (!confirm) return <Button type="button" variant="ghost" className="h-auto min-h-11 whitespace-normal" onClick={() => setConfirm(true)}><Square className="size-4" aria-hidden />{copy(l, "Stop this week", "Դադարեցնել այս շաբաթը", "Остановить эту неделю")}</Button>;
  return (
    <div role="group" aria-label={copy(l, "Stop this week", "Դադարեցնել այս շաբաթը", "Остановить эту неделю")} className="space-y-3 rounded-xl border border-border p-3">
      <p className="text-body2">{copy(l, "Stop the week? Your saved readings stay, and your care team can see them.", "Դադարեցնե՞լ շաբաթը։ Պահված չափումները մնում են, և ձեր խնամքի թիմը կարող է դրանք տեսնել։", "Остановить неделю? Сохранённые измерения останутся доступны вашей медицинской команде.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={busy} onClick={() => start(async () => {
          if(sending.current)return; sending.current=true;
          setError("");
          const r = await run(() => stopMyBpWeek(weekId));
          sending.current=false;
          if (r?.status === "stopped") { if(onSaved)onSaved(); else router.refresh(); } else setError(bpWeekMessage(l, r));
        })}>{copy(l, "Yes, stop the week", "Այո, դադարեցնել", "Да, остановить неделю")}</Button>
        <Button type="button" variant="secondary" className="h-auto min-h-11 whitespace-normal" disabled={busy} onClick={() => setConfirm(false)}>{copy(l, "Keep going", "Շարունակել", "Продолжить")}</Button>
      </div>
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </div>
  );
}

/** The slot's save for the shared measurement form: one reading into this week's slot. */
export function weekSave(l: PatientLocale, weekId: string, slot: "morning" | "evening"): MeasurementSave {
  return async input => {
    const r = await recordBpWeekReading({ weekId, slot, submissionId: input.submissionId, systolic: input.systolic, diastolic: input.diastolic, pulse: input.pulse ?? null, measuredAt: input.measuredAt });
    if (r.status === "saved" || r.status === "replayed") return { ok: true, bp: r.bp };
    if (r.status === "signed_out") return { ok: false, reason: "signed_out" };
    return { ok: false, reason: r.status === "conflict" ? "conflict" : undefined, message: r.status === "unavailable" ? undefined : bpWeekMessage(l, r) };
  };
}
