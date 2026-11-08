-- Lead replaces this placeholder stamp and regenerates types before integration.
-- A read-only snapshot, with exactly the alert's visibility check. No locks, writes,
-- provider calls, draft bodies or clinical inference. Existing list reads lack this evidence.
create function public.care_alert_resolution_record(p_alert uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare actor jsonb:=public._care_alert_actor();a public.care_alerts;contacts jsonb;
begin
 select * into a from public.care_alerts where id=p_alert;
 if not found or not public._care_alert_visible(a,actor)then return jsonb_build_object('ok',false,'code','not_found');end if;
 select coalesce(jsonb_agg(to_jsonb(q)order by q.at desc,q.id),'[]')into contacts from(
  select r.id::text id,a.member_id as "memberId",r.created_at at,r.nurse_name as "by",'reply'::text kind,'in_app'::text state
  from public.conversation_nurse_replies r join public.conversations c on c.id=r.conversation_id
  where c.member_id=a.member_id and r.created_at>a.cycle_started_at
  union all
  select ap.id::text,a.member_id,ap.created_at,ap.doctor_name,'reply',case when ar.approval_id is not null then 'in_app'else dl.state end
  from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
   join public.conversations c on c.id=d.conversation_id
   left join public.conversation_app_releases ar on ar.approval_id=ap.id and ar.member_id=a.member_id and ar.conversation_id=c.id
   left join public.conversation_deliveries dl on dl.approval_id=ap.id and dl.conversation_id=c.id
  where c.member_id=a.member_id and ap.created_at>a.cycle_started_at and(ar.approval_id is not null or dl.state='accepted_by_provider')
  union all
  -- Only an explicit source-message link relates a coordination task to this alert.
  -- Same-member tasks alone, contact attempts and unreachable outcomes do not prove contact.
  select e.id::text,a.member_id,e.created_at,e.actor_name,'task','reached'
  from public.patient_coordination_events e join public.patient_coordination_tasks t on t.id=e.task_id
   join public.conversation_nurse_handoffs h on h.task_id=t.id
   join public.conversations c on c.id=h.conversation_id
  where t.patient_case_id=a.member_id and c.member_id=a.member_id and e.created_at>a.cycle_started_at
   and e.operation='contact'and e.detail#>>'{input,outcome}'='reached'
   and exists(select 1 from public.care_alert_screenings s join public.conversation_messages m on m.id::text=s.source_ref
    where s.alert_id=a.id and s.member_id=a.member_id and s.source='message'and m.conversation_id=c.id and h.message_id='m'||m.seq::text)
  order by at desc,id limit 20
 )q;
 -- Reopening starts a fresh evidence window. Return contact facts only, never task
 -- instructions, staff notes, message bodies or draft text.
 return jsonb_build_object('ok',true,'record',jsonb_build_object('alert',public._care_alert_json(a)-'resolutionNote','cycleStartedAt',a.cycle_started_at,'contacts',contacts,'closer',(select display_name from public.workspace_staff where user_id=(actor->>'id')::uuid)));
end$$;
revoke all on function public.care_alert_resolution_record(uuid)from public,anon,authenticated,service_role;
grant execute on function public.care_alert_resolution_record(uuid)to authenticated;

-- Resolve already acknowledges in the same transaction. Journal that acknowledgement too,
-- after existing actor, owner, state and sequence checks and before the existing update.
-- Preserve the entire current function, including #684's shared lock order and handback guard.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public.care_alert_resolve(uuid,bigint,text,text)'::regprocedure);
 old:=$old$ update public.care_alerts set state='resolved',$old$;
 replacement:=$new$ if a.state='open'then
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,(actor->>'id')::uuid,'acknowledged',jsonb_build_object('role',actor->>'role','via','resolve'));
 end if;
 update public.care_alerts set state='resolved',$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected care_alert_resolve update definition';end if;
 definition:=replace(definition,old,replacement);
 -- A reopened alert is acknowledged by the person resolving this occurrence.
 old:=$old$acknowledged_by=coalesce(acknowledged_by,(actor->>'id')::uuid),acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),$old$;
 replacement:=$new$acknowledged_by=case when a.state='open'then(actor->>'id')::uuid else acknowledged_by end,
  acknowledged_at=case when a.state='open'then clock_timestamp()else acknowledged_at end,$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected care_alert_resolve acknowledgement definition';end if;
 execute replace(definition,old,replacement);
end $migration$;
