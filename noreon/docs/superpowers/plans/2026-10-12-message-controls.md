# Durable dispatch controls

Close the provider failure and submission-volume gaps before activation. Routine engineering limits are delegated overnight; the initial limit is **200 submission attempts per UTC day**, separate from the AI quota. This bounds attempts, not currency cost or SMS segments. Operators can revise it through a service-only, audited command.

One singleton control row serializes admission across workers. Wrap the existing begin RPC; revoke service access to the inner function so it cannot bypass controls. Under the lock, reject paused/exhausted admission and allow at most one unresolved submitting attempt globally. Already-submitted job calls remain idempotent no-ops. Count only a successfully created attempt. Consent/source/quiet checks remain in the original transactional authority.

Wrap finish and stale sweep under the same control-first lock order. A newly recorded failed or unknown outcome pauses subsequent dispatch durably; stale submitting attempts also pause. Acceptance/reconciliation does not silently resume a paused service. An operator resume requires the expected control revision, a fixed acknowledgement reason, and an optional revised daily limit; record the operation in a service-only append-only control log. Never reset today's count during resume. No person/clinical text in that log.

This makes a crash before outcome storage safe: the outstanding attempt blocks other submissions until the sweep marks it unknown and pauses. No network call happens under a database lock. Shared callbacks can still resolve delivery facts while dispatch is paused.

Worker returns a typed paused/daily-limit/busy reason rather than treating admission rejection as a generic storage error. No activation flags or live requests are made. Controlled re-attempt of definitively rejected jobs and provider reconciliation remain the next pieces, and the recovery-ready gate remains unset.

Tests must cover concurrent final-slot admission, persistent failure pause, one in-flight submission, idempotent repeats, revision-checked resume, unchanged daily count and private function/grant boundaries. Replay, generate types, test and Claude review before release.
