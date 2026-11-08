create function public.valid_care_times(values_to_check time[])
returns boolean language sql immutable set search_path='' as $$
 select coalesce(bool_and(v is not null and extract(second from v)=0 and v<time '24:00'),false)
 from unnest(values_to_check) v
$$;
alter table public.patient_care_medications add constraint care_schedule_minute_precision check(public.valid_care_times(times));

create or replace function public.report_patient_dose(p_medication_id uuid,p_due_at timestamptz,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare m public.patient_care_medications; plan public.patient_care_plans; local_due timestamp;
begin
 if auth.uid() is null or p_status not in ('taken','skipped') or p_status is null then raise exception 'invalid dose report'; end if;
 select * into m from public.patient_care_medications where id=p_medication_id and user_id=auth.uid() for share;
 if not found or not m.active then raise exception 'medication unavailable'; end if;
 select * into plan from public.patient_care_plans where id=m.plan_id and user_id=auth.uid() for share;
 if not found or not plan.active or plan.published_at>now() then raise exception 'plan unavailable'; end if;
 local_due := timezone('Asia/Yerevan',p_due_at);
 if p_due_at is null or p_due_at>now() or p_due_at<plan.published_at or local_due::date<>timezone('Asia/Yerevan',now())::date
    or local_due::date<m.start_date or (m.end_date is not null and local_due::date>m.end_date)
    or not(local_due::time=any(m.times)) then raise exception 'dose outside schedule'; end if;
 insert into public.patient_dose_events(user_id,medication_id,due_at,status)
 values(auth.uid(),m.id,p_due_at,p_status)
 on conflict(user_id,medication_id,due_at) do update set status=excluded.status,recorded_at=now();
end $$;
