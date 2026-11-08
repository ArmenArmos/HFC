import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { KIT, type Line } from "@/components/patient/zoe-kit/copy";
import { zoeChatDesignPreviewEnabled, zoeChatKitEnabled } from "@/lib/patient/zoe-chat-design-preview";

// The Zoe chat kit and its preview (output/zoe-chat-design/DESIGN.md). The copy is complete and follows the voice
// guide; the kit uses tokens only; the preview cannot save, send or reach Zoe's safety pipeline; the flag is exact.
const KIT_DIR = "components/patient/zoe-kit";
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]);
const kitFiles = files(KIT_DIR);
const read = (f: string) => readFileSync(f, "utf8");

// Copy: every line in hy, en and ru; no exclamation mark, em dash or emoji; never "patient" or "user".
const sample = (v: unknown): Line[] => typeof v === "function" ? [v(2, 9, "X") as Line].filter(x => typeof x === "object") : [v as Line];
const lines = Object.values(KIT).flatMap(sample);
assert.ok(lines.length > 40, "kit copy sampled");
for (const line of lines) for (const l of ["hy", "en", "ru"] as const) {
  assert.ok(line[l]?.trim(), `kit copy: ${l} present for ${line.en}`);
  assert.doesNotMatch(line[l], /[!—]/u, `kit copy: no exclamation mark or em dash: ${line[l]}`);
  assert.doesNotMatch(line[l], /\p{Extended_Pictographic}/u, `kit copy: no emoji: ${line[l]}`);
  assert.doesNotMatch(line[l], /\b(patient|user)\b/i, `kit copy: say "you" or "member": ${line[l]}`);
}
// Journey copy in the preview: the same voice rules on every quoted string.
for (const f of kitFiles.filter(f => f.endsWith(".tsx"))) {
  for (const [, s] of read(f).matchAll(/"((?:[^"\\\n]|\\.){2,})"/g)) {
    // Member-facing words start with a capital or are not Latin; ids, class names and paths are skipped.
    if (!/^[A-Z][a-z]* |[^\x00-\x7F]/.test(s)) continue;
    assert.doesNotMatch(s, /—|\p{Extended_Pictographic}/u, `${f}: no em dash or emoji: ${s}`);
    assert.doesNotMatch(s, /[^!]![^=]|!$/u, `${f}: no exclamation mark: ${s}`);
  }
}

// Tokens only: no hex, rgb() or pixel radius in kit components or the kit stylesheet.
for (const f of kitFiles) {
  const src = read(f);
  if (f.endsWith(".css")) assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b/i, `${f}: no hex colour`);
  assert.doesNotMatch(src, /\brgba?\(|\bhsla?\(/i, `${f}: no rgb() or hsl() colour`);
  assert.doesNotMatch(src, /rounded-\[\d|border-radius:\s*\d/, `${f}: no pixel radius`);
  if (f.endsWith(".tsx") || f.endsWith(".ts")) assert.doesNotMatch(src, /["'`]#[0-9a-f]{3,8}["'`]/i, `${f}: no hex colour`);
}

// The kit never imports Zoe's safety pipeline or a server action; the preview writes nothing.
for (const f of kitFiles.filter(f => /\.tsx?$/.test(f))) {
  const src = read(f);
  for (const [, from] of src.matchAll(/from\s+"([^"]+)"/g)) {
    assert.ok(!from.startsWith("@/lib/zoe/"), `${f}: the kit does not touch Zoe's safety pipeline (${from})`);
    assert.ok(!/actions|server|supabase|repository|@\/app\//.test(from) || from === "@/lib/zoe-chat-actions/copy", `${f}: no server code in the kit (${from})`);
  }
  assert.doesNotMatch(src, /["']use server["']|fetch\(|navigator\.sendBeacon/, `${f}: no server action or network call`);
}
// The prototype's emergency word list stays out: the emergency card is shown only by the safety route.
assert.doesNotMatch(kitFiles.map(read).join("\n"), /EMERGENCY_WORDS|URGENT_WORDS|emergencyWords|urgentTerms/i, "no emergency word list in the kit");

// New member-facing clinical wording in the preview is marked for sign-off.
assert.match(read(`${KIT_DIR}/preview/journeys.tsx`), /SIGN_OFF\(/, "preview marks new clinical wording with SIGN_OFF");

// The flag is exact: only "true" opens the preview.
assert.equal(zoeChatDesignPreviewEnabled({}), false);
for (const v of ["1", "TRUE", "yes", " true", "false", ""]) assert.equal(zoeChatDesignPreviewEnabled({ NOREON_ZOE_CHAT_DESIGN_PREVIEW: v }), false, `flag "${v}" stays off`);
assert.equal(zoeChatDesignPreviewEnabled({ NOREON_ZOE_CHAT_DESIGN_PREVIEW: "true" }), true);
// The route checks the flag before anything else, and the live chat imports no kit component: only the look moves.
const page = read("app/patient/zoe/preview/page.tsx");
assert.ok(page.indexOf("zoeChatDesignPreviewEnabled()") < page.indexOf("requireRegisteredForRender()"), "the preview route checks its flag first");
assert.doesNotMatch(read("app/patient/zoe/page.tsx") + read("components/patient/zoe-chat.tsx"), /from "[^"]*zoe-kit\/(?!zoe-kit\.css)/, "the live chat imports no kit component");

console.log(`zoe kit: ${lines.length} copy lines, ${kitFiles.length} files checked`);

// Astra #407: the nearest text size wins, so a preview inside a saved size still previews every size (F1); the results
// journey promises no individual review (F2); going back to change an answer is not a write that can fail (F3).
const css = read("app/globals.css");
assert.match(css, /\.journey-main \{\n  zoom: var\(--member-text-zoom, 1\);/, "the zoom reads the inherited value");
assert.doesNotMatch(css, /\[data-member-text-size="[a-z]+"\] \.journey-main/, "no descendant selector can outrank the nearest setting");
assert.match(css, /\[data-member-text-size="normal"\] \{\n  --member-text-zoom: 1;/, "Normal resets a larger outer size");
const journeys = read("components/patient/zoe-kit/preview/journeys.tsx");
assert.doesNotMatch(journeys, /doctor reviews|Waiting for your doctor|ձեր բժիշկն է այն դիտում|Ждёт врача/u, "no promise of individual review");
assert.match(journeys, /onChange=\{key => \{ void act\.revisit\(/, "Change an answer goes back without a simulated write");

// The live chat's look: the flag is exact, off by default, and it changes classes only, so behaviour cannot differ.
assert.equal(zoeChatKitEnabled({}), false);
for (const v of ["1", "TRUE", "yes", " true", "false", ""]) assert.equal(zoeChatKitEnabled({ NOREON_ZOE_CHAT_KIT: v }), false, `kit flag: "${v}" stays off`);
assert.equal(zoeChatKitEnabled({ NOREON_ZOE_CHAT_KIT: "true" }), true);
const live = read("components/patient/zoe-chat.tsx");
assert.equal(live.split("\n").filter(line => /\bkit\b/.test(line)).length, 3, "the live chat reads the flag for its wrapper class only");
assert.match(live, /className=\{kit \? "zk zk-chat space-y-4" : "space-y-4"\}/, "flag off keeps the live chat's class");
