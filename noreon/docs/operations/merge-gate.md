# Merge gate

`node scripts/merge-pr.mjs <pr> [--dry-run]` is the only way to merge to `main`
(no branch protection on this plan). Logic: `scripts/merge-gate-lib.mjs`, tests:
`scripts/check-merge-gate.ts`.

It blocks a PR that is closed or a draft, has any check not green on the exact
head commit, brings a migration (added, or renamed or copied in) that sorts at
or before main's newest, cannot read the full list of migrations on main (git
tree, truncation reported), edits,
renames or removes a migration already on main (production records migrations
by version and would skip the change; write a new migration instead), changes
CI or what it runs (see below) without `--ci-change-reviewed`, lists more files
than GitHub returns (over 3000), or is behind main in one of these ways:

| Main's new commits | The PR | Result |
| --- | --- | --- |
| more than GitHub's compare lists (300 files or 250 commits) | anything | block: the gate cannot see main's changes |
| touch `supabase/migrations/**` or `lib/db/types.ts` | anything | block: update from main, CI again |
| app code only | changes the schema, and a file main changed mentions an object its migrations touch | block, naming the files and objects |
| app code only | changes the schema, nothing on main mentions its objects | merge, with a warning |
| app code only | app code only | merge, with a warning |

"Objects" are the tables, views, functions, procedures, types, domains and
sequences that the PR's migrations create, alter, drop, comment on, grant or
revoke on, put a policy, trigger or unique index on, or insert into, update or
delete from (every name in a comma list counts).
A file "mentions" one when the name appears as a whole word anywhere in the
file's current text on main.

## Applied migrations outside the gate

The gate reads a PR's file list. Two more checks read git itself, so an applied
migration changed some other way (the GitHub merge button, a direct push) is
still caught (`scripts/migration-history.mjs`, tests in
`scripts/check-migration-history.ts`):

- Verify, on every PR: no migration that exists on main is modified, renamed,
  removed or retyped by the merge commit, and every incoming migration is a
  regular, stamped file that sorts after main's newest (`--range HEAD^1 HEAD`).
  A manual run on main checks the full history; on another branch, the range
  from its merge base with main.
- The production deploy, before `db push`: on main's first-parent history every
  migration was added after all earlier ones, and still exists as the same
  regular file with the content it was added with (`--history HEAD`). If not,
  nothing is applied. Restore the file (a revert passes again) and write a new
  migration for the intended change.

Git output is read NUL-delimited, so a quoted or unusual path cannot hide a file.

The gate fails closed: if it cannot read the PR's migrations, cannot find any
object in them, or cannot read a file changed on main, it blocks.

## Residual risk of merging a schema PR without re-running CI

When the gate lets a schema PR merge behind app-only changes, the merged
result is checked only by Vercel's build (which type-checks the app). What
it can miss:

- Code on main that reaches a changed object without naming it: a name built
  from a string at run time, a generic helper that takes the table name as an
  argument from another file, or a database function or view that main's code
  calls and that in turn uses the changed object.
- A column-level change visible only through another table name (for example
  a view the PR does not touch reading a column the PR drops).
- Tests added on main that would fail against the new schema. They run on the
  next PR's CI, not before this merge.

These affect app behaviour after deploy, not migration safety: main's app-only
changes cannot change what the PR's migrations do in production. If an object
is reached indirectly, update the PR from main by hand before merging.

## App and schema deploy separately

A merge to `main` starts two independent deploys: Vercel builds and promotes the
app, and `supabase-deploy-production.yml` applies the migrations. Nothing orders
them, so for a few minutes after a schema merge one of these is true:

- **New app, old schema** (the usual case: the Vercel build often finishes
  first). Code that reads a new column, table or function fails until the
  migration job ends. PostgREST answers `PGRST202`/`PGRST204`/`42703`.
- **Old app, new schema.** Code that still uses a dropped or renamed object fails
  until the new app is live.
- **Failed migration job.** The new app stays live against the old schema with
  no automatic rollback. Re-run the job from the Actions tab after fixing the
  cause, or roll the Vercel deployment back to the previous one.

Rules that keep the window harmless:

1. Migrations are additive first: add the column, table or function in one PR,
   switch the code in that or a later PR, and drop the old object only in a PR
   after the code that used it is live.
2. New code tolerates the object being missing for the window where it can
   (the rate limiter admits on `PGRST202`; dark features stay behind a switch
   whose row the migration creates, so a missing row reads as off).
3. Never rename or change the signature of a function the live app calls in one
   step; add the new one and retire the old one later.
4. After a schema merge, the integrator watches the migration job to the end
   and checks the app on the changed path before calling the merge verified.

Gating the Vercel promotion on the migration job (Vercel "deployment checks"
or a deploy hook fired by the workflow) would close the window; it is not set
up yet.

## Changes to CI or the gate

Counted as a CI change, by new or old path: `.github/**`; the gate and check
runners (`scripts/merge-pr.mjs`, `merge-gate-lib.mjs`, `check-merge-gate.ts`,
`run-checks.mjs`, `ci-mobile-scope.mjs`, `check-ci-mobile-scope.mjs`,
`register-alias.mjs`); the production deploy's scripts (`supabase-migrate.mjs`,
`supabase-db-url.mjs`, `schema-pending.mjs`, `migration-history.mjs`,
`check-migration-history.ts`); root and app `package.json`, `tsconfig*.json`,
`eslint.config.*` and `next.config.*`; and deleting or renaming an existing
`scripts/check-*` file. Dependency bumps therefore need the flag too.

Residual risk: editing an existing check (for example weakening an assertion) is
not flagged, because nearly every PR edits checks; reviewers read those diffs.

A pull request's checks run that pull request's own workflow files, so a PR that
edits CI or this gate could pass by weakening the checks. The integrator reads
those files in the diff and only then merges with
`node scripts/merge-pr.mjs <pr> --ci-change-reviewed`. The flag clears only this
blocker; every other rule still applies.
