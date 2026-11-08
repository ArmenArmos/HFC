-- Tasks 16 and 19 (20261102183134): the optional activity field on a plan draft, Zoe's read of it, and the haemorrhagic stroke type.
-- Rolled back. Fictional fixtures only. Run: psql -v ON_ERROR_STOP=1 -f scripts/check-zoe-tasks-14-20.sql
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(s text)returns uuid language sql as $$select ('73000000-0000-4000-8000-0000000000'||s)::uuid$$;
create temp table base as select '{"explanation":"Fictional review","instructions":"Fictional instructions","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}'::jsonb d;

-- 1. Draft validity: absent as before, a string within the limit, nothing else.
select pg_temp.ok(public.workspace_valid_review_draft(d),'a draft without the field stays valid') from base;
select pg_temp.ok(public.workspace_valid_review_draft(d||'{"activityLimits":"Walking up to 30 minutes, no heavy lifting"}'),'the field is valid') from base;
select pg_temp.ok(public.workspace_valid_review_draft(d||'{"activityLimits":"Walking only","medicines":[]}'),'with a regimen too') from base;
select pg_temp.ok(not public.workspace_valid_review_draft(d||'{"activityLimits":"   "}'),'blank is refused: absent means nothing recorded') from base;
select pg_temp.ok(not public.workspace_valid_review_draft(d||jsonb_build_object('activityLimits',repeat('x',501))),'over the limit is refused') from base;
select pg_temp.ok(not public.workspace_valid_review_draft(d||'{"activityLimits":5}'),'a number is refused') from base;
select pg_temp.ok(not public.workspace_valid_review_draft(d||'{"somethingElse":"x"}'),'an unknown key is still refused') from base;
select pg_temp.ok(not public.workspace_valid_review_draft(d||'{"activityLimits":"Walking only","somethingElse":"x"}'),'the new key does not make room for another') from base;

-- 2. Zoe reads it from the published plan, not from a draft.
select pg_temp.ok(pg_get_functiondef('public.zoe_run_health_context(uuid[])'::regprocedure) like '%jsonb_strip_nulls(jsonb_build_object(''activityLimits'',nullif(left(public.workspace_js_trim(coalesce(p.draft->>''activityLimits''%','Zoe reads the published draft, and the key is absent when empty');
select pg_temp.ok(jsonb_strip_nulls(jsonb_build_object('activityLimits',null::text))='{}'::jsonb,'an empty value adds no key for the old strict schema');

-- 3. The event type, and what it does to the member's pathway.
-- 01 haemorrhagic only; 02 haemorrhagic and a heart attack; 03 recorder; 04 haemorrhagic with a therapy; 05 haemorrhagic with a goal; 06 haemorrhagic and TIA; 07 haemorrhagic and other.
insert into auth.users(id)select pg_temp.id(s) from unnest(array['01','02','03','04','05','06','07'])s;
insert into public.workspace_clinics(id,name)values(pg_temp.id('09'),'Synthetic LDL pilot clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('03'),'doctor','Dr Synthetic',pg_temp.id('09'));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)select pg_temp.id(s),pg_temp.id('03') from unnest(array['01','02','04','05','06','07'])s;
update public.ldl_goal_settings set ldl_goal_enabled=true where singleton;
insert into public.ldl_index_events(member_id,submission_id,event_type,source,recorded_by)values
 (pg_temp.id('01'),gen_random_uuid(),'haemorrhagic_stroke','doctor_entered',pg_temp.id('03')),
 (pg_temp.id('02'),gen_random_uuid(),'haemorrhagic_stroke','doctor_entered',pg_temp.id('03')),
 (pg_temp.id('02'),gen_random_uuid(),'acs_mi','doctor_entered',pg_temp.id('03'));
insert into public.ldl_index_events(member_id,submission_id,event_type,event_other,source,recorded_by)
 select pg_temp.id(s),gen_random_uuid(),'haemorrhagic_stroke',null,'doctor_entered',pg_temp.id('03') from unnest(array['04','05','06','07'])s
 union all select pg_temp.id('06'),gen_random_uuid(),'tia',null,'doctor_entered',pg_temp.id('03')
 union all select pg_temp.id('07'),gen_random_uuid(),'other','Fictional event','doctor_entered',pg_temp.id('03');
insert into public.ldl_lipid_therapies(member_id,submission_id,drug,dose,recorded_by)values(pg_temp.id('04'),gen_random_uuid(),'atorvastatin','40 mg',pg_temp.id('03'));
insert into public.ldl_goals(member_id,version,submission_id,category,threshold_mmol,reduction_rule,baseline_kind,reason,defaults_version,set_by)
 values(pg_temp.id('05'),1,gen_random_uuid(),'very_high',1.4,false,'unknown','FICTIONAL-GOAL-REASON','ldl-defaults-2026-11-02',pg_temp.id('03'));
select pg_temp.ok(public._ldl_pilot_excluded(pg_temp.id('01')),'a haemorrhagic stroke alone excludes');
select pg_temp.ok(public._member_ldl_read(pg_temp.id('01'))->>'inPathway'='false','and the member sees no pathway');
select pg_temp.ok(public._ldl_pilot_excluded(pg_temp.id('04')) and public._member_ldl_read(pg_temp.id('04'))->>'inPathway'='false','a therapy alone does not keep them in');
select pg_temp.ok(public._ldl_pilot_excluded(pg_temp.id('05')) and public._member_ldl_read(pg_temp.id('05'))->>'inPathway'='false','a goal alone does not keep them in');
select pg_temp.ok(public._ldl_pilot_excluded(pg_temp.id('07')),'an event of type other does not qualify');
select pg_temp.ok(not public._ldl_pilot_excluded(pg_temp.id('02')) and public._member_ldl_read(pg_temp.id('02'))->>'inPathway'='true','a heart attack as well: eligible');
select pg_temp.ok(not public._ldl_pilot_excluded(pg_temp.id('06')),'a TIA as well: eligible');
update public.ldl_index_events set removed_at=now(),removed_by=pg_temp.id('03') where member_id=pg_temp.id('06') and event_type='haemorrhagic_stroke';
select pg_temp.ok(not public._ldl_pilot_excluded(pg_temp.id('06')),'a removed event does not count');
select pg_temp.ok(not public._ldl_retest_eligible(pg_temp.id('01')),'excluded: no re-test request');
select pg_temp.ok(pg_get_functiondef('public._ldl_retest_eligible(uuid)'::regprocedure) like '%_ldl_pilot_excluded(p_member)%','the re-test eligibility reads the rule');
select pg_temp.ok(pg_get_functiondef('public.zoe_run_member_record(uuid[])'::regprocedure) like '%not public._ldl_pilot_excluded(r.member_id)%','excluded: no LDL record for Zoe, so no goal text or dates');
select pg_temp.ok(pg_get_functiondef('public.ldl_response_candidates(integer)'::regprocedure) like '%not public._ldl_pilot_excluded(k.user_id)%','excluded: no response candidate');
select pg_temp.ok(pg_get_functiondef('public.ldl_response_record(jsonb)'::regprocedure) like '%public._ldl_pilot_excluded(m)%','excluded: no response recorded');
select pg_temp.ok(not has_function_privilege('authenticated','public._ldl_pilot_excluded(uuid)','execute'),'internal only');
select pg_temp.ok(pg_get_functiondef('public.doctor_ldl_event_add(jsonb)'::regprocedure) like '%''tia'',''haemorrhagic_stroke'',''other''%','the doctor can record the type');
do $$begin
 begin insert into public.ldl_index_events(member_id,submission_id,event_type,source,recorded_by)values(pg_temp.id('01'),gen_random_uuid(),'stroke','doctor_entered',pg_temp.id('03'));
 exception when check_violation then return;end;
 raise exception 'FAIL: stroke types must not merge';
end$$;
rollback;
\echo zoe tasks 14-20 SQL: passed
