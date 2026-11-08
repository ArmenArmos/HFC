-- Audit log: additive replacement for the activity RPCs, with clinic scope and outbound metadata.
-- Stamp 20261104173000 from the integrator (S1-12, part d).
-- The deployed _activity_rows/_activity_page/admin_activity_* functions remain unchanged.
-- Drop those legacy functions in a later migration after all callers have moved.
-- No message bodies, delivery envelopes, clinical detail, contact values or reasons are returned.

create function public._audit_clinic_category(p_kind text)returns text
language sql immutable set search_path=''as $$
 select case
  when p_kind='audit-log-export'then 'export'
  when p_kind like 'membership-%'or p_kind like 'invitation-%'or p_kind in(
   'change_requested','change_approved','change_rejected','change_cancelled','change_stale','change_expired')then 'permission_change'
  when p_kind in('admin-record-opened','admin-record-refused','admin-patients-listed','member-search',
   'member-file-opened','member-file-refused','member-file-download-refused','member-file-downloaded','member-files-read',
   'member-files-refused','member_reveal','change_request_viewed','change_requests_listed','audit-log-view')then 'record_access'
  else 'care_change'end
$$;
revoke all on function public._audit_clinic_category(text)from public,anon,authenticated,service_role;

-- One set-based definition shared by rows and people. Membership history includes inactive rows.
-- The member half reuses the exact current _clinic_admin_patient set without taking per-row locks.
create function public._audit_clinic_scope(p_clinic uuid)returns table(id uuid,kind text)
language sql stable security definer set search_path=''as $$
 select m.user_id,'actor'::text from public.clinic_portal_memberships m where m.clinic_id=p_clinic
 union select s.user_id,'actor' from public.workspace_staff s where s.clinic_id=p_clinic
 -- "is or was" (review F3): staff moved between clinics keep their old clinic, from the config audit trail.
 union select e.row_key::uuid,'actor' from public.config_audit e where e.table_name='workspace_staff'
  and e.row_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and p_clinic::text in(e.changed->'clinic_id'->>'from',e.changed->'clinic_id'->>'to')
 union select p.member_id,'member' from public._clinic_admin_patients(p_clinic)p
$$;
revoke all on function public._audit_clinic_scope(uuid)from public,anon,authenticated,service_role;

-- Outbound inventory: telegram_auth_messages includes care_alert_deliveries and member_notices;
-- system_messages labels linked zoe_chat_card_sends without duplicating the send.
-- Outbound member_id is the contextual member; ref is the recipient auth UUID when known,
-- otherwise null. The key always retains the send/event ID. Staff recipients are never actors.
-- conversation_deliveries, patient_message_attempts/patient_message_delivery_events,
-- telegram_nurse_outbox, member_push_deliveries, system_message_audit and booking_notice_attempts
-- (normal and recovery sends; a recovery command only adds its actor) record outbound attempts/state.
-- Excluded: inbound messages, provider observation envelopes, internal-only notices, auth challenges,
-- and queue-control/recovery/spend records which do not themselves send a message to a person.
create function public._audit_rows(p_from timestamptz,p_to timestamptz,p_actor uuid,p_member uuid,p_category text)
returns table(at timestamptz,key text,category text,source text,action text,actor_id uuid,member_id uuid,ref text)
language sql stable security definer set search_path=''as $$
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
revoke all on function public._audit_rows(timestamptz,timestamptz,uuid,uuid,text)from public,anon,authenticated,service_role;


create function public._audit_page(p_actor uuid,p_member uuid,p_category text,p_from timestamptz,p_to timestamptz,p_cursor text,p_limit integer,p_clinic uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare c_at timestamptz;c_key text;lim int:=greatest(1,least(coalesce(p_limit,100),5000));rows jsonb;n int;
begin
 if p_category is not null and p_category not in('sign_in','record_access','alert_change','outbound_message','permission_change','care_change','admin_change','export')then raise invalid_parameter_value;end if;
 if p_cursor is not null then
  if p_cursor !~ '^[0-9TZ:.+-]{10,40}\|[a-z_]{1,40}:[A-Za-z0-9-]{1,80}$' then raise invalid_parameter_value;end if;
  c_at:=split_part(p_cursor,'|',1)::timestamptz;c_key:=split_part(p_cursor,'|',2);
 end if;
 with scope as materialized(select * from public._audit_clinic_scope(p_clinic))
 select coalesce(jsonb_agg(x order by ord),'[]'),count(*)into rows,n from(
  select row_number()over(order by r.at desc,r.key desc)ord,jsonb_build_object(
   'key',r.key,'at',to_char(r.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'category',r.category,'source',r.source,'action',coalesce(r.action,'unknown'),
   'actorId',r.actor_id,'actorName',coalesce(ws.display_name,cm.display_name,ap.display_name),
   'actorRole',coalesce(ws.role,case when cm.display_name is not null then 'clinic' end,case when ap.id is not null then 'member' end),
   'memberId',case when r.member_visible then r.member_id end,'memberName',case when r.member_visible then mp.display_name end,
   'ref',case when not r.member_visible then null
    when p_clinic is not null and r.ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and exists(select 1 from public.profiles p where p.id=r.ref::uuid)
     and not exists(select 1 from scope s where s.kind='member'and s.id=r.ref::uuid)
     and not exists(select 1 from scope s where s.kind='actor'and s.id=r.ref::uuid) then null
    else r.ref end)x
  from(select f.*,(p_clinic is null or f.member_id is null or exists(select 1 from scope s where s.kind='member'and s.id=f.member_id))member_visible
    from public._audit_rows(coalesce(p_from,now()-interval '366 days'),least(coalesce(p_to,'infinity'),coalesce(c_at,'infinity')),p_actor,p_member,p_category)f
    where(p_clinic is null or(f.category<>'admin_change'and(f.category<>'sign_in'or f.member_id is null)
     and(exists(select 1 from scope s where s.kind='actor'and s.id=f.actor_id)or exists(select 1 from scope s where s.kind='member'and s.id=f.member_id))))
    and(p_to is null or f.at<p_to)and(c_at is null or(f.at,f.key)<(c_at,c_key))
    order by f.at desc,f.key desc limit lim+1)r
  left join public.workspace_staff ws on ws.user_id=r.actor_id
  left join lateral(select m.display_name from public.clinic_portal_memberships m where m.user_id=r.actor_id order by m.active desc limit 1)cm on ws.user_id is null
  left join public.profiles ap on ap.id=r.actor_id and ws.user_id is null and cm.display_name is null
  left join public.profiles mp on mp.id=r.member_id and r.member_visible)s;
 return jsonb_build_object('ok',true,'rows',(select coalesce(jsonb_agg(v),'[]')from(select v from jsonb_array_elements(rows)with ordinality e(v,i)where i<=lim)q),
  'next',case when n>lim then (rows->(lim-1)->>'at')||'|'||(rows->(lim-1)->>'key')end);
end$$;
revoke all on function public._audit_page(uuid,uuid,text,timestamptz,timestamptz,text,integer,uuid)from public,anon,authenticated,service_role;

-- Writes only to the access audit: platform admins cannot select another actor's authority.
create function public.admin_audit_log(p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 100)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a uuid;
begin
 a:=public._real_staff_require_admin();
 insert into public.access_audit(actor_id,actor_role,member_id,surface,session_id)
  values(a,'admin',p_member,'audit_log.view',left(auth.jwt()->>'session_id',80));
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200));
end$$;
create function public.admin_audit_log_export(p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a uuid;
begin
 a:=public._real_staff_require_admin();
 insert into public.access_audit(actor_id,actor_role,member_id,surface,session_id)
  values(a,'admin',p_member,'audit_log.export',left(auth.jwt()->>'session_id',80));
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,null,5000);
end$$;

-- One people selector shared by both guarded entry points. In clinic scope, platform actors
-- appear only when a visible row links them to a clinic member; member accounts never appear.
create function public._audit_people(p_clinic uuid default null)returns jsonb
language sql stable security definer set search_path=''as $$
 with scope as materialized(select * from public._audit_clinic_scope(p_clinic)),
 eligible as materialized(
  select id from scope where kind='actor'
  union select r.actor_id from public._audit_rows(now()-interval '366 days','infinity',null,null,null)r
   where p_clinic is not null and r.actor_id is not null and r.category not in('sign_in','admin_change')
    and exists(select 1 from scope s where s.kind='member'and s.id=r.member_id)
 ),people as(
  select s.user_id id,s.display_name name,s.role||case when s.removed_at is not null or not s.active then ', removed'else ''end role
   from public.workspace_staff s where p_clinic is null or exists(select 1 from eligible e where e.id=s.user_id)
  union all
  select m.user_id,min(m.display_name),'clinic'from public.clinic_portal_memberships m
   where not exists(select 1 from public.workspace_staff s where s.user_id=m.user_id)
    and(p_clinic is null or exists(select 1 from eligible e where e.id=m.user_id))
    and(p_clinic is null or exists(select 1 from eligible e where e.id=m.user_id))group by m.user_id
 )select jsonb_build_object('ok',true,'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role)order by name,id)from people),'[]'::jsonb))
$$;
create function public.admin_audit_people()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a uuid;
begin
 a:=public._real_staff_require_admin();
 insert into public.access_audit(actor_id,actor_role,surface,session_id)
  values(a,'admin','audit_log.view',left(auth.jwt()->>'session_id',80));
 return public._audit_people();
end$$;

create function public.clinic_audit_log(p_clinic uuid,p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 100)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_member is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='member'and s.id=p_member)
  then return jsonb_build_object('status','refused');end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'audit-log-view',jsonb_build_object('membershipId',m.id));
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200),p_clinic);
exception when insufficient_privilege then return jsonb_build_object('status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
create function public.clinic_audit_log_export(p_clinic uuid,p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_member is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='member'and s.id=p_member)
  then return jsonb_build_object('status','refused');end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'audit-log-export',jsonb_build_object('membershipId',m.id));
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,null,5000,p_clinic);
exception when insufficient_privilege then return jsonb_build_object('status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
create function public.clinic_audit_people(p_clinic uuid)returns jsonb
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

revoke all on function public._audit_people(uuid),
 public.admin_audit_log(uuid,uuid,text,timestamptz,timestamptz,text,integer),
 public.admin_audit_log_export(uuid,uuid,text,timestamptz,timestamptz),public.admin_audit_people(),
 public.clinic_audit_log(uuid,uuid,uuid,text,timestamptz,timestamptz,text,integer),
 public.clinic_audit_log_export(uuid,uuid,uuid,text,timestamptz,timestamptz),public.clinic_audit_people(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_audit_log(uuid,uuid,text,timestamptz,timestamptz,text,integer),
 public.admin_audit_log_export(uuid,uuid,text,timestamptz,timestamptz),public.admin_audit_people(),
 public.clinic_audit_log(uuid,uuid,uuid,text,timestamptz,timestamptz,text,integer),
 public.clinic_audit_log_export(uuid,uuid,uuid,text,timestamptz,timestamptz),public.clinic_audit_people(uuid)
 to authenticated;

-- The decided approval card names who decided (lead, 5 Nov, after the #676 walk). The app accepts
-- deciderName since #681, which merges before this migration. A clinic sees a Noreon decision as "Noreon";
-- the Noreon approvals page (full dates) sees the staff name.
create or replace function public._clinic_admin_change_json(r public.clinic_admin_change_requests,p_full_dates boolean) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object(
  'id',r.id,'clinicId',r.clinic_id,'clinicName',(select name from public.workspace_clinics where id=r.clinic_id),
  'kind',r.kind,'memberId',r.member_id,'memberName',coalesce((select display_name from public.profiles where id=r.member_id),''),
  'requesterName',(select display_name from public.clinic_portal_memberships where id=r.requested_membership),
  'mine',r.requested_by=auth.uid(),'createdAt',r.created_at,'decidedAt',r.decided_at,
  'deciderName',case when r.state in('approved','rejected') then case r.decided_via
    when 'clinic_admin' then (select m.display_name from public.clinic_portal_memberships m where m.user_id=r.decided_by and m.clinic_id=r.clinic_id order by m.active desc,m.id limit 1)
    when 'platform_admin' then case when p_full_dates then coalesce((select display_name from public.workspace_staff where user_id=r.decided_by),'Noreon') else 'Noreon' end end end,
  'state',case when r.state='pending' and r.created_at<=clock_timestamp()-interval '7 days' then 'expired' else r.state end,
  'decisionNote',r.decision_note,'summary',
  case when r.kind='profile' then
   case when r.before->'name' is distinct from r.proposed->'name' then jsonb_build_object('name',jsonb_build_object('before',r.before->'name','after',r.proposed->'name')) else '{}'::jsonb end ||
   case when r.before->'birthDate' is distinct from r.proposed->'birthDate' then jsonb_build_object('birthDate',
    jsonb_build_object('beforeYear',extract(year from (r.before->>'birthDate')::date)::int,'afterYear',extract(year from (r.proposed->>'birthDate')::date)::int) ||
    case when p_full_dates then jsonb_build_object('before',r.before->'birthDate','after',r.proposed->'birthDate') else '{}'::jsonb end) else '{}'::jsonb end
  else
   case when r.before->'doctorId' is distinct from r.proposed->'doctorId' then jsonb_build_object('doctor',jsonb_build_object(
    'before',(select display_name from public.workspace_staff where user_id=(r.before->>'doctorId')::uuid),
    'after',(select display_name from public.workspace_staff where user_id=(r.proposed->>'doctorId')::uuid))) else '{}'::jsonb end ||
   case when r.before->'nurseId' is distinct from r.proposed->'nurseId' then jsonb_build_object('nurse',jsonb_build_object(
    'before',(select display_name from public.workspace_staff where user_id=(r.before->>'nurseId')::uuid),
    'after',(select display_name from public.workspace_staff where user_id=(r.proposed->>'nurseId')::uuid))) else '{}'::jsonb end
  end)
$$;
