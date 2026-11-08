import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import type { RiskTier, RiskTierRuleId } from "@/lib/clinical/rules/risk-tier";
import { reasonLabel } from "@/lib/care-queue/contracts";

/** Staff copy for the worklist card and the tier badge. Never shown to members. */
export const tierLabel = (t: RiskTier | null, l: StaffLocale) => t === null
  ? st(l, "Tier not computed yet", "Ռիսկի մակարդակը դեռ հաշվարկված չէ", "Уровень риска ещё не рассчитан")
  : ({
    very_high: st(l, "Very high priority", "Շատ բարձր առաջնահերթություն", "Очень высокий приоритет"),
    high: st(l, "High priority", "Բարձր առաջնահերթություն", "Высокий приоритет"),
    moderate: st(l, "Moderate priority", "Միջին առաջնահերթություն", "Средний приоритет"),
    low: st(l, "Low priority", "Ցածր առաջնահերթություն", "Низкий приоритет"),
  } as const)[t];

const RISK_REASON: Record<RiskTierRuleId, [string, string, string]> = {
  "risk.open_urgent": ["Open urgent or same-day work", "Բաց շտապ կամ նույն օրվա աշխատանք", "Открытая срочная работа или на сегодня"],
  "risk.red_flag": ["Red flag in the questionnaire", "Կարմիր դրոշ հարցաթերթիկում", "Красный флаг в анкете"],
  "risk.secondary_prevention": ["After a heart attack, stroke or stent", "Ինֆարկտից, ինսուլտից կամ ստենտից հետո", "После инфаркта, инсульта или стента"],
  "risk.history_unknown": ["Heart history not known yet", "Սրտի պատմությունը դեռ հայտնի չէ", "Сердечный анамнез пока неизвестен"],
  "risk.bp_alert_range": ["Home blood pressure in the alert range", "Տնային ճնշումը ահազանգի միջակայքում է", "Домашнее давление в зоне оповещения"],
  "risk.bp_above_target": ["Home blood pressure above target", "Տնային ճնշումը թիրախից բարձր է", "Домашнее давление выше цели"],
  "risk.bp_unknown": ["No home readings this week", "Այս շաբաթ տնային չափումներ չկան", "Нет домашних измерений на этой неделе"],
  "risk.ldl_above_goal": ["LDL above goal", "LDL-ն նպատակից բարձր է", "ЛПНП выше цели"],
  "risk.ldl_unknown": ["No LDL result for the goal", "Նպատակի համար LDL-ի արդյունք չկա", "Нет результата ЛПНП для цели"],
  "risk.adherence_low": ["Doses often missed", "Դեղաչափերը հաճախ բաց են թողնվում", "Дозы часто пропускаются"],
  "risk.contact_stale": ["No recent contact with the care team", "Վերջերս կապ չի եղել խնամքի թիմի հետ", "Давно не было связи с командой"],
};
/** A tier reason in plain words; an unknown code still reads as words. */
export function riskReasonLabel(reason: string, l: StaffLocale) {
  const row = RISK_REASON[reason as RiskTierRuleId];
  return row ? st(l, row[0], row[1], row[2]) : reason.replace(/^risk\./, "").replaceAll(/[_.]+/g, " ");
}
/** An open task's kind, through the care queue's own labels. */
export const taskKindLabel = (kind: string, l: StaffLocale) => reasonLabel(kind, l);

export const WORKLIST_COPY = {
  title: (l: StaffLocale) => st(l, "Your worklist", "Ձեր աշխատանքային ցուցակը", "Ваш рабочий список"),
  chip: (l: StaffLocale) => st(l, "Worklist", "Աշխատանքային ցուցակ", "Рабочий список"),
  empty: (l: StaffLocale) => st(l, "No members need you right now.", "Այս պահին ոչ մի անդամ ձեր կարիքը չունի։", "Сейчас никому из участников не нужна ваша помощь."),
  unavailable: (l: StaffLocale) => st(l, "The worklist could not be read. Try again.", "Չհաջողվեց կարդալ աշխատանքային ցուցակը։ Փորձեք կրկին։", "Не удалось загрузить рабочий список. Попробуйте ещё раз."),
  off: (l: StaffLocale) => st(l, "The worklist is not switched on yet.", "Աշխատանքային ցուցակը դեռ միացված չէ։", "Рабочий список ещё не включён."),
  open: (l: StaffLocale) => st(l, "Open member", "Բացել անդամին", "Открыть участника"),
  urgent: (n: number, l: StaffLocale) => st(l, `${n} urgent or same-day`, `${n} շտապ կամ նույն օրվա`, `Срочных или на сегодня: ${n}`),
  overdue: (n: number, l: StaffLocale) => st(l, `${n} overdue`, `${n} ժամկետանց`, `Просрочено: ${n}`),
  streak: (n: number, l: StaffLocale) => st(l, `${n} readings above target in a row`, `Անընդմեջ ${n} չափում թիրախից բարձր`, `${n} измерений подряд выше цели`),
  contact: (d: number | null, l: StaffLocale) => d === null
    ? st(l, "No contact recorded", "Կապ չի գրանցվել", "Связь не зарегистрирована")
    : st(l, `Last contact ${d} days ago`, `Վերջին կապը՝ ${d} օր առաջ`, `Последняя связь ${d} дн. назад`),
  unnamed: (l: StaffLocale) => st(l, "Member", "Անդամ", "Участник"),
  tryAgain: (l: StaffLocale) => st(l, "Try again", "Փորձել կրկին", "Попробовать ещё раз"),
} as const;
