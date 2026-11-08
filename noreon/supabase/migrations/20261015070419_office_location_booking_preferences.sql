-- Office is a requested or explicitly provider-recorded location, never an availability promise.
create or replace function public.valid_patient_test_terms(p_terms jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare start_at timestamptz;end_at timestamptz;
begin
 if jsonb_typeof(p_terms) is distinct from 'object' or p_terms->>'timezone' is distinct from 'Asia/Yerevan' or coalesce(p_terms->>'mode','') not in ('clinic','home','office') or coalesce(length(btrim(p_terms->>'location')),0) not between 3 and 1000 then return false;end if;
 start_at:=(p_terms->>'startsAt')::timestamptz;end_at:=(p_terms->>'endsAt')::timestamptz;
 return coalesce(isfinite(start_at) and isfinite(end_at) and end_at>start_at and end_at-start_at<=interval '1 day',false);
exception when others then return false;
end $$;
create or replace function public.valid_patient_test_preference(p_terms jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare start_at timestamptz;
begin
 if jsonb_typeof(p_terms) is distinct from 'object' then return false; end if;
 if p_terms ? 'endsAt' then return public.valid_patient_test_terms(p_terms); end if;
 if p_terms->>'timezone' is distinct from 'Asia/Yerevan' or coalesce(p_terms->>'mode','') not in ('clinic','home','office') or coalesce(length(btrim(p_terms->>'location')),0) not between 3 and 1000 then return false; end if;
 if coalesce(p_terms->>'startsAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
 start_at:=(p_terms->>'startsAt')::timestamptz;
 return coalesce(isfinite(start_at),false);
exception when others then return false;
end $$;
revoke all on function public.valid_patient_test_preference(jsonb) from public,anon,authenticated,service_role;

