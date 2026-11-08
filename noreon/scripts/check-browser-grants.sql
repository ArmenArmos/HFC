begin;
do $$
declare t record; r text; p text;
begin
 for t in select tablename from pg_tables where schemaname='public' loop
  foreach r in array array['anon','authenticated'] loop
   foreach p in array (array['INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES'] || case when current_setting('server_version_num')::integer>=170000 then array['MAINTAIN'] else array[]::text[] end) loop
    if has_table_privilege(r,format('public.%I',t.tablename),p) then raise exception 'Browser role % retains % on %',r,p,t.tablename;end if;
   end loop;
  end loop;
 end loop;
 if not has_table_privilege('authenticated','public.profiles','SELECT')
 or not has_table_privilege('authenticated','public.patient_measurements','SELECT')
 or not has_table_privilege('service_role','public.workspace_cases','SELECT') then raise exception 'Required access removed';end if;
end $$;
create table public.browser_grant_regression_probe(id integer generated always as identity);
alter table public.browser_grant_regression_probe enable row level security;
do $$
declare r text;
begin
 foreach r in array array['anon','authenticated'] loop
  if has_table_privilege(r,'public.browser_grant_regression_probe','INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES' || case when current_setting('server_version_num')::integer>=170000 then ',MAINTAIN' else '' end) then raise exception 'Unsafe default table grants for %',r;end if;
 end loop;
end $$;
rollback;
