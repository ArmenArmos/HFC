/**
 * Member copy for checked results from their own files (Armen, 20 Oct 2026). UNAPPROVED v1: wording for Armen,
 * Armenian and Russian for Tatevik. The app shows hy and en today (profiles hold only those two); ru is kept
 * here, complete, for review and for when members can choose it (as lib/member-medicines/ask-copy.ts).
 * The check (scripts/check-lab-results-view.ts) enforces: every locale has every line; no exclamation marks,
 * emoji or em dashes.
 */
export const LAB_RESULTS_COPY_VERSION = "member-lab-results-v1-unapproved";
export type ResultsLocale = "hy" | "en" | "ru";
export type RangeKey = "in" | "borderline" | "out" | "none";

type Copy = {
  title: string;
  intro: string;
  introNotChecked: string;
  waitingTitle: string;
  waitingBody: string;
  checkedTitle: string;
  seeResults: string;
  checkedBy: (name: string | null, date: string) => string;
  notChecked: string;
  doctorSays: string;
  editedByDoctor: string;
  range: Record<RangeKey, string>;
  labRange: string;
  date: string;
  since: (date: string) => string;
  direction: { up: string; down: string; same: string };
  chart: (name: string) => string;
  band: string;
  fromFile: (name: string) => string;
  noDate: string;
  earlier: string;
  unavailable: string;
};

export const LAB_RESULTS_COPY: Record<ResultsLocale, Copy> = {
  hy: {
    title: "Ձեր ստուգված արդյունքները",
    intro: "Ձեր ավելացրած ֆայլերի արժեքները՝ ձեր բժշկի ստուգումից հետո։ Գույնը միշտ ունի նաև գրավոր նշում։",
    introNotChecked: "Ձեր ավելացրած ֆայլերից AI-ի կարդացած արժեքները։ Բժիշկը դրանք չի ստուգել։",
    waitingTitle: "Սպասում է ձեր բժշկի ստուգմանը",
    waitingBody: "Մենք կարդացել ենք այս ֆայլը։ Արժեքները այստեղ կտեսնեք, երբ ձեր բժիշկը ստուգի դրանք։",
    checkedTitle: "Ձեր բժիշկը ստուգել է այս ֆայլը",
    seeResults: "Տեսնել արդյունքները",
    checkedBy: (name, date) => (name ? `Ստուգել է ձեր բժիշկը՝ ${name}, ${date}` : `Ստուգել է ձեր բժիշկը, ${date}`),
    notChecked: "Կարդացել է AI-ը, բժիշկը չի ստուգել",
    doctorSays: "Ձեր բժշկի բացատրությունը",
    editedByDoctor: "Ուղղել է ձեր բժիշկը",
    range: { in: "Միջակայքում", borderline: "Միջակայքի սահմանին մոտ", out: "Միջակայքից դուրս", none: "Միջակայք նշված չէ" },
    labRange: "Լաբորատորիայի միջակայք",
    date: "Ամսաթիվ",
    since: (date) => `${date}-ի համեմատ`,
    direction: { up: "Աճել է", down: "Նվազել է", same: "Չի փոխվել" },
    chart: (name) => `${name}՝ ըստ ամսաթվերի`,
    band: "Ստվերված գոտին ձեր վերջին թերթիկին նշված միջակայքն է։",
    fromFile: (name) => `Ֆայլ՝ ${name}`,
    noDate: "Ամսաթիվ չկա",
    earlier: "Նախորդ արժեքներ",
    unavailable: "Ձեր արդյունքներն այս պահին անհասանելի են։ Թարմացրեք էջը՝ կրկին փորձելու համար։",
  },
  en: {
    title: "Your checked results",
    intro: "Values from the files you added, after your doctor checked them. Every colour also has a written label.",
    introNotChecked: "Values read by AI from the files you added. A doctor has not checked them.",
    waitingTitle: "Waiting for your doctor to check",
    waitingBody: "We read this file. You will see the values here once your doctor has checked them.",
    checkedTitle: "Your doctor checked this file",
    seeResults: "See your results",
    checkedBy: (name, date) => (name ? `Checked by your doctor, ${name}, on ${date}` : `Checked by your doctor on ${date}`),
    notChecked: "Read by AI, not checked by a doctor",
    doctorSays: "What your doctor says",
    editedByDoctor: "Corrected by your doctor",
    range: { in: "In range", borderline: "Near the edge of the range", out: "Out of range", none: "No range on the sheet" },
    labRange: "Lab range",
    date: "Date",
    since: (date) => `Since ${date}`,
    direction: { up: "Up", down: "Down", same: "No change" },
    chart: (name) => `${name} by date`,
    band: "The shaded band is the range printed on your latest sheet.",
    fromFile: (name) => `File: ${name}`,
    noDate: "No date",
    earlier: "Earlier values",
    unavailable: "Your results are unavailable right now. Reload the page to try again.",
  },
  ru: {
    title: "Ваши проверенные результаты",
    intro: "Значения из добавленных вами файлов после проверки вашим врачом. У каждого цвета есть и текстовая подпись.",
    introNotChecked: "Значения, прочитанные AI из добавленных вами файлов. Врач их не проверял.",
    waitingTitle: "Ожидает проверки вашим врачом",
    waitingBody: "Мы прочитали этот файл. Значения появятся здесь после проверки вашим врачом.",
    checkedTitle: "Ваш врач проверил этот файл",
    seeResults: "Посмотреть результаты",
    checkedBy: (name, date) => (name ? `Проверено вашим врачом, ${name}, ${date}` : `Проверено вашим врачом ${date}`),
    notChecked: "Прочитано AI, врач не проверял",
    doctorSays: "Что говорит ваш врач",
    editedByDoctor: "Исправлено вашим врачом",
    range: { in: "В пределах диапазона", borderline: "У границы диапазона", out: "Вне диапазона", none: "Диапазон не указан" },
    labRange: "Диапазон лаборатории",
    date: "Дата",
    since: (date) => `По сравнению с ${date}`,
    direction: { up: "Выросло", down: "Снизилось", same: "Без изменений" },
    chart: (name) => `${name} по датам`,
    band: "Затенённая полоса показывает диапазон из вашего последнего бланка.",
    fromFile: (name) => `Файл: ${name}`,
    noDate: "Без даты",
    earlier: "Прежние значения",
    unavailable: "Ваши результаты сейчас недоступны. Обновите страницу, чтобы попробовать снова.",
  },
};
export const resultsCopy = (l: string) => LAB_RESULTS_COPY[(l === "hy" || l === "ru" ? l : "en") as ResultsLocale];
