-- Require the same verified-phone identity as the member server action.
-- A preference is not registration: no consent, assessment or care writes.
create or replace function public.save_patient_locale(p_locale text,p_expected_locale text,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare owner_id uuid := auth.uid(); current_locale text; current_revision bigint;
begin
 if owner_id is null or not exists(select 1 from auth.users where id=owner_id and phone is not null and phone<>'' and phone_confirmed_at is not null) then raise exception 'verified member required'; end if;
 if p_locale is null or p_locale not in ('hy','en') or p_expected_locale is null or p_expected_locale not in ('hy','en') or p_expected_revision is null or p_expected_revision<0 then raise exception 'invalid locale'; end if;
 select locale into current_locale from public.profiles where id=owner_id and display_name is not null and birth_date is not null and biological_sex is not null for update;
 if not found then raise exception 'profile missing'; end if;
 select revision into current_revision from public.patient_assessments where user_id=owner_id for update;
 if not found or not exists(select 1 from public.patient_consents where user_id=owner_id and version='patient-pilot-v1') then raise exception 'registration missing'; end if;
 if current_locale<>p_expected_locale or current_revision<>p_expected_revision then return -1; end if;
 update public.profiles set locale=p_locale where id=owner_id;
 return current_revision;
end $$;
revoke all on function public.save_patient_locale(text,text,bigint) from public,anon,service_role;
grant execute on function public.save_patient_locale(text,text,bigint) to authenticated;

