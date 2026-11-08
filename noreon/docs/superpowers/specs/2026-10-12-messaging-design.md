# Verified messaging for the member journey

## Intent and authority

Khikar requested WhatsApp after critical fixes, SMS alongside it, and overnight implementation without routine approval waits. Build actual delivery infrastructure shared by web and future Android/iOS clients. External business/sender accounts remain a prerequisite for activation. No live messages are authorized by this implementation task.

## Architecture and provisional choices

Use existing Supabase Postgres for consent, durable jobs and audit, with Next server endpoints and a bounded scheduled dispatcher. Keeping the outbox beside care events supports transactions and ownership checks without another paid service. An external queue alone would not provide consent or source-event authority. A synchronous send during plan publication would make a provider failure affect clinical work and duplicate retries, so do not use it.

Provisional: one preferred outbound channel (`none`, `sms`, `whatsapp`), default none; no automatic cross-channel fallback. A later fallback requires separate consent and a definitive failure, never a timeout alone. Twilio is a candidate unified transport; keep the contract provider-independent until the adapter is implemented and verified against official documentation. No provider account or subscription is created by this plan.

## Identity and consent

Only real authenticated members with an existing profile, accepted patient-pilot-v1 consent and a currently verified auth phone may opt in. Resolve user ID and phone in the database; browser input never supplies a destination or another member ID. Normalize an optional leading plus on the auth phone and require E.164 shape. Demo case IDs never enter this namespace: jobs reference real auth users and real care plans, not workspace cases.

Unchanged saves are idempotent. Limit changed opt-ins to30 preference events per hour; opt-out always remains available and repeated opt-out creates no new event. This is an engineering abuse limit under overnight delegated authority.

Preferences have a monotonic revision, selected channel, verified phone snapshot, exact consent version and acceptance time. Consent history is append-only. Any preference revision cancels pending jobs; changing the verified phone makes prior consent unusable. Opt-out must remain possible even if phone verification/profile eligibility changes. Re-enabling does not replay old or cancelled events automatically. Provisional product choice: changing SMS to WhatsApp (or the reverse) also cancels queued jobs rather than moving them; the settings UI must explain this and the plan remains available in-app. A producer receives null for a cancelled event, never a false queued-success signal.

## Source events and duplicate prevention

The first producer is a real published active care plan. Enqueue only after the plan is available, only for the owner with current consent, and never for future, inactive or already acknowledged plans. A unique plan-event identity allows at most one logical job across channel changes and retries. Preserve source plan ID and consent revision. Store only identifiers and a template key, never medicine names, test values or free-text clinical content in outbound payloads. The member follows a fixed authenticated app link.

Later producers add dose/BP reminders, appointments and support events using stable authoritative event identities and source-version checks. They are explicit remaining work, not implied by plan-ready support.

## Dispatch and delivery semantics

Before any provider request, recheck consent revision, verified phone, source publication/currentness, acknowledgement, expiry and quiet hours. Use existing Asia/Yerevan scheduling and saved reminder quiet hours initially; timezone expansion remains a recorded product decision. Concurrent workers claim jobs transactionally. A worker must record a sending attempt before network submission. Ambiguous timeouts/crashes become unknown and require provider reconciliation; do not blindly retry. Provider acceptance, delivery and read status are different facts and never prove adherence. Opt-out cancels unsent jobs but cannot retract a request already submitted.

Provider callbacks require official signature validation against the exact configured public endpoint, deduplication and monotonic state transitions. No inbound message becomes a clinical instruction or authenticated user action. Human support needs assigned ownership and visible unresolved state. Emergencies do not depend on message delivery.

## Staged implementation and remaining work

1. Database foundation: consent/preferences/history, RLS and narrow RPCs; source-bound idempotent plan-ready outbox. No public send API and no provider calls.
2. Member settings and server contracts, clear not-yet-active channel status; currentness/quiet-hour checks, transactional claims and attempt outcomes.
3. Configured provider adapter, signed callbacks, operator reconciliation, test-only end-to-end transport verification and activation checklist tied to the actual account.
4. Reminder and Zoe/support producers, event cancellation/correction integration, mobile contracts and notifications.

Each stage must be tested and reviewed as its own deliverable. Stage1 is not completed WhatsApp/SMS integration. Provider activation, approved templates, sender ownership and live pilot authorization are external requirements.

## Acceptance and review risks

Real SQL tests must show ownership/RLS, no direct writes or broad grants, opt-in eligibility, phone change invalidation, stale revision conflict, opt-out cancellation, source ownership/currentness, unique event enqueue and no synthetic recipients. Subsequent stages must cover concurrent workers, revoke-versus-send races, quiet hours, unknown send outcomes and forged/replayed callbacks. Replay migrations from zero, regenerate types, run existing regression suites, review with Claude and verify deployed schema/app versions.

## Review decisions and activation gates

Claude stage1 review confirmed source/RLS/lock boundaries. Do not describe phone fingerprints as anonymous; they are readable only by owner/service. Staging must verify definer privileges for auth.users row locks before activation. A future sent-attempt ledger needs explicit retention/anonymization policy before enabling delivery; current cascade deletion is not an approved policy for sent-message audit. Future-dated plans need a scheduled producer when published. Provider webhook validation must use the configured full HTTPS callback URL and official signature verification: https://www.twilio.com/docs/usage/security.

### Consent scope ruling after batch 7 review

Although its identifier is `messaging-service-v1`, the consent collected by the first settings release covers new care-plan availability notices only. Both languages describe that same narrow scope. Dose/BP reminders, appointment notices, support and other later producers require a new consent version and explicit reconfirmation before they can send. Do not broaden existing consent implicitly. Delivery remains inactive.

### Submission and delivery are separate facts

Batch8 ledger status is strictly the submission outcome. `accepted` means the provider created a message resource and returned its reference, even if that resource already reports a failed delivery status. `failed` means definitive rejection without a created message reference; timeouts, transport failures and ambiguous responses are `unknown`, never assumed failed. A valid returned reference must not be discarded to fit a failed submission state.

The provider stage must add an append-only delivery-event history bound to the attempt and provider reference; accepted submission remains accepted when delivery is failed/undelivered. Derive delivery state with explicit monotonic rules and handle callbacks arriving before the synchronous response using the opaque attempt ID in the signed callback URL. A worker timeout must be well below the two-minute unknown sweep. Fixed public HTTPS callbacks must be verified using the official provider SDK and all form fields; never derive authority from a caller-controlled Host header. References remain potentially linkable personal data. Retention/pruning and activation approval remain gates before sending.

Sources checked: https://www.twilio.com/docs/usage/security and https://www.twilio.com/docs/messaging/api/message-resource (12 October 2026). No account or live provider request was made.

### Provider-stage review decisions

Twilio callbacks must use the member app host; staff-host routing may reject this path. Provider-side queue validity is provisionally five minutes. SDK autoRetry stays false (its maxRetries=0 option internally defaults to3 but is unused when autoRetry is false).

Before dispatcher activation, every definitive rejection must be visible to operations, with a circuit breaker for repeated account/sender/auth failures. Temporary 429 rejection needs controlled recovery after confirming no provider resource exists; the current single-attempt ledger does not offer that recovery yet. Do not call a rejected notice delivered or silently discard it. No automatic retry of unknown attempts is allowed.

Callback storage can fail, and callback retries must not be assumed. Reconcile known references using provider GET; unknown attempts with no reference require an operator queue and must never be blindly resent. A false finish result requires reading authoritative state: an early callback may already have resolved it, but a missing attempt or conflicting reference is an error, not automatic success. Reconciliation and controlled-retry behavior need their own regression evidence before activation.
