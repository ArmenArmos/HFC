# Demo admission controls

Approved demo limits: 20 new cases per source per UTC day, 200 globally per UTC day, and 1,000 active cases. Upload and sample POST attempts: 500 globally per UTC day and 50 per source per UTC hour. Authentication and same-origin checks run before admission. Invalid authenticated attempts count; source-denied attempts do not consume the global budget. The upload budget bounds new original bytes to 500 × 2 MiB daily, not total stored bytes or historical orphan retention.

Staff login: 8 attempts per source/email pair and 40 per source per UTC quarter-hour. Successful login clears the pair only. This removes the application email-only lockout; it does not protect the independently reachable Supabase password endpoint or prevent distributed guessing. Clinic NATs share a source budget.

Source means IPv4 address or IPv6 /64. Only Vercel's trusted x-vercel-forwarded-for header is accepted on Vercel. Comma lists, port suffixes, zone IDs, missing and invalid addresses fail closed. Never fall back to browser-controlled forwarding headers. Non-Vercel development uses one local bucket; production without Vercel fails closed, including local next start. HMAC keys use the existing workspace service-role secret with separate source/email prefixes; only hashes enter the database. Rotating that secret changes source keys but does not reset global counters.

Limits trade bounded resource use for availability: enough distinct sources can exhaust the global demo budget. Existing sessions remain usable when creation is full, and existing data is not removed. AI budgets remain 1,000/day with the existing staff/member split. Counters expire by fixed UTC windows and expired counters for an operation are removed on its next admission request. This is lazy cleanup, not a guaranteed deletion deadline.

## Release order

1. Merge the migration, generated types and SQL tests; wait for successful production migration workflow. Old app callers remain compatible and gain the active-case cap.
2. Test the caller preview on Vercel, then merge callers only after review and green CI. No new secret is required; the shared-workspace build validates the existing signing key.
3. Once callers are confirmed live, revoke the legacy case-creation RPC from service_role in a follow-up migration. The admitted SECURITY DEFINER wrapper can continue to use it internally. After this retirement, an app rollback must retain the admitted caller or explicitly restore the old permission through a reviewed migration.

Before retirement, rollback the caller deployment to the migration-only release if runtime header parsing fails. Do not roll back the database. A rate-limited upload receives 429, no-store and Retry-After; admission infrastructure failure returns 503. Staff sign-in failures remain generic to avoid revealing account existence.
