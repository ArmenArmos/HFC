/**
 * Zoe's missed-dose ask (Armen's coaching item 5, 20 Oct 2026). UNAPPROVED v1: clinical wording for Armen,
 * Armenian and Russian wording for Tatevik. The app shows en and hy today (profiles hold only those two);
 * ru is kept here, complete, for review and for when members can choose it.
 *
 * Rules the check (scripts/check-medicine-ask-copy.ts) enforces: every locale has every line; no dose,
 * amount or "take/stop it" instruction; no exclamation marks, emoji or em dashes.
 */
export const MEDICINE_ASK_COPY_VERSION = "medicine-ask-v1-unapproved";

export type AskLocale = "en" | "hy" | "ru";
export type AskReason = "forgot" | "side_effect" | "cost_or_availability" | "ran_out" | "decided_to_stop";
export const ASK_REASONS: readonly AskReason[] = ["forgot", "side_effect", "cost_or_availability", "ran_out", "decided_to_stop"];

type Copy = {
  title: string;
  skipped: (name: string, when: string) => string;
  missed: (name: string, when: string) => string;
  why: string;
  reasons: Record<AskReason, string>;
  notNow: string;
  today: string;
  yesterday: string;
  forgot: { body: string; action: string };
  refill: { body: string; cost: string; action: string; sent: string; already: string };
  doctor: { sideEffect: string; stop: string; noAdvice: string; urgent: string };
  failed: string;
  closed: string;
};

export const MEDICINE_ASK_COPY: Record<AskLocale, Copy> = {
  en: {
    title: "Zoe has a quick question",
    skipped: (name, when) => `You marked ${name} at ${when} as skipped.`,
    missed: (name, when) => `${name} at ${when} was not ticked.`,
    why: "Can I ask what got in the way? No blame, life gets busy. Your answer helps your care team support you.",
    reasons: {
      forgot: "I forgot",
      side_effect: "It gave me a side effect",
      cost_or_availability: "Cost, or I could not get it",
      ran_out: "I ran out",
      decided_to_stop: "I decided to stop it",
    },
    notNow: "Not now",
    today: "today",
    yesterday: "yesterday",
    forgot: {
      body: "Thanks for telling me. It happens to everyone. Would a reminder at a different time help?",
      action: "Change my reminder time",
    },
    refill: {
      body: "Thanks for telling me. To get more, you can ask at your pharmacy. If you need a new prescription, your care team can help.",
      cost: "If the cost is the problem, your care team can talk it through with you.",
      action: "Ask my care team",
      sent: "Sent. Your care team will get back to you.",
      already: "Your care team already has this.",
    },
    doctor: {
      sideEffect: "Thank you for telling me. I have passed this to your doctor, and they will answer you.",
      stop: "Thank you for telling me. I have let your doctor know, and they will answer you.",
      noAdvice: "I can't give advice about medicines. Your doctor can talk it through with you.",
      urgent: "If you feel very unwell right now, call 103.",
    },
    failed: "That didn't save. Try again.",
    closed: "This question has closed.",
  },
  hy: {
    title: "Զոյան կարճ հարց ունի",
    skipped: (name, when) => `Դուք ${name}-ի ${when} ընդունումը նշել եք որպես բաց թողնված։`,
    missed: (name, when) => `${name}-ի ${when} ընդունումը նշված չէ։`,
    why: "Կարո՞ղ եմ հարցնել, թե ինչ խանգարեց։ Ոչինչ, կյանքը զբաղված է։ Ձեր պատասխանն օգնում է ձեր խնամքի թիմին աջակցել ձեզ։",
    reasons: {
      forgot: "Մոռացա",
      side_effect: "Կողմնակի ազդեցություն ունեցավ",
      cost_or_availability: "Գինը, կամ չկարողացա ձեռք բերել",
      ran_out: "Վերջացավ",
      decided_to_stop: "Որոշեցի դադարեցնել",
    },
    notNow: "Ոչ հիմա",
    today: "այսօր",
    yesterday: "երեկ",
    forgot: {
      body: "Շնորհակալ եմ, որ ասացիք։ Դա պատահում է բոլորի հետ։ Արդյո՞ք այլ ժամի հիշեցումը կօգնի։",
      action: "Փոխել հիշեցման ժամը",
    },
    refill: {
      body: "Շնորհակալ եմ, որ ասացիք։ Նորը ձեռք բերելու համար կարող եք դիմել դեղատուն։ Եթե նոր դեղատոմս է պետք, ձեր խնամքի թիմը կօգնի։",
      cost: "Եթե խնդիրը գինն է, ձեր խնամքի թիմը կարող է քննարկել դա ձեզ հետ։",
      action: "Հարցնել իմ խնամքի թիմին",
      sent: "Ուղարկված է։ Ձեր խնամքի թիմը կկապվի ձեզ հետ։",
      already: "Ձեր խնամքի թիմն արդեն տեղյակ է։",
    },
    doctor: {
      sideEffect: "Շնորհակալ եմ, որ ասացիք։ Ես սա փոխանցել եմ ձեր բժշկին, և նա կպատասխանի ձեզ։",
      stop: "Շնորհակալ եմ, որ ասացիք։ Ես տեղեկացրել եմ ձեր բժշկին, և նա կպատասխանի ձեզ։",
      noAdvice: "Ես չեմ կարող դեղերի վերաբերյալ խորհուրդ տալ։ Ձեր բժիշկը կքննարկի դա ձեզ հետ։",
      urgent: "Եթե հիմա ձեզ շատ վատ եք զգում, զանգահարեք 103։",
    },
    failed: "Չհաջողվեց պահել։ Կրկին փորձեք։",
    closed: "Այս հարցն այլևս բաց չէ։",
  },
  ru: {
    title: "У Зои короткий вопрос",
    skipped: (name, when) => `Вы отметили приём ${name} в ${when} как пропущенный.`,
    missed: (name, when) => `Приём ${name} в ${when} не отмечен.`,
    why: "Можно спросить, что помешало? Ничего страшного, так бывает. Ваш ответ поможет вашей команде лечения поддержать вас.",
    reasons: {
      forgot: "Забыл(а)",
      side_effect: "Был побочный эффект",
      cost_or_availability: "Цена, или не смог(ла) купить",
      ran_out: "Закончилось",
      decided_to_stop: "Решил(а) прекратить",
    },
    notNow: "Не сейчас",
    today: "сегодня",
    yesterday: "вчера",
    forgot: {
      body: "Спасибо, что рассказали. Такое бывает у всех. Поможет ли напоминание в другое время?",
      action: "Изменить время напоминания",
    },
    refill: {
      body: "Спасибо, что рассказали. Купить ещё можно в аптеке. Если нужен новый рецепт, ваша команда лечения поможет.",
      cost: "Если дело в цене, ваша команда лечения может обсудить это с вами.",
      action: "Спросить мою команду лечения",
      sent: "Отправлено. Ваша команда лечения свяжется с вами.",
      already: "Ваша команда лечения уже знает об этом.",
    },
    doctor: {
      sideEffect: "Спасибо, что рассказали. Я передала это вашему врачу, и он вам ответит.",
      stop: "Спасибо, что рассказали. Я сообщила вашему врачу, и он вам ответит.",
      noAdvice: "Я не могу давать советы по лекарствам. Ваш врач обсудит это с вами.",
      urgent: "Если вам сейчас очень плохо, звоните 103.",
    },
    failed: "Не удалось сохранить. Попробуйте ещё раз.",
    closed: "Этот вопрос уже закрыт.",
  },
};

/** "08:00 today", "20:00 yesterday" or "08:00, 18 Oct", in Yerevan time. */
export function askWhen(dueAt: string, now: Date, l: AskLocale): string {
  const local = (d: Date) => new Date(d.getTime() + 4 * 3600000).toISOString();
  const due = local(new Date(dueAt)), today = local(now).slice(0, 10);
  const yesterday = local(new Date(now.getTime() - 86400000)).slice(0, 10);
  const time = due.slice(11, 16), day = due.slice(0, 10);
  const c = MEDICINE_ASK_COPY[l];
  if (day === today) return `${time} ${c.today}`;
  if (day === yesterday) return `${time} ${c.yesterday}`;
  return `${time}, ${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

/** Where an answer leads. Side effect and stopping always go to the doctor; nothing else does. */
export function askNext(reason: AskReason): "reminders" | "refill" | "doctor" {
  if (reason === "forgot") return "reminders";
  if (reason === "side_effect" || reason === "decided_to_stop") return "doctor";
  return "refill";
}
