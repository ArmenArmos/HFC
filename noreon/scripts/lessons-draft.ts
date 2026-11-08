// Writes the clinical review sheet for the short lessons from lib/lessons/content.ts, so what
// Armen approves is exactly what the app shows. Usage:
//   node --import ./scripts/register-alias.mjs scripts/lessons-draft.ts <out.md>
import { writeFileSync } from "node:fs";
import { LESSONS } from "@/lib/lessons/content";
import { wordCount } from "@/lib/lessons/catalogue";

/** Clinical points the author could not settle; shown above the lesson. */
const CHECK: Record<string, string> = {
  "home-bp-high-reading": "the 180/110 example is THRESHOLD.crisis in the app's rules (ESH/ESC). Is this the number you want members to see, and is \"tell your care team\" right for a high reading without symptoms?",
  "salt-less": "local foods named (brynza, basturma, sujukh, lavash) and the tip to soak salty cheese.",
  "diabetes-hba1c": "\"around 7% for many adults\" (ADA). Keep a number, or say only that the doctor sets the target?",
  "low-sugar-signs": "the 15-minute rule (ADA \"15-15\": half a glass of juice or 3 to 4 sugar cubes). This is first aid, not a medicine dose, but it is an instruction; keep it, or say only \"follow your doctor's plan\"?",
  "high-sugar-signs": "the 103 signs listed (vomiting, stomach pain, deep breathing, fruity breath, drowsiness) as the DKA/HHS warning.",
  "cholesterol-medicine": "symptoms to report on statins (muscle pain or weakness, dark urine).",
  "activity-start": "who should ask first (heart disease, chest pain on effort, insulin) and the stop signs.",
  "weight-why": "\"half a kilo to one kilo a week\" as a safe pace.",
  "medicines-side-effects": "\"some common painkillers can raise blood pressure\" (NSAIDs); and the missed-dose wording, which sends members to the leaflet, doctor or pharmacist.",
  "when-to-call-103": "the list of 103 symptoms; should it match the app's red flags exactly?",
};

const out = process.argv[2];
if (!out) throw Error("Usage: lessons-draft.ts <out.md>");
const block = (lines: readonly string[]) => lines.map((l) => (l.startsWith("- ") ? l : `${l}\n`)).join("\n").replace(/\n+$/, "");
const counts = LESSONS.reduce<Record<string, number>>((a, l) => ({ ...a, [l.status]: (a[l.status] ?? 0) + 1 }), {});
const md = [
  "# Short lessons for clinical approval (Armen, item 6)",
  "",
  `Generated from \`lib/lessons/content.ts\` on ${new Date().toISOString().slice(0, 10)}. ${LESSONS.length} lessons: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ")}.`,
  "",
  "How to review: for each lesson, write **approved**, **rejected**, or the change you want next to *Decision*. Armenian is first, then English and Russian; the app shows Armenian or English by the member's language, and Russian is kept for later. Armenian and Russian are agent drafts: please read them as a native speaker too.",
  "",
  "Rules every lesson follows: about one minute (at most 150 words), plain words, no medicine doses, no change to treatment without the doctor, 103 for emergencies. Members see a lesson only once it is approved here; in staging, drafts show with a Draft badge so you can read them in the app (Plan, One-minute lessons).",
  "",
  "Points that need a clinical decision are marked **Check**.",
  "",
  ...LESSONS.flatMap((l, i) => [
    "---",
    "",
    `## ${i + 1}. ${l.title.en}`,
    "",
    `Id \`${l.id}\` · topic ${l.topic} · status **${l.status}**${l.review ? ` · ${l.review}` : ""} · words HY ${wordCount(l.body.hy)} / EN ${wordCount(l.body.en)} / RU ${wordCount(l.body.ru)}`,
    "",
    ...(CHECK[l.id] ? [`**Check:** ${CHECK[l.id]}`, ""] : []),
    `### HY: ${l.title.hy}`, "", block(l.body.hy), "",
    `### EN: ${l.title.en}`, "", block(l.body.en), "",
    `### RU: ${l.title.ru}`, "", block(l.body.ru), "",
    "Sources:", "", ...l.sources.map((s) => `- [${s.label}](${s.url})`), "",
    "*Decision:* ", "",
  ]),
].join("\n");
writeFileSync(out, md);
console.log(`Wrote ${out}`);
