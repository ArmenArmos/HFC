-- Member uploads read by the lab AI reader (20261018120200); fictional fixtures, all rolled back.
-- Switches and the daily limit on enqueue, no direct table access, member jobs claimed only with their own
-- switch, removed documents closed, shared spend reservation, finish validation, values born pending and
-- answered only by the member, identity question, member reads only their own, doctor reads only assigned.
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
-- 02 doctor of member 04; 03 doctor of member 05; 04 and 05 members; clinic 07.
insert into auth.users(id,phone,phone_confirmed_at)select ('3a100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5)then '37400097000'||n end,case when n in(4,5)then now()end from generate_series(2,9)n;
insert into public.workspace_clinics(id,name)values('3a100000-0000-4000-8000-000000000007','Synthetic member upload clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('3a100000-0000-4000-8000-000000000002','doctor','Synthetic upload doctor','3a100000-0000-4000-8000-000000000007'),
 ('3a100000-0000-4000-8000-000000000003','doctor','Synthetic upload other doctor','3a100000-0000-4000-8000-000000000007'),
 ('3a100000-0000-4000-8000-000000000006','admin','Synthetic upload admin',null),
 ('3a100000-0000-4000-8000-000000000008','nurse','Synthetic upload nurse','3a100000-0000-4000-8000-000000000007');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('3a100000-0000-4000-8000-000000000009','3a100000-0000-4000-8000-000000000007','Synthetic clinic desk');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('3a100000-0000-4000-8000-000000000004','3a100000-0000-4000-8000-000000000002','3a100000-0000-4000-8000-000000000008'),
 ('3a100000-0000-4000-8000-000000000005','3a100000-0000-4000-8000-000000000003',null);
update public.profiles set display_name='Synthetic Upload Four',birth_date='1970-01-02'where id='3a100000-0000-4000-8000-000000000004';
insert into public.zoe_settings(singleton,daily_spend_cap_usd)values(true,10)on conflict(singleton)do update set daily_spend_cap_usd=10;

create function pg_temp.doc(n int,member int) returns uuid language sql as $$
 insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256)
 values(('3a100000-0000-4000-8000-0000000001'||n)::uuid,('3a100000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'))::uuid,
  '3a100000-0000-4000-8000-0000000000'||lpad(member::text,2,'0')||'/'||n||'.pdf','PRIVATE-UPLOAD-'||n||'.pdf','application/pdf',1000,lpad(n::text,64,'0'))returning id
$$;
-- A live password session for the user (staff RPCs require a managed session, 20261020195207).
create function pg_temp.as_user(n int) returns void language plpgsql security definer as $$declare c jsonb:=jsonb_build_object('sub','3a100000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','3a100000-0000-4000-8000-0000000002'||lpad(n::text,2,'0'));begin
 insert into auth.sessions(id,user_id,created_at,updated_at)select (c->>'session_id')::uuid,(c->>'sub')::uuid,now(),now()
  where exists(select 1 from auth.users where id=(c->>'sub')::uuid)on conflict(id)do nothing;
 perform set_config('request.jwt.claims',(c||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password'))))::text,true);
end$$;
create function pg_temp.as_service() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.job(n int) returns public.lab_ai_jobs language sql security definer as $$select * from public.lab_ai_jobs where member_document_id=('3a100000-0000-4000-8000-0000000001'||n)::uuid$$;
create function pg_temp.vid(n int,q int) returns uuid language sql security definer as $$
 select v.id from public.member_upload_ai_values v where v.document_id=('3a100000-0000-4000-8000-0000000001'||n)::uuid and v.seq=q
$$;
create function pg_temp.value(analyte text,v numeric,unit text,measure text,munit text,collected text default '2026-09-01') returns jsonb language sql as $$
 select jsonb_build_object('testName',analyte,'catalogueRef',analyte,'valueText',v::text,'value',v,'unit',unit,'refText','< 5','labFlag','high','collectedOn',collected,
  'labName','Synthetic lab','page',1,'snippet',analyte||' '||v,'checks','[]'::jsonb,'attention','needs_doctor','measure',measure,'measureUnit',munit)
$$;
create function pg_temp.done(n int,vals jsonb,status text default 'match') returns jsonb language sql security definer as $$
 select jsonb_build_object('disposition','done','outcome','extracted','pageCount',1,'sourceSha256',(select sha256 from public.member_reported_documents where id=('3a100000-0000-4000-8000-0000000001'||n)::uuid),
  'identityStatus',status,'identity',jsonb_build_object('nameOnSheet','Synthetic Upload Four','sampleDate','2026-09-01'),'values',vals,
  'summary',case when status in('match','unknown')then jsonb_build_object('preparedBy','ai','reviewedByDoctor',false)end,'provider','noreon.fake','model','noreon-fake-lab-1')
$$;
create function pg_temp.edit(sub text,n int,edits jsonb,extra jsonb default '{}') returns jsonb language sql as $$
 select public.member_upload_ai_edit(jsonb_build_object('version','member-upload-edit-v1','submissionId','3a100000-0000-4000-8000-0000000009'||sub,
  'jobId',(pg_temp.job(n)).id,'edits',edits)||extra)
$$;
create function pg_temp.identity(sub text,n int,answer text) returns jsonb language sql as $$
 select public.member_upload_ai_identity(jsonb_build_object('version','member-upload-identity-v1','submissionId','3a100000-0000-4000-8000-0000000008'||sub,'jobId',(pg_temp.job(n)).id,'answer',answer))
$$;
create function pg_temp.charted(n int,q int) returns public.member_reported_values language sql security definer as $$select * from public.member_reported_values where ai_value_id=pg_temp.vid(n,q)$$;
create function pg_temp.mv(n int,q int) returns public.member_upload_ai_values language sql security definer as $$select * from public.member_upload_ai_values where id=pg_temp.vid(n,q)$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int),pg_temp.as_service(),pg_temp.job(int),pg_temp.vid(int,int),
 pg_temp.value(text,numeric,text,text,text,text),pg_temp.done(int,jsonb,text),pg_temp.edit(text,int,jsonb,jsonb),pg_temp.identity(text,int,text),pg_temp.charted(int,int),pg_temp.mv(int,int) to authenticated,service_role;

-- These checks cover the member's own flow with the doctor's approval switched off (the fallback, 20261021070050);
-- scripts/check-member-upload-approval.sql covers the approval.
update public.lab_ai_capabilities set member_upload_doctor_approval=false where singleton;

-- 1. Switches: the member switch alone, or the lab switch alone, queues nothing.
update public.lab_ai_capabilities set enabled=true,member_upload_enabled=false where singleton;
select pg_temp.doc(20,4);
update public.lab_ai_capabilities set enabled=false,member_upload_enabled=true where singleton;
select pg_temp.doc(28,4);
select pg_temp.ok(not exists(select 1 from public.lab_ai_jobs where kind='member_upload'),'either switch off queues nothing');
select pg_temp.ok((select member_upload_enabled from public.lab_ai_capabilities)is not null and(select column_default from information_schema.columns where table_name='lab_ai_capabilities'and column_name='member_upload_enabled')='false','member switch defaults to false');

-- 2. Both on: an upload queues one job for its owner. At most five a day per member.
update public.lab_ai_capabilities set enabled=true,member_upload_enabled=true where singleton;
select pg_temp.doc(21,4);select pg_temp.doc(22,5);
select pg_temp.ok((pg_temp.job(21)).member_id='3a100000-0000-4000-8000-000000000004'and(pg_temp.job(21)).state='queued'and(pg_temp.job(21)).file_id is null,'upload queues a member job for its owner');
select pg_temp.ok((pg_temp.job(22)).member_id='3a100000-0000-4000-8000-000000000005','other member queued for themselves');
select pg_temp.doc(n,4)from generate_series(23,27)n;
select pg_temp.ok((select count(*)from public.lab_ai_jobs where kind='member_upload'and member_id='3a100000-0000-4000-8000-000000000004')=5 and(pg_temp.job(27)).id is null,'daily limit of five per member');
select pg_temp.ok(pg_temp.raises($$insert into public.lab_ai_jobs(kind,member_document_id,member_id,file_id)values('member_upload','3a100000-0000-4000-8000-000000000127','3a100000-0000-4000-8000-000000000004','3a100000-0000-4000-8000-000000000127')$$,'23514'),'a member job has no clinic file');

-- 3. Members have no direct access: no job insert, no table reads, no worker functions.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($$insert into public.lab_ai_jobs(kind,member_document_id,member_id)values('member_upload','3a100000-0000-4000-8000-000000000127','3a100000-0000-4000-8000-000000000004')$$),'member cannot enqueue directly');
select pg_temp.ok(pg_temp.raises($$select * from public.lab_ai_jobs$$),'member cannot read jobs');
select pg_temp.ok(pg_temp.raises($$select * from public.member_upload_ai_values$$),'member cannot read the values table');
select pg_temp.ok(pg_temp.raises($$select * from public.member_upload_ai_confirmations$$),'member cannot read confirmations');
select pg_temp.ok(pg_temp.raises($$select public.lab_ai_job_claim(5)$$),'member cannot claim');
select pg_temp.ok(pg_temp.raises($$select public.lab_ai_job_finish('3a100000-0000-4000-8000-000000000001','3a100000-0000-4000-8000-000000000001','{}')$$),'member cannot finish');
select pg_temp.ok(pg_temp.raises($$insert into public.member_reported_documents(user_id,object_path,file_name,mime,size_bytes,sha256)values('3a100000-0000-4000-8000-000000000004','3a100000-0000-4000-8000-000000000004/x.pdf','x.pdf','application/pdf',1,repeat('f',64))$$),'member cannot insert a document to enqueue');
reset role;

-- 4. Claim: member jobs wait while their switch is off; a removed document closes its job.
update public.member_reported_documents set deleted_at=now()where id='3a100000-0000-4000-8000-000000000126';
update public.lab_ai_capabilities set member_upload_enabled=false where singleton;
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.lab_ai_job_claim(5)='[]'::jsonb,'member jobs not claimed while the member switch is off');
reset role;
update public.lab_ai_capabilities set member_upload_enabled=true where singleton;
select pg_temp.as_service();
set local role service_role;
create temp table claimed as select x from jsonb_array_elements(public.lab_ai_job_claim(5))x;
insert into claimed select x from jsonb_array_elements(public.lab_ai_job_claim(5))x;
reset role;
select pg_temp.ok((pg_temp.job(26)).state='rejected'and(pg_temp.job(26)).outcome='document_removed','removed document closes its job');
select pg_temp.ok((select count(*)from claimed)=5,'five member jobs claimed, the removed one not');
select pg_temp.ok((select bool_and(x->>'kind'='member_upload'and x->'file'->>'bucket'='member-history'and x->'file'->>'documentId'is not null and x->'file'->>'mime'='application/pdf')from claimed),'claim shape');
select pg_temp.ok((select x->'member'->>'name'from claimed where x->'file'->>'documentId'='3a100000-0000-4000-8000-000000000121')='Synthetic Upload Four','claim carries the owner, for the identity check');
select pg_temp.ok((select bool_and(split_part(x->'file'->>'objectKey','/',1)=(select user_id::text from public.member_reported_documents where id=(x->'file'->>'documentId')::uuid))from claimed),'each claimed file belongs to the job member');

-- 5. Spend: same reservation and shared caps as clinic reading.
select pg_temp.as_service();
set local role service_role;
do $$declare j public.lab_ai_jobs:=pg_temp.job(21);r jsonb;begin
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','anthropic/claude-opus-5.5',false,0.05);
 perform pg_temp.ok(r->>'code'='model_calls_not_permitted','real call refused while model calls are off');
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','noreon-fake-lab-1',true,7);
 perform pg_temp.ok(r->>'code'='tier_spend_cap_reached','the tier cap applies to member uploads');
 r:=public.lab_ai_call_reserve(j.id,gen_random_uuid(),'extract','high','noreon-fake-lab-1',true,0.05);
 perform pg_temp.ok(r->>'code'='job_not_running','a wrong lease cannot reserve');
 r:=public.lab_ai_call_reserve(j.id,j.lease_token,'extract','high','noreon-fake-lab-1',true,0.05);
 perform pg_temp.ok((r->>'ok')::boolean,'local call within caps reserved');
 perform pg_temp.ok((public.lab_ai_call_finish((r->>'callId')::uuid,jsonb_build_object('outcome','ok','provider','noreon.fake','responseModel','noreon-fake-lab-1','inputTokens',100,'outputTokens',50,'costUsd',0.03,'latencyMs',9))->>'ok')::boolean,'call finished');
end$$;
reset role;
select pg_temp.ok((select x.total from public._ai_spend((select spend_day from public.lab_ai_calls where reserved limit 1),'high')x)=0.03,'member upload spend counts in the shared total');
update public.zoe_tier_config set daily_cap_usd=10 where tier='high';
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.lab_ai_call_reserve((pg_temp.job(23)).id,(pg_temp.job(23)).lease_token,'extract','high','noreon-fake-lab-1',true,9.98)->>'code'in('tier_spend_cap_reached','daily_spend_cap_reached'),'the US$10 daily total includes member upload spend');
reset role;

-- 6. Finish: checked like clinic results; values born pending with the chart measure decided in code; the
--    member's own sheet is saved at once (charted values as ai_read), a mismatch waits for the member.
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(public.lab_ai_job_finish((pg_temp.job(21)).id,(pg_temp.job(21)).lease_token,pg_temp.done(21,'[]')||jsonb_build_object('sourceSha256',repeat('0',64)))->>'code'='invalid','wrong file hash refused');
select pg_temp.ok(public.lab_ai_job_finish((pg_temp.job(24)).id,(pg_temp.job(24)).lease_token,pg_temp.done(24,jsonb_build_array(pg_temp.value('tsh',2,'mIU/L',null,null)),'multiple_patients'))->>'code'='invalid','no values kept for several patients');
select pg_temp.ok(public.lab_ai_job_finish((pg_temp.job(21)).id,(pg_temp.job(21)).lease_token,pg_temp.done(21,jsonb_build_array(pg_temp.value('ldl_c',3.4,'mmol/L','ldl_c','mmol/L'),pg_temp.value('tsh',2,'mIU/L','bogus','mmol/L'))))->>'code'='invalid','an unknown measure is refused');
select pg_temp.ok((public.lab_ai_job_finish((pg_temp.job(21)).id,(pg_temp.job(21)).lease_token,pg_temp.done(21,jsonb_build_array(
 pg_temp.value('hba1c',6.1,'%','hba1c','%',null),pg_temp.value('ldl_c',3.4,'mmol/L','ldl_c','mmol/L'),pg_temp.value('tsh',2,'mIU/L',null,null))))->>'values')::int=3,'match finished with three values');
select pg_temp.ok((public.lab_ai_job_finish((pg_temp.job(23)).id,(pg_temp.job(23)).lease_token,pg_temp.done(23,jsonb_build_array(pg_temp.value('ldl_c',2.2,'mmol/L','ldl_c','mmol/L')),'mismatch'))->>'state')='done','mismatch finished with values');
select pg_temp.ok((public.lab_ai_job_finish((pg_temp.job(24)).id,(pg_temp.job(24)).lease_token,pg_temp.done(24,'[]','multiple_patients'))->>'state')='done','several patients finished without values');
select pg_temp.ok((public.lab_ai_job_finish((pg_temp.job(22)).id,(pg_temp.job(22)).lease_token,pg_temp.done(22,jsonb_build_array(pg_temp.value('ldl_c',2.4,'mmol/L','ldl_c','mmol/L')),'mismatch'))->>'state')='done','other member''s mismatch finished');
select pg_temp.ok((public.lab_ai_job_finish((pg_temp.job(25)).id,(pg_temp.job(25)).lease_token,'{"disposition":"defer","outcome":"model_calls_not_permitted"}')->>'state')='queued','defer keeps it queued');
reset role;
select pg_temp.ok((select bool_and(member_status='pending'and member_reviewed_at is null)from public.member_upload_ai_values),'values born pending (not confirmed by the member)');
select pg_temp.ok((pg_temp.charted(21,1)).source='ai_read'and(pg_temp.charted(21,1)).measured_on='2026-09-01'and(pg_temp.charted(21,2)).value=3.4 and(pg_temp.charted(21,3)).id is null,
 'own sheet saved at once: charted measures as ai_read, the undated one on the sample date, others kept uncharted');
select pg_temp.ok((select values_saved=3 and values_charted=2 and identity_answer is null from public.member_upload_ai_confirmations where job_id=(pg_temp.job(21)).id),'one save record for the reading');
select pg_temp.ok((pg_temp.charted(23,1)).id is null and not exists(select 1 from public.member_upload_ai_confirmations where job_id=(pg_temp.job(23)).id),'a mismatch saves nothing yet');
select pg_temp.ok(not exists(select 1 from public.member_upload_ai_confirmations where job_id=(pg_temp.job(24)).id),'several patients: nothing to save');
select pg_temp.ok(not exists(select 1 from public.lab_ai_values),'nothing written to the clinic value table');
select pg_temp.ok(pg_temp.raises($$update public.member_upload_ai_values set member_status='confirmed',member_reviewed_at=now()where seq=1$$),'no answer without the signed-in member');
select pg_temp.ok(pg_temp.raises($$update public.member_upload_ai_values set value=1 where seq=1$$,'55000'),'the AI reading is kept as it was');
select pg_temp.ok(pg_temp.raises($$delete from public.member_upload_ai_values$$,'55000'),'values are kept');

-- 6b. A reading finished before auto-save (under #278) and never confirmed is saved by the backfill (Codex F1).
alter table public.lab_ai_jobs disable trigger lab_ai_jobs_member_upload_autosave;
update public.lab_ai_jobs set next_attempt_at=now()-interval '1 second' where id=(pg_temp.job(25)).id;
select pg_temp.as_service();
set local role service_role;
select pg_temp.ok(jsonb_array_length(public.lab_ai_job_claim(5))=1,'deferred job claimed again');
select pg_temp.ok((public.lab_ai_job_finish((pg_temp.job(25)).id,(pg_temp.job(25)).lease_token,pg_temp.done(25,jsonb_build_array(pg_temp.value('ldl_c',2.9,'mmol/L','ldl_c','mmol/L'))))->>'state')='done','finished without auto-save');
reset role;
alter table public.lab_ai_jobs enable trigger lab_ai_jobs_member_upload_autosave;
select pg_temp.ok(not exists(select 1 from public.member_upload_ai_confirmations where job_id=(pg_temp.job(25)).id),'unsaved, as a #278 reading left unconfirmed');
select pg_temp.ok(public._member_upload_ai_backfill()=1,'backfill saves exactly that reading');
select pg_temp.ok((pg_temp.charted(25,1)).source='ai_read'and public._member_upload_ai_backfill()=0,'charted, and the backfill is idempotent');

-- 7. The member reads only their own; never doctor-only marks.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok((select count(*)from jsonb_array_elements(public.member_upload_ai_overview()->'documents'))=7,'overview lists the member''s own documents');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.member_upload_ai_overview()->'documents')d where d->>'documentId'='3a100000-0000-4000-8000-000000000122'),'never another member''s');
select pg_temp.ok(public.member_upload_ai_read('3a100000-0000-4000-8000-000000000122')->>'found'='false','another member''s document reads as not found');
select pg_temp.ok(jsonb_array_length(public.member_upload_ai_read('3a100000-0000-4000-8000-000000000121')->'values')=3,'own reading has its values');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.member_upload_ai_read('3a100000-0000-4000-8000-000000000121')->'values')v where v ? 'attention'or v ? 'labFlag'or v ? 'refText'),'no doctor-only marks for the member');
select pg_temp.ok(not(public.member_upload_ai_read('3a100000-0000-4000-8000-000000000121')->'job' ? 'summary'),'no AI summary for the member');
reset role;

-- 8. Member answers: "Is this yours?" only after a mismatch; edits only to their own saved reading.
select pg_temp.as_user(5);
set local role authenticated;
select pg_temp.ok(pg_temp.edit('01',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,1),'action','remove')))->>'status'='stale','another member cannot edit');
select pg_temp.ok(pg_temp.identity('01',23,'not_mine')->>'status'='stale','another member cannot answer');
select pg_temp.ok(pg_temp.identity('02',22,'mine')->>'status'='saved'and(pg_temp.identity('02',22,'mine')->>'replayed')='true','"mine" saves, and replays');
select pg_temp.ok(pg_temp.identity('03',22,'not_mine')->>'status'='unchanged','answered once');
reset role;
select pg_temp.ok((pg_temp.charted(22,1)).source='ai_read'and(select identity_answer from public.member_upload_ai_confirmations where job_id=(pg_temp.job(22)).id)='mine','"mine" charts the values and is recorded');
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.identity('04',21,'mine')->>'status'='stale','no question on the member''s own sheet');
select pg_temp.ok(pg_temp.edit('02',23,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(23,1),'action','correct','value',2.1)))->>'status'='stale','no edits before "Is this yours?"');
select pg_temp.ok(pg_temp.identity('05',23,'not_mine')->>'status'='saved','not mine is recorded');
select pg_temp.ok(pg_temp.edit('03',23,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(23,1),'action','correct','value',2.1)))->>'status'='stale','no edits after "not mine"');
select pg_temp.ok(pg_temp.edit('04',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,2),'action','correct','value',3.1),jsonb_build_object('valueId',pg_temp.vid(21,1),'action','correct','value',99)))->>'status'='invalid',
 'an out-of-range chart value is refused, with the whole edit');
select pg_temp.ok(pg_temp.edit('05',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,2),'action','correct','value',3.1)),'{"measuredOn":"2099-01-01"}')->>'status'='invalid','a future date is refused');
select pg_temp.ok(pg_temp.edit('06',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,2),'action','confirm')))->>'status'='invalid','only correct or remove');
select pg_temp.ok(pg_temp.edit('07',21,'[]')->>'status'='invalid','at least one edit');
select pg_temp.ok(pg_temp.edit('08',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,2),'action','correct','value',3.1),jsonb_build_object('valueId',pg_temp.vid(21,3),'action','remove')))->>'edited'='2','corrected and removed');
select pg_temp.ok(pg_temp.edit('08',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,2),'action','correct','value',3.1),jsonb_build_object('valueId',pg_temp.vid(21,3),'action','remove')))->>'replayed'='true','the same submission replays');
select pg_temp.ok(pg_temp.edit('09',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,2),'action','correct','value',3.2)))->>'status'='saved','a correction can be corrected again');
select pg_temp.ok(pg_temp.edit('10',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,1),'action','remove')))->>'status'='saved','a charted value removed');
select pg_temp.ok(pg_temp.edit('11',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,1),'action','correct','value',6.0)))->>'status'='invalid','a removed value stays removed');
select pg_temp.ok(pg_temp.raises($$insert into public.member_reported_values(user_id,source,ai_value_id,measure,value,unit,measured_on)values('3a100000-0000-4000-8000-000000000004','ai_read',null,'ldl_c',3,'mmol/L','2026-09-01')$$),'members cannot write AI values directly');
select pg_temp.ok(pg_temp.raises($$select * from public.member_upload_ai_edits$$),'members cannot read the edit log');
reset role;
select pg_temp.ok((pg_temp.mv(21,2)).member_status='corrected'and(pg_temp.mv(21,2)).member_value=3.2 and(pg_temp.mv(21,2)).value=3.4,'AI reading kept beside the correction');
select pg_temp.ok((pg_temp.charted(21,2)).value=3.2 and(pg_temp.charted(21,2)).source='member_corrected','charted value follows the correction');
select pg_temp.ok((pg_temp.mv(21,3)).member_status='rejected'and(pg_temp.mv(21,1)).member_status='rejected'and(pg_temp.charted(21,1)).id is null,'removed values uncharted');
select pg_temp.ok((pg_temp.mv(23,1)).member_status='rejected'and(pg_temp.charted(23,1)).id is null,'not mine saves nothing');
select pg_temp.ok((select count(*)from public.member_upload_ai_edits)=4 and(select (before->>'chartedValue')::numeric from public.member_upload_ai_edits where action='remove'and value_id=pg_temp.vid(21,1))=6.1,'every edit logged with what it replaced');
select pg_temp.ok(pg_temp.raises($$update public.member_upload_ai_edits set action='remove'$$,'55000'),'edit log is append-only');
select pg_temp.ok(pg_temp.raises($$insert into public.member_reported_values(user_id,source,measure,value,unit,measured_on)values('3a100000-0000-4000-8000-000000000004','ai_read','ldl_c',3,'mmol/L','2026-09-01')$$,'23514'),'AI sources need their AI value');

-- 8b. Removing an AI-read value from "Values you added" is the audited, final removal (Codex F2).
select (pg_temp.charted(22,1)).id as rv22 \gset
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.member_reported_value_remove(:'rv22')=false,'not another member''s value');
reset role;
select pg_temp.as_user(5);
set local role authenticated;
select pg_temp.ok(public.member_reported_value_remove(:'rv22'),'removed from the values list');
select pg_temp.ok(pg_temp.edit('30',22,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(22,1),'action','correct','value',2.5)))->>'status'='invalid','and cannot come back through Edit');
reset role;
select pg_temp.ok((pg_temp.mv(22,1)).member_status='rejected'and(pg_temp.charted(22,1)).id is null
 and(select count(*)from public.member_upload_ai_edits where value_id=pg_temp.vid(22,1)and action='remove'and after->>'via'='values_list')=1,'AI value removed, logged, uncharted');
select pg_temp.as_user(4);
set local role authenticated;
select public.member_reported_value_add('weight',80,null,'kg','2026-09-01') as handid \gset
select pg_temp.ok(public.member_reported_value_remove(:'handid'),'hand-entered values are still simply deleted');
reset role;

-- 9a. A clinic document for member 04, read and partly reviewed by the doctor (as in check-lab-ai-extraction).
update public.doctor_completion_capabilities set enabled=true where singleton;
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,created_at)values
 ('3a100000-0000-4000-8000-000000000041','3a100000-0000-4000-8000-000000000004','3a100000-0000-4000-8000-000000000008','Synthetic nurse','nurse','3a100000-0000-4000-8000-000000000007',now()-interval '3 hours');
set local session_replication_role=replica;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
values('3a100000-0000-4000-8000-000000000311',gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'3a100000-0000-4000-8000-000000000002',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'PRIVATE-CLINIC-311.pdf','application/pdf',1000,repeat('c',64),'synthetic-member-upload/311','3a100000-0000-4000-8000-000000000312',1000,repeat('c',64),'stored',now()-interval '1 hour');
insert into storage.objects(id,bucket_id,name,metadata)values('3a100000-0000-4000-8000-000000000312','clinic-originals','synthetic-member-upload/311','{"size":1000}');
set local session_replication_role=origin;
insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
 values('3a100000-0000-4000-8000-000000000311','3a100000-0000-4000-8000-000000000007','3a100000-0000-4000-8000-000000000004','3a100000-0000-4000-8000-000000000041','noreon-admin','3a100000-0000-4000-8000-000000000002',gen_random_uuid());
create function pg_temp.cjob() returns public.lab_ai_jobs language sql security definer as $f$select * from public.lab_ai_jobs where file_id='3a100000-0000-4000-8000-000000000311'$f$;
grant execute on function pg_temp.cjob() to service_role;
select pg_temp.as_service();
set local role service_role;
do $$declare c jsonb;j public.lab_ai_jobs;begin
 c:=public.lab_ai_job_claim(5);
 j:=pg_temp.cjob();
 perform pg_temp.ok(j.state='running','clinic job claimed alongside member jobs');
 perform pg_temp.ok((public.lab_ai_job_finish(j.id,j.lease_token,jsonb_build_object('disposition','done','outcome','extracted','pageCount',1,'sourceSha256',repeat('c',64),'identityStatus','match',
  'identity',jsonb_build_object('nameOnSheet','Synthetic Upload Four'),'values',jsonb_build_array(pg_temp.value('ldl_c',4.1,'mmol/L',null,null)-'measure'-'measureUnit',pg_temp.value('tsh',2,'mIU/L',null,null)-'measure'-'measureUnit'),
  'summary',jsonb_build_object('preparedBy','ai'),'provider','noreon.fake','model','noreon-fake-lab-1'))->>'values')::int=2,'clinic finish still works');
end$$;
reset role;
insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind)select j.user_id,j.file_id,j.attachment_id,'3a100000-0000-4000-8000-000000000002','doctor'from public.lab_ai_jobs j where j.file_id='3a100000-0000-4000-8000-000000000311';
select v.id as cvid from public.lab_ai_values v where v.file_id='3a100000-0000-4000-8000-000000000311'and v.seq=1 \gset
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_lab_ai_value_review(jsonb_build_object('version','lab-ai-review-v1','submissionId','3a100000-0000-4000-8000-000000000981','memberId','3a100000-0000-4000-8000-000000000004',
 'valueId',:'cvid','action','correct','value',4.0))->>'status'='saved','doctor corrects a clinic value');
reset role;

-- 9. Staff read (staff_lab_ai_results): the assigned doctor and active admins read, every read recorded;
--    another doctor, the nurse, a clinic user and members are refused.
select pg_temp.as_user(2);
set local role authenticated;
create temp table d1 as select public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')r;
select pg_temp.ok((select r->>'enabled'='true'and r->>'viewer'='doctor'from d1),'assigned doctor reads');
select pg_temp.ok((select d->'job'->'confirmation'->>'valuesCharted'='2'and jsonb_array_length(d->'values')=3 and d->'job'->'summary'is not null
 from d1,jsonb_array_elements(r->'memberUploads')d where d->>'documentId'='3a100000-0000-4000-8000-000000000121'),'values, member answers and summary');
select pg_temp.ok((select d->'values'->1->>'memberStatus'='corrected'and d->'values'->1->>'attention'='needs_doctor'and d->'values'->1->>'labFlag'='high'and d->'values'->1 ? 'checks'
 from d1,jsonb_array_elements(r->'memberUploads')d where d->>'documentId'='3a100000-0000-4000-8000-000000000121'),'per value status, flags, checks and doctor marks');
select pg_temp.ok(pg_temp.raises($$select public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000005')$$),'not another doctor''s member');
reset role;
select pg_temp.ok((select count(*)from public.access_audit where actor_id='3a100000-0000-4000-8000-000000000002'and member_id='3a100000-0000-4000-8000-000000000004'and surface='lab_ai_results'and actor_role='doctor')=1,'doctor read recorded');
select pg_temp.ok((select jsonb_array_length(r->'clinic')=1 from d1),'doctor sees the clinic document too');
select pg_temp.as_user(6);
set local role authenticated;
create temp table a1 as select public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')r;
select pg_temp.ok((select r->>'viewer'='admin'and jsonb_array_length(r->'memberUploads')=7 from a1),'admin reads any member''s results');
select pg_temp.ok((select jsonb_array_length(f->'values')=2 and f->'values'->0->>'status'='corrected'and(f->'values'->0->>'correctedValue')::numeric=4.0 and f->'values'->1->>'status'='unverified'
 and f->'job'->'summary'is not null from a1,jsonb_array_elements(r->'clinic')f where f->>'fileId'='3a100000-0000-4000-8000-000000000311'),'admin sees clinic values with the doctor''s review state');
select pg_temp.ok((select jsonb_typeof(r->'clinic')='array'from a1)and(public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000005')->>'viewer')='admin','admin reads the other member too');
select pg_temp.ok(pg_temp.edit('20',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,2),'action','remove')))->>'status'='stale','admin cannot edit for the member');
select pg_temp.ok(pg_temp.raises($$select public.doctor_lab_ai_value_review('{"version":"lab-ai-review-v1","submissionId":"3a100000-0000-4000-8000-000000000999","memberId":"3a100000-0000-4000-8000-000000000004","valueId":"3a100000-0000-4000-8000-000000000999","action":"confirm"}')$$),'admin cannot review clinic values');
reset role;
select pg_temp.ok((select count(*)from public.access_audit where actor_id='3a100000-0000-4000-8000-000000000006'and surface='lab_ai_results'and actor_role='admin')=2,'admin reads recorded');
update public.workspace_staff set active=false where user_id='3a100000-0000-4000-8000-000000000006';
select pg_temp.as_user(6);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')$$),'an inactive admin is refused');
reset role;
update public.workspace_staff set active=true where user_id='3a100000-0000-4000-8000-000000000006';
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')$$),'an unassigned doctor is refused');
reset role;
select pg_temp.as_user(8);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')$$),'the assigned nurse is refused');
reset role;
select pg_temp.as_user(9);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')$$),'a clinic user is refused');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($$select public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')$$),'a member cannot use the staff read, even for themselves');
reset role;
select pg_temp.ok((select count(*)from public.access_audit where surface='lab_ai_results')=3,'refused reads record nothing');

-- 10. Member switch off: reads say off, answers are refused.
update public.lab_ai_capabilities set member_upload_enabled=false where singleton;
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.member_upload_ai_overview()->>'enabled'='false'and public.member_upload_ai_read('3a100000-0000-4000-8000-000000000121')->>'enabled'='false','member reads off');
select pg_temp.ok(pg_temp.edit('21',21,jsonb_build_array(jsonb_build_object('valueId',pg_temp.vid(21,2),'action','remove')))->>'status'='disabled','edits refused while off');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')->'memberUploads')=0,'staff read shows no member uploads while off');
reset role;
update public.lab_ai_capabilities set enabled=false where singleton;
select pg_temp.as_user(6);
set local role authenticated;
select pg_temp.ok(public.staff_lab_ai_results('3a100000-0000-4000-8000-000000000004')->>'enabled'='false','staff read off with the lab switch');
reset role;

rollback;
\echo 'member upload AI checks passed'
