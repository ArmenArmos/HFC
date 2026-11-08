import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bell, Pill } from "lucide-react";
import { PatientShell } from "@/components/patient/patient-shell";
import { requireRegistered } from "@/lib/patient/repository";
import { CareLink, CareSection, IconTile, RowLink, Status, copy } from "@/components/patient-care/common";
import { DoseButtons } from "@/components/patient-care/controls";
import { getCareData } from "@/lib/patient-care/repository";
import { dosesForDay } from "@/lib/patient-care/model";
import { readMemberMedicineAsks, readMemberMedicines } from "@/lib/member-medicines/server";
import { todaysDoses } from "@/lib/member-medicines/model";
import { AddMedicineForm, EditMedicineForm, OwnDoseButtons, StopMedicineButton } from "@/components/member-medicines/controls";
import { MedicineAskCard } from "@/components/member-medicines/ask-card";
import type { MedicineAsk } from "@/lib/member-medicines/asks";

export const dynamic = "force-dynamic";

/** D2, medicines and daily ticks (dark: member_medicine_settings.enabled). No dosing advice anywhere. */
export default async function MedicinesPage() {
  const { profile } = await requireRegistered();
  const read = await readMemberMedicines();
  if (!read.enabled) notFound();
  const l = profile.locale, now = new Date();
  const [care, asks] = await Promise.all([getCareData().catch(() => null), readMemberMedicineAsks()]);
  const planDoses = care ? dosesForDay(care, now) : [];
  const planMeds = care?.plan ? care.plan.medications.filter(m => m.active && m.planId === care.plan!.id) : [];
  const own = read.medicines.filter(m => !m.stoppedAt).map(m => {
    const doses = todaysDoses(m, now, read.medicines);
    return { medicine: m, doses, later: m.times.filter(t => !doses.some(d => d.time === t)) };
  });
  const doseKey = (source: MedicineAsk["source"], medicineId: string, dueAt: string) => `${source}:${medicineId}:${Date.parse(dueAt)}`;
  const openAsks = asks.enabled ? asks.asks.filter(a => a.state === "open") : [];
  const asksByDose = new Map<string, MedicineAsk[]>();
  for (const ask of openAsks) {
    const key = doseKey(ask.source, ask.medicineId, ask.dueAt);
    asksByDose.set(key, [...(asksByDose.get(key) ?? []), ask]);
  }
  const renderedDoseKeys = new Set([
    ...planDoses.map(d => doseKey("plan", d.medication.id, d.dueAt)),
    ...own.flatMap(({ doses }) => doses.map(d => doseKey("self", d.medicineId, d.dueAt))),
  ]);
  return (
    <PatientShell locale={l}>
      <div className="space-y-5">
        <header className="flex items-start gap-3">
          <IconTile icon={Pill} />
          <div>
            <h1 className="text-h1">{copy(l, "Your medicines", "Ձեր դեղերը", "Ваши лекарства")}</h1>
            <p className="mt-1 text-body2 text-muted-foreground">{copy(l, "Tick each dose when you take it. Ticks are your own report, not proof. No blame: life gets busy.", "Նշեք յուրաքանչյուր ընդունում, երբ ընդունում եք։ Նշումները ձեր սեփական գրառումն են, ոչ թե ապացույց։ Ոչինչ, կյանքը զբաղված է։", "Отмечайте каждый приём лекарства после того, как приняли его. Отметки отражают ваши записи и не подтверждают приём. Без упрёков: в жизни бывает много дел.")}</p>
          </div>
        </header>

        {openAsks.filter(a => !renderedDoseKeys.has(doseKey(a.source, a.medicineId, a.dueAt))).map(a => <MedicineAskCard key={a.id} ask={a} locale={l} now={now.toISOString()} />)}

        <CareSection title={copy(l, "From your doctor’s plan", "Ձեր բժշկի պլանից", "Из плана вашего врача")}>
          {planMeds.length === 0
            ? <p className="text-body2 text-muted-foreground">{copy(l, "There are no medicines in your care plan.", "Ձեր խնամքի պլանում դեղեր չկան։", "В вашем плане лечения нет лекарств.")}</p>
            : <ul className="space-y-4">
              {planMeds.map(m => (
                <li key={m.id} className="space-y-3 rounded-xl border border-border/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="break-words text-body1 font-semibold">{m.name}</p><p className="break-words text-body2 text-muted-foreground">{m.dose}</p></div>
                    <Status tone="complete">{copy(l, "In your plan", "Ձեր պլանում", "В вашем плане")}</Status>
                  </div>
                  {m.instructions && <p className="break-words text-body2">{m.instructions}</p>}
                  <ul className="space-y-3">
                    {planDoses.filter(d => d.medication.id === m.id).map(d => {
                      const doseAsks = asksByDose.get(doseKey("plan", m.id, d.dueAt)) ?? [];
                      return (
                        <li key={d.dueAt} className="space-y-2">
                          <p className="text-body2 font-semibold">{copy(l, "Today", "Այսօր", "Сегодня")} · {d.dueAt && new Date(Date.parse(d.dueAt) + 4 * 3600000).toISOString().slice(11, 16)}</p>
                          <DoseButtons dose={d} locale={l} compact />
                          {doseAsks.map(a => <MedicineAskCard key={a.id} ask={a} locale={l} now={now.toISOString()} />)}
                          {d.status === "skipped" && doseAsks.length === 0 && <p className="text-body2 text-muted-foreground"><Link href="/patient/zoe" className="underline underline-offset-4">{copy(l, "Marked as skipped. If you have a question about this medicine, write to your doctor.", "Նշված է որպես բաց թողնված։ Եթե այս դեղի վերաբերյալ հարց ունեք, գրեք ձեր բժշկին։", "Отмечено как пропущенное. Если у вас есть вопрос об этом лекарстве, напишите вашему врачу.")}</Link></p>}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>}
        </CareSection>

        <CareSection title={copy(l, "Your own list", "Ձեր սեփական ցանկը", "Ваш собственный список")} detail={copy(l, "Medicines you take that are not in your plan, for example from another doctor. Marked as self-reported for your care team.", "Դեղեր, որոնք ընդունում եք, բայց ձեր պլանում չեն, օրինակ՝ այլ բժշկից։ Ձեր խնամքի թիմի համար նշված են որպես ձեր կողմից հաղորդված։", "Лекарства, которые вы принимаете и которых нет в вашем плане, например назначенные другим врачом. Для вашей медицинской команды они отмечены как сведения, сообщённые вами.")}>
          {own.length > 0 && (
            <ul className="space-y-4">
              {own.map(({ medicine: m, doses, later }) => (
                <li key={m.id} className="space-y-3 rounded-xl border border-border/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0"><p className="break-words text-body1 font-semibold">{m.name}</p>{m.dose && <p className="break-words text-body2 text-muted-foreground">{m.dose}</p>}<p className="text-caption text-muted-foreground">{m.times.join(" · ")}</p></div>
                    <Status>{copy(l, "Self-reported", "Ձեր կողմից", "С ваших слов")}</Status>
                  </div>
                  <ul className="space-y-3">
                    {doses.map(d => {
                      const doseAsks = asksByDose.get(doseKey("self", d.medicineId, d.dueAt)) ?? [];
                      return (
                        <li key={d.dueAt} className="space-y-2">
                          <p className="text-body2 font-semibold">{copy(l, "Today", "Այսօր", "Сегодня")} · {d.time}</p>
                          <OwnDoseButtons dose={d} locale={l} />
                          {doseAsks.map(a => <MedicineAskCard key={a.id} ask={a} locale={l} now={now.toISOString()} />)}
                          {d.status === "skipped" && doseAsks.length === 0 && <p className="text-body2 text-muted-foreground"><Link href="/patient/zoe" className="underline underline-offset-4">{copy(l, "Marked as skipped. If you have a question about this medicine, write to your doctor.", "Նշված է որպես բաց թողնված։ Եթե այս դեղի վերաբերյալ հարց ունեք, գրեք ձեր բժշկին։", "Отмечено как пропущенное. Если у вас есть вопрос об этом лекарстве, напишите вашему врачу.")}</Link></p>}
                        </li>
                      );
                    })}
                  </ul>
                  {/* QA 118: a time added by a change today after that time has passed starts tomorrow, never in the past. */}
                  {later.length > 0 && <p className="text-caption text-muted-foreground">{copy(l, `Starts tomorrow: ${later.join(" · ")}`, `Կսկսվի վաղը՝ ${later.join(" · ")}`, `Начнётся завтра: ${later.join(" · ")}`)}</p>}
                  <div className="flex flex-wrap gap-2"><EditMedicineForm medicine={m} locale={l} /><StopMedicineButton id={m.id} locale={l} /></div>
                </li>
              ))}
            </ul>
          )}
          <AddMedicineForm locale={l} />
        </CareSection>

        <section className="rounded-2xl border border-border/70 bg-card p-2">
          <RowLink href="/patient/account/reminders" icon={Bell} detail={copy(l, "Medicine reminders in Telegram follow these settings and your quiet hours.", "Telegram-ի դեղերի հիշեցումները հետևում են այս կարգավորումներին և ձեր հանգստի ժամերին։", "Напоминания о лекарствах в Telegram учитывают эти настройки и ваши часы тишины.")}>
            {copy(l, "Reminder times and quiet hours", "Հիշեցումների ժամեր և հանգստի ժամեր", "Время напоминаний и часы тишины")}
          </RowLink>
        </section>
        <p className="rounded-xl bg-muted p-4 text-body2">{copy(l, "Noreon never changes your medicines or doses. If you have a question about a medicine, ask your doctor, nurse or pharmacist.", "Նորեոն Հելթը երբեք չի փոխում ձեր դեղերը կամ դեղաչափերը։ Դեղի վերաբերյալ հարցի դեպքում դիմեք ձեր բժշկին, բուժքրոջը կամ դեղագործին։", "Нореон Хелс никогда не меняет ваши лекарства или дозы. Если у вас есть вопрос о лекарстве, обратитесь к вашему врачу, медсестре или фармацевту.")}</p>
        <CareLink href="/patient/care" icon={ArrowLeft}>{copy(l, "Back to my care plan", "Վերադառնալ խնամքի պլանին", "Вернуться к моему плану лечения")}</CareLink>
      </div>
    </PatientShell>
  );
}
