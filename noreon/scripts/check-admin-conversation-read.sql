-- Admin conversation reading: only an active admin with a live session reads, only while the switch is
-- on, every read is recorded, and the doctor functions are not widened. Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create function pg_temp.refused(sql text)returns text language plpgsql as $$begin execute sql;return 'ran';exception when others then return sqlstate;end$$;
grant execute on function pg_temp.denied(text),pg_temp.refused(text)to authenticated,anon;
create function pg_temp.reads(m uuid,a uuid)returns bigint language sql as $$select count(*)from public.access_audit where member_id is not distinct from m and actor_id=a and surface='conversation.read.admin'$$;

-- Member M (doctor D), admin A, removed admin R, inactive admin I, nurse N, clinic user C.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('ad000000-0000-4000-8000-000000000001','37499018001',now()),
 ('ad000000-0000-4000-8000-000000000011',null,null),('ad000000-0000-4000-8000-000000000012',null,null),('ad000000-0000-4000-8000-000000000013',null,null),
 ('ad000000-0000-4000-8000-000000000014',null,null),('ad000000-0000-4000-8000-000000000015',null,null),('ad000000-0000-4000-8000-000000000016',null,null);
insert into public.workspace_clinics(id,name)values('ad000000-0000-4000-8000-000000000020','Synthetic oversight clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active,removed_at)values
 ('ad000000-0000-4000-8000-000000000011','doctor','Dr Oversight','ad000000-0000-4000-8000-000000000020',true,null),
 ('ad000000-0000-4000-8000-000000000015','nurse','Nurse Oversight','ad000000-0000-4000-8000-000000000020',true,null),
 ('ad000000-0000-4000-8000-000000000012',  'admin','Admin Oversight',null,true,null),
 ('ad000000-0000-4000-8000-000000000013','admin','Removed Admin',null,false,now()),
 ('ad000000-0000-4000-8000-000000000014','admin','Inactive Admin',null,false,null);
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('ad000000-0000-4000-8000-000000000016','ad000000-0000-4000-8000-000000000020','Clinic Desk');
insert into auth.sessions(id,user_id,created_at,updated_at)select ('ad000000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,('ad000000-0000-4000-8000-0000000000'||lpad((n-20)::text,2,'0'))::uuid,now(),now()
 from unnest(array[21,31,32,33,34,35,36])n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000011');
update public.profiles set display_name='Oversight Member' where id='ad000000-0000-4000-8000-000000000001';
insert into public.conversations(id,member_id)values('ad000000-0000-4000-8000-000000000040','ad000000-0000-4000-8000-000000000001');
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values
 ('ad000000-0000-4000-8000-000000000040',1,'ad000000-0000-4000-8000-000000000001','Synthetic app words','authenticated_member',gen_random_uuid()),
 ('ad000000-0000-4000-8000-000000000040',2,'ad000000-0000-4000-8000-000000000001','Synthetic Telegram words','telegram_member',gen_random_uuid());
update public.conversations set version=2 where id='ad000000-0000-4000-8000-000000000040';
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at,summary)values
 ('ad000000-0000-4000-8000-000000000050','ad000000-0000-4000-8000-000000000040','ad000000-0000-4000-8000-000000000001',2,2,0,current_date,'finished','intake_escalated','red_flag',now(),'Synthetic summary');
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)values
 ('ad000000-0000-4000-8000-000000000040','ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000050',2,'Synthetic urgent advice','en','openai','gpt-test','urgent');
insert into public.conversation_drafts(id,conversation_id,state,context_version,clinical_revision,source_token)values
 ('ad000000-0000-4000-8000-000000000060','ad000000-0000-4000-8000-000000000040','pending',2,1,'synthetic');
insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)values
 ('ad000000-0000-4000-8000-000000000060',1,'Synthetic draft reply','Synthetic draft summary','x','ad000000-0000-4000-8000-000000000011','ai_assistant','{}');

-- 1. Grants: anon cannot reach the functions; the switch table is closed to every client role.
select pg_temp.ok(not has_function_privilege('anon','public.admin_conversation_read(uuid,timestamptz)','execute')
 and not has_function_privilege('anon','public.admin_conversation_list(text)','execute')
 and not has_function_privilege('anon','public.admin_conversation_read_enabled()','execute')
 and not has_function_privilege('authenticated','public._admin_conversation_read_on()','execute')
 and has_function_privilege('authenticated','public.admin_conversation_read(uuid,timestamptz)','execute'),'Function grants');
select pg_temp.ok(not has_table_privilege(r,'public.admin_oversight_settings',p),format('%s has no %s on the switch',r,p))
 from unnest(array['anon','authenticated','service_role'])r,unnest(array['select','insert','update','delete'])p;
select pg_temp.ok((select prosecdef and proconfig=array['search_path=""']from pg_proc where oid='public.admin_conversation_read(uuid,timestamptz)'::regprocedure),'Definer with empty search_path');
set local role anon;
select pg_temp.ok(pg_temp.denied($q$select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')$q$),'Anon refused');
reset role;

-- 2. Switch off (the default): the admin gets "disabled", nothing is recorded, the link is hidden.
select pg_temp.ok((select not admin_conversation_read_enabled from public.admin_oversight_settings),'Switch defaults to off');
select pg_temp.as_user('ad000000-0000-4000-8000-000000000012','ad000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')->>'code'='disabled','Off: admin read disabled');
select pg_temp.ok((public.admin_conversation_list()->>'enabled')='false','Off: list disabled');
select pg_temp.ok(public.admin_conversation_read_enabled() is false,'Off: link hidden');
reset role;
select pg_temp.ok(pg_temp.reads('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000012')=0,'Off: nothing recorded');
update public.admin_oversight_settings set admin_conversation_read_enabled=true;
select pg_temp.ok(exists(select 1 from public.config_audit where table_name='admin_oversight_settings'and changed ? 'admin_conversation_read_enabled'),'Switch change recorded in config_audit');

-- 3. Admin reads everything, and the read is recorded once with no content.
select pg_temp.as_user('ad000000-0000-4000-8000-000000000012','ad000000-0000-4000-8000-000000000032');set local role authenticated;
create temp table r as select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')v;
select pg_temp.ok((select v->>'ok'='true'and jsonb_array_length(v->'messages')=2 and v#>>'{messages,1,channel}'='telegram'and v#>>'{messages,0,channel}'='app'from r),'Admin reads app and Telegram messages');
select pg_temp.ok((select v#>>'{zoeAnswers,0,kind}'='urgent'and v#>>'{zoeAnswers,0,text}'='Synthetic urgent advice'from r),'Admin reads Zoe answers with their kind');
select pg_temp.ok((select v#>>'{drafts,0,state}'='pending'and v#>>'{drafts,0,latest,text}'='Synthetic draft reply'from r),'Admin reads drafts and their state');
select pg_temp.ok((select v#>>'{zoeRuns,0,outcome}'='intake_escalated'and v->>'doctorName'='Dr Oversight'and jsonb_typeof(v->'trace')='array'and jsonb_typeof(v->'intakes')='array'from r),'Admin reads runs, intakes and trace');
select pg_temp.ok(public.admin_conversation_read_enabled(),'On: link shown to the admin');
select pg_temp.ok((select i->>'urgentToday'='true'and i->>'needsReply'='true'and i->>'channel'='telegram'and not i ? 'text'
 from jsonb_array_elements(public.admin_conversation_list()->'items')i where i->>'memberId'='ad000000-0000-4000-8000-000000000001'),'List flags, no text');
select pg_temp.ok(jsonb_array_length(public.admin_conversation_list('urgent_today')->'items')>=1 and
 not exists(select 1 from jsonb_array_elements(public.admin_conversation_list('intake_active')->'items')i where i->>'memberId'='ad000000-0000-4000-8000-000000000001'),'Filters apply');
select pg_temp.ok(pg_temp.denied('select 1 from public.access_audit'),'Admin still cannot read the audit table directly');
reset role;
select pg_temp.ok(pg_temp.reads('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000012')=1,'One audit row for one open');
select pg_temp.ok((select actor_role='admin'and object_id is null and session_id='ad000000-0000-4000-8000-000000000032'from public.access_audit
 where surface='conversation.read.admin'and actor_id='ad000000-0000-4000-8000-000000000012'),'Audit row: admin, member, session, no content');
select pg_temp.ok(exists(select 1 from public.access_audit where surface='conversation.list.admin'and actor_id='ad000000-0000-4000-8000-000000000012'and member_id is null),'List open recorded');
select pg_temp.as_user('ad000000-0000-4000-8000-000000000012','ad000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.admin_audit_log(p_member=>'ad000000-0000-4000-8000-000000000001')->'rows')x
 where x->>'action'='conversation.read.admin'and x->>'category'='record_access'and x->>'actorName'='Admin Oversight'),'Read shown in the activity log');
reset role;

-- 4. Nobody else can use the admin functions; refused calls record nothing.
select pg_temp.as_user('ad000000-0000-4000-8000-000000000011','ad000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')$q$),'Assigned doctor refused');
select pg_temp.ok(pg_temp.denied('select public.admin_conversation_list()'),'Doctor refused the list');
select pg_temp.ok(public.admin_conversation_read_enabled() is false,'Doctor: no link');
reset role;
select pg_temp.as_user('ad000000-0000-4000-8000-000000000015','ad000000-0000-4000-8000-000000000035');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')$q$),'Nurse refused');
reset role;
select pg_temp.as_user('ad000000-0000-4000-8000-000000000016','ad000000-0000-4000-8000-000000000036');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')$q$),'Clinic user refused');
reset role;
select pg_temp.as_user('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000021');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')$q$),'Member refused, own conversation too');
reset role;
select pg_temp.as_user('ad000000-0000-4000-8000-000000000013','ad000000-0000-4000-8000-000000000033');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')$q$),'Removed admin refused');
select pg_temp.ok(public.admin_conversation_read_enabled() is false,'Removed admin: no link');
reset role;
select pg_temp.as_user('ad000000-0000-4000-8000-000000000014','ad000000-0000-4000-8000-000000000034');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')$q$),'Inactive admin refused');
reset role;
-- An admin without a live session (expired or foreign session id) is refused too.
select pg_temp.as_user('ad000000-0000-4000-8000-000000000012','ad000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.admin_conversation_read('ad000000-0000-4000-8000-000000000001')$q$),'Admin with another user''s session refused');
reset role;
select pg_temp.ok((select count(*)from public.access_audit where surface='conversation.read.admin'and member_id='ad000000-0000-4000-8000-000000000001')=1,'Refused calls recorded nothing');

-- 4b. Paging (review F1): a long conversation is read in consistent windows, and older pages are recorded too.
reset role;
insert into auth.users(id,phone,phone_confirmed_at)values('ad000000-0000-4000-8000-000000000002','37499018002',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('ad000000-0000-4000-8000-000000000002',null);
insert into public.conversations(id,member_id)values('ad000000-0000-4000-8000-000000000041','ad000000-0000-4000-8000-000000000002');
-- 205 messages a minute apart; Zoe answered message 3 (an old, held answer).
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)
 select 'ad000000-0000-4000-8000-000000000041',g,'ad000000-0000-4000-8000-000000000002','Synthetic paged '||g,'telegram_member',gen_random_uuid(),now()-interval '1 day'+g*interval '1 minute'from generate_series(1,205)g;
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)values
 ('ad000000-0000-4000-8000-000000000051','ad000000-0000-4000-8000-000000000041','ad000000-0000-4000-8000-000000000002',3,3,0,current_date,'finished','answered','logistics',now()-interval '1 day'+interval '3 minutes 10 seconds');
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,created_at)values
 ('ad000000-0000-4000-8000-000000000041','ad000000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-000000000051',3,'Synthetic old answer','en','openai','gpt-test',now()-interval '1 day'+interval '3 minutes 10 seconds');
-- A late urgent answer to message 5, written after message 6 (the urgent path skips the newer-message guard).
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)values
 ('ad000000-0000-4000-8000-000000000052','ad000000-0000-4000-8000-000000000041','ad000000-0000-4000-8000-000000000002',5,5,0,current_date,'finished','intake_escalated','red_flag',now()-interval '1 day'+interval '6 minutes 30 seconds');
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)values
 ('ad000000-0000-4000-8000-000000000041','ad000000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-000000000052',5,'Synthetic late urgent answer','en','openai','gpt-test','urgent',now()-interval '1 day'+interval '6 minutes 30 seconds');
select pg_temp.as_user('ad000000-0000-4000-8000-000000000012','ad000000-0000-4000-8000-000000000032');set local role authenticated;
create temp table p1 as select public.admin_conversation_read('ad000000-0000-4000-8000-000000000002')v;
select pg_temp.ok((select jsonb_array_length(v->'messages')=200 and(v#>>'{messages,0,seq}')::int=6 and v#>>'{window,olderBefore}' is not null and jsonb_array_length(v->'zoeAnswers')=0 from p1),'Newest window: 200 messages, cursor, no answer from an older message');
create temp table p2 as select public.admin_conversation_read('ad000000-0000-4000-8000-000000000002',(select (v#>>'{window,olderBefore}')::timestamptz from p1))v;
select pg_temp.ok((select jsonb_array_length(v->'messages')=5 and v#>>'{window,olderBefore}' is null and jsonb_array_length(v->'zoeAnswers')=2 and v#>>'{zoeAnswers,0,text}'='Synthetic old answer'
 and exists(select 1 from jsonb_array_elements(v->'zoeAnswers')x where x->>'text'='Synthetic late urgent answer'and(x->>'messageSeq')::int=5)
 and(v#>>'{messages,4,seq}')::int=5 from p2),'Older window: the rest, with both answers (the late one too), and no further cursor');
reset role;
select pg_temp.ok((select count(*)=2 and count(*)filter(where object_id like 'before=%')=1 from public.access_audit where surface='conversation.read.admin'and member_id='ad000000-0000-4000-8000-000000000002'),'Each page recorded; the older page names its cursor');

-- 5. The doctor functions are not widened: an admin still cannot use them.
select pg_temp.as_user('ad000000-0000-4000-8000-000000000012','ad000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.zoe_runs_for_doctor('ad000000-0000-4000-8000-000000000001')$q$),'Admin still refused zoe_runs_for_doctor');
select pg_temp.ok(pg_temp.denied($q$select public.zoe_symptom_intakes_for_doctor('ad000000-0000-4000-8000-000000000001')$q$),'Admin still refused zoe_symptom_intakes_for_doctor');
select pg_temp.ok(pg_temp.refused($q$select public.conversation_actions('ad000000-0000-4000-8000-000000000001')$q$)<>'ran','Admin still refused conversation_actions');
select pg_temp.ok(pg_temp.refused($q$select public.conversation_workspace('ad000000-0000-4000-8000-000000000001')$q$)<>'ran','Admin still refused the doctor workspace');
-- A member without a case is not found and not recorded.
select pg_temp.ok(public.admin_conversation_read('ad000000-0000-4000-8000-0000000000ff')->>'code'='not_found','Unknown member not found');
reset role;
select pg_temp.ok(not exists(select 1 from public.access_audit where member_id='ad000000-0000-4000-8000-0000000000ff'),'Unknown member not recorded');
rollback;
\echo 'admin conversation read: all checks passed'
