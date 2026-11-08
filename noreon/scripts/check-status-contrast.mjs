/**
 * Contrast of the status colours where they are used as TEXT, and of the
 * "Call 103" button, resolved through the same token chain the app paints.
 *
 *   node scripts/check-status-contrast.mjs      (part of pnpm check:tokens)
 *
 * Three things are asserted:
 *
 *  1. The emergency button. The `.emergency-call` rule in app/globals.css keeps
 *     the label at least 18.66px and bold, and the pair must keep 3:1, so the
 *     button stays readable even if the danger token is ever lightened again.
 *  2. Every `href="tel:103"` in app/ and components/ is painted with the
 *     emergency style, so a navy "Call 103" cannot come back unnoticed.
 *  3. Danger and warning as text on the grounds the member app paints need
 *     4.5:1. The 17 Oct design system update closed the earlier gaps; any pair
 *     listed in KNOWN_GAPS must still fail, and a pair that starts passing has
 *     to be removed from the list. Any unlisted failure fails the check.
 *
 * Exits non-zero on any failure.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { contrast } from "../styles/noreon/validate-palette.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => readFileSync(join(root, ...p), "utf8");
const globals = read("app", "globals.css");

// Later files win, as in the cascade: vendored palette, vendored semantics, then
// the app's own :root aliases (the @theme block is skipped, it only re-exports).
const tokens = new Map();
for (const text of [
  read("styles", "noreon", "colors.css"),
  read("styles", "noreon", "semantic.css"),
  read("styles", "noreon", "typography.css"),
  globals.replace(/@theme inline\s*\{[\s\S]*?\n\}/, ""),
]) {
  for (const [, block] of text.matchAll(/:root\s*\{([\s\S]*?)\n\}/g)) {
    for (const [, name, value] of block.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) tokens.set(name, value.trim());
  }
}
const resolve = (value, seen = new Set()) => {
  const ref = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!ref) return value.trim();
  if (seen.has(ref[1]) || !tokens.has(ref[1])) throw new Error(`cannot resolve ${ref[1]}`);
  seen.add(ref[1]);
  return resolve(tokens.get(ref[1]), seen);
};
const color = (token) => {
  const v = resolve(`var(${token})`);
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`${token} resolves to ${v}, not a hex`);
  return v;
};

let failed = false;
const line = (ok, label, detail) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
  if (!ok) failed = true;
};

// ── 1. the emergency button ─────────────────────────────────────────────────
console.log("Emergency button (.emergency-call)");
const rule = /\.emergency-call,\s*\.member-journey \.emergency-call\s*\{([^}]*)\}/.exec(globals);
if (!rule) throw new Error(".emergency-call rule is missing from app/globals.css");
const decl = (name) => new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+);`).exec(rule[1])?.[1].trim();
const bg = decl("background-color"), fg = decl("color");
const size = parseFloat(resolve(decl("font-size") ?? "0"));
const weight = Number(resolve(decl("font-weight") ?? "0"));
line(bg === "var(--destructive)", "background is the danger token", bg ?? "(missing)");
line(size >= 18.66 && weight >= 700, "label is WCAG large text (>= 18.66px bold)", `${size}px / ${weight}`);
const button = contrast(color(fg.slice(4, -1)), color("--destructive"));
line(button >= 3, "label on danger, large-text AA (3:1)", `${button.toFixed(2)}:1`);

// ── 2. every tel:103 is the emergency style ─────────────────────────────────
console.log("\nCall 103 actions");
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : /\.tsx$/.test(name) ? [path] : [];
});
// Khikar, 18 Oct: only urgent screens carry the big filled button; everyday screens
// use the small outlined .emergency-pill. These files are urgent screens and must keep
// .emergency-call on every tel:103.
const URGENT = new Set([
  "app/patient/urgent/page.tsx",
  "app/patient/urgent/review/page.tsx",
  "app/patient/zoe/urgent/content.tsx",
  "components/patient/questionnaire.tsx",
  "components/patient/profile-summary.tsx",
]);
let calls = 0;
const urgentBig = new Set();
for (const file of [...walk(join(root, "app")), ...walk(join(root, "components"))]) {
  const text = readFileSync(file, "utf8");
  for (const hit of text.matchAll(/href="tel:103"/g)) {
    calls++;
    // The opening tag the href sits in: back to its `<`, forward to its `>`.
    const start = text.lastIndexOf("<", hit.index);
    const end = text.indexOf(">", hit.index);
    const tag = text.slice(start, end + 1);
    const owner = text.slice(text.lastIndexOf("<", start - 1), start); // a render={<a …/>} parent
    const where = `${relative(root, file)}:${text.slice(0, hit.index).split("\n").length}`;
    const ok = /emergency/.test(tag) || /variant="emergency(-pill)?"/.test(owner);
    if (!ok) line(false, where, "tel:103 without the emergency style");
    if (URGENT.has(relative(root, file))) {
      const big = /emergency-call/.test(tag) || /variant="emergency"/.test(owner) || /variant="emergency"/.test(tag);
      if (!big) line(false, where, "urgent screen must keep the big filled Call 103");
      else urgentBig.add(relative(root, file));
    }
  }
}
line(calls > 0, "tel:103 actions use the emergency style", `${calls} found`);
// The Zoe route and inline card share the button, so pin both call sites as well as its actual markup.
const zoeUrgentPage = readFileSync("app/patient/zoe/urgent/page.tsx", "utf8");
const zoeUrgentCard = readFileSync("components/patient/zoe-emergency-card.tsx", "utf8");
line(/import \{ ZoeUrgentContent \} from "\.\/content"/.test(zoeUrgentPage) && /<ZoeUrgentContent\b/.test(zoeUrgentPage)
  && /import \{ ZoeUrgentContent \} from "@\/app\/patient\/zoe\/urgent\/content"/.test(zoeUrgentCard) && /<ZoeUrgentContent\b[^>]*inline/.test(zoeUrgentCard),
  "Zoe page and card use the shared emergency content", "both call sites pinned");
const missing = [...URGENT].filter((f) => !urgentBig.has(f));
line(missing.length === 0, "every urgent screen keeps the big filled button", missing.length ? `missing: ${missing.join(", ")}` : `${urgentBig.size} of ${URGENT.size}`);
const pill = /\.emergency-pill\s*\{([^}]*)\}/.exec(globals);
if (!pill) throw new Error(".emergency-pill rule is missing from app/globals.css");
const pd = (name) => new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+);`).exec(pill[1])?.[1].trim();
line(pd("color") === "var(--destructive)" && pd("background-color") === "var(--surface-card)", "pill is danger text on the card ground", `${pd("color")} on ${pd("background-color")}`);
line(parseFloat(pd("min-height") ?? "0") >= 44, "pill tap target is at least 44px", pd("min-height") ?? "(missing)");


// ── 3. danger and warning as text ───────────────────────────────────────────
// Grounds: the white card, the member journey page (gray-100), and the app page.
const GROUNDS = { card: "--surface-card", "member page": "--noreon-gray-100", page: "--surface-page" };
const TEXT = { danger: "--destructive", warning: "--status-warning-fg" };
// Open design-system request (17 Oct 2026): no existing red or amber step reaches
// 4.5:1. The reviewed prototype uses #B42318 and #8F6204; the design team owns the
// value. Remove a pair from this list once a re-vendored token passes.
// Closed by the 17 Oct design system update (danger #B42318, warning #8F6204).
const KNOWN_GAPS = new Set([]);
console.log("\nStatus colours as text (AA 4.5:1)");
for (const [role, token] of Object.entries(TEXT)) {
  for (const [ground, surface] of Object.entries(GROUNDS)) {
    const key = `${role}/${ground}`;
    const ratio = contrast(color(token), color(surface));
    const pass = ratio >= 4.5;
    const label = `${role} ${token} on ${ground}`;
    if (KNOWN_GAPS.has(key)) {
      if (pass) line(false, label, `${ratio.toFixed(2)}:1 now passes; remove "${key}" from KNOWN_GAPS`);
      else console.log(`  OPEN  ${label.padEnd(52)} ${ratio.toFixed(2)}:1 (design-system request)`);
    } else line(pass, label, `${ratio.toFixed(2)}:1`);
  }
}

// The pill's label is ordinary-size danger text on the card, so it is the same pair as
// "danger/card": enforced as soon as that gap is closed (the 17 Oct design system update).
const pillRatio = contrast(color("--destructive"), color("--surface-card"));
if (KNOWN_GAPS.has("danger/card") && pillRatio < 4.5) console.log(`  OPEN  ${"pill label, normal-text AA (4.5:1)".padEnd(52)} ${pillRatio.toFixed(2)}:1 (closes with danger/card)`);
else line(pillRatio >= 4.5, "pill label, normal-text AA (4.5:1)", `${pillRatio.toFixed(2)}:1`);

// ── Zoe chat in the prototype's look (30 Oct): its colours must keep 4.5:1 as text.
console.log("\nZoe chat tokens as text (AA 4.5:1)");
for (const [fg, ground] of [
  ["--text-on-inverse", "--zoe-action"], ["--text-on-inverse", "--zoe-action-hover"],
  ["--zoe-action-ink", "--surface-card"], ["--zoe-action-ink", "--zoe-tint"], ["--zoe-action-ink", "--zoe-tint-2"], ["--zoe-action-ink", "--zoe-canvas"],
  ["--zoe-ldl", "--surface-card"], ["--zoe-ldl", "--zoe-ldl-wash"], ["--zoe-ldl", "--zoe-canvas"],
  ["--zoe-ink", "--zoe-canvas"], ["--text-muted", "--zoe-canvas"], ["--text-muted", "--zoe-tint"],
]) {
  const ratio = contrast(color(fg), color(ground));
  line(ratio >= 4.5, `${fg} on ${ground}`, `${ratio.toFixed(2)}:1`);
}

// ── 4. member journey chips and callouts (prototype alignment, 18 Oct) ──────
// Every rule listed here paints text: its color on its background must keep 4.5:1.
// The selector's rule in app/globals.css is read, so a lighter token cannot slip in.
console.log("\nMember journey chips and callouts (AA 4.5:1)");
const ruleFor = (selector) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`).exec(globals);
  if (!m) throw new Error(`${selector} rule is missing from app/globals.css`);
  return (name) => new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*([^;]+);`).exec(m[1])?.[1].trim();
};
const tokenOf = (v) => /^var\((--[\w-]+)\)$/.exec(v ?? "")?.[1];
for (const [selector, inheritBg] of [
  ['.member-journey .journey-actor', null],
  ['.member-journey .journey-actor[data-actor="nurse"]', null],
  ['.member-journey .journey-actor[data-actor="doctor"]', null],
  ['.member-journey .journey-actor[data-actor="zoe"]', null],
  ['.member-journey .journey-callout[data-tone="danger"]', null],
  ['.member-journey .booking-test-state', null],
  ['.member-journey .booking-test[data-test-state="to-book"] .booking-test-state', null],
  ['.member-journey .booking-test[data-test-state="booked"] .booking-test-state', null],
  ['.member-journey .booking-test[data-test-state="requested"] .booking-test-state', null],
  ['.member-journey .journey-callout[data-tone="teal"]', null],
  ['.member-journey .meet-zoe-avatar[data-role="nurse"]', null],
  ['.member-journey .meet-zoe-avatar[data-role="doctor"]', null],
]) {
  const d = ruleFor(selector);
  const fg = tokenOf(d("color")), bgTok = tokenOf(d("background")) ?? inheritBg;
  if (!fg || !bgTok) { line(false, selector, "color or background is not a single token"); continue; }
  const ratio = contrast(color(fg), color(bgTok));
  line(ratio >= 4.5, selector.replace(".member-journey ", ""), `${ratio.toFixed(2)}:1`);
}
// Text painted by utility classes in components: the timeline's "You are here" line.
const youAreHere = contrast(color("--noreon-teal-800"), color("--surface-card"));
line(/text-\[var\(--noreon-teal-800\)\]">\{t\(\{ en: "You are here"/.test(read("components", "patient", "programme-timeline.tsx")) && youAreHere >= 4.5, '"You are here" teal-800 on the card', `${youAreHere.toFixed(2)}:1`);

if (failed) {
  console.error("\nA status contrast check failed.");
  process.exit(1);
}
console.log("\nStatus contrast: emergency button and status text pass.");
