-- The assigned doctor's current urgent windows, using the same projection as the member chat.
create function public.doctor_urgent_windows()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;items jsonb;total_count bigint;
begin
 if who is null or who->>'role'is distinct from 'doctor' or (who->>'id')::uuid is distinct from auth.uid()then
  raise insufficient_privilege using message='Assigned doctor session required';
 end if;
 me:=auth.uid();
 with members as materialized(
  select k.user_id from public.patient_clinical_cases k
  where k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true)
   and not public._test_member_hidden(k.user_id,me)
 ), windows as materialized(
  select m.user_id,w.started_at,w.opened_by
  from members m join public.conversations c on c.member_id=m.user_id
  cross join lateral public._zoe_talking_urgent_window(c.id)w
  where w.started_at>=clock_timestamp()-interval '24 hours'
 ), shown as(
  select * from windows order by started_at desc,user_id limit 200
 )
 select (select count(*)from windows),coalesce((select jsonb_agg(
  jsonb_build_object('memberId',s.user_id,'memberName',coalesce(p.display_name,''),
   'since',s.started_at,'openedBy',s.opened_by)order by s.started_at desc,s.user_id)
  from shown s left join public.profiles p on p.id=s.user_id),'[]'::jsonb)into total_count,items;
 perform public._access_audit_record(mid,'doctor_zoe_urgent_window','read')
  from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(items)x)q;
 return jsonb_build_object('ok',true,'windows',items,'total',total_count);
end$$;
revoke all on function public.doctor_urgent_windows()from public,anon,authenticated,service_role;
grant execute on function public.doctor_urgent_windows()to authenticated;
