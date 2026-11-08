-- P0-04 follow-up: open alerts with the old no-escalation snapshot need a timed backup too.
-- Keep the primary role: those recipients were already told. Start the wait now, not retroactively.
create function public._care_alert_backfill_open_routes()returns integer
language plpgsql volatile security definer set search_path=''as $$
declare a public.care_alerts;r public.care_alert_routing;n integer:=0;
begin
 for a in select al.* from public.care_alerts al
  where al.state='open'and al.escalated_at is null and al.route_primary is not null and al.route_backup is null and al.route_minutes is null
  for update loop
  r:=public._care_alert_route(a.source);
  if r.backup_role is null or r.escalate_after_minutes is null then continue;end if;
  update public.care_alerts set route_backup=r.backup_role,route_minutes=r.escalate_after_minutes,
   cycle_started_at=clock_timestamp(),escalated_at=null,escalated_to=null,
   escalation_notified_at=null,escalation_attempted_at=null where id=a.id;
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,null,'routing_backfilled',
   jsonb_build_object('primaryRole',a.route_primary,'backupRole',r.backup_role,'afterMinutes',r.escalate_after_minutes));
  n:=n+1;
 end loop;
 return n;
end$$;
revoke all on function public._care_alert_backfill_open_routes()from public,anon,authenticated,service_role;
select public._care_alert_backfill_open_routes();
