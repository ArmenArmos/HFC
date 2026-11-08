import type { PatientLocale } from "@/lib/patient/copy";
import { formatMemberDate } from "@/lib/patient/date-format";

// Fixed English short months: some ICU builds print "Sept", which read as "Sept 26" next to a year.
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const yerevanYear = (at: number) => Number(formatMemberDate(new Date(at), "en", { timeZone: "Asia/Yerevan", year: "numeric" }));

/**
 * Chart axis labels as "26 Sep" (QA N-12): day and month, with the year where it changes from the
 * previous tick (or on the first tick when the range stays in one year), so no label reads as a
 * month and a year.
 */
export function axisDateLabel(at: number, ticks: readonly number[], locale: PatientLocale): string {
  const index = ticks.indexOf(at);
  const year = yerevanYear(at);
  const years = ticks.map(yerevanYear);
  // The year marks where it changes; the first tick carries it only when the range stays within one year.
  const showYear = index > 0 ? years[index - 1] !== year : new Set(years).size <= 1;
  if (locale === "hy") return formatMemberDate(new Date(at), "hy", { timeZone: "Asia/Yerevan", day: "numeric", month: "short", ...(showYear ? { year: "numeric" } : {}) });
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Yerevan", day: "numeric", month: "numeric" }).formatToParts(new Date(at));
  const day = Number(parts.find(p => p.type === "day")!.value), month = Number(parts.find(p => p.type === "month")!.value);
  return `${day} ${EN_MONTHS[month - 1]}${showYear ? ` ${year}` : ""}`;
}

const DAY = 864e5;
/**
 * The time axis of a progress chart (QA 179): the data's own range, never into the future. Readings
 * within one day get a week before them, so the single point is not pinned to the left edge, and the
 * axis ends today (or at the reading, if that is later). `now` is rounded down to the hour so a
 * server and a browser render draw the same ticks.
 */
export function chartTimeDomain(first: number, last: number, now: number = Date.now()): [number, number] {
  if (last - first >= DAY) return [first, last];
  const today = Math.floor(now / 36e5) * 36e5;
  return [first - 7 * DAY, Math.max(last, Math.min(today, last + 7 * DAY))];
}
