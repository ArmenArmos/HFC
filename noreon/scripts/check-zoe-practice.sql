-- Isolated local replay only; fictional rows and all changes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.refused(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
grant execute on function pg_temp.refused(text),pg_temp.ok(boolean,text)to authenticated,service_role;
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_practice_mutate(uuid,text,jsonb)','execute'),'Browser cannot forge stored pipeline output');
select pg_temp.ok(has_function_privilege('service_role','public.zoe_practice_mutate(uuid,text,jsonb)','execute'),'Practice server can mutate');
select pg_temp.ok(not has_table_privilege('authenticated',t,p),'Browser mutation denied: '||t||' '||p)from unnest(array['public.zoe_practice_sessions','public.zoe_practice_marks'])t,unnest(array['insert','update','delete'])p;
select pg_temp.ok((select relrowsecurity from pg_class where oid=t::regclass),'RLS enabled: '||t)from unnest(array['public.zoe_practice_sessions','public.zoe_practice_marks'])t;
set local session_replication_role=replica;
insert into auth.users(id)values('e9000000-0000-4000-8000-000000000001'),('e9000000-0000-4000-8000-000000000002'),('e9000000-0000-4000-8000-000000000003'),('e9000000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('e9000000-0000-4000-8000-000000000001','admin','Fictional practice admin'),('e9000000-0000-4000-8000-000000000002','admin','Other fictional practice admin');
insert into public.workspace_clinics(id,name,address)values('e9000000-0000-4000-8000-000000000090','Fictional practice clinic','Fictional address');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e9000000-0000-4000-8000-000000000004','doctor','Fictional practice doctor','e9000000-0000-4000-8000-000000000090');
insert into auth.sessions(id,user_id,created_at,updated_at)values('e9000000-0000-4000-8000-000000000104','e9000000-0000-4000-8000-000000000004',now(),now());
reset session_replication_role;
update public.staff_telegram_policy set signin_required=false;
-- Daily caps count every row; earlier local use must not change this run.
update public.zoe_practice_sessions set reservations='[]';
create temp table r(k text primary key,v jsonb);grant all on r to service_role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into r values('doctor_created',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000004','create','{"patientId":"practice-new-ldl","state":{"turns":[],"edits":[]}}'));
select pg_temp.ok(v->>'ok'='true','Active doctor creates own session')from r where k='doctor_created';
insert into r values('created',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','create','{"patientId":"practice-new-ldl","state":{"turns":[],"edits":[]}}'));
select pg_temp.ok(v->>'ok'='true','Server creates fictional session')from r where k='created';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000002','reserve',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0))->>'code'='access','Another doctor cannot mutate session')from r where k='created';
insert into r select 'reserve',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0,'doctorLimit',1,'globalLimit',1))from r where k='created';
select pg_temp.ok(v->>'ok'='true' and v->>'token' is not null,'First reservation accepted')from r where k='reserve';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0))->>'code'='busy','Simultaneous session request refused')from r where k='created';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','release',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0,'token',v->>'token'))->>'ok'='true','Failed attempt releases session')from r where k='reserve';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0,'doctorLimit',1,'globalLimit',1))->>'code'='daily_limit','Failure still counts toward caps')from r where k='created';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000003','create','{}')->>'code'='access','Member denied privileged mutation');
insert into r select 'reserve2',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0))from r where k='created';
insert into r select 'finished',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','finish',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0,'token',v->>'token','configVersion','generation-version','state','{"turns":[{"id":"e9000000-0000-4000-8000-000000000010","at":1,"job":{"model":"original"},"finish":{"answer":"Original fictional reply"}}],"edits":[]}'::jsonb))from r where k='reserve2';
select pg_temp.ok(v->>'ok'='true' and v->'session'->>'version'='1','Finish commits once and advances version')from r where k='finished';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','finish',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0,'token',v->>'token','state','{}'::jsonb))->>'code'='conflict','Duplicate completion cannot overwrite committed state')from r where k='reserve2';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0))->'session'->>'version'='1','Owner conflict returns latest state for response-loss recovery')from r where k='finished';
insert into r select 'mark',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','mark',jsonb_build_object('sessionId',v->'session'->>'id','turnId','e9000000-0000-4000-8000-000000000010','rating','wrong','reason','wrong_fact','correction','Fictional corrected reply','configVersion','forged-mark-version','snapshot','forged-browser-snapshot'))from r where k='finished';
select pg_temp.ok(v->'mark'->'snapshot'->>'configVersion'='generation-version' and v->'mark'->'snapshot'->'markedTurn'->'finish'->>'answer'='Original fictional reply','Mark uses generation version and persisted reply, ignoring supplied snapshot')from r where k='mark';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','mark',jsonb_build_object('sessionId',v->'session'->>'id','turnId','e9000000-0000-4000-8000-000000000010','rating','good'))->>'ok'='true','Own mark may be retried or revised')from r where k='finished';

reset role;
-- A live doctor session reads practice sessions and marks from other doctors/admins.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9000000-0000-4000-8000-000000000004","session_id":"e9000000-0000-4000-8000-000000000104","amr":[{"method":"password"}]}',true);
select pg_temp.ok((select count(*)>0 from public.zoe_practice_sessions),'Doctor reads all fictional sessions');
select pg_temp.ok((select count(*)>0 from public.zoe_practice_marks),'Doctor reads other authors marks');
reset role;
-- A member has no managed staff identity and sees no practice rows.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9000000-0000-4000-8000-000000000003"}',true);
select pg_temp.ok((select count(*)=0 from public.zoe_practice_sessions),'Member sees no sessions');
select pg_temp.ok((select count(*)=0 from public.zoe_practice_marks),'Member sees no marks');
reset role;
-- A member cannot touch the tables or the server function, whatever the row.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9000000-0000-4000-8000-000000000003"}',true);
select pg_temp.ok(pg_temp.refused(q),'Member refused: '||q)from unnest(array[
 $q$insert into public.zoe_practice_sessions(author,patient_id,state)values('e9000000-0000-4000-8000-000000000003','practice-new-ldl','{}')$q$,
 $q$update public.zoe_practice_sessions set state='{}'$q$,
 $q$delete from public.zoe_practice_sessions$q$,
 $q$insert into public.zoe_practice_marks(session_id,author,turn_id,rating,snapshot)values(gen_random_uuid(),'e9000000-0000-4000-8000-000000000003',gen_random_uuid(),'good','{}')$q$,
 $q$update public.zoe_practice_marks set correction='changed'$q$,
 $q$delete from public.zoe_practice_marks$q$,
 $q$select public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000003','create','{}')$q$
])q;
reset role;
-- A signed-in doctor cannot change another author's mark or session, directly or through the server function.
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9000000-0000-4000-8000-000000000004","session_id":"e9000000-0000-4000-8000-000000000104","amr":[{"method":"password"}]}',true);
select pg_temp.ok(pg_temp.refused(q),'Doctor refused: '||q)from unnest(array[
 $q$update public.zoe_practice_marks set correction='changed'$q$,
 $q$delete from public.zoe_practice_marks$q$,
 $q$update public.zoe_practice_sessions set state='{}'$q$,
 $q$select public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','mark','{}')$q$
])q;
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000004','mark',jsonb_build_object('sessionId',v->'session'->>'id','turnId','e9000000-0000-4000-8000-000000000010','rating','wrong','reason','other','correction','Changed by another doctor'))->>'code'='access','Doctor cannot mark or remark on another author session')from r where k='finished';
reset role;
select pg_temp.ok((select count(*)=1 and min(rating)='good' and min(correction)='' from public.zoe_practice_marks where author='e9000000-0000-4000-8000-000000000001'),'The first author mark is unchanged');
-- Staff without the doctor or admin role, and doctors who left, get nothing.
set local session_replication_role=replica;
insert into auth.users(id)values('e9000000-0000-4000-8000-000000000005'),('e9000000-0000-4000-8000-000000000006');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e9000000-0000-4000-8000-000000000005','nurse','Fictional practice nurse','e9000000-0000-4000-8000-000000000090');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values('e9000000-0000-4000-8000-000000000006','doctor','Fictional inactive doctor','e9000000-0000-4000-8000-000000000090',false);
insert into auth.sessions(id,user_id,created_at,updated_at)values('e9000000-0000-4000-8000-000000000105','e9000000-0000-4000-8000-000000000005',now(),now());
reset session_replication_role;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9000000-0000-4000-8000-000000000005","session_id":"e9000000-0000-4000-8000-000000000105","amr":[{"method":"password"}]}',true);
select pg_temp.ok((select count(*)=0 from public.zoe_practice_sessions),'Nurse sees no sessions');
select pg_temp.ok((select count(*)=0 from public.zoe_practice_marks),'Nurse sees no marks');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000005','create','{"patientId":"practice-new-ldl","state":{"turns":[],"edits":[]}}')->>'code'='access','Nurse cannot start practice');
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000006','create','{"patientId":"practice-new-ldl","state":{"turns":[],"edits":[]}}')->>'code'='access','Inactive doctor cannot start practice');
reset role;
-- Anon, removed doctors, abandoned reservations, stale tokens and the UTC day.
reset role;
grant execute on function pg_temp.refused(text),pg_temp.ok(boolean,text) to anon;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.ok(pg_temp.refused(q),'Anon denied: '||q) from unnest(array[
 'select * from public.zoe_practice_sessions',
 'select * from public.zoe_practice_marks',
 $$select public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','create','{}')$$
]) q;
reset role;
update public.workspace_staff set removed_at=now(),active=false
where user_id='e9000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"e9000000-0000-4000-8000-000000000004","session_id":"e9000000-0000-4000-8000-000000000104","amr":[{"method":"password"}]}',true);
select pg_temp.ok(not exists(select 1 from public.zoe_practice_sessions),'Removed doctor reads no sessions');
select pg_temp.ok(not exists(select 1 from public.zoe_practice_marks),'Removed doctor reads no marks');
select pg_temp.ok(pg_temp.refused('update public.zoe_practice_marks set rating=''good'''),'Removed doctor cannot edit marks');
reset role;
set local role service_role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000004',op,
 jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',0))->>'code'='access',
 'Removed doctor denied operation: '||op)
from r cross join unnest(array['reserve','finish','release','replace','reset','mark'])op where k='doctor_created';
reset role;
-- Abandoned reservation remains charged; replacement invalidates the old token.
update public.zoe_practice_sessions set reservations='[]',lease=null,lease_until=null
where author='e9000000-0000-4000-8000-000000000001';
set local role service_role;
insert into r select 'lost',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',
 jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',1)) from r where k='finished';
select pg_temp.ok(v->>'ok'='true','Lost reservation established') from r where k='lost';
reset role;
update public.zoe_practice_sessions set lease_until=now()-interval '1 second'
where id=(select (v->'session'->>'id')::uuid from r where k='lost');
set local role service_role;
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',
 jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',1,'doctorLimit',1))->>'code'='daily_limit',
 'Expired reservation still counts') from r where k='lost';
insert into r select 'new_token',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',
 jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',1)) from r where k='lost';
select pg_temp.ok(v->>'ok'='true','Expired lease may be replaced') from r where k='new_token';
select pg_temp.ok(public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','finish',
 jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',1,'token',v->>'token','state','{}'::jsonb))->>'code'='conflict',
 'Old completion token rejected') from r where k='lost';
reset role;
update public.zoe_practice_sessions set reservations=jsonb_build_array(to_char((now() at time zone 'UTC')-interval '1 day','YYYY-MM-DD')),lease=null,lease_until=null
where author='e9000000-0000-4000-8000-000000000001';
set local timezone='Pacific/Kiritimati';
set local role service_role;
insert into r select 'utc',public.zoe_practice_mutate('e9000000-0000-4000-8000-000000000001','reserve',
 jsonb_build_object('sessionId',v->'session'->>'id','expectedVersion',1,'doctorLimit',1)) from r where k='finished';
select pg_temp.ok(v->>'ok'='true','Prior UTC day does not consume current limit') from r where k='utc';
reset role;
select pg_temp.ok(reservations->>-1=to_char(now() at time zone 'UTC','YYYY-MM-DD'),'Reservation uses UTC day')
from public.zoe_practice_sessions where id=(select (v->'session'->>'id')::uuid from r where k='utc');
rollback;
