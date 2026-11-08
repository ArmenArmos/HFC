-- N1/N2 risk path. Fictional identities only; Verify discovers check-*.sql.
-- All fixtures and effects are rolled back. No providers, models or outbound sends.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.uid(n integer)returns uuid language sql as $$select ('ad130000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.claims(n integer)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method',case when n=1 then 'otp'else 'password'end)),'session_id',pg_temp.uid(n+10))::text,true);
end$$;
insert into auth.users(id,phone,phone_confirmed_at)values
 (pg_temp.uid(1),'37499001101',now()),(pg_temp.uid(2),null,null),(pg_temp.uid(3),null,null),(pg_temp.uid(4),null,null),(pg_temp.uid(5),'37499001105',now());
insert into public.workspace_clinics(id,name)values(pg_temp.uid(9),'Nurse chat fictional clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.uid(2),'doctor','Fictional responsible doctor',pg_temp.uid(9)),
 (pg_temp.uid(3),'nurse','Fictional assigned nurse',pg_temp.uid(9)),
 (pg_temp.uid(4),'nurse','Fictional other nurse',pg_temp.uid(9));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.uid(n+10),pg_temp.uid(n),now(),now()from generate_series(1,5)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'nurse-chat-fictional',3600,600,60,100,true,false,true);
create temp table nc(label text primary key,value jsonb);
grant all on nc to authenticated;
select pg_temp.claims(3);set local role authenticated;
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','other','Review question')->>'code'='off','Handoff defaults off');
reset role;
update public.nurse_chat_settings set enabled=true where singleton;
select pg_temp.claims(1);set local role authenticated;
select public.conversation_receive(jsonb_build_object('requestId',pg_temp.uid(20),'text','Fictional question for handoff'));
reset role;
select pg_temp.claims(3);set local role authenticated;
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),0,'m1','other','Review question')->>'code'='stale_context','Stale context refused');
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m999','other','Review question')->>'code'='invalid','Fabricated source refused');
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','urgent','Review question')->>'code'='invalid','Unapproved urgency refused');
insert into nc values('handoff',public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','member-request','Review question'));
select pg_temp.ok(value->>'ok'='true'and value->>'replayed'='false','Selected message creates handoff')from nc where label='handoff';
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','member-request','Review question')->>'replayed'='true','Exact replay');
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','other','Changed')->>'code'='request_conflict','Changed replay refused');
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(31),1,'m1','member-request','Review question')->>'code'='already_exists','Second request cannot duplicate source');
select pg_temp.ok(public.conversation_nurse_handoffs(pg_temp.uid(1))#>>'{items,0,task,origin}'='nurse_handoff','Handoff nested snapshot carries origin');
select pg_temp.ok(public.conversation_nurse_handoffs(pg_temp.uid(1))#>>'{items,0,task,status}'='awaiting-doctor','Nurse sees actionable waiting task');
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),(select(value->>'taskId')::uuid from nc where label='handoff'),2,pg_temp.uid(32),'resolve','{"note":"Nurse cannot resolve"}');
 raise exception 'Nurse resolved handoff';exception when insufficient_privilege then null;end$$;
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),(select(value->>'taskId')::uuid from nc where label='handoff'),2,pg_temp.uid(35),'cancel','{"note":"Nurse cannot cancel doctor work"}');
 raise exception 'Nurse cancelled doctor handoff';exception when insufficient_privilege then null;end$$;
reset role;
update public.nurse_chat_settings set enabled=false where singleton;
set local role authenticated;
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),(select(value->>'taskId')::uuid from nc where label='handoff'),2,pg_temp.uid(36),'cancel','{"note":"Nurse cannot cancel a saved handoff while dark"}');
 raise exception 'Nurse cancelled saved handoff while dark';exception when insufficient_privilege then null;end$$;
reset role;
update public.nurse_chat_settings set enabled=true where singleton;
select pg_temp.ok((select count(*)=1 from public.patient_coordination_tasks where patient_case_id=pg_temp.uid(1)),'One persisted task');
select pg_temp.ok((select kind='doctor-referral'and status='awaiting-doctor'and owner_id=pg_temp.uid(2)and due_at is null from public.patient_coordination_tasks where patient_case_id=pg_temp.uid(1)),'Real doctor owner, no invented SLA');
select pg_temp.ok((select count(*)=2 from public.patient_coordination_events where task_id=(select(value->>'taskId')::uuid from nc where label='handoff')),'Creation and existing referral audit events');
select pg_temp.claims(4);set local role authenticated;
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(33),1,'m1','other','Other nurse')->>'code'='denied','Unassigned nurse refused');
do $$begin perform public.conversation_nurse_handoffs(pg_temp.uid(1));raise exception 'Unassigned read';exception when insufficient_privilege then null;end$$;
do $$begin perform * from public.conversation_nurse_handoffs;raise exception 'Direct source table exposed';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.claims(2);set local role authenticated;
select pg_temp.ok(public.conversation_nurse_handoffs()#>>'{items,0,messageText}'='Fictional question for handoff','Doctor Today reads linked message');
select pg_temp.ok(public.conversation_nurse_handoffs(pg_temp.uid(1))#>>'{items,0,task,status}'='awaiting-doctor','Doctor chat reads same task');
select public.patient_coordination_command(pg_temp.uid(1),(select(value->>'taskId')::uuid from nc where label='handoff'),2,pg_temp.uid(34),'resolve','{"note":"Fictional doctor reviewed question"}');
select pg_temp.ok(public.conversation_nurse_handoffs(pg_temp.uid(1))#>>'{items,0,task,status}'='completed','Existing doctor resolution updates handoff');
reset role;
select pg_temp.claims(3);set local role authenticated;
select pg_temp.ok(public.conversation_nurse_handoffs(pg_temp.uid(1))#>>'{items,0,task,status}'='completed','Completion visible to nurse');
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','member-request','Review question')->>'replayed'='true','Replay after completion creates no new work');
reset role;
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.uid(4)where user_id=pg_temp.uid(1);
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','member-request','Review question')->>'code'='denied','Reassigned nurse cannot replay');
reset role;
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.uid(3)where user_id=pg_temp.uid(1);
update auth.sessions set not_after=now()-interval '1 second'where id=pg_temp.uid(13);
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','member-request','Review question')->>'code'='denied','Ended session cannot replay');
reset role;
update auth.sessions set not_after=null where id=pg_temp.uid(13);
-- Ordinary coordination work keeps the assigned nurse's existing permissions,
-- even while handoffs are enabled. Only linked handoffs get the new guard.
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id)values
 (pg_temp.uid(40),pg_temp.uid(1),'contact-followup','Doctor owned','Fictional work',pg_temp.uid(2),pg_temp.uid(2)),
 (pg_temp.uid(41),pg_temp.uid(1),'contact-followup','Nurse owned','Fictional work',pg_temp.uid(2),pg_temp.uid(3));
set local role authenticated;
select pg_temp.ok(public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(40),1,pg_temp.uid(42),'complete','{"note":"Contact completed"}')->>'status'='completed','Assigned nurse completes ordinary doctor-owned coordination task');
select pg_temp.ok(public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(41),1,pg_temp.uid(43),'complete','{"note":"Contact completed"}')->>'status'='completed','Nurse completes own coordination task');
reset role;
update public.nurse_chat_settings set enabled=false where singleton;
set local role authenticated;
select pg_temp.ok(public.conversation_nurse_handoff(pg_temp.uid(1),pg_temp.uid(30),1,'m1','member-request','Review question')->>'code'='off','DB switch fences replay');
do $$begin perform public.conversation_nurse_handoffs();raise exception 'Read while off';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.ok(not exists(select 1 from public.conversation_audit where kind='nurse.handoff'and detail::text like '%Review question%'),'Conversation audit has IDs, no message text');
rollback;
