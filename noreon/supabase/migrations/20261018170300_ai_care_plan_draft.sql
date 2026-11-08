-- AI-prepared care plan draft (Khikar, 18 Oct 2026 14:59: "The care plan should be prefilled, via AI").
-- Design: output/ai-care-plan-2026-10-18/DESIGN.md.
--
-- The assigned doctor asks for a draft. The app builds every clinical item in code (rules engine and
-- lab protocol v2, reviewed lab values only); the high-tier model only words prose around those items,
-- and code guards and assembles it into the existing draft shape. Nothing here saves a doctor draft,
-- publishes, or messages the member: the doctor edits, saves and publishes through the existing steps.
--
-- Off by default: ai_plan_capabilities.enabled (the "ai_plan_draft_enabled" switch). Real model calls
-- also need the shared locks: _zoe_real_calls_permitted(model) (model_calls_allowed with staging_ai_mode
-- or a signed data agreement) and the same per-tier and total daily caps as Zoe and lab reading, under
-- the same lock. Every attempt is recorded: model, provider, tokens, cost, input fingerprint, prompt and
-- builder versions, guard codes, and the draft it produced. No name, phone or member text is logged.

-- 1. Switch --------------------------------------------------------------------------------------------
create table public.ai_plan_capabilities(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
comment on column public.ai_plan_capabilities.enabled is 'ai_plan_draft_enabled: the assigned doctor may prepare an AI draft of the care plan.';
insert into public.ai_plan_capabilities(singleton,enabled)values(true,false);
create function public._ai_plan_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.ai_plan_capabilities where singleton),false)
$$;

-- 2. Generations: one row per attempt, append-only -----------------------------------------------------
create table public.ai_plan_generations(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.patient_clinical_cases(user_id),
 doctor_id uuid not null references auth.users(id),
 case_revision bigint not null check(case_revision>=0),
 evidence_token text not null check(evidence_token ~ '^[a-f0-9]{32}$'),
 -- The member's current lab values and review states when the facts were read (_ai_plan_lab_token).
 lab_token text not null check(lab_token ~ '^[a-f0-9]{32}$'),
 input_sha256 text not null check(input_sha256 ~ '^[a-f0-9]{64}$'),
 prompt_version text not null check(prompt_version ~ '^[a-z0-9_.-]{1,40}$'),
 builder_version text not null check(builder_version ~ '^[a-z0-9_.-]{1,40}$'),
 language text not null check(language in('hy','en')),
 tier text not null check(tier in('low','medium','high')),
 model text not null check(model ~ '^[a-z0-9_.:/-]{1,80}$'),
 local boolean not null,
 spend_day date not null,
 estimate_usd numeric(10,6)not null check(estimate_usd>=0 and estimate_usd<=100),
 reserved boolean not null,
 refusal text check(refusal ~ '^[a-z0-9_]{1,60}$'),
 state text not null check(state in('reserved','refused','ready','failed')),
 mode text check(mode in('model','protocol_only')),
 provider text check(provider ~ '^[a-z0-9_.-]{1,64}$'),
 response_model text check(response_model ~ '^[A-Za-z0-9_.:/@-]{1,80}$'),
 outcome text check(outcome ~ '^[a-z0-9_]{1,60}$'),
 input_tokens integer check(input_tokens>=0),
 output_tokens integer check(output_tokens>=0),
 cost_usd numeric(10,6)check(cost_usd>=0 and cost_usd<=100),
 latency_ms integer check(latency_ms>=0),
 fallback_used boolean not null default false,
 guard text[]not null default '{}'check(cardinality(guard)<=20),
 draft jsonb check(draft is null or(jsonb_typeof(draft)='object'and octet_length(draft::text)<=12000)),
 items jsonb check(items is null or(jsonb_typeof(items)='array'and jsonb_array_length(items)<=60 and octet_length(items::text)<=40000)),
 summary text check(length(summary)between 1 and 1200),
 adopted_at timestamptz,
 adopted_by uuid references auth.users(id),
 adopted_fields text[]check(adopted_fields<@array['explanation','instructions','followUp']::text[]),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 check(reserved=(refusal is null)),
 check((state='refused')=(not reserved)),
 check(cost_usd is null or reserved),
 check((state='ready')=(draft is not null)),
 check(state<>'ready'or(items is not null and mode is not null)),
 check((state in('ready','failed'))=(finished_at is not null)),
 check((adopted_at is null)=(adopted_by is null)and(adopted_at is null)=(adopted_fields is null)),
 check(adopted_at is null or state='ready')
);
-- Lab freshness (Codex #280 F2): the case evidence token does not cover AI-read lab values or their
-- reviews, so a draft is bound to this token too. Every current value counts, rejected ones included,
-- with its review state and the value and unit in force; a detached or replaced attachment drops out.
create function public._ai_plan_lab_token(p_user uuid)returns text language sql stable security definer set search_path=''as $$
 select md5(coalesce(string_agg(concat_ws(':',v.id,v.status,coalesce(v.corrected_value,v.value),coalesce(v.corrected_unit,v.unit),v.reviewed_at),'|' order by v.id),''))
 from public.lab_ai_values v where v.user_id=p_user and public._lab_ai_current(v.attachment_id)
$$;
create index ai_plan_generations_member on public.ai_plan_generations(user_id,created_at desc);
create index ai_plan_generations_spend on public.ai_plan_generations(spend_day,tier)where reserved;

-- Born reserved or refused; finished once; afterwards only the doctor's adoption record changes.
create function public._ai_plan_generations_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='Plan draft attempts are kept';end if;
 if tg_op='INSERT'then
  if new.state not in('reserved','refused')or new.finished_at is not null or new.draft is not null or new.adopted_at is not null then
   raise exception using errcode='55000',message='A plan draft attempt starts reserved or refused';end if;
  return new;
 end if;
 if(new.id,new.user_id,new.doctor_id,new.case_revision,new.evidence_token,new.lab_token,new.input_sha256,new.prompt_version,new.builder_version,new.language,new.tier,new.model,
   new.local,new.spend_day,new.estimate_usd,new.reserved,new.refusal,new.created_at)is distinct from(old.id,old.user_id,old.doctor_id,old.case_revision,old.evidence_token,old.lab_token,
   old.input_sha256,old.prompt_version,old.builder_version,old.language,old.tier,old.model,old.local,old.spend_day,old.estimate_usd,old.reserved,old.refusal,old.created_at)then
  raise exception using errcode='55000',message='A plan draft attempt is kept as reserved';end if;
 if old.state<>'reserved'and(new.state,new.mode,new.provider,new.response_model,new.outcome,new.input_tokens,new.output_tokens,new.cost_usd,new.latency_ms,new.fallback_used,
   new.guard,new.draft,new.items,new.summary,new.finished_at)is distinct from(old.state,old.mode,old.provider,old.response_model,old.outcome,old.input_tokens,old.output_tokens,
   old.cost_usd,old.latency_ms,old.fallback_used,old.guard,old.draft,old.items,old.summary,old.finished_at)then
  raise exception using errcode='55000',message='A finished plan draft is kept as it was';end if;
 return new;
end$$;
create trigger ai_plan_generations_guard before insert or update or delete on public.ai_plan_generations for each row execute function public._ai_plan_generations_guard();

-- 3. Shared daily spend: Zoe, lab reading and plan drafts count against the same caps -------------------
create or replace function public._ai_spend(p_day date,p_tier text)returns table(total numeric,tier_total numeric)
language sql stable security definer set search_path=''as $$
 select coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.zoe_runs where spend_day=p_day and reserved),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.lab_ai_calls where spend_day=p_day and reserved),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.ai_plan_generations where spend_day=p_day and reserved),0),
        coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.zoe_runs where spend_day=p_day and reserved and tier=p_tier),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.lab_ai_calls where spend_day=p_day and reserved and tier=p_tier),0)
       +coalesce((select sum(coalesce(cost_usd,estimate_usd))from public.ai_plan_generations where spend_day=p_day and reserved and tier=p_tier),0)
$$;

-- 4. Service functions (the app calls them only after the doctor's own read proved the assignment) -----
-- Reserve one attempt. The doctor must still be the member's assigned, active doctor in an active clinic.
create function public.ai_plan_reserve(p_user uuid,p_doctor uuid,p_revision bigint,p_token text,p_lab_token text,p_input_sha256 text,p_prompt_version text,p_builder_version text,
 p_language text,p_tier text,p_model text,p_local boolean,p_estimate_usd numeric)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;c public.zoe_tier_config;spent numeric;tier_spent numeric;cap numeric;tier_cap numeric;code text;day date;v_id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_user is null or p_doctor is null or p_revision is null or p_revision<0 or coalesce(p_token,'')!~'^[a-f0-9]{32}$'or coalesce(p_lab_token,'')!~'^[a-f0-9]{32}$'or coalesce(p_input_sha256,'')!~'^[a-f0-9]{64}$'
  or coalesce(p_prompt_version,'')!~'^[a-z0-9_.-]{1,40}$'or coalesce(p_builder_version,'')!~'^[a-z0-9_.-]{1,40}$'or p_language is null or p_language not in('hy','en')
  or p_tier is null or p_tier not in('low','medium','high')or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'or p_local is null
  or p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 then return jsonb_build_object('ok',false,'code','invalid');end if;
 if not public._ai_plan_enabled()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if not exists(select 1 from public.patient_clinical_cases k where k.user_id=p_user and k.assigned_doctor_id=p_doctor)
  or not exists(select 1 from public.workspace_staff w join public.workspace_clinics l on l.id=w.clinic_id where w.user_id=p_doctor and w.role='doctor'and w.active and l.active)
 then return jsonb_build_object('ok',false,'code','not_assigned');end if;
 -- The facts were built from lab values that have since been reviewed, corrected, rejected or detached.
 if p_lab_token is distinct from public._ai_plan_lab_token(p_user)then return jsonb_build_object('ok',false,'code','stale');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into s from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 day:=(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date;
 if(select count(*)from public.ai_plan_generations g where g.user_id=p_user and g.spend_day=day)>=20 then return jsonb_build_object('ok',false,'code','daily_attempt_limit');end if;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(day,p_tier)x;
 code:=case when p_local then null
  when not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'end;
 insert into public.ai_plan_generations(user_id,doctor_id,case_revision,evidence_token,lab_token,input_sha256,prompt_version,builder_version,language,tier,model,local,spend_day,
  estimate_usd,reserved,refusal,state)
 values(p_user,p_doctor,p_revision,p_token,p_lab_token,p_input_sha256,p_prompt_version,p_builder_version,p_language,p_tier,p_model,p_local,day,
  case when p_local then 0 else p_estimate_usd end,code is null,code,case when code is null then 'reserved'else 'refused'end)returning id into v_id;
 return case when code is null then jsonb_build_object('ok',true,'generationId',v_id)else jsonb_build_object('ok',false,'code',code,'generationId',v_id)end;
end$$;

-- Finish an attempt once: ready with a draft, or failed. Never member text in a log; the draft is stored for the doctor.
create function public.ai_plan_finish(p_generation uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare g public.ai_plan_generations;st text;v_guard text[];
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into g from public.ai_plan_generations where id=p_generation for update;
 if not found or not g.reserved then return jsonb_build_object('ok',false,'code','generation_unknown');end if;
 if g.state<>'reserved'then return jsonb_build_object('ok',true,'replayed',true);end if;
 st:=p_result->>'state';
 if jsonb_typeof(p_result)is distinct from 'object'or st is null or st not in('ready','failed')or coalesce(p_result->>'outcome','')!~'^[a-z0-9_]{1,60}$'
  or coalesce(p_result->>'provider','')!~'^[a-z0-9_.-]{1,64}$'
  or(p_result ? 'responseModel'and coalesce(p_result->>'responseModel','')!~'^[A-Za-z0-9_.:/@-]{1,80}$')
  or(st='ready'and(coalesce(p_result->>'mode','')not in('model','protocol_only')or jsonb_typeof(p_result->'draft')is distinct from 'object'
   or jsonb_typeof(p_result->'items')is distinct from 'array'or not(p_result->'draft' ?& array['explanation','instructions','followUp'])))
  or(st='failed'and(p_result ? 'draft'or p_result ? 'items'))
  or(p_result ? 'guard'and jsonb_typeof(p_result->'guard')is distinct from 'array')
  or coalesce((p_result->>'costUsd')::numeric,0)not between 0 and 100 or coalesce((p_result->>'inputTokens')::integer,0)<0
  or coalesce((p_result->>'outputTokens')::integer,0)<0 or coalesce((p_result->>'latencyMs')::integer,0)<0
 then return jsonb_build_object('ok',false,'code','invalid');end if;
 -- Local attempts (stand-in or protocol only) never cost anything. A real call without a reported cost
 -- (usage unknown or partly reported, whatever the outcome) keeps cost_usd null, so the reserved
 -- estimate stays in the shared daily spend (Codex #280 F4).
 if g.local and coalesce((p_result->>'costUsd')::numeric,0)<>0 then return jsonb_build_object('ok',false,'code','invalid');end if;
 select coalesce(array_agg(x),'{}')into v_guard from jsonb_array_elements_text(coalesce(p_result->'guard','[]'))x;
 if exists(select 1 from unnest(v_guard)x where x!~'^[a-z0-9_:]{1,60}$')then return jsonb_build_object('ok',false,'code','invalid');end if;
 update public.ai_plan_generations set state=st,mode=case when st='ready'then p_result->>'mode'end,provider=p_result->>'provider',response_model=p_result->>'responseModel',
  outcome=p_result->>'outcome',input_tokens=(p_result->>'inputTokens')::integer,output_tokens=(p_result->>'outputTokens')::integer,cost_usd=case when g.local then 0 else(p_result->>'costUsd')::numeric end,
  latency_ms=(p_result->>'latencyMs')::integer,fallback_used=coalesce((p_result->>'fallbackUsed')::boolean,false),guard=v_guard,
  draft=case when st='ready'then p_result->'draft'end,items=case when st='ready'then p_result->'items'end,
  summary=case when st='ready'then nullif(btrim(coalesce(p_result->>'summary','')),'')end,finished_at=clock_timestamp()
 where id=g.id;
 return jsonb_build_object('ok',true,'replayed',false);
end$$;

-- 5. Doctor functions ----------------------------------------------------------------------------------
-- The member's current lab values with their review status (no PDF snippet, no file name), the latest
-- finished draft and today's attempt count. Assigned active doctor only.
create function public.doctor_ai_plan_read(p_user_id uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare g public.ai_plan_generations;day date;
begin
 perform public._assigned_active_doctor(p_user_id);
 if not public._ai_plan_enabled()then return jsonb_build_object('version','ai-plan-read-v1','enabled',false);end if;
 day:=(clock_timestamp()at time zone coalesce((select time_zone from public.zoe_settings where singleton),'Asia/Yerevan'))::date;
 select * into g from public.ai_plan_generations where user_id=p_user_id and state='ready'order by created_at desc limit 1;
 return jsonb_build_object('version','ai-plan-read-v1','enabled',true,
  'attemptsToday',(select count(*)from public.ai_plan_generations where user_id=p_user_id and spend_day=day),
  'published',exists(select 1 from public.patient_care_plans p where p.user_id=p_user_id and p.active),
  'labToken',public._ai_plan_lab_token(p_user_id),
  'labValues',coalesce((select jsonb_agg(jsonb_build_object('valueId',v.id,'catalogueRef',v.catalogue_ref,'testName',v.test_name,'value',coalesce(v.corrected_value,v.value),
    'unit',coalesce(v.corrected_unit,v.unit),'labFlag',v.lab_flag,'collectedOn',v.collected_on,'attention',v.attention,'status',v.status)order by v.collected_on desc nulls last,v.seq)
   from public.lab_ai_values v where v.user_id=p_user_id and v.status<>'rejected'and public._lab_ai_current(v.attachment_id)),'[]'),
  'latest',case when g.id is null then null else jsonb_build_object('id',g.id,'createdAt',g.created_at,'mode',g.mode,'model',g.model,'local',g.local,'provider',g.provider,
   'responseModel',g.response_model,'language',g.language,'evidenceToken',g.evidence_token,'labToken',g.lab_token,'caseRevision',g.case_revision,'promptVersion',g.prompt_version,
   'builderVersion',g.builder_version,'guard',to_jsonb(g.guard),'draft',g.draft,'items',g.items,'summary',g.summary,'adoptedAt',g.adopted_at,
   'adoptedFields',to_jsonb(g.adopted_fields),'byYou',g.doctor_id=auth.uid())end);
end$$;

-- Which AI-prepared fields the doctor accepted or edited when they saved their draft.
create function public.doctor_ai_plan_adopted(p_generation uuid,p_fields text[])returns jsonb
language plpgsql security definer set search_path=''as $$
declare g public.ai_plan_generations;d uuid;
begin
 if p_generation is null or p_fields is null or cardinality(p_fields)>3 or not(p_fields<@array['explanation','instructions','followUp']::text[])then
  return jsonb_build_object('status','invalid');end if;
 select * into g from public.ai_plan_generations where id=p_generation;
 if not found then raise insufficient_privilege;end if;
 d:=public._assigned_active_doctor(g.user_id);
 if not public._ai_plan_enabled()then return jsonb_build_object('status','disabled');end if;
 if g.state<>'ready'or g.lab_token is distinct from public._ai_plan_lab_token(g.user_id)then return jsonb_build_object('status','stale');end if;
 update public.ai_plan_generations set adopted_at=clock_timestamp(),adopted_by=d,adopted_fields=(select coalesce(array_agg(distinct x order by x),'{}')from unnest(p_fields)x)
 where id=g.id;
 return jsonb_build_object('status','saved');
end$$;

-- Saving text taken from an AI-prepared draft (Codex #280 F2). The draft must still be on the case
-- evidence being saved and on the current lab values and review states, checked in the same transaction
-- as the save. Lock order, so a lab change cannot slip between the check and the save:
--  1. the case row (FOR UPDATE): a new lab value or attachment references it, so it waits;
--  2. the member's attachments (FOR UPDATE): a detachment references one, so it waits;
--  3. the member's lab values (FOR SHARE): a review, correction or rejection updates one, so it waits.
-- A change that committed first is seen by the token and the save is refused (40001). The save itself is
-- the existing save_patient_clinical_draft (assignment, session, revision and evidence token checks).
create function public.save_patient_clinical_draft_from_ai(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_draft jsonb,p_generation uuid)returns bigint
language plpgsql security definer set search_path=''as $$
declare g public.ai_plan_generations;
begin
 perform public._assigned_active_doctor(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update;
 perform 1 from public.clinic_result_attachments where user_id=p_user_id for update;
 perform 1 from public.lab_ai_values where user_id=p_user_id for share;
 select * into g from public.ai_plan_generations where id=p_generation and user_id=p_user_id;
 if not found or g.state<>'ready'or not public._ai_plan_enabled()or g.evidence_token is distinct from p_evidence_token
  or g.lab_token is distinct from public._ai_plan_lab_token(p_user_id)then
  raise exception using errcode='40001',message='AI draft evidence changed';
 end if;
 return public.save_patient_clinical_draft(p_user_id,p_expected_revision,p_evidence_token,p_draft);
end$$;

-- 6. Member: "Your doctor is preparing your plan" (a boolean, nothing about content) ---------------------
create function public.patient_plan_preparing()returns boolean
language sql stable security definer set search_path=''as $$
 select auth.uid()is not null and public._ai_plan_enabled()
  and exists(select 1 from public.patient_clinical_cases k where k.user_id=auth.uid()and k.assigned_doctor_id is not null)
  and not exists(select 1 from public.patient_care_plans p where p.user_id=auth.uid()and p.active)
  and(exists(select 1 from public.patient_clinical_cases k where k.user_id=auth.uid()and k.draft_saved_at is not null)
   or exists(select 1 from public.lab_ai_values v where v.user_id=auth.uid()and v.reviewed_by is not null)
   or exists(select 1 from public.ai_plan_generations g where g.user_id=auth.uid()and g.state='ready'))
$$;

-- 7. RLS and grants: no direct table access; functions only --------------------------------------------
alter table public.ai_plan_capabilities enable row level security;
alter table public.ai_plan_generations enable row level security;
revoke all on public.ai_plan_capabilities,public.ai_plan_generations from public,anon,authenticated,service_role;
revoke all on function public._ai_plan_enabled(),public._ai_plan_generations_guard(),public._ai_spend(date,text),public._ai_plan_lab_token(uuid),
 public.ai_plan_reserve(uuid,uuid,bigint,text,text,text,text,text,text,text,text,boolean,numeric),public.ai_plan_finish(uuid,jsonb),
 public.doctor_ai_plan_read(uuid),public.doctor_ai_plan_adopted(uuid,text[]),public.save_patient_clinical_draft_from_ai(uuid,bigint,text,jsonb,uuid),public.patient_plan_preparing()from public,anon,authenticated,service_role;
grant execute on function public.ai_plan_reserve(uuid,uuid,bigint,text,text,text,text,text,text,text,text,boolean,numeric),public.ai_plan_finish(uuid,jsonb)to service_role;
grant execute on function public.doctor_ai_plan_read(uuid),public.doctor_ai_plan_adopted(uuid,text[]),public.save_patient_clinical_draft_from_ai(uuid,bigint,text,jsonb,uuid),public.patient_plan_preparing()to authenticated;
