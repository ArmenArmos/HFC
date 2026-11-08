-- Auth hooks have their own idempotency ledger, never an OTP/phone/body queue.
create table public.auth_sms_hook_attempts (
 webhook_id text primary key check(webhook_id ~ '^[A-Za-z0-9_-]{1,128}$'),
 body_digest text not null check(body_digest ~ '^[a-f0-9]{64}$'),
 claim_token uuid not null default gen_random_uuid(),
 status text not null default 'submitting' check(status in ('submitting','accepted','failed','unknown')),
 provider_reference text check(provider_reference ~ '^[0-9]{1,16}$'),
 budget_day date not null,currency text not null check(currency='USD'),
 amount_micros bigint not null check(amount_micros between 1 and 5000000),
 policy_revision bigint not null references public.patient_message_spend_policy_events(revision),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 foreign key(budget_day,currency) references public.patient_message_spend_totals(budget_day,currency),
 check((status='accepted')=(provider_reference is not null)),
 check((status='submitting')=(finished_at is null))
);
alter table public.auth_sms_hook_attempts enable row level security;
revoke all on public.auth_sms_hook_attempts from public,anon,authenticated,service_role;
grant select on public.auth_sms_hook_attempts to service_role;

create function public.claim_auth_sms_hook(p_webhook_id text,p_body_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.patient_message_dispatch_control;p public.patient_message_spend_policy;a public.auth_sms_hook_attempts;today date;used bigint;amount bigint;
begin
 if p_webhook_id is null or p_webhook_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_body_digest is null or p_body_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid';end if;
 -- Same global lock order as notice admission and spend configuration.
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 select * into a from public.auth_sms_hook_attempts where webhook_id=p_webhook_id;
 if found then
  if a.body_digest<>p_body_digest then raise exception 'auth hook conflict';end if;
  return jsonb_build_object('status',a.status);
 end if;
 if c.paused_reason is not null then raise exception 'message dispatch paused';end if;
 select * into p from public.patient_message_spend_policy where id=1 for update;
 if not found or not p.enabled or p.currency is distinct from 'USD' or p.valid_until is null or p.valid_until<=clock_timestamp()
 or p.allowed_prefixes is distinct from array['+374']::text[] or p.sms_segment_ceiling_micros<=0 then raise exception 'message spending unconfigured';end if;
 today:=(clock_timestamp()at time zone'UTC')::date;
 -- Brevo's fixed ASCII auth body is exactly one GSM-7 segment. No tariff default.
 amount:=p.sms_segment_ceiling_micros;
 select reserved_micros into used from public.patient_message_spend_totals where budget_day=today and currency='USD';used:=coalesce(used,0);
 if amount>least(p.daily_limit_micros,5000000)-used then raise exception 'message spending limit';end if;
 insert into public.patient_message_spend_totals(budget_day,currency,reserved_micros) values(today,'USD',amount)
 on conflict(budget_day,currency) do update set reserved_micros=public.patient_message_spend_totals.reserved_micros+excluded.reserved_micros;
 insert into public.auth_sms_hook_attempts(webhook_id,body_digest,budget_day,currency,amount_micros,policy_revision)
 values(p_webhook_id,p_body_digest,today,'USD',amount,p.revision) returning * into a;
 return jsonb_build_object('status','send','claimToken',a.claim_token);
end $$;
create function public.finish_auth_sms_hook(p_webhook_id text,p_claim_token uuid,p_status text,p_reference text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.auth_sms_hook_attempts;c public.patient_message_dispatch_control;n bigint;reason text;
begin
 if p_status is null or p_status not in ('accepted','failed','unknown') or (p_status='accepted' and (p_reference is null or p_reference !~ '^[0-9]{1,16}$')) or (p_status<>'accepted' and p_reference is not null) then raise exception 'invalid';end if;
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 select * into a from public.auth_sms_hook_attempts where webhook_id=p_webhook_id for update;
 if not found or a.claim_token is distinct from p_claim_token then return false;end if;
 if a.status<>'submitting' then return a.status=p_status and a.provider_reference is not distinct from p_reference;end if;
 update public.auth_sms_hook_attempts set status=p_status,provider_reference=p_reference,finished_at=clock_timestamp() where webhook_id=p_webhook_id;
 -- Reservations are never refunded, including failed/uncertain provider outcomes.
 if p_status in ('failed','unknown') and c.paused_reason is null then
  reason:=case when p_status='failed' then 'provider-rejected' else 'provider-unknown' end;
  update public.patient_message_dispatch_control set paused_reason=reason,paused_at=clock_timestamp(),revision=revision+1 where id=1 returning revision into n;
  insert into public.patient_message_control_events(revision,action,reason,daily_limit)values(n,'paused',reason,c.daily_limit);
 end if;
 return true;
end $$;
revoke all on function public.claim_auth_sms_hook(text,text),public.finish_auth_sms_hook(text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_auth_sms_hook(text,text),public.finish_auth_sms_hook(text,uuid,text,text) to service_role;

-- Currency cannot change after either kind of reservation, even on a later day.
alter function public.configure_patient_message_spend(bigint,jsonb,text) rename to configure_patient_message_spend_before_auth_hook;
revoke all on function public.configure_patient_message_spend_before_auth_hook(bigint,jsonb,text) from public,anon,authenticated,service_role;
create function public.configure_patient_message_spend(p_expected_revision bigint,p_policy jsonb,p_operator_label text) returns boolean
language plpgsql security definer set search_path='' as $$
declare p public.patient_message_spend_policy;
begin
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 select * into p from public.patient_message_spend_policy where id=1 for update;
 if p.revision is distinct from p_expected_revision then return false;end if;
 if p_policy->'enabled'='true'::jsonb and p_policy->>'currency' is distinct from p.currency and exists(select 1 from public.auth_sms_hook_attempts) then raise exception 'message currency locked';end if;
 return public.configure_patient_message_spend_before_auth_hook(p_expected_revision,p_policy,p_operator_label);
end $$;
revoke all on function public.configure_patient_message_spend(bigint,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.configure_patient_message_spend(bigint,jsonb,text) to service_role;

-- Notice sends share the same USD five-dollar ceiling with auth hooks.
create or replace function public.begin_patient_message_submission_budgeted(p_job_id uuid,p_policy_revision bigint)
returns table(attempt_id uuid,destination text,channel text,template_key text,locale text)
language plpgsql security definer set search_path='' as $$
declare p public.patient_message_spend_policy;r record;amount bigint;used bigint;today date;
begin
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 if not exists(select 1 from public.patient_message_outbox where id=p_job_id and state='queued') then return;end if;
 select * into p from public.patient_message_spend_policy where id=1 for update;
 if not p.enabled or p.currency is distinct from 'USD' or p.valid_until is null or p.valid_until<=clock_timestamp() then raise exception 'message spending unconfigured';end if;
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
 if amount>least(p.daily_limit_micros,5000000)-used then raise exception 'message spending limit';end if;
 insert into public.patient_message_spend_totals(budget_day,currency,reserved_micros) values(today,p.currency,amount)
 on conflict(budget_day,currency) do update set reserved_micros=public.patient_message_spend_totals.reserved_micros+excluded.reserved_micros;
 insert into public.patient_message_spend_reservations(attempt_id,budget_day,currency,amount_micros,policy_revision,segment_allowance) values(r.attempt_id,today,p.currency,amount,p.revision,case when r.channel='sms' then p.max_sms_segments else 1 end);
 return query select r.attempt_id,r.destination,r.channel,r.template_key,r.locale;
end $$;
revoke all on function public.begin_patient_message_submission_budgeted(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.begin_patient_message_submission_budgeted(uuid,bigint) to service_role;
