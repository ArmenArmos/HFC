-- Discovery is bounded; enqueue and begin remain the transactional authorities.
create function public.patient_plan_message_candidates(p_after_published_at timestamptz default null,p_after_id uuid default null,p_limit integer default 100)
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
 and (p_after_published_at is null or (c.published_at,c.id)>(p_after_published_at,p_after_id))
 order by c.published_at,c.id limit p_limit;
end $$;
revoke all on function public.patient_plan_message_candidates(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.patient_plan_message_candidates(timestamptz,uuid,integer) to service_role;

create function public.patient_message_queue_candidates(p_limit integer default 25)
returns table(job_id uuid) language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 25 then raise exception 'invalid';end if;
 return query select o.id from public.patient_message_outbox o
 left join public.patient_reminder_preferences r on r.user_id=o.user_id
 where o.state='queued' and (o.expires_at<=now() or not public.message_is_quiet(coalesce(r.preferences->>'quietStart','22:00'),coalesce(r.preferences->>'quietEnd','07:00'),now()))
 order by o.created_at,o.id limit p_limit;
end $$;
revoke all on function public.patient_message_queue_candidates(integer) from public,anon,authenticated,service_role;
grant execute on function public.patient_message_queue_candidates(integer) to service_role;
