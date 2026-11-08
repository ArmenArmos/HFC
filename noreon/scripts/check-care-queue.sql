-- Care queue tasks: nothing reachable except through functions, routing by role and assignment, the
-- admin never gets clinical content, replay does not double, forward-only marks, stale marks
-- refused, sandbox rows hidden from the live view, append-only events, and the test-account switch
-- on staff notices. Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_member(m text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);end$$;
create function pg_temp.has(m uuid,n text,o text,r text)returns boolean language sql as $$
 select exists(select 1 from public.conversation_trace_events where member_id=m and name=n and outcome=o and reason_code=r)$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

-- Runs one statement under a role and says what happened: 'denied' or the JSON it returned.
create function pg_temp.call(r text,q text)returns jsonb language plpgsql as $$
declare j jsonb;
begin
 execute format('set local role %I',r);
 begin execute 'select ('||q||')::jsonb' into j;
 exception when insufficient_privilege then reset role;return '"denied"'::jsonb;end;
 reset role;return j;
end$$;
create function pg_temp.raise(m text,q text,z text,src text,summary jsonb default '{}',sla timestamptz default now()+interval '4 hours',reason text default 'bp_orange',flags text default null,action text default null)returns jsonb language plpgsql as $$
declare j jsonb;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
 j:=public.care_queue_raise(m::uuid,q,z,reason,'zones-v1-test',flags,action,summary,sla,src);reset role;return j;
end$$;
create function pg_temp.inbox(u text,sid text,q text,v text default 'live')returns jsonb language plpgsql as $$begin
 perform pg_temp.as_staff(u,sid);return pg_temp.call('authenticated',format('public.care_queue_inbox(%L,%L)',q,v));end$$;
create function pg_temp.mark(u text,sid text,task text,seq bigint,dest text)returns jsonb language plpgsql as $$begin
 perform pg_temp.as_staff(u,sid);return pg_temp.call('authenticated',format('public.care_queue_mark(%L::uuid,%s,%L)',task,seq,dest));end$$;
create function pg_temp.ids(j jsonb)returns text[] language sql as $$select coalesce(array_agg(e->>'id' order by e->>'id'),'{}')from jsonb_array_elements(j->'tasks')e$$;

-- Members M1 (N1, D1), M2 (N2, D2), M3 (test account, N1, D1). Nurses N1, N2, doctors D1, D2, admin A.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c0000000-0000-4000-8000-000000000001','37499017001',now()),('c0000000-0000-4000-8000-000000000002','37499017002',now()),('c0000000-0000-4000-8000-000000000003','37499017003',now()),
 ('c0000000-0000-4000-8000-000000000011',null,null),('c0000000-0000-4000-8000-000000000012',null,null),('c0000000-0000-4000-8000-000000000013',null,null),('c0000000-0000-4000-8000-000000000014',null,null),('c0000000-0000-4000-8000-000000000015',null,null);
insert into public.workspace_clinics(id,name)values('c0000000-0000-4000-8000-000000000020','Synthetic queue clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c0000000-0000-4000-8000-000000000011','nurse','Nurse One','c0000000-0000-4000-8000-000000000020'),('c0000000-0000-4000-8000-000000000012','nurse','Nurse Two','c0000000-0000-4000-8000-000000000020'),
 ('c0000000-0000-4000-8000-000000000013','doctor','Dr One','c0000000-0000-4000-8000-000000000020'),('c0000000-0000-4000-8000-000000000014','doctor','Dr Two','c0000000-0000-4000-8000-000000000020');
insert into public.workspace_staff(user_id,role,display_name)values('c0000000-0000-4000-8000-000000000015','admin','Admin Queue');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('c0000000-0000-4000-8000-000000000031','c0000000-0000-4000-8000-000000000011',now(),now()),('c0000000-0000-4000-8000-000000000032','c0000000-0000-4000-8000-000000000012',now(),now()),
 ('c0000000-0000-4000-8000-000000000033','c0000000-0000-4000-8000-000000000013',now(),now()),('c0000000-0000-4000-8000-000000000034','c0000000-0000-4000-8000-000000000014',now(),now()),
 ('c0000000-0000-4000-8000-000000000035','c0000000-0000-4000-8000-000000000015',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('c0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000011'),
 ('c0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000012'),
 ('c0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000011');
update public.profiles set display_name='Queue Member One'where id='c0000000-0000-4000-8000-000000000001';
update public.profiles set is_test_account=true where id='c0000000-0000-4000-8000-000000000003';

-- 1. Raising: valid tasks in each queue, and replay returns the same row.
insert into kv values('n1',pg_temp.raise('c0000000-0000-4000-8000-000000000001','nurse','orange','turn-1','{"reasons":["bp_orange"]}',now()+interval '4 hours','bp_orange','cleared'));
insert into kv values('p1',pg_temp.raise('c0000000-0000-4000-8000-000000000001','physician','red','turn-1','{"reasons":["bp_red"]}',now()+interval '30 minutes','bp_red'));
insert into kv values('n2',pg_temp.raise('c0000000-0000-4000-8000-000000000002','nurse','yellow','turn-2',sla=>now()+interval '48 hours'));
insert into kv values('a1',pg_temp.raise('c0000000-0000-4000-8000-000000000001','admin',null,'lab-1',sla=>null,reason=>'followup_labs_due'));
insert into kv values('s1',pg_temp.raise('c0000000-0000-4000-8000-000000000003','nurse','orange','turn-3'));
select pg_temp.ok((v->>'ok')::boolean and(v->>'replayed')::boolean=false and v#>>'{task,status}'='sent'and(v#>>'{task,sandbox}')::boolean=false,'Raise stores a sent task')from kv where k='n1';
select pg_temp.ok((v#>>'{task,sandbox}')::boolean,'A test account raises a sandbox task')from kv where k='s1';
select pg_temp.ok((select count(*)=5 from public.care_queue_task_events where from_status is null and to_status='sent'and actor_id is null),'Each raise writes one event');
select pg_temp.ok((select (r->>'replayed')::boolean and r#>>'{task,id}'=k.v#>>'{task,id}' from kv k,pg_temp.raise('c0000000-0000-4000-8000-000000000001','nurse','orange','turn-1')r where k.k='n1'),'Replay returns the existing row');
select pg_temp.ok((select count(*)=1 from public.care_queue_tasks where member_id='c0000000-0000-4000-8000-000000000001'and queue='nurse'),'Replay does not double');
select pg_temp.ok((select count(*)=5 from public.care_queue_task_events),'Replay writes no event');

-- 2. Bad input answers {ok:false}, it never raises.
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','admin',null,'lab-2','{"reasons":["bp_red"]}',null,'lab_no_show')->>'code'='invalid','Admin task with a summary is refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','admin',null,'lab-2',sla=>null,reason=>'lab_no_show',flags=>'cleared')->>'code'='invalid','Admin task with red flag status is refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','admin','yellow','lab-2',sla=>null,reason=>'lab_no_show')->>'code'='invalid','Admin task with a zone is refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','admin',null,'lab-2',sla=>null,reason=>'bp_symptom_chest_pain')->>'code'='invalid','A clinical reason never reaches the admin');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','admin',null,'lab-2',sla=>null,reason=>'lab_no_show',action=>'review_hba1c_high')->>'code'='invalid','A clinical action never reaches the admin');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','nurse',null,'t-9')->>'code'='invalid','Clinical task without a zone is refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','nurse','green','t-9')->>'code'='invalid','Green is not a task');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','nurse','orange','t-9',sla=>null)->>'code'='invalid','Clinical task without a deadline is refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','clinic','orange','t-9')->>'code'='invalid','Unknown queue is refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','nurse','orange','t 9')->>'code'='invalid','Bad source ref is refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','nurse','orange','t-9',reason=>'bp_symptom_chestPain')->>'code'='invalid','Reason must be lower case');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000001','nurse','orange','t-9','[1]')->>'code'='invalid','Summary must be an object');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-0000000000ff','nurse','orange','t-9')->>'code'='member_not_found','Unknown member is refused');
do $$begin
 begin insert into public.care_queue_tasks(member_id,queue,reason_code,rule_version,summary,source_ref)values('c0000000-0000-4000-8000-000000000001','admin','lab_no_show','v','{"a":1}','direct');raise exception 'FAIL: admin summary stored';
 exception when check_violation then null;end;
 begin insert into public.care_queue_tasks(member_id,queue,reason_code,rule_version,source_ref)values('c0000000-0000-4000-8000-000000000001','admin','bp_red','v','direct');raise exception 'FAIL: clinical admin reason stored';
 exception when check_violation then null;end;
 begin insert into public.care_queue_tasks(member_id,queue,reason_code,rule_version,suggested_action,source_ref)values('c0000000-0000-4000-8000-000000000001','admin','lab_no_show','v','review_hba1c_high','direct');raise exception 'FAIL: clinical admin action stored';
 exception when check_violation then null;end;
end$$;

-- 3. Only the service role raises, and nobody reads or writes the tables directly.
select pg_temp.as_member('c0000000-0000-4000-8000-000000000001');
do $$begin
 set local role authenticated;
 begin perform public.care_queue_raise('c0000000-0000-4000-8000-000000000001','nurse','red','x','v',null,null,'{}',now(),'self');raise exception 'FAIL: member raised';
 exception when insufficient_privilege then null;end;
 begin perform * from public.care_queue_tasks;raise exception 'FAIL: member read table';exception when insufficient_privilege then null;end;
 begin perform * from public.care_queue_task_events;raise exception 'FAIL: member read events';exception when insufficient_privilege then null;end;
 begin insert into public.care_queue_tasks(member_id,queue,reason_code,rule_version,source_ref)values('c0000000-0000-4000-8000-000000000001','admin','x','v','y');raise exception 'FAIL: member insert';
 exception when insufficient_privilege then null;end;
 begin perform public.care_queue_inbox('nurse','live');raise exception 'FAIL: member opened the inbox';exception when insufficient_privilege then null;end;
 begin perform public.care_queue_mark(gen_random_uuid(),0,'seen');raise exception 'FAIL: member marked';exception when insufficient_privilege then null;end;
 reset role;
end$$;
select pg_temp.as_staff('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031');
do $$begin
 set local role authenticated;
 begin perform * from public.care_queue_tasks;raise exception 'FAIL: nurse read table';exception when insufficient_privilege then null;end;
 reset role;
end$$;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.ok(pg_temp.call('anon','public.care_queue_member_tasks()')='"denied"','Anon reads nothing');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok(pg_temp.call('service_role','public.care_queue_inbox(''admin'',''live'')')='"denied"','Service role does not use the staff inbox');

-- 4. A member sees only their own tasks, only the chip fields, and no admin task.
select pg_temp.as_member('c0000000-0000-4000-8000-000000000001');
insert into kv values('m1',pg_temp.call('authenticated','public.care_queue_member_tasks()'));
select pg_temp.ok(jsonb_array_length(v->'tasks')=2,'Member reads own clinical tasks, not the admin task')from kv where k='m1';
select pg_temp.ok((select array_agg(distinct key order by key)from jsonb_array_elements(v->'tasks')e,jsonb_object_keys(e)key)=array['createdAt','id','queue','slaDeadline','status'],'Member reads only the chip fields')from kv where k='m1';
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(v->'tasks')e where e->>'id'=(select x.v#>>'{task,id}'from kv x where x.k='n2')),'Member does not read another member')from kv where k='m1';
select pg_temp.as_member('c0000000-0000-4000-8000-000000000003');
select pg_temp.ok(jsonb_array_length(pg_temp.call('authenticated','public.care_queue_member_tasks()')->'tasks')=1,'A test account still reads its own task');

-- 5. Routing: nurse to nurse, doctor to physician, admin to admin, each for their own members.
select pg_temp.ok(pg_temp.ids(pg_temp.inbox('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031','nurse'))=array[(select v#>>'{task,id}'from kv where k='n1')],'Nurse reads her member only, no sandbox row');
select pg_temp.ok(pg_temp.ids(pg_temp.inbox('c0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000032','nurse'))=array[(select v#>>'{task,id}'from kv where k='n2')],'Another nurse reads hers');
select pg_temp.ok(pg_temp.ids(pg_temp.inbox('c0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000033','physician'))=array[(select v#>>'{task,id}'from kv where k='p1')],'Doctor reads the physician queue for his members');
select pg_temp.ok(jsonb_array_length(pg_temp.inbox('c0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000034','physician')->'tasks')=0,'Another doctor reads nothing of it');
select pg_temp.ok(pg_temp.ids(pg_temp.inbox('c0000000-0000-4000-8000-000000000015','c0000000-0000-4000-8000-000000000035','admin'))=array[(select v#>>'{task,id}'from kv where k='a1')],'Admin reads the admin queue');
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031','admin')='"denied"','Nurse cannot open the admin queue');
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031','physician')='"denied"','Nurse cannot open the physician queue');
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000033','nurse')='"denied"','Doctor cannot open the nurse queue');
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000015','c0000000-0000-4000-8000-000000000035','nurse')='"denied"','Admin cannot open the nurse queue');
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000015','c0000000-0000-4000-8000-000000000035','physician')='"denied"','Admin cannot open the physician queue');
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000015','c0000000-0000-4000-8000-000000000035','admin')#>'{tasks,0,summary}'='{}'and pg_temp.inbox('c0000000-0000-4000-8000-000000000015','c0000000-0000-4000-8000-000000000035','admin')#>>'{tasks,0,zone}'is null,'Admin task carries no clinical content');
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031','nurse','bogus')->>'code'='invalid','Unknown view is refused');
-- Clinical reads are recorded per member; the admin's logistics read is not a clinical read.
select pg_temp.ok((select count(*)>0 from public.access_audit where surface='care_queue'and actor_role='nurse'and member_id='c0000000-0000-4000-8000-000000000001'),'Nurse read is on the access audit');
select pg_temp.ok(not exists(select 1 from public.access_audit where surface='care_queue'and actor_role='admin'),'Admin read writes no clinical access row');

-- A managed session is required: a session that is gone, or an unassigned reader, sees nothing.
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-0000000000ee','nurse')='"denied"','A dead session is refused');
update public.workspace_staff set active=false where user_id='c0000000-0000-4000-8000-000000000012';
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000032','nurse')='"denied"','A deactivated nurse is refused');
update public.workspace_staff set active=true where user_id='c0000000-0000-4000-8000-000000000012';

-- 6. Sandbox rows stay out of the live view and show in the sandbox view.
select pg_temp.ok(pg_temp.ids(pg_temp.inbox('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031','nurse','sandbox'))=array[(select v#>>'{task,id}'from kv where k='s1')],'Sandbox view shows the test account');

-- 7. Marks: forward only, optimistic, and only for a task this person can see.
insert into kv select 'id_n1',to_jsonb(v#>>'{task,id}')from kv where k='n1';
select pg_temp.ok(pg_temp.mark('c0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000032',(select v#>>'{}'from kv where k='id_n1'),0,'seen')->>'code'='not_found','Another nurse cannot mark it');
select pg_temp.ok(pg_temp.mark('c0000000-0000-4000-8000-000000000015','c0000000-0000-4000-8000-000000000035',(select v#>>'{}'from kv where k='id_n1'),0,'seen')->>'code'='not_found','Admin cannot mark a clinical task');
select pg_temp.ok(pg_temp.mark('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031',(select v#>>'{}'from kv where k='id_n1'),0,'sent')->>'code'='invalid','Sent is not a target');
select pg_temp.ok(m->>'status'='seen'and m->>'code'='moved'and(m->>'stateSeq')::int=1,'Nurse marks it seen')from pg_temp.mark('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031',(select v#>>'{}'from kv where k='id_n1'),0,'seen')m;
select pg_temp.ok((pg_temp.mark('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031',(select v#>>'{}'from kv where k='id_n1'),0,'seen')->>'code')='unchanged','A repeated press changes nothing');
select pg_temp.ok(pg_temp.mark('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031',(select v#>>'{}'from kv where k='id_n1'),0,'answered')->>'code'='changed','A stale seq is refused');
select pg_temp.ok(m->>'status'='answered','Nurse marks it answered')from pg_temp.mark('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031',(select v#>>'{}'from kv where k='id_n1'),1,'answered')m;
select pg_temp.ok(pg_temp.mark('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031',(select v#>>'{}'from kv where k='id_n1'),2,'seen')->>'code'='backward','A backward move is refused');
select pg_temp.ok((select status='answered'and state_seq=2 and seen_by='c0000000-0000-4000-8000-000000000011'and answered_by='c0000000-0000-4000-8000-000000000011'from public.care_queue_tasks where id=(select(v#>>'{}')::uuid from kv where k='id_n1')),'Who and when are stored');
select pg_temp.ok((select array_agg(to_status order by id)=array['sent','seen','answered']from public.care_queue_task_events where task_id=(select(v#>>'{}')::uuid from kv where k='id_n1')),'Events follow the moves');
select pg_temp.ok(jsonb_array_length(pg_temp.inbox('c0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-000000000031','nurse')->'tasks')=0,'An answered task leaves the open list');
-- Sent straight to answered still records that it was seen.
insert into kv values('n2_answered',pg_temp.mark('c0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000032',(select v#>>'{task,id}'from kv where k='n2'),0,'answered'));
select pg_temp.ok(v->>'status'='answered'and(select seen_at is not null from public.care_queue_tasks where id=(v->>'id')::uuid),'Sent to answered also fills seen')from kv where k='n2_answered';
select pg_temp.ok(m->>'status'='closed','Answered moves to closed')from pg_temp.mark('c0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000032',(select v#>>'{task,id}'from kv where k='n2'),1,'closed')m;
select pg_temp.ok((select closed_by='c0000000-0000-4000-8000-000000000012'and closed_at is not null from public.care_queue_tasks where id=(select(v#>>'{task,id}')::uuid from kv where k='n2')),'Closed keeps who and when');
-- An assignment change moves the task with the member.
update public.patient_clinical_cases set assigned_doctor_id='c0000000-0000-4000-8000-000000000014' where user_id='c0000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.ids(pg_temp.inbox('c0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000034','physician'))=array[(select v#>>'{task,id}'from kv where k='p1')],'The newly assigned doctor sees the task');
select pg_temp.ok(jsonb_array_length(pg_temp.inbox('c0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000033','physician')->'tasks')=0,'The previous doctor does not');

-- 8. Events are append-only, and go when the member's account goes.
reset role;
do $$begin
 begin update public.care_queue_task_events set actor_id=null;raise exception 'FAIL: event updated';exception when object_not_in_prerequisite_state then null;end;
 begin delete from public.care_queue_task_events;raise exception 'FAIL: event deleted';exception when object_not_in_prerequisite_state then null;end;
end$$;

-- 9. Test accounts and staff notices: off, a test account still notifies; on, it is skipped and the alert stays.
insert into public.care_alert_settings(enabled,telegram_delivery)values(true,true);
select pg_temp.ok((select not sandbox_test_accounts from public.care_alert_settings),'The sandbox switch defaults off');
select public._telegram_auth_bind('c0000000-0000-4000-8000-000000000015','staff','["telegram","noreon_queue",9007,"user",8701]','["telegram","noreon_queue",9007]','+37499017015','8701',null);
-- An escalation from Zoe needs a red flag; a lab result does not.
create function pg_temp.alert(m text,src text,ref text,flags text[] default '{}')returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
 j:=public.care_alert_screen(m::uuid,src,ref,'escalate','urgent_words_matched',flags,'care_alert.check','check-1');reset role;return j;end$$;
create function pg_temp.notices(m text)returns bigint language sql as $$select count(*)from public.care_alert_deliveries d join public.care_alerts a on a.id=d.alert_id where a.member_id=m::uuid$$;
-- Since 3 Nov the staff notice about a flagged test member goes only to staff who may see test members; the admin here may.
update public.workspace_staff set sees_test_members=true where user_id='c0000000-0000-4000-8000-000000000015';
select pg_temp.ok((pg_temp.alert('c0000000-0000-4000-8000-000000000003','lab','lab-off')->>'ok')::boolean,'Lab alert raised');
select pg_temp.ok(pg_temp.notices('c0000000-0000-4000-8000-000000000003')=1,'Switch off: a test account notifies as before');
select pg_temp.ok(not pg_temp.has('c0000000-0000-4000-8000-000000000003','care_alert.telegram_skipped','skipped','test_account_sandbox'),'Switch off: nothing skipped');
update public.care_alert_settings set sandbox_test_accounts=true;
select pg_temp.ok((pg_temp.alert('c0000000-0000-4000-8000-000000000003','zoe','zoe-on','{RF-04}')->>'ok')::boolean,'Zoe alert raised');
select pg_temp.ok(pg_temp.has('c0000000-0000-4000-8000-000000000003','care_alert.telegram_skipped','skipped','test_account_sandbox'),'Switch on: the skip is journaled');
select pg_temp.ok(pg_temp.notices('c0000000-0000-4000-8000-000000000003')=1,'Switch on: no new notice for a test account');
select pg_temp.ok((select count(*)=2 from public.care_alerts where member_id='c0000000-0000-4000-8000-000000000003'),'Switch on: the alert row itself stays');
select pg_temp.ok((pg_temp.alert('c0000000-0000-4000-8000-000000000001','lab','lab-real')->>'ok')::boolean,'Real member alert raised');
select pg_temp.ok(pg_temp.notices('c0000000-0000-4000-8000-000000000001')=1,'Switch on: a real member still notifies');

-- A task must reach someone. M4 has a doctor and no nurse, M5 has a doctor and a deactivated nurse, M6 has nobody.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c0000000-0000-4000-8000-000000000004','37499017004',now()),('c0000000-0000-4000-8000-000000000005','37499017005',now()),('c0000000-0000-4000-8000-000000000006','37499017006',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('c0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000014',null),
 ('c0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000012');
update public.workspace_staff set active=false where user_id='c0000000-0000-4000-8000-000000000012';
insert into kv values('m4',pg_temp.raise('c0000000-0000-4000-8000-000000000004','nurse','yellow','no-nurse'));
insert into kv values('m5',pg_temp.raise('c0000000-0000-4000-8000-000000000005','nurse','yellow','gone-nurse'));
insert into kv values('m6n',pg_temp.raise('c0000000-0000-4000-8000-000000000006','nurse','yellow','nobody'));
insert into kv values('m6p',pg_temp.raise('c0000000-0000-4000-8000-000000000006','physician','orange','nobody'));
insert into kv values('m6a',pg_temp.raise('c0000000-0000-4000-8000-000000000006','admin',null,'logistics',sla:=null,reason:='lab_booking_needed'));
select pg_temp.ok((v->>'ok')::boolean,'A nurse task with only a doctor is accepted')from kv where k in('m4','m5');
select pg_temp.ok(v->>'code'='no_care_team','No care team: refused, so nobody is told it was sent')from kv where k in('m6n','m6p');
select pg_temp.ok((v->>'ok')::boolean,'Logistics needs no clinician')from kv where k='m6a';
select pg_temp.ok(not exists(select 1 from public.care_queue_tasks where member_id='c0000000-0000-4000-8000-000000000006'and queue<>'admin'),'A refused task leaves no row');
insert into kv values('d2',pg_temp.inbox('c0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-000000000034','physician'));
select pg_temp.ok((select count(*)=2 from jsonb_array_elements(v->'tasks')e where e->>'memberId'in('c0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000005')),'The doctor sees nurse tasks with no active nurse')from kv where k='d2';
insert into kv values('d1',pg_temp.inbox('c0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000033','physician'));
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(v->'tasks')e where e->>'queue'='nurse'),'A doctor does not see tasks of a member with a working nurse')from kv where k='d1';

-- Reachability matches who can actually open the queue. M7's nurse is in a closed clinic, M8's whole care
-- team is, and M9's doctor is no longer a doctor. D3 and D4 work in the open clinic.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c0000000-0000-4000-8000-000000000007','37499017007',now()),('c0000000-0000-4000-8000-000000000008','37499017008',now()),('c0000000-0000-4000-8000-000000000009','37499017009',now()),
 ('c0000000-0000-4000-8000-000000000017',null,null),('c0000000-0000-4000-8000-000000000018',null,null),('c0000000-0000-4000-8000-000000000019',null,null),('c0000000-0000-4000-8000-00000000001a',null,null);
insert into public.workspace_clinics(id,name)values('c0000000-0000-4000-8000-000000000021','Synthetic closing clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c0000000-0000-4000-8000-000000000017','nurse','Nurse Closed','c0000000-0000-4000-8000-000000000021'),('c0000000-0000-4000-8000-00000000001a','doctor','Dr Closed','c0000000-0000-4000-8000-000000000021'),
 ('c0000000-0000-4000-8000-000000000018','doctor','Dr Three','c0000000-0000-4000-8000-000000000020'),('c0000000-0000-4000-8000-000000000019','doctor','Dr Four','c0000000-0000-4000-8000-000000000020');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('c0000000-0000-4000-8000-000000000036','c0000000-0000-4000-8000-000000000017',now(),now()),('c0000000-0000-4000-8000-000000000037','c0000000-0000-4000-8000-000000000018',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('c0000000-0000-4000-8000-000000000007','c0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-000000000017'),
 ('c0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-00000000001a','c0000000-0000-4000-8000-000000000017'),
 ('c0000000-0000-4000-8000-000000000009','c0000000-0000-4000-8000-000000000019',null);
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000007','nurse','yellow','open-nurse')->>'ok'='true','Before the clinic closes the nurse task is accepted');
select pg_temp.ok(jsonb_array_length(pg_temp.inbox('c0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-000000000037','physician')->'tasks')=0,'A working nurse keeps the task from the doctor');
update public.workspace_clinics set active=false where id='c0000000-0000-4000-8000-000000000021';
update public.workspace_staff set role='nurse' where user_id='c0000000-0000-4000-8000-000000000019';
insert into kv values('m7',pg_temp.raise('c0000000-0000-4000-8000-000000000007','nurse','yellow','closed-nurse'));
select pg_temp.ok((v->>'ok')::boolean,'Nurse in a closed clinic: the task is accepted for the doctor')from kv where k='m7';
select pg_temp.ok(pg_temp.inbox('c0000000-0000-4000-8000-000000000017','c0000000-0000-4000-8000-000000000036','nurse')='"denied"','The nurse in a closed clinic cannot open the queue');
select pg_temp.ok((select count(*)=2 from jsonb_array_elements(pg_temp.inbox('c0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-000000000037','physician')->'tasks')e where e->>'memberId'='c0000000-0000-4000-8000-000000000007'),'Nurse tasks fall to the eligible doctor');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000008','nurse','yellow','all-closed')->>'code'='no_care_team','Whole care team in a closed clinic: nurse task refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000008','physician','orange','all-closed')->>'code'='no_care_team','Whole care team in a closed clinic: physician task refused');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000009','physician','orange','wrong-role')->>'code'='no_care_team','An assigned doctor who is no longer a doctor does not count');
select pg_temp.ok(pg_temp.raise('c0000000-0000-4000-8000-000000000009','nurse','yellow','wrong-role')->>'code'='no_care_team','Nor for a nurse task');
select pg_temp.ok(not exists(select 1 from public.care_queue_tasks where member_id in('c0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000009')),'Refused tasks leave no row');

-- A mark answers with position only on every path that has a task, and with the code alone when there is none.
create function pg_temp.keys(j jsonb)returns text[] language sql as $$select array_agg(k order by k)from jsonb_object_keys(j)k$$;
insert into kv select 'mk_id',to_jsonb(v#>>'{task,id}')from kv where k='m7';
create function pg_temp.mark7(seq bigint,dest text)returns jsonb language sql as $$
 select pg_temp.mark('c0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-000000000037',(select v#>>'{}'from kv where k='mk_id'),seq,dest)$$;
insert into kv values('mk_moved',pg_temp.mark7(0,'seen')),('mk_same',pg_temp.mark7(0,'seen')),('mk_stale',pg_temp.mark7(0,'answered'));
insert into kv values('mk_on',pg_temp.mark7(1,'answered'));
insert into kv values('mk_back',pg_temp.mark7(2,'seen'));
select pg_temp.ok(pg_temp.keys(v)=array['code','id','ok','stateSeq','status'],'Mark returns only position and code: '||k)from kv where k in('mk_moved','mk_same','mk_stale','mk_on','mk_back');
select pg_temp.ok((select array_agg(v->>'code' order by k)=array['backward','moved','moved','unchanged','changed']from kv where k in('mk_back','mk_moved','mk_on','mk_same','mk_stale')),'Each mark path gives its code');
select pg_temp.ok(v->>'id'=(select x.v#>>'{}'from kv x where x.k='mk_id')and v->>'status'='answered'and(v->>'stateSeq')::int=2,'Mark says where the task now is')from kv where k='mk_on';
select pg_temp.ok(pg_temp.keys(pg_temp.mark7(2,'bogus'))=array['code','ok'],'An invalid mark returns the code alone');
select pg_temp.ok(pg_temp.keys(pg_temp.mark('c0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-000000000037','c0000000-0000-4000-8000-0000000000fe',0,'seen'))=array['code','ok'],'An unknown task returns the code alone');

-- Each logistics word and action is accepted, and an admin reads it.
select pg_temp.ok((pg_temp.raise('c0000000-0000-4000-8000-000000000001','admin',null,'vocab-'||r,sla=>null,reason=>r)->>'ok')::boolean,'Logistics reason accepted: '||r)
 from unnest(array['lab_booking_needed','lab_reschedule','fasting_failed','lab_no_show','missing_baseline_labs','followup_labs_due'])r;
select pg_temp.ok((pg_temp.raise('c0000000-0000-4000-8000-000000000001','admin',null,'action-'||a,sla=>null,reason=>'lab_no_show',action=>a)->>'ok')::boolean,'Logistics action accepted: '||a)from unnest(array['rebook','book'])a;

-- Deleting a member removes tasks and events; the append-only trigger lets the cascade through.
delete from auth.users where id='c0000000-0000-4000-8000-000000000002';
select pg_temp.ok(not exists(select 1 from public.care_queue_tasks where member_id='c0000000-0000-4000-8000-000000000002'),'Account deletion removes the tasks');
rollback;
