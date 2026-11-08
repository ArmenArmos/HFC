-- Activity log: the filters reach every source (quality review 18 Oct, item 43).
-- _activity_rows was a security definer SQL function, which Postgres cannot inline, so every call
-- read and unioned all 21 audit sources for the whole date window before _activity_page applied the
-- person, member and type filters. The filters now go into each branch: a source whose type cannot
-- match is skipped by a one-time filter, and actor/member conditions drop rows inside each scan.
-- _activity_page also orders and limits before it joins display names, and a call without a start
-- date covers 366 days rather than all history (the app always sends a start, 7 days by default).
-- Same rows, same order, same cursor format; nothing else changes.

create function public._activity_rows(p_from timestamptz,p_to timestamptz,p_actor uuid,p_member uuid,p_category text)
returns table(at timestamptz,key text,category text,source text,action text,actor_id uuid,member_id uuid,ref text)
language sql stable security definer set search_path=''as $$
 select a.at,'access:'||a.id,case when a.surface like 'activity_log.%'then 'export' else 'record_access' end,'access',a.surface,a.actor_id,a.member_id,a.object_id
  from public.access_audit a where a.at>=p_from and a.at<=p_to
   and(p_category is null or p_category=case when a.surface like 'activity_log.%'then 'export' else 'record_access' end)and(p_actor is null or a.actor_id=p_actor)
   and(p_member is null or a.member_id=p_member)
 union all
 select e.created_at,'auth:'||e.id,'sign_in','auth',e.payload->>'action',u.id,
  case when not exists(select 1 from public.workspace_staff s where s.user_id=u.id)and not exists(select 1 from public.clinic_portal_memberships m where m.user_id=u.id)then u.id end,null
  from auth.audit_log_entries e
  left join lateral(select case when e.payload->>'actor_id' ~ '^[0-9a-f-]{36}$' then (e.payload->>'actor_id')::uuid end id)u on true
  where e.created_at>=p_from and e.created_at<=p_to
   and e.payload->>'action' in('login','logout','user_signedup','user_recovery_requested','user_updated_password','user_invited','user_deleted','user_modified')
   and(p_category is null or p_category='sign_in')and(p_actor is null or u.id=p_actor)
   and(p_member is null or case when not exists(select 1 from public.workspace_staff s where s.user_id=u.id)and not exists(select 1 from public.clinic_portal_memberships m where m.user_id=u.id)then u.id end=p_member)
 union all
 select t.created_at,'telegram_auth:'||t.id,'sign_in','telegram_auth',t.kind,t.auth_user_id,
  case when not exists(select 1 from public.workspace_staff s where s.user_id=t.auth_user_id)and not exists(select 1 from public.clinic_portal_memberships m where m.user_id=t.auth_user_id)then t.auth_user_id end,null
  from public.telegram_auth_audit t where t.created_at>=p_from and t.created_at<=p_to
   and(p_category is null or p_category='sign_in')and(p_actor is null or t.auth_user_id=p_actor)
   and(p_member is null or case when not exists(select 1 from public.workspace_staff s where s.user_id=t.auth_user_id)and not exists(select 1 from public.clinic_portal_memberships m where m.user_id=t.auth_user_id)then t.auth_user_id end=p_member)
 union all
 select t.created_at,'telegram:'||t.id,'sign_in','telegram',t.kind,t.member_id,t.member_id,null
  from public.telegram_audit t where t.created_at>=p_from and t.created_at<=p_to and t.kind like 'link.%'
   and(p_category is null or p_category='sign_in')and(p_actor is null or t.member_id=p_actor)
   and(p_member is null or t.member_id=p_member)
 union all
 select o.created_at,'document_open:'||o.id,'record_access','document_open',o.actor_kind,o.actor_id,o.user_id,o.file_id::text
  from public.patient_document_opens o where o.created_at>=p_from and o.created_at<=p_to
   and(p_category is null or p_category='record_access')and(p_actor is null or o.actor_id=p_actor)
   and(p_member is null or o.user_id=p_member)
 union all
 select c.created_at,'clinic_file_open:'||c.id,'record_access','clinic_file_open','opened',c.actor_id,
  (select r.user_id from public.clinic_result_attachments r where r.file_id=c.file_id order by r.created_at desc limit 1),c.file_id::text
  from public.clinic_original_accesses c where c.created_at>=p_from and c.created_at<=p_to
   and(p_category is null or p_category='record_access')and(p_actor is null or c.actor_id=p_actor)
   and(p_member is null or (select r.user_id from public.clinic_result_attachments r where r.file_id=c.file_id order by r.created_at desc limit 1)=p_member)
 union all
 select c.created_at,'clinic:'||c.id,case when c.kind like 'member-file-%'then 'record_access' else 'care_change' end,'clinic',c.kind,c.actor_id,
  case when c.detail->>'memberId' ~ '^[0-9a-f-]{36}$' then (c.detail->>'memberId')::uuid end,c.batch_id::text
  from public.clinic_portal_audit c where c.created_at>=p_from and c.created_at<=p_to
   and(p_category is null or p_category=case when c.kind like 'member-file-%'then 'record_access' else 'care_change' end)and(p_actor is null or c.actor_id=p_actor)
   and(p_member is null or case when c.detail->>'memberId' ~ '^[0-9a-f-]{36}$' then (c.detail->>'memberId')::uuid end=p_member)
 union all
 select e.created_at,'clinical_case:'||e.id,'care_change','clinical_case',e.kind,e.actor_id,e.user_id,null
  from public.patient_clinical_case_events e where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='care_change')and(p_actor is null or e.actor_id=p_actor)
   and(p_member is null or e.user_id=p_member)
 union all
 select e.created_at,'document_release:'||e.id,'care_change','document_release',e.kind,e.actor_id,e.user_id,e.file_id::text
  from public.patient_document_release_events e where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='care_change')and(p_actor is null or e.actor_id=p_actor)
   and(p_member is null or e.user_id=p_member)
 union all
 select e.created_at,'coordination:'||e.id,'care_change','coordination',e.operation,e.actor_id,t.patient_case_id,e.task_id::text
  from public.patient_coordination_events e join public.patient_coordination_tasks t on t.id=e.task_id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='care_change')and(p_actor is null or e.actor_id=p_actor)
   and(p_member is null or t.patient_case_id=p_member)
 union all
 select e.created_at,'test_request:'||e.request_id||'-'||e.command_id,'care_change','test_request',e.operation,e.actor_id,r.user_id,e.request_id::text
  from public.patient_test_request_events e join public.patient_test_requests r on r.id=e.request_id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='care_change')and(p_actor is null or e.actor_id=p_actor)
   and(p_member is null or r.user_id=p_member)
 union all
 select e.created_at,'care_alert:'||e.id,'care_change','care_alert',e.kind,e.actor_id,a.member_id,e.alert_id::text
  from public.care_alert_audit e join public.care_alerts a on a.id=e.alert_id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='care_change')and(p_actor is null or e.actor_id=p_actor)
   and(p_member is null or a.member_id=p_member)
 union all
 select e.created_at,'conversation:'||e.id,'care_change','conversation',e.kind,e.actor_id,c.member_id,null
  from public.conversation_audit e join public.conversations c on c.id=e.conversation_id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='care_change')and(p_actor is null or e.actor_id=p_actor)
   and(p_member is null or c.member_id=p_member)
 union all
 select e.created_at,'booking:'||e.id,'care_change','booking',e.kind,null,a.member_id,e.appointment_id::text
  from public.booking_appointment_events e join public.booking_appointments a on a.id=e.appointment_id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='care_change')and p_actor is null
   and(p_member is null or a.member_id=p_member)
 union all
 select e.at,'payment:'||e.id,'admin_change','payment',e.kind||coalesce(':'||e.to_status,''),e.actor_id,p.member_id,e.payment_id::text
  from public.pilot_payment_events e join public.pilot_payments p on p.id=e.payment_id where e.at>=p_from and e.at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor_id=p_actor)
   and(p_member is null or p.member_id=p_member)
 union all
 select e.at,'catalog:'||e.id,'admin_change','catalog',e.kind,e.actor_id,null,e.test_id::text
  from public.pilot_catalog_events e where e.at>=p_from and e.at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor_id=p_actor)and p_member is null
 union all
 select e.at,'bp_device:'||e.id,'admin_change','bp_device',e.kind,e.actor_id,null,e.device_id::text
  from public.bp_device_events e where e.at>=p_from and e.at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor_id=p_actor)and p_member is null
 union all
 select e.created_at,'zoe_tier:'||e.id,'admin_change','zoe_tier',e.action||':'||e.tier,e.actor,null,null
  from public.zoe_tier_config_changes e where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor=p_actor)and p_member is null
 union all
 select e.created_at,'staff_admin:'||e.id,'admin_change','staff_admin',e.kind,e.actor_id,null,coalesce(e.invitation_id,e.clinic_id)::text
  from public.real_staff_admin_events e where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor_id=p_actor)and p_member is null
 union all
 select e.created_at,'staff_recovery:'||e.id,'admin_change','staff_recovery',e.kind,e.actor_id,null,e.recovery_id::text
  from public.real_staff_recovery_events e where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor_id=p_actor)and p_member is null
 union all
 select e.at,'config:'||e.id,'admin_change','config',e.operation||':'||e.table_name,e.actor_id,null,
  left(coalesce(e.row_key,'')||' ('||(select string_agg(k,', 'order by k)from jsonb_object_keys(e.changed)k)||')',200)
  from public.config_audit e where e.at>=p_from and e.at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor_id=p_actor)and p_member is null
$$;
revoke all on function public._activity_rows(timestamptz,timestamptz,uuid,uuid,text)from public,anon,authenticated,service_role;

create or replace function public._activity_page(p_actor uuid,p_member uuid,p_category text,p_from timestamptz,p_to timestamptz,p_cursor text,p_limit integer)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c_at timestamptz;c_key text;lim int:=greatest(1,least(coalesce(p_limit,100),5000));rows jsonb;n int;
begin
 if p_category is not null and p_category not in('sign_in','record_access','care_change','admin_change','export')then raise invalid_parameter_value;end if;
 if p_cursor is not null then
  if p_cursor !~ '^[0-9TZ:.+-]{10,40}\|[a-z_]{1,40}:[A-Za-z0-9-]{1,80}$' then raise invalid_parameter_value;end if;
  c_at:=split_part(p_cursor,'|',1)::timestamptz;c_key:=split_part(p_cursor,'|',2);
 end if;
 select coalesce(jsonb_agg(x order by ord),'[]'),count(*)into rows,n from(
  select row_number()over(order by r.at desc,r.key desc)ord,jsonb_build_object(
   'key',r.key,'at',to_char(r.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'category',r.category,'source',r.source,'action',coalesce(r.action,'unknown'),
   'actorId',r.actor_id,'actorName',coalesce(ws.display_name,cm.display_name,ap.display_name),
   'actorRole',coalesce(ws.role,case when cm.display_name is not null then 'clinic' end,case when ap.id is not null then 'member' end),
   'memberId',r.member_id,'memberName',mp.display_name,'ref',r.ref)x
  from(select f.* from public._activity_rows(coalesce(p_from,now()-interval '366 days'),least(coalesce(p_to,'infinity'),coalesce(c_at,'infinity')),p_actor,p_member,p_category)f
    where(p_to is null or f.at<p_to)and(c_at is null or(f.at,f.key)<(c_at,c_key))
    order by f.at desc,f.key desc limit lim+1)r
  left join public.workspace_staff ws on ws.user_id=r.actor_id
  left join lateral(select m.display_name from public.clinic_portal_memberships m where m.user_id=r.actor_id order by m.active desc limit 1)cm on ws.user_id is null
  left join public.profiles ap on ap.id=r.actor_id and ws.user_id is null and cm.display_name is null
  left join public.profiles mp on mp.id=r.member_id)s;
 return jsonb_build_object('ok',true,'rows',(select coalesce(jsonb_agg(v),'[]')from(select v from jsonb_array_elements(rows)with ordinality e(v,i)where i<=lim)q),
  'next',case when n>lim then (rows->(lim-1)->>'at')||'|'||(rows->(lim-1)->>'key')end);
end$$;
revoke all on function public._activity_page(uuid,uuid,text,timestamptz,timestamptz,text,integer)from public,anon,authenticated,service_role;

drop function public._activity_rows(timestamptz,timestamptz);
