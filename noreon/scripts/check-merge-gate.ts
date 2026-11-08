import assert from 'node:assert/strict';
import { mainAheadReferences, mergeBlockers, mergeWarnings, migrationObjects, migrationStamp } from './merge-gate-lib.mjs';

const ready = { state: 'open', draft: false, behindBy: 0, headSha: 'abc' };
const green = [{ name: 'verify', status: 'completed', conclusion: 'success' }, { name: 'mobile', status: 'completed', conclusion: 'skipped' }];
const main = ['supabase/migrations/20261017095154_trace_zoe_hardening.sql', 'supabase/migrations/20261017084014_b5_care_plan_versions.sql'];
const ok = (input: object) => mergeBlockers({ pr: ready, checks: green, addedFiles: [], mainMigrations: main, ...input });

assert.equal(migrationStamp('supabase/migrations/20261017095154_trace_zoe_hardening.sql'), '20261017095154');
assert.deepEqual(ok({}), [], 'ready, up to date, green, no migrations');
assert.deepEqual(ok({ addedFiles: ['supabase/migrations/20261017120000_new_thing.sql', 'app/page.tsx'] }), [], 'new migration sorts last');
assert.match(ok({ pr: { ...ready, draft: true } }).join(), /draft/);
const behind = { ...ready, behindBy: 2 };
assert.deepEqual(ok({ pr: behind, changedFiles: ['app/page.tsx'], mainAheadFiles: ['lib/x.ts'] }), [], 'app-only behind main is a warning, not a blocker');
assert.equal(mergeWarnings({ pr: behind, changedFiles: ['app/page.tsx'], mainAheadFiles: ['lib/x.ts'] }).length, 1);
assert.match(ok({ pr: behind, changedFiles: ['lib/db/types.ts'] }).join(), /could not tell which objects/, 'types-only PR without migration SQL blocks');
assert.match(ok({ pr: behind, changedFiles: ['app/page.tsx'], mainAheadFiles: ['supabase/migrations/20261017130000_x.sql'] }).join(), /behind main/, 'main gained a migration');
assert.match(ok({ pr: behind, addedFiles: ['supabase/migrations/20261017130000_y.sql'] }).join(), /could not tell which objects/, 'PR adds a migration the gate has not read');
assert.deepEqual(mergeWarnings({ pr: ready }), []);
assert.match(ok({ pr: { ...ready, state: 'closed' } }).join(), /closed/);
assert.match(ok({ checks: [] }).join(), /No "verify" check/);
assert.match(ok({ checks: [{ name: 'verify', status: 'in_progress', conclusion: null }] }).join(), /still in_progress/);
assert.match(ok({ checks: [{ name: 'verify', status: 'completed', conclusion: 'failure' }] }).join(), /concluded failure/);
assert.match(ok({ checks: [...green, { name: 'mobile', status: 'completed', conclusion: 'cancelled' }] }).join(), /concluded cancelled/);
assert.match(ok({ addedFiles: ['supabase/migrations/20261017084014_older.sql'] }).join(), /sorts at or before/);
assert.match(ok({ addedFiles: ['supabase/migrations/20261017095154_same_stamp.sql'] }).join(), /sorts at or before/);
assert.match(ok({ addedFiles: ['supabase/migrations/bad-name.sql'] }).join(), /not named/);
console.log('Merge gate blocks drafts, stale bases, missing/failed/pending checks and out-of-order migrations.');

// Narrow schema rule: a schema PR behind main re-runs CI only when main changed
// the schema, or main's changed files use objects the PR's migrations touch.
const sql = `-- create table ignored_comment (x int);
create table if not exists public.member_callbacks (id uuid);
create or replace function public.request_callback(p uuid) returns void language sql as $$ select 1 $$;
alter table only public.members add column text_size text;
create policy "own rows" on public.member_callbacks for select using (true);
create trigger t_set before update of name or delete on public.member_prefs for each row execute function f();
revoke execute on function public.old_fn(uuid) from authenticated;
grant select on public.care_team_hours to authenticated;
insert into public.capabilities (key) values ('callbacks');
drop view if exists public.v_journey;`;
assert.deepEqual([...migrationObjects(sql)].sort(), ['capabilities', 'care_team_hours', 'member_callbacks', 'member_prefs', 'members', 'old_fn', 'request_callback', 'v_journey']);
assert.deepEqual(mainAheadReferences([sql], [{ path: 'app/a.tsx', text: "supabase.rpc('request_callback')" }, { path: 'app/b.tsx', text: 'membership members_count' }]), [{ path: 'app/a.tsx', names: ['request_callback'] }], 'word-boundary match only');

const schemaPr = { pr: behind, changedFiles: ['supabase/migrations/20261017130000_y.sql', 'lib/db/types.ts'], addedFiles: ['supabase/migrations/20261017130000_y.sql'], prMigrationSql: [sql] };
assert.deepEqual(ok({ ...schemaPr, mainAheadFiles: ['app/x.tsx'], mainAheadTexts: [{ path: 'app/x.tsx', text: 'unrelated' }] }), [], 'schema PR behind unrelated app-only main merges');
assert.match(mergeWarnings({ ...schemaPr, mainAheadFiles: ['app/x.tsx'], mainAheadTexts: [{ path: 'app/x.tsx', text: 'unrelated' }] }).join(), /does not use the objects/);
assert.match(ok({ ...schemaPr, mainAheadFiles: ['app/x.tsx'], mainAheadTexts: [{ path: 'app/x.tsx', text: "from('members')" }] }).join(), /app\/x\.tsx \(members\)/, 'main code uses a changed table');
assert.equal(mergeWarnings({ ...schemaPr, mainAheadFiles: ['app/x.tsx'], mainAheadTexts: [{ path: 'app/x.tsx', text: "from('members')" }] }).length, 0, 'no warning when blocked');
assert.match(ok({ ...schemaPr, mainAheadFiles: ['supabase/migrations/20261017140000_z.sql'], mainAheadTexts: [] }).join(), /main changed the database schema/);
assert.match(ok({ ...schemaPr, mainAheadFiles: ['lib/db/types.ts'], mainAheadTexts: [] }).join(), /main changed the database schema/);
assert.match(ok({ ...schemaPr, mainAheadFiles: ['app/x.tsx', 'app/y.tsx'], mainAheadTexts: [{ path: 'app/x.tsx', text: 'unrelated' }] }).join(), /could not read every file/, 'unreadable main file blocks');
assert.match(ok({ ...schemaPr, prMigrationSql: [], mainAheadFiles: ['app/x.tsx'], mainAheadTexts: [{ path: 'app/x.tsx', text: 'unrelated' }] }).join(), /could not tell which objects/, 'unparseable or unreadable migration blocks');
assert.match(ok({ ...schemaPr, mainAheadFiles: ['app/x.tsx'], mainAheadTexts: [{ path: 'app/x.tsx', text: 'x' }], addedFiles: ['supabase/migrations/20261017084014_old.sql'] }).join(), /sorts at or before/, 'ordering rule still applies');
console.log('Schema PRs behind main re-run CI only when main changed the schema or uses the objects their migrations change.');

// Review fixes: keywords are not names, comma lists, indexes, truncated compare.
const tricky = `execute format('revoke all on function %s from public', fn);
select id from public.jobs for update skip locked;
select id from public.jobs2 for no key update nowait;
for r in select * from public.queue loop perform 1; end loop;
grant execute on function public.a_fn(uuid), public.b_fn(), c_fn(text) to authenticated;
drop table if exists public.t_one, public.t_two cascade;
create unique index if not exists member_email_key on public.member_contacts (email);`;
assert.deepEqual([...migrationObjects(tricky)].sort(), ['a_fn', 'b_fn', 'c_fn', 'member_contacts', 't_one', 't_two']);
assert.match(ok({ ...schemaPr, mainAheadTruncated: true, mainAheadFiles: ['app/x.tsx'], mainAheadTexts: [{ path: 'app/x.tsx', text: 'unrelated' }] }).join(), /more than GitHub's compare lists/);
assert.match(ok({ pr: behind, changedFiles: ['app/page.tsx'], mainAheadTruncated: true }).join(), /more than GitHub's compare lists/, 'truncated compare blocks app-only PRs too');
console.log('Gate parsing ignores SQL keywords, reads comma lists and unique indexes, and blocks when GitHub truncates the compare.');
assert.match(ok({ checks: [{ name: 'verify', status: 'completed', conclusion: 'skipped' }] }).join(), /was skipped/, 'a skipped verify (draft push) does not count');
console.log('A verify check skipped while the PR was a draft does not pass the gate.');
// A scoped manual run (draft iteration) reports under its own name and never stands in for verify.
const scoped = [{ name: 'verify (sql only)', status: 'completed', conclusion: 'success' }, { name: 'verify (ts only)', status: 'completed', conclusion: 'success' }];
assert.match(ok({ checks: scoped }).join(), /No "verify" check/, 'scoped runs alone do not pass the gate');
assert.match(ok({ checks: [...green, { name: 'verify (sql only)', status: 'completed', conclusion: 'failure' }] }).join(), /concluded failure/, 'a failed scoped run on the head still blocks');
console.log('Scoped manual runs never satisfy the verify check.');

// Applied migrations are never edited, renamed or removed; CI and gate changes need the integrator's explicit OK.
const appliedPath = main[0];
assert.match(ok({ changedFiles: [appliedPath], fileChanges: [{ path: appliedPath, status: 'modified' }] }).join(), /edits .*applied to production/, 'editing an applied migration blocks');
assert.match(ok({ changedFiles: ['supabase/migrations/20261018000000_new.sql'], fileChanges: [{ path: 'supabase/migrations/20261018000000_new.sql', status: 'renamed', previous: appliedPath }] }).join(), /renames .*applied/, 'renaming an applied migration blocks');
assert.match(ok({ changedFiles: [appliedPath], fileChanges: [{ path: appliedPath, status: 'removed' }] }).join(), /removes /, 'removing an applied migration blocks');
assert.deepEqual(ok({ addedFiles: ['supabase/migrations/20261018000000_new.sql'], fileChanges: [{ path: 'supabase/migrations/20261018000000_new.sql', status: 'added' }] }), [], 'a new migration is fine');
assert.deepEqual(ok({ changedFiles: ['supabase/migrations/20261018000000_mine.sql'], fileChanges: [{ path: 'supabase/migrations/20261018000000_mine.sql', status: 'modified' }] }), [], 'editing a migration not yet on main is fine');
for (const f of ['.github/workflows/verify.yml', 'scripts/merge-pr.mjs', 'scripts/merge-gate-lib.mjs', 'scripts/run-checks.mjs', 'scripts/check-merge-gate.ts'])
  assert.match(ok({ changedFiles: [f] }).join(), /changes CI or the merge gate/, `${f} needs the integrator's OK`);
assert.deepEqual(ok({ changedFiles: ['.github/workflows/verify.yml'], ciChangeReviewed: true }), [], '--ci-change-reviewed lets a reviewed CI change merge');
assert.deepEqual(ok({ changedFiles: ['scripts/check-foo.ts', 'app/page.tsx'] }), [], 'ordinary checks and app code need no OK');
console.log('Applied migrations stay untouched, and changes to CI or the gate need an explicit integrator OK.');

// Review round 1 (Astra): wider CI surface, old paths, removed checks, truncated file lists.
for (const f of ['package.json', 'apps/patient-mobile/package.json', 'scripts/ci-mobile-scope.mjs', 'scripts/register-alias.mjs', 'tsconfig.json', 'eslint.config.mjs', 'next.config.ts'])
  assert.match(ok({ changedFiles: [f] }).join(), /changes CI or the merge gate/, `${f} can change what CI runs`);
assert.match(ok({ changedFiles: ['docs/old-supply-chain.yml'], fileChanges: [{ path: 'docs/old-supply-chain.yml', status: 'renamed', previous: '.github/workflows/supply-chain.yml' }] }).join(), /\.github\/workflows\/supply-chain\.yml/, 'moving a workflow out of .github/ counts');
assert.match(ok({ changedFiles: ['scripts/check-booking.sql'], fileChanges: [{ path: 'scripts/check-booking.sql', status: 'removed' }] }).join(), /check-booking\.sql/, 'deleting an existing check needs the OK');
assert.match(ok({ changedFiles: ['scripts/old-booking.sql'], fileChanges: [{ path: 'scripts/old-booking.sql', status: 'renamed', previous: 'scripts/check-booking.sql' }] }).join(), /check-booking\.sql/, 'renaming a check away needs the OK');
assert.deepEqual(ok({ changedFiles: ['scripts/check-booking.sql'], fileChanges: [{ path: 'scripts/check-booking.sql', status: 'modified' }] }), [], 'editing a check is the reviewers\x27 job');
assert.match(ok({ filesComplete: false }).join(), /usually a network error|Split the PR/, 'an incomplete file list blocks');
assert.match(ok({ filesComplete: false, ciChangeReviewed: true }).join(), /usually a network error|Split the PR/, 'the CI flag never clears an incomplete list');
console.log('CI surface covers package, config and check removals; old paths count; incomplete file lists block.');
assert.match(ok({ filesComplete: false, fileCounts: { listed: 0, total: 9 } }).join(), /listed 0 of this PR's 9 files, usually a network error/, 'a short list says retry');
assert.match(ok({ filesComplete: false, fileCounts: { listed: 3000, total: 3400 } }).join(), /3400 files.*Split the PR/, 'over the cap says split');
console.log('An incomplete file list names its cause: retry for a short list, split for over 3000.');

// A migration that arrives as a rename or copy is new too, and must sort last.
assert.match(ok({ changedFiles: ['supabase/migrations/20261017000000_moved.sql'], fileChanges: [{ path: 'supabase/migrations/20261017000000_moved.sql', status: 'renamed', previous: 'docs/draft.sql' }] }).join(), /sorts at or before/, 'renamed into migrations out of order');
assert.match(ok({ changedFiles: ['supabase/migrations/20261017000001_copy.sql'], fileChanges: [{ path: 'supabase/migrations/20261017000001_copy.sql', status: 'copied', previous: main[0] }] }).join(), /sorts at or before/, 'copied migration out of order');
assert.match(ok({ changedFiles: ['supabase/migrations/copy.sql'], fileChanges: [{ path: 'supabase/migrations/copy.sql', status: 'renamed', previous: 'x.sql' }] }).join(), /not named/, 'renamed-in migration still needs a stamped name');
// An incomplete list of main's migrations cannot tell applied from new.
assert.match(ok({ mainMigrationsComplete: false }).join(), /full list of migrations on main/);
// The production deploy's scripts are CI.
for (const f of ['scripts/supabase-migrate.mjs', 'scripts/supabase-db-url.mjs', 'scripts/schema-pending.mjs', 'scripts/migration-history.mjs', 'scripts/check-migration-history.ts'])
  assert.match(ok({ changedFiles: [f] }).join(), /changes CI or the merge gate/, `${f} needs the integrator's OK`);
assert.deepEqual(ok({ changedFiles: ['supabase/migrations/20261019000000_copy.sql'], fileChanges: [{ path: 'supabase/migrations/20261019000000_copy.sql', status: 'copied', previous: main[0] }] }), [], 'copying an applied migration into a new, later one leaves the applied one as it was');
console.log('Renamed or copied migrations are ordered like new ones; a truncated main list blocks; deploy scripts count as CI.');
