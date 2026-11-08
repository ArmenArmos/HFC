import type { Localized, PlannedTest } from "@/lib/clinical/types";

/**
 * The personalised test plan (handoff screen 06).
 *
 * Each entry names the rules that put it there. That link is what lets the plan
 * screen claim there is nothing generic on the list: every item traces back to
 * an answer the person actually gave, and `buildPlan` will not include a test
 * whose rules did not fire.
 *
 * The handoff document asks this screen to explain the recommendation rather
 * than list it, so a card is not a name and a blurb. Each test has to answer
 * four separate questions — why you, what it can tell us, how it may change the
 * next step, and what it involves — and none of them may promise a diagnosis.
 */

/**
 * The seeded home visit's length, from the handoff document.
 *
 * Not a sum of `durationMinutes`: the four tests that share one blood draw add
 * no time of their own, and the visit also contains arrival, consent and
 * packing that belong to no single test.
 */
export const VISIT_DURATION_MINUTES = 35;

const HOME_OR_LAB: Localized = {
  hy: "Տնային այց, աշխատավայր կամ գործընկեր լաբորատորիա",
  en: "Home visit, workplace or partner laboratory",
  ru: "Визит на дом, на рабочее место или в партнёрскую лабораторию",
};

const SAME_DRAW: Localized = {
  hy: "Կատարվում է լիպիդային պրոֆիլի նույն արյան նմուշից. լրացուցիչ ժամանակ չի պահանջվում։",
  en: "Runs from the same blood draw as the lipid profile, so it adds no time.",
  ru: "Выполняется из того же образца крови, что и липидный профиль, поэтому не требует дополнительного времени.",
};

const LAB_TURNAROUND: Localized = {
  hy: "Արդյունքը՝ մեկ աշխատանքային օրում",
  en: "Result within one working day",
  ru: "Результат в течение одного рабочего дня",
};

const URINE_SAMPLE: Localized = {
  hy: "Մեզի նմուշ, ցանկալի է՝ առավոտյան առաջինը։ Քաղցած լինել պետք չէ։",
  en: "A urine sample, ideally the first of the morning. No fasting needed.",
  ru: "Образец мочи, желательно первая утренняя порция. Сдавать натощак не нужно.",
};

/**
 * Rules that make hypertension present, by measurement or by diagnosis.
 *
 * Decision tree v1.1 P175–176 orders an ECG and the basic workup for a reading
 * of 140/90 or more; questionnaire Q5.2 adds the 7-day home protocol for
 * 140–179/90–109. Q5.1 and the catalogue (B.1: ACR for every hypertensive)
 * extend the workup to a diagnosis, treated or not. RF-06 (180/110 or more, no
 * symptoms) gets at least the same set: the tree itemises only its deadline, so
 * this is an inference pending Armen (audit B8).
 *
 * The basic workup DT P176 names but does not itemise is read from catalogue
 * sections A and B: creatinine/eGFR, urine ACR, K, Na, urinalysis, full blood
 * count, HbA1c with fasting glucose, and TSH. Liver tests, uric acid, calcium
 * and echo are where the catalogue and lab protocol v2 §2 disagree; they stay
 * off the automatic list until Armen settles them.
 */
/** Decision tree Q9.1 says "consider": this rule puts tests on the plan without requiring them. */
export const DISCUSS_ONLY_RULES: readonly string[] = ["NRN-RULE-PAL-004"];

const HYPERTENSION_RULES = ["NRN-RULE-BP-002", "RF-06", "NRN-RULE-HTN-001", "NRN-RULE-HTN-002"];

/** CAT A.3 and B.1: kidney tests for every diabetic and for known kidney disease. */
const KIDNEY_RULES = ["NRN-RULE-DM-005", "NRN-RULE-CKD-001"];

const CONFIRM_WITH_PROVIDER: Localized = { en: "Confirm with the clinician and service provider", ru: "Уточните у врача и поставщика услуг", hy: "Ճշտել բժշկի և ծառայություն մատուցողի հետ" };
/** Additional investigations explicitly named by the decision-tree branches. */
function reviewTest(id: string, name: Localized, sourceRuleIds: string[], catalogueRef: string, method: PlannedTest["method"]): PlannedTest {
  return { id, name, sourceRuleIds, catalogueRef, method,
    category: method === "blood_draw" ? "laboratory" : "cardiovascular",
    priority: "now", durationMinutes: 0,
    rationale: { en: "Suggested by a matching questionnaire rule; confirm the indication during review.", ru: "Предложено на основании соответствующего правила анкеты. При проверке уточните показания.", hy: "Առաջարկվում է հարցաշարի համապատասխան կանոնով․ վերանայման ընթացքում ճշտել ցուցումը։" },
    whatItTells: { en: "Additional investigation named in the medical decision tree. Its interpretation and next steps need clinician review.", ru: "Дополнительное исследование, указанное в дереве медицинских решений. Интерпретация и следующие шаги требуют проверки врачом.", hy: "Բժշկական որոշումների ծառում նշված լրացուցիչ հետազոտություն։ Մեկնաբանությունն ու հաջորդ քայլերը պահանջում են բժշկական վերանայում։" },
    howItChangesNextStep: CONFIRM_WITH_PROVIDER, preparation: CONFIRM_WITH_PROVIDER,
    turnaround: CONFIRM_WITH_PROVIDER, location: CONFIRM_WITH_PROVIDER };
}

export const TEST_CATALOGUE: PlannedTest[] = [
  reviewTest("tsh", {en:"TSH",ru:"TSH",hy:"TSH"}, ["NRN-RULE-CP-002", ...HYPERTENSION_RULES], "TSH", "blood_draw"),
  reviewTest("nt-probnp", {en:"NT-proBNP",ru:"NT-proBNP",hy:"NT-proBNP"}, ["NRN-RULE-CMB-001", "NRN-RULE-PAL-004"], "NT-proBNP", "blood_draw"),
  reviewTest("echocardiogram", {en:"Echocardiogram",ru:"Эхокардиография",hy:"ԷխոԿԳ"}, ["NRN-RULE-CMB-001", "NRN-RULE-PAL-004", "RF-08", "RF-09"], "ԷխոԿԳ", "measurement"),
  reviewTest("holter", {en:"24–48 hour Holter monitoring",ru:"Холтеровское мониторирование в течение 24–48 часов",hy:"Հոլտեր 24–48 ժամ"}, ["NRN-RULE-CMB-002", "NRN-RULE-PAL-003", "RF-08", "RF-09", "RF-10"], "Հոլտեր 24–48 ժ", "ecg"),
  // Catalogue A.2: BMI >=30. Suspected metabolic syndrome has no defining rule.
  { ...reviewTest("insulin-homa", {en:"Fasting insulin and HOMA-IR",ru:"Инсулин натощак и HOMA-IR",hy:"Ծոմային ինսուլին · HOMA-IR"}, ["NRN-RULE-ANT-002"], "Ծոմային ինսուլին · HOMA-IR", "blood_draw"), discussOnly: true },
  { ...reviewTest("sleep-study", {en:"Sleep study (PSG/HSAT)",ru:"Исследование сна (ПСГ/HSAT)",hy:"Պոլիսոմնոգրաֆիա / HSAT"}, ["NRN-RULE-APN-002"], "Պոլիսոմնոգրաֆիա / HSAT", "measurement"), discussOnly: true },
  // Catalogue B.3: yearly for every member with diabetes.
  { ...reviewTest("fundoscopy", {en:"Eye fundus examination",ru:"Исследование глазного дна",hy:"Աչքի հատակի հետազոտություն"}, ["NRN-RULE-DM-005"], "Աչքի հատակի հետազոտություն", "measurement"), repeatAfterDays: 365, discussOnly: true },
  { ...reviewTest("foot-exam", {en:"Foot examination",ru:"Осмотр стоп",hy:"Ոտքերի զննում"}, ["NRN-RULE-DM-005"], "Ոտքերի զննում", "measurement"), repeatAfterDays: 365, discussOnly: true },
  {
    id: "bp-visit",
    category: "measurement",
    name: {
      hy: "Զարկերակային ճնշման կրկնակի չափում",
      en: "Repeated blood pressure measurement",
      ru: "Повторное измерение артериального давления",
    },
    rationale: {
      hy: "Ձեր վերջին գրանցված ցուցանիշը 148/92 է, և հաստատված ախտորոշում չկա։ Մեկ չափումը ախտորոշում չէ։",
      en: "Your latest recorded reading is 148/92 and there is no established diagnosis. One reading is not a diagnosis.",
      ru: "Ваше последнее записанное измерение составляет 148/92, установленного диагноза нет. Одно измерение не является диагнозом.",
    },
    whatItTells: {
      hy: "Կրկնվող չափումները ցույց են տալիս՝ բարձրացումը կայո՞ւն է, թե՞ կապված էր տվյալ պահի հետ։",
      en: "Repeated measurements show whether the elevation persists or was tied to that one moment.",
      ru: "Повторные измерения показывают, сохраняется ли повышение или оно было связано с конкретным моментом.",
    },
    howItChangesNextStep: {
      hy: "Կայուն բարձրացումը տանում է ապրելակերպի հսկողության, լրացուցիչ գնահատման կամ բուժման քննարկման. պատահական բարձրացումը՝ պարզապես կրկնակի չափման։",
      en: "A sustained elevation leads to lifestyle follow-up, further evaluation or a treatment discussion. A one-off leads to another measurement.",
      ru: "Стойкое повышение ведёт к наблюдению за изменениями образа жизни, дополнительной оценке или обсуждению лечения. Разовое повышение ведёт к ещё одному измерению.",
    },
    priority: "now",
    preparation: {
      hy: "Չափումից 30 րոպե առաջ առանց սուրճի և ծխախոտի։ Չափվում է նստած՝ 5 րոպե հանգստից հետո։",
      en: "No coffee or cigarettes for 30 minutes beforehand. Measured seated, after five minutes of rest.",
      ru: "Не пейте кофе и не курите в течение 30 минут до измерения. Измерение проводится сидя, после пяти минут отдыха.",
    },
    method: "measurement",
    durationMinutes: 5,
    turnaround: { hy: "Արդյունքը՝ տեղում", en: "Result on the spot", ru: "Результат на месте" },
    location: { hy: "Այցի ընթացքում", en: "During the visit", ru: "Во время визита" },
    sourceRuleIds: ["NRN-RULE-BP-002"],
    repeatAfterDays: 90,
  },
  {
    id: "anthropometry",
    category: "measurement",
    name: { hy: "Քաշի և գոտկատեղի չափում", en: "Weight and waist measurement", ru: "Измерение веса и окружности талии" },
    rationale: {
      hy: "103 սմ գոտկատեղը տղամարդկանց 102 սմ շեմից բարձր է, և ելակետը պետք է չափված լինի, ոչ թե հիշված։",
      en: "A 103 cm waist is above the 102 cm threshold for men, and the baseline needs to be measured rather than remembered.",
      ru: "Окружность талии 103 см превышает порог 102 см для мужчин. Исходное значение нужно измерить, а не вспоминать.",
    },
    whatItTells: {
      hy: "Ելակետ, որը կրկնվող եղանակով չափելի է և ցույց է տալիս փոփոխությունը ժամանակի ընթացքում։",
      en: "A reproducible baseline that shows change over time.",
      ru: "Воспроизводимое исходное измерение, которое показывает изменения со временем.",
    },
    howItChangesNextStep: {
      hy: "Գոտկատեղն ու քաշը համատեքստ են ավելացնում նյութափոխանակային և սրտանոթային կանխարգելման ծրագրին։ Ինքնին ախտորոշում չեն։",
      en: "Waist and weight add context to metabolic and cardiovascular prevention planning. On their own they are not a diagnosis.",
      ru: "Окружность талии и вес дополняют картину при планировании профилактики метаболических и сердечно-сосудистых заболеваний. Сами по себе они не являются диагнозом.",
    },
    priority: "baseline",
    preparation: {
      hy: "Հատուկ նախապատրաստություն չի պահանջվում։",
      en: "No special preparation needed.",
      ru: "Специальная подготовка не нужна.",
    },
    method: "measurement",
    durationMinutes: 5,
    turnaround: { hy: "Արդյունքը՝ տեղում", en: "Result on the spot", ru: "Результат на месте" },
    location: { hy: "Այցի ընթացքում", en: "During the visit", ru: "Во время визита" },
    sourceRuleIds: ["NRN-RULE-ANT-001"],
    repeatAfterDays: 90,
  },
  {
    id: "lipid-panel",
    category: "laboratory",
    name: { hy: "Լիպիդային պրոֆիլ և LDL-C", en: "Lipid profile with LDL-C", ru: "Липидный профиль с LDL-C" },
    rationale: {
      hy: "Արդի լիպիդային տվյալները բացակայում են, իսկ տարիքը, ծխելը և ընտանեկան պատմությունը կանխարգելման համար նշանակալի են։",
      en: "Recent lipid data is missing, and your age, smoking and family history all matter for prevention.",
      ru: "Свежих данных о липидах нет, а ваш возраст, курение и семейный анамнез имеют значение для профилактики.",
    },
    whatItTells: {
      hy: "Չափում է արյան մեջ շրջանառվող լիպիդները և տալիս ռիսկի գնահատման հիմնական մուտքերը։",
      en: "It measures the lipids circulating in your blood and provides the key inputs for risk assessment.",
      ru: "Измеряет липиды, циркулирующие в крови, и даёт основные данные для оценки риска.",
    },
    howItChangesNextStep: {
      hy: "Առանց այս ցուցանիշների սրտանոթային ռիսկը հնարավոր չէ հաշվարկել, ուստի սա այն անալիզն է, որը բացում է կանխարգելման որոշումները։",
      en: "Cardiovascular risk cannot be calculated without these values, so this is the test that unlocks the prevention decisions.",
      ru: "Без этих значений невозможно рассчитать сердечно-сосудистый риск, поэтому этот анализ позволяет принять решения о профилактике.",
    },
    priority: "now",
    // DT P506, catalogue B.2 and lab protocol v2 §3: lipids need no fasting.
    preparation: {
      hy: "Քաղցած լինել պետք չէ։ Եթե նույն այցին վերցվում է քաղցած գլյուկոզա, հետևեք դրա ցուցմանը։",
      en: "No fasting needed. If fasting glucose is taken at the same visit, follow its instruction.",
      ru: "Сдавать натощак не нужно. Если во время того же визита берут кровь на глюкозу натощак, следуйте инструкции к этому анализу.",
    },
    method: "blood_draw",
    durationMinutes: 10,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: ["Ընդհանուր խոլեստերին", "HDL-C", "LDL-C", "Տրիգլիցերիդներ"],
    sourceRuleIds: ["NRN-RULE-MISS-001", "NRN-RULE-FAM-001", "NRN-RULE-FAM-002", "NRN-RULE-CP-002"],
    repeatAfterDays: 90,
  },
  {
    id: "apob",
    category: "laboratory",
    name: { hy: "ApoB", en: "ApoB", ru: "ApoB" },
    rationale: {
      hy: "Ձեր դեպքում ApoB-ն ճշտում է լիպիդային պատկերը, նախքան բժիշկը կսահմանի կանխարգելման թիրախները։",
      en: "For you, ApoB refines the lipid picture before the clinician sets the prevention targets.",
      ru: "В вашем случае ApoB уточняет липидную картину, прежде чем врач определит цели профилактики.",
    },
    whatItTells: {
      hy: "ApoB-ն արտացոլում է աթերոգեն լիպոպրոտեինային մասնիկների քանակը և առանձին դեպքերում լրացնում է LDL-C-ի տված տեղեկությունը։",
      en: "ApoB reflects the number of atherogenic lipoprotein particles and can add information beyond LDL-C in selected situations.",
      ru: "ApoB отражает количество атерогенных липопротеиновых частиц и в отдельных случаях может дополнить информацию, которую даёт LDL-C.",
    },
    howItChangesNextStep: {
      hy: "Երբ LDL-C-ն և ApoB-ն տարբեր պատկեր են տալիս, բժիշկը թիրախը սահմանում է ըստ մասնիկների քանակի։",
      en: "When LDL-C and ApoB tell different stories, the clinician sets the target from the particle count.",
      ru: "Когда LDL-C и ApoB дают разную картину, врач определяет целевое значение по количеству частиц.",
    },
    priority: "now",
    preparation: SAME_DRAW,
    method: "blood_draw",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "ApoB",
    // Not for smoking alone: neither the tree nor the catalogue (trigger:
    // dyslipidaemia, metabolic syndrome) orders it there (audit A11).
    sourceRuleIds: ["NRN-RULE-FAM-001"],
    repeatAfterDays: 90,
  },
  {
    id: "lpa",
    category: "laboratory",
    name: { hy: "Lp(a)", en: "Lp(a)", ru: "Lp(a)" },
    rationale: {
      hy: "Հոր՝ 52 տարեկանում տարած ինֆարկտը հենց այն պատմությունն է, որի դեպքում ժառանգական գործոնն արժե չափել։",
      en: "A father with a heart attack at 52 is exactly the history that makes an inherited factor worth measuring.",
      ru: "Инфаркт у отца в 52 года как раз относится к тем случаям семейного анамнеза, когда стоит измерить наследственный фактор.",
    },
    whatItTells: {
      hy: "Lp(a)-ն հիմնականում ժառանգական է և կարող է բացահայտել լրացուցիչ սրտանոթային ռիսկի գործոն, որը սովորական խոլեստերինից չի երևում։",
      en: "Lp(a) is largely inherited and can reveal an additional cardiovascular risk factor that routine cholesterol does not show.",
      ru: "Уровень Lp(a) во многом определяется наследственностью и может выявить дополнительный фактор сердечно-сосудистого риска, который не виден по обычному анализу на холестерин.",
    },
    howItChangesNextStep: {
      hy: "Բարձր արժեքը խստացնում է մնացած գործոնների նկատմամբ ուշադրությունը։ Այս դեմոյում այն դիտվում է որպես ելակետային, սովորաբար մեկանգամյա չափում, եթե բժիշկը այլ բան չի խորհուրդ տալիս։",
      en: "A raised value tightens the attention paid to every other factor. In this demo it is positioned as a useful baseline and typically a one-time measurement, unless a clinician recommends otherwise.",
      ru: "Повышенное значение требует более пристального внимания ко всем остальным факторам. В этой демоверсии это полезное исходное измерение, которое обычно выполняется однократно, если врач не рекомендует иначе.",
    },
    priority: "one_time",
    preparation: SAME_DRAW,
    method: "blood_draw",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "Lp(a)",
    // DT P253–254, Q7.1: a relative with inherited high cholesterol orders it too.
    sourceRuleIds: ["NRN-RULE-FAM-001", "NRN-RULE-FAM-002"],
  },
  {
    // Decision tree v1.1 P231–233 orders HbA1c alone, without fasting.
    id: "hba1c",
    category: "laboratory",
    name: { hy: "HbA1c", en: "HbA1c", ru: "HbA1c" },
    rationale: {
      hy: "Դիաբետի դեպքում ձեր HbA1c-ն հայտնի չէ։",
      en: "Your HbA1c is not known with diabetes.",
      ru: "У вас сахарный диабет, но ваш HbA1c неизвестен.",
    },
    whatItTells: {
      hy: "HbA1c-ն արտացոլում է վերջին ամիսների միջին գլյուկոզան։",
      en: "HbA1c reflects average glucose exposure over recent months.",
      ru: "HbA1c отражает средний уровень глюкозы за последние месяцы.",
    },
    howItChangesNextStep: {
      hy: "Արդյունքն օգնում է բժշկին գնահատել ձեր դիաբետի ընթացիկ հսկողությունը։",
      en: "The result helps your clinician review your current diabetes control.",
      ru: "Результат помогает врачу оценить текущий контроль вашего сахарного диабета.",
    },
    priority: "now",
    preparation: { hy: "Ծոմ պահել պետք չէ։", en: "No fasting is required.", ru: "Сдавать натощак не требуется." },
    method: "blood_draw",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "HbA1c",
    sourceRuleIds: ["NRN-RULE-DM-004"],
  },
  {
    id: "hba1c-glucose",
    category: "laboratory",
    name: { hy: "HbA1c և քաղցած գլյուկոզա", en: "HbA1c and fasting glucose", ru: "HbA1c и глюкоза натощак" },
    rationale: {
      hy: "Ձեր ընթացիկ գլիկեմիկ վիճակն անհայտ է, իսկ քաշի և գոտկատեղի տվյալները ելակետը օգտակար են դարձնում։",
      en: "Your current glycaemic status is unknown, and your weight and waist make a current baseline useful.",
      ru: "Ваш текущий уровень глюкозы неизвестен, а с учётом веса и окружности талии полезно получить актуальные исходные данные.",
    },
    whatItTells: {
      hy: "HbA1c-ն արտացոլում է վերջին ամիսների միջին գլյուկոզան, իսկ քաղցած գլյուկոզան՝ տվյալ պահի ցուցանիշը։",
      en: "HbA1c reflects average glucose exposure over recent months, while fasting glucose is a point-in-time measurement.",
      ru: "HbA1c отражает средний уровень глюкозы за последние месяцы, а глюкоза натощак показывает значение в конкретный момент.",
    },
    howItChangesNextStep: {
      hy: "Միասին ցույց են տալիս՝ արդյոք անհրաժեշտ է նյութափոխանակային հետագա գնահատում։",
      en: "Together they help identify whether further metabolic evaluation is needed.",
      ru: "Вместе они помогают определить, нужна ли дальнейшая оценка обмена веществ.",
    },
    priority: "now",
    preparation: {
      hy: "8–12 ժամ քաղցած՝ գլյուկոզայի համար։ HbA1c-ն քաղց չի պահանջում։",
      en: "Fast 8 to 12 hours for the glucose. HbA1c does not need fasting.",
      ru: "Не ешьте от 8 до 12 часов перед анализом на глюкозу. Для HbA1c сдавать кровь натощак не нужно.",
    },
    method: "blood_draw",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: ["HbA1c", "Ծոմային գլյուկոզա"],
    // CAT A.2: BMI 25 or more, prediabetes and hypertension. Low activity
    // alone is not a trigger (audit A12).
    sourceRuleIds: ["NRN-RULE-ANT-001", "NRN-RULE-ANT-002", "NRN-RULE-ANT-004", "NRN-RULE-DM-006", ...HYPERTENSION_RULES],
    repeatAfterDays: 90,
  },
  {
    id: "creatinine-egfr",
    category: "laboratory",
    name: { hy: "Կրեատինին և eGFR", en: "Creatinine and eGFR", ru: "Креатинин и eGFR" },
    rationale: {
      hy: "Երիկամների ֆունկցիան ազդում է այն բանի վրա, թե ինչպես է բժիշկը կարդում ամբողջ պատկերը և ինչ բուժում կարող է ընտրել։",
      en: "Kidney function affects how the clinician reads the overall picture and which treatments they can choose.",
      ru: "Функция почек влияет на то, как врач оценивает общую картину и какие варианты лечения может выбрать.",
    },
    whatItTells: {
      hy: "Ցույց է տալիս, թե որքան արդյունավետ են երիկամները զտում արյունը։",
      en: "It shows how effectively your kidneys are filtering your blood.",
      ru: "Показывает, насколько эффективно ваши почки фильтруют кровь.",
    },
    howItChangesNextStep: {
      hy: "Սա ապահովության և համատեքստի ցուցանիշ է, ոչ թե երիկամային հիվանդության ախտորոշում։ Այն նաև ելակետ է, եթե հետագայում դեղորայք նշանակվի։",
      en: "This is a safety and context test, not a kidney-disease diagnosis. It is also the baseline if medication is started later.",
      ru: "Этот анализ помогает оценить безопасность и общую картину, но не устанавливает диагноз заболевания почек. Он также даёт исходные данные на случай, если позже будет назначено лекарство.",
    },
    priority: "baseline",
    preparation: {
      hy: "Նույն արյան նմուշից։ Անալիզից առաջ խուսափեք ինտենսիվ մարզումից։",
      en: "From the same sample. Avoid intense exercise beforehand.",
      ru: "Из того же образца крови. Перед анализом избегайте интенсивных физических нагрузок.",
    },
    method: "blood_draw",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "Կրեատինին + eGFR",
    sourceRuleIds: [...HYPERTENSION_RULES, ...KIDNEY_RULES],
  },
  {
    id: "urine-acr",
    category: "laboratory",
    name: { hy: "Միզի ալբումին/կրեատինին հարաբերություն (ACR)", en: "Urine albumin to creatinine ratio (ACR)", ru: "Соотношение альбумина и креатинина в моче (ACR)" },
    rationale: {
      hy: "Բարձր ճնշումը և դիաբետը կարող են ազդել երիկամների վրա՝ նախքան որևէ ախտանիշ ի հայտ գալը։",
      en: "High blood pressure and diabetes can affect the kidneys before any symptom appears.",
      ru: "Высокое давление и сахарный диабет могут влиять на почки ещё до появления каких-либо симптомов.",
    },
    whatItTells: {
      hy: "Հայտնաբերում է սպիտակուցի փոքր քանակներ մեզում, ինչը երիկամների ծանրաբեռնվածության վաղ նշան է։",
      en: "It looks for small amounts of protein in the urine, an early sign of strain on the kidneys.",
      ru: "Выявляет небольшое количество белка в моче, ранний признак нагрузки на почки.",
    },
    howItChangesNextStep: {
      hy: "Բարձր արժեքը կարող է բարձրացնել ընդհանուր ռիսկի կատեգորիան և փոխել բժշկի սահմանած թիրախները։",
      en: "A raised value can move the overall risk category up and changes the targets the clinician sets.",
      ru: "Повышенное значение может повысить общую категорию риска и меняет целевые значения, которые определяет врач.",
    },
    priority: "baseline",
    preparation: URINE_SAMPLE,
    method: "urine_sample",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "Միզի ACR",
    sourceRuleIds: [...HYPERTENSION_RULES, ...KIDNEY_RULES],
  },
  {
    id: "urinalysis",
    category: "laboratory",
    name: { hy: "Մեզի ընդհանուր հետազոտություն", en: "Urinalysis", ru: "Общий анализ мочи" },
    rationale: {
      hy: "Բազային ստուգման մաս է, երբ ճնշումը բարձր է կամ արդեն ախտորոշված է։",
      en: "Part of the basic check when blood pressure is raised or already diagnosed.",
      ru: "Часть базового обследования при повышенном давлении или уже установленном диагнозе артериальной гипертензии.",
    },
    whatItTells: {
      hy: "Ստուգում է մեզում արյան, սպիտակուցի, շաքարի և վարակի նշանների առկայությունը։",
      en: "It checks the urine for blood, protein, sugar and signs of infection.",
      ru: "Проверяет наличие крови, белка, глюкозы и признаков инфекции в моче.",
    },
    howItChangesNextStep: {
      hy: "Շեղումը բժշկի ուշադրությունն ուղղում է երիկամներին կամ ճնշման բարձրացման այնպիսի պատճառի, որն արժե ստուգել։",
      en: "An abnormal finding points the clinician to the kidneys, or to a cause of raised blood pressure worth checking.",
      ru: "Отклонение направляет внимание врача на почки или на причину повышенного давления, которую стоит проверить.",
    },
    priority: "baseline",
    preparation: URINE_SAMPLE,
    method: "urine_sample",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "Միզի ընդհանուր",
    sourceRuleIds: HYPERTENSION_RULES,
  },
  {
    id: "potassium",
    category: "laboratory",
    name: { hy: "Կալիում", en: "Potassium", ru: "Калий" },
    rationale: {
      hy: "Կալիումը բարձր ճնշման բազային ստուգման մաս է, և դրա ելակետը կարևոր է ճնշման որոշ դեղեր սկսելուց առաջ։",
      en: "Potassium is part of the basic check for high blood pressure, and its baseline matters before some blood pressure medicines.",
      ru: "Калий входит в базовое обследование при высоком давлении. Его исходный уровень важен перед началом приёма некоторых лекарств от давления.",
    },
    whatItTells: {
      hy: "Չափում է արյան այն աղը, որից կախված է սրտի և երիկամների աշխատանքը։",
      en: "It measures a blood salt that the heart and kidneys depend on.",
      ru: "Измеряет уровень соли в крови, от которой зависит работа сердца и почек.",
    },
    howItChangesNextStep: {
      hy: "Միջակայքից դուրս արժեքը կարող է մատնանշել ճնշման բարձրացման հորմոնալ պատճառ և ցույց տալ, թե որ դեղերն են անվտանգ։",
      en: "A value outside the range can point to a hormonal cause of raised blood pressure, and shows which medicines are safe.",
      ru: "Значение вне диапазона может указывать на гормональную причину повышенного давления и показывает, какие лекарства безопасны.",
    },
    priority: "baseline",
    preparation: SAME_DRAW,
    method: "blood_draw",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "Կալիում (K⁺)",
    sourceRuleIds: HYPERTENSION_RULES,
  },
  {
    id: "sodium",
    category: "laboratory",
    name: { hy: "Նատրիում", en: "Sodium", ru: "Натрий" },
    rationale: {
      hy: "Նատրիումը բարձր ճնշման բազային ստուգման մաս է։",
      en: "Sodium is part of the basic check for high blood pressure.",
      ru: "Натрий входит в базовое обследование при высоком давлении.",
    },
    whatItTells: {
      hy: "Չափում է արյան հիմնական աղը, որն արտացոլում է օրգանիզմի հեղուկների հավասարակշռությունը։",
      en: "It measures the main salt in the blood, which reflects the body's fluid balance.",
      ru: "Измеряет уровень основной соли в крови, который отражает баланс жидкости в организме.",
    },
    howItChangesNextStep: {
      hy: "Անսովոր արժեքը կարող է մատնանշել ճնշման բարձրացման պատճառ, որն արժե ստուգել, կամ դեղի ազդեցություն։",
      en: "An unusual value can point to a cause of raised blood pressure worth checking, or to the effect of a medicine.",
      ru: "Необычное значение может указывать на причину повышенного давления, которую стоит проверить, или на действие лекарства.",
    },
    priority: "baseline",
    preparation: SAME_DRAW,
    method: "blood_draw",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "Նատրիում (Na⁺)",
    sourceRuleIds: HYPERTENSION_RULES,
  },
  {
    id: "cbc-hb",
    category: "laboratory",
    name: { hy: "Արյան ընդհանուր հետազոտություն", en: "Full blood count", ru: "Общий анализ крови" },
    rationale: {
      hy: "Բազային ստուգման մաս է, երբ ճնշումը բարձր է կամ արդեն ախտորոշված է։",
      en: "Part of the basic check when blood pressure is raised or already diagnosed.",
      ru: "Часть базового обследования при повышенном давлении или уже установленном диагнозе артериальной гипертензии.",
    },
    whatItTells: {
      hy: "Հաշվում է արյան կարմիր և սպիտակ բջիջները, թրոմբոցիտները և չափում հեմոգլոբինը։",
      en: "It counts red and white blood cells and platelets, and measures haemoglobin.",
      ru: "Подсчитывает эритроциты, лейкоциты и тромбоциты, а также измеряет гемоглобин.",
    },
    howItChangesNextStep: {
      hy: "Սակավարյունությունը կամ այլ շեղում փոխում է ախտանիշների մեկնաբանությունը և բժշկի առաջարկած հաջորդ քայլերը։",
      en: "Anaemia or another abnormality changes how symptoms are read and which next steps the clinician suggests.",
      ru: "Анемия или другое отклонение меняет интерпретацию симптомов и следующие шаги, которые предлагает врач.",
    },
    priority: "baseline",
    preparation: SAME_DRAW,
    method: "blood_draw",
    durationMinutes: 0,
    turnaround: LAB_TURNAROUND,
    location: HOME_OR_LAB,
    catalogueRef: "Արյան ընդհանուր + լեյկոֆորմուլա",
    // Stable chest pain: decision tree Q8 «Hb», confirmed by Armen's TC-05.
    sourceRuleIds: [...HYPERTENSION_RULES, "NRN-RULE-CP-002"],
  },
  {
    id: "ecg-12-lead",
    category: "cardiovascular",
    name: { hy: "12-առաջատար ԷՍԳ", en: "12-lead ECG", ru: "ЭКГ в 12 отведениях" },
    rationale: {
      hy: "Երկարատև բարձր ճնշումը փոխում է սրտի մկանը, իսկ ռիթմի խանգարումները հաճախ անցնում են աննկատ։",
      en: "Sustained high blood pressure changes the heart muscle, and rhythm problems often go unnoticed.",
      ru: "Длительное высокое давление меняет сердечную мышцу, а нарушения ритма часто остаются незамеченными.",
    },
    whatItTells: {
      hy: "ԷՍԳ-ն գրանցում է սրտի էլեկտրական ակտիվությունը և կարող է հայտնաբերել ռիթմի, հաճախության կամ հաղորդականության շեղումներ գրանցման պահին։",
      en: "An ECG records the heart's electrical activity and can identify rhythm, rate or conduction abnormalities at the time of the recording.",
      ru: "ЭКГ регистрирует электрическую активность сердца и может выявить нарушения ритма, частоты или проводимости в момент записи.",
    },
    howItChangesNextStep: {
      hy: "Կարևոր է իմանալ՝ նորմալ ԷՍԳ-ն ինքնին չի բացառում կորոնար հիվանդությունը կամ ապագա սրտանոթային ռիսկը։ Շեղումը տանում է սրտաբանի գնահատման։",
      en: "Importantly, a normal ECG does not by itself rule out coronary disease or future cardiovascular risk. An abnormality leads to a cardiology assessment.",
      ru: "Важно: нормальная ЭКГ сама по себе не исключает ишемическую болезнь сердца или будущий сердечно-сосудистый риск. Отклонение ведёт к оценке кардиологом.",
    },
    priority: "now",
    preparation: {
      hy: "Հատուկ նախապատրաստություն չկա։ Հագեք հեշտ բացվող վերնաշապիկ։",
      en: "No special preparation. Wear a top that opens easily.",
      ru: "Специальная подготовка не нужна. Наденьте рубашку, которую легко расстегнуть.",
    },
    method: "ecg",
    durationMinutes: 10,
    turnaround: { hy: "Գրանցումը՝ տեղում, վերծանումը՝ նույն օրը", en: "Recorded on the spot, read the same day", ru: "Запись на месте, расшифровка в тот же день" },
    location: { hy: "Այցի ընթացքում՝ շարժական սարքով", en: "During the visit, with a portable device", ru: "Во время визита, с помощью переносного прибора" },
    catalogueRef: "ԷՍԳ 12 արտածում",
    sourceRuleIds: [...HYPERTENSION_RULES, "NRN-RULE-PAL-002", "NRN-RULE-PAL-003", "NRN-RULE-CMB-002", "NRN-RULE-CP-002", "RF-07", "RF-08", "RF-09", "RF-12"],
  },
  {
    id: "bp-home-log",
    category: "measurement",
    name: {
      hy: "Ճնշման 7-օրյա տնային գրանցամատյան",
      en: "7-day home blood pressure log",
      ru: "Дневник домашнего артериального давления за 7 дней",
    },
    rationale: {
      hy: "Մեկ չափումը ախտորոշում չէ։ Տնային չափումները ցույց են տալիս՝ ճնշումը կայուն բարձր է, թե ոչ։",
      en: "One reading is not a diagnosis. Home readings show whether your blood pressure is consistently raised.",
      ru: "Одно измерение не является диагнозом. Домашние измерения показывают, остаётся ли ваше давление стабильно повышенным.",
    },
    whatItTells: {
      hy: "Յոթ օրվա տնային չափումները ցույց են տալիս ձեր սովորական ճնշումը՝ առանց այցի հետ կապված բարձրացման։",
      en: "Seven days of readings at home show your usual blood pressure, without the rise a visit itself can cause.",
      ru: "Измерения дома в течение семи дней показывают ваше обычное давление без повышения, которое может вызвать сам визит.",
    },
    howItChangesNextStep: {
      hy: "Միջին ցուցանիշը որոշում է՝ խոսքը կայուն բարձրացման՞ մասին է, և հենց այն է, ինչ սրտաբանը կարդում է խորհրդատվության ժամանակ։",
      en: "The average decides whether this is a sustained elevation, and it is what the cardiologist reads at the consultation.",
      ru: "Среднее значение определяет, является ли повышение стойким. Именно его кардиолог оценивает на консультации.",
    },
    priority: "now",
    preparation: {
      hy: "Առավոտյան և երեկոյան, նստած, 5 րոպե հանգստից հետո։ Գրանցումը՝ յոթ օր անընդմեջ։",
      en: "Morning and evening, seated, after five minutes of rest. Seven days without a gap.",
      ru: "Утром и вечером, сидя, после пяти минут отдыха. Семь дней без перерыва.",
    },
    method: "home_log",
    durationMinutes: 0,
    turnaround: {
      hy: "Ամփոփումը՝ յոթերորդ օրվա վերջում",
      en: "Summary at the end of the seventh day",
      ru: "Сводка в конце седьмого дня",
    },
    location: { hy: "Տանը՝ Նորեոն Հելթի տրամադրած ապարատով", en: "At home, with a device Noreon provides", ru: "Дома, с прибором, который предоставляет Нореон Хелс" },
    catalogueRef: "HBPM 7-օրյա արձանագրություն",
    // Questionnaire Q5.2 (140–179/90–109) and DT P186–187 (reading unknown).
    // The booking path and the results page both read it from here.
    sourceRuleIds: ["NRN-RULE-BP-002", "NRN-RULE-BP-003"],
    repeatAfterDays: 90,
  },
];

export function testById(id: string): PlannedTest | undefined {
  return TEST_CATALOGUE.find((t) => t.id === id);
}

/** Tests that fall due again at the given demo day (handoff screen 21). */
export function testsDueAtDay(day: number): PlannedTest[] {
  return TEST_CATALOGUE.filter(
    (t) => t.repeatAfterDays !== undefined && day >= t.repeatAfterDays,
  );
}
