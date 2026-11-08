-- Explicit operator recovery for a definitely rejected initial Verify send only.
-- Monetary reservations and immutable attempts are never changed or refunded.
create table public.auth_verify_recovery_events (
 webhook_id text primary key references public.auth_sms_hook_attempts(webhook_id),
 recipient_digest text not null references public.auth_verify_recipients(recipient_digest),
 operator_label text not null check(operator_label ~ '^[A-Za-z0-9@._-]{3,100}$'),
 control_revision bigint not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.auth_verify_recovery_events enable row level security;
revoke all on public.auth_verify_recovery_events from public,anon,authenticated,service_role;
grant select on public.auth_verify_recovery_events to service_role;
create function public.recover_failed_auth_verify_recipient(p_expected_webhook_id text,p_operator_label text) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.patient_message_dispatch_control;a public.auth_sms_hook_attempts;b public.auth_verify_attempt_bindings;r public.auth_verify_recipients;
begin
 if p_operator_label is null or p_operator_label !~ '^[A-Za-z0-9@._-]{3,100}$' then raise exception 'invalid operator';end if;
 if p_expected_webhook_id is null or p_expected_webhook_id !~ '^[A-Za-z0-9_-]{1,128}$' then raise exception 'invalid';end if;
 select * into c from public.patient_message_dispatch_control where id=1 for update;
 if c.paused_reason is null then return false;end if;
 select * into b from public.auth_verify_attempt_bindings where webhook_id=p_expected_webhook_id;
 if not found or b.previous_reference is not null then return false;end if;
 select * into r from public.auth_verify_recipients where recipient_digest=b.recipient_digest for update;
 if not found or r.active_webhook_id is distinct from p_expected_webhook_id then return false;end if;
 select * into a from public.auth_sms_hook_attempts where webhook_id=p_expected_webhook_id for update;
 if not found or a.provider is distinct from 'twilio-verify' or a.status is distinct from 'failed' or a.provider_reference is not null then return false;end if;
 if exists(select 1 from public.auth_verify_feedback where webhook_id=p_expected_webhook_id) then return false;end if;
 insert into public.auth_verify_recovery_events(webhook_id,recipient_digest,operator_label,control_revision)
 values(p_expected_webhook_id,b.recipient_digest,p_operator_label,c.revision);
 update public.auth_verify_recipients set active_webhook_id=null where recipient_digest=b.recipient_digest;
 -- Dispatch stays paused. The operator must separately review and resume it.
 return true;
end $$;
revoke all on function public.recover_failed_auth_verify_recipient(text,text) from public,anon,authenticated,service_role;
grant execute on function public.recover_failed_auth_verify_recipient(text,text) to service_role;
