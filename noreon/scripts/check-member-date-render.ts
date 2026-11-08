import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stamp } from "@/components/patient-care/common";
import { formatMemberDate } from "@/lib/patient/date-format";
import { MedicineCalendar } from "@/components/patient-care/medicine-calendar";

const Native = Intl.DateTimeFormat;
const samples = ["2026-10-11T19:59:00Z", "2026-10-11T20:01:00Z", "2026-12-31T20:01:00Z"];
const enBefore = samples.map(value => stamp(value, "en"));
const normal = samples.map(value => stamp(value, "hy"));
// Model a browser ICU build without Armenian data: unsupported hy-AM falls back
// to English. The output must still equal the server's Armenian labels.
const Fallback = function(locale: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
  return new Native(String(locale).startsWith("hy") ? "en-GB" : locale, options);
} as unknown as typeof Intl.DateTimeFormat;
Intl.DateTimeFormat = Fallback;
try {
  assert.deepEqual(samples.map(value => stamp(value, "hy")), normal, "Armenian labels must be identical without hy-AM ICU data");
  assert.deepEqual(samples.map(value => stamp(value, "en")), enBefore, "English behavior remains unchanged");
  const weekdays = ["Կ", "Ե", "Ե", "Չ", "Հ", "Ո", "Շ"];
  for (let i = 0; i < 7; i++) {
    assert.equal(formatMemberDate(`2026-10-${11 + i}T12:00:00+04:00`, "hy", { weekday: "narrow", timeZone: "Asia/Yerevan" }), weekdays[i]);
  }
  const months = ["հնվ", "փտր", "մրտ", "ապր", "մյս", "հնս", "հլս", "օգս", "սեպ", "հոկ", "նոյ", "դեկ"];
  for (let i = 0; i < 12; i++) {
    assert.equal(formatMemberDate(Date.UTC(2026, i, 1), "hy", { month: "short", timeZone: "UTC" }), months[i]);
  }
  assert.equal(formatMemberDate(samples[1], "hy", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Yerevan" }), "00:01");
  assert.equal(formatMemberDate("2026-10-11T23:59:00Z", "hy", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }), "11 հոկ 2026", "Date-only report retains UTC rather than shifting its collection date");
  assert.equal(formatMemberDate("2026-10-11T23:59:00Z", "hy", { month: "short", year: "2-digit", timeZone: "UTC" }), "հոկ 26", "Historical chart tick format");
  assert.equal(formatMemberDate(samples[1], "en", { weekday: "narrow", timeZone: "Asia/Yerevan" }), "M");
  assert.equal(stamp(samples[1], "hy"), "12 հոկ 2026, 00:01", "Yerevan midnight crosses to the correct day");
  assert.equal(stamp(samples[2], "hy", false), "1 հնվ 2027", "Yerevan midnight crosses the year boundary");
  const html = renderToStaticMarkup(createElement(MedicineCalendar, {
    locale: "hy", days: [{ day: "2026-10-12", taken: 0, skipped: 0, schedule: "scheduled" }],
  }));
  assert.ok(html.includes("Ե"), "Monday weekday remains Armenian in the actual calendar render");
  assert.ok(!/>M</.test(html), "No English fallback weekday in Armenian calendar");
} finally {
  Intl.DateTimeFormat = Native;
}
console.log("Member Armenian dates/calendar remain deterministic without Armenian ICU; Yerevan boundaries and English output pass.");
