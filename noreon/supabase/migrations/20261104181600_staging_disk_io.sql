-- Staging disk IO: bounded audit-page sorting and deduplicated inbox access.
-- Placeholder stamp requested by the integrator; rename before applying anywhere.
-- Existing entry points retain their signatures, guards, grants and search_path.
-- The raw relational helper is private and intentionally SQL SECURITY INVOKER
-- without SET options so PostgreSQL can inline it inside the guarded definers.
-- Its UNION ALL is the previous _audit_rows body unchanged; keep one source list.

create function public._audit_source_rows(p_from timestamptz,p_to timestamptz,p_actor uuid,p_member uuid,p_category text)
returns table(at timestamptz,key text,category text,source text,action text,actor_id uuid,member_id uuid,ref text)
language sql stable as $$
 select a.at,'access:'||a.id,case when a.surface in('activity_log.export','audit_log.export')then 'export' else 'record_access' end,'access',a.surface,a.actor_id,a.member_id,
  case when a.object_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then a.object_id end -- caller-supplied text: ids only (review F1)
  from public.access_audit a where a.at>=p_from and a.at<=p_to
   and(p_category is null or p_category=case when a.surface in('activity_log.export','audit_log.export')then 'export' else 'record_access' end)and(p_actor is null or a.actor_id=p_actor)
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
 select c.created_at,'clinic:'||c.id,public._audit_clinic_category(c.kind),'clinic',c.kind,c.actor_id,
  case when c.detail->>'memberId' ~ '^[0-9a-f-]{36}$' then (c.detail->>'memberId')::uuid end,c.batch_id::text
  from public.clinic_portal_audit c where c.created_at>=p_from and c.created_at<=p_to
   and(p_category is null or p_category=public._audit_clinic_category(c.kind))and(p_actor is null or c.actor_id=p_actor)
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
 select e.created_at,'care_alert:'||e.id,'alert_change','care_alert',e.kind,e.actor_id,a.member_id,e.alert_id::text
  from public.care_alert_audit e join public.care_alerts a on a.id=e.alert_id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='alert_change')and(p_actor is null or e.actor_id=p_actor)
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
 select e.created_at,'staff_admin:'||e.id,'permission_change','staff_admin',e.kind,e.actor_id,null,coalesce(e.invitation_id,e.clinic_id)::text
  from public.real_staff_admin_events e where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='permission_change')and(p_actor is null or e.actor_id=p_actor)and p_member is null
 union all
 select e.created_at,'staff_recovery:'||e.id,'admin_change','staff_recovery',e.kind,e.actor_id,null,e.recovery_id::text
  from public.real_staff_recovery_events e where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='admin_change')and(p_actor is null or e.actor_id=p_actor)and p_member is null
 union all
 select e.at,'config:'||e.id,case when e.table_name in('workspace_staff','clinic_portal_memberships','workspace_clinics')then 'permission_change'else 'admin_change'end,'config',e.operation||':'||e.table_name,e.actor_id,null,
  e.id::text
  from public.config_audit e where e.at>=p_from and e.at<=p_to
   and(p_category is null or p_category=case when e.table_name in('workspace_staff','clinic_portal_memberships','workspace_clinics')then 'permission_change'else 'admin_change'end)and(p_actor is null or e.actor_id=p_actor)and p_member is null
 union all
 select e.created_at,'telegram_auth_message:'||e.id,'outbound_message','telegram_auth_message','telegram:'||e.template_id||':'||e.state,null::uuid,coalesce(ca.member_id,mn.member_id,case when b.kind='member'then b.auth_user_id end),coalesce(d.recipient_id,mn.member_id,b.auth_user_id)::text
  from public.telegram_auth_messages e left join public.care_alert_deliveries d on d.telegram_message_id=e.id left join public.care_alerts ca on ca.id=d.alert_id left join public.member_notices mn on mn.telegram_message_id=e.id left join lateral(select x.auth_user_id,x.kind from public.telegram_auth_bindings x where x.principal_ref=e.principal_ref and x.created_at<=e.created_at and(x.revoked_at is null or x.revoked_at>=e.created_at)order by x.created_at desc,x.id limit 1)b on true where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='outbound_message')and(null::uuid=p_actor or p_actor is null)
   and(p_member is null or coalesce(ca.member_id,mn.member_id,case when b.kind='member'then b.auth_user_id end)=p_member)
 union all
 select e.created_at,'conversation_delivery:'||e.id,'outbound_message','conversation_delivery',coalesce(ep.adapter,'telegram')||':reply:'||e.state,a.doctor_id,c.member_id,c.member_id::text
  from public.conversation_deliveries e join public.conversations c on c.id=e.conversation_id join public.conversation_approvals a on a.id=e.approval_id left join public.conversation_endpoints ep on ep.id=e.endpoint_id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='outbound_message')and(a.doctor_id=p_actor or p_actor is null)
   and(p_member is null or c.member_id=p_member)
 union all
 select e.started_at,'patient_message_attempt:'||e.id,'outbound_message','patient_message_attempt',e.channel||':'||e.template_key||':'||e.status,null::uuid,e.user_id,e.user_id::text
  from public.patient_message_attempts e  where e.started_at>=p_from and e.started_at<=p_to
   and(p_category is null or p_category='outbound_message')and(null::uuid=p_actor or p_actor is null)
   and(p_member is null or e.user_id=p_member)
 union all
 select e.received_at,'patient_message_delivery:'||e.id,'outbound_message','patient_message_delivery',a.channel||':'||a.template_key||':'||e.status,null::uuid,a.user_id,a.user_id::text
  from public.patient_message_delivery_events e join public.patient_message_attempts a on a.id=e.attempt_id where e.received_at>=p_from and e.received_at<=p_to
   and(p_category is null or p_category='outbound_message')and(null::uuid=p_actor or p_actor is null)
   and(p_member is null or a.user_id=p_member)
 union all
 select e.created_at,'telegram_nurse_outbox:'||e.id||coalesce('-'||mm.member_id::text,''),'outbound_message','telegram_nurse_outbox','telegram:'||e.template_id||':'||e.state,null::uuid,mm.member_id,b.auth_user_id::text
  from public.telegram_nurse_outbox e left join public.telegram_auth_bindings b on b.id=e.binding_id left join lateral(select distinct v member_id from unnest(e.member_ids)v)mm on true where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='outbound_message')and(null::uuid=p_actor or p_actor is null)
   and(p_member is null or mm.member_id=p_member)
 union all
 select e.created_at,'member_push_delivery:'||e.id,'outbound_message','member_push_delivery','push:member_notice.push:'||e.state,null::uuid,e.member_id,e.member_id::text
  from public.member_push_deliveries e  where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='outbound_message')and(null::uuid=p_actor or p_actor is null)
   and(p_member is null or e.member_id=p_member)
 union all
 select e.created_at,'system_message:'||e.id,'outbound_message',case when z.system_message_id is not null then 'zoe_chat_card_send'else 'system_message'end,coalesce(ep.adapter,'telegram')||':'||e.template_id||':'||e.state,null::uuid,e.member_id,e.member_id::text
  from public.system_messages e left join public.conversation_endpoints ep on ep.id=e.endpoint_id left join public.zoe_chat_card_sends z on z.system_message_id=e.id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='outbound_message')and(null::uuid=p_actor or p_actor is null)
   and(p_member is null or e.member_id=p_member)
 union all
 select e.created_at,'system_message_audit:'||e.id,'outbound_message','system_message_audit',coalesce(ep.adapter,'telegram')||':'||m.template_id||':'||e.kind,null::uuid,m.member_id,m.member_id::text
  from public.system_message_audit e join public.system_messages m on m.id=e.message_id left join public.conversation_endpoints ep on ep.id=m.endpoint_id where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='outbound_message')and(null::uuid=p_actor or p_actor is null)
   and(p_member is null or m.member_id=p_member)
 union all
 select e.created_at,'booking_notice_attempt:'||e.id,'outbound_message','booking_notice','email:'||n.template_version||':'||n.state,coalesce(c.actor_id,v.actor_id),ap.member_id,null::text
  from public.booking_notice_attempts e join public.booking_scheduling_notices n on n.id=e.notice_id join public.booking_appointments ap on ap.id=n.appointment_id
  left join public.booking_notice_first_send_commands c on c.attempt_id=e.id
  left join public.booking_appointment_versions v on v.notice_id=n.id -- who made the booking change; a recovery command takes precedence
  where e.created_at>=p_from and e.created_at<=p_to
   and(p_category is null or p_category='outbound_message')and(coalesce(c.actor_id,v.actor_id)=p_actor or p_actor is null)
   and(p_member is null or ap.member_id=p_member)
$$;
revoke all on function public._audit_source_rows(timestamptz,timestamptz,uuid,uuid,text)from public,anon,authenticated,service_role;

create or replace function public._audit_rows(p_from timestamptz,p_to timestamptz,p_actor uuid,p_member uuid,p_category text)
returns table(at timestamptz,key text,category text,source text,action text,actor_id uuid,member_id uuid,ref text)
language sql stable security definer set search_path=''as $$
 select * from public._audit_source_rows(p_from,p_to,p_actor,p_member,p_category)
$$;

-- Only (at,key) reaches the history-wide top-N sort. Materialization prevents
-- detail/name/JSON work moving ahead of the page boundary. lim+1 keeps the
-- existing next-cursor semantics; all later ordered aggregates see only a page.
-- Rehydrate within the page's time range with a scalar key-array filter: this
-- needs no history-wide join sort carrying the detail columns.
create or replace function public._audit_page(p_actor uuid,p_member uuid,p_category text,p_from timestamptz,p_to timestamptz,p_cursor text,p_limit integer,p_clinic uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c_at timestamptz;c_key text;lim int:=greatest(1,least(coalesce(p_limit,100),5000));rows jsonb;n int;
begin
 if p_category is not null and p_category not in('sign_in','record_access','alert_change','outbound_message','permission_change','care_change','admin_change','export')then raise invalid_parameter_value;end if;
 if p_cursor is not null then
  if p_cursor !~ '^[0-9TZ:.+-]{10,40}\|[a-z_]{1,40}:[A-Za-z0-9-]{1,80}$' then raise invalid_parameter_value;end if;
  c_at:=split_part(p_cursor,'|',1)::timestamptz;c_key:=split_part(p_cursor,'|',2);
 end if;
 with scope as materialized(select * from public._audit_clinic_scope(p_clinic)),
 page_keys as materialized(
  select f.at,f.key
  from public._audit_source_rows(coalesce(p_from,now()-interval '366 days'),least(coalesce(p_to,'infinity'),coalesce(c_at,'infinity')),p_actor,p_member,p_category)f
    where(p_clinic is null or(f.category<>'admin_change'and(f.category<>'sign_in'or f.member_id is null)
     and(exists(select 1 from scope s where s.kind='actor'and s.id=f.actor_id)or exists(select 1 from scope s where s.kind='member'and s.id=f.member_id))))
    and(p_to is null or f.at<p_to)and(c_at is null or(f.at,f.key)<(c_at,c_key))
    order by f.at desc,f.key desc limit lim+1
 ),page_bounds as materialized(
  select min(k.at)lo,max(k.at)hi,array_agg(k.key)keys from page_keys k
 )
 select coalesce(jsonb_agg(x order by ord),'[]'),count(*)into rows,n from(
  select row_number()over(order by r.at desc,r.key desc)ord,jsonb_build_object(
   'key',r.key,'at',to_char(r.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'category',r.category,'source',r.source,'action',case when p_clinic is not null and r.category='record_access'
    and r.source<>'clinic'and ws.role in('doctor','nurse','admin')then 'member_record'else coalesce(r.action,'unknown')end,
   'actorId',case when p_clinic is not null and ws.user_id is not null and not exists(select 1 from scope s where s.kind='actor'and s.id=ws.user_id)
    then null else r.actor_id end,
   'actorName',case when p_clinic is not null and ws.user_id is not null and not exists(select 1 from scope s where s.kind='actor'and s.id=ws.user_id)
    then 'Noreon'else coalesce(ws.display_name,cm.display_name,ap.display_name)end,
   'actorRole',case when p_clinic is not null and ws.user_id is not null and not exists(select 1 from scope s where s.kind='actor'and s.id=ws.user_id)
    then 'noreon'else coalesce(ws.role,case when cm.display_name is not null then 'clinic' end,case when ap.id is not null then 'member' end)end,
   'memberId',case when r.member_visible then r.member_id end,'memberName',case when r.member_visible then mp.display_name end,
   'ref',case when not r.member_visible then null
    when p_clinic is not null and r.ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and exists(select 1 from public.profiles p where p.id=r.ref::uuid)
     and not exists(select 1 from scope s where s.kind='member'and s.id=r.ref::uuid)
     and not exists(select 1 from scope s where s.kind='actor'and s.id=r.ref::uuid) then null
    else r.ref end)x
  from(select f.*,(p_clinic is null or f.member_id is null or exists(select 1 from scope s where s.kind='member'and s.id=f.member_id))member_visible
    from page_bounds b
    cross join lateral public._audit_source_rows(b.lo,b.hi,p_actor,p_member,p_category)f
    where f.key=any(b.keys))r
  left join public.workspace_staff ws on ws.user_id=r.actor_id
  left join lateral(select m.display_name from public.clinic_portal_memberships m where m.user_id=r.actor_id order by m.active desc limit 1)cm on ws.user_id is null
  left join public.profiles ap on ap.id=r.actor_id and ws.user_id is null and cm.display_name is null
  left join public.profiles mp on mp.id=r.member_id and r.member_visible)s;
 return jsonb_build_object('ok',true,'rows',(select coalesce(jsonb_agg(v),'[]')from(select v from jsonb_array_elements(rows)with ordinality e(v,i)where i<=lim)q),
  'next',case when n>lim then (rows->(lim-1)->>'at')||'|'||(rows->(lim-1)->>'key')end);
end$$;

-- The people RPC has no pagination: preserve every eligible person and order.
-- Test actor existence using the inlinable source, never a full audit DTO spool.
create or replace function public._audit_people(p_clinic uuid default null)returns jsonb
language sql stable security definer set search_path=''as $$
 with scope as materialized(select * from public._audit_clinic_scope(p_clinic)),
 eligible as materialized(
  select m.user_id id from public.clinic_portal_memberships m
   where p_clinic is not null and (
    exists(select 1 from scope s where s.kind='actor'and s.id=m.user_id)
    or exists(select 1 from public._audit_source_rows(now()-interval '366 days','infinity',m.user_id,null,null)r
     where r.category not in('sign_in','admin_change')
      and exists(select 1 from scope s where s.kind='member'and s.id=r.member_id)))
 ),people as(
  select s.user_id id,s.display_name name,s.role||case when s.removed_at is not null or not s.active then ', removed'else ''end role
   from public.workspace_staff s where p_clinic is null or exists(select 1 from scope c where c.kind='actor'and c.id=s.user_id)
  union all
  select m.user_id,min(m.display_name),'clinic'from public.clinic_portal_memberships m
   where not exists(select 1 from public.workspace_staff s where s.user_id=m.user_id)
    and(p_clinic is null or exists(select 1 from eligible e where e.id=m.user_id))
    group by m.user_id
 )select jsonb_build_object('ok',true,'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role)order by name,id)from people),'[]'::jsonb))
$$;

create or replace function public.clinic_audit_log(p_clinic uuid,p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 100,p_profile_values boolean default false)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_actor is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='actor'and s.id=p_actor)
  then return jsonb_build_object('status','refused');end if;
 if p_member is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='member'and s.id=p_member)
  then return jsonb_build_object('status','refused');end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'audit-log-view',jsonb_build_object('membershipId',m.id));
 if p_profile_values then return public._audit_profile_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200),p_clinic);end if;
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200),p_clinic);
exception when insufficient_privilege then return jsonb_build_object('status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;

create or replace function public.clinic_audit_people(p_clinic uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'audit-log-view',jsonb_build_object('membershipId',m.id));
 return public._audit_people(p_clinic);
exception when insufficient_privilege then return jsonb_build_object('status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;

create or replace function public.doctor_ai_inbox()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare
 who jsonb:=public.real_clinical_staff_identity();
 me uuid;
 today date:=public._programme_today(clock_timestamp());
 p0 jsonb:='[]';items jsonb:='[]';part jsonb;missing text[]:='{}';
 p0_total integer;p0_cap constant integer:=200;lane_cap constant integer:=50;
 audit_session text:=left(auth.jwt()->>'session_id',80);
 audit_cutoff timestamptz;
 audit_member uuid;
 shown_members uuid[];
 members uuid[];za jsonb:='[]';za_total integer:=0;nurse_activity jsonb:='[]';
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;

 -- Members this doctor may read: assigned to them, with care access (as doctor_programme_queue). An array, not a
 -- temp table, so a caller's own session objects can never stand in for it.
 select coalesce(array_agg(k.user_id),'{}')into members from public.patient_clinical_cases k
  where k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true)and not public._test_member_hidden(k.user_id,me);

 -- P0: care alerts. Open (new, or open again) before acknowledged; then oldest first.
 select count(*)into p0_total from public.care_alerts a where a.member_id=any(members)and a.state<>'resolved';
 select coalesce(jsonb_agg(x order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into p0 from(
  select jsonb_build_object('id','care_alert:'||a.id,'lane','P0','kind','care_alert','rank',case when a.state='open'then 0 else 1 end,
   'memberId',a.member_id,'at',a.created_at,'confidence','rule','ai','none',
   'sources',jsonb_build_array(jsonb_build_object('type','care_alert','ref',a.id::text),jsonb_build_object('type','source','ref',a.source))
    ||coalesce((select jsonb_agg(jsonb_build_object('type','rule','ref',f))from unnest(a.red_flags)f),'[]'),
   'alert',public._care_alert_json(a))x
  from public.care_alerts a where a.member_id=any(members)and a.state<>'resolved'
  order by(a.state='open')desc,a.created_at,a.id limit p0_cap)q;

 -- P1 and P2: lab files with values still to review. Flagged values make a P1 item; unflagged only, a P2 item.
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','lab:'||v.file_id,'lane',case when bool_or(v.attention is not null)then 'P1'else 'P2'end,
    'kind',case when bool_or(v.attention is not null)then 'lab_attention'else 'lab_sheet'end,
    'rank',case when bool_or(v.attention='lab_critical'or v.lab_flag='critical')then 0 when bool_or(v.attention is not null)then 1 else 3 end,
    'memberId',v.user_id,'at',min(v.created_at),'confidence','H','ai','values',
    'fileId',v.file_id,'toReview',count(*),'flagged',count(*)filter(where v.attention is not null),
    'critical',count(*)filter(where v.attention='lab_critical'or v.lab_flag='critical'),
    'sources',coalesce(jsonb_agg(jsonb_build_object('type','lab_value','ref',v.id::text,'rule',v.attention_rule,'page',v.page)order by v.seq)
     filter(where v.attention is not null),'[]')||jsonb_build_array(jsonb_build_object('type','lab_file','ref',v.file_id::text)))x
   from public.lab_ai_values v
   where v.user_id=any(members)and v.status='unverified'and public._lab_ai_current(v.attachment_id)
   group by v.user_id,v.file_id)q;
  items:=items||part;
 exception when others then missing:=array_append(missing,'lab');end;

 -- P1 "worse" check-ins and P2 checkpoints due within 3 days (or overdue), while the programme is on.
 begin
  if public._programme_enabled()then
   select coalesce(jsonb_agg(x),'[]')into part from(
    select jsonb_build_object('id','checkpoint:'||c.id,'lane',case when i.feeling='worse'then 'P1'else 'P2'end,
     'kind',case when i.feeling='worse'then 'checkin_worse'else 'checkpoint_due'end,
     'rank',case when i.feeling='worse'then 2 when c.due_on<today then 0 else 2 end,
     'memberId',c.member_id,'at',coalesce(i.submitted_at,c.due_on::timestamptz),'confidence','H','ai','none',
     'checkpointId',c.id,'checkpointKind',c.kind,'dueOn',c.due_on,'overdue',c.due_on<today,'medicines',i.medicines,
     'sources',jsonb_build_array(jsonb_build_object('type','checkpoint','ref',c.id::text,'rule',c.kind))
      ||case when i.id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','checkin','ref',i.id::text))end)x
    from public.programme_checkpoints c
    left join public.programme_checkins i on i.checkpoint_id=c.id
    where c.member_id=any(members)and c.state in('scheduled','open')and(i.feeling='worse'or c.due_on<=today+3))q;
   items:=items||part;
  end if;
 exception when others then missing:=array_append(missing,'programme');end;

 -- P2 AI care plan drafts: the member's latest ready draft, not adopted, with no plan published since.
 begin
  if public._ai_plan_enabled()then
   select coalesce(jsonb_agg(x),'[]')into part from(
    select jsonb_build_object('id','plan:'||g.id,'lane','P2','kind','plan_draft','rank',1,
     'memberId',g.user_id,'at',g.created_at,'confidence','M','ai',case when g.mode='protocol_only'then 'protocol'else 'draft'end,
     'generationId',g.id,'stale',(g.lab_token is distinct from public._ai_plan_lab_token(g.user_id)or g.case_revision is distinct from k.revision),
     'sources',jsonb_build_array(jsonb_build_object('type','plan_generation','ref',g.id::text,'rule',g.prompt_version),
      jsonb_build_object('type','case_revision','ref',g.case_revision::text)))x
    from public.patient_clinical_cases k
    cross join lateral(select * from public.ai_plan_generations g where g.user_id=k.user_id and g.state='ready'order by g.created_at desc limit 1)g
    where k.user_id=any(members)and g.adopted_at is null
     and not exists(select 1 from public.patient_clinical_publications p where p.user_id=g.user_id and p.published_at>g.created_at))q;
   items:=items||part;
  end if;
 exception when others then missing:=array_append(missing,'plan');end;

 -- P1 and P3 replies, by the Replies page's rules (conversation_awaiting_replies) with two differences so that only a
 -- decision closes an item (review DI-01, DI-02): an undelivered reply stays until a newer reply or a rejection, at any
 -- age; and the wait starts at the oldest unanswered member event, a stored message or a media or over-limit message
 -- that has no stored row. Over 24 h is P1.
 -- Zoe's structured reply draft (#323) for the pending draft is carried on the item: the exact text, its revision and
 -- content hash (what an inbox Approve is bound to), and its sources. A question whose draft needs the doctor's
 -- judgement is P1 at any age. The draft is approvable from the inbox only when it is structured, current (conversation,
 -- clinical revision and evidence token unchanged), quotes the plan that is still published, needs no judgement, and the
 -- member has no unresolved care alert: P0 is never answered by a one-tap reply. The approval itself still goes through
 -- conversation_actions and conversation_command, which re-check all of this.
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','reply:'||q.cid,'memberId',q.member_id,
    'lane',case when q.reason='not_delivered'or q.judgement or q.same_day or q.since<clock_timestamp()-interval '24 hours'then 'P1'else 'P3'end,
    'kind',case when q.reason='not_delivered'then 'reply_not_delivered'when q.since<clock_timestamp()-interval '24 hours'then 'reply_overdue'else 'reply_draft'end,
    'rank',case when q.reason='not_delivered'then 5 when q.judgement or q.same_day or q.since<clock_timestamp()-interval '24 hours'then 4 else 0 end,
    'at',case when q.reason='not_delivered'then q.delivered_at else q.since end,
    'confidence',case when q.reason='not_delivered'then 'rule'when q.draft_id is null or q.human_only or q.stale or(q.run_id is not null and not q.plan_current)then 'L'else 'M'end,
    'ai',case when q.reason='not_delivered'or q.draft_id is null or q.human_only then 'none'else 'draft'end,
    'unanswered',q.unanswered,'delivery',q.delivery,
    'sources',jsonb_build_array(jsonb_build_object('type','conversation','ref',q.cid::text,'seq',q.version))
     ||case when q.draft_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','draft','ref',q.draft_id::text,'seq',q.draft_seq))end
     ||case when q.run_id is null or q.reason='not_delivered'then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','zoe_run','ref',q.run_id::text,'rule',q.s_version))
      ||case when q.plan_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('type','plan_publication','ref',q.plan_id::text))end
      ||coalesce((select jsonb_agg(jsonb_build_object('type','plan_item','ref',e->>'id','rule',e->>'kind'))from jsonb_array_elements(q.quoted)e),'[]')end)
    ||case when q.reason='not_delivered'or q.draft_id is null then '{}'::jsonb else jsonb_build_object('draft',jsonb_build_object(
     'draftId',q.draft_id,'revision',q.draft_revision,'body',q.body,'contentHash',q.content_hash,'author',q.author,
     'structured',q.run_id is not null,'stale',q.stale,'planCurrent',q.plan_current,'openAlert',q.open_alert,
     'asked',q.asked,'acknowledgementId',q.ack_id,'needsJudgement',coalesce(q.needs_judgement,false),'outsidePlan',coalesce(q.outside_plan,false),
     'judgementReasons',coalesce(to_jsonb(q.judgement_reasons),'[]'),'doctorDecides',coalesce(to_jsonb(q.doctor_decides),'[]'),
     'approvable',q.run_id is not null and not q.stale and q.plan_current and not q.judgement and not q.open_alert))end x
   from(
    select q0.*,
     q0.draft_id is not null and(q0.draft_ctx<>q0.version or q0.draft_clinical is distinct from q0.case_revision
      or q0.draft_source is distinct from(case when q0.draft_id is null then null else public.patient_clinical_evidence(q0.member_id)->>'token'end))stale,
     q0.run_id is not null and q0.reason='new_message'and(coalesce(q0.needs_judgement,false)or coalesce(q0.outside_plan,false))judgement,
     q0.run_id is not null and q0.plan_id is not distinct from(select p.plan_id from public.patient_care_plans plan join public.patient_clinical_publications p on p.plan_id=plan.id and p.user_id=plan.user_id
      where plan.user_id=q0.member_id and plan.active and plan.published_at<=now()and p.published_at<=now()order by p.published_at desc limit 1)plan_current,
     exists(select 1 from public.care_alerts al where al.member_id=q0.member_id and al.state<>'resolved')open_alert
    from(
    select c.id cid,c.member_id,c.version,ld.state delivery,ld.created_at delivered_at,d.id draft_id,d.context_version draft_seq,
     d.revision draft_revision,d.context_version draft_ctx,d.clinical_revision draft_clinical,d.source_token draft_source,k.revision case_revision,
     rv.body,rv.content_hash,rv.author_kind author,
     rv.author_kind='staff'and not exists(select 1 from public.conversation_revisions ar where ar.draft_id=d.id and ar.author_kind='ai_assistant')human_only,
     s.run_id,s.version s_version,s.plan_id,s.quoted,s.asked,s.acknowledgement_id ack_id,s.needs_judgement,s.outside_plan,s.judgement_reasons,s.doctor_decides,
     (select count(*)from public.conversation_messages m2 where m2.conversation_id=c.id and m2.seq>coalesce(dec.v,0))::int unanswered,
     -- 20261031134000: Zoe sent something in the open window to the doctor at the same-day level or above (the zoe.forward audit
     -- zoe_run_finish writes). The member was told it needs a doctor today, so it is in Today at any age, until a decision.
     exists(select 1 from public.conversation_audit au where au.conversation_id=c.id and au.kind='zoe.forward'
      and(au.detail->>'seq')::bigint>coalesce(dec.v,0)and au.detail->>'urgency'in('same_day','emergency'))same_day,
     case when c.version>coalesce(dec.v,0)and zst.st is null then 'new_message'
      when ld.state in('definitely_failed','unknown')or(ld.state='held'and ld.reason is distinct from 'newer_member_message'
       and not(ld.reason='route_policy_missing'and exists(select 1 from public.conversation_app_releases ar where ar.approval_id=ld.approval_id)))
      then case when exists(select 1 from public.conversation_drafts d2 where d2.conversation_id=c.id and d2.state='rejected'and d2.created_at>ld.created_at)then null else 'not_delivered'end
     end reason,
     coalesce(least(
      (select min(cm.created_at)from public.conversation_messages cm where cm.conversation_id=c.id and cm.seq>coalesce(dec.v,0)),
      (select min(au.created_at)from public.conversation_audit au where au.conversation_id=c.id and au.kind in('message.media','message.overflow')
        and(au.detail->>'version')::bigint>coalesce(dec.v,0))),clock_timestamp())since
    from public.conversations c
    join public.patient_clinical_cases k on k.user_id=c.member_id
    left join lateral(select max(dd.context_version)v from public.conversation_drafts dd where dd.conversation_id=c.id and dd.state in('approved','rejected'))dec on true
    left join lateral(select dl.state,dl.reason,dl.created_at,dl.approval_id from public.conversation_deliveries dl where dl.conversation_id=c.id order by dl.created_at desc,dl.id desc limit 1)ld on true
    left join lateral(select dd.* from public.conversation_drafts dd where dd.conversation_id=c.id and dd.state='pending'order by dd.created_at desc,dd.id desc limit 1)d on true
    left join public.conversation_revisions rv on rv.draft_id=d.id and rv.revision=d.revision
    left join lateral(select zr.* from public.zoe_runs z join public.zoe_reply_drafts zr on zr.run_id=z.id where z.draft_id=d.id order by zr.created_at desc limit 1)s on true
    -- Part 2 (20261020060842): a thread Zoe fully answered is not "new message"; an undelivered reply still is.
    left join lateral(select public._zoe_answered_open(c.id)st)zst on true
    where c.member_id=any(members))q0)q
   where q.reason is not null)q2;
  items:=items||part;
 exception when others then missing:=array_append(missing,'replies');end;

 -- P1 finished symptom intakes the doctor has not answered yet (no reply decision at or after the intake's last message).
 begin
  select coalesce(jsonb_agg(x),'[]')into part from(
   select jsonb_build_object('id','intake:'||s.id,'lane','P1','kind','intake','rank',3,'memberId',s.member_id,'at',coalesce(s.finished_at,s.updated_at),
    'confidence','H','ai','summary','intakeId',s.id,'sheetId',s.sheet_id,'ending',s.ending,'redFlags',jsonb_array_length(coalesce(s.summary#>'{redFlags,hits}','[]')),
    'sources',jsonb_build_array(jsonb_build_object('type','intake','ref',s.id::text,'rule',s.sheet_id||'@'||s.sheet_version,'seq',s.last_seq)))x
   from public.zoe_symptom_intakes s
   where s.member_id=any(members)and s.state<>'active'
    and not exists(select 1 from public.conversation_drafts dd where dd.conversation_id=s.conversation_id and dd.state in('approved','rejected')and dd.context_version>=s.last_seq))q;
  items:=items||part;
 exception when others then missing:=array_append(missing,'intake');end;

 -- Recent nurse activity is information, not a clinical decision or a closed reply.
 -- Keep it separate from the existing item kinds, so an older app can still parse the lanes.
 begin
  select coalesce(jsonb_agg(x order by x->>'at'desc,x->>'id'),'[]')into nurse_activity from(
   select jsonb_build_object('id',r.id,'memberId',c.member_id,'memberName',coalesce(pr.display_name,''),
    'text',r.body,'at',r.created_at,'senderName',r.nurse_name,'senderRole','nurse')x
   from public.conversation_nurse_replies r join public.conversations c on c.id=r.conversation_id
   left join public.profiles pr on pr.id=c.member_id
   where c.member_id=any(members)and r.created_at>=clock_timestamp()-interval '24 hours'
   order by r.created_at desc,r.id limit lane_cap)q;
 exception when others then missing:=array_append(missing,'nurse_activity');end;

 -- Part 2 (20261020060842): threads Zoe fully answered, not yet marked reviewed, newest first (not an item: the item kinds
 -- stay those the running app parses). Its own block, so a failure here is reported and never hides the lanes.
 begin
  select coalesce(jsonb_agg(x order by x->>'answeredAt'desc,x->>'memberId'),'[]'),count(*)into za,za_total from(
   select q.st||jsonb_build_object('memberName',coalesce(pr.display_name,''))x
   from(select c.member_id,public._zoe_answered_open(c.id)st from public.conversations c where c.member_id=any(members))q
   left join public.profiles pr on pr.id=q.member_id
   where q.st is not null and not(q.st->>'reviewed')::boolean)q2;
  za:=coalesce((select jsonb_agg(x order by n)from jsonb_array_elements(za)with ordinality e(x,n)where n<=lane_cap),'[]');
 exception when others then missing:=array_append(missing,'zoe_answered');za:='[]';za_total:=0;end;

 -- Names, lane order, caps. The order is lane, rank, age (oldest first), id; check:doctor-ai-inbox pins it.
 select coalesce(jsonb_agg(x||jsonb_build_object('memberName',coalesce(pr.display_name,''))order by x->>'lane',(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into items
 from(select x,row_number()over(partition by x->>'lane'order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id')n from jsonb_array_elements(items)x)q
 left join public.profiles pr on pr.id=(x->>'memberId')::uuid where n<=lane_cap;
 select coalesce(jsonb_agg(x||jsonb_build_object('memberName',coalesce(x#>>'{alert,memberName}',''))order by(x->>'rank')::int,(x->>'at')::timestamptz,x->>'id'),'[]')into p0
 from jsonb_array_elements(p0)x;

 -- Record access for each displayed doctor/member/session unless its most recent
 -- inbox audit is younger than 10 minutes. Polls do not refresh that timestamp.
 -- The hot path writes nothing and takes no row/advisory locks. Cold reads use
 -- a transaction lock per doctor/member/session, in member order to avoid
 -- deadlocks across overlapping inboxes. Under READ COMMITTED, the separate
 -- check after waiting sees the first reader's committed row; if it rolled back,
 -- the waiter records access instead. Refresh the cutoff after any lock wait.
 select coalesce(array_agg(distinct(x->>'memberId')::uuid),'{}')into shown_members
 from jsonb_array_elements(p0||items||za||nurse_activity)x;
 for audit_member in select mid from unnest(shown_members)mid order by mid loop
  audit_cutoff:=clock_timestamp()-interval '10 minutes';
  if exists(select 1 from public.access_audit a where a.actor_id=me and a.member_id=audit_member
   and a.surface='doctor_inbox'and a.object_id is null and a.channel='web'
   and a.session_id is not distinct from audit_session
   and a.at>audit_cutoff)then continue;end if;
  perform pg_advisory_xact_lock(hashtextextended('doctor-inbox-access:'||me::text||':'||audit_member::text||':'||coalesce(audit_session,''),0));
  audit_cutoff:=clock_timestamp()-interval '10 minutes';
  if not exists(select 1 from public.access_audit a where a.actor_id=me and a.member_id=audit_member
     and a.surface='doctor_inbox'and a.object_id is null and a.channel='web'
     and a.session_id is not distinct from audit_session
     and a.at>audit_cutoff)then
   perform public._access_audit_record(audit_member,'doctor_inbox',null);
  end if;
 end loop;

 return jsonb_build_object('version','doctor-inbox-v1','ok',true,'asOf',clock_timestamp(),
  'p0',p0,'p0Total',p0_total,'items',items,'laneCap',lane_cap,'unavailable',to_jsonb(missing),'zoeAnswered',za,'zoeAnsweredTotal',za_total,'nurseActivity',nurse_activity);
end$$;

comment on function public.doctor_ai_inbox()is
 'Assigned doctor inbox from existing records. Clinical access is recorded per displayed member, doctor and session unless the most recent identical inbox audit is younger than 10 minutes. Polls do not write or refresh the audit timestamp. Remains VOLATILE because a first read or a read at least 10 minutes after the last audit records access.';
