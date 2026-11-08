import { THRESHOLD as WEEKLY_THRESHOLD } from "./thresholds";
import { BP_REPEAT, type BpNumbers, type BpStep } from "./bp-check";

/**
 * Every member and staff sentence of the one BP check, in one place. STAGING DRAFT: the rest-and-repeat wording needs Armen and
 * Yesayi's approval (2.4 of the open questions), and the Armenian and Russian need Tatevik's check. The 48-hour window is Armen's
 * (message 588): change it here and the questionnaire, Zoe, the form, the cards and Telegram all follow.
 */
export type BpLang = "en" | "hy" | "ru";
export const BP_SOON = { en: "within 48 hours", hy: "48 ժամվա ընթացքում", ru: "в течение 48 часов" } as const;
const SYMPTOMS = { en: "a headache, vision change, chest pain or weakness", hy: "գլխացավ, տեսողության փոփոխություն, կրծքավանդակի ցավ կամ թուլություն", ru: "головная боль, изменение зрения, боль в груди или слабость" } as const;
const n = (r: BpNumbers) => `${r.systolic}/${r.diastolic}`;

/** where: chat asks for the numbers in the conversation, save asks for a second saved reading. */
export function bpRemeasureLine(l: BpLang, r: BpNumbers, where: "chat" | "save" = "chat") {
  if (l === "hy") return `${n(r)}-ը շատ բարձր է։ Նստեք հանգիստ, ${BP_REPEAT.restMinutes} րոպե հանգստացեք, հետո նորից չափեք և ${where === "chat" ? "գրեք ինձ նոր թվերը" : "պահեք նոր չափումը"}։ Եթե հիմա ունեք ${SYMPTOMS.hy}, զանգահարեք 103։`;
  if (l === "ru") return `Давление ${n(r)} очень высокое. Сядьте и спокойно отдохните ${BP_REPEAT.restMinutes} минут, затем измерьте снова и ${where === "chat" ? "напишите мне новые цифры" : "сохраните новое измерение"}. Если сейчас есть ${SYMPTOMS.ru}, позвоните 103.`;
  return `${n(r)} is very high. Sit quietly and rest for ${BP_REPEAT.restMinutes} minutes, then measure again and ${where === "chat" ? "send me the new numbers" : "save the new reading"}. If you have ${SYMPTOMS.en} right now, call 103.`;
}
/**
 * A repeat in the band below doctor today. sent: chat, where the doctor really has it through the automatic forward, and where the
 * re-measure line already named the 103 symptoms, so they are not said twice. A saved route says them here.
 */
export function bpSoonLine(l: BpLang, sent: boolean) {
  if (l === "hy") return `Կրկնակի չափումը դեռ շատ բարձր է։ Բժիշկը պետք է տեսնի ձեզ ${BP_SOON.hy}։${sent ? " Սա փոխանցեցի ձեր բժշկին։" : ` Եթե սկսվի ${SYMPTOMS.hy}, զանգահարեք 103։`}`;
  if (l === "ru") return `Повторное измерение всё ещё очень высокое. Врач должен осмотреть вас ${BP_SOON.ru}.${sent ? " Я передала это вашему врачу." : ` Если появится ${SYMPTOMS.ru}, позвоните 103.`}`;
  return `Your repeat reading is still very high. A doctor needs to see you ${BP_SOON.en}.${sent ? " I've passed this to your doctor." : ` If you get ${SYMPTOMS.en}, call 103.`}`;
}
/** A repeat at doctor today. sent as above. */
export function bpTodayLine(l: BpLang, sent = false) {
  if (l === "hy") return `Կրկնակի չափումը դեռ շատ բարձր է։ Սա պահանջում է բժշկի գնահատում այսօր. ձեր բժիշկը, իսկ աշխատանքային ժամերից հետո՝ անհետաձգելի բուժօգնություն կամ պոլիկլինիկայի հերթապահ բժիշկը։${sent ? " Սա փոխանցեցի ձեր բժշկին։" : ` Եթե սկսվի ${SYMPTOMS.hy}, զանգահարեք 103։`}`;
  if (l === "ru") return `Повторное измерение всё ещё очень высокое. Это нужно показать врачу сегодня: вашему врачу, а в нерабочее время в неотложную помощь или дежурному врачу поликлиники.${sent ? " Я передала это вашему врачу." : ` Если появится ${SYMPTOMS.ru}, позвоните 103.`}`;
  return `Your repeat reading is still very high. This needs a doctor today: your doctor, or after hours urgent care or the polyclinic duty doctor.${sent ? " I've passed this to your doctor." : ` If you get ${SYMPTOMS.en}, call 103.`}`;
}
/** When the doctor's note or alert is not on record yet: no claim that it is done (lead, 4 Nov: Zoe may only say "passed" once the row exists). STAGING wording. */
export function bpCareTeamLine(l: BpLang) {
  if (l === "hy") return "Ես կհամոզվեմ, որ ձեր խնամքի թիմը սա կտեսնի։";
  if (l === "ru") return "Я прослежу, чтобы ваша команда по уходу это увидела.";
  return "I'll make sure your care team sees this.";
}
/** While a repeat is awaited and a reply could not go out: the step stands, never the careful line. */
export function bpWaitingLine(l: BpLang) {
  if (l === "hy") return "Գրեք ինձ նոր թվերը, երբ չափեք։ Ձեր հաղորդագրությունը փոխանցեցի բժշկին։";
  if (l === "ru") return "Напишите мне новые цифры, когда измерите. Ваше сообщение я передала врачу.";
  return "Send me the new numbers when you have them. I've passed your message to your doctor.";
}
/** The questionnaire's RF-06 next step: the same window as Zoe's. */
export const BP_QUESTIONNAIRE_NEXT = {
  hy: `Բժիշկ ${BP_SOON.hy}, պարտադիր, իսկ վերին ճնշումը 180 կամ ստորինը 120 և ավելի լինելու դեպքում՝ նույն օրը։ Չափումը պետք է հաստատվի։`,
  en: `A clinician ${BP_SOON.en}, without exception, or the same day if the upper number is 180 or more or the lower is 120 or more. The reading has to be confirmed.`,
  ru: `Обязательно обратитесь к врачу ${BP_SOON.ru}, а если верхнее давление 180 или выше либо нижнее 120 или выше, в тот же день. Измерение необходимо подтвердить.`,
};
/** The nurse checklist row severe-bp-contact and NurseUrgentGuidance, the same words (20261103100100_bp_one_rule.sql). */
export const BP_NURSE_GUIDANCE = {
  en: "If systolic is 180 or higher, or diastolic 110 or higher: have the member rest 5 minutes and measure again. With symptoms, call 103 now. Without symptoms, if the repeat is systolic 180 or higher, or diastolic 120 or higher, contact the assigned doctor today; otherwise the doctor within 48 hours.",
  hy: "Եթե սիստոլիկը 180 կամ ավելի է, կամ դիաստոլիկը՝ 110 կամ ավելի. թող անդամը 5 րոպե հանգստանա և նորից չափեք։ Ախտանիշների դեպքում անմիջապես զանգահարեք 103։ Առանց ախտանիշների, եթե կրկնակի չափմամբ սիստոլիկը 180 կամ ավելի է, կամ դիաստոլիկը՝ 120 կամ ավելի, այսօր կապվեք նշանակված բժշկի հետ, հակառակ դեպքում՝ բժիշկ 48 ժամվա ընթացքում։",
  ru: "Если верхнее давление 180 или выше, либо нижнее 110 или выше: пусть участник отдохнёт 5 минут и измерит ещё раз. При симптомах немедленно звоните 103. Без симптомов, если при повторном измерении верхнее давление 180 или выше, либо нижнее 120 или выше, свяжитесь с назначенным врачом сегодня, иначе с врачом в течение 48 часов.",
};
/** The warning on the nurse and doctor entry screens. */
export const BP_STAFF_WARNING = {
  en: `Very high reading. Have the member rest for ${BP_REPEAT.restMinutes} minutes, then measure again. Ask about headache, vision change, chest pain and weakness: with any of these, call 103 now. This reading also goes to the doctor.`,
  hy: `Շատ բարձր չափում։ Թող անդամը ${BP_REPEAT.restMinutes} րոպե հանգստանա, հետո նորից չափեք։ Հարցրեք գլխացավի, տեսողության փոփոխության, կրծքավանդակի ցավի և թուլության մասին. դրանցից որևէ մեկի դեպքում անմիջապես զանգահարեք 103։ Այս չափումը փոխանցվում է նաև բժշկին։`,
  ru: `Очень высокое измерение. Пусть участник отдохнёт ${BP_REPEAT.restMinutes} минут, затем измерьте снова. Спросите о головной боли, изменении зрения, боли в груди и слабости: при любом из них сразу звоните 103. Это измерение также передаётся врачу.`,
};
/** What a member reads after saving a reading, by step. Routine readings keep each screen's own line. */
export function bpSavedLine(l: BpLang, step: BpStep, r: BpNumbers) {
  return step === "doctor_today" ? bpTodayLine(l) : step === "doctor_48h" ? bpSoonLine(l, false) : step === "remeasure" ? bpRemeasureLine(l, r, "save") : null;
}

/** Weekly summary, draft for Armen and language review. Also transcribed in the weekly SQL
 * migration, pinned by check-bp-trend.ts. No diagnosis or claim of a doctor action.
 * Empty optional lines omit unsupported comparisons, rather than inventing a baseline.
 */
export const BP_WEEKLY_WORDS = {
  en: {
    average: 'Your week: average {sys}/{dia} mmHg.',
    change: ' Change from last week: upper number {sys}, lower number {dia} mmHg.',
    pattern: ' Mornings {morning_sys}/{morning_dia}, evenings {evening_sys}/{evening_dia} mmHg.',
    days: ' You measured on {days} of the last {window} days.',
    mornings: ' Next: measure each morning for the next {next_days} days.',
    twice_daily: ' Next: measure morning and evening for the next {next_days} days.',
    keep: ' Next: keep measuring a few mornings a week.',
  },
  hy: {
    average: 'Ձեր շաբաթը. միջին ճնշումը՝ {sys}/{dia} մմ սնդ. սյուն։',
    change: ' Փոփոխությունն անցած շաբաթվա համեմատ. վերին թիվը՝ {sys}, ստորինը՝ {dia} մմ սնդ. սյուն։',
    pattern: ' Առավոտյան՝ {morning_sys}/{morning_dia}, երեկոյան՝ {evening_sys}/{evening_dia} մմ սնդ. սյուն։',
    days: ' Դուք չափել եք վերջին {window} օրերից {days}-ում։',
    mornings: ' Հաջորդ քայլը. հաջորդ {next_days} օրերին չափեք ամեն առավոտ։',
    twice_daily: ' Հաջորդ քայլը. հաջորդ {next_days} օրերին չափեք առավոտյան և երեկոյան։',
    keep: ' Հաջորդ քայլը. շարունակեք չափել շաբաթական մի քանի առավոտ։',
  },
  ru: {
    average: 'Ваша неделя: среднее давление {sys}/{dia} мм рт. ст.',
    change: ' Изменение за неделю: верхнее число {sys}, нижнее число {dia} мм рт. ст.',
    pattern: ' Утром {morning_sys}/{morning_dia}, вечером {evening_sys}/{evening_dia} мм рт. ст.',
    days: ' Вы измеряли давление в {days} из последних {window} дней.',
    mornings: ' Следующий шаг: измеряйте каждое утро в следующие {next_days} дня.',
    twice_daily: ' Следующий шаг: измеряйте утром и вечером в следующие {next_days} дня.',
    keep: ' Следующий шаг: продолжайте измерять несколько раз в неделю по утрам.',
  },
} as const;

export function bpWeeklySummaryLine(lang: BpLang, summary: import('./bp-trend').BpWeeklyTrend): string {
  const w=BP_WEEKLY_WORDS[lang], s=summary;
  const fill=(text:string,values:Record<string,number|string>)=>text.replace(/\{([a-z_]+)\}/g,(_,key:string)=>String(values[key]));
  const signed=(n:number)=>n>0?`+${n}`:String(n);
  return fill(w.average,{sys:s.thisMean.systolic,dia:s.thisMean.diastolic})
    +(s.change?fill(w.change,{sys:signed(s.change.systolic),dia:signed(s.change.diastolic)}):'')
    +(s.morning&&s.evening?fill(w.pattern,{morning_sys:s.morning.systolic,morning_dia:s.morning.diastolic,evening_sys:s.evening.systolic,evening_dia:s.evening.diastolic}):'')
    +fill(w.days,{days:s.daysMeasured,window:WEEKLY_THRESHOLD.bpTrendWindowDays})
    +fill(w[s.nextStep],{next_days:WEEKLY_THRESHOLD.bpTrendNextDays});
}
