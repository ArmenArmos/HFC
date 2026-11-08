\set ON_ERROR_STOP on
-- Fictional identities only. Run by Verify against its isolated replay; no provider IO.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.uid(n integer)returns uuid language sql as $$select ('ad140000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.login(n integer)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.uid(n+10))::text,true);
end$$;
insert into auth.users(id,email,phone,phone_confirmed_at)values
 (pg_temp.uid(1),'handover-member@example.invalid','37499001201',now()),(pg_temp.uid(2),'handover-doctor@example.invalid',null,null),
 (pg_temp.uid(3),'handover-nurse@example.invalid',null,null),(pg_temp.uid(4),'handover-other@example.invalid',null,null),
 (pg_temp.uid(5),'handover-other-member@example.invalid','37499001205',now());
insert into public.workspace_clinics(id,name)values(pg_temp.uid(9),'Fictional handover clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.uid(2),'doctor','Fictional doctor',pg_temp.uid(9)),(pg_temp.uid(3),'nurse','Fictional nurse',pg_temp.uid(9)),(pg_temp.uid(4),'doctor','Other doctor',pg_temp.uid(9));
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.uid(n+10),pg_temp.uid(n),now(),now()from generate_series(1,5)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3)),(pg_temp.uid(5),pg_temp.uid(2),null);
insert into public.conversations(id,member_id)values(pg_temp.uid(20),pg_temp.uid(1)),(pg_temp.uid(21),pg_temp.uid(5));
create function pg_temp.command(source_id uuid,owner_id uuid default pg_temp.uid(3))returns jsonb language sql as $$
 select jsonb_build_object('kind','contact-followup','title','From the doctor','instructions',E'Call tomorrow.\nKeep THIS wording.','dueAt',null,'ownerId',owner_id,'sourceConversationId',source_id)
$$;
create temp table member_baseline as select (select count(*)from public.conversation_messages)messages,(select count(*)from public.conversation_deliveries)deliveries,(select count(*)from public.conversation_nurse_replies)replies,(select count(*)from public.conversation_audit)audit,(select count(*)from public.workspace_notifications)notifications;
select pg_temp.login(2);set local role authenticated;
select pg_temp.ok(public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(30),0,pg_temp.uid(31),'create',pg_temp.command(pg_temp.uid(20)))->>'status'='open','Doctor creates task owned by assigned nurse');
select pg_temp.ok(public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(30),0,pg_temp.uid(31),'create',pg_temp.command(pg_temp.uid(20)))->>'revision'='1','Exact replay');
select pg_temp.ok(public.patient_coordination_snapshot(pg_temp.uid(30))->>'origin'='doctor_handover','Snapshot carries doctor origin');
select pg_temp.ok(public.patient_coordination_snapshot(pg_temp.uid(30))->>'sourceConversationId'=pg_temp.uid(20)::text,'Snapshot exposes source');
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(30),0,pg_temp.uid(31),'create',pg_temp.command(pg_temp.uid(21)));
 raise exception 'Changed source replay accepted';exception when serialization_failure or insufficient_privilege then null;end$$;
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(32),0,pg_temp.uid(33),'create',pg_temp.command(pg_temp.uid(21)));
 raise exception 'Other member source accepted';exception when insufficient_privilege then null;end$$;
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(34),0,pg_temp.uid(35),'create',pg_temp.command(pg_temp.uid(20),pg_temp.uid(2)));
 raise exception 'Doctor as nurse owner accepted';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.ok((select count(*)=1 from public.patient_coordination_tasks where patient_case_id=pg_temp.uid(1)),'One task; refused writes rolled back');
select pg_temp.ok((select owner_id=pg_temp.uid(3)and creator_id=pg_temp.uid(2)and kind='contact-followup'and due_at is null and instructions=E'Call tomorrow.\nKeep THIS wording.'from public.patient_coordination_tasks where id=pg_temp.uid(30)),'Exact note and owner; no invented deadline');
select pg_temp.ok((select count(*)=1 from public.patient_coordination_receipts where patient_case_id=pg_temp.uid(1)),'No refused receipts');
select pg_temp.ok((select count(*)=1 from public.patient_coordination_events where task_id=pg_temp.uid(30)),'No duplicate events');
select pg_temp.ok((select detail#>>'{input,source}'='doctor-handover'from public.patient_coordination_events where request_id=pg_temp.uid(31)),'Create event carries handover source');
select pg_temp.ok((select (select count(*)from public.conversation_messages)=messages and(select count(*)from public.conversation_deliveries)=deliveries and(select count(*)from public.conversation_nurse_replies)=replies and(select count(*)from public.conversation_audit)=audit and(select count(*)from public.workspace_notifications)=notifications from member_baseline),'No member-facing write');
select pg_temp.login(4);set local role authenticated;
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(36),0,pg_temp.uid(37),'create',pg_temp.command(pg_temp.uid(20)));
 raise exception 'Unassigned doctor accepted';exception when insufficient_privilege then null;end$$;
reset role;select pg_temp.login(3);set local role authenticated;
select pg_temp.ok(public.patient_coordination_queue(p_filter=>'active')#>>'{tasks,0,origin}'='doctor_handover','Queue carries doctor origin');
select pg_temp.ok(public.patient_coordination_queue(p_filter=>'active')#>>'{tasks,0,title}'='From the doctor','Assigned nurse queue sees task');
select pg_temp.ok(public.patient_coordination_queue(p_filter=>'active')#>>'{tasks,0,sourceConversationId}'=pg_temp.uid(20)::text,'Queue exposes conversation link');
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(36),0,pg_temp.uid(37),'create',pg_temp.command(pg_temp.uid(20)));
 raise exception 'Nurse create accepted';exception when insufficient_privilege then null;end$$;
select public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(30),1,pg_temp.uid(38),'contact','{"outcome":"reached","note":"Fictional contact"}');
select public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(30),2,pg_temp.uid(39),'complete','{"note":"Fictional completion"}');
reset role;select pg_temp.login(2);set local role authenticated;
select pg_temp.ok(public.patient_coordination_snapshot(pg_temp.uid(30))->>'status'='completed','Existing completion visible to doctor');
select pg_temp.ok(public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(30),0,pg_temp.uid(31),'create',pg_temp.command(pg_temp.uid(20)))->>'revision'='1','Retry after completion remains idempotent');
-- Staff cannot choose a provenance marker, even for a registered fixed title.
select public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(50),0,pg_temp.uid(51),'create',pg_temp.command(pg_temp.uid(20))-'sourceConversationId');
select pg_temp.ok((public.patient_coordination_snapshot(pg_temp.uid(50))->'origin')='null'::jsonb,'Ordinary exact-match title has null origin');
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(52),0,pg_temp.uid(53),'create',(pg_temp.command(pg_temp.uid(20))-'sourceConversationId')||'{"origin":"doctor_handover"}');
 raise exception 'Staff chose origin';exception when check_violation then null;end$$;
reset role;
do $$begin
 update public.patient_coordination_tasks set origin='invented'where id=pg_temp.uid(50);
 raise exception 'Unknown origin accepted';exception when check_violation then null;end$$;
reset role;
update public.patient_clinical_cases set assigned_nurse_id=null where user_id=pg_temp.uid(1);
set local role authenticated;
do $$begin
 perform public.patient_coordination_command(pg_temp.uid(1),pg_temp.uid(30),0,pg_temp.uid(31),'create',pg_temp.command(pg_temp.uid(20)));
 raise exception 'Reassigned nurse replay accepted';exception when insufficient_privilege then null;end$$;
reset role;
rollback;
