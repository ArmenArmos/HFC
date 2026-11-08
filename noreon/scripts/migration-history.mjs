#!/usr/bin/env node
// Applied migrations are never edited, renamed, removed or retyped, and new ones sort after every
// earlier one (AGENTS.md). The merge gate checks a PR's file list; this checks git itself, so it also
// catches a change that reached main another way (the GitHub merge button, a direct push).
//
//   node scripts/migration-history.mjs --history [rev]   (default HEAD)
//     On rev's first-parent line, each migration was added after every earlier one (by timestamp), and
//     still exists at rev as the same regular file with the content it was added with. Needs full
//     history (fetch-depth: 0). The production deploy runs this before anything reaches the database.
//   node scripts/migration-history.mjs --range <base> <head>
//     No migration that exists at base is modified, renamed, removed or retyped by head, and every
//     migration head adds is a regular file named <14-digit stamp>_<name>.sql that sorts after all of
//     base's. CI runs this on a pull request (base = the merge commit's first parent).
//
// Git output is read NUL-delimited, so no path quoting can hide a file. Exits 1 listing each offending
// file, 2 on usage or git errors (fail closed).
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DIR = 'supabase/migrations/';
const NAME = /^supabase\/migrations\/(\d{14})_[a-z0-9_]+\.sql$/;
const REGULAR = '100644';

/** @typedef {{ path: string, mode: string, blob: string }} Entry */

/**
 * @param {Entry[]} added  first-parent additions, oldest first
 * @param {Map<string, Entry>} current  path -> entry at the checked revision
 * @returns {string[]}
 */
export function historyViolations(added, current) {
  const out = [];
  const first = new Map();
  let newest = '';
  for (const a of added) {
    if (first.has(a.path)) continue; // a re-addition must match the first one, checked below
    first.set(a.path, a);
    const stamp = NAME.exec(a.path)?.[1];
    if (!stamp) out.push(`${a.path} is not named <14-digit stamp>_<name>.sql`);
    else if (stamp <= newest) out.push(`${a.path} was added after ${newest}, which sorts later`);
    else newest = stamp;
  }
  for (const [path, a] of [...first].sort(([x], [y]) => (x < y ? -1 : 1))) {
    const now = current.get(path);
    if (!now) out.push(`${path} was removed or renamed after it was added`);
    else if (now.mode !== a.mode) out.push(`${path} changed type (${a.mode} to ${now.mode}) after it was added`);
    else if (now.blob !== a.blob) out.push(`${path} was edited after it was added`);
  }
  for (const [path, e] of current) if (e.mode !== REGULAR) out.push(`${path} is not a regular file (${e.mode})`);
  return out;
}

/**
 * @param {{ status: string, from: string, to?: string }[]} changes  git diff -M -C, base to head
 * @param {Set<string>} atBase  migration paths at base
 * @param {Map<string, Entry>} atHead  migration entries at head
 * @returns {string[]}
 */
export function rangeViolations(changes, atBase, atHead) {
  const out = [];
  const newest = [...atBase].map((p) => NAME.exec(p)?.[1]).filter(Boolean).sort().at(-1) ?? '';
  for (const { status, from, to } of changes) {
    const kind = status[0];
    if (kind !== 'A' && kind !== 'C' && from.startsWith(DIR) && atBase.has(from)) {
      const verb = kind === 'R' ? `renamed to ${to}` : kind === 'D' ? 'removed' : kind === 'T' ? 'retyped' : 'edited';
      out.push(`${from} ${verb}`);
    }
    const incoming = kind === 'A' ? from : kind === 'R' || kind === 'C' ? to : null;
    if (!incoming?.startsWith(DIR) || atBase.has(incoming)) continue;
    const stamp = NAME.exec(incoming)?.[1];
    if (!stamp) out.push(`${incoming} is not named <14-digit stamp>_<name>.sql`);
    else if (stamp <= newest) out.push(`${incoming} sorts at or before the base's newest (${newest})`);
  }
  for (const [path, e] of atHead) if (e.mode !== REGULAR) out.push(`${path} is not a regular file (${e.mode})`);
  return out;
}

/** Split `git diff --name-status -z` output into changes. @param {string} z */
export function parseNameStatusZ(z) {
  const t = z.split('\0');
  const out = [];
  for (let i = 0; i < t.length; ) {
    const status = t[i++];
    if (!status) continue;
    const from = t[i++];
    const to = status[0] === 'R' || status[0] === 'C' ? t[i++] : undefined;
    out.push({ status, from, ...(to === undefined ? {} : { to }) });
  }
  return out;
}

/** Split `git log --raw -z --format=` output (additions only) into entries. @param {string} z */
export function parseRawAddsZ(z) {
  const t = z.split('\0').map((s) => s.replace(/^\n+/, ''));
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (!t[i].startsWith(':')) continue;
    const meta = t[i].slice(1).split(' '); // srcmode dstmode srcsha dstsha status
    out.push({ path: t[++i], mode: meta[1], blob: meta[3] });
  }
  return out;
}

/** Split `git ls-tree -r -z` output into path -> entry. @param {string} z */
export function parseTreeZ(z) {
  const map = new Map();
  for (const rec of z.split('\0').filter(Boolean)) {
    const tab = rec.indexOf('\t');
    const [mode, , blob] = rec.slice(0, tab).split(' ');
    map.set(rec.slice(tab + 1), { path: rec.slice(tab + 1), mode, blob });
  }
  return map;
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'inherit'] });
const tree = (rev) => parseTreeZ(git(['ls-tree', '-r', '-z', rev, '--', DIR]));

function main() {
  const [mode, a, b] = process.argv.slice(2);
  let violations;
  if (mode === '--history') {
    const rev = a ?? 'HEAD';
    if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') throw new Error('Shallow clone: run with full history (actions/checkout fetch-depth: 0).');
    // Oldest first; --no-renames so a rename shows as a removal plus an addition.
    const added = parseRawAddsZ(git(['log', rev, '--first-parent', '--diff-merges=first-parent', '--reverse', '--no-renames', '--diff-filter=A', '--raw', '-z', '--no-abbrev', '--format=', '--', DIR]));
    if (!added.length) throw new Error(`No migrations found in the history of ${rev}.`);
    violations = historyViolations(added, tree(rev));
    console.log(`Checked ${added.length} migration addition(s) on the first-parent history of ${rev}.`);
  } else if (mode === '--range' && a && b) {
    const atBase = new Set(tree(a).keys());
    violations = rangeViolations(parseNameStatusZ(git(['diff', '--name-status', '-z', '-M', '-C', a, b, '--', DIR])), atBase, tree(b));
    console.log(`Checked ${DIR} changes from ${a} to ${b} against ${atBase.size} migration(s) at the base.`);
  } else {
    console.error('Usage: migration-history.mjs --history [rev] | --range <base> <head>');
    process.exit(2);
  }
  if (violations.length) {
    for (const v of violations) console.error(`::error::${v}. Applied migrations are never changed and new ones sort last: production records them by version. Restore the file and write a new migration with pnpm db:new.`);
    process.exit(1);
  }
  console.log('No applied migration was edited, renamed, removed or retyped, and every addition sorts last.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(); } catch (e) { console.error(`::error::${e instanceof Error ? e.message : e}`); process.exit(2); }
}
