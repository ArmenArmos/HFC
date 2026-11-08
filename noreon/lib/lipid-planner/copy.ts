import type { GoalCheckGap, LipidTest } from "./facts";
import type { L3 } from "./engine";

/** Staff copy of the lipid plan, on the member page and on the Doctor Zoe card. Armenian and Russian are UNAPPROVED v1 (Tatevik). */
export const LIPID_COPY = {
  title: ["Lipid follow-up plan", "Լիպիդային հսկողության պլան", "План контроля липидов"],
  intro: ["Worked out by fixed rules from reviewed results and the record. Read-only: nothing is booked, and nothing goes to the member.", "Հաշվարկված է ֆիքսված կանոններով՝ ստուգված արդյունքներից և գրառումից։ Միայն կարդալու համար. ոչինչ չի ամրագրվում և անդամին չի ուղարկվում։", "Рассчитано по фиксированным правилам из проверенных результатов и записи. Только чтение: ничего не бронируется и не отправляется участнику."],
  proposed: ["Proposed rules, under clinical review", "Առաջարկվող կանոններ՝ կլինիկական վերանայման փուլում", "Предлагаемые правила, проходят клиническую проверку"],
  timeline: ["Follow-up tests", "Հսկողության անալիզներ", "Контрольные анализы"],
  none: ["Nothing can be dated yet.", "Դեռ ոչինչ հնարավոր չէ թվագրել։", "Пока ничего нельзя датировать."],
  scheduled: ["Scheduled", "Նախատեսված է", "Запланировано"], due_now: ["Due now", "Հիմա է պետք", "Пора сделать"], overdue: ["Overdue", "Ժամկետանց", "Просрочено"],
  undated: ["Not dated: data missing", "Առանց ամսաթվի. տվյալներ չկան", "Без даты: нет данных"], done: ["Done", "Արված է", "Сделано"],
  confirmed: ["doctor confirmed", "բժիշկը հաստատել է", "подтверждено врачом"],
  doctorDate: ["Next test date you set", "Ձեր սահմանած հաջորդ անալիզի ամսաթիվը", "Заданная вами дата следующего анализа"],
  goal: ["Goal check", "Նպատակի ստուգում", "Проверка цели"],
  notRun: ["Not run:", "Չի կատարվել՝", "Не выполнена:"],
  threshold: ["Threshold", "Շեմ", "Порог"], reduction: ["Reduction from pre-treatment LDL", "Նվազում բուժումից առաջվա ՑԽԼ-ից", "Снижение от ЛПНП до лечения"],
  noReduction: ["No reduction part in this goal", "Այս նպատակում նվազման մաս չկա", "В этой цели нет части о снижении"],
  both: ["Both parts", "Երկու մասը", "Обе части"], below: ["below", "ցածր", "ниже"], required: ["required", "պահանջվում է", "требуется"],
  TRUE: ["Met", "Կատարված է", "Выполнено"], FALSE: ["Not met", "Կատարված չէ", "Не выполнено"], UNKNOWN: ["Unknown", "Անհայտ", "Неизвестно"],
  belowAlready: ["The pre-treatment value is already below the threshold.", "Բուժումից առաջվա արժեքն արդեն շեմից ցածր է։", "Значение до лечения уже ниже порога."],
  intake: ["Intake and tolerability", "Ընդունում և տանելիություն", "Приём и переносимость"],
  noLog: ["No lipid medicine on the dose log.", "Ընդունման գրանցումում լիպիդիջեցնող դեղ չկա։", "В журнале приёма нет липидснижающего препарата."],
  ticks: ["Doses ticked as taken, last 28 days", "Ընդունված նշված դեղաչափեր, վերջին 28 օր", "Отмеченные дозы за 28 дней"],
  notProof: ["Ticks are the member's own report. A missing tick is not a missed dose.", "Նշումները անդամի սեփական հաղորդումն են։ Բացակայող նշումը բաց թողնված դեղաչափ չէ։", "Отметки это сообщение самого участника. Отсутствие отметки не значит пропуск дозы."],
  noReport: ["No open side-effect report. That does not prove the medicine is tolerated.", "Կողմնակի ազդեցության բաց հաղորդում չկա։ Դա չի ապացուցում, որ դեղը լավ է տարվում։", "Открытых сообщений о побочных эффектах нет. Это не доказывает хорошую переносимость."],
  side_effect: ["Side effect reported", "Հաղորդված կողմնակի ազդեցություն", "Сообщён побочный эффект"], decided_to_stop: ["Decided to stop", "Որոշել է դադարեցնել", "Решил прекратить"],
  gaps: ["Data gaps and questions for you", "Տվյալների բացեր և հարցեր ձեզ", "Пробелы в данных и вопросы к вам"], noGaps: ["None.", "Չկան։", "Нет."],
  open: ["Guidance differs: clinical decision open", "Ուղեցույցները տարբեր են. կլինիկական որոշումը բաց է", "Рекомендации расходятся: клиническое решение открыто"],
  applies: ["Applies", "Կիրառելի է", "Применимо"],
  doesNotApply: ["Does not apply", "Կիրառելի չէ", "Не применимо"],
  rules: ["Rules checked", "Ստուգված կանոններ", "Проверенные правила"], status: ["proposed", "առաջարկվող", "предложено"],
} as const satisfies Record<string, L3>;

export const LIPID_TESTS: Record<LipidTest, L3> = {
  lipid: ["Lipid test", "Լիպիդային անալիզ", "Анализ липидов"],
  lipid_annual: ["Yearly lipid test", "Տարեկան լիպիդային անալիզ", "Ежегодный анализ липидов"],
  alt: ["ALT", "ԱԼՏ", "АЛТ"],
  ck: ["CK", "CK", "КФК"],
};
export const LIPID_GOAL_GAPS: Record<GoalCheckGap, L3> = {
  goal: ["no goal set, so no risk category", "նպատակ սահմանված չէ, ուստի ռիսկի կատեգորիա չկա", "цель не задана, поэтому нет категории риска"],
  baseline_unknown: ["no documented pre-treatment LDL", "բուժումից առաջվա փաստաթղթավորված ՑԽԼ չկա", "нет документированного ЛПНП до лечения"],
  baseline_on_treatment: ["the baseline was already on treatment", "ելակետն արդեն բուժման ընթացքում էր", "исходное значение получено уже на лечении"],
  latest: ["no reviewed LDL result", "ստուգված ՑԽԼ արդյունք չկա", "нет проверенного результата ЛПНП"],
  no_later_value: ["no reviewed LDL after the baseline date", "ելակետից հետո ստուգված ՑԽԼ չկա", "нет проверенного ЛПНП после исходной даты"],
};

