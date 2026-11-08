import assert from "node:assert/strict";
import { bookingDateText, bookingTimeText, bookingTimestampText, termsText } from "../lib/real-booking/display-time";
import type { BookingTerms } from "../lib/real-booking/schema";

const terms: BookingTerms = { startsAt: "2026-10-15T05:00:00Z", endsAt: "2026-10-15T07:00:00Z", timezone: "Asia/Yerevan", mode: "clinic", location: "Synthetic formatter check" };
assert.equal(termsText(terms, "en"), "15 Oct 2026, 09:00–11:00");
assert.equal(termsText(terms, "hy"), "15 հոկ 2026, 09:00–11:00");
assert.equal(bookingTimestampText("2026-10-13T12:00:00Z", "hy"), "13 հոկ 2026, 16:00");
assert.equal(bookingTimestampText("2026-12-31T21:00:00Z", "en"), "1 Jan 2027, 01:00");
// QA 213: the date and the time come from their own formatters, never by splitting a timestamp.
assert.equal(bookingDateText("2026-11-02T05:00:00Z", "hy"), "2 նոյ 2026");
assert.equal(bookingTimeText("2026-11-02T05:00:00Z", "hy"), "09:00");
assert.equal(bookingDateText("2026-11-02T05:00:00Z", "en"), "2 Nov 2026");
assert.equal(bookingTimeText("2026-11-02T05:00:00Z", "ru"), "09:00");
const overnight = { ...terms, startsAt: "2026-10-15T19:00:00Z", endsAt: "2026-10-15T21:00:00Z" };
assert.equal(termsText(overnight, "en"), "15 Oct 2026, 23:00 – 16 Oct 2026, 01:00");
assert.equal(termsText(overnight, "hy"), "15 հոկ 2026, 23:00 – 16 հոկ 2026, 01:00");
assert.equal(termsText({ ...terms, startsAt: "2026-10-15T09:00:00+04:00", endsAt: "2026-10-15T11:00:00+04:00" }, "hy"), termsText(terms, "hy"));

// Missing Armenian ICU data still uses the shared deterministic Armenian labels.
const original = Intl.DateTimeFormat;
try {
  Intl.DateTimeFormat = function(locale: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    if(String(locale).startsWith("hy")) throw Error("Armenian locale data unavailable");
    return new original(locale,options);
  } as typeof Intl.DateTimeFormat;
  assert.equal(termsText(terms, "hy"), "15 հոկ 2026, 09:00–11:00");
  assert.equal(bookingTimestampText("2026-10-13T12:00:00Z", "hy"), "13 հոկ 2026, 16:00");
} finally { Intl.DateTimeFormat = original; }
console.log("Booking time display passed: EN/HY deterministic without Armenian ICU data, offset equivalence, Yerevan midnight/year boundaries.");

// All three locales share the member timestamp, including one-ended preferences.
const {formatMemberDate}=await import('@/lib/patient/date-format');
for(const locale of ['en','hy','ru'] as const){
 const stamp=(value:string)=>formatMemberDate(value,locale,{timeZone:'Asia/Yerevan',dateStyle:'medium',timeStyle:'short'});
 assert.equal(bookingTimestampText(terms.startsAt,locale),stamp(terms.startsAt));
 const preference={...terms,endsAt:undefined};
 assert.equal(termsText(preference,locale),stamp(terms.startsAt));
 assert.equal(termsText(overnight,locale),`${stamp(overnight.startsAt)} ${locale==='ru'?'-':'–'} ${stamp(overnight.endsAt)}`,'An overnight interval shows both local dates');
}
