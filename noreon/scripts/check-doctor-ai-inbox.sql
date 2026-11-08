-- Doctor's four-lane inbox (doctor_ai_inbox): assigned doctor only, lane and rank order, P0 first and never
-- taken down by a failing AI source, closure follows the record, 10-minute access dedupe. Synthetic, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub','d1a00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','d1a00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::text,true)$$;
create function pg_temp.as_anon()returns void language sql as $$select set_config('request.jwt.claims','{"role":"anon"}',true)$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('d1a00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create temp table r(k text primary key,v jsonb);
grant all on r to authenticated,anon;
grant execute on all functions in schema pg_temp to authenticated,anon;
create function pg_temp.inbox(label text)returns jsonb language plpgsql as $$declare x jsonb;begin
 set local role authenticated;x:=public.doctor_ai_inbox();reset role;insert into r values(label,x)on conflict(k)do update set v=excluded.v;return x;end$$;
create function pg_temp.kinds(k text)returns text language sql as $$
 select string_agg(x->>'lane'||':'||(x->>'kind'),',' order by n)from r,jsonb_array_elements(r.v->'items')with ordinality e(x,n)where r.k=$1$$;
create function pg_temp.p0(k text)returns text language sql as $$
 select string_agg(x#>>'{alert,state}',',' order by n)from r,jsonb_array_elements(r.v->'p0')with ordinality e(x,n)where r.k=$1$$;

-- People: members 01 (doctor 11), 02 (doctor 12), 03 (doctor 11); doctors 11, 12; nurse 13; admin 14; clinic user 15.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990170'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,11,12,13,14,15])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select('d1a00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid,pg_temp.u(n),now()-interval '1 hour',now()
 from unnest(array[1,2,3,11,12,13,14,15])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic inbox clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Dr Inbox One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Inbox Two',pg_temp.u(20)),(pg_temp.u(13),'nurse','Nurse Inbox',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Inbox');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values(pg_temp.u(15),pg_temp.u(20),'Clinic Inbox');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.u(1),pg_temp.u(11)),(pg_temp.u(2),pg_temp.u(12)),(pg_temp.u(3),pg_temp.u(11));
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.u(13)where user_id=pg_temp.u(1);
update public.profiles set display_name='Inbox Member '||right(id::text,1)where id in(pg_temp.u(1),pg_temp.u(2),pg_temp.u(3));

-- 1. Grants and refusals: only a signed-in doctor; nurse, admin, clinic, member and anonymous are refused.
select pg_temp.ok(not has_function_privilege('anon','public.doctor_ai_inbox()','execute')and has_function_privilege('authenticated','public.doctor_ai_inbox()','execute'),'grants');
select pg_temp.as_user(13);select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'nurse refused');
select pg_temp.as_user(14);select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'admin refused');
select pg_temp.as_user(15);select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'clinic user refused');
select pg_temp.as_user(1);select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'member refused');
select pg_temp.as_anon();select pg_temp.ok(pg_temp.denied($$set local role anon;select public.doctor_ai_inbox()$$),'anonymous refused');
reset role;
-- A doctor whose session is not a managed staff session (no session id) is refused.
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(11),'role','authenticated')::text,true);
select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'doctor without a staff session refused');
-- 1b. Review probes (Astra, 19 Oct): inactive or removed doctor, inactive clinic, another user's session, an unknown session.
savepoint inactive;update public.workspace_staff set active=false where user_id=pg_temp.u(11);select pg_temp.as_user(11);
select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'inactive doctor refused');rollback to inactive;
savepoint removed;update public.workspace_staff set removed_at=now(),active=false where user_id=pg_temp.u(11);select pg_temp.as_user(11);
select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'removed doctor refused');rollback to removed;
savepoint clinic;update public.workspace_clinics set active=false where id=pg_temp.u(20);select pg_temp.as_user(11);
select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'doctor of an inactive clinic refused');rollback to clinic;
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(11),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','d1a00000-0000-4000-8000-000000000112')::text,true);
select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'another user''s session refused');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(11),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',gen_random_uuid())::text,true);
select pg_temp.ok(pg_temp.denied($$select pg_temp.inbox('x')$$),'unknown session refused');
reset role;
-- An empty inbox reads fine.
select pg_temp.as_user(11);
select pg_temp.inbox('empty');
select pg_temp.ok((select(v->>'ok')::boolean and v->'items'='[]'and v->'p0'='[]'from r where k='empty'),'empty inbox');

-- 2. Fixtures (triggers off: these are the records the real flows write).
set local session_replication_role=replica;
insert into public.care_alerts(id,member_id,source,reason_code,red_flags,rule_id,rule_version,source_ref,doctor_id,state,acknowledged_by,acknowledged_at,created_at)values
 (pg_temp.u(40),pg_temp.u(1),'lab','lab_result_critical','{}','care_alert.critical_lab','v1','lab-1',pg_temp.u(11),'acknowledged',pg_temp.u(11),now()-interval '3 hours',now()-interval '5 hours'),
 (pg_temp.u(41),pg_temp.u(1),'questionnaire','questionnaire_red_flag','{RF-03}','clinical.red_flag','v1','assessment-1',pg_temp.u(11),'open',null,null,now()-interval '1 hour'),
 (pg_temp.u(42),pg_temp.u(2),'questionnaire','questionnaire_red_flag','{RF-01}','clinical.red_flag','v1','assessment-2',pg_temp.u(12),'open',null,null,now()-interval '1 hour');
-- Lab: file 50 has a lab-critical value (P1), file 60 only unflagged values (P2).
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)values(pg_temp.u(45),pg_temp.u(1),pg_temp.u(13),'Nurse Inbox','nurse',pg_temp.u(20));
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state)
 select pg_temp.u(n),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),pg_temp.u(11),gen_random_uuid(),'[]',now(),gen_random_uuid(),1,gen_random_uuid(),'SYNTHETIC.pdf','application/pdf',1000,repeat('a',64),'synthetic/'||n,gen_random_uuid(),1000,repeat('a',64),'stored'
 from unnest(array[50,60])n;
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
 select pg_temp.u(n+1),pg_temp.u(n),pg_temp.u(20),pg_temp.u(1),pg_temp.u(45),'noreon-admin',pg_temp.u(11),gen_random_uuid()from unnest(array[50,60])n;
insert into public.lab_ai_jobs(id,attachment_id,file_id,user_id,state,identity_status,outcome,finished_at)
 select pg_temp.u(n+2),pg_temp.u(n+1),pg_temp.u(n),pg_temp.u(1),'done','match','extracted',now()from unnest(array[50,60])n;
insert into public.lab_ai_values(id,job_id,user_id,file_id,attachment_id,seq,test_name,catalogue_ref,value_text,value,unit,page,status,attention,attention_rule,lab_flag,created_at)values
 (pg_temp.u(54),pg_temp.u(52),pg_temp.u(1),pg_temp.u(50),pg_temp.u(51),1,'Potassium','potassium','6.4',6.4,'mmol/l',1,'unverified','lab_critical','lab.critical','critical',now()-interval '6 hours'),
 (pg_temp.u(55),pg_temp.u(52),pg_temp.u(1),pg_temp.u(50),pg_temp.u(51),2,'Sodium','sodium','140',140,'mmol/l',1,'unverified',null,null,'normal',now()-interval '6 hours'),
 (pg_temp.u(64),pg_temp.u(62),pg_temp.u(1),pg_temp.u(60),pg_temp.u(61),1,'LDL-C','ldl_c','2.1',2.1,'mmol/l',1,'unverified',null,null,'normal',now()-interval '30 hours');
-- Programme: a "worse" check-in on an open week-4 review (P1) and a month-3 review due in 2 days (P2).
insert into public.programme_settings(singleton,enabled)values(true,true)on conflict(singleton)do update set enabled=true;
insert into public.programme_checkpoints(id,member_id,kind,anchor_plan_id,anchor_at,due_on,state,opened_at)values
 (pg_temp.u(70),pg_temp.u(1),'week4_review',gen_random_uuid(),now()-interval '30 days',public._programme_today(now())-1,'open',now()-interval '1 day'),
 (pg_temp.u(71),pg_temp.u(1),'month3',gen_random_uuid(),now()-interval '30 days',public._programme_today(now())+2,'scheduled',null);
insert into public.programme_checkins(id,checkpoint_id,member_id,feeling,medicines,submission_id,submitted_at)values(pg_temp.u(72),pg_temp.u(70),pg_temp.u(1),'worse','all',gen_random_uuid(),now()-interval '4 hours');
-- AI care plan draft ready and not adopted (P2).
update public.ai_plan_capabilities set enabled=true;
insert into public.ai_plan_generations(id,user_id,doctor_id,case_revision,evidence_token,lab_token,input_sha256,prompt_version,builder_version,language,tier,model,local,spend_day,estimate_usd,reserved,state,mode,draft,items,finished_at,created_at)values
 (pg_temp.u(75),pg_temp.u(1),pg_temp.u(11),0,repeat('a',32),public._ai_plan_lab_token(pg_temp.u(1)),repeat('b',64),'ai-plan-prompt-3','ai-plan-builder-2','en','high','noreon-protocol-1',true,current_date,0,true,'ready','model',
  '{"explanation":"Synthetic."}','[]',now(),now()-interval '2 hours');
-- Conversations: member 01 waiting 30 hours with a pending draft (P1), member 03 waiting 1 hour without one (P3).
insert into public.conversations(id,member_id,version)values(pg_temp.u(80),pg_temp.u(1),1),(pg_temp.u(81),pg_temp.u(3),1);
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)values
 (pg_temp.u(80),1,pg_temp.u(1),'Synthetic question','authenticated_member',gen_random_uuid(),now()-interval '30 hours'),
 (pg_temp.u(81),1,pg_temp.u(3),'Synthetic question','authenticated_member',gen_random_uuid(),now()-interval '1 hour');
insert into public.conversation_drafts(id,conversation_id,state,context_version,clinical_revision,source_token,created_at)values(pg_temp.u(82),pg_temp.u(80),'pending',1,0,'synthetic',now()-interval '29 hours');
-- A finished symptom intake on member 01's conversation, not yet answered (P1).
insert into public.zoe_symptom_intakes(id,conversation_id,member_id,sheet_id,sheet_version,state,language,started_seq,last_seq,record,summary,ending,finished_at,updated_at)values
 (pg_temp.u(85),pg_temp.u(80),pg_temp.u(1),'headache',1,'completed','en',1,1,'{}','{"redFlags":{"hits":[]}}','complete',now()-interval '29 hours',now()-interval '29 hours');
set local session_replication_role=origin;

-- 3. Doctor 11: P0 open before acknowledged; then P1, P2, P3, each by risk then age.
select pg_temp.as_user(11);select pg_temp.inbox('d11');
select pg_temp.ok(pg_temp.p0('d11')='open,acknowledged','P0: open alert before the older acknowledged one');
select pg_temp.ok((select(v->>'p0Total')::int=2 from r where k='d11'),'P0 total');
select pg_temp.ok(pg_temp.kinds('d11')='P1:lab_attention,P1:checkin_worse,P1:intake,P1:reply_overdue,P2:plan_draft,P2:checkpoint_due,P2:lab_sheet,P3:reply_draft','lane and rank order: '||coalesce(pg_temp.kinds('d11'),'none'));
select pg_temp.ok((select bool_and(x->>'confidence'='rule'and x->>'ai'='none')from r,jsonb_array_elements(r.v->'p0')x where k='d11'),'P0 has no AI part');
select pg_temp.ok((select x->>'confidence'='L'and x->>'ai'='none'from r,jsonb_array_elements(r.v->'items')x where k='d11'and x->>'kind'='reply_draft'),'reply without a draft is low confidence');
-- The fixture draft's clinical context is not the member's current one (20261019075018: a stale draft is low and carries stale=true).
select pg_temp.ok((select x->>'confidence'='L'and x->>'ai'='draft'and x#>>'{draft,stale}'='true'and x#>>'{draft,approvable}'='false'from r,jsonb_array_elements(r.v->'items')x where k='d11'and x->>'kind'='reply_overdue'),'reply with a stale pending draft is low');
select pg_temp.ok((select(x->>'critical')::int=1 and(x->>'toReview')::int=2 and x->'sources'@>'[{"type":"lab_value","rule":"lab.critical"}]'from r,jsonb_array_elements(r.v->'items')x where k='d11'and x->>'kind'='lab_attention'),'lab item carries counts and the value source');
select pg_temp.ok((select(x->>'stale')::boolean=false from r,jsonb_array_elements(r.v->'items')x where k='d11'and x->>'kind'='plan_draft'),'plan draft current');
select pg_temp.ok(not exists(select 1 from r,jsonb_array_elements(r.v->'p0'||r.v->'items')x where k='d11'and(x->>'memberId')::uuid=pg_temp.u(2)),'doctor 11 never sees member 02');
select pg_temp.ok((select count(*)=2 and count(distinct member_id)=2 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_inbox'and member_id in(pg_temp.u(1),pg_temp.u(3))),'one access record per member shown');
select pg_temp.ok(not exists(select 1 from public.access_audit where actor_id=pg_temp.u(11)and member_id=pg_temp.u(2)),'no record for a member not shown');

-- A 9-minute-old audit must still suppress polling without extending the window.
-- Backdating is fixture-only: bypass the immutable-audit trigger inside this rollback.
set local session_replication_role=replica;
update public.access_audit set at=clock_timestamp()-interval '9 minutes'
 where actor_id=pg_temp.u(11)and surface='doctor_inbox'and member_id=pg_temp.u(1);
set local session_replication_role=origin;
create temp table inbox_audit_before_poll as select * from public.access_audit;
-- Polls inside 10 minutes after the required access record must do no database writes.
-- A write-rejecting trigger catches inserts/updates/deletes even if counts would
-- hide them. Access audits are already append-only. No statistics timing needed.
create function pg_temp.inbox_no_write()returns trigger language plpgsql as $$begin
 raise exception 'Repeated inbox read attempted a write to %',tg_table_name;end$$;
do $$declare t record;begin
 for t in select c.oid::regclass relation from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'loop
  execute format('create trigger inbox_poll_no_write before insert or update or delete on %s for each statement execute function pg_temp.inbox_no_write()',t.relation);
 end loop;
end$$;
-- PostgreSQL also rejects row locks/writes in this mode; temporary result
-- storage remains allowed. This covers dirtying reads beyond audit inserts.
savepoint inbox_readonly_poll;
set local transaction_read_only=on;
select pg_temp.inbox('d11-repeat');
select pg_temp.inbox('d11-repeat-2');
select pg_temp.ok((select (a.v-'asOf')=(b.v-'asOf')from r a,r b where a.k='d11'and b.k='d11-repeat'),
 'Repeated inbox read preserves clinical data and order');
select pg_temp.ok((select count(*)=2 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_inbox'),
 'Repeated inbox reads inside 10 minutes add no audit rows');
select pg_temp.ok(not exists((table public.access_audit except table inbox_audit_before_poll)
 union all(table inbox_audit_before_poll except table public.access_audit)),
 'Polling leaves every audit row and timestamp unchanged');
-- Rolling back the savepoint restores read-write mode and discards only the
-- temporary probe results. Switching directly to READ WRITE is too late here.
rollback to savepoint inbox_readonly_poll;
release savepoint inbox_readonly_poll;
do $$declare t record;begin
 for t in select c.oid::regclass relation from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r'loop
  execute format('drop trigger inbox_poll_no_write on %s',t.relation);
 end loop;
end$$;
-- Expiry is per member and uses elapsed time, even on the same UTC day.
-- The other member still has a recent audit; only the expired member gets a row.
set local session_replication_role=replica;
update public.access_audit set at=clock_timestamp()-interval '10 minutes'
 where actor_id=pg_temp.u(11)and surface='doctor_inbox'and member_id=pg_temp.u(1);
set local session_replication_role=origin;
select pg_temp.inbox('d11-expired');select pg_temp.inbox('d11-expired-repeat');
select pg_temp.ok((select count(*)=2 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_inbox'and member_id=pg_temp.u(1))
 and(select count(*)=1 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_inbox'and member_id=pg_temp.u(3)),
 'A read at least 10 minutes later adds one row only for the expired member, then deduplicates');

-- A different authenticated session records both members despite recent reads.
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1a00000-0000-4000-8000-000000000211',pg_temp.u(11),now(),now());
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('session_id','d1a00000-0000-4000-8000-000000000211'))::text,true);
select pg_temp.inbox('d11-new-session');select pg_temp.inbox('d11-new-session-repeat');
select pg_temp.ok((select count(*)=5 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_inbox')
 and(select count(*)=2 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_inbox'and session_id='d1a00000-0000-4000-8000-000000000211'),
 'A different session records each shown member immediately, then deduplicates');
-- Returning to the original session must find its most recent row, not its old one.
select pg_temp.as_user(11);select pg_temp.inbox('d11-original-session');
select pg_temp.ok((select count(*)=5 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_inbox'),
 'The most recent audit controls dedupe when older rows also exist');
select pg_temp.ok((select provolatile='v'and prosecdef and proconfig=array['search_path=""']from pg_proc where oid='public.doctor_ai_inbox()'::regprocedure),
 'Auditing inbox remains volatile, definer and empty-search-path');

-- Opening the same member as a newly assigned doctor records that doctor's access.
savepoint inbox_other_doctor;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.u(12)where user_id=pg_temp.u(1);
select pg_temp.as_user(12);select pg_temp.inbox('d12-reassigned');select pg_temp.inbox('d12-reassigned-repeat');
select pg_temp.ok((select count(*)=1 from public.access_audit where actor_id=pg_temp.u(12)and member_id=pg_temp.u(1)and surface='doctor_inbox'),
 'A different doctor records access to the same member despite the first doctor''s recent reads');
rollback to savepoint inbox_other_doctor;release savepoint inbox_other_doctor;

-- A newly shown member records access within the same doctor/session window.
savepoint inbox_other_member;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.u(11)where user_id=pg_temp.u(2);
select pg_temp.inbox('d11-another-member');select pg_temp.inbox('d11-another-member-repeat');
select pg_temp.ok((select count(*)=1 from public.access_audit where actor_id=pg_temp.u(11)and member_id=pg_temp.u(2)and surface='doctor_inbox')
 and(select count(*)=6 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_inbox'),
 'A different member records access immediately without rewriting the already shown members');
rollback to savepoint inbox_other_member;release savepoint inbox_other_member;

-- 4. A non-assigned doctor sees only their own member.
select pg_temp.as_user(12);select pg_temp.inbox('d12');
select pg_temp.ok((select jsonb_array_length(v->'p0')=1 and v#>>'{p0,0,memberId}'=pg_temp.u(2)::text and v->'items'='[]'from r where k='d12'),'doctor 12 sees only member 02');

-- 5. A failing AI source is reported and P0 still arrives.
alter table public.ai_plan_generations rename to ai_plan_generations_off;
select pg_temp.as_user(11);select pg_temp.inbox('fault');
select pg_temp.ok((select v->'unavailable'='["plan"]'and jsonb_array_length(v->'p0')=2 from r where k='fault'),'plan source down: P0 intact, plan listed unavailable');
select pg_temp.ok(pg_temp.kinds('fault')not like '%plan_draft%','no plan item while its source is down');
alter table public.ai_plan_generations_off rename to ai_plan_generations;

-- 6. Closure follows the record (written as the doctor actions write it; triggers off). Resolving removes the
-- alert; acknowledging keeps it.
set local session_replication_role=replica;
update public.care_alerts set state='resolved',resolved_by=pg_temp.u(11),resolved_at=now(),resolution='member_contacted',acknowledged_by=pg_temp.u(11),acknowledged_at=now()where id=pg_temp.u(41);
-- Reviewing the critical value leaves the unflagged one: the file drops to P2 as a lab sheet.
update public.lab_ai_values set status='verified',reviewed_by=pg_temp.u(11),reviewed_at=now()where id=pg_temp.u(54);
-- Approving a reply covering message 1 closes the overdue reply and the intake.
insert into public.conversation_drafts(conversation_id,state,context_version,clinical_revision,source_token)values(pg_temp.u(80),'approved',1,0,'synthetic');
update public.conversation_drafts set state='superseded'where id=pg_temp.u(82);
-- Completing the week-4 review closes the "worse" item; a newer published plan closes the draft.
update public.programme_checkpoints set state='completed',completed_at=now(),completed_by=pg_temp.u(11),outcome='confirmed'where id=pg_temp.u(70);
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at)
 values(pg_temp.u(1),gen_random_uuid(),gen_random_uuid(),pg_temp.u(11),1,repeat('c',32),'{}','{}','{}',now());
set local session_replication_role=origin;
select pg_temp.inbox('closed');
select pg_temp.ok(pg_temp.p0('closed')='acknowledged','resolved alert gone, acknowledged stays');
select pg_temp.ok(pg_temp.kinds('closed')='P2:checkpoint_due,P2:lab_sheet,P2:lab_sheet,P3:reply_draft','closed items gone: '||coalesce(pg_temp.kinds('closed'),'none'));

-- 7. Only a decision closes a reply item (review DI-01, DI-02). Member 04: the last reply failed 31 days ago. Member 05:
-- after an answered message, only a photo (no stored message row) 30 hours ago.
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.u(4),'37499017004',now()),(pg_temp.u(5),'37499017005',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.u(4),pg_temp.u(11)),(pg_temp.u(5),pg_temp.u(11));
set local session_replication_role=replica;
insert into public.conversations(id,member_id,version)values(pg_temp.u(90),pg_temp.u(4),1),(pg_temp.u(91),pg_temp.u(5),2);
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id,created_at)values
 (pg_temp.u(90),1,pg_temp.u(4),'Synthetic question','authenticated_member',gen_random_uuid(),now()-interval '32 days'),
 (pg_temp.u(91),1,pg_temp.u(5),'Synthetic question','authenticated_member',gen_random_uuid(),now()-interval '3 days');
insert into public.conversation_drafts(conversation_id,state,context_version,clinical_revision,source_token,created_at)values
 (pg_temp.u(90),'approved',1,0,'synthetic',now()-interval '31 days'),(pg_temp.u(91),'approved',1,0,'synthetic',now()-interval '3 days');
insert into public.conversation_deliveries(conversation_id,approval_id,state,reason,created_at)values(pg_temp.u(90),gen_random_uuid(),'definitely_failed','provider_rejected',now()-interval '31 days');
insert into public.conversation_audit(conversation_id,kind,detail,created_at)values(pg_temp.u(91),'message.media','{"version":2}',now()-interval '30 hours');
set local session_replication_role=origin;
select pg_temp.as_user(11);select pg_temp.inbox('decisions');
select pg_temp.ok(pg_temp.kinds('decisions')='P1:reply_overdue,P1:reply_not_delivered,P2:checkpoint_due,P2:lab_sheet,P2:lab_sheet,P3:reply_draft','old failure and media-only wait stay until decided: '||coalesce(pg_temp.kinds('decisions'),'none'));
set local session_replication_role=replica;
insert into public.conversation_drafts(conversation_id,state,context_version,clinical_revision,source_token)values(pg_temp.u(90),'rejected',1,0,'synthetic'),(pg_temp.u(91),'approved',2,0,'synthetic');
set local session_replication_role=origin;
select pg_temp.inbox('decided');
select pg_temp.ok(pg_temp.kinds('decided')='P2:checkpoint_due,P2:lab_sheet,P2:lab_sheet,P3:reply_draft','rejection and approval close them: '||coalesce(pg_temp.kinds('decided'),'none'));

rollback;
