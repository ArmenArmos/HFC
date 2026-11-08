import {isTextUsableInLocale,memberInstruction} from '@/lib/text-language';
import {memberStaffName} from "@/lib/member-staff-name.mjs";
import { type Locale } from "@/lib/locale";
import type { CareAction } from "@/lib/patient-care/types";
import type { Appointment } from "@/lib/real-booking/appointment-schema";
import { formatMemberDate } from "@/lib/patient/date-format";

/**
 * "Your next step" for a real member, from saved journey state only (lead input 17 Oct, from
 * Khikar): questionnaire, review request, book tests, clinic confirmation or a new proposed time,
 * visit confirmed, samples at the lab, results with the doctor, consultation, doctor-approved plan. The most
 * advanced recorded stage wins. Payment is never a gate here. A read that failed is passed as
 * undefined and never treated as "nothing recorded", so it cannot send a member backwards.
 *
 * Returns null when the existing actions should lead: questionnaire not finished (its own
 * action), urgent (handled before this), or a published plan (plan and medication actions).
 */
export type JourneyInput = {
  questionnaireComplete: boolean;
  /** null: review requests are off; undefined: the status read failed. */
  review: { status: "awaiting_assignment" | "review_pending" | "consultation_needed"; consultation?: { scheduledAt: string; channel: "phone" | "clinic"; clinic: string | null } } | "none" | null | undefined;
  /** undefined: the booking read failed. */
  appointments: Appointment[] | undefined;
  clinics: Record<string, string>;
  canBook: boolean;
  hasOpenRequest: boolean;
  lab: "collected" | "partial" | "at-lab" | "results-received" | null | undefined;
  /** The member's latest nurse visit with recorded steps since the latest plan; null: none; undefined: the read failed or the switch is off. */
  nurseVisit?: {
    startsAt: string;
    mode: "home" | "clinic" | "office";
    steps: { step: "confirmed" | "samples-collected" | "samples-at-lab" | "completed"; at: string }[];
    samplesTaken: number | null;
  } | null;
  /** Clinic lab PDFs the doctor released to the member, newest first; undefined when the read failed or the feature is off. */
  released?: { clinic: string; uploadedAt: string }[] | null;
  planPublished: boolean;
  /** The assigned doctor has started on the plan (results reviewed, a draft saved or prepared) and nothing is published. */
  planPreparing?: boolean;
  consultationText?: Record<Locale, string>;
  /** The assigned doctor's display name, when the member may see it (patient_care_team). */
  doctorName?: string | null;
  now: Date;
};

const pair = (en: string, hy: string, ru: string) => ({ en, hy, ru });
const PREP_INLINE_MAX = 300;
const when = (iso: string) =>
  pair(
    formatMemberDate(iso, "en", { timeZone: "Asia/Yerevan", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    formatMemberDate(iso, "hy", { timeZone: "Asia/Yerevan", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
    formatMemberDate(iso, "ru", { timeZone: "Asia/Yerevan", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  );
export const mapLink = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** The appointment that describes where the member is now: the newest one that is not cancelled. */
export function currentAppointment(appointments: Appointment[]) {
  return appointments
    .filter((a) => a.status !== "cancelled" && !(a.noticePurpose === "cancellation" && a.status === "confirmed"))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

export type JourneyAction = CareAction & { secondary?: { href: string; label: Record<Locale, string> } };

export function memberJourneyStep(input: JourneyInput): JourneyAction | null {
  const doctorName = memberStaffName(input.doctorName);
  if (!input.questionnaireComplete || input.planPublished) return null;
  const base = { href: "/patient/service" };
  const review = input.review;
  // 8. Consultation needed.
  if (review && review !== "none" && review.status === "consultation_needed")
    return {
      ...base, id: "journey-consultation", kind: "consultation", href: "/patient/review",
      title: pair("Your doctor would like to talk with you", "Ձեր բժիշկը ցանկանում է խոսել ձեզ հետ", "Ваш врач хочет поговорить с вами"),
      detail: input.consultationText ? input.consultationText : pair("Your care team will contact you to arrange a time.", "Ձեր խնամքի թիմը կկապվի ձեզ հետ՝ ժամը համաձայնեցնելու համար։", "Ваша медицинская команда свяжется с вами, чтобы согласовать время."),
      ...(review.consultation ? { dueAt: review.consultation.scheduledAt } : {}),
      button: pair("See details", "Տեսնել մանրամասները", "Посмотреть подробности"),
    };
  // 7c. The doctor is preparing the plan (Khikar, 18 Oct: guide the member while results are reviewed).
  if (input.planPreparing)
    return {
      ...base, id: "journey-plan-preparing", kind: "waiting", href: "/patient/results",
      title: pair("Your doctor is preparing your plan", "Ձեր բժիշկը պատրաստում է ձեր պլանը", "Ваш врач готовит ваш план лечения"),
      detail: pair("Your care plan will appear here when your doctor approves it. No action is needed from you right now.", "Ձեր խնամքի պլանը կհայտնվի այստեղ, երբ բժիշկը հաստատի այն։ Այս պահին ձեզնից գործողություն չի պահանջվում։", "Ваш план лечения появится здесь после одобрения врачом. Сейчас вам ничего не нужно делать."),
      button: pair("See test status", "Տեսնել հետազոտության կարգավիճակը", "Посмотреть статус анализов"),
    };
  // 7b. The doctor released a clinic lab PDF to the member (QA N-02, 18 Oct).
  // Only results that belong to the current round: a newer visit that is not completed yet leads (Fable F2).
  const current = input.appointments ? currentAppointment(input.appointments) : null;
  const newest = input.released?.length ? [...input.released].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0] : null;
  const released = newest && (!current || current.portal?.checkin?.outcome === "completed" || newest.uploadedAt >= current.createdAt) ? newest : null;
  // 7. Results received: a recorded lab stage, or the clinic sent the visit's results (the result
  // link completes the visit, QA N-02), which is further along than any earlier stage.
  const visitCompleted = input.appointments ? currentAppointment(input.appointments)?.portal?.checkin?.outcome === "completed" : false;
  if (input.lab === "results-received" || visitCompleted || released)
    return {
      ...base, id: "journey-results", kind: "results", href: "/patient/results",
      title: review && review !== "none" && review.status === "review_pending"
        ? pair("Your results are with your doctor", "Ձեր արդյունքները ձեր բժշկի մոտ են", "Ваши результаты у вашего врача")
        : pair("Your lab results have arrived", "Ձեր լաբորատոր արդյունքները ստացվել են", "Ваши результаты анализов получены"),
      detail: pair("Your results and care plan will appear together after approval. No action is needed from you right now.", "Արդյունքներն ու խնամքի պլանը կհայտնվեն միասին՝ հաստատումից հետո։ Այս պահին ձեզնից գործողություն չի պահանջվում։", "Ваши результаты и план лечения появятся вместе после одобрения. Сейчас вам ничего не нужно делать."),
      button: pair("See test status", "Տեսնել հետազոտության կարգավիճակը", "Посмотреть статус анализов"),
    };
  // 6. Samples collected or at the lab.
  if (input.lab === "collected" || input.lab === "partial" || input.lab === "at-lab")
    return {
      ...base, id: "journey-samples", kind: "waiting", href: "/patient/results",
      title: input.lab === "collected" ? pair("Your samples were collected", "Ձեր նմուշները վերցված են", "Ваши образцы взяты") : pair("Your samples are at the lab", "Ձեր նմուշները լաբորատորիայում են", "Ваши образцы в лаборатории"),
      detail: input.lab === "collected"
        ? pair("The nurse recorded your samples as collected. They have not reached the lab yet.", "Բուժքույրը գրանցել է, որ նմուշները վերցված են։ Դրանք դեռ չեն հասել լաբորատորիա։", "Медсестра отметила, что ваши образцы взяты. Они ещё не поступили в лабораторию.")
        : pair("Your samples have reached the lab. Results are not available yet.", "Ձեր նմուշները հասել են լաբորատորիա։ Արդյունքները դեռ հասանելի չեն։", "Ваши образцы поступили в лабораторию. Результаты пока недоступны."),
      button: pair("See test status", "Տեսնել հետազոտության կարգավիճակը", "Посмотреть статус анализов"),
    };
  const visit = input.appointments ? currentAppointment(input.appointments) : null;
  // 5b. The nurse's visit steps (nurse visit flow). A recorded lab stage leads above. A booking made
  // after the latest step leads below. "Confirmed" alone leads only without a booked visit (a home
  // request), because the booked visit's own step carries its time and preparation.
  const nurse = input.nurseVisit;
  const order = ["confirmed", "samples-collected", "samples-at-lab", "completed"] as const;
  const latest = nurse?.steps.length ? [...nurse.steps].sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step)).at(-1)! : null;
  if (nurse && latest && (!visit || latest.at >= visit.createdAt) && (latest.step !== "confirmed" || !visit)) {
    const n = nurse.samplesTaken ?? 0;
    const step = { ...base, kind: "waiting" as const, href: "/patient/results", button: pair("See test status", "Տեսնել հետազոտության կարգավիճակը", "Посмотреть статус анализов") };
    if (latest.step === "completed")
      return {
        ...step, id: "journey-nurse-visit-done",
        title: pair("Your visit is done", "Ձեր այցը կայացել է", "Ваш визит завершён"),
        detail: n > 0
          ? pair(`The nurse recorded your visit and took ${n} ${n === 1 ? "sample" : "samples"}. Your results are not ready yet.`, `Բուժքույրը գրանցել է ձեր այցը և վերցրել ${n} նմուշ։ Արդյունքները դեռ պատրաստ չեն։`, `Медсестра отметила ваш визит. Количество взятых образцов: ${n}. Ваши результаты пока не готовы.`)
          : pair("The nurse recorded your visit. Your next step will appear here.", "Բուժքույրը գրանցել է ձեր այցը։ Հաջորդ քայլը կհայտնվի այստեղ։", "Медсестра отметила ваш визит. Ваш следующий шаг появится здесь."),
      };
    if (latest.step === "samples-at-lab")
      return { ...step, id: "journey-nurse-samples-sent", title: pair("Your samples were sent to the lab", "Ձեր նմուշներն ուղարկվել են լաբորատորիա", "Ваши образцы отправлены в лабораторию"), detail: pair("Your results are not ready yet. They will appear here.", "Արդյունքները դեռ պատրաստ չեն։ Դրանք կհայտնվեն այստեղ։", "Ваши результаты пока не готовы. Они появятся здесь.") };
    if (latest.step === "samples-collected")
      return { ...step, id: "journey-nurse-samples-collected", title: pair("Your samples were collected", "Ձեր նմուշները վերցված են", "Ваши образцы взяты"), detail: pair("The nurse took your samples. Your results are not ready yet.", "Բուժքույրը վերցրել է ձեր նմուշները։ Արդյունքները դեռ պատրաստ չեն։", "Медсестра взяла ваши образцы. Ваши результаты пока не готовы.") };
    return {
      ...step, id: "journey-nurse-confirmed", kind: "appointment", href: "/patient/service",
      title: pair("Your nurse confirmed the visit", "Ձեր բուժքույրը հաստատել է այցը", "Ваша медсестра подтвердила визит"),
      detail: pair(`${nurse.mode === "home" ? "Home visit" : "Visit"} ${when(nurse.startsAt).en}.`, `${nurse.mode === "home" ? "Տնային այց" : "Այց"}՝ ${when(nurse.startsAt).hy}։`, `${nurse.mode === "home" ? "Визит на дом" : "Визит"} ${when(nurse.startsAt).ru}.`),
      button: pair("View my visit", "Տեսնել իմ այցը", "Посмотреть мой визит"),
    };
  }
  if (visit) {
    const checkin = visit.portal?.checkin ?? null;
    const proposal = visit.portal?.channel === "portal" ? visit.portal.proposal : null;
    // 4. The clinic proposed a new time: the member accepts or declines on the visit page.
    if (proposal && visit.status !== "cancelled")
      return {
        ...base, id: "journey-proposal", kind: "appointment",
        title: pair("The clinic proposed a new time", "Կլինիկան առաջարկել է նոր ժամ", "Клиника предложила новое время"),
        detail: pair(`${when(proposal.startsAt).en} at ${proposal.clinicName}. Accept it if it works for you.`, `${when(proposal.startsAt).hy}, ${proposal.clinicName}։ Ընդունեք, եթե այն ձեզ հարմար է։`, `${when(proposal.startsAt).ru}, ${proposal.clinicName}. Примите, если вам удобно.`),
        button: pair("Review and accept", "Դիտել և ընդունել", "Посмотреть и принять"),
      };
    if (visit.status === "notification-pending")
      return {
        ...base, id: "journey-waiting", kind: "waiting",
        title: pair("Waiting for the clinic to confirm", "Սպասում է կլինիկայի հաստատմանը", "Ожидаем подтверждения клиники"),
        detail: pair("Your request is with the clinic. Your visit is booked once the clinic confirms it.", "Ձեր հարցումը կլինիկայում է։ Այցը գրանցված է, երբ կլինիկան հաստատի այն։", "Ваша заявка у клиники. Запись на визит будет оформлена после подтверждения клиникой."),
        button: pair("View my visit", "Տեսնել իմ այցը", "Посмотреть мой визит"),
      };
    if (visit.status !== "confirmed" || !visit.current)
      return {
        ...base, id: "journey-visit-check", kind: "appointment",
        title: pair("Your visit needs checking", "Ձեր այցը պետք է ստուգել", "Ваш визит нужно проверить"),
        detail: pair("Check the saved visit status. If it needs review, contact Noreon.", "Ստուգեք պահպանված այցի վիճակը։ Եթե այն պետք է վերանայել, կապվեք Նորեոն Հելթի հետ։", "Проверьте сохранённый статус визита. Если он требует проверки, свяжитесь с Нореон Хелс."),
        button: pair("View my visit", "Տեսնել իմ այցը", "Посмотреть мой визит"),
      };
    if (checkin?.outcome === "no-show")
      return {
        ...base, id: "journey-rebook", kind: "tests",
        title: pair("Book a new visit", "Գրանցեք նոր այց", "Запишитесь на новый визит"),
        detail: pair("The clinic recorded that you did not come to this visit.", "Կլինիկան գրանցել է, որ դուք չեք ներկայացել այս այցին։", "Клиника отметила, что вы не пришли на этот визит."),
        button: pair("Choose a visit", "Ընտրել այցը", "Выбрать визит"),
      };
    const ended = Date.parse(visit.current.endsAt) < input.now.getTime();
    if (checkin?.outcome === "arrived" || ended)
      return {
        ...base, id: "journey-visit-done", kind: "waiting", href: "/patient/results",
        // Only a recorded arrival says the visit happened; a passed time says only that (Fable F5).
        title: checkin?.outcome === "arrived" ? pair("Your visit is done", "Ձեր այցը կայացել է", "Ваш визит завершён") : pair("Your visit time has passed", "Ձեր այցի ժամն անցել է", "Время вашего визита прошло"),
        detail: checkin?.outcome === "arrived"
          ? pair("The clinic recorded your arrival. Your sample status will appear here.", "Կլինիկան գրանցել է ձեր ներկայանալը։ Նմուշների կարգավիճակը կհայտնվի այստեղ։", "Клиника отметила ваше прибытие. Статус ваших образцов появится здесь.")
          : pair("Your sample status will appear here once the clinic records it.", "Նմուշների կարգավիճակը կհայտնվի այստեղ, երբ կլինիկան գրանցի այն։", "Статус ваших образцов появится здесь, когда клиника его внесёт."),
        button: pair("See test status", "Տեսնել հետազոտության կարգավիճակը", "Посмотреть статус анализов"),
      };
    // 5. Visit confirmed.
    const a = visit.current, at = when(a.startsAt), clinic = input.clinics[a.clinicId];
    const prep = a.preparation.trim();
    const shortPrep = pair("Read your preparation before the visit.", "Այցից առաջ կարդացեք նախապատրաստման ցուցումները։", "Прочитайте указания по подготовке перед визитом.");
    const prepIn = (locale:Locale) => !isTextUsableInLocale(prep,locale) || prep.length <= PREP_INLINE_MAX ? memberInstruction(prep,locale) : shortPrep[locale];
    const prepText = pair(prepIn('en'),prepIn('hy'),prepIn('ru'));
    const where = a.mode === "home"
      ? pair(`Home visit at ${memberInstruction(a.location,'en')}.`, `Տնային այց՝ ${memberInstruction(a.location,'hy')}։`, `Визит на дом: ${memberInstruction(a.location,'ru')}.`)
      : pair(`At ${clinic ? `${clinic}, ` : ""}${memberInstruction(a.location,'en')}.`, `${clinic ? `${clinic}, ` : ""}${memberInstruction(a.location,'hy')}։`, `${clinic ? `${clinic}, ` : ""}${memberInstruction(a.location,'ru')}.`);
    return {
      ...base, id: "journey-visit", kind: "appointment",
      title: pair(`Your visit is ${at.en}`, `Ձեր այցը՝ ${at.hy}`, `Ваш визит: ${at.ru}`),
      detail: pair(`${where.en} ${prepText.en}`.trim(), `${where.hy} ${prepText.hy}`.trim(), `${where.ru} ${prepText.ru}`.trim()),
      button: pair("See visit details and preparation", "Տեսնել այցի մանրամասներն ու նախապատրաստումը", "Посмотреть подробности визита и подготовку"),
      ...(a.mode === "clinic" ? { secondary: { href: mapLink(clinic ? `${clinic}, ${a.location}` : a.location), label: pair("Open map", "Բացել քարտեզը", "Открыть карту") } } : {}),
    };
  }
  // 2. Review request not sent yet (only when review requests are on and the read succeeded).
  if (review === "none")
    return {
      ...base, id: "journey-review", kind: "consultation", href: "/patient/review",
      title: pair("Send your review request", "Ուղարկեք վերանայման հարցումը", "Отправьте запрос на рассмотрение врачом"),
      detail: pair("Request a review so your assigned doctor can view your answers and recorded measurements.", "Ուղարկեք հարցում, որպեսզի ձեր նշանակված բժիշկը կարողանա դիտել ձեր պատասխաններն ու գրանցված չափումները։", "Отправьте запрос, чтобы ваш назначенный врач мог просмотреть ваши ответы и записанные измерения."),
      button: pair("Send my review request", "Ուղարկել վերանայման հարցումը", "Отправить мой запрос врачу"),
    };
  if (input.hasOpenRequest)
    return {
      ...base, id: "journey-request", kind: "waiting",
      title: pair("Your test request is saved", "Հետազոտության ձեր հարցումը պահպանված է", "Ваша заявка на анализы сохранена"),
      detail: pair("Your request is with the Noreon team. Your visit details will appear here.", "Ձեր հարցումը Նորեոն Հելթի թիմի մոտ է։ Այցի մանրամասները կհայտնվեն այստեղ։", "Ваша заявка у команды Нореон Хелс. Подробности вашего визита появятся здесь."),
      button: pair("View my request", "Տեսնել իմ հարցումը", "Посмотреть мою заявку"),
    };
  // 3. Book tests (clinic or home).
  if (input.canBook && input.appointments !== undefined)
    return {
      ...base, id: "journey-book", kind: "tests",
      title: pair("Book your tests", "Պլանավորեք ձեր հետազոտությունները", "Запишитесь на анализы"),
      detail: pair("Choose a clinic visit or a home visit for your tests.", "Ընտրեք այց կլինիկա կամ տնային այց ձեր հետազոտությունների համար։", "Выберите визит в клинику или на дом для сдачи анализов."),
      button: pair("Choose a visit", "Ընտրել այցը", "Выбрать визит"),
    };
  if (review)
    return {
      ...base, id: "journey-reviewing", kind: "waiting", href: "/patient/review",
      title: review.status === "awaiting_assignment" ? pair("Your review request is saved", "Ձեր վերանայման հարցումը պահպանված է", "Ваш запрос врачу сохранён") : doctorName ? pair(`Your request is with ${doctorName}`, "Ձեր հարցումը ձեր բժշկի մոտ է", `Ваш запрос у врача ${doctorName}`) : pair("Your request is with your doctor", "Ձեր հարցումը ձեր բժշկի մոտ է", "Ваш запрос у вашего врача"),
      // Naming the one assigned doctor: approved by Khikar 17 Oct, wording for Armen to confirm.
      detail: review.status === "awaiting_assignment" ? pair("Your request is saved. Doctor assignment is pending.", "Ձեր հարցումը պահպանված է։ Բժշկի նշանակումը սպասման մեջ է։", "Ваш запрос сохранён. Ожидается назначение врача.") : input.doctorName
        ? pair(`${doctorName} reviews your answers, tests, home readings and reports together. Your next step will appear here.`, `Ձեր բժիշկը՝ ${doctorName}, միասին դիտարկում է ձեր պատասխանները, հետազոտությունները, տնային չափումներն ու զեկույցները։ Հաջորդ քայլը կհայտնվի այստեղ։`, `${doctorName} рассматривает вместе ваши ответы, анализы, домашние измерения и отчёты. Ваш следующий шаг появится здесь.`)
        : pair("Your request is assigned to a doctor and awaits review.", "Ձեր հարցումը նշանակված է բժշկին և սպասում է վերանայման։", "Ваш запрос назначен врачу и ожидает рассмотрения."),
      button: pair("See my request", "Տեսնել իմ հարցումը", "Посмотреть мой запрос"),
    };
  return null;
}
