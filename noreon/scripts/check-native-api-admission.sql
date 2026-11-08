begin;
-- Keep a boundary-count loop away from a real UTC minute rollover.
do $$ begin if extract(second from clock_timestamp())>58 then perform pg_sleep(2);end if;end $$;
insert into auth.users(id,phone,phone_confirmed_at) values
 ('a1010000-0000-4000-8000-000000000001','37499000901',now()),
 ('a1010000-0000-4000-8000-000000000002','37499000902',now()),
 ('a1010000-0000-4000-8000-000000000003','37499000903',null);
do $$ declare r record; before_row jsonb; i integer; begin
 if has_function_privilege('anon','public.claim_native_member_request(uuid)','EXECUTE') or has_function_privilege('authenticated','public.claim_native_member_request(uuid)','EXECUTE') then raise exception 'TEST: browser claim'; end if;
 if not has_function_privilege('service_role','public.claim_native_member_request(uuid)','EXECUTE') then raise exception 'TEST: missing server claim'; end if;
 if has_table_privilege('anon','public.native_member_request_usage','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,MAINTAIN') or has_table_privilege('authenticated','public.native_member_request_usage','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,MAINTAIN') then raise exception 'TEST: browser table grant'; end if;
 if not (select relrowsecurity from pg_class where oid='public.native_member_request_usage'::regclass) then raise exception 'TEST: RLS missing'; end if;
 begin perform public.claim_native_member_request(null);raise exception 'TEST: null owner';exception when others then if sqlerrm<>'verified member required' then raise;end if;end;
 begin perform public.claim_native_member_request('a1010000-0000-4000-8000-000000000003');raise exception 'TEST: unverified owner';exception when others then if sqlerrm<>'verified member required' then raise;end if;end;
 begin perform public.claim_native_member_request('a1010000-0000-4000-8000-000000000099');raise exception 'TEST: unknown owner';exception when others then if sqlerrm<>'verified member required' then raise;end if;end;
 for i in 1..120 loop
  select * into r from public.claim_native_member_request('a1010000-0000-4000-8000-000000000001');
  if not r.allowed or r.retry_after<>0 then raise exception 'TEST: early denial at %',i;end if;
 end loop;
 select to_jsonb(u) into before_row from public.native_member_request_usage u where user_id='a1010000-0000-4000-8000-000000000001';
 select * into r from public.claim_native_member_request('a1010000-0000-4000-8000-000000000001');
 if r.allowed or r.retry_after not between 1 and 60 then raise exception 'TEST: minute boundary'; end if;
 if before_row is distinct from (select to_jsonb(u) from public.native_member_request_usage u where user_id='a1010000-0000-4000-8000-000000000001') then raise exception 'TEST: denial changed counters';end if;
 select * into r from public.claim_native_member_request('a1010000-0000-4000-8000-000000000002');
 if not r.allowed then raise exception 'TEST: owner isolation';end if;
 update public.native_member_request_usage set minute_started_at=date_trunc('minute',clock_timestamp())-interval '1 minute' where user_id='a1010000-0000-4000-8000-000000000001';
 select * into r from public.claim_native_member_request('a1010000-0000-4000-8000-000000000001');
 if not r.allowed or (select minute_count from public.native_member_request_usage where user_id='a1010000-0000-4000-8000-000000000001')<>1 then raise exception 'TEST: minute did not reset';end if;
 update public.native_member_request_usage set day_count=4999 where user_id='a1010000-0000-4000-8000-000000000001';
 select * into r from public.claim_native_member_request('a1010000-0000-4000-8000-000000000001');
 if not r.allowed then raise exception 'TEST: final daily slot';end if;
 select * into r from public.claim_native_member_request('a1010000-0000-4000-8000-000000000001');
 if r.allowed or r.retry_after not between 1 and 86400 then raise exception 'TEST: daily boundary';end if;
 update public.native_member_request_usage set minute_count=120 where user_id='a1010000-0000-4000-8000-000000000001';
 select * into r from public.claim_native_member_request('a1010000-0000-4000-8000-000000000001');
 if r.allowed or abs(r.retry_after-ceil(extract(epoch from (date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC')+interval '1 day'-clock_timestamp()))::integer)>1 then raise exception 'TEST: wrong combined wait';end if;
 update public.native_member_request_usage set day_started_at=day_started_at-interval '1 day',minute_started_at=minute_started_at-interval '1 minute' where user_id='a1010000-0000-4000-8000-000000000001';
 select * into r from public.claim_native_member_request('a1010000-0000-4000-8000-000000000001');
 if not r.allowed or (select day_count from public.native_member_request_usage where user_id='a1010000-0000-4000-8000-000000000001')<>1 then raise exception 'TEST: day did not reset';end if;
end $$;
set local role service_role;
select * from public.claim_native_member_request('a1010000-0000-4000-8000-000000000002');
reset role;
delete from auth.users where id='a1010000-0000-4000-8000-000000000002';
do $$ begin if exists(select 1 from public.native_member_request_usage where user_id='a1010000-0000-4000-8000-000000000002') then raise exception 'TEST: account cleanup';end if; end $$;
rollback;
