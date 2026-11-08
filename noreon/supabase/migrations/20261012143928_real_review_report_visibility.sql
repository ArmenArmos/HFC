-- Removed member reports must not be returned as doctor review evidence.
create or replace function public.patient_clinical_evidence(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with evidence as (select jsonb_build_object(
 'profile',(select jsonb_build_object('name',display_name,'birthDate',birth_date,'biologicalSex',biological_sex) from public.profiles where id=p_user_id),
 'consent',(select to_jsonb(c) from public.patient_consents c where user_id=p_user_id and version='patient-pilot-v1'),
 'assessment',(select to_jsonb(a)-'user_id' from public.patient_assessments a where user_id=p_user_id),
 'measurements',coalesce((select jsonb_agg(to_jsonb(m)-'user_id' order by m.measured_at desc,m.id) from public.patient_measurements m where user_id=p_user_id),'[]'),
 'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'state',r.state,'reviewed',r.reviewed,'confirmedAt',r.confirmed_at) order by r.id) from public.patient_reports r where user_id=p_user_id and deleted_at is null and state<>'deleted'),'[]')
 ) body)
 select jsonb_build_object('token',md5(body::text),'data',body) from evidence
$$;
