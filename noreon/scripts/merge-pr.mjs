#!/usr/bin/env node
// Merge a PR into main only when it is safe. Usage:
//   node scripts/merge-pr.mjs <pr-number> [--dry-run]
// Branch protection is not available on this GitHub plan, and merging to main
// deploys the app (Vercel) and applies migrations to production. This gate
// requires: ready (not draft), every check on the exact head commit green, an
// update from main when main's changes touch the schema or this PR's schema
// objects (docs/operations/merge-gate.md), and new migrations sorting after main's newest. It then
// squash-merges with --match-head-commit so a late push cannot slip through.
import { execFileSync } from 'node:child_process';
import { mergeBlockers, mergeWarnings } from './merge-gate-lib.mjs';

const REPO = 'noreon-health/noreon-core';
const [prArg, ...flags] = process.argv.slice(2);
const dryRun = flags.includes('--dry-run');
// The integrator passes this only after reading a PR's changes to CI or the gate.
const ciChangeReviewed = flags.includes('--ci-change-reviewed');
if (!/^\d+$/.test(prArg ?? '')) {
  console.error('Usage: node scripts/merge-pr.mjs <pr-number> [--dry-run] [--ci-change-reviewed]');
  process.exit(2);
}
// 64 MB: large compare or diff answers exceed Node's 1 MB default (ENOBUFS on #281, #287).
const gh = (args) => execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 64 << 20 });
// Read-only API calls retry: the network to GitHub drops connections at times.
const retry = (fn, tries = 3) => { for (let i = 1; ; i++) { try { return fn(); } catch (e) { if (i >= tries) throw e; } } };
const api = (path) => retry(() => JSON.parse(gh(['api', '-H', 'Accept: application/vnd.github+json', path])));
const paged = (path) => retry(() => JSON.parse(gh(['api', '--paginate', '--slurp', path])).flat());

const pull = api(`repos/${REPO}/pulls/${prArg}`);
if (pull.base.ref !== 'main') {
  console.error(`PR #${prArg} targets ${pull.base.ref}, not main. Merge stacked PRs into main only after rebasing them onto main.`);
  process.exit(1);
}
const headSha = pull.head.sha;
const compare = api(`repos/${REPO}/compare/main...${headSha}`);
const runs = paged(`repos/${REPO}/commits/${headSha}/check-runs?per_page=100`).flatMap((page) => page.check_runs ?? page);
// Keep only the latest run of each check name (re-runs create new entries).
const latest = new Map();
for (const run of runs) {
  const prior = latest.get(run.name);
  if (!prior || Date.parse(run.started_at ?? 0) > Date.parse(prior.started_at ?? 0)) latest.set(run.name, run);
}
// Commit statuses (not check runs). Vercel no longer builds PR branches (only main,
// to save Build CPU; 18 Oct), so its preview statuses are skipped or cancelled and
// are not required: the verify job runs the same `pnpm build` on this exact commit.
const statuses = (api(`repos/${REPO}/commits/${headSha}/status`).statuses ?? []).filter((s) => !/^Vercel\b/.test(s.context));
for (const s of statuses)
  latest.set(s.context, { name: s.context, status: s.state === 'pending' ? 'pending' : 'completed', conclusion: s.state === 'error' ? 'failure' : s.state });
// A dropped page during a GitHub outage returns a short list; fetch once more
// before treating it as incomplete (seen on #303: 0 of 9 listed, then 9 of 9).
let files = paged(`repos/${REPO}/pulls/${prArg}/files?per_page=100`);
if (files.length !== pull.changed_files && pull.changed_files < 3000) files = paged(`repos/${REPO}/pulls/${prArg}/files?per_page=100`);
// Migrations on main, from the git tree of supabase/migrations at one pinned main
// commit. The contents API lists at most 1,000 entries of a directory and says
// nothing when it stops, which would let an edit to a later migration through;
// the tree API reports truncation, and the gate blocks on it.
const mainHead = api(`repos/${REPO}/commits/main`).sha;
const migrationsDir = api(`repos/${REPO}/contents/supabase?ref=${mainHead}`).find((e) => e.name === 'migrations' && e.type === 'dir');
const mainTree = migrationsDir ? api(`repos/${REPO}/git/trees/${migrationsDir.sha}`) : null;
const mainMigrations = (mainTree?.tree ?? []).filter((e) => e.type === 'blob').map((e) => `supabase/migrations/${e.path}`);
const mainMigrationsComplete = !!mainTree && mainTree.truncated === false && mainMigrations.length > 0;

// Files changed on main that this PR's head does not have yet.
// Pin main to one commit, so the file list and the texts read below agree.
const mainSha = compare.behind_by > 0 ? mainHead : null;
const mainCompare = mainSha ? api(`repos/${REPO}/compare/${headSha}...${mainSha}`) : null;
const mainAhead = mainCompare?.files ?? [];
// The compare API lists at most 300 files and 250 commits; past that the gate
// cannot see main's changes and blocks.
const mainAheadTruncated = !!mainCompare && (mainAhead.length >= 300 || (mainCompare.commits?.length ?? 0) < mainCompare.total_commits);
const schemaPr = files.some((f) => f.filename.startsWith('supabase/migrations/') || f.filename === 'lib/db/types.ts');
// For a schema PR behind main: its migration SQL, and the current text of every
// file main changed (a removed file counts as empty), to find code on main that
// uses the objects this PR changes. Read from git after one fetch; a read
// failure leaves a file out, which the gate treats as a blocker.
const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
const needTexts = schemaPr && compare.behind_by > 0;
if (needTexts) { try { retry(() => git(['fetch', '-q', 'origin', mainSha, headSha])); } catch { /* reads below fail closed */ } }
const readOrNull = (path, ref) => { try { return git(['show', `${ref}:${path}`]); } catch { return null; } };
const migrationTexts = needTexts
  ? files.filter((f) => f.filename.startsWith('supabase/migrations/') && f.status !== 'removed').map((f) => readOrNull(f.filename, headSha))
  : [];
// An unreadable migration empties the list, which blocks the merge.
const prMigrationSql = migrationTexts.includes(null) ? [] : migrationTexts;
const mainAheadTexts = needTexts
  ? mainAhead.flatMap((f) => { const text = f.status === 'removed' ? '' : readOrNull(f.filename, mainSha); return text === null ? [] : [{ path: f.filename, text }]; })
  : [];
const input = {
  pr: { state: pull.state, draft: pull.draft, behindBy: compare.behind_by, headSha },
  checks: [...latest.values()].map((r) => ({ name: r.name, status: r.status, conclusion: r.conclusion })),
  addedFiles: files.filter((f) => f.status === 'added').map((f) => f.filename),
  changedFiles: files.map((f) => f.filename),
  fileChanges: files.map((f) => ({ path: f.filename, status: f.status, previous: f.previous_filename })),
  ciChangeReviewed,
  filesComplete: files.length === pull.changed_files && files.length < 3000,
  fileCounts: { listed: files.length, total: pull.changed_files },
  mainAheadFiles: mainAhead.map((f) => f.filename),
  mainAheadTruncated,
  mainMigrations,
  mainMigrationsComplete,
  prMigrationSql,
  mainAheadTexts,
};
const blockers = mergeBlockers(input);
for (const w of mergeWarnings(input)) console.warn(`Warning: ${w}`);

if (blockers.length) {
  console.error(`PR #${prArg} (${headSha.slice(0, 7)}) is not ready to merge:`);
  for (const b of blockers) console.error(`- ${b}`);
  process.exit(1);
}
const migrations = files.filter((f) => f.filename.startsWith('supabase/migrations/')).length;
console.log(`PR #${prArg} (${headSha.slice(0, 7)}) passes the merge gate.${migrations ? ` It changes ${migrations} migration file(s): merging applies them to production.` : ''}`);
if (dryRun) process.exit(0);
gh(['pr', 'merge', prArg, '--repo', REPO, '--squash', '--match-head-commit', headSha]);
console.log(`Merged PR #${prArg}.`);
