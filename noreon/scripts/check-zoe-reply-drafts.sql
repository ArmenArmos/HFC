-- Zoe structured reply drafts (20261018213357): the switch, zoe_run_plan (service only, current publication only),
-- zoe_run_record_reply_draft (started runs only, every quote word for word from the current published plan, the
-- exact medicine line, the plan unchanged since the claim, once per run), the assigned doctor's read (planCurrent,
-- access audit) and grants. Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
grant execute on function pg_temp.denied(text)to authenticated,anon,service_role;
create function pg_temp.plan(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_plan(array[run]);reset role;return j->0;end$$;
create function pg_temp.rec(run uuid,r jsonb)returns text language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_record_reply_draft(run,r);reset role;return coalesce(j->>'code',j->>'ok');end$$;
create function pg_temp.doctor(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user('5d000000-0000-4000-8000-000000000011','5d000000-0000-4000-8000-000000000031');set local role authenticated;j:=public.zoe_reply_drafts_for_doctor(m::uuid);reset role;return j;end$$;
-- A record for run R quoting items; plan id P.
create function pg_temp.r(p text,quoted jsonb,extra jsonb default '{}')returns jsonb language sql as $$
 select jsonb_build_object('version','zoe-reply-draft-1','planId',p,'planPublishedAt',null,'asked','The member asks about salt.','acknowledgementId','A1','acknowledgement','Thank you for your question.',
  'quoted',quoted,'doctorDecides','[]'::jsonb,'outsidePlan',false,'needsJudgement',false,'judgementReasons','[]'::jsonb)||extra$$;

-- Member M (doctor D), other doctor O.
insert into auth.users(id,phone,phone_confirmed_at)values('5d000000-0000-4000-8000-000000000001','37499018501',now()),
 ('5d000000-0000-4000-8000-000000000011',null,null),('5d000000-0000-4000-8000-000000000012',null,null);
insert into public.workspace_clinics(id,name)values('5d000000-0000-4000-8000-000000000020','Synthetic draft clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('5d000000-0000-4000-8000-000000000011','doctor','Dr Draft','5d000000-0000-4000-8000-000000000020'),
 ('5d000000-0000-4000-8000-000000000012','doctor','Dr Other','5d000000-0000-4000-8000-000000000020');
insert into auth.sessions(id,user_id,created_at,updated_at)values('5d000000-0000-4000-8000-000000000031','5d000000-0000-4000-8000-000000000011',now(),now()),
 ('5d000000-0000-4000-8000-000000000032','5d000000-0000-4000-8000-000000000012',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('5d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-000000000011');
insert into public.conversations(id,member_id)values('5d000000-0000-4000-8000-000000000040','5d000000-0000-4000-8000-000000000001');
-- 20261023063508 (Codex A2-3): zoe_run_reserve and zoe_run_finish re-check Zoe consent; the fixture's members consent.
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version=coalesce(consent_wording_version,'zoe-consent-draft-1')where singleton;
insert into public.zoe_consents(member_id,kind,granted,wording_version)select c.member_id,'zoe_reads_messages',true,(select s.consent_wording_version from public.zoe_settings s where s.singleton)
 from public.conversations c where not public._zoe_consent_ok(c.member_id);
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)values
 ('5d000000-0000-4000-8000-000000000051','5d000000-0000-4000-8000-000000000040','5d000000-0000-4000-8000-000000000001',1,1,0,current_date,'started'),
 ('5d000000-0000-4000-8000-000000000052','5d000000-0000-4000-8000-000000000040','5d000000-0000-4000-8000-000000000001',2,2,0,current_date,'started');
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)values
 ('5d000000-0000-4000-8000-000000000053','5d000000-0000-4000-8000-000000000040','5d000000-0000-4000-8000-000000000001',3,3,0,current_date,'finished','draft_blocked','draft_discarded_by_guard',now());
-- An old and the current published plan.
insert into public.patient_care_plans(id,user_id,clinician,instructions,active,published_at)values
 ('5d000000-0000-4000-8000-000000000061','5d000000-0000-4000-8000-000000000001','Dr Draft','Old plan',false,now()-interval '9 days'),
 ('5d000000-0000-4000-8000-000000000062','5d000000-0000-4000-8000-000000000001','Dr Draft','Current plan',true,now()-interval '1 day');
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,published_at,draft)
select '5d000000-0000-4000-8000-000000000001',p,gen_random_uuid(),'5d000000-0000-4000-8000-000000000011',n,'fixture-token','{}','{}',case when n=1 then now()-interval '9 days' else now()-interval '1 day' end,
 jsonb_build_object('explanation',case when n=1 then 'Old explanation.' else 'Your home readings are above the level your doctor wants.' end,
  'instructions','Measure twice a day.'||chr(10)||'Reduce salt in your food.','followUp','Repeat the blood tests in 3 months.',
  'medicationName','Amlodipine','medicationDose','5 mg','medicationInstructions','After breakfast.','medicationTimes','["08:00"]'::jsonb)
from(values('5d000000-0000-4000-8000-000000000061'::uuid,1),('5d000000-0000-4000-8000-000000000062'::uuid,2))x(p,n);

-- 1. The switch and the plan read.
select pg_temp.ok((select structured_drafts_enabled=false from public.zoe_settings where singleton)is not false,'Switch defaults off');
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
select pg_temp.ok((pg_temp.plan('5d000000-0000-4000-8000-000000000051')->>'enabled')='false'and pg_temp.plan('5d000000-0000-4000-8000-000000000051')->'plan'='null'::jsonb,'Switch off: no plan read');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062','[]'))='structured_drafts_off','Switch off: nothing recorded');
update public.zoe_settings set structured_drafts_enabled=true;
select pg_temp.ok((pg_temp.plan('5d000000-0000-4000-8000-000000000051')#>>'{plan,planId}')='5d000000-0000-4000-8000-000000000062','Plan read: the current publication only');
select pg_temp.ok((pg_temp.plan('5d000000-0000-4000-8000-000000000051')#>>'{plan,instructions}')like 'Measure twice a day.%'and(pg_temp.plan('5d000000-0000-4000-8000-000000000051')#>'{plan,medicationTimes}')='["08:00"]','Plan read: member-facing fields');
select pg_temp.ok(not(pg_temp.plan('5d000000-0000-4000-8000-000000000051')->'plan' ?| array['evidence','review','reports']),'Plan read: no evidence or review');
select pg_temp.ok(pg_temp.plan('5d000000-0000-4000-8000-000000000053')is null,'Plan read: started runs only');
select pg_temp.as_user('5d000000-0000-4000-8000-000000000011','5d000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.zoe_run_plan(array['5d000000-0000-4000-8000-000000000051'::uuid])$q$),'Plan read: service role only');
reset role;

-- 2. Recording: verbatim quotes only.
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062','[{"id":"I2","kind":"instruction","text":"Reduce salt in your food and stop the pills."}]'))='quote_not_in_plan','An altered instruction is refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062','[{"id":"I2","kind":"explanation","text":"Reduce salt in your food."}]'))='quote_not_in_plan','A quote of the wrong field is refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062','[{"id":"M1","kind":"medicine","text":"Amlodipine 10 mg, 08:00, After breakfast."}]'))='quote_not_in_plan','A changed dose is refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062','[{"id":"E1","kind":"explanation","text":"Old explanation."}]'))='quote_not_in_plan','A quote of an older plan is refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000061','[]'))='plan_changed','A record for another plan is refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r(null,'[]'))='plan_changed','No plan id while a plan is published: refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000053',pg_temp.r('5d000000-0000-4000-8000-000000000062','[]'))='run_not_started','A finished run is refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062','"x"'))='record_invalid','A malformed record is refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062','[]',jsonb_build_object('asked','')))='record_invalid','An empty asked is refused');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062',
 '[{"id":"I2","kind":"instruction","text":"Reduce salt in your food."},{"id":"N1","kind":"next_step","text":"Repeat the blood tests in 3 months."},{"id":"M1","kind":"medicine","text":"Amlodipine 5 mg, 08:00, After breakfast."}]',
 '{"needsJudgement":true,"judgementReasons":["medicine_quoted"],"doctorDecides":["Whether a change is needed"]}'))='true','Verbatim quotes and the exact medicine line are recorded');
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000051',pg_temp.r('5d000000-0000-4000-8000-000000000062','[]'))='already_recorded','Once per run');
select pg_temp.ok((select plan_id='5d000000-0000-4000-8000-000000000062'and jsonb_array_length(quoted)=3 and needs_judgement and doctor_decides=array['Whether a change is needed']from public.zoe_reply_drafts where run_id='5d000000-0000-4000-8000-000000000051'),'Row stored');
select pg_temp.as_user('5d000000-0000-4000-8000-000000000011','5d000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.zoe_run_record_reply_draft('5d000000-0000-4000-8000-000000000052',null)$q$),'Recording: service role only');
reset role;


-- 2b. Codex RD-03: the draft must carry the clinical context the sources were recorded in.
create function pg_temp.finish(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 perform public.zoe_run_reserve(run,0.001,true,'[]'::jsonb,'medium','noreon-fake-deterministic-1');
 j:=public.zoe_run_finish(run,jsonb_build_object('outcome','draft_proposed','reason','structured_draft_passed_guards','summary','Synthetic summary.','draft','Thank you for your question.','guardReasons','[]'::jsonb,
  'redactionCount',0,'usage',jsonb_build_object('inputTokens',10,'outputTokens',10),'costUsd',0.0001,'latencyMs',1,'provider','noreon.fake','model','noreon-fake-deterministic-1','configVersion','reply-draft-check',
  'sealed',null,'events','[]'::jsonb,'tier','medium','tierReason','health','fallbackUsed',false));
 reset role;return j;end$$;
update public.conversations set version=2,draft_epoch=0 where id='5d000000-0000-4000-8000-000000000040';
select pg_temp.ok(pg_temp.rec('5d000000-0000-4000-8000-000000000052',pg_temp.r('5d000000-0000-4000-8000-000000000062','[{"id":"I2","kind":"instruction","text":"Reduce salt in your food."}]'))='true','Sources for run 2 recorded');
select pg_temp.ok((select clinical_revision=(select revision from public.patient_clinical_cases where user_id='5d000000-0000-4000-8000-000000000001')and source_token is not null from public.zoe_reply_drafts where run_id='5d000000-0000-4000-8000-000000000052'),'The clinical context is captured with the sources');
update public.patient_clinical_cases set revision=revision+1 where user_id='5d000000-0000-4000-8000-000000000001';
do $$begin perform pg_temp.finish('5d000000-0000-4000-8000-000000000052');raise exception 'FAIL: a finish after a clinical change was accepted';
exception when serialization_failure then null;end$$;
select pg_temp.ok((select state='started'and draft_id is null from public.zoe_runs where id='5d000000-0000-4000-8000-000000000052'),'Refused finish leaves no draft');
update public.patient_clinical_cases set revision=revision-1 where user_id='5d000000-0000-4000-8000-000000000001';
select pg_temp.ok((pg_temp.finish('5d000000-0000-4000-8000-000000000052')->>'outcome')='draft_proposed','Unchanged context: the draft is proposed');

-- 3. The doctor's read.
select pg_temp.ok((select jsonb_array_length(pg_temp.doctor('5d000000-0000-4000-8000-000000000001')->'drafts')=2),'Assigned doctor reads the draft sources');
select pg_temp.ok((pg_temp.doctor('5d000000-0000-4000-8000-000000000001')#>>'{drafts,0,planCurrent}')='true','planCurrent while the plan is current');
select pg_temp.ok(exists(select 1 from public.access_audit where member_id='5d000000-0000-4000-8000-000000000001'and surface='member_zoe_reply_drafts'and actor_id='5d000000-0000-4000-8000-000000000011'),'Doctor read is in the access audit');
update public.patient_care_plans set active=false where id='5d000000-0000-4000-8000-000000000062';
select pg_temp.ok((pg_temp.doctor('5d000000-0000-4000-8000-000000000001')#>>'{drafts,0,planCurrent}')='false','planCurrent false once the plan is retired');
select pg_temp.as_user('5d000000-0000-4000-8000-000000000012','5d000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.zoe_reply_drafts_for_doctor('5d000000-0000-4000-8000-000000000001')$q$),'Another doctor is refused');
reset role;
select pg_temp.as_user('5d000000-0000-4000-8000-000000000001','5d000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.zoe_reply_drafts_for_doctor('5d000000-0000-4000-8000-000000000001')$q$),'The member is refused');
select pg_temp.ok(pg_temp.denied($q$select * from public.zoe_reply_drafts$q$),'No direct table access');
reset role;

-- 4. Grants.
select pg_temp.ok(not has_function_privilege('anon','public.zoe_run_plan(uuid[])','execute')and not has_function_privilege('authenticated','public.zoe_run_plan(uuid[])','execute')
 and not has_function_privilege('authenticated','public.zoe_run_record_reply_draft(uuid,jsonb)','execute')and not has_function_privilege('anon','public.zoe_reply_drafts_for_doctor(uuid)','execute')
 and not has_function_privilege('service_role','public.zoe_reply_drafts_for_doctor(uuid)','execute'),'Function grants');
select pg_temp.ok(not has_table_privilege('authenticated','public.zoe_reply_drafts','select')and not has_table_privilege('service_role','public.zoe_reply_drafts','insert')and(select relrowsecurity from pg_class where oid='public.zoe_reply_drafts'::regclass),'Table: RLS on, no grants');
rollback;
\echo Zoe structured reply drafts: switch, plan read, verbatim-quote recording, doctor read, audit and grants pass.
