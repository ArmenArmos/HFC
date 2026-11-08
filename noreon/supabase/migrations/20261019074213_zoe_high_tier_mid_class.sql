-- Zoe AI settings: the high tier may use a Mid-class model (lead decision 19 Oct; AI eval output/ai-eval-zoe-2026-10-19:
-- Sonnet 5.5 was as safe as Opus 5.5 on symptom intake at 2.3x lower cost per turn, and GPT-6 Sol as the reply judge
-- passed all 169 MUST judge rows). The tier's rank stays its RECOMMENDED class (the admin page warns below it); the new
-- floor is the LOWEST class a tier may use: low Small, medium Mid, high Mid. The eval gate is unchanged: a tier change
-- still needs a passing eval of the candidate (zoe_tier_config_apply), and the floor applies to primary and fallback.
create function public._zoe_tier_floor(t text)returns smallint language sql immutable set search_path=''as $$
 select case t when 'low'then 1 when 'medium'then 2 when 'high'then 2 end::smallint$$;

create or replace function public._zoe_tier_config_check()returns trigger language plpgsql set search_path=''as $$
begin
 if not exists(select 1 from public.zoe_model_catalog where model_id=new.model_id and enabled and strength>=public._zoe_tier_floor(new.tier))
  or(new.fallback_model_id is not null and not exists(select 1 from public.zoe_model_catalog where model_id=new.fallback_model_id and enabled and strength>=public._zoe_tier_floor(new.tier)))then
  raise exception using errcode='23514',message='Model not allowed for this tier';
 end if;
 return new;
end$$;

revoke all on function public._zoe_tier_floor(text)from public,anon,authenticated,service_role;
