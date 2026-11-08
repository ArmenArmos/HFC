-- A cancelled logical event is not a successful enqueue.
create or replace function public.enqueue_patient_plan_message(p_plan_id uuid) returns uuid
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
 if not found or not care.active or care.published_at<p.consented_at or care.published_at>now() or care.published_at<=now()-interval '48 hours' or care.acknowledged_at is not null then return null;end if;
 insert into public.patient_message_outbox(user_id,plan_id,consent_revision,channel,expires_at)
 values(uid,care.id,p.revision,p.channel,care.published_at+interval '48 hours')
 on conflict(user_id,kind,plan_id) do nothing returning id into job_id;
 if job_id is null then select id into job_id from public.patient_message_outbox where user_id=uid and kind='plan-ready' and plan_id=care.id and state='queued';end if;
 return job_id;
end $$;
