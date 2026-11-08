-- Clinic admin full access: who may read and edit which patients, the switch, care-team rules and
-- the audit trail. Fictional data; rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ca_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.ca_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection % for %',expected,q;
end$$;
-- ca1a: clinics A 0a, B 0b. Clinic portal: A admin 0c, A staff 0d, B admin 0e. Workspace: A doctors d1, d4 (active), d3 (inactive),
-- A nurse e1, B doctor d2, B nurse e2, Noreon admin aa.
-- Members: 01 (doctor d1, no booking), 02 (doctor d2), 03 (booked at A, doctor d2), 04 (unrelated), 05 (booked at A, no doctor).
create function pg_temp.ca_id(n text) returns uuid language sql immutable as $$select('ca1a0000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.as_user(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.ca_id(n),'role','authenticated','exp',4102444800,'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',('ca1a0000-0000-4000-8000-0000000001'||n)::uuid)::text,true),
  set_config('request.jwt.claim.sub',pg_temp.ca_id(n)::text,true)
$$;
create function pg_temp.sub()returns uuid language sql as $$select gen_random_uuid()$$;
grant execute on function pg_temp.ca_id(text),pg_temp.as_user(text),pg_temp.ca_assert(boolean,text),pg_temp.ca_reject(text,text),pg_temp.sub() to authenticated,anon,service_role;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.ca_id(n),case when n like '0_'and n<'06'then '3749908'||n||'77'end,case when n like '0_'and n<'06'then now()end
 from unnest(array['01','02','03','04','05','06','0c','0d','0e','d1','d2','d3','d4','e1','e2','aa'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select('ca1a0000-0000-4000-8000-0000000001'||n)::uuid,pg_temp.ca_id(n),now(),now()from unnest(array['01','0c','0d','0e','d1','aa'])n;
update public.profiles set display_name='Fictional Anahit '||right(id::text,2),birth_date='1975-04-05',biological_sex='female'
 where id in(pg_temp.ca_id('01'),pg_temp.ca_id('02'),pg_temp.ca_id('03'),pg_temp.ca_id('04'),pg_temp.ca_id('05'),pg_temp.ca_id('06'));
insert into public.workspace_clinics(id,name,address)values(pg_temp.ca_id('0a'),'Fictional clinic A','1 Fictional Street'),(pg_temp.ca_id('0b'),'Fictional clinic B','2 Fictional Street');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values
 (pg_temp.ca_id('d1'),'doctor','Fictional doctor A1',pg_temp.ca_id('0a'),true),(pg_temp.ca_id('d4'),'doctor','Fictional doctor A4',pg_temp.ca_id('0a'),true),
 (pg_temp.ca_id('d3'),'doctor','Fictional doctor A3 inactive',pg_temp.ca_id('0a'),false),(pg_temp.ca_id('e1'),'nurse','Fictional nurse A',pg_temp.ca_id('0a'),true),
 (pg_temp.ca_id('d2'),'doctor','Fictional doctor B',pg_temp.ca_id('0b'),true),(pg_temp.ca_id('e2'),'nurse','Fictional nurse B',pg_temp.ca_id('0b'),true),
 (pg_temp.ca_id('aa'),'admin','Fictional Noreon admin',null,true);
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role)values
 (pg_temp.ca_id('0c'),pg_temp.ca_id('0a'),'Fictional A admin','admin'),(pg_temp.ca_id('0d'),pg_temp.ca_id('0a'),'Fictional A staff','staff'),(pg_temp.ca_id('0e'),pg_temp.ca_id('0b'),'Fictional B admin','admin');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.ca_id('01'),pg_temp.ca_id('d1')),(pg_temp.ca_id('02'),pg_temp.ca_id('d2')),
 (pg_temp.ca_id('03'),pg_temp.ca_id('d2')),(pg_temp.ca_id('04'),null),(pg_temp.ca_id('05'),null),(pg_temp.ca_id('06'),null);
insert into public.clinic_portal_capabilities(singleton,clinic_admin_full_access)values(true,false)on conflict(singleton)do update set clinic_admin_full_access=false;
-- Bookings at A for 03 and 05, an answered questionnaire and a reading for 01. Inserted directly.
set local session_replication_role=replica;
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,proposed_arrangement,proposed_reservation_id,notice_id,current_arrangement)
select pg_temp.ca_id(x.a),pg_temp.ca_id(x.m),pg_temp.ca_id('5'||right(x.a,1)),'r'||x.a,0,'confirmed',jsonb_build_object('clinicId',pg_temp.ca_id('0a'),'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 30 minutes','coveredTestIds','[]'::jsonb),
 pg_temp.ca_id('6'||right(x.a,1)),pg_temp.ca_id('7'||right(x.a,1)),jsonb_build_object('clinicId',pg_temp.ca_id('0a'),'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 30 minutes','coveredTestIds','[]'::jsonb)
from(values('33','03'),('35','05'))x(a,m);
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state)
select pg_temp.ca_id('7'||right(x.a,1)),pg_temp.ca_id(x.a),0,pg_temp.ca_id('5'||right(x.a,1)),pg_temp.ca_id('6'||right(x.a,1)),pg_temp.ca_id('0a'),0,'portal','booking','accepted'from(values('33'),('35'))x(a);
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
select a.id,0,a.program_id,a.proposed_arrangement,a.notice_id,a.member_id from public.booking_appointments a where a.id in(pg_temp.ca_id('33'),pg_temp.ca_id('35'));
-- Member 06 asked clinic A for a visit and was declined: not one of A's members (review F3).
insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,proposed_arrangement,proposed_reservation_id,notice_id)
 values(pg_temp.ca_id('36'),pg_temp.ca_id('06'),pg_temp.ca_id('56'),'r36',0,'notification-pending',jsonb_build_object('clinicId',pg_temp.ca_id('0a'),'startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 30 minutes','coveredTestIds','[]'::jsonb),pg_temp.ca_id('66'),pg_temp.ca_id('76'));
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state)
 values(pg_temp.ca_id('76'),pg_temp.ca_id('36'),0,pg_temp.ca_id('56'),pg_temp.ca_id('66'),pg_temp.ca_id('0a'),0,'portal','booking','declined');
insert into public.patient_assessments(user_id,algorithm_version,answers,assessment_date,completed_at)
 values(pg_temp.ca_id('01'),'NRN-CLIN-ALG-001','{"q1.sex":{"value":"female"}}','2026-10-15',now());
insert into public.patient_measurements(user_id,measured_at,systolic,diastolic,pulse,source,submission_id)values(pg_temp.ca_id('01'),now()-interval '1 day',138,88,72,'manual',gen_random_uuid());
-- Every removed section has data: absence must not depend on empty tables.
insert into public.patient_care_plans(id,user_id,clinician,instructions)
 values(pg_temp.ca_id('90'),pg_temp.ca_id('01'),'Fictional doctor A1','PRIVATE PLAN');
insert into public.patient_care_medications(user_id,plan_id,name,dose,instructions,times,start_date)
 values(pg_temp.ca_id('01'),pg_temp.ca_id('90'),'PRIVATE MEDICINE','5 mg','PRIVATE MEDICINE INSTRUCTIONS',array[time '08:00'],'2026-10-15');
insert into public.patient_care_tests(id,user_id,title,status,ordered_by,ordered_at,source,source_label)
 values(pg_temp.ca_id('91'),pg_temp.ca_id('01'),'PRIVATE TEST','ordered','Fictional doctor A1',now(),'clinic','Fictional clinic A');
insert into public.patient_care_results(user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label)
 values(pg_temp.ca_id('01'),pg_temp.ca_id('91'),'PRIVATE RESULT',5,'mmol/L',now(),now(),'laboratory','Fictional lab');
insert into public.member_reported_documents(user_id,object_path,file_name,mime,size_bytes,sha256)
 values(pg_temp.ca_id('01'),pg_temp.ca_id('01')::text||'/private-document.pdf','PRIVATE DOCUMENT','application/pdf',100,repeat('a',64));
insert into public.patient_reports(user_id,object_path,file_name,mime,size_bytes,consent_version)
 values(pg_temp.ca_id('01'),pg_temp.ca_id('01')::text||'/private-report.pdf','PRIVATE REPORT','application/pdf',100,'patient-pilot-v1');
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.ca_id('92'),pg_temp.ca_id('01'),pg_temp.ca_id('e1'),'Fictional nurse A','nurse',pg_temp.ca_id('0a')),
 (pg_temp.ca_id('93'),pg_temp.ca_id('01'),pg_temp.ca_id('e2'),'Fictional nurse B','nurse',pg_temp.ca_id('0b'));
insert into public.patient_care_visit_entries(user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
 select pg_temp.ca_id('01'),v.id,gen_random_uuid(),0,'{"kind":"note","text":"PRIVATE VISIT NOTE"}'::jsonb,now()::text,now(),v.actor_id,v.actor_name,v.actor_role,v.clinic_id
 from public.patient_care_visits v where v.id in(pg_temp.ca_id('92'),pg_temp.ca_id('93'));
set local session_replication_role=origin;

-- 1. Switch off (the migration default): refused for the clinic admin.
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ca_assert(public.clinic_admin_patients(pg_temp.ca_id('0a'))->>'enabled'='false','Switch off: no patient list');
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))->>'enabled'='false'
 and public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))=jsonb_build_object('version','clinic-admin-record-v1','enabled',false),'Switch off: no record');
select pg_temp.ca_assert(public.clinic_admin_patient_profile_update(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),pg_temp.sub(),'{"name":"Fictional Anahit 01","birthDate":"1975-04-05"}','Changed','1976-01-01')->>'status'='disabled','Switch off: no profile edit');
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),0,pg_temp.ca_id('d4'),null)->>'status'='disabled','Switch off: no care team change');
reset role;
select pg_temp.ca_assert((select display_name='Fictional Anahit 01' from public.profiles where id=pg_temp.ca_id('01'))
 and(select assigned_doctor_id=pg_temp.ca_id('d1')from public.patient_clinical_cases where user_id=pg_temp.ca_id('01')),'Switch off wrote nothing');
update public.clinic_portal_capabilities set clinic_admin_full_access=true where singleton;

-- 2. Who: clinic staff, workspace staff, members and anon are refused.
select pg_temp.as_user('0d');
set local role authenticated;
select pg_temp.ca_reject($q$select public.clinic_admin_patients(pg_temp.ca_id('0a'))$q$,'42501');
select pg_temp.ca_reject($q$select public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))$q$,'42501');
select pg_temp.ca_reject($q$select public.clinic_admin_patient_profile_update(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),pg_temp.sub(),'{}','X','1976-01-01')$q$,'42501');
select pg_temp.ca_reject($q$select public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),0,pg_temp.ca_id('d4'),null)$q$,'42501');
reset role;
select pg_temp.as_user('d1');
set local role authenticated;
select pg_temp.ca_reject($q$select public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))$q$,'42501');
reset role;
select pg_temp.as_user('aa');
set local role authenticated;
select pg_temp.ca_reject($q$select public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))$q$,'42501');
reset role;
select pg_temp.as_user('01');
set local role authenticated;
select pg_temp.ca_reject($q$select public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))$q$,'42501');
select pg_temp.ca_reject($q$select public.clinic_admin_patient_profile_update(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),pg_temp.sub(),'{}','X','1976-01-01')$q$,'42501');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true),set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.ca_reject($q$select public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))$q$,'42501');
select pg_temp.ca_reject($q$select public.clinic_admin_patients(pg_temp.ca_id('0a'))$q$,'42501');
reset role;
-- The A admin cannot act as clinic B.
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ca_reject($q$select public.clinic_admin_patient_record(pg_temp.ca_id('0b'),pg_temp.ca_id('02'))$q$,'42501');

-- 3. Which patients: assigned to the clinic's staff or known through a booking; never other clinics', never staff.
select pg_temp.ca_assert((select array_agg(x->>'memberId' order by x->>'memberId')from jsonb_array_elements(public.clinic_admin_patients(pg_temp.ca_id('0a'))->'patients')x)
 =array[pg_temp.ca_id('01')::text,pg_temp.ca_id('03')::text,pg_temp.ca_id('05')::text],'Clinic A lists 01 (its doctor), 03 and 05 (booked), not 02 or 04');
select pg_temp.ca_assert((select array_agg(x->>'memberId' order by x->>'memberId')from jsonb_array_elements(public.clinic_admin_patients(pg_temp.ca_id('0a'),'0177')->'patients')x)
 =array[pg_temp.ca_id('01')::text],'Phone filter');
select pg_temp.ca_assert(jsonb_array_length(public.clinic_admin_patients(pg_temp.ca_id('0a'),'%%')->'patients')=0,'Wildcards are literal');
select pg_temp.ca_reject($q$select public.clinic_admin_patients(pg_temp.ca_id('0a'),'A')$q$,'22023');
create temp table ca_record on commit drop as select public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))r;
select pg_temp.ca_assert((select r->>'status'='ok'and r#>'{member,phone}'='null'::jsonb and r#>'{member,birthDate}'='null'::jsonb and r#>>'{member,sex}'='female'from ca_record),'Record: masked personal data and sex');
select pg_temp.ca_assert((select r->>'version'='clinic-admin-record-v1'
 and r->'assessment'='null'::jsonb and r->'plan'='null'::jsonb
 and r->'measurements'='[]'::jsonb and r->'tests'='[]'::jsonb and r->'results'='[]'::jsonb and r->'memberDocuments'='[]'::jsonb and r->'reports'='[]'::jsonb
 and r-array['version','enabled','status','member','consents','careTeam','bookings','visits','files','profileChanges','pendingRequests','assessment','measurements','tests','results','plan','memberDocuments','reports']='{}'::jsonb
 and r ?& array['member','consents','careTeam','bookings','visits','files','profileChanges','pendingRequests'] from ca_record),'Record: clinical keys present but always empty, no other keys');
select pg_temp.ca_assert((select jsonb_array_length(r->'visits')=1 and r#>>'{visits,0,visitId}'=pg_temp.ca_id('92')::text
 and r#>>'{visits,0,recordedBy}'='Fictional nurse A'and r#>>'{visits,0,role}'='nurse'
 and r#>>'{visits,0,visitedAt}'is not null
 and r#>'{visits,0,entries}'='[]'::jsonb and r#>'{visits,0,thisClinic}'='true'::jsonb
 and (r#>'{visits,0}')-array['visitId','visitedAt','clinicName','thisClinic','recordedBy','role','entries']='{}'::jsonb from ca_record),'Only this clinic visit, with no entries');
select pg_temp.ca_assert((select r::text not like '%PRIVATE%' from ca_record),'No private clinical values in the record');
select pg_temp.ca_assert((select r#>>'{careTeam,doctor,name}'='Fictional doctor A1'and(r#>>'{careTeam,editable}')::boolean from ca_record),'Record: care team, editable');
select pg_temp.ca_assert((select array_agg(x->>'name' order by x->>'name')=array['Fictional doctor A1','Fictional doctor A4']from ca_record,jsonb_array_elements(r#>'{careTeam,doctors}')x)
 and(select array_agg(x->>'name')=array['Fictional nurse A']from ca_record,jsonb_array_elements(r#>'{careTeam,nurses}')x),'Choices: only active staff of this clinic');
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('03'))#>>'{careTeam,editable}'='false','Booked member with another clinic''s doctor: visible, care team not editable');
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('02'))=jsonb_build_object('version','clinic-admin-record-v1','enabled',true,'status','refused'),'Another clinic''s patient is refused');
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('04'))->>'status'='refused','An unrelated member is refused');
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('06'))->>'status'='refused','A declined request does not open the record');
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('06'),0,pg_temp.ca_id('d1'),null)->>'status'='refused','A declined request does not allow taking the member');
select pg_temp.ca_assert(public.clinic_admin_patient_profile_update(pg_temp.ca_id('0a'),pg_temp.ca_id('06'),pg_temp.sub(),'{"name":"Fictional Anahit 06","birthDate":"1975-04-05"}','X','1975-04-05')->>'status'='refused','A declined request does not allow edits');
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('d1'))->>'status'='refused','A staff account is never a patient');
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0a'),gen_random_uuid())->>'status'='refused','An unknown id is refused');
reset role;
select pg_temp.as_user('0e');
set local role authenticated;
select pg_temp.ca_assert((select array_agg(x->>'memberId' order by x->>'memberId')from jsonb_array_elements(public.clinic_admin_patients(pg_temp.ca_id('0b'))->'patients')x)
 =array[pg_temp.ca_id('02')::text,pg_temp.ca_id('03')::text],'Clinic B lists its doctor''s patients only');
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0b'),pg_temp.ca_id('01'))->>'status'='refused','Clinic B cannot open clinic A''s patient');
select pg_temp.ca_assert(public.clinic_admin_patient_profile_update(pg_temp.ca_id('0b'),pg_temp.ca_id('01'),pg_temp.sub(),'{"name":"Fictional Anahit 01","birthDate":"1975-04-05"}','Taken','1976-01-01')->>'status'='refused','Clinic B cannot edit clinic A''s patient');
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0b'),pg_temp.ca_id('01'),0,pg_temp.ca_id('d2'),null)->>'status'='refused','Clinic B cannot take clinic A''s patient');
reset role;
select pg_temp.ca_assert((select count(*)=1 from public.access_audit where member_id=pg_temp.ca_id('01')and surface='clinic_admin_record'and actor_role='clinic'and actor_id=pg_temp.ca_id('0c')),'Opening a record is in access_audit');
select pg_temp.ca_assert((select count(*)=1 from public.clinic_portal_audit where kind='admin-record-opened'and clinic_id=pg_temp.ca_id('0a')and actor_id=pg_temp.ca_id('0c')and detail->>'memberId'=pg_temp.ca_id('01')::text),'Opening a record remains in the portal audit');
select pg_temp.ca_assert((select count(*)>=4 from public.clinic_portal_audit where kind='admin-record-refused'),'Refused opens are audited');
select pg_temp.ca_assert((select count(*)>=1 from public.clinic_portal_audit where kind='admin-patients-listed'and clinic_id=pg_temp.ca_id('0a'))
 and not exists(select 1 from public.clinic_portal_audit where kind='admin-patients-listed'and detail::text like '%0177%'),'Lists audited without the filter text');

-- 4. Mutations require a separately approved request. Their lifecycle and rerouting are
-- exercised by check-clinic-admin-approvals.sql. Retired RPCs never write, even with full access.
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),0,pg_temp.ca_id('d1'),pg_temp.ca_id('e2'))->>'reason'='nurse_unavailable','Another clinic''s nurse cannot be assigned');
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),0,pg_temp.ca_id('d2'),null)->>'reason'='doctor_unavailable','Another clinic''s doctor cannot be assigned');
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),0,pg_temp.ca_id('d3'),null)->>'reason'='doctor_unavailable','An inactive doctor cannot be assigned');
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),0,pg_temp.ca_id('e1'),null)->>'reason'='doctor_unavailable','A nurse cannot be the doctor');
select pg_temp.ca_assert(public.clinic_admin_patient_profile_update(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),pg_temp.sub(),'{"name":"Fictional Anahit 01","birthDate":"1975-04-05"}','Changed','1975-04-05')->>'status'='disabled','Legacy profile mutation is disabled');
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),0,pg_temp.ca_id('d4'),null)->>'status'='disabled','Legacy care-team mutation is disabled');
reset role;
select pg_temp.ca_assert((select display_name='Fictional Anahit 01'from public.profiles where id=pg_temp.ca_id('01'))
 and(select assigned_doctor_id=pg_temp.ca_id('d1')and revision=0 from public.patient_clinical_cases where user_id=pg_temp.ca_id('01')),'Legacy mutations leave profile and team unchanged');

-- 6. Switch back off: refused again.
update public.clinic_portal_capabilities set clinic_admin_full_access=false where singleton;
select pg_temp.ca_assert((select count(*)>=2 from public.config_audit where table_name='clinic_portal_capabilities'and changed?'clinic_admin_full_access'),'Switch changes are in config_audit');
select pg_temp.as_user('0c');
set local role authenticated;
select pg_temp.ca_assert(public.clinic_admin_patient_record(pg_temp.ca_id('0a'),pg_temp.ca_id('01'))->>'enabled'='false','Switched off again: refused');
select pg_temp.ca_assert(public.clinic_admin_patient_care_team(pg_temp.ca_id('0a'),pg_temp.ca_id('01'),2,pg_temp.ca_id('d1'),null)->>'status'='disabled','Switched off again: no change');
reset role;
select 'clinic admin full access checks passed';
rollback;
