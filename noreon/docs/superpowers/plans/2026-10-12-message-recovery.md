# Message recovery and operator tooling

Finish the software recovery path before provider activation. Keep live dispatch disabled and require explicit operator commands for retry/resume. No unknown attempt is automatically retried or changed to failed.

## Decisions

- Preserve every attempt. Replace the one-attempt-per-job constraint with a partial unique constraint allowing at most one non-failed attempt per job. A service-only retry RPC accepts an exact failed attempt ID and operator label, locks the control row, checks that it is the latest attempt, and requeues only a still-submitted, unexpired job. Maximum three attempts per logical notice; each admission still spends daily quota and rechecks current consent, phone, plan and quiet hours. Retry and resume are separate actions; retries never clear the circuit breaker.
- Record recovery actions in a private append-only audit. The operator label is supplied by the holder of the dedicated service credential; it is attribution, not proof of an authenticated staff identity. Real staff UI/SSO mapping remains an activation decision.
- Reconcile only an already bound provider reference using the provider's GET API. Validate account, returned reference and status before recording facts. A missing resource, unexpected response or error is not proof of rejection. Unknown attempts without a reference remain in the operator queue; no matching by phone, guessing SID, or blind resend.
- Poll accepted nonterminal submissions with bounded batches and persistent backoff. Record poll timing/failure count without storing provider error text, bodies or recipient data. Signed callbacks continue to work independently.
- Provide a local service-credential operator CLI for bounded status, known-reference reconciliation, explicit rejected retry and revision-checked resume. It has no send command, requires an explicit operations flag and refuses demo mode. Print only IDs, states, counts and fixed error categories. Keep all delivery activation flags unset.

## Verification

SQL coverage for append-only privilege boundaries, only-failed retry, stale retry idempotence, three-attempt ceiling, expired/cancelled jobs, preserved histories and quota/consent checks. Provider GET tests verify exact SID/account, errors and fixed output; operator/reconciliation tests ensure unknown messages never call create, batches are bounded and repeated failures back off. Clean replay/types/full relevant suites, then one focused Claude review before merge/deploy.

## Claude review reconciliation

R1/R2 are addressed in a forward migration: operators acknowledge an exact hash of current evidence, without changing delivery/submission facts. Default attention hides only that acknowledged evidence; new facts/reasons return the item, and `status-all` retains visibility. SMS `sent` without a final receipt becomes `no-delivery-receipt` at 48 hours. Stable polling results now back off independently of errors. Database-only commands no longer depend on provider credentials or the callback flag. Tests reproduce stale acknowledgements, changed-evidence reopening, retained history and stable-status backoff.
