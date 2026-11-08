-- Commit source admission separately before enqueue: a cancelled enqueue transaction
-- must not erase scheduling backoff. These rows contain no destination or payload.
create table public.patient_message_source_backoff (
 plan_id uuid primary key references public.patient_care_plans(id) on delete cascade,
 claim_token uuid not null,
 attempts integer not null check(attempts between 1 and 32),
 next_attempt_at timestamptz not null
);
alter table public.patient_message_source_backoff enable row level security;
revoke all on public.patient_message_source_backoff from public,anon,authenticated,service_role;

create function public.claim_patient_message_source(p_plan_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare token uuid;
begin
 insert into public.patient_message_source_backoff as b(plan_id,claim_token,attempts,next_attempt_at)
 values(p_plan_id,gen_random_uuid(),1,clock_timestamp()+interval '5 minutes')
 on conflict(plan_id) do update set
  claim_token=gen_random_uuid(),attempts=least(b.attempts+1,32),
  next_attempt_at=clock_timestamp()+least(interval '6 hours',interval '5 minutes'*power(2,least(b.attempts,7)))
 where b.next_attempt_at<=clock_timestamp()
 returning claim_token into token;
 return token;
end $$;
create function public.complete_patient_message_source(p_plan_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 delete from public.patient_message_source_backoff where plan_id=p_plan_id and claim_token=p_claim_token;
 get diagnostics changed=row_count;
 return changed=1;
end $$;
revoke all on function public.claim_patient_message_source(uuid) from public,anon,authenticated,service_role;
revoke all on function public.complete_patient_message_source(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.claim_patient_message_source(uuid) to service_role;
grant execute on function public.complete_patient_message_source(uuid,uuid) to service_role;

-- Discovery is bounded; enqueue and begin remain the transactional authorities.
create or replace function public.patient_plan_message_candidates(p_after_published_at timestamptz default null,p_after_id uuid default null,p_limit integer default 100)
returns table(plan_id uuid,published_at timestamptz) language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 100 or (p_after_published_at is null)<>(p_after_id is null) then raise exception 'invalid';end if;
 return query select c.id,c.published_at from public.patient_care_plans c
 join public.patient_message_preferences p on p.user_id=c.user_id
 join auth.users u on u.id=c.user_id
 where c.active and c.acknowledged_at is null and c.published_at<=now() and c.published_at>now()-interval '48 hours'
 and p.channel<>'none' and p.consent_version='messaging-service-v1' and c.published_at>=p.consented_at
 and u.phone_confirmed_at is not null and p.verified_phone='+'||ltrim(u.phone,'+')
 and exists(select 1 from public.patient_consents pc where pc.user_id=c.user_id and pc.version='patient-pilot-v1')
 and not exists(select 1 from public.patient_message_outbox o where o.user_id=c.user_id and o.plan_id=c.id and o.kind='plan-ready')
 and not exists(select 1 from public.patient_message_source_backoff b where b.plan_id=c.id and b.next_attempt_at>clock_timestamp())
 and (p_after_published_at is null or (c.published_at,c.id)>(p_after_published_at,p_after_id))
 order by c.published_at,c.id limit p_limit;
end $$;
revoke all on function public.patient_plan_message_candidates(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.patient_plan_message_candidates(timestamptz,uuid,integer) to service_role;

