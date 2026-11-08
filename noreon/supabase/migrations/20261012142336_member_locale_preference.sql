-- A preference is not registration: no consent, assessment or care writes.
create function public.save_patient_locale(p_locale text,p_expected_locale text,p_expected_revision bigint)
returns bigint language plpgsql security definer set search_path='' as $$
declare owner_id uuid := auth.uid(); current_locale text; current_revision bigint;
begin
 if owner_id is null then raise exception 'unauthorized'; end if;
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

-- Shared demo authorization stays at the server's authenticated cookie boundary.
-- The service-only command locks the existing case and never admits a new case.
create function public.workspace_save_member_locale(p_id uuid,p_expected_revision integer,p_assessment_revision bigint,p_expected_locale text,p_locale text)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases; next_revision integer;
begin
 if p_locale is null or p_locale not in ('hy','en') or p_expected_locale is null or p_expected_locale not in ('hy','en') or p_expected_revision is null or p_expected_revision<0 or p_assessment_revision is null or p_assessment_revision<0 then raise exception 'invalid locale'; end if;
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found then raise exception 'case missing'; end if;
 if c.state->>'userId' is distinct from p_id::text or c.state#>>'{state,profile,userId}' is distinct from p_id::text or c.state#>>'{state,consentAccepted}' is distinct from 'true' or c.state#>'{state,assessment}' is null then raise exception 'registration missing'; end if;
 if c.revision<>p_expected_revision or c.state#>>'{state,assessment,revision}' is distinct from p_assessment_revision::text or c.state#>>'{state,profile,locale}' is distinct from p_expected_locale then return -1; end if;
 perform public.workspace_set_actor(null,p_id);
 update public.workspace_cases set state=jsonb_set(state,'{state,profile,locale}',to_jsonb(p_locale),false),revision=revision+1 where id=p_id returning revision into next_revision;
 return next_revision;
end $$;
revoke all on function public.workspace_save_member_locale(uuid,integer,bigint,text,text) from public,anon,authenticated;
grant execute on function public.workspace_save_member_locale(uuid,integer,bigint,text,text) to service_role;
