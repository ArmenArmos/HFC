-- No exposed STABLE or IMMUTABLE function may reach a row or table lock, an advisory lock or a write.
-- PostgREST runs a non-volatile function in a read-only transaction, so the first FOR SHARE or write on
-- the way fails with 25006 and the screen shows "Not given" or an empty list instead of the data. The SQL
-- checks run read-write and never see it (care_alert_routing_read, clinic_member_masked, 5 Nov).
-- A self-test first plants a stable RPC that locks through a helper and proves the scan finds it and that
-- it really fails read-only with 25006. Everything is rolled back. Run after a clean replay with
-- psql -f scripts/check-stable-functions-no-locks.sql.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.stable_lock_hits()returns text language sql as $$
 with recursive f as (
  select p.oid,p.proname,p.provolatile,
   -- Comments removed so a mention of "for update" in prose is not a hit.
   regexp_replace(regexp_replace(p.prosrc,'/\*.*?\*/','','g'),'--[^\n]*','','g') as body
  from pg_proc p
  where p.pronamespace='public'::regnamespace and p.prokind='f'
   and p.prolang in(select oid from pg_language where lanname in('plpgsql','sql'))
   and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
 ), direct as (
  select proname from f
  where body ~* 'for\s+(no\s+key\s+|key\s+)?(update|share)\y'
   or body ~* '\ylock\s+(table\s+)?(only\s+)?[a-z_."]+(\s*,\s*[a-z_."]+)*\s+in\y'
   or body ~* 'pg_(try_)?advisory_(xact_)?lock'
   or body ~* '\y(insert\s+into|delete\s+from|merge\s+into)\s'
   or body ~* '\yupdate\s+(only\s+)?(public\.)?"?[a-z_]+"?(\s+(as\s+)?[a-z_]+)?\s+set\y'
   or body ~* '\ytruncate\y'
   or body ~* '\ynextval\s*\('
 ), edges as (
  -- A call is a name followed by "(". Overloads share a name, which only makes the test stricter.
  select distinct a.proname as caller,b.proname as callee
  from f a cross join lateral regexp_matches(a.body,'([a-z_][a-z0-9_]*)\s*\(','gi') m(t)
  join f b on b.proname=lower(m.t[1]) and b.proname<>a.proname
 ), reach(name) as (
  select proname from direct
  union
  select e.caller from edges e join reach r on r.name=e.callee
 )
 select string_agg(distinct f.oid::regprocedure::text,', ')
 from f join reach r on r.name=f.proname
 where f.provolatile in('s','i')
  -- Only what PostgREST can call. Internal helpers granted to postgres alone are reached from volatile callers.
  and (has_function_privilege('anon',f.oid,'execute') or has_function_privilege('authenticated',f.oid,'execute')
   or has_function_privilege('service_role',f.oid,'execute'))
$$;

-- Self-test: the scan matches what PostgREST does.
create table public.stable_lock_probe(id int primary key);
insert into public.stable_lock_probe values(1);
create function public.stable_lock_probe_lock()returns int language sql volatile as $$select id from public.stable_lock_probe for share$$;
create function public.stable_lock_probe_read()returns int language plpgsql stable as $$begin return public.stable_lock_probe_lock();end$$;
grant execute on function public.stable_lock_probe_read() to authenticated;
select pg_temp.ok(coalesce(pg_temp.stable_lock_hits(),'') like '%stable_lock_probe_read()%','Scan finds a stable RPC that locks through a helper');
do $$declare state text;begin
 begin
  set local transaction_read_only=on;
  perform public.stable_lock_probe_read();
  state:='ran';
 exception when others then state:=sqlstate;
 end;
 perform pg_temp.ok(state='25006','Planted RPC fails read-only with 25006, got '||coalesce(state,'null'));
end$$;
alter function public.stable_lock_probe_read() volatile;
select pg_temp.ok(coalesce(pg_temp.stable_lock_hits(),'') not like '%stable_lock_probe_read()%','A volatile RPC is not a hit');
drop function public.stable_lock_probe_read(),public.stable_lock_probe_lock();
drop table public.stable_lock_probe;

-- The real check.
do $$declare bad text:=pg_temp.stable_lock_hits();begin
 perform pg_temp.ok(bad is null,'These exposed functions are declared stable but reach a lock or a write (25006 under PostgREST); make them volatile: '||coalesce(bad,''));
end$$;
select 'PASS stable functions: none of the exposed stable or immutable functions reaches a row, table or advisory lock or a write' as result;
rollback;
