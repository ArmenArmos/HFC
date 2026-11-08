-- staging_ai_mode is no longer "staging only" (Khikar, 19 Oct 2026 01:28: "don't remove AI in
-- non-staging mode. Keep all on."). Comment only: the column, the guards and every check are
-- unchanged. It is the database switch for real AI calls without a signed data agreement (and, for
-- symptom intake, with unsigned symptom sheets); it stays on by the owner's decision until the data
-- agreements and the legal check (PENDING_QUESTIONS P14, P16) are done. GO_LIVE_GATES "staging AI on".
comment on column public.zoe_settings.staging_ai_mode is
 'Real AI calls without a signed data agreement (and symptom intake with unsigned sheets). On by owner decision (19 Oct 2026) until the DPA and legal check (P14/P16); see docs/operations/staging-ai-mode.md.';
