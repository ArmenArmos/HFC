/**
 * The chat kit's own words: buttons, states and read-backs that every journey shares. Armenian first, then
 * English and Russian. UNAPPROVED v1: Armenian and Russian wording for Tatevik. No clinical wording lives here.
 * scripts/check-zoe-kit.ts enforces: every locale has every line; no exclamation mark, emoji or em dash.
 */
export const ZOE_KIT_COPY_VERSION = "zoe-kit-v1-unapproved";
export type KitLocale = "hy" | "en" | "ru";
export type Line = { hy: string; en: string; ru: string };
const c = (hy: string, en: string, ru: string): Line => ({ hy, en, ru });
export const t = (l: KitLocale, line: Line) => line[l];

export const KIT = {
  zoe: c("Զոյա", "Zoe", "Зоя"),
  role: c("ԱԲ օգնական", "AI assistant", "ИИ-помощник"),
  you: c("Դուք", "You", "Вы"),
  writing: c("Զոյան գրում է", "Zoe is writing", "Zoe пишет"),
  sending: c("Ուղարկվում է", "Sending", "Отправляется"),
  notSent: c("Չուղարկվեց", "Not sent", "Не отправлено"),
  next: c("Հաջորդը", "Next", "Далее"),
  done: c("Պատրաստ է", "Done", "Готово"),
  doneCount: (n: number) => c(`Պատրաստ է (${n})`, `Done (${n})`, `Готово (${n})`),
  chooseOne: c("Ընտրեք մեկը", "Choose one", "Выберите один вариант"),
  chooseAny: c("Ընտրեք առնվազն մեկը", "Choose at least one", "Выберите хотя бы один вариант"),
  orTap: c("Կամ ընտրեք՝", "Or tap:", "Или выберите:"),
  dontKnow: c("Չգիտեմ", "I don't know", "Не знаю"),
  range: (min: number, max: number, unit: string) =>
    c(`Գրեք թիվ ${min}-ից ${max} ${unit}`, `Enter a number from ${min} to ${max} ${unit}`, `Введите число от ${min} до ${max} ${unit}`),
  enterNumber: c("Գրեք թիվը", "Enter the number", "Введите число"),
  retry: c("Կրկին փորձել", "Try again", "Попробуйте снова"),
  saveFailed: c("Չհաջողվեց պահել։ Կրկին փորձեք։", "We could not save this. Try again.", "Не удалось сохранить. Попробуйте снова."),
  slotTaken: c("Այդ ժամն արդեն զբաղված է։ Ընտրեք ուրիշը։", "That time was just taken. Choose another.", "Это время уже заняли. Выберите другое."),
  asOf: (when: string) => c(`${when}-ի դրությամբ`, `As of ${when}`, `На ${when}`),
  stale: c("Թարմացվել է այս քարտից հետո", "Updated since this was shown", "Обновлено после показа"),
  seeCurrent: c("Տեսնել ներկան", "See current", "Посмотреть текущее"),
  undo: c("Հետարկել", "Undo", "Отменить"),
  undone: c("Հետարկված է", "Undone", "Отменено"),
  edit: c("Խմբագրել", "Edit", "Изменить"),
  send: c("Ուղարկել", "Send", "Отправить"),
  goesTo: c("Սա կուղարկվի ձեր խնամքի թիմին՝", "This goes to your care team:", "Это получит ваша медицинская команда:"),
  changeAnswer: c("Փոխել պատասխանը", "Change an answer", "Изменить ответ"),
  whichAnswer: c("Ո՞ր պատասխանը փոխենք։", "Which answer should we change?", "Какой ответ изменить?"),
  allAnswers: (n: number) => c(`Բոլոր պատասխանները (${n})`, `All my answers (${n})`, `Все мои ответы (${n})`),
  showNumbers: c("Ցույց տալ թվերը", "Show the numbers", "Показать цифры"),
  noTimes: c("Այս օրը ազատ ժամ չկա։", "No free times on this day.", "На этот день свободного времени нет."),
  today: c("Այսօր", "Today", "Сегодня"),
  book: (when: string) => c(`Ամրագրել՝ ${when}`, `Book ${when}`, `Записаться: ${when}`),
  pickDay: c("Օրը", "Day", "День"),
  pickTime: c("Ժամը", "Time", "Время"),
  top: c("Վերին", "Top", "Верхнее"),
  bottom: c("Ստորին", "Bottom", "Нижнее"),
  pulse: c("Զարկ", "Pulse", "Пульс"),
  optional: c("ոչ պարտադիր", "optional", "необязательно"),
  bpReadback: (s: string, d: string, p: string | null) =>
    c(`${s}/${d}${p ? `, զարկ ${p}` : ""}`, `${s} over ${d}${p ? `, pulse ${p}` : ""}`, `${s} на ${d}${p ? `, пульс ${p}` : ""}`),
  bpSave: (v: string) => c(`Պահել՝ ${v}`, `Save ${v}`, `Сохранить ${v}`),
  bpSaveIdle: c("Պահել չափումը", "Save reading", "Сохранить измерение"),
  bpEnter:c("Գրեք վերին և ստորին թվերը", "Enter the top and bottom numbers", "Введите верхнее и нижнее числа"),
  bpOrder: c("Ստորին թիվը պետք է փոքր լինի վերինից։", "The bottom number must be lower than the top one.", "Нижнее число должно быть меньше верхнего."),
  bpRange: (what: Line, min: number, max: number) =>
    c(`${what.hy}՝ ${min}-ից ${max}`, `${what.en}: from ${min} to ${max}`, `${what.ru}: от ${min} до ${max}`),
  dontRemember: c("Չեմ հիշում", "I don't remember", "Не помню"),
  noneOfThese: c("Ոչ մեկը", "None of these", "Ничего из перечисленного"),
  showChart: c("Ցույց տալ գծապատկերը", "Show the chart", "Показать график"),
  emergencyTitle: c("Զանգահարեք 103 հիմա", "Call 103 now", "Позвоните 103 сейчас"),
  call103: c("Զանգահարել 103", "Call 103", "Позвонить 103"),
  typingOff: c("Նախադիտում, գրելն անջատված է", "Preview, typing is off", "Предпросмотр, ввод отключён"),
  message: c("Գրեք Zoe-ին", "Write to Zoe", "Напишите Zoe"),
  sendMessage: c("Ուղարկել", "Send", "Отправить"),
  stepDone: c("Արված է", "Done", "Сделано"),
  stepNow: c("Հիմա", "Now", "Сейчас"),
  stepNext: c("Հետո", "Next", "Далее"),
};
