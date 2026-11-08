-- Old no-escalation snapshots gain the current backup, without changing who was told first.
-- Run after all migrations against an isolated replay; every fixture rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(v boolean,label text)returns void language plpgsql as $$begin
 if v is not true then raise exception 'Open alert backfill check failed: %',label;end if;end$$;
insert into auth.users(id)select ('ed100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid from generate_series(1,9)g;
insert into public.care_alert_settings(singleton,enabled,telegram_delivery)values(true,true,false)
 on conflict(singleton)do update set enabled=true,telegram_delivery=false;
delete from public.care_alert_routing;
insert into public.care_alert_routing(source,primary_role,backup_role,escalate_after_minutes)values
 ('*','nurse','doctor',15),('lab','both',null,null),('message','doctor','nurse',25);
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref)
 select ('ed100000-0000-4000-8100-'||lpad(g::text,12,'0'))::uuid,
 ('ed100000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 case g when 5 then 'lab'when 7 then 'message'else 'zoe'end,
 'urgent_words_matched','zoe.urgent_lexicon','test','backfill-open-'||g from generate_series(1,9)g;
-- INSERT snapshots today's route, so restore the historical snapshots after insertion.
update public.care_alerts set route_primary='both',route_backup=null,route_minutes=null,
 cycle_started_at=clock_timestamp()-interval '3 hours'
 where source_ref like 'backfill-open-%';
update public.care_alerts set state='acknowledged',acknowledged_at=clock_timestamp(),
 acknowledged_by='ed100000-0000-4000-8000-000000000009'where source_ref='backfill-open-2';
update public.care_alerts set state='resolved',acknowledged_at=clock_timestamp(),
 acknowledged_by='ed100000-0000-4000-8000-000000000009',resolved_at=clock_timestamp(),
 resolved_by='ed100000-0000-4000-8000-000000000009',resolution='member_contacted'where source_ref='backfill-open-3';
update public.care_alerts set route_backup='nurse',route_minutes=30,cycle_started_at=clock_timestamp()
 where source_ref='backfill-open-4';
update public.care_alerts set route_minutes=10 where source_ref='backfill-open-6';
update public.care_alerts set route_primary=null where source_ref='backfill-open-8';
update public.care_alerts set escalated_at=clock_timestamp()-interval '2 hours',escalated_to='nurse',
 escalation_notified_at=clock_timestamp()-interval '2 hours',escalation_attempted_at=clock_timestamp()-interval '2 hours'
 where source_ref='backfill-open-9';
create temp table before_backfill as select * from public.care_alerts where source_ref like 'backfill-open-%';
create temp table backfill_started as select clock_timestamp()started_at;

select pg_temp.ok(public._care_alert_backfill_open_routes()=2,'Only eligible open snapshots are backfilled');
select pg_temp.ok((select route_primary='both'and route_backup='doctor'and route_minutes=15
 and cycle_started_at>=(select started_at from backfill_started)and cycle_started_at<=clock_timestamp()
 and escalated_at is null and escalated_to is null and escalation_notified_at is null and escalation_attempted_at is null
 from public.care_alerts where source_ref='backfill-open-1'),'Old both snapshot keeps primary and starts a fresh doctor wait');
select pg_temp.ok((select route_primary='both'and route_backup='nurse'and route_minutes=25
 from public.care_alerts where source_ref='backfill-open-7'),'Source-specific backup and minutes override the default');
select pg_temp.ok(not exists(select 1 from before_backfill b join public.care_alerts a using(id)
 where b.source_ref not in('backfill-open-1','backfill-open-7')and to_jsonb(a)is distinct from to_jsonb(b)),
 'Acknowledged, resolved, existing backup, untimed current route, partial, absent and escalated snapshots stay unchanged');
select pg_temp.ok((select a.escalated_at is not distinct from b.escalated_at
 and a.escalated_to is not distinct from b.escalated_to
 and a.escalation_notified_at is not distinct from b.escalation_notified_at
 and a.escalation_attempted_at is not distinct from b.escalation_attempted_at
 and a.route_primary is not distinct from b.route_primary
 and a.route_backup is not distinct from b.route_backup
 and a.route_minutes is not distinct from b.route_minutes
 and a.cycle_started_at=b.cycle_started_at
 from before_backfill b join public.care_alerts a using(id)where b.source_ref='backfill-open-9'),
 'Already-escalated snapshot keeps all escalation fields, route and cycle');
select pg_temp.ok(not exists(select 1 from public.care_alert_audit
 where alert_id='ed100000-0000-4000-8100-000000000009'),'Already-escalated snapshot has no new audit row');
select pg_temp.ok((select count(*)=1 and bool_and(actor_id is null and
 detail='{"primaryRole":"both","backupRole":"doctor","afterMinutes":15}'::jsonb)
 from public.care_alert_audit where alert_id='ed100000-0000-4000-8100-000000000001'and kind='routing_backfilled'),
 'Audit records the retained primary, current backup and minutes with no actor');
select pg_temp.ok((select count(*)=1 and bool_and(actor_id is null and
 detail='{"primaryRole":"both","backupRole":"nurse","afterMinutes":25}'::jsonb)
 from public.care_alert_audit where alert_id='ed100000-0000-4000-8100-000000000007'and kind='routing_backfilled'),
 'Source-specific backfill audited once');
select pg_temp.ok((select count(*)=2 from public.care_alert_audit au join before_backfill b on b.id=au.alert_id
 where au.kind='routing_backfilled'),'Skipped snapshots have no backfill audit');
create temp table after_backfill as select * from public.care_alerts where source_ref like 'backfill-open-%';
create temp table after_backfill_audit as select au.* from public.care_alert_audit au join after_backfill a on a.id=au.alert_id;
select pg_temp.ok(public._care_alert_backfill_open_routes()=0,'Second backfill changes nothing');
select pg_temp.ok(not exists(select 1 from after_backfill b join public.care_alerts a using(id)
 where to_jsonb(a)is distinct from to_jsonb(b)),'Second run preserves the cycle and all alert fields');
select pg_temp.ok((select count(*)=(select count(*)from after_backfill_audit)
 from public.care_alert_audit au join after_backfill a on a.id=au.alert_id),'Second run adds no audit');

select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select pg_temp.ok(public.care_alert_escalate_due()->>'raised'='0','Fresh cycle does not escalate immediately');
reset role;
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '14 minutes'where source_ref='backfill-open-1';
set local role service_role;
select pg_temp.ok(public.care_alert_escalate_due()->>'raised'='0','Backfilled alert waits the full 15 minutes');
reset role;
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '16 minutes'where source_ref='backfill-open-1';
set local role service_role;
select pg_temp.ok(public.care_alert_escalate_due()->>'raised'='1','Unacknowledged old snapshot escalates after 15 minutes');
select pg_temp.ok(public.care_alert_escalate_due()->>'raised'='0','Backfilled alert escalates only once');
reset role;
select pg_temp.ok((select route_primary='both'and state='open'and escalated_at is not null and escalated_to='doctor'
 from public.care_alerts where source_ref='backfill-open-1'),'Escalation reaches the doctor and retains the historical primary');
select pg_temp.ok((select count(*)=1 from public.care_alert_audit
 where alert_id='ed100000-0000-4000-8100-000000000001'and kind='escalated'),'Escalation audited once');
select pg_temp.ok((select provolatile='v'and prosecdef and proconfig=array['search_path=""']
 from pg_proc where oid='public._care_alert_backfill_open_routes()'::regprocedure),'Backfill is volatile, security definer, with an empty search path');
select pg_temp.ok(not has_function_privilege('anon','public._care_alert_backfill_open_routes()','execute')
 and not has_function_privilege('authenticated','public._care_alert_backfill_open_routes()','execute')
 and not has_function_privilege('service_role','public._care_alert_backfill_open_routes()','execute'),'Backfill is internal only');
rollback;
select 'care alert open route backfill ok';
