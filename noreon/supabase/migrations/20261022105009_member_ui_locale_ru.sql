-- Russian as a third member UI language (Khikar, 22 Oct 2026).
-- profiles.locale stays 'hy'/'en': every Telegram, Zoe and system-template lookup reads it,
-- and clinical text (health summaries, care plans) stays Armenian for Russian readers.
-- The screen language is ui_locale when set, else locale. A Russian choice stores
-- locale='hy', ui_locale='ru'; Armenian or English clears ui_locale.
alter table public.profiles add column ui_locale text check (ui_locale in ('hy','en','ru'));
comment on column public.profiles.ui_locale is 'Screen language when it differs from locale (only ru today). Messages and clinical text use locale.';

create or replace function public.save_patient_profile(p_user_id uuid,p_name text,p_birth_date date,p_sex text,p_locale text,p_consent_version text,p_answers jsonb,p_expected_revision bigint,p_urgent_rule text)
returns bigint language plpgsql security invoker set search_path='' as $$
declare current_revision bigint; old_birth date; old_sex text; next_revision bigint;
begin
  if length(trim(p_name)) not between 1 and 100
    or extract(year from age(timezone('Asia/Yerevan',now())::date,p_birth_date)) not between 18 and 110
    or p_sex not in ('male','female') or p_locale is null or p_locale not in ('hy','en','ru')
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
  update public.profiles set display_name=trim(p_name),birth_date=p_birth_date,biological_sex=p_sex,
    locale=case when p_locale='ru' then 'hy' else p_locale end,
    ui_locale=case when p_locale='ru' then 'ru' end,updated_at=now() where id=p_user_id;
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

-- Same verified-phone identity rule as before; the expected locale is the screen language.
create or replace function public.save_patient_locale(p_locale text,p_expected_locale text,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare owner_id uuid := auth.uid(); current_locale text; current_revision bigint;
begin
 if owner_id is null or not exists(select 1 from auth.users where id=owner_id and phone is not null and phone<>'' and phone_confirmed_at is not null) then raise exception 'verified member required'; end if;
 if p_locale is null or p_locale not in ('hy','en','ru') or p_expected_locale is null or p_expected_locale not in ('hy','en','ru') or p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid locale'; end if;
 select coalesce(ui_locale,locale) into current_locale from public.profiles where id=owner_id and display_name is not null and birth_date is not null and biological_sex is not null for update;
 if not found then raise exception 'profile missing'; end if;
 select revision into current_revision from public.patient_assessments where user_id=owner_id for update;
 if not found or not exists(select 1 from public.patient_consents where user_id=owner_id and version='patient-pilot-v1') then raise exception 'registration missing'; end if;
 if current_locale<>p_expected_locale or current_revision<>p_expected_revision then return -1; end if;
 update public.profiles set locale=case when p_locale='ru' then 'hy' else p_locale end,ui_locale=case when p_locale='ru' then 'ru' end where id=owner_id;
 return current_revision;
end $$;
revoke all on function public.save_patient_locale(text,text,bigint) from public,anon,service_role;
grant execute on function public.save_patient_locale(text,text,bigint) to authenticated;
