-- Bounded, pageable operations queue: no recipient, body or clinical fields.
create or replace function public.patient_message_attention(p_before_started_at timestamptz default null,p_before_id uuid default null,p_limit integer default 51)
returns table(attempt_id uuid,started_at timestamptz,submission_status text,reason text,reconcile_failures integer)
language plpgsql security definer set search_path='' as $$
begin
 if p_limit is null or p_limit not between 1 and 51 or (p_before_started_at is null)<>(p_before_id is null) then raise exception 'invalid';end if;
 return query select a.id,a.started_at,a.status,
 case when a.status='unknown' then 'submission-unknown'
 when a.status='submitting' then 'submission-pending'
 when a.status='failed' then 'submission-rejected'
 when e.success and e.failure then 'delivery-conflict'
 when e.failure then 'delivery-failed'
 when a.reconcile_failures>0 then 'reconciliation-failed'
 else 'delivery-overdue' end,a.reconcile_failures
 from public.patient_message_attempts a
 cross join lateral(select coalesce(bool_or(d.status in ('delivered','read')),false) success,coalesce(bool_or(d.status in ('failed','undelivered','canceled')),false) failure from public.patient_message_delivery_events d where d.attempt_id=a.id) e
 where (p_before_started_at is null or (a.started_at,a.id)<(p_before_started_at,p_before_id))
 and (a.status in ('submitting','unknown')
 or (a.status='failed' and not exists(select 1 from public.patient_message_recovery_events r where r.attempt_id=a.id and r.action='retry'))
 or (a.status='accepted' and (e.failure or (not e.success and (a.reconcile_failures>0 or a.started_at<=clock_timestamp()-interval '48 hours')))))
 order by a.started_at desc,a.id desc limit p_limit;
end $$;
revoke all on function public.patient_message_attention(timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.patient_message_attention(timestamptz,uuid,integer) to service_role;
