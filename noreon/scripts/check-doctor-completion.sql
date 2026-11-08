-- Fictional B5 part A checks; all fixtures roll back.
-- Database switch, neutral consultation hold status, doctor-only audited open,
-- explicit release with single-member confirmation, replay, withdrawal, and
-- release ending when the attachment is detached or moved.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(cond boolean,label text) returns void language plpgsql as $$begin
 if cond is distinct from true then raise exception 'TEST %',label;end if;
end$$;
-- b5a0: doctor 02, other doctor 03, member 04, other member 05, clinic 07.
insert into auth.users(id,phone,phone_confirmed_at)select ('b5a00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,case when n in(4,5)then '37400095000'||n end,case when n in(4,5)then now()end from generate_series(2,5)n;
insert into public.workspace_clinics(id,name)values('b5a00000-0000-4000-8000-000000000007','Synthetic B5 clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('b5a00000-0000-4000-8000-000000000002','doctor','Synthetic B5 doctor','b5a00000-0000-4000-8000-000000000007'),
 ('b5a00000-0000-4000-8000-000000000003','doctor','Synthetic B5 other doctor','b5a00000-0000-4000-8000-000000000007');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('b5a00000-0000-4000-8000-000000000004','b5a00000-0000-4000-8000-000000000002'),
 ('b5a00000-0000-4000-8000-000000000005','b5a00000-0000-4000-8000-000000000002');
-- Files 51 (released), 52 (moved to 05), 53 (detached), 54 (withdrawn), 55 (released then moved).
set local session_replication_role=replica;
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,created_at)
select ('b5a00000-0000-4000-8000-0000000000'||n)::uuid,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),
 'PRIVATE-CLINIC-NAME-'||n||'.pdf','application/pdf',10,repeat('c',64),'synthetic-b5/'||n,('b5a00000-0000-4000-8000-0000000002'||n)::uuid,10,repeat('c',64),'stored',now()-interval '1 hour'
from generate_series(51,55)n;
insert into storage.objects(id,bucket_id,name,metadata)select ('b5a00000-0000-4000-8000-0000000002'||n)::uuid,'clinic-originals','synthetic-b5/'||n,'{"size":10}'from generate_series(51,55)n;
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id,created_at)values
 ('b5a00000-0000-4000-8000-000000000061','b5a00000-0000-4000-8000-000000000051','b5a00000-0000-4000-8000-000000000007','b5a00000-0000-4000-8000-000000000004',gen_random_uuid(),'noreon-admin','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),null,now()-interval '50 minutes'),
 ('b5a00000-0000-4000-8000-000000000062','b5a00000-0000-4000-8000-000000000052','b5a00000-0000-4000-8000-000000000007','b5a00000-0000-4000-8000-000000000004',gen_random_uuid(),'noreon-admin','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),null,now()-interval '50 minutes'),
 ('b5a00000-0000-4000-8000-000000000072','b5a00000-0000-4000-8000-000000000052','b5a00000-0000-4000-8000-000000000007','b5a00000-0000-4000-8000-000000000005',gen_random_uuid(),'noreon-admin','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),'b5a00000-0000-4000-8000-000000000062',now()-interval '40 minutes'),
 ('b5a00000-0000-4000-8000-000000000063','b5a00000-0000-4000-8000-000000000053','b5a00000-0000-4000-8000-000000000007','b5a00000-0000-4000-8000-000000000004',gen_random_uuid(),'noreon-admin','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),null,now()-interval '50 minutes'),
 ('b5a00000-0000-4000-8000-000000000064','b5a00000-0000-4000-8000-000000000054','b5a00000-0000-4000-8000-000000000007','b5a00000-0000-4000-8000-000000000004',gen_random_uuid(),'noreon-admin','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),null,now()-interval '50 minutes'),
 ('b5a00000-0000-4000-8000-000000000065','b5a00000-0000-4000-8000-000000000055','b5a00000-0000-4000-8000-000000000007','b5a00000-0000-4000-8000-000000000004',gen_random_uuid(),'noreon-admin','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),null,now()-interval '50 minutes');
insert into public.clinic_result_detachments(attachment_id,actor_id,submission_id,reason)values('b5a00000-0000-4000-8000-000000000063','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),'Synthetic: wrong member');
-- File 53 (detached, never released by command): a release stamped after the withdrawal that followed it,
-- as a clock step backwards would leave it. The current state follows insertion order, not the clock.
insert into public.patient_document_release_events(user_id,file_id,attachment_id,kind,single_member_confirmed,actor_id,submission_id,created_at)values
 ('b5a00000-0000-4000-8000-000000000004','b5a00000-0000-4000-8000-000000000053','b5a00000-0000-4000-8000-000000000063','released',true,'b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),now()+interval '1 hour');
insert into public.patient_document_release_events(user_id,file_id,attachment_id,kind,actor_id,submission_id,created_at)values
 ('b5a00000-0000-4000-8000-000000000004','b5a00000-0000-4000-8000-000000000053','b5a00000-0000-4000-8000-000000000063','withdrawn','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),now());
set local session_replication_role=origin;

select pg_temp.ok((public._member_document_release('b5a00000-0000-4000-8000-000000000004','b5a00000-0000-4000-8000-000000000053','b5a00000-0000-4000-8000-000000000063')).kind='withdrawn','latest release state follows insertion order, not created_at');
-- A live password session for the user (staff RPCs require a managed session, 20261020195207).
create function pg_temp.as_user(n int) returns void language plpgsql security definer as $$declare c jsonb:=jsonb_build_object('sub','b5a00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated','session_id','b5a00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'));begin
 insert into auth.sessions(id,user_id,created_at,updated_at)select (c->>'session_id')::uuid,(c->>'sub')::uuid,now(),now()
  where exists(select 1 from auth.users where id=(c->>'sub')::uuid)on conflict(id)do nothing;
 perform set_config('request.jwt.claims',(c||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password'))))::text,true);
end$$;
create function pg_temp.cmd(sub text,member text,file text,act text,confirmed boolean default null) returns jsonb language sql as $$
 select jsonb_build_object('version','member-document-v1','submissionId','b5a00000-0000-4000-8000-0000000008'||sub,'memberId','b5a00000-0000-4000-8000-0000000000'||member,'fileId','b5a00000-0000-4000-8000-0000000000'||file,'action',act)
  ||case when confirmed is null then '{}'::jsonb else jsonb_build_object('singleMemberConfirmed',confirmed)end
$$;
create function pg_temp.raises(statement text) returns boolean language plpgsql as $$begin
 execute statement;return false;
exception when insufficient_privilege then return true;end$$;

-- Switch off: nothing new is visible or writable, and the hold status stays as before.
update public.doctor_completion_capabilities set enabled=false where singleton;
update public.patient_clinical_cases set review=jsonb_build_object('consultation',jsonb_build_object('decision','required','note','PRIVATE REASON')) where user_id='b5a00000-0000-4000-8000-000000000004';
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.patient_clinical_case_status()->>'status'='review_pending','switch off keeps the old member status');
select pg_temp.ok(public.patient_released_documents()->'documents'='[]'::jsonb,'switch off member list empty');
reset role;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok((public.doctor_member_documents('b5a00000-0000-4000-8000-000000000004')->>'enabled')::boolean=false,'switch off doctor list disabled');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('01','04','51','release',true))->>'status'='disabled','switch off command disabled');
reset role;

update public.doctor_completion_capabilities set enabled=true where singleton;

-- Neutral hold: a required, uncompleted consultation shows only a status word.
select pg_temp.as_user(4);
set local role authenticated;
do $$declare s jsonb:=public.patient_clinical_case_status();begin
 perform pg_temp.ok(s->>'status'='consultation_needed','hold status shown');
 perform pg_temp.ok(s::text not like '%PRIVATE%' and not(s?'review'),'hold status leaks no reason');
end$$;
reset role;
update public.patient_clinical_cases set review=jsonb_set(review,'{consultation,completedAt}',to_jsonb(now())) where user_id='b5a00000-0000-4000-8000-000000000004';
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.patient_clinical_case_status()->>'status'='review_pending','completed consultation ends the hold');
reset role;

-- Doctor list: current, undetached attachments to this member only.
select pg_temp.as_user(2);
set local role authenticated;
do $$declare d jsonb:=public.doctor_member_documents('b5a00000-0000-4000-8000-000000000004');begin
 perform pg_temp.ok((select array_agg(x->>'fileId' order by x->>'fileId') from jsonb_array_elements(d->'documents')x)=array['b5a00000-0000-4000-8000-000000000051','b5a00000-0000-4000-8000-000000000054','b5a00000-0000-4000-8000-000000000055'],'doctor list excludes moved and detached files');
 perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(d->'documents')x where x->'released'<>'false'::jsonb or x->'openedByYou'<>'false'::jsonb or x->'releasedAt'<>'null'::jsonb),'nothing released or opened yet, as explicit booleans');
end$$;
-- Release needs an open and an explicit single-member confirmation.
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('02','04','51','release',true))->>'status'='open-first','release before opening refused');
select pg_temp.ok(public.doctor_member_document_open('b5a00000-0000-4000-8000-000000000004','b5a00000-0000-4000-8000-000000000051')->>'objectKey'='synthetic-b5/51','doctor open returns location');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('03','04','51','release',false))->>'status'='confirm-required','unconfirmed release refused');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('04','04','51','release'))->>'status'='confirm-required','missing confirmation refused');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('05','04','51','release',true))->>'status'='released','release recorded');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('05','04','51','release',true))->>'status'='released','resend replays');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('05','04','51','withdraw'))->>'status'='stale','reused submission for another action is stale');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('06','04','51','release',true))->>'status'='unchanged','second release unchanged');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('07','04','53','release',true))->>'status'='stale','detached file cannot be released');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('08','04','52','release',true))->>'status'='stale','moved file cannot be released for its old member');
select pg_temp.ok(public.doctor_member_document_command('{"version":"member-document-v1"}')->>'status'='invalid','malformed command invalid');
-- 54: release then withdraw. 55: release, then it moves to another member.
select public.doctor_member_document_open('b5a00000-0000-4000-8000-000000000004',f)from(values('b5a00000-0000-4000-8000-000000000054'::uuid),('b5a00000-0000-4000-8000-000000000055'::uuid))x(f);
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('09','04','54','release',true))->>'status'='released','second file released');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('10','04','54','withdraw'))->>'status'='withdrawn','withdrawal recorded');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('11','04','54','withdraw'))->>'status'='unchanged','second withdrawal unchanged');
select pg_temp.ok(public.doctor_member_document_command(pg_temp.cmd('12','04','55','release',true))->>'status'='released','third file released');
reset role;

-- Another doctor in the same clinic is not the assigned doctor.
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_member_documents('b5a00000-0000-4000-8000-000000000004')$q$),'other doctor cannot list');
select pg_temp.ok(pg_temp.raises($q$select public.doctor_member_document_open('b5a00000-0000-4000-8000-000000000004','b5a00000-0000-4000-8000-000000000051')$q$),'other doctor cannot open');
select pg_temp.ok(pg_temp.raises($q$select public.doctor_member_document_command(pg_temp.cmd('13','04','51','withdraw'))$q$),'other doctor cannot withdraw');
reset role;

-- Member: released documents only, without the clinic's file name.
select pg_temp.as_user(4);
set local role authenticated;
do $$declare d jsonb:=public.patient_released_documents();begin
 perform pg_temp.ok((select array_agg(x->>'fileId' order by x->>'fileId') from jsonb_array_elements(d->'documents')x)=array['b5a00000-0000-4000-8000-000000000051','b5a00000-0000-4000-8000-000000000055'],'member sees released documents only');
 perform pg_temp.ok(d::text not like '%PRIVATE-CLINIC-NAME%' and d::text not like '%synthetic-b5%','member list leaks no file name or location');
end$$;
select pg_temp.ok(public.patient_released_document_open('b5a00000-0000-4000-8000-000000000051')->>'objectKey'='synthetic-b5/51','member opens own released document');
select pg_temp.ok(pg_temp.raises($q$select public.patient_released_document_open('b5a00000-0000-4000-8000-000000000054')$q$),'withdrawn document cannot be opened');
reset role;
select pg_temp.as_user(5);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.patient_released_document_open('b5a00000-0000-4000-8000-000000000051')$q$),'another member cannot open');
select pg_temp.ok(public.patient_released_documents()->'documents'='[]'::jsonb,'another member sees nothing');
reset role;

-- A move ends the release for the old member and does not carry it to the new one.
set local session_replication_role=replica;
insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id)values
 ('b5a00000-0000-4000-8000-000000000055','b5a00000-0000-4000-8000-000000000007','b5a00000-0000-4000-8000-000000000005',gen_random_uuid(),'noreon-admin','b5a00000-0000-4000-8000-000000000002',gen_random_uuid(),'b5a00000-0000-4000-8000-000000000065');
set local session_replication_role=origin;
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.patient_released_documents()->'documents')x where x->>'fileId'='b5a00000-0000-4000-8000-000000000055'),'moved file leaves the old member');
reset role;
select pg_temp.as_user(5);
set local role authenticated;
select pg_temp.ok(public.patient_released_documents()->'documents'='[]'::jsonb,'release does not follow the file to a new member');
reset role;

-- Audit: opens recorded with actor kind; history immutable; no excess grants.
select pg_temp.ok((select count(*) from public.patient_document_opens where actor_kind='doctor' and file_id='b5a00000-0000-4000-8000-000000000051')=1 and (select count(*) from public.patient_document_opens where actor_kind='member' and user_id::text like 'b5a0%')=1,'opens audited');
select pg_temp.ok((select count(*) from public.patient_document_release_events where user_id::text like 'b5a0%' and file_id<>'b5a00000-0000-4000-8000-000000000053')=4,'one event per recorded change');
do $$begin
 begin update public.patient_document_release_events set kind='withdrawn';raise exception 'TEST release history mutable';exception when sqlstate '55000' then null;end;
 begin delete from public.patient_document_opens;raise exception 'TEST open audit mutable';exception when sqlstate '55000' then null;end;
end$$;
select pg_temp.ok(not has_function_privilege('anon','public.patient_released_documents()','execute') and not has_function_privilege('anon','public.doctor_member_document_command(jsonb)','execute') and not has_function_privilege('authenticated','public._member_clinic_documents(uuid)','execute'),'no excess grants');
select pg_temp.ok(not has_table_privilege('authenticated','public.patient_document_release_events','select') and not has_table_privilege('authenticated','public.doctor_completion_capabilities','select'),'tables closed');
rollback;
\echo Doctor completion A: switch, neutral hold, audited doctor open, confirmed release, replay, withdrawal, move/detach ending and member isolation pass.
