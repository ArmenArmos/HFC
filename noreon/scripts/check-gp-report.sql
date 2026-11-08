-- Fictional GP report checks; all fixtures roll back.
-- Database switch (off by default), assigned-doctor-only source and content, admin
-- metadata-only read, approval bound to the evidence token, replay, append-only versions.
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

-- Off by default: the source says disabled and approval refuses.
select pg_temp.ok((select not enabled from public.gp_report_capabilities),'switch is off by default');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok((public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')->>'enabled')::boolean=false,'switch off: source disabled');
select pg_temp.ok(pg_temp.code($$select public.doctor_gp_report_approve('9e000000-0000-4000-8000-000000000004','00000000000000000000000000000000','{}',gen_random_uuid())$$)='55P03','switch off: approve refused');
select pg_temp.ok(public.doctor_gp_report_version('9e000000-0000-4000-8000-000000000004',1) is null,'switch off: no version');
reset role;
update public.gp_report_capabilities set enabled=true where singleton;

-- Only the assigned doctor reads the source; other doctor, nurse, admin and the member do not.
do $$begin
 perform pg_temp.as_user(3);set local role authenticated;
 perform pg_temp.ok(pg_temp.code($q$select public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')$q$)='42501','other doctor refused');
 reset role;perform pg_temp.as_user(6);set local role authenticated;
 perform pg_temp.ok(pg_temp.code($q$select public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')$q$)='42501','nurse refused');
 reset role;perform pg_temp.as_user(5);set local role authenticated;
 perform pg_temp.ok(pg_temp.code($q$select public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')$q$)='42501','admin cannot read clinical source');
 reset role;perform pg_temp.as_user(4);set local role authenticated;
 perform pg_temp.ok(pg_temp.code($q$select public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')$q$)='42501','member refused');
 reset role;
end$$;

-- Assigned doctor: source carries the rows and a token; approval binds to that token.
select pg_temp.as_user(2);
set local role authenticated;
do $$declare s jsonb:=public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004');t text;a jsonb;b jsonb;
begin
 perform pg_temp.ok((s->>'enabled')::boolean and s->>'token' ~ '^[0-9a-f]{32}$','source enabled with token');
 perform pg_temp.ok(jsonb_array_length(s#>'{source,homeReadings}')=1 and s#>>'{source,homeReadings,0,systolic}'='152','home reading present');
 perform pg_temp.ok(s#>>'{source,profile,name}'='Fictional GP member' and s->>'doctorName'='Synthetic assigned doctor','profile and doctor name');
 t:=s->>'token';
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_gp_report_approve(%L,%L,%L,%L)','9e000000-0000-4000-8000-000000000004','ffffffffffffffffffffffffffffffff',pg_temp.content('ffffffffffffffffffffffffffffffff'),'9e000000-0000-4000-8000-000000000101'))='40001','stale token refused');
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_gp_report_approve(%L,%L,%L,%L)','9e000000-0000-4000-8000-000000000004',t,pg_temp.content(t,'9e000000-0000-4000-8000-000000000009'),'9e000000-0000-4000-8000-000000000102'))='22023','content for another member refused');
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_gp_report_approve(%L,%L,%L,%L)','9e000000-0000-4000-8000-000000000004',t,pg_temp.content(t)-'kind','9e000000-0000-4000-8000-000000000106'))='22023','content that is not a GP report refused');
 perform pg_temp.ok(pg_temp.code(format('select public.doctor_gp_report_approve(%L,%L,%L,%L)','9e000000-0000-4000-8000-000000000004',t,pg_temp.content('eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'),'9e000000-0000-4000-8000-000000000103'))='22023','content built on another token refused');
 a:=public.doctor_gp_report_approve('9e000000-0000-4000-8000-000000000004',t,pg_temp.content(t),'9e000000-0000-4000-8000-000000000104');
 perform pg_temp.ok((a->>'version')::int=1 and a->>'approvedByName'='Synthetic assigned doctor' and a->>'contentSha256' ~ '^[0-9a-f]{64}$','first approval is version 1 with reviewer');
 b:=public.doctor_gp_report_approve('9e000000-0000-4000-8000-000000000004',t,pg_temp.content(t),'9e000000-0000-4000-8000-000000000104');
 perform pg_temp.ok(b=a,'replay returns the recorded outcome');
 b:=public.doctor_gp_report_approve('9e000000-0000-4000-8000-000000000004',t,pg_temp.content(t),'9e000000-0000-4000-8000-000000000105');
 perform pg_temp.ok((b->>'version')::int=2,'a new approval is a new version');
 perform pg_temp.ok((public.doctor_gp_report_version('9e000000-0000-4000-8000-000000000004',1)->'content'->>'sourceToken')=t,'doctor reads frozen content');
 perform pg_temp.ok(jsonb_array_length(public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')->'versions')=2,'source lists versions');
end$$;
select pg_temp.ok((select count(*) from public.gp_report_versions)=2,'doctor reads version metadata');
select pg_temp.ok(pg_temp.code('select content from public.gp_report_versions')='42501','content column not granted');
select pg_temp.ok(pg_temp.code('select approved_by from public.gp_report_versions')='42501','approver id column not granted');
select pg_temp.ok(pg_temp.code($$update public.gp_report_versions set version=9$$)='42501','versions are not updatable');
select pg_temp.ok(pg_temp.code($$delete from public.gp_report_versions$$)='42501','versions are not deletable');
select pg_temp.ok(pg_temp.code($$insert into public.gp_report_versions(member_id,version,template_version,algorithm_version,source_token,content,content_sha256,approved_by,approved_by_name,submission_id) values('9e000000-0000-4000-8000-000000000004',3,'x','x',repeat('a',32),'{}',repeat('a',64),'9e000000-0000-4000-8000-000000000002','x',gen_random_uuid())$$)='42501','no direct insert');
reset role;

-- A replay from another doctor's session cannot claim the submission.
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok((select count(*) from public.gp_report_versions)=0,'other doctor sees no versions');
select pg_temp.ok(pg_temp.code($$select public.doctor_gp_report_version('9e000000-0000-4000-8000-000000000004',1)$$)='42501','other doctor cannot read content');
reset role;
select pg_temp.as_user(5);
set local role authenticated;
select pg_temp.ok((select count(*) from public.gp_report_versions)=2,'admin reads version metadata');
select pg_temp.ok(pg_temp.code('select content from public.gp_report_versions')='42501','admin cannot read content');
select pg_temp.ok(pg_temp.code($$select public.doctor_gp_report_version('9e000000-0000-4000-8000-000000000004',1)$$)='42501','admin cannot read content by function');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok((select count(*) from public.gp_report_versions)=0,'member sees no versions');
reset role;

-- New evidence changes the token, so an approval on the old view is refused.
select pg_temp.as_user(2);
set local role authenticated;
create temp table seen as select public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')->>'token' token;
reset role;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at,source)values('9e000000-0000-4000-8000-000000000004',gen_random_uuid(),150,90,74,now(),'manual');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok((select token from seen)<>(public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')->>'token'),'new reading changes the token');
select pg_temp.ok(pg_temp.code(format('select public.doctor_gp_report_approve(%L,%L,%L,gen_random_uuid())','9e000000-0000-4000-8000-000000000004',(select token from seen),pg_temp.content((select token from seen))))='40001','approval on the old view refused');
reset role;

-- Switching off hides the metadata again.
update public.gp_report_capabilities set enabled=false where singleton;
select pg_temp.as_user(5);
set local role authenticated;
select pg_temp.ok((select count(*) from public.gp_report_versions)=0,'switch off hides versions from admin');
reset role;
-- No grant reaches anon.
set local role anon;
select pg_temp.ok(pg_temp.code('select id from public.gp_report_versions')='42501','anon has no access');
select pg_temp.ok(pg_temp.code($$select public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')$$)='42501','anon cannot call the source');
reset role;
-- B2-1: a medicine counts as current only on the active plan and within its dates.
update public.gp_report_capabilities set enabled=true where singleton;
insert into public.patient_care_plans(id,user_id,clinician,published_at,instructions,active,retired_at)values
 ('9e000000-0000-4000-8000-000000000201','9e000000-0000-4000-8000-000000000004','x',now()-interval '20 days','x',false,now()-interval '10 days'),
 ('9e000000-0000-4000-8000-000000000202','9e000000-0000-4000-8000-000000000004','x',now()-interval '10 days','x',true,null);
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date,end_date)values
 ('9e000000-0000-4000-8000-000000000211','9e000000-0000-4000-8000-000000000004','9e000000-0000-4000-8000-000000000201','Retired','1','x','{08:00}',current_date-20,null),
 ('9e000000-0000-4000-8000-000000000212','9e000000-0000-4000-8000-000000000004','9e000000-0000-4000-8000-000000000202','Ended','1','x','{08:00}',current_date-10,current_date-5),
 ('9e000000-0000-4000-8000-000000000213','9e000000-0000-4000-8000-000000000004','9e000000-0000-4000-8000-000000000202','Current','1','x','{08:00}',current_date-10,null);
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok((select jsonb_object_agg(x->>'name',x->'active') from jsonb_array_elements(public.doctor_gp_report_source('9e000000-0000-4000-8000-000000000004')#>'{source,medications}')x)
 ='{"Retired":false,"Ended":false,"Current":true}','medicines active only on the active plan and in date');
reset role;
rollback;
\echo 'GP report SQL checks passed.'
