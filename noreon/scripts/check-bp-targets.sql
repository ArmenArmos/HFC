-- WP T: member_bp_targets (20261108080606_member_bp_targets.sql). Rolled back; synthetic fixtures only.
-- Actors: 01 member A, 02 member B, 07 caregiver of A with view_plan, 08 caregiver of A without it; 03 family physician of A
-- (clinic 10), 04 cardiologist of A (clinic 11), 0d family physician of B (clinic 11), 05 admin, 06 nurse of A (clinic 10),
-- 09 coordinator (clinic 10).
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;
exception when insufficient_privilege then return true;end$$;
create function pg_temp.state(q text)returns text language plpgsql as $$begin execute q;return 'ok';
exception when others then return sqlstate;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('5eb0f000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.sid(n text)returns uuid language sql immutable as $$select('5eb0f000-0000-4000-8000-0000000001'||n)::uuid$$;
create function pg_temp.as_user(u text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(u),'role','authenticated','session_id',pg_temp.sid(u),
  'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.audits(actor text,member text,surface text)returns bigint language sql security definer as $$
 select count(*)from public.access_audit where actor_id=pg_temp.id(actor)and member_id=pg_temp.id(member)and surface=$3$$;
-- A full command with defaults; the caller overrides fields.
create function pg_temp.cmd(sub text,expected int,extra jsonb default '{}')returns jsonb language sql as $$
 select jsonb_build_object('version','bp-target-v1','memberId',pg_temp.id('01'),'submissionId',('5eb0f000-0000-4000-8000-0000000002'||sub)::uuid,
  'expectedVersion',expected,'homeSystolicTarget',135,'homeDiastolicTarget',85,'alertHighSystolic',160,'alertHighDiastolic',100,'alertHighConsecutive',2,
  'alertLowSystolic',90,'alertLowPulse',50,'reason',null,'defaultsVersion','personal-bp-defaults-2026-11-08')||extra$$;

insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n in('01','02','07','08')then '374990002'||n end,case when n in('01','02','07','08')then now()end
 from unnest(array['01','02','03','04','05','06','07','08','09','0d'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.id(n),now(),now()from unnest(array['01','02','03','04','05','06','07','08','09','0d'])n;
insert into public.workspace_clinics(id,name)values(pg_temp.id('10'),'Synthetic BP target clinic A'),(pg_temp.id('11'),'Synthetic BP target clinic B');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id('03'),'doctor','Synthetic family physician',pg_temp.id('10')),(pg_temp.id('05'),'admin','Synthetic admin',null),
 (pg_temp.id('06'),'nurse','Synthetic nurse',pg_temp.id('10')),(pg_temp.id('09'),'coordinator','Synthetic coordinator',pg_temp.id('10')),
 (pg_temp.id('0d'),'doctor','Synthetic doctor B',pg_temp.id('11'));
insert into public.workspace_staff(user_id,role,specialty,display_name,clinic_id)values(pg_temp.id('04'),'doctor','cardiologist','Synthetic cardiologist',pg_temp.id('11'));
insert into public.profiles(id,display_name)values(pg_temp.id('01'),'Synthetic Anna'),(pg_temp.id('02'),'Synthetic Bob')on conflict(id)do update set display_name=excluded.display_name;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,assigned_cardiologist_id)values
 (pg_temp.id('01'),pg_temp.id('03'),pg_temp.id('06'),pg_temp.id('04')),(pg_temp.id('02'),pg_temp.id('0d'),null,null);
insert into public.member_caregivers(member_id,caregiver_user_id,request_id,phone,display_name,relationship,scopes,status,consent_wording_version,consent_text_hash,accepted_at)values
 (pg_temp.id('01'),pg_temp.id('07'),gen_random_uuid(),'+37499000207','Synthetic Carer','child',array['view_plan'],'active','caregiver-consent-draft-1',repeat('c',64),now()),
 (pg_temp.id('01'),pg_temp.id('08'),gen_random_uuid(),'+37499000208','Synthetic Other','friend',array['log_readings'],'active','caregiver-consent-draft-1',repeat('c',64),now());

-- 1. Reads before any target -----------------------------------------------------------------------------------------
select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok(public.member_bp_target_read()->'target'='null'::jsonb,'No target yet: the member reads null (defaults apply)');
reset role;

-- 2. Only the assigned family physician or cardiologist may set ------------------------------------------------------
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_set(pg_temp.cmd('01',0))$q$),'A nurse cannot set targets, even assigned');
reset role;
select pg_temp.as_user('09');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_set(pg_temp.cmd('01',0))$q$),'A coordinator cannot set targets');
reset role;
select pg_temp.as_user('05');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_set(pg_temp.cmd('01',0))$q$),'An admin cannot set targets');
reset role;
select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_set(pg_temp.cmd('01',0))$q$),'The member cannot set targets');
reset role;
select pg_temp.as_user('07');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_set(pg_temp.cmd('01',0))$q$),'A caregiver cannot set targets');
reset role;
select pg_temp.as_user('0d');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_set(pg_temp.cmd('01',0))$q$),'Another member''s doctor cannot set targets');
reset role;
select pg_temp.ok(not exists(select 1 from public.member_bp_targets),'Nothing was written by a refused caller');

select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('01',0))=jsonb_build_object('status','saved','targetVersion',1),'The family physician confirms the defaults as version 1');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('01',0))->>'status'='replayed','The same submission replays');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('02',0))->>'status'='stale','A form built on version 0 is stale now');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('03',1))->>'status'='invalid','A later version needs a reason');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('04',1,'{"reason":"x","homeSystolicTarget":200}'))->>'status'='invalid','Implausible target refused');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('05',1,'{"reason":"x","alertHighSystolic":130}'))->>'status'='invalid','The alert must be above the target');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('06',1,'{"reason":"x","alertLowSystolic":140}'))->>'status'='invalid','The low alert must be below the target');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('07',1,'{"reason":"x","alertHighSystolic":190}'))->>'status'='invalid','No personal alert above the crisis cut');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('08',1,'{"reason":"x","homeSystolicTarget":130.5}'))->>'status'='invalid','Whole numbers only');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('09',1,'{"reason":"x","extra":1}'))->>'status'='invalid','Strict keys');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('0a',1)-'alertLowPulse'||'{"reason":"x"}')->>'status'='invalid','Every number is required');
reset role;
select pg_temp.as_user('04');set local role authenticated;
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('0b',1,'{"reason":"Secondary prevention after MI","homeSystolicTarget":130,"homeDiastolicTarget":80,"alertHighSystolic":150,"alertHighDiastolic":95}'))
 =jsonb_build_object('status','saved','targetVersion',2),'The assigned cardiologist sets version 2');
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('0b',1,'{"reason":"Secondary prevention after MI","homeSystolicTarget":130,"homeDiastolicTarget":80,"alertHighSystolic":150,"alertHighDiastolic":95}'))->>'status'='replayed','Replay by the same physician');
reset role;
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(public.doctor_bp_target_set(pg_temp.cmd('0b',2,'{"reason":"x"}'))->>'status'='stale','Another physician''s submission id is never a replay');
reset role;
select pg_temp.ok((select array_agg(set_by_role order by version)from public.member_bp_targets where member_id=pg_temp.id('01'))=array['family_physician','cardiologist'],'Each version names the physician''s role');
select pg_temp.ok((select reason from public.member_bp_targets where member_id=pg_temp.id('01')and version=1)is null and(select defaults_version from public.member_bp_targets where version=1 and member_id=pg_temp.id('01'))='personal-bp-defaults-2026-11-08','Defaults version stored');

-- 3. Versions are immutable --------------------------------------------------------------------------------------------
select pg_temp.ok(pg_temp.state($q$update public.member_bp_targets set home_systolic_target=120 where member_id=pg_temp.id('01')$q$)='55000','A version cannot be changed');
select pg_temp.ok(pg_temp.state($q$delete from public.member_bp_targets where member_id=pg_temp.id('01')$q$)='55000','A version cannot be deleted');
select pg_temp.ok(pg_temp.state($q$insert into public.member_bp_targets(member_id,version,submission_id,home_systolic_target,home_diastolic_target,alert_high_systolic,alert_high_diastolic,alert_low_systolic,alert_low_pulse,set_by,set_by_role,defaults_version)
 values(pg_temp.id('01'),3,gen_random_uuid(),130,80,150,95,90,50,pg_temp.id('03'),'family_physician','d')$q$)='23514','A later version without a reason fails the table check');
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select * from public.member_bp_targets$q$),'No direct table read');
reset role;

-- 4. Audited: case events and access_audit ---------------------------------------------------------------------------
select pg_temp.ok((select count(*)from public.patient_clinical_case_events where user_id=pg_temp.id('01')and kind='bp-target-set')=2,'Each saved version is a case event');
select pg_temp.ok(pg_temp.audits('03','01','bp_target_set')=1 and pg_temp.audits('04','01','bp_target_set')=1,'Each save writes access_audit');

-- 5. Reads: care team, member, caregiver with view_plan ----------------------------------------------------------------
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok((select r->>'canSet'='true' and r->>'role'='family_physician' and (r#>>'{current,version}')::int=2 and r#>>'{current,setByRole}'='cardiologist'
 and jsonb_array_length(r->'history')=2 and r#>>'{current,alertHighSystolic}'='150' from public.doctor_bp_target_read(pg_temp.id('01'))r),'The family physician reads every field and may set');
reset role;
select pg_temp.as_user('04');set local role authenticated;
select pg_temp.ok((public.doctor_bp_target_read(pg_temp.id('01')))->>'role'='cardiologist','The cardiologist reads as cardiologist');
reset role;
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ok((select r->>'canSet'='false' and r->'role'='null'::jsonb and (r#>>'{current,homeSystolicTarget}')::int=130 from public.doctor_bp_target_read(pg_temp.id('01'))r),'The assigned nurse reads but may not set');
reset role;
select pg_temp.as_user('09');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_read(pg_temp.id('01'))$q$),'A coordinator never reads targets');
reset role;
select pg_temp.as_user('05');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_read(pg_temp.id('01'))$q$),'An admin does not read targets here');
reset role;
select pg_temp.as_user('0d');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_bp_target_read(pg_temp.id('01'))$q$),'Another member''s doctor cannot read');
reset role;
select pg_temp.ok(pg_temp.audits('03','01','bp_target')=1 and pg_temp.audits('06','01','bp_target')=1 and pg_temp.audits('09','01','bp_target')=0,'Staff reads are audited, refusals are not');

select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok((select (r#>>'{target,homeSystolicTarget}')::int=130 and (r#>>'{target,homeDiastolicTarget}')::int=80 and not(r->'target'?'alertHighSystolic') and not(r->'target'?'reason')
 from public.member_bp_target_read()r),'The member reads their own target, without the care team''s alert settings');
reset role;
select pg_temp.as_user('02');set local role authenticated;
select pg_temp.ok(public.member_bp_target_read()->'target'='null'::jsonb,'Another member reads only their own');
reset role;
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.member_bp_target_read()$q$),'Staff are no member');
reset role;
select pg_temp.as_user('07');set local role authenticated;
select pg_temp.ok((public.caregiver_bp_target_read(pg_temp.id('01')))#>>'{target,homeSystolicTarget}'='130','A caregiver with view_plan reads the target');
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_bp_target_read(pg_temp.id('02'))$q$),'Not another member''s');
reset role;
select pg_temp.as_user('08');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_bp_target_read(pg_temp.id('01'))$q$),'A caregiver without view_plan cannot');
reset role;
select pg_temp.ok((select count(*)from public.access_audit where actor_id=pg_temp.id('07')and actor_role='caregiver'and surface='caregiver_bp_target')=1
 and exists(select 1 from public.member_caregiver_events where actor_id=pg_temp.id('07')and kind='plan_read'),'The caregiver read is audited in both trails');

-- 6. Service read ------------------------------------------------------------------------------------------------------
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at,source,entry_source)values
 (pg_temp.id('01'),gen_random_uuid(),151,96,70,now()-interval '1 day','manual','caregiver_reported'),(pg_temp.id('01'),gen_random_uuid(),152,90,null,now()-interval '1 hour','manual',null),
 (pg_temp.id('01'),gen_random_uuid(),150,90,null,now()-interval '40 days','manual',null);
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.bp_personal_context(pg_temp.id('01'),14)$q$),'The service read is not for sessions');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((select (r#>>'{target,version}')::int=2 and jsonb_array_length(r->'readings')=2 and r#>>'{readings,0,entrySource}'='caregiver_reported' and not(r->'target'?'byYou')
 from public.bp_personal_context(pg_temp.id('01'),14)r),'Target and the last 14 days of readings, oldest first, with their entry source');
select pg_temp.ok(public.bp_personal_context(pg_temp.id('02'),14)->'target'='null'::jsonb,'No target: null, so the defaults apply');
select pg_temp.ok(pg_temp.state($q$select public.bp_personal_context(pg_temp.id('01'),0)$q$)='22023','Window bounded');
reset role;

-- 7. The assigned cardiologist on the LDL goal and the care plan; nurses never ------------------------------------------
update public.ldl_goal_settings set ldl_goal_enabled=true where singleton;
select pg_temp.as_user('04');set local role authenticated;
select pg_temp.ok((public.doctor_ldl_read(pg_temp.id('01')))->>'enabled'='true','The cardiologist reads the LDL record');
select pg_temp.ok((public.doctor_ldl_goal_set(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.id('01'),'submissionId',gen_random_uuid(),'expectedVersion',0,
 'category','very_high','thresholdMmol',1.4,'reductionRule',false,'baselineKind','unknown','defaultsVersion','ldl-defaults-2026-11-02')))->>'status'='saved','The cardiologist sets the LDL goal');
select pg_temp.ok(pg_temp.denied($q$select public.doctor_ldl_event_add(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.id('01'),'submissionId',gen_random_uuid(),'type','acs_mi','source','doctor_entered'))$q$),
 'Events stay with the assigned doctor');
reset role;
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.doctor_ldl_goal_set(jsonb_build_object('version','ldl-goal-v1','memberId',pg_temp.id('01'),'submissionId',gen_random_uuid(),'expectedVersion',1,
 'category','very_high','thresholdMmol',1.4,'reductionRule',false,'baselineKind','unknown','defaultsVersion','ldl-defaults-2026-11-02','reason','x'))$q$),'A nurse never sets the LDL goal');
select pg_temp.ok(pg_temp.denied($q$select public.doctor_ldl_read(pg_temp.id('01'))$q$),'A nurse does not read the doctor LDL record');
reset role;
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok((public.doctor_ldl_read(pg_temp.id('01')))#>>'{goals,0,version}'='1','The family physician still reads it, and sees the cardiologist''s goal');
reset role;
-- Plan review and publication: the physician check passes for the cardiologist and fails for anyone else. The case is not
-- ready (no completed questionnaire), so an authorised physician reaches that later refusal instead of 42501.
create temp table plan_case as select c.revision,public.patient_clinical_evidence(c.user_id)->>'token' token from public.patient_clinical_cases c where c.user_id=pg_temp.id('01');
grant select on plan_case to authenticated,service_role;
select pg_temp.as_user('04');set local role authenticated;
select pg_temp.ok(pg_temp.state($q$select public.patient_clinical_case_snapshot(pg_temp.id('01'))$q$)='ok','The cardiologist reads the review snapshot');
select pg_temp.ok(pg_temp.state($q$select public.save_patient_clinical_draft(pg_temp.id('01'),(select revision from plan_case),(select token from plan_case),'{}'::jsonb)$q$) not in('42501','ok'),'The cardiologist passes the draft physician check');
select pg_temp.ok(pg_temp.state($q$select public.doctor_regimen_review(pg_temp.id('01'))$q$)<>'42501','The cardiologist reads the regimen review');
reset role;
select pg_temp.as_user('0d');set local role authenticated;
select pg_temp.ok(pg_temp.state($q$select public.patient_clinical_case_snapshot(pg_temp.id('01'))$q$)='42501','Another member''s doctor cannot');
select pg_temp.ok(pg_temp.state($q$select public.save_patient_clinical_draft(pg_temp.id('01'),(select revision from plan_case),(select token from plan_case),'{}'::jsonb)$q$)='42501','Another doctor cannot draft');
reset role;
select pg_temp.as_user('06');set local role authenticated;
select pg_temp.ok(pg_temp.state($q$select public.save_patient_clinical_draft(pg_temp.id('01'),(select revision from plan_case),(select token from plan_case),'{}'::jsonb)$q$)='42501','A nurse never drafts a plan');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(pg_temp.state($q$select public.publish_patient_clinical_plan(pg_temp.id('01'),pg_temp.id('06'),(select revision from plan_case),(select token from plan_case),'{}'::jsonb,gen_random_uuid())$q$)='42501','A nurse never publishes a plan');
select pg_temp.ok(pg_temp.state($q$select public.publish_patient_clinical_plan(pg_temp.id('01'),pg_temp.id('0d'),(select revision from plan_case),(select token from plan_case),'{}'::jsonb,gen_random_uuid())$q$)='42501','Another doctor never publishes');
select pg_temp.ok(pg_temp.state($q$select public.publish_patient_clinical_plan(pg_temp.id('01'),pg_temp.id('04'),(select revision from plan_case),(select token from plan_case),'{}'::jsonb,gen_random_uuid())$q$) not in('42501','ok'),'The cardiologist passes the publication physician check');
select pg_temp.ok(pg_temp.state($q$select public.publish_patient_clinical_plan(pg_temp.id('01'),pg_temp.id('03'),(select revision from plan_case),(select token from plan_case),'{}'::jsonb,gen_random_uuid())$q$) not in('42501','ok'),'The family physician still passes it');
reset role;
select 'check-bp-targets: ok' as result;
rollback;
