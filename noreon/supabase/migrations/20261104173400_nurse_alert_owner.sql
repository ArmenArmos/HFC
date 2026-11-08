-- P0-04 part 1: the assigned nurse owns the follow-up; the assigned doctor remains the backup.
-- Assignment and staff validity use the existing coordination boundary. No urgency rules change.
alter table public.care_alerts
 add column next_action text check(next_action is null or(next_action=btrim(next_action,E' \t\r\n\f'||chr(11))and length(next_action)between 1 and 300)),
 add column next_action_due_at timestamptz check(next_action_due_at is null or isfinite(next_action_due_at)),
 add column next_action_by uuid,
 add column next_action_at timestamptz,
 add constraint care_alert_next_action_complete check(
  (next_action is null and next_action_by is null and next_action_at is null and next_action_due_at is null)
  or(next_action is not null and next_action_by is not null and next_action_at is not null));

alter table public.care_alert_routing alter column primary_role set default 'nurse',
 alter column backup_role set default 'doctor',alter column escalate_after_minutes set default 15;
update public.care_alert_routing set primary_role='nurse',backup_role='doctor',escalate_after_minutes=15,
 updated_at=clock_timestamp(),updated_by=null where source='*';

-- DB-derived display fields never trust a caller-supplied owner. Invalid/removed assignments do not own alerts.
create function public._care_alert_owner(p_member uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce((select jsonb_build_object('ownerName',s.display_name,'ownerRole',s.role)
  from public.patient_clinical_cases c join public.workspace_staff s on s.user_id in(c.assigned_nurse_id,c.assigned_doctor_id)
  where c.user_id=p_member and public._patient_coordination_owner_valid(p_member,s.user_id,false)
  order by(s.role='nurse')desc limit 1),jsonb_build_object('ownerName',null,'ownerRole',null))
$$;
revoke all on function public._care_alert_owner(uuid)from public,anon,authenticated,service_role;

-- Primary ownership stays visible after escalation, alongside the doctor now responsible for acting.
create function public._care_alert_ownership(a public.care_alerts)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object(
  'primaryOwnerName',p->>'ownerName','primaryOwnerRole',p->>'ownerRole',
  'ownerName',coalesce(d->>'ownerName',p->>'ownerName'),'ownerRole',coalesce(d->>'ownerRole',p->>'ownerRole'),
  'escalatedDoctorName',d->>'ownerName')
 from(select public._care_alert_owner(a.member_id)p,
  case when a.escalated_to='doctor'and a.escalated_at is not null then
   (select jsonb_build_object('ownerName',s.display_name,'ownerRole','doctor')
    from public.patient_clinical_cases c join public.workspace_staff s on s.user_id=c.assigned_doctor_id
    where c.user_id=a.member_id and public._patient_coordination_owner_valid(c.user_id,s.user_id,true))end d)x
$$;
revoke all on function public._care_alert_ownership(public.care_alerts)from public,anon,authenticated,service_role;

create or replace function public._care_alert_actor()returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare ws public.workspace_staff;
begin
 if auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 select * into ws from public.workspace_staff where user_id=auth.uid()and active and removed_at is null and role in('admin','doctor','nurse');
 if not found or not public._real_staff_managed_session_allowed(auth.uid())then
  raise insufficient_privilege using message='Active staff session required';end if;
 return jsonb_build_object('id',ws.user_id,'role',ws.role);
end$$;

create or replace function public._care_alert_visible(a public.care_alerts,actor jsonb)returns boolean
language sql volatile security definer set search_path=''as $$
 select not public._test_member_hidden(a.member_id,(actor->>'id')::uuid)and(
  actor->>'role'='admin'
  or(actor->>'role'='doctor'and exists(select 1 from public.patient_clinical_cases c where c.user_id=a.member_id and c.assigned_doctor_id=(actor->>'id')::uuid))
  or(actor->>'role'='nurse'and public.patient_coordination_access(a.member_id)
   and exists(select 1 from public.patient_clinical_cases c where c.user_id=a.member_id and c.assigned_nurse_id=(actor->>'id')::uuid)
   and public._patient_coordination_owner_valid(a.member_id,(actor->>'id')::uuid,false)))
$$;

-- Account -> case -> invitation -> session -> staff -> clinic -> conversation -> alert. Recheck after the locks.
-- All mutations use this order, so reassignment or staff/clinic removal cannot authorize a stale write.
create function public._care_alert_lock(p_alert uuid)returns public.care_alerts
language plpgsql volatile security definer set search_path=''as $$
declare m uuid;has_case boolean;actor jsonb;a public.care_alerts;
begin
 actor:=public._care_alert_actor();
 select member_id into m from public.care_alerts where id=p_alert;
 if not found then return null;end if;
 perform 1 from auth.users where id=auth.uid()for share nowait;
 perform 1 from public.patient_clinical_cases where user_id=m for update nowait;
 has_case:=found;
 perform 1 from public.real_staff_invitations where auth_user_id=auth.uid()for share nowait;
 perform 1 from auth.sessions where id::text=auth.jwt()->>'session_id'and user_id=auth.uid()for share nowait;
 perform 1 from public.workspace_staff where user_id=auth.uid()or user_id in(
  select c.assigned_doctor_id from public.patient_clinical_cases c where c.user_id=m
  union select c.assigned_nurse_id from public.patient_clinical_cases c where c.user_id=m)
  order by user_id for share nowait;
 perform 1 from public.workspace_clinics where id in(select s.clinic_id from public.workspace_staff s
  where s.user_id=auth.uid()or s.user_id in(select c.assigned_doctor_id from public.patient_clinical_cases c where c.user_id=m
   union select c.assigned_nurse_id from public.patient_clinical_cases c where c.user_id=m))order by id for share nowait;
 actor:=public._care_alert_actor();
 if not has_case and actor->>'role'<>'admin'then return null;end if;
 -- Doctor resolution can hand the conversation back to Zoe. Match the worker's
 -- conversation-before-alert order even though its side effects remain in care_alert_resolve.
 perform 1 from public.conversations where member_id=m for update;
 select * into a from public.care_alerts where id=p_alert and member_id=m for update;
 if not found or not public._care_alert_visible(a,actor)then return null;end if;
 return a;
end$$;
revoke all on function public._care_alert_lock(uuid)from public,anon,authenticated,service_role;

-- Preserve existing close validation, outcomes, traces and optimistic sequencing in place.
do $migration$
declare definition text;start_at integer;end_at integer;
begin
 definition:=pg_get_functiondef('public.care_alert_resolve(uuid,bigint,text,text)'::regprocedure);
 start_at:=position(' select member_id into m from public.care_alerts where id=p_alert;'in definition);
 end_at:=position(' if a.state=''resolved'''in definition);
 if start_at=0 or end_at<=start_at then raise exception 'Unexpected care_alert_resolve locks';end if;
 -- This replaced span also contains the conversation lock added by the stuck-state fix.
 -- Require it in the old source so future edits cannot silently bypass the shared ordering.
 if cardinality(string_to_array(substr(definition,start_at,end_at-start_at),
  ' perform 1 from public.conversations where member_id=m for update;'))<>2 then
  raise exception 'Unexpected care_alert_resolve conversation lock';end if;
 definition:=substr(definition,1,start_at-1)||E' a:=public._care_alert_lock(p_alert);\n if a.id is null then return jsonb_build_object(''ok'',false,''code'',''not_found'');end if;\n actor:=public._care_alert_actor();\n'||substr(definition,end_at);
 execute definition;
end $migration$;

create or replace function public.care_alert_acknowledge(p_alert uuid,p_expected_seq bigint)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare actor jsonb;a public.care_alerts;
begin
 a:=public._care_alert_lock(p_alert);
 if a.id is null then return jsonb_build_object('ok',false,'code','not_found');end if;
 actor:=public._care_alert_actor();
 if a.state<>'open'then return jsonb_build_object('ok',true,'changed',false,'alert',public._care_alert_json(a));end if;
 if a.state_seq is distinct from p_expected_seq then return jsonb_build_object('ok',false,'code','changed','alert',public._care_alert_json(a));end if;
 update public.care_alerts set state='acknowledged',acknowledged_by=(actor->>'id')::uuid,acknowledged_at=clock_timestamp(),state_seq=state_seq+1 where id=a.id returning * into a;
 insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,(actor->>'id')::uuid,'acknowledged',jsonb_build_object('role',actor->>'role'));
 perform public._care_alert_trace(a,'care_alert.acknowledged','recorded','staff_acknowledged',public._conversation_trace_actor(),(actor->>'id')::uuid,'{}');
 return jsonb_build_object('ok',true,'changed',true,'alert',public._care_alert_json(a));
end$$;

create function public.care_alert_next_action(p_alert uuid,p_expected_seq bigint,p_text text,p_due_at timestamptz default null)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare actor jsonb;a public.care_alerts;note text:=nullif(btrim(p_text,E' \t\r\n\f'||chr(11)),'');
begin
 -- Authenticate even when validation fails, as the existing staff commands do.
 actor:=public._care_alert_actor();
 if note is null or length(note)>300 or(p_due_at is not null and not isfinite(p_due_at))then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 a:=public._care_alert_lock(p_alert);
 if a.id is null then return jsonb_build_object('ok',false,'code','not_found');end if;
 actor:=public._care_alert_actor();
 -- A next action belongs to the assigned nurse or assigned doctor, not to an unassigned admin.
 if actor->>'role'not in('doctor','nurse')or not public._patient_coordination_owner_valid(a.member_id,(actor->>'id')::uuid,false)then return jsonb_build_object('ok',false,'code','not_found');end if;
 if a.state_seq is distinct from p_expected_seq then return jsonb_build_object('ok',false,'code','changed','alert',public._care_alert_json(a));end if;
 if a.state='resolved'then return jsonb_build_object('ok',false,'code','resolved','alert',public._care_alert_json(a));end if;
 update public.care_alerts set next_action=note,next_action_due_at=p_due_at,next_action_by=(actor->>'id')::uuid,next_action_at=clock_timestamp(),
  state='acknowledged',
  acknowledged_by=case when a.state='open'then(actor->>'id')::uuid else acknowledged_by end,
  acknowledged_at=case when a.state='open'then clock_timestamp()else acknowledged_at end,state_seq=state_seq+1
  where id=a.id returning * into a;
 insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,(actor->>'id')::uuid,'next_action',
  jsonb_build_object('role',actor->>'role','at',a.next_action_at,'dueAt',p_due_at,'text',note));
 perform public._care_alert_trace(a,'care_alert.next_action','recorded','staff_next_action',public._conversation_trace_actor(),(actor->>'id')::uuid,'{}');
 return jsonb_build_object('ok',true,'changed',true,'alert',public._care_alert_json(a));
end$$;
revoke all on function public.care_alert_next_action(uuid,bigint,text,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.care_alert_next_action(uuid,bigint,text,timestamptz)to authenticated;

-- Add display data without losing BP merge history, delivery states, or existing doctor fields.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public._care_alert_json(public.care_alerts)'::regprocedure);
 old:=$old$'resolution',a.resolution,'resolutionNote',a.resolution_note,$old$;
 replacement:=$new$'resolution',a.resolution,'resolutionNote',a.resolution_note,
  'ownerName',public._care_alert_ownership(a)->>'ownerName','ownerRole',public._care_alert_ownership(a)->>'ownerRole',
  'primaryOwnerName',public._care_alert_ownership(a)->>'primaryOwnerName','primaryOwnerRole',public._care_alert_ownership(a)->>'primaryOwnerRole',
  'nextAction',a.next_action,'nextActionDueAt',a.next_action_due_at,
  'nextActionBy',(select display_name from public.workspace_staff where user_id=a.next_action_by),'nextActionAt',a.next_action_at,
  'escalatedDoctorName',public._care_alert_ownership(a)->>'escalatedDoctorName',$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected _care_alert_json owner fields';end if;
 execute replace(definition,old,replacement);
end $migration$;

create or replace function public.care_alert_nurse_inbox(p_limit integer default 50)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare actor jsonb:=public._care_alert_actor();lim integer:=greatest(1,least(coalesce(p_limit,50),100));total integer;items jsonb;m uuid;
begin
 if actor->>'role'is distinct from 'nurse'then raise insufficient_privilege using message='Active nurse session required';end if;
 with live as(select a.* from public.care_alerts a where a.state<>'resolved'and public._care_alert_visible(a,actor)),
 page as(select * from live order by(state<>'open'),(source not in('zoe','message')),coalesce(last_seen_at,created_at)desc,id limit lim)
 select(select count(*)from live),coalesce((select jsonb_agg(public._care_alert_json(a)
  order by(a.state<>'open'),(a.source not in('zoe','message')),coalesce(a.last_seen_at,a.created_at)desc,a.id)from page a),'[]'::jsonb)into total,items;
 for m in select distinct(e->>'memberId')::uuid from jsonb_array_elements(items)e loop
  perform public._access_audit_record(m,'care_alert_inbox','nurse');
 end loop;
 return jsonb_build_object('ok',true,'asOf',statement_timestamp(),'total',total,'alerts',items);
end$$;

-- A nurse-primary route always has a first recipient when a valid assigned doctor exists.
-- Keep all delivery, sandbox, deduplication and unapproved-wording behavior from the current implementation.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public._care_alert_notify(public.care_alerts)'::regprocedure);
 old:=$old$(ws.role='doctor'and ws.user_id=a.doctor_id and coalesce(a.route_primary,'both')in('doctor','both'))$old$;
 replacement:=$new$(ws.role='doctor'and(
    (ws.user_id=a.doctor_id and coalesce(a.route_primary,'both')in('doctor','both'))
    or(coalesce(a.route_primary,'both')='nurse'
     and public._patient_coordination_owner_valid(a.member_id,ws.user_id,true)
     and not exists(select 1 from public.patient_clinical_cases c where c.user_id=a.member_id
      and public._patient_coordination_owner_valid(c.user_id,c.assigned_nurse_id,false)))))$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected _care_alert_notify doctor routing';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$(ws.role='nurse'and ws.user_id=(select c.assigned_nurse_id from public.patient_clinical_cases c where c.user_id=a.member_id)and coalesce(a.route_primary,'both')in('nurse','both'))$old$;
 replacement:=$new$(ws.role='nurse'and public._patient_coordination_owner_valid(a.member_id,ws.user_id,false)
    and coalesce(a.route_primary,'both')in('nurse','both'))$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected _care_alert_notify nurse routing';end if;
 execute replace(definition,old,replacement);
end $migration$;

-- Escalation addresses the currently assigned, valid backup, as ownership does. The cycle's
-- snapshotted role and deadline stay unchanged; an acknowledgement or next action stops the sweep.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public.care_alert_escalate_due()'::regprocedure);
 old:=$old$(a.escalated_to='doctor'and ws.role='doctor'and ws.user_id=a.doctor_id)$old$;
 replacement:=$new$(a.escalated_to='doctor'and ws.role='doctor'and public._patient_coordination_owner_valid(a.member_id,ws.user_id,true))$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected care_alert_escalate_due doctor';end if;
 definition:=replace(definition,old,replacement);
 old:=$old$(a.escalated_to='nurse'and ws.role='nurse'and ws.user_id=(select c.assigned_nurse_id from public.patient_clinical_cases c where c.user_id=a.member_id))$old$;
 replacement:=$new$(a.escalated_to='nurse'and ws.role='nurse'and public._patient_coordination_owner_valid(a.member_id,ws.user_id,false))$new$;
 if cardinality(string_to_array(definition,old))<>2 then raise exception 'Unexpected care_alert_escalate_due nurse';end if;
 execute replace(definition,old,replacement);
end $migration$;

-- Snapshot-free open alerts start their first timed cycle now, never retroactively overdue.
-- A separate revoked helper makes the migration's one-time behavior testable and safe to repeat.
create function public._care_alert_backfill_owner_routes()returns integer
language plpgsql volatile security definer set search_path=''as $$
declare a public.care_alerts;r public.care_alert_routing;n integer:=0;
begin
 for a in select al.* from public.care_alerts al where al.state='open'and al.route_primary is null for update loop
  r:=public._care_alert_route(a.source);
  update public.care_alerts set cycle_started_at=clock_timestamp(),route_primary=r.primary_role,route_backup=r.backup_role,route_minutes=r.escalate_after_minutes,
   escalated_at=null,escalated_to=null,escalation_notified_at=null,escalation_attempted_at=null where id=a.id;
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,null,'routing_backfilled',
   jsonb_build_object('primaryRole',r.primary_role,'backupRole',r.backup_role,'afterMinutes',r.escalate_after_minutes));
  n:=n+1;
 end loop;
 return n;
end$$;
revoke all on function public._care_alert_backfill_owner_routes()from public,anon,authenticated,service_role;
select public._care_alert_backfill_owner_routes();

-- A volatile predicate must never be reached through a read-only RPC transaction.
alter function public.care_alert_inbox(text,integer)volatile;
alter function public.care_alert_audit_log(uuid)volatile;
alter function public.care_alert_resolve(uuid,bigint,text,text)volatile;
