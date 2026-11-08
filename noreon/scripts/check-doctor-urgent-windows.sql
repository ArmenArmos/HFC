-- Synthetic projection fixtures only. Discovered by run-checks.mjs --sql; everything rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;
end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$
 select ('d7d00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.as_user(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.u(n+10000))::text,true)
$$;
create function pg_temp.windows(n int)returns jsonb language plpgsql as $$declare r jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;
 r:=public.doctor_urgent_windows();reset role;return r;
end$$;
create function pg_temp.refused(n int)returns boolean language plpgsql as $$begin
 perform pg_temp.windows(n);return false;exception when insufficient_privilege then return true;
end$$;
create function pg_temp.answer(m int,s int,reason text,kind text,ago interval)returns void language sql as $$
 insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 values(pg_temp.u(30000+m*10+s),pg_temp.u(20000+m),pg_temp.u(m),s,0,0,current_date,'finished','discarded',reason,now());
 insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)
 values(pg_temp.u(20000+m),pg_temp.u(m),pg_temp.u(30000+m*10+s),s,'Synthetic text.','en','noreon.rules','zoe-urgent-fixed',kind,clock_timestamp()-ago)
$$;
grant execute on all functions in schema pg_temp to authenticated,anon;
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.u(n),case when n<10 then '374991950'||lpad(n::text,2,'0')end,
 case when n<10 then now()end from unnest(array[1,2,3,4,5,6,7,8,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select pg_temp.u(n+10000),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic urgent clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Urgent One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Urgent Two',pg_temp.u(20)),
 (pg_temp.u(13),'nurse','Urgent Nurse',pg_temp.u(20)),(pg_temp.u(14),'admin','Urgent Admin',null);
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)
 select pg_temp.u(n),pg_temp.u(case when n=2 then 12 else 11 end),pg_temp.u(13)from generate_series(1,8)n;
update public.profiles set display_name='Synthetic urgent member'where id=pg_temp.u(1);
select pg_temp.ok(pg_temp.windows(11)='{"ok":true,"windows":[],"total":0}'::jsonb,'empty and no-conversation members');
-- Minimal synthetic projections; guards normally exercised by the separate write-path checks.
set local session_replication_role=replica;
insert into public.conversations(id,member_id)select pg_temp.u(20000+n),pg_temp.u(n)from generate_series(1,7)n;
select pg_temp.answer(1,1,'urgent_health_answer_model','urgent',interval '1 hour');
select pg_temp.answer(2,1,'urgent_route_no_model_call','urgent',interval '2 hours');
select pg_temp.answer(3,1,'urgent_route_no_model_call','urgent',interval '25 hours');
select pg_temp.answer(4,1,'urgent_health_answer_model','urgent',interval '2 hours');
insert into public.zoe_urgent_clears(conversation_id,member_id,cleared_by,opened_by,window_started_at)
 values(pg_temp.u(20004),pg_temp.u(4),pg_temp.u(11),'model',now()-interval '2 hours');
select pg_temp.answer(5,1,'urgent_route_no_model_call','urgent',interval '2 hours');
select pg_temp.answer(5,2,'health_answer_passed_guards','answer',interval '1 hour');
select pg_temp.answer(6,1,'urgent_route_no_model_call','urgent',interval '30 minutes');
select pg_temp.answer(7,1,'urgent_route_no_model_call','urgent',interval '10 minutes');
set local session_replication_role=origin;
update public.profiles set is_test_account=true where id=pg_temp.u(7);
create temp table result as select pg_temp.windows(11)body;
select pg_temp.ok((select body->>'ok'='true'and body->>'total'='2'and jsonb_array_length(body->'windows')=2 from result),
 'only assigned active windows; old, cleared, answered, hidden and missing conversations excluded');
select pg_temp.ok((select body#>>'{windows,0,memberId}'=pg_temp.u(6)::text and body#>>'{windows,1,memberId}'=pg_temp.u(1)::text
 and body#>>'{windows,0,openedBy}'='rule'and body#>>'{windows,1,openedBy}'='model'
 and body#>>'{windows,1,memberName}'='Synthetic urgent member'from result),'newest first with names and projection provenance');
select pg_temp.ok((select bool_and(x-'memberId'-'memberName'-'since'-'openedBy'='{}'::jsonb)
 from result,jsonb_array_elements(body->'windows')x),'minimal fields only');
select pg_temp.ok((select count(*)=2 and count(distinct member_id)=2 and bool_and(member_id in(pg_temp.u(1),pg_temp.u(6)))
 from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_zoe_urgent_window'and object_id='read'),'one audit per returned member and no excluded reads');
select pg_temp.ok(pg_temp.windows(12)#>>'{windows,0,memberId}'=pg_temp.u(2)::text
 and pg_temp.windows(12)->>'total'='1','other doctor sees only their assigned member');
update public.patient_clinical_cases set assigned_doctor_id=null where user_id in(pg_temp.u(1),pg_temp.u(6));
select pg_temp.ok(pg_temp.windows(11)->'windows'='[]'::jsonb,'reassignment removes windows immediately');
update public.workspace_staff set sees_test_members=true where user_id=pg_temp.u(11);
select pg_temp.ok(pg_temp.windows(11)->>'total'='1','test-member visibility follows staff permission');
update public.workspace_staff set sees_test_members=false where user_id=pg_temp.u(11);
-- More than one page: total must count all eligible windows before the 200-row cap.
insert into auth.users(id)select pg_temp.u(n)from generate_series(100,300)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)select pg_temp.u(n),pg_temp.u(11)from generate_series(100,300)n;
set local session_replication_role=replica;
insert into public.conversations(id,member_id)select pg_temp.u(20000+n),pg_temp.u(n)from generate_series(100,300)n;
select pg_temp.answer(n,1,'urgent_health_answer_model','urgent',make_interval(secs=>n))from generate_series(100,300)n;
set local session_replication_role=origin;
create temp table before_audit as select count(*)n from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_zoe_urgent_window'and object_id='read';
create temp table capped as select pg_temp.windows(11)body;
select pg_temp.ok((select body->>'total'='201'and jsonb_array_length(body->'windows')=200
 and body#>>'{windows,0,memberId}'=pg_temp.u(100)::text and body#>>'{windows,199,memberId}'=pg_temp.u(299)::text from capped),'200 cap with full total and newest selection');
select pg_temp.ok((select count(*)from public.access_audit where actor_id=pg_temp.u(11)and surface='doctor_zoe_urgent_window'and object_id='read')
 =(select n+200 from before_audit),'capped call audits exactly its 200 returned members');
select pg_temp.ok(not exists(select 1 from public.access_audit where actor_id=pg_temp.u(11)and member_id=pg_temp.u(300)),'omitted 201st member is not audited');
select pg_temp.ok(pg_temp.refused(13)and pg_temp.refused(14)and pg_temp.refused(1),'nurse, admin and member refused');
select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(11),'role','authenticated')::text,true);
do $$begin
 set local role authenticated;perform public.doctor_urgent_windows();
 raise exception 'FAIL: no-session doctor admitted';exception when insufficient_privilege then null;
end$$;
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);
do $$begin
 set local role anon;perform public.doctor_urgent_windows();
 raise exception 'FAIL: anonymous admitted';exception when insufficient_privilege then null;
end$$;
reset role;
select pg_temp.ok(has_function_privilege('authenticated','public.doctor_urgent_windows()','execute')
 and not has_function_privilege('anon','public.doctor_urgent_windows()','execute')
 and not has_function_privilege('service_role','public.doctor_urgent_windows()','execute'),'authenticated execution only');
select 'Doctor urgent windows SQL checks passed.';
rollback;
