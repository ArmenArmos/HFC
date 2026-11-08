# Background jobs

Every background job follows one contract (`lib/jobs/contract.ts`) and writes one row per run to
the job ledger (`public.job_runs`). Admins see the ledger under **Operations** in the backoffice.

## The jobs

| Job (ledger name) | Route | Schedule | What it does |
| --- | --- | --- | --- |
| `telegram_dispatch` | `/api/internal/telegram/dispatch` | every 5 min | Session cleanup, programme checkpoints, Telegram inbox, reminders, queued sends |
| `zoe_run` | `/api/internal/zoe/run` (maxDuration 300) | every 5 min, and right after a member writes in the app | Zoe passes, one message at a time; sends nothing itself |
| `lab_ai` | `/api/internal/lab-ai` | every 5 min | Reads queued clinic lab PDFs (dark) |
| `report_cleanup` | `/api/internal/report-cleanup` | hourly at :17 | Removes deleted report files (its own detail stays in `cleanup_runs`) |
| `message_dispatch` | `/api/internal/message-dispatch` | none (SMS and email are off) | Legacy SMS/email outbox |

The Telegram webhook still runs Zoe inside its after-response sweep, so a Telegram member's reply
follows their message at once; it answers at most two messages per update (the function has 60 s),
and the zoe/run cron takes any others. The scheduled Telegram sweep does not run Zoe: Zoe has its own cron,
so a slow model call never eats the dispatch budget. A reply that the cron's Zoe pass queues for
Telegram goes out with the next Telegram dispatch (at most five minutes); zoe/run has no send loop,
because a send loop there would have no deadline of its own.

`telegram_dispatch` is `ok` when every item was processed and its outcome recorded. That includes a
send Telegram refused: the dispatcher records the provider's verdict per message, and those show on
the backoffice Delivery problems page, not in the job ledger.

The demo-only `monitoring-follow-up` cron is retired (it returned 404 in production every five
minutes).

## The contract

1. Vercel Cron, or the app's own trigger (`lib/zoe/sweep-trigger.ts`), calls `GET` with
   `Authorization: Bearer $CRON_SECRET`. Anything else, or a job whose switch is off, gets a 404.
2. `job_run_start` records the run (job, `cron` or `request`, started, deadline = start + the
   route's `maxDuration`) before any work.
3. The work gets a deadline 10 seconds before `maxDuration` and should stop claiming new items when
   too little time is left (`zoe_run` claims one message at a time and only with 150 seconds left, about one worst-case run).
4. `job_run_finish` records the outcome once: `ok`, `skipped` (switched off or unconfigured),
   `partial` (some items failed), or `error`; a fixed error code (never message text); the duration;
   and the report's numbers and short state words (`lib/jobs/summary.ts` drops anything else).
5. If the ledger cannot be written, the job still runs and the log says `job_ledger`. A ledger
   outage never blocks or changes a job.

The claim, lease and attempt rules of each queue stay in its own SQL (`zoe_run_claim`,
`lab_ai_jobs`, `conversation_attempts`, `patient_message_outbox`).

## Reading the ledger

- **Lost**: a run with no recorded finish after its deadline. The function was killed (time limit,
  crash, deploy) or the finish write failed. Items it had claimed are retried by their own queue
  rules.
- **No run recently**: a scheduled job whose last start is more than two intervals old. The cron may
  have stopped (Vercel project settings, a failed deploy, `CRON_SECRET` changed).
- Rows older than 30 days are removed when the same job starts again.

## Adding a job

Write the route with `jobRoute({name, maxDurationSec: maxDuration}, async ({remainingMs}) => ...)`,
add it to `vercel.json` if it is scheduled, add it to `JOB_SCHEDULE` in `lib/jobs/admin-view.ts`, and
to the table above. `scripts/check-job-contract.ts` fails if a scheduled route does not use
`jobRoute`.
