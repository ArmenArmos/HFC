-- Verified real-member consent and a durable, provider-independent plan-event outbox.
-- This migration does not enable any transport or send messages.
create table public.patient_message_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revision integer not null check(revision between 1 and 2147483647),
 channel text not null check(channel in ('none','sms','whatsapp')),
 verified_phone text,
 consent_version text not null check(consent_version='messaging-service-v1'),
 consented_at timestamptz,
 updated_at timestamptz not null default now(),
 check((channel='none' and verified_phone is null and consented_at is null) or
       (channel<>'none' and verified_phone ~ '^\+[1-9][0-9]{7,14}$' and verified_phone is not null and consented_at is not null))
);
create table public.patient_message_consent_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 revision integer not null,
 channel text not null check(channel in ('none','sms','whatsapp')),
 consent_version text not null,
 phone_fingerprint text,
 created_at timestamptz not null default now(),
 unique(user_id,revision)
);
create table public.patient_message_outbox (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 plan_id uuid not null,
 kind text not null default 'plan-ready' check(kind='plan-ready'),
 template_key text not null default 'plan-ready-v1' check(template_key='plan-ready-v1'),
 consent_revision integer not null,
 channel text not null check(channel in ('sms','whatsapp')),
 state text not null default 'queued' check(state in ('queued','cancelled')),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 cancelled_at timestamptz,
 unique(user_id,kind,plan_id),
 foreign key(plan_id,user_id) references public.patient_care_plans(id,user_id) on delete cascade,
 check(expires_at>created_at),
 check((state='queued' and cancelled_at is null) or (state='cancelled' and cancelled_at is not null))
);
create index patient_message_outbox_pending on public.patient_message_outbox(created_at,id) where state='queued';
alter table public.patient_message_preferences enable row level security;
alter table public.patient_message_consent_events enable row level security;
alter table public.patient_message_outbox enable row level security;
create policy own_message_preferences on public.patient_message_preferences for select to authenticated using((select auth.uid())=user_id);
create policy own_message_consent_events on public.patient_message_consent_events for select to authenticated using((select auth.uid())=user_id);
revoke all on public.patient_message_preferences,public.patient_message_consent_events,public.patient_message_outbox from public,anon,authenticated,service_role;
revoke all on sequence public.patient_message_consent_events_id_seq from public,anon,authenticated,service_role;
grant select on public.patient_message_preferences,public.patient_message_consent_events to authenticated;
grant select on public.patient_message_preferences,public.patient_message_consent_events,public.patient_message_outbox to service_role;

create function public.save_patient_message_preferences(p_channel text,p_expected_revision integer,p_consent_version text) returns integer
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
 next_revision:=p_expected_revision+1;
 insert into public.patient_message_preferences(user_id,revision,channel,verified_phone,consent_version,consented_at)
 values(uid,next_revision,p_channel,case when p_channel='none' then null else phone_value end,p_consent_version,case when p_channel='none' then null else now() end)
 on conflict(user_id) do update set revision=excluded.revision,channel=excluded.channel,verified_phone=excluded.verified_phone,consent_version=excluded.consent_version,consented_at=excluded.consented_at,updated_at=now();
 insert into public.patient_message_consent_events(user_id,revision,channel,consent_version,phone_fingerprint)
 values(uid,next_revision,p_channel,p_consent_version,case when p_channel='none' then null else encode(sha256(convert_to(phone_value,'UTF8')),'hex') end);
 update public.patient_message_outbox set state='cancelled',cancelled_at=now() where user_id=uid and state='queued';
 return next_revision;
end $$;
revoke all on function public.save_patient_message_preferences(text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.save_patient_message_preferences(text,integer,text) to authenticated;

create function public.enqueue_patient_plan_message(p_plan_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid;phone_value text;confirmed timestamptz;p public.patient_message_preferences;care public.patient_care_plans;job_id uuid;
begin
 select user_id into uid from public.patient_care_plans where id=p_plan_id;
 if uid is null then return null;end if;
 -- Use the same identity -> preference lock order as consent changes.
 select '+'||ltrim(phone,'+'),phone_confirmed_at into phone_value,confirmed from auth.users where id=uid for share;
 if not found or confirmed is null then return null;end if;
 select * into p from public.patient_message_preferences where user_id=uid for share;
 if not found or p.channel='none' or p.verified_phone is distinct from phone_value then return null;end if;
 if not exists(select 1 from public.patient_consents where user_id=uid and version='patient-pilot-v1') then return null;end if;
 select * into care from public.patient_care_plans where id=p_plan_id and user_id=uid for share;
 if not found or not care.active or care.published_at>now() or care.published_at<=now()-interval '48 hours' or care.acknowledged_at is not null then return null;end if;
 insert into public.patient_message_outbox(user_id,plan_id,consent_revision,channel,expires_at)
 values(uid,care.id,p.revision,p.channel,care.published_at+interval '48 hours')
 on conflict(user_id,kind,plan_id) do nothing returning id into job_id;
 if job_id is null then select id into job_id from public.patient_message_outbox where user_id=uid and kind='plan-ready' and plan_id=care.id;end if;
 return job_id;
end $$;
revoke all on function public.enqueue_patient_plan_message(uuid) from public,anon,authenticated,service_role;
grant execute on function public.enqueue_patient_plan_message(uuid) to service_role;
