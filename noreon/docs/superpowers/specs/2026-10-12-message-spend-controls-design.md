# Messaging segment and spending reservations

## Scope and authority

Continue the unfinished monetary/segment safeguards in the roadmap under the overnight delegation. Delivery stays disabled. No provider account, real price, billing currency, sender, destination permission or live sending is invented. Build the enforcement path and test with fictional inputs. Operator configuration and business-account setup remain activation prerequisites.

## Verified constraints

Current SQL dispatch controls serialize all starts, enforce a daily attempt count and pause on uncertain or rejected provider outcomes. The begin call rechecks consent, verified phone, plan, quiet hours and expiry before creating a durable attempt; keep that lock order and behavior. Existing recovery requeues only definitively rejected jobs, and unknown attempts need reconciliation.

Twilio's `maxPrice` parameter is obsolete and has no effect since 2024-06-03. SMS is billed per segment; Armenian content uses Unicode encoding. Therefore provider request options cannot stand in for an application budget. Sources checked 12 October 2026:

- https://www.twilio.com/docs/messaging/api/message-resource
- https://www.twilio.com/docs/api/errors/21627

## Proposed implementation

1. Bound the actual SMS body generated from fixed EN/HY copy plus the configured HTTPS app URL. Count GSM-7 septets including escape-table characters and Unicode UTF-16 units conservatively. Set an explicit maximum segment allowance; do not truncate clinical/service text silently. Keep WhatsApp content SID validation separate from SMS segmentation.
2. Store one explicit billing currency and integer micro-unit daily reservation budget in a protected database configuration. Configure conservative per-channel unit ceilings, permitted destination prefixes/routes, segment maximum and rate-valid-until time. Default configuration is inactive, with no positive budget or assumed rate. Missing, expired or malformed policy refuses new outbound attempts.
3. Reserve a conservative maximum cost atomically with the authoritative begin submission transaction, using the existing dispatch control lock first. Keep a per-attempt immutable reservation in addition to the daily total. Never reserve twice for an old job or release uncertain spend automatically. New attempts after definitive rejection reserve again; actual provider billing may still charge failures, so refunds are not inferred from delivery status.
4. Retire the unrestricted begin RPC from service-role access. A versioned budget-aware entry point validates the worker's policy revision and template/segment assumptions before it can commit an attempt. Only the guarded dispatch path reaches the transport. Old workers fail closed during rollout. Callback and recovery reads remain usable when new sends are disabled.
5. Operator tooling reports configured currency, reserved amount, remaining allowance, rate expiry and revision. Policy changes require revision checks and audit attribution. Changing currency while retaining existing monetary totals must not reinterpret those totals; preserve day/currency history and reject unsafe changes. No hard-coded live rates. All policy activation remains an explicit later operational action.

## Important limits

A reservation ceiling based on configured estimates is not a guaranteed cap on the provider's final invoice, taxes or other traffic. Activation requires confirmed route pricing, conservative ceilings, provider account-level safeguards, approved templates and business ownership. Report that distinction plainly. Unknown or expired configuration halts rather than assuming free messaging. Keep provider fees and billing reconciliation as separate facts from delivery success.

## Verification requirements

Forward-only migration generated with the CLI; clean isolated replay and generated types. Test concurrent workers at the final budget slot, retries and duplicate begin, policy revision/expiry, currency transitions, old RPC denial, failed/unknown reservation retention and recovery. Test EN/HY segmentation boundaries, GSM extended characters, surrogate pairs, long configured URLs and transport rejection before network I/O. Re-run existing messaging consent/dispatch/callback/recovery suites. Focused Claude review before merge/deploy. Do not enable any live producer or sender.

## Final implementation choices

The worker reads one policy revision and preflights both fixed locale bodies before creating the transport. The budgeted begin RPC requires that revision and validates the actual destination against configured E.164 prefixes. Currency is immutable after the first reservation, across all days; changing it requires a separate reviewed migration. The former begin signature remains private (its execution grant is revoked), preserving its existing eligibility and count guards inside the new transaction. See the implementation plan and operator guide for exact interfaces.

### Segment research

Twilio's official glossary (https://www.twilio.com/docs/glossary/what-sms-character-limit, checked 12 October 2026) gives GSM-7 160 single / 153 multipart septets and Unicode 70 single / 67 multipart units. Toll-free US/Canada multipart capacity is lower, 152 / 66. Use the lower multipart capacities for conservative preflight unless supported sender/route classification proves the ordinary limit. Count extension escapes and surrogate-pair boundaries so naive string length or division cannot undercount. No Smart Encoding assumption; actual fixed content remains unchanged.

### Interface direction to pin in the implementation plan

Prefer reserving the configured maximum segment allowance for each SMS, rather than trusting a client-provided count as the database financial authority. Validate both generated EN/HY bodies against that allowance before creating any attempt. Read one policy revision, pass it to a new guarded begin RPC, and reject a revision race. The SQL wrapper keeps the dispatch lock first and uses the existing eligibility routine inside the same transaction; over-budget/unsupported-route failures roll the attempt back. Revoke the old begin signature so stale application deployments cannot bypass monetary admission. Keep every attempt's conservative reservation even after rejection or uncertainty; do not implement refunds in this batch. These are estimated spending reservations, not actual billing claims.

A queued message to a destination outside the configured prefixes is cancelled with `destination-blocked` and the policy revision recorded. Its tentative attempt and count changes are rolled back, no monetary reservation is made, and the worker continues to the next job. Expanding permitted prefixes later does not automatically resend cancelled messages.
