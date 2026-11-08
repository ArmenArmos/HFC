-- Go-live AI switches (runbook F3). Run after scripts/seed-environment.sql AND after the model-mode
-- evals of runbook F2 (one passing run per tier in the last 7 days; +chat-N for warm replies,
-- +intake-N for symptom intake). The guards on zoe_settings refuse otherwise, naming what is missing,
-- and nothing is changed.
--
--   psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/seed-environment-ai.sql
--
-- Real calls and lab AI on: the owner's decision (Khikar, 19 Oct 01:28, "Keep all on"), with staging_ai_mode
-- from the main seed and the US$10 daily cap. The three reply features are clinical sign-offs
-- (Armen W6-W8, R1-R17) and stay off until the lead records them; flip them here in a reviewed PR.
-- Idempotent.

begin;
update public.zoe_settings set model_calls_allowed=true,updated_at=clock_timestamp()where singleton and not model_calls_allowed;
-- Lab PDF reading for doctors (owner decision, AI on); it reads only while doctor completion (B5) is on.
update public.lab_ai_capabilities set enabled=true,auto_accept_enabled=true where singleton and (not enabled or not auto_accept_enabled);
update public.zoe_settings set
 direct_answers_enabled=false,             -- [A1] direct answers
 conversational_replies_enabled=false,     -- [A1] warm (conversational) replies
 symptom_intake_enabled=false,             -- [A1] symptom intake
 health_answers_enabled=false,             -- [A1] health answers (Armen's sign-off on the dataset eval)
 updated_at=clock_timestamp()
where singleton;
do $$begin
 if not coalesce((select model_calls_allowed and staging_ai_mode from public.zoe_settings where singleton),false)then
  raise exception 'Go-live AI seed: zoe_settings row missing, or real calls not allowed; run seed-environment.sql first';end if;
end$$;
commit;
