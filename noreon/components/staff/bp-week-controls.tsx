"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import { staffStartBpWeek, staffStopBpWeek, type BpWeekResult } from "@/lib/bp-week/actions";

const text = (l: StaffLocale, r: BpWeekResult | undefined) => r?.status === "open-week" ? st(l, "This member already has an open week.", "Անդամն արդեն ունի բաց շաբաթ։", "У этого участника уже есть открытая неделя.")
  : r?.status === "invalid" ? st(l, "Check the date and times (morning 05:00 to 11:30, evening 17:00 to 22:30).", "Ստուգեք ամսաթիվը և ժամերը (առավոտ 05:00–11:30, երեկո 17:00–22:30)։", "Проверьте дату и время (утро с 05:00 до 11:30, вечер с 17:00 до 22:30).")
    : r?.status === "busy" ? st(l, "Busy. Try again in a moment.", "Զբաղված է։ Մի փոքր ուշ կրկին փորձեք։", "Система занята. Попробуйте снова чуть позже.") : st(l, "Not saved. Reload and try again.", "Չպահվեց։ Թարմացրեք և կրկին փորձեք։", "Не сохранено. Обновите страницу и попробуйте снова.");

export function StaffStartWeek({ memberId, locale: l, today, device }: { memberId: string; locale: StaffLocale; today: string; device: string | null }) {
  const router = useRouter();
  const [startsOn, setStartsOn] = useState(today), [morning, setMorning] = useState("08:00"), [evening, setEvening] = useState("20:00");
  const [busy, start] = useTransition(), [error, setError] = useState("");
  return (
    <form className="space-y-3 border-t pt-4" onSubmit={e => { e.preventDefault(); start(async () => { setError(""); const r = await staffStartBpWeek(memberId, { startsOn, morning, evening }).catch(() => undefined); if (r?.status === "started") router.refresh(); else setError(text(l, r)); }); }}>
      <p className="text-body2 font-semibold">{st(l, "Start a 7-day week for this member", "Սկսել 7-օրյա շաբաթ այս անդամի համար", "Начать 7-дневную неделю для этого участника")}</p>
      <p className="text-caption text-muted-foreground">{device ? st(l, `The monitor handed over (${device}) is linked to the week.`, `Հանձնված սարքը (${device}) կկապվի շաբաթին։`, `Переданный тонометр (${device}) связан с этой неделей.`) : st(l, "No monitor is handed over; the member uses their own.", "Սարք հանձնված չէ, անդամն օգտագործում է իր սարքը։", "Тонометр не передан; участник использует свой.")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="sw-start">{st(l, "First day", "Առաջին օր", "Первый день")}</Label><Input id="sw-start" type="date" min={today} value={startsOn} onValueChange={setStartsOn} disabled={busy} required /></div>
        <div className="space-y-1"><Label htmlFor="sw-morning">{st(l, "Morning", "Առավոտ", "Утро")}</Label><Input id="sw-morning" type="time" value={morning} onValueChange={setMorning} disabled={busy} required /></div>
        <div className="space-y-1"><Label htmlFor="sw-evening">{st(l, "Evening", "Երեկո", "Вечер")}</Label><Input id="sw-evening" type="time" value={evening} onValueChange={setEvening} disabled={busy} required /></div>
      </div>
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
      <Button type="submit" className="min-h-11" disabled={busy}>{st(l, "Start the week", "Սկսել շաբաթը", "Начать неделю")}</Button>
    </form>
  );
}

export function StaffStopWeek({ memberId, weekId, locale: l }: { memberId: string; weekId: string; locale: StaffLocale }) {
  const router = useRouter();
  const [reason, setReason] = useState(""), [open, setOpen] = useState(false), [busy, start] = useTransition(), [error, setError] = useState("");
  if (!open) return <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)}>{st(l, "Stop this week", "Դադարեցնել շաբաթը", "Остановить эту неделю")}</Button>;
  return (
    <div className="space-y-2">
      <Label htmlFor="sw-reason">{st(l, "Reason (optional)", "Պատճառ (ոչ պարտադիր)", "Причина (необязательно)")}</Label>
      <Input id="sw-reason" maxLength={300} value={reason} onValueChange={setReason} disabled={busy} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => start(async () => { setError(""); const r = await staffStopBpWeek(memberId, weekId, reason).catch(() => undefined); if (r?.status === "stopped") router.refresh(); else setError(text(l, r)); })}>{st(l, "Stop the week", "Դադարեցնել", "Остановить неделю")}</Button>
        <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setOpen(false)}>{st(l, "Cancel", "Չեղարկել", "Отмена")}</Button>
      </div>
      {error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </div>
  );
}
