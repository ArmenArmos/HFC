import { CareSection } from "@/components/patient-care/common";
import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import { adherence, type StaffMedicinesRead } from "@/lib/member-medicines/model";
import { reasonsByMedicine, type StaffReason } from "@/lib/member-medicines/asks";
import { reasonLabel } from "@/lib/member-medicines/staff-copy";

/** D2 for the assigned nurse and doctor: counts of the member's own ticks. Never a rating or advice. */
export function MedicinesAdherencePanel({ read, reasons = [], locale, now }: { read: Extract<StaffMedicinesRead, { enabled: true }>; reasons?: StaffReason[]; locale: StaffLocale; now: Date }) {
  const t = (en: string, hy: string, ru: string) => st(locale, en, hy, ru);
  const rows = [...read.plan, ...read.self];
  const why = reasonsByMedicine(reasons);
  const day = (iso: string) => new Date(Date.parse(iso) + 4 * 3600000).toISOString().slice(5, 16).replace("T", " ");
  return (
    <CareSection title={t(`Medicines and ticks, last ${read.days} days`, `Դեղեր և նշումներ, վերջին ${read.days} օրը`, `Лекарства и отметки за последние ${read.days} дней`)}
      detail={t("Ticks are the member's own report, not proof. No missed-dose rule or alert is applied; the rule is under clinical review.", "Նշումներն անդամի սեփական գրառումն են, ոչ թե ապացույց։ Բաց թողնված ընդունման կանոն կամ ահազանգ չի կիրառվում. կանոնը կլինիկական վերանայման փուլում է։", "Отметки сделаны участником и не служат доказательством. Правило или уведомление о пропущенной дозе не применяется.")}>
      {rows.length === 0 ? <p className="text-body2 text-muted-foreground">{t("No medicines recorded.", "Դեղեր գրանցված չեն։", "Лекарства не записаны.")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-left text-body2">
            <thead><tr className="border-b text-caption text-muted-foreground">
              <th scope="col" className="py-2 pr-3">{t("Medicine", "Դեղ", "Лекарство")}</th><th scope="col" className="py-2 pr-3">{t("Source", "Աղբյուր", "Источник")}</th>
              <th scope="col" className="py-2 pr-3">{t("Times", "Ժամեր", "Время")}</th><th scope="col" className="py-2 pr-3 text-right">{t("Taken", "Ընդունված", "Принято")}</th>
              <th scope="col" className="py-2 pr-3 text-right">{t("Skipped", "Բաց թողնված", "Пропущено")}</th><th scope="col" className="py-2 pr-3 text-right">{t("No report", "Չնշված", "Нет отметки")}</th><th scope="col" className="py-2">{t("Reasons given to Zoe", "Զոյային տրված պատճառներ", "Причины, сообщённые Зое")}</th>
            </tr></thead>
            <tbody className="divide-y">
              {rows.map(m => {
                const a = adherence(m, read.days, now);
                return (
                  <tr key={`${m.source}:${m.id}`}>
                    <th scope="row" className="py-2 pr-3 align-top font-normal"><span className="block break-words font-semibold">{m.name}</span>{"fromChat" in m && m.fromChat && <span className="block text-caption text-muted-foreground">{t("Said in chat, to check", "Ասել է զրույցում, ստուգել", "Сказано в чате, проверить")}</span>}{m.dose && <span className="block break-words text-caption text-muted-foreground">{m.dose}</span>}{"stoppedAt" in m && m.stoppedAt && <span className="block text-caption text-muted-foreground">{t("Stopped by the member", "Դադարեցրել է անդամը", "Участник прекратил приём")} {m.stoppedAt.slice(0, 10)}</span>}</th>
                    <td className="py-2 pr-3 align-top">{m.source === "plan" ? t("Care plan", "Խնամքի պլան", "План лечения") : t("Self-reported by the member", "Անդամի կողմից հաղորդված", "Со слов участника")}</td>
                    <td className="py-2 pr-3 align-top tabular-nums">{m.times.join(", ")}</td>
                    <td className="py-2 pr-3 text-right align-top tabular-nums">{a.taken} / {a.expected}</td>
                    <td className="py-2 pr-3 text-right align-top tabular-nums">{a.skipped}</td>
                    <td className="py-2 pr-3 text-right align-top tabular-nums">{a.noReport}</td>
                    <td className="py-2 align-top">{(why.get(`${m.source === "plan" ? "plan" : "self"}:${m.id}`) ?? []).length === 0 ? <span className="text-muted-foreground">-</span> : (
                      <ul className="space-y-1">{(why.get(`${m.source === "plan" ? "plan" : "self"}:${m.id}`) ?? []).map(r => <li key={r.dueAt} className="text-caption"><span className="font-semibold">{reasonLabel(locale, r.reason)}</span> <span className="text-muted-foreground tabular-nums">{day(r.dueAt)}</span></li>)}</ul>)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </CareSection>
  );
}
