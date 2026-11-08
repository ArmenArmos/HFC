-- Zoe 103 safety net (20261020182719; Armen and Khikar 20 Oct). zoe_run_urgent_window says who opened the current run of
-- urgent texts: 'model' only when every urgent text came from a model's emergency (or repeated it in the window), 'rule'
-- otherwise. Only the member's assigned doctor (with care access) reads and clears the 103 alert; members, nurses, admins
-- and other doctors are refused. A clear ends the run (the worker then sees no window), is audited, and sends nothing.
-- Synthetic, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1a30000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1a30000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.win(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;j:=public.zoe_run_urgent_window(array[run]);reset role;return j->0;end$$;
create function pg_temp.view(n int,member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_zoe_urgent_window(pg_temp.u(member));reset role;return j;end$$;
create function pg_temp.clear(n int,member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_zoe_clear_urgent(pg_temp.u(member));reset role;return j;end$$;
create function pg_temp.refused(n int,member int)returns boolean language plpgsql as $$begin
 begin perform pg_temp.clear(n,member);reset role;return false;exception when insufficient_privilege then reset role;return true;end;end$$;
create function pg_temp.view_refused(n int,member int)returns boolean language plpgsql as $$begin
 begin perform pg_temp.view(n,member);reset role;return false;exception when insufficient_privilege then reset role;return true;end;end$$;
-- One finished run with a Zoe answer of the given kind, `ago` minutes ago, for member m's conversation.
create function pg_temp.answer(m int,p_seq int,p_reason text,p_kind text,ago int)returns void language sql as $$
 insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
  values(gen_random_uuid(),('e1a30000-0000-4000-8000-0000000002'||lpad(m::text,2,'0'))::uuid,pg_temp.u(m),p_seq,0,0,current_date,'finished','discarded',p_reason,now());
 insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)
  select('e1a30000-0000-4000-8000-0000000002'||lpad(m::text,2,'0'))::uuid,pg_temp.u(m),z.id,p_seq,'Synthetic text.','en','noreon.rules','zoe-urgent-fixed',p_kind,clock_timestamp()-make_interval(mins=>ago)
  from public.zoe_runs z where z.member_id=pg_temp.u(m)and z.message_seq=p_seq and z.state='finished';
$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- People: members 01, 02, 03; doctor 11 (assigned to 01 and 03), doctor 12 (assigned to 02), nurse 13, admin 14.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990371'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,3,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic 103 clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Dr Alert One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Alert Two',pg_temp.u(20)),(pg_temp.u(13),'nurse','Nurse Alert',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Alert');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null),(pg_temp.u(3),pg_temp.u(11),null);
insert into public.conversations(id,member_id)select('e1a30000-0000-4000-8000-0000000002'||lpad(n::text,2,'0'))::uuid,pg_temp.u(n)from unnest(array[1,2,3])n;
-- The started runs the worker reads.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 select('e1a30000-0000-4000-8000-0000000003'||lpad(n::text,2,'0'))::uuid,('e1a30000-0000-4000-8000-0000000002'||lpad(n::text,2,'0'))::uuid,pg_temp.u(n),100,0,0,current_date,'started'from unnest(array[1,2,3])n;
create function pg_temp.conv(m int)returns uuid language sql immutable as $$select('e1a30000-0000-4000-8000-0000000002'||lpad(m::text,2,'0'))::uuid$$;
create function pg_temp.run(m int)returns uuid language sql immutable as $$select('e1a30000-0000-4000-8000-0000000003'||lpad(m::text,2,'0'))::uuid$$;

-- 1. Who opened the window.
-- Member 01 (Armen's case): an ordinary answer, then a model's emergency and two window repeats: 'model'.
select pg_temp.answer(1,1,'health_answer_passed_guards','answer',90);
select pg_temp.answer(1,2,'urgent_health_answer_model','urgent',50);
select pg_temp.answer(1,3,'urgent_in_window_no_model_call','urgent',49);
select pg_temp.answer(1,4,'urgent_in_window_no_model_call','urgent',2);
select pg_temp.ok(pg_temp.win(pg_temp.run(1))->>'urgentOpenedBy'='model','A model-only window: model');
select pg_temp.ok((pg_temp.win(pg_temp.run(1))->>'urgentSinceMinutes')::int between 49 and 50,'Minutes since the model emergency');
-- Member 02: urgent words, then a model emergency inside the same run: 'rule' (a fixed rule took part).
select pg_temp.answer(2,1,'urgent_route_no_model_call','urgent',30);
select pg_temp.answer(2,2,'urgent_health_answer_model','urgent',10);
select pg_temp.ok(pg_temp.win(pg_temp.run(2))->>'urgentOpenedBy'='rule','A fixed rule in the run: rule');
-- Member 03: a red flag (intake escalation), then a repeat: 'rule'; and a repeat alone (no model emergency) is never 'model'.
select pg_temp.answer(3,1,'symptom_red_flag_no_model_call','urgent',20);
select pg_temp.answer(3,2,'urgent_in_window_no_model_call','urgent',5);
select pg_temp.ok(pg_temp.win(pg_temp.run(3))->>'urgentOpenedBy'='rule','A red flag: rule');
select pg_temp.ok((select bool_and(x - 'runId' - 'urgentSinceMinutes' - 'urgentOpenedBy' - 'urgentThroughSeq' - 'memberClear' - 'selfHarmTodayMinutes'='{}'::jsonb and jsonb_typeof(x->'selfHarmTodayMinutes')in('number','null'))from(select pg_temp.win(pg_temp.run(n))x from generate_series(1,3)n)q),'Numbers and codes only, never text');

-- 1b. A member with no conversation yet (Gohar, QA 247: "Test Qa"): the doctor's read answers "not open", it does not fail.
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.u(4),'37499037104',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(4),pg_temp.u(11),null);
select pg_temp.ok(not exists(select 1 from public.conversations where member_id=pg_temp.u(4)),'Member 04 has no conversation');
select pg_temp.ok(pg_temp.view(11,4)@>'{"ok":true,"open":false}'and pg_temp.view(11,4)->>'since'is null,'A member without a conversation has no open alert, and the read works');
select pg_temp.ok(pg_temp.view_refused(12,4),'Another doctor still cannot read it');
-- 2. The doctor's view and clear: only the assigned doctor.
select pg_temp.ok(pg_temp.view(11,1)@>'{"ok":true,"open":true,"openedBy":"model"}','The assigned doctor sees the open model-only alert');
select pg_temp.ok(pg_temp.view_refused(12,1),'Another doctor cannot read it');
select pg_temp.ok(pg_temp.view_refused(13,1),'The nurse cannot read it');
select pg_temp.ok(pg_temp.view_refused(14,1),'An admin cannot read it');
select pg_temp.ok(pg_temp.view_refused(1,1),'The member cannot read it');
select pg_temp.ok(pg_temp.refused(12,1),'Another doctor cannot clear it');
select pg_temp.ok(pg_temp.refused(13,1),'The nurse cannot clear it');
select pg_temp.ok(pg_temp.refused(14,1),'An admin cannot clear it');
select pg_temp.ok(pg_temp.refused(1,1),'The member cannot clear it');
select pg_temp.ok(not exists(select 1 from public.zoe_urgent_clears),'Nothing cleared by a refused call');
select pg_temp.ok(pg_temp.clear(11,1)@>'{"ok":true,"replayed":false,"openedBy":"model"}','The assigned doctor clears it');
select pg_temp.ok(pg_temp.win(pg_temp.run(1))->'urgentSinceMinutes'='null'::jsonb and pg_temp.win(pg_temp.run(1))->'urgentOpenedBy'='null'::jsonb,'The worker then sees no window');
select pg_temp.ok(pg_temp.view(11,1)@>'{"open":false}','The view shows it closed');
select pg_temp.ok(pg_temp.clear(11,1)@>'{"ok":true,"replayed":true}','A second clear changes nothing');
select pg_temp.ok((select count(*)from public.zoe_urgent_clears where member_id=pg_temp.u(1))=1,'One clear row');
select pg_temp.ok((select count(*)from public.conversation_audit where kind='zoe.urgent_cleared'and actor_id=pg_temp.u(11)and detail->>'openedBy'='model')=1,'The clear is in the conversation audit');
select pg_temp.ok((select count(*)from public.access_audit where actor_id=pg_temp.u(11)and member_id=pg_temp.u(1)and surface='doctor_zoe_urgent_window'and object_id='clear')=1,'The clear is in the access audit');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(1)and created_at>now()-interval '1 minute'),'The member is sent nothing');
-- A new urgent text after the clear starts a new window.
select pg_temp.answer(1,5,'urgent_route_no_model_call','urgent',0);
select pg_temp.ok(pg_temp.win(pg_temp.run(1))->>'urgentOpenedBy'='rule'and(pg_temp.win(pg_temp.run(1))->>'urgentSinceMinutes')::int=0,'A later urgent text opens a new window');
-- Astra Z103-04: a window repeat from a run that started before the clear (in flight) does not reopen the window.
select pg_temp.clear(11,1);
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at,started_at)
 values(gen_random_uuid(),pg_temp.conv(1),pg_temp.u(1),6,0,0,current_date,'finished','discarded','urgent_in_window_no_model_call',now(),clock_timestamp()-interval '1 minute');
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)
 select pg_temp.conv(1),pg_temp.u(1),z.id,6,'Synthetic text.','en','noreon.rules','zoe-urgent-fixed','urgent',clock_timestamp()
 from public.zoe_runs z where z.member_id=pg_temp.u(1)and z.message_seq=6;
select pg_temp.ok(pg_temp.win(pg_temp.run(1))->'urgentSinceMinutes'='null'::jsonb,'An in-flight repeat after the clear does not reopen the window');
-- Doctor 11 clears member 03's rule window too (the assigned doctor may clear either kind after checking).
select pg_temp.ok(pg_temp.clear(11,3)@>'{"ok":true,"replayed":false,"openedBy":"rule"}','A rule window can be cleared by the assigned doctor');
-- Older than the monitored day: nothing to clear.
update public.zoe_member_answers set created_at=created_at-interval '25 hours'where member_id=pg_temp.u(2);
select pg_temp.ok(pg_temp.view(12,2)@>'{"open":false}'and pg_temp.clear(12,2)@>'{"replayed":true}','An expired window: nothing to clear');

-- 3. Grants: the doctor functions for authenticated (they check the doctor), the table and helper private.
select pg_temp.ok(has_function_privilege('authenticated','public.doctor_zoe_clear_urgent(uuid)','execute')and not has_function_privilege('anon','public.doctor_zoe_clear_urgent(uuid)','execute')
 and not has_function_privilege('authenticated','public._zoe_urgent_window(uuid)','execute')and not has_function_privilege('authenticated','public.zoe_run_urgent_window(uuid[])','execute')
 and not has_table_privilege('authenticated','public.zoe_urgent_clears','select')and not has_table_privilege('service_role','public.zoe_urgent_clears','insert'),'Grants');
select 'Zoe 103 safety net SQL checks passed.';
rollback;
