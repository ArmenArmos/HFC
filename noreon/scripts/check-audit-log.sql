-- Unified audit RPC contract. Synthetic source fixtures only, never a delivery call.
-- Fixture insertion suppresses unrelated triggers/FKs; the read model's joined parents
-- are seeded explicitly. Authorization, read recording and all assertions run normally.
-- scripts/run-checks.mjs discovers this file. Every fixture and read rolls back.
\set ON_ERROR_STOP on
begin;
-- Frozen pre-optimization read models: compare full DTOs, ordering and cursors.
create function pg_temp.al_previous_page(p_actor uuid,p_member uuid,p_category text,p_from timestamptz,p_to timestamptz,p_cursor text,p_limit integer,p_clinic uuid default null)returns jsonb
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
create function pg_temp.al_previous_people(p_clinic uuid default null)returns jsonb
language sql stable security definer set search_path=''as $$
 with scope as materialized(select * from public._audit_clinic_scope(p_clinic)),
 eligible as materialized(
  select id from scope where kind='actor'
  union select r.actor_id from public._audit_rows(now()-interval '366 days','infinity',null,null,null)r
   where p_clinic is not null and r.actor_id is not null and r.category not in('sign_in','admin_change')
    and exists(select 1 from scope s where s.kind='member'and s.id=r.member_id)
 ),people as(
  select s.user_id id,s.display_name name,s.role||case when s.removed_at is not null or not s.active then ', removed'else ''end role
   from public.workspace_staff s where p_clinic is null or exists(select 1 from scope c where c.kind='actor'and c.id=s.user_id)
  union all
  select m.user_id,min(m.display_name),'clinic'from public.clinic_portal_memberships m
   where not exists(select 1 from public.workspace_staff s where s.user_id=m.user_id)
    and(p_clinic is null or exists(select 1 from eligible e where e.id=m.user_id))
    and(p_clinic is null or exists(select 1 from eligible e where e.id=m.user_id))group by m.user_id
 )select jsonb_build_object('ok',true,'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role)order by name,id)from people),'[]'::jsonb))
$$;
create function pg_temp.al_id(n text)returns uuid language sql immutable as $$select('ad170000-0000-4000-8000-'||lpad(n,12,'0'))::uuid$$;
create function pg_temp.al_ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.al_user(n text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.al_id(n),'role','authenticated','exp',4102444800,
 'amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',pg_temp.al_id('1'||n))::text,true),
 set_config('request.jwt.claim.sub',pg_temp.al_id(n)::text,true)$$;
create function pg_temp.al_denied(q text)returns boolean language plpgsql as $$begin
 execute q;return false;exception when insufficient_privilege then return true;end$$;
create function pg_temp.al_state(q text)returns text language plpgsql as $$begin
 execute q;return 'ran';exception when others then return sqlstate;end$$;
grant execute on function pg_temp.al_id(text),pg_temp.al_ok(boolean,text),pg_temp.al_user(text),pg_temp.al_denied(text),pg_temp.al_state(text)to authenticated,anon,service_role;
-- 01/02 members, aa platform admin, d1/d2 clinic doctors, ca/cb clinic admins, cc clinic staff.
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.al_id(n),case n when '01'then '37499017901'when '02'then '37499017902'end,
 case when n in('01','02')then now()end from unnest(array['01','02','aa','d1','d2','ca','cb','cc'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)
 select pg_temp.al_id('1'||n),pg_temp.al_id(n),now(),now()from unnest(array['01','02','aa','d1','d2','ca','cb','cc'])n;
insert into public.workspace_clinics(id,name)values(pg_temp.al_id('a0'),'Fictional audit clinic A'),(pg_temp.al_id('b0'),'Fictional audit clinic B');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.al_id('aa'),'admin','Fictional audit platform admin',null),
 (pg_temp.al_id('d1'),'doctor','Fictional audit doctor A',pg_temp.al_id('a0')),
 (pg_temp.al_id('d2'),'doctor','Fictional audit doctor B',pg_temp.al_id('b0'));
insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name,role)values
 (pg_temp.al_id('fa'),pg_temp.al_id('ca'),pg_temp.al_id('a0'),'Fictional audit admin A','admin'),
 (pg_temp.al_id('fb'),pg_temp.al_id('cb'),pg_temp.al_id('b0'),'Fictional audit admin B','admin'),
 (pg_temp.al_id('fc'),pg_temp.al_id('cc'),pg_temp.al_id('a0'),'Fictional audit desk','staff');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.al_id('01'),pg_temp.al_id('d1')),(pg_temp.al_id('02'),pg_temp.al_id('d2'));
update public.profiles set display_name=case id when pg_temp.al_id('01')then 'Fictional audit member A'else 'Fictional audit member B'end where id in(pg_temp.al_id('01'),pg_temp.al_id('02'));
insert into public.clinic_portal_capabilities(singleton,clinic_admin_full_access)values(true,true)on conflict(singleton)do update set clinic_admin_full_access=true;
create temp table al_results(label text primary key,v jsonb)on commit drop;
grant select,insert on al_results to authenticated;


-- More than six pages at one timestamp: key ordering, not timestamp alone, decides the cursor.
insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail,created_at)
 select pg_temp.al_id('a0'),pg_temp.al_id('ca'),'member_reveal',
  jsonb_build_object('memberId',pg_temp.al_id('01'),'private',repeat('AUDIT_PRIVATE_CANARY',4096)),
  now()-interval '2 hours' from generate_series(1,43);

-- All original 21 sources, plus the outbound sources and Zoe card linkage. Secret canaries live
-- only in fields that must never be projected as action/ref or returned detail.
set local session_replication_role=replica;
insert into public.access_audit(actor_id,actor_role,member_id,surface)values(pg_temp.al_id('d1'),'doctor',pg_temp.al_id('01'),'member_file');
-- Clinic-safe projection covers raw clinical surfaces and a platform actor linked to its member.
insert into public.access_audit(actor_id,actor_role,member_id,surface)values
 (pg_temp.al_id('d1'),'doctor',pg_temp.al_id('01'),'ldl_goal'),
 (pg_temp.al_id('aa'),'admin',pg_temp.al_id('01'),'member_upload_overrides');
-- A clinic A doctor reading a clinic B member: clinic A sees the action but never who the member is.
insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id)values(pg_temp.al_id('d1'),'doctor',pg_temp.al_id('02'),'member_file','foreign-member-ref');
-- Review F1: caller-supplied references are never free text, and a clinic never sees another clinic's member id.
insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id)values
 (pg_temp.al_id('d1'),'doctor',pg_temp.al_id('02'),'member_report',pg_temp.al_id('02')::text),
 (pg_temp.al_id('d1'),'doctor',pg_temp.al_id('02'),'member_report','REVIEW_PRIVATE_CONTENT'),
 (pg_temp.al_id('d1'),'doctor',pg_temp.al_id('01'),'member_report',pg_temp.al_id('02')::text);
-- Review F3: d3 worked at clinic A, then moved to clinic B. Clinic A keeps the actor and the actor-only event.
insert into auth.users(id)values(pg_temp.al_id('d3'));
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.al_id('d3'),'doctor','Fictional audit moved doctor',pg_temp.al_id('b0'));
insert into public.config_audit(db_role,table_name,operation,row_key,changed)values
 ('postgres','workspace_staff','update',pg_temp.al_id('d3')::text,jsonb_build_object('clinic_id',jsonb_build_object('from',pg_temp.al_id('a0'),'to',pg_temp.al_id('b0'))));
insert into public.access_audit(actor_id,actor_role,surface)values(pg_temp.al_id('d3'),'doctor','moved_staff_fixture');
insert into public.access_audit(actor_id,actor_role,surface)values(pg_temp.al_id('aa'),'admin','activity_log.export');
insert into auth.audit_log_entries(id,payload,created_at)values
 (pg_temp.al_id('101'),jsonb_build_object('actor_id',pg_temp.al_id('01'),'action','login','secret','AUDIT_PRIVATE_CANARY'),clock_timestamp()),
 (pg_temp.al_id('102'),jsonb_build_object('actor_id',pg_temp.al_id('ca'),'action','login','secret','AUDIT_PRIVATE_CANARY'),clock_timestamp());
insert into public.telegram_auth_audit(auth_user_id,kind,detail)values(pg_temp.al_id('ca'),'login','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.telegram_audit(member_id,kind,detail)values(pg_temp.al_id('01'),'link.created','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values(pg_temp.al_id('200'),pg_temp.al_id('a0'),'Fictional batch',pg_temp.al_id('ca'),'Fictional audit admin A');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,name,mime,declared_size,expected_sha256,object_key)
 values(pg_temp.al_id('201'),pg_temp.al_id('200'),pg_temp.al_id('202'),pg_temp.al_id('203'),pg_temp.al_id('ca'),pg_temp.al_id('1ca'),'[]',now()+interval '1 hour',pg_temp.al_id('fa'),1,pg_temp.al_id('204'),'AUDIT_PRIVATE_CANARY','application/pdf',1,repeat('a',64),'AUDIT_PRIVATE_CANARY');
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)values
 (pg_temp.al_id('205'),pg_temp.al_id('201'),pg_temp.al_id('a0'),pg_temp.al_id('01'),pg_temp.al_id('206'),'noreon-admin',pg_temp.al_id('aa'),pg_temp.al_id('207'));
insert into public.patient_document_opens(user_id,file_id,attachment_id,actor_id,actor_kind)values(pg_temp.al_id('01'),pg_temp.al_id('201'),pg_temp.al_id('205'),pg_temp.al_id('d1'),'doctor');
insert into public.clinic_original_accesses(file_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,file_revision)
 values(pg_temp.al_id('201'),pg_temp.al_id('ca'),pg_temp.al_id('1ca'),'[]',now()+interval '1 hour',pg_temp.al_id('fa'),1,1);
insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail)values
 (pg_temp.al_id('a0'),pg_temp.al_id('ca'),'member-file-opened',jsonb_build_object('memberId',pg_temp.al_id('01'),'secret','AUDIT_PRIVATE_CANARY')),
 (pg_temp.al_id('b0'),pg_temp.al_id('cb'),'member-file-opened',jsonb_build_object('memberId',pg_temp.al_id('02'),'secret','AUDIT_PRIVATE_CANARY')),
 (pg_temp.al_id('a0'),pg_temp.al_id('ca'),'membership-updated','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.clinic_portal_audit(clinic_id,actor_id,kind,detail)
 select pg_temp.al_id('a0'),pg_temp.al_id('ca'),k,jsonb_build_object('memberId',pg_temp.al_id('01'),'secret','AUDIT_PRIVATE_CANARY')
 from unnest(array['change_requested','change_approved','change_rejected','change_cancelled','change_stale','change_expired','member_reveal','admin-record-opened'])k;
insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)values(pg_temp.al_id('01'),1,'assigned',pg_temp.al_id('d1'),' {"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.patient_document_release_events(user_id,file_id,attachment_id,kind,single_member_confirmed,actor_id,submission_id)
 values(pg_temp.al_id('01'),pg_temp.al_id('201'),pg_temp.al_id('205'),'released',true,pg_temp.al_id('d1'),pg_temp.al_id('208'));
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id)
 values(pg_temp.al_id('210'),pg_temp.al_id('01'),'contact-followup','AUDIT_PRIVATE_CANARY','AUDIT_PRIVATE_CANARY',pg_temp.al_id('d1'),pg_temp.al_id('d1'));
insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,note,detail)
 values(pg_temp.al_id('210'),1,pg_temp.al_id('211'),pg_temp.al_id('d1'),'Fictional audit doctor A','doctor','create','open',pg_temp.al_id('d1'),'AUDIT_PRIVATE_CANARY','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.patient_test_requests(id,user_id,requested_terms,requirements,algorithm_version,context_token,create_payload)
 values(pg_temp.al_id('220'),pg_temp.al_id('01'),'{}','{}','fixture','AUDIT_PRIVATE_CANARY','{}');
insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
 values(pg_temp.al_id('220'),pg_temp.al_id('221'),pg_temp.al_id('d1'),1,'create','{"secret":"AUDIT_PRIVATE_CANARY"}','{}');
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values(pg_temp.al_id('230'),pg_temp.al_id('01'),'message','fixture','fixture','fixture','fixture',pg_temp.al_id('d1'));
insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(pg_temp.al_id('230'),pg_temp.al_id('d1'),'acknowledged','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.conversations(id,member_id)values(pg_temp.al_id('240'),pg_temp.al_id('01'));
insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(pg_temp.al_id('240'),pg_temp.al_id('d1'),'approved','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.booking_appointments(id,member_id,program_id,requirements_token,status,proposed_arrangement,proposed_reservation_id,notice_id)
 values(pg_temp.al_id('250'),pg_temp.al_id('01'),pg_temp.al_id('251'),'fixture','notification-pending','{}',pg_temp.al_id('252'),pg_temp.al_id('253'));
insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash)
 values(pg_temp.al_id('253'),pg_temp.al_id('250'),0,pg_temp.al_id('251'),pg_temp.al_id('252'),pg_temp.al_id('a0'),1,1,'fixture@example.invalid','fixture@example.invalid','fixture@example.invalid','fixture','AUDIT_PRIVATE_CANARY','AUDIT_PRIVATE_CANARY',repeat('a',64));
insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(pg_temp.al_id('250'),0,'created',pg_temp.al_id('253'));
insert into public.booking_appointment_versions(appointment_id,revision,program_id,proposed_arrangement,notice_id,actor_id)
 values(pg_temp.al_id('250'),0,pg_temp.al_id('251'),'{}',pg_temp.al_id('253'),pg_temp.al_id('ca'));
insert into public.pilot_payments(id,member_id,test_request_id,amount_amd,lines,price_basis,created_by)
 values(pg_temp.al_id('260'),pg_temp.al_id('01'),pg_temp.al_id('220'),1,'[{}]','staging-placeholder',pg_temp.al_id('aa'));
insert into public.pilot_payment_events(payment_id,kind,actor_kind,actor_id,actor_name,reason,provider_reference)
 values(pg_temp.al_id('260'),'created','admin',pg_temp.al_id('aa'),'Fictional audit platform admin','AUDIT_PRIVATE_CANARY','AUDIT_PRIVATE_CANARY');
insert into public.pilot_catalog_events(test_id,kind,actor_id,actor_name,reason,detail)
 values(pg_temp.al_id('261'),'created',pg_temp.al_id('aa'),'Fictional audit platform admin','AUDIT_PRIVATE_CANARY','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.bp_device_events(device_id,kind,actor_id,actor_name,actor_role,reason,detail)
 values(pg_temp.al_id('262'),'registered',pg_temp.al_id('aa'),'Fictional audit platform admin','admin','AUDIT_PRIVATE_CANARY','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.zoe_tier_config_changes(tier,action,before,after,eval_run_id,actor,reason)
 values('low','apply','{}','{}',pg_temp.al_id('263'),pg_temp.al_id('aa'),'AUDIT_PRIVATE_CANARY');
insert into public.real_staff_admin_events(clinic_id,actor_id,kind,details)values(pg_temp.al_id('a0'),pg_temp.al_id('aa'),'clinic_created','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.real_staff_recovery_events(recovery_id,kind,actor_id)values(pg_temp.al_id('264'),'requested',pg_temp.al_id('aa'));
insert into public.config_audit(actor_id,db_role,table_name,operation,row_key,changed)values
 (pg_temp.al_id('aa'),'postgres','lab_ai_capabilities','update','true','{"enabled":{"from":false,"to":true},"secret":{"to":"AUDIT_PRIVATE_CANARY"}}'),
 (pg_temp.al_id('aa'),'postgres','workspace_staff','update',pg_temp.al_id('d1')::text,'{"active":{"from":false,"to":true}}');

insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body,reason)
 values(pg_temp.al_id('300'),'99900001','AUDIT_PRIVATE_CANARY','care_alert.staff_notice',1,'en','AUDIT_PRIVATE_CANARY','AUDIT_PRIVATE_CANARY');
insert into public.care_alert_deliveries(alert_id,recipient_id,channel,telegram_message_id,occurrence)
 values(pg_temp.al_id('230'),pg_temp.al_id('d1'),'telegram',pg_temp.al_id('300'),1);
insert into public.conversation_approvals(id,draft_id,revision,context_version,content_hash,body,doctor_id,doctor_name,doctor_role,clinic_id,grant_id,grant_generation,intent_id)
 values(pg_temp.al_id('301'),pg_temp.al_id('302'),1,1,'fixture','AUDIT_PRIVATE_CANARY',pg_temp.al_id('d1'),'Fictional audit doctor A','doctor',pg_temp.al_id('a0'),pg_temp.al_id('303'),1,pg_temp.al_id('304'));
insert into public.conversation_deliveries(conversation_id,approval_id,state,reason)values(pg_temp.al_id('240'),pg_temp.al_id('301'),'held','AUDIT_PRIVATE_CANARY');
insert into public.patient_message_attempts(id,user_id,channel,template_key,status)values(pg_temp.al_id('310'),pg_temp.al_id('01'),'sms','plan-ready-v1','unknown');
insert into public.patient_message_attempts(id,user_id,channel,template_key,status)values(pg_temp.al_id('311'),pg_temp.al_id('02'),'sms','plan-ready-v1','unknown');
insert into public.patient_message_delivery_events(attempt_id,status)values(pg_temp.al_id('310'),'delivered');
insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 values(pg_temp.al_id('320'),pg_temp.al_id('d1'),'staff','AUDIT_PRIVATE_CANARY','fixture','+37499017903','99900003',1);
insert into public.telegram_nurse_outbox(binding_id,generation,source_inbox,ordinal,question_version,member_ids,turn,locale,template_id)
 values(pg_temp.al_id('320'),1,pg_temp.al_id('321'),1,1,array[pg_temp.al_id('01')],'{"text":"AUDIT_PRIVATE_CANARY"}','en','fixture');
insert into public.member_push_deliveries(notice_id,subscription_id,member_id,subscription_generation)values(pg_temp.al_id('330'),pg_temp.al_id('331'),pg_temp.al_id('01'),1);
insert into public.system_messages(id,member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation,reason)
 values(pg_temp.al_id('340'),pg_temp.al_id('01'),'fixture',1,'en','AUDIT_PRIVATE_CANARY','fixture',pg_temp.al_id('341'),1,'AUDIT_PRIVATE_CANARY');
insert into public.system_message_audit(message_id,kind,detail)values(pg_temp.al_id('340'),'queued','{"secret":"AUDIT_PRIVATE_CANARY"}');
-- Booking emails (review F2): a normal send has no command; a recovery send adds its actor once.
insert into public.booking_notice_attempts(id,notice_id,generation,envelope_hash)values
 (pg_temp.al_id('351'),pg_temp.al_id('253'),1,repeat('a',64)),(pg_temp.al_id('352'),pg_temp.al_id('253'),2,repeat('b',64));
insert into public.booking_notice_first_send_commands(id,member_id,actor_id,notice_id,input,attempt_id)
 values(pg_temp.al_id('350'),pg_temp.al_id('01'),pg_temp.al_id('d1'),pg_temp.al_id('253'),'{"secret":"AUDIT_PRIVATE_CANARY"}',pg_temp.al_id('352'));
-- Linkage enrichment: a Zoe card send is one system message, with a distinct source.
insert into public.system_messages(id,member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation)
 values(pg_temp.al_id('342'),pg_temp.al_id('01'),'fixture',1,'en','AUDIT_PRIVATE_CANARY','fixture',pg_temp.al_id('341'),1);
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot)
 values(pg_temp.al_id('343'),pg_temp.al_id('01'),pg_temp.al_id('344'),'bp','chip','{"secret":"AUDIT_PRIVATE_CANARY"}');
insert into public.zoe_chat_card_sends(system_message_id,card_id)values(pg_temp.al_id('342'),pg_temp.al_id('343'));
-- A member-notice send has a contextual member without a care-alert linkage.
insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body)
 values(pg_temp.al_id('305'),'99900002','AUDIT_PRIVATE_CANARY','member_notice.fixture',1,'en','AUDIT_PRIVATE_CANARY');
insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,telegram_message_id)
 values(pg_temp.al_id('01'),'audit_fixture:notice','care','member_notice.fixture','queued','queued',pg_temp.al_id('305'));
set local session_replication_role=origin;

-- Public grants and PostgREST volatility: every reader writes its own access event.
do $$declare f regprocedure;begin
 foreach f in array array[
 'public.admin_audit_log(uuid,uuid,text,timestamptz,timestamptz,text,integer,boolean)'::regprocedure,
 'public.admin_audit_log_export(uuid,uuid,text,timestamptz,timestamptz,boolean)'::regprocedure,'public.admin_audit_people()'::regprocedure,
 'public.clinic_audit_log(uuid,uuid,uuid,text,timestamptz,timestamptz,text,integer,boolean)'::regprocedure,
 'public.clinic_audit_log_export(uuid,uuid,uuid,text,timestamptz,timestamptz,boolean)'::regprocedure,'public.clinic_audit_people(uuid)'::regprocedure]loop
 perform pg_temp.al_ok(has_function_privilege('authenticated',f,'execute')and not has_function_privilege('anon',f,'execute')
  and not has_function_privilege('service_role',f,'execute'),'RPC grants: '||f::text);
 perform pg_temp.al_ok((select provolatile='v'from pg_proc where oid=f),'RPC is volatile: '||f::text);
 end loop;
end$$;
select pg_temp.al_ok(not has_function_privilege(r,p.oid,'execute'),'Private audit helper: '||p.proname||' / '||r)
 from pg_proc p cross join unnest(array['anon','authenticated','service_role'])r
 where p.pronamespace='public'::regnamespace and p.proname in('_audit_rows','_audit_page','_audit_people','_audit_clinic_scope','_audit_clinic_category','_audit_profile_page');

-- Each non-admin authenticated identity is denied each platform entry point.
do $$declare n text;q text;begin
 foreach n in array array['01','d1','ca','cc']loop
 perform pg_temp.al_user(n);
 execute 'set local role authenticated';
 foreach q in array array['select public.admin_audit_log()','select public.admin_audit_log_export()','select public.admin_audit_people()']loop
 perform pg_temp.al_ok(pg_temp.al_denied(q),'Platform audit denied for '||n||': '||q);
 end loop;
 execute 'reset role';
 end loop;
end$$;

select pg_temp.al_user('aa');set local role authenticated;
insert into al_results values('admin',public.admin_audit_log(p_from=>now()-interval '1 minute',p_limit=>200));
insert into al_results values('outbound-member',public.admin_audit_log(p_category=>'outbound_message',p_member=>pg_temp.al_id('01'),p_limit=>200));
insert into al_results values('outbound-actor',public.admin_audit_log(p_category=>'outbound_message',p_actor=>pg_temp.al_id('d1'),p_limit=>200));
insert into al_results values('outbound-future',public.admin_audit_log(p_category=>'outbound_message',p_from=>now()+interval '1 day'));
insert into al_results values('outbound-past',public.admin_audit_log(p_category=>'outbound_message',p_to=>now()-interval '1 day'));
insert into al_results values('admin-export',public.admin_audit_log_export(p_from=>now()-interval '1 minute'));
insert into al_results values('booker',public.admin_audit_log(p_actor=>pg_temp.al_id('ca'),p_category=>'outbound_message',p_from=>now()-interval '1 minute'));
insert into al_results values('booker-export',public.admin_audit_log_export(p_actor=>pg_temp.al_id('ca'),p_category=>'outbound_message',p_from=>now()-interval '1 minute'));
insert into al_results values('admin-people',public.admin_audit_people());
select pg_temp.al_ok(pg_temp.al_state($q$select public.admin_audit_log(p_category=>'everything')$q$)='22023','Unknown new category refused');
select pg_temp.al_ok(pg_temp.al_state($q$select public.admin_audit_log(p_cursor=>'malformed')$q$)='22023','Malformed new cursor refused');
insert into al_results values('page-1',public.admin_audit_log(p_member=>pg_temp.al_id('01'),p_limit=>2));
insert into al_results values('page-2',public.admin_audit_log(p_member=>pg_temp.al_id('01'),p_limit=>2,p_cursor=>(select v->>'next'from al_results where label='page-1')));
reset role;

select pg_temp.al_ok(exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='admin'
 and r->>'key'='telegram_auth_message:'||pg_temp.al_id('300')::text and r->>'memberId'=pg_temp.al_id('01')::text
 and r->>'ref'=pg_temp.al_id('d1')::text), 'Staff alert send keeps contextual member and actual recipient');
select pg_temp.al_ok(exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='admin'
 and r->>'source'='telegram_nurse_outbox'and r->>'memberId'=pg_temp.al_id('01')::text and r->>'ref'=pg_temp.al_id('d1')::text),
 'Nurse send keeps contextual member and actual staff recipient');
select pg_temp.al_ok(exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='admin'
 and r->>'key'='telegram_auth_message:'||pg_temp.al_id('305')::text and r->>'memberId'=pg_temp.al_id('01')::text),
 'Member notice linkage supplies the contextual member');

-- Positive per-source assertions cannot pass on an empty union branch. New source
-- labels are exhaustively listed, so deleting any included source breaks this check.
select pg_temp.al_ok(exists(select 1 from al_results a,jsonb_array_elements(a.v->'rows')r
 where a.label=l and r->>'source'=s and r->>'category'=c
 and(r->>'actorId'like 'ad170000-%'or r->>'memberId'like 'ad170000-%')),'Seeded audit source: '||s||' / '||c||' / '||l)
 from(values
 ('access','record_access'),('auth','sign_in'),('telegram_auth','sign_in'),('telegram','sign_in'),
 ('document_open','record_access'),('clinic_file_open','record_access'),('clinic','record_access'),
 ('clinical_case','care_change'),('document_release','care_change'),('coordination','care_change'),
 ('test_request','care_change'),('care_alert','alert_change'),('conversation','care_change'),('booking','care_change'),
 ('payment','admin_change'),('catalog','admin_change'),('bp_device','admin_change'),('zoe_tier','admin_change'),
 ('staff_admin','permission_change'),('staff_recovery','admin_change'),('config','admin_change'),('config','permission_change'),
 ('telegram_auth_message','outbound_message'),('conversation_delivery','outbound_message'),
 ('patient_message_attempt','outbound_message'),('patient_message_delivery','outbound_message'),
 ('telegram_nurse_outbox','outbound_message'),('member_push_delivery','outbound_message'),
 ('system_message','outbound_message'),('zoe_chat_card_send','outbound_message'),('system_message_audit','outbound_message'),('booking_notice','outbound_message'))expected(s,c)cross join unnest(array['admin','admin-export'])l;
select pg_temp.al_ok(exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='admin'and r->>'category'=c),'Category has positive fixture: '||c)
 from unnest(array['sign_in','record_access','care_change','alert_change','outbound_message','permission_change','admin_change','export'])c;
select pg_temp.al_ok((select count(*)>=3 from public.access_audit where actor_id=pg_temp.al_id('aa')and surface='audit_log.view')
 and exists(select 1 from public.access_audit where actor_id=pg_temp.al_id('aa')and surface='audit_log.export'),
 'Admin views, people and export record their own access');
select pg_temp.al_ok((select v->>'ok'='true'and v?'next'and jsonb_typeof(v->'rows')='array'from al_results where label='admin')
 and(select v->>'ok'='true'and jsonb_typeof(v->'people')='array'from al_results where label='admin-people'),'Admin wire response contracts');
select pg_temp.al_ok((select jsonb_array_length(v->'rows')=2 and v->>'next'is not null from al_results where label='page-1')
 and not exists(select 1 from al_results a,al_results b,jsonb_array_elements(a.v->'rows')x,jsonb_array_elements(b.v->'rows')y
 where a.label='page-1'and b.label='page-2'and x->>'key'=y->>'key'),'New keyset pages do not overlap');

select pg_temp.al_ok(exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='admin'and r->>'source'='clinic'and r->>'action'=k
 and r->>'category'=case when k in('member_reveal','admin-record-opened')then 'record_access'else 'permission_change'end),
 'Clinic event has explicit category: '||k)
 from unnest(array['change_requested','change_approved','change_rejected','change_cancelled','change_stale','change_expired','member_reveal','admin-record-opened'])k;
select pg_temp.al_ok((select jsonb_array_length(v->'rows')>=9 from al_results where label='outbound-member')
 and not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='outbound-member'and(r->>'category'<>'outbound_message'or r->>'memberId'is distinct from pg_temp.al_id('01')::text)),
 'Outbound member filter retains every applicable source and excludes member B');
select pg_temp.al_ok((select jsonb_array_length(v->'rows')=2 from al_results where label='outbound-actor')
 and not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='outbound-actor'and r->>'actorId'is distinct from pg_temp.al_id('d1')::text),
 'Outbound actor filter keeps only explicit doctor and first-send actors');
select pg_temp.al_ok(jsonb_array_length(v->'rows')=0,'Outbound time bounds exclude fixture rows: '||label)
 from al_results where label in('outbound-future','outbound-past');

-- Category filters execute over actual fixture rows, rather than only checking names.
select pg_temp.al_user('aa');set local role authenticated;
insert into al_results select 'category-'||c,public.admin_audit_log(p_category=>c,p_from=>now()-interval '1 minute',p_limit=>200)
 from unnest(array['alert_change','outbound_message','permission_change'])c;
reset role;
select pg_temp.al_ok(jsonb_array_length(v->'rows')>0 and not exists(select 1 from jsonb_array_elements(v->'rows')r where r->>'category'<>substr(label,10)),
 'New category filter: '||label)from al_results where label like 'category-%';

select pg_temp.al_user('ca');set local role authenticated;
insert into al_results values('clinic',public.clinic_audit_log(pg_temp.al_id('a0'),p_limit=>200));
insert into al_results values('clinic-export',public.clinic_audit_log_export(pg_temp.al_id('a0')));
insert into al_results values('clinic-people',public.clinic_audit_people(pg_temp.al_id('a0')));
select pg_temp.al_ok(public.clinic_audit_log(pg_temp.al_id('b0'))->>'status'='refused','Clinic admin cannot select another clinic');
select pg_temp.al_ok(public.clinic_audit_log_export(pg_temp.al_id('b0'))->>'status'='refused','Clinic admin cannot export another clinic');
select pg_temp.al_ok(public.clinic_audit_people(pg_temp.al_id('b0'))->>'status'='refused','Clinic admin cannot list another clinic people');
select pg_temp.al_ok(public.clinic_audit_log(pg_temp.al_id('a0'),p_member=>pg_temp.al_id('02'))->>'status'='refused','Foreign member filter refused');
select pg_temp.al_ok(public.clinic_audit_log_export(pg_temp.al_id('a0'),p_member=>pg_temp.al_id('02'))->>'status'='refused','Foreign member export filter refused');
reset role;
select pg_temp.al_ok((select v->>'ok'='true'and v?'next'and jsonb_array_length(v->'rows')>0 from al_results where label='clinic')
 and(select v->>'ok'='true'and jsonb_typeof(v->'people')='array'from al_results where label='clinic-people'),'Clinic wire response contracts');
select pg_temp.al_ok(exists(select 1 from al_results a,jsonb_array_elements(a.v->'rows')r
 join public.access_audit e on r->>'key'='access:'||e.id::text
 where a.label=l and e.actor_id=pg_temp.al_id('aa')and r->'actorId'='null'::jsonb and r->>'actorName'='Noreon'and r->>'actorRole'='noreon'
 and r->>'source'='access'and r->>'action'='member_record'and r->>'memberId'=pg_temp.al_id('01')::text),
 'Platform actor is masked in clinic page/export: '||l)from unnest(array['clinic','clinic-export'])l;
select pg_temp.al_ok(exists(select 1 from al_results a,jsonb_array_elements(a.v->'rows')r
 join public.access_audit e on r->>'key'='access:'||e.id::text
 where a.label=l and e.surface='ldl_goal'and r->>'action'='member_record'
 and r->>'actorName'='Fictional audit doctor A'and r->>'actorRole'='doctor'),
 'Doctor clinical surface is generic in clinic page/export: '||l)from unnest(array['clinic','clinic-export'])l;
select pg_temp.al_ok(not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r
 where label in('clinic','clinic-export')and(r->>'action'in('ldl_goal','member_upload_overrides')
 or r->>'actorId'=pg_temp.al_id('aa')::text or r->>'actorName'='Fictional audit platform admin'
 or(r->>'actorRole'='noreon'and r->'actorId'is distinct from 'null'::jsonb))),
 'Clinic rows/export expose neither platform identities nor clinical surfaces');
select pg_temp.al_ok(exists(select 1 from al_results a,jsonb_array_elements(a.v->'rows')r
 where a.label=l and r->>'source'='document_open'and r->>'actorId'=pg_temp.al_id('d1')::text and r->>'action'='member_record')
 and exists(select 1 from al_results a,jsonb_array_elements(a.v->'rows')r
 where a.label=l and r->>'source'='clinic'and r->>'action'='member-file-opened'),
 'Staff document access is generic and clinic portal kinds are preserved: '||l)from unnest(array['clinic','clinic-export'])l;
select pg_temp.al_ok(exists(select 1 from al_results a,jsonb_array_elements(a.v->'rows')r
 where a.label=l and r->>'actorId'=pg_temp.al_id('aa')::text and r->>'actorName'='Fictional audit platform admin'
 and r->>'actorRole'='admin'and r->>'action'='member_upload_overrides')
 and exists(select 1 from al_results a,jsonb_array_elements(a.v->'rows')r where a.label=l and r->>'action'='ldl_goal'),
 'Noreon page/export keep names, roles and raw surfaces: '||l)from unnest(array['admin','admin-export'])l;
select pg_temp.al_ok(not exists(select 1 from al_results,jsonb_array_elements(v->'people')p
 where label='clinic-people'and p->>'id'=pg_temp.al_id('aa')::text)
 and exists(select 1 from al_results,jsonb_array_elements(v->'people')p
 where label='admin-people'and p->>'id'=pg_temp.al_id('aa')::text and p->>'name'='Fictional audit platform admin'),
 'Clinic people omit platform actors; Noreon people keep their names');
select pg_temp.al_ok(exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='clinic'and r->>'source'='clinic'and r->>'actorId'=pg_temp.al_id('ca')::text)
 and exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='clinic'and r->>'category'='outbound_message'and r->>'memberId'=pg_temp.al_id('01')::text),
 'Clinic sees its own actor and member-linked outbound fixture');
select pg_temp.al_ok(not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label in('clinic','clinic-export')and(
 r->>'memberId'=pg_temp.al_id('02')::text or r->>'actorId'in(pg_temp.al_id('cb')::text,pg_temp.al_id('d2')::text)
 or r->>'category'='admin_change' or(r->>'category'='sign_in'and r->>'memberId'is not null))),
 'Clinic rows/export exclude clinic B, all member sign-ins and platform admin changes');
select pg_temp.al_ok(not exists(select 1 from al_results,jsonb_array_elements(v->'people')p where label='clinic-people'
 and p->>'id'in(pg_temp.al_id('cb')::text,pg_temp.al_id('d2')::text,pg_temp.al_id('01')::text,pg_temp.al_id('02')::text))
 and exists(select 1 from al_results,jsonb_array_elements(v->'people')p where label='clinic-people'and p->>'id'=pg_temp.al_id('ca')::text),
 'Clinic people includes own admin and excludes foreign staff and members');
select pg_temp.al_ok((select count(*)>=2 from public.clinic_portal_audit where clinic_id=pg_temp.al_id('a0')and actor_id=pg_temp.al_id('ca')and kind='audit-log-view')
 and exists(select 1 from public.clinic_portal_audit where clinic_id=pg_temp.al_id('a0')and actor_id=pg_temp.al_id('ca')and kind='audit-log-export'),
 'Clinic view, people and export self-record');

-- Review R1: a clinic JWT cannot recover a masked UUID, even with a known actor filter.
select pg_temp.al_user('ca');set local role authenticated;
insert into al_results values('clinic-masked-actor',public.clinic_audit_log(
 pg_temp.al_id('a0'),p_actor=>pg_temp.al_id('aa'),p_member=>pg_temp.al_id('01')));
insert into al_results values('clinic-masked-actor-export',public.clinic_audit_log_export(
 pg_temp.al_id('a0'),p_actor=>pg_temp.al_id('aa'),p_member=>pg_temp.al_id('01')));
select pg_temp.al_ok(not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r
 where label in('clinic','clinic-export','clinic-masked-actor','clinic-masked-actor-export')
 and r->>'actorId'=pg_temp.al_id('aa')::text),'Clinic JWT cannot recover a Noreon staff UUID through p_actor');
select pg_temp.al_ok(v->>'status'='refused','Masked actor filter refused: '||label)
 from al_results where label in('clinic-masked-actor','clinic-masked-actor-export');
-- A foreign doctor and an in-scope member are both outside the clinic's actor scope.
select pg_temp.al_ok(public.clinic_audit_log(pg_temp.al_id('a0'),p_actor=>pg_temp.al_id(n))->>'status'='refused'
 and public.clinic_audit_log_export(pg_temp.al_id('a0'),p_actor=>pg_temp.al_id(n))->>'status'='refused',
 'Outside-scope actor filter refused on page/export: '||n)from unnest(array['d2','01'])n;
select pg_temp.al_ok(
 (select v->>'ok'='true'and jsonb_array_length(v->'rows')>0
  and not exists(select 1 from jsonb_array_elements(v->'rows')r where r->>'actorId'is distinct from pg_temp.al_id(n)::text)
  from(select public.clinic_audit_log(pg_temp.al_id('a0'),p_actor=>pg_temp.al_id(n))v)q)
 and(select v->>'ok'='true'and jsonb_array_length(v->'rows')>0
  and not exists(select 1 from jsonb_array_elements(v->'rows')r where r->>'actorId'is distinct from pg_temp.al_id(n)::text)
  from(select public.clinic_audit_log_export(pg_temp.al_id('a0'),p_actor=>pg_temp.al_id(n))v)q),
 'Current and former clinic actors remain filterable: '||n)from unnest(array['ca','d1','d3'])n;
reset role;


-- Exact differential checks against the previous helpers. Profile enrichment
-- is covered separately by check-clinic-admin-approvals.sql.
select pg_temp.al_user('ca');
do $$declare opts record;actual jsonb;expected jsonb;cursor text;seen text[];keys text[];pages int;
begin
 for opts in select * from(values
  (null::uuid,null::uuid,null::text,null::timestamptz,null::timestamptz),
  (pg_temp.al_id('ca'),pg_temp.al_id('01'),'record_access',now()-interval '3 hours',now()-interval '1 hour'),
  (pg_temp.al_id('d1'),null,null,null,null),
  (null,pg_temp.al_id('01'),'outbound_message',null,null),
  (null,null,'record_access',now()+interval '1 day',null)
 )v(actor,member,category,from_at,to_at) loop
  cursor:=null;seen:='{}';pages:=0;
  loop
   -- Same identity and snapshot; call the public RPC first so its required
   -- self-audit row is present in both implementations' results.
   set local role authenticated;
   actual:=public.clinic_audit_log(pg_temp.al_id('a0'),opts.actor,opts.member,opts.category,opts.from_at,opts.to_at,cursor,7);
   reset role;
   expected:=pg_temp.al_previous_page(opts.actor,opts.member,opts.category,opts.from_at,opts.to_at,cursor,7,pg_temp.al_id('a0'));
   perform pg_temp.al_ok(actual=expected,'Optimized clinic page equals previous DTOs and next cursor');
   select coalesce(array_agg(r->>'key'),'{}')into keys from jsonb_array_elements(actual->'rows')r;
   perform pg_temp.al_ok(not(seen&&keys),'Clinic keyset pages never overlap, including timestamp ties');
   seen:=seen||keys;pages:=pages+1;
   cursor:=actual->>'next';
   exit when cursor is null;
   perform pg_temp.al_ok(pages<100,'Clinic keyset traversal terminates');
  end loop;
  if opts.actor=pg_temp.al_id('ca')then
   perform pg_temp.al_ok(pages=7 and cardinality(seen)=43,'All 43 tied events traverse seven exact pages');
  end if;
 end loop;
 set local role authenticated;
 actual:=public.clinic_audit_people(pg_temp.al_id('a0'));
 reset role;
 perform pg_temp.al_ok(actual=pg_temp.al_previous_people(pg_temp.al_id('a0')),'Clinic people preserve the full ordered eligible list');
 perform pg_temp.al_ok(public._audit_people(null)=pg_temp.al_previous_people(null),'Platform people preserve the full ordered list');
end$$;
-- Guard the materialization boundary without relying on EXPLAIN output/costs.
select pg_temp.al_ok(position('page_keys as materialized' in prosrc)>0
 and prosrc ~ 'select f\.at,f\.key[[:space:]]+from public\._audit_source_rows'
 and position('limit lim+1' in prosrc)<position('jsonb_build_object(' in prosrc)
 and position('page_bounds as materialized' in prosrc)>0
 and position('where f.key=any(b.keys)' in prosrc)>0,
 'Audit page selects narrow bounded keys before DTO construction')
 from pg_proc where oid='public._audit_page(uuid,uuid,text,timestamptz,timestamptz,text,integer,uuid)'::regprocedure;
select pg_temp.al_ok(not has_function_privilege(r,'public._audit_source_rows(timestamptz,timestamptz,uuid,uuid,text)','execute'),
 'Raw source helper is private: '||r)from unnest(array['anon','authenticated','service_role'])r;

select pg_temp.al_user('cc');set local role authenticated;
select pg_temp.al_ok(public.clinic_audit_log(pg_temp.al_id('a0'))->>'status'='refused'
 and public.clinic_audit_log_export(pg_temp.al_id('a0'))->>'status'='refused'
 and public.clinic_audit_people(pg_temp.al_id('a0'))->>'status'='refused','Non-admin clinic staff refused all three clinic RPCs');
reset role;
update public.clinic_portal_capabilities set clinic_admin_full_access=false;
select pg_temp.al_user('ca');set local role authenticated;
select pg_temp.al_ok(public.clinic_audit_log(pg_temp.al_id('a0'))->>'status'='disabled'
 and public.clinic_audit_log_export(pg_temp.al_id('a0'))->>'status'='disabled'
 and public.clinic_audit_people(pg_temp.al_id('a0'))->>'status'='disabled','Switch off disables all three clinic RPCs');
reset role;

select pg_temp.al_ok(not exists(select 1 from al_results where v::text like '%AUDIT_PRIVATE_CANARY%'),'No seeded secret, body, detail, note, reason, filename or address leaks');
select pg_temp.al_ok(not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r
 where r ?| array['detail','details','changed','payload','body','text','reason','note','address','providerReference']),
 'Rows expose metadata fields only');
select pg_temp.al_ok(exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='clinic'and r->>'actorId'=pg_temp.al_id('d1')::text
 and r->>'action'='member_record'and r->>'memberId'is null and r->>'memberName'is null and r->>'ref'is null)
 and not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label in('clinic','clinic-export')and r::text like '%Fictional audit member B%'),
 'Own staff acting on a foreign member shows the action without naming the member');

select pg_temp.al_ok(not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label in('clinic','clinic-export')
 and r->>'ref'in(pg_temp.al_id('02')::text,'REVIEW_PRIVATE_CONTENT','foreign-member-ref'))
 and not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label in('admin','admin-export')and r->>'ref'in('REVIEW_PRIVATE_CONTENT','foreign-member-ref'))
 and exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='admin'and r->>'action'='member_report'and r->>'ref'=pg_temp.al_id('02')::text),
 'References: ids only for Noreon, never another clinic''s member for a clinic (review F1)');
select pg_temp.al_ok((select count(*)=2 from al_results,jsonb_array_elements(v->'rows')r where label='admin'and r->>'source'='booking_notice')
 and (select count(*)=1 from al_results,jsonb_array_elements(v->'rows')r where label='admin'and r->>'source'='booking_notice'and r->>'actorId'=pg_temp.al_id('d1')::text)
 and (select count(*)=1 from al_results,jsonb_array_elements(v->'rows')r where label='admin'and r->>'source'='booking_notice'and r->>'actorId'=pg_temp.al_id('ca')::text)
 and (select count(*)=1 from al_results,jsonb_array_elements(v->'rows')r where label='booker'and r->>'source'='booking_notice')
 and (select count(*)=1 from al_results,jsonb_array_elements(v->'rows')r where label='booker-export'and r->>'source'='booking_notice'),
 'Every booking email attempt appears once: a normal send under the person who booked, a recovery send under its command actor (review F2)');
select pg_temp.al_ok(exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='clinic'and r->>'actorId'=pg_temp.al_id('d3')::text and r->>'action'='member_record'
 and r->>'actorName'='Fictional audit moved doctor'and r->>'actorRole'='doctor')
 and exists(select 1 from al_results,jsonb_array_elements(v->'people')p where label='clinic-people'and p->>'id'=pg_temp.al_id('d3')::text),
 'Staff who moved away stay in the old clinic''s log and person list (review F3)');

-- Inbox access remains a privacy record in the unified log: recent identical
-- polls add nothing, but the next opening after 10 minutes appears separately.
-- Keep these probes separate from the historical paging fixtures above.
savepoint al_inbox_access;
create function pg_temp.al_inbox()returns void language plpgsql as $$begin
 set local role authenticated;perform public.doctor_ai_inbox();reset role;end$$;
select pg_temp.al_user('d1');select pg_temp.al_inbox();
select pg_temp.al_ok((select count(*)=1 from public.access_audit
 where actor_id=pg_temp.al_id('d1')and member_id=pg_temp.al_id('01')and surface='doctor_inbox'),
 'First inbox opening records the displayed member');
-- Fixture-only backdating bypasses audit immutability and is rolled back.
set local session_replication_role=replica;
update public.access_audit set at=clock_timestamp()-interval '9 minutes'
 where actor_id=pg_temp.al_id('d1')and member_id=pg_temp.al_id('01')and surface='doctor_inbox';
set local session_replication_role=origin;
create temp table al_inbox_before_poll as select * from public.access_audit;
create function pg_temp.al_inbox_no_write()returns trigger language plpgsql as $$begin
 raise exception 'Inbox polling attempted an audit write';end$$;
create trigger al_inbox_no_write before insert or update or delete on public.access_audit
 for each statement execute function pg_temp.al_inbox_no_write();
select pg_temp.al_inbox();select pg_temp.al_inbox();
select pg_temp.al_ok(not exists((table public.access_audit except table al_inbox_before_poll)
 union all(table al_inbox_before_poll except table public.access_audit)),
 'Polling inside 10 minutes leaves audit rows and timestamps untouched');
drop trigger al_inbox_no_write on public.access_audit;
set local session_replication_role=replica;
update public.access_audit set at=clock_timestamp()-interval '11 minutes'
 where actor_id=pg_temp.al_id('d1')and member_id=pg_temp.al_id('01')and surface='doctor_inbox';
set local session_replication_role=origin;
select pg_temp.al_inbox();select pg_temp.al_inbox();
select pg_temp.al_ok((select count(*)=2 from public.access_audit
 where actor_id=pg_temp.al_id('d1')and member_id=pg_temp.al_id('01')and surface='doctor_inbox'),
 'Opening after 10 minutes records a new row, then polling deduplicates');

insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.al_id('2d1'),pg_temp.al_id('d1'),now(),now());
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('session_id',pg_temp.al_id('2d1')))::text,true);
select pg_temp.al_inbox();select pg_temp.al_inbox();
select pg_temp.al_ok((select count(*)=3 from public.access_audit
 where actor_id=pg_temp.al_id('d1')and member_id=pg_temp.al_id('01')and surface='doctor_inbox'),
 'A new session records a fresh opening despite recent access in the old session');

-- Make a second member visible to the same doctor/session, then reassign the
-- first member to another doctor. Fixture writes remain inside the savepoint.
set local session_replication_role=replica;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.al_id('d1')where user_id=pg_temp.al_id('02');
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values(pg_temp.al_id('231'),pg_temp.al_id('02'),'message','fixture','fixture','fixture','fixture',pg_temp.al_id('d1'));
set local session_replication_role=origin;
select pg_temp.al_inbox();select pg_temp.al_inbox();
select pg_temp.al_ok((select count(*)=1 from public.access_audit
 where actor_id=pg_temp.al_id('d1')and member_id=pg_temp.al_id('02')and surface='doctor_inbox'),
 'A different member records a fresh opening within the same session');
set local session_replication_role=replica;
update public.patient_clinical_cases set assigned_doctor_id=pg_temp.al_id('d2')where user_id=pg_temp.al_id('01');
set local session_replication_role=origin;
select pg_temp.al_user('d2');select pg_temp.al_inbox();select pg_temp.al_inbox();
select pg_temp.al_ok((select count(*)=1 from public.access_audit
 where actor_id=pg_temp.al_id('d2')and member_id=pg_temp.al_id('01')and surface='doctor_inbox'),
 'A different doctor records a fresh opening of the same member');

select pg_temp.al_user('aa');set local role authenticated;
insert into al_results values('inbox-openings',public.admin_audit_log(p_category=>'record_access',p_member=>pg_temp.al_id('01'),p_from=>now()-interval '1 hour',p_limit=>200));
reset role;
select pg_temp.al_ok((select count(*)=4 from al_results,jsonb_array_elements(v->'rows')r
 where label='inbox-openings'and r->>'action'='doctor_inbox'and r->>'source'='access')
 and not exists(select 1 from public.access_audit a where a.member_id=pg_temp.al_id('01')and a.surface='doctor_inbox'
  and not exists(select 1 from al_results,jsonb_array_elements(v->'rows')r where label='inbox-openings'
   and r->>'key'='access:'||a.id and(r->>'at')::timestamptz=a.at and r->>'actorId'=a.actor_id::text)),
 'Unified audit log retains every opening with its own timestamp and doctor, without polling duplicates');
rollback to savepoint al_inbox_access;release savepoint al_inbox_access;

select 'audit log checks passed';
rollback;
