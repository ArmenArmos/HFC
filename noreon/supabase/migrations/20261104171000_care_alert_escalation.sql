-- Care alert routing and escalation (Armen's safety audit S0-5).
--
-- Who is told about an urgent alert, and who is told next when nobody has acknowledged it, is configuration, because the
-- mapping and the waiting time are clinical decisions that Armen has not made yet. Until he sets them the default is the
-- safe one: tell the member's assigned nurse AND the assigned doctor at once (admins as before), and escalate nothing,
-- since everyone who could act has already been told.
--
-- care_alert_routing: one row per alert source (questionnaire, message, lab, zoe, reading) or the default row '*'.
--   primary_role           who is told when the alert is raised: doctor, nurse or both
--   backup_role            who is told next when it is not acknowledged in time (null: nobody)
--   escalate_after_minutes how long an open alert waits before it escalates (null: never)
-- An alert that is still open (not acknowledged) after the wait is marked escalated (escalated_at, escalated_to), the backup
-- is notified in the same way as the first notice (Telegram, held until the wording is approved), and the staff lists show
-- "Escalated". Acknowledging or resolving it ends the wait. A route applies to alerts raised, or reopened after an acknowledgement, after it is
-- set; an alert already in flight keeps the route it started with. Alerts that exist before this migration have no snapshot and never
-- escalate. Nothing here decides what is urgent or changes who may read an alert.

-- cycle_started_at and the route_* columns are the alert's escalation cycle: when it began (raised, or reopened after an acknowledgement)
-- and the route in force at that moment, so a later change of routing never changes what an alert already in flight owes anyone.
-- escalation_notified_at is set when the backup has been told (or there was nobody to tell by design), so a notice that could not be
-- queued (delivery off, nobody enrolled) is retried by the next sweep instead of being lost.
alter table public.care_alerts
 add column escalated_at timestamptz,
 add column escalated_to text check(escalated_to in('doctor','nurse')),
 add column cycle_started_at timestamptz not null default clock_timestamp(),
 add column route_primary text,
 add column route_backup text check(route_backup in('doctor','nurse')),
 add column route_minutes integer check(route_minutes between 1 and 1440),
 add column escalation_notified_at timestamptz,
 add column escalation_attempted_at timestamptz;

create table public.care_alert_routing (
 source text primary key check(source in('*','questionnaire','message','lab','zoe','reading')),
 primary_role text not null default 'both' check(primary_role in('doctor','nurse','both')),
 backup_role text check(backup_role in('doctor','nurse')),
 escalate_after_minutes integer check(escalate_after_minutes between 1 and 1440),
 updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid,
 check((backup_role is null)=(escalate_after_minutes is null))
);
alter table public.care_alert_routing enable row level security;
revoke all on public.care_alert_routing from public,anon,authenticated,service_role;
insert into public.care_alert_routing(source)values('*');

-- The row for a source, else the default row.
create function public._care_alert_route(p_source text)returns public.care_alert_routing
language sql stable security definer set search_path=''as $$
 select r.* from public.care_alert_routing r where r.source in(p_source,'*')order by(r.source='*')limit 1
$$;

-- A new alert, or an acknowledged or resolved one that opens again, starts a new cycle: the route is read once, the wait counts from
-- now, and escalation starts over. Repeats of an open alert change nothing, so unanswered repeats cannot postpone an escalation.
create function public._care_alert_cycle()returns trigger language plpgsql security definer set search_path=''as $$
declare r public.care_alert_routing;
begin
 if tg_op='INSERT'or(old.state<>'open'and new.state='open')then
  r:=public._care_alert_route(new.source);
  new.cycle_started_at:=clock_timestamp();
  new.route_primary:=r.primary_role;new.route_backup:=r.backup_role;new.route_minutes:=r.escalate_after_minutes;
  new.escalated_at:=null;new.escalated_to:=null;new.escalation_notified_at:=null;new.escalation_attempted_at:=null;
 end if;
 return new;
end$$;
create trigger care_alert_cycle before insert or update on public.care_alerts for each row execute function public._care_alert_cycle();

-- Admin: read and change the routing. The change is audited by the row's updated_at and updated_by, and a trace-free journal line.
create function public.care_alert_routing_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 perform public._real_staff_require_admin();
 return jsonb_build_object('ok',true,'routes',coalesce((select jsonb_agg(jsonb_build_object('source',r.source,'primaryRole',r.primary_role,'backupRole',r.backup_role,
  'escalateAfterMinutes',r.escalate_after_minutes,'updatedAt',r.updated_at)order by(r.source<>'*'),r.source)from public.care_alert_routing r),'[]'));
end$$;

create function public.care_alert_routing_set(p_source text,p_primary text,p_backup text default null,p_minutes integer default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid:=public._real_staff_require_admin();
begin
 if p_source is null or p_source not in('*','questionnaire','message','lab','zoe','reading')or p_primary is null or p_primary not in('doctor','nurse','both')
  or(p_backup is null)<>(p_minutes is null)or(p_backup is not null and(p_backup not in('doctor','nurse')or p_minutes not between 1 and 1440))
  -- A backup that is already told first is no backup.
  or(p_backup is not null and p_primary=p_backup)or(p_backup is not null and p_primary='both')then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 insert into public.care_alert_routing(source,primary_role,backup_role,escalate_after_minutes,updated_by)values(p_source,p_primary,p_backup,p_minutes,actor)
  on conflict(source)do update set primary_role=excluded.primary_role,backup_role=excluded.backup_role,escalate_after_minutes=excluded.escalate_after_minutes,
   updated_at=clock_timestamp(),updated_by=excluded.updated_by;
 return jsonb_build_object('ok',true);
end$$;
revoke all on function public.care_alert_routing_read(),public.care_alert_routing_set(text,text,text,integer),public._care_alert_route(text)from public,anon,authenticated,service_role;
grant execute on function public.care_alert_routing_read(),public.care_alert_routing_set(text,text,text,integer)to authenticated;

-- First notice: the assigned doctor when the cycle's route tells doctors, the assigned nurse when it tells nurses (default and alerts from
-- before this migration: both), read from the alert's own route snapshot so a later route change cannot redirect a repeat; and every
-- active admin as before. Patched in place so any later change to the function body stays.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public._care_alert_notify(public.care_alerts)'::regprocedure);
 old:=$old$ where ws.active and ws.removed_at is null and(ws.role='admin'or(ws.role='doctor'and ws.user_id=a.doctor_id))$old$;
 replacement:=$new$ where ws.active and ws.removed_at is null and(ws.role='admin'
   or(ws.role='doctor'and ws.user_id=a.doctor_id and coalesce(a.route_primary,'both')in('doctor','both'))
   or(ws.role='nurse'and ws.user_id=(select c.assigned_nurse_id from public.patient_clinical_cases c where c.user_id=a.member_id)and coalesce(a.route_primary,'both')in('nurse','both')))$new$;
 if position(old in definition)=0 or cardinality(string_to_array(definition,old))<>2 then
  raise exception 'Unexpected _care_alert_notify definition';
 end if;
 execute replace(definition,old,replacement);
end $migration$;

-- The staff views carry the escalation: an escalated, still open alert is shown as such to every role that reads alerts.
do $migration$
declare definition text;old text;replacement text;
begin
 definition:=pg_get_functiondef('public._care_alert_json(public.care_alerts)'::regprocedure);
 old:=$old$'occurrences',a.occurrences,'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,$old$;
 replacement:=$new$'occurrences',a.occurrences,'createdAt',a.created_at,'lastSeenAt',a.last_seen_at,'escalatedAt',a.escalated_at,'escalatedTo',a.escalated_to,$new$;
 if position(old in definition)=0 or cardinality(string_to_array(definition,old))<>2 then
  raise exception 'Unexpected _care_alert_json definition';
 end if;
 execute replace(definition,old,replacement);
end $migration$;

-- Swept with the other care alert jobs (service role, every few minutes). Two steps, each safe to repeat:
-- 1. an open (not acknowledged) alert whose cycle route has a backup and whose wait has passed is marked escalated, once, and journaled;
--    eligibility is decided in the query, so alerts with no backup can never crowd out due ones.
-- 2. an escalated, still open alert whose backup has not been told yet is retried until a notice is queued: delivery off, nobody enrolled
--    and the like leave it pending. With test-account sandboxing on, a test member's alert is never noticed, as for the first notice.
-- An acknowledged or resolved alert never escalates and is never noticed here.
create function public.care_alert_escalate_due()returns jsonb
language plpgsql security definer set search_path=''as $$
declare a public.care_alerts;s public.care_alert_settings:=public._care_alert_settings();u record;mid uuid;n integer:=0;told integer;eligible integer;already integer;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if s.enabled is not true then return jsonb_build_object('ok',true,'raised',0,'failed',0);end if;
 for a in select al.* from public.care_alerts al
  where al.state='open'and al.escalated_at is null and al.route_backup is not null and al.route_minutes is not null
   and clock_timestamp()>=al.cycle_started_at+make_interval(mins=>al.route_minutes)
  order by al.cycle_started_at limit 200 for update skip locked loop
  update public.care_alerts set escalated_at=clock_timestamp(),escalated_to=a.route_backup where id=a.id returning * into a;
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,null,'escalated',jsonb_build_object('to',a.route_backup,'afterMinutes',a.route_minutes));
  perform public._care_alert_trace(a,'care_alert.escalated','escalate','not_acknowledged_in_time','system',null,
   jsonb_build_object('noreon.care_alert.escalated_to',a.route_backup,'noreon.care_alert.after_minutes',a.route_minutes));
  n:=n+1;
 end loop;
 if s.telegram_delivery is not true then return jsonb_build_object('ok',true,'raised',n,'failed',0);end if;
 for a in select al.* from public.care_alerts al
  where al.state='open'and al.escalated_at is not null and al.escalation_notified_at is null
  -- Fair across sweeps: never-tried first, then the least recently tried, so undeliverable ones cannot keep deliverable ones waiting.
  order by al.escalation_attempted_at nulls first,al.escalated_at limit 200 for update skip locked loop
  if s.sandbox_test_accounts is true and exists(select 1 from public.profiles where id=a.member_id and is_test_account)then
   update public.care_alerts set escalation_notified_at=clock_timestamp()where id=a.id;
   perform public._care_alert_trace(a,'care_alert.escalation_notice_skipped','skipped','test_account_sandbox','system',null,'{}');
   continue;
  end if;
  told:=0;eligible:=0;already:=0;
  for u in select distinct on(ws.user_id)ws.user_id,b.address,b.principal_ref
   from public.workspace_staff ws join public.telegram_auth_bindings b on b.auth_user_id=ws.user_id and b.kind='staff'and b.active
   where ws.active and ws.removed_at is null
    and((a.escalated_to='doctor'and ws.role='doctor'and ws.user_id=a.doctor_id)
     or(a.escalated_to='nurse'and ws.role='nurse'and ws.user_id=(select c.assigned_nurse_id from public.patient_clinical_cases c where c.user_id=a.member_id)))
    and not public._test_member_hidden(a.member_id,ws.user_id)order by ws.user_id loop
   eligible:=eligible+1;
   if exists(select 1 from public.care_alert_deliveries d where d.alert_id=a.id and d.recipient_id=u.user_id and d.occurrence=a.occurrences)then already:=already+1;continue;end if;
   mid:=public._telegram_auth_enqueue('care_alert.staff_notice',public._telegram_auth_locale(u.user_id),u.address,u.principal_ref,null,null);
   if mid is null then continue;end if;
   insert into public.care_alert_deliveries(alert_id,recipient_id,channel,telegram_message_id,occurrence)values(a.id,u.user_id,'telegram',mid,a.occurrences);
   told:=told+1;
  end loop;
  -- Told, or everyone who could be told already was. Otherwise it stays pending and the next sweep tries again.
  update public.care_alerts set escalation_attempted_at=clock_timestamp()where id=a.id;
  if told>0 or(eligible>0 and already=eligible)then
   update public.care_alerts set escalation_notified_at=clock_timestamp()where id=a.id;
   perform public._care_alert_trace(a,'care_alert.escalation_notified','queued','backup_told','system',null,
    jsonb_build_object('noreon.care_alert.escalated_to',a.escalated_to,'noreon.care_alert.recipients',told));
  end if;
 end loop;
 return jsonb_build_object('ok',true,'raised',n,'failed',0);
end$$;
revoke all on function public.care_alert_escalate_due()from public,anon,authenticated,service_role;
grant execute on function public.care_alert_escalate_due()to service_role;
