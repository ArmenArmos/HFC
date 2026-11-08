-- Fictional lab PDF reading checks; all fixtures roll back.
-- Switch, enqueue on attach (once per attachment), service-only worker functions, leases, retry,
-- defer and failure, shared spend caps with Zoe, values born unverified, no reviewed status without
-- the signed-in assigned doctor, identity gates, review replay, and moved or detached files.
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
-- lab1: doctor 02, other doctor 03, member 04, other member 05, nurse 06, clinic 07.
insert into auth.users(id,phone,phone_confirmed_at)select ('1ab00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5)then '37400096000'||n end,case when n in(4,5)then now()end from generate_series(2,6)n;
insert into public.workspace_clinics(id,name)values('1ab00000-0000-4000-8000-000000000007','Synthetic lab AI clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('1ab00000-0000-4000-8000-000000000002','doctor','Synthetic lab AI doctor','1ab00000-0000-4000-8000-000000000007'),
 ('1ab00000-0000-4000-8000-000000000003','doctor','Synthetic lab AI other doctor','1ab00000-0000-4000-8000-000000000007'),
 ('1ab00000-0000-4000-8000-000000000006','nurse','Synthetic lab AI nurse','1ab00000-0000-4000-8000-000000000007');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000002'),
 ('1ab00000-0000-4000-8000-000000000005','1ab00000-0000-4000-8000-000000000003');
update public.profiles set display_name='Synthetic Member Four',birth_date='1970-01-02'where id='1ab00000-0000-4000-8000-000000000004';
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,created_at)values
 ('1ab00000-0000-4000-8000-000000000041','1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000006','Synthetic nurse','nurse','1ab00000-0000-4000-8000-000000000007',now()-interval '3 hours'),
 ('1ab00000-0000-4000-8000-000000000051','1ab00000-0000-4000-8000-000000000005','1ab00000-0000-4000-8000-000000000006','Synthetic nurse','nurse','1ab00000-0000-4000-8000-000000000007',now()-interval '3 hours');
insert into public.zoe_settings(singleton,daily_spend_cap_usd)values(true,10)on conflict(singleton)do update set daily_spend_cap_usd=10;
-- Files 11..16 (stored). 15 is detached later; 16 is moved to member 05.
set local session_replication_role=replica;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('1ab00000-0000-4000-8000-0000000001'||n)::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'1ab00000-0000-4000-8000-000000000002',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'PRIVATE-LAB-'||n||'.pdf','application/pdf',1000,repeat('a',64),'synthetic-lab-ai/'||n,('1ab00000-0000-4000-8000-0000000002'||n)::uuid,1000,repeat('a',64),'stored',now()-interval '1 hour'
from generate_series(11,16)n;
insert into storage.objects(id,bucket_id,name,metadata)select ('1ab00000-0000-4000-8000-0000000002'||n)::uuid,'clinic-originals','synthetic-lab-ai/'||n,'{"size":1000}'from generate_series(11,16)n;
set local session_replication_role=origin;

update public.doctor_completion_capabilities set enabled=true where singleton;
create function pg_temp.attach(n int,member int,visit int) returns uuid language sql as $$
 insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
 values(('1ab00000-0000-4000-8000-0000000001'||n)::uuid,'1ab00000-0000-4000-8000-000000000007',('1ab00000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid,
  ('1ab00000-0000-4000-8000-0000000000'||visit)::uuid,'noreon-admin','1ab00000-0000-4000-8000-000000000002',gen_random_uuid())returning id
$$;
-- A live password session for the user (staff RPCs require a managed session, 20261020195207).
create function pg_temp.as_user(n int) returns void language plpgsql security definer as $$declare c jsonb:=jsonb_build_object('sub','1ab00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','1ab00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'));begin
 insert into auth.sessions(id,user_id,created_at,updated_at)select (c->>'session_id')::uuid,(c->>'sub')::uuid,now(),now()
  where exists(select 1 from auth.users where id=(c->>'sub')::uuid)on conflict(id)do nothing;
 perform set_config('request.jwt.claims',(c||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password'))))::text,true);
end$$;
create function pg_temp.as_service() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.job(n int) returns public.lab_ai_jobs language sql security definer as $$select * from public.lab_ai_jobs where file_id=('1ab00000-0000-4000-8000-0000000001'||n)::uuid order by created_at desc limit 1$$;
create function pg_temp.vid(n int,q int) returns uuid language sql security definer as $$
 select v.id from public.lab_ai_values v join public.lab_ai_jobs j on j.id=v.job_id where j.file_id=('1ab00000-0000-4000-8000-0000000001'||n)::uuid and v.seq=q order by v.created_at desc limit 1
$$;
create function pg_temp.open_doc(n int) returns void language sql as $$
 insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind)
 select j.user_id,j.file_id,j.attachment_id,'1ab00000-0000-4000-8000-000000000002','doctor'from pg_temp.job(n)j
$$;
create function pg_temp.value(seq int,page int default 1) returns jsonb language sql as $$
 select jsonb_build_object('testName','HbA1c','catalogueRef','HbA1c','valueText','9.4','value',9.4,'unit','%','refLow',4,'refHigh',6,'labFlag','high','collectedOn','2026-10-15',
  'labName','Synthetic lab','page',page,'snippet','HbA1c 9.4 %','checks','[]'::jsonb,'attention','threshold','attentionRule','THRESHOLD.hba1cUrgent')||jsonb_build_object('seq',seq)
$$;
create function pg_temp.done(id text,vals jsonb,status text default 'match',sha text default repeat('a',64)) returns jsonb language sql as $$
 select jsonb_build_object('disposition','done','outcome','extracted','pageCount',2,'sourceSha256',sha,'identityStatus',status,
  'identity',jsonb_build_object('nameOnSheet','Synthetic Member Four'),'values',vals,
  'summary',jsonb_build_object('preparedBy','ai','reviewedByDoctor',false),'provider','noreon.fake','model','noreon-fake-lab-1')
$$;
create function pg_temp.review(sub text,value uuid,act text,extra jsonb default '{}') returns jsonb language sql as $$
 select public.doctor_lab_ai_value_review(jsonb_build_object('version','lab-ai-review-v1','submissionId','1ab00000-0000-4000-8000-0000000009'||sub,
  'memberId','1ab00000-0000-4000-8000-000000000004','valueId',value,'action',act)||extra)
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int),pg_temp.as_service(),pg_temp.job(int),pg_temp.vid(int,int),pg_temp.value(int,int),pg_temp.done(text,jsonb,text,text),pg_temp.review(text,uuid,text,jsonb) to authenticated,service_role;

-- 1. Switch off: attaching queues nothing and the worker claims nothing.
update public.lab_ai_capabilities set enabled=false where singleton;
select pg_temp.attach(11,4,41);
select pg_temp.ok(not exists(select 1 from public.lab_ai_jobs),'switch off queues nothing');
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.lab_ai_job_claim(5)='[]'::jsonb,'switch off claims nothing');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok((public.doctor_lab_ai_overview('1ab00000-0000-4000-8000-000000000004')->>'enabled')::boolean=false,'switch off overview disabled');
select pg_temp.ok(public.doctor_lab_ai_request('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000111')->>'status'='disabled','switch off request disabled');
reset role;

-- 2. Switch on: attaching queues one job per attachment; a doctor's request for an old file queues it.
update public.lab_ai_capabilities set enabled=true where singleton;
select pg_temp.attach(12,4,41);
select pg_temp.ok((select count(*)from public.lab_ai_jobs where file_id='1ab00000-0000-4000-8000-000000000112')=1 and(pg_temp.job(12)).state='queued','attach queues one job');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_lab_ai_request('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000111')->>'status'='queued','doctor request queues the earlier file');
select pg_temp.ok(public.doctor_lab_ai_request('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000111')->>'status'='unchanged','a second request is idempotent');
reset role;
select pg_temp.ok((select count(*)from public.lab_ai_jobs where file_id='1ab00000-0000-4000-8000-000000000111')=1,'one job per attachment');

-- 3. Access: tables are closed; worker functions are service-only; reads are the assigned doctor's.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select * from public.lab_ai_values'),'member cannot read values');
select pg_temp.ok(pg_temp.raises('select * from public.lab_ai_jobs'),'member cannot read jobs');
select pg_temp.ok(pg_temp.raises('select public.lab_ai_job_claim(5)'),'member cannot claim');
select pg_temp.ok(pg_temp.raises($q$select public.doctor_lab_ai_read('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000112')$q$),'member cannot read the verification screen');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_lab_ai_read('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000112')$q$),'another doctor cannot read');
select pg_temp.ok(pg_temp.raises($q$select public.doctor_lab_ai_overview('1ab00000-0000-4000-8000-000000000004')$q$),'another doctor cannot see the overview');
reset role;
select pg_temp.as_user(6);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_lab_ai_read('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000112')$q$),'a nurse cannot read');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select public.lab_ai_job_claim(5)'),'doctor cannot claim');
select pg_temp.ok(pg_temp.raises($q$select public.lab_ai_job_finish(gen_random_uuid(),gen_random_uuid(),'{}')$q$),'doctor cannot finish');
reset role;

-- 4. Claim: leases, one worker at a time, member identity and visit tests for the worker only.
select pg_temp.as_service();
set local role service_role;
create temp table claimed as select x from jsonb_array_elements(public.lab_ai_job_claim(5))x;
reset role;
select pg_temp.ok((select count(*)from claimed)=2,'two due jobs claimed');
select pg_temp.ok((select bool_and(x->'member'->>'name'='Synthetic Member Four'and x->'file'->>'bucket'='clinic-originals'and(x->>'attempt')::int=1)from claimed),'claim carries what the worker needs');
select pg_temp.ok((pg_temp.job(12)).state='running'and(pg_temp.job(12)).attempts=1,'claimed job running');
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.lab_ai_job_claim(5)='[]'::jsonb,'a leased job is not claimed twice');
reset role;
select pg_temp.ok((pg_temp.job(12)).attempts=1,'upload kick while cron holds a lease does not spend another attempt');
select pg_temp.ok((pg_temp.job(12)).lease_until between clock_timestamp()+interval '9 minutes'and clock_timestamp()+interval '10 minutes',
 'a killed upload function leaves a bounded ten-minute lease for the backup sweep');

-- 5. Spend: real calls refused while model calls are off; local calls within caps; caps shared with Zoe.
select pg_temp.as_service();
set local role service_role;
do $$declare j public.lab_ai_jobs:=pg_temp.job(12);r jsonb;begin
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','anthropic/claude-opus-5.5',false,0.05);
 perform pg_temp.ok(r->>'code'='model_calls_not_permitted','real call refused while model calls are off');
 r:=public.lab_ai_call_reserve(j.id,gen_random_uuid(),'extract','high','noreon-fake-lab-1',true,0.05);
 perform pg_temp.ok(r->>'code'='job_not_running','a wrong lease cannot reserve');
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','noreon-fake-lab-1',true,7);
 perform pg_temp.ok(r->>'code'='tier_spend_cap_reached','the high tier cap applies');
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','noreon-fake-lab-1',true,0.05);
 perform pg_temp.ok((r->>'ok')::boolean,'local call within caps is reserved');
 perform pg_temp.ok((public.lab_ai_call_finish((r->>'callId')::uuid,jsonb_build_object('outcome','ok','provider','noreon.fake','responseModel','noreon-fake-lab-1','inputTokens',100,'outputTokens',50,'costUsd',0.04,'latencyMs',12))->>'ok')::boolean,'call finished');
 perform pg_temp.ok((public.lab_ai_call_finish((r->>'callId')::uuid,'{"outcome":"ok","provider":"noreon.fake"}')->>'replayed')::boolean,'call finish replays');
end$$;
reset role;
select pg_temp.ok((select cost_usd from public.lab_ai_calls where reserved)=0.04,'cost recorded');
select pg_temp.ok((select total from public._ai_spend((select spend_day from public.lab_ai_calls where reserved),'high'))=0.04,'lab spend counts in the shared total');
-- The AI settings page shows lab spend in today's totals.
insert into auth.users(id)values('1ab00000-0000-4000-8000-000000000008');
insert into auth.sessions(id,user_id,created_at,updated_at)values('1ab00000-0000-4000-8000-000000000008','1ab00000-0000-4000-8000-000000000008',now(),now());
insert into public.workspace_staff(user_id,role,display_name)values('1ab00000-0000-4000-8000-000000000008','admin','Synthetic lab AI admin');
select set_config('request.jwt.claims',jsonb_build_object('sub','1ab00000-0000-4000-8000-000000000008','role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','1ab00000-0000-4000-8000-000000000008')::text,true);
set local role authenticated;
select pg_temp.ok((public.zoe_ai_settings_admin()->>'spentTodayUsd')::numeric=0.04
 and(select (t->>'spentTodayUsd')::numeric from jsonb_array_elements(public.zoe_ai_settings_admin()->'tiers')t where t->>'tier'='high')=0.04,'admin page counts lab spend');
reset role;
-- Zoe sees lab spend: US$0.04 leaves less than US$0.25 under a US$0.28 total.
update public.zoe_settings set daily_spend_cap_usd=0.28;
update public.zoe_tier_config set daily_cap_usd=10 where tier='low';
insert into public.conversations(member_id)values('1ab00000-0000-4000-8000-000000000004');
-- 20261023063508 (Codex A2-3): zoe_run_reserve and zoe_run_finish re-check Zoe consent; the fixture's members consent.
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version=coalesce(consent_wording_version,'zoe-consent-draft-1')where singleton;
insert into public.zoe_consents(member_id,kind,granted,wording_version)select c.member_id,'zoe_reads_messages',true,(select s.consent_wording_version from public.zoe_settings s where s.singleton)
 from public.conversations c where not public._zoe_consent_ok(c.member_id);
insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 select c.id,c.member_id,1,c.version,c.draft_epoch,(select spend_day from public.lab_ai_calls where reserved),'started'from public.conversations c where c.member_id='1ab00000-0000-4000-8000-000000000004';
select id as zoe_run from public.zoe_runs where member_id='1ab00000-0000-4000-8000-000000000004' \gset
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.zoe_run_reserve(:'zoe_run',9.97,true,'[]','low','noreon-fake-deterministic-1')->>'code'='daily_spend_cap_reached','Zoe reservation counts lab spend');
reset role;
update public.zoe_settings set daily_spend_cap_usd=10;

-- 6. Finish: values born unverified; the sheet's hash must match; several patients carry no values; replay.
select pg_temp.as_service();
set local role service_role;
do $$declare j public.lab_ai_jobs:=pg_temp.job(12);r jsonb;begin
 r:=public.lab_ai_job_finish(j.id,j.lease_token,pg_temp.done('x',jsonb_build_array(pg_temp.value(1)),'match',repeat('b',64)));
 perform pg_temp.ok(r->>'code'='invalid','a different file hash is refused');
 r:=public.lab_ai_job_finish(j.id,j.lease_token,pg_temp.done('x',jsonb_build_array(pg_temp.value(1,3))));
 perform pg_temp.ok(r->>'code'='invalid','a page beyond the file is refused');
 r:=public.lab_ai_job_finish(j.id,j.lease_token,pg_temp.done('x',jsonb_build_array(pg_temp.value(1)),'multiple_patients'));
 perform pg_temp.ok(r->>'code'='invalid','several patients carry no values');
 r:=public.lab_ai_job_finish(j.id,j.lease_token,pg_temp.done('x',jsonb_build_array(pg_temp.value(1)||'{"status":"verified","reviewedBy":"1ab00000-0000-4000-8000-000000000002"}',pg_temp.value(2,2)),'unknown'));
 perform pg_temp.ok((r->>'values')::int=2,'two values recorded');
 r:=public.lab_ai_job_finish(j.id,j.lease_token,pg_temp.done('x','[]'));
 perform pg_temp.ok((r->>'replayed')::boolean,'finish replays without a second write');
end$$;
reset role;
select pg_temp.ok((select bool_and(status='unverified'and reviewed_by is null and source='ai_extracted')from public.lab_ai_values),'the worker cannot mark a value verified');
select pg_temp.ok((pg_temp.job(12)).state='done'and(pg_temp.job(12)).identity_status='unknown','job done with identity unknown');

-- 7. No reviewed status without a person: direct writes are refused even for the owner role.
select pg_temp.ok(pg_temp.raises($q$update public.lab_ai_values set status='verified',reviewed_by='1ab00000-0000-4000-8000-000000000002',reviewed_at=now()$q$),'no reviewed status without a signed-in doctor');
select pg_temp.ok(pg_temp.raises($q$insert into public.lab_ai_values(job_id,user_id,file_id,attachment_id,seq,test_name,value_text,page,status,reviewed_by,reviewed_at)
 select job_id,user_id,file_id,attachment_id,99,'X','1',1,'verified','1ab00000-0000-4000-8000-000000000002',now()from public.lab_ai_values limit 1$q$),'no value is born verified');
select pg_temp.ok(pg_temp.raises($q$update public.lab_ai_values set value=1$q$,'55000'),'the AI reading never changes');
select pg_temp.ok(pg_temp.raises($q$delete from public.lab_ai_values$q$,'55000'),'AI readings are kept');
select pg_temp.as_user(3);
select pg_temp.ok(pg_temp.raises($q$update public.lab_ai_values set status='verified',reviewed_by='1ab00000-0000-4000-8000-000000000003',reviewed_at=now()$q$),'another doctor cannot verify');
select pg_temp.as_user(6);
select pg_temp.ok(pg_temp.raises($q$update public.lab_ai_values set status='verified',reviewed_by='1ab00000-0000-4000-8000-000000000006',reviewed_at=now()$q$),'a nurse cannot verify');
select pg_temp.ok(not exists(select 1 from public._lab_ai_verified_values('1ab00000-0000-4000-8000-000000000004')),'the engine sees no verified values yet');

-- 8. Review: open first, identity first, then confirm, correct (original kept), reject; replay.
select pg_temp.as_user(2);
set local role authenticated;
do $$declare v1 uuid;v2 uuid;r jsonb;j public.lab_ai_jobs:=pg_temp.job(12);begin
 v1:=pg_temp.vid(12,1);v2:=pg_temp.vid(12,2);
 perform pg_temp.ok(pg_temp.review('01',v1,'confirm')->>'status'='identity-first','identity first when the sheet did not match');
 perform pg_temp.ok(public.doctor_lab_ai_identity_confirm(jsonb_build_object('version','lab-ai-identity-v1','memberId','1ab00000-0000-4000-8000-000000000004','jobId',j.id))->>'status'='open-first','identity needs the PDF opened');
end$$;
reset role;
select pg_temp.open_doc(12);
select pg_temp.as_user(2);
set local role authenticated;
do $$declare v1 uuid;v2 uuid;r jsonb;j public.lab_ai_jobs:=pg_temp.job(12);begin
 v1:=pg_temp.vid(12,1);v2:=pg_temp.vid(12,2);
 perform pg_temp.ok(public.doctor_lab_ai_identity_confirm(jsonb_build_object('version','lab-ai-identity-v1','memberId','1ab00000-0000-4000-8000-000000000004','jobId',j.id))->>'status'='confirmed','identity confirmed');
 perform pg_temp.ok(pg_temp.review('02',v1,'confirm')->>'status'='saved','value confirmed');
 perform pg_temp.ok((pg_temp.review('02',v1,'confirm')->>'replayed')::boolean,'review replays');
 perform pg_temp.ok(pg_temp.review('02',v2,'confirm')->>'status'='stale','a submission is bound to its value');
 perform pg_temp.ok(pg_temp.review('03',v2,'correct',jsonb_build_object('value','x'))->>'status'='invalid','a correction needs a number');
 perform pg_temp.ok(pg_temp.review('03',v2,'confirm',jsonb_build_object('value',1))->>'status'='invalid','a confirmation carries no value');
 perform pg_temp.ok(pg_temp.review('04',v2,'correct',jsonb_build_object('value',8.4,'unit','%','note','Read the sheet'))->>'status'='saved','value corrected');
 r:=public.doctor_lab_ai_read('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000112');
 perform pg_temp.ok((r->'values'->1->>'value')::numeric=9.4 and(r->'values'->1->>'correctedValue')::numeric=8.4 and r->'values'->1->>'status'='corrected','correction keeps the original reading');
 perform pg_temp.ok((r->'job'->'counts'->>'verified')::int=2 and(r->'job'->'counts'->>'attention')::int=2,'counts verified and attention');
 -- Astra A3-3 (20 Oct audit): confirming the corrected value keeps the correction, not the AI's 9.4.
 perform pg_temp.ok(pg_temp.review('a6',v2,'confirm')->>'status'='saved','corrected value confirmed');
 r:=public.doctor_lab_ai_read('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000112');
 perform pg_temp.ok((r->'values'->1->>'correctedValue')::numeric=8.4 and r->'values'->1->>'status'='corrected'and r->'values'->1->>'correctedUnit'='%'and r->'values'->1->>'reviewNote'='Read the sheet','confirming a correction keeps it');
 perform pg_temp.ok(pg_temp.review('05',v2,'reject',jsonb_build_object('note','Duplicate row'))->>'status'='saved','value rejected');
end$$;
reset role;
select pg_temp.ok((select count(*)from public.lab_ai_value_reviews)=4,'each review logged once');
select pg_temp.ok((select(after->>'correctedValue')::numeric=8.4 and after->>'status'='corrected'from public.lab_ai_value_reviews where action='confirm'and before->>'status'='corrected'),'the confirmation of a correction recorded the corrected number');
select pg_temp.ok((select count(*)from public._lab_ai_verified_values('1ab00000-0000-4000-8000-000000000004'))=1,'the engine sees only the confirmed value');
select pg_temp.ok(pg_temp.raises($q$update public.lab_ai_value_reviews set action='reject'$q$,'55000'),'review history is append-only');

-- 9. Mismatch needs a reason; several patients cannot be confirmed; retry, defer and failure.
select pg_temp.as_service();
set local role service_role;
do $$declare j public.lab_ai_jobs:=pg_temp.job(11);r jsonb;begin
 r:=public.lab_ai_job_finish(j.id,j.lease_token,pg_temp.done('x',jsonb_build_array(pg_temp.value(1)),'mismatch'));
 perform pg_temp.ok(r->>'state'='done','mismatch recorded with values held');
end$$;
reset role;
select pg_temp.open_doc(11);
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.review('06',pg_temp.vid(11,1),'confirm')->>'status'='identity-first','mismatch blocks review');
select pg_temp.ok(public.doctor_lab_ai_identity_confirm(jsonb_build_object('version','lab-ai-identity-v1','memberId','1ab00000-0000-4000-8000-000000000004','jobId',(pg_temp.job(11)).id))->>'status'='reason-required','mismatch needs a reason');
reset role;
select pg_temp.attach(13,4,41);
select pg_temp.attach(14,4,41);
select pg_temp.as_service();
set local role service_role;
create temp table c2 as select public.lab_ai_job_claim(5)x;
do $$declare j public.lab_ai_jobs:=pg_temp.job(13);k public.lab_ai_jobs:=pg_temp.job(14);r jsonb;begin
 r:=public.lab_ai_job_finish(j.id,j.lease_token,jsonb_build_object('disposition','done','outcome','extracted','pageCount',1,'sourceSha256',repeat('a',64),'identityStatus','multiple_patients','values','[]'::jsonb));
 perform pg_temp.ok(r->>'state'='done','several patients recorded without values');
 r:=public.lab_ai_job_finish(k.id,k.lease_token,jsonb_build_object('disposition','defer','outcome','model_calls_not_permitted'));
 perform pg_temp.ok(r->>'state'='queued','calls off defers');
end$$;
reset role;
select pg_temp.ok((pg_temp.job(14)).attempts=0 and(pg_temp.job(14)).next_attempt_at>now()+interval '20 minutes','a deferral does not count as an attempt');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_lab_ai_identity_confirm(jsonb_build_object('version','lab-ai-identity-v1','memberId','1ab00000-0000-4000-8000-000000000004','jobId',(pg_temp.job(13)).id))->>'status'='not-allowed','several patients cannot be confirmed');
reset role;
-- Retry with backoff, then fail on the third attempt.
update public.lab_ai_jobs set next_attempt_at=now()-interval '1 minute'where id=(pg_temp.job(14)).id;
do $$declare i int;j public.lab_ai_jobs;r jsonb;begin
 for i in 1..3 loop
  perform pg_temp.as_service();
  set local role service_role;
  perform public.lab_ai_job_claim(5);
  j:=pg_temp.job(14);
  r:=public.lab_ai_job_finish(j.id,j.lease_token,'{"disposition":"retry","outcome":"provider_timeout"}');
  reset role;
  update public.lab_ai_jobs set next_attempt_at=now()-interval '1 minute'where id=j.id and state='queued';
 end loop;
end$$;
select pg_temp.ok((pg_temp.job(14)).state='failed'and(pg_temp.job(14)).attempts=3,'fails after three attempts');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_lab_ai_request('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000114')->>'status'='queued','doctor can ask again after a failure');
reset role;
-- A lost lease is reclaimed and counts.
select pg_temp.as_service();
set local role service_role;
select public.lab_ai_job_claim(5);
reset role;
create temp table lost_upload_lease as select id,lease_token from public.lab_ai_jobs where id=(pg_temp.job(14)).id;
grant select on lost_upload_lease to service_role;
update public.lab_ai_jobs set lease_until=now()-interval '1 second'where id=(pg_temp.job(14)).id;
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok((select (x->>'attempt')::int from jsonb_array_elements(public.lab_ai_job_claim(5))x where x->>'jobId'=(pg_temp.job(14)).id::text)=2,'a lost lease is claimed again as the next attempt');
select pg_temp.ok((select public.lab_ai_job_finish(id,lease_token,'{"disposition":"retry","outcome":"worker_error"}'::jsonb)->>'code'from lost_upload_lease)='job_not_running',
 'an old upload invocation cannot finish after cron reclaimed its expired lease');
reset role;

-- 10. Moved or detached files: values leave the screen and the engine; a moved file is read again.
select pg_temp.attach(15,4,41);
insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)values((pg_temp.job(15)).attachment_id,'1ab00000-0000-4000-8000-000000000002',gen_random_uuid(),'Synthetic: wrong member');
select pg_temp.as_service();
set local role service_role;
select public.lab_ai_job_claim(5);
reset role;
select pg_temp.ok((pg_temp.job(15)).state='rejected'and(pg_temp.job(15)).outcome='attachment_not_current','a detached file is not read');
-- Move file 12 (with a confirmed value) to member 05.
insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id)
 values('1ab00000-0000-4000-8000-000000000112','1ab00000-0000-4000-8000-000000000007','1ab00000-0000-4000-8000-000000000005','1ab00000-0000-4000-8000-000000000051','noreon-admin','1ab00000-0000-4000-8000-000000000002',gen_random_uuid(),(pg_temp.job(12)).attachment_id);
select pg_temp.ok(not exists(select 1 from public._lab_ai_verified_values('1ab00000-0000-4000-8000-000000000004')),'a moved file takes its values out of the engine');
select pg_temp.ok((select count(*)from public.lab_ai_jobs where file_id='1ab00000-0000-4000-8000-000000000112')=2 and(pg_temp.job(12)).user_id='1ab00000-0000-4000-8000-000000000005','the moved file is queued for its new member');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_lab_ai_read('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000112')$q$),'the old member''s doctor no longer reads it');
reset role;

-- 11. Call allowance (quality review item 23): refused reservations call nothing and do not count; a
-- doctor's "Read again" starts a new allowance; the history rows stay.
update public.lab_ai_jobs set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=(pg_temp.job(14)).id;
insert into public.lab_ai_calls(job_id,purpose,tier,model,local,spend_day,estimate_usd,reserved,refusal)
 select (pg_temp.job(14)).id,'extract','high','noreon-fake-lab-1',true,current_date,0.01,false,'tier_spend_cap_reached' from generate_series(1,6);
select pg_temp.as_service();
set local role service_role;
do $$declare j public.lab_ai_jobs:=pg_temp.job(14);r jsonb;begin
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','noreon-fake-lab-1',true,0.01);
 perform pg_temp.ok((r->>'ok')::boolean,'six refused reservations do not use up the allowance');
end$$;
reset role;
insert into public.lab_ai_calls(job_id,purpose,tier,model,local,spend_day,estimate_usd,reserved)
 select (pg_temp.job(14)).id,'extract','high','noreon-fake-lab-1',true,current_date,0.01,true from generate_series(1,5);
select pg_temp.as_service();
set local role service_role;
do $$declare j public.lab_ai_jobs:=pg_temp.job(14);r jsonb;begin
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','noreon-fake-lab-1',true,0.01);
 perform pg_temp.ok(r->>'code'='job_call_limit','six calls made: the seventh is refused');
end$$;
reset role;
update public.lab_ai_jobs set state='failed',lease_token=null,lease_until=null,outcome='retries_exhausted',finished_at=now() where id=(pg_temp.job(14)).id;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_lab_ai_request('1ab00000-0000-4000-8000-000000000004','1ab00000-0000-4000-8000-000000000114')->>'status'='queued','doctor asks again');
reset role;
select pg_temp.ok((pg_temp.job(14)).retry_requested_at is not null,'the retry is stamped');
update public.lab_ai_jobs set state='running',lease_token=gen_random_uuid(),lease_until=now()+interval '5 minutes' where id=(pg_temp.job(14)).id;
select pg_temp.as_service();
set local role service_role;
do $$declare j public.lab_ai_jobs:=pg_temp.job(14);r jsonb;begin
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','noreon-fake-lab-1',true,0.01);
 perform pg_temp.ok((r->>'ok')::boolean,'after "Read again" the job may call again');
end$$;
reset role;
select pg_temp.ok((select count(*) from public.lab_ai_calls where job_id=(pg_temp.job(14)).id)>=13,'earlier call rows are kept');

rollback;
\echo 'lab AI extraction checks passed'
