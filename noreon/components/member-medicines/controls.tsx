"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { copy } from "@/components/patient-care/common";
import { SignInEnded } from "@/components/patient/sign-in-ended";
import type { PatientLocale } from "@/lib/patient/copy";
import { addMyMedicine, stopMyMedicine, tickMyMedicine, updateMyMedicine, type MedicineResult } from "@/lib/member-medicines/actions";
import type { DoseSlot, SelfMedicine } from "@/lib/member-medicines/model";

/** Real members only (off in the demo), so no demo save lock is needed; a thrown request reads as "not saved". */
const run = async <T,>(op: () => Promise<T>): Promise<T | null> => { try { return await op(); } catch { return null; } };

/** The error for an ended sign-in: it offers sign-in, so it is more than a sentence. */
const SIGNED_OUT = "signed_out";

function message(l: PatientLocale, r: MedicineResult | null | undefined) {
  // No answer at all: the reply was lost, so it may have been saved (BC-12). Never "couldn't save".
  if (r === null) return copy(l, "We couldn’t confirm your save. Check your list or try again.", "Չհաջողվեց հաստատել պահպանումը։ Ստուգեք ցանկը կամ կրկին փորձեք։", "Не удалось подтвердить сохранение. Проверьте список или попробуйте снова.");
  switch (r?.status) {
    case "signed_out": return SIGNED_OUT;
    case "conflict": return copy(l, "This changed in another window. Reload and try again.", "Սա փոխվել է մեկ այլ պատուհանում։ Թարմացրեք էջը և կրկին փորձեք։", "Данные изменились в другом окне. Обновите страницу и попробуйте ещё раз.");
    case "not-due": return copy(l, "This dose cannot be ticked now.", "Այս ընդունումը հիմա չի կարելի նշել։", "Сейчас нельзя отметить этот приём.");
    case "limit": return copy(l, "Your list is full (20 medicines). Stop one you no longer take first.", "Ձեր ցանկը լիքն է (20 դեղ)։ Նախ դադարեցրեք մեկը, որն այլևս չեք ընդունում։", "В вашем списке уже 20 лекарств. Сначала уберите из списка то, которое больше не принимаете.");
    case "invalid": return copy(l, "Check the name and the times.", "Ստուգեք անվանումը և ժամերը։", "Проверьте название и время приёма.");
    case "disabled": return copy(l, "Medicines are not available right now.", "Դեղերն այս պահին հասանելի չեն։", "Лекарства сейчас недоступны.");
    default: return copy(l, "We couldn’t save. Try again.", "Չհաջողվեց պահել։ Կրկին փորձեք։", "Не удалось сохранить. Попробуйте ещё раз.");
  }
}

/** Taken / skipped for one dose of a self-reported medicine. The member's own report, changeable. */
export function OwnDoseButtons({ dose, locale: l }: { dose: DoseSlot; locale: PatientLocale }) {
  const router = useRouter();
  // The error belongs to the record it was about: a re-read that shows the dose saved or changed clears it.
  const [busy, start] = useTransition(), [failure, setFailure] = useState<{ text: string; revision: number; status: string } | null>(null);
  const error = failure && failure.revision === dose.revision && failure.status === dose.status ? failure.text : "";
  if (dose.status === "upcoming") return <p className="text-caption text-muted-foreground">{copy(l, "You can tick it from an hour before.", "Կարող եք նշել ժամից մեկ ժամ առաջ։", "Можно отметить за час до времени приёма.")}</p>;
  const send = (status: "taken" | "skipped") => start(async () => {
    setFailure(null);
    const r = await run(() => tickMyMedicine({ medicineId: dose.medicineId, dueAt: dose.dueAt, status, revision: dose.revision }));
    if (r?.status !== "saved") setFailure({ text: message(l, r), revision: dose.revision, status: dose.status });
    // A lost reply or a conflict means this page may be behind the record: what is on screen comes from a fresh read.
    if (r?.status === "saved" || r === null || r.status === "conflict") router.refresh();
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="h-auto min-h-11 whitespace-normal" variant={dose.status === "taken" ? "secondary" : "default"} disabled={busy || dose.status === "taken"} aria-pressed={dose.status === "taken"} onClick={() => send("taken")}>
          <Check className="size-4" aria-hidden />{dose.status === "taken" ? copy(l, "Taken", "Ընդունված է", "Принято") : copy(l, "I took it", "Ընդունեցի", "Отметить приём")}
        </Button>
        <Button type="button" className="h-auto min-h-11 whitespace-normal" variant="outline" disabled={busy || dose.status === "skipped"} aria-pressed={dose.status === "skipped"} onClick={() => send("skipped")}>
          <X className="size-4" aria-hidden />{dose.status === "skipped" ? copy(l, "Skipped", "Բաց է թողնված", "Пропущено") : copy(l, "I skipped it", "Բաց թողեցի", "Отметить пропуск")}
        </Button>
      </div>
      {error === SIGNED_OUT ? <SignInEnded locale={l} /> : error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </div>
  );
}

export function AddMedicineForm({ locale: l, action = addMyMedicine }: { locale: PatientLocale; action?: typeof addMyMedicine }) {
  const fieldId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false), [name, setName] = useState(""), [dose, setDose] = useState(""), [times, setTimes] = useState<string[]>(["08:00"]);
  const [busy, start] = useTransition(), [error, setError] = useState("");
  // One request id per set of values: a retry after a lost reply replays it (BC-04); an edited form is a new add.
  const attempt = useRef<{ values: string; id: string } | null>(null);
  const requestFor = (values: string) => {
    if (attempt.current?.values !== values) attempt.current = { values, id: crypto.randomUUID() };
    return attempt.current.id;
  };
  if (!open) return <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" onClick={() => setOpen(true)}><Plus className="size-4" aria-hidden />{copy(l, "Add a medicine I take", "Ավելացնել դեղ, որն ընդունում եմ", "Добавить лекарство, которое я принимаю")}</Button>;
  return (
    <form noValidate className="space-y-4 rounded-xl border border-border p-4" onSubmit={e => {
      e.preventDefault();
      if (!name.trim()) { setError(copy(l,"Enter the medicine name as it appears on the box.","Մուտքագրեք դեղի անվանումը՝ ինչպես տուփի վրա։","Введите название лекарства, как на упаковке.")); document.getElementById(`${fieldId}-name`)?.focus(); return; }
      start(async () => {
        setError("");
        const requestId = requestFor(JSON.stringify([name, dose, times]));
        const r = await run(() => action({ requestId, name, dose, times }));
        if (r?.status === "added") { attempt.current = null; setOpen(false); setName(""); setDose(""); setTimes(["08:00"]); router.refresh(); }
        else { setError(message(l, r)); if (r === null) router.refresh(); }
      });
    }}>
      <div className="space-y-2"><Label htmlFor={`${fieldId}-name`}>{copy(l, "Name, as on the box", "Անվանումը, ինչպես տուփի վրա", "Название, как на упаковке")}</Label>
        <Input id={`${fieldId}-name`} className="h-12 bg-background" maxLength={120} placeholder={copy(l,"Copy the name from the box","Արտագրեք անվանումը տուփից","Перепишите название с упаковки")} aria-invalid={!!error && !name.trim()} value={name} onValueChange={setName} required disabled={busy} autoComplete="off" /></div>
      <div className="space-y-2"><Label htmlFor={`${fieldId}-dose`}>{copy(l, "Dose, if you know it (optional)", "Դեղաչափը, եթե գիտեք (ոչ պարտադիր)", "Доза, если знаете (необязательно)")}</Label>
        <Input id={`${fieldId}-dose`} className="h-12 bg-background" maxLength={120} value={dose} onValueChange={setDose} disabled={busy} autoComplete="off" placeholder={copy(l, "For example: 1 tablet", "Օրինակ՝ 1 հաբ", "Например: 1 таблетка")} /></div>
      <TimesField locale={l} times={times} setTimes={setTimes} busy={busy} />
      <p className="text-caption text-muted-foreground">{copy(l, "This list is your own report. It does not change your plan, and Noreon never changes your medicines. Telegram reminders are not sent during your quiet hours.", "Այս ցանկը ձեր սեփական գրառումն է։ Այն չի փոխում ձեր պլանը, և Noreon-ը երբեք չի փոխում ձեր դեղերը։ Telegram հիշեցումները չեն ուղարկվում ձեր հանգստի ժամերին։", "Этот список вы заполняете сами. Он не меняет ваш план, и Noreon никогда не меняет ваши лекарства. В тихие часы напоминания в Telegram не отправляются.")}</p>
      {error === SIGNED_OUT ? <SignInEnded locale={l} /> : error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-body2 text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-auto min-h-11 whitespace-normal" disabled={busy}>{busy ? copy(l, "Saving…", "Պահվում է…", "Сохраняется…") : copy(l, "Save to my list", "Պահել իմ ցանկում", "Сохранить в моём списке")}</Button>
        <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setOpen(false)}>{copy(l, "Cancel", "Չեղարկել", "Отменить")}</Button>
      </div>
    </form>
  );
}

/** "When you take it": one to six times, each a time input, shared by adding and editing. */
function TimesField({ locale: l, times, setTimes, busy }: { locale: PatientLocale; times: string[]; setTimes: (f: (ts: string[]) => string[]) => void; busy: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-body2 font-semibold">{copy(l, "When you take it", "Երբ եք ընդունում", "Когда вы принимаете лекарство")}</legend>
      {times.map((t, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input type="time" aria-label={copy(l, `Time ${i + 1}`, `Ժամ ${i + 1}`, `Время ${i + 1}`)} className="h-12 w-40 bg-background" value={t} required disabled={busy}
            onValueChange={v => setTimes(ts => ts.map((x, j) => (j === i ? v : x)))} />
          {times.length > 1 && <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setTimes(ts => ts.filter((_, j) => j !== i))}>{copy(l, "Remove", "Հեռացնել", "Удалить")}</Button>}
        </div>
      ))}
      {times.length < 6 && <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setTimes(ts => [...ts, "20:00"])}><Plus className="size-4" aria-hidden />{copy(l, "Add another time", "Ավելացնել ևս մեկ ժամ", "Добавить ещё время")}</Button>}
    </fieldset>
  );
}

/** Change the dose and times of a medicine on the member's own list (Gohar QA 99). The doctor's plan medicines have no edit. */
export function EditMedicineForm({ medicine: m, locale: l, action = updateMyMedicine, timesOnly = false }: { medicine: SelfMedicine; locale: PatientLocale; action?: typeof updateMyMedicine; timesOnly?: boolean }) {
  const fieldId = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false), [dose, setDose] = useState(m.dose ?? ""), [times, setTimes] = useState<string[]>(m.times);
  const [busy, start] = useTransition(), [error, setError] = useState("");
  const doseId = `${fieldId}-dose`;
  if (!open) return <Button type="button" variant="ghost" className="h-auto min-h-11 whitespace-normal" onClick={() => { setDose(m.dose ?? ""); setTimes(m.times); setError(""); setOpen(true); }} data-medicine-edit><Pencil className="size-4" aria-hidden />{timesOnly ? copy(l, "Change my times", "Փոխել իմ ժամերը", "Изменить время приёма") : copy(l, "Change dose or times", "Փոխել դեղաչափը կամ ժամերը", "Изменить дозу или время")}</Button>;
  return (
    <form className="w-full space-y-4 rounded-xl border border-border p-4" onSubmit={e => {
      e.preventDefault();
      start(async () => {
        setError("");
        const r = await run(() => action({ id: m.id, dose, times }));
        if (r?.status === "saved") { setOpen(false); router.refresh(); } else { setError(message(l, r)); if (r === null) router.refresh(); }
      });
    }}>
      {!timesOnly && <div className="space-y-2"><Label htmlFor={doseId}>{copy(l, "Dose, if you know it (optional)", "Դեղաչափը, եթե գիտեք (ոչ պարտադիր)", "Доза, если знаете (необязательно)")}</Label>
        <Input id={doseId} className="h-12 bg-background" maxLength={120} value={dose} onValueChange={setDose} disabled={busy} autoComplete="off" placeholder={copy(l, "For example: 1 tablet", "Օրինակ՝ 1 հաբ", "Например: 1 таблетка")} /></div>}
      <TimesField locale={l} times={times} setTimes={setTimes} busy={busy} />
      <p className="text-caption text-muted-foreground">{copy(l, "This changes only your own list and its reminders. New times apply from now; your previous dose records stay saved.", "Սա փոխում է միայն ձեր սեփական ցանկը և դրա հիշեցումները։ Նոր ժամերը գործում են այս պահից, արդեն արված նշումները մնում են։", "Это меняет только ваш собственный список и напоминания по нему. Новое время действует с этого момента, предыдущие записи о приёме сохранятся.")}</p>
      {error === SIGNED_OUT ? <SignInEnded locale={l} /> : error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-body2 text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="h-auto min-h-11 whitespace-normal" disabled={busy}>{busy ? copy(l, "Saving…", "Պահվում է…", "Сохраняется…") : copy(l, "Save changes", "Պահել փոփոխությունները", "Сохранить изменения")}</Button>
        <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => setOpen(false)}>{copy(l, "Cancel", "Չեղարկել", "Отменить")}</Button>
      </div>
    </form>
  );
}

export function StopMedicineButton({ id, locale: l, action = stopMyMedicine }: { id: string; locale: PatientLocale; action?: typeof stopMyMedicine }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false), [busy, start] = useTransition(), [error, setError] = useState("");
  if (!confirm) return <Button type="button" variant="ghost" className="h-auto min-h-11 whitespace-normal" onClick={() => setConfirm(true)}>{copy(l, "I no longer take this", "Այլևս չեմ ընդունում", "Больше не принимаю")}</Button>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" className="h-auto min-h-11 whitespace-normal" disabled={busy} onClick={() => start(async () => {
        setError("");
        const r = await run(() => action(id));
        if (r?.status === "stopped") router.refresh(); else { setError(message(l, r)); if (r === null) router.refresh(); }
      })}>{copy(l, "Yes, take it off my list", "Այո, հանել ցանկից", "Да, убрать из моего списка")}</Button>
      <Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={() => setConfirm(false)}>{copy(l, "Keep it", "Թողնել", "Оставить")}</Button>
      {error === SIGNED_OUT ? <SignInEnded locale={l} /> : error && <p role="alert" className="text-caption text-destructive">{error}</p>}
    </div>
  );
}
