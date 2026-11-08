-- Care alert routing and escalation (S0-5). Synthetic fixtures, rolled back, safe on a database that already has alert settings.
-- Default route: the assigned nurse is told first, with the assigned doctor as backup after 15 minutes. Routes are admin configuration. An open alert past its wait goes to the
-- backup role once and shows as escalated; an acknowledged one never escalates. A route applies to alerts raised after it is set,
-- a notice that could not be queued is retried, and the test-account sandbox holds for escalation too.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
grant execute on function pg_temp.denied(text) to authenticated,service_role;
create function pg_temp.told(p_alert uuid)returns text language sql as $$
 select coalesce(string_agg(w.role,',' order by w.role),'')from public.care_alert_deliveries d join public.workspace_staff w on w.user_id=d.recipient_id where d.alert_id=p_alert
$$;
grant execute on function pg_temp.told(uuid) to authenticated,service_role;

-- Admin A, doctor D, nurse N; members M and M3 (D and N), member M2 (D, no nurse).
insert into auth.users(id,phone,phone_confirmed_at)values
 ('ea000000-0000-4000-8000-000000000001','37499017001',now()),('ea000000-0000-4000-8000-000000000002','37499017002',now()),('ea000000-0000-4000-8000-000000000003','37499017003',now()),
 ('ea000000-0000-4000-8000-000000000011',null,null),('ea000000-0000-4000-8000-000000000012',null,null),('ea000000-0000-4000-8000-000000000013',null,null);
insert into public.workspace_clinics(id,name)values('ea000000-0000-4000-8000-000000000020','Synthetic escalation clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('ea000000-0000-4000-8000-000000000011','doctor','Dr Escalation','ea000000-0000-4000-8000-000000000020'),
 ('ea000000-0000-4000-8000-000000000012','nurse','Nurse Escalation','ea000000-0000-4000-8000-000000000020');
insert into public.workspace_staff(user_id,role,display_name)values('ea000000-0000-4000-8000-000000000013','admin','Admin Escalation');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('ea000000-0000-4000-8000-000000000031','ea000000-0000-4000-8000-000000000011',now(),now()),('ea000000-0000-4000-8000-000000000032','ea000000-0000-4000-8000-000000000012',now(),now()),
 ('ea000000-0000-4000-8000-000000000033','ea000000-0000-4000-8000-000000000013',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('ea000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000012'),
 ('ea000000-0000-4000-8000-000000000002','ea000000-0000-4000-8000-000000000011',null),
 ('ea000000-0000-4000-8000-000000000003','ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000012');
insert into public.care_alert_settings(singleton,enabled,telegram_delivery)values(true,true,true)on conflict(singleton)do update set enabled=true,telegram_delivery=true;
select public._telegram_auth_bind('ea000000-0000-4000-8000-000000000011','staff','["telegram","noreon_alert",9101,"user",8701]','["telegram","noreon_alert",9101]','+37499017011','8701',null);
select public._telegram_auth_bind('ea000000-0000-4000-8000-000000000012','staff','["telegram","noreon_alert",9102,"user",8702]','["telegram","noreon_alert",9102]','+37499017012','8702',null);
-- Start from the default route, whatever the database held.
delete from public.care_alert_routing;insert into public.care_alert_routing(source)values('*');

-- 1. The default route tells the nurse first, or the doctor immediately when no nurse is assigned.
select pg_temp.ok((select primary_role='nurse'and backup_role='doctor'and escalate_after_minutes=15 from public._care_alert_route('zoe')),'Default route: nurse, doctor backup, 15 minutes');
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ea000000-0000-4000-8000-000000000001','zoe','zoe-esc-1','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test');
select public.care_alert_screen('ea000000-0000-4000-8000-000000000002','zoe','zoe-esc-2','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test');
reset role;
select pg_temp.ok(pg_temp.told((select id from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000001'and source='zoe'))='nurse','Default: the assigned nurse is told first');
select pg_temp.ok(pg_temp.told((select id from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000002'and source='zoe'))='doctor','A member with no nurse tells the doctor only');

-- 2. Configuration is admin only and refuses nonsense.
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied($$select public.care_alert_routing_set('lab','nurse')$$),'A doctor cannot change the routing');
select pg_temp.ok(pg_temp.denied($$select public.care_alert_routing_read()$$),'A doctor cannot read the routing');
reset role;
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000013','ea000000-0000-4000-8000-000000000033');set local role authenticated;
select pg_temp.ok(public.care_alert_routing_set('x','both')->>'code'='invalid','Unknown source refused');
select pg_temp.ok(public.care_alert_routing_set('lab','both','nurse',0)->>'code'='invalid','Zero minutes refused');
select pg_temp.ok(public.care_alert_routing_set('lab','doctor','nurse')->>'code'='invalid','A backup needs a wait');
select pg_temp.ok(public.care_alert_routing_set('lab','doctor',null,20)->>'code'='invalid','A wait needs a backup');
select pg_temp.ok(public.care_alert_routing_set('lab','doctor','doctor',20)->>'code'='invalid','The backup cannot be the primary');
select pg_temp.ok(public.care_alert_routing_set('lab','both','nurse',20)->>'code'='invalid','A backup is not for a primary that already tells both');
select pg_temp.ok(public.care_alert_routing_set('zoe','nurse')->>'ok'='true','An admin sets Zoe alerts to the nurse');
select pg_temp.ok(public.care_alert_routing_set('lab','doctor','nurse',30)->>'ok'='true','An admin sets lab alerts: doctor first, nurse after 30 minutes');
select pg_temp.ok((select count(*)=3 from jsonb_array_elements(public.care_alert_routing_read()->'routes'))and public.care_alert_routing_read()#>>'{routes,0,source}'='*','Read lists the default row first');
reset role;

-- 3. The route decides who is told first.
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ea000000-0000-4000-8000-000000000003','zoe','zoe-esc-3','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test');
select public.care_alert_screen('ea000000-0000-4000-8000-000000000003','lab','lab-esc-3','escalate','lab_result_critical','{}','care_alert.critical_lab','q3-test');
reset role;
select pg_temp.ok(pg_temp.told((select id from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000003'and source='zoe'))='nurse','Zoe route nurse: only the nurse is told first');
select pg_temp.ok(pg_temp.told((select id from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000003'and source='lab'))='doctor','Lab route doctor first: only the doctor is told first');

-- 4. Escalation: not before the wait, once after it, to the backup, visible in the lists.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.care_alert_escalate_due()->>'raised')::int=0,'Nothing is due before the wait');
reset role;
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '31 minutes' where member_id='ea000000-0000-4000-8000-000000000003' and source='lab';
-- The route changes while the alert is in flight: it keeps the route it started with, so the backup is still owed.
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000013','ea000000-0000-4000-8000-000000000033');set local role authenticated;
select public.care_alert_routing_set('lab','both');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.care_alert_escalate_due()->>'raised')::int=1,'The open lab alert escalates after 30 minutes, even though the route was changed since');
select pg_temp.ok((public.care_alert_escalate_due()->>'raised')::int=0,'It escalates once');
reset role;
select pg_temp.ok((select escalated_to='nurse' and escalated_at is not null and escalation_notified_at is not null from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000003' and source='lab'),'Marked escalated to the backup, and the backup was told');
select pg_temp.ok(pg_temp.told((select id from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000003' and source='lab'))='doctor,nurse','The backup is told, the doctor already was');
select pg_temp.ok(exists(select 1 from public.care_alert_audit where kind='escalated' and detail->>'to'='nurse'),'Escalation is audited');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='care_alert.escalated' and member_id='ea000000-0000-4000-8000-000000000003'),'Escalation is journaled');
select pg_temp.ok(not exists(select 1 from public.care_alerts where source='zoe' and escalated_at is not null),'A route without a backup never escalates');
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.care_alert_inbox('live',50)->'alerts')a where a->>'escalatedAt' is not null and a->>'source'='lab'),'The doctor list shows the alert as escalated');
reset role;

-- 5. An acknowledged alert does not escalate; reopening starts a new cycle with the wait counted again.
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000013','ea000000-0000-4000-8000-000000000033');set local role authenticated;
select public.care_alert_routing_set('lab','doctor','nurse',30);
reset role;
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ea000000-0000-4000-8000-000000000002','lab','lab-esc-2','escalate','lab_result_critical','{}','care_alert.critical_lab','q3-test');
reset role;
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '40 minutes' where member_id='ea000000-0000-4000-8000-000000000002' and source='lab';
create temp table ack as select id,state_seq from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000002' and source='lab';
grant select on ack to authenticated;
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000031');set local role authenticated;
select public.care_alert_acknowledge(id,state_seq)from ack;
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.care_alert_escalate_due()->>'raised')::int=0,'An acknowledged alert does not escalate');
select public.care_alert_screen('ea000000-0000-4000-8000-000000000002','lab','lab-esc-2b','escalate','lab_result_critical','{}','care_alert.critical_lab','q3-test');
reset role;
select pg_temp.ok((select state='open' and escalated_at is null and cycle_started_at>clock_timestamp()-interval '1 minute' from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000002' and source='lab'),'Reopened: a new cycle, nothing escalated yet');
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '31 minutes',last_seen_at=clock_timestamp() where member_id='ea000000-0000-4000-8000-000000000002' and source='lab';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.care_alert_escalate_due()->>'raised')::int=1,'A reopened alert escalates after the new wait, whatever its last activity');
reset role;

-- 6. A notice that cannot be queued is retried, not lost: delivery off, then on.
update public.care_alert_settings set telegram_delivery=false;
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000013','ea000000-0000-4000-8000-000000000033');set local role authenticated;
select public.care_alert_routing_set('zoe','doctor','nurse',30);
reset role;
update public.care_alerts set state='resolved',resolved_at=clock_timestamp(),resolved_by='ea000000-0000-4000-8000-000000000011',resolution='no_action_needed',acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),acknowledged_by=coalesce(acknowledged_by,'ea000000-0000-4000-8000-000000000011') where member_id='ea000000-0000-4000-8000-000000000001' and source='zoe';
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ea000000-0000-4000-8000-000000000001','zoe','zoe-esc-1c','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test');
reset role;
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '31 minutes' where member_id='ea000000-0000-4000-8000-000000000001' and source='zoe' and state='open';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.care_alert_escalate_due()->>'raised')::int=1,'Escalated while delivery is off');
reset role;
select pg_temp.ok((select escalated_at is not null and escalation_notified_at is null from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000001' and source='zoe' and state='open'),'Delivery off: escalated, backup not yet told, still pending');
update public.care_alert_settings set telegram_delivery=true;
select pg_temp.as_service();set local role service_role;
select public.care_alert_escalate_due();
reset role;
select pg_temp.ok((select escalation_notified_at is not null from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000001' and source='zoe' and state='open') and pg_temp.told((select id from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000001' and source='zoe' and state='open')) like '%nurse%','Delivery restored: the backup is told by the next sweep');

-- 7. The test-account sandbox holds for escalation: no notice, even to staff who may see test members.
update public.profiles set is_test_account=true where id='ea000000-0000-4000-8000-000000000003';
update public.care_alert_settings set sandbox_test_accounts=true;
update public.care_alerts set state='resolved',resolved_at=clock_timestamp(),resolved_by='ea000000-0000-4000-8000-000000000011',resolution='no_action_needed',acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),acknowledged_by=coalesce(acknowledged_by,'ea000000-0000-4000-8000-000000000011') where member_id='ea000000-0000-4000-8000-000000000003' and source='zoe';
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ea000000-0000-4000-8000-000000000003','zoe','zoe-esc-3b','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test');
reset role;
delete from public.care_alert_deliveries where alert_id in(select id from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000003' and source='zoe');
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '31 minutes' where member_id='ea000000-0000-4000-8000-000000000003' and source='zoe' and state='open';
select pg_temp.as_service();set local role service_role;
select public.care_alert_escalate_due();
reset role;
select pg_temp.ok((select count(*)=0 from public.care_alert_deliveries d join public.care_alerts a on a.id=d.alert_id where a.member_id='ea000000-0000-4000-8000-000000000003' and a.source='zoe' and a.state='open'),'Sandbox: a test member alert queues no notice, escalation included');

-- 7b. The first notice follows the route the alert started with: delivery off, route changed, delivery on, a repeat: the original primary is told.
insert into auth.users(id)values('ea000000-0000-4000-8000-000000000004');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('ea000000-0000-4000-8000-000000000004','ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000012');
update public.care_alert_settings set telegram_delivery=false,sandbox_test_accounts=false;
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000013','ea000000-0000-4000-8000-000000000033');set local role authenticated;
select public.care_alert_routing_set('zoe','nurse','doctor',30);
reset role;
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ea000000-0000-4000-8000-000000000004','zoe','zoe-esc-4','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test');
reset role;
create temp table cyc as select cycle_started_at c from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000004' and source='zoe';
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000013','ea000000-0000-4000-8000-000000000033');set local role authenticated;
select public.care_alert_routing_set('zoe','doctor');
reset role;
update public.care_alert_settings set telegram_delivery=true;
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ea000000-0000-4000-8000-000000000004','zoe','zoe-esc-4b','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test');
reset role;
select pg_temp.ok(pg_temp.told((select id from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000004' and source='zoe'))='nurse','The original primary (nurse) is told by the repeat, not the new route');
select pg_temp.ok((select a.cycle_started_at=c.c and a.occurrences=2 from public.care_alerts a,cyc c where a.member_id='ea000000-0000-4000-8000-000000000004' and a.source='zoe'),'The repeat does not move the cycle');

-- 7c. Retries are fair: 200 older escalations nobody can be told about do not keep a newer deliverable one waiting.
insert into auth.users(id)select ('eb000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid from generate_series(1,200)g;
insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref)select ('eb000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'lab','lab_result_critical','care_alert.critical_lab','q3-test','lab-bulk-'||g from generate_series(1,200)g;
update public.care_alerts set route_backup='nurse',route_minutes=30,escalated_at=clock_timestamp()-interval '3 hours',escalated_to='nurse',escalation_notified_at=null,escalation_attempted_at=null where member_id::text like 'eb000000%';
insert into auth.users(id)values('ea000000-0000-4000-8000-000000000005');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('ea000000-0000-4000-8000-000000000005','ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000012');
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ea000000-0000-4000-8000-000000000005','lab','lab-esc-5','escalate','lab_result_critical','{}','care_alert.critical_lab','q3-test');
reset role;
update public.care_alerts set route_backup='nurse',route_minutes=30,escalated_at=clock_timestamp()-interval '1 hour',escalated_to='nurse',escalation_notified_at=null,escalation_attempted_at=null where member_id='ea000000-0000-4000-8000-000000000005' and source='lab';
select pg_temp.as_service();set local role service_role;
select public.care_alert_escalate_due();select public.care_alert_escalate_due();
reset role;
select pg_temp.ok((select escalation_notified_at is not null from public.care_alerts where member_id='ea000000-0000-4000-8000-000000000005' and source='lab'),'The newer deliverable notice is queued within two sweeps');
select pg_temp.ok((select count(*)=200 from public.care_alerts where member_id::text like 'eb000000%' and escalation_notified_at is null and escalation_attempted_at is not null),'The undeliverable ones stay pending, tried and rotated');

-- 8. Only the service role sweeps.
select pg_temp.as_staff('ea000000-0000-4000-8000-000000000013','ea000000-0000-4000-8000-000000000033');set local role authenticated;
select pg_temp.ok(pg_temp.denied($$select public.care_alert_escalate_due()$$),'Only the service role runs the sweep');
reset role;
rollback;
select 'care alert escalation ok';
