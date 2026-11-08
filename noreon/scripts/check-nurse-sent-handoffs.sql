-- Narrow read risk path. Fictional fixtures only; every change is rolled back.
begin;
create function pg_temp.ok(c boolean,label text) returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;
end $$;
create function pg_temp.uid(n integer) returns uuid language sql as $$
 select ('ae770000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.claims(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated','exp',4102444800,
  'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.uid(n+10))::text,true);
end $$;
insert into auth.users(id,phone,phone_confirmed_at) values
 (pg_temp.uid(1),'37499001234',now()),(pg_temp.uid(2),null,null),(pg_temp.uid(3),null,null),(pg_temp.uid(4),null,null),(pg_temp.uid(5),null,null),
 (pg_temp.uid(6),null,null),(pg_temp.uid(7),null,null);
update public.profiles set display_name='Fictional sent member',birth_date='1980-04-03' where id=pg_temp.uid(1);
insert into public.workspace_clinics(id,name) values(pg_temp.uid(9),'Fictional sent clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
 (pg_temp.uid(2),'doctor','Fictional doctor',pg_temp.uid(9)),
 (pg_temp.uid(3),'nurse','Fictional sending nurse',pg_temp.uid(9)),
 (pg_temp.uid(4),'nurse','Fictional second nurse',pg_temp.uid(9)),
 (pg_temp.uid(5),'admin','Fictional admin',null);
-- Both portal roles belong to the sending nurse's clinic and the member's assigned doctor's clinic.
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role) values
 (pg_temp.uid(6),pg_temp.uid(9),'Fictional clinic admin','admin'),
 (pg_temp.uid(7),pg_temp.uid(9),'Fictional clinic staff','staff');
insert into auth.sessions(id,user_id,created_at,updated_at) select pg_temp.uid(n+10),pg_temp.uid(n),now(),now() from generate_series(1,7)n;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id) values(pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
insert into public.conversations(id,member_id) values(pg_temp.uid(20),pg_temp.uid(1));
update public.nurse_chat_settings set enabled=true where singleton;

-- Fifty-one own handoffs, including completed/cancelled ahead of older active work,
-- plus one sent by another nurse while previously assigned to this same member.
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,status,revision,created_at)
 select pg_temp.uid(100+n),pg_temp.uid(1),'doctor-referral','Nurse handoff','Fictional observation',
  pg_temp.uid(case when n=52 then 4 else 3 end),pg_temp.uid(2),
  case n when 1 then 'completed' when 2 then 'cancelled' else 'awaiting-doctor' end,3,
  '2026-11-07 13:00:00+00'::timestamptz-n*interval '1 minute' from generate_series(1,52)n;
insert into public.conversation_nurse_handoffs(task_id,conversation_id,message_id,message_text,context_version,nurse_id,nurse_name,request_id,topic,observation)
 select pg_temp.uid(100+n),pg_temp.uid(20),'m'||n,'PRIVATE SOURCE MESSAGE',1,
  pg_temp.uid(case when n=52 then 4 else 3 end),'Fictional nurse',pg_temp.uid(200+n),'member-request','Fictional observation' from generate_series(1,52)n;
insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,old_status,new_status,new_owner_id,note,detail,created_at) values
 (pg_temp.uid(101),1,pg_temp.uid(301),pg_temp.uid(2),'Fictional doctor','doctor','contact','awaiting-doctor','awaiting-doctor',pg_temp.uid(2),'PRIVATE CONTACT NOTE','{"input":{"note":"PRIVATE DETAIL"}}','2026-11-07 13:20:00+00'),
 (pg_temp.uid(101),2,pg_temp.uid(302),pg_temp.uid(2),'Fictional doctor','doctor','resolve','awaiting-doctor','completed',pg_temp.uid(2),'Fictional resolution','{}','2026-11-07 14:00:00+00'),
 (pg_temp.uid(101),3,pg_temp.uid(303),pg_temp.uid(2),'Fictional doctor','doctor','reassign','completed','completed',pg_temp.uid(2),'PRIVATE LATER NOTE','{}','2026-11-07 14:01:00+00'),
 (pg_temp.uid(102),3,pg_temp.uid(304),pg_temp.uid(2),'Fictional doctor','doctor','cancel','awaiting-doctor','cancelled',pg_temp.uid(2),'Fictional cancellation','{}','2026-11-07 14:02:00+00'),
 (pg_temp.uid(103),1,pg_temp.uid(305),pg_temp.uid(2),'Fictional doctor','doctor','resolve','awaiting-doctor','completed',pg_temp.uid(2),'PRIVATE OLD RESOLUTION','{}','2026-11-07 13:10:00+00');

select pg_temp.claims(3);set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.nurse_sent_handoffs()->'items')=50,'Bounded to latest fifty own handoffs');
select pg_temp.ok((public.nurse_sent_handoffs()->>'hasMore')::boolean,'Older handoffs disclosed');
select pg_temp.ok(public.nurse_sent_handoffs()#>>'{items,0,taskId}'=pg_temp.uid(101)::text,'Newest first even when completed');
select pg_temp.ok(public.nurse_sent_handoffs()#>>'{items,1,status}'='cancelled','Doctor task status retained');
select pg_temp.ok(public.nurse_sent_handoffs()#>>'{items,0,resolution,note}'='Fictional resolution','Only terminal resolution, not later history note');
select pg_temp.ok(public.nurse_sent_handoffs()#>>'{items,0,resolution,by}'='Fictional doctor','Resolution author');
select pg_temp.ok((public.nurse_sent_handoffs()#>>'{items,0,resolution,at}')::timestamptz='2026-11-07 14:00:00+00','Resolution time');
select pg_temp.ok(public.nurse_sent_handoffs()#>>'{items,1,resolution,note}'='Fictional cancellation','Cancellation resolution');
select pg_temp.ok(public.nurse_sent_handoffs()#>'{items,2,resolution}'='null'::jsonb,'Reopened work has no old resolution');
select pg_temp.ok(public.nurse_sent_handoffs()#>>'{items,0,member,birthDate}'='1980-04-03' and public.nurse_sent_handoffs()#>>'{items,0,member,phoneLast4}'='1234','Same masked member identity');
select pg_temp.ok(public.nurse_sent_handoffs()::text not like '%PRIVATE%' and public.nurse_sent_handoffs()::text not like '%37499001234%','No other notes, source messages, detail or full phone');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.nurse_sent_handoffs()->'items') i
 where (select array_agg(k order by k) from jsonb_object_keys(i) k)<>array['member','observation','resolution','sentAt','status','taskId','topic']),'Exact exposed fields');
reset role;

select pg_temp.claims(4);set local role authenticated;
select pg_temp.ok(public.nurse_sent_handoffs()->'items'='[]','Unassigned nurse cannot read even her own old handoff');
reset role;
update public.patient_clinical_cases set assigned_nurse_id=pg_temp.uid(4) where user_id=pg_temp.uid(1);
select pg_temp.claims(3);set local role authenticated;
select pg_temp.ok(public.nurse_sent_handoffs()->'items'='[]','Creator loses read access after member reassignment');
reset role;
select pg_temp.claims(4);set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.nurse_sent_handoffs()->'items')=1 and public.nurse_sent_handoffs()#>>'{items,0,taskId}'=pg_temp.uid(152)::text,'Assigned second nurse sees only her own handoff, none of the first nurse''s');
reset role;

select pg_temp.claims(2);set local role authenticated;
select pg_temp.ok(public.real_clinical_staff_identity()->>'role'='doctor','Doctor has a current staff session');
do $$begin perform public.nurse_sent_handoffs();raise exception 'Doctor was allowed';exception when insufficient_privilege then
 perform pg_temp.ok(sqlstate='42501' and sqlerrm='Current nurse access required','Doctor receives no member, observation or resolution data');end $$;
reset role;
select pg_temp.claims(5);set local role authenticated;
select pg_temp.ok(public.real_clinical_staff_identity()->>'role'='admin','Admin has a current staff session');
do $$begin perform public.nurse_sent_handoffs();raise exception 'Admin was allowed';exception when insufficient_privilege then
 perform pg_temp.ok(sqlstate='42501' and sqlerrm='Current nurse access required','Admin receives no member, observation or resolution data');end $$;
reset role;

-- A refusal must raise before returning any JSON, including member identity, observation or resolution note.
select pg_temp.claims(6);set local role authenticated;
select pg_temp.ok(public.clinic_portal_identity(pg_temp.uid(9))#>>'{identity,capability}'='clinic_admin','Clinic admin has a current portal session');
do $$begin perform public.nurse_sent_handoffs();raise exception 'Clinic admin was allowed';exception when insufficient_privilege then
 perform pg_temp.ok(sqlstate='42501' and sqlerrm='Current nurse access required','Clinic admin receives no member, observation or resolution data');end $$;
reset role;
select pg_temp.claims(7);set local role authenticated;
select pg_temp.ok(public.clinic_portal_identity(pg_temp.uid(9))#>>'{identity,capability}'='clinic_staff','Clinic staff has a current portal session');
do $$begin perform public.nurse_sent_handoffs();raise exception 'Clinic staff was allowed';exception when insufficient_privilege then
 perform pg_temp.ok(sqlstate='42501' and sqlerrm='Current nurse access required','Clinic staff receives no member, observation or resolution data');end $$;
reset role;
select pg_temp.claims(1);set local role authenticated;
do $$begin perform public.nurse_sent_handoffs();raise exception 'Member was allowed';exception when insufficient_privilege then null;end $$;
reset role;
select pg_temp.claims(4);
update public.nurse_chat_settings set enabled=false where singleton;
set local role authenticated;
do $$begin perform public.nurse_sent_handoffs();raise exception 'Dark read was allowed';exception when insufficient_privilege then null;end $$;
reset role;
update public.nurse_chat_settings set enabled=true where singleton;
delete from auth.sessions where id=pg_temp.uid(14);
set local role authenticated;
do $$begin perform public.nurse_sent_handoffs();raise exception 'Expired session was allowed';exception when insufficient_privilege then null;end $$;
reset role;
set local role anon;
do $$begin perform public.nurse_sent_handoffs();raise exception 'Anon was allowed';exception when insufficient_privilege then
 perform pg_temp.ok(sqlstate='42501' and sqlerrm='permission denied for function nurse_sent_handoffs','Anon is denied EXECUTE');end $$;
reset role;
set local role service_role;
do $$begin perform public.nurse_sent_handoffs();raise exception 'Service role was allowed';exception when insufficient_privilege then
 perform pg_temp.ok(sqlstate='42501' and sqlerrm='permission denied for function nurse_sent_handoffs','Service role is denied EXECUTE');end $$;
reset role;
select pg_temp.ok(has_function_privilege('authenticated','public.nurse_sent_handoffs()','execute')
 and not has_function_privilege('anon','public.nurse_sent_handoffs()','execute')
 and not has_function_privilege('service_role','public.nurse_sent_handoffs()','execute'),'Only authenticated has EXECUTE among API roles');
select pg_temp.ok((select provolatile='v' and prosecdef from pg_proc where oid='public.nurse_sent_handoffs()'::regprocedure),'Volatile security definer read');
rollback;
