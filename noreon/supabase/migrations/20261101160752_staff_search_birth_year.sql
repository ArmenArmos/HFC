-- Separate RPC: existing clients keep the original strict search response.
-- Reuse its assignment scope, cursor, counts and atomic page audit unchanged.
create function public.patient_clinical_case_search_identity(p_query text,p_after_created_at timestamptz default null,p_after_user_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.patient_clinical_case_search(p_query,p_after_created_at,p_after_user_id);
 result:=jsonb_set(result,'{rows}',coalesce((
  select jsonb_agg(r.value||jsonb_build_object('birthYear',extract(year from p.birth_date)::integer) order by r.ordinality)
  from jsonb_array_elements(result->'rows') with ordinality r(value,ordinality)
  left join public.profiles p on p.id=(r.value->>'id')::uuid
 ),'[]'::jsonb));
 return result;
end $$;
revoke all on function public.patient_clinical_case_search_identity(text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.patient_clinical_case_search_identity(text,timestamptz,uuid) to authenticated;
