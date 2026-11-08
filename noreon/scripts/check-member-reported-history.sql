-- Member-reported history: owner, assigned active doctor and active admin read; everyone else is denied. Rolled back. Synthetic fixtures only.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.fails(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when others then return true;end$$;
-- A live password session for the user (staff reads require a managed session, 20261020195207).
create function pg_temp.as_user(p_id uuid)returns void language plpgsql security definer as $$begin
 insert into auth.sessions(id,user_id,created_at,updated_at)select p_id,p_id,now(),now()where exists(select 1 from auth.users where id=p_id)on conflict(id)do nothing;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);end$$;
create function pg_temp.docs()returns bigint language sql as $$select count(*)from public.member_reported_documents$$;
create function pg_temp.vals()returns bigint language sql as $$select count(*)from public.member_reported_values$$;
-- Staff read through staff_member_history (20261020195207): counts, or -1 when refused.
create function pg_temp.sdocs(m uuid)returns int language plpgsql as $$begin return jsonb_array_length(public.staff_member_history(m)->'documents');exception when insufficient_privilege then return -1;end$$;
create function pg_temp.svals(m uuid)returns int language plpgsql as $$begin return jsonb_array_length(public.staff_member_history(m)->'values');exception when insufficient_privilege then return -1;end$$;

-- Members A and B; member C whose doctor is inactive. Doctors: D1 assigned to A, D2 assigned to B,
-- D3 inactive (assigned to C). Admin E, inactive admin F, nurse N.
insert into auth.users(id,email)values
 ('e1700000-0000-4000-8000-0000000000a1','a@example.invalid'),('e1700000-0000-4000-8000-0000000000b1','b@example.invalid'),('e1700000-0000-4000-8000-0000000000c1','c@example.invalid'),
 ('e1700000-0000-4000-8000-0000000000d1','d1@example.invalid'),('e1700000-0000-4000-8000-0000000000d2','d2@example.invalid'),('e1700000-0000-4000-8000-0000000000d3','d3@example.invalid'),
 ('e1700000-0000-4000-8000-0000000000e1','e@example.invalid'),('e1700000-0000-4000-8000-0000000000f1','f@example.invalid'),('e1700000-0000-4000-8000-0000000000f2','n@example.invalid');
insert into public.workspace_clinics(id,name,active)values('e1700000-0000-4000-8000-000000000001','Synthetic clinic',true);
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values
 ('e1700000-0000-4000-8000-0000000000d1','doctor','Dr One','e1700000-0000-4000-8000-000000000001',true),
 ('e1700000-0000-4000-8000-0000000000d2','doctor','Dr Two','e1700000-0000-4000-8000-000000000001',true),
 ('e1700000-0000-4000-8000-0000000000d3','doctor','Dr Three','e1700000-0000-4000-8000-000000000001',false),
 ('e1700000-0000-4000-8000-0000000000e1','admin','Admin E',null,true),
 ('e1700000-0000-4000-8000-0000000000f1','admin','Admin F',null,false),
 ('e1700000-0000-4000-8000-0000000000f2','nurse','Nurse N','e1700000-0000-4000-8000-000000000001',true);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000d1'),
 ('e1700000-0000-4000-8000-0000000000b1','e1700000-0000-4000-8000-0000000000d2'),
 ('e1700000-0000-4000-8000-0000000000c1','e1700000-0000-4000-8000-0000000000d3');

-- Documents are written by the server (service role) only.
insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256)values
 ('e1700000-0000-4000-8000-00000000da01','e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000a1/one.pdf','old-labs.pdf','application/pdf',1000,repeat('a',64)),
 ('e1700000-0000-4000-8000-00000000db01','e1700000-0000-4000-8000-0000000000b1','e1700000-0000-4000-8000-0000000000b1/one.jpg','photo.jpg','image/jpeg',1000,repeat('b',64)),
 ('e1700000-0000-4000-8000-00000000dc01','e1700000-0000-4000-8000-0000000000c1','e1700000-0000-4000-8000-0000000000c1/one.png','scan.png','image/png',1000,repeat('c',64));
select pg_temp.ok(pg_temp.fails($q$insert into public.member_reported_documents(user_id,object_path,file_name,mime,size_bytes,sha256)values('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000b1/x.pdf','x.pdf','application/pdf',1,repeat('d',64))$q$),'A document path must sit under its owner');
select pg_temp.ok(pg_temp.fails($q$insert into public.member_reported_documents(user_id,object_path,file_name,mime,size_bytes,sha256)values('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000a1/x.svg','x.svg','image/svg+xml',1,repeat('d',64))$q$),'Only PDF, JPEG and PNG');
select pg_temp.ok(pg_temp.fails($q$insert into public.member_reported_documents(user_id,object_path,file_name,mime,size_bytes,sha256)values('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000a1/x.pdf','x.pdf','application/pdf',4194305,repeat('d',64))$q$),'At most 4 MB');
select pg_temp.ok(pg_temp.fails($q$insert into public.member_reported_documents(user_id,object_path,file_name,mime,size_bytes,sha256)values('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000a1/y.pdf','y.pdf','application/pdf',1000,repeat('a',64))$q$),'The same file is stored once');
select pg_temp.ok((select not public and file_size_limit=4194304 from storage.buckets where id='member-history'),'Bucket is private with a 4 MB limit');
select pg_temp.ok(not exists(select 1 from pg_policies where schemaname='storage'and qual like '%member-history%'),'No storage policy opens the bucket to signed-in users');

-- 1. Member A writes values through the add function; the owner comes from the session, never the request.
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000a1');set local role authenticated;
select public.member_reported_value_add('bp',142,91,'mmHg','2025-03-01');select public.member_reported_value_add('ldl_c',3.4,null,'mmol/L','2025-03-01');select public.member_reported_value_add('hba1c',5.9,null,'%','2024-11-20');
select pg_temp.ok(pg_temp.vals()=3,'A sees its own three values');
select pg_temp.ok((select bool_and(user_id='e1700000-0000-4000-8000-0000000000a1'and source='member-reported')from public.member_reported_values),'Owner and source tag set by the database');
select pg_temp.ok(pg_temp.fails($q$insert into public.member_reported_values(user_id,measure,value,unit,measured_on)values('e1700000-0000-4000-8000-0000000000a1','weight',80,'kg','2025-01-01')$q$),'No direct table insert, even for oneself');
select pg_temp.ok(pg_temp.fails($q$delete from public.member_reported_values$q$),'No direct table delete');
select pg_temp.ok(pg_temp.fails($q$select public.member_reported_value_add('weight',80,null,'kg',current_date+30)$q$),'No future dates');
select pg_temp.ok(pg_temp.fails($q$select public.member_reported_value_add('weight',400,null,'kg','2025-01-01')$q$),'Weight bound (questionnaire 30 to 300 kg)');
select pg_temp.ok(pg_temp.fails($q$select public.member_reported_value_add('bp',140,null,'mmHg','2025-01-01')$q$),'Blood pressure needs both numbers');
select pg_temp.ok(pg_temp.fails($q$select public.member_reported_value_add('bp',80,90,'mmHg','2025-01-01')$q$),'Diastolic below systolic');
select pg_temp.ok(pg_temp.fails($q$select public.member_reported_value_add('hba1c',25,null,'%','2025-01-01')$q$),'HbA1c bound (questionnaire 3 to 20 %)');
select pg_temp.ok(pg_temp.fails($q$select public.member_reported_value_add('ldl_c',3.4,null,'mg/dL','2025-01-01')$q$),'Unit-specific bounds');
select pg_temp.ok(pg_temp.docs()=1,'A sees its own document only');
select pg_temp.ok(pg_temp.fails($q$insert into public.member_reported_documents(user_id,object_path,file_name,mime,size_bytes,sha256)values('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000a1/z.pdf','z.pdf','application/pdf',1,repeat('e',64))$q$),'Members cannot insert documents directly');
select pg_temp.ok(pg_temp.fails($q$update public.member_reported_documents set file_name='x'$q$),'Members cannot edit documents');
select pg_temp.ok(pg_temp.fails($q$update public.member_reported_values set value=1$q$),'Members cannot edit values');
reset role;

-- 2. Member B is denied A's rows and cannot delete or remove them.
select id as a_value from public.member_reported_values where measure='bp' \gset
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000b1');set local role authenticated;
select public.member_reported_value_add('weight',81.5,null,'kg','2025-02-01');
select pg_temp.ok(pg_temp.vals()=1 and pg_temp.docs()=1,'B sees only its own rows');
select pg_temp.ok(not exists(select 1 from public.member_reported_values where user_id='e1700000-0000-4000-8000-0000000000a1'),'B cannot read A values');
select pg_temp.ok(not public.member_reported_value_remove(:'a_value'),'B cannot remove an A value');
select pg_temp.ok(public.member_reported_document_remove('e1700000-0000-4000-8000-00000000da01')is null,'B cannot remove A document');
reset role;
select pg_temp.ok((select count(*)=3 from public.member_reported_values where user_id='e1700000-0000-4000-8000-0000000000a1'),'A values untouched by B');
select pg_temp.ok((select deleted_at is null from public.member_reported_documents where id='e1700000-0000-4000-8000-00000000da01'),'A document untouched by B');

-- 3. A's assigned doctor reads A's rows and nobody else's, and cannot write.
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000d1');set local role authenticated;
select pg_temp.ok(pg_temp.vals()=0 and pg_temp.docs()=0,'Staff get nothing from the tables directly (reads go through the audited RPC)');
select pg_temp.ok(pg_temp.svals('e1700000-0000-4000-8000-0000000000a1')=3 and pg_temp.sdocs('e1700000-0000-4000-8000-0000000000a1')=1,'Assigned doctor reads the member rows through staff_member_history');
select pg_temp.ok(pg_temp.svals('e1700000-0000-4000-8000-0000000000b1')=-1,'Assigned doctor reads no other member');
select pg_temp.ok(pg_temp.fails($q$insert into public.member_reported_values(user_id,measure,value,unit,measured_on)values('e1700000-0000-4000-8000-0000000000a1','weight',80,'kg','2025-01-01')$q$),'Doctor cannot write for the member');
reset role;
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000d1');set local role authenticated;
select pg_temp.ok(not public.member_reported_value_remove(:'a_value'),'Doctor cannot remove a member value');
reset role;
select pg_temp.ok((select count(*)=4 from public.member_reported_values),'Doctor removed nothing');

-- 4. Another doctor, an inactive doctor, a nurse and an inactive admin are denied.
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000d2');set local role authenticated;
select pg_temp.ok(pg_temp.svals('e1700000-0000-4000-8000-0000000000a1')=-1 and pg_temp.docs()=0 and pg_temp.vals()=0,'Unassigned doctor denied');
reset role;
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000d3');set local role authenticated;
select pg_temp.ok(pg_temp.docs()=0 and pg_temp.vals()=0 and pg_temp.svals('e1700000-0000-4000-8000-0000000000c1')=-1,'Inactive doctor denied even for their own assigned member');
reset role;
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000f2');set local role authenticated;
select pg_temp.ok(pg_temp.docs()=0 and pg_temp.vals()=0 and pg_temp.svals('e1700000-0000-4000-8000-0000000000a1')=-1,'Nurse denied');
reset role;
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000f1');set local role authenticated;
select pg_temp.ok(pg_temp.docs()=0 and pg_temp.vals()=0 and pg_temp.svals('e1700000-0000-4000-8000-0000000000a1')=-1,'Inactive admin denied');
reset role;
-- An inactive clinic closes its doctor's access.
update public.workspace_clinics set active=false where id='e1700000-0000-4000-8000-000000000001';
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000d1');set local role authenticated;
select pg_temp.ok(pg_temp.docs()=0 and pg_temp.vals()=0 and pg_temp.svals('e1700000-0000-4000-8000-0000000000a1')=-1,'Doctor of an inactive clinic denied');
reset role;
update public.workspace_clinics set active=true where id='e1700000-0000-4000-8000-000000000001';

-- 5. Active admin reads all; anon has no grant at all.
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000e1');set local role authenticated;
select pg_temp.ok(pg_temp.docs()=0 and pg_temp.vals()=0,'Active admin gets nothing from the tables directly');
select pg_temp.ok(pg_temp.sdocs('e1700000-0000-4000-8000-0000000000a1')+pg_temp.sdocs('e1700000-0000-4000-8000-0000000000b1')+pg_temp.sdocs('e1700000-0000-4000-8000-0000000000c1')=3
 and pg_temp.svals('e1700000-0000-4000-8000-0000000000a1')+pg_temp.svals('e1700000-0000-4000-8000-0000000000b1')=4,'Active admin reads every member through the RPC');
select pg_temp.ok(pg_temp.fails($q$delete from public.member_reported_values$q$),'Admin has no delete');
reset role;
select pg_temp.ok(not has_table_privilege('anon','public.member_reported_documents','select')and not has_table_privilege('anon','public.member_reported_values','select'),'Anon has no access');
select pg_temp.ok(not has_function_privilege('anon','public.member_reported_document_remove(uuid)','execute')and not has_function_privilege('anon','public.member_reported_value_add(text,numeric,numeric,text,date)','execute')and not has_function_privilege('anon','public.member_reported_value_remove(uuid)','execute'),'Anon cannot write');

-- 6. The owner removes their document; it disappears for every reader.
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000a1');set local role authenticated;
select pg_temp.ok(public.member_reported_document_remove('e1700000-0000-4000-8000-00000000da01')='e1700000-0000-4000-8000-0000000000a1/one.pdf','Owner removes and gets the storage path');
select pg_temp.ok(pg_temp.docs()=0,'Removed document hidden from the member');
select pg_temp.ok(public.member_reported_value_remove(id),'Owner removes own value')from public.member_reported_values where measure='hba1c';
select pg_temp.ok(pg_temp.vals()=2,'Owner value gone');
reset role;
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000d1');set local role authenticated;
select pg_temp.ok(pg_temp.sdocs('e1700000-0000-4000-8000-0000000000a1')=0,'Removed document hidden from the doctor');
reset role;

-- 7. Clinic measurements: each member gets only their own nurse-entered values.
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values
 ('e1700000-0000-4000-8000-0000000000a9','e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000f2','Nurse N','nurse','e1700000-0000-4000-8000-000000000001');
insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at)values
 ('e1700000-0000-4000-8000-0000000000aa','e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000ab',150,95,'2026-10-01T08:00:00Z'),
 ('e1700000-0000-4000-8000-0000000000ac','e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000ad',130,85,'2026-10-02T08:00:00Z');
insert into public.patient_care_visit_command_receipts(user_id,submission_id,actor_id,session_id,command,state,result)values
 ('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000ab','e1700000-0000-4000-8000-0000000000f2','e1700000-0000-4000-8000-0000000000f2','{}','committed','{}');
insert into public.patient_care_visit_entries(user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id,measurement_id)values
 ('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000a9','e1700000-0000-4000-8000-0000000000ab',1,'{"kind":"observation","field":"systolic","state":"known","value":150,"unit":"mmHg"}','2026-10-01T08:00:00Z','2026-10-01T08:00:00Z','e1700000-0000-4000-8000-0000000000f2','Nurse N','nurse','e1700000-0000-4000-8000-000000000001','e1700000-0000-4000-8000-0000000000aa'),
 ('e1700000-0000-4000-8000-0000000000a1','e1700000-0000-4000-8000-0000000000a9','e1700000-0000-4000-8000-0000000000ab',2,'{"kind":"observation","field":"weight","state":"known","value":84.2,"unit":"kg"}','2026-10-01T08:00:00Z','2026-10-01T08:00:00Z','e1700000-0000-4000-8000-0000000000f2','Nurse N','nurse','e1700000-0000-4000-8000-000000000001',null);
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000a1');set local role authenticated;
select pg_temp.ok((select jsonb_array_length(x->'bp')=1 and x#>>'{bp,0,id}'='e1700000-0000-4000-8000-0000000000aa'and jsonb_array_length(x->'observations')=1 and(x#>>'{observations,0,value}')::numeric=84.2 from public.member_clinic_measurements()x),'Member gets own clinic BP (home reading excluded) and weight');
reset role;
select pg_temp.as_user('e1700000-0000-4000-8000-0000000000b1');set local role authenticated;
select pg_temp.ok((select jsonb_array_length(x->'bp')=0 and jsonb_array_length(x->'observations')=0 from public.member_clinic_measurements()x),'Other member gets nothing of A');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.member_clinic_measurements()','execute'),'Anon cannot read clinic measurements');

rollback;
\echo 'check-member-reported-history: ok'
