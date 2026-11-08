import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = new URL("../../../styles/noreon/", import.meta.url);
const vars = new Map();
for (const file of [
  "colors.css",
  "semantic.css",
  "spacing.css",
  "radius.css",
  "typography.css",
]) {
  const css = readFileSync(new URL(file, root), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  for (const match of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g))
    vars.set(match[1], match[2].trim());
}
function resolve(name, seen = new Set()) {
  if (seen.has(name) || !vars.has(name))
    throw Error("Unknown/circular token " + name);
  seen.add(name);
  const value = vars.get(name),
    alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias) return resolve(alias[1], seen);
  return /^\d+(\.\d+)?px$/.test(value) ? Number(value.slice(0, -2)) : value;
}
const names = [
  "surface-page",
  "surface-card",
  "surface-subtle-teal",
  "text-strong",
  "text-body",
  "text-muted",
  "text-on-inverse",
  "border-default",
  "border-divider",
  "action-primary-bg",
  "action-primary-fg",
  "status-danger-fg",
  "status-danger-bg",
  "space-1",
  "space-2",
  "space-3",
  "space-4",
  "space-6",
  "space-8",
  "radius-sm",
  "radius-md",
  "control-height-lg",
  "text-h1-size",
  "text-h1-line",
  "text-h2-size",
  "text-h2-line",
  "text-body1-size",
  "text-body1-line",
  "text-body2-size",
  "text-body2-line",
];
const output =
  "// Generated from vendored Noreon CSS. Run pnpm theme; do not edit.\nexport const tokens = " +
  JSON.stringify(
    Object.fromEntries(names.map((name) => [name, resolve(name)])),
    null,
    2,
  ) +
  " as const;\n";
const target = new URL("../src/lib/tokens.ts", import.meta.url);
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output)
    throw Error("Native tokens drifted");
} else writeFileSync(target, output);
console.log("Native design tokens match " + fileURLToPath(root));
