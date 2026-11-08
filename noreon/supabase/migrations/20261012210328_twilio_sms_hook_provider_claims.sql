-- Existing claims remain Brevo SMS; no sender, tariff or runtime gate is enabled.
alter table public.auth_sms_hook_attempts
 add column provider text not null default 'brevo' check(provider in ('brevo','twilio')),
 add column channel text not null default 'sms' check(channel='sms');
alter table public.auth_sms_hook_attempts drop constraint auth_sms_hook_attempts_provider_reference_check;
alter table public.auth_sms_hook_attempts add constraint auth_sms_hook_provider_reference_check check(
 provider_reference is null or (provider='brevo' and provider_reference ~ '^[0-9]{1,16}$') or (provider='twilio' and provider_reference ~ '^(SM|MM)[0-9a-fA-F]{32}$'));
-- The caller may only finish a claim. Its send identity and reservation cannot change.
create function public.guard_auth_sms_hook_binding() returns trigger
language plpgsql set search_path='' as $$
begin
 if (new.webhook_id,new.body_digest,new.claim_token,new.provider,new.channel,new.budget_day,new.currency,new.amount_micros,new.policy_revision,new.created_at)
 is distinct from (old.webhook_id,old.body_digest,old.claim_token,old.provider,old.channel,old.budget_day,old.currency,old.amount_micros,old.policy_revision,old.created_at)
 then raise exception 'auth hook binding immutable';end if;
 if old.status<>'submitting' and new is distinct from old then raise exception 'auth hook outcome immutable';end if;
 return new;
end $$;
create trigger auth_sms_hook_binding before update on public.auth_sms_hook_attempts for each row execute function public.guard_auth_sms_hook_binding();
revoke all on function public.guard_auth_sms_hook_binding() from public,anon,authenticated,service_role;
-- Keep the two-argument legacy signature as a fixed Brevo SMS wrapper.
drop function public.claim_auth_sms_hook(text,text);
create function public.claim_auth_sms_hook(p_webhook_id text,p_body_digest text,p_provider text,p_channel text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.patient_message_dispatch_control;p public.patient_message_spend_policy;a public.auth_sms_hook_attempts;today date;used bigint;amount bigint;
begin
 if p_provider is null or p_provider not in ('brevo','twilio') or p_channel is distinct from 'sms' then raise exception 'invalid';end if;
 if p_webhook_id is null or p_webhook_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_body_digest is null or p_body_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid';end if;
 -- Same global lock order as notice admission and spend configuration.
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 select * into a from public.auth_sms_hook_attempts where webhook_id=p_webhook_id;
 if found then
  if a.body_digest<>p_body_digest or a.provider<>p_provider or a.channel<>p_channel then raise exception 'auth hook conflict';end if;
  return jsonb_build_object('status',a.status);
 end if;
 if c.paused_reason is not null then raise exception 'message dispatch paused';end if;
 select * into p from public.patient_message_spend_policy where id=1 for update;
 if not found or not p.enabled or p.currency is distinct from 'USD' or p.valid_until is null or p.valid_until<=clock_timestamp()
 or p.allowed_prefixes is distinct from array['+374']::text[] or p.sms_segment_ceiling_micros<=0 then raise exception 'message spending unconfigured';end if;
 today:=(clock_timestamp()at time zone'UTC')::date;
 -- Both providers use the fixed ASCII auth body is exactly one GSM-7 segment. No tariff default.
 amount:=p.sms_segment_ceiling_micros;
 select reserved_micros into used from public.patient_message_spend_totals where budget_day=today and currency='USD';used:=coalesce(used,0);
 if amount>least(p.daily_limit_micros,5000000)-used then raise exception 'message spending limit';end if;
 insert into public.patient_message_spend_totals(budget_day,currency,reserved_micros) values(today,'USD',amount)
 on conflict(budget_day,currency) do update set reserved_micros=public.patient_message_spend_totals.reserved_micros+excluded.reserved_micros;
 insert into public.auth_sms_hook_attempts(webhook_id,body_digest,provider,channel,budget_day,currency,amount_micros,policy_revision)
 values(p_webhook_id,p_body_digest,p_provider,p_channel,today,'USD',amount,p.revision) returning * into a;
 return jsonb_build_object('status','send','claimToken',a.claim_token);
end $$;
create or replace function public.finish_auth_sms_hook(p_webhook_id text,p_claim_token uuid,p_status text,p_reference text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.auth_sms_hook_attempts;c public.patient_message_dispatch_control;n bigint;reason text;
begin
 if p_status is null or p_status not in ('accepted','failed','unknown') or (p_status<>'accepted' and p_reference is not null) then raise exception 'invalid';end if;
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 select * into a from public.auth_sms_hook_attempts where webhook_id=p_webhook_id for update;
 if not found or a.claim_token is distinct from p_claim_token then return false;end if;
 if p_status='accepted' and (p_reference is null or (a.provider='brevo' and p_reference !~ '^[0-9]{1,16}$') or (a.provider='twilio' and p_reference !~ '^(SM|MM)[0-9a-fA-F]{32}$')) then raise exception 'invalid';end if;
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
revoke all on function public.claim_auth_sms_hook(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_auth_sms_hook(text,text,text,text) to service_role;

create function public.claim_auth_sms_hook(p_webhook_id text,p_body_digest text) returns jsonb
language sql security definer set search_path='' as $$
 select public.claim_auth_sms_hook(p_webhook_id,p_body_digest,'brevo','sms');
$$;
revoke all on function public.claim_auth_sms_hook(text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_auth_sms_hook(text,text) to service_role;
