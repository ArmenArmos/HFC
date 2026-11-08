# PR #684 delta review

Reviewer: independent Codex Astra, 5 November 2026. No source edits.

Verdict: **approve on source review** for `570f87be..f6baa824`. Required SQL runtime verification remains unavailable; this is not an executed risk-path approval or release approval.

Acceptance: the restamped migration follows main, the removed member-status rewrite restores main's status contract, nurse scope stays restricted to assigned members, and isolated replay plus named SQL checks pass. The first three are supported by source inspection; the final criterion was not executed.

## Finding list

| Severity | Evidence | Fix / disposition | Verification |
| --- | --- | --- | --- |
| Verification gap, no confirmed code defect | No local PostgreSQL server or running Docker daemon. `initdb` explicitly reports that `postgres` is missing. | Run the isolated migration replay and SQL checks below on an available local or CI stack before treating the risk path as verified. | Pending. No SQL assertion was executed in this review. |

## Fresh evidence

- HEAD was `f6baa824fafe1182af8db444044f6a50d02d4a11`; worktree initially clean.
- Compared the prior `20261104173100_nurse_alert_owner.sql` to `20261104173400_nurse_alert_owner.sql`: byte equality after removing exactly the 32-line `care_alert_member_status(uuid)` rewrite. No other migration logic changed in this delta.
- The newest migration on inspected `origin/main` (`9e241b33`) is `20261104173300_zoe_unverified_bp.sql`; the new nurse migration sorts after it and the clinic lockdown migration.
- `care_alert_member_status(uuid)` remains defined by `20261030222034_zoe_urgent_screen_status.sql`, identical to main. No later migration now mentions that function. Its member/request scoping, questionnaire output, and exact Zoe `{alerted,pending}` envelope remain intact. It no longer calls the owner helper introduced by this PR.
- `check-care-alerts.sql` removes only the member-status owner metadata expectation in this delta and retains the current-alert assertion. The urgent-screen status test still exercises exact status objects, pending/settled states, retries, and another member's request.
- All seven other changed `scripts/*.sql` files are byte-identical to inspected main. They are inherited clinic-lockdown and unverified-BP checks, not new PR-specific changes.
- Read the nurse predicate and mutation entry points: both inboxes use `_care_alert_visible`; nurse visibility requires current assignment, coordination access, and valid ownership. Acknowledge, next action, and resolve use `_care_alert_lock`, which rechecks the actor and visibility after locks. Unrelated-member calls return `not_found`. This is source evidence, not a runtime authorization test.
- Read `check-care-alert-nurse.sql`, including unrelated-member reads/mutations, unassigned nurse, stale sequence, escalation, backfill, and lock-order assertions. These assertions were not run.
- `git diff --check 570f87be..f6baa824 -- supabase/migrations 'scripts/*.sql'` reports only pre-existing whitespace imported from main in `scripts/check-zoe-unverified-bp.sql:94`; no important finding.

## Runtime availability commands and results

```sh
command -v psql postgres initdb docker colima
docker context ls
colima list
docker --context default info --format '{{.ServerVersion}}'
docker --context colima-noreon-qa108 info --format '{{.ServerVersion}}'
docker --context colima-noreon-zoehealth info --format '{{.ServerVersion}}'
rg --files /opt/homebrew/Cellar /Applications /private/tmp 2>/dev/null | rg '/(psql|postgres|initdb)$'
/opt/homebrew/Cellar/libpq/18.6_2/bin/initdb -D /private/tmp/noreon-684-review-pg
```

`psql`, `postgres`, and `initdb` were absent from PATH. The file scan found Homebrew libpq client tools, including `psql` and `initdb`, but no server binary. All listed Colima profiles were stopped. All three Docker contexts failed with missing socket paths. The explicit initdb attempt returned: `program "postgres" is needed by initdb but was not found in the same directory`. No database was started or reset. Existing Supabase config uses default shared ports, so it was not pointed at an unverified stack. Starting Colima requires writes outside permitted roots; no escalation or installation was attempted.

The following checks remain unexecuted and must target an isolated stack after its clean migration replay:

```sh
pnpm db:reset
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-care-alert-nurse.sql
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-care-alerts.sql
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-care-alert-escalation.sql
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-care-alert-nurse-inbox.sql
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-zoe-urgent-care-alert.sql
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-zoe-urgent-screen-status.sql
psql "$ISOLATED_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/check-stable-functions-no-locks.sql
```

Inherited evidence: the earlier review at `output/workflow-tools/briefs/nurse-alert-owner.review-brief.review.md` approved source at `570f87be`, reported seven mocked TypeScript/component checks, and explicitly did not run replay, SQL, or signed-in journeys. Those checks were not rerun or represented as fresh evidence here.

No push, merge, deployment, external message, hosted-data access, or source modification occurred. This artifact is the only workspace addition.
