-- Browser roles and public functions (quality review item 52). Functions are EXECUTE-able by PUBLIC
-- unless a migration revokes it, and until now only per-migration prefix loops caught a missed revoke.
-- Trigger functions are harmless to grant (they refuse a direct call). Everything else:
--  * anon may execute nothing but the allow-list below;
--  * authenticated may execute no internal helper (name starting with _) but the allow-list below.
-- A new function that needs one of these grants is added here with the reason, in the same PR.
\set ON_ERROR_STOP on
begin;
create function pg_temp.grant_violations()returns text language sql as $$
 select string_agg(x,'; 'order by x)from(
  select 'anon can execute '||p.oid::regprocedure::text x
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and p.prokind='f'and p.prorettype<>'trigger'::regtype
   and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
   and has_function_privilege('anon',p.oid,'execute')
   and p.oid::regprocedure::text not in(
    -- Table check constraint on patient_care_medications.times (evaluated as the writer).
    'valid_care_times(time without time zone[])')
  union all
  select 'authenticated can execute internal helper '||p.oid::regprocedure::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'and p.prokind='f'and p.prorettype<>'trigger'::regtype and p.proname like '\_%'
   and not exists(select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
   and has_function_privilege('authenticated',p.oid,'execute')
   and p.proname not in(
    -- Table check constraint on member_medicines.times (evaluated as the writer).
    '_member_medicine_times_ok',
    -- RLS policy helpers: a policy expression runs with the querying role's privileges.
    '_member_history_reader','_gp_report_reader','_member_upload_value_member_visible'))v
$$;
do $$begin if pg_temp.grant_violations()is not null then raise exception 'Function grants: %',pg_temp.grant_violations();end if;end$$;

-- Results evidence is available only through the authenticated assigned-doctor RPC.
do $$begin
 if not has_function_privilege('authenticated','public.doctor_result_entry_save(uuid,text,numeric,text,date,uuid)','execute')
 or has_function_privilege('anon','public.doctor_result_entry_save(uuid,text,numeric,text,date,uuid)','execute')
 or has_function_privilege('service_role','public.doctor_result_entry_save(uuid,text,numeric,text,date,uuid)','execute')then
  raise exception 'Result entry function grants are incorrect';
 end if;
end$$;

-- The guard itself: a new helper left with the default PUBLIC grant is reported.
create function public._function_grant_regression_probe()returns integer language sql as $$select 1$$;
do $$begin
 if coalesce(pg_temp.grant_violations(),'')not like '%anon can execute _function_grant_regression_probe()%'
 or pg_temp.grant_violations()not like '%authenticated can execute internal helper _function_grant_regression_probe()%'
 then raise exception 'Function grant guard missed the probe';end if;
end$$;
rollback;
