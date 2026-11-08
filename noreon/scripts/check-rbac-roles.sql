-- RBAC foundation (WP F: 20261108063420_rbac_roles_foundation, 20261108063720_member_caregivers_consents).
-- Rolled back; synthetic fixtures only.
-- Actors: 01 member A, 02 member B, 07 caregiver (invited phone), 08 another phone account; 03 family physician (clinic 10),
-- 04 cardiologist (clinic 11), 0d family physician (clinic 11), 05 admin, 06 nurse (clinic 10), 09 coordinator (clinic 10),
-- 0c coordinator (clinic 11).
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
-- true when the statement is refused with insufficient_privilege (42501), false when it runs.
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;
exception when insufficient_privilege then return true;end$$;
-- the SQLSTATE a statement raises, or 'ok'.
create function pg_temp.state(q text)returns text language plpgsql as $$begin execute q;return 'ok';
exception when others then return sqlstate;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('5ea0f000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.sid(n text)returns uuid language sql immutable as $$select('5ea0f000-0000-4000-8000-0000000001'||n)::uuid$$;
create function pg_temp.as_user(u text,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(u),'role','authenticated','session_id',pg_temp.sid(u),
  'amr',jsonb_build_array(jsonb_build_object('method',amr)))::text,true)$$;
create function pg_temp.audits(actor text,member text,role text,surface text)returns bigint language sql security definer as $$
 select count(*)from public.access_audit where actor_id=pg_temp.id(actor)and member_id=pg_temp.id(member)and actor_role=role and surface=$4$$;

insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n in('01','02','07','08')then '374990001'||n end,case when n in('01','02','07','08')then now()end
 from unnest(array['01','02','03','04','05','06','07','08','09','0c','0d'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.id(n),now(),now()from unnest(array['01','02','03','04','05','06','07','08','09','0c','0d'])n;
insert into public.workspace_clinics(id,name)values(pg_temp.id('10'),'Synthetic RBAC clinic A'),(pg_temp.id('11'),'Synthetic RBAC clinic B');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id('03'),'doctor','Synthetic family physician',pg_temp.id('10')),(pg_temp.id('05'),'admin','Synthetic admin',null),
 (pg_temp.id('06'),'nurse','Synthetic nurse',pg_temp.id('10')),(pg_temp.id('09'),'coordinator','Synthetic coordinator A',pg_temp.id('10')),
 (pg_temp.id('0c'),'coordinator','Synthetic coordinator B',pg_temp.id('11')),(pg_temp.id('0d'),'doctor','Synthetic doctor B',pg_temp.id('11'));
insert into public.workspace_staff(user_id,role,specialty,display_name,clinic_id)values(pg_temp.id('04'),'doctor','cardiologist','Synthetic cardiologist',pg_temp.id('11'));
insert into public.profiles(id,display_name,birth_date,biological_sex)values(pg_temp.id('01'),'Synthetic Anna Member','1960-01-01','female'),(pg_temp.id('02'),'Synthetic Bob Member','1958-01-01','male')
 on conflict(id)do update set display_name=excluded.display_name,birth_date=excluded.birth_date,biological_sex=excluded.biological_sex;
insert into public.patient_consents(user_id,version)values(pg_temp.id('01'),'patient-pilot-v1'),(pg_temp.id('02'),'patient-pilot-v1');
insert into public.patient_assessments(user_id)values(pg_temp.id('01')),(pg_temp.id('02'));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id('01'),pg_temp.id('03'),pg_temp.id('06')),(pg_temp.id('02'),pg_temp.id('0d'),null);

-- 1. Roles, specialty and their constraints --------------------------------------------------------------------------
select pg_temp.ok((select specialty from public.workspace_staff where user_id=pg_temp.id('03'))='family_physician','A doctor written without a specialty is a family physician');
select pg_temp.ok((select specialty from public.workspace_staff where user_id=pg_temp.id('09'))is null,'A coordinator has no specialty');
select pg_temp.ok(pg_temp.state($q$update public.workspace_staff set specialty='cardiologist' where user_id=pg_temp.id('06')$q$)='23514','A nurse cannot hold a specialty');
select pg_temp.ok(pg_temp.state($q$update public.workspace_staff set specialty='surgeon' where user_id=pg_temp.id('03')$q$)='23514','Only family_physician or cardiologist');
select pg_temp.ok(pg_temp.state($q$insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.id('08'),'coordinator','No clinic')$q$)='23514','A coordinator needs a clinic');
select pg_temp.ok(pg_temp.state($q$insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id('08'),'chief','X',pg_temp.id('10'))$q$)='23514','Unknown roles are refused');
select pg_temp.ok(pg_temp.state($q$insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,role,specialty)values('x@example.invalid','X',pg_temp.id('10'),pg_temp.id('05'),'nurse','cardiologist')$q$)='23514','An invitation specialty is for doctors only');

select pg_temp.as_user('05');set local role authenticated;
select pg_temp.ok((public.real_admin_reserve_staff_invitation(gen_random_uuid(),'cardio@example.invalid','Synthetic invited cardiologist',pg_temp.id('11'),'doctor','cardiologist'))->>'specialty'='cardiologist','Admin reserves a cardiologist invitation');
select pg_temp.ok((public.real_admin_reserve_staff_invitation(gen_random_uuid(),'gp@example.invalid','Synthetic invited GP',pg_temp.id('10'),'doctor'))->>'specialty'='family_physician','A five-argument doctor invitation is a family physician');
select pg_temp.ok((public.real_admin_reserve_staff_invitation(gen_random_uuid(),'coord@example.invalid','Synthetic invited coordinator',pg_temp.id('10'),'coordinator'))->>'role'='coordinator','Admin reserves a coordinator invitation');
select pg_temp.ok(pg_temp.state($q$select public.real_admin_reserve_staff_invitation(gen_random_uuid(),'bad@example.invalid','Bad',pg_temp.id('10'),'nurse','cardiologist')$q$)='22023','A nurse invitation with a specialty is refused');
reset role;

select pg_temp.as_user('04');set local role authenticated;
select pg_temp.ok((select r->>'specialty'='cardiologist' and r->>'role'='doctor' and r?'clinicId' and r?'name' and r?'id' from public.real_clinical_staff_identity()r),'The cardiologist identity is a doctor with its specialty');
reset role;
select pg_temp.as_user('09');set local role authenticated;
select pg_temp.ok((select r->>'role'='coordinator' and r->'specialty'='null'::jsonb from public.real_clinical_staff_identity()r),'The coordinator identity has role coordinator');
reset role;

-- 2. Assigned cardiologist -------------------------------------------------------------------------------------------
select pg_temp.ok(not public.staff_care_access(pg_temp.id('01'),pg_temp.id('04'),true),'Before assignment the cardiologist has no access');
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.assign_patient_case_cardiologist(pg_temp.id('01'),0,pg_temp.id('04'))$q$),'A doctor cannot assign a cardiologist');
reset role;
select pg_temp.as_user('05');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.assign_patient_case_cardiologist(pg_temp.id('01'),0,pg_temp.id('0d'))$q$),'A family physician cannot be assigned as cardiologist');
select pg_temp.ok(pg_temp.state($q$select public.assign_patient_case_cardiologist(pg_temp.id('01'),7,pg_temp.id('04'))$q$)='40001','A stale revision is refused');
select pg_temp.ok(public.assign_patient_case_cardiologist(pg_temp.id('01'),0,pg_temp.id('04'))=1,'Admin assigns the cardiologist and the revision moves');
reset role;
select pg_temp.ok(exists(select 1 from public.patient_clinical_case_events where user_id=pg_temp.id('01')and kind='cardiologist-assigned'and actor_id=pg_temp.id('05')),'The assignment is audited');
select pg_temp.as_user('04');select pg_temp.ok(public.staff_care_access(pg_temp.id('01'),pg_temp.id('04'),true),'The assigned cardiologist has the assigned doctor''s member access');
select pg_temp.ok(not public.staff_care_access(pg_temp.id('02'),pg_temp.id('04'),true),'Not for another member');
select pg_temp.ok(public._case_physician(pg_temp.id('01'),pg_temp.id('04'))='cardiologist','_case_physician names the cardiologist');
select pg_temp.ok(public._case_physician(pg_temp.id('02'),pg_temp.id('04'))is null,'_case_physician is null for an unassigned member');
select pg_temp.as_user('03');select pg_temp.ok(public._case_physician(pg_temp.id('01'),pg_temp.id('03'))='family_physician','_case_physician names the family physician');
select pg_temp.ok(public.staff_care_access(pg_temp.id('01'),pg_temp.id('03'),true),'The family physician keeps access');
select pg_temp.as_user('06');select pg_temp.ok(public._case_physician(pg_temp.id('01'),pg_temp.id('06'))is null,'A nurse is no physician');
select pg_temp.ok(public._case_physician(pg_temp.id('01'),pg_temp.id('04'))is null,'Without the cardiologist''s own session it is null');

-- 3. Coordinator: logistics only -------------------------------------------------------------------------------------
select pg_temp.as_user('09');select pg_temp.ok(not public.staff_care_access(pg_temp.id('01'),pg_temp.id('09'),true),'A coordinator has no clinical member access');
select pg_temp.ok(public._staff_coordination_access(pg_temp.id('01'),pg_temp.id('09')),'The clinic coordinator coordinates the member of their clinic');
select pg_temp.ok(not public._staff_coordination_access(pg_temp.id('02'),pg_temp.id('09')),'Not a member of another clinic');
select pg_temp.ok(public._case_physician(pg_temp.id('01'),pg_temp.id('09'))is null,'A coordinator is no physician');
set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.assign_patient_case_nurse(pg_temp.id('01'),1,null)$q$),'Coordinator cannot assign a nurse');
select pg_temp.ok(pg_temp.denied($q$select public.assign_patient_case_cardiologist(pg_temp.id('01'),1,null)$q$),'Coordinator cannot assign a cardiologist');
select pg_temp.ok(pg_temp.denied($q$select public.assign_patient_clinical_case(pg_temp.id('01'),1,pg_temp.id('03'))$q$),'Coordinator cannot assign a doctor');
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_history(pg_temp.id('01'))$q$),'Coordinator cannot read clinical history');
select pg_temp.ok(pg_temp.denied($q$select public.publish_patient_clinical_plan(pg_temp.id('01'),pg_temp.id('09'),1,repeat('a',32),'{}'::jsonb,gen_random_uuid())$q$),'Coordinator cannot publish a plan');
select pg_temp.ok(pg_temp.denied($q$select public.care_queue_inbox('physician','live')$q$),'Coordinator cannot read the physician queue');
reset role;
select pg_temp.ok((public.care_queue_raise(pg_temp.id('01'),'admin',null,'lab_booking_needed','synthetic-1',null,null,'{}'::jsonb,null,'rbac-check:1'))->>'ok'='true','An admin logistics task exists for member A');
select pg_temp.ok((public.care_queue_raise(pg_temp.id('02'),'admin',null,'lab_booking_needed','synthetic-1',null,null,'{}'::jsonb,null,'rbac-check:2'))->>'ok'='true','An admin logistics task exists for member B');
select pg_temp.as_user('09');set local role authenticated;
select pg_temp.ok((select jsonb_array_length(r->'tasks')=1 and r#>>'{tasks,0,memberId}'=pg_temp.id('01')::text from public.care_queue_inbox('admin','live')r),'Coordinator reads the admin queue of their clinic only');
reset role;
select pg_temp.ok(pg_temp.audits('09','01','coordinator','care_queue')=1,'The coordinator read is recorded with actor_role coordinator');
select pg_temp.as_user('0c');set local role authenticated;
select pg_temp.ok((select jsonb_array_length(r->'tasks')=1 and r#>>'{tasks,0,memberId}'=pg_temp.id('02')::text from public.care_queue_inbox('admin','live')r),'The other clinic''s coordinator sees only their member');
reset role;
select pg_temp.as_user('09');set local role authenticated;
select pg_temp.ok(jsonb_typeof((public.patient_coordination_queue(null,'active',null,null,50))->'tasks')='array','Coordinator reads coordination tasks');
reset role;

insert into public.doctor_completion_capabilities(singleton,enabled)values(true,true)on conflict(singleton)do update set enabled=true;
update public.patient_clinical_cases set review=jsonb_build_object('consultation',jsonb_build_object('decision','required'),'preparedAt',now()-interval '1 day')where user_id in(pg_temp.id('01'),pg_temp.id('02'));
select pg_temp.as_user('09');set local role authenticated;
select pg_temp.ok((select jsonb_array_length(r->'cases')=1 and r#>>'{cases,0,memberId}'=pg_temp.id('01')::text from public.admin_consultations_to_arrange()r),'Coordinator lists consultations of their clinic only');
create temp table hold as select (r#>>'{cases,0,since}')since from public.admin_consultations_to_arrange()r;
select pg_temp.ok(public.admin_consultation_arrange_command(jsonb_build_object('version','consultation-arrange-v1','submissionId',gen_random_uuid(),'memberId',pg_temp.id('01'),
 'since',(select since from hold),'previous',null,'scheduledAt',now()+interval '2 days','channel','phone'))->>'status'='arranged','Coordinator arranges a consultation for their clinic');
select pg_temp.ok(pg_temp.denied($q$select public.admin_consultation_arrange_command(jsonb_build_object('version','consultation-arrange-v1','submissionId',gen_random_uuid(),'memberId',pg_temp.id('02'),
 'since',now(),'previous',null,'scheduledAt',now()+interval '2 days','channel','phone'))$q$),'Not for another clinic');
reset role;
select pg_temp.ok(pg_temp.audits('09','01','coordinator','consultation_arrange')=1,'The arrangement is recorded for the coordinator');
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.admin_consultations_to_arrange()$q$),'A doctor still cannot list consultations to arrange');
reset role;

-- 4. Consents ----------------------------------------------------------------------------------------------------------
select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok((public.member_consent_set('data_processing',true,'consent-draft-1',repeat('a',64),'tap','chat_card'))->>'changed'='true','Member grants data processing');
select pg_temp.ok((public.member_consent_set('data_processing',true,'consent-draft-1',repeat('a',64),'tap','chat_card'))->>'changed'='false','The same decision again changes nothing');
select pg_temp.ok((public.member_consent_set('research',false,'consent-draft-1',repeat('b',64),'voice','chat_card'))->>'ok'='true','Member declines research by voice');
select pg_temp.ok((public.member_consent_set('caregiver_sharing',true,'consent-draft-1',repeat('a',64),'tap','chat_card'))->>'code'='invalid','Caregiver sharing is decided on the caregiver card only');
select pg_temp.ok((public.member_consent_set('data_processing',true,'Bad Version',repeat('a',64),'tap','chat_card'))->>'code'='invalid','The wording version is validated');
select pg_temp.ok((public.member_consent_set('data_processing',false,'consent-draft-1',repeat('a',64),'tap','chat_card'))->>'changed'='true','Member withdraws data processing');
select pg_temp.ok((select jsonb_array_length(r->'consents')=2 and exists(select 1 from jsonb_array_elements(r->'consents')c where c->>'kind'='data_processing'and c->>'granted'='false')from public.member_consents_current()r),'Current shows the latest per kind');
select pg_temp.ok(jsonb_array_length((public.member_consent_history())->'history')=3,'History keeps every decision');
select pg_temp.ok((select count(*)from public.member_consents)=3,'The member reads their own rows directly');
select pg_temp.ok(pg_temp.denied($q$insert into public.member_consents(member_id,kind,granted,wording_version,text_hash,method,source)values(pg_temp.id('01'),'research',true,'v',repeat('a',64),'tap','settings')$q$),'No direct writes');
reset role;
select pg_temp.as_user('02');set local role authenticated;
select pg_temp.ok((select count(*)from public.member_consents)=0,'Another member reads none of them');
reset role;
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.member_consents_current()$q$),'Staff accounts are not members');
reset role;
select pg_temp.ok(pg_temp.state($q$update public.member_consents set granted=true where member_id=pg_temp.id('01')$q$)='55000','Consents are append-only (update)');
select pg_temp.ok(pg_temp.state($q$delete from public.member_consents where member_id=pg_temp.id('01')$q$)='55000','Consents are append-only (delete)');

-- 5. Caregivers --------------------------------------------------------------------------------------------------------
select pg_temp.as_user('01');set local role authenticated;
create temp table link as select (r#>>'{link,id}')::uuid id,(r#>>'{link,revision}')::bigint revision from public.member_caregiver_invite(pg_temp.id('a1'),'Synthetic Carer','child','+37499000107',array['log_readings','view_readings'],'caregiver-draft-1',repeat('c',64),'tap')r;
select pg_temp.ok((select id from link)is not null,'Member invites a caregiver');
select pg_temp.ok((public.member_caregiver_invite(pg_temp.id('a1'),'Synthetic Carer','child','+37499000107',array['view_readings','log_readings'],'caregiver-draft-1',repeat('c',64),'tap'))->>'replayed'='true','The same request replays');
select pg_temp.ok((public.member_caregiver_invite(pg_temp.id('a1'),'Someone else','child','+37499000107',array['view_readings'],'caregiver-draft-1',repeat('c',64),'tap'))->>'code'='conflict','A changed request with the same id conflicts');
select pg_temp.ok((public.member_caregiver_invite(gen_random_uuid(),'Synthetic Carer','child','+37499000107',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap'))->>'code'='duplicate','One live link per phone');
select pg_temp.ok((public.member_caregiver_invite(gen_random_uuid(),'Synthetic Me','other','+37499000101',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap'))->>'code'='own_phone','Not the member''s own phone');
select pg_temp.ok((public.member_caregiver_invite(gen_random_uuid(),'X','friend','+37499000107',array['delete_everything'],'caregiver-draft-1',repeat('c',64),'tap'))->>'code'='invalid','Scopes are validated');
select pg_temp.ok((public.member_caregiver_invite(gen_random_uuid(),'Two','friend','+37499000201',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap'))->>'ok'='true'
 and(public.member_caregiver_invite(gen_random_uuid(),'Three','friend','+37499000202',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap'))->>'ok'='true','Up to three live links');
select pg_temp.ok((public.member_caregiver_invite(gen_random_uuid(),'Four','friend','+37499000203',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap'))->>'code'='limit','A fourth live link is refused');
select pg_temp.ok((select count(*)from public.member_consents where kind='caregiver_sharing'and granted)=1,'The invitation records the caregiver-sharing consent once');
reset role;
-- An invitation not accepted within 14 days expires: it no longer counts toward the limit or blocks the same number.
update public.member_caregivers set invited_at=now()-interval '15 days' where member_id=pg_temp.id('01')and phone='+37499000202';
select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok(exists(select 1 from jsonb_array_elements((public.member_caregivers_read())->'links')l where l->>'phone'='+37499000202'and l->>'status'='expired'),'The member sees the old invitation as expired');
select pg_temp.ok((public.member_caregiver_update_scopes((select id from public.member_caregivers where phone='+37499000202'and status='pending'),1,array['view_readings'],'caregiver-draft-1',repeat('c',64),'tap'))->>'code'='closed','An expired invitation cannot be changed');
select pg_temp.ok((public.member_caregiver_invite(gen_random_uuid(),'Three again','friend','+37499000202',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap'))->>'ok'='true','The same number can be invited again once the old invitation expired');
select pg_temp.ok((public.member_caregiver_invite(gen_random_uuid(),'Four','friend','+37499000203',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap'))->>'code'='limit','Three live links again: the limit holds');
reset role;

select pg_temp.as_user('08');set local role authenticated;
select pg_temp.ok(jsonb_array_length((public.caregiver_invitations_read())->'invitations')=0,'Another phone sees no invitation');
select pg_temp.ok((public.caregiver_invitation_accept((select id from link)))->>'code'='not_found','Another phone cannot accept it');
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_bp_log(pg_temp.id('01'),gen_random_uuid(),130,80,null,now())$q$),'A stranger cannot log readings');
select pg_temp.ok((select count(*)from public.member_caregivers)=0,'A stranger reads no link rows');
reset role;

select pg_temp.as_user('07');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_readings_read(pg_temp.id('01'))$q$),'A pending invitation grants nothing');
select pg_temp.ok((select jsonb_array_length(r->'invitations')=1 and r#>>'{invitations,0,memberFirstName}'='Synthetic' from public.caregiver_invitations_read()r),'The invited phone sees the invitation with the first name only');
select pg_temp.ok((public.caregiver_invitation_accept((select id from link)))->>'status'='active','The invited phone accepts');
select pg_temp.ok((public.caregiver_invitation_accept((select id from link)))->>'changed'='false','Accepting again changes nothing');
select pg_temp.ok((select jsonb_array_length(r->'members')=1 and r#>>'{members,0,firstName}'='Synthetic' from public.caregiver_members_read()r),'The caregiver lists the member');
select pg_temp.ok((select count(*)from public.member_caregivers)=1,'The caregiver reads their own link row');
select pg_temp.ok((public.caregiver_bp_log(pg_temp.id('01'),pg_temp.id('b1'),134,84,70,now()-interval '5 minutes'))->>'ok'='true','With log_readings the caregiver logs a reading');
select pg_temp.ok((public.caregiver_bp_log(pg_temp.id('01'),pg_temp.id('b1'),134,84,70,now()-interval '5 minutes'))->>'replayed'='true','The same request replays');
select pg_temp.ok((public.caregiver_bp_log(pg_temp.id('01'),pg_temp.id('b1'),135,84,70,now()-interval '5 minutes'))->>'code'='conflict','A replay with different values conflicts');
select pg_temp.ok((public.caregiver_bp_log(pg_temp.id('01'),pg_temp.id('b2'),60,90,null,now()))->>'code'='invalid','Impossible values are refused');
select pg_temp.ok((public.caregiver_bp_log(pg_temp.id('01'),pg_temp.id('b3'),185,95,null,now()-interval '2 minutes'))->>'ok'='true','The caregiver logs a high reading');
select pg_temp.ok(jsonb_array_length((public.caregiver_readings_read(pg_temp.id('01')))->'readings')=2,'With view_readings the caregiver reads readings');
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_plan_read(pg_temp.id('01'))$q$),'Without view_plan the plan is refused');
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_readings_read(pg_temp.id('02'))$q$),'Another member is refused');
select pg_temp.ok(pg_temp.denied($q$select public.member_caregiver_revoke((select id from link),1)$q$)
 or (public.member_caregiver_revoke((select id from link),1))->>'code'='not_found','The caregiver cannot revoke as the member');
reset role;
select pg_temp.ok((select entry_source from public.patient_measurements where user_id=pg_temp.id('01')and submission_id=pg_temp.id('b1'))='caregiver_reported','The reading carries caregiver provenance');
-- The typed-reading safety net: a high caregiver reading raises the nurse verification task, as a member-typed one does.
select pg_temp.ok(exists(select 1 from public.care_queue_tasks t join public.patient_measurements m on t.source_ref='typed-bp:'||m.id::text
 where m.user_id=pg_temp.id('01')and m.submission_id=pg_temp.id('b3')and t.queue='nurse'and t.reason_code='bp_member_reported_high'and t.suggested_action='verify_bp'
  and t.summary->>'entrySource'='caregiver_reported'and t.summary->>'text'='Check reported BP 185/95 mmHg. Caregiver-reported, not verified'),'A high caregiver reading raises the nurse verification task');
select pg_temp.ok(not exists(select 1 from public.care_queue_tasks t join public.patient_measurements m on t.source_ref='typed-bp:'||m.id::text
 where m.user_id=pg_temp.id('01')and m.submission_id=pg_temp.id('b1')),'A normal caregiver reading raises no verification task');
-- And it is an unverified observation: never counted as measured BP evidence.
select pg_temp.ok((select bool_and(pg_get_functiondef(f::regprocedure)like '%entry_source is distinct from ''caregiver_reported''%')from unnest(array['public.pilot_gm_overview(date,date)','public._gp_report_source_body(uuid)',
 'public.doctor_programme_member(uuid)','public.zoe_run_health_context(uuid[])','public._required_evidence_sources(uuid,text)','public._bp_weekly_trend(uuid,timestamptz)'])f),'Measured-BP aggregates leave caregiver readings out');
select pg_temp.ok(pg_temp.audits('07','01','caregiver','caregiver_bp_log')=2 and pg_temp.audits('07','01','caregiver','caregiver_readings')=1,'Caregiver writes and read are in access_audit');
select pg_temp.ok((select count(*)from public.member_caregiver_events where member_id=pg_temp.id('01')and kind in('accepted','bp_logged','readings_read','members_read'))=5,'And in the caregiver trail');
-- A banned or locked member account shares nothing, whatever the link says.
update auth.users set banned_until=now()+interval '1 day' where id=pg_temp.id('01');
select pg_temp.as_user('07');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_readings_read(pg_temp.id('01'))$q$),'A banned member''s readings are refused');
reset role;
update auth.users set banned_until=null where id=pg_temp.id('01');
select pg_temp.ok(pg_temp.state($q$update public.member_caregiver_events set kind='revoked'$q$)='55000','The caregiver trail is append-only (update)');
select pg_temp.ok(pg_temp.state($q$delete from public.member_caregiver_events$q$)='55000','The caregiver trail is append-only (delete)');
select pg_temp.ok(exists(select 1 from public._audit_rows(now()-interval '1 hour',now()+interval '1 hour',null,pg_temp.id('01'),null)where source='caregiver'and action='bp_logged'),'The unified audit lists the caregiver write');
select pg_temp.ok(exists(select 1 from public._audit_rows(now()-interval '1 hour',now()+interval '1 hour',null,pg_temp.id('01'),null)where source='member_consent'),'The unified audit lists consent decisions');

select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok((public.member_caregiver_update_scopes((select id from link),99,array['view_plan'],'caregiver-draft-1',repeat('d',64),'tap'))->>'code'='stale','A stale scope change is refused');
select pg_temp.ok((public.member_caregiver_update_scopes((select id from link),1,array['view_plan'],'Bad Version',repeat('d',64),'tap'))->>'code'='invalid','A scope change needs the confirmed statement''s version and hash');
select pg_temp.ok((public.member_caregiver_update_scopes((select id from link),(select (l->>'revision')::bigint from jsonb_array_elements((public.member_caregivers_read())->'links')l where (l->>'id')::uuid=(select id from link)),array['view_plan'],'caregiver-draft-1',repeat('d',64),'tap'))->>'changed'='true','Member changes the scopes to the plan');
reset role;
select pg_temp.ok((select consent_text_hash=repeat('d',64)and consent_wording_version='caregiver-draft-1'from public.member_caregivers where id=(select id from link)),'The link holds the statement confirmed for the new scopes');
select pg_temp.ok((select source='caregiver_scopes'and granted and text_hash=repeat('d',64)from public.member_consents where member_id=pg_temp.id('01')and kind='caregiver_sharing'order by id desc limit 1),'The scope change records a caregiver-sharing consent for that statement');
select pg_temp.as_user('07');set local role authenticated;
select pg_temp.ok(not pg_temp.denied($q$select public.caregiver_plan_read(pg_temp.id('01'))$q$),'With view_plan the caregiver reads the plan');
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_bp_log(pg_temp.id('01'),gen_random_uuid(),130,80,null,now())$q$),'Without log_readings the reading is refused');
reset role;
select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok((public.member_caregiver_revoke((select id from link),(select (l->>'revision')::bigint from jsonb_array_elements((public.member_caregivers_read())->'links')l where (l->>'id')::uuid=(select id from link))))->>'changed'='true','Member revokes the caregiver');
reset role;
select pg_temp.ok(not public._caregiver_can(pg_temp.id('01'),pg_temp.id('07'),'view_plan'),'_caregiver_can is false once revoked');
select pg_temp.as_user('07');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_plan_read(pg_temp.id('01'))$q$),'A revoked caregiver is refused');
select pg_temp.ok(jsonb_array_length((public.caregiver_members_read())->'members')=0,'A revoked caregiver lists no member');
select pg_temp.ok((select count(*)from public.member_caregivers)=0,'A revoked caregiver no longer reads its link row');
reset role;
select pg_temp.as_user('01');set local role authenticated;
create temp table link2 as select (r#>>'{link,id}')::uuid id from public.member_caregiver_invite(gen_random_uuid(),'Synthetic Carer','child','+37499000107',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap')r;
reset role;
select pg_temp.as_user('07');set local role authenticated;
select pg_temp.ok((public.caregiver_invitation_decline((select id from link2)))->>'status'='declined','The invited phone declines a second invitation');
reset role;
select pg_temp.ok(not public._caregiver_can(pg_temp.id('01'),pg_temp.id('07'),'view_plan'),'A declined invitation grants nothing');
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.caregiver_invitations_read()$q$),'Staff accounts are not caregivers');
reset role;
-- Erasing a caregiver's account revokes its active links instead of failing on the link's shape.
select pg_temp.as_user('01');set local role authenticated;
create temp table link3 as select (r#>>'{link,id}')::uuid id from public.member_caregiver_invite(gen_random_uuid(),'Synthetic Friend','friend','+37499000108',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap')r;
reset role;
select pg_temp.as_user('08');set local role authenticated;
select pg_temp.ok((public.caregiver_invitation_accept((select id from link3)))->>'status'='active','Another caregiver accepts');
reset role;
select pg_temp.ok(pg_temp.state($q$delete from auth.users where id=pg_temp.id('08')$q$)='ok','The caregiver account can be erased');
select pg_temp.ok((select status='revoked'and caregiver_user_id is null and revoked_at is not null from public.member_caregivers where id=(select id from link3)),'Its active link is revoked');
select pg_temp.ok(exists(select 1 from public.member_caregiver_events where link_id=(select id from link3)and kind='revoked'and actor_kind='system'and actor_id is null),'The trail records a system revocation');

rollback;
\echo 'check-rbac-roles: ok'
