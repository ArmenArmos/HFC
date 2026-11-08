# Member message settings implementation plan

> Implement natively with executing-plans. Routine design choices delegated for overnight work; Claude reviews important issues before release.

**Goal:** Members can inspect and change a verified-phone channel preference with explicit consent, conflict handling and an honest inactive-delivery status.
**Architecture:** Server-rendered settings page, narrow server action and existing authenticated Supabase RPC. No provider calls or activation flag. One additive RPC wrapper checks the expected verified phone under the same auth row lock as consent saves; a migration verifies the function owner can take that lock.
**Spec:** docs/superpowers/specs/2026-10-12-messaging-design.md

## Constraints and decisions

Use existing patient shell, tokens and Armenian/English copy. No browser-supplied user ID or destination. Demo page is informational and saves are rejected before creating a database client. Real-member identity comes from auth.getUser; allow opt-out even when phone/profile eligibility has changed. Saved preference is explicitly dormant until delivery is available. Checkbox records informed channel selection, never prechecked. A channel switch cancels pending notifications and does not replay older plans; say this in the UI. Existing reminders remain independent and do not change prescriptions.

## Review focus and tasks

- [x] Add failing actual-service boundary tests using module hooks for anonymous identity, demo refusal, bad input, unchecked consent, stale revision, ineligible phone, rate limit and failed storage. No provider mocks are needed because there is no transport.
- [x] Implement lib/messaging/preferences.ts for validated server inputs and UI-safe state; lib/messaging/server.ts for authenticated read/save using the narrow RPC. Return typed errors; preserve last saved state when save fails. Never expose raw database errors or full phone in the client state.
- [x] Add app/patient/account/messages/actions.ts and page.tsx, components/messaging/message-settings.tsx; link from account. Save success refreshes authoritative state; conflict asks for reload without silently overwriting draft. Pending disables submissions, errors use role=alert, success role=status. None requires no checkbox.
- [x] Verify typecheck/lint/build and actual service regressions; run full suites after integration. Inspect the rendered demo page and unavailable-channel behavior with browser tools. Claude focused review, then PR/CI/release checks.

Later delivery-engine work remains in the parent spec. This page never claims queued/sent/delivered status.

Ruling: guard stale account/phone context in the action and recheck expected phone in the database transaction. The browser supplies only an opaque expected-context hash, never an authoritative user ID or destination. The server supplies the expected auth phone to the wrapper. Opt-out bypasses phone eligibility. Added SQL race-precondition regression and production migration privilege preflight.

Validation: 49 migrations replayed in isolated noreon-integrity-replay; generated types refreshed; 25 SQL and 74 TypeScript checks pass. Typecheck and production build pass. Demo browser page inspected on existing localhost:3100; real authenticated save not exercised in browser. Claude batch7 report cleared security/integrity and requested aligned consent scope, now fixed.

Release review: staging environment has no environment-specific secrets listed, and its workflow falls back to repository project credentials. Do not dispatch it assuming isolation; production preflight remains in the normal main-only migration workflow. Verify that workflow before calling the release complete.
