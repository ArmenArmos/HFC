// Short lessons: content rules (three languages, length, voice, no doses, sources), who sees what
// (approved only, drafts only on staging, never rejected), and Zoe's topic match. Pure.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LessonBody } from "@/components/lessons/lesson-body";
import {LessonContent} from "@/components/lessons/lesson-content";
import { LessonOfferCard } from "@/components/lessons/lesson-controls";
import { LESSONS, LESSON_LOCALES, type Lesson, type LessonTopic } from "@/lib/lessons/content";
import { LESSON_ID, currentPlanMedicineNames, findLesson, lessonTopics, lessonsShowDrafts, pickLesson, recentMemberTexts, visibleLessons, wordCount } from "@/lib/lessons/catalogue";

// Content.
assert.equal(LESSONS.length, 20, "Twenty lessons");
assert.equal(new Set(LESSONS.map((l) => l.id)).size, LESSONS.length, "Unique ids");
const topics: LessonTopic[] = ["hypertension", "home-bp", "salt", "diabetes", "low-sugar", "high-sugar", "lipids", "activity", "weight", "medicines", "emergency"];
for (const t of topics) assert.ok(LESSONS.some((l) => l.topic === t), `A lesson on ${t}`);
for (const l of LESSONS) {
  assert.match(l.id, LESSON_ID, `${l.id}: id format (the database checks the same pattern)`);
  assert.ok(l.sources.length > 0 && l.sources.every((s) => s.url.startsWith("https://") && s.label.length > 0), `${l.id}: sources cited`);
  for (const loc of LESSON_LOCALES) {
    const text = [l.title[loc], ...l.body[loc]].join("\n");
    assert.ok(l.title[loc].trim().length > 0 && l.body[loc].length > 0, `${l.id}/${loc}: title and body`);
    assert.ok(wordCount(l.body[loc]) <= 150, `${l.id}/${loc}: at most 150 words (has ${wordCount(l.body[loc])})`);
    assert.doesNotMatch(text, /—/, `${l.id}/${loc}: no em dash (voice guide)`);
    assert.doesNotMatch(text, /!/, `${l.id}/${loc}: no exclamation marks (voice guide)`);
    // No medicine doses: no amounts in mg, units or tablets-per-day instructions.
    assert.doesNotMatch(text, /\d\s*(mg|mcg|мг|մգ|units?|ЕД|միավոր)\b/iu, `${l.id}/${loc}: no doses`);
    assert.doesNotMatch(text, /\b(patient|user)s?\b/i, `${l.id}/${loc}: never patient or user`);
  }
  // Every lesson that names an emergency gives 103, the Armenian emergency number.
  if (l.topic === "emergency" || l.topic === "low-sugar" || l.topic === "high-sugar") for (const loc of LESSON_LOCALES) assert.match(l.body[loc].join(" "), /103/, `${l.id}/${loc}: names 103`);
}
// Armenian first in the source: the order the review sheet and the app use.
assert.deepEqual([...LESSON_LOCALES], ["hy", "en", "ru"]);

// Who sees what. Every lesson is a draft until Armen signs it.
assert.ok(LESSONS.every((l) => l.status === "draft" ? !l.review : true), "A draft carries no sign-off note");
const sample: Lesson[] = (["approved", "draft", "rejected"] as const).map((status, i) => ({ ...LESSONS[i], id: `sample-${status}`, status }));
assert.deepEqual(visibleLessons(false, sample).map((l) => l.status), ["approved"], "Real members: approved only");
assert.deepEqual(visibleLessons(true, sample).map((l) => l.status), ["approved", "draft"], "Staging: drafts too, never rejected");
assert.equal(findLesson("sample-rejected", true, sample), null, "A rejected lesson has no page");
assert.equal(findLesson("sample-draft", false, sample), null, "A draft has no page for real members");
assert.equal(lessonsShowDrafts({ NOREON_PRELAUNCH_STAGING: "true" }), true);
for (const v of [undefined, "", "false", "TRUE", "1"]) assert.equal(lessonsShowDrafts({ NOREON_PRELAUNCH_STAGING: v }), false, `Drafts hidden when the marker is ${v}`);

// Topic match, in each language and in Armenian typed with Latin letters.
const first = (s: string) => lessonTopics(s)[0];
assert.equal(first("My blood pressure was 150/95 this morning"), "hypertension");
assert.equal(first("Ճնշումս բարձր է"), "hypertension");
assert.equal(first("давление опять высокое"), "hypertension");
assert.equal(first("chnshumս 150 er"), "hypertension");
assert.equal(first("How do I measure my blood pressure at home?"), "home-bp");
assert.equal(first("ինչպես չափել ճնշումը"), "home-bp");
assert.equal(first("my sugar was low and I was shaking"), "low-sugar");
assert.equal(first("շաքարս ցածր էր"), "low-sugar");
assert.equal(first("сахар высокий 14"), "high-sugar");
assert.equal(first("what is HbA1c"), "diabetes");
assert.equal(first("Շաքարային դիաբետ ունեմ"), "diabetes");
assert.equal(first("my cholesterol is high"), "lipids");
assert.equal(first("розувастатин"), "lipids");
assert.equal(first("I eat too much salt"), "salt");
assert.equal(first("Աղը վնասակա՞ր է"), "salt");
assert.equal(first("Աղջիկս հարցնում է"), undefined, "«աղ» as a whole word only, not inside «աղջիկ»");
assert.equal(first("I forgot my pills"), "medicines");
assert.equal(first("դեղերս մոռացա"), "medicines");
assert.equal(first("I want to lose weight"), "weight");
assert.equal(first("how much should I walk"), "activity");
assert.equal(first("Should I call 103?"), "emergency");
assert.equal(first("When is my next appointment?"), undefined, "Logistics names no topic");
assert.deepEqual(lessonTopics(""), []);

// Picking Zoe's one offer.
const base = { messages: [] as string[], plan: [] as string[], done: new Set<string>(), offered: new Set<string>(), lessons: visibleLessons(true) };
assert.equal(pickLesson(base), null, "No words, no offer");
assert.equal(pickLesson({ ...base, messages: ["My sugar is low"] })?.id, "low-sugar-signs");
assert.equal(pickLesson({ ...base, messages: ["What is cholesterol?", "my blood pressure is 160"] })?.topic, "lipids", "The newest message wins");
assert.equal(pickLesson({ ...base, messages: ["hello"], plan: ["Metformin"] })?.topic, "diabetes", "Then the care plan (medicine names)");
assert.equal(pickLesson({ ...base, messages: ["blood pressure"], done: new Set(["bp-numbers"]) })?.id, "bp-why-treat", "A done lesson is skipped");
assert.equal(pickLesson({ ...base, messages: ["blood pressure"], offered: new Set(["bp-numbers", "bp-why-treat"]) }), null, "Offered lessons are not repeated");
assert.equal(pickLesson({ ...base, messages: ["blood pressure"], lessons: visibleLessons(false) }), null, "Real members: nothing until a lesson is approved");

// Care-plan medicines: the current plan's own and carried-forward rows only; a replaced plan's statin never counts.
const meds = [
  { id: "m1", plan_id: "p2", name: "Metformin", active: true },
  { id: "m2", plan_id: "p1", name: "Amlodipine", active: true },
  { id: "m3", plan_id: "p1", name: "Atorvastatin", active: true },
  { id: "m4", plan_id: "p2", name: "Rosuvastatin", active: false },
];
assert.deepEqual(currentPlanMedicineNames("p2", meds, [{ plan_id: "p2", medication_id: "m2" }, { plan_id: "p1", medication_id: "m3" }]), ["Metformin", "Amlodipine"]);
assert.equal(pickLesson({ ...base, messages: [], plan: currentPlanMedicineNames("p2", meds, []) })?.topic, "diabetes");

// Only the member's own messages of the last three days, newest first, at most five.
const now = Date.parse("2026-10-20T10:00:00Z");
const msg = (text: string, hoursAgo: number) => ({ text, at: new Date(now - hoursAgo * 3_600_000).toISOString() });
assert.deepEqual(recentMemberTexts([msg("old", 80), msg("a", 5), msg("b", 1), msg("c", 2), msg("d", 3), msg("e", 4), msg("f", 6)], now), ["b", "c", "d", "e", "a"]);

// The Zoe hook is outside the pipeline: the chat page renders it in a Suspense boundary.
const zoePage = readFileSync("app/patient/zoe/page.tsx", "utf8");
assert.match(zoePage, /<Suspense fallback=\{null\}><ZoeLessonOffer /);
assert.doesNotMatch(readFileSync("lib/zoe/pipeline.ts", "utf8"), /lessons/, "No pipeline change");
// Rendering: paragraphs, one list per run of "- " lines, nothing else.
const html = renderToStaticMarkup(createElement(LessonBody, { lines: ["Intro.", "- one", "- two", "Middle.", "- three"] }));
assert.equal(html, '<div class="max-w-2xl space-y-3 text-body1" data-lesson-body="true"><p>Intro.</p><ul class="list-disc space-y-1.5 pl-5"><li>one</li><li>two</li></ul><p>Middle.</p><ul class="list-disc space-y-1.5 pl-5"><li>three</li></ul></div>');
for (const l of LESSONS) assert.ok(!renderToStaticMarkup(createElement(LessonBody, { lines: l.body.hy })).includes("- "), `${l.id}: no stray list markers`);

// Member offers show fixed text and actions without editorial labels; staff preview may identify a draft.
for (const [locale, line] of [["en", "Zoe suggests a one-minute lesson"], ["hy", "Zoe-ն առաջարկում է մեկ րոպեանոց դաս"]] as const) {
  const card = renderToStaticMarkup(createElement(LessonOfferCard, { lessonId: "salt-less", title: "Less salt", draft: true, locale }));
  assert.ok(card.includes(line) && card.includes('href="/patient/learn/salt-less"') && !card.includes("data-lesson-draft"), `${locale}: offer card`);
  assert.ok(!renderToStaticMarkup(createElement(LessonOfferCard, { lessonId: "salt-less", title: "Less salt", draft: false, locale })).includes("data-lesson-draft"), `${locale}: no badge on approved`);
}

console.log("Lessons: content, visibility and topic match ok.");

for(const locale of ['en','hy','ru'] as const){
 const memberLesson=renderToStaticMarkup(createElement(LessonContent,{lesson:LESSONS[0],locale,done:null}));
 assert(!memberLesson.includes('data-lesson-draft'),'Legacy member lesson has no draft badge');
 assert(!memberLesson.includes('status-warning-bg'),'Legacy member lesson has no staging notice');
 assert(memberLesson.includes('data-lesson-body'),'Lesson content remains available');
 const staffLesson=renderToStaticMarkup(createElement(LessonContent,{lesson:LESSONS[0],locale,done:null,staffPreview:true}));
 assert(staffLesson.includes('data-lesson-draft'),'Explicit staff preview retains the draft badge');
 const memberOffer=renderToStaticMarkup(createElement(LessonOfferCard,{lessonId:'salt-less',title:'Less salt',draft:true,locale}));
 assert(!memberOffer.includes('data-lesson-draft'),'Member offer has no editorial marker in each locale');
 const preview=renderToStaticMarkup(createElement(LessonOfferCard,{lessonId:'salt-less',title:'Less salt',draft:true,locale,staffPreview:true}));
 assert(preview.includes('data-lesson-draft'),'Staff preview retains the editorial marker');
}

assert.doesNotMatch(readFileSync('app/patient/learn/page.tsx','utf8'),/DraftBadge|draftNotice|data-learn-draft-notice/,'Legacy member lesson list has no editorial chrome');
