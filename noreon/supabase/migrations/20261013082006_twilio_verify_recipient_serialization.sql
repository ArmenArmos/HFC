-- A separate keyed recipient identity serializes changed-code sends and feedback.
-- Neither the raw recipient nor the OTP is persisted.
create table public.auth_verify_recipients (
 recipient_digest text primary key check(recipient_digest ~ '^[a-f0-9]{64}$'),
 active_webhook_id text references public.auth_sms_hook_attempts(webhook_id)
);
create table public.auth_verify_attempt_bindings (
 webhook_id text primary key references public.auth_sms_hook_attempts(webhook_id),
 recipient_digest text not null references public.auth_verify_recipients(recipient_digest),
 previous_reference text check(previous_reference ~ '^VE[0-9a-fA-F]{32}$')
);
alter table public.auth_verify_recipients enable row level security;
alter table public.auth_verify_attempt_bindings enable row level security;
revoke all on public.auth_verify_recipients,public.auth_verify_attempt_bindings from public,anon,authenticated,service_role;
grant select on public.auth_verify_recipients,public.auth_verify_attempt_bindings to service_role;
-- No older runtime may bypass recipient serialization.
create or replace function public.claim_auth_sms_verify_hook(p_webhook_id text,p_body_digest text,p_verification_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
begin raise exception 'Verify recipient binding required';end $$;
create function public.claim_auth_sms_verify_hook(p_webhook_id text,p_body_digest text,p_verification_digest text,p_recipient_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.auth_verify_recipients;a public.auth_sms_hook_attempts;b public.auth_verify_attempt_bindings;f public.auth_verify_feedback;result jsonb;previous text;
begin
 if p_recipient_digest is null or p_recipient_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid';end if;
 -- Same global lock as admission and feedback. This lock is never held during HTTP.
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 select * into b from public.auth_verify_attempt_bindings where webhook_id=p_webhook_id;
 if found then
  if b.recipient_digest<>p_recipient_digest then raise exception 'auth hook conflict';end if;
  result:=public.claim_auth_sms_hook_bound(p_webhook_id,p_body_digest,'twilio-verify','sms',p_verification_digest);
  if (select active_webhook_id from public.auth_verify_recipients where recipient_digest=p_recipient_digest) is distinct from p_webhook_id then return jsonb_build_object('status','failed');end if;
  return result;
 end if;
 -- Legacy attempts have no safe recipient association and may never be reused.
 if exists(select 1 from public.auth_sms_hook_attempts where webhook_id=p_webhook_id) then raise exception 'auth hook conflict';end if;
 insert into public.auth_verify_recipients(recipient_digest)values(p_recipient_digest) on conflict do nothing;
 select * into r from public.auth_verify_recipients where recipient_digest=p_recipient_digest for update;
 if r.active_webhook_id is not null then
  select * into a from public.auth_sms_hook_attempts where webhook_id=r.active_webhook_id;
  if a.status is distinct from 'accepted' then raise exception 'Verify recipient busy';end if;
  select * into f from public.auth_verify_feedback where webhook_id=a.webhook_id;
  if found and f.status in ('submitting','unknown') then raise exception 'Verify recipient busy';end if;
  -- Pending or definitely rejected feedback requires exact-SID cancellation first.
  if f.status is distinct from 'accepted' then previous:=a.provider_reference;end if;
 end if;
 -- Reserve the entire Verify+SMS cost before cancellation or new provider submission.
 result:=public.claim_auth_sms_hook_bound(p_webhook_id,p_body_digest,'twilio-verify','sms',p_verification_digest);
 insert into public.auth_verify_attempt_bindings(webhook_id,recipient_digest,previous_reference)values(p_webhook_id,p_recipient_digest,previous);
 update public.auth_verify_recipients set active_webhook_id=p_webhook_id where recipient_digest=p_recipient_digest;
 return result||case when previous is null then '{}'::jsonb else jsonb_build_object('previousReference',previous) end;
end $$;
revoke all on function public.claim_auth_sms_verify_hook(text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_auth_sms_verify_hook(text,text,text,text) to service_role;

create or replace function public.claim_auth_verify_feedback(p_verification_digest text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.auth_sms_hook_attempts;f public.auth_verify_feedback;
begin
 if p_verification_digest is null or p_verification_digest !~ '^[a-f0-9]{64}$' then raise exception 'invalid';end if;
 perform 1 from public.patient_message_dispatch_control where id=1 for update;
 select attempt.* into a from public.auth_sms_hook_attempts attempt
 join public.auth_verify_attempt_bindings binding on binding.webhook_id=attempt.webhook_id
 join public.auth_verify_recipients recipient on recipient.recipient_digest=binding.recipient_digest and recipient.active_webhook_id=attempt.webhook_id
 where attempt.verification_digest=p_verification_digest and attempt.provider='twilio-verify' and attempt.status='accepted' and attempt.created_at>clock_timestamp()-interval '10 minutes'
 order by attempt.created_at desc limit 1;
 if not found then return null;end if;
 insert into public.auth_verify_feedback(webhook_id,provider_reference)values(a.webhook_id,a.provider_reference) on conflict do nothing returning * into f;
 if not found then return null;end if;
 return jsonb_build_object('webhookId',f.webhook_id,'claimToken',f.claim_token,'reference',f.provider_reference);
end $$;
