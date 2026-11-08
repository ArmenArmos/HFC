# Deploy order: schema first, then the app

A merge to `main` starts two deploys: Vercel builds the app, and
`.github/workflows/supabase-deploy-production.yml` applies migrations to the
production database. Vercel holds every production deployment until that
workflow's check **`deploy / Schema ready on production`** passes on the same
commit. Only then are the production domains moved to the new deployment.

So:

- New code never serves members against a schema it does not have yet.
- A migration that fails keeps the previous app live (with the previous
  schema). Nothing reaches members until a fix is merged or the run is retried.
- Old code does run against the new schema for the minutes between `db push`
  and the domain switch. Migrations must stay **additive first**: add columns,
  tables and functions in one PR; switch code to them in the next; drop the old
  ones later. Never rename or drop something the live app still reads in the
  same PR that stops reading it.

## How the check decides

The workflow runs on every push to `main` (not only schema changes):

1. `pending` reads `supabase_migrations.schema_migrations` on production and
   lists this commit's migrations that are not there
   (`scripts/schema-pending.mjs`).
2. If any are pending: `replay` (every migration from zero on a throwaway
   database, plus the generated types check) and then `deploy` (`db push`).
   Otherwise both are skipped.
3. `Schema ready on production` runs whatever happened above and passes only if
   the database now has every migration of this commit. It reads the database,
   not the diff: a migration an earlier run failed to apply counts as pending on
   every later commit, which stay held too.

Runs share one concurrency group and never cancel a running deploy. GitHub
keeps one waiting run and cancels an older waiting one; that older commit's app
deployment then stays held, and the newer commit (which contains it) is the one
released. A commit with nothing to apply costs two short GitHub-hosted jobs.

## Setup on Vercel (once, after the workflow change is on `main`)

Add the check only after one run on `main` has produced it, otherwise Vercel
waits for a check that never appears. Both projects build from this repo:
`noreon-app` (app and backoffice) and `noreon-core` (public site).

```bash
cat > /tmp/schema-check.json <<'JSON'
{
  "name": "Production schema ready",
  "requires": "none",
  "blocks": "deployment-alias",
  "targets": ["production"],
  "timeout": 3600,
  "source": { "kind": "git-provider", "provider": "github", "externalCheckName": "deploy / Schema ready on production" }
}
JSON
vercel project checks add noreon-app --file /tmp/schema-check.json --scope noreon
vercel project checks add noreon-core --file /tmp/schema-check.json --scope noreon
vercel project checks noreon-app --scope noreon --blocks deployment-alias
```

`timeout` is in seconds: a deployment whose check has not passed within an hour
(a long replay queued behind another) is not aliased; release it by re-running
the newest `main` run, or with Force Promote once the check is green.

Production auto-aliasing must stay on (Vercel project settings, Environments,
Production); with checks it moves the domains when the check passes.

## When the check fails

- **Migration failed.** Read the `deploy` job log. Fix forward with a new
  migration in a new PR (never edit the failed one if any part of it applied).
  The merge of the fix releases the app with it.
- **Transient failure** (network, pooler, GitHub outage). Re-run the failed jobs
  of the latest `main` run, or run the workflow from the Actions tab on `main`.
  Re-run the newest commit's run, not an older one: the newest deployment is
  the one to release.
- **Emergency app release with the schema unchanged** (for example a rollback
  of app code only): Vercel's **Force Promote** on the deployment page bypasses
  the check. Record why in the integrator's log.
- **GitHub-hosted runners unavailable** (for example the Actions spending limit
  reached): no run starts, so every production deployment stays held. Raise the
  limit, or use Force Promote for an app-only commit after checking with
  `node scripts/schema-pending.mjs` (with the deploy env set) that nothing is
  pending.

## Removing the gate

`vercel project checks noreon-app --scope noreon`, then
`vercel project checks remove <check_id> noreon-app --scope noreon` (and the same
for `noreon-core`). Vercel then aliases each production build as soon as it is
ready, as before.
