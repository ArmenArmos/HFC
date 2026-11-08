# Message operations

Delivery is disabled. Do not enable it until the real sender/account, templates, operational ownership, retention, cost controls and pilot authorization are settled. These commands are an engineering recovery tool, not a staff care-workspace feature.

Load credentials through the deployment team's secret mechanism, never command-line arguments or committed files. The tool requires the dedicated `NOREON_MESSAGING_SERVICE_ROLE_KEY`, real `NEXT_PUBLIC_SUPABASE_URL`, and explicit `NOREON_MESSAGE_OPERATIONS_ENABLED=true`. Only `reconcile` additionally requires validated Twilio/runtime settings; database-only operations remain available with callbacks disabled. It refuses `NEXT_PUBLIC_PATIENT_DEMO=true`. Neither delivery flag is needed; the tool has no provider-create/send command. Commands below are examples only.

```sh
pnpm messages:ops status
pnpm messages:ops status '<nextCursor.startedAt>' '<nextCursor.attemptId>'
pnpm messages:ops reconcile
pnpm messages:ops retry '<failed-attempt-uuid>' 'operator@example.org'
pnpm messages:ops resume '<expected-control-revision>' configuration-checked 'operator@example.org'
# Optional fifth argument changes the daily attempt limit, not today's usage:
pnpm messages:ops resume '<expected-control-revision>' operator-reset 'operator@example.org' 200
```

`status` returns the control revision and a page of at most 50 attention items. Follow `nextCursor` until null. Reasons distinguish pending/unknown/rejected submissions, failed delivery, contradictory delivery facts, poll failures and overdue nonterminal deliveries. It never returns phone numbers, bodies or clinical content. Attempt IDs are still private operational identifiers; keep outputs in the operations access boundary.

`reconcile` performs at most 25 known-reference GET requests within a 45-second worker budget. It validates the bound SID/account, records recognized delivery facts, and persists poll backoff (5 minutes after a changed status, 10 minutes after the first unchanged result or first failure, exponential to 6 hours). It never creates a message. Terminal delivery or age over 48 hours stops routine polling; unresolved older submissions remain in the attention queue. Provider 404, transport errors and unexpected responses do not mean rejection or permission to resend. Re-run the command periodically through the eventual approved operator scheduler; no cron has been installed yet.

`retry` accepts only a definitively rejected submission, never unknown, submitting, accepted, or accepted-but-undelivered. It requeues the same logical notice once per failed attempt, preserves history, and caps the job at three attempts total. Expired/cancelled notices cannot retry. The next dispatcher admission rechecks consent, verified phone, plan currentness, quiet hours and global quota. This command does not send and does not clear a pause.

`resume` must follow investigation of the pause. Obtain the current revision from `status`; a false result means state changed, so inspect again. Fix sender/account issues before `configuration-checked`. For `unknown-reviewed`, inspect the unknown queue and provider-side evidence; no-reference unknowns stay unknown and are never retried. Resuming may permit other notices, not resend those uncertain notices. All callers must supply an operator label. This label is declared attribution from the holder of the privileged credential, not independently verified staff identity. Restrict credential distribution and retain the surrounding access audit; integrating named staff authentication remains a deployment decision.

Callbacks can race reconciliation and repeated facts are idempotent. Delivery failure remains a delivery fact and cannot convert an accepted submission into retryable rejection. Contradictory delivered/failed facts remain visible for investigation. A delivery or read receipt is not evidence of taking medicine.

Provider GET contract checked against https://www.twilio.com/docs/messaging/api/message-resource on 12 October 2026. No actual provider request was made during implementation.

## Reviewed items and receipt gaps

Use `pnpm messages:ops acknowledge '<attempt-uuid>' '<evidence-from-status>' 'operator@example.org'` after investigating an item. This records review of those exact facts; it does not assert delivery, permit unknown retries or clear the circuit breaker. A stale evidence value returns false. New outcome facts or a changed attention reason bring it back into the default queue. `pnpm messages:ops status-all` (with the same optional cursor pair) includes acknowledged current items; audit history remains in the private recovery events table.

SMS with a recorded `sent` event but no final receipt after 48 hours is labelled `no-delivery-receipt`, not a proved failure. Unchanged polling statuses back off exponentially to one hour; a newly observed status resets the interval to five minutes. Provider errors retain their separate failure backoff.



## Source enqueue backoff

Before each plan enqueue, the producer commits a service-only admission token. A failed, timed-out or interrupted enqueue leaves a five-minute cooldown, doubling on each admitted retry to one hour. Candidate discovery skips cooling sources, so an old failing source cannot monopolize every run. Successful enqueue clears only its own token; a stale completion cannot clear a newer attempt. The existing outbox uniqueness and send-time eligibility checks still apply. A temporary ineligible enqueue also retains cooldown. Scheduling rows contain only plan ID/token/counter/next-attempt time, remain tied to the source plan, and cascade when that plan is deleted; this is separate from provider audit retention. No automatic resend is introduced.

## Estimated spending reservations

New sending also requires an active, unexpired database spending policy. The migration creates it disabled, without a currency, tariff or budget. Do not enable delivery merely because a provider account exists. Validate destination-route pricing, taxes/fees and provider account safeguards first. Twilio's obsolete `maxPrice` option does not enforce a cap.

The policy uses integer **micro-units of the configured currency** (1 currency unit = 1,000,000 micro-units). Each SMS reserves the configured maximum segment allowance times the conservative per-segment ceiling. WhatsApp reserves its configured per-message ceiling. Both EN/HY SMS bodies are validated before any attempt starts, using conservative GSM/Unicode segment capacities; oversized copy or links halt instead of truncating. Prefixes are explicit destination-prefix permissions, not automatically inferred country permissions. Use ceilings that cover every route allowed by each prefix.

These totals are estimated reservations, **not the provider's invoice and not a guaranteed final billing cap**. Failed and unknown attempts retain their reservation. Retrying a definitively rejected message reserves again. No automatic refund is inferred from provider status. Currency cannot be changed after the first reservation; a currency migration requires a separate reviewed design. Budget reductions preserve previous reservations. Daily buckets use UTC. Callback and incident/recovery operations remain available with spending disabled.

Read status through the existing gated operator CLI:

```sh
node --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/message-ops.ts spend-status
```

`spend-configure EXPECTED_REVISION OPERATOR_LABEL /absolute/path/policy.json` applies a revision-checked policy and records the operator label. The file is limited to 16 KiB. To disable without rewriting historical configuration, its exact content is `{"enabled":false}`. Enabling requires all fields below, with actual approved values supplied by the operator; no sample live prices are provided:

- `enabled`: true
- `currency`: uppercase three-letter billing currency
- `daily_limit_micros`: positive integer daily reservation allowance
- `sms_segment_ceiling_micros`: positive conservative per-segment ceiling
- `whatsapp_message_ceiling_micros`: positive conservative per-message ceiling
- `max_sms_segments`: integer 1–10
- `allowed_prefixes`: unique E.164 destination prefixes, such as a reviewed country or narrower route prefix
- `valid_until`: future ISO timestamp with timezone; renew after checking current tariffs

The existing explicit operations flag and dedicated real-project credentials are required. Configuration is independent of delivery activation and does not send anything. A stale revision returns `configured:false`; re-read status before deciding on another change. Errors remain sanitized and never print recipient details. A policy/route/segment rejection must be investigated, not bypassed by calling an old RPC: stale begin signatures intentionally have no service-role execution grant.

A queued message to a destination outside the configured prefixes is cancelled with `destination-blocked` and the policy revision recorded. Its tentative attempt and count changes are rolled back, no monetary reservation is made, and the worker continues to the next job. Expanding permitted prefixes later does not automatically resend cancelled messages.
