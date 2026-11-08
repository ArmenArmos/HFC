/**
 * Three checks over what `app/globals.css` currently declares:
 *
 *  1. The chart series still passes the colourblind-separation and contrast
 *     checks, on both grounds the app paints: the stone page and the white card.
 *  2. The radius and shadow values transcribed into the Tailwind theme still
 *     match the vendored token files. Those two are transcribed rather than
 *     imported because their names collide with a Tailwind namespace, which is
 *     exactly the situation where a silent drift is possible.
 *  3. The colours written as literals outside CSS — the theme-color meta tag,
 *     the web app manifest and the Open Graph card — still match the tokens
 *     they were transcribed from. None of those three can read a custom
 *     property, so a literal is the only option and a check is the only guard.
 *
 *   node styles/noreon/check.mjs
 *
 * Exits non-zero if anything fails, so it can gate a build.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validate } from "./validate-palette.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "..", "..", "app", "globals.css"), "utf8");

const palette = Array.from({ length: 5 }, (_, i) => {
  const hit = new RegExp(`--chart-${i + 1}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!hit) throw new Error(`--chart-${i + 1} is missing from app/globals.css, or is not a plain hex`);
  return hit[1];
});

// Both grounds, because a series colour has to hold on either. Charts sit in
// white cards today; the page itself is the stone ground declared in
// app/globals.css, which overrides the design system's Soft Ivory. Validate
// against what the app actually paints, or this check passes on a surface no
// screen has.
const GROUNDS = { "stone page": "#F6F5F2", "white card": "#FFFFFF" };

console.log(`chart series: ${palette.join(", ")}\n`);
let failed = false;
for (const [name, surface] of Object.entries(GROUNDS)) {
  const { report, ok } = validate(palette, { mode: "light", surface, pairs: "all" });
  console.log(`${name} (${surface})`);
  for (const [check, pass, detail] of report) {
    console.log(`  ${pass ? "PASS" : "FAIL"}  ${check.padEnd(22)} ${detail}`);
  }
  console.log("");
  if (!ok) failed = true;
}
if (failed) {
  console.error("A colour check failed. Re-derive the series before shipping.");
  process.exit(1);
}
console.log("Chart series: all checks pass on both grounds.\n");

// ── transcription drift ──────────────────────────────────────────────────────
// A declaration list, flattened to `name:value` with whitespace removed and
// every decimal put in canonical form, so the vendored `rgba(26,34,51,.05)` and
// a formatter's `rgba(26, 34, 51, 0.05)` compare equal, as do `0.10` and `0.1`.
// Only formatting is normalised. A changed number is still a drift.
const decls = (text) => {
  const out = new Map();
  for (const [, name, value] of text.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
    const canonical = value
      .replace(/\s+/g, "")
      .replace(/\d*\.\d+/g, (n) => String(parseFloat(n)));
    out.set(name, canonical);
  }
  return out;
};

const vendored = (file) => decls(readFileSync(join(here, file), "utf8"));
const theme = decls(/@theme inline\s*\{([\s\S]*?)\n\}/.exec(css)[1]);

// The design system calls the 8px step --radius-sm; Tailwind's namespace owns
// that name, so the ladder is shifted one name. Same physical sizes.
const RADIUS = { "--radius-xs": "--radius-sm", "--radius-sm": "--radius-md",
                 "--radius-md": "--radius-lg", "--radius-lg": "--radius-xl",
                 "--radius-xl": "--radius-2xl", "--radius-pill": "--radius-pill" };

let drifted = false;
const compare = (label, want, got) => {
  if (want === got) return;
  drifted = true;
  console.error(`  DRIFT  ${label}\n         token:   ${want}\n         written: ${got ?? "(missing)"}`);
};

console.log("Transcribed tokens");
for (const [dsName, twName] of Object.entries(RADIUS)) {
  compare(`${dsName} -> ${twName}`, vendored("radius.css").get(dsName), theme.get(twName));
}
for (const [name, value] of vendored("elevation.css")) {
  if (!name.startsWith("--shadow-")) continue; // --inset-hairline lives in :root
  compare(name, value, theme.get(name));
}
// ── colours that leave the stylesheet ────────────────────────────────────────
// Three files outside CSS have to write a colour as a literal, because none of
// them can read a custom property: the theme-color meta tag, which the browser
// paints its own chrome with; the web app manifest, which is JSON read by the
// operating system; and the Open Graph card, which Satori composites with no
// stylesheet in reach. Each is a transcription of a token, so each is checked
// here for the same reason the radius ladder is.
const hex = (text, pattern, what) => {
  const hit = pattern.exec(text);
  if (!hit) throw new Error(`no hex to check in ${what} — did the ${pattern} move?`);
  return hit[1].toLowerCase();
};
const read = (...parts) => readFileSync(join(here, "..", "..", ...parts), "utf8");

// The ground the app paints. It is declared in globals.css rather than vendored
// because it is the one colour the design system does not specify; see the
// note above --noreon-stone there.
const stone = hex(css, /--noreon-stone:\s*(#[0-9a-fA-F]{6})/, "app/globals.css");
const navy = hex(readFileSync(join(here, "colors.css"), "utf8"),
                 /--noreon-navy-700:\s*(#[0-9a-fA-F]{6})/, "colors.css");

const TRANSCRIBED = [
  ["app/layout.tsx themeColor", stone,
   () => hex(read("app", "layout.tsx"), /themeColor:\s*"(#[0-9a-fA-F]{6})"/, "app/layout.tsx")],
  ["app/manifest.ts background_color", stone,
   () => hex(read("app", "manifest.ts"), /background_color:\s*"(#[0-9a-fA-F]{6})"/, "app/manifest.ts")],
  ["app/manifest.ts theme_color", stone,
   () => hex(read("app", "manifest.ts"), /theme_color:\s*"(#[0-9a-fA-F]{6})"/, "app/manifest.ts")],
  ["app/opengraph-image.tsx ground", navy,
   () => hex(read("app", "opengraph-image.tsx"), /backgroundColor:\s*"(#[0-9a-fA-F]{6})"/, "app/opengraph-image.tsx")],
];
for (const [label, want, got] of TRANSCRIBED) compare(label, want, got());

if (drifted) {
  console.error("\nThe theme no longer matches the vendored tokens. Reconcile before shipping.");
  process.exit(1);
}
console.log("  radius and shadow values match the vendored token files.");
console.log("  the colours written outside CSS still match their tokens.");
