import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import type { AskReason } from "./ask-copy";
import type { DoctorConcern } from "./asks";

/** Staff wording for the reasons a member gave Zoe (item 5). The member's words, not a finding. */
export function reasonLabel(l: StaffLocale, r: AskReason): string {
  switch (r) {
    case "forgot": return st(l, "Forgot", "Մոռացել է", "Забыли");
    case "side_effect": return st(l, "Side effect", "Կողմնակի ազդեցություն", "Побочный эффект");
    case "cost_or_availability": return st(l, "Cost or could not get it", "Գինը կամ չի կարողացել ձեռք բերել", "Стоимость или не удалось получить");
    case "ran_out": return st(l, "Ran out", "Վերջացել է", "Закончилось");
    case "decided_to_stop": return st(l, "Decided to stop", "Որոշել է դադարեցնել", "Решили прекратить");
  }
}

const local = (iso: string) => new Date(Date.parse(iso) + 4 * 3600000).toISOString();

/** The summary, built from facts only: which dose, what the member said, and 14 days of their own ticks. */
export function concernSummary(c: DoctorConcern, l: StaffLocale): string {
  const t = (en: string, hy: string, ru: string) => st(l, en, hy, ru);
  const due = local(c.ask.dueAt), when = `${due.slice(8, 10)}.${due.slice(5, 7)} ${due.slice(11, 16)}`;
  const med = [c.ask.medicine.name, c.ask.medicine.dose].filter(Boolean).join(" ");
  const what = c.ask.trigger === "skipped" ? t(`Marked ${med} at ${when} as skipped.`, `${med}-ի ${when} ընդունումը նշել է որպես բաց թողնված։`, `Приём ${med} в ${when} отмечен как пропущенный.`) : t(`Did not tick ${med} at ${when}.`, `Չի նշել ${med}-ի ${when} ընդունումը։`, `Приём ${med} в ${when} не отмечен.`);
  const why = c.ask.reason ? t(`Told Zoe: ${reasonLabel(l, c.ask.reason).toLowerCase()}.`, `Զոիին ասել է՝ ${reasonLabel(l, c.ask.reason).toLowerCase()}։`, `Сообщили Zoe: ${reasonLabel(l, c.ask.reason).toLowerCase()}.`) : "";
  const ticks = t(`Last 14 days: ${c.ticks14.taken} taken, ${c.ticks14.skipped} skipped (the member's own ticks).`, `Վերջին 14 օրը՝ ${c.ticks14.taken} ընդունված, ${c.ticks14.skipped} բաց թողնված (անդամի սեփական նշումները)։`, `За последние 14 дней: ${c.ticks14.taken} принято, ${c.ticks14.skipped} пропущено (по отметкам участника).`);
  const ask = c.kind === "refill" ? t("Asks the care team about a refill.", "Խնդրում է խնամքի թիմին օգնել նոր դեղի հարցում։", "Просит медицинскую команду помочь с пополнением запаса лекарства.") : t("The member was told you will answer.", "Անդամին ասվել է, որ դուք կպատասխանեք։", "Участнику сообщили, что вы ответите.");
  return [what, why, ticks, ask].filter(Boolean).join(" ");
}

