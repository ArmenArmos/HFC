# CI scope and runner minutes

`Verify application` retains all existing web and database checks on every PR
and main push. The `verify` job also reports whether native mobile checks are
needed in its step summary. The existing `mobile` check name is retained.

Only known web-only areas (`app/`, `components/`, `hooks/`, `public/`, `docs/`,
`tools/`) and root guidance files can skip native checks. Mobile code, all `lib/`
code, design styles, scripts/fixtures, migrations, CI, root configuration and
unrecognized paths run the full existing native suite. A mixed batch runs it.
The gate compares exact PR base/head or push before/after commits, including
multi-commit pushes, deletions and both sides of renames. Failed comparisons,
empty diffs and initial pushes conservatively run native checks.

There is no extra detection job. Mobile waits for successful web/database
verification; this saves a runner allocation for web-only changes and avoids
spending native minutes when web checks already fail. Changes affecting both
products take longer in elapsed time because the jobs now run sequentially.
Web failures still fail `verify`; a scope-based skipped `mobile` job is not
mobile test evidence. Missing scope output defaults to running mobile.

Run the gate regression matrix without installing dependencies:

```sh
node scripts/check-ci-mobile-scope.mjs
```

Before pushing, batch related small fixes and run the affected local checks.
Keep full CI before release; don't rerun a successful unchanged commit. Continue
responsive browser checks for web layout/touch changes. Do not change billing,
branch protections, clinical coverage or database coverage to reduce minutes.

Local validation of this workflow does not establish hosted execution. Confirm a
web-only PR reports mobile skipped and a mobile/shared change runs the native
suite once Actions capacity is available.
