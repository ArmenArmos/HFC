-- Fictional fixtures only; all writes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- 02 assigned doctor, 03 other doctor, 05 admin, 06 nurse, 04 member, 07 clinic.
insert into auth.users(id,phone,phone_confirmed_at)select ('9e000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n=4 then '37400096004' end,case when n=4 then now() end from generate_series(2,6)n;
insert into auth.sessions(id,user_id,created_at,updated_at)select ('9e000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,('9e000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now() from generate_series(2,6)n;
insert into public.workspace_clinics(id,name)values('9e000000-0000-4000-8000-000000000007','Synthetic GP report clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('9e000000-0000-4000-8000-000000000002','doctor','Synthetic assigned doctor','9e000000-0000-4000-8000-000000000007'),
 ('9e000000-0000-4000-8000-000000000003','doctor','Synthetic other doctor','9e000000-0000-4000-8000-000000000007'),
 ('9e000000-0000-4000-8000-000000000005','admin','Synthetic admin',null),
 ('9e000000-0000-4000-8000-000000000006','nurse','Synthetic nurse','9e000000-0000-4000-8000-000000000007');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('9e000000-0000-4000-8000-000000000004','9e000000-0000-4000-8000-000000000002','9e000000-0000-4000-8000-000000000006');
update public.profiles set display_name='Fictional GP member',birth_date='1968-06-08',biological_sex='male' where id='9e000000-0000-4000-8000-000000000004';
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at,source)values('9e000000-0000-4000-8000-000000000004',gen_random_uuid(),152,92,76,now()-interval '1 day','manual');

create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','9e000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','9e000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.code(statement text) returns text language plpgsql as $$begin
 execute statement;return 'none';
exception when others then return sqlstate;end$$;
create function pg_temp.content(token text,member text default '9e000000-0000-4000-8000-000000000004') returns jsonb language sql as $$
 select jsonb_build_object('kind','noreon-gp-report','memberId',member,'sourceToken',token,'templateVersion','NRN-GP-REP-001 v1.0','algorithmVersion','NRN-CLIN-ALG-001-v1.1','priority',jsonb_build_object('en','x','hy','x'))
$$;

select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.code($$select public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','potassium',4.2,null,current_date,gen_random_uuid())$$)='55P03','disabled save refused');
reset role;
update public.gp_report_capabilities set enabled=true where singleton;
select pg_temp.as_user(2);
set local role authenticated;
do $$declare before_token text;entry jsonb;again jsonb;s jsonb;args text;
begin
 before_token:=public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')->>'token';
 entry:=public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','potassium',4.2,null,current_date,'9e000000-0000-4000-8000-000000000301');
 again:=public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','potassium',4.2,null,current_date,'9e000000-0000-4000-8000-000000000301');
 perform pg_temp.ok(entry=again,'submission replay returns original entry');
 s:=public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004');
 perform pg_temp.ok(s#>>'{source,resultEntries,0,number}'='4.2'and s#>>'{source,resultEntries,0,field}'='potassium'
  and s#>>'{source,resultEntries,0,enteredByName}'='Synthetic assigned doctor'
  and s#>>'{source,resultEntries,0,observedOn}'=current_date::text,'assigned doctor reads entry with provenance');
 perform pg_temp.ok(before_token<>s->>'token','entry changes source token');
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_gp_report_approve(%L,%L,%L,gen_random_uuid())',
  '9e000000-0000-4000-8000-000000000004',before_token,pg_temp.content(before_token)))='40001','entry invalidates stale approval');
 perform public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','potassium',4.6,null,current_date,gen_random_uuid());
 perform pg_temp.ok(public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')#>>'{source,resultEntries,0,number}'='4.6','latest entry wins');
 perform public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','potassium',null,null,current_date,gen_random_uuid());
 perform pg_temp.ok(public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')#>'{source,resultEntries}'='[]'::jsonb,'clear hides latest without reviving old value');
 perform public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','ecg_lvh',null,'no',current_date,gen_random_uuid());
 perform pg_temp.ok(public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')#>>'{source,resultEntries,0,finding}'='no','negative finding retained');
 perform public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','score2_percent',0,null,current_date,gen_random_uuid());
 perform public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','ahi',0,null,current_date,gen_random_uuid());
 perform pg_temp.ok(public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')#>>'{source,resultEntries,0,number}'='0','zero retained and fields sorted');
 foreach args in array array[
  '''potassium'',0.5,null,current_date', '''potassium'',13,null,current_date',
  '''score2_percent'',101,null,current_date', '''score2_percent'',-1,null,current_date',
  '''ahi'',201,null,current_date', '''ahi'',-1,null,current_date',
  '''potassium'',''NaN''::numeric,null,current_date',
  '''potassium'',null,''yes'',current_date', '''ecg_lvh'',3,null,current_date',
  '''ecg_lvh'',null,''maybe'',current_date', '''unknown'',null,null,current_date',
  '''ahi'',3,null,null', '''ahi'',3,null,(clock_timestamp()at time zone ''Asia/Yerevan'')::date+1'
 ]loop
  perform pg_temp.ok(pg_temp.code('select public.doctor_result_entry_save(''9e000000-0000-4000-8000-000000000004'','||args||',gen_random_uuid())')='22023','invalid entry refused');
 end loop;
end$$;
select pg_temp.ok(pg_temp.code('select * from public.gp_report_doctor_entries')='42501','no direct select');
select pg_temp.ok(pg_temp.code('insert into public.gp_report_doctor_entries default values')='42501','no direct insert');
select pg_temp.ok(pg_temp.code('update public.gp_report_doctor_entries set finding=''yes''')='42501','no update');
select pg_temp.ok(pg_temp.code('delete from public.gp_report_doctor_entries')='42501','no delete');
reset role;
select pg_temp.ok((select count(*)from public.gp_report_doctor_entries where submission_id='9e000000-0000-4000-8000-000000000301')=1,'one row for repeat submission');
select pg_temp.ok((select count(*)from public.gp_report_doctor_entries where field='potassium')=3,'clear preserves append-only history');
-- Unassigned staff and members cannot save or read.
do $$declare n int;
begin
 foreach n in array array[3,4,5,6]loop
  perform pg_temp.as_user(n);set local role authenticated;
  perform pg_temp.ok(pg_temp.code($q$select public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','ahi',2,null,current_date,gen_random_uuid())$q$)='42501','unassigned actor save refused');
  perform pg_temp.ok(pg_temp.code($q$select public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')$q$)='42501','unassigned actor read refused');
  reset role;
 end loop;
end$$;
-- A newly assigned doctor cannot claim the previous doctor's submission.
update public.patient_clinical_cases set assigned_doctor_id='9e000000-0000-4000-8000-000000000003'where user_id='9e000000-0000-4000-8000-000000000004';
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(pg_temp.code($$select public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','potassium',4.2,null,current_date,'9e000000-0000-4000-8000-000000000301')$$)='22023','another doctor submission collision refused');
reset role;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('9e000000-0000-4000-8000-000000000005','9e000000-0000-4000-8000-000000000002');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.code($$select public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000005','potassium',4.2,null,current_date,'9e000000-0000-4000-8000-000000000301')$$)='22023','another member submission collision refused');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.code($$select public.doctor_result_entry_save('9e000000-0000-4000-8000-000000000004','ahi',2,null,current_date,gen_random_uuid())$$)='42501','anon save refused');
select pg_temp.ok(pg_temp.code('select * from public.gp_report_doctor_entries')='42501','anon table access refused');
reset role;
select pg_temp.ok(not exists(select 1 from pg_policies where schemaname='public'and tablename='gp_report_doctor_entries'),'no direct table policies');
select pg_temp.ok(not has_table_privilege('service_role','public.gp_report_doctor_entries','SELECT,INSERT,UPDATE,DELETE'),'service role has no direct table grant');
rollback;
\echo 'Results report entry SQL checks passed.'
