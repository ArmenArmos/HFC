\set ON_ERROR_STOP on
-- Job ledger (supabase/migrations/*_job_ledger.sql): only the service role writes it, through two RPCs;
-- only admins read it; a run finishes once; rows carry codes and numbers, not text.
begin;
do $$
begin
 if has_table_privilege('authenticated','public.job_runs','SELECT') or has_table_privilege('anon','public.job_runs','SELECT')
  or has_table_privilege('service_role','public.job_runs','INSERT') or has_table_privilege('service_role','public.job_runs','SELECT') then raise exception 'Direct ledger access';end if;
 if has_function_privilege('authenticated','public.job_run_start(text,text,integer)','EXECUTE') or has_function_privilege('anon','public.job_run_finish(uuid,text,text,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','public.job_run_finish(uuid,text,text,jsonb)','EXECUTE') or has_function_privilege('anon','public.real_admin_job_runs(text,integer)','EXECUTE')
  or has_function_privilege('service_role','public.real_admin_job_runs(text,integer)','EXECUTE') then raise exception 'RPC grant leak';end if;
 if not has_function_privilege('service_role','public.job_run_start(text,text,integer)','EXECUTE') or not has_function_privilege('service_role','public.job_run_finish(uuid,text,text,jsonb)','EXECUTE') then raise exception 'Missing writer grant';end if;
 if not (select relrowsecurity from pg_class where oid='public.job_runs'::regclass) then raise exception 'RLS missing';end if;
 if exists(select from pg_policies where schemaname='public' and tablename='job_runs') then raise exception 'Unexpected policy';end if;
end $$;

set local role service_role;
do $$declare a uuid;b uuid;c uuid;
begin
 a:=public.job_run_start('zoe_run','cron',120);
 b:=public.job_run_start('zoe_run','request',120);
 c:=public.job_run_start('lab_ai','cron',300);
 if a is null or a=b then raise exception 'Starts collide';end if;
 if not public.job_run_finish(a,'ok',null,'{"claimed":1}') then raise exception 'First finish refused';end if;
 if public.job_run_finish(a,'error','zoe_run_failed','{}') then raise exception 'Second finish overwrote';end if;
 if not public.job_run_finish(b,'partial','zoe_job_failed','{"failed":1}') then raise exception 'Partial refused';end if;
 -- Rejected shapes: bad name, trigger, outcome, error text, an error code on a success, oversized counts, limits.
 begin perform public.job_run_start('Zoe Run','cron',60);raise exception 'Bad job name accepted';exception when check_violation then null;end;
 begin perform public.job_run_start('zoe_run','manual',60);raise exception 'Bad trigger accepted';exception when check_violation then null;end;
 begin perform public.job_run_start('zoe_run','cron',0);raise exception 'Zero limit accepted';exception when raise_exception then if sqlerrm<>'Invalid job limit' then raise; end if;end;
 begin perform public.job_run_start('zoe_run','cron',901);raise exception 'Long limit accepted';exception when raise_exception then if sqlerrm<>'Invalid job limit' then raise; end if;end;
 begin perform public.job_run_finish(c,'done',null,'{}');raise exception 'Bad outcome accepted';exception when check_violation then null;end;
 begin perform public.job_run_finish(c,'error','Member Ani has chest pain',null);raise exception 'Free text error accepted';exception when check_violation then null;end;
 begin perform public.job_run_finish(c,'ok','lab_sweep_failed','{}');raise exception 'Error code on success accepted';exception when check_violation then null;end;
 begin perform public.job_run_finish(c,'ok',null,jsonb_build_object('x',repeat('a',5000)));raise exception 'Oversized counts accepted';exception when check_violation then null;end;
 begin perform public.job_run_finish(c,'ok',null,'[1,2]');raise exception 'Array counts accepted';exception when check_violation then null;end;
end $$;
reset role;
do $$begin
 -- Only this transaction's rows (started at or after its start), so existing ledger rows do not matter.
 if (select count(*) from public.job_runs where job='zoe_run' and outcome is not null and started_at>=now())<>2 then raise exception 'Finishes missing';end if;
 if exists(select from public.job_runs where finished_at is not null and (duration_ms is null or finished_at<started_at)) then raise exception 'Duration missing';end if;
 if not exists(select from public.job_runs where job='lab_ai' and finished_at is null and started_at>=now()) then raise exception 'Failed finishes changed the run';end if;
end $$;

-- Purge: a job's own rows older than 30 days go when it starts again; other jobs' rows stay.
insert into public.job_runs(job,trigger,started_at,deadline_at,finished_at,outcome,duration_ms)
values ('zoe_run','cron',now()-interval '31 days',now()-interval '31 days'+interval '1 minute',now()-interval '31 days'+interval '1 second','ok',1000),
       ('lab_ai','cron',now()-interval '31 days',now()-interval '31 days'+interval '5 minutes',now()-interval '31 days'+interval '1 second','ok',1000);
set local role service_role;
select public.job_run_start('zoe_run','cron',60) is not null as started;
reset role;
do $$begin
 if exists(select from public.job_runs where job='zoe_run' and started_at<now()-interval '30 days') then raise exception 'Old rows kept';end if;
 if not exists(select from public.job_runs where job='lab_ai' and started_at<now()-interval '30 days') then raise exception 'Other job purged';end if;
end $$;
-- A run past its deadline with no finish is "lost".
insert into public.job_runs(id,job,trigger,started_at,deadline_at) values ('1a000000-0000-4000-8000-000000000001','telegram_dispatch','cron',now()-interval '10 minutes',now()-interval '9 minutes');
set local role authenticated;
do $$begin
 begin perform public.real_admin_job_runs();raise exception 'Anonymous identity read allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;

-- Admin reads only, with the same live-session claims as the other admin gates.
begin;
-- Start from an empty ledger inside this rolled-back transaction, so the health counts are exact.
delete from public.job_runs;
insert into auth.users(id,email,email_confirmed_at) select ('1b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'job-ledger-'||n||'@example.test',clock_timestamp() from generate_series(1,4) n;
insert into auth.sessions(id,user_id,created_at,updated_at) select ('1c000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('1b000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,clock_timestamp(),clock_timestamp() from generate_series(1,4) n;
insert into public.workspace_clinics(id,name) values('1b000000-0000-4000-8000-000000000009','Job ledger SQL fixture');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active) values
 ('1b000000-0000-4000-8000-000000000001','admin','Admin',null,true),
 ('1b000000-0000-4000-8000-000000000002','doctor','Doctor','1b000000-0000-4000-8000-000000000009',true),
 ('1b000000-0000-4000-8000-000000000003','nurse','Nurse','1b000000-0000-4000-8000-000000000009',true),
 ('1b000000-0000-4000-8000-000000000004','admin','Inactive',null,false);
insert into public.job_runs(id,job,trigger,started_at,deadline_at) values ('1a000000-0000-4000-8000-000000000002','telegram_dispatch','cron',now()-interval '10 minutes',now()-interval '9 minutes');
insert into public.job_runs(job,trigger,started_at,deadline_at,finished_at,outcome,error_code,duration_ms) values
 ('zoe_run','cron',now()-interval '2 minutes',now()+interval '1 minute',now()-interval '1 minute','error','zoe_run_failed',60000),
 ('zoe_run','request',now()-interval '3 minutes',now()+interval '1 minute',now()-interval '170 seconds','ok',null,10000);
set local role authenticated;
do $$declare n integer;result jsonb;z jsonb;
begin
 for n in 1..4 loop
  perform set_config('request.jwt.claim.sub','1b000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','1b000000-0000-4000-8000-'||lpad(n::text,12,'0'),'session_id','1c000000-0000-4000-8000-'||lpad(n::text,12,'0'),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
  if n=1 then
   result:=public.real_admin_job_runs(null,50);
   if jsonb_typeof(result->'jobs')<>'array' or jsonb_typeof(result->'runs')<>'array' or jsonb_array_length(result->'runs')>50 then raise exception 'Read shape';end if;
   if (select r->>'status' from jsonb_array_elements(result->'runs') r where r->>'id'='1a000000-0000-4000-8000-000000000002')<>'lost' then raise exception 'Lost run not shown';end if;
   select j into z from jsonb_array_elements(result->'jobs') j where j->>'job'='zoe_run';
   if (z->>'runs_24h')::int<>2 or (z->>'errors_24h')::int<>1 or z->>'last_ok_at' is null or z->>'last_error_at' is null or (z->>'p95_ms_24h')::int<>60000 then raise exception 'Zoe health wrong: %',z;end if;
   select j into z from jsonb_array_elements(result->'jobs') j where j->>'job'='telegram_dispatch';
   if (z->>'lost_24h')::int<>1 then raise exception 'Lost count wrong: %',z;end if;
   if jsonb_array_length(public.real_admin_job_runs('zoe_run',200)->'runs')<>2 then raise exception 'Job filter';end if;
   begin perform public.real_admin_job_runs(null,201);raise exception 'Unbounded read allowed';exception when raise_exception then if sqlerrm<>'Invalid limit' then raise;end if;end;
  else begin perform public.real_admin_job_runs();raise exception 'Nonadmin read allowed';exception when insufficient_privilege then null;end;end if;
 end loop;
end $$;
reset role;
rollback;
