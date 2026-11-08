import type { LipidDateFact, LipidTest, LipidTriFact } from "../facts";
import type { L3, Ruleset } from "../engine";
import type { LipidSourceId } from "../sources";

/**
 * Lipid follow-up rules, version 2026-10-30. CLINICAL CONFIGURATION: every rule is `proposed` until Armen and Yesayi sign
 * it. Nothing here is signed policy, and the card says so. To change a rule, add a new dated file and point rules/index.ts
 * at it; to sign one, the clinicians' decision is recorded first.
 *
 * Basis: output/ldl-pivot-2026-10-29/ERRATA.md and the two reviews in output/specialist-review-2026-10-30/. Where guidance
 * differs, the rule carries an `open` entry and the card shows the positions side by side: the window a rule dates by is a
 * proposal to check, not a choice between them. No rule selects a medicine or a dose. There is no adherence cut-off (no
 * reviewed source has one), and no ALT multiple (the reviews could not read one in a source).
 *
 * Armenian and Russian are UNAPPROVED v1 (Tatevik).
 */
export const LIPID_OPEN_GUIDANCE = {
  retest_acs: {
    topic: ["First lipid test after a heart attack", "Առաջին լիպիդային անալիզը ինֆարկտից հետո", "Первый анализ липидов после инфаркта"],
    positions: [
      { source: "esc2019_s95", text: ["4 to 6 weeks", "4-ից 6 շաբաթ", "4–6 недель"] },
      { source: "esc2025", text: ["4 to 6 weeks after starting or intensifying", "4-ից 6 շաբաթ՝ սկսելուց կամ ուժեղացնելուց հետո", "4–6 недель после начала или усиления"] },
      { source: "acc2025_acs", text: ["4 to 8 weeks", "4-ից 8 շաբաթ", "4–8 недель"] },
      { source: "acc2026_s35", text: ["4 to 12 weeks", "4-ից 12 շաբաթ", "4–12 недель"] },
    ],
  },
  retest_general: {
    topic: ["First lipid test without a heart attack, including stroke", "Առաջին լիպիդային անալիզը առանց ինֆարկտի, ներառյալ ինսուլտը", "Первый анализ липидов без инфаркта, включая инсульт"],
    positions: [
      { source: "esc2019_t13", text: ["8 weeks, give or take 4", "8 շաբաթ, ±4", "8 недель, ±4"] },
      { source: "acc2026_s35", text: ["4 to 12 weeks", "4-ից 12 շաբաթ", "4–12 недель"] },
      { source: "aha2021_stroke", text: ["After stroke or TIA: 4 to 12 weeks", "Ինսուլտից կամ TIA-ից հետո՝ 4-ից 12 շաբաթ", "После инсульта или ТИА: 4–12 недель"] },
      { source: "esc2025", text: ["4 to 6 weeks after starting or intensifying; the context is acute coronary syndrome", "4-ից 6 շաբաթ՝ սկսելուց կամ ուժեղացնելուց հետո. համատեքստը սուր կորոնար համախտանիշն է", "4–6 недель после начала или усиления; контекст: острый коронарный синдром"] },
    ],
  },
  maintenance: {
    topic: ["Test interval once at goal", "Անալիզի հաճախականությունը նպատակին հասնելուց հետո", "Интервал анализов после достижения цели"],
    positions: [
      { source: "acc2026_s35", text: ["Every 6 to 12 months. The date here uses the 12-month end.", "Յուրաքանչյուր 6-ից 12 ամիսը մեկ։ Այստեղ ամսաթիվը հաշվարկված է 12 ամսով։", "Каждые 6–12 месяцев. Здесь дата рассчитана по 12 месяцам."] },
    ],
  },
  alt: {
    topic: ["ALT on treatment", "ԱԼՏ բուժման ընթացքում", "АЛТ на лечении"],
    positions: [
      { source: "esc2019_t13", text: ["Before treatment and once at 8 to 12 weeks", "Բուժումից առաջ և մեկ անգամ՝ 8-ից 12 շաբաթում", "До лечения и однократно через 8–12 недель"] },
      { source: "acc2026_s51", text: ["No routine testing without symptoms; before and after adding ezetimibe to a statin", "Առանց ախտանիշների պարբերական անալիզ չի պահանջվում. ստատինին էզետիմիբ ավելացնելիս՝ առաջ և հետո", "Без симптомов рутинно не проверять; до и после добавления эзетимиба к статину"] },
    ],
  },
  ck: {
    topic: ["CK", "CK", "КФК"],
    positions: [
      { source: "esc2019_t13", text: ["Before treatment", "Բուժումից առաջ", "До лечения"] },
      { source: "acc2026_s51", text: ["No routine testing without severe muscle symptoms", "Առանց մկանային ծանր ախտանիշների պարբերական անալիզ չի պահանջվում", "Без тяжёлых мышечных симптомов рутинно не проверять"] },
    ],
  },
  stroke_risk: {
    topic: ["Risk category after stroke or TIA", "Ռիսկի կատեգորիան ինսուլտից կամ TIA-ից հետո", "Категория риска после инсульта или ТИА"],
    positions: [
      { source: "esc2019_s6", text: ["Very high risk, goal under 1.4 mmol/L", "Շատ բարձր ռիսկ, նպատակը՝ 1.4 մմոլ/լ-ից ցածր", "Очень высокий риск, цель ниже 1,4 ммоль/л"] },
      { source: "acc2026_s426", text: ["Not every single event is very high risk: under 1.8 mmol/L, with 1.4 reasonable", "Ոչ բոլոր առանձին դեպքերն են շատ բարձր ռիսկի. 1.8 մմոլ/լ-ից ցածր, 1.4-ը ողջամիտ է", "Не каждое единичное событие означает очень высокий риск: ниже 1,8 ммоль/л, 1,4 допустимо"] },
      { source: "aha2021_stroke", text: ["Atherosclerotic stroke or TIA: under 1.8 mmol/L", "Աթերոսկլերոտիկ ինսուլտ կամ TIA՝ 1.8 մմոլ/լ-ից ցածր", "Атеросклеротический инсульт или ТИА: ниже 1,8 ммоль/л"] },
    ],
  },
} as const satisfies Record<string, { topic: L3; positions: readonly { source: LipidSourceId; text: L3 }[] }>;
export type LipidOpenId = keyof typeof LIPID_OPEN_GUIDANCE;

const onTherapy = { fact: "onLipidTherapy" } as const;
const acs = { fact: "acsEvent" } as const;

export const LIPID_RULES_2026_10_30: Ruleset<LipidTriFact, LipidDateFact, LipidTest, LipidSourceId, LipidOpenId> = {
  version: "lipid-rules-2026-10-30",
  status: "proposed",
  rules: [
    {
      id: "LR-01", status: "proposed",
      title: ["Lipid test 4 to 6 weeks after a heart attack or a therapy change", "Լիպիդային անալիզ ինֆարկտից կամ բուժման փոփոխությունից 4-ից 6 շաբաթ հետո", "Анализ липидов через 4–6 недель после инфаркта или изменения терапии"],
      when: { all: [onTherapy, acs, { fact: "changeDatesKnown" }] },
      then: { kind: "test", test: "lipid", group: "lipid", anchor: "acsRetestAnchor", from: { weeks: 4 }, to: { weeks: 6 }, doneBy: "lipid", confirmedWindow: true },
      sources: ["esc2019_s95", "esc2025"], open: ["retest_acs"],
    },
    {
      id: "LR-02", status: "proposed",
      title: ["Lipid test 4 to 12 weeks after a therapy change, no heart attack", "Լիպիդային անալիզ բուժման փոփոխությունից 4-ից 12 շաբաթ հետո, առանց ինֆարկտի", "Анализ липидов через 4–12 недель после изменения терапии, без инфаркта"],
      when: { all: [onTherapy, { not: acs }, { fact: "changeDatesKnown" }] },
      then: { kind: "test", test: "lipid", group: "lipid", anchor: "lastChangeOn", from: { weeks: 4 }, to: { weeks: 12 }, doneBy: "lipid", confirmedWindow: true },
      sources: ["esc2019_t13", "acc2026_s35"], open: ["retest_general"],
    },
    {
      id: "LR-03", status: "proposed",
      title: ["Yearly lipid test once both parts of the goal are met", "Տարեկան լիպիդային անալիզ, երբ նպատակի երկու մասն էլ կատարված են", "Ежегодный анализ липидов, когда выполнены обе части цели"],
      when: { all: [onTherapy, { fact: "goalMet" }, { fact: "noChangeSinceLatestLdl" }] },
      then: { kind: "test", test: "lipid_annual", group: "annual", anchor: "latestLdlOn", from: { years: 1 }, to: { years: 1 }, onlyWhenTrue: true },
      sources: ["acc2026_s35"], open: ["maintenance"],
    },
    {
      id: "LR-04", status: "proposed",
      title: ["ALT once, 8 to 12 weeks after a start or dose increase", "ԱԼՏ մեկ անգամ՝ սկսելուց կամ դոզան բարձրացնելուց 8-ից 12 շաբաթ հետո", "АЛТ однократно через 8–12 недель после начала или повышения дозы"],
      when: { all: [onTherapy, { fact: "startOrIncreaseRecorded" }] },
      then: { kind: "test", test: "alt", group: "alt", anchor: "lastStartOrIncreaseOn", from: { weeks: 8 }, to: { weeks: 12 }, doneBy: "alt" },
      sources: ["esc2019_t13"], open: ["alt"],
    },
    {
      id: "LR-05", status: "proposed",
      title: ["CK with severe muscle symptoms", "CK մկանային ծանր ախտանիշների դեպքում", "КФК при тяжёлых мышечных симптомах"],
      when: { all: [onTherapy, { fact: "sideEffectOpen" }, { fact: "muscleSymptoms" }] },
      then: { kind: "test", test: "ck", group: "ck", anchor: "sideEffectOn", from: { weeks: 0 }, to: { weeks: 0 } },
      sources: ["acc2026_s4211", "acc2026_s51"],
    },
    {
      id: "LR-06", status: "proposed",
      title: ["Goal check, threshold and reduction shown separately", "Նպատակի ստուգում, շեմն ու նվազումը՝ առանձին", "Проверка цели: порог и снижение отдельно"],
      when: { all: [{ fact: "goalRecorded" }, { fact: "documentedBaseline" }, { fact: "latestAfterBaseline" }] },
      then: { kind: "goal_check" },
      sources: ["esc2019_s6", "acc2026_s426"],
    },
    {
      id: "LR-07", status: "proposed",
      title: ["Documented pre-treatment LDL", "Բուժումից առաջվա փաստաթղթավորված ՑԽԼ", "Документированный ЛПНП до лечения"],
      when: { fact: "noPreTreatmentValue" },
      then: { kind: "question", text: ["No documented pre-treatment LDL. Is there a value from before treatment? A discharge value counts only if the member was not yet on treatment.", "Բուժումից առաջվա փաստաթղթավորված ՑԽԼ չկա։ Կա՞ արժեք բուժումից առաջ։ Դուրսգրման արժեքը հաշվվում է միայն, եթե անդամը դեռ բուժում չէր ստանում։", "Нет документированного ЛПНП до лечения. Есть ли значение до начала лечения? Значение при выписке подходит, только если участник ещё не лечился."] },
      sources: ["esc2019_s6", "acc2026_s426"],
    },
    {
      id: "LR-08", status: "proposed",
      title: ["Pre-treatment value dated before therapy", "Բուժումից առաջվա արժեքը թվագրված է բուժումից առաջ", "Значение до лечения датировано раньше терапии"],
      when: { fact: "baselineAfterTherapy" },
      then: { kind: "question", text: ["The pre-treatment value is dated after the first recorded therapy. Was it really untreated?", "Բուժումից առաջվա արժեքը թվագրված է առաջին գրանցված բուժումից հետո։ Իսկապե՞ս չբուժված էր։", "Значение до лечения датировано позже первой записанной терапии. Оно действительно без лечения?"] },
      sources: ["esc2019_s6"],
    },
    {
      id: "LR-09", status: "proposed",
      title: ["ALT before treatment", "ԱԼՏ բուժումից առաջ", "АЛТ до лечения"],
      when: { fact: "baselineAltMissing" },
      then: { kind: "gap", text: ["No reviewed ALT from before the first therapy.", "Առաջին բուժումից առաջ ստուգված ԱԼՏ չկա։", "Нет проверенного АЛТ до первой терапии."] },
      sources: ["esc2019_t13"], open: ["alt"],
    },
    {
      id: "LR-10", status: "proposed",
      title: ["CK before treatment", "CK բուժումից առաջ", "КФК до лечения"],
      when: { fact: "baselineCkMissing" },
      then: { kind: "gap", text: ["No reviewed CK from before the first therapy. Was one taken?", "Առաջին բուժումից առաջ ստուգված CK չկա։ Արվե՞լ է։", "Нет проверенной КФК до первой терапии. Её измеряли?"] },
      sources: ["esc2019_t13", "acc2026_s51"], open: ["ck"],
    },
    {
      id: "LR-11", status: "proposed",
      title: ["Lp(a) at least once", "Lp(a) առնվազն մեկ անգամ", "Lp(a) хотя бы один раз"],
      when: { fact: "lpaMissing" },
      then: { kind: "question", text: ["No reviewed Lp(a) on record. Guidelines advise measuring it at least once. Is it part of this member's tests? Keep the unit the laboratory reports.", "Ստուգված Lp(a) չկա։ Ուղեցույցները խորհուրդ են տալիս չափել առնվազն մեկ անգամ։ Մտնո՞ւմ է այս անդամի անալիզների մեջ։ Պահեք լաբորատորիայի միավորը։", "Нет проверенного Lp(a). Рекомендации советуют измерить его хотя бы раз. Входит ли он в анализы этого участника? Сохраняйте единицы лаборатории."] },
      sources: ["acc2026_s34", "esc2025"],
    },
    {
      id: "LR-12", status: "proposed",
      title: ["Above goal: review intake and tolerability", "Նպատակից բարձր. ստուգել ընդունումն ու տանելիությունը", "Выше цели: проверить приём и переносимость"],
      when: { fact: "aboveGoal" },
      then: { kind: "question", text: ["Above goal. Check what the member actually took, cost and access, and how it was tolerated. The next step is your decision; none is proposed here.", "Նպատակից բարձր է։ Ստուգեք, թե անդամն իրականում ինչ է ընդունել, արժեքն ու հասանելիությունը, և տանելիությունը։ Հաջորդ քայլը ձեր որոշումն է. այստեղ առաջարկ չկա։", "Выше цели. Проверьте, что участник фактически принимал, стоимость и доступность, переносимость. Следующий шаг решаете вы; здесь он не предлагается."] },
      sources: ["acc2026_s35"],
    },
    {
      id: "LR-13", status: "proposed",
      title: ["Above goal: highest tolerated dose recorded", "Նպատակից բարձր. գրանցված է առավելագույն տանելի դոզան", "Выше цели: записана максимально переносимая доза"],
      when: { all: [{ fact: "aboveGoal" }, { fact: "highestDoseNotRecorded" }] },
      then: { kind: "question", text: ["No current therapy is marked as the highest tolerated dose. Has it been reached?", "Ընթացիկ բուժումներից ոչ մեկը նշված չէ որպես առավելագույն տանելի դոզա։ Հասե՞լ եք դրան։", "Ни одна текущая терапия не отмечена как максимально переносимая доза. Она достигнута?"] },
      sources: ["acc2026_s426"],
    },
    {
      id: "LR-14", status: "proposed",
      title: ["Stroke or TIA: risk category and mechanism", "Ինսուլտ կամ TIA. ռիսկի կատեգորիա և մեխանիզմ", "Инсульт или ТИА: категория риска и механизм"],
      when: { all: [{ fact: "strokeOrTiaEvent" }, { not: acs }] },
      then: { kind: "question", text: ["Stroke or TIA with no heart attack on record. Confirm the risk category and the mechanism: atherosclerotic, cardioembolic and haemorrhagic stroke are not the same pathway.", "Ինսուլտ կամ TIA՝ առանց գրանցված ինֆարկտի։ Հաստատեք ռիսկի կատեգորիան և մեխանիզմը. աթերոսկլերոտիկ, կարդիոէմբոլիկ և հեմոռագիկ ինսուլտները նույն ուղին չեն։", "Инсульт или ТИА без записанного инфаркта. Подтвердите категорию риска и механизм: атеросклеротический, кардиоэмболический и геморрагический инсульт это разные пути."] },
      sources: ["acc2026_s426", "aha2021_stroke"], open: ["stroke_risk"],
    },
    {
      id: "LR-15", status: "proposed",
      title: ["Side-effect or stopping report", "Կողմնակի ազդեցության կամ դադարեցման հաղորդում", "Сообщение о побочном эффекте или отмене"],
      when: { fact: "reportOpen" },
      then: { kind: "question", text: ["The member reported a side effect or stopping a lipid medicine, and it is still open. Please review it.", "Անդամը հաղորդել է լիպիդիջեցնող դեղի կողմնակի ազդեցության կամ դադարեցման մասին, և դա դեռ բաց է։ Խնդրում ենք դիտարկել։", "Участник сообщил о побочном эффекте или отмене липидснижающего препарата, сообщение ещё открыто. Просмотрите его."] },
      sources: ["acc2026_s4211"],
    },
    {
      id: "LR-16", status: "proposed",
      title: ["Dose log for lipid medicines", "Լիպիդիջեցնող դեղերի ընդունման գրանցում", "Журнал приёма липидснижающих препаратов"],
      when: { fact: "noDoseLog" },
      then: { kind: "gap", text: ["No lipid medicine on the dose log, so intake is not known. A missing tick is not a missed dose.", "Ընդունման գրանցումում լիպիդիջեցնող դեղ չկա, ուստի ընդունումն անհայտ է։ Բացակայող նշումը բաց թողնված դեղաչափ չէ։", "В журнале приёма нет липидснижающего препарата, поэтому приём неизвестен. Отсутствие отметки не значит пропуск дозы."] },
      sources: ["acc2026_s35"],
    },
    {
      id: "LR-17", status: "proposed",
      title: ["Current lipid therapy on record", "Գրանցված ընթացիկ լիպիդիջեցնող բուժում", "Текущая липидснижающая терапия в записи"],
      when: { not: onTherapy },
      then: { kind: "gap", text: ["All recorded lipid therapy has stopped. No follow-up test can be dated from it.", "Գրանցված ամբողջ լիպիդիջեցնող բուժումը դադարեցված է։ Հետևողական անալիզի ամսաթիվ չի կարող հաշվարկվել։", "Вся записанная липидснижающая терапия отменена. Дату контрольного анализа определить нельзя."] },
      sources: ["acc2026_s35"],
    },
  ],
  factLabels: {
    onLipidTherapy: ["No lipid therapy recorded.", "Լիպիդիջեցնող բուժում գրանցված չէ։", "Липидснижающая терапия не записана."],
    acsEvent: ["The event type is not settled: no event is recorded, or it is recorded as other. The lipid test window depends on it.", "Դեպքի տեսակը պարզ չէ. դեպք գրանցված չէ կամ գրանցված է որպես այլ։ Լիպիդային անալիզի ժամկետը դրանից է կախված։", "Тип события не ясен: событие не записано или записано как другое. От этого зависит срок анализа липидов."],
    strokeOrTiaEvent: null,
    changeDatesKnown: ["A therapy start or stop date, or an event date, is not recorded, so the lipid test window cannot be dated.", "Բուժման սկսելու կամ դադարեցնելու ամսաթիվը կամ դեպքի ամսաթիվը գրանցված չէ, ուստի լիպիդային անալիզի ժամկետը հնարավոր չէ հաշվարկել։", "Не записана дата начала или отмены терапии либо дата события, поэтому срок анализа липидов определить нельзя."],
    startOrIncreaseRecorded: ["Start date or dose direction of the current therapy is not clear, so the ALT window cannot be dated.", "Ընթացիկ բուժման սկսելու ամսաթիվը կամ դոզայի ուղղությունը պարզ չէ, ուստի ԱԼՏ-ի ժամկետը հնարավոր չէ հաշվարկել։", "Дата начала или направление изменения дозы неясны, поэтому срок АЛТ определить нельзя."],
    goalRecorded: ["No LDL goal recorded, so no risk category is set.", "ՑԽԼ նպատակ գրանցված չէ, ուստի ռիսկի կատեգորիան սահմանված չէ։", "Цель по ЛПНП не записана, поэтому категория риска не задана."],
    documentedBaseline: null,
    latestAfterBaseline: ["No reviewed LDL result yet.", "Ստուգված ՑԽԼ արդյունք դեռ չկա։", "Проверенного результата ЛПНП пока нет."],
    goalMet: null,
    aboveGoal: null,
    noChangeSinceLatestLdl: null,
    noPreTreatmentValue: null,
    baselineAfterTherapy: null,
    baselineAltMissing: ["The first therapy start date is not recorded, so tests from before treatment cannot be checked.", "Առաջին բուժման սկսելու ամսաթիվը գրանցված չէ, ուստի բուժումից առաջվա անալիզները հնարավոր չէ ստուգել։", "Дата начала первой терапии не записана, поэтому анализы до лечения проверить нельзя."],
    baselineCkMissing: ["The first therapy start date is not recorded, so tests from before treatment cannot be checked.", "Առաջին բուժման սկսելու ամսաթիվը գրանցված չէ, ուստի բուժումից առաջվա անալիզները հնարավոր չէ ստուգել։", "Дата начала первой терапии не записана, поэтому анализы до лечения проверить нельзя."],
    lpaMissing: null,
    highestDoseNotRecorded: null,
    noDoseLog: null,
    sideEffectOpen: ["An open report does not name its medicine, so it may be about a lipid medicine.", "Բաց հաղորդումը չի նշում դեղը, ուստի կարող է վերաբերել լիպիդիջեցնող դեղին։", "В открытом сообщении не указан препарат, возможно, он липидснижающий."],
    reportOpen: ["An open report does not name its medicine, so it may be about a lipid medicine.", "Բաց հաղորդումը չի նշում դեղը, ուստի կարող է վերաբերել լիպիդիջեցնող դեղին։", "В открытом сообщении не указан препарат, возможно, он липидснижающий."],
    muscleSymptoms: ["Whether the reported side effect is severe muscle pain or weakness is not recorded.", "Գրանցված չէ՝ հաղորդված կողմնակի ազդեցությունը մկանային ծանր ցա՞վ է, թե՞ թուլություն։", "Не записано, является ли побочный эффект сильной мышечной болью или слабостью."],
  },
};
