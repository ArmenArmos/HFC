import { pick, type Locale } from "@/lib/locale";
import type { Appointment } from "@/lib/real-booking/appointment-schema";
import { addDays, currentWeek, weekPhase, weekSlots, yerevanDate, yerevanInstant, type BpWeekRead } from "@/lib/bp-week/model";
import type { Stage } from "@/lib/programme/stages";
import { formatMemberDate } from "@/lib/patient/date-format";
import { currentAppointment } from "./journey-step";

/**
 * The next dated thing for Home (product review §4.1, Khikar 19 Oct 01:25): "caught up" with no date is
 * the state members leave in. From saved state only, the soonest of: a confirmed visit or a time the clinic
 * proposed, an arranged consultation, the next BP-week reading slot or the week's start, and the next
 * programme checkpoint (week-4 review, month 3, month 6; dates from programme_settings). Nothing here
 * invents a date: results have no promised day, so they are never listed. Pure; a read that failed is
 * passed as undefined and simply contributes nothing.
 */
export type NextDateKind = "visit" | "proposal" | "consultation" | "bp-week" | "checkpoint";
export type NextDate = {
  kind: NextDateKind;
  /** The instant, or a Yerevan calendar day (YYYY-MM-DD) when only the day is known. */
  at: string;
  allDay: boolean;
  /** Its saved time has passed and it is still to do (a BP slot not done yet, a checkpoint still open). */
  overdue: boolean;
  title: Record<Locale, string>;
  href: string;
};
export type NextDateInput = {
  now: Date;
  appointments?: Appointment[];
  consultationAt?: string | null;
  bpWeek?: BpWeekRead | null;
  /** Programme stages, when the programme is on. */
  stages?: Stage[] | null;
  /** Kinds the card above already shows (the primary next step), so they are not repeated. */
  skip?: NextDateKind[];
};

const pair = (en: string, hy: string, ru: string) => ({ en, hy, ru });

function candidates(input: NextDateInput): NextDate[] {
  const now = input.now, today = yerevanDate(now), out: NextDate[] = [];
  const visit = input.appointments ? currentAppointment(input.appointments) : null;
  const proposal = visit?.portal?.channel === "portal" ? visit.portal.proposal : null;
  if (proposal && visit?.status !== "cancelled" && Date.parse(proposal.startsAt) > now.getTime())
    out.push({ kind: "proposal", at: proposal.startsAt, allDay: false, overdue: false, title: pair("New visit time proposed by the clinic", "Կլինիկայի առաջարկած նոր այցի ժամ", "Новое время визита, предложенное клиникой"), href: "/patient/service" });
  else if (visit?.status === "confirmed" && visit.current && visit.portal?.checkin?.outcome == null && Date.parse(visit.current.startsAt) > now.getTime())
    out.push({ kind: "visit", at: visit.current.startsAt, allDay: false, overdue: false,
      title: visit.current.mode === "home" ? pair("Home visit for your tests", "Տնային այց ձեր հետազոտությունների համար", "Визит на дом для сдачи анализов") : pair("Clinic visit for your tests", "Այց կլինիկա ձեր հետազոտությունների համար", "Визит в клинику для сдачи анализов"),
      href: "/patient/service" });
  if (input.consultationAt && Date.parse(input.consultationAt) > now.getTime())
    out.push({ kind: "consultation", at: input.consultationAt, allDay: false, overdue: false, title: pair("Talk with your doctor", "Զրույց ձեր բժշկի հետ", "Поговорите с вашим врачом"), href: "/patient/review" });
  const week = input.bpWeek ? currentWeek(input.bpWeek, now) : null;
  if (week) {
    const phase = weekPhase(week, now);
    if (phase === "not-started")
      out.push({ kind: "bp-week", at: yerevanInstant(week.startsOn, week.morningTime).toISOString(), allDay: false, overdue: false, title: pair("Your blood pressure week starts", "Սկսվում է ձեր ճնշման շաբաթը", "Начинается ваша неделя измерения давления"), href: "/patient/bp-week" });
    else if (phase === "running") {
      const slot = weekSlots(week, now).find((s) => (s.state === "due" || s.state === "partial" || s.state === "upcoming") && s.date >= today);
      if (slot)
        // The slot's own saved time, even when it is due now (Astra F1): the date is never the render time.
        out.push({ kind: "bp-week", at: yerevanInstant(slot.date, slot.time).toISOString(), allDay: false, overdue: slot.state !== "upcoming",
          title: slot.slot === "morning" ? pair("Morning blood pressure readings", "Առավոտյան ճնշման չափումներ", "Утренние измерения давления") : pair("Evening blood pressure readings", "Երեկոյան ճնշման չափումներ", "Вечерние измерения давления"),
          href: "/patient/bp-week" });
    }
  }
  // The first checkpoint not completed, even when its date has passed (Astra F2): it stays the next thing until it is done.
  const checkpoint = input.stages?.find((s) => s.checkpoint && s.checkpoint.state !== "completed");
  if (checkpoint?.checkpoint)
    out.push({ kind: "checkpoint", at: checkpoint.checkpoint.dueOn, allDay: true, overdue: checkpoint.checkpoint.dueOn < today, title: checkpoint.title, href: "/patient/progress#programme-timeline-title" });
  return out;
}

/** An all-day date sorts at the start of its Yerevan day. */
const sortKey = (d: NextDate) => (d.allDay ? Date.parse(`${d.at}T00:00:00+04:00`) : Date.parse(d.at));

export function nextDatedThing(input: NextDateInput): NextDate | null {
  const skip = new Set(input.skip ?? []);
  return candidates(input).filter((c) => !skip.has(c.kind)).sort((a, b) => sortKey(a) - sortKey(b))[0] ?? null;
}

/** "Today, 08:00", "Tomorrow, 19:00", "Mon 14 Nov, 10:30", a day only, "Now (from 08:00)" or "Due 18 October". */
export function nextDateWhen(d: NextDate, locale: Locale, now: Date): string {
  const today = yerevanDate(now), day = d.allDay ? d.at : yerevanDate(new Date(d.at));
  if (d.overdue) {
    if (d.allDay) {
      const date = formatMemberDate(`${day}T12:00:00+04:00`, locale, { timeZone: "Asia/Yerevan", day: "numeric", month: "long" });
      return pick(locale, { en: `Due ${date}`, hy: `Ժամկետը՝ ${date}`, ru: `Срок: ${date}` });
    }
    const from = formatMemberDate(d.at, locale, { timeZone: "Asia/Yerevan", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    return pick(locale, { en: `Now (from ${from})`, hy: `Հիմա (${from}-ից)`, ru: `Сейчас (с ${from})` });
  }
  const label = day === today ? pick(locale, { en: "Today", hy: "Այսօր", ru: "Сегодня" }) : day === addDays(today, 1) ? pick(locale, { en: "Tomorrow", hy: "Վաղը", ru: "Завтра" })
    : formatMemberDate(`${day}T12:00:00+04:00`, locale, { timeZone: "Asia/Yerevan", weekday: "short", day: "numeric", month: "long" });
  if (d.allDay) return label;
  const time = formatMemberDate(d.at, locale, { timeZone: "Asia/Yerevan", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${label}, ${time}`;
}
