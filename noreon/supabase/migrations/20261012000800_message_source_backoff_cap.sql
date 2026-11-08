-- Limit recovery latency for notices with a 48-hour useful lifetime.
create or replace function public.claim_patient_message_source(p_plan_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid;
begin
 insert into public.patient_message_source_backoff as b(plan_id,claim_token,attempts,next_attempt_at)
 values(p_plan_id,gen_random_uuid(),1,clock_timestamp()+interval '5 minutes')
 on conflict(plan_id) do update set
  claim_token=gen_random_uuid(),attempts=least(b.attempts+1,32),
  next_attempt_at=clock_timestamp()+least(interval '1 hour',interval '5 minutes'*power(2,least(b.attempts,7)))
 where b.next_attempt_at<=clock_timestamp()
 returning claim_token into token;
 return token;
end $$;
update public.patient_message_source_backoff set next_attempt_at=least(next_attempt_at,clock_timestamp()+interval '1 hour');
