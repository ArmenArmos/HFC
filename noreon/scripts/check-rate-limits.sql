-- Abuse limits (docs/operations/abuse-protection.md): limits trigger, legitimate use passes,
-- one source or account cannot spend another's quota, callers cannot pick limits, browsers
-- cannot reach the limiter. Rolled back.
begin;
do $$
declare i integer;a text:=repeat('a',64);b text:=repeat('b',64);p text:=repeat('c',64);r integer;
begin
 if to_regprocedure('public.rate_limit_claim(text,text[],text[],text[])')is null then raise exception 'rate_limit_claim missing';end if;
 delete from public.rate_limit_counters;
 -- Ten six-chunk replies fit in a minute, independent of uploads and other members.
 for i in 1..60 loop
  if public.rate_limit_claim('member_speech',array['source','user'],array[a,p],array['take','take'])<>0 then raise exception 'speech refused at %',i;end if;
 end loop;
 r:=public.rate_limit_claim('member_speech',array['source','user'],array[a,p],array['take','take']);
 if r<1 or r>60 then raise exception 'speech 61st admitted or bad retry %',r;end if;
 if public.rate_limit_claim('member_speech',array['source','user'],array[a,b],array['take','take'])<>0 then raise exception 'another speech member blocked';end if;
 for i in 1..30 loop
  if public.rate_limit_claim('member_upload',array['source','user'],array[a,p],array['take','take'])<>0 then raise exception 'speech spent upload quota';end if;
 end loop;
 if public.rate_limit_claim('member_upload',array['user'],array[p],array['take'])<=0 then raise exception 'upload quota widened';end if;
 -- The speech source budget still bounds requests distributed across members.
 for i in 1..58 loop
  if public.rate_limit_claim('member_speech',array['source'],array[a],array['take'])<>0 then raise exception 'speech source refused early';end if;
 end loop;
 if public.rate_limit_claim('member_speech',array['source'],array[a],array['take'])<=0 then raise exception 'speech source unbounded';end if;
 update public.rate_limit_counters set window_start=window_start-interval '1 minute',expires_at=now()-interval '1 second' where operation='member_speech';
 if public.rate_limit_claim('member_speech',array['source','user'],array[a,p],array['take','take'])<>0 then raise exception 'speech window did not reset';end if;
 -- Member codes: 30 requests per network in 15 minutes, the 31st is refused with a retry time.
 for i in 1..30 loop
  if public.rate_limit_claim('member_code',array['source'],array[a],array['take'])<>0 then raise exception 'member_code source refused at %',i;end if;
 end loop;
 r:=public.rate_limit_claim('member_code',array['source'],array[a],array['take']);
 if r<1 or r>900 then raise exception 'member_code 31st admitted or bad retry %',r;end if;
 if public.rate_limit_claim('member_code',array['source'],array[b],array['take'])<>0 then raise exception 'another network was blocked';end if;
 -- Phone quota: peek never counts, so requests that fail CAPTCHA cannot exhaust it.
 for i in 1..50 loop
  if public.rate_limit_claim('member_code',array['phone'],array[p],array['peek'])<>0 then raise exception 'peek counted';end if;
 end loop;
 for i in 1..8 loop perform public.rate_limit_claim('member_code',array['phone'],array[p],array['record']);end loop;
 if public.rate_limit_claim('member_code',array['source','phone'],array[b,p],array['take','peek'])<=0 then raise exception 'phone over quota admitted';end if;
 if public.rate_limit_claim('member_code',array['phone'],array[b],array['peek'])<>0 then raise exception 'another phone blocked';end if;
 -- Staff sign-in: the email bucket fills only from recorded failures.
 for i in 1..10 loop perform public.rate_limit_claim('staff_signin',array['email'],array[p],array['record']);end loop;
 if public.rate_limit_claim('staff_signin',array['source','email'],array[b,p],array['take','peek'])<=0 then raise exception 'locked email admitted';end if;
 if public.rate_limit_claim('staff_signin',array['source','email'],array[b,a],array['take','peek'])<>0 then raise exception 'other email blocked';end if;
 -- Windows end: an expired counter starts again at one.
 update public.rate_limit_counters set window_start=window_start-interval '1 hour',expires_at=now()-interval '1 second' where operation='member_code' and bucket='source:'||a;
 if public.rate_limit_claim('member_code',array['source'],array[a],array['take'])<>0 then raise exception 'expired window not reset';end if;
 if(select hits from public.rate_limit_counters where operation='member_code' and bucket='source:'||a)<>1 then raise exception 'reset did not start at one';end if;
 -- Unknown operations, kinds, modes and malformed keys are refused, never defaulted.
 begin perform public.rate_limit_claim('anything',array['source'],array[a],array['take']);raise exception 'unknown operation accepted';exception when raise_exception then if sqlerrm<>'invalid rate limit request' then raise;end if;end;
 begin perform public.rate_limit_claim('member_code',array['email'],array[a],array['take']);raise exception 'unknown kind accepted';exception when raise_exception then if sqlerrm<>'invalid rate limit request' then raise;end if;end;
 begin perform public.rate_limit_claim('member_code',array['source'],array['203.0.113.1'],array['take']);raise exception 'raw address accepted';exception when raise_exception then if sqlerrm<>'invalid rate limit request' then raise;end if;end;
 begin perform public.rate_limit_claim('member_code',array['source'],array[a],array['skip']);raise exception 'unknown mode accepted';exception when raise_exception then if sqlerrm<>'invalid rate limit request' then raise;end if;end;
 begin perform public.rate_limit_claim('member_code',array['source','source'],array[a],array['take']);raise exception 'mismatched arrays accepted';exception when raise_exception then if sqlerrm<>'invalid rate limit request' then raise;end if;end;
 -- Only the server can use it.
 if has_function_privilege('anon','public.rate_limit_claim(text,text[],text[],text[])','execute')
  or has_function_privilege('authenticated','public.rate_limit_claim(text,text[],text[],text[])','execute')
  or has_function_privilege('authenticated','public._rate_limit_policy(text,text)','execute')
  or has_table_privilege('anon','public.rate_limit_counters','select')or has_table_privilege('authenticated','public.rate_limit_counters','select')
 then raise exception 'browser roles can reach the limiter';end if;
 if not(select relrowsecurity from pg_class where oid='public.rate_limit_counters'::regclass)then raise exception 'RLS off';end if;
end $$;
rollback;
