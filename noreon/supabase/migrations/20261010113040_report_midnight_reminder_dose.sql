-- Keep the original scheduled dose identity when a member's reminder crosses midnight.
create or replace function public.report_patient_dose(p_medication_id uuid,p_due_at timestamptz,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare m public.patient_care_medications; plan public.patient_care_plans; local_due timestamp; today date; crosses_midnight boolean;
begin
 if auth.uid() is null or p_status not in ('taken','skipped') or p_status is null then raise exception 'invalid dose report'; end if;
 select * into m from public.patient_care_medications where id=p_medication_id and user_id=auth.uid() for share;
 if not found or not m.active then raise exception 'medication unavailable'; end if;
 select * into plan from public.patient_care_plans where id=m.plan_id and user_id=auth.uid() for share;
 if not found or not plan.active or plan.published_at>now() then raise exception 'plan unavailable'; end if;
 local_due := timezone('Asia/Yerevan',p_due_at);
 today := timezone('Asia/Yerevan',now())::date;
 crosses_midnight := (local_due + interval '15 minutes')::date=today and exists (
   select 1 from public.patient_reminder_preferences where user_id=auth.uid() and preferences->>'medicationOffsetMinutes'='15'
 );
 if p_due_at is null or p_due_at>now() or p_due_at<plan.published_at
    or (local_due::date<>today and not crosses_midnight)
    or local_due::date<m.start_date or (m.end_date is not null and local_due::date>m.end_date)
    or not(local_due::time=any(m.times)) then raise exception 'dose outside schedule'; end if;
 insert into public.patient_dose_events(user_id,medication_id,due_at,status)
 values(auth.uid(),m.id,p_due_at,p_status)
 on conflict(user_id,medication_id,due_at) do update set status=excluded.status,recorded_at=now();
end $$;
