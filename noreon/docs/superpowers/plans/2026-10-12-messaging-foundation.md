# Messaging foundation implementation plan

> Implement natively using superpowers:executing-plans. User delegated routine choices for overnight work; Claude reviews the completed batch before release.

**Goal:** Persist verified channel consent and one source-bound plan-ready job without sending any external message.
**Architecture:** Supabase tables, RLS and narrow security-definer RPCs use auth.uid or an authoritative care-plan ID. Existing clients remain unaffected. No provider or cron is enabled in this stage.
**Tech stack:** Postgres/Supabase migrations and existing SQL regression runner.
**Spec:** docs/superpowers/specs/2026-10-12-messaging-design.md

## Global constraints

Default channel none. Real auth users only. No browser-supplied recipient. Consent version messaging-service-v1. One logical job per plan-ready event. No direct client or service-role table writes. Forward migrations created with pnpm db:new, generated types, isolated clean replay. Preserve original clinical/design source files.

## Review focus

1. Another member ID or unverified phone cannot grant consent or receive a job.
2. Concurrent/stale settings saves cannot overwrite newer consent.
3. Phone changes and opt-out prevent queued work from staying eligible.
4. Future/inactive/acknowledged/foreign plans cannot generate a sendable event.
5. Repeated enqueue and channel switching cannot duplicate a logical plan-ready notification.

## Task1: consent and durable plan-event storage

Files: new CLI-generated supabase/migrations/*_messaging_consent_outbox.sql; scripts/check-messaging-foundation.sql; generated lib/db/types.ts.

- [x] Write SQL fixture with two real auth users, verified/unverified phones, profiles and existing care consent. Invoke save_patient_message_preferences(p_channel,p_expected_revision,p_consent_version). Verify caller isolation, revision rejection and opt-out without verified phone.
- [x] Run against current isolated DB and observe missing RPC failure.
- [x] Implement patient_message_preferences, patient_message_consent_events and patient_message_outbox with ownership foreign keys, RLS, explicit revoked grants, own select only for preference/history and service select on outbox.
- [x] Implement save RPC: auth.uid identity; lock auth row then preference; require verified phone and current care consent for opt-in; exact version; expected revision; append history and cancel queued jobs atomically. Opt-out can proceed without eligible phone. Return revision or -1 conflict.
- [x] Implement enqueue_patient_plan_message(p_plan_id) as service-only: lock owner preferences, check verified phone/current consent and active published unacknowledged source; insert with unique(user_id,kind,plan_id) and on-conflict return existing ID. Missing/ineligible source returns null. No caller-controlled destination/body/channel.
- [x] Extend SQL test to attempt duplicate enqueue, foreign-source substitution, future/inactive/acknowledged plan, changed phone, opt-out cancellation and direct grants/RLS escape. Assertions run as authenticated/service roles where applicable, not only postgres.
- [x] Copy migration to isolated replay workdir, compare all migration bytes, reset from zero and regenerate types. Run SQL/TS suites, typecheck/build and diff check.
- [ ] Claude reviews important permission/transaction/source-boundary issues; resolve material findings, commit, PR, CI, merge and verify production migration.

## Later tasks remain in the design

Settings UI, transport/claims/callbacks, delivery observability, reminder/Zoe producers and mobile integration follow this foundation; no claim of live messaging support at this stage.

## Execution evidence

Implemented natively. SQL regressions observed missing-RPC, unchanged-save, pre-consent-event and cancelled-result failures before fixes. Because earlier migrations had already run locally, corrections are forward migrations. Final48migration replay matches source; generated types match replay;24SQL/72TS checks, typecheck, targeted lint and build pass. Eight concurrent consent calls yield one revision winner; eight producers yield one job. Claude initial review and narrow addendum clear this disabled foundation; PR/CI/production gates remain.

Ruling: add30changes/hour abuse guard and idempotent unchanged saves; permit opt-out even at the limit. Ruling: cancel pending jobs on channel switch and explain that in next-stage settings UI; this provisional choice avoids implicit transfer of an already-queued event to a newly consented channel. The broader messaging stages remain required.
