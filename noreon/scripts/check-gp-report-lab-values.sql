-- Fictional checks for QA N-01: the GP report source carries clinic lab PDF values (#225) only after
-- the assigned doctor confirmed or corrected them; unchecked values carry no value; rejected values,
-- detached or moved files and another member's values never appear; a confirmation changes the token.
-- All fixtures roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- Text of a source for leak searches, with timestamps blanked: a real clock value such as
-- 12:34:03.618 contains '3.61' by chance (flaky on #270). Values themselves are never timestamps.
create function pg_temp.txt(j jsonb) returns text language sql immutable as $$
 select regexp_replace(j::text,'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?','<ts>','g')
$$;
-- 02 assigned doctor, 03 other doctor, 04 member, 05 other member, 06 nurse, 07 clinic.
insert into auth.users(id,phone,phone_confirmed_at)select ('9e100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5)then '3740009610'||n end,case when n in(4,5)then now()end from generate_series(2,6)n;
insert into auth.sessions(id,user_id,created_at,updated_at)select ('9e100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,('9e100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now(),now() from generate_series(2,6)n;
insert into public.workspace_clinics(id,name)values('9e100000-0000-4000-8000-000000000007','Synthetic GP lab clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('9e100000-0000-4000-8000-000000000002','doctor','Synthetic assigned doctor','9e100000-0000-4000-8000-000000000007'),
 ('9e100000-0000-4000-8000-000000000003','doctor','Synthetic other doctor','9e100000-0000-4000-8000-000000000007'),
 ('9e100000-0000-4000-8000-000000000006','nurse','Synthetic nurse','9e100000-0000-4000-8000-000000000007');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('9e100000-0000-4000-8000-000000000004','9e100000-0000-4000-8000-000000000002'),
 ('9e100000-0000-4000-8000-000000000005','9e100000-0000-4000-8000-000000000003');
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,created_at)values
 ('9e100000-0000-4000-8000-000000000041','9e100000-0000-4000-8000-000000000004','9e100000-0000-4000-8000-000000000006','Synthetic nurse','nurse','9e100000-0000-4000-8000-000000000007',now()-interval '3 hours'),
 ('9e100000-0000-4000-8000-000000000051','9e100000-0000-4000-8000-000000000005','9e100000-0000-4000-8000-000000000006','Synthetic nurse','nurse','9e100000-0000-4000-8000-000000000007',now()-interval '3 hours');
-- Files 11 (member 04), 12 (member 05), 13 (member 04, later detached), 14 (member 04, later moved to 05).
set local session_replication_role=replica;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('9e100000-0000-4000-8000-0000000001'||n)::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'9e100000-0000-4000-8000-000000000002',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'PRIVATE-GP-LAB-'||n||'.pdf','application/pdf',1000,repeat('a',64),'synthetic-gp-lab/'||n,('9e100000-0000-4000-8000-0000000002'||n)::uuid,1000,repeat('a',64),'stored',now()-interval '1 hour'
from generate_series(11,14)n;
set local session_replication_role=origin;
create function pg_temp.attach(n int,member int,visit int,prev uuid default null) returns uuid language sql as $$
 insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id)
 values(('9e100000-0000-4000-8000-0000000001'||n)::uuid,'9e100000-0000-4000-8000-000000000007',('9e100000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid,
  ('9e100000-0000-4000-8000-0000000000'||visit)::uuid,'noreon-admin','9e100000-0000-4000-8000-000000000002',gen_random_uuid(),prev)returning id
$$;
create temp table att(n int primary key,id uuid);
insert into att select 11,pg_temp.attach(11,4,41);
insert into att select 12,pg_temp.attach(12,5,51);
insert into att select 13,pg_temp.attach(13,4,41);
insert into att select 14,pg_temp.attach(14,4,41);
insert into public.lab_ai_jobs(attachment_id,file_id,user_id)select a.id,('9e100000-0000-4000-8000-0000000001'||a.n)::uuid,case when a.n=12 then '9e100000-0000-4000-8000-000000000005'else '9e100000-0000-4000-8000-000000000004'end::uuid from att a
 on conflict(attachment_id)do nothing;
-- Values as the worker writes them: born unverified. Distinctive numbers make leaks easy to spot.
create function pg_temp.val(n int,seq int,name text,ref text,v numeric,unit text) returns uuid language sql as $$
 insert into public.lab_ai_values(job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,ref_low,ref_high,collected_on,page)
 select j.id,j.user_id,j.file_id,j.attachment_id,seq,name,ref,v::text,v,unit,0,3,'2026-10-16',1 from public.lab_ai_jobs j where j.file_id=('9e100000-0000-4000-8000-0000000001'||n)::uuid
 returning id
$$;
create temp table vals(label text primary key,id uuid);
insert into vals values('ldl',pg_temp.val(11,1,'LDL-C','ldl_c',3.61,'mmol/L')),('tc',pg_temp.val(11,2,'Total cholesterol','total_cholesterol',5.93,'mmol/L')),
 ('hba1c',pg_temp.val(11,3,'HbA1c','hba1c',7.77,'%')),('creat',pg_temp.val(11,4,'Creatinine','creatinine',141.7,'umol/L')),
 ('other',pg_temp.val(12,1,'LDL-C','ldl_c',9.91,'mmol/L')),('detached',pg_temp.val(13,1,'Potassium',null,4.44,'mmol/L')),('moved',pg_temp.val(14,1,'Sodium',null,133.3,'mmol/L'));
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','9e100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','9e100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.review(label text,status text,corrected numeric default null,corrected_unit text default null,doctor int default 2) returns void language plpgsql as $$begin
 perform pg_temp.as_user(doctor);
 update public.lab_ai_values set status=review.status,corrected_value=corrected,corrected_unit=coalesce(review.corrected_unit,case when corrected is not null then unit end),
  reviewed_by=('9e100000-0000-4000-8000-0000000000'||lpad(doctor::text,2,'0'))::uuid,reviewed_at=clock_timestamp()
 where id=(select id from vals where vals.label=review.label);
end$$;
create function pg_temp.src(member int default 4) returns jsonb language plpgsql as $$declare r jsonb;begin
 perform pg_temp.as_user(case member when 4 then 2 else 3 end);
 set local role authenticated;
 r:=public.doctor_gp_report_source(('9e100000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid);
 reset role;
 return r;
end$$;
create function pg_temp.pdf(s jsonb,name text) returns jsonb language sql as $$
 select x from jsonb_array_elements(s#>'{source,clinicLabValues}')x where x->>'testName'=name
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.as_user(int) to authenticated;
update public.gp_report_capabilities set enabled=true where singleton;

-- 1. Nothing checked yet: every value is named, none carries a number; other member and moved/detached files not yet relevant.
create temp table seen as select pg_temp.src() s;
select pg_temp.ok(jsonb_array_length((select s from seen)#>'{source,clinicLabValues}')=6,'six current values for member 04 before any review (files 11, 13, 14)');
select pg_temp.ok((select bool_and(x->>'status'='unverified' and x->'value'='null'::jsonb and x->'valueText'='null'::jsonb and x->'unit'='null'::jsonb and x->'referenceHigh'='null'::jsonb and x->'reviewedBy'='null'::jsonb)
 from jsonb_array_elements((select s from seen)#>'{source,clinicLabValues}')x),'unchecked values carry no value, unit, range or reviewer');
select pg_temp.ok(pg_temp.txt((select s from seen)) not like '%3.61%' and pg_temp.txt((select s from seen)) not like '%5.93%' and pg_temp.txt((select s from seen)) not like '%7.77%','no unchecked number anywhere in the source');

-- 2. The assigned doctor confirms LDL, corrects total cholesterol (unit kept, then a unit change), rejects creatinine.
select pg_temp.review('ldl','verified');
select pg_temp.review('tc','corrected',5.39);
select pg_temp.review('creat','rejected');
reset role;
create temp table after as select pg_temp.src() s;
select pg_temp.ok((select s from seen)->>'token'<>(select s from after)->>'token','a review changes the source token, so an approval on the old view is stale');
select pg_temp.ok(pg_temp.pdf((select s from after),'LDL-C')->>'status'='verified' and (pg_temp.pdf((select s from after),'LDL-C')->>'value')::numeric=3.61
 and pg_temp.pdf((select s from after),'LDL-C')->>'unit'='mmol/L' and pg_temp.pdf((select s from after),'LDL-C')->>'collectedOn'='2026-10-16'
 and pg_temp.pdf((select s from after),'LDL-C')->>'clinic'='Synthetic GP lab clinic' and pg_temp.pdf((select s from after),'LDL-C')->>'reviewedBy'='Synthetic assigned doctor'
 and (pg_temp.pdf((select s from after),'LDL-C')->>'referenceHigh')::numeric=3,'confirmed value with unit, date, clinic, reviewer and range');
select pg_temp.ok(pg_temp.pdf((select s from after),'Total cholesterol')->>'status'='corrected' and (pg_temp.pdf((select s from after),'Total cholesterol')->>'value')::numeric=5.39
 and pg_temp.pdf((select s from after),'Total cholesterol')->'valueText'='null'::jsonb and pg_temp.txt((select s from after)) not like '%5.93%','a corrected value replaces the AI reading, which never appears');
select pg_temp.ok(pg_temp.pdf((select s from after),'HbA1c')->>'status'='unverified' and pg_temp.pdf((select s from after),'HbA1c')->'value'='null'::jsonb and pg_temp.txt((select s from after)) not like '%7.77%','still unchecked: no value');
select pg_temp.ok(pg_temp.pdf((select s from after),'Creatinine') is null and pg_temp.txt((select s from after)) not like '%141.7%','rejected value is left out');
-- A corrected value in another unit loses the sheet's reference range.
select pg_temp.as_user(2);
update public.lab_ai_values set status='corrected',corrected_value=212,corrected_unit='mg/dL',reviewed_by='9e100000-0000-4000-8000-000000000002',reviewed_at=clock_timestamp() where id=(select id from vals where label='hba1c');
reset role;
select pg_temp.ok(pg_temp.pdf(pg_temp.src(),'HbA1c')->>'unit'='mg/dL' and pg_temp.pdf(pg_temp.src(),'HbA1c')->'referenceHigh'='null'::jsonb and pg_temp.pdf(pg_temp.src(),'HbA1c')->'referenceText'='null'::jsonb,'unit change drops the sheet range');

-- 3. Another member's values never appear, even confirmed by their own doctor.
select pg_temp.review('other','verified',null,null,3);
reset role;
select pg_temp.ok(pg_temp.txt(pg_temp.src()) not like '%9.91%','member 05 value absent from member 04 report');
select pg_temp.ok((select bool_and(x->>'fileId'<>'9e100000-0000-4000-8000-000000000112') from jsonb_array_elements(pg_temp.src()#>'{source,clinicLabValues}')x),'member 05 file absent');
select pg_temp.ok(pg_temp.txt(pg_temp.src(5)) like '%9.91%' and pg_temp.txt(pg_temp.src(5)) not like '%3.61%','member 05 report has its own value and not member 04''s');

-- 4. Detached and moved files leave the report, even with confirmed values.
select pg_temp.review('detached','verified');
select pg_temp.review('moved','verified');
reset role;
select pg_temp.ok(pg_temp.txt(pg_temp.src()) like '%4.44%' and pg_temp.txt(pg_temp.src()) like '%133.3%','confirmed values on current files appear');
insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)select id,'9e100000-0000-4000-8000-000000000002',gen_random_uuid(),'Synthetic wrong member' from att where n=13;
select pg_temp.attach(14,5,51,(select id from att where n=14));
select pg_temp.ok(pg_temp.txt(pg_temp.src()) not like '%4.44%','detached file values leave the report');
select pg_temp.ok(pg_temp.txt(pg_temp.src()) not like '%133.3%','values of a file moved to another member leave the report');
select pg_temp.ok(pg_temp.txt(pg_temp.src(5)) not like '%133.3%','a moved file''s old values do not follow it to the new member');

-- 5. Access is unchanged: other doctor, nurse and the member cannot read member 04's source.
select pg_temp.as_user(3);
set local role authenticated;
do $$begin
 begin perform public.doctor_gp_report_source('9e100000-0000-4000-8000-000000000004');raise exception 'TEST other doctor read the source';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.as_user(4);
set local role authenticated;
do $$begin
 begin perform public.doctor_gp_report_source('9e100000-0000-4000-8000-000000000004');raise exception 'TEST member read the source';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
rollback;
\echo 'GP report lab value SQL checks passed.'
