-- Assigned-doctor queue, no AI read, identity confirmation and access audit. Fictional, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.id(n int)returns uuid language sql immutable as $$select('d9a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(n int)returns void language sql as $$select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.id(n+100))::text,true)$$;
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
grant execute on all functions in schema pg_temp to authenticated,anon;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n<10 then '374991940'||lpad(n::text,2,'0')end,case when n<10 then now()end from unnest(array[1,2,3,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id(n+100),pg_temp.id(n),now(),now()from unnest(array[11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.id(20),'Synthetic mismatch clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.id(11),'doctor','Synthetic doctor',pg_temp.id(20)),(pg_temp.id(12),'doctor','Synthetic other doctor',pg_temp.id(20)),(pg_temp.id(13),'nurse','Synthetic nurse',pg_temp.id(20));
insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name,role)values(pg_temp.id(21),pg_temp.id(14),pg_temp.id(20),'Synthetic clinic admin','admin');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id(1),pg_temp.id(11),pg_temp.id(13)),(pg_temp.id(2),pg_temp.id(12),null),(pg_temp.id(3),pg_temp.id(11),null);
update public.lab_ai_capabilities set enabled=true where singleton;
update public.doctor_completion_capabilities set enabled=true where singleton;
-- Seed current immutable attachments directly; the upload flow is covered separately.
set local session_replication_role=replica;
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values(pg_temp.id(30),pg_temp.id(20),'Synthetic batch',pg_temp.id(14),'Synthetic clinic admin');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state)
select pg_temp.id(40+n),pg_temp.id(30),gen_random_uuid(),gen_random_uuid(),pg_temp.id(14),pg_temp.id(114),'[]',now()+interval '1 hour',pg_temp.id(21),1,gen_random_uuid(),'PRIVATE member patronymic CBC.pdf','application/pdf',10,repeat('a',64),'synthetic-mismatch/'||n,gen_random_uuid(),10,repeat('a',64),'stored'from generate_series(1,3)n;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)select pg_temp.id(50+n),pg_temp.id(n),pg_temp.id(13),'Synthetic nurse','nurse',pg_temp.id(20)from generate_series(1,3)n;
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)select pg_temp.id(60+n),pg_temp.id(40+n),pg_temp.id(20),pg_temp.id(n),pg_temp.id(50+n),'clinic-admin',pg_temp.id(14),gen_random_uuid()from generate_series(1,3)n;
insert into public.clinic_upload_overrides(clinic_id,actor_id,membership_id,member_id,file_id,attachment_id,submission_id,sheet,member_values,mismatch)
select pg_temp.id(20),pg_temp.id(14),pg_temp.id(21),pg_temp.id(n),pg_temp.id(40+n),pg_temp.id(60+n),gen_random_uuid(),'{"name":"Sheet name","birthDate":"1970-01-01"}','{"name":"Member name","birthDate":"1971-01-01"}','both'from generate_series(1,3)n;
-- Member 3 deliberately has no AI job. Member 1's AI guessed match despite the override.
insert into public.lab_ai_jobs(id,kind,file_id,attachment_id,clinic_id,user_id,state,outcome,finished_at,identity_status,identity)
select pg_temp.id(70+n),'attachment',pg_temp.id(40+n),pg_temp.id(60+n),pg_temp.id(20),pg_temp.id(n),'done','extracted',now(),'match','{"nameOnSheet":"Sheet name","birthDateOnSheet":"1970-01-01","sampleDate":"2026-11-05","patientsSeen":1,"nameMatch":"yes","birthDateMatch":"yes"}'from generate_series(1,2)n;
insert into public.lab_ai_values(job_id,user_id,file_id,attachment_id,seq,test_name,value_text,page)values(pg_temp.id(72),pg_temp.id(2),pg_temp.id(42),pg_temp.id(62),1,'Synthetic test','1',1);
set local session_replication_role=origin;
select pg_temp.ok(not exists(select 1 from public.member_reported_documents where user_id in(pg_temp.id(1),pg_temp.id(3))),'override fixtures have no member document row');
select pg_temp.ok(has_function_privilege('authenticated','public.doctor_mismatched_uploads(uuid)','execute')and not has_function_privilege('anon','public.doctor_mismatched_uploads(uuid)','execute')and not has_function_privilege('service_role','public.doctor_mismatched_uploads(uuid)','execute'),'authenticated grant only');
select pg_temp.as_user(11);set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.doctor_mismatched_uploads())=2,'exactly two own open overrides, including no AI read');
select pg_temp.ok(jsonb_array_length(public.doctor_mismatched_uploads(pg_temp.id(3)))=1,'no AI read is discoverable');
select pg_temp.ok((public.doctor_mismatched_uploads(pg_temp.id(1))->0->>'noValuesRead')::boolean,'doctor sees empty completed read even without member documents');
select pg_temp.ok(not(public.doctor_mismatched_uploads(pg_temp.id(3))->0->>'noValuesRead')::boolean,'no AI read is not mislabeled as empty');
select pg_temp.ok(pg_temp.denied($$select public.doctor_mismatched_uploads(pg_temp.id(2))$$),'other doctor member refused');
select pg_temp.ok(public.doctor_lab_ai_read(pg_temp.id(1),pg_temp.id(41))#>>'{job,identityStatus}'='mismatch','classic and chat confirmation control remains available despite AI match');
select pg_temp.ok(public.doctor_lab_ai_identity_confirm(jsonb_build_object('version','lab-ai-identity-v1','memberId',pg_temp.id(1),'jobId',pg_temp.id(71),'note','Synthetic identity checked'))->>'status'='open-first','cannot confirm without opening PDF');
reset role;
insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind)values(pg_temp.id(1),pg_temp.id(41),pg_temp.id(61),pg_temp.id(11),'doctor');
set local role authenticated;
select pg_temp.ok(public.doctor_lab_ai_identity_confirm(jsonb_build_object('version','lab-ai-identity-v1','memberId',pg_temp.id(1),'jobId',pg_temp.id(71),'note','Synthetic identity checked'))->>'status'='confirmed','existing confirmation resolves overridden AI match');
reset role;
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.doctor_mismatched_uploads())=1 and public.doctor_mismatched_uploads()->0->>'memberId'=pg_temp.id(3)::text,'confirmed file drops off; no-AI file stays');
reset role;
select pg_temp.ok(exists(select 1 from public.access_audit where actor_id=pg_temp.id(11)and member_id=pg_temp.id(1)and surface='member_upload_overrides'and object_id=pg_temp.id(41)::text),'confirmation audited');
select pg_temp.ok(not exists(select 1 from public.access_audit where actor_id=pg_temp.id(11)and member_id=pg_temp.id(2)and surface='member_upload_overrides'),'other member never audited as displayed');
select pg_temp.as_user(12);set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.doctor_mismatched_uploads())=1 and public.doctor_mismatched_uploads()->0->>'memberId'=pg_temp.id(2)::text,'other doctor sees only own file');
select pg_temp.ok(not(public.doctor_mismatched_uploads(pg_temp.id(2))->0->>'noValuesRead')::boolean,'doctor sees a nonempty completed read');
select pg_temp.ok(pg_temp.denied($$select public.doctor_mismatched_uploads(pg_temp.id(1))$$),'other doctor cannot read first doctor member');
reset role;
select pg_temp.as_user(13);set local role authenticated;
select pg_temp.ok(pg_temp.denied($$select public.doctor_mismatched_uploads()$$),'nurse cannot read doctor queue');
reset role;
select pg_temp.as_user(14);set local role authenticated;
select pg_temp.ok(pg_temp.denied($$select public.doctor_mismatched_uploads()$$),'clinic user refused');
reset role;
rollback;
