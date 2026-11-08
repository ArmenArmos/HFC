-- Configuration capabilities must be checked before any attempt/count/spend admission.
alter function public.begin_patient_message_submission_budgeted(uuid,bigint) rename to begin_patient_message_submission_budgeted_before_channel_gate;
revoke all on function public.begin_patient_message_submission_budgeted_before_channel_gate(uuid,bigint) from public,anon,authenticated,service_role;
create function public.begin_patient_message_submission_budgeted(p_job_id uuid,p_policy_revision bigint,p_available_channels text[] default '{}'::text[])
returns table(attempt_id uuid,destination text,channel text,template_key text,locale text)
language plpgsql security definer set search_path='' as $$
begin
 if p_available_channels is null or cardinality(p_available_channels)>2 or exists(select 1 from unnest(p_available_channels)c where c is null or c not in ('sms','whatsapp')) then raise exception 'invalid';end if;
 -- Match the private admission lock order. Outbox channel is immutable; row is
 -- reread by the private begin after it locks current consent and source state.
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 if not exists(select 1 from public.patient_message_outbox o where o.id=p_job_id and o.state='queued' and o.channel=any(p_available_channels)) then return;end if;
 return query select * from public.begin_patient_message_submission_budgeted_before_channel_gate(p_job_id,p_policy_revision);
end $$;
revoke all on function public.begin_patient_message_submission_budgeted(uuid,bigint,text[]) from public,anon,authenticated,service_role;
grant execute on function public.begin_patient_message_submission_budgeted(uuid,bigint,text[]) to service_role;

-- Apply capability filtering before LIMIT so unavailable channels cannot starve SMS.
create function public.patient_message_queue_candidates(p_limit integer,p_available_channels text[])
returns table(job_id uuid) language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 25 or p_available_channels is null or cardinality(p_available_channels)>2 or exists(select 1 from unnest(p_available_channels)c where c is null or c not in ('sms','whatsapp')) then raise exception 'invalid';end if;
 return query select o.id from public.patient_message_outbox o
 left join public.patient_reminder_preferences r on r.user_id=o.user_id
 where o.state='queued' and o.channel=any(p_available_channels) and (o.expires_at<=now() or not public.message_is_quiet(coalesce(r.preferences->>'quietStart','22:00'),coalesce(r.preferences->>'quietEnd','07:00'),now()))
 order by o.created_at,o.id limit p_limit;
end $$;
revoke all on function public.patient_message_queue_candidates(integer,text[]) from public,anon,authenticated,service_role;
grant execute on function public.patient_message_queue_candidates(integer,text[]) to service_role;
