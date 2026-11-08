/**
 * Short lessons (Armen's coaching item 6, 20 Oct 2026): one-minute reads in Armenian first, then
 * English and Russian. This file is the only source: the app renders it and
 * scripts/lessons-draft.ts writes the review sheet for Armen from it
 * (output/zoe-lessons/LESSONS_DRAFT.md), so what he approves is exactly what members read.
 *
 * Clinical content. Every lesson starts as "draft" and becomes "approved" only on Armen's
 * (or the designated clinical owner's) sign-off, recorded here with the date in `review`.
 * Real members see approved lessons only; prod-as-staging also shows drafts with a Draft badge
 * (lib/lessons/catalogue.ts). No lesson gives a medicine dose. Armenian and Russian wording is
 * an agent draft and needs a native clinical read with the sign-off.
 *
 * Body lines are paragraphs; lines starting with "- " are list items.
 */
export const LESSON_LOCALES = ["hy", "en", "ru"] as const;
export type LessonLocale = (typeof LESSON_LOCALES)[number];
export type LessonStatus = "draft" | "approved" | "rejected";
export type LessonTopic =
  | "hypertension" | "home-bp" | "salt" | "diabetes" | "low-sugar" | "high-sugar"
  | "lipids" | "activity" | "weight" | "medicines" | "emergency";
type Text = Record<LessonLocale, string>;
type Body = Record<LessonLocale, readonly string[]>;
export type LessonSource = { label: string; url: string };
export type Lesson = {
  id: string;
  topic: LessonTopic;
  status: LessonStatus;
  /** Who signed what, and when, once Armen has reviewed it (e.g. "Approved by Armen, 2026-10-22"). */
  review?: string;
  title: Text;
  body: Body;
  sources: readonly LessonSource[];
};

const S = {
  whoHtn: { label: "WHO fact sheet: Hypertension (2023)", url: "https://www.who.int/news-room/fact-sheets/detail/hypertension" },
  esc2024: { label: "2024 ESC Guidelines for the management of elevated blood pressure and hypertension, Eur Heart J 2024", url: "https://doi.org/10.1093/eurheartj/ehae178" },
  esh2023: { label: "2023 ESH Guidelines for the management of arterial hypertension, J Hypertens 2023", url: "https://doi.org/10.1097/HJH.0000000000003480" },
  eshBpm: { label: "ESH practice guidelines for office and out-of-office blood pressure measurement, J Hypertens 2021", url: "https://doi.org/10.1097/HJH.0000000000002843" },
  stride: { label: "STRIDE BP: list of validated blood pressure monitors", url: "https://www.stridebp.org/" },
  whoSalt: { label: "WHO fact sheet: Sodium reduction (2023)", url: "https://www.who.int/news-room/fact-sheets/detail/salt-reduction" },
  whoDiet: { label: "WHO fact sheet: Healthy diet (2020)", url: "https://www.who.int/news-room/fact-sheets/detail/healthy-diet" },
  whoDm: { label: "WHO fact sheet: Diabetes (2024)", url: "https://www.who.int/news-room/fact-sheets/detail/diabetes" },
  ada6: { label: "ADA Standards of Care in Diabetes 2025, section 6: Glycemic goals and hypoglycemia", url: "https://doi.org/10.2337/dc25-S006" },
  ada5: { label: "ADA Standards of Care in Diabetes 2025, section 5: Facilitating positive health behaviors and well-being", url: "https://doi.org/10.2337/dc25-S005" },
  ada8: { label: "ADA Standards of Care in Diabetes 2025, section 8: Obesity and weight management", url: "https://doi.org/10.2337/dc25-S008" },
  adaA1c: { label: "ADA patient page: Understanding A1C", url: "https://diabetes.org/about-diabetes/a1c" },
  adaLow: { label: "ADA patient page: Hypoglycemia (low blood glucose)", url: "https://diabetes.org/living-with-diabetes/hypoglycemia-low-blood-glucose" },
  adaHigh: { label: "ADA patient page: Hyperglycemia (high blood glucose)", url: "https://diabetes.org/living-with-diabetes/treatment-care/hyperglycemia" },
  adaPlate: { label: "ADA patient page: Meal planning and the Diabetes Plate", url: "https://diabetes.org/food-nutrition/meal-planning" },
  escLipid: { label: "2019 ESC/EAS Guidelines for the management of dyslipidaemias, Eur Heart J 2020", url: "https://doi.org/10.1093/eurheartj/ehz455" },
  whoCvd: { label: "WHO fact sheet: Cardiovascular diseases (2021)", url: "https://www.who.int/news-room/fact-sheets/detail/cardiovascular-diseases-(cvds)" },
  whoPa: { label: "WHO fact sheet: Physical activity (2024)", url: "https://www.who.int/news-room/fact-sheets/detail/physical-activity" },
  whoObesity: { label: "WHO fact sheet: Obesity and overweight (2024)", url: "https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight" },
  whoAdherence: { label: "WHO: Adherence to long-term therapies, evidence for action (2003)", url: "https://iris.who.int/handle/10665/42682" },
  escAcs: { label: "2023 ESC Guidelines for the management of acute coronary syndromes, Eur Heart J 2023", url: "https://doi.org/10.1093/eurheartj/ehad191" },
  whoStroke: { label: "WHO: Stroke, Cerebrovascular accident (health topic)", url: "https://www.emro.who.int/health-topics/stroke-cerebrovascular-accident/index.html" },
} satisfies Record<string, LessonSource>;

export const LESSONS: readonly Lesson[] = [
  {
    id: "bp-numbers", topic: "hypertension", status: "draft", sources: [S.whoHtn, S.esc2024],
    title: {
      hy: "Ի՞նչ են նշանակում ձեր ճնշման թվերը",
      en: "What your blood pressure numbers mean",
      ru: "Что означают цифры вашего давления",
    },
    body: {
      hy: [
        "Զարկերակային ճնշումը ցույց է տալիս, թե ինչ ուժով է արյունը ճնշում զարկերակների պատերին։ Այն գրվում է երկու թվով, օրինակ՝ 128/82։ Վերին թիվը ճնշումն է, երբ սիրտը կծկվում է։ Ստորին թիվը ճնշումն է, երբ սիրտը հանգստանում է զարկերի միջև։",
        "Բարձր ճնշումը (հիպերտոնիա) նշանակում է, որ ճնշումը բարձր է մնում մեծ մասամբ, ոչ թե մեկ անգամ։ Այն շատ տարածված է և հաճախ ոչ մի ախտանիշ չի տալիս, ուստի իմանալու միակ ձևը չափելն է։",
        "Ձեր բժիշկը որոշում կայացնելուց առաջ նայում է ժամանակի ընթացքում արված շատ չափումների, ոչ թե մեկ թվի։ Շտապելուց, սուրճից կամ սթրեսից հետո մեկ բարձր չափումը ախտորոշում չէ։",
        "Ձեր թվերն իմանալը օգնում է ձեզ և ձեր խնամքի թիմին տեսնել՝ արդյոք ձեր պլանն աշխատում է։",
      ],
      en: [
        "Blood pressure is the force of blood pushing on the walls of your arteries. It is written as two numbers, for example 128/82. The top number is the pressure when your heart beats. The bottom number is the pressure when your heart rests between beats.",
        "High blood pressure, also called hypertension, means the pressure stays high most of the time, not just once. It is very common and often gives no symptoms, so measuring is the only way to know.",
        "Your doctor looks at many readings over time, not one number, before deciding anything. A single high reading after rushing, coffee or stress is not a diagnosis.",
        "Knowing your numbers helps you and your care team see whether your plan is working.",
      ],
      ru: [
        "Артериальное давление показывает, с какой силой кровь давит на стенки артерий. Его записывают двумя числами, например 128/82. Верхнее число это давление в момент сокращения сердца. Нижнее число это давление, когда сердце отдыхает между ударами.",
        "Повышенное давление (гипертония) означает, что давление остаётся высоким большую часть времени, а не один раз. Это очень частое состояние, и оно часто никак не ощущается, поэтому узнать о нём можно только измеряя.",
        "Прежде чем что-то решать, ваш врач смотрит на много измерений за разное время, а не на одно число. Одно высокое значение после спешки, кофе или стресса это ещё не диагноз.",
        "Зная свои цифры, вы и ваша команда ухода видите, работает ли ваш план.",
      ],
    },
  },
  {
    id: "bp-why-treat", topic: "hypertension", status: "draft", sources: [S.whoHtn, S.esc2024, S.whoCvd],
    title: {
      hy: "Ինչու բուժել ճնշումը, եթե ձեզ լավ եք զգում",
      en: "Why treat blood pressure when you feel fine",
      ru: "Зачем лечить давление, если вы хорошо себя чувствуете",
    },
    body: {
      hy: [
        "Բարձր ճնշումը սովորաբար ցավ չի պատճառում։ Դրա համար էլ հեշտ է անտեսել այն, և դրա համար էլ այն կարևոր է։",
        "Տարիների ընթացքում բարձր ճնշումը ծանրաբեռնում է սիրտը, անոթները, երիկամները, աչքերը և ուղեղը։ Այն աշխարհում ինֆարկտի և ինսուլտի հիմնական պատճառներից մեկն է։",
        "Լավ լուրն այն է, որ ճնշումն իջեցնելը նվազեցնում է այդ ռիսկերը, և օգուտը սկսվում է շուտով։ Օգնում են քիչ աղը, շատ շարժումը, առողջ քաշը, քիչ ալկոհոլը և չծխելը։ Շատերին պետք է նաև դեղ, հաճախ ողջ կյանքի ընթացքում։ Դա ձախողում չէ, դա պաշտպանություն է։",
        "Լավ զգալը չի նշանակում, որ բուժումը կարելի է դադարեցնել։ Շարունակեք դեղերն ընդունել այնպես, ինչպես նշանակել է ձեր բժիշկը, և որևէ բան փոխելուց առաջ խոսեք ձեր խնամքի թիմի հետ։",
      ],
      en: [
        "High blood pressure usually does not hurt. That is why it is easy to ignore, and why it matters.",
        "Over years, high pressure strains the heart, the blood vessels, the kidneys, the eyes and the brain. It is one of the main causes of heart attack and stroke worldwide.",
        "The good news: bringing blood pressure down lowers these risks, and the benefit starts soon. Less salt, more movement, a healthy weight, less alcohol and not smoking all help. Many people also need medicine, often for life. That is not a failure. It is protection.",
        "Feeling well is not a sign that treatment can stop. Keep taking your medicines as your doctor prescribed, and talk to your care team before changing anything.",
      ],
      ru: [
        "Повышенное давление обычно не болит. Поэтому его легко не замечать, и поэтому оно важно.",
        "За годы высокое давление перегружает сердце, сосуды, почки, глаза и мозг. Это одна из главных причин инфаркта и инсульта в мире.",
        "Хорошая новость: снижение давления уменьшает эти риски, и польза начинается быстро. Помогают меньше соли, больше движения, здоровый вес, меньше алкоголя и отказ от курения. Многим также нужны лекарства, часто на всю жизнь. Это не поражение, а защита.",
        "Хорошее самочувствие не значит, что лечение можно прекратить. Принимайте лекарства так, как назначил врач, и прежде чем что-то менять, поговорите с вашей командой ухода.",
      ],
    },
  },
  {
    id: "home-bp-how", topic: "home-bp", status: "draft", sources: [S.eshBpm, S.esh2023, S.stride],
    title: {
      hy: "Ինչպես ճիշտ չափել ճնշումը տանը",
      en: "How to measure your blood pressure at home",
      ru: "Как правильно измерять давление дома",
    },
    body: {
      hy: [
        "Ճիշտ տեխնիկան ձեր չափումները դարձնում է վստահելի։",
        "- Չափելուց 30 րոպե առաջ մի խմեք սուրճ, մի ծխեք և մի մարզվեք։ Դատարկեք միզապարկը։",
        "- Նստեք աթոռին՝ մեջքը հենած, ոտքերը հատակին։ Ոտքերը մի խաչեք։",
        "- Հանգիստ նստեք 5 րոպե։ Չափման ժամանակ մի խոսեք։",
        "- Մանժետը դրեք մերկ ուսին, սրտի մակարդակով, ձեռքը սեղանին հենած։",
        "- Արեք 2 չափում՝ 1 րոպե ընդմիջումով, և գրանցեք երկուսն էլ։",
        "- Չափեք առավոտյան՝ դեղերից և նախաճաշից առաջ, և երեկոյան, ինչպես խնդրել է ձեր խնամքի թիմը։",
        "Օգտագործեք ուսի սարք, որը կլինիկորեն ստուգված է։ Դաստակի սարքերը ավելի քիչ ճշգրիտ են։",
        "Մուտքագրեք չափումները հավելվածում, որպեսզի ձեր խնամքի թիմը տեսնի նույն թվերը, ինչ դուք։",
      ],
      en: [
        "Good technique makes your readings trustworthy.",
        "- In the 30 minutes before: no coffee, smoking or exercise. Empty your bladder.",
        "- Sit on a chair with your back supported and your feet flat on the floor. Do not cross your legs.",
        "- Rest quietly for 5 minutes. Do not talk during the measurement.",
        "- Put the cuff on your bare upper arm, at the level of your heart, with your arm resting on a table.",
        "- Take 2 readings, 1 minute apart, and record both.",
        "- Measure in the morning before medicines and breakfast, and in the evening, as your care team asked.",
        "Use an upper-arm device that has been clinically validated. Wrist devices are less reliable.",
        "Enter your readings in the app so your care team sees the same numbers you do.",
      ],
      ru: [
        "Правильная техника делает ваши измерения надёжными.",
        "- За 30 минут до измерения: без кофе, курения и физической нагрузки. Опорожните мочевой пузырь.",
        "- Сядьте на стул, опираясь спиной, ступни на полу. Не скрещивайте ноги.",
        "- Посидите спокойно 5 минут. Не разговаривайте во время измерения.",
        "- Наденьте манжету на голое плечо, на уровне сердца, рука лежит на столе.",
        "- Сделайте 2 измерения с перерывом в 1 минуту и запишите оба.",
        "- Измеряйте утром до лекарств и завтрака и вечером, как попросила ваша команда ухода.",
        "Пользуйтесь клинически проверенным прибором для плеча. Приборы на запястье менее точны.",
        "Вносите измерения в приложение, чтобы ваша команда ухода видела те же цифры, что и вы.",
      ],
    },
  },
  {
    id: "home-bp-high-reading", topic: "home-bp", status: "draft", sources: [S.esh2023, S.esc2024],
    title: {
      hy: "Ի՞նչ անել, եթե տանը ճնշումը բարձր է",
      en: "What to do with a high home reading",
      ru: "Что делать, если дома давление высокое",
    },
    body: {
      hy: [
        "Մեկ բարձր չափումը հաճախ է պատահում և խուճապի պատճառ չէ։",
        "- Հանգիստ նստեք 5 րոպե և նորից չափեք ճիշտ տեխնիկայով։",
        "- Եթե այն դեռ բարձր է, բայց ձեզ լավ եք զգում, գրանցեք այն հավելվածում։ Ձեր խնամքի թիմը տեսնում է ձեր չափումները և նայում է օրերի ընթացքում պատկերին։",
        "- Մեկ չափման պատճառով մի ընդունեք լրացուցիչ դեղ և մի բաց թողեք ընդունումը, եթե ձեր բժիշկը այդպես չի ասել։",
        "Անմիջապես զանգահարեք 103, եթե շատ բարձր ճնշման հետ (օրինակ՝ 180/110 կամ ավելի) կա կրծքավանդակի ցավ, շնչահեղձություն, ուժեղ գլխացավ, թուլություն կամ թմրածություն, խոսելու դժվարություն կամ տեսողության փոփոխություն։",
        "Ցածր ճնշումը գլխապտույտով կամ ուշագնացությամբ նույնպես ուշադրություն է պահանջում. նստեք կամ պառկեք և տեղեկացրեք ձեր խնամքի թիմին։",
      ],
      en: [
        "One high reading is common and is not a reason to panic.",
        "- Sit quietly for 5 minutes and measure again with good technique.",
        "- If it is still high but you feel well, record it in the app. Your care team sees your readings and looks at the pattern over days.",
        "- Do not take extra medicine or skip a dose because of one reading unless your doctor told you to.",
        "Call 103 now if a very high reading (for example 180/110 or above) comes with chest pain, shortness of breath, a severe headache, weakness or numbness, trouble speaking, or changes in vision.",
        "A low reading with dizziness or fainting also needs attention: sit or lie down and tell your care team.",
      ],
      ru: [
        "Одно высокое измерение бывает часто и не повод для паники.",
        "- Посидите спокойно 5 минут и измерьте снова, соблюдая технику.",
        "- Если давление всё ещё высокое, но вы чувствуете себя хорошо, внесите его в приложение. Ваша команда ухода видит измерения и смотрит на картину за несколько дней.",
        "- Не принимайте лишнее лекарство и не пропускайте приём из-за одного измерения, если врач не говорил так делать.",
        "Звоните 103 сразу, если очень высокое давление (например 180/110 и выше) сопровождается болью в груди, одышкой, сильной головной болью, слабостью или онемением, нарушением речи или изменением зрения.",
        "Низкое давление с головокружением или обмороком тоже требует внимания: сядьте или лягте и сообщите вашей команде ухода.",
      ],
    },
  },
  {
    id: "salt-less", topic: "salt", status: "draft", sources: [S.whoSalt, S.esc2024],
    title: {
      hy: "Ավելի քիչ աղ՝ քայլ առ քայլ",
      en: "Less salt, step by step",
      ru: "Меньше соли, шаг за шагом",
    },
    body: {
      hy: [
        "Աղի մեծ մասը արդեն սննդի մեջ է, նախքան աղամանին ձեռք տալը։ ԱՀԿ-ն մեծահասակներին խորհուրդ է տալիս օրական 5 գրամից քիչ աղ՝ ընդհանուր մոտ մեկ թեյի գդալ՝ բոլոր ուտելիքներից միասին։",
        "Առօրյա սննդի մեջ աղի մեծ աղբյուրներն են հացն ու լավաշը, պանիրը (օրինակ՝ բրինձան), թթուներն ու մարինադները, երշիկը, բաստուրման ու սուջուխը, պահածոները, պատրաստի սոուսները և արագ պատրաստվող արիշտան։",
        "Լավագույնս աշխատում են փոքր քայլերը.",
        "- Համտեսեք, նախքան աղ ավելացնելը, և աղամանը հանեք սեղանից։",
        "- Ընտրեք թարմ կամ սառեցված բանջարեղեն թթուների փոխարեն։",
        "- Աղի պանիրը ուտելուց առաջ պահեք ջրի մեջ։",
        "- Համ տվեք կանաչիով, սխտորով, կիտրոնով, պղպեղով և համեմունքներով։",
        "Ձեր համը հարմարվում է մի քանի շաբաթում, իսկ քիչ աղը կարող է իջեցնել ճնշումը։",
      ],
      en: [
        "Most of the salt we eat is already in food before we reach for the salt shaker. WHO advises adults to eat less than 5 grams of salt a day, about one level teaspoon in total, from all foods together.",
        "Big sources in everyday meals: bread and lavash, cheese such as brynza, pickles and marinated vegetables, sausage, basturma and sujukh, canned food, ready sauces and instant noodles.",
        "Small steps work best:",
        "- Taste before adding salt, and take the shaker off the table.",
        "- Choose fresh or frozen vegetables instead of pickled ones.",
        "- Soak salty cheese in water before eating it.",
        "- Add flavour with herbs, garlic, lemon, pepper and spices instead.",
        "Your taste adapts in a few weeks, and less salt can lower blood pressure.",
      ],
      ru: [
        "Большая часть соли уже есть в еде, прежде чем мы берём солонку. ВОЗ советует взрослым меньше 5 граммов соли в день, это примерно одна чайная ложка без горки на все продукты вместе.",
        "Главные источники в обычной еде: хлеб и лаваш, сыр (например брынза), соленья и маринады, колбаса, бастурма и суджух, консервы, готовые соусы и лапша быстрого приготовления.",
        "Лучше всего работают маленькие шаги:",
        "- Пробуйте еду, прежде чем солить, и уберите солонку со стола.",
        "- Выбирайте свежие или замороженные овощи вместо солёных.",
        "- Вымачивайте солёный сыр в воде перед едой.",
        "- Добавляйте вкус зеленью, чесноком, лимоном, перцем и специями.",
        "Вкус привыкает за несколько недель, а меньше соли может снизить давление.",
      ],
    },
  },
  {
    id: "salt-labels", topic: "salt", status: "draft", sources: [S.whoSalt, S.whoDiet],
    title: {
      hy: "Ինչպես գտնել թաքնված աղը պիտակի վրա",
      en: "Finding hidden salt on food labels",
      ru: "Как найти скрытую соль на этикетке",
    },
    body: {
      hy: [
        "Փաթեթավորված սնունդը հաճախ թաքցնում է աղը։ Պիտակը օգնում է։",
        "- Նայեք «աղ» կամ «նատրիում» տողին՝ 100 գրամի համար։",
        "- Եթե գրված է միայն նատրիումը, բազմապատկեք 2,5-ով՝ աղի քանակը ստանալու համար։ Օրինակ՝ 0,4 գ նատրիումը մոտ 1 գ աղ է։",
        "- Համեմատեք երկու նման ապրանք և ընտրեք ավելի քիչ աղ ունեցողը։",
        "- Հետևեք բաժնի չափին. շատ աղի սննդի փոքր քանակն էլ է գումարվում։",
        "Ռեստորանի և փռի սնունդը պիտակ չունի, ուստի հնարավորության դեպքում խնդրեք քիչ աղ կամ սոուսը առանձին։",
        "Կատարյալ լինել պետք չէ։ Մի քանի առօրյա ապրանք փոխարինելը ամենամեծ տարբերությունն է տալիս։",
      ],
      en: [
        "Packaged food often hides salt. The label helps.",
        "- Look for the salt or sodium line, per 100 grams.",
        "- If only sodium is listed, multiply it by 2.5 to get salt. For example, 0.4 g of sodium is about 1 g of salt.",
        "- Compare two similar products and choose the one with less.",
        "- Watch the portion: a small amount of a very salty food still adds up.",
        "Restaurant and bakery food has no label, so ask for less salt, or the sauce on the side, when you can.",
        "You do not need to be perfect. Swapping a few everyday items makes the biggest difference.",
      ],
      ru: [
        "Упакованные продукты часто скрывают соль. Этикетка помогает.",
        "- Ищите строку «соль» или «натрий» на 100 граммов.",
        "- Если указан только натрий, умножьте его на 2,5, чтобы получить соль. Например, 0,4 г натрия это около 1 г соли.",
        "- Сравните два похожих продукта и выберите тот, где соли меньше.",
        "- Следите за порцией: немного очень солёной еды тоже складывается.",
        "У еды из ресторана и пекарни нет этикетки, поэтому по возможности просите меньше соли или соус отдельно.",
        "Не нужно быть идеальным. Замена нескольких привычных продуктов даёт самый большой эффект.",
      ],
    },
  },
  {
    id: "diabetes-basics", topic: "diabetes", status: "draft", sources: [S.whoDm, S.ada5],
    title: {
      hy: "Ի՞նչ է 2-րդ տիպի շաքարային դիաբետը",
      en: "What type 2 diabetes is",
      ru: "Что такое сахарный диабет 2 типа",
    },
    body: {
      hy: [
        "Ձեր օրգանիզմը սնունդը վերածում է շաքարի (գլյուկոզի)՝ էներգիայի համար։ Ինսուլին կոչվող հորմոնն օգնում է շաքարին արյունից անցնել բջիջներ։",
        "2-րդ տիպի դիաբետի դեպքում օրգանիզմը լավ չի արձագանքում ինսուլինին, և ժամանակի ընթացքում կարող է բավարար ինսուլին չարտադրել։ Արդյունքում շաքարը կուտակվում է արյան մեջ։",
        "Տարիներով բարձր շաքարը կարող է վնասել սիրտը, անոթները, երիկամները, աչքերը, նյարդերը և ոտքերը։ Հաճախ երկար ժամանակ ախտանիշներ չկան։",
        "2-րդ տիպի դիաբետը կարելի է կառավարել։ Առողջ սնունդը, կանոնավոր շարժումը, անհրաժեշտության դեպքում քաշի նվազեցումը և բժշկի նշանակած դեղերը իջեցնում են շաքարը և պաշտպանում օրգանիզմը։ Աչքերի, ոտքերի և երիկամների կանոնավոր ստուգումները վաղ են հայտնաբերում խնդիրները։",
        "Դուք մենակ չեք. ձեր խնամքի թիմը պլանի վրա աշխատում է ձեզ հետ։",
      ],
      en: [
        "Your body turns food into sugar, called glucose, for energy. A hormone called insulin helps sugar move from the blood into your cells.",
        "In type 2 diabetes, the body does not respond well to insulin, and over time it may not make enough. Sugar then builds up in the blood.",
        "High blood sugar over years can harm the heart, blood vessels, kidneys, eyes, nerves and feet. Often there are no symptoms for a long time.",
        "Type 2 diabetes can be managed. Healthy eating, regular activity, weight loss if needed, and medicines your doctor prescribes all lower blood sugar and protect your body. Regular checks of your eyes, feet and kidneys catch problems early.",
        "You are not alone in this: your care team works on the plan with you.",
      ],
      ru: [
        "Организм превращает еду в сахар (глюкозу) для энергии. Гормон инсулин помогает сахару переходить из крови в клетки.",
        "При диабете 2 типа организм плохо отвечает на инсулин, а со временем может вырабатывать его недостаточно. Тогда сахар накапливается в крови.",
        "Высокий сахар в течение лет может повредить сердце, сосуды, почки, глаза, нервы и стопы. Часто долгое время нет никаких симптомов.",
        "Диабетом 2 типа можно управлять. Здоровое питание, регулярная активность, снижение веса при необходимости и лекарства, назначенные врачом, снижают сахар и защищают организм. Регулярные проверки глаз, стоп и почек помогают заметить проблемы рано.",
        "Вы не одни: ваша команда ухода работает над планом вместе с вами.",
      ],
    },
  },
  {
    id: "diabetes-hba1c", topic: "diabetes", status: "draft", sources: [S.adaA1c, S.ada6],
    title: {
      hy: "Ի՞նչ է ցույց տալիս HbA1c-ն",
      en: "What HbA1c tells you",
      ru: "Что показывает HbA1c",
    },
    body: {
      hy: [
        "HbA1c-ն (գլիկացված հեմոգլոբին) արյան անալիզ է, որը ցույց է տալիս ձեր շաքարի միջին մակարդակը վերջին 2-3 ամսում։ Մատից շաքարի չափումը ցույց է տալիս մեկ պահ, իսկ HbA1c-ն՝ ավելի մեծ պատկերը։",
        "Այն գրվում է տոկոսով, օրինակ՝ 7,2%։ Ավելի բարձր թիվը նշանակում է, որ շաքարը միջինում ավելի բարձր է եղել։",
        "Ձեր բժիշկը սահմանում է ձեզ հարմար նպատակ՝ հաշվի առնելով տարիքը, առողջությունը և դեղերը։ Շատ մեծահասակների համար այն մոտ 7% է, բայց ձերը կարող է տարբեր լինել։",
        "HbA1c-ն սովորաբար ստուգում են 3-6 ամիսը մեկ։ Քանի որ այն դանդաղ է փոխվում, այսօր արված փոփոխությունները կերևան հաջորդ անալիզում։",
        "Հարցրեք ձեր խնամքի թիմին, թե ինչ է նշանակում ձեր վերջին արդյունքը և որն է ձեր նպատակը։",
      ],
      en: [
        "HbA1c is a blood test that shows your average blood sugar over the last 2 to 3 months. A finger-prick test shows one moment. HbA1c shows the bigger picture.",
        "It is written as a percentage, for example 7.2%. A higher number means your sugar has been higher on average.",
        "Your doctor sets a target that fits you, based on your age, health and medicines. For many adults it is around 7%, but yours may be different.",
        "HbA1c is usually checked every 3 to 6 months. Because it changes slowly, the changes you make today will show in your next test.",
        "Ask your care team what your last result means and what your target is.",
      ],
      ru: [
        "HbA1c (гликированный гемоглобин) это анализ крови, который показывает средний уровень сахара за последние 2–3 месяца. Анализ из пальца показывает один момент, а HbA1c показывает общую картину.",
        "Его записывают в процентах, например 7,2%. Чем выше число, тем выше был сахар в среднем.",
        "Ваш врач ставит цель, подходящую именно вам, с учётом возраста, здоровья и лекарств. Для многих взрослых это около 7%, но ваша цель может быть другой.",
        "HbA1c обычно проверяют раз в 3–6 месяцев. Он меняется медленно, поэтому то, что вы меняете сегодня, будет видно в следующем анализе.",
        "Спросите вашу команду ухода, что означает ваш последний результат и какая у вас цель.",
      ],
    },
  },
  {
    id: "low-sugar-signs", topic: "low-sugar", status: "draft", sources: [S.adaLow, S.ada6],
    title: {
      hy: "Ցածր շաքար. նախազգուշացնող նշաններ",
      en: "Low blood sugar: warning signs",
      ru: "Низкий сахар: тревожные признаки",
    },
    body: {
      hy: [
        "Շաքարը կարող է չափազանց իջնել (հիպոգլիկեմիա), եթե ընդունում եք ինսուլին կամ դիաբետի որոշ հաբեր, բաց եք թողել ուտելը, խմել եք ալկոհոլ կամ սովորականից շատ եք շարժվել։",
        "Վաղ նշաններ.",
        "- դող, քրտնարտադրություն, արագ սրտխփոց",
        "- հանկարծակի սով, անհանգստություն կամ դյուրագրգռություն",
        "- գլխապտույտ, մշուշոտ տեսողություն, գլխացավ",
        "Եթե գլյուկոմետր ունեք, չափեք։ Եթե բժիշկը ձեզ ցածր շաքարի պլան է տվել, հետևեք դրան։ Ընդհանուր կանոնը. ընդունեք արագ շաքար, օրինակ՝ կես բաժակ հյութ կամ 3-4 կտոր շաքար, սպասեք 15 րոպե և նորից չափեք։",
        "Զանգահարեք 103, եթե մարդը շփոթված է, շատ քնկոտ է, ցնցումներ ունի կամ չի կարող անվտանգ կուլ տալ։ Լիովին արթուն չեղող մարդու բերանը սնունդ կամ խմիչք մի դրեք։",
        "Ամեն ցածր շաքարի մասին տեղեկացրեք ձեր խնամքի թիմին, որպեսզի պլանը հնարավոր լինի ճշգրտել։",
      ],
      en: [
        "Blood sugar can drop too low, called hypoglycaemia, if you take insulin or some diabetes tablets, skip a meal, drink alcohol, or are more active than usual.",
        "Early signs:",
        "- shaking, sweating, a fast heartbeat",
        "- sudden hunger, feeling anxious or irritable",
        "- dizziness, blurred vision, a headache",
        "If you have a meter, check. If your doctor gave you a plan for low sugar, follow it. A common rule: take some fast sugar, such as half a glass of juice or 3 to 4 sugar cubes, wait 15 minutes, and check again.",
        "Call 103 if the person is confused, very drowsy, has a seizure, or cannot swallow safely. Do not put food or drink in the mouth of someone who is not fully awake.",
        "Tell your care team about every low, so your plan can be adjusted.",
      ],
      ru: [
        "Сахар может упасть слишком низко (гипогликемия), если вы принимаете инсулин или некоторые таблетки от диабета, пропустили еду, выпили алкоголь или двигались больше обычного.",
        "Ранние признаки:",
        "- дрожь, потливость, учащённое сердцебиение",
        "- внезапный голод, тревога или раздражительность",
        "- головокружение, нечёткое зрение, головная боль",
        "Если у вас есть глюкометр, измерьте сахар. Если врач дал вам план на случай низкого сахара, следуйте ему. Общее правило: примите быстрый сахар, например полстакана сока или 3–4 кусочка сахара, подождите 15 минут и измерьте снова.",
        "Звоните 103, если человек спутан, очень сонлив, у него судороги или он не может безопасно глотать. Не давайте еду или питьё человеку, который не полностью в сознании.",
        "Сообщайте вашей команде ухода о каждом эпизоде низкого сахара, чтобы план можно было поправить.",
      ],
    },
  },
  {
    id: "high-sugar-signs", topic: "high-sugar", status: "draft", sources: [S.adaHigh, S.ada6],
    title: {
      hy: "Բարձր շաքար. նախազգուշացնող նշաններ",
      en: "High blood sugar: warning signs",
      ru: "Высокий сахар: тревожные признаки",
    },
    body: {
      hy: [
        "Շաքարը կարող է բարձրանալ, երբ հիվանդ եք, սթրեսի մեջ եք, քիչ եք շարժվում, սովորականից շատ ածխաջրեր եք ուտում կամ բաց եք թողնում դեղերը։",
        "Ուշադրություն դարձրեք՝",
        "- ուժեղ ծարավ և բերանի չորություն",
        "- հաճախակի միզարձակում",
        "- հոգնածություն, մշուշոտ տեսողություն",
        "- վարակներ կամ վերքեր, որոնք դանդաղ են լավանում",
        "Եթե նկատում եք դրանք, չափեք շաքարը, եթե գլյուկոմետր ունեք, ջուր խմեք և տեղեկացրեք ձեր խնամքի թիմին։ Ինքնուրույն մի փոխեք դեղի չափաբաժինը։",
        "Զանգահարեք 103, եթե բարձր շաքարի հետ կա փսխում, որովայնի ցավ, արագ կամ խորը շնչառություն, բերանից մրգային հոտ, ուժեղ քնկոտություն կամ շփոթվածություն։ Դրանք կարող են լինել վտանգավոր վիճակի նշաններ, որը հիվանդանոցային բուժում է պահանջում։",
      ],
      en: [
        "Blood sugar can run high when you are ill or stressed, move less, eat more carbohydrates than usual, or miss medicines.",
        "Signs to notice:",
        "- strong thirst and a dry mouth",
        "- passing urine often",
        "- tiredness, blurred vision",
        "- infections or cuts that heal slowly",
        "If you notice these, check your sugar if you have a meter, drink water, and tell your care team. Do not change your medicine dose on your own.",
        "Call 103 if high sugar comes with vomiting, stomach pain, fast or deep breathing, a fruity smell on the breath, strong drowsiness or confusion. These can be signs of a dangerous condition that needs hospital care.",
      ],
      ru: [
        "Сахар может повышаться, когда вы болеете или в стрессе, мало двигаетесь, едите больше углеводов, чем обычно, или пропускаете лекарства.",
        "Обратите внимание:",
        "- сильная жажда и сухость во рту",
        "- частое мочеиспускание",
        "- усталость, нечёткое зрение",
        "- инфекции или ранки, которые долго заживают",
        "Если вы это замечаете, измерьте сахар, если есть глюкометр, пейте воду и сообщите вашей команде ухода. Не меняйте дозу лекарства самостоятельно.",
        "Звоните 103, если высокий сахар сопровождается рвотой, болью в животе, частым или глубоким дыханием, фруктовым запахом изо рта, сильной сонливостью или спутанностью. Это могут быть признаки опасного состояния, которое требует лечения в больнице.",
      ],
    },
  },
  {
    id: "cholesterol-basics", topic: "lipids", status: "draft", sources: [S.escLipid, S.whoCvd],
    title: {
      hy: "Խոլեստերինը պարզ բառերով",
      en: "Cholesterol in plain words",
      ru: "Холестерин простыми словами",
    },
    body: {
      hy: [
        "Խոլեստերինը ճարպ է, որն անհրաժեշտ է օրգանիզմին և արյան մեջ տեղափոխվում է մասնիկներով։ Երկուսն են ամենակարևորը.",
        "- LDL, որը հաճախ անվանում են «վատ» խոլեստերին։ Դրա ավելցուկը տարիների ընթացքում կուտակվում է զարկերակների պատերին և նեղացնում դրանք։",
        "- HDL, որը հաճախ անվանում են «լավ» խոլեստերին։ Այն օգնում է հեռացնել խոլեստերինը։",
        "Բարձր LDL-ը ախտանիշներ չի տալիս։ Այն երևում է լիպիդային պրոֆիլ կոչվող արյան անալիզում։",
        "Ձեր LDL-ի նպատակը կախված է ինֆարկտի և ինսուլտի ձեր ընդհանուր ռիսկից, որը բժիշկը գնահատում է տարիքից, ճնշումից, շաքարից, ծխելուց և այլ գործոններից։ Որքան բարձր է ռիսկը, այնքան ցածր է նպատակը։",
        "Օգնում են քիչ հագեցած ճարպը (յուղոտ միս, կարագ, խմորեղեն), շատ բանջարեղենը, լոբազգիները և ամբողջական հացահատիկը, շարժումը և չծխելը։ Շատերին պետք է նաև դեղ։",
      ],
      en: [
        "Cholesterol is a fat your body needs, carried in the blood by particles. Two matter most:",
        "- LDL, often called bad cholesterol. Too much of it builds up in artery walls and narrows them over years.",
        "- HDL, often called good cholesterol. It helps carry cholesterol away.",
        "High LDL gives no symptoms. A blood test called a lipid profile shows it.",
        "Your LDL target depends on your overall risk of heart attack and stroke, which your doctor estimates from your age, blood pressure, sugar, smoking and other factors. The higher your risk, the lower the target.",
        "Less saturated fat (fatty meat, butter, pastries), more vegetables, beans and whole grains, moving more and not smoking all help. Many people also need medicine.",
      ],
      ru: [
        "Холестерин это жир, который нужен организму. В крови его переносят частицы. Важнее всего две:",
        "- ЛПНП, его часто называют «плохим» холестерином. Его избыток годами откладывается в стенках артерий и сужает их.",
        "- ЛПВП, его часто называют «хорошим» холестерином. Он помогает выводить холестерин.",
        "Высокий ЛПНП никак не ощущается. Его показывает анализ крови, липидный профиль.",
        "Ваша цель по ЛПНП зависит от общего риска инфаркта и инсульта, который врач оценивает по возрасту, давлению, сахару, курению и другим факторам. Чем выше риск, тем ниже цель.",
        "Помогают меньше насыщенных жиров (жирное мясо, сливочное масло, выпечка), больше овощей, бобовых и цельных злаков, движение и отказ от курения. Многим также нужны лекарства.",
      ],
    },
  },
  {
    id: "cholesterol-medicine", topic: "lipids", status: "draft", sources: [S.escLipid],
    title: {
      hy: "Ինչու է խոլեստերինի դեղը երկարաժամկետ",
      en: "Why cholesterol medicine is long term",
      ru: "Почему лекарство от холестерина принимают долго",
    },
    body: {
      hy: [
        "Ստատիններ կոչվող դեղերը իջեցնում են LDL խոլեստերինը։ Դրանք աշխարհում ամենաշատ ուսումնասիրված դեղերից են և նվազեցնում են ինֆարկտի ու ինսուլտի ռիսկը։",
        "Դրանք աշխատում են միայն այնքան ժամանակ, որքան ընդունում եք։ Եթե դադարեցնեք, խոլեստերինը մի քանի շաբաթում նորից կբարձրանա, նույնիսկ եթե վերջին անալիզը լավ էր։",
        "Մարդկանց մեծ մասը դրանք ընդունում է առանց խնդիրների։ Տեղեկացրեք ձեր խնամքի թիմին, եթե ունեք մկանային ցավ կամ թուլություն, մուգ մեզ կամ որևէ նոր բան, որը ձեզ անհանգստացնում է։ Ինքնուրույն մի դադարեցրեք. հաճախ կա պարզ լուծում, օրինակ՝ բժշկի ընտրած այլ դեղ։",
        "Դեղն սկսելուց հետո բժիշկը կստուգի խոլեստերինը՝ տեսնելու, որ դեղը կատարում է իր գործը։",
      ],
      en: [
        "Medicines called statins lower LDL cholesterol. They are among the most studied medicines in the world, and they lower the risk of heart attack and stroke.",
        "They work only while you take them. If you stop, cholesterol goes back up within weeks, even if your last test looked good.",
        "Most people take them without problems. Tell your care team if you have muscle pain or weakness, dark urine, or anything new that worries you. Do not stop on your own: there is often a simple fix, such as a different medicine chosen by your doctor.",
        "Your doctor will check your cholesterol after you start, to see that the medicine is doing its job.",
      ],
      ru: [
        "Лекарства, которые называются статинами, снижают холестерин ЛПНП. Это одни из самых изученных лекарств в мире, и они снижают риск инфаркта и инсульта.",
        "Они работают, только пока вы их принимаете. Если прекратить, холестерин за несколько недель вернётся, даже если последний анализ был хорошим.",
        "Большинство людей принимают их без проблем. Сообщите вашей команде ухода, если появилась боль или слабость в мышцах, тёмная моча или что-то новое, что вас беспокоит. Не прекращайте приём сами: часто есть простое решение, например другое лекарство, которое подберёт врач.",
        "После начала приёма врач проверит холестерин, чтобы убедиться, что лекарство работает.",
      ],
    },
  },
  {
    id: "activity-start", topic: "activity", status: "draft", sources: [S.whoPa, S.ada5],
    title: {
      hy: "Ավելի շատ շարժում՝ փոքրից սկսած",
      en: "Moving more, starting small",
      ru: "Больше движения, начиная с малого",
    },
    body: {
      hy: [
        "ԱՀԿ-ն մեծահասակներին խորհուրդ է տալիս շաբաթական առնվազն 150 րոպե չափավոր ակտիվություն, այսինքն՝ 30 րոպե շաբաթը 5 օր։ Չափավոր նշանակում է՝ շնչում եք ավելի արագ, բայց կարող եք խոսել։",
        "Պարտադիր չէ սկսել դրանից։ Ցանկացած շարժում ավելի լավ է, քան ոչ մի շարժում։",
        "- Սկսեք ուտելուց հետո 10 րոպե քայլելով։ Ուտելուց հետո քայլելը օգնում է նաև շաքարին։",
        "- Ամեն շաբաթ ավելացրեք մի քանի րոպե։",
        "- Ընտրեք այն, ինչ ձեզ դուր է գալիս. քայլք, պար, լող, հեծանիվ, այգու աշխատանք։",
        "- Բարձրացեք աստիճաններով, ավտոբուսից իջեք մեկ կանգառ շուտ։",
        "Եթե սրտի հիվանդություն ունեք, ծանրաբեռնվածության ժամանակ կրծքավանդակի ցավ ունեք կամ ինսուլին եք ընդունում, նախ հարցրեք ձեր խնամքի թիմին, թե ինչն է ձեզ համար անվտանգ։ Դադարեցրեք և օգնություն խնդրեք, եթե շարժման ժամանակ առաջանում է կրծքավանդակի ցավ, ուշագնացություն կամ ուժեղ շնչահեղձություն։",
      ],
      en: [
        "WHO advises adults to aim for at least 150 minutes of moderate activity a week. That is 30 minutes on 5 days. Moderate means you breathe faster but can still talk.",
        "You do not have to start there. Any movement is better than none.",
        "- Start with a 10-minute walk after a meal. Walking after meals also helps blood sugar.",
        "- Add a few minutes each week.",
        "- Pick something you enjoy: walking, dancing, swimming, cycling, gardening.",
        "- Take the stairs, or get off the bus one stop early.",
        "If you have heart disease, get chest pain on effort, or take insulin, ask your care team what is safe for you first. Stop and get help if activity brings chest pain, fainting or severe breathlessness.",
      ],
      ru: [
        "ВОЗ советует взрослым не меньше 150 минут умеренной активности в неделю, то есть 30 минут 5 дней в неделю. Умеренная значит, что вы дышите чаще, но можете говорить.",
        "Не обязательно начинать сразу с этого. Любое движение лучше, чем ничего.",
        "- Начните с 10 минут ходьбы после еды. Ходьба после еды также помогает сахару.",
        "- Каждую неделю добавляйте несколько минут.",
        "- Выберите то, что вам нравится: ходьба, танцы, плавание, велосипед, работа в саду.",
        "- Поднимайтесь по лестнице, выходите из автобуса на остановку раньше.",
        "Если у вас болезнь сердца, боль в груди при нагрузке или вы принимаете инсулин, сначала спросите вашу команду ухода, что для вас безопасно. Остановитесь и обратитесь за помощью, если при нагрузке появилась боль в груди, обморок или сильная одышка.",
      ],
    },
  },
  {
    id: "activity-strength", topic: "activity", status: "draft", sources: [S.whoPa, S.ada5],
    title: {
      hy: "Ուժային վարժություններ և քիչ նստել",
      en: "Strength, and less sitting",
      ru: "Сила мышц и меньше сидения",
    },
    body: {
      hy: [
        "Մկանները օգտագործում են շաքարը և պահում են հոդերն ու հավասարակշռությունը։ ԱՀԿ-ն խորհուրդ է տալիս մկաններն ամրացնող վարժություններ շաբաթը 2 կամ ավելի օր։",
        "Տանը, առանց սարքավորումների.",
        "- նստեք աթոռին և դանդաղ վեր կացեք, 10 անգամ",
        "- հրեք պատը ձեռքերով",
        "- բարձրացրեք ջրի շշեր",
        "- բարձրացեք աստիճաններով",
        "Երկար նստելն ինքնին վնասակար է, նույնիսկ մարզվող մարդկանց համար։ Ամեն 30 րոպեն մեկ վեր կացեք, ձգվեք կամ մեկ-երկու րոպե քայլեք։ Հեռախոսի հիշեցումը կարող է օգնել։",
        "Վարժությունների ժամանակ նորմալ շնչեք, շունչը մի պահեք։ Սկսեք մեղմ և աստիճանաբար ավելացրեք։ Եթե որևէ բան ցավ է պատճառում, դադարեցրեք և տեղեկացրեք ձեր խնամքի թիմին։",
      ],
      en: [
        "Muscles use sugar and support your joints and balance. WHO advises muscle-strengthening activity on 2 or more days a week.",
        "At home, without equipment:",
        "- sit down on a chair and stand up slowly, 10 times",
        "- push against a wall with your hands",
        "- lift bottles of water",
        "- climb stairs",
        "Long sitting is harmful on its own, even for people who exercise. Every 30 minutes, stand up, stretch or walk for a minute or two. A phone reminder can help.",
        "Breathe normally during exercise and do not hold your breath. Start gently and build up. If anything causes pain, stop and tell your care team.",
      ],
      ru: [
        "Мышцы расходуют сахар и поддерживают суставы и равновесие. ВОЗ советует упражнения для укрепления мышц 2 и более дней в неделю.",
        "Дома, без снарядов:",
        "- сядьте на стул и медленно встаньте, 10 раз",
        "- отжимайтесь руками от стены",
        "- поднимайте бутылки с водой",
        "- поднимайтесь по лестнице",
        "Долгое сидение вредно само по себе, даже для тех, кто занимается спортом. Каждые 30 минут вставайте, потягивайтесь или ходите минуту-две. Помочь может напоминание в телефоне.",
        "Во время упражнений дышите ровно, не задерживайте дыхание. Начинайте мягко и постепенно увеличивайте. Если что-то вызывает боль, остановитесь и сообщите вашей команде ухода.",
      ],
    },
  },
  {
    id: "weight-why", topic: "weight", status: "draft", sources: [S.whoObesity, S.ada8, S.esc2024],
    title: {
      hy: "Ինչու է քաշի փոքր նվազումն օգնում",
      en: "Why a little weight loss helps",
      ru: "Почему помогает даже небольшое снижение веса",
    },
    body: {
      hy: [
        "Եթե ավելորդ քաշ ունեք, դրա նույնիսկ 5-10 տոկոսը կորցնելը իրական տարբերություն է տալիս։ 90 կգ կշռող մարդու համար դա 4,5-9 կգ է։",
        "Այդքանը կարող է իջեցնել ճնշումը, բարելավել շաքարը և խոլեստերինը։ 2-րդ տիպի դիաբետով որոշ մարդկանց մոտ այն կարող է զգալիորեն նվազեցնել դեղերի կարիքը։",
        "Լավագույնս աշխատում է դանդաղ և կայուն տեմպը՝ շաբաթական մոտ կես կիլոգրամից մեկ կիլոգրամ։ Արագ դիետաները դժվար է պահել, և քաշը հաճախ վերադառնում է։",
        "Գոտկատեղի չափն էլ է կարևոր։ Որովայնի շրջանի ճարպն ավելի շատ է կապված սրտի հիվանդությունների և դիաբետի հետ, քան այլ տեղերի ճարպը։",
        "Ձեր խնամքի թիմը կարող է օգնել սահմանել ձեզ համար իրատեսական նպատակ։",
      ],
      en: [
        "If you carry extra weight, losing even 5 to 10 percent of it makes a real difference. For someone who weighs 90 kg, that is 4.5 to 9 kg.",
        "That much can lower blood pressure and improve blood sugar and cholesterol. For some people with type 2 diabetes, it can greatly reduce the need for medicine.",
        "Slow and steady works best: about half a kilo to one kilo a week. Quick diets are hard to keep, and the weight often comes back.",
        "Waist size matters too. Fat around the belly is linked to heart disease and diabetes more than fat elsewhere.",
        "Your care team can help you set a goal that is realistic for you.",
      ],
      ru: [
        "Если у вас лишний вес, снижение даже на 5–10 процентов даёт реальную разницу. Для человека весом 90 кг это 4,5–9 кг.",
        "Этого может хватить, чтобы снизить давление и улучшить сахар и холестерин. У некоторых людей с диабетом 2 типа это может заметно уменьшить потребность в лекарствах.",
        "Лучше всего работает медленный и стабильный темп: примерно от полукилограмма до килограмма в неделю. Быстрые диеты трудно выдержать, и вес часто возвращается.",
        "Размер талии тоже важен. Жир на животе больше связан с болезнями сердца и диабетом, чем жир в других местах.",
        "Ваша команда ухода поможет поставить реалистичную для вас цель.",
      ],
    },
  },
  {
    id: "healthy-plate", topic: "weight", status: "draft", sources: [S.adaPlate, S.whoDiet],
    title: {
      hy: "Առողջ ափսեն",
      en: "The healthy plate",
      ru: "Здоровая тарелка",
    },
    body: {
      hy: [
        "Ուտելիքը պլանավորելու պարզ ձև՝ առանց հաշվելու. օգտագործեք ձեր ափսեն։",
        "- Ափսեի կեսը՝ բանջարեղեն և աղցան, օրինակ՝ կաղամբ, լոլիկ, վարունգ, կանաչի, սմբուկ, պղպեղ, կանաչ լոբի։",
        "- Քառորդը՝ սպիտակուց, օրինակ՝ ձուկ, հավ, ձու, ոսպ կամ ցածր յուղայնությամբ կաթնաշոռ։",
        "- Քառորդը՝ օսլայով սնունդ, օրինակ՝ ամբողջահատիկ հաց, հնդկաձավար, բլղուր կամ կարտոֆիլ։",
        "Խմեք ջուր, ոչ քաղցր ըմպելիքներ կամ հյութ։ Օգտագործեք ավելի փոքր ափսե։ Կերեք դանդաղ և կանգ առեք, երբ ձեզ հարմար եք զգում, ոչ թե երբ կուշտ եք։",
        "Ավանդական ուտեստներն էլ են տեղավորվում. ոսպով ապուր մեծ աղցանով, կամ տոլմա կանաչիով և ավելի քիչ հացով։",
        "Այս ափսեն միաժամանակ օգնում է դիաբետին, ճնշմանը և քաշին։",
      ],
      en: [
        "A simple way to plan a meal without counting: use your plate.",
        "- Half the plate: vegetables and salad, such as cabbage, tomatoes, cucumbers, greens, aubergine, peppers, green beans.",
        "- A quarter: protein, such as fish, chicken, eggs, lentils or low-fat cottage cheese.",
        "- A quarter: starchy food, such as whole-grain bread, buckwheat, bulgur or potatoes.",
        "Drink water, not sweet drinks or juice. Use a smaller plate. Eat slowly, and stop when you feel comfortable, not full.",
        "Traditional dishes fit too: lentil soup with a big salad, or dolma with greens and less bread.",
        "This plate helps diabetes, blood pressure and weight at the same time.",
      ],
      ru: [
        "Простой способ планировать еду без подсчётов: используйте свою тарелку.",
        "- Половина тарелки: овощи и салат, например капуста, помидоры, огурцы, зелень, баклажаны, перец, стручковая фасоль.",
        "- Четверть: белок, например рыба, курица, яйца, чечевица или нежирный творог.",
        "- Четверть: крахмалистая еда, например цельнозерновой хлеб, гречка, булгур или картофель.",
        "Пейте воду, а не сладкие напитки или сок. Берите тарелку поменьше. Ешьте медленно и останавливайтесь, когда вам комфортно, а не когда наелись.",
        "Традиционные блюда тоже подходят: чечевичный суп с большим салатом или толма с зеленью и меньшим количеством хлеба.",
        "Такая тарелка помогает одновременно при диабете, давлении и для веса.",
      ],
    },
  },
  {
    id: "medicines-daily", topic: "medicines", status: "draft", sources: [S.whoAdherence, S.esc2024],
    title: {
      hy: "Ինչպես ամեն օր չմոռանալ դեղերը",
      en: "Taking your medicines every day",
      ru: "Как не забывать лекарства каждый день",
    },
    body: {
      hy: [
        "Ճնշման, շաքարի և խոլեստերինի դեղերը պաշտպանում են միայն կանոնավոր ընդունելու դեպքում, սովորաբար տարիներով։",
        "Ինչն է օգնում.",
        "- Կապեք յուրաքանչյուր դեղ առօրյա սովորության հետ, օրինակ՝ ատամները լվանալու կամ նախաճաշի։",
        "- Օգտագործեք շաբաթական դեղատուփ և լցրեք այն ամեն շաբաթ նույն օրը։",
        "- Դրեք հիշեցում հեռախոսում կամ միացրեք դեղերի հիշեցումները հավելվածում։",
        "- Պահեք ձեր բոլոր դեղերի ցանկը, այդ թվում՝ այլ բժիշկների նշանակածները, և բերեք այցելություններին։",
        "- Գնեք նոր տուփը նախքան վերջանալը։",
        "Երբեմն մոռանալը մարդկային է։ Եթե հաճախ եք բաց թողնում կամ ժամանակացույցը դժվար է, ասեք ձեր խնամքի թիմին։ Հնարավոր է ավելի պարզ տարբերակ լինի, օրինակ՝ օրական ավելի քիչ հաբեր։",
      ],
      en: [
        "Medicines for blood pressure, sugar and cholesterol protect you only when you take them regularly, usually for years.",
        "Things that help:",
        "- Link each medicine to a daily habit, such as brushing your teeth or breakfast.",
        "- Use a weekly pill box, and fill it on the same day each week.",
        "- Set a reminder on your phone, or turn on medicine reminders in the app.",
        "- Keep a list of all your medicines, including ones from other doctors, and bring it to visits.",
        "- Get the next pack before you run out.",
        "Forgetting sometimes is human. If you often miss doses, or the schedule is hard, tell your care team. There may be a simpler option, such as fewer tablets a day.",
      ],
      ru: [
        "Лекарства от давления, сахара и холестерина защищают, только если принимать их регулярно, обычно годами.",
        "Что помогает:",
        "- Свяжите каждое лекарство с ежедневной привычкой, например чисткой зубов или завтраком.",
        "- Пользуйтесь таблетницей на неделю и заполняйте её в один и тот же день.",
        "- Поставьте напоминание в телефоне или включите напоминания о лекарствах в приложении.",
        "- Держите список всех своих лекарств, включая назначенные другими врачами, и берите его на приёмы.",
        "- Покупайте следующую упаковку до того, как закончится текущая.",
        "Иногда забыть это по-человечески. Если вы часто пропускаете приём или схема сложная, скажите вашей команде ухода. Возможно, есть вариант проще, например меньше таблеток в день.",
      ],
    },
  },
  {
    id: "medicines-side-effects", topic: "medicines", status: "draft", sources: [S.whoAdherence, S.esc2024],
    title: {
      hy: "Կողմնակի ազդեցություններ և բաց թողնված ընդունում",
      en: "Side effects and missed doses",
      ru: "Побочные эффекты и пропущенный приём",
    },
    body: {
      hy: [
        "Եթե դեղը կողմնակի ազդեցություն է տալիս, ինքնուրույն մի դադարեցրեք այն։ Որոշ ազդեցություններ անցնում են մի քանի շաբաթում, մյուսները պարզ լուծում ունեն։ Ասեք ձեր խնամքի թիմին, թե ինչ եք նկատում և երբ է սկսվել։",
        "Եթե բաց եք թողել ընդունումը, նայեք ներդիրը կամ հարցրեք բժշկին կամ դեղագործին, թե ինչ անել։ Կրկնակի չափաբաժին մի ընդունեք, եթե ձեզ այդպես չեն ասել։",
        "Ցանկացած նոր դեղ, սննդային հավելում կամ բուսական միջոց սկսելուց առաջ հարցրեք՝ արդյոք այն անվտանգ է ձեր ընդունածների հետ։ Օրինակ՝ որոշ տարածված ցավազրկողներ կարող են բարձրացնել ճնշումը։",
        "Զանգահարեք 103, եթե դեղից հետո ուռել են դեմքը, շրթունքները կամ լեզուն, դժվարացել է շնչառությունը կամ առաջացել է ուժեղ ցան։",
      ],
      en: [
        "If a medicine gives you side effects, do not stop it on your own. Some effects pass after a few weeks, and others have simple fixes. Tell your care team what you notice and when it started.",
        "If you miss a dose, check the leaflet or ask your doctor or pharmacist what to do. Do not take a double dose to make up for it unless you were told to.",
        "Before you start any new medicine, supplement or herbal remedy, ask whether it is safe with what you already take. Some common painkillers, for example, can raise blood pressure.",
        "Call 103 if, after a medicine, your face, lips or tongue swell, you have trouble breathing, or you get a severe rash.",
      ],
      ru: [
        "Если лекарство вызывает побочные эффекты, не прекращайте его сами. Некоторые эффекты проходят за несколько недель, у других есть простое решение. Расскажите вашей команде ухода, что вы замечаете и когда это началось.",
        "Если вы пропустили приём, посмотрите инструкцию или спросите врача или фармацевта, что делать. Не принимайте двойную дозу, чтобы восполнить пропуск, если вам так не говорили.",
        "Прежде чем начать любое новое лекарство, добавку или травяное средство, спросите, безопасно ли это вместе с тем, что вы уже принимаете. Например, некоторые распространённые обезболивающие могут повышать давление.",
        "Звоните 103, если после лекарства отекли лицо, губы или язык, стало трудно дышать или появилась сильная сыпь.",
      ],
    },
  },
  {
    id: "when-to-call-103", topic: "emergency", status: "draft", sources: [S.escAcs, S.esc2024, S.whoStroke],
    title: {
      hy: "Երբ զանգահարել 103",
      en: "When to call 103",
      ru: "Когда звонить 103",
    },
    body: {
      hy: [
        "Որոշ ախտանիշներ չեն կարող սպասել հաղորդագրության կամ այցի։ Անմիջապես զանգահարեք 103, եթե ունեք՝",
        "- կրծքավանդակի ցավ, ճնշում կամ սեղմվածություն, հատկապես եթե տարածվում է ձեռքին, ծնոտին կամ մեջքին, կամ ուղեկցվում է քրտինքով կամ սրտխառնոցով",
        "- դեմքի, ձեռքի կամ ոտքի հանկարծակի թուլություն կամ թմրածություն, խոսելու դժվարություն կամ դեմքի կախվածություն",
        "- ուժեղ շնչահեղձություն",
        "- ուշագնացություն կամ հանկարծակի շփոթվածություն",
        "- շատ բարձր ճնշում այս ախտանիշներից որևէ մեկի հետ",
        "- ցածր շաքար՝ շփոթվածությամբ կամ քնկոտությամբ",
        "Ինքներդ մեքենա մի վարեք։ Մնացեք հեռախոսագծին և հետևեք օպերատորի ցուցումներին։ Եթե մենակ եք, բացեք դուռը։",
        "Զոյան և այս հավելվածը շտապ օգնության ծառայություն չեն։ Երբ ապահով լինեք, տեղեկացրեք ձեր խնամքի թիմին։",
      ],
      en: [
        "Some symptoms cannot wait for a message or an appointment. Call 103 right away for:",
        "- chest pain, pressure or tightness, especially if it spreads to the arm, jaw or back, or comes with sweating or nausea",
        "- sudden weakness or numbness of the face, arm or leg, trouble speaking, or a drooping face",
        "- severe shortness of breath",
        "- fainting or sudden confusion",
        "- a very high blood pressure reading with any of these symptoms",
        "- low blood sugar with confusion or drowsiness",
        "Do not drive yourself. Stay on the phone and follow the operator's instructions. If you are alone, unlock the door.",
        "Zoe and this app are not an emergency service. Once you are safe, let your care team know.",
      ],
      ru: [
        "Некоторые симптомы не могут ждать сообщения или приёма. Сразу звоните 103, если есть:",
        "- боль, давление или сжатие в груди, особенно если отдаёт в руку, челюсть или спину или сопровождается потом или тошнотой",
        "- внезапная слабость или онемение лица, руки или ноги, нарушение речи или перекошенное лицо",
        "- сильная одышка",
        "- обморок или внезапная спутанность",
        "- очень высокое давление вместе с любым из этих симптомов",
        "- низкий сахар со спутанностью или сонливостью",
        "Не садитесь за руль сами. Оставайтесь на линии и следуйте указаниям оператора. Если вы одни, откройте дверь.",
        "Зоя и это приложение не служба скорой помощи. Когда вы будете в безопасности, сообщите вашей команде ухода.",
      ],
    },
  },
  {
    id: "stroke-fast", topic: "emergency", status: "draft", sources: [S.whoStroke, S.esc2024],
    title: {
      hy: "Ինսուլտ. գործեք արագ",
      en: "Stroke: act FAST",
      ru: "Инсульт: действуйте быстро",
    },
    body: {
      hy: [
        "Ինսուլտը տեղի է ունենում, երբ արյունը դադարում է հասնել ուղեղի մի մասին։ Յուրաքանչյուր րոպեն կարևոր է. արագ բուժումը փրկում է ուղեղը և կյանքը։",
        "Ստուգեք՝",
        "- Դեմք. ժպտալիս դեմքի մի կողմը կախվա՞ծ է։",
        "- Ձեռքեր. կարո՞ղ է մարդը բարձրացնել երկու ձեռքն էլ և պահել։",
        "- Խոսք. խոսքը խառնվա՞ծ է կամ տարօրինակ։",
        "- Ժամանակ. այս նշաններից որևէ մեկի դեպքում անմիջապես զանգահարեք 103 և նշեք, թե երբ են սկսվել նշանները։",
        "Այլ հանկարծակի նշաններ են տեսողության կորուստը, ուժեղ գլխացավը կամ հավասարակշռության կորուստը։",
        "Նույնիսկ եթե նշաններն անցնում են մի քանի րոպեում, զանգահարեք 103։ Դա կարող է ավելի մեծ ինսուլտի նախազգուշացում լինել։",
        "Բարձր ճնշումը ինսուլտի ամենամեծ պատճառն է, ահա թե ինչու է այդքան կարևոր այն վերահսկելը։",
      ],
      en: [
        "A stroke happens when blood stops reaching part of the brain. Every minute counts: fast treatment saves the brain and saves lives.",
        "Remember FAST:",
        "- Face: does one side of the face droop when the person smiles?",
        "- Arms: can they raise both arms and keep them up?",
        "- Speech: is their speech slurred or strange?",
        "- Time: if you see any of these, call 103 at once and note the time the signs started.",
        "Other sudden signs include loss of vision, a severe headache, or loss of balance.",
        "Even if the signs pass within a few minutes, call 103. It can be the warning of a bigger stroke.",
        "High blood pressure is the biggest cause of stroke, which is why keeping it under control matters so much.",
      ],
      ru: [
        "Инсульт случается, когда кровь перестаёт поступать в часть мозга. Важна каждая минута: быстрое лечение спасает мозг и жизнь.",
        "Проверьте:",
        "- Лицо: опускается ли одна сторона лица, когда человек улыбается?",
        "- Руки: может ли он поднять обе руки и удержать их?",
        "- Речь: невнятная или странная ли речь?",
        "- Время: если есть любой из этих признаков, сразу звоните 103 и запомните, когда признаки начались.",
        "Другие внезапные признаки: потеря зрения, сильная головная боль или потеря равновесия.",
        "Даже если признаки прошли за несколько минут, звоните 103. Это может быть предупреждением о более серьёзном инсульте.",
        "Повышенное давление главная причина инсульта, поэтому так важно держать его под контролем.",
      ],
    },
  },
];
