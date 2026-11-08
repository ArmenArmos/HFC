-- Disabled by default. This ceiling includes the Verify success fee and ALL SMS charges.
alter table public.patient_message_spend_policy add column verify_attempt_ceiling_micros bigint not null default 0 check(verify_attempt_ceiling_micros between 0 and 5000000);
alter table public.auth_sms_hook_attempts drop constraint auth_sms_hook_attempts_provider_check;
alter table public.auth_sms_hook_attempts add constraint auth_sms_hook_attempts_provider_check check(provider in ('brevo','twilio','twilio-verify'));
alter table public.auth_sms_hook_attempts add column verification_digest text;
alter table public.auth_sms_hook_attempts add constraint auth_sms_verify_digest check((provider='twilio-verify' and verification_digest is not null and verification_digest ~ '^[a-f0-9]{64}$') or (provider<>'twilio-verify' and verification_digest is null));
alter table public.auth_sms_hook_attempts drop constraint auth_sms_hook_provider_reference_check;
alter table public.auth_sms_hook_attempts add constraint auth_sms_hook_provider_reference_check check(provider_reference is null or (provider='brevo' and provider_reference ~ '^[0-9]{1,16}$') or (provider='twilio' and provider_reference ~ '^(SM|MM)[0-9a-fA-F]{32}$') or (provider='twilio-verify' and provider_reference ~ '^VE[0-9a-fA-F]{32}$'));
create function public.guard_auth_sms_verify_digest() returns trigger language plpgsql set search_path='' as $$
begin if new.verification_digest is distinct from old.verification_digest then raise exception 'Verify binding immutable';end if;return new;end $$;
create trigger auth_sms_verify_digest before update on public.auth_sms_hook_attempts for each row execute function public.guard_auth_sms_verify_digest();
revoke all on function public.guard_auth_sms_verify_digest() from public,anon,authenticated,service_role;
create function public.claim_auth_sms_hook_bound(p_webhook_id text,p_body_digest text,p_provider text,p_channel text,p_verification_digest text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.patient_message_dispatch_control;p public.patient_message_spend_policy;a public.auth_sms_hook_attempts;today date;used bigint;amount bigint;
begin
 if p_provider is null or p_provider not in ('brevo','twilio','twilio-verify') or p_channel is distinct from 'sms' then raise exception 'invalid';end if;
 if (p_provider='twilio-verify' and (p_verification_digest is null or p_verification_digest !~ '^[a-f0-9]{64}$')) or (p_provider<>'twilio-verify' and p_verification_digest is not null) then raise exception 'invalid';end if;
 if p_webhook_id is null or p_webhook_id !~ '^[A-Za-z0-9_-]{1,128}$' or p_body_digest is null or p_body_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid';end if;
 -- Same global lock order as notice admission and spend configuration.
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 select * into a from public.auth_sms_hook_attempts where webhook_id=p_webhook_id;
 if found then
  if a.body_digest<>p_body_digest or a.provider<>p_provider or a.channel<>p_channel or a.verification_digest is distinct from p_verification_digest then raise exception 'auth hook conflict';end if;
  return jsonb_build_object('status',a.status);
 end if;
 if c.paused_reason is not null then raise exception 'message dispatch paused';end if;
 select * into p from public.patient_message_spend_policy where id=1 for update;
 if not found or not p.enabled or p.currency is distinct from 'USD' or p.valid_until is null or p.valid_until<=clock_timestamp()
 or p.allowed_prefixes is distinct from array['+374']::text[] or p.sms_segment_ceiling_micros<=0 then raise exception 'message spending unconfigured';end if;
 today:=(clock_timestamp()at time zone'UTC')::date;
 -- Both providers use the fixed ASCII auth body is exactly one GSM-7 segment. No tariff default.
 amount:=case when p_provider='twilio-verify' then p.verify_attempt_ceiling_micros else p.sms_segment_ceiling_micros end;
 if amount<=0 then raise exception 'Verify spending unconfigured';end if;
 select reserved_micros into used from public.patient_message_spend_totals where budget_day=today and currency='USD';used:=coalesce(used,0);
 if amount>least(p.daily_limit_micros,5000000)-used then raise exception 'message spending limit';end if;
 insert into public.patient_message_spend_totals(budget_day,currency,reserved_micros) values(today,'USD',amount)
 on conflict(budget_day,currency) do update set reserved_micros=public.patient_message_spend_totals.reserved_micros+excluded.reserved_micros;
 insert into public.auth_sms_hook_attempts(webhook_id,body_digest,provider,channel,verification_digest,budget_day,currency,amount_micros,policy_revision)
 values(p_webhook_id,p_body_digest,p_provider,p_channel,p_verification_digest,today,'USD',amount,p.revision) returning * into a;
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
 if p_status='accepted' and (p_reference is null or (a.provider='brevo' and p_reference !~ '^[0-9]{1,16}$') or (a.provider='twilio' and p_reference !~ '^(SM|MM)[0-9a-fA-F]{32}$') or (a.provider='twilio-verify' and p_reference !~ '^VE[0-9a-fA-F]{32}$')) then raise exception 'invalid';end if;
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

revoke all on function public.claim_auth_sms_hook_bound(text,text,text,text,text) from public,anon,authenticated,service_role;
create or replace function public.claim_auth_sms_hook(p_webhook_id text,p_body_digest text,p_provider text,p_channel text) returns jsonb language sql security definer set search_path='' as $$
 select public.claim_auth_sms_hook_bound(p_webhook_id,p_body_digest,p_provider,p_channel,null);
$$;
create function public.claim_auth_sms_verify_hook(p_webhook_id text,p_body_digest text,p_verification_digest text) returns jsonb language sql security definer set search_path='' as $$
 select public.claim_auth_sms_hook_bound(p_webhook_id,p_body_digest,'twilio-verify','sms',p_verification_digest);
$$;
revoke all on function public.claim_auth_sms_verify_hook(text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_auth_sms_verify_hook(text,text,text) to service_role;

-- Separate explicit operator approval, sharing the existing spend revision/audit history.
create function public.configure_auth_verify_spend(p_expected_revision bigint,p_ceiling_micros bigint,p_operator_label text) returns boolean language plpgsql security definer set search_path='' as $$
declare p public.patient_message_spend_policy;
begin
 if p_ceiling_micros is null or p_ceiling_micros not between 0 and 5000000 or p_operator_label is null or length(p_operator_label) not between 1 and 100 then raise exception 'invalid';end if;
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 select * into p from public.patient_message_spend_policy where id=1 for update;
 if p.revision is distinct from p_expected_revision then return false;end if;
 update public.patient_message_spend_policy set verify_attempt_ceiling_micros=p_ceiling_micros,revision=revision+1,updated_at=clock_timestamp() where id=1 returning * into p;
 insert into public.patient_message_spend_policy_events(revision,operator_label,policy) values(p.revision,p_operator_label,to_jsonb(p));return true;
end $$;
revoke all on function public.configure_auth_verify_spend(bigint,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.configure_auth_verify_spend(bigint,bigint,text) to service_role;

create table public.auth_verify_feedback (
 webhook_id text primary key references public.auth_sms_hook_attempts(webhook_id),
 provider_reference text not null unique check(provider_reference ~ '^VE[0-9a-fA-F]{32}$'),
 claim_token uuid not null default gen_random_uuid(),
 status text not null default 'submitting' check(status in ('submitting','accepted','failed','unknown')),
 created_at timestamptz not null default clock_timestamp(),finished_at timestamptz
);
alter table public.auth_verify_feedback enable row level security;
revoke all on public.auth_verify_feedback from public,anon,authenticated,service_role;
grant select on public.auth_verify_feedback to service_role;
-- Only trusted server code calls this after Supabase verified the supplied phone/code.
create function public.claim_auth_verify_feedback(p_verification_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.auth_sms_hook_attempts;f public.auth_verify_feedback;
begin
 if p_verification_digest is null or p_verification_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid';end if;
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 select * into a from public.auth_sms_hook_attempts where verification_digest=p_verification_digest and provider='twilio-verify' and status='accepted' and created_at>clock_timestamp()-interval '10 minutes' order by created_at desc limit 1;
 if not found then return null;end if;
 insert into public.auth_verify_feedback(webhook_id,provider_reference)values(a.webhook_id,a.provider_reference) on conflict do nothing returning * into f;
 if not found then return null;end if;
 return jsonb_build_object('webhookId',f.webhook_id,'claimToken',f.claim_token,'reference',f.provider_reference);
end $$;
create function public.finish_auth_verify_feedback(p_webhook_id text,p_claim_token uuid,p_status text) returns boolean language plpgsql security definer set search_path='' as $$
declare f public.auth_verify_feedback;
begin
 if p_status is null or p_status not in ('accepted','failed','unknown') then raise exception 'invalid';end if;
 select * into f from public.auth_verify_feedback where webhook_id=p_webhook_id for update;
 if not found or f.claim_token is distinct from p_claim_token then return false;end if;
 if f.status<>'submitting' then return f.status=p_status;end if;
 update public.auth_verify_feedback set status=p_status,finished_at=clock_timestamp() where webhook_id=p_webhook_id;return true;
end $$;
revoke all on function public.claim_auth_verify_feedback(text),public.finish_auth_verify_feedback(text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_auth_verify_feedback(text),public.finish_auth_verify_feedback(text,uuid,text) to service_role;
