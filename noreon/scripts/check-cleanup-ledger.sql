\set ON_ERROR_STOP on
begin;
do $$
begin
 if has_table_privilege('authenticated','public.cleanup_runs','SELECT') or has_table_privilege('service_role','public.cleanup_runs','INSERT') then raise exception 'Direct ledger access';end if;
 if has_function_privilege('authenticated','public.cleanup_run_start(uuid)','EXECUTE') or has_function_privilege('anon','public.real_admin_cleanup_runs(timestamptz,uuid)','EXECUTE') then raise exception 'RPC grant leak';end if;
 if not has_function_privilege('service_role','public.cleanup_run_start(uuid)','EXECUTE') then raise exception 'Missing writer grant';end if;
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='cleanup_runs')<>9 then raise exception 'Unexpected ledger fields';end if;
 if not (select relrowsecurity from pg_class where oid='public.cleanup_runs'::regclass) then raise exception 'RLS missing';end if;
end $$;
set local role service_role;
select public.cleanup_run_start('ca000000-0000-4000-8000-000000000001');
select public.cleanup_run_start('ca000000-0000-4000-8000-000000000002');
select public.cleanup_run_start('ca000000-0000-4000-8000-000000000003');
select public.cleanup_run_finish('ca000000-0000-4000-8000-000000000001',0,0,0,null);
select public.cleanup_run_finish('ca000000-0000-4000-8000-000000000002',1,0,1,'storage');
reset role;
do $$begin
 if (select count(*) from public.cleanup_runs where run_id::text like 'ca000000%')<>3 then raise exception 'Concurrent starts clobbered';end if;
 if not exists(select from public.cleanup_runs where run_id='ca000000-0000-4000-8000-000000000003' and status='running' and ended_at is null) then raise exception 'Missing incomplete run';end if;
 if not exists(select from public.cleanup_runs where run_id='ca000000-0000-4000-8000-000000000001' and status='succeeded' and attempted=0) then raise exception 'Empty run not success';end if;
end $$;
set local role authenticated;
do $$begin
 begin perform public.real_admin_cleanup_runs();raise exception 'Anonymous identity read allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
-- Current-role safe reads, including live-session claims for the stricter admin gate.
begin;
insert into auth.users(id,email,email_confirmed_at) select ('ce000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'cleanup-role-'||n||'@example.test',clock_timestamp() from generate_series(1,5) n;
insert into auth.sessions(id,user_id,created_at,updated_at) select ('cf000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('ce000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,clock_timestamp(),clock_timestamp() from generate_series(1,5) n;
insert into public.workspace_clinics(id,name) values('ce000000-0000-4000-8000-000000000009','Cleanup SQL fixture');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active) values
 ('ce000000-0000-4000-8000-000000000001','admin','Admin',null,true),
 ('ce000000-0000-4000-8000-000000000002','doctor','Doctor','ce000000-0000-4000-8000-000000000009',true),
 ('ce000000-0000-4000-8000-000000000003','nurse','Nurse','ce000000-0000-4000-8000-000000000009',true),
 ('ce000000-0000-4000-8000-000000000004','admin','Inactive',null,false);
set local role authenticated;
do $$declare n integer;result jsonb;
begin
 for n in 1..5 loop
  perform set_config('request.jwt.claim.sub','ce000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','ce000000-0000-4000-8000-'||lpad(n::text,12,'0'),'session_id','cf000000-0000-4000-8000-'||lpad(n::text,12,'0'),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
  if n=1 then result:=public.real_admin_cleanup_runs();if jsonb_typeof(result)<>'array' or jsonb_array_length(result)>50 then raise exception 'Read shape';end if;
  else begin perform public.real_admin_cleanup_runs();raise exception 'Nonadmin read allowed';exception when insufficient_privilege then null;end;end if;
 end loop;
end $$;
reset role;
rollback;
