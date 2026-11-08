-- Native clients get one owner-bound operation, never a service key/table write grant.
create function public.record_patient_measurement(p_submission_id uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();saved public.patient_measurements;
begin
 if uid is null then raise exception 'verified membership required';end if;
 perform 1 from auth.users where id=uid and phone is not null and phone_confirmed_at is not null for share;
 if not found or not exists(select 1 from public.profiles where id=uid and length(trim(display_name))>0 and birth_date is not null and biological_sex in ('male','female'))
 or not exists(select 1 from public.patient_consents where user_id=uid and version='patient-pilot-v1')
 or not exists(select 1 from public.patient_assessments where user_id=uid) then raise exception 'verified membership required';end if;
 if p_submission_id is null or p_submission_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 or p_systolic is null or p_systolic not between 60 and 300
 or p_diastolic is null or p_diastolic not between 30 and 200 or p_diastolic>=p_systolic
 or (p_pulse is not null and p_pulse not between 20 and 250)
 or p_measured_at is null or not isfinite(p_measured_at) or p_measured_at>now()+interval '5 minutes' then raise exception 'invalid measurement';end if;
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)
 values(uid,p_submission_id,p_systolic,p_diastolic,p_pulse,p_measured_at)
 on conflict(user_id,submission_id) do nothing returning * into saved;
 if saved.id is null then
  select * into saved from public.patient_measurements where user_id=uid and submission_id=p_submission_id;
  if saved.id is null then raise exception 'measurement unavailable';end if;
  if saved.systolic<>p_systolic or saved.diastolic<>p_diastolic or saved.pulse is distinct from p_pulse or saved.measured_at<>p_measured_at then raise exception 'measurement conflict';end if;
 end if;
 return saved.id;
end $$;
revoke all on function public.record_patient_measurement(uuid,integer,integer,integer,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.record_patient_measurement(uuid,integer,integer,integer,timestamptz) to authenticated;
