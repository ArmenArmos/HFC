# Unified member care experience

Approved direction: one mobile-first member experience with five sections: Today, My health, Results, My care, Profile. Remove clinical role switching from member routes. Keep presentation controls separate, demo-only. Maintain existing brand tokens and Armenian/English copy.

Today has a prominent next step and Also today list, derived from saved facts. Priority: existing urgent finding; imminent confirmed appointment; due medication check-in; confirmed tests; received results awaiting review; newly published plan; incomplete questionnaire; measurement entry. Waiting is a visible state, never a fabricated action. Multiple medications remain visible. Taken/skipped is self-report, not proof. Missed doses do not instruct catching up. Schedules use Asia/Yerevan and only published, active prescriptions; completed check-ins are idempotent and correctable.

Results include ordered/collected tests, source-labelled dated numeric results, source reference intervals, review status and published explanations. Questionnaire recommendations remain separate drafts, never orders. My health provides real time-based BP/pulse and laboratory trends with filters and accessible value lists. No missing data is imputed or clinical inference added.

My care includes published instructions, medication schedule/check-ins, appointments with accurate status and organization details. Profile includes questionnaire progress and existing personal details. Real records are Supabase-owned and isolated with RLS. Organizations can write through trusted backend credentials later; no new doctor/coordinator interface or automatic lab integration is claimed. Demo provides the same screens with explicit fictional stages and reset; seeded data never enters production. Legacy patient journey redirects into the unified hub.

Release keeps existing registration gate and SMS limitations. In-app reminders only; no push/SMS delivery promise. File uploads and structured lab ingestion are separate future integration work; this release displays structured records already received, with source and review status. A member can always enter their own BP via the existing flow.

Verification: priority/routing and time-boundary tests, invalid/stale medication events, database isolation and publication restrictions, current clinical conformance, responsive browser walkthrough for tests pending, review pending, published treatment, and empty real records.
