-- C-17 clinic read-status regression. Fictional fixtures; everything rolls back.
-- Run after migration replay: psql -f scripts/check-clinic-file-empty-read-status.sql.
\set ON_ERROR_STOP on
begin;
create function pg_temp.cf_id(n int)returns uuid language sql immutable as $$select('d9a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.cf_ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;
end$$;
create function pg_temp.cf_user(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.cf_id(n),'role','authenticated','exp',4102444800,
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.cf_id(n+1000))::text,true),
  set_config('request.jwt.claim.sub',pg_temp.cf_id(n)::text,true)
$$;
create function pg_temp.cf_json(n int)returns jsonb language sql volatile as $$
 select public._clinic_member_file_json(pg_temp.cf_id(20),pg_temp.cf_id(1),f,case when n=11 then 'unmatched'else 'attached'end,true)
 from public.clinic_batch_files f where f.id=pg_temp.cf_id(40+n)
$$;
create function pg_temp.cf_safe(j jsonb)returns boolean language sql immutable as $$
 select jsonb_typeof(j)='object'
  and j?&array['fileId','name','uploadedAt','fromRecord','state','attached','override','fileReading','memberReading','readingOn','compare','noValuesRead']
  and j-array['fileId','name','uploadedAt','fromRecord','state','attached','override','fileReading','memberReading','readingOn','compare','noValuesRead']='{}'::jsonb
  and jsonb_typeof(j->'noValuesRead')='boolean'
  and j->>'name'='PDF '||to_char((j->>'uploadedAt')::timestamptz at time zone 'Asia/Yerevan','YYYY-MM-DD')||'.pdf'
  and j::text not like '%PRIVATE_%'
$$;
grant execute on function pg_temp.cf_id(int),pg_temp.cf_ok(boolean,text),pg_temp.cf_user(int) to authenticated;

insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.cf_id(n),case when n<10 then '374991940'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,11,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.cf_id(1014),pg_temp.cf_id(14),now(),now());
insert into public.workspace_clinics(id,name)values(pg_temp.cf_id(20),'Synthetic read-status clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.cf_id(11),'doctor','Synthetic doctor',pg_temp.cf_id(20));
insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name,role)values(pg_temp.cf_id(21),pg_temp.cf_id(14),pg_temp.cf_id(20),'Synthetic clinic admin','admin');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.cf_id(1),pg_temp.cf_id(11)),(pg_temp.cf_id(2),pg_temp.cf_id(11));
insert into public.clinic_portal_capabilities(singleton,result_attach_enabled,clinic_admin_full_access)values(true,true,true)
 on conflict(singleton)do update set result_attach_enabled=true,clinic_admin_full_access=true;
update public.clinic_scheduling_capabilities set enabled=true where singleton;
update public.lab_ai_capabilities set enabled=true where singleton;

-- As in the other clinic checks, bypass upload/attachment side effects only for fixture setup.
set local session_replication_role=replica;
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)
 values(pg_temp.cf_id(30),pg_temp.cf_id(20),'PRIVATE_BATCH',pg_temp.cf_id(14),'Synthetic clinic admin'),
 (pg_temp.cf_id(31),pg_temp.cf_id(20),'PRIVATE_UNLINKED_BATCH',pg_temp.cf_id(14),'Synthetic clinic admin');
insert into public.clinic_member_uploads(batch_id,clinic_id,member_id,actor_id,membership_id)
 values(pg_temp.cf_id(30),pg_temp.cf_id(20),pg_temp.cf_id(1),pg_temp.cf_id(14),pg_temp.cf_id(21));
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state)
 select pg_temp.cf_id(40+n),pg_temp.cf_id(case when n=11 then 31 else 30 end),gen_random_uuid(),gen_random_uuid(),pg_temp.cf_id(14),pg_temp.cf_id(1014),'[]',now()+interval '1 hour',pg_temp.cf_id(21),1,gen_random_uuid(),
 'PRIVATE_FILENAME_member_CBC.pdf','application/pdf',10,repeat('a',64),'PRIVATE_OBJECT/'||n,gen_random_uuid(),10,repeat('a',64),'stored'
 from generate_series(1,14)n;
insert into public.clinic_member_upload_files(file_id,batch_id,state)
 select pg_temp.cf_id(40+n),pg_temp.cf_id(30),'attached'from generate_series(1,14)n where n<>11;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,source)
 select pg_temp.cf_id(80+n),pg_temp.cf_id(n),pg_temp.cf_id(14),'Synthetic clinic admin','clinic',pg_temp.cf_id(20),'clinic-upload'from generate_series(1,2)n;
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
 select pg_temp.cf_id(100+n),pg_temp.cf_id(40+n),pg_temp.cf_id(20),pg_temp.cf_id(1),pg_temp.cf_id(81),'clinic-admin',pg_temp.cf_id(14),gen_random_uuid()
 from generate_series(1,14)n where n<>11;
insert into public.clinic_upload_overrides(clinic_id,actor_id,membership_id,member_id,file_id,attachment_id,submission_id,sheet,member_values,mismatch)
 values(pg_temp.cf_id(20),pg_temp.cf_id(14),pg_temp.cf_id(21),pg_temp.cf_id(1),pg_temp.cf_id(45),pg_temp.cf_id(105),gen_random_uuid(),
 '{"name":"PRIVATE_SHEET_NAME","birthDate":"1970-01-01"}','{"name":"PRIVATE_MEMBER_NAME","birthDate":"1971-01-01"}','both');
-- 1 values; 2 empty; 3 unreadable/done; 4 unreadable/failed; 5 override with values;
-- 6 no job; 7/8 only file read done/failed; 9 other failure; 10 success after unreadable;
-- 11 unlinked unreadable; 12 detached; 13 moved; 14 queued retry after unreadable.
insert into public.lab_ai_jobs(id,kind,file_id,attachment_id,clinic_id,user_id,state,outcome,finished_at,identity_status,identity,summary)
 select pg_temp.cf_id(200+n),'attachment',pg_temp.cf_id(40+n),pg_temp.cf_id(100+n),pg_temp.cf_id(20),pg_temp.cf_id(1),
 case when n=14 then 'queued'when n in(4,9)then 'failed'else 'done'end,
 case when n=14 then null when n in(3,4)then 'unreadable'when n=9 then 'provider_error'when n in(2,12,13)then 'no_values'else 'extracted'end,
 case when n<>14 then now()end,case when n in(3,4)then 'unknown'else 'match'end,
 '{"nameOnSheet":"PRIVATE_IDENTITY","birthDateOnSheet":"1970-01-01"}','{"text":"PRIVATE_SUMMARY"}'
 from unnest(array[1,2,3,4,5,9,10,12,13,14])n;
insert into public.lab_ai_values(job_id,user_id,file_id,attachment_id,seq,test_name,value_text,page)
 select pg_temp.cf_id(200+n),pg_temp.cf_id(1),pg_temp.cf_id(40+n),pg_temp.cf_id(100+n),1,'PRIVATE_TEST','PRIVATE_VALUE',1
 from unnest(array[1,5,10])n;
insert into public.lab_ai_jobs(kind,file_id,clinic_id,state,outcome,finished_at,identity_status,identity,extraction)
 select 'file',pg_temp.cf_id(40+n),pg_temp.cf_id(20),case when n=8 then 'failed'else 'done'end,'unreadable',now(),'unknown',
 '{"nameOnSheet":"PRIVATE_IDENTITY"}','{"text":"PRIVATE_EXTRACTION"}'from unnest(array[7,8,10,11,12,14])n;
insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)
 values(pg_temp.cf_id(112),pg_temp.cf_id(11),gen_random_uuid(),'Synthetic detachment');
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id,created_at)
 values(pg_temp.cf_id(153),pg_temp.cf_id(53),pg_temp.cf_id(20),pg_temp.cf_id(2),pg_temp.cf_id(82),'noreon-admin',pg_temp.cf_id(11),gen_random_uuid(),pg_temp.cf_id(113),now()+interval '1 minute');
insert into public.lab_ai_jobs(kind,file_id,attachment_id,clinic_id,user_id,state,outcome,finished_at)
 values('attachment',pg_temp.cf_id(53),pg_temp.cf_id(153),pg_temp.cf_id(20),pg_temp.cf_id(2),'done','no_values',now());
set local session_replication_role=origin;

select pg_temp.cf_ok(pg_temp.cf_safe(pg_temp.cf_json(n)),'Boolean-only status and sanitized filename, fixture '||n)from generate_series(1,14)n;
select pg_temp.cf_ok(pg_temp.cf_json(n)->'noValuesRead'='true'::jsonb,'Empty/unreadable, fixture '||n)from unnest(array[2,3,4,7,8,11])n;
select pg_temp.cf_ok(pg_temp.cf_json(n)->'noValuesRead'='false'::jsonb,'Values, no read, other failure, detached/moved or queued retry, fixture '||n)from unnest(array[1,5,6,9,10,12,13,14])n;
select pg_temp.cf_ok(pg_temp.cf_json(5)->'override'='true'::jsonb and pg_temp.cf_json(5)->'compare'='null'::jsonb,'Override exposes only its status, no stored identity details');
select pg_temp.cf_ok(pg_temp.cf_json(12)->'attached'='false'::jsonb and pg_temp.cf_json(13)->'attached'='false'::jsonb,'Current attachment guard is retained');
select pg_temp.cf_ok(not has_function_privilege('authenticated','public._clinic_member_file_json(uuid,uuid,public.clinic_batch_files,text,boolean)','execute'),'Internal helper stays private');

-- Also exercise the public caller as the clinic, so the new boolean is not lost in aggregation.
create temporary table cf_response(data jsonb);
grant insert on cf_response to authenticated;
select pg_temp.cf_user(14);set local role authenticated;
insert into cf_response select public.clinic_admin_member_files(pg_temp.cf_id(20),pg_temp.cf_id(1));
reset role;
select pg_temp.cf_ok(data->>'status'='ok'and jsonb_array_length(data->'uploads')=13,'Clinic RPC still lists its record uploads')from cf_response;
select pg_temp.cf_ok(pg_temp.cf_safe(f),'Public clinic JSON has no values, counts, PDF target or source filename')from cf_response cross join lateral jsonb_array_elements(data->'uploads')f;
select pg_temp.cf_ok(f->'noValuesRead'=to_jsonb(n in(2,3,4,7,8)),'Public caller retains status, fixture '||n)
 from cf_response cross join generate_series(1,14)n cross join lateral jsonb_array_elements(data->'uploads')f where f->>'fileId'=pg_temp.cf_id(40+n)::text;
rollback;
