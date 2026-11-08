-- A nurse or doctor can find an assigned member by date of birth. The date is an exact-match filter inside the caller's own
-- assigned list (the same `authorized` set as name and phone); it widens nothing and returns the same DTO. Accepted forms are
-- day.month.year with a dot, slash or dash, and ISO year-month-day. It is tested before the phone shape because digits with
-- dots and dashes look like a phone number. An impossible date is rejected, not read as a name or a phone.
create or replace function public.patient_clinical_case_search(p_query text,p_after_created_at timestamptz default null,p_after_user_id uuid default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare staff jsonb:=public.real_clinical_staff_identity();q text;digits text;is_phone boolean;is_dob boolean:=false;dob date;result jsonb;
begin
 if staff is null then raise insufficient_privilege using message='Active staff session required';end if;
 if p_query is null or char_length(p_query)>100 or p_query~'[[:cntrl:]]'
 or (p_after_created_at is null)<>(p_after_user_id is null)
 or (p_after_created_at is not null and not isfinite(p_after_created_at)) then
  raise invalid_parameter_value using message='Invalid member search';
 end if;
 q:=btrim(p_query);
 if q~'^[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{4}$'then
  is_dob:=true;
  begin dob:=make_date(split_part(regexp_replace(q,'[./-]','.','g'),'.',3)::int,split_part(regexp_replace(q,'[./-]','.','g'),'.',2)::int,split_part(regexp_replace(q,'[./-]','.','g'),'.',1)::int);
  exception when others then raise invalid_parameter_value using message='Enter a valid date of birth';end;
 elsif q~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then
  is_dob:=true;
  begin dob:=make_date(split_part(q,'-',1)::int,split_part(q,'-',2)::int,split_part(q,'-',3)::int);
  exception when others then raise invalid_parameter_value using message='Enter a valid date of birth';end;
 end if;
 is_phone:=not is_dob and q<>'' and q~'^[0-9[:space:]()+.\-]+$';
 if is_phone then
  digits:=regexp_replace(q,'[^0-9]','','g');
  -- Only a complete national Armenian number has a trunk prefix. Preserve
  -- approved partial matching rather than stripping zero from arbitrary input.
  if digits~'^0[1-9][0-9]{7}$'then digits:='374'||substr(digits,2);end if;
  if length(digits)<4 or length(digits)>15 then raise invalid_parameter_value using message='Enter at least four phone digits';end if;
 elsif not is_dob and q<>'' and char_length(q)<2 then raise invalid_parameter_value using message='Enter at least two name characters';
 end if;
 with authorized as materialized (
  select c.user_id,c.revision,c.assigned_doctor_id,c.assigned_nurse_id,c.created_at,p.display_name,p.birth_date
  from public.patient_clinical_cases c join public.profiles p on p.id=c.user_id
  where staff->>'role'='admin' or public.staff_care_access(c.user_id,auth.uid(),true)
 ), matches as materialized (
  select a.* from authorized a
  where (q='' or (is_dob and a.birth_date=dob) or (not is_dob and not is_phone and strpos(lower(a.display_name),lower(q))>0)
   or (is_phone and exists(select 1 from auth.users u where u.id=a.user_id and u.phone_confirmed_at is not null
    and strpos(regexp_replace(u.phone,'[^0-9]','','g'),digits)>0)))
  and (p_after_created_at is null or (a.created_at,a.user_id)>(p_after_created_at,p_after_user_id))
  order by a.created_at,a.user_id limit 51
 ), visible as materialized (
  select * from matches order by created_at,user_id limit 50
 ), counts as (
  select r.user_id,count(*) filter(where r.status='requested') requested,
   count(*) filter(where r.status='provider-proposed') proposed,count(*) filter(where r.status='confirmed') confirmed,
   count(*) filter(where r.status='change-pending') pending
  from public.patient_test_requests r join visible v on v.user_id=r.user_id group by r.user_id
 )
 select jsonb_build_object('rows',coalesce((select jsonb_agg(jsonb_build_object('id',v.user_id,'name',v.display_name,'revision',v.revision,
  'doctorId',v.assigned_doctor_id,'nurseId',v.assigned_nurse_id,'createdAt',v.created_at,
  'bookingCounts',jsonb_build_object('requested',coalesce(b.requested,0),'providerProposed',coalesce(b.proposed,0),
   'confirmed',coalesce(b.confirmed,0),'changePending',coalesce(b.pending,0))) order by v.created_at,v.user_id)
  from visible v left join counts b on b.user_id=v.user_id),'[]'::jsonb),
  'hasMore',(select count(*)>50 from matches),
  'nextCursor',case when (select count(*)>50 from matches)then
   (select jsonb_build_object('createdAt',created_at,'id',user_id) from visible order by created_at desc,user_id desc limit 1)
   else null end) into result;
 -- Do not catch audit failures: a page is served only if all its audit inserts succeed.
 perform public._access_audit_record((r->>'id')::uuid,'member_search','page')
  from jsonb_array_elements(result->'rows')r;
 return result;
end $$;
revoke all on function public.patient_clinical_case_search(text,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.patient_clinical_case_search(text,timestamptz,uuid) to authenticated;
