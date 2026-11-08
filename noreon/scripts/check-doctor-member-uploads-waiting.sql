-- Fictional fixtures only. Run after a clean migration replay; everything rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text) returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;
end$$;
create function pg_temp.u(n int) returns uuid language sql immutable as $$
 select ('d7b00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.u(n+100))::text,true)
$$;
create function pg_temp.denied(statement text) returns boolean language plpgsql as $$begin
 execute statement;return false;exception when insufficient_privilege then return true;
end$$;
create temp table responses(label text primary key,body jsonb);
grant all on responses to authenticated;
create function pg_temp.read(label text) returns void language plpgsql as $$declare x jsonb;begin
 set local role authenticated;x:=public.doctor_member_uploads_waiting();reset role;
 insert into responses values(label,x);
end$$;
grant execute on all functions in schema pg_temp to authenticated,anon;

-- Doctor 11 owns members 1 and 3; doctor 12 owns member 2; nurse 13 assists 1.
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.u(n),case when n<10 then '374991930'||lpad(n::text,2,'0')end,
  case when n<10 then now()end from unnest(array[1,2,3,11,12,13])n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select pg_temp.u(n+100),pg_temp.u(n),now()-interval '1 hour',now()
 from unnest(array[1,2,3,11,12,13])n;
insert into public.workspace_clinics(id,name) values(pg_temp.u(20),'Synthetic uploads clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
 (pg_temp.u(11),'doctor','Synthetic Uploads Doctor',pg_temp.u(20)),
 (pg_temp.u(12),'doctor','Synthetic Other Doctor',pg_temp.u(20)),
 (pg_temp.u(13),'nurse','Synthetic Uploads Nurse',pg_temp.u(20));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id) values
 (pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null),(pg_temp.u(3),pg_temp.u(11),null);
update public.profiles set display_name='Synthetic Upload Member' where id=pg_temp.u(1);
update public.lab_ai_capabilities set enabled=true,member_upload_enabled=true,member_upload_doctor_approval=true where singleton;

select pg_temp.ok(has_function_privilege('authenticated','public.doctor_member_uploads_waiting()','execute')
 and not has_function_privilege('anon','public.doctor_member_uploads_waiting()','execute')
 and not has_function_privilege('service_role','public.doctor_member_uploads_waiting()','execute'),'authenticated grant only');
select pg_temp.as_user(13);select pg_temp.ok(pg_temp.denied($$select pg_temp.read('nurse')$$),'nurse refused');
select pg_temp.as_user(1);select pg_temp.ok(pg_temp.denied($$select pg_temp.read('member')$$),'member refused');
select pg_temp.ok(pg_temp.denied($$set local role anon;select public.doctor_member_uploads_waiting()$$),'anonymous refused');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(11),'role','authenticated')::text,true);
select pg_temp.ok(pg_temp.denied($$select pg_temp.read('no-session')$$),'doctor without managed session refused');
reset role;
select pg_temp.as_user(11);select pg_temp.read('empty');
select pg_temp.ok((select body='{"rows":[],"total":0}'::jsonb from responses where label='empty'),'empty envelope');

-- Records produced by the upload/worker flows, seeded without running workers.
-- 21 own ready; 22 other doctor; 23 approved; 24 mismatch awaiting answer;
-- 25 mismatch confirmed mine; 26 not mine; 27 deleted; 28 queued; 29 all values removed.
set local session_replication_role=replica;
insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256,deleted_at)
 select pg_temp.u(n+200),pg_temp.u(case when n=22 then 2 else 1 end),
  pg_temp.u(case when n=22 then 2 else 1 end)::text||'/'||n||'.pdf',
  'Synthetic upload.pdf','application/pdf',1000,lpad(n::text,64,'0'),case when n=27 then now()end
 from generate_series(21,29)n;
insert into public.lab_ai_jobs(id,kind,member_id,member_document_id,state,outcome,finished_at,identity_status)
 select pg_temp.u(n+300),'member_upload',pg_temp.u(case when n=22 then 2 else 1 end),pg_temp.u(n+200),
  case when n=28 then 'queued'else 'done'end,case when n<>28 then 'extracted'end,
  case when n<>28 then '2026-10-20 10:00:00+00'::timestamptz+n*interval '1 minute'end,
  case when n in(24,25,26)then 'mismatch'else 'match'end from generate_series(21,29)n;
insert into public.member_upload_ai_values(id,job_id,member_id,document_id,seq,test_name,value_text,value,page,member_status,member_reviewed_at)
 select pg_temp.u(n+400),pg_temp.u(n+300),pg_temp.u(case when n=22 then 2 else 1 end),pg_temp.u(n+200),1,'Synthetic analyte','5',5,1,
  case when n=29 then 'rejected'else 'pending'end,case when n=29 then now()end from generate_series(21,29)n;
insert into public.member_upload_ai_confirmations(job_id,member_id,submission_id,identity_status,identity_answer,values_saved,values_charted)
 select pg_temp.u(n+300),pg_temp.u(case when n=22 then 2 else 1 end),pg_temp.u(n+500),
  case when n in(25,26)then 'mismatch'else 'match'end,
  case when n=25 then 'mine'when n=26 then 'not_mine'end,1,0
 from generate_series(21,29)n where n<>24;
set local session_replication_role=origin;

-- Use the actual approval entry point to close 23, then prove the queue omits it.
select pg_temp.as_user(11);set local role authenticated;
select pg_temp.ok(public.doctor_member_upload_approve(jsonb_build_object(
 'version','member-upload-approve-v1','submissionId',pg_temp.u(600),'memberId',pg_temp.u(1),'jobId',pg_temp.u(323),
 'basedOn',null,'values',jsonb_build_array(jsonb_build_object('valueId',pg_temp.u(423),'action','keep')),
 'interpretationHy','Սինթետիկ մեկնաբանություն։','interpretationEn','Synthetic interpretation.','interpretationEdited',false))->>'status'='approved','actual approval succeeds');
reset role;
select pg_temp.read('own');
select pg_temp.ok((select (body->>'total')::int=2 and jsonb_array_length(body->'rows')=2
 and body#>>'{rows,0,documentId}'=pg_temp.u(221)::text
 and body#>>'{rows,1,documentId}'=pg_temp.u(225)::text
 and body#>>'{rows,0,memberId}'=pg_temp.u(1)::text
 and body#>>'{rows,0,memberName}'='Synthetic Upload Member'
 and body#>>'{rows,0,jobId}'=pg_temp.u(321)::text
 and (body#>>'{rows,0,at}')::timestamptz='2026-10-20 10:21:00+00'::timestamptz
 from responses where label='own'),'own unapproved ready only, identity gate and stable oldest-first fields');
select pg_temp.ok((select count(*)=1 from public.access_audit where actor_id=pg_temp.u(11)
 and member_id=pg_temp.u(1) and surface='doctor_inbox'),'one queue audit per displayed member, despite two rows');
select pg_temp.ok(not exists(select 1 from public.access_audit where actor_id=pg_temp.u(11)
 and member_id=pg_temp.u(2) and surface='doctor_inbox'),'other member never audited as displayed');
select pg_temp.as_user(12);select pg_temp.read('other');
select pg_temp.ok((select body->>'total'='1' and body#>>'{rows,0,memberId}'=pg_temp.u(2)::text from responses where label='other'),'other doctor sees only own member');

-- Current assignment and access are rechecked on every read.
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.u(12) where user_id=pg_temp.u(1);
select pg_temp.as_user(11);select pg_temp.read('reassigned');
select pg_temp.ok((select body='{"rows":[],"total":0}'::jsonb from responses where label='reassigned'),'former doctor loses queue access');
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.u(11) where user_id=pg_temp.u(1);
savepoint inactive;
update public.workspace_staff set active=false where user_id=pg_temp.u(11);
select pg_temp.ok(pg_temp.denied($$select pg_temp.read('inactive')$$),'inactive doctor refused');
rollback to inactive;
savepoint clinic;
update public.workspace_clinics set active=false where id=pg_temp.u(20);
select pg_temp.ok(pg_temp.denied($$select pg_temp.read('inactive-clinic')$$),'inactive clinic refused');
rollback to clinic;

update public.lab_ai_capabilities set member_upload_doctor_approval=false where singleton;
select pg_temp.read('not-required');
select pg_temp.ok((select body='{"rows":[],"total":0}'::jsonb from responses where label='not-required'),'no required approvals when switch off');
update public.lab_ai_capabilities set member_upload_doctor_approval=true,member_upload_enabled=false where singleton;
select pg_temp.read('disabled');
select pg_temp.ok((select body='{"rows":[],"total":0}'::jsonb from responses where label='disabled'),'disabled uploads produce no waiting work');
update public.lab_ai_capabilities set member_upload_enabled=true where singleton;

-- The displayed rows are capped; total includes all eligible work.
set local session_replication_role=replica;
insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256)
 select pg_temp.u(n+1000),pg_temp.u(3),pg_temp.u(3)::text||'/'||n||'.pdf','Synthetic cap.pdf','application/pdf',1000,lpad(n::text,64,'0') from generate_series(1,61)n;
insert into public.lab_ai_jobs(id,kind,member_id,member_document_id,state,outcome,finished_at,identity_status)
 select pg_temp.u(n+2000),'member_upload',pg_temp.u(3),pg_temp.u(n+1000),'done','extracted','2026-10-21 10:00:00+00','match' from generate_series(1,61)n;
insert into public.member_upload_ai_values(job_id,member_id,document_id,seq,test_name,value_text,value,page)
 select pg_temp.u(n+2000),pg_temp.u(3),pg_temp.u(n+1000),1,'Synthetic analyte','5',5,1 from generate_series(1,61)n;
insert into public.member_upload_ai_confirmations(job_id,member_id,submission_id,identity_status,values_saved,values_charted)
 select pg_temp.u(n+2000),pg_temp.u(3),pg_temp.u(n+3000),'match',1,0 from generate_series(1,61)n;
set local session_replication_role=origin;
select pg_temp.as_user(11);select pg_temp.read('capped');
select pg_temp.ok((select body->>'total'='63' and jsonb_array_length(body->'rows')=60
 and body#>>'{rows,2,jobId}'=pg_temp.u(2001)::text
 and body#>>'{rows,59,jobId}'=pg_temp.u(2058)::text from responses where label='capped'),'cap 60, uncapped total, deterministic job tie-break');
select 'doctor member uploads waiting checks passed';
rollback;
