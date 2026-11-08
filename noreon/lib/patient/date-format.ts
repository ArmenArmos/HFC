import type { PatientLocale } from "./copy";

// Keep Armenian labels independent of the ICU locale data shipped by Node or
// browsers, following the deterministic names used by the existing demo clock.
const MONTHS = ["հունվարի", "փետրվարի", "մարտի", "ապրիլի", "մայիսի", "հունիսի", "հուլիսի", "օգոստոսի", "սեպտեմբերի", "հոկտեմբերի", "նոյեմբերի", "դեկտեմբերի"];
const SHORT_MONTHS = ["հնվ", "փտր", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"];
const WEEKDAYS = ["կիրակի", "երկուշաբթի", "երեքշաբթի", "չորեքշաբթի", "հինգշաբթի", "ուրբաթ", "շաբաթ"];
const SHORT_WEEKDAYS = ["կիր", "երկ", "երք", "չրք", "հնգ", "ուրբ", "շբթ"];
const NARROW_WEEKDAYS = ["Կ", "Ե", "Ե", "Չ", "Հ", "Ո", "Շ"];

/** Member display dates. English and Russian use Intl; Armenian
 * uses explicit names and numeric parts in the requested timezone. */
export function formatMemberDate(
  value: string | number | Date,
  locale: PatientLocale,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (locale === "en") return new Intl.DateTimeFormat("en-GB", options).format(date);
  if (locale === "ru") return new Intl.DateTimeFormat("ru-RU", options).format(date);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: options.timeZone ?? "Asia/Yerevan",
    calendar: "gregory", numberingSystem: "latn",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === name)!.value;
  const year = Number(part("year")), month = Number(part("month")), day = Number(part("day"));
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const dayStyle = options.day ?? (options.dateStyle ? "numeric" : undefined);
  const monthStyle = options.month ?? (options.dateStyle === "long" || options.dateStyle === "full" ? "long" : options.dateStyle ? "short" : undefined);
  const yearStyle = options.year ?? (options.dateStyle ? "numeric" : undefined);
  const pieces: string[] = [];
  if (dayStyle) pieces.push(dayStyle === "2-digit" ? part("day") : String(day));
  if (monthStyle) pieces.push(monthStyle === "long" ? MONTHS[month - 1] : monthStyle === "short" || monthStyle === "narrow" ? SHORT_MONTHS[month - 1] : monthStyle === "2-digit" ? part("month") : String(month));
  if (yearStyle) pieces.push(yearStyle === "2-digit" ? part("year").slice(-2) : part("year"));
  const weekdayStyle = options.weekday ?? (options.dateStyle === "full" ? "long" : undefined);
  const weekdayLabel = weekdayStyle === "narrow" ? NARROW_WEEKDAYS[weekday] : weekdayStyle === "short" ? SHORT_WEEKDAYS[weekday] : weekdayStyle ? WEEKDAYS[weekday] : "";
  const dateLabel = [weekdayLabel, pieces.join(" ")].filter(Boolean).join(", ");
  const timeLabel = options.timeStyle || options.hour || options.minute ? `${part("hour")}:${part("minute")}` : "";
  return [dateLabel, timeLabel].filter(Boolean).join(", ");
}
