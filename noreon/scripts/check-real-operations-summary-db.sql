\set ON_ERROR_STOP on
-- Local integration database only. All fixtures and truncation roll back.
begin;
truncate public.patient_clinical_cases cascade;
create temp table operations_fixture as select gen_random_uuid() a,gen_random_uuid() d,gen_random_uuid() n,gen_random_uuid() c,gen_random_uuid() sa,gen_random_uuid() sd,gen_random_uuid() sn;
grant select on operations_fixture to authenticated;
insert into auth.users(id,email) select u,u||'@example.invalid' from operations_fixture cross join lateral unnest(array[a,d,n]) u;
insert into public.workspace_clinics(id,name) select c,'Operations fixture clinic' from operations_fixture;
insert into public.workspace_staff(user_id,role,display_name,clinic_id) select a,'admin','Admin',null from operations_fixture union all select d,'doctor','Doctor',c from operations_fixture union all select n,'nurse','Nurse',c from operations_fixture;
insert into auth.sessions(id,user_id,created_at,updated_at) select sa,a,now(),now() from operations_fixture union all select sd,d,now(),now() from operations_fixture union all select sn,n,now(),now() from operations_fixture;
create function pg_temp.operations_login(who text) returns void language plpgsql as $$declare f record;u uuid;s uuid;begin
 select * into f from operations_fixture;u:=case who when 'admin' then f.a when 'doctor' then f.d when 'nurse' then f.n end;s:=case who when 'admin' then f.sa when 'doctor' then f.sd when 'nurse' then f.sn end;
 perform set_config('request.jwt.claim.sub',coalesce(u::text,''),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated','session_id',s,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
select pg_temp.operations_login('admin');set local role authenticated;
do $$declare r jsonb;begin r:=public.real_admin_operations_summary();
 if r->'cases'<>'{"total":0,"doctorAssigned":0,"doctorUnassigned":0,"nurseAssigned":0,"nurseUnassigned":0}'::jsonb or r#>>'{bookings,total}'<>'0' or r#>>'{coordination,total}'<>'0' or r->>'asOf' is null then raise exception 'TEST exact zero snapshot';end if;
end$$;
reset role;
-- An arbitrary demo case must not affect any native count.
insert into public.workspace_cases(state) values('{"operationsFixture":true}');
create temp table operations_members as select n,gen_random_uuid() id from generate_series(1,205) n;
insert into auth.users(id,email) select id,id||'@example.invalid' from operations_members;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id) select m.id,f.d,f.n from operations_members m cross join operations_fixture f where m.n=1;
select pg_temp.operations_login('admin');set local role authenticated;
do $$declare r jsonb;begin r:=public.real_admin_operations_summary();
 if r->'cases'<>'{"total":1,"doctorAssigned":1,"doctorUnassigned":0,"nurseAssigned":1,"nurseUnassigned":0}'::jsonb then raise exception 'TEST exact one native case, excluding demo';end if;
end$$;
reset role;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id) select m.id,case when m.n%2=0 then f.d end from operations_members m cross join operations_fixture f where m.n>1;
insert into public.patient_test_requests(id,user_id,status,requested_terms,requirements,algorithm_version,context_token,create_payload)
 select gen_random_uuid(),id,(array['requested','provider-proposed','confirmed','change-pending','cancelled'])[(n-1)%5+1],'{}','{}','fixture','fixture','{}' from operations_members;
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,status)
 select gen_random_uuid(),m.id,case when (m.n-1)%5=2 then 'doctor-referral' else 'contact-followup' end,'Fixture task','Operational fixture',f.d,case when m.n=1 then f.n else f.d end,(array['open','awaiting-member','awaiting-doctor','completed','cancelled'])[(m.n-1)%5+1] from operations_members m cross join operations_fixture f;
select pg_temp.operations_login('admin');set local role authenticated;
do $$declare r jsonb;begin r:=public.real_admin_operations_summary();
 if r->'cases'<>'{"total":205,"doctorAssigned":103,"doctorUnassigned":102,"nurseAssigned":1,"nurseUnassigned":204}'::jsonb then raise exception 'TEST exact counts beyond 200 cases';end if;
 if r->'bookings'<>'{"total":205,"requested":41,"providerProposed":41,"confirmed":41,"changePending":41,"cancelled":41}'::jsonb then raise exception 'TEST all booking statuses';end if;
 -- 61 unfinished tasks have no assigned doctor; completed/cancelled are excluded.
 if r->'coordination'<>'{"total":205,"open":41,"awaitingMember":41,"awaitingDoctor":41,"completed":41,"cancelled":41,"needsReassignment":61}'::jsonb then raise exception 'TEST exact coordination beyond page, reassignment uses existing authority: %',r->'coordination';end if;
end$$;
reset role;
update public.workspace_staff set active=false where user_id=(select n from operations_fixture);
select pg_temp.operations_login('admin');set local role authenticated;
do $$begin if public.real_admin_operations_summary()#>>'{coordination,needsReassignment}'<>'62' then raise exception 'TEST inactive owner requires reassignment';end if;end$$;
reset role;
-- Direct RPC calls must fail for every non-admin role and absent identity.
update public.workspace_staff set active=true where user_id=(select n from operations_fixture);
set local role authenticated;
do $$declare who text;begin
 foreach who in array array['doctor','nurse','none'] loop
  perform pg_temp.operations_login(who);
  begin perform public.real_admin_operations_summary();raise exception 'TEST non-admin read allowed: %',who;exception when insufficient_privilege then null;end;
 end loop;
end$$;
reset role;
update auth.sessions set not_after=now()-interval '1 minute' where id=(select sa from operations_fixture);
select pg_temp.operations_login('admin');set local role authenticated;
do $$begin begin perform public.real_admin_operations_summary();raise exception 'TEST expired admin session read allowed';exception when insufficient_privilege then null;end;end$$;
reset role;
do $$begin
 if has_function_privilege('anon','public.real_admin_operations_summary()','EXECUTE') or has_function_privilege('service_role','public.real_admin_operations_summary()','EXECUTE') then raise exception 'TEST RPC grant leak';end if;
end$$;
rollback;
