# Native journey API

`/api/native/journey` is the server prerequisite for native profile, consent and questionnaire screens. It is disabled by default. It does not enable phone sign-in, register accounts, upload reports or send messages.

Enable only on the real app deployment with all three settings:

- `NOREON_NATIVE_JOURNEY_ENABLED=true`
- `NOREON_DEPLOYMENT_TARGET=app`
- `NEXT_PUBLIC_PATIENT_DEMO=false`

Before activation, verify hosted Auth configuration/abuse controls and complete signed-in device and clinical/consent acceptance. No hosted activation is part of this change. The existing Supabase URL, public key and service role remain server configuration; never ship the service role to mobile.

Every request uses `Authorization: Bearer <member access token>`. The server verifies the token and confirmed phone; cookies and demo sessions are ignored. If an Origin header is sent, it must match this API origin. CORS is not enabled. Responses use `Cache-Control: no-store`; logs must not include tokens or health data.

GET returns `{state, consentVersion}`, with the same `PatientState` shape used by the web service. State includes profile, consent acceptance and assessment revision/answers/completion/urgent-rule fields. An urgent rule must take precedence in the client journey.

POST takes JSON, at most16KiB, with exactly the listed fields:

```json
{"type":"profile","profile":{"name":"Fictional member","birthDate":"1974-05-18","biologicalSex":"male","locale":"en"},"consent":true,"consentVersion":"patient-pilot-v1","expectedRevision":-1}
```

Use the consent version returned by GET after showing the corresponding approved consent content. Revision-1 is only for initial creation with no assessment; existing state must use its current revision. Profile fields and clinical answers are validated by the existing shared service.

```json
{"type":"answers","expectedRevision":0,"entries":[{"fieldId":"q3.status","value":"never"}]}
```

One to ten entries, each exactly fieldId/value. Null clears a value; shared rules prune inactive branches and compute completion/emergency state. Demographics are changed through profile, never q1 answer injection.

```json
{"type":"complete","expectedRevision":1}
```

Incomplete or urgent assessments cannot be completed. Successful writes return `{ok:true,revision}`; validated rejections return `{ok:false,reason}`. Boundary failures return `{error}`. Statuses:200 success,400 invalid,401 unverified identity/origin,409 revision conflict,503 disabled/unavailable. Never show raw provider errors.

The server has one20s deadline including authentication/body/storage. A timeout, abort or connection loss is **an uncertain write**, because a database operation may already have committed. Re-read authoritative state; show conflicts and ask the member to review before a new save. Do not automatically resend or report that no data was saved. Local draft ownership/session retirement rules still apply on mobile. This endpoint does not provide an offline write queue or exactly-once submission receipt.

Native UI integration and real-device acceptance remain separate roadmap work. Existing web callers retain their current contract; the new native path always requires an explicit profile revision.


## Mandatory client transition after every save

A successful POST returns a revision, not the resulting urgent rule. After **every successful profile, answers or complete command**, the client must GET authoritative state before advancing or displaying completion. If that read fails or returns an older revision than the save, keep the current screen blocked with a retry-read action; do not resend the write. If an urgent rule is present, show the urgent route before another questionnaire step or summary. The mobile implementation must test this transition, including failed reads and a new urgent answer. This is a correctness requirement, not an optional refresh for display.

## Request admission

After remote bearer verification, native journey requests share an atomic per-member allowance of 120 requests per fixed UTC minute and 5,000 per UTC day. These are provisional engineering defaults for activation. Admission occurs before reading the request body or patient state. Denial returns 429 with Retry-After and no-store; unavailable or malformed admission fails closed. Fixed windows permit bursts across a boundary. Cancellation can consume an admission slot but cannot continue into a patient operation. Existing AI, report-upload, demo and staff budgets are unchanged.

This does not throttle signed-out Auth requests or replace hosted Auth/firewall abuse controls. Native activation remains disabled.
