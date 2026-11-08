# Twilio SMS hook implementation acceptance

Scope: Armenia phone registration and existing care-plan SMS notices for members using their own +374 numbers. This implementation is rebased on main a4486d0, targets the member app Node runtime and Supabase Send SMS Hook, and remains disabled. No phone-number allowlist is introduced. Existing CAPTCHA, country and rate policies remain.

Acceptance: authenticated raw hook requests reserve the shared daily USD ceiling before a single provider submission; replay never sends twice; immutable claims bind body digest, provider and SMS channel; OTPs and phone numbers never enter the claim ledger; unknown outcomes keep reservations. API-key SMS notices work without WhatsApp configuration; WhatsApp remains unavailable without its sender/templates.

Set provider `twilio-sms-hook` only when registration, hook readiness, and `NOREON_TWILIO_SMS_READY` have independently passed live acceptance. Required server secrets are `NOREON_SUPABASE_SMS_HOOK_SECRET`, `NOREON_MESSAGING_SERVICE_ROLE_KEY`, `NOREON_TWILIO_ACCOUNT_SID`, `NOREON_TWILIO_API_KEY_SID`, `NOREON_TWILIO_API_KEY_SECRET`, and the approved registered alphanumeric `NOREON_TWILIO_SMS_FROM` for Armenia (E.164 senders remain syntax-supported for independently approved routes). The existing full account AuthToken authentication is supported for compatibility. API keys use SK credentials for HTTP Basic authentication and the separate AC SID in the resource path. The notice SDK and existing authenticated receipt lookup use the same credential selection. Incomplete key pairs fail configuration. Without an account AuthToken, incoming status callbacks fail verification; provider acceptance is never proof of handset delivery.

The hook makes one Twilio Messages API request with a two-second deadline within its 4.5-second total deadline. It rejects redirects and bounds response bodies. Recognized 4xx request rejections are definitive failures; timeouts, uncertain status codes and malformed receipts are unknown. Both retain their reservation and pause dispatch. A finish failure leaves the claim unavailable for resending. The migration preserves old Brevo SMS claims and legacy RPC calls, while validating Twilio SM/MM receipts against the claimed provider. It enables no runtime or spending configuration.

The shared policy reserves at most USD 5/day across OTPs and notices. It is an application reservation ceiling, not an invoice guarantee; rental charges and prices/fees above the configured ceiling are outside that guarantee. Obtain account-specific Armenian tariffs and fee ceilings before configuring the policy. Do not reuse a cheaper Brevo ceiling. No tariff is defaulted here.

Live release remains blocked on hosted sender approval, account-specific tariff and fee acceptance, protected credentials, deployed migration and hook configuration, and direct +374 receipt/registration plus SMS notice acceptance. Keep registration and readiness disabled until those checks pass. Native Supabase Twilio SMS/WhatsApp must not be enabled for this rehearsal: it bypasses this reservation hook. WhatsApp authentication remains a separate future change requiring an approved concrete template.

The API contract was checked against [Twilio Messages](https://www.twilio.com/docs/messaging/api/message-resource), [API keys](https://www.twilio.com/docs/iam/api-keys), and [Armenia sender guidance](https://www.twilio.com/en-us/guidelines/am/sms) on 13 October 2026. Local transport tests use synthetic credentials and mocked requests; no live message was sent.

## Implementation findings

| Finding | Severity | Disposition | Evidence |
| --- | --- | --- | --- |
| Native auth sends bypass shared reservation admission | High | Use only budgeted Send SMS Hook; deployment remains disabled | Signed API regression checks reserve-before-send; live configuration pending |
| Claims previously accepted only numeric Brevo receipts | High | Forward migration adds immutable provider/channel binding and provider-specific receipt checks | New SQL regression went red before migration; passes after isolated full replay |
| Twilio SMS depended on WhatsApp sender/templates | Medium | SMS config independent; unavailable channels are checked before any database reservation/attempt | Actual worker + PostgreSQL admission regression; queue filtering, API and preference checks |
| Restricted API keys could not authenticate existing sends | Medium | SK key pair plus AC account SID supported for hook, SDK and existing lookup | API regression verifies Basic credentials and SDK username/account SID |
| Partial API keys could override valid AuthToken incorrectly | Medium | Configuration rejects incomplete key pairs | Missing-exception regression went red, then passed |
| Callback signatures need account AuthToken | Medium | Fail closed without it; existing authenticated receipt lookup remains available | Callback null result under API-key-only configuration |
| Unavailable WhatsApp could reserve then pause all dispatch | High | Closed: admission capabilities default empty, old private begin revoked, queued jobs preserved, filtering before limit | Actual worker + DB: WA attempts 0, SMS attempts 1, reserved 3000, pause null, one mocked send |
| Alphanumeric Armenian sender rejected by phone-only schema | Medium | Accept strict 1–11 ASCII alphanumeric/space sender with a letter; approval remains external | Signed hook regression using Noreon; invalid Unicode/punctuation/length/numeric IDs rejected |
| SMS dispatch unnecessarily depended on active callbacks | Medium | Separate default-off dispatch/recovery runtime from callback activation; callbacks still require AuthToken | Restricted-key runtime initializes with callbacks off, refuses disabled dispatch; focused regression went red then green |
| Live tariffs, sender and handset receipts unavailable | Release blocker | Pending owner acceptance; no readiness flags enabled | No provider credentials or external messages used in implementation |

## Verification evidence

- Full migration sequence initialized from zero in isolated `supabase_db_noreon-twilio-hook-replay` (port 56422); primary `supabase_db_noreon-core` was not reset.
- Generated database types from that replay.
- `pnpm typecheck` passed against fully regenerated replay types.
- Repository TypeScript regression runner: 129 checks, zero failures, including actual hook entry-point tests with mocked RPC/provider transport.
- Repository transactional SQL runner: 42 checks, zero failures.
- `pnpm build` passed after the runtime/channel changes with dependencies installed in this isolated checkout.
- `pnpm lint`: zero errors; existing unused-variable warnings in demo welcome and report-content-parity check.
- Actual concurrent Twilio auth-claim PostgreSQL sessions passed: one cap winner, one same-ID sender, no double reservation.
- Unavailable channel admission and existing dispatch/recovery/control/spend concurrency boundaries passed; sender, hook and preference regressions used synthetic credentials.
- No hosted deployment, sender configuration, spending-policy change or live message occurred.


Channel readiness is independent: `NOREON_TWILIO_SMS_READY` enables only validated SMS configuration. `NOREON_TWILIO_WHATSAPP_READY` stays false until a registered sender and both approved language templates exist. The worker passes this server-derived capability list to queue selection and atomic reservation admission. The database defaults the list to empty, and unavailable jobs remain queued without changing attempt, count, spending or pause state. Queue filtering occurs before the batch limit. New preferences show and reject unavailable channels, while existing preferences are retained and can be turned off.

SMS dispatch uses its own explicit `NOREON_MESSAGE_DELIVERY_ENABLED` and `NOREON_MESSAGE_RECOVERY_READY` gates; it can initialize with restricted API keys while callbacks are disabled. The dispatch route's existing authorization remains required. Callback activation is separate and fails closed without an account AuthToken.

## Independent closure and rendered UI evidence

The narrow Astra follow-up closed the unavailable-channel P1 with no new actionable findings and confirmed the dispatch/callback runtime split. Root inspected the actual EN/HY message preferences at 390px and 1280px in a clean isolated production copy using synthetic credentials and a labelled fake callback URL. SMS was selectable, unavailable WhatsApp was disabled, and consent was required before Save became enabled. The initially unconfigured state showed both channels unavailable. Component source hashes matched this implementation. No preference save was submitted, no dispatch ran, and no live SMS receipt or feature activation is claimed by these checks.
