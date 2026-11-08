-- Submission intent is durable before network I/O. No transport is enabled here.
alter table public.patient_message_outbox drop constraint patient_message_outbox_state_check;
alter table public.patient_message_outbox drop constraint patient_message_outbox_check1;
alter table public.patient_message_outbox add constraint patient_message_outbox_state_check check(state in ('queued','cancelled','submitted'));
alter table public.patient_message_outbox add constraint patient_message_outbox_check1 check((state in ('queued','submitted') and cancelled_at is null) or (state='cancelled' and cancelled_at is not null));
create table public.patient_message_attempts (
 id uuid primary key default gen_random_uuid(),
 job_id uuid unique references public.patient_message_outbox(id) on delete set null,
 user_id uuid references auth.users(id) on delete set null,
 channel text not null check(channel in ('sms','whatsapp')),
 template_key text not null check(template_key='plan-ready-v1'),
 status text not null default 'submitting' check(status in ('submitting','unknown','accepted','failed')),
 provider_reference text unique check(length(provider_reference) between 1 and 160),
 started_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((status='accepted' and provider_reference is not null) or (status<>'accepted' and provider_reference is null))
);
create index patient_message_attempts_unresolved on public.patient_message_attempts(started_at) where status='submitting';
alter table public.patient_message_attempts enable row level security;
revoke all on public.patient_message_attempts from public,anon,authenticated,service_role;
grant select on public.patient_message_attempts to service_role;

create function public.message_is_quiet(p_start text,p_end text,p_at timestamptz) returns boolean
language sql immutable set search_path='' as $$
 select case when p_start is null or p_end is null or p_at is null or p_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then true
 when p_start=p_end then false
 when p_start<p_end then to_char(p_at at time zone 'Asia/Yerevan','HH24:MI')>=p_start and to_char(p_at at time zone 'Asia/Yerevan','HH24:MI')<p_end
 else to_char(p_at at time zone 'Asia/Yerevan','HH24:MI')>=p_start or to_char(p_at at time zone 'Asia/Yerevan','HH24:MI')<p_end end;
$$;
revoke all on function public.message_is_quiet(text,text,timestamptz) from public,anon,authenticated,service_role;

create function public.begin_patient_message_submission(p_job_id uuid)
returns table(attempt_id uuid,destination text,channel text,template_key text,locale text)
language plpgsql security definer set search_path='' as $$
declare uid uuid;phone_value text;confirmed timestamptz;p public.patient_message_preferences;care public.patient_care_plans;j public.patient_message_outbox;profile public.profiles;reminders jsonb;allowed boolean:=true;stamp timestamptz;new_attempt uuid;source_id uuid;
begin
 select o.user_id,o.plan_id into uid,source_id from public.patient_message_outbox o where o.id=p_job_id;
 if uid is null then return;end if;
 -- Match consent/enqueue lock order. Never take an outbox lock first.
 select '+'||ltrim(u.phone,'+'),u.phone_confirmed_at into phone_value,confirmed from auth.users u where u.id=uid for share;
 if not found then return;end if;
 select * into p from public.patient_message_preferences where user_id=uid for share;
 if not found then allowed:=false;end if;
 select * into care from public.patient_care_plans where id=source_id and user_id=uid for share;
 if not found then return;end if;
 select * into profile from public.profiles where id=uid for share;
 if not found then allowed:=false;end if;
 perform 1 from public.patient_consents where user_id=uid and version='patient-pilot-v1' for share;
 if not found then allowed:=false;end if;
 -- Also serialize first reminder-preference inserts with their existing RPC.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,51981));
 select preferences into reminders from public.patient_reminder_preferences where user_id=uid for share;
 select * into j from public.patient_message_outbox where id=p_job_id for update skip locked;
 if not found or j.state<>'queued' then return;end if;
 stamp:=clock_timestamp();
 if not allowed or confirmed is null or phone_value is null or phone_value !~ '^\+[1-9][0-9]{7,14}$'
 or p.channel='none' or p.channel is distinct from j.channel or p.revision is distinct from j.consent_revision or p.verified_phone is distinct from phone_value or p.consent_version is distinct from 'messaging-service-v1'
 or nullif(btrim(profile.display_name),'') is null or profile.birth_date is null or profile.biological_sex is null
 or not care.active or care.acknowledged_at is not null or care.published_at>stamp or care.published_at<p.consented_at or care.published_at<=stamp-interval '48 hours' or j.expires_at<=stamp then
  update public.patient_message_outbox set state='cancelled',cancelled_at=stamp where id=j.id;return;
 end if;
 if public.message_is_quiet(coalesce(reminders->>'quietStart','22:00'),coalesce(reminders->>'quietEnd','07:00'),stamp) then return;end if;
 insert into public.patient_message_attempts(job_id,user_id,channel,template_key) values(j.id,j.user_id,j.channel,j.template_key) returning id into new_attempt;
 update public.patient_message_outbox set state='submitted' where id=j.id;
 return query select new_attempt,phone_value,j.channel,j.template_key,case when profile.locale='en' then 'en' else 'hy' end;
end $$;
revoke all on function public.begin_patient_message_submission(uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_patient_message_submission(uuid) to service_role;

create function public.finish_patient_message_submission(p_attempt_id uuid,p_status text,p_provider_reference text) returns boolean
language plpgsql security definer set search_path='' as $$
declare a public.patient_message_attempts;
begin
 if p_status is null or p_status not in ('unknown','accepted','failed') or (p_status='accepted' and (p_provider_reference is null or length(p_provider_reference) not between 1 and 160 or p_provider_reference !~ '^[A-Za-z0-9:_-]+$')) or (p_status<>'accepted' and p_provider_reference is not null) then raise exception 'invalid';end if;
 select * into a from public.patient_message_attempts where id=p_attempt_id for update;
 if not found then return false;end if;
 if a.status in ('accepted','failed') then return a.status=p_status and a.provider_reference is not distinct from p_provider_reference;end if;
 update public.patient_message_attempts set status=p_status,provider_reference=p_provider_reference,updated_at=clock_timestamp() where id=a.id;
 return true;
end $$;
revoke all on function public.finish_patient_message_submission(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.finish_patient_message_submission(uuid,text,text) to service_role;

create function public.mark_stale_patient_message_submissions() returns integer
language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
 with stale as(select id from public.patient_message_attempts where status='submitting' and started_at<=clock_timestamp()-interval '2 minutes' order by started_at limit 100 for update skip locked)
 update public.patient_message_attempts a set status='unknown',updated_at=clock_timestamp() from stale where a.id=stale.id;
 get diagnostics changed=row_count;return changed;
end $$;
revoke all on function public.mark_stale_patient_message_submissions() from public,anon,authenticated,service_role;
grant execute on function public.mark_stale_patient_message_submissions() to service_role;
