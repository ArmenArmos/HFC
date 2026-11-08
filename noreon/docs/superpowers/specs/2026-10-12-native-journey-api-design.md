# Native journey API design

The user delegated overnight routine design/implementation decisions and asked for patient web/iOS/Android delivery with Claude review of important batches. This architectural prerequisite supports the full native profile, consent and questionnaire flow; screens and device acceptance remain subsequent work, not completed by this API.

## Chosen approach

Expose GET/POST /api/native/journey using verified Supabase bearer identity and the existing patient service. Extract the database store so web keeps cookie-scoped reads and native uses fixed-bearer RLS reads. Trusted writes remain server-only service-role RPCs. Do not expose those RPCs to authenticated/anon roles or duplicate clinical rules in SQL/mobile. A separate server implementation would drift; undocumented Next server-action calls are not a stable mobile contract.

## Contract

Disabled unless NOREON_NATIVE_JOURNEY_ENABLED=true, NOREON_DEPLOYMENT_TARGET=app, and NEXT_PUBLIC_PATIENT_DEMO=false. No cookies, demo identities or caller-supplied user ids. Verify token via getUser(token); require confirmed phone. Return generic no-store JSON. No CORS grants. If Origin exists it must equal the request origin.

GET returns {state, consentVersion}. POST accepts exactly one command: profile {profile, consent:true, consentVersion, expectedRevision}; answers {expectedRevision, entries}; complete {expectedRevision}. Reject unknown keys, forged identity/urgent/completion metadata and invalid shapes. Profile revision is -1 for initial creation, >=0 otherwise. Answers/complete require >=0. Consent version must match server. Shared service computes urgent rules, completeness, pruning and profile seed; database compares revisions atomically.

Add an optional expectedRevision argument to existing saveProfile; omitted preserves web behavior, provided enforces stale edit rejection before writing. Native always supplies it. A timeout/connection loss is an uncertain write: clients reload and compare revision before deciding to retry, never silently overwrite or auto-resend.

## Resource and failure boundaries

JSON max16KiB counted from actual stream bytes. One20s server deadline covers auth, body and database; cancellation prevents downstream calls after the signal aborts. Reject a stalled body promptly even if its stream cancellation stalls. Database work already accepted may commit; no exactly-once claim. No health data/tokens/provider details in logs. Future per-member distributed throttling is required before enabling this new endpoint; keep default disabled and record this activation gate.

## Verification

Tests exercise actual shared service via fake store and installed Supabase SDK via mocked transport: disabled/demo/cookie-only/unconfirmed rejected; verified owner only; forged fields/version/revisions rejected; invalid answers and emergency/completion guards; oversize/stalled body; stale profile/concurrent RPC conflict; bounded auth; RLS read client and privileged writer separation. Run existing service, full TS/SQL/clinical checks, types/lint/build, Claude important-only review, CI and exact-head release. No schema/clinical/token changes.


## Review clarification: urgent routing

Claude approved disabled merge and identified a required client transition: successful POST only returns revision, so native must GET state after every save and route urgent rules before advancing. Failed/stale re-read blocks progression and retries only the read. The subsequent native-screen batch must cover this with rendered tests. API docs now make this mandatory. No claim of completed mobile clinical flow is made by this server prerequisite.
