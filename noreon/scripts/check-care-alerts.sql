-- Care-team alerts: dark switch, questionnaire red-flag hook, message/lab/Zoe screening,
-- de-duplication, staff inbox access, acknowledge/resolve, Telegram notices held while the
-- wording is unapproved, and a trace event for every decision. Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.has(m uuid,n text,o text,r text default null)returns boolean language sql as $$
 select exists(select 1 from public.conversation_trace_events where member_id=m and name=n and outcome=o and(r is null or reason_code=r))$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;
grant execute on function pg_temp.denied(text) to authenticated,service_role;

-- Members M1 (assigned to D1) and M2 (no doctor); doctors D1, D2; admin A.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('ca000000-0000-4000-8000-000000000001','37499016001',now()),('ca000000-0000-4000-8000-000000000002','37499016002',now()),
 ('ca000000-0000-4000-8000-000000000011',null,null),('ca000000-0000-4000-8000-000000000012',null,null),('ca000000-0000-4000-8000-000000000013',null,null);
insert into public.workspace_clinics(id,name)values('ca000000-0000-4000-8000-000000000020','Synthetic alert clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('ca000000-0000-4000-8000-000000000011','doctor','Dr Alert One','ca000000-0000-4000-8000-000000000020'),
 ('ca000000-0000-4000-8000-000000000012','doctor','Dr Alert Two','ca000000-0000-4000-8000-000000000020');
insert into public.workspace_staff(user_id,role,display_name)values('ca000000-0000-4000-8000-000000000013','admin','Admin Alert');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('ca000000-0000-4000-8000-000000000031','ca000000-0000-4000-8000-000000000011',now(),now()),('ca000000-0000-4000-8000-000000000032','ca000000-0000-4000-8000-000000000012',now(),now()),
 ('ca000000-0000-4000-8000-000000000033','ca000000-0000-4000-8000-000000000013',now(),now()),('ca000000-0000-4000-8000-000000000034','ca000000-0000-4000-8000-000000000001',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000011'),('ca000000-0000-4000-8000-000000000002',null);
update public.profiles set display_name='Alert Member One'where id='ca000000-0000-4000-8000-000000000001';
insert into public.patient_assessments(user_id)values('ca000000-0000-4000-8000-000000000001'),('ca000000-0000-4000-8000-000000000002');

-- 1. Dark: with no settings row a red flag raises nothing and journals nothing.
update public.patient_assessments set urgent_rule='RF-03',revision=1 where user_id='ca000000-0000-4000-8000-000000000001';
select pg_temp.ok(not exists(select 1 from public.care_alerts)and not exists(select 1 from public.conversation_trace_events where step='care_alert'),'Off: nothing raised or journaled');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_screen('ca000000-0000-4000-8000-000000000001','lab','lab-1','escalate','lab_result_critical','{}','care_alert.critical_lab','q3-test')->>'code'='alerts_off','Off: service screening refused');
select pg_temp.ok(public.care_alert_messages_pending(10,false)='[]'::jsonb,'Off: no pending messages');
reset role;

-- 2. Questionnaire red flag (computed by the engine, stored in urgent_rule) raises one alert.
update public.patient_assessments set urgent_rule=null,revision=2 where user_id='ca000000-0000-4000-8000-000000000001';
insert into public.care_alert_settings(enabled)values(true);
update public.patient_assessments set urgent_rule='RF-03',revision=3 where user_id='ca000000-0000-4000-8000-000000000001';
select pg_temp.ok((select count(*)=1 and bool_and(source='questionnaire'and state='open'and red_flags='{RF-03}'and reason_code='questionnaire_red_flag'and doctor_id='ca000000-0000-4000-8000-000000000011'and rule_id='clinical.red_flag')
 from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000001'),'Red flag raises an open questionnaire alert for the assigned doctor');
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000001','care_alert.screened','escalate','questionnaire_red_flag'),'Screening decision journaled');
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000001','care_alert.raised','escalate','questionnaire_red_flag'),'Raise journaled');
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000001','care_alert.telegram_skipped','skipped','telegram_delivery_off'),'Telegram off journaled');
-- Same rule on a later save is not a new signal; a different red flag merges into the live alert.
update public.patient_assessments set revision=4,urgent_rule='RF-03'where user_id='ca000000-0000-4000-8000-000000000001';
select pg_temp.ok((select occurrences=1 from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000001'),'Unchanged red flag adds nothing');
update public.patient_assessments set revision=5,urgent_rule='RF-05'where user_id='ca000000-0000-4000-8000-000000000001';
select pg_temp.ok((select occurrences=2 and red_flags='{RF-03,RF-05}'and state_seq=1 from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000001'),'New red flag merges: red stays red');
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000001','care_alert.repeated','escalate'),'Repeat journaled');
-- No assigned doctor: still raised, journaled as going to admins.
update public.patient_assessments set urgent_rule='RF-01',revision=1 where user_id='ca000000-0000-4000-8000-000000000002';
select pg_temp.ok((select doctor_id is null from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000002'),'Unassigned member alert raised');
select pg_temp.ok((select reason_code='questionnaire_red_flag'and attributes->>'noreon.care_alert.assigned_doctor'='false'from public.conversation_trace_events where member_id='ca000000-0000-4000-8000-000000000002'and name='care_alert.raised'),'Unassigned raise keeps its reason; doctor absence is an attribute');

-- 2b. The profile save upserts the assessment (ON CONFLICT DO UPDATE): the trigger fires there too.
insert into auth.users(id,phone,phone_confirmed_at)values('ca000000-0000-4000-8000-000000000004','37499016004',now());
insert into public.patient_assessments(user_id)values('ca000000-0000-4000-8000-000000000004');
insert into public.patient_assessments(user_id,urgent_rule,revision)values('ca000000-0000-4000-8000-000000000004','RF-06',1)
 on conflict(user_id)do update set urgent_rule=excluded.urgent_rule,revision=excluded.revision;
select pg_temp.ok(exists(select 1 from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000004'and red_flags='{RF-06}'),'Upsert path raises');
-- 2c. A failed raise never undoes the save, is journaled, and the retry sweep raises it later.
alter table public.care_alert_screenings add constraint pg_temp_fail check(source<>'questionnaire')not valid;
update public.patient_assessments set urgent_rule='RF-09',revision=2 where user_id='ca000000-0000-4000-8000-000000000004';
alter table public.care_alert_screenings drop constraint pg_temp_fail;
select pg_temp.ok((select urgent_rule='RF-09'and revision=2 from public.patient_assessments where user_id='ca000000-0000-4000-8000-000000000004'),'Member save kept when the raise fails');
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000004','care_alert.raise_failed','failed','alert_not_recorded_will_retry'),'Failure journaled');
select pg_temp.ok((select red_flags='{RF-06}'from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000004'),'Not raised yet');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_assessments_retry(20)->>'raised'='1','Retry raises the missed red flag');
select pg_temp.ok(public.care_alert_assessments_retry(20)->>'raised'='0','Retry is once');
reset role;
select pg_temp.ok((select red_flags='{RF-06,RF-09}'and occurrences=2 from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000004'),'Retried flag merged into the live alert');
-- N1: time passing never re-raises an unchanged flag. Age every screening by two days, save again unchanged.
update public.care_alert_screenings set screened_at=screened_at-interval '2 days'where member_id='ca000000-0000-4000-8000-000000000004';
update public.patient_assessments set revision=3,updated_at=now()where user_id='ca000000-0000-4000-8000-000000000004';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_assessments_retry(20)->>'raised'='0','Unchanged flag with an old screening is not re-raised');
reset role;
select pg_temp.ok((select occurrences=2 from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000004'),'No extra occurrence');
select pg_temp.as_staff('ca000000-0000-4000-8000-000000000011','ca000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(pg_temp.denied($$select public.care_alert_assessments_retry(5)$$),'Retry is service-only');
reset role;
delete from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000004';

-- 3. Inbox access: admin sees both, D1 sees M1 only, D2 sees none, a member is refused.
select pg_temp.as_staff('ca000000-0000-4000-8000-000000000013','ca000000-0000-4000-8000-000000000033');set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.care_alert_inbox('live',100)->'alerts')=2,'Admin sees every alert');
reset role;select pg_temp.as_staff('ca000000-0000-4000-8000-000000000011','ca000000-0000-4000-8000-000000000031');set local role authenticated;
insert into kv values('d1',public.care_alert_inbox('live',100));
select pg_temp.ok((select jsonb_array_length(v->'alerts')=1 and v#>>'{alerts,0,memberName}'='Alert Member One'and v->>'role'='doctor'from kv where k='d1'),'Assigned doctor sees only their member');
reset role;select pg_temp.as_staff('ca000000-0000-4000-8000-000000000012','ca000000-0000-4000-8000-000000000032');set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.care_alert_inbox('live',100)->'alerts')=0,'Other doctor sees nothing');
select pg_temp.ok(public.care_alert_acknowledge((select (v#>>'{alerts,0,id}')::uuid from kv where k='d1'),1)->>'code'='not_found','Other doctor cannot acknowledge');
reset role;select pg_temp.as_staff('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000034');set local role authenticated;
select pg_temp.ok(pg_temp.denied($$select public.care_alert_inbox('live',10)$$),'Member is refused');
select pg_temp.ok(public.care_alert_member_status()->>'alerted'='true','Member status keeps current alert');
select pg_temp.ok(pg_temp.denied($$select public.care_alert_screen(null,'lab','x','skipped','x','{}','x','x')$$),'Screening is service-only');
reset role;
-- Owner metadata is additive: an assigned doctor is the fallback when no nurse exists.
select pg_temp.ok((select public._care_alert_json(a)->>'ownerName'='Dr Alert One'and public._care_alert_json(a)->>'ownerRole'='doctor'from public.care_alerts a where a.member_id='ca000000-0000-4000-8000-000000000001'),'Doctor fallback owner metadata');
select pg_temp.ok((select public._care_alert_json(a)->>'ownerName'is null and public._care_alert_json(a)->>'ownerRole'is null from public.care_alerts a where a.member_id='ca000000-0000-4000-8000-000000000002'),'Unassigned owner metadata is null');
select pg_temp.ok(not has_table_privilege('authenticated','public.care_alerts','select')and not has_table_privilege('service_role','public.care_alerts','select'),'No direct table access');

-- A new clinical signal after the inbox read must not be closed by its stale sequence.
savepoint newer_signal;
update public.patient_assessments set urgent_rule='RF-06',revision=revision+1
 where user_id='ca000000-0000-4000-8000-000000000001';
select pg_temp.as_staff('ca000000-0000-4000-8000-000000000011','ca000000-0000-4000-8000-000000000031');
set local role authenticated;
select pg_temp.ok(public.care_alert_resolve((v#>>'{alerts,0,id}')::uuid,(v#>>'{alerts,0,stateSeq}')::bigint,'member_contacted','Synthetic reason')->>'code'='changed','Newer signal rejects stale resolution')from kv where k='d1';
reset role;
select pg_temp.ok((select state='open'and state_seq=2 and occurrences=3 and resolved_by is null from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000001'),'Stale resolution preserves the newer signal');
select pg_temp.ok(not exists(select 1 from public.care_alert_audit where kind='resolved'),'Stale resolution has no resolution audit');
rollback to newer_signal;

-- The existing admin policy also covers alerts raised before a case is created.
savepoint admin_without_case;
delete from public.patient_clinical_cases where user_id='ca000000-0000-4000-8000-000000000002';
insert into kv select 'no_case',to_jsonb(id)from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000002';
select pg_temp.as_staff('ca000000-0000-4000-8000-000000000013','ca000000-0000-4000-8000-000000000033');
set local role authenticated;
select pg_temp.ok(public.care_alert_resolve((v#>>'{}')::uuid,0,'member_contacted','Synthetic reason')->>'changed'='true','Admin can resolve an alert without a case')from kv where k='no_case';
reset role;
rollback to admin_without_case;

-- 4. Acknowledge and resolve: optimistic, audited, journaled; the note never reaches the trace.
select pg_temp.as_staff('ca000000-0000-4000-8000-000000000011','ca000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(public.care_alert_acknowledge((v#>>'{alerts,0,id}')::uuid,0)->>'code'='changed','Stale view cannot acknowledge')from kv where k='d1';
select pg_temp.ok((public.care_alert_acknowledge((v#>>'{alerts,0,id}')::uuid,1)#>>'{alert,state}')='acknowledged','Acknowledged')from kv where k='d1';
select pg_temp.ok(public.care_alert_acknowledge((v#>>'{alerts,0,id}')::uuid,2)->>'changed'='false','Second acknowledge is a no-op')from kv where k='d1';
select pg_temp.ok(public.care_alert_resolve((v#>>'{alerts,0,id}')::uuid,2,'other','  ')->>'code'='invalid','Other needs a note')from kv where k='d1';
select pg_temp.ok(public.care_alert_resolve((v#>>'{alerts,0,id}')::uuid,2,'not_a_code',null)->>'code'='invalid','Unknown resolution refused')from kv where k='d1';
select pg_temp.ok((public.care_alert_resolve((v#>>'{alerts,0,id}')::uuid,2,'member_contacted','Synthetic private note')#>>'{alert,state}')='resolved','Resolved')from kv where k='d1';
select pg_temp.ok(jsonb_array_length(public.care_alert_audit_log((v#>>'{alerts,0,id}')::uuid)->'events')=4,'Audit: raised, repeated, acknowledged, resolved')from kv where k='d1';
reset role;
select pg_temp.ok((select actor_kind='doctor'and actor_id='ca000000-0000-4000-8000-000000000011'from public.conversation_trace_events where name='care_alert.acknowledged'),'Acknowledge journaled with the doctor');
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000001','care_alert.resolved','recorded','member_contacted'),'Resolve journaled with its code');
select pg_temp.ok(not exists(select 1 from public.conversation_trace_events where attributes::text like '%Synthetic private note%'),'Note never journaled');
do $$begin update public.care_alert_audit set kind='x';raise exception 'FAIL: audit is append-only';exception when sqlstate '55000' then null;end$$;
-- After resolution the same source opens a fresh alert.
update public.patient_assessments set revision=6,urgent_rule=null where user_id='ca000000-0000-4000-8000-000000000001';
update public.patient_assessments set revision=7,urgent_rule='RF-02'where user_id='ca000000-0000-4000-8000-000000000001';
select pg_temp.ok((select count(*)=2 and count(*)filter(where state='open')=1 from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000001'),'Resolved alert stays; new one opens');

-- 5. Member messages: pending without text, screened once, escalate needs red flags, member re-derived.
insert into public.conversations(member_id)values('ca000000-0000-4000-8000-000000000002');
insert into public.conversation_messages(id,conversation_id,seq,author_id,body,source,request_id)
 select 'ca000000-0000-4000-8000-000000000041',id,1,member_id,'Synthetic message words','authenticated_member',gen_random_uuid()from public.conversations where member_id='ca000000-0000-4000-8000-000000000002';
select pg_temp.as_service();set local role service_role;
insert into kv values('p',public.care_alert_messages_pending(10,false));
select pg_temp.ok((select v@>'[{"messageId":"ca000000-0000-4000-8000-000000000041","text":null}]'from kv where k='p'),'Pending without text when the list is unsigned');
select pg_temp.ok(public.care_alert_messages_pending(10,true)#>>'{0,text}'='Synthetic message words','Text only when asked for');
select pg_temp.ok(public.care_alert_screen(null,'message','ca000000-0000-4000-8000-000000000041','skipped','lexicon_awaiting_s1_signoff','{}','care_alert.urgent_lexicon','s1-unsigned-0')->>'replayed'='false','Skipped screening recorded');
select pg_temp.ok(public.care_alert_screen(null,'message','ca000000-0000-4000-8000-000000000041','escalate','urgent_words_matched','{RF-01}','care_alert.urgent_lexicon','x')->>'replayed'='true','Screening is once per message');
select pg_temp.ok(public.care_alert_messages_pending(10,false)='[]'::jsonb,'Screened message no longer pending');
reset role;
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000002','care_alert.screened','skipped','lexicon_awaiting_s1_signoff'),'Skipped screening journaled');
insert into public.conversation_messages(id,conversation_id,seq,author_id,body,source,request_id)
 select 'ca000000-0000-4000-8000-000000000042',id,2,member_id,'Synthetic urgent words','authenticated_member',gen_random_uuid()from public.conversations where member_id='ca000000-0000-4000-8000-000000000002';
select pg_temp.as_service();set local role service_role;
-- A match on an urgent word with no red flag id escalates (check-urgent-reach.sql); any other reason with no red flag does not.
select pg_temp.ok(public.care_alert_screen(null,'message','ca000000-0000-4000-8000-000000000042','escalate','some_other_reason','{}','care_alert.urgent_lexicon','test')->>'code'='invalid','Escalation without a red flag refused');
select pg_temp.ok(public.care_alert_screen(null,'message','ca000000-0000-4000-8000-000000000042','escalate','urgent_words_matched','{RF-99}','care_alert.urgent_lexicon','test')->>'code'='invalid','Unknown red flag refused');
select pg_temp.ok(public.care_alert_screen(null,'message','ca000000-0000-4000-8000-000000000042','escalate','Free text reason','{RF-01}','care_alert.urgent_lexicon','test')->>'code'='invalid','Free-text reason refused');
-- A wrong member id is ignored: the message's author is the member.
select pg_temp.ok(public.care_alert_screen('ca000000-0000-4000-8000-000000000001','message','ca000000-0000-4000-8000-000000000042','escalate','urgent_words_matched','{RF-01}','care_alert.urgent_lexicon','test-lexicon')->>'ok'='true','Message escalation recorded');
reset role;
select pg_temp.ok((select member_id='ca000000-0000-4000-8000-000000000002'and red_flags='{RF-01}'from public.care_alerts where source='message'),'Message alert belongs to the author');

-- 6. Lab (interface; rules await Q3) and Zoe both go through the same path.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_screen('ca000000-0000-4000-8000-000000000002','lab','lab-result-1','skipped','lab_rules_awaiting_q3','{}','care_alert.critical_lab','q3-unsigned-0')->>'ok'='true','Lab skipped recorded');
select pg_temp.ok(public.care_alert_screen('ca000000-0000-4000-8000-000000000002','lab','lab-result-2','escalate','lab_result_critical','{}','care_alert.critical_lab','q3-test')->>'alertId'is not null,'Lab critical raises without a red flag id');
select pg_temp.ok(public.care_alert_screen('ca000000-0000-4000-8000-000000000002','zoe','zoe-turn-1','escalate','urgent_words_matched','{RF-02}','zoe.urgent_lexicon','test')->>'alertId'is not null,'Zoe escalation raises');
select pg_temp.ok(public.care_alert_screen('ca000000-0000-4000-8000-000000000009','zoe','zoe-turn-2','skipped','x','{}','x','x')->>'code'='unknown_member','Unknown member refused');
reset role;
select pg_temp.ok((select count(distinct source)=4 from public.care_alerts),'All four sources raised');

-- 7. Telegram to enrolled staff: queued for the admin with a binding, held while the wording is unapproved.
update public.care_alert_settings set telegram_delivery=true;
select public._telegram_auth_bind('ca000000-0000-4000-8000-000000000013','staff','["telegram","noreon_alert",9006,"user",8601]','["telegram","noreon_alert",9006]','+37499016013','8601',null);
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ca000000-0000-4000-8000-000000000001','zoe','zoe-turn-3','escalate','urgent_words_matched','{RF-04}','zoe.urgent_lexicon','test');
reset role;
select pg_temp.ok((select count(*)=1 from public.care_alert_deliveries d join public.telegram_auth_messages m on m.id=d.telegram_message_id
 where d.recipient_id='ca000000-0000-4000-8000-000000000013'and m.template_id='care_alert.staff_notice'and m.address='8601'and m.state='queued'),'Notice queued for the enrolled admin only');
select pg_temp.ok((select body not like '%Alert Member%'and body not like '%RF-%'from public.telegram_auth_messages where template_id='care_alert.staff_notice'),'Notice carries no member or clinical detail');
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000001','care_alert.telegram_queued','queued','queued_wording_unapproved_will_be_held'),'Queue decision journaled truthfully');
insert into kv select 'notice',to_jsonb(telegram_message_id)from public.care_alert_deliveries limit 1;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_message_claim((v#>>'{}')::uuid,gen_random_uuid())->>'code'='template_unapproved','Unapproved wording is held at claim')from kv where k='notice';
-- A repeat within 15 minutes does not page again.
select public.care_alert_screen('ca000000-0000-4000-8000-000000000001','zoe','zoe-turn-4','escalate','urgent_words_matched','{RF-04}','zoe.urgent_lexicon','test');
reset role;
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000001','care_alert.telegram_held','held','template_unapproved'),'Hold journaled on the alert');
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000001','care_alert.telegram_skipped','skipped','recently_notified'),'Repeat within 15 minutes not re-sent');
select pg_temp.ok((select count(*)=1 from public.care_alert_deliveries),'Still one notice');
-- Telegram on but nobody enrolled for M2's alert path except the admin: covered; with the admin revoked nobody is.
update public.telegram_auth_bindings set active=false where auth_user_id='ca000000-0000-4000-8000-000000000013';
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ca000000-0000-4000-8000-000000000002','lab','lab-result-3','skipped','lab_rules_awaiting_q3','{}','care_alert.critical_lab','q3-unsigned-0');
update public.patient_assessments set urgent_rule='RF-07',revision=2 where user_id='ca000000-0000-4000-8000-000000000002';
reset role;
select pg_temp.ok(pg_temp.has('ca000000-0000-4000-8000-000000000002','care_alert.telegram_skipped','skipped','no_enrolled_staff'),'No enrolled staff journaled');

-- 8. Deleting a member's account removes their alerts and audit (the cascade is allowed; direct deletes are not).
do $$begin delete from public.care_alert_audit;raise exception 'FAIL: direct audit delete';exception when sqlstate '55000' then null;end$$;
insert into auth.users(id,phone,phone_confirmed_at)values('ca000000-0000-4000-8000-000000000003','37499016003',now());
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ca000000-0000-4000-8000-000000000003','lab','lab-result-9','escalate','lab_result_critical','{}','care_alert.critical_lab','q3-test');
reset role;
select pg_temp.ok(exists(select 1 from public.care_alert_audit a join public.care_alerts c on c.id=a.alert_id where c.member_id='ca000000-0000-4000-8000-000000000003'),'Fixture alert audited');
delete from auth.users where id='ca000000-0000-4000-8000-000000000003';
select pg_temp.ok(not exists(select 1 from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000003'),'Account deletion cascades');

-- 9. Every journaled care-alert event is codes only.
select pg_temp.ok(not exists(select 1 from public.conversation_trace_events where step='care_alert'and(attributes::text like '%Synthetic%'or attributes ?| array['text','body','note'])),'Trace holds no text');

-- 10. An alert never ends by itself; a named person closes it with an outcome and a reason (Armen's audit, 4 Nov, S0-2 and S0-3).
insert into auth.users(id,phone,phone_confirmed_at)values('ca000000-0000-4000-8000-000000000005','37499016005',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('ca000000-0000-4000-8000-000000000005','ca000000-0000-4000-8000-000000000011');
select pg_temp.as_service();set local role service_role;
select public.care_alert_screen('ca000000-0000-4000-8000-000000000005','lab','lab-result-10','escalate','lab_result_critical','{}','care_alert.critical_lab','q3-test');
reset role;
insert into kv select 'close',jsonb_build_object('id',id,'seq',state_seq)from public.care_alerts where member_id='ca000000-0000-4000-8000-000000000005'and state<>'resolved';
select pg_temp.ok((select count(*)=1 from kv where k='close'),'Closing fixture: one live alert');
-- 10a. Time alone changes nothing: an urgent alert a month old stays open after every sweep the plumbing has.
update public.care_alerts set created_at=now()-interval '30 days',last_seen_at=now()-interval '30 days'where member_id='ca000000-0000-4000-8000-000000000005';
select pg_temp.as_service();set local role service_role;
select public.care_alert_messages_pending(10,false);
select public.care_alert_screen('ca000000-0000-4000-8000-000000000005','lab','lab-result-10b','skipped','lab_rules_awaiting_q3','{}','care_alert.critical_lab','q3-unsigned-1');
reset role;
select pg_temp.ok((select state='open'and resolved_by is null and resolved_at is null and resolution is null from public.care_alerts where id=(select (v->>'id')::uuid from kv where k='close')),'A month-old urgent alert is still open after the sweeps');
-- 10b. Only care_alert_resolve may write a resolution: any other function that does fails this check.
select pg_temp.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname<>'care_alert_resolve'
 and(p.prosrc ~* 'update\s+public\.care_alerts\s+set[^;]*state\s*=\s*''resolved'''or p.prosrc ~* 'update\s+public\.care_alerts[^;]*resolved_(by|at)\s*=')),'No function other than care_alert_resolve closes an alert');
-- 10c. Only a named authorized staff member can close: a member, the service role and an anonymous caller are refused.
select pg_temp.as_staff('ca000000-0000-4000-8000-000000000001','ca000000-0000-4000-8000-000000000034');set local role authenticated;
select pg_temp.ok(pg_temp.denied(format('select public.care_alert_resolve(%L,%s,''member_contacted'',''Reason'')',(v->>'id'),(v->>'seq')))::boolean,'A member session cannot close an alert')from kv where k='close';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(pg_temp.denied(format('select public.care_alert_resolve(%L,%s,''member_contacted'',''Reason'')',(v->>'id'),(v->>'seq'))),'The service role cannot close an alert')from kv where k='close';
reset role;
grant select on kv to anon;grant execute on function pg_temp.denied(text),pg_temp.ok(boolean,text) to anon;
select pg_temp.as_service();set local role anon;
select pg_temp.ok(pg_temp.denied(format('select public.care_alert_resolve(%L,%s,''member_contacted'',''Reason'')',(v->>'id'),(v->>'seq'))),'An anonymous caller cannot close an alert')from kv where k='close';
reset role;
select pg_temp.ok((select state='open'from public.care_alerts where id=(select (v->>'id')::uuid from kv where k='close')),'Refused callers left it open');
-- 10d. A doctor needs an outcome from the list and a reason; 'duplicate' is not an outcome.
select pg_temp.as_staff('ca000000-0000-4000-8000-000000000011','ca000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok(public.care_alert_resolve((v->>'id')::uuid,(v->>'seq')::bigint,r,n)->>'code'='invalid',format('Close refused: %s with %L',r,n))
 from kv,(values('member_contacted',null),('member_contacted',''),('emergency_care_advised','   '),('no_action_needed',null),('other',' '),('other',E'\n\t'),('member_contacted',E' \t\r\n '),('other',chr(11)),('no_action_needed',E' '||chr(11)||E'\f '),('duplicate','Same as the one above'),('duplicate',null),('unknown','Reason'))x(r,n)where k='close';
reset role;
select pg_temp.ok((select state='open'and resolved_by is null from public.care_alerts where id=(select (v->>'id')::uuid from kv where k='close')),'Refused closes left it open');
-- 10e. With an outcome and a reason the doctor's close is recorded: who, which outcome, when, why.
select pg_temp.as_staff('ca000000-0000-4000-8000-000000000011','ca000000-0000-4000-8000-000000000031');set local role authenticated;
select pg_temp.ok((public.care_alert_resolve((v->>'id')::uuid,(v->>'seq')::bigint,'member_contacted','Called the member, all well v')#>>'{alert,state}')='resolved','Doctor closes with an outcome and a reason')from kv where k='close';
reset role;
select pg_temp.ok((select resolved_by='ca000000-0000-4000-8000-000000000011'and resolved_at is not null and resolution='member_contacted'and resolution_note='Called the member, all well v'
 from public.care_alerts where id=(select (v->>'id')::uuid from kv where k='close')),'Close recorded: doctor, time, outcome, reason');
select pg_temp.ok((select detail->>'resolution'='member_contacted'and actor_id='ca000000-0000-4000-8000-000000000011'from public.care_alert_audit
 where alert_id=(select (v->>'id')::uuid from kv where k='close')and kind='resolved'),'Close audited with the doctor and the outcome');
-- 10f. Nothing, however written, can newly mark an alert as a duplicate.
do $$begin update public.care_alerts set resolution='duplicate'where member_id='ca000000-0000-4000-8000-000000000005';raise exception 'FAIL: new duplicate resolution accepted';exception when check_violation then null;end$$;

rollback;
\echo 'PASS care alerts: dark switch, questionnaire hook, screening, dedupe, inbox access, ack/resolve, Telegram held, trace'
