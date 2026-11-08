-- Zoe structured reply drafts (output/ai-reply-drafts/DESIGN.md; AI_FIRST_OPERATIONS §4.1).
-- For a health question that goes to the doctor, Zoe makes a second, small call: the model chooses an approved
-- acknowledgement from a fixed set and picks items of the member's PUBLISHED plan by id; app code quotes those items verbatim
-- and adds one fixed deferral line. The draft is an ordinary pending AI draft (zoe_run_finish, unchanged):
-- only the assigned doctor's approval sends anything. This migration adds:
--  1. zoe_settings.structured_drafts_enabled (default off);
--  2. zoe_run_plan: per claimed run the switch and the current published plan (service role only);
--  3. zoe_reply_drafts: the draft's sources for the doctor, one per run, written only by the function below while the run
--     is started (no grants: nothing updates it); every quoted item is checked here against the published plan, so a quote can only be the
--     doctor's own published words;
--  4. zoe_reply_drafts_for_doctor: the assigned doctor's read, journaled in the access audit.

-- 1. The switch ------------------------------------------------------------------------------------------
alter table public.zoe_settings add column structured_drafts_enabled boolean not null default false;
comment on column public.zoe_settings.structured_drafts_enabled is
 'Zoe prepares structured reply drafts for health questions: an acknowledgement, verbatim quotes of the published plan and a fixed deferral line, for the doctor to approve, edit or reject. Doctor-facing until approved.';

-- 2. The plan for a run ------------------------------------------------------------------------------------
-- The published clinical review of the member's active plan (the immutable publication snapshot), only its
-- member-facing fields. Null when nothing is published. Service role only.
create function public.zoe_run_plan(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare on_ boolean:=coalesce((select structured_drafts_enabled from public.zoe_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,'plan',case when on_ then(
   select jsonb_build_object('planId',p.plan_id,'publishedAt',p.published_at,
    'explanation',coalesce(p.draft->>'explanation',''),'instructions',coalesce(p.draft->>'instructions',''),'followUp',coalesce(p.draft->>'followUp',''),
    'medicationName',coalesce(p.draft->>'medicationName',''),'medicationDose',coalesce(p.draft->>'medicationDose',''),
    'medicationInstructions',coalesce(p.draft->>'medicationInstructions',''),'medicationTimes',coalesce(p.draft->'medicationTimes','[]'::jsonb))
   from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
   where plan.user_id=r.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()
   order by p.published_at desc limit 1)end))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;
revoke all on function public.zoe_run_plan(uuid[])from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_plan(uuid[])to service_role;

-- 3. The sources ---------------------------------------------------------------------------------------------
create table public.zoe_reply_drafts (
 run_id uuid primary key references public.zoe_runs(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 version text not null check(version ~ '^[a-z0-9_.-]{1,40}$'),
 plan_id uuid references public.patient_care_plans(id)on delete set null,
 plan_published_at timestamptz,
 -- The member's clinical context when the sources were recorded; the draft zoe_run_finish creates must carry the same (Codex RD-03).
 clinical_revision bigint not null,source_token text not null,
 -- Doctor-only: what the member asked, and what only the doctor can decide. Guarded app text.
 asked text not null check(length(asked)between 1 and 400),
 -- Member-facing once approved: the approved line the model chose (lib/zoe/reply-draft.ts ACKNOWLEDGEMENTS), and its text.
 acknowledgement_id text not null check(acknowledgement_id ~ '^A[0-9]{1,2}$'),
 acknowledgement text not null check(length(acknowledgement)between 1 and 400),
 -- [{id,kind,text}], verbatim from the published plan (checked by zoe_run_record_reply_draft).
 quoted jsonb not null check(jsonb_typeof(quoted)='array'and jsonb_array_length(quoted)<=4),
 doctor_decides text[]not null default '{}'check(cardinality(doctor_decides)<=3),
 outside_plan boolean not null,
 needs_judgement boolean not null,
 judgement_reasons text[]not null default '{}'check(cardinality(judgement_reasons)<=8),
 created_at timestamptz not null default clock_timestamp()
);
create index zoe_reply_drafts_member on public.zoe_reply_drafts(member_id,created_at desc);
alter table public.zoe_reply_drafts enable row level security;
revoke all on public.zoe_reply_drafts from public,anon,authenticated,service_role;
comment on table public.zoe_reply_drafts is
 'Sources of Zoe structured reply drafts (one per run, written once by zoe_run_record_reply_draft, never updated). asked, acknowledgement and doctor_decides hold member-derived text; retention as zoe_runs (Q17), deleted with the account.';

-- Written by the worker while the run is started, before zoe_run_finish. Refuses a quote that is not, word for
-- word, part of the member's current published plan, and a medicine line that is not exactly the published one.
create function public.zoe_run_record_reply_draft(p_run uuid,p_record jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;pub record;item jsonb;txt text;med text;ok boolean;cr bigint;src text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not coalesce((select structured_drafts_enabled from public.zoe_settings where singleton),false)then return jsonb_build_object('ok',false,'code','structured_drafts_off');end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state<>'started'then return jsonb_build_object('ok',false,'code','run_not_started');end if;
 -- Codex RD-03: the publication, the case revision and the evidence token are read after locking the member's case row,
 -- so a publication (which updates the case) cannot land between those reads; anything after is caught by the bind trigger.
 select revision into cr from public.patient_clinical_cases where user_id=r.member_id for update;
 if jsonb_typeof(p_record)<>'object'or jsonb_typeof(p_record->'quoted')<>'array'or jsonb_array_length(p_record->'quoted')>4
  or jsonb_typeof(coalesce(p_record->'doctorDecides','[]'))<>'array'or jsonb_typeof(coalesce(p_record->'judgementReasons','[]'))<>'array'then
  return jsonb_build_object('ok',false,'code','record_invalid');end if;
 select p.plan_id,p.published_at,p.draft into pub
  from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
  where plan.user_id=r.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()order by p.published_at desc limit 1;
 if(p_record->>'planId')is distinct from(pub.plan_id::text)then return jsonb_build_object('ok',false,'code','plan_changed');end if;
 if pub.plan_id is null and jsonb_array_length(p_record->'quoted')>0 then return jsonb_build_object('ok',false,'code','quote_without_plan');end if;
 med:=concat_ws(', ',nullif(btrim(btrim(coalesce(pub.draft->>'medicationName',''))||' '||btrim(coalesce(pub.draft->>'medicationDose',''))),''),
  nullif((select string_agg(t,', 'order by o)from jsonb_array_elements_text(coalesce(pub.draft->'medicationTimes','[]'))with ordinality x(t,o)),''),
  nullif(btrim(coalesce(pub.draft->>'medicationInstructions','')),''));
 for item in select value from jsonb_array_elements(p_record->'quoted')loop
  txt:=item->>'text';
  if txt is null or length(txt)not between 2 and 400 or coalesce(item->>'id','')not similar to '[A-Z][0-9]{1,2}'then return jsonb_build_object('ok',false,'code','quote_invalid');end if;
  ok:=(item->>'kind'='instruction'and strpos(coalesce(pub.draft->>'instructions',''),txt)>0)
   or(item->>'kind'='explanation'and strpos(coalesce(pub.draft->>'explanation',''),txt)>0)
   or(item->>'kind'='next_step'and strpos(coalesce(pub.draft->>'followUp',''),txt)>0)
   or(item->>'kind'='medicine'and nullif(btrim(coalesce(pub.draft->>'medicationName','')),'')is not null and med=txt);
  if not coalesce(ok,false)then return jsonb_build_object('ok',false,'code','quote_not_in_plan');end if;
 end loop;
 src:=public.patient_clinical_evidence(r.member_id)->>'token';
 if cr is null or src is null then return jsonb_build_object('ok',false,'code','no_clinical_context');end if;
 insert into public.zoe_reply_drafts(run_id,member_id,clinical_revision,source_token,version,plan_id,plan_published_at,asked,acknowledgement_id,acknowledgement,quoted,doctor_decides,outside_plan,needs_judgement,judgement_reasons)
 values(r.id,r.member_id,cr,src,p_record->>'version',pub.plan_id,pub.published_at,p_record->>'asked',p_record->>'acknowledgementId',p_record->>'acknowledgement',p_record->'quoted',
  array(select jsonb_array_elements_text(coalesce(p_record->'doctorDecides','[]'))),(p_record->>'outsidePlan')::boolean,(p_record->>'needsJudgement')::boolean,
  array(select jsonb_array_elements_text(coalesce(p_record->'judgementReasons','[]'))))
 on conflict(run_id)do nothing;
 if not found then return jsonb_build_object('ok',false,'code','already_recorded');end if;
 return jsonb_build_object('ok',true);
exception when check_violation or not_null_violation or invalid_text_representation then return jsonb_build_object('ok',false,'code','record_invalid');
end$$;
revoke all on function public.zoe_run_record_reply_draft(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_record_reply_draft(uuid,jsonb)to service_role;

-- Codex RD-03: the sources and the draft are written by two calls. If a plan was published (or other clinical evidence
-- changed) in between, the draft zoe_run_finish creates would carry the NEW clinical context while quoting the OLD plan,
-- and the reply machine's stale check would not catch it. The finish is refused instead (fail closed: the run ends with
-- no draft and the doctor writes the reply).
create function public._zoe_reply_draft_bind()returns trigger language plpgsql security definer set search_path=''as $$
declare s public.zoe_reply_drafts;d public.conversation_drafts;
begin
 if new.draft_id is null or new.draft_id is not distinct from old.draft_id then return new;end if;
 select * into s from public.zoe_reply_drafts where run_id=new.id;
 if not found then return new;end if;
 select * into d from public.conversation_drafts where id=new.draft_id;
 if d.clinical_revision is distinct from s.clinical_revision or d.source_token is distinct from s.source_token then
  raise exception using errcode='40001',message='Zoe reply draft sources are older than the clinical context';end if;
 return new;
end$$;
revoke all on function public._zoe_reply_draft_bind()from public,anon,authenticated,service_role;
create trigger zoe_reply_draft_bind after update of draft_id on public.zoe_runs for each row execute function public._zoe_reply_draft_bind();

-- 4. The doctor's read ---------------------------------------------------------------------------------------
-- The assigned doctor only (as zoe_runs_for_doctor). planCurrent: the quoted plan is still the published one.
create function public.zoe_reply_drafts_for_doctor(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();cur uuid;
begin
 if who is null or who->>'role'<>'doctor'or not exists(select 1 from public.patient_clinical_cases where user_id=p_member and assigned_doctor_id=auth.uid())then raise insufficient_privilege;end if;
 select p.plan_id into cur from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
  where plan.user_id=p_member and plan.active and plan.published_at<=now()and p.published_at<=now()order by p.published_at desc limit 1;
 perform public._access_audit_record(p_member,'member_zoe_reply_drafts',null);
 return jsonb_build_object('ok',true,'drafts',coalesce((select jsonb_agg(jsonb_build_object('runId',d.run_id,'draftId',z.draft_id,'messageSeq',z.message_seq,'version',d.version,
   'planId',d.plan_id,'planPublishedAt',d.plan_published_at,'planCurrent',d.plan_id is not distinct from cur,'asked',d.asked,'acknowledgementId',d.acknowledgement_id,'acknowledgement',d.acknowledgement,'quoted',d.quoted,
   'doctorDecides',to_jsonb(d.doctor_decides),'outsidePlan',d.outside_plan,'needsJudgement',d.needs_judgement,'judgementReasons',to_jsonb(d.judgement_reasons),'createdAt',d.created_at)order by d.created_at desc)
  from(select * from public.zoe_reply_drafts where member_id=p_member order by created_at desc limit 5)d join public.zoe_runs z on z.id=d.run_id),'[]'));
end$$;
revoke all on function public.zoe_reply_drafts_for_doctor(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_reply_drafts_for_doctor(uuid)to authenticated;
