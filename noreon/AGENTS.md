<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Design tokens

Every brand value comes from the Noreon design system, vendored byte for byte
under `styles/noreon/`. `app/globals.css` imports those files and maps them onto
the names Tailwind and the shadcn components look for.

## Never hand-edit anything under styles/noreon/

They are copies. Taking an update from the design team is a file replacement,
which only works if the copies are still identical to their source. If a value is
wrong, it is wrong upstream: raise it there rather than patching the copy.

## Never write a hex, an rgb, or a px radius in a component

Use a token. The `:root` block in `globals.css` declares no colour of its own,
only aliases, so `--primary` resolves through `--action-primary-bg` to
`--noreon-navy-700`. A literal in a component is a value that no longer tracks
the brand.

## Two files are transcribed rather than imported, and a check guards them

`radius.css` and `elevation.css` declare names inside Tailwind's `--radius-*` and
`--shadow-*` namespaces. Importing them leaves the variable saying one thing and
the utility doing another. Their values are declared in the `@theme` block in
`globals.css` instead, and `pnpm check:tokens` fails if the two copies drift.

Note the one renaming this forces: the design system's `--radius-sm` is 8px for
inputs and buttons, and that step is `rounded-md` here. The whole ladder shifts
one name. `styles/noreon/README.md` has the table.

## Run pnpm check:tokens after touching colour

It re-runs the colourblind-separation and contrast checks on `--chart-1..5`
against both grounds the app paints, and compares the transcribed values against
the vendored files. Charts are the only place this repo picks colours the design
system does not specify, so they are the only place the checks can regress.

## Copy follows the voice guide, not ordinary product-writing habits

Second person. Sentence case. No exclamation marks, no emoji, and no em dashes,
which is an explicit ban. Never "patient" or "user"; say "you" or "member".
Buttons name what happens, so "See my risk picture" rather than "Submit" or
"Learn more". Never claim a doctor reviews each report: physicians design the
protocols and routinely monitor, and no copy may promise more than that. One
approved exception (Khikar, 17 Oct 2026; wording pending Armen's confirmation):
the member Home and next step may name the one assigned doctor and say they
"review your answers, tests, home readings and reports together". Do not extend
it to individual reports or results.

# The clinical algorithm

The screening logic is specified by the clinical team, not by this repo. Both
source documents are vendored under `docs/clinical/` and carry the document code
`NRN-CLIN-ALG-001`, which `ALGORITHM_VERSION` stamps onto every decision the
product records.

## Never edit anything under docs/clinical/

Same rule as the design tokens, for the same reason: they are copies, and taking
an update is a file replacement. A wrong threshold is wrong upstream.

## Run pnpm check:clinical after touching the questionnaire or the rules

The specification is machine-readable, so conformance is a test rather than a
promise. The check walks it and fails on a missing question, a renamed option, a
moved bound, a changed flag level or a derived threshold at the wrong cut. Branch
conditions are verified by executing both the source's expression and this app's
`showIf` over thousands of generated sessions, and the check fails if it could
not exercise both sides of a branch.

`lib/clinical/seed/spec-map.ts` is the only place the source's codes and this app's
meet. Adding a question means adding a mapping there, and forgetting is a
failing check rather than a silent omission.

## The document is the source, the code is the transcription

| Source | Code |
| --- | --- |
| The branching graph, question by question | `lib/clinical/seed/questions.ts` |
| BMI, waist, pack-years, blood pressure category, activity adequacy, diet score, STOP-BANG, SCORE2 applicability | `lib/clinical/rules/derived.ts` |
| The twelve red flags, `RF-01` to `RF-12` | `lib/clinical/rules/rules.ts` |
| The laboratory catalogue entry each ordered test corresponds to | `catalogueRef` in `lib/clinical/seed/tests.ts` |

When the code and the document disagree, the code is wrong. Read the simulator's
branching tab before changing a `showIf`: the conditions are load-bearing and
several of them are subtler than they look, like the chest-pain clarifiers,
which test the «right now» gate as well as their parent question.

## Never test a threshold in a component

Every cut point that more than one rule or metric uses lives in `THRESHOLD` in
`lib/clinical/rules/thresholds.ts` exactly once (re-exported from `rules.ts`, so
consumers import it from there), and `pnpm check:clinical` pins the bands. A rule
reads as a sentence rather than a comparison. A screen asks the engine
what it thinks and renders the answer.

## Keep the registry ids

`RF-01` to `RF-12` are the clinical team's identifiers. Keep them unchanged in
the rules, internal staff views and provenance tooling so each finding remains
traceable to the row that justifies it. Patient pages use plain-language findings
and guidance without exposing internal registry identifiers.

## Red opens the urgent route. Orange does not.

`firesEmergency` filters on urgency for this reason. An orange flag sets a
consultation window measured in days and the person stays in the product;
freezing the app for it would teach presenters that the emergency screen is
routine, which is the one thing it must never become.

## Three rules govern everything downstream

- Red always wins. One red answer among eight green ones is a red result. Not an
  average, not a sum, not last-write-wins.
- "Right now" is asked first, before frequency, history or medication.
- A missing answer is not a zero. It is stored as `UNKNOWN` and the person is
  sent to measure. Never let an absent value reach a rule as a normal one.

# Database migrations

The schema lives in `supabase/migrations/` and is the only source of truth for
the database. Every change goes through a migration file.

## Never hand-write a migration file

Create it with the CLI so the timestamp is correct:

```bash
pnpm db:new add_measurements     # -> supabase/migrations/<utc-timestamp>_add_measurements.sql
```

Then write the SQL into the file it printed. A hand-named file is how you end up
with a timestamp that sorts wrong or collides with someone else's.

If the change was made through Studio instead of in SQL, capture the drift rather
than retyping it:

```bash
pnpm db:diff add_measurements
```

## Never edit a migration that has been applied anywhere

Applied migrations are recorded by version in `supabase_migrations.schema_migrations`
on each environment. Editing a file that has already run means environments
silently disagree about what the schema is — the recorded version still matches,
so nothing reports an error. To change something that has shipped, write a new
migration. There are no down migrations; the history is forward-only.

The one exception is a migration you created but have not applied anywhere,
including locally. Those are still free to edit or rename.

## Rebasing: renumber before you merge

The timestamp is stamped when the file is created, not when it merges. If you
branched Monday and a teammate's migration landed on `main` Tuesday, your older
timestamp now sorts *before* theirs — so a fresh `pnpm db:reset` applies them in
one order while the shared environment applied them in another.

After rebasing, if your migration's timestamp is older than the newest one on
`main`, rename the file to a fresh UTC timestamp. It has not run anywhere, so
renaming is free.

## Deploys happen on merge, not from your machine

`.github/workflows/supabase-deploy-production.yml` runs on every push to `main`
and applies any migrations production has not applied. Vercel holds the app's
production deployment until that run's `Schema ready on production` check
passes, so the app goes live only after its schema
(`docs/operations/deploy-order.md`). The old app runs briefly against the new
schema, so keep migrations additive first: add in one PR, switch code in the
next, drop later. Staging is deployed on
demand by running `supabase-deploy-staging.yml` from the Actions tab against the
branch you pick. Do not run `pnpm db:push` against a hosted project as part of
normal work — a migration applied by hand is one the
run log cannot account for, and it makes the next CI run's history comparison
lie about where the drift came from.

## Merge only through the merge gate

Branch protection is not available on this GitHub plan, and a merge to `main`
deploys the app and applies migrations to production. Never press merge in the
UI or run `gh pr merge` directly. Use:

```bash
node scripts/merge-pr.mjs <pr-number> --dry-run   # explains what blocks it
node scripts/merge-pr.mjs <pr-number>             # squash-merges the checked head
```

It requires a ready PR targeting `main`, every check green on the exact head
commit, an update from main when main changed the schema or uses objects the
PR's migrations change (`docs/operations/merge-gate.md`), and new migrations that
sort after main's newest, no edits to migrations already on main, and an explicit
`--ci-change-reviewed` from the integrator for changes to CI or the gate. Do not stack PRs
on other PRs; branch from `main`, and rebase onto `main` before marking ready.

## Always verify by replaying from zero

```bash
pnpm db:reset
```

This drops the local database and replays every migration in order. It is the
only check that proves the sequence works from a clean slate rather than from
whatever state your local database happens to have accumulated. Run it before
opening a PR, and after any rebase that moved migrations around.

## Always regenerate types after a schema change

```bash
pnpm db:types
```

`lib/db/types.ts` is generated output — never hand-edit it. It is what makes
`createClient<Database>()` reject queries against columns that do not exist; if
it drifts, TypeScript starts approving broken queries.

## Every new table needs RLS in the same migration

Enable row level security and write its policies in the migration that creates
the table, not a later one. A table with RLS enabled and no policy denies access;
a table with RLS forgotten is readable by anyone holding the anon key. The
failure modes are not symmetric, so the safe one has to be the default.

Do not repeat a policy's `user_id` predicate in application queries — the policy
is the filter, and two copies of one rule drift apart.

# Errors and logs

## Never put member data in error messages or log text; use IDs

Error messages leave the database: Sentry (browser and server) and Axiom receive them.
Throw and log fixed text plus internal ids, for example
``new Error(`Reading save failed for member ${memberId}`)``, never a name, phone number,
reading, lab value, answer or message text. `lib/monitoring/scrub.ts` redacts what it can
recognise, but plain prose cannot be recognised reliably, so this rule is the real
control. Do not rethrow a provider or database error message that may echo input.

# CI minutes and batching

Batch small, related fixes into one coherent PR. Verify each affected behavior
locally before pushing the batch, and avoid pushing individual cosmetic edits or
rerunning unchanged successful checks. Keep urgent fixes and unrelated changes
separate; batching must not delay an urgent fix or conceal its review scope.

The `verify` job always keeps the full web build, clinical regressions, database
replay, SQL, security and concurrency checks. Native Expo checks run after it
only when `scripts/ci-mobile-scope.mjs` identifies mobile/shared/configuration
changes. Unknown paths or unavailable comparisons run native checks as a safe
fallback. Do not bypass required checks or use skip-CI commit markers to save
minutes. A failed required check still blocks release.

Two exceptions keep the queue short. A `verify` job on a commit whose full run
already passed in the last 6 hours reuses that pass and skips its steps. A manual
run on a draft branch can pick `scope: sql` or `scope: ts`
(`gh workflow run verify.yml --ref <branch> -f scope=sql`). It reports as
`verify (sql only)` or `verify (ts only)` and never counts as `verify` for the
merge gate, so the full run before merge is still required.

For web-only changes, do not run the native Expo suite locally. Still test the
affected web journey at relevant viewport sizes when layout, touch interaction
or accessibility changes: native tests and responsive web checks cover different
products. Native checks are needed when a change reaches the mobile app: files
under `apps/patient-mobile/` or `styles/`, any root file the app imports
(directly or through other shared files, for example shared clinical code,
validation or `lib/db/types.ts` after a schema change), CI workflows, and root
dependency or configuration files. Scripts and migrations alone do not need
them; `scripts/ci-mobile-scope.mjs` is the rule. Keep this boundary
conservative when adding new shared imports.
