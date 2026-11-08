\set ON_ERROR_STOP on
begin;
-- Ordinary password sign-in fixtures carry a live session and explicit AMR.
-- This helper only selects claims; it never creates/resurrects a session.
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;

create function pg_temp.assert_queue(condition boolean,label text) returns void language plpgsql as $$begin if condition is distinct from true then raise exception 'TEST %',label;end if;end$$;
insert into auth.users(id) select ('82000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,6) n;
update public.profiles set display_name='SYNTHETIC queue fixture' where id::text like '82000000%';
insert into public.workspace_clinics(id,name) values('82000000-0000-4000-8000-000000000010','Synthetic queue clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
('82000000-0000-4000-8000-000000000003','admin','Synthetic admin',null),
('82000000-0000-4000-8000-000000000004','doctor','Synthetic assigned doctor','82000000-0000-4000-8000-000000000010'),
('82000000-0000-4000-8000-000000000005','doctor','Synthetic other doctor','82000000-0000-4000-8000-000000000010'),
('82000000-0000-4000-8000-000000000006','nurse','Synthetic assigned nurse','82000000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id,draft) values
('82000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000006','{"private":"Must never appear in operations"}'),
('82000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000005',null,null);
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload)
select gen_random_uuid(),'82000000-0000-4000-8000-000000000001',s,'{}','[]','test','test','{}' from unnest(array['requested','provider-proposed','confirmed']) s;
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload) values
(gen_random_uuid(),'82000000-0000-4000-8000-000000000002','change-pending','{}','[]','test','test','{}');
insert into auth.sessions(id,user_id,created_at,updated_at) select user_id,user_id,clock_timestamp(),clock_timestamp() from public.workspace_staff where user_id::text like '82000000%';
select pg_temp.password_actor('82000000-0000-4000-8000-000000000003');
set local role authenticated;
select pg_temp.assert_queue((select value->'bookingCounts'='{"requested":1,"providerProposed":1,"confirmed":1,"changePending":0}' from jsonb_array_elements(public.patient_clinical_case_queue()) where value->>'id'='82000000-0000-4000-8000-000000000001'),'admin receives accurate operational counts');
select pg_temp.assert_queue(not exists(select 1 from jsonb_array_elements(public.patient_clinical_case_queue()) where value ? 'draft' or value ? 'evidence' or value ? 'requirements'),'admin queue excludes private clinical source and drafts');
reset role;
select pg_temp.password_actor('82000000-0000-4000-8000-000000000004');
set local role authenticated;
select pg_temp.assert_queue(jsonb_array_length(public.patient_clinical_case_queue())=1 and public.patient_clinical_case_queue()#>>'{0,id}'='82000000-0000-4000-8000-000000000001','doctor sees only assigned member counts');
reset role;
select pg_temp.password_actor('82000000-0000-4000-8000-000000000006');
set local role authenticated;
select pg_temp.assert_queue(jsonb_array_length(public.patient_clinical_case_queue())=1 and public.patient_clinical_case_queue()#>>'{0,bookingCounts,confirmed}'='1','nurse sees only assigned member counts');
reset role;
update public.patient_clinical_cases set assigned_nurse_id=null where user_id='82000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_queue(public.patient_clinical_case_queue()='[]','revoked nurse sees no member counts');
reset role;
update public.workspace_clinics set active=false where id='82000000-0000-4000-8000-000000000010';
set local role authenticated;
do $$begin perform public.patient_clinical_case_queue();raise exception 'TEST inactive clinic admitted';exception when insufficient_privilege then null;end$$;
reset role;
rollback;
