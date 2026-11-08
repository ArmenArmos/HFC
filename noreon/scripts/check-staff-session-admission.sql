-- Staff-session admission on clinical reads and doctor writes, and access audit on clinical reads
-- (20261020195207; Codex Astra audit 20 Oct, A1 1-5, A3 2, A5 1). Rolled back; synthetic fixtures only.
-- Actors: an admitted assigned doctor and admin, the same staff on an unadmitted, revoked or recovery
-- session, another doctor, the assigned nurse, the member and anon.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
-- true when the statement is refused with insufficient_privilege (42501), false when it runs.
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;
exception when insufficient_privilege then return true;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('5ea00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.sid(n text)returns uuid language sql immutable as $$select('5ea00000-0000-4000-8000-0000000001'||n)::uuid$$;
create function pg_temp.as_user(u text,s text,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(u),'role','authenticated','session_id',pg_temp.sid(s),
  'amr',jsonb_build_array(jsonb_build_object('method',amr)))::text,true)$$;
create function pg_temp.audits(u text,surface text)returns bigint language sql security definer as $$
 select count(*)from public.access_audit where actor_id=pg_temp.id(u)and member_id=pg_temp.id('01')and surface=$2$$;

-- 01 member A, 02 member B; 03 doctor of A, 04 doctor of B, 05 admin, 06 nurse of A. Clinic 10.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n in('01','02')then '3740990'||n||'00'end,case when n in('01','02')then now()end
 from unnest(array['01','02','03','04','05','06'])n;
insert into public.workspace_clinics(id,name)values(pg_temp.id('10'),'Synthetic admission clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id('03'),'doctor','Synthetic doctor A',pg_temp.id('10')),(pg_temp.id('04'),'doctor','Synthetic doctor B',pg_temp.id('10')),
 (pg_temp.id('05'),'admin','Synthetic admin',null),(pg_temp.id('06'),'nurse','Synthetic nurse',pg_temp.id('10'));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 (pg_temp.id('01'),pg_temp.id('03'),pg_temp.id('06')),(pg_temp.id('02'),pg_temp.id('04'),null);
insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256)values
 (pg_temp.id('a1'),pg_temp.id('01'),pg_temp.id('01')||'/a.pdf','synthetic-a.pdf','application/pdf',100,repeat('5',64));
insert into public.member_reported_values(user_id,measure,value,unit,measured_on)values(pg_temp.id('01'),'weight',80,'kg','2026-01-01');
update public.bp_week_settings set enabled=true;
update public.member_medicine_settings set enabled=true;

-- Sessions (label -> id suffix): <n>a admitted, <n>u never admitted, 03r a recovery session (admitted), 01m the member's.
create temp table sess(label text primary key,n text,u text);
insert into sess values('03a','31','03'),('03u','32','03'),('03r','33','03'),('04a','41','04'),('05a','51','05'),('05u','52','05'),('06a','61','06'),('06u','62','06'),('01m','11','01');
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.id(u),now(),now()from sess;
insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id('b'||right(u,1)),pg_temp.id(u),'staff','p-'||u,'a-'||u,'+3749900'||u||'00','77'||u,1 from unnest(array['03','04','05','06'])u;
insert into public.auth_admissions(operation_kind,operation_id,auth_user_id,binding_id,binding_generation,session_id,state)
 select 'signin',gen_random_uuid(),pg_temp.id(u),pg_temp.id('b'||right(u,1)),1,pg_temp.sid(n),'admitted'from sess where label in('03a','03r','04a','05a','06a');
insert into public.staff_telegram_policy(signin_required)values(true)on conflict(singleton)do update set signin_required=true;

create function pg_temp.review()returns text language sql as $$
 select public.doctor_lab_ai_value_review(jsonb_build_object('version','lab-ai-review-v1','submissionId',gen_random_uuid(),'memberId',pg_temp.id('01'),
  'valueId',gen_random_uuid(),'action','confirm'))->>'status'$$;

-- 1. Admitted assigned doctor: reads and the review RPC pass; every read is recorded; direct tables are empty.
select pg_temp.as_user('03','31');set local role authenticated;
select pg_temp.ok(not pg_temp.denied($q$select public.doctor_member_documents(pg_temp.id('01'))$q$),'Admitted doctor opens member documents');
select pg_temp.ok(pg_temp.review()='disabled','Admitted doctor reaches the lab review RPC (switches off here)');
select pg_temp.ok(not pg_temp.denied($q$select public.staff_lab_ai_results(pg_temp.id('01'))$q$),'Admitted doctor reads lab results');
select pg_temp.ok((select jsonb_array_length(h->'documents')=1 and jsonb_array_length(h->'values')=1 from public.staff_member_history(pg_temp.id('01'))h),'Admitted doctor reads history through the RPC');
select pg_temp.ok((public.staff_member_history_document(pg_temp.id('01'),pg_temp.id('a1'))->>'object_path')=pg_temp.id('01')||'/a.pdf','Admitted doctor opens a history document');
select pg_temp.ok(public.staff_member_history_document(pg_temp.id('01'),pg_temp.id('a2'))is null,'An unknown document is null, not an error');
select pg_temp.ok((select count(*)from public.member_reported_values)=0 and(select count(*)from public.member_reported_documents)=0,'Staff get nothing from the history tables directly');
select pg_temp.ok(public.bp_week_staff_read(pg_temp.id('01'))->>'enabled'='true','Admitted doctor reads the BP week');
select pg_temp.ok(public.member_medicines_staff_read(pg_temp.id('01'),14)->>'enabled'='true','Admitted doctor reads medicines');
select pg_temp.ok(public.zoe_symptom_intakes_for_doctor(pg_temp.id('01'))->>'ok'='true','Admitted doctor reads symptom intakes');
reset role;
select pg_temp.ok(pg_temp.audits('03','member_history')=1 and pg_temp.audits('03','member_upload')=1 and pg_temp.audits('03','bp_week')=1
 and pg_temp.audits('03','member_medicines')=1 and pg_temp.audits('03','zoe_symptom_intakes')=1,'Each clinical read left exactly one access record');
-- A switched-off read shows nothing and records nothing.
update public.bp_week_settings set enabled=false;
select pg_temp.as_user('03','31');set local role authenticated;
select pg_temp.ok(public.bp_week_staff_read(pg_temp.id('01'))->>'enabled'='false','BP week off');
reset role;
select pg_temp.ok(pg_temp.audits('03','bp_week')=1,'A switched-off read is not recorded');
update public.bp_week_settings set enabled=true;

-- 2. The same doctor on an unadmitted session, on a recovery session, and after the session is revoked.
create function pg_temp.doctor_refused(label text)returns void language plpgsql as $$begin
 perform pg_temp.ok(pg_temp.denied($q$select public.doctor_member_documents(pg_temp.id('01'))$q$),label||': member documents');
 perform pg_temp.ok(pg_temp.denied($q$select pg_temp.review()$q$),label||': lab value review (clinical write)');
 perform pg_temp.ok(pg_temp.denied($q$select public.staff_lab_ai_results(pg_temp.id('01'))$q$),label||': lab results');
 perform pg_temp.ok(pg_temp.denied($q$select public.staff_member_history(pg_temp.id('01'))$q$),label||': history RPC');
 perform pg_temp.ok(pg_temp.denied($q$select public.staff_member_history_document(pg_temp.id('01'),pg_temp.id('a1'))$q$),label||': history document');
 perform pg_temp.ok(pg_temp.denied($q$select public.staff_record_member_access(pg_temp.id('01'),'member_history')$q$),label||': record access');
 perform pg_temp.ok(pg_temp.denied($q$select public.bp_week_staff_read(pg_temp.id('01'))$q$),label||': BP week');
 perform pg_temp.ok(pg_temp.denied($q$select public.member_medicines_staff_read(pg_temp.id('01'),14)$q$),label||': medicines');
 perform pg_temp.ok(pg_temp.denied($q$select public.zoe_symptom_intakes_for_doctor(pg_temp.id('01'))$q$),label||': symptom intakes');
 perform pg_temp.ok((select count(*)from public.member_reported_values)=0 and(select count(*)from public.member_reported_documents)=0,label||': history tables');
end$$;
select pg_temp.as_user('03','32');set local role authenticated;select pg_temp.doctor_refused('Unadmitted doctor');reset role;
select pg_temp.as_user('03','33','recovery');set local role authenticated;select pg_temp.doctor_refused('Recovery-session doctor');reset role;
delete from auth.sessions where id=pg_temp.sid('31');
select pg_temp.as_user('03','31');set local role authenticated;select pg_temp.doctor_refused('Revoked-session doctor');reset role;
-- A revoked Telegram binding closes an admitted session as well.
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.sid('31'),pg_temp.id('03'),now(),now());
update public.telegram_auth_bindings set active=false,revoked_at=now()where auth_user_id=pg_temp.id('03');
select pg_temp.as_user('03','31');set local role authenticated;select pg_temp.doctor_refused('Revoked-binding doctor');reset role;
select pg_temp.ok(pg_temp.audits('03','member_history')=1 and pg_temp.audits('03','member_upload')=1,'Refused reads left no access record');

-- 3. Another admitted doctor is refused member A.
select pg_temp.as_user('04','41');set local role authenticated;select pg_temp.doctor_refused('Other doctor');reset role;

-- 4. Admin: admitted reads lab results and history (recorded); unadmitted is refused both.
select pg_temp.as_user('05','51');set local role authenticated;
select pg_temp.ok(public.staff_lab_ai_results(pg_temp.id('01'))->>'viewer'='admin','Admitted admin reads lab results');
select pg_temp.ok((select jsonb_array_length(h->'values')=1 from public.staff_member_history(pg_temp.id('01'))h),'Admitted admin reads history through the RPC');
select pg_temp.ok((select count(*)from public.member_reported_values)=0,'Admin gets nothing from the history table directly');
reset role;
select pg_temp.ok(pg_temp.audits('05','member_history')=1,'Admin history read recorded');
select pg_temp.as_user('05','52');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.staff_lab_ai_results(pg_temp.id('01'))$q$),'Unadmitted admin refused lab results');
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_history(pg_temp.id('01'))$q$),'Unadmitted admin refused history');
select pg_temp.ok((select count(*)from public.member_reported_values)=0 and(select count(*)from public.member_reported_documents)=0,'Unadmitted admin reads no history rows');
reset role;

-- 5. Nurse: admitted reads BP week and medicines (recorded); unadmitted is refused; never history.
select pg_temp.as_user('06','61');set local role authenticated;
select pg_temp.ok(public.bp_week_staff_read(pg_temp.id('01'))->>'enabled'='true','Admitted nurse reads the BP week');
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_history(pg_temp.id('01'))$q$),'Nurse refused member history');
reset role;
select pg_temp.ok(pg_temp.audits('06','bp_week')=1,'Nurse BP week read recorded');
select pg_temp.as_user('06','62');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.bp_week_staff_read(pg_temp.id('01'))$q$),'Unadmitted nurse refused the BP week');
select pg_temp.ok(pg_temp.denied($q$select public.member_medicines_staff_read(pg_temp.id('01'),14)$q$),'Unadmitted nurse refused medicines');
reset role;

-- 6. The member reads their own rows directly and is refused every staff RPC, even for themselves.
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id('01'),'role','authenticated','session_id',pg_temp.sid('11'),'amr',jsonb_build_array(jsonb_build_object('method','otp')))::text,true);
set local role authenticated;
select pg_temp.ok((select count(*)from public.member_reported_values)=1 and(select count(*)from public.member_reported_documents)=1,'Member reads own history directly');
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_history(pg_temp.id('01'))$q$),'Member refused the staff history RPC');
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_history_document(pg_temp.id('01'),pg_temp.id('a1'))$q$),'Member refused the staff document RPC');
select pg_temp.ok(pg_temp.denied($q$select public.staff_lab_ai_results(pg_temp.id('01'))$q$),'Member refused staff lab results');
select pg_temp.ok(pg_temp.denied($q$select pg_temp.review()$q$),'Member refused the lab review');
reset role;

-- 7. Anon has no execute on any of these, and no table read; inner bodies are not callable by anyone.
select pg_temp.ok(not has_function_privilege('anon','public.staff_member_history(uuid)','execute')and not has_function_privilege('anon','public.staff_member_history_document(uuid,uuid)','execute')
 and not has_function_privilege('anon','public.staff_lab_ai_results(uuid)','execute')and not has_function_privilege('anon','public.bp_week_staff_read(uuid)','execute')
 and not has_function_privilege('anon','public.member_medicines_staff_read(uuid,integer)','execute')and not has_function_privilege('anon','public.zoe_symptom_intakes_for_doctor(uuid)','execute')
 and not has_table_privilege('anon','public.member_reported_values','select')and not has_table_privilege('anon','public.member_reported_documents','select'),'Anon has no access');
select pg_temp.ok(not has_function_privilege('authenticated',p,'execute')and not has_function_privilege('anon',p,'execute'),'Inner body not callable: '||p)
 from unnest(array['public._staff_lab_ai_results_body(uuid)','public._bp_week_staff_read_body(uuid)','public._member_medicines_staff_read_body(uuid,integer)','public._zoe_symptom_intakes_for_doctor_body(uuid)'])p;
select set_config('request.jwt.claims','{"role":"anon"}',true);set local role anon;
select pg_temp.ok(pg_temp.denied($q$select public.staff_member_history(pg_temp.id('01'))$q$),'Anon refused the history RPC');
reset role;

rollback;
\echo 'check-staff-session-admission: ok'
