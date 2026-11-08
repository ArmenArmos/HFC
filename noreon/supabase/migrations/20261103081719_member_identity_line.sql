-- Preserve the original search's assignment scope, counts, cursor and atomic audit.
create or replace function public.patient_clinical_case_search_identity(p_query text,p_after_created_at timestamptz default null,p_after_user_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.patient_clinical_case_search(p_query,p_after_created_at,p_after_user_id);
 result:=jsonb_set(result,'{rows}',coalesce((
  select jsonb_agg(r.value||jsonb_build_object(
   'birthYear',extract(year from p.birth_date)::integer,'birthDate',p.birth_date,
   'phoneLast4',case when length(phone.digits)>=4 then right(phone.digits,4) else null end
  ) order by r.ordinality)
  from jsonb_array_elements(result->'rows') with ordinality r(value,ordinality)
  left join public.profiles p on p.id=(r.value->>'id')::uuid
  -- The search matches confirmed auth.users.phone only. Never return that column.
  left join auth.users u on u.id=p.id and u.phone_confirmed_at is not null
  cross join lateral (select regexp_replace(u.phone,'[^0-9]','','g') as digits) phone
 ),'[]'::jsonb));
 return result;
end $$;
revoke all on function public.patient_clinical_case_search_identity(text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.patient_clinical_case_search_identity(text,timestamptz,uuid) to authenticated;

-- Bounded identity read for screens which already have member IDs.
create function public.staff_member_identities(p_members uuid[]) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare staff jsonb:=public.real_clinical_staff_identity();result jsonb;
begin
 if staff is null then raise insufficient_privilege using message='Active staff session required';end if;
 if p_members is null or cardinality(p_members)>50 or array_position(p_members,null) is not null then
  raise invalid_parameter_value using message='Invalid member identities request';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',c.user_id,'name',p.display_name,'birthDate',p.birth_date,
  'birthYear',extract(year from p.birth_date)::integer,
  'phoneLast4',case when length(phone.digits)>=4 then right(phone.digits,4) else null end
 ) order by c.created_at,c.user_id),'[]'::jsonb) into result
 from public.patient_clinical_cases c join public.profiles p on p.id=c.user_id
 left join auth.users u on u.id=c.user_id and u.phone_confirmed_at is not null
 cross join lateral (select regexp_replace(u.phone,'[^0-9]','','g') as digits) phone
 -- Identical to patient_clinical_case_search, including the admin branch.
 where c.user_id=any(p_members)
 and (staff->>'role'='admin' or public.staff_care_access(c.user_id,auth.uid(),true));
 -- As in search, an audit failure refuses the whole read, never a partial result.
 perform public._access_audit_record((r->>'id')::uuid,'member_identities','page')
  from jsonb_array_elements(result) r;
 return result;
end $$;
revoke all on function public.staff_member_identities(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.staff_member_identities(uuid[]) to authenticated;
