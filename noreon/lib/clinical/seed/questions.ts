import type { Answers, CoreQuestion, FieldValue } from "@/lib/clinical/types";
import { NONE, UNKNOWN } from "@/lib/clinical/types";
import { inCrisisRange } from "@/lib/clinical/rules/rules";

/**
 * The ten core screening questions.
 *
 * Transcribed from `docs/clinical/NRN-CLIN-ALG-001-*`: the wording, the answer
 * options and the branch conditions are the clinical team's, not this file's.
 * When the two disagree the document wins and this file is wrong.
 *
 * `index` drives the progress indicator. Conditional subquestions live inside
 * their parent question and carry a `showIf`, so revealing one never moves the
 * "N of 10" counter — the counter tracks core questions, not fields.
 *
 * Two branch shapes recur and are worth naming. A gate is the «right now?»
 * question, asked before frequency or history and evaluated the moment it is
 * answered; it carries `immediate`. A clarifier set is the four or five
 * questions that only open once the gate has been answered «no», which is why
 * every one of them tests the gate as well as its parent.
 */

function value(answers: Answers, id: string): FieldValue | undefined {
  return answers[id]?.value;
}

function isOneOf(answers: Answers, id: string, ...accepted: string[]): boolean {
  const v = value(answers, id);
  return typeof v === "string" && accepted.includes(v);
}

function includesOption(answers: Answers, id: string, option: string): boolean {
  const v = value(answers, id);
  return Array.isArray(v) && v.includes(option);
}

function numberValue(answers: Answers, id: string): number | undefined {
  const v = value(answers, id);
  return typeof v === "number" ? v : undefined;
}

/**
 * True once drinking frequency needs clarification, including «I don't remember».
 *
 * The AUDIT-C follow-ups and the gram estimate both hang off this. «Never»
 * ends the question, because the source is explicit that we do not suggest
 * starting, and asking a non-drinker how much they drink reads as a challenge.
 */
function drinksAlcohol(answers: Answers): boolean {
  return isOneOf(
    answers,
    "q4.frequency",
    "monthly_or_less",
    "two_to_four_month",
    "two_to_three_week",
    "four_plus_week",
    UNKNOWN,
  );
}

/** True while the chest-pain or palpitation clarifiers should be asked. */
function clarifiersOpen(
  answers: Answers,
  parentId: string,
  gateId: string,
  ...parentValues: string[]
): boolean {
  return (
    isOneOf(answers, parentId, ...parentValues) && isOneOf(answers, gateId, "no")
  );
}

export const CORE_QUESTIONS: CoreQuestion[] = [
  {
    id: "q1",
    index: 1,
    title: { hy: "Տարիք և կենսաբանական սեռ", en: "Age and biological sex", ru: "Возраст и биологический пол" },
    intro: {
      hy: "Այս երկու պատասխանը որոշում է, թե ռիսկի որ մոդելով է հաշվարկվելու ամբողջ սեսիան։",
      en: "These two answers decide which risk model the whole session is calculated with.",
      ru: "Эти два ответа определяют, по какой модели риска рассчитывается вся сессия.",
    },
    fields: [
      {
        id: "q1.age",
        kind: "number",
        label: { hy: "Քանի՞ տարեկան եք։", en: "How old are you?", ru: "Сколько вам лет?" },
        help: {
          hy: "Տարիքը սրտանոթային ռիսկի ամենաուժեղ գործոններից է։",
          en: "Age is one of the strongest cardiovascular risk factors.",
          ru: "Возраст является одним из самых значимых факторов сердечно-сосудистого риска.",
        },
        unit: { hy: "տարեկան", en: "years", ru: "лет" },
        min: 18,
        max: 110,
      },
      {
        id: "q1.sex",
        kind: "single",
        label: { hy: "Ձեր կենսաբանական սեռը", en: "Your biological sex", ru: "Ваш биологический пол" },
        help: {
          hy: "Հարցնում ենք, քանի որ սրտանոթային ռիսկի հաշվարկը տարբերվում է տղամարդկանց և կանանց մոտ։",
          en: "We ask because the risk calculation differs for men and women.",
          ru: "Мы спрашиваем, потому что расчёт риска различается для мужчин и женщин.",
        },
        options: [
          { value: "male", label: { hy: "Արական", en: "Male", ru: "Мужской" } },
          { value: "female", label: { hy: "Իգական", en: "Female", ru: "Женский" } },
        ],
      },
    ],
  },
  {
    id: "q2",
    index: 2,
    title: {
      hy: "Քաշ, շարժում և սնունդ",
      en: "Weight, activity and nutrition",
      ru: "Вес, активность и питание",
    },
    intro: {
      hy: "Ամենաերկար հարցը՝ երեք ենթամասով։ Այստեղ է որոշվում ապրելակերպի ամբողջ ծրագիրը։",
      en: "The longest question, in three parts. Your whole lifestyle plan is decided here.",
      ru: "Самый длинный вопрос, состоящий из трёх частей. Здесь определяется весь ваш план изменения образа жизни.",
    },
    fields: [
      {
        id: "q2.weight_perception",
        kind: "single",
        label: {
          hy: "Ինչպե՞ս կգնահատեք ձեր քաշը։",
          en: "How would you describe your weight?",
          ru: "Как бы вы оценили свой вес?",
        },
        help: {
          hy: "Նշեք՝ ինչպես եք գնահատում ձեր քաշը։",
          en: "Tell us what you know about your weight.",
          ru: "Расскажите, что вы знаете о своём весе.",
        },
        options: [
          { value: "ok", label: { hy: "Կարծում եմ՝ նորմալ է", en: "I think it is normal", ru: "Думаю, мой вес в норме" } },
          { value: "over", label: { hy: "Կարծում եմ՝ ավելորդ քաշ ունեմ", en: "I think I am overweight", ru: "Думаю, у меня избыточный вес" } },
          { value: UNKNOWN, label: { hy: "Չգիտեմ", en: "I don't know", ru: "Не знаю" } },
        ],
      },
      {
        id: "q2.height",
        kind: "number",
        label: { hy: "Ձեր հասակը", en: "Your height", ru: "Ваш рост" },
        unit: { hy: "սմ", en: "cm", ru: "см" },
        min: 120,
        max: 230,
      },
      {
        id: "q2.weight",
        kind: "number",
        label: { hy: "Ձեր քաշը", en: "Your weight", ru: "Ваш вес" },
        unit: { hy: "կգ", en: "kg", ru: "кг" },
        min: 30,
        max: 300,
      },
      {
        id: "q2.waist",
        kind: "number",
        label: {
          hy: "Ձեր գոտկատեղի շրջագիծը",
          en: "Your waist circumference",
          ru: "Ваша окружность талии",
        },
        help: {
          hy: "Ըստ ցանկության։ Չափեք պորտի մակարդակով, արտաշնչումից հետո, առանց ձգելու։ Գոտկատեղը առանձին շեմեր ունի և աշխատում է անկախ քաշից։",
          en: "Optional. Measure at navel level after breathing out, without pulling in. Waist has its own thresholds and works independently of weight.",
          ru: "Необязательно. Измерьте на уровне пупка после выдоха, не втягивая живот. Для окружности талии есть отдельные пороги, она учитывается независимо от веса.",
        },
        unit: { hy: "սմ", en: "cm", ru: "см" },
        min: 40,
        max: 200,
        skippable: true,
      },
      {
        id: "q2.activity",
        kind: "single",
        label: {
          hy: "Ինչպե՞ս կնկարագրեք ձեր ֆիզիկական ակտիվությունը վերջին 3 ամսվա ընթացքում։",
          en: "How would you describe your physical activity over the last 3 months?",
          ru: "Как бы вы описали свою физическую активность за последние 3 месяца?",
        },
        options: [
          {
            value: "active",
            label: {
              hy: "Ակտիվ եմ՝ շաբաթը 3 կամ ավելի անգամ մարզվում եմ",
              en: "Active, I train three or more times a week",
              ru: "Активный образ жизни, тренируюсь три или более раз в неделю",
            },
          },
          {
            value: "occasional",
            label: {
              hy: "Երբեմն եմ մարզվում, անկանոն",
              en: "I train sometimes, not regularly",
              ru: "Тренируюсь иногда, нерегулярно",
            },
          },
          {
            value: "sedentary",
            label: {
              hy: "Նստակյաց եմ՝ գրասենյակային աշխատանք, հազվադեպ եմ շարժվում",
              en: "Sedentary, desk work and little movement",
              ru: "Малоподвижный образ жизни, сидячая работа и мало движения",
            },
          },
          {
            value: "limited",
            label: {
              hy: "Առողջական պատճառով չեմ կարող մարզվել",
              en: "I cannot exercise for health reasons",
              ru: "Не могу заниматься физическими упражнениями по состоянию здоровья",
            },
          },
        ],
      },
      {
        // Only the two active answers get a volume question. Someone who is
        // sedentary or medically limited is already classified, and asking them
        // for a number they do not have would read as a reproach.
        id: "q2.activity_minutes",
        kind: "number",
        label: {
          hy: "Շաբաթվա ընթացքում ընդհանուր որքա՞ն ժամանակ եք մարզվում։",
          en: "How much time do you train in a week, in total?",
          ru: "Сколько времени в общей сложности вы тренируетесь за неделю?",
        },
        unit: { hy: "րոպե", en: "minutes", ru: "минут" },
        // Khikar, 18 Oct 2026: 500+ instead of the source's 1200, which made the
        // slider unusable. 500 reads as "500 or more", still above every
        // activity threshold, so no rule changes.
        min: 0,
        max: 500,
        openMax: true,
        showIf: (a) => isOneOf(a, "q2.activity", "active", "occasional"),
      },
      {
        id: "q2.activity_intensity",
        kind: "single",
        label: { hy: "Ի՞նչ ինտենսիվությամբ", en: "At what intensity?", ru: "С какой интенсивностью?" },
        help: {
          hy: "Չափավոր՝ շնչառությունս արագանում է, բայց կարող եմ ազատ խոսել։ Ինտենսիվ՝ շնչում եմ շատ արագ, դժվարանում եմ խոսել։",
          en: "Moderate: my breathing speeds up but I can still talk freely. Vigorous: I breathe fast and find it hard to talk.",
          ru: "Умеренная: дыхание учащается, но я могу свободно разговаривать. Высокая: я часто дышу, мне трудно разговаривать.",
        },
        options: [
          { value: "moderate", label: { hy: "Չափավոր ինտենսիվություն", en: "Moderate intensity", ru: "Умеренная интенсивность" } },
          { value: "vigorous", label: { hy: "Ինտենսիվ", en: "Vigorous", ru: "Высокая" } },
        ],
        // Gohar QA 120: no intensity for 0 minutes a week. The answer is then
        // pruned rather than stored, and 0 minutes is below the target at any
        // intensity, so no rule or band changes. A narrowing of the source's
        // Q2.3a condition, recorded in check-clinical.ts.
        showIf: (a) =>
          isOneOf(a, "q2.activity", "active", "occasional") &&
          numberValue(a, "q2.activity_minutes") !== 0,
      },
      {
        id: "q2.diet",
        kind: "multi",
        label: {
          hy: "Ինչպե՞ս եք սնվում։ Նշեք այն ամենը, ինչը ճիշտ է ձեր դեպքում։",
          en: "How do you eat? Select everything that is true for you.",
          ru: "Как вы питаетесь? Выберите всё, что относится к вам.",
        },
        help: {
          hy: "Առողջ սննդակարգի ութ բաղադրիչը։ Խորհուրդ ցույց ենք տալիս միայն չնշված կետերի համար։ Ալկոհոլը հարցնում ենք առանձին։",
          en: "The eight components of a healthy diet. We only give advice on the ones you leave unticked, and alcohol is asked separately.",
          ru: "Восемь составляющих здорового питания. Мы даём рекомендации только по тем пунктам, которые вы не отметите, а об алкоголе спрашиваем отдельно.",
        },
        options: [
          { value: "veg", label: { hy: "Օրական 200 գ և ավելի բանջարեղեն", en: "200 g or more of vegetables a day", ru: "200 г овощей или более в день" } },
          { value: "fruit", label: { hy: "Օրական 200 գ և ավելի միրգ", en: "200 g or more of fruit a day", ru: "200 г фруктов или более в день" } },
          { value: "fish", label: { hy: "Շաբաթը 1–2 անգամ ձուկ, հատկապես ճարպոտ", en: "Fish once or twice a week, oily fish especially", ru: "Рыба один или два раза в неделю, особенно жирная рыба" } },
          { value: "nuts", label: { hy: "Ամեն օր 30 գ չաղած ընկույզ", en: "30 g of unsalted nuts every day", ru: "30 г несолёных орехов каждый день" } },
          { value: "meat", label: { hy: "Կարմիր միս շաբաթը 350–500 գ-ից քիչ", en: "Less than 350 to 500 g of red meat a week", ru: "Менее 350–500 г красного мяса в неделю" } },
          { value: "grain", label: { hy: "Ամբողջական հացահատիկ՝ թեփով հաց, ձավարեղեն", en: "Whole grains, wholemeal bread and groats", ru: "Цельнозерновые продукты, цельнозерновой хлеб и крупы" } },
          { value: "salt", label: { hy: "Աղը՝ օրական 5 գ-ից քիչ", en: "Less than 5 g of salt a day", ru: "Менее 5 г соли в день" } },
          { value: "ssb", label: { hy: "Չեմ խմում շաքարով ըմպելիքներ", en: "No sugary drinks", ru: "Без сладких напитков" } },
          { value: NONE, label: { hy: "Ոչ մեկը", en: "None of these", ru: "Ничего из перечисленного" } },
        ],
      },
    ],
  },
  {
    id: "q3",
    index: 3,
    title: { hy: "Ծխելը", en: "Smoking", ru: "Курение" },
    intro: {
      hy: "Չորս պատասխան, ոչ թե երկու։ «Նախկինում ծխել եմ»-ը կլինիկապես բոլորովին այլ վիճակ է։",
      en: "Four answers, not two. «I used to smoke» is a clinically different state.",
      ru: "Четыре ответа, а не два. «Раньше я курил(а)» является отдельным состоянием с клинической точки зрения.",
    },
    fields: [
      {
        id: "q3.status",
        kind: "single",
        label: { hy: "Ծխո՞ւմ եք։", en: "Do you smoke?", ru: "Вы курите?" },
        options: [
          { value: "current", label: { hy: "Այո, ներկայումս ծխում եմ", en: "Yes, I currently smoke", ru: "Да, сейчас курю" } },
          { value: "former", label: { hy: "Նախկինում ծխել եմ, հիմա՝ ոչ", en: "I used to smoke, not any more", ru: "Раньше курил(а), сейчас нет" } },
          { value: "never", label: { hy: "Երբեք չեմ ծխել", en: "I have never smoked", ru: "Никогда не курил(а)" } },
          {
            value: "alternative",
            label: {
              hy: "Օգտագործում եմ էլեկտրոնային կամ տաքացվող ծխախոտ",
              en: "I use electronic or heated tobacco",
              ru: "Использую электронные сигареты или системы нагревания табака",
            },
          },
        ],
      },
      {
        id: "q3.years",
        kind: "number",
        label: {
          hy: "Ընդհանուր քանի՞ տարի եք ծխել կամ ծխում։",
          en: "For how many years have you smoked, in total?",
          ru: "Сколько лет в общей сложности вы курили?",
        },
        labelWhen: {
          when: (a) => isOneOf(a, "q3.status", "former"),
          label: {
            hy: "Ընդհանուր քանի՞ տարի եք ծխել։",
            en: "For how many years did you smoke, in total?",
            ru: "Сколько лет в общей сложности вы курили?",
          },
        },
        unit: { hy: "տարի", en: "years", ru: "лет" },
        min: 0,
        max: 80,
        showIf: (a) => isOneOf(a, "q3.status", "current", "former", "alternative"),
      },
      {
        id: "q3.per_day",
        kind: "number",
        label: {
          hy: "Օրական միջինում քանի՞ հատ ծխախոտ եք ծխում։",
          en: "How many cigarettes a day, on average?",
          ru: "Сколько сигарет в день в среднем?",
        },
        labelWhen: {
          when: (a) => isOneOf(a, "q3.status", "former"),
          label: {
            hy: "Օրական միջինում քանի՞ հատ ծխախոտ էիք ծխում։",
            en: "How many cigarettes a day did you smoke, on average?",
            ru: "Сколько сигарет в день вы выкуривали в среднем?",
          },
        },
        help: { hy: "Մեկ տուփը 20 հատ է։", en: "One pack is 20 cigarettes.", ru: "В одной пачке 20 сигарет." },
        unit: { hy: "հատ", en: "cigarettes", ru: "сигарет" },
        min: 0,
        max: 100,
        showIf: (a) => isOneOf(a, "q3.status", "current", "former"),
      },
      {
        id: "q3.quit_years_ago",
        kind: "number",
        label: {
          hy: "Քանի՞ տարի առաջ եք թողել ծխելը։",
          en: "How many years ago did you stop?",
          ru: "Сколько лет назад вы бросили курить?",
        },
        help: {
          hy: "Ծխելը թողնելուց հետո 5 տարվա ընթացքում ձեր ռիսկը զգալիորեն նվազում է։",
          en: "Your risk drops substantially over the five years after you stop.",
          ru: "Ваш риск существенно снижается в течение пяти лет после отказа от курения.",
        },
        unit: { hy: "տարի առաջ", en: "years ago", ru: "лет назад" },
        min: 0,
        max: 70,
        showIf: (a) => isOneOf(a, "q3.status", "former"),
      },
    ],
  },
  {
    id: "q4",
    index: 4,
    title: { hy: "Ալկոհոլի օգտագործումը", en: "Alcohol use", ru: "Употребление алкоголя" },
    intro: {
      hy: "Ալկոհոլը սննդի ցանկից առանձնացնում ենք, որովհետև հաճախականությունն ու մեկ ընդունման քանակը առանձին գնահատման կարիք ունեն։",
      en: "We ask about alcohol separately from diet, because how often you drink and how much you drink at a time need to be weighed on their own.",
      ru: "Мы спрашиваем об алкоголе отдельно от питания, потому что частоту употребления и количество за один раз нужно оценивать отдельно.",
    },
    fields: [
      {
        id: "q4.frequency",
        kind: "single",
        label: {
          hy: "Վերջին 12 ամսում որքա՞ն հաճախ եք օգտագործել ալկոհոլ պարունակող խմիչք։",
          en: "In the last 12 months, how often have you had a drink containing alcohol?",
          ru: "Как часто за последние 12 месяцев вы употребляли напитки, содержащие алкоголь?",
        },
        options: [
          { value: "never", label: { hy: "Երբեք", en: "Never", ru: "Никогда" } },
          {
            value: "monthly_or_less",
            label: { hy: "Ամսական մեկ անգամ կամ պակաս", en: "Once a month or less", ru: "Один раз в месяц или реже" },
          },
          {
            value: "two_to_four_month",
            label: { hy: "Ամսական 2–4 անգամ", en: "Two to four times a month", ru: "От двух до четырёх раз в месяц" },
          },
          {
            value: "two_to_three_week",
            label: { hy: "Շաբաթական 2–3 անգամ", en: "Two or three times a week", ru: "Два или три раза в неделю" },
          },
          {
            value: "four_plus_week",
            label: { hy: "Շաբաթական 4 կամ ավելի անգամ", en: "Four or more times a week", ru: "Четыре или более раз в неделю" },
          },
          { value: UNKNOWN, label: { hy: "Չեմ հիշում", en: "I don't remember", ru: "Не помню" } },
        ],
      },
      {
        // The two remaining AUDIT-C items. They open only once the frequency
        // question has been answered as something other than «never», which is
        // what makes the total a 0 for a person who does not drink rather than
        // three questions they were made to sit through.
        id: "q4.drinks_per_day",
        kind: "single",
        label: {
          hy: "Սովորաբար մեկ օրում քանի՞ ստանդարտ բաժին եք օգտագործում։",
          en: "On a day when you drink, how many standard drinks do you usually have?",
          ru: "Сколько стандартных порций алкоголя вы обычно выпиваете в день, когда употребляете алкоголь?",
        },
        help: {
          hy: "Մեկ ստանդարտ բաժինը մոտ 10 գ մաքուր ալկոհոլ է՝ մոտ 250 մլ 5% գարեջուր, 100 մլ 12% գինի կամ 30 մլ 40% թունդ խմիչք։",
          en: "A standard drink is about 10 g of pure alcohol: roughly 250 ml of 5% beer, 100 ml of 12% wine or 30 ml of 40% spirits.",
          ru: "Стандартная порция содержит около 10 г чистого алкоголя: примерно 250 мл пива крепостью 5%, 100 мл вина крепостью 12% или 30 мл крепкого алкоголя крепостью 40%.",
        },
        options: [
          { value: "one_two", label: { hy: "1–2 բաժին", en: "One or two", ru: "Одну или две" } },
          { value: "three_four", label: { hy: "3–4 բաժին", en: "Three or four", ru: "Три или четыре" } },
          { value: "five_six", label: { hy: "5–6 բաժին", en: "Five or six", ru: "Пять или шесть" } },
          { value: "seven_nine", label: { hy: "7–9 բաժին", en: "Seven to nine", ru: "От семи до девяти" } },
          { value: "ten_plus", label: { hy: "10 և ավելի բաժին", en: "Ten or more", ru: "Десять или более" } },
          { value: UNKNOWN, label: { hy: "Չեմ հիշում", en: "I don't remember", ru: "Не помню" } },
        ],
        showIf: (a) => drinksAlcohol(a),
      },
      {
        id: "q4.binge",
        kind: "single",
        label: {
          hy: "Որքա՞ն հաճախ եք մեկ առիթով օգտագործում 6 կամ ավելի ստանդարտ բաժին։",
          en: "How often do you have six or more standard drinks on one occasion?",
          ru: "Как часто вы выпиваете шесть или более стандартных порций алкоголя за один раз?",
        },
        options: [
          { value: "never", label: { hy: "Երբեք", en: "Never", ru: "Никогда" } },
          {
            value: "less_than_monthly",
            label: { hy: "Ամսականից պակաս", en: "Less than monthly", ru: "Реже одного раза в месяц" },
          },
          { value: "monthly", label: { hy: "Ամսական", en: "Monthly", ru: "Ежемесячно" } },
          { value: "weekly", label: { hy: "Շաբաթական", en: "Weekly", ru: "Еженедельно" } },
          {
            value: "daily",
            label: { hy: "Ամեն օր կամ գրեթե ամեն օր", en: "Daily or almost daily", ru: "Ежедневно или почти ежедневно" },
          },
          { value: UNKNOWN, label: { hy: "Չեմ հիշում", en: "I don't remember", ru: "Не помню" } },
        ],
        showIf: (a) => drinksAlcohol(a),
      },
      {
        // The decision tree scores alcohol in grams of ethanol, and a standard
        // drink is 8 to 14 g depending on the country. These two answers are
        // what turn «a glass» into a number; without them the estimate falls
        // back to the 10 g standard drink, which is why they are optional.
        id: "q4.drink_type",
        kind: "single",
        label: {
          hy: "Ո՞ր խմիչքն եք ամենից հաճախ օգտագործում։",
          en: "Which drink do you have most often?",
          ru: "Какой напиток вы употребляете чаще всего?",
        },
        options: [
          { value: "beer", label: { hy: "Գարեջուր, մոտ 5%", en: "Beer, around 5%", ru: "Пиво, около 5%" } },
          { value: "wine", label: { hy: "Գինի, մոտ 12%", en: "Wine, around 12%", ru: "Вино, около 12%" } },
          { value: "spirits", label: { hy: "Թունդ խմիչք, մոտ 40%", en: "Spirits, around 40%", ru: "Крепкий алкоголь, около 40%" } },
          { value: "mixed", label: { hy: "Տարբեր խմիչքներ", en: "A mix of drinks", ru: "Разные напитки" } },
          { value: UNKNOWN, label: { hy: "Չեմ հիշում", en: "I don't remember", ru: "Не помню" } },
        ],
        showIf: (a) => drinksAlcohol(a),
      },
      {
        id: "q4.volume_ml",
        kind: "number",
        label: {
          hy: "Մեկ ընդունման ժամանակ սովորաբար ի՞նչ ծավալ եք խմում։",
          en: "How much do you usually drink on one occasion?",
          ru: "Сколько вы обычно выпиваете за один раз?",
        },
        help: {
          hy: "Մոտավոր ծավալը բավական է։ Այն օգնում է գրամները ճշտել, երբ ձեր բաժակը ստանդարտ չափի չէ։",
          en: "An approximate volume is enough. It sharpens the gram estimate when your glass is not a standard measure.",
          ru: "Достаточно приблизительного объёма. Это уточняет расчёт в граммах, если ваш бокал не соответствует стандартной порции.",
        },
        unit: { hy: "մլ", en: "ml", ru: "мл" },
        min: 0,
        max: 3000,
        skippable: true,
        skipLabel: { hy: "Չեմ հիշում", en: "I don't remember", ru: "Не помню" },
        showIf: (a) => drinksAlcohol(a),
      },
    ],
  },
  {
    id: "q5",
    index: 5,
    title: { hy: "Զարկերակային ճնշում", en: "Blood pressure", ru: "Артериальное давление" },
    intro: {
      hy: "Այստեղ է հարցաշարի երկրորդ շտապ ելքը։",
      en: "This is the second place the questionnaire can open an emergency.",
      ru: "Это второе место в анкете, где может открыться экстренный маршрут.",
    },
    fields: [
      {
        id: "q5.diagnosed",
        kind: "single",
        label: {
          hy: "Ձեզ մոտ երբևէ հայտնաբերվե՞լ է բարձր զարկերակային ճնշում։",
          en: "Has high blood pressure ever been found in you?",
          ru: "У вас когда-либо выявляли повышенное артериальное давление?",
        },
        options: [
          { value: "treated", label: { hy: "Այո, և ընդունում եմ ճնշման դեղեր", en: "Yes, and I take medication for it", ru: "Да, и я принимаю лекарства от давления" } },
          { value: "untreated", label: { hy: "Այո, բայց դեղ չեմ ընդունում", en: "Yes, but I take no medication", ru: "Да, но я не принимаю лекарства" } },
          { value: "no", label: { hy: "Ոչ", en: "No", ru: "Нет" } },
          { value: UNKNOWN, label: { hy: "Չգիտեմ կամ երբեք չեմ չափել", en: "I don't know, or I have never measured it", ru: "Не знаю или никогда не измерял(а)" } },
        ],
      },
      {
        // Asked of everyone, including the people who answered "no" above. A
        // diagnosis and a measurement are different facts and the algorithm
        // needs both.
        id: "q5.last_reading",
        kind: "blood-pressure",
        label: {
          hy: "Նշեք ձեր ճնշման վերջին չափման արդյունքը։",
          en: "Give your most recent blood pressure reading.",
          ru: "Укажите последнее измерение вашего артериального давления.",
        },
        help: {
          hy: "Եթե հիմա չափեք, ավելի ճշգրիտ կլինի։ Եթե չեք հիշում, թողեք դատարկ։ Կգրանցվի որպես անհայտ, ոչ թե որպես նորմա։",
          en: "Measuring now is more accurate. If you don't remember, leave it blank. It is recorded as unknown, not as normal.",
          ru: "Измерение прямо сейчас будет точнее. Если не помните, оставьте поле пустым. Значение будет записано как неизвестное, а не как нормальное.",
        },
        parts: {
          systolic: { min: 60, max: 300 },
          diastolic: { min: 30, max: 200 },
        },
      },
      {
        // The hypertensive-emergency gate. Opens at 180/110 and is evaluated
        // the moment it is answered, before the questionnaire moves on.
        id: "q5.crisis_symptoms",
        kind: "multi",
        immediate: true,
        exclusiveValue: NONE,
        label: {
          hy: "Ձեր ճնշումը շատ բարձր է։ Այս պահին ունե՞ք հետևյալ ախտանիշներից որևէ մեկը։",
          en: "Your blood pressure is very high. Do you have any of these right now?",
          ru: "У вас очень высокое давление. Есть ли у вас что-либо из перечисленного прямо сейчас?",
        },
        options: [
          { value: "headache", label: { hy: "Ուժեղ գլխացավ", en: "Severe headache", ru: "Сильная головная боль" }, redFlag: true },
          { value: "vision", label: { hy: "Տեսողության խանգարում՝ մշուշ, կրկնատեսություն", en: "Vision changes, blurring or double vision", ru: "Изменения зрения, затуманивание или двоение в глазах" }, redFlag: true },
          { value: "chest", label: { hy: "Կրծքավանդակի ցավ", en: "Chest pain", ru: "Боль в груди" }, redFlag: true },
          { value: "breathless", label: { hy: "Օդի պակասի զգացում կամ շնչահեղձություն", en: "Shortness of breath", ru: "Одышка" }, redFlag: true },
          { value: "dizziness", label: { hy: "Գլխապտույտ կամ թուլություն", en: "Dizziness or weakness", ru: "Головокружение или слабость" }, redFlag: true },
          { value: "neuro", label: { hy: "Խոսքի կամ շարժման խանգարում, դեմքի ասիմետրիա", en: "Trouble speaking or moving, or a drooping face", ru: "Нарушение речи или движений либо опущение одной стороны лица" }, redFlag: true },
          { value: "seizure", label: { hy: "Ցնցումներ կամ գիտակցության պղտորում", en: "Seizures or clouded consciousness", ru: "Судороги или помрачение сознания" }, redFlag: true },
          { value: NONE, label: { hy: "Ոչ, վերոնշյալներից ոչ մեկը", en: "No, none of these", ru: "Нет, ничего из перечисленного" } },
        ],
        // The gate opens at the reading RF-03 and RF-06 fire on: ask the rule.
        showIf: (a) => inCrisisRange(a),
      },
    ],
  },
  {
    id: "q6",
    index: 6,
    title: { hy: "Ուղեկցող հիվանդություններ", en: "Existing conditions", ru: "Имеющиеся заболевания" },
    intro: {
      hy: "Միայն այն, ինչ բժիշկն է ախտորոշել։ Վեց հիվանդություն ամբողջովին փոխում է հաշվարկի ձևը՝ ռիսկը այլևս տոկոսով չի հաշվվում։",
      en: "Only what a doctor has diagnosed. Six of these change the calculation entirely: risk stops being a percentage.",
      ru: "Только то, что диагностировал врач. Шесть из них полностью меняют расчёт: риск перестаёт выражаться в процентах.",
    },
    fields: [
      {
        id: "q6.conditions",
        kind: "multi",
        exclusiveValue: NONE,
        label: {
          hy: "Ունե՞ք բժշկի կողմից ախտորոշված որևէ քրոնիկ հիվանդություն։",
          en: "Do you have any chronic condition a doctor has diagnosed?",
          ru: "Есть ли у вас хроническое заболевание, диагностированное врачом?",
        },
        options: [
          { value: "diabetes", label: { hy: "Շաքարային դիաբետ", en: "Diabetes", ru: "Сахарный диабет" } },
          { value: "prediabetes", label: { hy: "Նախաշաքարախտ", en: "Prediabetes", ru: "Преддиабет" } },
          { value: "ascvd", label: { hy: "Սրտի իշեմիկ հիվանդություն, ինֆարկտ կամ ստենտ", en: "Coronary heart disease, heart attack or a stent", ru: "Ишемическая болезнь сердца, инфаркт или установленный стент" } },
          { value: "stroke", label: { hy: "Ինսուլտ կամ անցողիկ իշեմիկ նոպա", en: "Stroke or transient ischaemic attack", ru: "Инсульт или транзиторная ишемическая атака" } },
          { value: "heart_failure", label: { hy: "Սրտի անբավարարություն", en: "Heart failure", ru: "Сердечная недостаточность" } },
          { value: "af", label: { hy: "Առիթմիա կամ նախասրտերի ֆիբրիլյացիա", en: "Arrhythmia or atrial fibrillation", ru: "Аритмия или фибрилляция предсердий" } },
          { value: "kidney", label: { hy: "Երիկամային քրոնիկ հիվանդություն", en: "Chronic kidney disease", ru: "Хроническая болезнь почек" } },
          { value: "dyslipidaemia", label: { hy: "Բարձր խոլեստերին կամ դիսլիպիդեմիա", en: "High cholesterol or dyslipidaemia", ru: "Повышенный холестерин или дислипидемия" } },
          { value: "familial_hypercholesterolaemia", label: { hy: "Ընտանեկան հիպերքոլեստերինեմիա", en: "Familial hypercholesterolaemia", ru: "Семейная гиперхолестеринемия" } },
          { value: "inflammatory", label: { hy: "Բորբոքային հիվանդություն՝ ռևմատոիդ արթրիտ, պսորիազ", en: "Inflammatory disease, rheumatoid arthritis or psoriasis", ru: "Воспалительное заболевание, ревматоидный артрит или псориаз" } },
          { value: "osa", label: { hy: "Քնային ապնոէ, արդեն ախտորոշված", en: "Sleep apnoea, already diagnosed", ru: "Апноэ сна, уже диагностированное" } },
          { value: "fatty_liver", label: { hy: "Ճարպակալված լյարդ", en: "Fatty liver disease", ru: "Жировая болезнь печени" } },
          { value: "mental_health", label: { hy: "Հոգեկան առողջության խնդիր", en: "A mental health condition", ru: "Психическое расстройство" } },
          { value: NONE, label: { hy: "Ոչ մեկը", en: "None of these", ru: "Ничего из перечисленного" } },
        ],
      },
      {
        // Unknown duration is retained for clinician review, never guessed as zero.
        id: "q6.diabetes_years",
        kind: "number",
        label: {
          hy: "Քանի՞ տարի առաջ է ձեզ ախտորոշվել շաքարային դիաբետ։",
          en: "How many years ago were you diagnosed with diabetes?",
          ru: "Сколько лет назад у вас диагностировали сахарный диабет?",
        },
        unit: { hy: "տարի առաջ", en: "years ago", ru: "лет назад" },
        min: 0,
        max: 70,
        skippable: true,
        skipLabel: { hy: "Չգիտեմ", en: "I don't know", ru: "Не знаю" },
        showIf: (a) => includesOption(a, "q6.conditions", "diabetes"),
      },
      {
        id: "q6.hba1c",
        kind: "number",
        label: {
          hy: "Գիտե՞ք ձեր վերջին HbA1c ցուցանիշը։",
          en: "Do you know your most recent HbA1c?",
          ru: "Знаете ли вы свой последний показатель HbA1c?",
        },
        help: {
          hy: "Ցույց է տալիս ձեր շաքարի միջինը վերջին 2–3 ամսում։ Ծոմ պահել պետք չէ։",
          en: "It shows your average blood sugar over the last two to three months. No fasting needed.",
          ru: "Он показывает средний уровень глюкозы в крови за последние два или три месяца. Сдавать натощак не нужно.",
        },
        unit: { hy: "%", en: "%", ru: "%" },
        min: 3,
        max: 20,
        step: 0.1,
        skippable: true,
        skipLabel: { hy: "Չգիտեմ կամ չեմ հանձնել", en: "I don't know, or I have not had it done", ru: "Не знаю или не сдавал(а) этот анализ" },
        showIf: (a) => includesOption(a, "q6.conditions", "diabetes"),
      },
    ],
  },
  {
    id: "q7",
    index: 7,
    title: { hy: "Ընտանեկան անամնեզ", en: "Family history", ru: "Семейный анамнез" },
    intro: {
      hy: "Երկու քայլ՝ ի՞նչ հիվանդություն, ապա ի՞նչ տարիքում։ Երկրորդ քայլն է որոշիչը՝ 80-ամյա պապի ինֆարկտը ռիսկի գործոն չէ։",
      en: "Two steps: which condition, then at what age. The second step is what decides. A heart attack in an 80-year-old grandfather is not a risk factor.",
      ru: "Два шага: какое заболевание, затем в каком возрасте. Второй шаг является решающим. Инфаркт у дедушки в 80 лет не является фактором риска.",
    },
    fields: [
      {
        id: "q7.relatives",
        kind: "multi",
        exclusiveValue: NONE,
        label: {
          hy: "Ձեր մերձավոր ազգականների մոտ եղե՞լ են այս հիվանդությունները։",
          en: "Have any of these happened to your close relatives?",
          ru: "Было ли что-либо из перечисленного у ваших близких родственников?",
        },
        help: { hy: "Ծնող, եղբայր, քույր, երեխա։", en: "Parent, brother, sister or child.", ru: "У родителя, брата, сестры или ребёнка." },
        options: [
          { value: "cad", label: { hy: "Սրտի կաթված կամ ստենտ և շունտավորում", en: "Heart attack, or a stent or bypass", ru: "Инфаркт, установка стента или шунтирование" } },
          { value: "stroke", label: { hy: "Ինսուլտ", en: "Stroke", ru: "Инсульт" } },
          { value: "sudden_death", label: { hy: "Հանկարծամահություն 50 տարեկանից շուտ", en: "Sudden death before the age of 50", ru: "Внезапная смерть в возрасте до 50 лет" } },
          { value: "diabetes", label: { hy: "Շաքարային դիաբետ", en: "Diabetes", ru: "Сахарный диабет" } },
          { value: "kidney", label: { hy: "Երիկամային հիվանդություն", en: "Kidney disease", ru: "Болезнь почек" } },
          { value: "familial_hypercholesterolaemia", label: { hy: "Բարձր խոլեստերին կամ ընտանեկան հիպերքոլեստերինեմիա", en: "High cholesterol or familial hypercholesterolaemia", ru: "Повышенный холестерин или семейная гиперхолестеринемия" } },
          { value: "hypertension", label: { hy: "Բարձր ճնշում", en: "High blood pressure", ru: "Повышенное артериальное давление" } },
          { value: NONE, label: { hy: "Ոչ մեկը կամ չգիտեմ", en: "None of these, or I don't know", ru: "Ничего из перечисленного или не знаю" } },
        ],
      },
      {
        // A band rather than a number: the algorithm only ever asks whether the
        // event was premature, and the bands are sex-specific.
        id: "q7.relative_age",
        kind: "single",
        label: {
          hy: "Մոտավորապես քանի՞ տարեկան էր ձեր ազգականը, երբ դա տեղի ունեցավ։",
          en: "Roughly how old was your relative when it happened?",
          ru: "Примерно сколько лет было вашему родственнику, когда это произошло?",
        },
        help: {
          hy: "Եթե մեկից ավելի են, նշեք ամենավաղ դեպքը։",
          en: "If there was more than one, give the earliest.",
          ru: "Если случаев было несколько, укажите самый ранний возраст.",
        },
        options: [
          { value: "male_under_55", label: { hy: "Տղամարդ ազգական, 55 տարեկանից շուտ", en: "A male relative, before 55", ru: "У родственника мужского пола, до 55 лет" } },
          { value: "female_under_65", label: { hy: "Կին ազգական, 65 տարեկանից շուտ", en: "A female relative, before 65", ru: "У родственницы, до 65 лет" } },
          { value: "later", label: { hy: "Ավելի ուշ տարիքում", en: "Later than that", ru: "Позже этого возраста" } },
          { value: UNKNOWN, label: { hy: "Չգիտեմ", en: "I don't know", ru: "Не знаю" } },
        ],
        showIf: (a) =>
          includesOption(a, "q7.relatives", "cad") ||
          includesOption(a, "q7.relatives", "stroke") ||
          includesOption(a, "q7.relatives", "sudden_death"),
      },
    ],
  },
  {
    id: "q8",
    index: 8,
    title: { hy: "Քունը և սթրեսը", en: "Sleep and stress", ru: "Сон и стресс" },
    intro: {
      hy: "Մեկ հարցի ներսում երկու տարբեր բան ենք ստուգում՝ քնային ապնոէ և հոգեկան ծանրաբեռնվածություն։",
      en: "One question checking two different things: sleep apnoea and mental load.",
      ru: "Один вопрос проверяет две разные вещи: апноэ сна и психологическую нагрузку.",
    },
    fields: [
      {
        id: "q8.sleep_quality",
        kind: "scale",
        label: {
          hy: "Ինչպե՞ս կգնահատեք ձեր քնի որակը։",
          en: "How would you rate the quality of your sleep?",
          ru: "Как бы вы оценили качество своего сна?",
        },
        min: 1,
        max: 10,
        scaleLabels: {
          low: { hy: "Շատ վատ", en: "Very poor", ru: "Очень плохое" },
          high: { hy: "Գերազանց", en: "Excellent", ru: "Отличное" },
        },
      },
      {
        id: "q8.sleep_hours",
        kind: "number",
        label: {
          hy: "Միջինում քանի՞ ժամ եք քնում գիշերը։",
          en: "How many hours do you sleep a night, on average?",
          ru: "Сколько часов в среднем вы спите за ночь?",
        },
        help: { hy: "Օպտիմալը մոտ 7 ժամ է։", en: "Around seven hours is optimal.", ru: "Оптимальная продолжительность составляет около семи часов." },
        unit: { hy: "ժամ", en: "hours", ru: "часов" },
        min: 2,
        max: 14,
        step: 0.5,
      },
      {
        // The apnoea branch opens on poor sleep quality, not on snoring. Someone
        // sleeping badly is the person worth asking.
        id: "q8.breathing",
        kind: "single",
        label: {
          hy: "Քնի ընթացքում խռմփո՞ւմ եք բարձր, կամ ձեզ ասե՞լ են, որ քնած ժամանակ շնչառությունը ընդհատվում է։",
          en: "Do you snore loudly, or has anyone told you your breathing stops while you sleep?",
          ru: "Вы громко храпите или вам говорили, что у вас останавливается дыхание во сне?",
        },
        options: [
          { value: "snoring", label: { hy: "Այո, բարձր խռմփում եմ", en: "Yes, I snore loudly", ru: "Да, я громко храплю" } },
          { value: "apnoea", label: { hy: "Այո, ասել են, որ շնչառությունս ընդհատվում է", en: "Yes, I have been told my breathing stops", ru: "Да, мне говорили об остановках дыхания" } },
          { value: "both", label: { hy: "Այո, երկուսն էլ", en: "Yes, both", ru: "Да, и то и другое" } },
          { value: "no", label: { hy: "Ոչ կամ չգիտեմ", en: "No, or I don't know", ru: "Нет или не знаю" } },
        ],
        showIf: (a) => {
          const quality = numberValue(a, "q8.sleep_quality");
          return quality !== undefined && quality < 7;
        },
      },
      {
        id: "q8.daytime_sleepiness",
        kind: "single",
        label: {
          hy: "Օրվա ընթացքում հաճա՞խ եք զգում ուժեղ քնկոտություն կամ հոգնածություն։",
          en: "Do you often feel very sleepy or tired during the day?",
          ru: "Вы часто чувствуете сильную сонливость или усталость в течение дня?",
        },
        help: {
          hy: "Օրինակ՝ հեռուստացույց դիտելիս, մեքենա վարելիս կամ զրուցելիս։",
          en: "For example while watching television, driving or talking.",
          ru: "Например, во время просмотра телевизора, вождения или разговора.",
        },
        options: [
          { value: "never", label: { hy: "Երբեք կամ գրեթե երբեք", en: "Never or almost never", ru: "Никогда или почти никогда" } },
          { value: "sometimes", label: { hy: "Երբեմն", en: "Sometimes", ru: "Иногда" } },
          { value: "often", label: { hy: "Հաճախ", en: "Often", ru: "Часто" } },
          { value: "daily", label: { hy: "Գրեթե ամեն օր", en: "Almost every day", ru: "Почти каждый день" } },
        ],
        showIf: (a) => isOneOf(a, "q8.breathing", "snoring", "apnoea", "both"),
      },
      {
        id: "q8.neck",
        kind: "number",
        label: {
          hy: "Եթե հնարավոր է, չափեք ձեր պարանոցի շրջագիծը։",
          en: "If you can, measure your neck circumference.",
          ru: "Если можете, измерьте окружность шеи.",
        },
        unit: { hy: "սմ", en: "cm", ru: "см" },
        min: 25,
        max: 70,
        skippable: true,
        skipLabel: { hy: "Չեմ կարող չափել", en: "I cannot measure it", ru: "Не могу измерить" },
        showIf: (a) => isOneOf(a, "q8.breathing", "snoring", "apnoea", "both"),
      },
      {
        // Asked on every path. Apnoea and stress travel together often enough
        // that the branch above must not be allowed to skip it.
        id: "q8.stress",
        kind: "single",
        label: {
          hy: "Ձեր աշխատանքը կամ առօրյան սթրեսային համարո՞ւմ եք։",
          en: "Would you call your work or your daily life stressful?",
          ru: "Вы считаете свою работу или повседневную жизнь стрессовой?",
        },
        options: [
          { value: "no", label: { hy: "Ոչ, հանգիստ եմ", en: "No, things are calm", ru: "Нет, всё спокойно" } },
          { value: "sometimes", label: { hy: "Երբեմն", en: "Sometimes", ru: "Иногда" } },
          { value: "often", label: { hy: "Այո, հաճախ", en: "Yes, often", ru: "Да, часто" } },
          { value: "always", label: { hy: "Այո, մշտապես", en: "Yes, constantly", ru: "Да, постоянно" } },
        ],
      },
    ],
  },
  {
    id: "q9",
    index: 9,
    title: { hy: "Կրծքավանդակի ցավը", en: "Chest pain", ru: "Боль в груди" },
    intro: {
      hy: "Հարցաշարի ամենակարևոր անվտանգության կետը։",
      en: "The most important safety point in the questionnaire.",
      ru: "Самый важный пункт безопасности в анкете.",
    },
    fields: [
      {
        id: "q9.present",
        kind: "single",
        label: {
          hy: "Զգո՞ւմ եք ցավ, ճնշվածություն, սեղմվածություն կամ ծանրություն կրծքավանդակում ֆիզիկական ծանրաբեռնվածության կամ սթրեսի ժամանակ։",
          en: "Do you feel pain, pressure, tightness or heaviness in your chest during exertion or stress?",
          ru: "Вы ощущаете боль, давление, стеснение или тяжесть в груди при физической нагрузке или стрессе?",
        },
        help: {
          hy: "Կարող է լինել սեղմող, ճնշող կամ այրող զգացողություն կրծքավանդակի կենտրոնում։ Երբեմն տարածվում է ձախ ձեռքին, պարանոցին, ծնոտին, թիկունքին կամ ստամոքսի շրջանին։",
          en: "It can feel like squeezing, pressing or burning in the centre of the chest. Sometimes it spreads to the left arm, the neck, the jaw, the back or the upper stomach.",
          ru: "Это может ощущаться как сжатие, давление или жжение в центре груди. Иногда ощущение распространяется в левую руку, шею, челюсть, спину или верхнюю часть живота.",
        },
        options: [
          { value: "yes", label: { hy: "Այո", en: "Yes", ru: "Да" } },
          { value: "no", label: { hy: "Ոչ", en: "No", ru: "Нет" } },
          { value: "unsure", label: { hy: "Համոզված չեմ", en: "I am not sure", ru: "Не уверен(а)" } },
        ],
      },
      {
        // The gate. Asked before frequency, before duration, before anything.
        id: "q9.right_now",
        kind: "single",
        immediate: true,
        label: {
          hy: "Այս պահին ունե՞ք այդ ցավը կամ ճնշվածությունը։",
          en: "Do you have that pain or pressure right now?",
          ru: "Есть ли у вас эта боль или давление прямо сейчас?",
        },
        options: [
          { value: "yes", label: { hy: "Այո, հիմա ունեմ", en: "Yes, right now", ru: "Да, прямо сейчас" }, redFlag: true },
          { value: "no", label: { hy: "Ոչ, հիմա չկա", en: "No, not right now", ru: "Нет, не прямо сейчас" } },
        ],
        showIf: (a) => isOneOf(a, "q9.present", "yes", "unsure"),
      },
      {
        id: "q9.frequency",
        kind: "single",
        label: { hy: "Որքա՞ն հաճախ է դա լինում։", en: "How often does it happen?", ru: "Как часто это происходит?" },
        options: [
          { value: "multi_daily", label: { hy: "Օրական մի քանի անգամ", en: "Several times a day", ru: "Несколько раз в день" } },
          { value: "daily", label: { hy: "Ամեն օր", en: "Every day", ru: "Каждый день" } },
          { value: "weekly", label: { hy: "Շաբաթը մի քանի անգամ", en: "Several times a week", ru: "Несколько раз в неделю" } },
          { value: "monthly", label: { hy: "Ամսական մի քանի անգամ", en: "Several times a month", ru: "Несколько раз в месяц" } },
          { value: "rare", label: { hy: "Հազվադեպ՝ տարվա մեջ մի քանի անգամ", en: "Rarely, a few times a year", ru: "Редко, несколько раз в год" } },
        ],
        showIf: (a) => clarifiersOpen(a, "q9.present", "q9.right_now", "yes", "unsure"),
      },
      {
        // Stable pain and worsening pain are different conditions. Without this
        // question both would be told to book a cardiologist and wait.
        id: "q9.crescendo",
        kind: "single",
        label: {
          hy: "Վերջին 4 շաբաթվա ընթացքում այդ ցավը դարձե՞լ է ավելի հաճախակի, ավելի ուժեղ, կամ առաջանո՞ւմ է ավելի փոքր ծանրաբեռնվածությունից։",
          en: "Over the last four weeks, has it become more frequent, more severe, or started coming on with less effort?",
          ru: "За последние четыре недели это стало происходить чаще, стало сильнее или стало возникать при меньшей нагрузке?",
        },
        options: [
          { value: "worse", label: { hy: "Այո, վատացել է", en: "Yes, it has got worse", ru: "Да, стало хуже" }, redFlag: true },
          { value: "same", label: { hy: "Ոչ, նույնն է", en: "No, it is the same", ru: "Нет, без изменений" } },
          { value: "better", label: { hy: "Բարելավվել է", en: "It has improved", ru: "Стало лучше" } },
        ],
        showIf: (a) => clarifiersOpen(a, "q9.present", "q9.right_now", "yes", "unsure"),
      },
      {
        id: "q9.at_rest",
        kind: "single",
        label: {
          hy: "Այդ ցավը երբևէ առաջանո՞ւմ է հանգստի ժամանակ կամ գիշերը՝ առանց ֆիզիկական ծանրաբեռնվածության։",
          en: "Does it ever come on at rest or at night, with no exertion?",
          ru: "Бывает ли это в покое или ночью, без физической нагрузки?",
        },
        options: [
          { value: "yes", label: { hy: "Այո", en: "Yes", ru: "Да" }, redFlag: true },
          { value: "no", label: { hy: "Ոչ", en: "No", ru: "Нет" } },
        ],
        showIf: (a) => clarifiersOpen(a, "q9.present", "q9.right_now", "yes", "unsure"),
      },
      {
        id: "q9.duration",
        kind: "single",
        label: { hy: "Սովորաբար որքա՞ն է տևում ցավը։", en: "How long does it usually last?", ru: "Как долго это обычно длится?" },
        options: [
          { value: "seconds", label: { hy: "Մի քանի վայրկյան", en: "A few seconds", ru: "Несколько секунд" } },
          { value: "1_5", label: { hy: "1–5 րոպե", en: "1 to 5 minutes", ru: "От 1 до 5 минут" } },
          { value: "5_15", label: { hy: "5–15 րոպե", en: "5 to 15 minutes", ru: "От 5 до 15 минут" } },
          { value: "over_15", label: { hy: "15 րոպեից ավելի", en: "More than 15 minutes", ru: "Более 15 минут" }, redFlag: true },
          { value: "variable", label: { hy: "Փոփոխական", en: "It varies", ru: "По-разному" } },
        ],
        showIf: (a) => clarifiersOpen(a, "q9.present", "q9.right_now", "yes", "unsure"),
      },
    ],
  },
  {
    id: "q10",
    index: 10,
    title: { hy: "Սրտխփոց և գլխապտույտ", en: "Palpitations and dizziness", ru: "Сердцебиение и головокружение" },
    intro: {
      hy: "Նույն կառուցվածքը, ինչ 8-րդում՝ նախ «այս պահին», հետո մանրամասները։",
      en: "The same shape as question 8: «right now» first, the details after.",
      ru: "Та же структура, что и в вопросе 8: сначала «прямо сейчас», затем подробности.",
    },
    fields: [
      {
        id: "q10.symptoms",
        kind: "single",
        label: {
          hy: "Զգացե՞լ եք հանկարծակի գլխապտույտ, թուլություն, օդի պակաս կամ մոտալուտ ուշագնացության զգացում՝ սրտխփոցի հետ միաժամանակ։",
          en: "Have you had sudden dizziness, weakness, breathlessness or a feeling you were about to faint, together with a racing heart?",
          ru: "Бывали ли у вас внезапное головокружение, слабость, одышка или предобморочное состояние вместе с учащённым сердцебиением?",
        },
        options: [
          { value: "yes", label: { hy: "Այո", en: "Yes", ru: "Да" } },
          { value: "no", label: { hy: "Ոչ", en: "No", ru: "Нет" } },
          {
            value: "palpitations_only",
            label: {
              hy: "Սրտխփոց ունեմ, բայց առանց գլխապտույտի",
              en: "I get palpitations, but without dizziness",
              ru: "У меня бывает сердцебиение, но без головокружения",
            },
          },
        ],
      },
      {
        id: "q10.right_now",
        kind: "single",
        immediate: true,
        label: {
          hy: "Այս պահին ունե՞ք այդ գանգատները։",
          en: "Do you have those symptoms right now?",
          ru: "Есть ли у вас эти симптомы прямо сейчас?",
        },
        options: [
          { value: "yes", label: { hy: "Այո, հիմա ունեմ", en: "Yes, right now", ru: "Да, прямо сейчас" }, redFlag: true },
          { value: "no", label: { hy: "Ոչ, հիմա չկա", en: "No, not right now", ru: "Нет, не прямо сейчас" } },
        ],
        showIf: (a) => isOneOf(a, "q10.symptoms", "yes"),
      },
      {
        // Decision tree Q9.1 needs breathlessness apart from the combined Q10.1 answer.
        id: "q10.breathless",
        kind: "single",
        label: {
          en: "Was shortness of breath part of this?",
          hy: "Դրա մեջ օդի պակաս եղե՞լ է։",
          ru: "Была ли при этом нехватка воздуха?",
        },
        options: [
          { value: "yes", label: { hy: "Այո", en: "Yes", ru: "Да" } },
          { value: "no", label: { hy: "Ոչ", en: "No", ru: "Нет" } },
        ],
        showIf: (a) =>
          clarifiersOpen(a, "q10.symptoms", "q10.right_now", "yes") ||
          isOneOf(a, "q10.symptoms", "palpitations_only"),
      },
      {
        id: "q10.syncope",
        kind: "single",
        label: {
          hy: "Երբևէ կորցրե՞լ եք գիտակցությունը։",
          en: "Have you ever lost consciousness?",
          ru: "Вы когда-нибудь теряли сознание?",
        },
        options: [
          {
            value: "exertion",
            label: {
              hy: "Այո, ֆիզիկական ծանրաբեռնվածության ժամանակ",
              en: "Yes, during physical exertion",
              ru: "Да, при физической нагрузке",
            },
            redFlag: true,
          },
          {
            value: "rest",
            label: {
              hy: "Այո, հանգստի ժամանակ կամ առանց նախազգուշացնող նշանների",
              en: "Yes, at rest or with no warning signs",
              ru: "Да, в покое или без предвестников",
            },
            redFlag: true,
          },
          {
            value: "vasovagal",
            label: {
              hy: "Այո, երկար կանգնելուց, արյան տեսքից կամ ցավից հետո",
              en: "Yes, after standing a long time, or at the sight of blood, or from pain",
              ru: "Да, после долгого стояния, при виде крови или от боли",
            },
          },
          { value: "never", label: { hy: "Ոչ, երբեք", en: "No, never", ru: "Нет, никогда" } },
        ],
        showIf: (a) =>
          clarifiersOpen(a, "q10.symptoms", "q10.right_now", "yes") ||
          isOneOf(a, "q10.symptoms", "palpitations_only"),
      },
      {
        id: "q10.rhythm",
        kind: "single",
        label: {
          hy: "Երբ սրտխփոց եք զգում, սրտի բաբախյունը՝",
          en: "When you feel palpitations, your heartbeat is",
          ru: "Когда вы ощущаете сердцебиение, ритм сердца",
        },
        options: [
          { value: "fast_regular", label: { hy: "Արագ է, բայց կանոնավոր", en: "Fast, but regular", ru: "Частый, но регулярный" } },
          { value: "irregular", label: { hy: "Անկանոն է, «թռչում» է", en: "Irregular, it skips", ru: "Нерегулярный, с перебоями" } },
          { value: "strong", label: { hy: "Առանձին ուժեղ հարվածներ են", en: "Single strong beats", ru: "Отдельные сильные удары" } },
          { value: UNKNOWN, label: { hy: "Չեմ կարող որոշել", en: "I cannot tell", ru: "Не могу определить" } },
        ],
        showIf: (a) =>
          clarifiersOpen(a, "q10.symptoms", "q10.right_now", "yes") ||
          isOneOf(a, "q10.symptoms", "palpitations_only"),
      },
      {
        id: "q10.episode_duration",
        kind: "single",
        label: { hy: "Որքա՞ն են տևում այդ նոպաները։", en: "How long do those episodes last?", ru: "Как долго длятся эти эпизоды?" },
        options: [
          { value: "seconds", label: { hy: "Վայրկյաններ", en: "Seconds", ru: "Секунды" } },
          { value: "under_5", label: { hy: "5 րոպեից քիչ", en: "Less than 5 minutes", ru: "Менее 5 минут" } },
          { value: "5_30", label: { hy: "5–30 րոպե", en: "5 to 30 minutes", ru: "От 5 до 30 минут" } },
          { value: "over_30", label: { hy: "30 րոպեից ավելի", en: "More than 30 minutes", ru: "Более 30 минут" }, redFlag: true },
        ],
        showIf: (a) =>
          clarifiersOpen(a, "q10.symptoms", "q10.right_now", "yes") ||
          isOneOf(a, "q10.symptoms", "palpitations_only"),
      },
    ],
  },
];

export const CORE_QUESTION_COUNT = CORE_QUESTIONS.length;

/** Fields of a question that the current answers have unlocked. */
export function visibleFields(question: CoreQuestion, answers: Answers) {
  return question.fields.filter((f) => !f.showIf || f.showIf(answers));
}

/** Ids of every field a completed assessment should have touched. */
export function expectedFieldIds(answers: Answers): string[] {
  return CORE_QUESTIONS.flatMap((q) =>
    visibleFields(q, answers).flatMap((f) =>
      f.kind === "blood-pressure"
        ? [`${f.id}.systolic`, `${f.id}.diastolic`]
        : [f.id],
    ),
  );
}

/** The field carrying a given id, wherever it sits in the nine questions. */
export function fieldById(id: string) {
  for (const question of CORE_QUESTIONS) {
    for (const field of question.fields) {
      if (field.id === id || id.startsWith(`${field.id}.`)) return field;
    }
  }
  return undefined;
}
