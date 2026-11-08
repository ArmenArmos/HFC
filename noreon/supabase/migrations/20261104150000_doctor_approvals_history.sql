-- Read-only history of the admitted doctor's own actions for currently assigned members.
create function public.doctor_approvals_history(p_since timestamptz,p_until timestamptz)returns jsonb
language plpgsql security definer set search_path=''as $$
declare
 who jsonb:=public.real_clinical_staff_identity();me uuid;since_at timestamptz;
 items jsonb;more boolean;
begin
 if who is null or who->>'role'is distinct from 'doctor' or (who->>'id')::uuid is distinct from auth.uid()then
  raise insufficient_privilege using message='Assigned doctor session required';
 end if;
 me:=auth.uid();
 if p_since is null or p_until is null or not isfinite(p_since)or not isfinite(p_until)or p_since>=p_until then
  return jsonb_build_object('ok',false,'code','refused');
 end if;
 since_at:=greatest(p_since,p_until-interval '168 hours');
 with members as materialized(
  select k.user_id from public.patient_clinical_cases k
  where k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true)
 ), actions as(
  select 'reply'::text kind,a.id::text id,a.created_at at,c.member_id,
   coalesce(d.state,'unknown')state,case when d.id is not null then left(a.body,80)else ''end excerpt
  from public.conversation_approvals a
  join public.conversation_drafts draft on draft.id=a.draft_id
  join public.conversations c on c.id=draft.conversation_id
  join members m on m.user_id=c.member_id
  left join lateral(select d.id,d.state from public.conversation_deliveries d where d.approval_id=a.id and d.conversation_id=c.id order by d.created_at desc,d.id desc limit 1)d on true
  where a.doctor_id=me and a.created_at>=since_at and a.created_at<p_until
  union all
  select 'lab_review',r.id::text,r.created_at,v.user_id,r.action,null
  from public.lab_ai_value_reviews r join public.lab_ai_values v on v.id=r.value_id
  join members m on m.user_id=v.user_id
  where r.actor_id=me and r.created_at>=since_at and r.created_at<p_until
  union all
  select 'plan',p.id::text,p.published_at,p.user_id,'published',null
  from public.patient_clinical_publications p join members m on m.user_id=p.user_id
  where p.actor_id=me and p.published_at>=since_at and p.published_at<p_until
  union all
  select 'upload',a.id::text,a.created_at,a.member_id,'approved',null
  from public.member_upload_doctor_approvals a join members m on m.user_id=a.member_id
  where a.doctor_id=me and a.created_at>=since_at and a.created_at<p_until
  union all
  select 'alert',a.id::text,a.created_at,c.member_id,a.kind,null
  from public.care_alert_audit a join public.care_alerts c on c.id=a.alert_id
  join members m on m.user_id=c.member_id
  where a.actor_id=me and a.kind in('acknowledged','resolved')and a.created_at>=since_at and a.created_at<p_until
 ), bounded as materialized(
  select * from actions order by at desc,kind,id desc limit 101
 ), shown as(
  select * from bounded order by at desc,kind,id desc limit 100
 )
 select (select count(*)>100 from bounded),coalesce((select jsonb_agg(
  jsonb_build_object('kind',a.kind,'at',a.at,'memberId',a.member_id,'memberName',coalesce(p.display_name,''),'state',a.state)
   ||case when a.kind='reply'then jsonb_build_object('excerpt',a.excerpt)else '{}'::jsonb end
  order by a.at desc,a.kind,a.id desc)
  from shown a left join public.profiles p on p.id=a.member_id),'[]'::jsonb)into more,items;
 perform public._access_audit_record(mid,'doctor_approvals_history',null)
  from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(items)x)q;
 return jsonb_build_object('ok',true,'rows',items,'hasMore',more,'asOf',clock_timestamp());
end$$;
revoke all on function public.doctor_approvals_history(timestamptz,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.doctor_approvals_history(timestamptz,timestamptz)to authenticated;
