-- Fictional checks for the first doctor note; all fixtures roll back.
-- Off by default; only the signed-in assigned active doctor approves, once; not before the questionnaire is
-- finished, not when urgent, not once a plan is active; replay by submission; insert only; the member reads
-- only their own approved note and only until a plan is active; the doctor's queue lists only their members;
-- text prepared from an older revision of the answers is refused (audit B2-3).
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
-- f1e: doctor 02, other doctor 03, members 04 (ready), 05 (urgent), 06 (not finished), 07 (plan active), 08 (other doctor's), nurse 09; clinic 10.
insert into auth.users(id)select ('f1e00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid from generate_series(2,9)n;
insert into public.workspace_clinics(id,name)values('f1e00000-0000-4000-8000-000000000010','Synthetic first-note clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('f1e00000-0000-4000-8000-000000000002','doctor','Synthetic Doctor Two','f1e00000-0000-4000-8000-000000000010'),
 ('f1e00000-0000-4000-8000-000000000003','doctor','Synthetic Doctor Three','f1e00000-0000-4000-8000-000000000010'),
 ('f1e00000-0000-4000-8000-000000000009','nurse','Synthetic Nurse','f1e00000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)select ('f1e00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,
 case when n=8 then 'f1e00000-0000-4000-8000-000000000003'::uuid else 'f1e00000-0000-4000-8000-000000000002'::uuid end from generate_series(4,8)n;
insert into public.patient_assessments(user_id,completed_at,urgent_rule)values
 ('f1e00000-0000-4000-8000-000000000004',now()-interval '30 hours',null),
 ('f1e00000-0000-4000-8000-000000000005',now()-interval '2 hours','RF-01'),
 ('f1e00000-0000-4000-8000-000000000006',null,null),
 ('f1e00000-0000-4000-8000-000000000007',now()-interval '5 days',null),
 ('f1e00000-0000-4000-8000-000000000008',now()-interval '1 hour',null);
update public.profiles set display_name='Synthetic Member '||right(id::text,1)where id::text like 'f1e00000-%';
insert into public.patient_care_plans(user_id,clinician,instructions)values('f1e00000-0000-4000-8000-000000000007','Synthetic Doctor Two','Synthetic plan');

-- Staff sessions: a real auth session and a password amr, as the managed-session guard requires.
insert into auth.sessions(id,user_id,created_at,updated_at)select ('f1e00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,('f1e00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,now()-interval '1 hour',now()
 from generate_series(2,9)n;
create function pg_temp.as_user(n int) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','f1e00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','f1e00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)
$$;
create function pg_temp.cmd(member int,sub int,extra jsonb default '{}') returns jsonb language sql as $$
 select jsonb_build_object('version','first-note-v1','memberId','f1e00000-0000-4000-8000-0000000000'||lpad(member::text,2,'0'),
  'submissionId','f1e00000-0000-4000-8000-0000000009'||lpad(sub::text,2,'0'),'textEn','Hello. I have read your health questions.','textHy','Բարև ձեզ։',
  'builderVersion','first-note-1','sources',jsonb_build_array('NRN-RULE-BP-002'),'edited',false,'assessmentRevision',0)||extra
$$;
create function pg_temp.approve(member int,sub int,extra jsonb default '{}') returns text language sql as $$
 select public.doctor_first_note_approve(pg_temp.cmd(member,sub,extra))->>'status'
$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.raises(text,text),pg_temp.as_user(int),pg_temp.cmd(int,int,jsonb),pg_temp.approve(int,int,jsonb) to authenticated;

-- 1. Off by default.
select pg_temp.ok((select enabled from public.member_first_note_settings)=false and(select due_hours from public.member_first_note_settings)=24,'off by default, 24 hours');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_first_note_read('f1e00000-0000-4000-8000-000000000004')->>'enabled'='false','doctor read says off');
select pg_temp.ok(pg_temp.approve(4,1)='disabled','approve refused while off');
select pg_temp.ok((public.doctor_first_note_queue()->>'enabled')::boolean=false,'queue off');
select pg_temp.ok(public.doctor_first_note_queue_count()=jsonb_build_object('version','first-note-queue-count-v1','enabled',false,'count',0),'disabled count has no details');
reset role;
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.patient_first_note()is null,'member sees nothing while off');
reset role;
update public.member_first_note_settings set enabled=true where singleton;

-- 2. Access: tables closed; another doctor, a nurse and the member cannot read or approve.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select * from public.member_first_notes'),'member cannot read the table');
select pg_temp.ok(pg_temp.raises($q$select public.doctor_first_note_read('f1e00000-0000-4000-8000-000000000004')$q$),'member cannot use the doctor read');
select pg_temp.ok(pg_temp.raises($q$select pg_temp.approve(4,2)$q$),'member cannot approve');
select pg_temp.ok(pg_temp.raises('select public.doctor_first_note_queue()'),'member has no queue');
select pg_temp.ok(pg_temp.raises('select public.doctor_first_note_queue_count()'),'member has no counts');
reset role;
select pg_temp.as_user(3);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_first_note_read('f1e00000-0000-4000-8000-000000000004')$q$),'another doctor cannot read');
select pg_temp.ok(pg_temp.raises($q$select pg_temp.approve(4,3)$q$),'another doctor cannot approve');
select pg_temp.ok((select array_agg(i->>'memberId')from jsonb_array_elements(public.doctor_first_note_queue()->'items')i)=array['f1e00000-0000-4000-8000-000000000008'],'another doctor sees only their own member');
reset role;
select pg_temp.as_user(9);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select pg_temp.approve(4,4)$q$),'a nurse cannot approve');
select pg_temp.ok(pg_temp.raises('select public.doctor_first_note_queue_count()'),'a nurse has no queue counts');
reset role;

-- 2b. An invited doctor whose staff session is not admitted is refused by every doctor RPC (Astra FN-01).
set local session_replication_role=replica;
insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,auth_user_id,expected_auth_user_id,status)
 values('synthetic-first-note@example.test','Synthetic Doctor Two','f1e00000-0000-4000-8000-000000000010','f1e00000-0000-4000-8000-000000000003','f1e00000-0000-4000-8000-000000000002','f1e00000-0000-4000-8000-000000000002','pending');
set local session_replication_role=origin;
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.doctor_first_note_read('f1e00000-0000-4000-8000-000000000004')$q$),'unadmitted session cannot read');
select pg_temp.ok(pg_temp.raises($q$select pg_temp.approve(4,11)$q$),'unadmitted session cannot approve');
select pg_temp.ok(pg_temp.raises('select public.doctor_first_note_queue()'),'unadmitted session has no queue');
select pg_temp.ok(pg_temp.raises('select public.doctor_first_note_queue_count()'),'unadmitted session has no counts');
reset role;
delete from public.real_staff_invitations where auth_user_id='f1e00000-0000-4000-8000-000000000002';

-- DH-02: member 04 appears only in first notes, without a conversation or another detail read.
select pg_temp.ok(not exists(select 1 from public.conversations where member_id='f1e00000-0000-4000-8000-000000000004'),'first-note-only member has no conversation');
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok(public.doctor_first_note_queue_count()=jsonb_build_object('version','first-note-queue-count-v1','enabled',true,'count',1),'poll returns only enabled and count');
reset role;
select pg_temp.ok(not exists(select 1 from public.access_audit where member_id='f1e00000-0000-4000-8000-000000000004'),'count poll records no member access');
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.doctor_first_note_queue()->'items')=1,'detail load returns the first-note-only member');
reset role;
select pg_temp.ok((select count(*)=1 from public.access_audit where actor_id='f1e00000-0000-4000-8000-000000000002' and member_id='f1e00000-0000-4000-8000-000000000004' and surface='doctor_inbox' and object_id='first_notes'),'detail load audits the first-note-only member');
set local role authenticated;
select public.doctor_first_note_queue_count();
select public.doctor_first_note_queue_count();
reset role;
select pg_temp.ok((select count(*)=1 from public.access_audit where member_id='f1e00000-0000-4000-8000-000000000004'),'unchanged polls add no audit rows');

-- Fail on the second returned member: the RPC must return no details and roll back the first audit too.
update public.patient_assessments set completed_at=now() where user_id='f1e00000-0000-4000-8000-000000000006';
create function pg_temp.fail_first_note_audit() returns trigger language plpgsql as $$begin
 if new.surface='doctor_inbox' and new.object_id='first_notes' and new.member_id='f1e00000-0000-4000-8000-000000000006'then raise exception 'Synthetic audit failure';end if;return new;
end$$;
create trigger synthetic_first_note_audit before insert on public.access_audit for each row execute function pg_temp.fail_first_note_audit();
set local role authenticated;
select pg_temp.ok(pg_temp.raises('select public.doctor_first_note_queue()','P0001'),'audit failure refuses all queue details');
reset role;
select pg_temp.ok((select count(*)=1 from public.access_audit where member_id='f1e00000-0000-4000-8000-000000000004'),'audit failure rolls back earlier member access in the same read');
drop trigger synthetic_first_note_audit on public.access_audit;
set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.doctor_first_note_queue()->'items')=2,'successful detail refresh returns both members');
reset role;
select pg_temp.ok((select count(*)=2 from public.access_audit where member_id='f1e00000-0000-4000-8000-000000000004' and surface='doctor_inbox' and object_id='first_notes')
 and(select count(*)=1 from public.access_audit where member_id='f1e00000-0000-4000-8000-000000000006' and surface='doctor_inbox' and object_id='first_notes'),'every returned member is audited on a successful detail refresh');
update public.patient_assessments set completed_at=null where user_id='f1e00000-0000-4000-8000-000000000006';

-- 3. The assigned doctor: queue, read, refusals, approve once, replay.
select pg_temp.as_user(2);
set local role authenticated;
select pg_temp.ok((select array_agg(i->>'memberId')from jsonb_array_elements(public.doctor_first_note_queue()->'items')i)=array['f1e00000-0000-4000-8000-000000000004'],
 'queue: finished, not urgent, no plan, no note');
select pg_temp.ok((select (i->>'dueAt')::timestamptz<now() from jsonb_array_elements(public.doctor_first_note_queue()->'items')i),'member 04 is overdue (30 hours)');
select pg_temp.ok((public.doctor_first_note_read('f1e00000-0000-4000-8000-000000000004')->>'note')is null,'no note yet');
select pg_temp.ok(pg_temp.approve(5,5)='urgent','urgent: refused');
select pg_temp.ok(pg_temp.approve(6,6)='not-ready','not finished: refused');
select pg_temp.ok(pg_temp.approve(7,7)='plan-active','plan active: refused');
select pg_temp.ok(pg_temp.approve(4,8,'{"textHy":"   "}')='invalid','both languages needed');
select pg_temp.ok(pg_temp.approve(4,8,'{"extra":1}')='invalid','unknown keys refused');
select pg_temp.ok(pg_temp.approve(4,8,'{"sources":["bad id!"]}')='invalid','source ids checked');
select pg_temp.ok(public.doctor_first_note_approve(pg_temp.cmd(4,8)-'assessmentRevision')->>'status'='invalid','the answers revision is required');
-- Audit B2-3: text prepared from other answers (another revision) is refused; nothing is saved.
select pg_temp.ok(pg_temp.approve(4,12,'{"assessmentRevision":1}')='stale','text from changed answers refused');
select pg_temp.ok(pg_temp.approve(4,8,'{"textEn":"Hello‮ there"}')='approved','approved');
select pg_temp.ok(pg_temp.approve(4,8)='approved'and(public.doctor_first_note_approve(pg_temp.cmd(4,8))->>'replayed')::boolean,'resend replays');
select pg_temp.ok(pg_temp.approve(4,9)='already','a second note is refused');
select pg_temp.ok((public.doctor_first_note_read('f1e00000-0000-4000-8000-000000000004')#>>'{note,textEn}')='Hello there','direction characters removed');
select pg_temp.ok(jsonb_array_length(public.doctor_first_note_queue()->'items')=0,'queue empty after approval');
reset role;
select pg_temp.ok(pg_temp.raises($q$update public.member_first_notes set text_en='changed'$q$,'55000'),'notes are insert only');
select pg_temp.ok(pg_temp.raises($q$delete from public.member_first_notes$q$,'55000'),'notes are kept');
select pg_temp.ok((select doctor_id='f1e00000-0000-4000-8000-000000000002'and assessment_completed_at is not null and sources=array['NRN-RULE-BP-002']from public.member_first_notes),'provenance recorded');

-- 4. The member reads their own note until a plan is active; another member sees nothing.
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.patient_first_note()->>'doctorName'='Synthetic Doctor Two'and public.patient_first_note()->>'textHy'='Բարև ձեզ։','member reads the note');
reset role;
select pg_temp.as_user(6);
set local role authenticated;
select pg_temp.ok(public.patient_first_note()is null,'another member sees nothing');
reset role;
insert into public.patient_care_plans(user_id,clinician,instructions)values('f1e00000-0000-4000-8000-000000000004','Synthetic Doctor Two','Synthetic plan');
select pg_temp.as_user(4);
set local role authenticated;
select pg_temp.ok(public.patient_first_note()is null,'hidden once a plan is active');
reset role;

-- 5. The approved note is also an app-only chat notice (Gohar's QA 4 Nov: V3 has no Home): once, in the screen language,
-- only when care notices are on, and the doctor's approval never depends on it.
update public.member_notice_settings set care=true where singleton;
update public.profiles set ui_locale='hy' where id='f1e00000-0000-4000-8000-000000000008';
insert into public.member_first_notes(user_id,doctor_id,submission_id,text_en,text_hy,builder_version,edited,assessment_completed_at)
 values('f1e00000-0000-4000-8000-000000000008','f1e00000-0000-4000-8000-000000000003',gen_random_uuid(),'Synthetic note in English','Սինթետիկ նշում','first-note-test',false,now()-interval '1 hour');
select pg_temp.ok((select count(*)=1 and bool_and(app_text='Ձեր բժշկի նշումը'||E'\n'||'Սինթետիկ նշում'and outcome='skipped'and telegram_message_id is null and notice_group='care')
 from public.member_notices where member_id='f1e00000-0000-4000-8000-000000000008'and event_key='first_note:f1e00000-0000-4000-8000-000000000008'),'the approved note is a chat notice in the member''s language, with no Telegram message');
select pg_temp.as_user(8);
set local role authenticated;
select pg_temp.ok((select jsonb_array_length(public.member_notices_read()->'notices')=1 and public.member_notices_read()#>>'{notices,0,text}' like 'Ձեր բժշկի նշումը%'),'the member reads it in the chat');
reset role;
-- Care notices off: no notice, and the approval still stands.
update public.member_notice_settings set care=false where singleton;
insert into public.member_first_notes(user_id,doctor_id,submission_id,text_en,text_hy,builder_version,edited,assessment_completed_at)
 values('f1e00000-0000-4000-8000-000000000005','f1e00000-0000-4000-8000-000000000002',gen_random_uuid(),'Synthetic note','Սինթետիկ','first-note-test',false,now()-interval '1 hour');
select pg_temp.ok(not exists(select 1 from public.member_notices where member_id='f1e00000-0000-4000-8000-000000000005')
 and exists(select 1 from public.member_first_notes where user_id='f1e00000-0000-4000-8000-000000000005'),'care notices off: no notice, the note is kept');
rollback;
\echo 'first note SQL checks passed'
