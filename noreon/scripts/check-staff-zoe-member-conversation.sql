-- Isolated local/CI database only. Fixtures and configuration changes roll back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.member_conversation_actor(id uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,
  'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
create function pg_temp.member_conversation_ok(ok boolean,label text)returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Member conversation check failed: %',label;end if;
end$$;
do $$declare clinic uuid:=gen_random_uuid();owner uuid:=gen_random_uuid();second_doctor uuid:=gen_random_uuid();
 outsider uuid:=gen_random_uuid();nurse uuid:=gen_random_uuid();member uuid:=gen_random_uuid();other_member uuid:=gen_random_uuid();
 old_conversation uuid:=gen_random_uuid();latest uuid:=gen_random_uuid();u uuid;begin
 perform set_config('test.mc_owner',owner::text,true);
 perform set_config('test.mc_second',second_doctor::text,true);
 perform set_config('test.mc_outsider',outsider::text,true);
 perform set_config('test.mc_nurse',nurse::text,true);
 perform set_config('test.mc_member',member::text,true);
 perform set_config('test.mc_latest',latest::text,true);
 insert into public.workspace_clinics(id,name)values(clinic,'Synthetic conversation clinic');
 foreach u in array array[owner,second_doctor,outsider,nurse,member,other_member]loop
  insert into auth.users(id,email)values(u,u||'@example.invalid');
 end loop;
 foreach u in array array[owner,second_doctor,outsider,nurse]loop
  insert into auth.sessions(id,user_id,created_at,updated_at)values(u,u,clock_timestamp(),clock_timestamp());
 end loop;
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
  (owner,'doctor','Synthetic owner',clinic),(second_doctor,'doctor','Synthetic second doctor',clinic),
  (outsider,'doctor','Synthetic unassigned doctor',clinic),(nurse,'nurse','Synthetic nurse',clinic);
 insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(member,owner,nurse),(other_member,owner,null);
 -- Latest means last activity, not creation, and includes conversations without messages.
 insert into public.staff_zoe_conversations(id,staff_id,member_id,created_at,last_at)values
  (old_conversation,owner,member,'2026-10-02','2026-10-03'),
  (latest,owner,member,'2026-10-01','2026-10-04'),
  (gen_random_uuid(),owner,other_member,'2026-10-05','2026-10-05'),
  (gen_random_uuid(),nurse,member,'2026-10-06','2026-10-06');
 update public.staff_zoe_settings set staff_zoe_enabled=true where singleton;
end$$;

select pg_temp.member_conversation_ok(has_function_privilege('authenticated','public.staff_zoe_member_conversation(uuid)','execute'),'authenticated can execute');
select pg_temp.member_conversation_ok(not has_function_privilege('anon','public.staff_zoe_member_conversation(uuid)','execute'),'anon has no grant');
select pg_temp.member_conversation_ok(not has_function_privilege('service_role','public.staff_zoe_member_conversation(uuid)','execute'),'service role has no grant');
select pg_temp.member_conversation_ok((select prosecdef and provolatile='s' and proconfig=array['search_path=""']
 from pg_proc where oid='public.staff_zoe_member_conversation(uuid)'::regprocedure),'stable SECURITY DEFINER with empty search_path');

-- No conversation, message, run or audit row may be written by this lookup.
create temp table mc_before as select
 (select count(*) from public.staff_zoe_conversations) conversations,
 (select count(*) from public.staff_zoe_messages) messages,
 (select count(*) from public.staff_zoe_runs) runs,
 (select count(*) from public.access_audit) audits;
set local role authenticated;
select pg_temp.member_conversation_actor(current_setting('test.mc_owner')::uuid);
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(current_setting('test.mc_member')::uuid)
 is not distinct from current_setting('test.mc_latest')::uuid,'owner gets latest own conversation for this member');
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(gen_random_uuid()) is null,'unknown member returns null');
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(null) is null,'null member returns null');
select pg_temp.member_conversation_actor(current_setting('test.mc_second')::uuid);
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(current_setting('test.mc_member')::uuid) is null,'second doctor gets null');
select pg_temp.member_conversation_actor(current_setting('test.mc_outsider')::uuid);
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(current_setting('test.mc_member')::uuid) is null,'unassigned doctor gets null');
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(gen_random_uuid()) is null,'unassigned and unknown are indistinguishable');
select pg_temp.member_conversation_actor(current_setting('test.mc_nurse')::uuid);
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(current_setting('test.mc_member')::uuid) is null,'assigned nurse with own conversation gets null');
reset role;

-- Isolate ownership from assignment: a newly assigned doctor cannot inherit the former doctor's history.
update public.patient_clinical_cases set assigned_doctor_id=current_setting('test.mc_second')::uuid
 where user_id=current_setting('test.mc_member')::uuid;
set local role authenticated;
select pg_temp.member_conversation_actor(current_setting('test.mc_second')::uuid);
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(current_setting('test.mc_member')::uuid) is null,'assigned second doctor has no own conversation');
select pg_temp.member_conversation_actor(current_setting('test.mc_owner')::uuid);
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(current_setting('test.mc_member')::uuid) is null,'former owner loses access');
reset role;
update public.patient_clinical_cases set assigned_doctor_id=current_setting('test.mc_owner')::uuid
 where user_id=current_setting('test.mc_member')::uuid;
update public.staff_zoe_settings set staff_zoe_enabled=false where singleton;
set local role authenticated;
select pg_temp.member_conversation_ok(public.staff_zoe_member_conversation(current_setting('test.mc_member')::uuid) is null,'disabled Zoe returns null');
reset role;

set local role anon;
do $$begin
 begin
  perform public.staff_zoe_member_conversation(current_setting('test.mc_member')::uuid);
  raise exception 'Anon unexpectedly executed member conversation lookup';
 exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.member_conversation_ok(
 (select conversations=(select count(*) from public.staff_zoe_conversations)
  and messages=(select count(*) from public.staff_zoe_messages)
  and runs=(select count(*) from public.staff_zoe_runs)
  and audits=(select count(*) from public.access_audit) from mc_before),'lookups write no data');
rollback;
