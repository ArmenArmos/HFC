import type { BookingPreference } from "./schema";
import { formatMemberDate } from "@/lib/patient/date-format";

import type { Locale } from "@/lib/locale";
export function bookingLocationText(mode: BookingPreference["mode"], locale: Locale) {
  const labels = {clinic: ["At a clinic", "Կլինիկայում", "В клинике"], home: ["At home", "Տանը", "Дома"], office: ["At an office", "Աշխատավայրում", "В офисе"]};
  return labels[mode][locale === "hy" ? 1 : locale === "ru" ? 2 : 0];
}
// Booking displays share the member timestamp format and retain Yerevan wall time.
function parts(value: string, locale: Locale) {
  return {
    date: bookingDateText(value, locale),
    time: bookingTimeText(value, locale),
    timestamp: bookingTimestampText(value, locale),
  };
}

export function bookingDateText(value: string, locale: Locale) {
  return formatMemberDate(value, locale, {timeZone:"Asia/Yerevan", dateStyle:"medium"});
}

export function bookingTimeText(value: string, locale: Locale) {
  return formatMemberDate(value, locale, {timeZone:"Asia/Yerevan", timeStyle:"short"});
}

export function bookingTimestampText(value: string, locale: Locale) {
  return formatMemberDate(value, locale, {timeZone:"Asia/Yerevan", dateStyle:"medium", timeStyle:"short"});
}

export function termsText(terms: BookingPreference, locale: Locale) {
  const start = parts(terms.startsAt, locale);
  if (!terms.endsAt) return start.timestamp;
  const end = parts(terms.endsAt, locale);
  if (start.date === end.date) return `${start.timestamp}${locale === "ru" ? "-" : "–"}${end.time}`;
  return `${start.timestamp} ${locale === "ru" ? "-" : "–"} ${end.timestamp}`;
}
