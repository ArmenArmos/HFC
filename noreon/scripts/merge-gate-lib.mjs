// Pure decision logic for scripts/merge-pr.mjs. Branch protection is not
// available on this GitHub plan, so every agent merges through this gate.

const MIGRATION = /^supabase\/migrations\/(\d{14})_[a-z0-9_]+\.sql$/;

/** @param {string} path */
export function migrationStamp(path) {
  return MIGRATION.exec(path)?.[1] ?? null;
}

/**
 * Returns a list of human-readable blockers; empty means the PR may merge.
 * pr: { draft, state, behindBy, headSha }
 * checks: [{ name, status, conclusion }] for the PR head commit
 * addedFiles: paths the PR adds; changedFiles: paths the PR changes;
 * mainAheadFiles: paths changed on main since the PR's base;
 * mainMigrations: migration paths on main
 * Being behind main blocks when main gained schema changes (CI has not replayed
 * this migration order or regenerated types), or when the PR changes the schema
 * and a file changed on main mentions an object the PR's migrations touch (that
 * code was never type-checked or tested against the new schema). Otherwise
 * being behind is a warning, so app-only merges do not restart the schema queue.
 * Residual risk: docs/operations/merge-gate.md.
 */
/**
 * @typedef {{ state: string, draft: boolean, behindBy: number, headSha?: string }} PullState
 * @typedef {{ name: string, status: string, conclusion: string | null }} CheckRun
 * @typedef {{ path: string, text: string }} FileText
 * @typedef {{ path: string, status: string, previous?: string }} FileChange
 * @typedef {{ pr: PullState, checks?: CheckRun[], addedFiles?: string[], changedFiles?: string[], fileChanges?: FileChange[], ciChangeReviewed?: boolean, filesComplete?: boolean, fileCounts?: { listed: number, total: number }, mainMigrationsComplete?: boolean, mainAheadFiles?: string[], mainAheadTruncated?: boolean, mainMigrations?: string[], prMigrationSql?: string[], mainAheadTexts?: FileText[] }} GateInput
 */
/** @param {string} path */
const SCHEMA = (path) => path.startsWith('supabase/migrations/') || path === 'lib/db/types.ts';

const IDENT = String.raw`(?:"?[a-z_][a-z0-9_$]*"?\.)?"?([a-z_][a-z0-9_$]*)"?`;
const OBJECT_PATTERNS = [
  // create / alter / drop / comment on a table, view, function, type ...
  new RegExp(String.raw`\b(?:create(?:\s+or\s+replace)?|alter|drop|comment\s+on)\s+(?:table|(?:materialized\s+)?view|function|procedure|type|domain|sequence)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?${IDENT}`, 'gi'),
  // policies and triggers change what the app can read or what writes do
  new RegExp(String.raw`\b(?:create|alter|drop)\s+(?:policy|trigger)\s+(?:if\s+exists\s+)?(?:"[^"]+"|\S+)[\s\S]*?\bon\s+(?:table\s+)?${IDENT}`, 'gi'),
  // seeded or changed rows (settings, capabilities, templates) change app behaviour
  // (not the row-lock clauses "for update", "for no key update")
  new RegExp(String.raw`\b(?:insert\s+into|(?<!\bfor\s(?:no\skey\s)?)update|delete\s+from|truncate(?:\s+table)?)\s+(?:only\s+)?${IDENT}`, 'gi'),
  // a new unique index can make main's inserts fail
  new RegExp(String.raw`\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?(?:\S+\s+)?on\s+(?:only\s+)?${IDENT}`, 'gi'),
];
// Statements that name several objects: grant/revoke ... on a(), b() to/from,
// and drop table|view|function a, b.
const LISTS = [
  /\b(?:grant|revoke)\b[^;]*?\bon\s+(?:all\s+\w+\s+in\s+schema\s+\S+|(?:table|function|procedure|sequence|type)\s+)?([^;]*?)\s+(?:to|from)\b/gi,
  /\bdrop\s+(?:table|(?:materialized\s+)?view|function|procedure|type|domain|sequence)\s+(?:if\s+exists\s+)?([^;]*?)(?:\s+(?:cascade|restrict))?\s*;/gi,
];
// SQL keywords caught by trigger, lock, loop and dynamic-SQL clauses.
const NOT_NAMES = new Set(['public', 'all', 'schema', 'auth', 'storage', 'set', 'or', 'on', 'of', 'only', 'function', 'functions', 'procedure', 'table', 'tables', 'sequence', 'sequences', 'type', 'skip', 'nowait', 'locked', 'loop', 'using', 'if', 'exists', 'select', 'execute']);

/**
 * Names of the tables, views, functions and types a migration creates, alters,
 * drops, re-grants or puts policies or triggers on (schema prefix removed).
 * @param {string} sql @returns {Set<string>}
 */
export function migrationObjects(sql) {
  const text = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const names = new Set();
  for (const re of OBJECT_PATTERNS) for (const m of text.matchAll(re)) names.add(m[1].toLowerCase());
  for (const re of LISTS)
    for (const m of text.matchAll(re))
      for (const item of m[1].replace(/\([^)]*\)/g, '').split(','))
        for (const id of item.matchAll(/^\s*(?:"?[a-z_][a-z0-9_$]*"?\.)?"?([a-z_][a-z0-9_$]*)"?\s*$/gi)) names.add(id[1].toLowerCase());
  for (const word of NOT_NAMES) names.delete(word);
  for (const name of names) if (name.length < 2) names.delete(name);
  return names;
}

/**
 * Files changed on main that mention an object the PR's migrations touch.
 * @param {string[]} prMigrationSql @param {FileText[]} mainAheadTexts
 * @returns {{ path: string, names: string[] }[]}
 */
export function mainAheadReferences(prMigrationSql, mainAheadTexts) {
  const names = new Set(prMigrationSql.flatMap((sql) => [...migrationObjects(sql)]));
  return mainAheadTexts
    .map(({ path, text }) => ({ path, names: [...names].filter((n) => new RegExp(`(?<![A-Za-z0-9_])${n}(?![A-Za-z0-9_])`, 'i').test(text)) }))
    .filter((r) => r.names.length);
}

/** @param {GateInput} input @returns {string[]} */
export function mergeBlockers({ pr, checks = [], addedFiles = [], changedFiles = addedFiles, fileChanges = [], ciChangeReviewed = false, filesComplete = true, fileCounts = { listed: 0, total: 0 }, mainMigrationsComplete = true, mainAheadFiles = [], mainAheadTruncated = false, mainMigrations = [], prMigrationSql = [], mainAheadTexts = [] }) {
  const blockers = [];
  if (pr.state !== 'open') blockers.push(`PR is ${pr.state}, not open.`);
  if (pr.draft) blockers.push('PR is a draft. Mark it ready so CI runs.');
  if (pr.behindBy > 0) {
    const stale = `PR is ${pr.behindBy} commit(s) behind main`;
    const update = 'Update it from main and wait for CI on the new head.';
    if (mainAheadTruncated) blockers.push(`${stale}, more than GitHub's compare lists (300 files or 250 commits), so the gate cannot see what changed. ${update}`);
    else if (mainAheadFiles.some(SCHEMA)) blockers.push(`${stale} and main changed the database schema. ${update}`);
    else if (changedFiles.some(SCHEMA)) {
      const objects = new Set(prMigrationSql.flatMap((sql) => [...migrationObjects(sql)]));
      const refs = mainAheadReferences(prMigrationSql, mainAheadTexts);
      if (!objects.size) blockers.push(`${stale}, the PR changes the schema, and the gate could not tell which objects its migrations touch. ${update}`);
      else if (mainAheadTexts.length < mainAheadFiles.length) blockers.push(`${stale}, the PR changes the schema, and the gate could not read every file changed on main. ${update}`);
      else if (refs.length) blockers.push(`${stale}, and code changed on main uses objects this PR's migrations change: ${refs.map((r) => `${r.path} (${r.names.join(', ')})`).join('; ')}. ${update}`);
    }
  }

  const verify = checks.filter((c) => c.name === 'verify');
  if (!verify.length) blockers.push('No "verify" check on the head commit. CI has not run on this exact commit.');
  // A push while the PR was a draft records verify as skipped; only a real run counts.
  else if (verify.every((c) => c.status === 'completed' && c.conclusion === 'skipped'))
    blockers.push('The "verify" check on the head commit was skipped (pushed while a draft). Wait for the run started by marking the PR ready.');
  for (const c of checks) {
    if (c.status !== 'completed') blockers.push(`Check "${c.name}" is still ${c.status}.`);
    else if (!['success', 'skipped', 'neutral'].includes(c.conclusion))
      blockers.push(`Check "${c.name}" concluded ${c.conclusion}.`);
  }

  const newest = mainMigrations.map(migrationStamp).filter(Boolean).sort().at(-1) ?? '';
  // Every migration path this PR brings that main does not have is new, however
  // GitHub labels it: added, or the target of a copy or a rename (from a non-
  // migration path or one not on main), so each must sort after main's newest.
  const onMain = new Set(mainMigrations);
  const incoming = [...new Set([
    ...addedFiles,
    ...fileChanges.filter((f) => f.status !== 'removed').map((f) => f.path),
  ])].filter((path) => !onMain.has(path));
  for (const path of incoming) {
    if (!path.startsWith('supabase/migrations/')) continue;
    const stamp = migrationStamp(path);
    if (!stamp) blockers.push(`Migration ${path} is not named <14-digit UTC timestamp>_<name>.sql.`);
    else if (stamp <= newest)
      blockers.push(`Migration ${path} sorts at or before main's newest (${newest}). Re-create it with pnpm db:new so production applies it last.`);
  }

  // GitHub lists at most 3000 files of a PR; past that the rules below cannot see
  // every change (e.g. an edited migration), so the gate refuses.
  if (!mainMigrationsComplete) blockers.push('The gate could not read the full list of migrations on main (missing or truncated tree), so it cannot tell applied migrations from new ones.');
  if (!filesComplete)
    blockers.push(fileCounts.total >= 3000
      ? `PR has ${fileCounts.total} files; GitHub lists at most 3000, so the gate cannot check it. Split the PR.`
      : `GitHub listed ${fileCounts.listed} of this PR's ${fileCounts.total} files, usually a network error. Retry the gate.`);

  // A migration already on main has been applied to production, which records it
  // by version: an edit or rename is skipped there, so environments silently drift.
  const applied = new Set(mainMigrations);
  for (const f of fileChanges) {
    if (f.status === 'added') continue;
    // A copy leaves its source as it was; only the source of a rename is changed.
    const hit = [f.path, f.status === 'copied' ? null : f.previous].find((p) => p && applied.has(p));
    if (hit) blockers.push(`PR ${f.status === 'renamed' ? 'renames' : f.status === 'removed' ? 'removes' : 'edits'} ${hit}, a migration already on main and applied to production. Write a new migration instead.`);
  }

  // A PR's own CI runs its own workflow files, so a change to CI or to this gate
  // could weaken the checks that approved it. The integrator reads the diff first.
  // Old paths count too: moving a workflow out of .github/ removes it. Deleting or
  // renaming an existing check counts as well; editing one is the reviewers' job.
  const ciFiles = [...new Set([
    ...changedFiles.filter(CI_FILE),
    ...fileChanges.flatMap((f) => [f.previous].filter((p) => p && CI_FILE(p))),
    ...fileChanges.filter((f) => f.status === 'removed' || f.status === 'renamed').flatMap((f) => [f.previous ?? f.path]).filter((p) => p && CHECK_FILE(p)),
  ])];
  if (ciFiles.length && !ciChangeReviewed)
    blockers.push(`PR changes CI or the merge gate (${ciFiles.join(', ')}), and its checks ran on those changed files. Read that diff, then merge with --ci-change-reviewed.`);
  return blockers;
}

/** @param {string} path */
const CI_FILE = (path) =>
  path.startsWith('.github/') ||
  /^scripts\/(merge-pr\.mjs|merge-gate-lib\.mjs|check-merge-gate\.ts|run-checks\.mjs|ci-mobile-scope\.mjs|check-ci-mobile-scope\.mjs|register-alias\.mjs)$/.test(path) ||
  // What the production deploy runs: changing these changes how and whether migrations reach production.
  /^scripts\/(supabase-migrate\.mjs|supabase-db-url\.mjs|schema-pending\.mjs|migration-history\.mjs|check-migration-history\.ts)$/.test(path) ||
  /^(apps\/[^/]+\/)?(package\.json|tsconfig[^/]*\.json|eslint\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s)$/.test(path);
/** An existing regression check: removing or renaming one weakens CI. @param {string} path */
const CHECK_FILE = (path) => /^scripts\/check-[^/]+\.(ts|mjs|sql|py)$/.test(path);

/** @param {GateInput} input @returns {string[]} */
export function mergeWarnings(input) {
  const { pr, changedFiles = [] } = input;
  if (pr.behindBy === 0 || mergeBlockers(input).some((b) => b.includes('behind main'))) return [];
  return changedFiles.some(SCHEMA)
    ? [`PR is ${pr.behindBy} commit(s) behind main. Main's changes are app code that does not use the objects this PR's migrations change, so CI is not re-run; Vercel will build the merged result.`]
    : [`PR is ${pr.behindBy} commit(s) behind main (app code only). The squash merge is not re-verified; Vercel will build the merged result.`];
}
