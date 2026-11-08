-- Urgent alerts for the assigned nurse (read only).
--
-- A member's 103 answer or a self-harm message raises a care alert, but the alert inbox is for
-- admins and doctors only. The nurse's Care queue lists tasks, so an urgent alert on her own
-- member showed as "No open tasks" (Armen's staging QA, 4 Nov). This gives the assigned nurse a
-- read of the live alerts for the members assigned to her, and nothing else: no acknowledge,
-- no resolve, no resolution note, no delivery detail, no other nurse's or doctor's members.
-- Whether an alert is urgent is still decided where it is raised; this only shows it.
-- Order: the same as the doctor chat (orderAlerts): open before acknowledged, then what the member wrote or Zoe saw before questionnaire,
-- lab and reading alerts, then the most recent activity first, then id.

create function public.care_alert_nurse_inbox(p_limit integer default 50)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;lim integer:=greatest(1,least(coalesce(p_limit,50),100));
 total integer;items jsonb;m uuid;
begin
 if auth.role()is distinct from 'authenticated'or who is null or who->>'role'is distinct from 'nurse'then
  raise insufficient_privilege using message='Active nurse session required';
 end if;
 me:=(who->>'id')::uuid;
 -- One statement, one snapshot: who is assigned to her now, which of their alerts are live, the total and the page. A member
 -- reassigned, or a nurse or doctor deactivated, while this runs can never leave her with an alert she may no longer read
 -- (staff_care_access rechecks the nurse, the doctor, the clinic and the session inside the same statement).
 with mine as(
   select k.user_id from public.patient_clinical_cases k
   where k.assigned_nurse_id=me and public.staff_care_access(k.user_id,me,true)),
  live as(
   select a.* from public.care_alerts a join mine on mine.user_id=a.member_id where a.state<>'resolved'),
  page as(
   select * from live order by(state<>'open'),(source not in('zoe','message')),coalesce(last_seen_at,created_at)desc,id limit lim)
 select(select count(*)from live),
  coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'memberId',a.member_id,
    'memberName',coalesce((select p.display_name from public.profiles p where p.id=a.member_id),''),
    'source',a.source,'priority',a.priority,'reason',a.reason_code,'redFlags',to_jsonb(a.red_flags),
    'state',a.state,'stateSeq',a.state_seq,'occurrences',a.occurrences,'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,
    'acknowledgedAt',a.acknowledged_at)order by(a.state<>'open'),(a.source not in('zoe','message')),coalesce(a.last_seen_at,a.created_at)desc,a.id)from page a),'[]'::jsonb)
 into total,items;
 -- As in member search, an audit failure refuses the whole read, never a partial result.
 for m in select distinct(e->>'memberId')::uuid from jsonb_array_elements(items)e loop
  perform public._access_audit_record(m,'care_alert_inbox','nurse');
 end loop;
 return jsonb_build_object('ok',true,'asOf',statement_timestamp(),'total',total,'alerts',items);
end$$;
revoke all on function public.care_alert_nurse_inbox(integer)from public,anon,authenticated,service_role;
grant execute on function public.care_alert_nurse_inbox(integer)to authenticated;
