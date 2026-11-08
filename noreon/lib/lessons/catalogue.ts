/**
 * Which lessons a member may read, and the topic match Zoe uses to offer one. Pure: no database,
 * no network, no model. Content and statuses are in ./content.ts.
 */
import { normaliseText } from "@/lib/zoe/normalise";
import { LESSONS, type Lesson, type LessonLocale, type LessonTopic } from "./content";

type Env = Record<string, string | undefined>;

/**
 * Drafts are shown (with a Draft badge) only on prod-as-staging, so Armen can review them in the
 * app. Real members see approved lessons only: once the staging marker is removed at go-live,
 * an unapproved lesson is invisible and never suggested.
 */
export const lessonsShowDrafts = (env: Env = process.env) => env.NOREON_PRELAUNCH_STAGING === "true";

export function visibleLessons(showDrafts: boolean, all: readonly Lesson[] = LESSONS): Lesson[] {
  return all.filter((l) => l.status === "approved" || (showDrafts && l.status === "draft"));
}

export function findLesson(id: string, showDrafts: boolean, all: readonly Lesson[] = LESSONS): Lesson | null {
  return visibleLessons(showDrafts, all).find((l) => l.id === id) ?? null;
}

/** The app speaks Armenian and English; Russian is kept for Telegram and later use. */
export const lessonLocale = (locale: "hy" | "en"): LessonLocale => locale;

export const LESSON_ID = /^[a-z0-9]+(?:-[a-z0-9]+){0,7}$/;

/**
 * Topic words. Each entry fires when every stem in it starts some word of the normalised text
 * ("=" means the whole word, for short stems that would otherwise hit unrelated words; a stem with
 * a space is matched against the whole text). Order matters: the first topic that fires wins
 * within one message, so low and high sugar come before diabetes in general.
 */
const TOPIC_WORDS: readonly (readonly [LessonTopic, readonly (readonly string[])[]])[] = [
  ["emergency", [["103"], ["ambulance"], ["emergency"], ["stroke"], ["շտապ օգնություն"], ["ինսուլտ"], ["скорая"], ["скорую"], ["инсульт"], ["shtap"]]],
  ["low-sugar", [["hypo"], ["sugar", "low"], ["glucose", "low"], ["շաքար", "ցածր"], ["շաքար", "իջ"], ["гипогликем"], ["сахар", "низк"], ["сахар", "упал"], ["shaqar", "cacr"]]],
  ["high-sugar", [["hyperglyc"], ["sugar", "high"], ["glucose", "high"], ["շաքար", "բարձր"], ["гипергликем"], ["сахар", "высок"], ["shaqar", "bardz"]]],
  ["home-bp", [["measur", "pressure"], ["cuff"], ["tonometer"], ["bp", "monitor"], ["ճնշ", "չափ"], ["տոնոմետր"], ["давлен", "измер"], ["тонометр"], ["chnsh", "chap"]]],
  ["salt", [["salt"], ["salty"], ["sodium"], ["=աղ"], ["=աղը"], ["=աղի"], ["=աղով"], ["աղաման"], ["նատրիում"], ["=соль"], ["=соли"], ["=солью"], ["солён"], ["солен"], ["натри"], ["=agh"]]],
  ["lipids", [["cholesterol"], ["ldl"], ["statin"], ["lipid"], ["atorvastatin"], ["rosuvastatin"], ["simvastatin"], ["ezetimib"], ["խոլեստերին"], ["ստատին"], ["լիպիդ"], ["холестерин"], ["статин"], ["липид"], ["лпнп"], ["аторвастатин"], ["розувастатин"], ["xolesterin"], ["kholesterin"]]],
  ["diabetes", [["diabet"], ["glucose"], ["sugar"], ["hba1c"], ["a1c"], ["insulin"], ["metformin"], ["gliclazid"], ["glimepirid"], ["empagliflozin"], ["dapagliflozin"], ["sitagliptin"], ["դիաբետ"], ["շաքար"], ["գլյուկոզ"], ["ինսուլին"], ["մետֆորմին"], ["диабет"], ["сахар"], ["глюкоз"], ["инсулин"], ["метформин"], ["shaqar"], ["shakar"]]],
  ["hypertension", [["blood pressure"], ["hypertens"], ["systolic"], ["diastolic"], ["amlodipin"], ["lisinopril"], ["enalapril"], ["losartan"], ["valsartan"], ["telmisartan"], ["perindopril"], ["ramipril"], ["bisoprolol"], ["metoprolol"], ["nebivolol"], ["indapamid"], ["hydrochlorothiazid"], ["ճնշ"], ["հիպերտոն"], ["давлен"], ["гипертон"], ["амлодипин"], ["лизиноприл"], ["эналаприл"], ["лозартан"], ["chnshum"], ["jnshum"]]],
  ["medicines", [["pill"], ["tablet"], ["medicine"], ["medication"], ["side effect"], ["դեղեր"], ["դեղը"], ["դեղի"], ["դեղերը"], ["=դեղ"], ["հաբ"], ["лекарств"], ["таблет"], ["препарат"], ["побочн"], ["=degh"], ["=deghe"], ["=hab"], ["haber"]]],
  ["activity", [["exercis"], ["walk"], ["activity"], ["sport"], ["gym"], ["քայլ"], ["մարզ"], ["սպորտ"], ["ֆիզիկական"], ["спорт"], ["ходьб"], ["ходит"], ["трениров"], ["физкульт"], ["qayl"], ["marz"]]],
  ["weight", [["weight"], ["diet"], ["obes"], ["waist"], ["bmi"], ["calori"], ["քաշ"], ["դիետ"], ["ճարպակալ"], ["գիրաց"], ["=вес"], ["=веса"], ["=весом"], ["=весе"], ["диет"], ["похуд"], ["ожирен"], ["калори"], ["=qash"]]],
];

const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const stemHits = (stem: string, text: string, tokens: readonly string[]) =>
  stem.includes(" ") ? text.includes(stem)
    : stem.startsWith("=") ? tokens.includes(stem.slice(1))
      : tokens.some((t) => t.startsWith(stem));

/** Topics named in one text, in TOPIC_WORDS order. */
export function lessonTopics(raw: string): LessonTopic[] {
  const text = normaliseText(raw);
  const tokens = words(text);
  return TOPIC_WORDS.filter(([, entries]) => entries.some((all) => all.every((s) => stemHits(s, text, tokens)))).map(([t]) => t);
}

export type SuggestionInput = {
  /** The member's own recent messages, newest first. Only these count, never Zoe's or a doctor's words. */
  messages: readonly string[];
  /** The published care plan's explanation, instructions and medicine names. */
  plan: readonly string[];
  /** Lessons the member marked done. */
  done: ReadonlySet<string>;
  /** Lessons offered before (any day still on record), so Zoe does not repeat herself. */
  offered: ReadonlySet<string>;
  lessons: readonly Lesson[];
};

/**
 * The one lesson Zoe may offer: the first topic in the member's newest message that has an unread,
 * not yet offered lesson, then older messages, then the care plan. Null when nothing fits.
 */
export function pickLesson(input: SuggestionInput): Lesson | null {
  const order: LessonTopic[] = [];
  for (const text of [...input.messages, input.plan.join("\n")]) {
    for (const topic of lessonTopics(text)) if (!order.includes(topic)) order.push(topic);
  }
  for (const topic of order) {
    const lesson = input.lessons.find((l) => l.topic === topic && !input.done.has(l.id) && !input.offered.has(l.id));
    if (lesson) return lesson;
  }
  return null;
}

/** How far back the member's own messages count for a lesson match, and how many. */
const RECENT_MS = 3 * 86_400_000, RECENT_COUNT = 5;

/** The member's own messages of the last three days, newest first, at most five. */
export function recentMemberTexts(messages: readonly { text: string; at: string }[], now: number): string[] {
  return messages.filter((m) => now - Date.parse(m.at) <= RECENT_MS)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, RECENT_COUNT).map((m) => m.text);
}

/** Active medicines of one plan: its own rows and the rows carried forward to it by a link. */
export function currentPlanMedicineNames(
  planId: string,
  meds: readonly { id: string; plan_id: string; name: string; active: boolean }[],
  links: readonly { plan_id: string; medication_id: string }[],
): string[] {
  const linked = new Set(links.filter((l) => l.plan_id === planId).map((l) => l.medication_id));
  return meds.filter((m) => m.active && (m.plan_id === planId || linked.has(m.id))).map((m) => m.name);
}

/** Plain-text word count, for the 150-word limit. */
export const wordCount = (lines: readonly string[]) => lines.join(" ").replace(/^- /gm, "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
