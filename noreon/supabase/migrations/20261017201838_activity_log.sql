-- Activity log (Khikar, 18 Oct): one admin place to answer who signed in, who opened or changed
-- which member's data, and what they did. Audit: output/activity-log-2026-10-18/AUDIT.md.
--
-- 1. access_audit: an append-only record of staff and clinic reads of a member's data, written by
--    the definer functions that serve that data. It holds who, whose, which surface and which
--    object id, never the content that was read.
-- 2. config_audit: an append-only record of changes to switches, settings, staff roles and clinic
--    memberships, written by triggers so SQL-editor changes are recorded as well.
-- 3. admin_activity_log: an admin-only, read-only, paginated union over the audit sources.
--    Its CSV export is itself recorded in access_audit.
-- Retention is an open question for Q17/legal and is not decided here: nothing is pruned.

-- 1. Staff read access ---------------------------------------------------------------------------
create table public.access_audit(
 id bigint generated always as identity primary key,
 at timestamptz not null default clock_timestamp(),
 actor_id uuid not null,
 actor_role text not null check(actor_role in('admin','doctor','nurse','clinic','staff')),
 member_id uuid,
 surface text not null check(surface ~ '^[a-z][a-z0-9_.]{2,60}$'),
 object_id text check(length(object_id)between 1 and 200),
 session_id text check(length(session_id)<=80)
);
create index access_audit_at on public.access_audit(at desc,id desc);
create index access_audit_member on public.access_audit(member_id,at desc);
create index access_audit_actor on public.access_audit(actor_id,at desc);
alter table public.access_audit enable row level security;
revoke all on public.access_audit from public,anon,authenticated,service_role;

create function public._audit_immutable()returns trigger language plpgsql set search_path=''as $$
begin raise exception using errcode='55000',message='Audit history is append-only';end$$;
create trigger access_audit_immutable before update or delete on public.access_audit for each row execute function public._audit_immutable();
revoke all on function public._audit_immutable()from public,anon,authenticated,service_role;

-- Records one read by the signed-in staff or clinic user. A member reading their own data, a
-- service call without a user, a read with no member, and a caller who is neither staff nor clinic
-- are not recorded here.
create function public._access_audit_record(p_member uuid,p_surface text,p_object text default null)returns void
language plpgsql security definer set search_path=''as $$
declare a uuid:=auth.uid();r text;
begin
 if a is null or p_member is null or a=p_member then return;end if;
 select case when s.role='admin'then 'admin' when s.role='doctor'then 'doctor' when s.role='nurse'then 'nurse' else 'staff' end into r
  from public.workspace_staff s where s.user_id=a;
 if r is null and exists(select 1 from public.clinic_portal_memberships m where m.user_id=a)then r:='clinic';end if;
 if r is null then return;end if;
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
  values(a,r,p_member,p_surface,left(p_object,200),left(auth.jwt()->>'session_id',80));
end$$;
revoke all on function public._access_audit_record(uuid,text,text)from public,anon,authenticated,service_role;

-- Reads served by RLS rather than a definer function (member-reported history and uploads, the
-- report file link) are recorded by the server before it shows them. Only active staff can call it,
-- and only for these surfaces; the caller is always the signed-in user.
create function public.staff_record_member_access(p_member uuid,p_surface text,p_object text default null)returns void
language plpgsql security definer set search_path=''as $$
begin
 if p_member is null or p_surface is null or p_surface not in('member_history','member_upload','member_report')then raise invalid_parameter_value;end if;
 perform 1 from public.workspace_staff where user_id=auth.uid() and active and removed_at is null;
 if not found then raise insufficient_privilege using message='Active staff required';end if;
 -- Only a member this caller can read: the assigned doctor or an admin (as RLS on the rows), or the
 -- assigned nurse. Anything else is refused rather than written (review F2).
 if not exists(select 1 from public.patient_clinical_cases where user_id=p_member)
  or not(public._member_history_reader(p_member)or public.staff_care_access(p_member,auth.uid(),true))
 then raise insufficient_privilege using message='Member access required';end if;
 perform public._access_audit_record(p_member,p_surface,p_object);
end$$;
revoke all on function public.staff_record_member_access(uuid,text,text)from public,anon,authenticated,service_role;
grant execute on function public.staff_record_member_access(uuid,text,text)to authenticated;

-- 2. Settings, switches, staff roles and clinic memberships ---------------------------------------
-- Rows hold configuration values only. actor_id is the signed-in user when the change came through
-- the app, and null for an operator change in the SQL editor, where db_role says who ran it.
create table public.config_audit(
 id bigint generated always as identity primary key,
 at timestamptz not null default clock_timestamp(),
 actor_id uuid,
 db_role text not null,
 table_name text not null,
 operation text not null check(operation in('insert','update','delete')),
 row_key text,
 changed jsonb not null default '{}'
);
create index config_audit_at on public.config_audit(at desc,id desc);
alter table public.config_audit enable row level security;
revoke all on public.config_audit from public,anon,authenticated,service_role;
create trigger config_audit_immutable before update or delete on public.config_audit for each row execute function public._audit_immutable();

-- TG_ARGV[0] names the key column; TG_ARGV[1..] are columns never copied (secrets, free text).
create function public._config_audit_row()returns trigger language plpgsql security definer set search_path=''as $$
declare o jsonb:=case when tg_op<>'INSERT'then to_jsonb(old)end;n jsonb:=case when tg_op<>'DELETE'then to_jsonb(new)end;
 d jsonb:='{}';k text;i int;
begin
 for i in 1..tg_nargs-1 loop o:=o-tg_argv[i];n:=n-tg_argv[i];end loop;
 for k in select jsonb_object_keys(coalesce(n,o))loop
  if tg_op='UPDATE'and o->k is not distinct from n->k then continue;end if;
  d:=d||jsonb_build_object(k,jsonb_build_object('from',o->k,'to',n->k));
 end loop;
 if tg_op='UPDATE'and d='{}'then return null;end if;
 insert into public.config_audit(actor_id,db_role,table_name,operation,row_key,changed)
  values(auth.uid(),coalesce(nullif(current_setting('role',true),'none'),session_user),tg_table_name,lower(tg_op),coalesce(n,o)->>tg_argv[0],d);
 return null;
end$$;
revoke all on function public._config_audit_row()from public,anon,authenticated,service_role;
-- Switches and settings (one row each), Zoe tiers, staff roles, clinic memberships and clinics.
create trigger care_alert_settings_config_audit after insert or update or delete on public.care_alert_settings for each row execute function public._config_audit_row('singleton','updated_at');
create trigger clinic_portal_capabilities_config_audit after insert or update or delete on public.clinic_portal_capabilities for each row execute function public._config_audit_row('singleton');
create trigger clinic_scheduling_capabilities_config_audit after insert or update or delete on public.clinic_scheduling_capabilities for each row execute function public._config_audit_row('singleton','updated_at');
create trigger conversation_policy_config_audit after insert or update or delete on public.conversation_policy for each row execute function public._config_audit_row('singleton');
create trigger doctor_completion_capabilities_config_audit after insert or update or delete on public.doctor_completion_capabilities for each row execute function public._config_audit_row('singleton');
create trigger gp_report_capabilities_config_audit after insert or update or delete on public.gp_report_capabilities for each row execute function public._config_audit_row('singleton');
create trigger home_visit_settings_config_audit after insert or update or delete on public.home_visit_settings for each row execute function public._config_audit_row('singleton','updated_at');
create trigger lab_ai_capabilities_config_audit after insert or update or delete on public.lab_ai_capabilities for each row execute function public._config_audit_row('singleton');
create trigger member_notice_settings_config_audit after insert or update or delete on public.member_notice_settings for each row execute function public._config_audit_row('singleton','updated_at');
create trigger patient_message_spend_policy_config_audit after insert or update or delete on public.patient_message_spend_policy for each row execute function public._config_audit_row('id','updated_at');
create trigger staff_message_notice_settings_config_audit after insert or update or delete on public.staff_message_notice_settings for each row execute function public._config_audit_row('singleton','updated_at');
create trigger staff_telegram_policy_config_audit after insert or update or delete on public.staff_telegram_policy for each row execute function public._config_audit_row('singleton','updated_at');
create trigger telegram_channel_settings_config_audit after insert or update or delete on public.telegram_channel_settings for each row execute function public._config_audit_row('singleton');
create trigger workspace_scheduling_settings_config_audit after insert or update or delete on public.workspace_scheduling_settings for each row execute function public._config_audit_row('id');
create trigger zoe_settings_config_audit after insert or update or delete on public.zoe_settings for each row execute function public._config_audit_row('singleton','updated_at');
create trigger zoe_tier_config_config_audit after insert or update or delete on public.zoe_tier_config for each row execute function public._config_audit_row('tier','updated_at');
create trigger workspace_staff_config_audit after insert or update or delete on public.workspace_staff for each row execute function public._config_audit_row('user_id');
create trigger clinic_portal_memberships_config_audit after insert or update or delete on public.clinic_portal_memberships for each row execute function public._config_audit_row('id');
create trigger workspace_clinics_config_audit after insert or update or delete on public.workspace_clinics for each row execute function public._config_audit_row('id');

-- 3. Recording staff reads at the source ------------------------------------------------------------
-- Each definer function that serves a member's data to staff keeps its name and signature, and is now
-- a thin wrapper: it calls the unchanged original (renamed *_unlogged, callable by no client role),
-- then records the read. A refused read raises inside the original, so nothing is recorded for it.
-- A read that returns nothing or {"enabled": false} (its switch is off) showed nothing, and some originals return
-- that before checking access, so it is not recorded (review F1).
-- The wrappers are volatile because they write; none of these is called from another SQL function,
-- and no client calls them with GET. A member reading their own data is not recorded (see above).
-- Already recorded elsewhere and left unwrapped: doctor_member_document_open (patient_document_opens),
-- clinic_member_file (clinic_portal_audit), zoe_run_detail (its own read journal).
alter function public.patient_clinical_case_snapshot(uuid)rename to patient_clinical_case_snapshot_unlogged;
revoke all on function public.patient_clinical_case_snapshot_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.patient_clinical_case_snapshot(p_user_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.patient_clinical_case_snapshot_unlogged(p_user_id);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_user_id,'member_file',null);end if;return r;end$$;
revoke all on function public.patient_clinical_case_snapshot(uuid)from public,anon,authenticated,service_role;
grant execute on function public.patient_clinical_case_snapshot(uuid)to authenticated;
alter function public.conversation_workspace(uuid)rename to conversation_workspace_unlogged;
revoke all on function public.conversation_workspace_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.conversation_workspace(p_member uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.conversation_workspace_unlogged(p_member);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_messages',null);end if;return r;end$$;
revoke all on function public.conversation_workspace(uuid)from public,anon,authenticated,service_role;
grant execute on function public.conversation_workspace(uuid)to authenticated;
alter function public.conversation_intake_workspace(uuid)rename to conversation_intake_workspace_unlogged;
revoke all on function public.conversation_intake_workspace_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.conversation_intake_workspace(p_member uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.conversation_intake_workspace_unlogged(p_member);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_intake',null);end if;return r;end$$;
revoke all on function public.conversation_intake_workspace(uuid)from public,anon,authenticated,service_role;
grant execute on function public.conversation_intake_workspace(uuid)to authenticated;
alter function public.conversation_trace(uuid,bigint)rename to conversation_trace_unlogged;
revoke all on function public.conversation_trace_unlogged(uuid,bigint)from public,anon,authenticated,service_role;
create function public.conversation_trace(p_member uuid,p_before bigint default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.conversation_trace_unlogged(p_member,p_before);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_trace',null);end if;return r;end$$;
revoke all on function public.conversation_trace(uuid,bigint)from public,anon,authenticated,service_role;
grant execute on function public.conversation_trace(uuid,bigint)to authenticated;
alter function public.zoe_runs_for_doctor(uuid)rename to zoe_runs_for_doctor_unlogged;
revoke all on function public.zoe_runs_for_doctor_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.zoe_runs_for_doctor(p_member uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.zoe_runs_for_doctor_unlogged(p_member);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_zoe_runs',null);end if;return r;end$$;
revoke all on function public.zoe_runs_for_doctor(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_runs_for_doctor(uuid)to authenticated;
alter function public.doctor_member_plan_versions(uuid)rename to doctor_member_plan_versions_unlogged;
revoke all on function public.doctor_member_plan_versions_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.doctor_member_plan_versions(p_user_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.doctor_member_plan_versions_unlogged(p_user_id);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_user_id,'member_plan_versions',null);end if;return r;end$$;
revoke all on function public.doctor_member_plan_versions(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_member_plan_versions(uuid)to authenticated;
alter function public.doctor_member_documents(uuid)rename to doctor_member_documents_unlogged;
revoke all on function public.doctor_member_documents_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.doctor_member_documents(p_user_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.doctor_member_documents_unlogged(p_user_id);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_user_id,'member_documents',null);end if;return r;end$$;
revoke all on function public.doctor_member_documents(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_member_documents(uuid)to authenticated;
alter function public.doctor_lab_ai_overview(uuid)rename to doctor_lab_ai_overview_unlogged;
revoke all on function public.doctor_lab_ai_overview_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.doctor_lab_ai_overview(p_user_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.doctor_lab_ai_overview_unlogged(p_user_id);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_user_id,'member_lab_overview',null);end if;return r;end$$;
revoke all on function public.doctor_lab_ai_overview(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_lab_ai_overview(uuid)to authenticated;
alter function public.doctor_lab_ai_read(uuid,uuid)rename to doctor_lab_ai_read_unlogged;
revoke all on function public.doctor_lab_ai_read_unlogged(uuid,uuid)from public,anon,authenticated,service_role;
create function public.doctor_lab_ai_read(p_user_id uuid,p_file uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.doctor_lab_ai_read_unlogged(p_user_id,p_file);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_user_id,'member_lab_read',p_file::text);end if;return r;end$$;
revoke all on function public.doctor_lab_ai_read(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_lab_ai_read(uuid,uuid)to authenticated;
alter function public.patient_staff_lab_stages(uuid)rename to patient_staff_lab_stages_unlogged;
revoke all on function public.patient_staff_lab_stages_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.patient_staff_lab_stages(p_member uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.patient_staff_lab_stages_unlogged(p_member);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_lab_stages',null);end if;return r;end$$;
revoke all on function public.patient_staff_lab_stages(uuid)from public,anon,authenticated,service_role;
grant execute on function public.patient_staff_lab_stages(uuid)to authenticated;
alter function public.patient_staff_visit_workspace(uuid)rename to patient_staff_visit_workspace_unlogged;
revoke all on function public.patient_staff_visit_workspace_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.patient_staff_visit_workspace(p_member uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.patient_staff_visit_workspace_unlogged(p_member);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_visit_evidence',null);end if;return r;end$$;
revoke all on function public.patient_staff_visit_workspace(uuid)from public,anon,authenticated,service_role;
grant execute on function public.patient_staff_visit_workspace(uuid)to authenticated;
alter function public.bp_staff_member_devices(uuid)rename to bp_staff_member_devices_unlogged;
revoke all on function public.bp_staff_member_devices_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.bp_staff_member_devices(p_member uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.bp_staff_member_devices_unlogged(p_member);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_bp_devices',null);end if;return r;end$$;
revoke all on function public.bp_staff_member_devices(uuid)from public,anon,authenticated,service_role;
grant execute on function public.bp_staff_member_devices(uuid)to authenticated;
alter function public.doctor_gp_report_source(uuid)rename to doctor_gp_report_source_unlogged;
revoke all on function public.doctor_gp_report_source_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.doctor_gp_report_source(p_user_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.doctor_gp_report_source_unlogged(p_user_id);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_user_id,'member_gp_report',null);end if;return r;end$$;
revoke all on function public.doctor_gp_report_source(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_gp_report_source(uuid)to authenticated;
alter function public.doctor_gp_report_version(uuid,integer)rename to doctor_gp_report_version_unlogged;
revoke all on function public.doctor_gp_report_version_unlogged(uuid,integer)from public,anon,authenticated,service_role;
create function public.doctor_gp_report_version(p_user_id uuid,p_version integer)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.doctor_gp_report_version_unlogged(p_user_id,p_version);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_user_id,'member_gp_report_version',p_version::text);end if;return r;end$$;
revoke all on function public.doctor_gp_report_version(uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.doctor_gp_report_version(uuid,integer)to authenticated;
alter function public.booking_pilot_workspace(uuid)rename to booking_pilot_workspace_unlogged;
revoke all on function public.booking_pilot_workspace_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.booking_pilot_workspace(p_member uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.booking_pilot_workspace_unlogged(p_member);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_bookings',null);end if;return r;end$$;
revoke all on function public.booking_pilot_workspace(uuid)from public,anon,authenticated,service_role;
grant execute on function public.booking_pilot_workspace(uuid)to authenticated;
alter function public.booking_pilot_workspace_details(uuid)rename to booking_pilot_workspace_details_unlogged;
revoke all on function public.booking_pilot_workspace_details_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.booking_pilot_workspace_details(p_member uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.booking_pilot_workspace_details_unlogged(p_member);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_member,'member_bookings',null);end if;return r;end$$;
revoke all on function public.booking_pilot_workspace_details(uuid)from public,anon,authenticated,service_role;
grant execute on function public.booking_pilot_workspace_details(uuid)to authenticated;
alter function public.patient_test_booking_requests(uuid)rename to patient_test_booking_requests_unlogged;
revoke all on function public.patient_test_booking_requests_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.patient_test_booking_requests(p_user_id uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.patient_test_booking_requests_unlogged(p_user_id);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record(p_user_id,'member_test_requests',null);end if;return r;end$$;
revoke all on function public.patient_test_booking_requests(uuid)from public,anon,authenticated,service_role;
grant execute on function public.patient_test_booking_requests(uuid)to authenticated;
alter function public.admin_member_contacts(uuid[])rename to admin_member_contacts_unlogged;
revoke all on function public.admin_member_contacts_unlogged(uuid[])from public,anon,authenticated,service_role;
create function public.admin_member_contacts(p_members uuid[])returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.admin_member_contacts_unlogged(p_members);k text;
begin for k in select jsonb_object_keys(r)loop perform public._access_audit_record(k::uuid,'member_contacts',null);end loop;return r;end$$;
revoke all on function public.admin_member_contacts(uuid[])from public,anon,authenticated,service_role;
grant execute on function public.admin_member_contacts(uuid[])to authenticated;
alter function public.patient_coordination_snapshot(uuid)rename to patient_coordination_snapshot_unlogged;
revoke all on function public.patient_coordination_snapshot_unlogged(uuid)from public,anon,authenticated,service_role;
create function public.patient_coordination_snapshot(p_task uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public.patient_coordination_snapshot_unlogged(p_task);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record((select patient_case_id from public.patient_coordination_tasks where id=p_task),'member_coordination',p_task::text);end if;return r;end$$;
revoke all on function public.patient_coordination_snapshot(uuid)from public,anon,authenticated,service_role;
grant execute on function public.patient_coordination_snapshot(uuid)to authenticated;

-- 4. The admin Activity log ------------------------------------------------------------------------
-- One row per recorded action from every audit source, newest first. Rows carry who, whose record,
-- what kind of action and an object id; detail columns (which may hold message or clinical text)
-- are never read here. Not exposed: no client role can execute it.
create function public._activity_rows(p_from timestamptz,p_to timestamptz)
returns table(at timestamptz,key text,category text,source text,action text,actor_id uuid,member_id uuid,ref text)
language sql stable security definer set search_path=''as $$
 select a.at,'access:'||a.id,case when a.surface like 'activity_log.%'then 'export' else 'record_access' end,'access',a.surface,a.actor_id,a.member_id,a.object_id
  from public.access_audit a where a.at>=p_from and a.at<=p_to
 union all
 select e.created_at,'auth:'||e.id,'sign_in','auth',e.payload->>'action',u.id,
  case when not exists(select 1 from public.workspace_staff s where s.user_id=u.id)and not exists(select 1 from public.clinic_portal_memberships m where m.user_id=u.id)then u.id end,null
  from auth.audit_log_entries e
  left join lateral(select case when e.payload->>'actor_id' ~ '^[0-9a-f-]{36}$' then (e.payload->>'actor_id')::uuid end id)u on true
  where e.created_at>=p_from and e.created_at<=p_to
   and e.payload->>'action' in('login','logout','user_signedup','user_recovery_requested','user_updated_password','user_invited','user_deleted','user_modified')
 union all
 select t.created_at,'telegram_auth:'||t.id,'sign_in','telegram_auth',t.kind,t.auth_user_id,
  case when not exists(select 1 from public.workspace_staff s where s.user_id=t.auth_user_id)and not exists(select 1 from public.clinic_portal_memberships m where m.user_id=t.auth_user_id)then t.auth_user_id end,null
  from public.telegram_auth_audit t where t.created_at>=p_from and t.created_at<=p_to
 union all
 select t.created_at,'telegram:'||t.id,'sign_in','telegram',t.kind,t.member_id,t.member_id,null
  from public.telegram_audit t where t.created_at>=p_from and t.created_at<=p_to and t.kind like 'link.%'
 union all
 select o.created_at,'document_open:'||o.id,'record_access','document_open',o.actor_kind,o.actor_id,o.user_id,o.file_id::text
  from public.patient_document_opens o where o.created_at>=p_from and o.created_at<=p_to
 union all
 select c.created_at,'clinic_file_open:'||c.id,'record_access','clinic_file_open','opened',c.actor_id,
  (select r.user_id from public.clinic_result_attachments r where r.file_id=c.file_id order by r.created_at desc limit 1),c.file_id::text
  from public.clinic_original_accesses c where c.created_at>=p_from and c.created_at<=p_to
 union all
 select c.created_at,'clinic:'||c.id,case when c.kind like 'member-file-%'then 'record_access' else 'care_change' end,'clinic',c.kind,c.actor_id,
  case when c.detail->>'memberId' ~ '^[0-9a-f-]{36}$' then (c.detail->>'memberId')::uuid end,c.batch_id::text
  from public.clinic_portal_audit c where c.created_at>=p_from and c.created_at<=p_to
 union all
 select e.created_at,'clinical_case:'||e.id,'care_change','clinical_case',e.kind,e.actor_id,e.user_id,null
  from public.patient_clinical_case_events e where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.created_at,'document_release:'||e.id,'care_change','document_release',e.kind,e.actor_id,e.user_id,e.file_id::text
  from public.patient_document_release_events e where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.created_at,'coordination:'||e.id,'care_change','coordination',e.operation,e.actor_id,t.patient_case_id,e.task_id::text
  from public.patient_coordination_events e join public.patient_coordination_tasks t on t.id=e.task_id where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.created_at,'test_request:'||e.request_id||'-'||e.command_id,'care_change','test_request',e.operation,e.actor_id,r.user_id,e.request_id::text
  from public.patient_test_request_events e join public.patient_test_requests r on r.id=e.request_id where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.created_at,'care_alert:'||e.id,'care_change','care_alert',e.kind,e.actor_id,a.member_id,e.alert_id::text
  from public.care_alert_audit e join public.care_alerts a on a.id=e.alert_id where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.created_at,'conversation:'||e.id,'care_change','conversation',e.kind,e.actor_id,c.member_id,null
  from public.conversation_audit e join public.conversations c on c.id=e.conversation_id where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.created_at,'booking:'||e.id,'care_change','booking',e.kind,null,a.member_id,e.appointment_id::text
  from public.booking_appointment_events e join public.booking_appointments a on a.id=e.appointment_id where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.at,'payment:'||e.id,'admin_change','payment',e.kind||coalesce(':'||e.to_status,''),e.actor_id,p.member_id,e.payment_id::text
  from public.pilot_payment_events e join public.pilot_payments p on p.id=e.payment_id where e.at>=p_from and e.at<=p_to
 union all
 select e.at,'catalog:'||e.id,'admin_change','catalog',e.kind,e.actor_id,null,e.test_id::text
  from public.pilot_catalog_events e where e.at>=p_from and e.at<=p_to
 union all
 select e.at,'bp_device:'||e.id,'admin_change','bp_device',e.kind,e.actor_id,null,e.device_id::text
  from public.bp_device_events e where e.at>=p_from and e.at<=p_to
 union all
 select e.created_at,'zoe_tier:'||e.id,'admin_change','zoe_tier',e.action||':'||e.tier,e.actor,null,null
  from public.zoe_tier_config_changes e where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.created_at,'staff_admin:'||e.id,'admin_change','staff_admin',e.kind,e.actor_id,null,coalesce(e.invitation_id,e.clinic_id)::text
  from public.real_staff_admin_events e where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.created_at,'staff_recovery:'||e.id,'admin_change','staff_recovery',e.kind,e.actor_id,null,e.recovery_id::text
  from public.real_staff_recovery_events e where e.created_at>=p_from and e.created_at<=p_to
 union all
 select e.at,'config:'||e.id,'admin_change','config',e.operation||':'||e.table_name,e.actor_id,null,
  left(coalesce(e.row_key,'')||' ('||(select string_agg(k,', 'order by k)from jsonb_object_keys(e.changed)k)||')',200)
  from public.config_audit e where e.at>=p_from and e.at<=p_to
$$;
revoke all on function public._activity_rows(timestamptz,timestamptz)from public,anon,authenticated,service_role;

create function public._activity_page(p_actor uuid,p_member uuid,p_category text,p_from timestamptz,p_to timestamptz,p_cursor text,p_limit integer)returns jsonb
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
  from public._activity_rows(coalesce(p_from,'-infinity'),least(coalesce(p_to,'infinity'),coalesce(c_at,'infinity')))r
  left join public.workspace_staff ws on ws.user_id=r.actor_id
  left join lateral(select m.display_name from public.clinic_portal_memberships m where m.user_id=r.actor_id order by m.active desc limit 1)cm on ws.user_id is null
  left join public.profiles ap on ap.id=r.actor_id and ws.user_id is null and cm.display_name is null
  left join public.profiles mp on mp.id=r.member_id
  where(p_actor is null or r.actor_id=p_actor)and(p_member is null or r.member_id=p_member)and(p_category is null or r.category=p_category)
   and(p_to is null or r.at<p_to)and(c_at is null or(r.at,r.key)<(c_at,c_key))
  order by r.at desc,r.key desc limit lim+1)s;
 return jsonb_build_object('ok',true,'rows',(select coalesce(jsonb_agg(v),'[]')from(select v from jsonb_array_elements(rows)with ordinality e(v,i)where i<=lim)q),
  'next',case when n>lim then (rows->(lim-1)->>'at')||'|'||(rows->(lim-1)->>'key')end);
end$$;
revoke all on function public._activity_page(uuid,uuid,text,timestamptz,timestamptz,text,integer)from public,anon,authenticated,service_role;

-- Admin only, read-only, at most 200 rows a page. Volatile only because the admin check locks the staff row.
create function public.admin_activity_log(p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 100)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 return public._activity_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200));
end$$;
revoke all on function public.admin_activity_log(uuid,uuid,text,timestamptz,timestamptz,text,integer)from public,anon,authenticated,service_role;
grant execute on function public.admin_activity_log(uuid,uuid,text,timestamptz,timestamptz,text,integer)to authenticated;

-- The CSV export: up to 5000 rows for the same filters, recorded before the rows are returned.
create function public.admin_activity_log_export(p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid:=public._real_staff_require_admin();
begin
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)values(a,'admin',p_member,'activity_log.export',
  nullif(left(concat_ws(';','actor='||p_actor,'category='||p_category,'from='||p_from,'to='||p_to),200),''),left(auth.jwt()->>'session_id',80));
 return public._activity_page(p_actor,p_member,p_category,p_from,p_to,null,5000);
end$$;
revoke all on function public.admin_activity_log_export(uuid,uuid,text,timestamptz,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.admin_activity_log_export(uuid,uuid,text,timestamptz,timestamptz)to authenticated;

-- People who can act on member records, for the Person filter.
create function public.admin_activity_people()returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 return jsonb_build_object('ok',true,'people',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role)order by name,id)from(
  select s.user_id id,s.display_name name,s.role||case when s.removed_at is not null or not s.active then ', removed' else '' end role from public.workspace_staff s
  union all
  select m.user_id,min(m.display_name),'clinic' from public.clinic_portal_memberships m where not exists(select 1 from public.workspace_staff s where s.user_id=m.user_id)group by m.user_id)p),'[]'));
end$$;
revoke all on function public.admin_activity_people()from public,anon,authenticated,service_role;
grant execute on function public.admin_activity_people()to authenticated;
