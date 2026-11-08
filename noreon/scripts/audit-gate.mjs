#!/usr/bin/env node
// Fails on high or critical advisories in production dependencies, except those accepted in
// scripts/audit-accepted.json for this lockfile and not yet past their date. An entry that names a
// version and a dependency (`via`) covers only that: any other version, or anything else in the
// lockfile needing that version, still blocks.
// Usage (from the lockfile's directory): pnpm audit --prod --json | node <repo>/scripts/audit-gate.mjs <lockfile-label>
import { readFileSync } from 'node:fs';

const label = process.argv[2];
if (!label) throw new Error('usage: audit-gate.mjs <lockfile-label>');
const accepted = JSON.parse(readFileSync(new URL('./audit-accepted.json', import.meta.url), 'utf8')).accepted;
const today = new Date().toISOString().slice(0, 10);
const input = readFileSync(0, 'utf8');
let report;
try {
  report = JSON.parse(input);
} catch {
  console.error(`audit-gate (${label}): pnpm audit did not return JSON`);
  console.error(input.slice(0, 2000));
  process.exit(1);
}
if (report.error) {
  console.error(`audit-gate (${label}): pnpm audit failed: ${JSON.stringify(report.error)}`);
  process.exit(1);
}
const advisories = Object.values(report.advisories ?? {});
const blocking = [];
// pnpm audit leaves paths empty without an install, as in CI, so who needs a version comes from the
// lockfile in the working directory. Direct dependencies are reported as "importer". An npm alias
// keeps the real package in its value (zod-old: zod@3.25.76), so a dependency counts by what it
// resolves to, not by the name it is listed under. A copy from anywhere but the registry (file, url,
// git) can carry the same version under a reference that shows none, so one voids the acceptance.
// There is no YAML parser here because this job runs without an install. Quotes are dropped first,
// since quoting style carries no meaning, and the scan reads pnpm's block style. This guards against
// honest dependency changes, not a hand-crafted lockfile, which could equally edit the acceptance file.
function dependents(name, version) {
  let lock;
  try {
    lock = readFileSync('pnpm-lock.yaml', 'utf8').replace(/['"]/g, '');
  } catch {
    return null;
  }
  const nonRegistry = new RegExp(`(^|[\\s{(,])${name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}@(?!\\d)`, 'm');
  if (nonRegistry.test(lock)) return null;
  const resolves = (dep, value) => {
    const target = value.trim().replace(/\(.*$/, '');
    return target === `${name}@${version}` || (dep === name && target === version);
  };
  const found = new Set();
  let section = '';
  let owner = '';
  let importerDep = '';
  for (const line of lock.split('\n')) {
    if (/^\S/.test(line)) section = line.replace(/:.*$/, '');
    const key = /^ {2}(\S.*?):/.exec(line);
    if (key) owner = key[1].replace(/(.)@.*$/, '$1');
    if (section === 'importers') {
      const dep = /^ {6}(\S.*?):$/.exec(line);
      if (dep) importerDep = dep[1];
      const resolved = /^ {8}version: (.+)$/.exec(line);
      if (resolved && resolves(importerDep, resolved[1])) found.add('importer');
    } else if (section === 'snapshots') {
      const dep = /^ {6}(\S.*?): (.+)$/.exec(line);
      if (dep && resolves(dep[1], dep[2])) found.add(owner);
    }
  }
  return found;
}
const covers = (entry, advisory) => {
  if (!entry.version && !entry.via) return true;
  const findings = advisory.findings ?? [];
  if (!findings.length || !findings.every((f) => f.version === entry.version)) return false;
  const needed = dependents(advisory.module_name, entry.version);
  return Boolean(needed?.size) && [...needed].every((name) => name === entry.via);
};
for (const a of advisories) {
  if (!['high', 'critical'].includes(a.severity)) continue;
  const ok = accepted.find((e) => e.ghsa === a.github_advisory_id && e.lockfile === label && covers(e, a));
  if (ok && ok.until >= today) {
    console.log(`accepted until ${ok.until}: ${a.severity} ${a.module_name} ${a.github_advisory_id} (${ok.reason})`);
    continue;
  }
  blocking.push(a);
  console.error(`${ok ? `acceptance expired ${ok.until}: ` : ''}${a.severity} ${a.module_name} ${a.vulnerable_versions} ${a.url}`);
}
console.log(`audit-gate (${label}): ${advisories.length} advisories, ${blocking.length} blocking`);
process.exit(blocking.length ? 1 : 0);
