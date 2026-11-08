#!/usr/bin/env node
// Which migrations in this checkout the hosted database has not applied yet.
// Usage (in the deploy workflow, with the SUPABASE_* env it already sets):
//   node scripts/schema-pending.mjs            prints them; writes count=<n> to $GITHUB_OUTPUT
//   node scripts/schema-pending.mjs --require-none   also exits 1 when any are pending
// The production app deploy waits on --require-none (docs/operations/deploy-order.md),
// so it reads the database's own history table, not the push diff: a migration a
// previous run failed to apply still counts as pending here. Any error exits
// non-zero, which holds the deploy (fail closed).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { poolerDbUrl } from './supabase-db-url.mjs';

const STAMP = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** Local migration versions missing from the remote history, oldest first. */
export function pendingVersions(local, remote) {
  const applied = new Set(remote);
  return [...new Set(local)].filter((v) => !applied.has(v)).sort();
}

/** Remote versions this checkout does not have (a newer schema is live). */
export function unknownVersions(local, remote) {
  const known = new Set(local);
  return [...new Set(remote)].filter((v) => !known.has(v)).sort();
}

export function localVersions(files) {
  return files.map((f) => STAMP.exec(f)?.[1]).filter(Boolean);
}

function main() {
  const requireNone = process.argv.includes('--require-none');
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'));
  const bad = files.filter((f) => !STAMP.test(f));
  if (bad.length) throw new Error(`Migration files not named <14-digit stamp>_<name>.sql: ${bad.join(', ')}`);
  const url = poolerDbUrl();
  if (!url) throw new Error('SUPABASE_POOLER_HOST is not set; cannot read the remote migration history.');
  const out = execFileSync('psql', [url, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'select version from supabase_migrations.schema_migrations'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const remote = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const pending = pendingVersions(localVersions(files), remote);
  const unknown = unknownVersions(localVersions(files), remote);
  console.log(`Remote has ${remote.length} migration(s); this commit has ${files.length}; pending: ${pending.length}.`);
  for (const v of pending.slice(0, 20)) console.log(`  pending ${v}`);
  if (pending.length > 20) console.log(`  ... and ${pending.length - 20} more`);
  // An older commit with a newer schema live is the normal additive-first case
  // (a later deploy got there first); say so, do not fail.
  if (unknown.length) console.log(`Remote also has ${unknown.length} version(s) this commit does not: ${unknown.join(', ')}.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `count=${pending.length}\n`);
  if (requireNone && pending.length) {
    console.error(`::error::${pending.length} migration(s) of this commit are not applied to the database; the app deploy stays held.`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
