-- Atomic confirm-passing regression checks. Synthetic fixtures roll back; no hosted data.
-- Off by default; the database re-checks identity, sample date against the visit day, range, flags and
-- code checks whatever the worker proposes; the guard refuses any other route; the doctor can still
-- confirm, correct or reject; a review is not undone; counts and the doctor's read show the new status.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.raises(statement text,code text default '42501') returns boolean language plpgsql as $$begin
 execute statement;return false;
exception when others then
 if sqlstate=code then return true;end if;
 raise notice 'unexpected % %',sqlstate,sqlerrm;return false;
end$$;
-- a5c: doctor 02, members 04/05, nurse 06, clinic 07. Visit 41 on 15 Oct (Yerevan), visit 42 on 10 Oct.
insert into auth.users(id,phone,phone_confirmed_at)select ('a5c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n=4 then '374000970004'end,case when n=4 then now()end from unnest(array[2,4,5,6])n;
insert into public.workspace_clinics(id,name)values('a5c00000-0000-4000-8000-000000000007','Synthetic auto-accept clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('a5c00000-0000-4000-8000-000000000002','doctor','Synthetic auto-accept doctor','a5c00000-0000-4000-8000-000000000007'),
 ('a5c00000-0000-4000-8000-000000000006','nurse','Synthetic auto-accept nurse','a5c00000-0000-4000-8000-000000000007');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('a5c00000-0000-4000-8000-000000000004','a5c00000-0000-4000-8000-000000000002'),
 ('a5c00000-0000-4000-8000-000000000005','a5c00000-0000-4000-8000-000000000002');
update public.profiles set display_name='Synthetic Member Four',birth_date='1970-01-02'where id='a5c00000-0000-4000-8000-000000000004';
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,created_at)values
 ('a5c00000-0000-4000-8000-000000000041','a5c00000-0000-4000-8000-000000000004','a5c00000-0000-4000-8000-000000000006','Synthetic nurse','nurse','a5c00000-0000-4000-8000-000000000007','2026-10-15 22:30+04'),
 ('a5c00000-0000-4000-8000-000000000042','a5c00000-0000-4000-8000-000000000004','a5c00000-0000-4000-8000-000000000006','Synthetic nurse','nurse','a5c00000-0000-4000-8000-000000000007','2026-10-10 10:00+04');
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values
 ('a5c00000-0000-4000-8000-000000000051','a5c00000-0000-4000-8000-000000000005','a5c00000-0000-4000-8000-000000000006','Synthetic nurse','nurse','a5c00000-0000-4000-8000-000000000007');
set local session_replication_role=replica;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('a5c00000-0000-4000-8000-0000000001'||n)::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'a5c00000-0000-4000-8000-000000000002',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'PRIVATE-AUTO-'||n||'.pdf','application/pdf',1000,repeat('a',64),'synthetic-auto-accept/'||n,('a5c00000-0000-4000-8000-0000000002'||n)::uuid,1000,repeat('a',64),'stored',now()
from generate_series(11,15)n;
insert into storage.objects(id,bucket_id,name,metadata)select ('a5c00000-0000-4000-8000-0000000002'||n)::uuid,'clinic-originals','synthetic-auto-accept/'||n,'{"size":1000}'from generate_series(11,15)n;
set local session_replication_role=origin;
update public.doctor_completion_capabilities set enabled=true where singleton;
update public.lab_ai_capabilities set enabled=true where singleton;

create function pg_temp.attach(n int,visit int,member int default 4) returns uuid language sql as $$
 insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
 values(('a5c00000-0000-4000-8000-0000000003'||n)::uuid,('a5c00000-0000-4000-8000-0000000001'||n)::uuid,'a5c00000-0000-4000-8000-000000000007',('a5c00000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid,
  ('a5c00000-0000-4000-8000-0000000000'||visit)::uuid,'noreon-admin','a5c00000-0000-4000-8000-000000000002',gen_random_uuid())returning id
$$;
-- A live password session for the user (staff RPCs require a managed session, 20261020195207).
create function pg_temp.as_user(n int) returns void language plpgsql security definer as $$declare c jsonb:=jsonb_build_object('sub','a5c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','a5c00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'));begin
 insert into auth.sessions(id,user_id,created_at,updated_at)select (c->>'session_id')::uuid,(c->>'sub')::uuid,now(),now()
  where exists(select 1 from auth.users where id=(c->>'sub')::uuid)on conflict(id)do nothing;
 perform set_config('request.jwt.claims',(c||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password'))))::text,true);
end$$;
create function pg_temp.as_service() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.job(n int) returns public.lab_ai_jobs language sql security definer as $$select * from public.lab_ai_jobs where file_id=('a5c00000-0000-4000-8000-0000000001'||n)::uuid order by created_at desc limit 1$$;
create function pg_temp.v(n int,q int) returns public.lab_ai_values language sql security definer as $$
 select v.* from public.lab_ai_values v join public.lab_ai_jobs j on j.id=v.job_id where j.file_id=('a5c00000-0000-4000-8000-0000000001'||n)::uuid and v.seq=q
$$;
-- An in-range haemoglobin the worker proposes; `extra` overrides fields.
create function pg_temp.value(extra jsonb default '{}') returns jsonb language sql as $$
 with fixture as(select jsonb_build_object('testName','Haemoglobin','catalogueRef','hemoglobin','valueText','140','value',140,'unit','g/L','refLow',120,'refHigh',160,'refText','120-160','labFlag',null,
  'collectedOn',(now()at time zone 'Asia/Yerevan')::date::text,'labName','Synthetic lab','page',1,'snippet','Haemoglobin 140 g/L','checks','[]'::jsonb,'attention',null,'attentionRule',null,'autoAccept',true)||extra v)
 select v||jsonb_build_object('snippet',case when extra ? 'snippet'then extra->>'snippet'
  else concat_ws(' ',v->>'testName',v->>'valueText',v->>'unit',case when v->>'refText' is not null then '['||(v->>'refText')||']'end)end)from fixture
$$;
create function pg_temp.done(vals jsonb,status text default 'match') returns jsonb language sql as $$
 select jsonb_build_object('disposition','done','outcome','extracted','pageCount',2,'sourceSha256',repeat('a',64),'identityStatus',status,
  'identity',jsonb_build_object('nameOnSheet','Synthetic Member Four'),'values',vals,'summary',null,'provider','noreon.fake','model','noreon-fake-lab-1')
$$;
create function pg_temp.finish(n int,vals jsonb,status text default 'match') returns jsonb language plpgsql as $$
declare j public.lab_ai_jobs:=pg_temp.job(n);begin return public.lab_ai_job_finish(j.id,j.lease_token,pg_temp.done(vals,status));end$$;
create function pg_temp.review(sub text,value uuid,act text,extra jsonb default '{}') returns jsonb language sql as $$
 select public.doctor_lab_ai_value_review(jsonb_build_object('version','lab-ai-review-v1','submissionId','a5c00000-0000-4000-8000-0000000009'||sub,
  'memberId','a5c00000-0000-4000-8000-000000000004','valueId',value,'action',act)||extra)
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int),pg_temp.as_service(),pg_temp.job(int),pg_temp.v(int,int),pg_temp.value(jsonb),
 pg_temp.done(jsonb,text),pg_temp.finish(int,jsonb,text),pg_temp.review(text,uuid,text,jsonb) to authenticated,service_role;


-- Keep values unverified at extraction, then enable the rules for the doctor's press.
update public.lab_ai_capabilities set auto_accept_enabled=false where singleton;
select pg_temp.attach(11,41),pg_temp.attach(12,41),pg_temp.attach(13,41),pg_temp.attach(14,41),pg_temp.attach(15,51,5);
select pg_temp.as_service();
set local role service_role;
select public.lab_ai_job_claim(5);
select pg_temp.finish(11,jsonb_build_array(pg_temp.value(),pg_temp.value('{"valueText":"251","value":251}'),pg_temp.value(),pg_temp.value(),pg_temp.value(),pg_temp.value()));
select pg_temp.finish(12,jsonb_build_array(pg_temp.value()),'mismatch');
select pg_temp.finish(13,'[]'::jsonb);
select pg_temp.finish(14,jsonb_build_array(pg_temp.value(),pg_temp.value()));
reset role;
update public.lab_ai_capabilities set auto_accept_enabled=true where singleton;
create function pg_temp.confirm(n int,sub text default '01',extra jsonb default '{}') returns jsonb language sql as $$
 select public.doctor_lab_ai_confirm_passing(jsonb_build_object('version','lab-ai-confirm-passing-v1',
  'submissionId','a5c00000-0000-4000-8000-0000000008'||sub,'memberId','a5c00000-0000-4000-8000-000000000004',
  'fileId',(pg_temp.job(n)).file_id)||extra)
$$;
grant execute on function pg_temp.confirm(int,text,jsonb) to authenticated;
select pg_temp.ok((select bool_and(file_id<>attachment_id)from public.lab_ai_jobs where file_id::text like 'a5c00000-%'),'fixture file IDs differ from attachment IDs');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.confirm(15,'20')->>'status'='stale','foreign member file is stale even for the same assigned doctor');
select pg_temp.ok(pg_temp.confirm(11)->>'status'='open-first','file must be opened');
select pg_temp.ok(pg_temp.confirm(12)->>'status'='identity-first','identity is checked before open');
reset role;
insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind)
 select j.user_id,j.file_id,j.attachment_id,'a5c00000-0000-4000-8000-000000000002','doctor'from public.lab_ai_jobs j
 where j.attachment_id in((pg_temp.job(11)).attachment_id,(pg_temp.job(13)).attachment_id,(pg_temp.job(14)).attachment_id);
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.review('11',(pg_temp.v(11,3)).id,'correct','{"value":142,"unit":"g/L","note":"Synthetic correction"}');
select pg_temp.review('12',(pg_temp.v(11,4)).id,'reject');
-- The page showed seq 5 unverified. Another review corrects it before the press.
select pg_temp.review('13',(pg_temp.v(11,5)).id,'correct','{"value":143,"unit":"g/L"}');
reset role;
-- Preserve an already accepted row too, using the worker's guarded path.
select set_config('noreon.lab_auto_accept_job',(pg_temp.job(11)).id::text,true);
update public.lab_ai_values set status='auto_accepted',auto_accepted_at=clock_timestamp(),auto_accept_rule='lab-auto-accept-v2'where id=(pg_temp.v(11,6)).id;
create temporary table prior_values as select v.* from public.lab_ai_values v where v.attachment_id=(pg_temp.job(11)).attachment_id and seq>=3;
select pg_temp.ok(public._lab_ai_auto_accept_ok(pg_temp.v(11,1)),'passing fixture meets rules');
select pg_temp.ok(not public._lab_ai_auto_accept_ok(pg_temp.v(11,2)),'251 g/L fails the sanity window');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.confirm(11)='{"status":"saved","replayed":false,"confirmed":1,"remaining":1}'::jsonb,'only the passing unverified row is confirmed');
select pg_temp.ok((pg_temp.v(11,1)).status='verified'and(pg_temp.v(11,1)).reviewed_by=auth.uid()and(pg_temp.v(11,1)).reviewed_at is not null,'assigned doctor stamps confirmation');
select pg_temp.ok((pg_temp.v(11,2)).status='unverified','failing value stays unverified');
select pg_temp.ok(pg_temp.confirm(11)='{"status":"saved","replayed":true,"confirmed":1,"remaining":1}'::jsonb,'replay returns original counts');
select pg_temp.ok(pg_temp.confirm(11,'02')='{"status":"saved","replayed":false,"confirmed":0,"remaining":1}'::jsonb,'fresh command skips reviewed values');
select pg_temp.ok(pg_temp.confirm(13,'03')='{"status":"saved","replayed":false,"confirmed":0,"remaining":0}'::jsonb,'empty attachment records a receipt');
select pg_temp.ok(pg_temp.confirm(13,'03')->>'replayed'='true','zero-value command also replays');
select pg_temp.ok(pg_temp.confirm(13,'01')->>'status'='stale','submission cannot be reused on another attachment');
select pg_temp.ok(pg_temp.confirm(11,'04','{"attachmentId":"a5c00000-0000-4000-8000-000000000311"}')->>'status'='invalid','old attachment key rejected');
select pg_temp.ok(pg_temp.confirm(11,'04','{"unexpected":true}')->>'status'='invalid','unknown keys rejected');
select pg_temp.ok(pg_temp.confirm(11,'04','{"fileId":null}')->>'status'='invalid','null ids rejected');
select pg_temp.ok(pg_temp.confirm(11,'04','{"submissionId":"bad"}')->>'status'='invalid','malformed uuid rejected');
reset role;
select pg_temp.ok(not exists(select 1 from prior_values p join public.lab_ai_values v using(id)where to_jsonb(p)is distinct from to_jsonb(v)),'corrected, rejected, racing correction and auto-accepted rows are unchanged');
select pg_temp.ok((select attachment_id=(pg_temp.job(11)).attachment_id and attachment_id<>(pg_temp.job(11)).file_id from public.lab_ai_confirm_passing_commands where submission_id='a5c00000-0000-4000-8000-000000000801'),'receipt stores the resolved attachment, not the file ID');
select pg_temp.ok((select count(*)=1 from public.lab_ai_value_reviews where action='confirm'and value_id=(pg_temp.v(11,1)).id),'one audit row despite replay');
select pg_temp.ok((select before->>'status'='unverified'and after->>'status'='verified'and after->>'reviewedBy'='a5c00000-0000-4000-8000-000000000002'from public.lab_ai_value_reviews where value_id=(pg_temp.v(11,1)).id),'audit captures before and after');
-- A doctor's subsequent decision is retained even when the old command is retried.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.review('14',(pg_temp.v(11,1)).id,'reject');
select pg_temp.ok(pg_temp.confirm(11)->>'confirmed'='1','replay is a receipt, not a recount');
select pg_temp.ok((pg_temp.v(11,1)).status='rejected','replay never re-confirms a later rejection');
reset role;
-- Deliberate audit submission collision on the LAST row exercises all-or-nothing
-- rollback: neither the earlier update/audit nor a receipt may survive the failure.
insert into public.lab_ai_value_reviews(value_id,submission_id,actor_id,action,before,after)
 select v.id,md5('lab-ai-confirm-passing-v1:a5c00000-0000-4000-8000-000000000810:'||v.id::text)::uuid,
 'a5c00000-0000-4000-8000-000000000002','confirm','{}','{}'
 from public.lab_ai_values v where v.attachment_id=(pg_temp.job(14)).attachment_id order by v.id desc limit 1;
set local role authenticated;
select pg_temp.ok(pg_temp.confirm(14,'10')->>'status'='stale','audit collision returns stale without a unique violation');
reset role;
select pg_temp.ok((select count(*)=2 from public.lab_ai_values where attachment_id=(pg_temp.job(14)).attachment_id and status='unverified'),'late collision rolls back every value');
select pg_temp.ok((select count(*)=1 from public.lab_ai_value_reviews r join public.lab_ai_values v on v.id=r.value_id where v.attachment_id=(pg_temp.job(14)).attachment_id),'late collision rolls back earlier audit inserts');
select pg_temp.ok(not exists(select 1 from public.lab_ai_confirm_passing_commands where submission_id='a5c00000-0000-4000-8000-000000000810'),'failed command has no receipt');
set local role authenticated;
select pg_temp.ok(pg_temp.confirm(14,'11')->>'confirmed'='2','fresh command confirms both eligible values after collision');
select pg_temp.ok(pg_temp.confirm(11,'07','{"fileId":"a5c00000-0000-4000-8000-000000000999"}')->>'status'='stale','unknown file is stale');
reset role;
-- Resolve only current attachments, including when an old job or receipt remains.
insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)
 values((pg_temp.job(13)).attachment_id,'a5c00000-0000-4000-8000-000000000002',gen_random_uuid(),'Synthetic detachment');
insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id)
 values('a5c00000-0000-4000-8000-000000000112','a5c00000-0000-4000-8000-000000000007','a5c00000-0000-4000-8000-000000000005',
  'a5c00000-0000-4000-8000-000000000051','noreon-admin','a5c00000-0000-4000-8000-000000000002',gen_random_uuid(),(pg_temp.job(12)).attachment_id);
select pg_temp.ok(not public._lab_ai_current((select attachment_id from public.lab_ai_jobs where file_id='a5c00000-0000-4000-8000-000000000112'and user_id='a5c00000-0000-4000-8000-000000000004')),'old member attachment is no longer current');
set local role authenticated;
select pg_temp.ok(pg_temp.confirm(13,'21')->>'status'='stale','detached file is stale');
select pg_temp.ok(pg_temp.confirm(12,'22')->>'status'='stale','superseded member attachment is stale');
reset role;
-- A different active doctor, with an authenticated managed session, has no assignment.
insert into auth.users(id)values('a5c00000-0000-4000-8000-000000000008');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('a5c00000-0000-4000-8000-000000000008','doctor','Synthetic other doctor','a5c00000-0000-4000-8000-000000000007');
select pg_temp.as_user(8);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select pg_temp.confirm(11,'05')$q$),'unassigned doctor refused');
select pg_temp.ok(pg_temp.raises($q$select pg_temp.confirm(11)$q$),'other doctor cannot replay');
reset role;
select pg_temp.as_user(2);
update public.doctor_completion_capabilities set enabled=false where singleton;
set local role authenticated;
select pg_temp.ok(pg_temp.confirm(11,'06')->>'status'='disabled','doctor completion switch enforced');
reset role;
update public.doctor_completion_capabilities set enabled=true where singleton;
update public.lab_ai_capabilities set enabled=false where singleton;
set local role authenticated;
select pg_temp.ok(pg_temp.confirm(11,'06')->>'status'='disabled','lab AI switch enforced');
reset role;
select pg_temp.ok(not has_function_privilege('service_role','public.doctor_lab_ai_confirm_passing(jsonb)','EXECUTE'),'service role cannot execute');
select pg_temp.ok(not has_function_privilege('anon','public.doctor_lab_ai_confirm_passing(jsonb)','EXECUTE'),'anon cannot execute');
select pg_temp.ok(not has_table_privilege('authenticated','public.lab_ai_confirm_passing_commands','SELECT,INSERT,UPDATE,DELETE'),'receipts are private');
rollback;
