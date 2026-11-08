import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemberHome } from "@/components/patient/member-home";
import { memberHomeEnabled } from "@/lib/patient/member-home-config";
import { EMPTY_CARE, type CareAction, type CareData } from "@/lib/patient-care/types";
import { DEFAULT_REMINDERS } from "@/lib/patient-care/reminder-preferences";
import type { MemberLdl } from "@/lib/ldl/schema";

assert.equal(memberHomeEnabled({}), false);
assert.equal(memberHomeEnabled({ NOREON_MEMBER_HOME_PROTOTYPE: "false" }), false);
assert.equal(memberHomeEnabled({ NOREON_MEMBER_HOME_PROTOTYPE: "true" }), true);
const now = new Date("2026-10-31T08:00:00Z");
const next: CareAction = {
  id: "questions", kind: "questions", href: "/patient/questions",
  title: { en: "Your saved next step", hy: "Ձեր հաջորդ քայլը", ru: "Ваш следующий шаг" },
  detail: { en: "Complete your answers", hy: "Լրացրեք պատասխանները", ru: "Заполните ответы" },
  button: { en: "Continue my answers", hy: "Շարունակել պատասխանները", ru: "Продолжить" },
};
const render = (overrides: Partial<Parameters<typeof MemberHome>[0]> = {}) => renderToStaticMarkup(createElement(MemberHome, {
  locale: "en", greeting: "Good afternoon, Test", date: "31 October", now,
  care: EMPTY_CARE, measurements: [], preferences: DEFAULT_REMINDERS,
  next, nextDate: null, ldl: undefined, doctor: undefined, journeyCurrent: 0, exercise: "suggest", ...overrides,
}));
const visitNext = { ...next, href: "/patient/service" };
assert.match(render({ chat: true, next: visitNext }), /href="\/patient\/zoe\?card=visit"/, "Chat next step opens a visit card");
assert.match(render({ chat: false, next: visitNext }), /href="\/patient\/service"/, "Previous pages keep their booking destination");

for (const locale of ["en", "hy"] as const) {
  const html = render({ locale });
  assert.match(html, /data-member-home/);
  assert.match(html, /href="\/patient\/questions"/);
  assert.match(html, /href="\/patient\/dashboard\?view=classic"/);
  for (const path of ["zoe", "progress", "care", "medicines", "bp-week", "service", "learn", "account", "help", "team", "reports", "health/profile", "progress/earlier", "results/history", "account/reminders"]) {
    assert.ok(html.includes(`href="/patient/${path}"`), `reachable destination ${path}, ${locale}`);
  }
  assert.doesNotMatch(html, /mmHg|mmol\/L|data-home-doctor|data-home-medicines/);
  assert.doesNotMatch(html, /at goal|at target|No doctor|Petrosyan|Narine|Mariam/i);
  assert.ok(html.includes(next.title[locale]));
  assert.match(html, /class="member-home-journey"/);
  assert.match(html, /aria-current="step"/);
}

const care: CareData = { ...EMPTY_CARE, plan: {
  id: "plan", clinician: "Recorded doctor", publishedAt: "2026-10-20T08:00:00Z", acknowledgedAt: null,
  instructions: "Recorded instructions", medications: [{ id: "med", planId: "plan", name: "Recorded medicine", dose: "Recorded dose", instructions: "Recorded instruction", times: ["08:00"], startDate: "2026-10-20", endDate: null, active: true }],
} };
const ldl: MemberLdl = { version: "ldl-member-v1", enabled: true, inPathway: true, goal: null, observations: [
  { id: "checked", value: 1.36, unit: "mmol/L", on: "2026-10-29", source: "upload_checked", name: null, memberVisible: true },
  { id: "unreviewed", value: 9, unit: "mmol/L", on: "2026-10-30", source: "clinic_result", name: null, memberVisible: false },
] };
const html = render({ care, ldl, doctor: "Recorded doctor", measurements: [
  { id: "r", submissionId: "s", source: "manual", systolic: 128, diastolic: 82, measuredAt: "2026-10-30T08:00:00Z" },
  { id: "future", submissionId: "f", source: "manual", systolic: 199, diastolic: 111, measuredAt: "2026-11-02T08:00:00Z" },
] });
assert.match(html, /128\/82/);
assert.match(html, /1\.36/);
assert.doesNotMatch(html, /199\/111|>9<|at goal|at target/i);
assert.match(html, /Recorded doctor/);
assert.match(html, /data-home-medicines/);
assert.match(html, /0\/1/);
assert.match(html, /dateTime="2026-10-30T08:00:00Z"/);
assert.match(html, /dateTime="2026-10-29"/);
assert.match(html, /dateTime="2026-10-31"/);
assert.match(html, /Plan medicines today/);
assert.match(html, /<details id="member-home-menu"(?![^>]*open)/);
assert.doesNotMatch(html, /member-home-plan-title/);
assert.doesNotMatch(render({ doctor: null }), /data-home-doctor/);
assert.doesNotMatch(render({ ldl: { version: "ldl-member-v1", enabled: false } }), /mmol\/L/);
assert.doesNotMatch(render({ next: { ...next, href: "/patient/dashboard#daily-routine", kind: "medication" } }), /href="\/patient\/dashboard#daily-routine"/);
assert.match(render({ next: { ...next, href: "/patient/dashboard#daily-routine", kind: "medication" } }), /class="member-home-button" href="\/patient\/medicines"/);
console.log("Member Home: dark flag, bilingual destinations, empty/unavailable reads, saved facts, no hidden or future values, no invented clinical status.");

// Chat reuses Home's next step, facts and notice inventory; only its page navigation is omitted.
const { HomeNotices, HOME_NOTICE_IDS } = await import("@/components/patient/home-notices");
for (const locale of ["hy", "en", "ru"] as const) {
  for (const active of [[], [...HOME_NOTICE_IDS], ...HOME_NOTICE_IDS.map(id => [id])]) {
    const cards = Object.fromEntries(HOME_NOTICE_IDS.map(id => [id, active.includes(id) ? createElement("p", {}, `notice:${id}`) : null])) as Record<typeof HOME_NOTICE_IDS[number], import("react").ReactNode>;
    const notices = createElement(HomeNotices, { cards });
    const classic = render({ locale, notices });
    const chat = render({ locale, notices, chat: true, care, ldl });
    assert.deepEqual([...chat.matchAll(/data-home-notice="([^"]+)"/g)].map(m => m[1]), [...classic.matchAll(/data-home-notice="([^"]+)"/g)].map(m => m[1]));
    for (const id of active) assert.ok(chat.includes(`notice:${id}`), `Chat retains ${id}`);
    assert.match(chat, /data-member-chat-today/);
    assert.match(chat, /0\/1/);
    assert.match(chat, /1\.36/);
    assert.doesNotMatch(chat, /member-home-menu|member-home-chat|member-home-quick|data-member-home[ >]/);
    assert.ok(chat.includes(next.title[locale]));
  }
}
console.log("Home/chat notice parity: all notices, each alone and none; three locales; shared next step and dated facts.");

assert.match(render({ chat: true, next: { ...next, href: "/patient/care#plan" } }), /href="\/patient\/zoe\?card=care"/, "The next step opens the plan in chat, including an anchored page action");
