-- AI-prepared care plan draft on prod-as-staging (Khikar, 18 Oct 2026 14:59). Run in the Supabase SQL
-- editor AFTER migration 20261018170300_ai_care_plan_draft is applied. Design and gates:
-- output/ai-care-plan-2026-10-18/DESIGN.md; GO_LIVE_GATES "AI-prepared care plan draft".
-- Vercel production env (then redeploy): NOREON_AI_PLAN_PROVIDER=gateway. Without it, drafts are
-- protocol-only (code wording, no model call). Model wording also needs the staging AI mode steps
-- (docs/operations/staging-ai-mode.sql: staging_ai_mode and model_calls_allowed).

-- 0. Current state.
select enabled from public.ai_plan_capabilities;
select model_calls_allowed,staging_ai_mode from public.zoe_settings;

-- 1. Switch on (assigned doctors see "Prepare care plan"; members see "Your doctor is preparing your plan").
update public.ai_plan_capabilities set enabled=true;

-- 2. Verify after a doctor prepared a draft: mode, model, cost, guard codes. No content is needed to check.
select created_at,state,mode,model,provider,response_model,refusal,outcome,cost_usd,guard,adopted_fields
 from public.ai_plan_generations order by created_at desc limit 10;

-- R. Off (any time; also before real members unless Armen sign-off, MDR assessment and DPA are done).
-- update public.ai_plan_capabilities set enabled=false;
