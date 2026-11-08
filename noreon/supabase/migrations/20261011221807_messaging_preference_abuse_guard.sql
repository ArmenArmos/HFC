-- Unchanged saves are idempotent. Bound new opt-ins without preventing opt-out.
create index patient_message_consent_recent on public.patient_message_consent_events(user_id,created_at);
create or replace function public.save_patient_message_preferences(p_channel text,p_expected_revision integer,p_consent_version text) returns integer
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();phone_value text;confirmed timestamptz;current_revision integer;next_revision integer;
begin
 if uid is null then raise exception 'unauthorized';end if;
 if p_channel is null or p_channel not in ('none','sms','whatsapp') or p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=2147483647 or p_consent_version is distinct from 'messaging-service-v1' then raise exception 'invalid';end if;
 -- Lock identity first, including the first preference save, to serialize revisions.
 select '+'||ltrim(phone,'+'),phone_confirmed_at into phone_value,confirmed from auth.users where id=uid for update;
 if not found then raise exception 'unauthorized';end if;
 select revision into current_revision from public.patient_message_preferences where user_id=uid for update;
 if coalesce(current_revision,0)<>p_expected_revision then return -1;end if;
 if p_channel<>'none' and (confirmed is null or phone_value is null or phone_value !~ '^\+[1-9][0-9]{7,14}$'
  or not exists(select 1 from public.profiles where id=uid and birth_date is not null and biological_sex is not null and nullif(btrim(display_name),'') is not null)
  or not exists(select 1 from public.patient_consents where user_id=uid and version='patient-pilot-v1')) then raise exception 'verified membership required';end if;
 if exists(select 1 from public.patient_message_preferences where user_id=uid and channel=p_channel and
  verified_phone is not distinct from (case when p_channel='none' then null else phone_value end)) then return current_revision;end if;
 if p_channel<>'none' and (select count(*) from public.patient_message_consent_events where user_id=uid and created_at>now()-interval '1 hour')>=30 then raise exception 'too many preference changes';end if;
 next_revision:=p_expected_revision+1;
 insert into public.patient_message_preferences(user_id,revision,channel,verified_phone,consent_version,consented_at)
 values(uid,next_revision,p_channel,case when p_channel='none' then null else phone_value end,p_consent_version,case when p_channel='none' then null else now() end)
 on conflict(user_id) do update set revision=excluded.revision,channel=excluded.channel,verified_phone=excluded.verified_phone,consent_version=excluded.consent_version,consented_at=excluded.consented_at,updated_at=now();
 insert into public.patient_message_consent_events(user_id,revision,channel,consent_version,phone_fingerprint)
 values(uid,next_revision,p_channel,p_consent_version,case when p_channel='none' then null else encode(sha256(convert_to(phone_value,'UTF8')),'hex') end);
 update public.patient_message_outbox set state='cancelled',cancelled_at=now() where user_id=uid and state='queued';
 return next_revision;
end $$;
