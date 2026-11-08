-- Assigned nurse ownership and actions. Run after all migrations; every fixture rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(v boolean,label text)returns void language plpgsql as $$begin
 if v is not true then raise exception 'Nurse alert check failed: %',label;end if;end$$;
create function pg_temp.as_staff(who integer)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',('ed000000-0000-4000-8000-'||lpad(who::text,12,'0')),
 'session_id',('ed000000-0000-4000-9000-'||lpad(who::text,12,'0')),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
insert into auth.users(id)select ('ed000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid from unnest(array[1,2,3,11,12,13,14])g;
insert into public.workspace_clinics(id,name)values('ed000000-0000-4000-8000-000000000020','Synthetic nurse alert clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('ed000000-0000-4000-8000-000000000011','doctor','Doctor Owner','ed000000-0000-4000-8000-000000000020'),
 ('ed000000-0000-4000-8000-000000000012','nurse','Nurse Owner','ed000000-0000-4000-8000-000000000020'),
 ('ed000000-0000-4000-8000-000000000013','nurse','Unrelated Nurse','ed000000-0000-4000-8000-000000000020'),
 ('ed000000-0000-4000-8000-000000000014','nurse','No Assignment Nurse','ed000000-0000-4000-8000-000000000020');
insert into auth.sessions(id,user_id,created_at,updated_at)
 select ('ed000000-0000-4000-9000-'||lpad(g::text,12,'0'))::uuid,('ed000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,now(),now()from generate_series(11,14)g;
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values
 ('ed000000-0000-4000-8000-000000000001','ed000000-0000-4000-8000-000000000011','ed000000-0000-4000-8000-000000000012'),
 ('ed000000-0000-4000-8000-000000000002','ed000000-0000-4000-8000-000000000011','ed000000-0000-4000-8000-000000000013'),
 ('ed000000-0000-4000-8000-000000000003','ed000000-0000-4000-8000-000000000011',null);
insert into public.care_alert_settings(singleton,enabled,telegram_delivery)values(true,true,false)
 on conflict(singleton)do update set enabled=true,telegram_delivery=false;
delete from public.care_alert_routing;
insert into public.care_alert_routing(source)values('*');
select pg_temp.ok((select primary_role='nurse'and backup_role='doctor'and escalate_after_minutes=15 from public._care_alert_route('zoe')),'Default route');
insert into public.care_alerts(id,member_id,doctor_id,source,reason_code,rule_id,rule_version,source_ref)
 select ('ed000000-0000-4000-8100-'||lpad(g::text,12,'0'))::uuid,('ed000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
 'ed000000-0000-4000-8000-000000000011','zoe','urgent_words_matched','zoe.urgent_lexicon','test','nurse-test-'||g from generate_series(1,3)g;
-- Urgent Resolve prefill: scoped, read-only evidence and one named close from open.
-- Kept in this rolled-back fixture so the existing assignment/session setup is identical.
savepoint resolve_prefill;
insert into public.conversations(id,member_id)values
 ('ed000000-0000-4000-8200-000000000001','ed000000-0000-4000-8000-000000000001'),
 ('ed000000-0000-4000-8200-000000000002','ed000000-0000-4000-8000-000000000002');
insert into public.conversation_nurse_replies(conversation_id,nurse_id,nurse_name,doctor_id,request_id,context_version,body,created_at)values
 ('ed000000-0000-4000-8200-000000000001','ed000000-0000-4000-8000-000000000012','Nurse Owner','ed000000-0000-4000-8000-000000000011',gen_random_uuid(),0,'Synthetic recorded reply',clock_timestamp()),
 ('ed000000-0000-4000-8200-000000000001','ed000000-0000-4000-8000-000000000012','Nurse Owner','ed000000-0000-4000-8000-000000000011',gen_random_uuid(),0,'Older reply',clock_timestamp()-interval '1 day'),
 ('ed000000-0000-4000-8200-000000000002','ed000000-0000-4000-8000-000000000013','Unrelated Nurse','ed000000-0000-4000-8000-000000000011',gen_random_uuid(),0,'Other member reply',clock_timestamp()+interval '1 second');
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000002')->>'code'='not_found','Prefill cannot read another nurse member');
select pg_temp.ok(jsonb_array_length(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')#>'{record,contacts}')=1,'Prefill includes only this member reply after alert onset');
select pg_temp.ok(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')#>>'{record,closer}'='Nurse Owner','Prefill closer comes from active actor, not alert owner');
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',99,'member_contacted','Synthetic reason')->>'code'='changed','Open Resolve preserves sequence guard');
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',0,'member_contacted',E' \t\n')->>'code'='invalid','Open Resolve still requires a reason');
reset role;
select pg_temp.ok((select state='open'and state_seq=0 and acknowledged_by is null from public.care_alerts where id='ed000000-0000-4000-8100-000000000001'),'Read and rejected closes do not change alert');
select pg_temp.ok(not exists(select 1 from public.care_alert_audit where alert_id='ed000000-0000-4000-8100-000000000001'and kind in('acknowledged','resolved')),'No write from prefill or rejected closes');
-- Acknowledge, then contact, then reopen through the real raise path and cycle trigger.
-- The original creation time and old acknowledger remain on the alert.
savepoint resolve_prefill_cycle;
update public.care_alerts set resolution_note='PRIVATE PREVIOUS ALERT RESOLUTION NOTE'where id='ed000000-0000-4000-8100-000000000001';
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(public.care_alert_acknowledge('ed000000-0000-4000-8100-000000000001',0)->>'ok'='true','Acknowledge before contact and reopening');
reset role;
insert into public.conversation_nurse_replies(conversation_id,nurse_id,nurse_name,doctor_id,request_id,context_version,body,created_at)values
 ('ed000000-0000-4000-8200-000000000001','ed000000-0000-4000-8000-000000000012','Nurse Owner','ed000000-0000-4000-8000-000000000011',gen_random_uuid(),0,'PRIVATE PRE-REOPENING REPLY',clock_timestamp());
insert into public.conversation_messages(id,conversation_id,seq,author_id,body,source,request_id)values
 ('ed000000-0000-4000-8300-000000000001','ed000000-0000-4000-8200-000000000001',1,'ed000000-0000-4000-8000-000000000001','PRIVATE SOURCE MESSAGE','authenticated_member',gen_random_uuid());
insert into public.care_alert_screenings(source,source_ref,member_id,outcome,reason_code,rule_id,rule_version,alert_id)values
 ('message','ed000000-0000-4000-8300-000000000001','ed000000-0000-4000-8000-000000000001','escalate','urgent_words_matched','test','test','ed000000-0000-4000-8100-000000000001');
insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id,origin)values
 ('ed000000-0000-4000-8400-000000000001','ed000000-0000-4000-8000-000000000001','contact-followup','Synthetic doctor handover','PRIVATE DOCTOR HANDOVER INSTRUCTIONS','ed000000-0000-4000-8000-000000000011','ed000000-0000-4000-8000-000000000012','doctor_handover'),
 ('ed000000-0000-4000-8400-000000000002','ed000000-0000-4000-8000-000000000001','doctor-referral','Synthetic source-linked task','PRIVATE TASK INSTRUCTIONS','ed000000-0000-4000-8000-000000000012','ed000000-0000-4000-8000-000000000011','nurse_handoff');
insert into public.conversation_nurse_handoffs(task_id,conversation_id,message_id,message_text,context_version,nurse_id,nurse_name,request_id,topic,observation)values
 ('ed000000-0000-4000-8400-000000000002','ed000000-0000-4000-8200-000000000001','m1','PRIVATE SOURCE MESSAGE',0,'ed000000-0000-4000-8000-000000000012','Nurse Owner',gen_random_uuid(),'member-request','PRIVATE HANDOFF OBSERVATION');
insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,note,detail,created_at)values
 ('ed000000-0000-4000-8400-000000000001',1,gen_random_uuid(),'ed000000-0000-4000-8000-000000000011','Doctor Owner','doctor','create','open','ed000000-0000-4000-8000-000000000012','','{"input":{"instructions":"PRIVATE DOCTOR HANDOVER INSTRUCTIONS"}}',clock_timestamp()),
 ('ed000000-0000-4000-8400-000000000001',2,gen_random_uuid(),'ed000000-0000-4000-8000-000000000011','Doctor Owner','doctor','resolve','completed','ed000000-0000-4000-8000-000000000012','PRIVATE OTHER STAFF RESOLUTION NOTE','{}',clock_timestamp()),
 ('ed000000-0000-4000-8400-000000000002',1,gen_random_uuid(),'ed000000-0000-4000-8000-000000000011','Doctor Owner','doctor','contact','awaiting-doctor','ed000000-0000-4000-8000-000000000011','PRIVATE CONTACT NOTE','{"input":{"outcome":"reached","note":"PRIVATE CONTACT DETAIL"}}',clock_timestamp());
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')#>'{record,contacts}')=3,'Current-cycle replies and source-linked reached contact qualify');
select pg_temp.ok(not(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')->'record'?'notes'),'Prefill exposes no notes collection');
select pg_temp.ok(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')::text not like '%PRIVATE%','Reader excludes instructions, staff notes, previous resolution notes, contact notes and message bodies');
reset role;
select pg_temp.ok(public._care_alert_raise('ed000000-0000-4000-8000-000000000001','zoe','urgent_words_matched','{}','zoe.urgent_lexicon','test','prefill-reopen')='ed000000-0000-4000-8100-000000000001'::uuid,'Repeat reopens the existing acknowledged alert');
select pg_temp.ok((select state='open'and state_seq=2 and cycle_started_at>acknowledged_at and cycle_started_at>created_at
 from public.care_alerts where id='ed000000-0000-4000-8100-000000000001'),'Reopening starts a new cycle without changing original onset');
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')#>'{record,contacts}')=0,'Reader excludes every pre-reopening reply and reached contact');
reset role;
select pg_temp.ok((select (public.care_alert_resolution_record(a.id)#>>'{record,cycleStartedAt}')::timestamptz=a.cycle_started_at
 from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000001'),'Reader carries the actual current cycle onset');
insert into public.conversation_nurse_replies(conversation_id,nurse_id,nurse_name,doctor_id,request_id,context_version,body,created_at)values
 ('ed000000-0000-4000-8200-000000000001','ed000000-0000-4000-8000-000000000012','Nurse Owner','ed000000-0000-4000-8000-000000000011',gen_random_uuid(),0,'PRIVATE NEW-CYCLE REPLY',clock_timestamp());
insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,note,detail,created_at)values
 ('ed000000-0000-4000-8400-000000000002',2,gen_random_uuid(),'ed000000-0000-4000-8000-000000000011','Doctor Owner','doctor','contact','awaiting-doctor','ed000000-0000-4000-8000-000000000011','PRIVATE NEW-CYCLE CONTACT NOTE','{"input":{"outcome":"reached"}}',clock_timestamp());
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')#>'{record,contacts}')=2,'Only post-reopening reply and reached contact qualify again');
select pg_temp.ok(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')::text not like '%PRIVATE%','New-cycle evidence still contains no free text');
reset role;
rollback to resolve_prefill_cycle;
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',0,'member_contacted','Synthetic reason')->>'ok'='true','Owner can resolve open alert in one command');
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',0,'member_contacted','Synthetic reason')->>'changed'='false','Repeated confirmation is idempotent');
reset role;
select pg_temp.ok((select state='resolved'and state_seq=1 and acknowledged_by=resolved_by and resolved_by='ed000000-0000-4000-8000-000000000012'and resolution='member_contacted'and resolution_note='Synthetic reason'and acknowledged_at is not null and resolved_at is not null from public.care_alerts where id='ed000000-0000-4000-8100-000000000001'),'Named person, reason, outcome and time are retained');
select pg_temp.ok((select count(*)=2 and count(distinct actor_id)=1 and bool_and(actor_id='ed000000-0000-4000-8000-000000000012')from public.care_alert_audit where alert_id='ed000000-0000-4000-8100-000000000001'and kind in('acknowledged','resolved')),'Exactly two audit rows for one open Resolve by the same person');
select pg_temp.as_staff(14);set local role authenticated;
select pg_temp.ok(public.care_alert_resolution_record('ed000000-0000-4000-8100-000000000001')->>'code'='not_found','Unassigned nurse cannot read prefill');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.care_alert_resolution_record(uuid)','execute')and not has_function_privilege('service_role','public.care_alert_resolution_record(uuid)','execute'),'No anon or service evidence read');
rollback to resolve_prefill;

-- A repeat reopens an acknowledged row; a resolved row stays terminal and the
-- next raise creates a different alert. Cover both paths, without forging state.
savepoint reopened_resolve;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin
 execute sql;return false;exception when insufficient_privilege then return true;end$$;
grant execute on function pg_temp.denied(text),pg_temp.ok(boolean,text) to authenticated,anon,service_role;
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(public.care_alert_acknowledge('ed000000-0000-4000-8100-000000000001',0)->>'changed'='true','Nurse A acknowledges cycle 1');
reset role;
create temp table resolve_cycle_before as
 select a.acknowledged_at,a.cycle_started_at,
  (select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e where e.alert_id=a.id) audit,
  (select max(e.id)from public.care_alert_audit e where e.alert_id=a.id) last_audit_id
 from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000001';
select pg_temp.ok(public._care_alert_raise('ed000000-0000-4000-8000-000000000001','zoe','urgent_words_matched','{}','zoe.urgent_lexicon','test','resolve-reopen')='ed000000-0000-4000-8100-000000000001'::uuid,'Real repeat reopens cycle 2 on the same alert');
select pg_temp.ok((select a.state='open'and a.state_seq=2 and a.cycle_started_at>b.cycle_started_at
 and a.acknowledged_by='ed000000-0000-4000-8000-000000000012'and a.acknowledged_at=b.acknowledged_at
 from public.care_alerts a cross join resolve_cycle_before b where a.id='ed000000-0000-4000-8100-000000000001'),'Reopened cycle retains the old acknowledger and time until someone acts');
savepoint open_cycle_2;
-- Every refused direct close must leave the open cycle and its audit unchanged.
create temp table refused_resolve_before as
 select to_jsonb(a) alert,(select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e where e.alert_id=a.id) audit
 from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000001';
select pg_temp.as_staff(13);set local role authenticated;
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'other','Synthetic refused close')->>'code'='not_found','Another nurse cannot resolve unacknowledged cycle 2');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at)values('ed000000-0000-4000-9000-000000000001','ed000000-0000-4000-8000-000000000001',now(),now());
select pg_temp.as_staff(1);set local role authenticated;
select pg_temp.ok(pg_temp.denied($q$select public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'other','Synthetic refused close')$q$),'Nonstaff cannot resolve unacknowledged cycle 2');
reset role;
select set_config('request.jwt.claims','{"role":"anon"}',true);set local role anon;
select pg_temp.ok(pg_temp.denied($q$select public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'other','Synthetic refused close')$q$),'Anon cannot resolve unacknowledged cycle 2');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(pg_temp.denied($q$select public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'other','Synthetic refused close')$q$),'Service role cannot resolve unacknowledged cycle 2');
reset role;
select pg_temp.ok((select to_jsonb(a)=b.alert
 and(select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e where e.alert_id=a.id)=b.audit
 from public.care_alerts a cross join refused_resolve_before b where a.id='ed000000-0000-4000-8100-000000000001'),'Refused closes leave no acknowledgement, resolution or other mutation');

-- This catches the former coalesce: the cycle-2 doctor must replace nurse A.
create temp table resolve_call_window as select clock_timestamp() started_at;
select pg_temp.as_staff(11);set local role authenticated;
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'emergency_care_advised','Synthetic cycle 2 reason')->>'changed'='true','Assigned doctor resolves reopened cycle without acknowledging separately');
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'emergency_care_advised','Synthetic cycle 2 reason')->>'changed'='false','Reopened resolution retry is a no-op');
reset role;
select pg_temp.ok((select a.state='resolved'and a.state_seq=3
 and a.acknowledged_by='ed000000-0000-4000-8000-000000000011'and a.resolved_by=a.acknowledged_by
 and a.acknowledged_at>b.acknowledged_at and a.acknowledged_at>=w.started_at
 and a.acknowledged_at>=a.cycle_started_at and a.resolved_at>=a.acknowledged_at and a.resolved_at<=clock_timestamp()
 and a.resolution='emergency_care_advised'and a.resolution_note='Synthetic cycle 2 reason'
 from public.care_alerts a cross join resolve_cycle_before b cross join resolve_call_window w
 where a.id='ed000000-0000-4000-8100-000000000001'),'Reopened resolution records the current resolver, time, outcome and reason');
select pg_temp.ok((select count(*)=2 and count(*)filter(where e.kind='acknowledged')=1 and count(*)filter(where e.kind='resolved')=1
 and bool_and(e.actor_id is not distinct from 'ed000000-0000-4000-8000-000000000011'::uuid and e.detail->>'role'is not distinct from 'doctor')
 from public.care_alert_audit e cross join resolve_cycle_before b
 where e.alert_id='ed000000-0000-4000-8100-000000000001'and e.id>b.last_audit_id and e.kind in('acknowledged','resolved')),'Exactly one new acknowledgement and resolution, both by the cycle-2 doctor');
select pg_temp.ok((select ack.detail->>'via'='resolve'and ack.actor_id=a.resolved_by and done.actor_id=a.resolved_by
 and ack.xmin=done.xmin and done.xmin=a.xmin
 and ack.created_at>=w.started_at and ack.created_at<=a.acknowledged_at and done.created_at>=a.resolved_at
 from public.care_alerts a
 join public.care_alert_audit ack on ack.alert_id=a.id and ack.kind='acknowledged'
 join public.care_alert_audit done on done.alert_id=a.id and done.kind='resolved'
 cross join resolve_cycle_before b cross join resolve_call_window w
 where a.id='ed000000-0000-4000-8100-000000000001'and ack.id>b.last_audit_id and done.id>b.last_audit_id),'Acknowledgement and resolution are written in the same transaction as the alert');
select pg_temp.ok((select(select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e
 where e.alert_id='ed000000-0000-4000-8100-000000000001'and e.id<=b.last_audit_id)=b.audit from resolve_cycle_before b),'Cycle-1 audit rows are untouched by direct reopened resolution');
rollback to open_cycle_2;

-- If nurse A explicitly acknowledges the new cycle, the doctor must preserve it.
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(public.care_alert_acknowledge('ed000000-0000-4000-8100-000000000001',2)->>'changed'='true','Nurse A explicitly acknowledges cycle 2');
reset role;
create temp table acknowledged_cycle_2 as
 select a.acknowledged_by,a.acknowledged_at,(select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e where e.alert_id=a.id and e.kind='acknowledged') audit
 from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000001';
select pg_temp.ok((select a.acknowledged_at>b.acknowledged_at from acknowledged_cycle_2 a cross join resolve_cycle_before b),'Explicit cycle-2 acknowledgement has a fresh time');
select pg_temp.as_staff(11);set local role authenticated;
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',3,'member_contacted','Synthetic acknowledged cycle 2')->>'changed'='true','Doctor resolves already acknowledged cycle 2');
reset role;
select pg_temp.ok((select a.state='resolved'and a.state_seq=4 and a.acknowledged_by=b.acknowledged_by
 and a.acknowledged_by='ed000000-0000-4000-8000-000000000012'and a.acknowledged_at=b.acknowledged_at
 and a.resolved_by='ed000000-0000-4000-8000-000000000011'and a.resolution='member_contacted'and a.resolution_note='Synthetic acknowledged cycle 2'
 and(select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e where e.alert_id=a.id and e.kind='acknowledged')=b.audit
 from public.care_alerts a cross join acknowledged_cycle_2 b where a.id='ed000000-0000-4000-8100-000000000001'),'Already acknowledged cycle keeps nurse A and time with no extra acknowledgement row');
select pg_temp.ok((select count(*)=2 and count(*)filter(where e.kind='acknowledged')=1 and count(*)filter(where e.kind='resolved')=1
 from public.care_alert_audit e cross join resolve_cycle_before b
 where e.alert_id='ed000000-0000-4000-8100-000000000001'and e.id>b.last_audit_id and e.kind in('acknowledged','resolved')),'Explicit cycle-2 acknowledgement and resolution are each audited once');
select pg_temp.ok((select(select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e
 where e.alert_id='ed000000-0000-4000-8100-000000000001'and e.id<=b.last_audit_id)=b.audit from resolve_cycle_before b),'Cycle-1 audit rows are untouched by already acknowledged resolution');
rollback to reopened_resolve;

-- A completed cycle is immutable: real new information raises a different row.
savepoint resolved_then_raised;
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(public.care_alert_acknowledge('ed000000-0000-4000-8100-000000000001',0)->>'changed'='true','Nurse A acknowledges before closing cycle 1');
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',1,'member_contacted','Synthetic cycle 1 reason')->>'changed'='true','Nurse A resolves cycle 1');
reset role;
create temp table closed_cycle_1 as
 select to_jsonb(a) alert,(select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e where e.alert_id=a.id) audit
 from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000001';
create temp table fresh_cycle_2 as select public._care_alert_raise('ed000000-0000-4000-8000-000000000001','zoe','urgent_words_matched','{}','zoe.urgent_lexicon','test','resolve-after-closed') id;
grant select on fresh_cycle_2 to authenticated;
select pg_temp.ok((select a.id<>'ed000000-0000-4000-8100-000000000001'::uuid and a.state='open'and a.state_seq=0 and a.acknowledged_by is null and a.acknowledged_at is null
 from public.care_alerts a join fresh_cycle_2 b on b.id=a.id),'After a resolved cycle, the real raise path creates a fresh unacknowledged alert');
select pg_temp.as_staff(11);set local role authenticated;
select pg_temp.ok(public.care_alert_resolve(id,0,'other','Synthetic fresh cycle 2')->>'changed'='true','Doctor directly resolves new alert after completed cycle')from fresh_cycle_2;
reset role;
select pg_temp.ok((select a.state='resolved'and a.state_seq=1 and a.acknowledged_by='ed000000-0000-4000-8000-000000000011'and a.resolved_by=a.acknowledged_by
 and a.acknowledged_at>=a.cycle_started_at and a.resolved_at>=a.acknowledged_at and a.resolution='other'and a.resolution_note='Synthetic fresh cycle 2'
 from public.care_alerts a join fresh_cycle_2 b on b.id=a.id),'Fresh alert names the cycle-2 doctor, outcome, reason and times');
select pg_temp.ok((select count(*)=2 and count(*)filter(where e.kind='acknowledged')=1 and count(*)filter(where e.kind='resolved')=1
 and bool_and(e.actor_id is not distinct from 'ed000000-0000-4000-8000-000000000011'::uuid)
 from public.care_alert_audit e join fresh_cycle_2 b on b.id=e.alert_id where e.kind in('acknowledged','resolved')),'Fresh alert acknowledges and resolves exactly once');
select pg_temp.ok((select to_jsonb(a)=b.alert and(select jsonb_agg(to_jsonb(e)order by e.id)from public.care_alert_audit e where e.alert_id=a.id)=b.audit
 from public.care_alerts a cross join closed_cycle_1 b where a.id='ed000000-0000-4000-8100-000000000001'),'Completed cycle-1 alert and all its audits stay untouched');
rollback to resolved_then_raised;

select pg_temp.ok((select public._care_alert_json(a)->>'ownerName'='Nurse Owner'and public._care_alert_json(a)->>'ownerRole'='nurse'from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000001'),'Assigned nurse owns');
select pg_temp.ok((select public._care_alert_json(a)->>'ownerName'='Doctor Owner'and public._care_alert_json(a)->>'ownerRole'='doctor'from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000003'),'No nurse falls back to doctor');
-- Primary delivery uses the nurse; a member with no nurse is sent to the doctor immediately.
select public._telegram_auth_bind('ed000000-0000-4000-8000-000000000011','staff','["telegram","noreon_alert",9401,"user",8901]','["telegram","noreon_alert",9401]','+37499018011','8901',null);
select public._telegram_auth_bind('ed000000-0000-4000-8000-000000000012','staff','["telegram","noreon_alert",9402,"user",8902]','["telegram","noreon_alert",9402]','+37499018012','8902',null);
update public.care_alert_settings set telegram_delivery=true;
select public._care_alert_notify(a)from public.care_alerts a where a.id in('ed000000-0000-4000-8100-000000000001','ed000000-0000-4000-8100-000000000003');
select pg_temp.ok((select count(*)=1 and bool_and(recipient_id='ed000000-0000-4000-8000-000000000012')from public.care_alert_deliveries where alert_id='ed000000-0000-4000-8100-000000000001'and recipient_id in('ed000000-0000-4000-8000-000000000011','ed000000-0000-4000-8000-000000000012')),'Nurse receives primary notice');
select pg_temp.ok((select count(*)=1 and bool_and(recipient_id='ed000000-0000-4000-8000-000000000011')from public.care_alert_deliveries where alert_id='ed000000-0000-4000-8100-000000000003'and recipient_id in('ed000000-0000-4000-8000-000000000011','ed000000-0000-4000-8000-000000000012')),'No-nurse primary notice falls back to assigned doctor');
update public.care_alert_settings set telegram_delivery=false;
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(public.care_alert_nurse_inbox()->>'total'='1','Nurse sees only own member');
select pg_temp.ok(jsonb_array_length(public.care_alert_inbox()->'alerts')=1,'Generic inbox scopes nurse reads too');
select pg_temp.ok(public.care_alert_acknowledge('ed000000-0000-4000-8100-000000000002',0)->>'code'='not_found','Cannot acknowledge unrelated member');
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000002',0,'other','A reason')->>'code'='not_found','Cannot resolve unrelated member');
select pg_temp.ok(public.care_alert_next_action('ed000000-0000-4000-8100-000000000002',0,'Call',null)->>'code'='not_found','Cannot record unrelated action');
select pg_temp.ok(public.care_alert_next_action('ed000000-0000-4000-8100-000000000001',0,E' \t\r\n',null)->>'code'='invalid','Whitespace action refused');
select pg_temp.ok(public.care_alert_next_action('ed000000-0000-4000-8100-000000000001',0,repeat('x',301),null)->>'code'='invalid','Overlong action refused');
select pg_temp.ok(public.care_alert_next_action('ed000000-0000-4000-8100-000000000001',99,'Call',null)->>'code'='changed','Action sequence guard');
select pg_temp.ok(public.care_alert_next_action('ed000000-0000-4000-8100-000000000001',0,'  Call member  ',now()+interval '1 hour')->>'ok'='true','Owner records next action');
reset role;
select pg_temp.ok((select state='acknowledged'and state_seq=1 and next_action='Call member'and next_action_due_at is not null and next_action_by='ed000000-0000-4000-8000-000000000012'and next_action_at is not null from public.care_alerts where id='ed000000-0000-4000-8100-000000000001'),'Action saved and acknowledges');
select pg_temp.ok((select count(*)=1 from public.care_alert_audit where alert_id='ed000000-0000-4000-8100-000000000001'and kind='next_action'and actor_id='ed000000-0000-4000-8000-000000000012'and detail->>'role'='nurse'and detail->>'text'='Call member'),'Action audit retains text and actor role');
select pg_temp.ok(not exists(select 1 from public.conversation_trace_events where member_id='ed000000-0000-4000-8000-000000000001'and attributes::text like '%Call member%'),'Action text stays out of trace');
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '16 minutes'where id='ed000000-0000-4000-8100-000000000001';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_escalate_due()->>'raised'='0','Next action stops escalation while acknowledged');
reset role;
-- An open repeat starts a new cycle but retains the previous cycle's acknowledgement fields.
-- Recording its next action must name the person acknowledging this new information now.
savepoint reopened_next_action;
update public.care_alerts set state='open',state_seq=state_seq+1,acknowledged_at=clock_timestamp()-interval '1 hour'
 where id='ed000000-0000-4000-8100-000000000001';
select pg_temp.as_staff(11);set local role authenticated;
select pg_temp.ok(public.care_alert_next_action('ed000000-0000-4000-8100-000000000001',2,'Doctor takes reopened alert',null)->>'ok'='true','Next action acknowledges reopened alert');
reset role;
select pg_temp.ok((select state='acknowledged'and acknowledged_by='ed000000-0000-4000-8000-000000000011'
 and acknowledged_at>clock_timestamp()-interval '1 minute'and next_action_by=acknowledged_by
 from public.care_alerts where id='ed000000-0000-4000-8100-000000000001'),'Reopened action replaces previous-cycle acknowledger and time');
rollback to reopened_next_action;

select pg_temp.as_staff(14);set local role authenticated;
select pg_temp.ok(public.care_alert_nurse_inbox()->>'total'='0','No assignments yields empty inbox');
select pg_temp.ok(public.care_alert_acknowledge('ed000000-0000-4000-8100-000000000001',1)->>'code'='not_found','Unassigned nurse denied');
reset role;
select pg_temp.as_staff(11);set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.care_alert_inbox()->'alerts')>=3,'Doctor retains assigned-member visibility');
select pg_temp.ok(public.care_alert_next_action('ed000000-0000-4000-8100-000000000001',1,'Doctor follows up',null)->>'ok'='true','Assigned doctor can act with nurse owner');
reset role;
select pg_temp.ok((select acknowledged_by='ed000000-0000-4000-8000-000000000012'and next_action_by='ed000000-0000-4000-8000-000000000011'
 from public.care_alerts where id='ed000000-0000-4000-8100-000000000001'),'Updating an already acknowledged action preserves that cycle acknowledger');
select pg_temp.as_staff(12);set local role authenticated;
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'duplicate','Repeat')->>'code'='invalid','Duplicate cannot close');
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'no_action_needed',E' \t\n')->>'code'='invalid','Closing requires reason');
select pg_temp.ok(public.care_alert_resolve('ed000000-0000-4000-8100-000000000001',2,'member_contacted','Reached member')->>'ok'='true','Nurse resolves own member');
select pg_temp.ok(public.care_alert_next_action('ed000000-0000-4000-8100-000000000001',3,'Too late',null)->>'code'='resolved','Resolved alert refuses new action');
reset role;
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '14 minutes'where id='ed000000-0000-4000-8100-000000000002';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_escalate_due()->>'raised'='0','No escalation before 15 minutes');
reset role;
update public.care_alerts set cycle_started_at=clock_timestamp()-interval '16 minutes'where id in('ed000000-0000-4000-8100-000000000001','ed000000-0000-4000-8100-000000000002');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_escalate_due()->>'raised'='1','Only unacknowledged open alert escalates');
select pg_temp.ok(public.care_alert_escalate_due()->>'raised'='0','Escalation once');
reset role;
select pg_temp.ok((select public._care_alert_json(a)->>'ownerRole'='doctor'and public._care_alert_json(a)->>'ownerName'='Doctor Owner'and public._care_alert_json(a)->>'primaryOwnerRole'='nurse'and public._care_alert_json(a)->>'primaryOwnerName'='Unrelated Nurse'and public._care_alert_json(a)->>'escalatedDoctorName'='Doctor Owner'and public._care_alert_json(a)->>'escalatedAt'is not null from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000002'),'Escalation names acting doctor and retains primary nurse/time');
select pg_temp.as_staff(13);set local role authenticated;
select pg_temp.ok(public.care_alert_acknowledge('ed000000-0000-4000-8100-000000000002',0)->>'ok'='true','Own nurse acknowledges escalated member');
reset role;
select pg_temp.ok((select state='acknowledged'and acknowledged_by='ed000000-0000-4000-8000-000000000013'from public.care_alerts where id='ed000000-0000-4000-8100-000000000002'),'Acknowledgement recorded');
update public.workspace_staff set active=false where user_id='ed000000-0000-4000-8000-000000000011';
select pg_temp.ok((select public._care_alert_json(a)->>'ownerName'is null and public._care_alert_json(a)->>'ownerRole'is null from public.care_alerts a where a.id='ed000000-0000-4000-8100-000000000003'),'No valid owner is null');
update public.workspace_staff set active=true where user_id='ed000000-0000-4000-8000-000000000011';
-- Simulate a pre-snapshot alert and exercise the same idempotent backfill used by migration.
update public.care_alerts set route_primary=null,route_backup=null,route_minutes=null,cycle_started_at=clock_timestamp()-interval '3 hours'where id='ed000000-0000-4000-8100-000000000003';
select pg_temp.ok(public._care_alert_backfill_owner_routes()=1,'Backfill preexisting open alert');
select pg_temp.ok(public._care_alert_backfill_owner_routes()=0,'Backfill idempotent');
select pg_temp.ok((select route_primary='nurse'and route_backup='doctor'and route_minutes=15 and cycle_started_at>clock_timestamp()-interval '1 minute'from public.care_alerts where id='ed000000-0000-4000-8100-000000000003'),'Backfill starts fresh wait');
select pg_temp.ok((select count(*)=1 from public.care_alert_audit where alert_id='ed000000-0000-4000-8100-000000000003'and kind='routing_backfilled'),'Backfill audited once');
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname in('_care_alert_actor','_care_alert_visible','_care_alert_lock','care_alert_inbox','care_alert_nurse_inbox','care_alert_acknowledge','care_alert_resolve','care_alert_next_action','care_alert_audit_log')and p.provolatile<>'v'),'Locking call chains volatile');
-- Source regression only: resolving still reaches the shared conversation-before-alert lock
-- and keeps the stuck-state fix's doctor-mode transition and notice after that lock.
select pg_temp.ok((select position('perform 1 from public.conversations where member_id=m for update;'in prosrc)>0
 and position('perform 1 from public.conversations where member_id=m for update;'in prosrc)
  <position('select * into a from public.care_alerts where id=p_alert and member_id=m for update;'in prosrc)
 from pg_proc where oid='public._care_alert_lock(uuid)'::regprocedure),'Shared lock takes conversation before alert');
select pg_temp.ok((select position('a:=public._care_alert_lock(p_alert);'in prosrc)>0
 and position('a:=public._care_alert_lock(p_alert);'in prosrc)<position('perform public._zoe_mode_doctor(a.member_id);'in prosrc)
 and position('update public.zoe_doctor_mode set doctor_mode=false'in prosrc)>0
 and position('public._zoe_mode_notify(c.id,a.member_id,'in prosrc)>0
 from pg_proc where oid='public.care_alert_resolve(uuid,bigint,text,text)'::regprocedure),'Resolve retains doctor-mode side effects after shared locks');
rollback;
select 'care alert nurse ownership ok';
