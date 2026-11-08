-- Fictional fixtures only. Replay the new migration first; never run against hosted data.
\set ON_ERROR_STOP on
begin;
create function pg_temp.id(n int)returns uuid language sql immutable as $$select ('fb040000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'TEST %',label;end if;
end$$;
create function pg_temp.fails(q text,code text default '42501')returns boolean language plpgsql as $$begin
 execute q;return false;exception when others then if sqlstate=code then return true;end if;raise;
end$$;
create function pg_temp.actor(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated','session_id',pg_temp.id(n+100),
  'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)
$$;
create function pg_temp.close(n int,reason text default 'Synthetic review')returns text language sql as $$
 select public.doctor_first_note_backlog_close(pg_temp.id(n),reason)->>'status'
$$;
create function pg_temp.note(n int)returns jsonb language sql as $$select jsonb_build_object(
 'version','first-note-v1','memberId',pg_temp.id(n),'submissionId',pg_temp.id(n+200),'textEn','Synthetic approved note.',
 'textHy','Սինթետիկ հաստատված գրառում։','builderVersion','first-note-1','sources','[]'::jsonb,'edited',true,'assessmentRevision',0)
$$;
grant execute on function pg_temp.id(int),pg_temp.ok(boolean,text),pg_temp.fails(text,text),pg_temp.actor(int),pg_temp.close(int,text),pg_temp.note(int)to authenticated;

-- Doctor 1 owns 10-14 and 16; 15 has no doctor. Doctor 2, nurse 3 and admin 4.
insert into auth.users(id)select pg_temp.id(n)from generate_series(1,4)n;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'37499098'||lpad(n::text,3,'0'),now()from generate_series(10,16)n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.id(n+100),pg_temp.id(n),now()-interval '1 hour',now()from generate_series(1,4)n;
insert into public.workspace_clinics(id,name)values(pg_temp.id(50),'Synthetic backlog clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id(1),'doctor','Synthetic owner',pg_temp.id(50)),(pg_temp.id(2),'doctor','Synthetic other doctor',pg_temp.id(50)),
 (pg_temp.id(3),'nurse','Synthetic nurse',pg_temp.id(50)),(pg_temp.id(4),'admin','Synthetic admin',pg_temp.id(50));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)select pg_temp.id(n),case when n<>15 then pg_temp.id(1)end from generate_series(10,16)n;
insert into public.patient_consents(user_id,version)select pg_temp.id(n),'patient-pilot-v1'from generate_series(10,16)n;
insert into public.patient_assessments(user_id,completed_at,urgent_rule)select pg_temp.id(n),
 case when n=11 then now()-interval '1 hour'else now()-interval '5 days'end,case when n=13 then 'RF-01'end from generate_series(10,16)n;
update public.profiles set display_name='Synthetic backlog member'where id in(select pg_temp.id(n)from generate_series(10,16)n);
insert into public.patient_care_plans(user_id,clinician,instructions)values(pg_temp.id(14),'Synthetic owner','Synthetic plan');
insert into public.member_first_notes(user_id,doctor_id,submission_id,text_en,text_hy,builder_version,edited,assessment_completed_at)
 values(pg_temp.id(16),pg_temp.id(1),pg_temp.id(216),'Already approved','Արդեն հաստատված','first-note-1',true,now()-interval '5 days');
update public.member_first_note_settings set enabled=true,due_hours=24;
create temp table before_state as select
 (select count(*)from public.member_notices)notices,
 (select count(*)from public.member_first_notes)notes,
 (select count(*)from public.patient_care_plans)plans;

select pg_temp.ok((select relrowsecurity from pg_class where oid='public.first_note_backlog_closures'::regclass),'RLS on');
select pg_temp.ok(not exists(select 1 from pg_policy where polrelid='public.first_note_backlog_closures'::regclass),'no direct access policies');
select pg_temp.ok((select bool_and(provolatile='v'and prosecdef and 'search_path=""'=any(proconfig))from pg_proc where oid in(
 'public.doctor_first_note_backlog_close(uuid,text)'::regprocedure,'public.doctor_first_note_backlog_reopen(uuid)'::regprocedure)),'writes are volatile security definers with empty search path');

select pg_temp.actor(2);
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select pg_temp.close(10)'),'another doctor cannot close');
select pg_temp.ok(pg_temp.fails('select public.doctor_first_note_backlog_reopen(pg_temp.id(10))'),'another doctor cannot reopen');
select pg_temp.ok(public.doctor_first_note_queue_count()->>'count'='0','another doctor sees no assigned members');
reset role;
select pg_temp.actor(3);
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select pg_temp.close(10)'),'nurse cannot close');
select pg_temp.ok(pg_temp.fails('select public.doctor_first_note_backlog_reopen(pg_temp.id(10))'),'nurse cannot reopen');
select pg_temp.ok(pg_temp.fails('select public.doctor_first_note_queue()'),'nurse cannot read backlog reasons');
select pg_temp.ok(pg_temp.fails('select * from public.first_note_backlog_closures'),'table cannot be read directly');
reset role;

select pg_temp.actor(1);
set local role authenticated;
select pg_temp.ok(pg_temp.close(10,null)='invalid'and pg_temp.close(10,'')='invalid'and pg_temp.close(10,E' \n\t')='invalid','reason required');
select pg_temp.ok(pg_temp.close(10,repeat('x',501))='invalid','reason limited to 500');
select pg_temp.ok(pg_temp.close(11)='not-overdue','not yet overdue refused');
select pg_temp.ok(pg_temp.close(16)='already','approved refused');
select pg_temp.ok(pg_temp.close(13)='urgent'and pg_temp.close(14)='plan-active','urgent and active plan excluded');
select pg_temp.ok(pg_temp.fails('select pg_temp.close(15)'),'doctor cannot close unassigned member');
select pg_temp.ok(public.doctor_first_note_queue_count()->>'count'='3','three assigned first notes waiting');
select pg_temp.ok(public.doctor_first_note_queue()#>>'{items,0,doctorName}'='Synthetic owner','RPC returns owner');
select pg_temp.ok(pg_temp.close(10,'  Synthetic reason  ')='closed','assigned doctor closes overdue');
select pg_temp.ok(pg_temp.close(10,'Second reason')='closed','repeat close is idempotent');
select pg_temp.ok(public.doctor_first_note_queue_count()->>'count'='2','closed leaves count');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.doctor_first_note_queue()->'items')i where i->>'memberId'=pg_temp.id(10)::text),'closed leaves queue');
select pg_temp.ok(public.doctor_first_note_queue()#>>'{closed,0,closedByName}'='Synthetic owner'
 and public.doctor_first_note_queue()#>>'{closed,0,reason}'='Synthetic reason','closed line has reviewer and preserved trimmed reason');
select pg_temp.ok(public.patient_first_note()is null,'closing is not publishing');
reset role;
select pg_temp.ok((select closed_at is not null and closed_by=pg_temp.id(1)and reason='Synthetic reason'from public.first_note_backlog_closures where member_id=pg_temp.id(10)),'closure stores actor, time and reason');
select pg_temp.ok((select count(*)=1 from public.access_audit where member_id=pg_temp.id(10)and surface='doctor_decisions'and object_id like '%:backlog-closed'),'one close audit, no duplicate on retry');
select pg_temp.ok((select (select count(*)from public.member_notices)=notices and(select count(*)from public.member_first_notes)=notes
 and(select count(*)from public.patient_care_plans)=plans from before_state),'close sends no notice, publishes no note, changes no plan');
select pg_temp.ok((select completed_at<now()-interval '4 days'from public.patient_assessments where user_id=pg_temp.id(10)),'close does not change questionnaire');

-- Admin sees unassigned ownership, can close it, and can reopen a doctor's closure.
select pg_temp.actor(4);
set local role authenticated;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.doctor_first_note_queue()->'items')i where i->>'memberId'=pg_temp.id(15)::text and i->>'doctorName'is null),'admin sees unassigned backlog');
select pg_temp.ok(pg_temp.close(15,repeat('x',500))='closed','admin closes unassigned with max length reason');
select pg_temp.ok(public.doctor_first_note_backlog_reopen(pg_temp.id(10))->>'status'='reopened','admin reopens');
select pg_temp.ok(public.doctor_first_note_backlog_reopen(pg_temp.id(10))->>'status'='reopened','repeat reopen is idempotent');
select pg_temp.ok(pg_temp.fails('select public.doctor_first_note_approve(pg_temp.note(10))'),'admin still cannot approve');
reset role;
select pg_temp.ok((select count(*)=1 from public.access_audit where member_id=pg_temp.id(10)and surface='doctor_decisions'and object_id like '%:backlog-reopened'),'one reopen audit, no duplicate on retry');
select pg_temp.actor(1);
set local role authenticated;
select pg_temp.ok(public.doctor_first_note_queue_count()->>'count'='3','reopen restores count');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.doctor_first_note_queue()->'items')i where i->>'memberId'=pg_temp.id(10)::text),'reopen restores queue');
select pg_temp.ok(pg_temp.close(10,'x')='closed','one character reason accepted');
select pg_temp.ok(public.doctor_first_note_approve(pg_temp.note(10))->>'status'='approved','closed backlog can still be approved by assigned doctor');
reset role;
select pg_temp.ok(not exists(select 1 from public.first_note_backlog_closures where member_id=pg_temp.id(10)),'page approval removes closure');

-- Audit errors fail closed: no closure remains when its audit could not be saved.
create function pg_temp.fail_backlog_audit()returns trigger language plpgsql as $$begin
 if new.member_id=pg_temp.id(12)and new.object_id like '%:backlog-closed'then
  raise exception using errcode='XX000',message='Synthetic audit failure';end if;return new;
end$$;
create trigger synthetic_backlog_audit before insert on public.access_audit for each row execute function pg_temp.fail_backlog_audit();
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select pg_temp.close(12)','XX000'),'audit failure refuses close');
reset role;
select pg_temp.ok(not exists(select 1 from public.first_note_backlog_closures where member_id=pg_temp.id(12)),'failed audit rolls back closure');
drop trigger synthetic_backlog_audit on public.access_audit;

-- The card path uses the same insert cleanup, with its normal care access and snapshot checks.
create temp table shown(j jsonb);
grant all on shown to authenticated;
set local role authenticated;
select pg_temp.ok(pg_temp.close(12)='closed','second member closed for card path');
insert into shown select public.doctor_approval_cards_read(pg_temp.id(12));
select pg_temp.ok((select public.doctor_first_note_card_approve(pg_temp.note(12),(j#>>'{snapshot,revision}')::bigint,
 j#>>'{snapshot,evidenceToken}',j->>'appointmentsRevision')->>'status'='approved'from shown),'card approval succeeds');
reset role;
select pg_temp.ok(not exists(select 1 from public.first_note_backlog_closures where member_id=pg_temp.id(12)),'card approval removes closure');
select pg_temp.ok((select count(*)=1 from public.access_audit where member_id=pg_temp.id(12)and surface='doctor_decisions'and object_id like '%:approved'),'card approval audit retained');

-- Removal/deactivation is rechecked for writes, not just on the page read.
update public.workspace_staff set active=false where user_id=pg_temp.id(4);
select pg_temp.actor(4);
set local role authenticated;
select pg_temp.ok(pg_temp.fails('select public.doctor_first_note_backlog_reopen(pg_temp.id(15))'),'inactive admin cannot reopen');
reset role;
update public.workspace_staff set active=true where user_id=pg_temp.id(4);
select pg_temp.actor(4);
set local role authenticated;
select pg_temp.ok(public.doctor_first_note_backlog_reopen(pg_temp.id(15))->>'status'='reopened','admin reopens unassigned closure');
reset role;
select pg_temp.ok(not exists(select 1 from public.first_note_backlog_closures where member_id in(pg_temp.id(10),pg_temp.id(12),pg_temp.id(15))),'no hidden closures remain');
rollback;
\echo 'first-note backlog SQL checks passed'
