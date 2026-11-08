drop function public.save_patient_profile(uuid,text,date,text,text,text,jsonb);
create function public.save_patient_profile(p_user_id uuid,p_name text,p_birth_date date,p_sex text,p_locale text,p_consent_version text,p_answers jsonb,p_expected_revision bigint,p_urgent_rule text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare current_revision bigint; old_birth date; old_sex text; next_revision bigint;
begin
  if length(trim(p_name)) not between 1 and 100
    or extract(year from age(timezone('Asia/Yerevan',now())::date,p_birth_date)) not between 18 and 110
    or p_sex not in ('male','female') or p_locale not in ('hy','en')
    or p_consent_version<>'patient-pilot-v1' or jsonb_typeof(p_answers)<>'object'
    or exists(select 1 from jsonb_object_keys(p_answers) k where k not in ('q1.age','q1.sex'))
    then raise exception 'invalid profile'; end if;
  select birth_date,biological_sex into old_birth,old_sex from public.profiles where id=p_user_id for update;
  if not found then raise exception 'profile missing'; end if;
  select revision into current_revision from public.patient_assessments where user_id=p_user_id for update;
  if found then
    if current_revision<>p_expected_revision then return -1; end if;
  elsif p_expected_revision<>-1 then return -1;
  end if;
  update public.profiles set display_name=trim(p_name),birth_date=p_birth_date,biological_sex=p_sex,locale=p_locale,updated_at=now() where id=p_user_id;
  insert into public.patient_consents(user_id,version) values(p_user_id,p_consent_version) on conflict do nothing;
  insert into public.patient_assessments(user_id,answers,urgent_rule) values(p_user_id,p_answers,p_urgent_rule)
    on conflict(user_id) do update set answers=public.patient_assessments.answers||excluded.answers,
      revision=public.patient_assessments.revision+1,
      completed_at=case when old_birth is distinct from p_birth_date or old_sex is distinct from p_sex then null else public.patient_assessments.completed_at end,
      urgent_rule=p_urgent_rule,updated_at=now()
    returning revision into next_revision;
  return next_revision;
end $$;
revoke execute on function public.save_patient_profile(uuid,text,date,text,text,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.save_patient_profile(uuid,text,date,text,text,text,jsonb,bigint,text) to service_role;
