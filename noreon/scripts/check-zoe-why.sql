-- Zoe's why record (20261030150858_zoe_run_why): saved once, a snapshot that never changes, never reachable by a member, read
-- through one audited function by the assigned active doctor and an admin only. Each role runs as itself (JWT claims, session
-- row, set local role). Fictional data, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1a70000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1a70000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.read(n int,run uuid,amr text default 'password')returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n,amr);set local role authenticated;j:=public.zoe_run_why(run);reset role;return j;
exception when insufficient_privilege then reset role;return jsonb_build_object('refused',true);end$$;
create function pg_temp.record(run uuid,w jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;j:=public.zoe_run_why_record(run,w);reset role;return j;end$$;
create function pg_temp.refused(sql text)returns text language plpgsql as $$begin execute sql;return 'ran';exception when others then return sqlstate;end$$;
create function pg_temp.audits(run uuid)returns bigint language sql as $$select count(*) from public.access_audit where surface='zoe_run_why'and object_id=run::text$$;

-- Members 1 and 2; doctor 11 of member 1, doctor 12 of member 2, nurse 13 of member 1, admin 14, removed doctor 15 (still on member 3's case).
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990390'||lpad(n::text,2,'0')end,case when n<10 then now()end from unnest(array[1,2,3,11,12,13,14,15])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,3,11,12,13,14,15])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Fictional why clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.u(11),'doctor','Fictional doctor one',pg_temp.u(20)),(pg_temp.u(12),'doctor','Fictional doctor two',pg_temp.u(20)),
 (pg_temp.u(13),'nurse','Fictional nurse',pg_temp.u(20)),(pg_temp.u(15),'doctor','Fictional removed doctor',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Fictional admin');
update public.workspace_staff set active=false,removed_at=now() where user_id=pg_temp.u(15);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null),(pg_temp.u(3),pg_temp.u(15),null)
 on conflict(user_id)do update set assigned_doctor_id=excluded.assigned_doctor_id,assigned_nurse_id=excluded.assigned_nurse_id;
insert into public.conversations(member_id)select pg_temp.u(n)from unnest(array[1,2,3])n on conflict do nothing;
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 select pg_temp.u(30+n),c.id,c.member_id,1,1,0,current_date,'finished','answered','health_answer_passed_guards',now()from public.conversations c,unnest(array[1,2,3])n where c.member_id=pg_temp.u(n);
-- Run 34: a second run for member 1, with no record yet.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 select pg_temp.u(34),c.id,c.member_id,2,1,0,current_date,'finished','no_output','worker_error',now()from public.conversations c where c.member_id=pg_temp.u(1);
set local session_replication_role=origin;

-- 0. Grants: no direct way in for anyone; the writer is the worker's, the read is for signed-in users and refuses all but two.
select pg_temp.ok(not has_column_privilege('authenticated','public.zoe_runs','why','select')and not has_column_privilege('anon','public.zoe_runs','why','select')and not has_column_privilege('service_role','public.zoe_runs','why','update'),'No direct read or write of zoe_runs.why');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.zoe_runs'::regclass),'RLS stays on zoe_runs');
select pg_temp.ok(not exists(select 1 from pg_policies where schemaname='public'and tablename='zoe_runs'),'No policy opens zoe_runs');
select pg_temp.ok(not has_function_privilege('anon','public.zoe_run_why(uuid)','execute')and not has_function_privilege('service_role','public.zoe_run_why(uuid)','execute'),'Only signed-in users call the read; the service role does not');
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_run_why_record(uuid,jsonb)','execute')and not has_function_privilege('anon','public.zoe_run_why_record(uuid,jsonb)','execute')and has_function_privilege('service_role','public.zoe_run_why_record(uuid,jsonb)','execute'),'Only the worker writes');

-- 1. The write: once; a bad record is refused with a code and leaves the run alone.
select pg_temp.ok(pg_temp.record(pg_temp.u(31),'[]'::jsonb)->>'code'='why_invalid','A record that is not an object is refused');
select pg_temp.ok(pg_temp.record(pg_temp.u(31),'{"v":2}'::jsonb)->>'code'='why_invalid','An unknown version is refused');
select pg_temp.ok(pg_temp.record(pg_temp.u(31),jsonb_build_object('v',1,'x',repeat('a',33000)))->>'code'='why_invalid','An oversized record is refused');
select pg_temp.ok(pg_temp.record(pg_temp.u(99),'{"v":1}'::jsonb)->>'code'='why_not_recorded','An unknown run records nothing');
select pg_temp.ok((select why from public.zoe_runs where id=pg_temp.u(31))is null,'A refused record leaves the run alone');
select pg_temp.ok((pg_temp.record(pg_temp.u(31),'{"v":1,"level":{"final":"same_day"},"data":[{"key":"bp_week","value":"avg 150/95"}]}'::jsonb)->>'ok')::boolean,'The run''s record is saved');
select pg_temp.ok((pg_temp.record(pg_temp.u(32),'{"v":1,"level":{"final":"planned"}}'::jsonb)->>'ok')::boolean,'Member 2''s record is saved');
select pg_temp.ok((pg_temp.record(pg_temp.u(33),'{"v":1,"level":{"final":"planned"}}'::jsonb)->>'ok')::boolean,'Member 3''s record is saved');
select pg_temp.ok(pg_temp.record(pg_temp.u(31),'{"v":1,"level":{"final":"none"}}'::jsonb)->>'code'='why_not_recorded','A second record never replaces the first');

-- 2. A snapshot: not even a privileged update changes it, and a change to the run or member data leaves it as saved.
select pg_temp.ok(pg_temp.refused($$update public.zoe_runs set why='{"v":1}' where id=pg_temp.u(31)$$)='55000','A saved record cannot be rewritten');
select pg_temp.ok(pg_temp.refused($$update public.zoe_runs set why=null where id=pg_temp.u(31)$$)='55000','A saved record cannot be blanked');
update public.zoe_runs set reason_code='worker_lost' where id=pg_temp.u(31);
select pg_temp.ok((select why#>>'{data,0,value}' from public.zoe_runs where id=pg_temp.u(31))='avg 150/95','Other updates to the run leave the record as saved');
update public.zoe_runs set reason_code='health_answer_passed_guards' where id=pg_temp.u(31);

-- 3. By role, on member 1's run.
create temp table reads(who text primary key,j jsonb);
insert into reads values('member',pg_temp.read(1,pg_temp.u(31),'otp')),('other_member',pg_temp.read(2,pg_temp.u(31),'otp')),('doctor',pg_temp.read(11,pg_temp.u(31))),('other_doctor',pg_temp.read(12,pg_temp.u(31))),
 ('nurse',pg_temp.read(13,pg_temp.u(31))),('admin',pg_temp.read(14,pg_temp.u(31))),('removed_doctor',pg_temp.read(15,pg_temp.u(33)));
select pg_temp.ok((select j?'refused' from reads where who='member'),'The member never reads their own why');
select pg_temp.ok((select j?'refused' from reads where who='other_member'),'Another member is refused');
select pg_temp.ok((select j?'refused' from reads where who='other_doctor'),'A doctor of another member is refused');
select pg_temp.ok((select j?'refused' from reads where who='nurse'),'The nurse is refused, as for the conversation');
select pg_temp.ok((select j?'refused' from reads where who='removed_doctor'),'A removed doctor is refused, even with the case still on them');
select pg_temp.ok((select j#>>'{why,level,final}' from reads where who='doctor')='same_day','The assigned doctor reads the saved record');
select pg_temp.ok((select j#>>'{why,level,final}' from reads where who='admin')='same_day','An admin reads it for the trace screen');
select pg_temp.ok((select j->>'label' from reads where who='doctor')like'%not a doctor''s reasoning%','The read itself labels the record as generated');
select pg_temp.ok((select j#>>'{run,reason}' from reads where who='doctor')='health_answer_passed_guards','The read carries the run''s final outcome');
do $$begin perform set_config('request.jwt.claims','{"role":"anon"}',true);set local role anon;perform public.zoe_run_why(pg_temp.u(31));raise exception 'FAIL: anon called the read';exception when insufficient_privilege then null;end$$;
reset role;
do $$begin perform pg_temp.as_user(1,'otp');set local role authenticated;perform why from public.zoe_runs;raise exception 'FAIL: a member selected zoe_runs.why';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.ok(pg_temp.read(1,pg_temp.u(34),'otp')?'refused','A member is refused on a run with no record too');

-- 4. Wrong session: a staff JWT is only as good as its managed session.
select pg_temp.ok(pg_temp.read(11,pg_temp.u(31),'otp')?'refused','A doctor without a password session is refused');
delete from auth.sessions where id=pg_temp.sid(14);
select pg_temp.ok(pg_temp.read(14,pg_temp.u(31))?'refused','An admin with no live session is refused');
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.sid(14),pg_temp.u(14),now()-interval '1 hour',now());
-- An unknown run refuses like someone else's run, and writes no audit row.
select pg_temp.ok(pg_temp.read(11,pg_temp.u(98))?'refused','A doctor learns nothing about an unknown run');
select pg_temp.ok(pg_temp.read(14,pg_temp.u(98))?'refused','An admin gets the same refusal on an unknown run');

-- 5. Audit: one row per allowed read, with who, whose and which run; refused reads leave none.
select pg_temp.ok(pg_temp.audits(pg_temp.u(31))=2,'Two allowed reads, two audit rows');
select pg_temp.ok((select array_agg(actor_role order by actor_role) from public.access_audit where surface='zoe_run_why'and object_id=pg_temp.u(31)::text)=array['admin','doctor'],'The audit names the role');
select pg_temp.ok(not exists(select 1 from public.access_audit where surface='zoe_run_why'and object_id=pg_temp.u(31)::text and member_id<>pg_temp.u(1)),'The audit names the member');
select pg_temp.ok(not exists(select 1 from public.access_audit where object_id=pg_temp.u(98)::text),'A refused read leaves no audit row');

-- 6. A run with no record says so: the read works and the answer is "missing", never an invented one.
select pg_temp.ok((select pg_temp.read(11,pg_temp.u(34))->'why')='null'::jsonb,'A run with no saved why reads as missing');
select pg_temp.ok((select pg_temp.read(11,pg_temp.u(34))#>>'{run,reason}')='worker_error','A missing record still shows the run''s outcome');
select pg_temp.ok(pg_temp.audits(pg_temp.u(34))=2,'Reading a missing record is audited too');

-- 7. Reassignment: access follows the current doctor; the record stays the same.
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.u(12)where user_id=pg_temp.u(1);
select pg_temp.ok(pg_temp.read(11,pg_temp.u(31))?'refused','The previous doctor loses the read at reassignment');
select pg_temp.ok((select pg_temp.read(12,pg_temp.u(31))#>>'{why,level,final}')='same_day','The new doctor reads the same saved record');

-- 8. Nothing member-facing carries it, and no function outside the three here writes the column.
-- staff_zoe_finish writes why on its own table, staff_zoe_runs: named, so a helper taking a zoe_runs row is still caught.
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname not in('zoe_run_why','zoe_run_why_record','_zoe_run_why_once','staff_zoe_finish')and p.prosrc ~ 'r\.why|z\.why|set why|why='),'No other function reads or writes the record');
select pg_temp.ok(not exists(select 1 from pg_publication_tables where tablename='zoe_runs'),'zoe_runs is not on a realtime publication');
rollback;
select 'zoe why record checks passed' as result;
