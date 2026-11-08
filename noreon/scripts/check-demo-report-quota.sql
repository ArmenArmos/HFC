-- Isolated local database only; all changes roll back.
begin;
delete from public.demo_report_ai_attempts;
do $$
declare id uuid:=gen_random_uuid(); n int; role_name text;
begin
 if not public.claim_demo_report_ai(id,repeat('a',64),'member') then raise exception 'first rejected'; end if;
 if public.claim_demo_report_ai(id,repeat('a',64),'staff') then raise exception 'cross-category replay accepted'; end if;
 for n in 1..19 loop
  if not public.claim_demo_report_ai(gen_random_uuid(),repeat('a',64),'member') then raise exception 'early session limit'; end if;
 end loop;
 if public.claim_demo_report_ai(gen_random_uuid(),repeat('a',64),'member') then raise exception 'session quota bypass'; end if;
 for n in 1..480 loop
  if not public.claim_demo_report_ai(gen_random_uuid(),lpad(n::text,64,'b'),'member') then raise exception 'early member limit'; end if;
 end loop;
 if public.claim_demo_report_ai(gen_random_uuid(),repeat('c',64),'member') then raise exception 'member quota bypass'; end if;
 if public.claim_demo_report_ai(gen_random_uuid(),repeat('c',64)) then raise exception 'legacy RPC bypass'; end if;
 for n in 1..20 loop
  if not public.claim_demo_report_ai(gen_random_uuid(),repeat('a',64),'staff') then raise exception 'member exhausted staff capacity'; end if;
 end loop;
 if public.claim_demo_report_ai(gen_random_uuid(),repeat('a',64),'staff') then raise exception 'staff session quota bypass'; end if;
 for n in 1..480 loop
  if not public.claim_demo_report_ai(gen_random_uuid(),lpad(n::text,64,'b'),'staff') then raise exception 'early staff limit'; end if;
 end loop;
 if public.claim_demo_report_ai(gen_random_uuid(),repeat('c',64),'staff') then raise exception 'staff quota bypass'; end if;
 if (select count(*) from public.demo_report_ai_attempts)<>1000 then raise exception 'incorrect daily accounting'; end if;
 if public.claim_demo_report_ai(gen_random_uuid(),repeat('c',64),null)
 or public.claim_demo_report_ai(gen_random_uuid(),repeat('c',64),'admin') then raise exception 'invalid category accepted'; end if;
 foreach role_name in array array['anon','authenticated'] loop
  if has_function_privilege(role_name,'public.claim_demo_report_ai(uuid,text,text)','execute')
   or has_function_privilege(role_name,'public.claim_demo_report_ai(uuid,text)','execute') then raise exception 'RPC access exposed'; end if;
 end loop;
 update public.demo_report_ai_attempts set created_at=(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC') - interval '1 second';
 if not public.claim_demo_report_ai(gen_random_uuid(),repeat('a',64),'staff')
 or not public.claim_demo_report_ai(gen_random_uuid(),repeat('a',64)) then raise exception 'UTC day did not reset'; end if;
 if has_table_privilege('authenticated','public.demo_report_ai_attempts','select') then raise exception 'table exposed'; end if;
end $$;
rollback;
