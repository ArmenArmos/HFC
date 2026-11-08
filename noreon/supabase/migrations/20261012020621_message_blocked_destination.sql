-- Terminal, explained policy cancellation prevents an unsupported number from starving the queue.
alter table public.patient_message_outbox
 add column cancellation_reason text check(cancellation_reason is null or cancellation_reason='destination-blocked'),
 add column cancellation_policy_revision bigint references public.patient_message_spend_policy_events(revision),
 add constraint patient_message_outbox_policy_cancellation check((cancellation_reason is null and cancellation_policy_revision is null) or (state='cancelled' and cancellation_reason is not null and cancellation_policy_revision is not null));

create or replace function public.begin_patient_message_submission_budgeted(p_job_id uuid,p_policy_revision bigint)
returns table(attempt_id uuid,destination text,channel text,template_key text,locale text)
language plpgsql security definer set search_path='' as $$
declare p public.patient_message_spend_policy;r record;amount bigint;used bigint;today date;
begin
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 if not exists(select 1 from public.patient_message_outbox where id=p_job_id and state='queued') then return;end if;
 select * into p from public.patient_message_spend_policy where id=1 for update;
 if not p.enabled or p.valid_until is null or p.valid_until<=clock_timestamp() then raise exception 'message spending unconfigured';end if;
 if p_policy_revision is null or p.revision<>p_policy_revision then raise exception 'message spending revision';end if;
 -- A subtransaction rolls back the private begin's attempt/count changes on a
 -- disallowed destination. Then commit a terminal cancellation outside it.
 begin
  select * into r from public.begin_patient_message_submission(p_job_id);
  if not found then return;end if;
  if not exists(select 1 from unnest(p.allowed_prefixes) prefix where starts_with(r.destination,prefix)) then
   raise exception using errcode='PZ001',message='message destination blocked';
  end if;
 exception when sqlstate 'PZ001' then
  update public.patient_message_outbox set state='cancelled',cancelled_at=clock_timestamp(),cancellation_reason='destination-blocked',cancellation_policy_revision=p.revision where id=p_job_id and state='queued';
  return;
 end;
 amount:=case when r.channel='sms' then p.sms_segment_ceiling_micros*p.max_sms_segments else p.whatsapp_message_ceiling_micros end;
 today:=(clock_timestamp() at time zone 'UTC')::date;
 select reserved_micros into used from public.patient_message_spend_totals where budget_day=today and currency=p.currency;
 used:=coalesce(used,0);
 if amount>p.daily_limit_micros-used then raise exception 'message spending limit';end if;
 insert into public.patient_message_spend_totals(budget_day,currency,reserved_micros) values(today,p.currency,amount)
 on conflict(budget_day,currency) do update set reserved_micros=public.patient_message_spend_totals.reserved_micros+excluded.reserved_micros;
 insert into public.patient_message_spend_reservations(attempt_id,budget_day,currency,amount_micros,policy_revision,segment_allowance) values(r.attempt_id,today,p.currency,amount,p.revision,case when r.channel='sms' then p.max_sms_segments else 1 end);
 return query select r.attempt_id,r.destination,r.channel,r.template_key,r.locale;
end $$;
revoke all on function public.begin_patient_message_submission_budgeted(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.begin_patient_message_submission_budgeted(uuid,bigint) to service_role;
