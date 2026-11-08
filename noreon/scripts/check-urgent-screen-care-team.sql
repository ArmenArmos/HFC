-- Urgent screen follow-up (M-01): red-flag changes are always recorded; a cleared red flag
-- still alerts the care team; the member status says "alerted" only when it is true.
-- Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_member(m text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.ans(field text,v text)returns jsonb language sql as $$select jsonb_build_object(field,jsonb_build_object('fieldId',field,'value',v,'source','manual','answeredAt','2026-10-17T00:00:00Z'))$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated;

insert into auth.users(id,phone,phone_confirmed_at)values('cb000000-0000-4000-8000-000000000001','37499018001',now()),('cb000000-0000-4000-8000-000000000002','37499018002',now());
insert into public.patient_assessments(user_id,answers)values('cb000000-0000-4000-8000-000000000001',pg_temp.ans('q9.present','yes')),('cb000000-0000-4000-8000-000000000002','{}');

-- Alerts off: the member status says not alerted, and a cleared flag is still recorded.
update public.patient_assessments set answers=answers||pg_temp.ans('q9.right_now','yes'),urgent_rule='RF-01',revision=1 where user_id='cb000000-0000-4000-8000-000000000001';
select pg_temp.as_member('cb000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()@>'{"alertsEnabled":false,"alerted":false}','Off: not alerted');
reset role;
update public.patient_assessments set answers=answers||pg_temp.ans('q9.right_now','no'),urgent_rule=null,revision=2 where user_id='cb000000-0000-4000-8000-000000000001';
select pg_temp.ok((select previous_rule='RF-01'and current_rule is null and alert_id is null and changed_fields='{"q9.right_now":{"before":"yes","after":"no"}}'
 from public.urgent_answer_changes where member_id='cb000000-0000-4000-8000-000000000001'),'Off: cleared flag recorded with the changed answer only');
select pg_temp.ok(not exists(select 1 from public.care_alerts),'Off: no alert');

-- Alerts on: raise, member sees "alerted"; the other member sees nothing of it.
insert into public.care_alert_settings(enabled)values(true);
update public.patient_assessments set answers=answers||pg_temp.ans('q9.right_now','yes'),urgent_rule='RF-01',revision=3 where user_id='cb000000-0000-4000-8000-000000000001';
select pg_temp.as_member('cb000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()@>'{"alertsEnabled":true,"alerted":true}','On: alerted');
reset role;select pg_temp.as_member('cb000000-0000-4000-8000-000000000002');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()@>'{"alerted":false}','Other member: not alerted');
reset role;

-- Mistake: the member changes the answer, the flag clears, the care team is still alerted.
update public.patient_assessments set answers=answers||pg_temp.ans('q9.right_now','no'),urgent_rule=null,revision=4 where user_id='cb000000-0000-4000-8000-000000000001';
select pg_temp.ok((select occurrences=2 and state='open'and red_flags='{RF-01}'from public.care_alerts where member_id='cb000000-0000-4000-8000-000000000001'),'Cleared flag repeats the live alert');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where member_id='cb000000-0000-4000-8000-000000000001'and name='care_alert.repeated'and reason_code='questionnaire_red_flag_cleared'),'Cleared alert journaled');
select pg_temp.ok((select alert_id is not null and changed_fields?'q9.right_now'from public.urgent_answer_changes where member_id='cb000000-0000-4000-8000-000000000001'and revision=4),'Change linked to the alert');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='care_alert.red_flag_cleared'and attributes->>'noreon.care_alert.changed_fields'='q9.right_now'
 and attributes::text not like '%"no"%'),'Change journaled with field ids, not values');
select pg_temp.as_member('cb000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()@>'{"alerted":false}','No current flag: the screen does not claim an alert');
reset role;

-- Resolved and cleared, then red again: a fresh alert (the cleared screening is a different row).
update public.care_alerts set state='resolved',acknowledged_by=member_id,acknowledged_at=now(),resolved_by=member_id,resolved_at=now()-interval '8 days',resolution='no_action_needed'where member_id='cb000000-0000-4000-8000-000000000001';
select pg_temp.as_member('cb000000-0000-4000-8000-000000000001');set local role authenticated;
reset role;
-- Without a live or recent alert carrying the flag, "alerted" stays false even if the flag is current.
alter table public.patient_assessments disable trigger care_alert_from_assessment;
update public.patient_assessments set urgent_rule='RF-01',revision=5 where user_id='cb000000-0000-4000-8000-000000000001';
alter table public.patient_assessments enable trigger care_alert_from_assessment;
select pg_temp.as_member('cb000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()@>'{"alerted":false}','An alert for an earlier occurrence does not count');
reset role;

-- Replaced by another red flag: recorded too.
update public.patient_assessments set urgent_rule='RF-02',revision=6 where user_id='cb000000-0000-4000-8000-000000000001';
select pg_temp.ok(exists(select 1 from public.urgent_answer_changes where previous_rule='RF-01'and current_rule='RF-02'),'Replaced flag recorded');

-- U3: the staff card shows why the latest repeat happened.
select pg_temp.ok((select public._care_alert_json(c)->>'lastReason'='questionnaire_red_flag_cleared'from public.care_alerts c
 where member_id='cb000000-0000-4000-8000-000000000001'and reason_code='questionnaire_red_flag'order by created_at limit 1),'Withdrawn answer visible on the staff card');

-- U2: "alerted" belongs to the current occurrence. Member 3: RF-01 raised and resolved, cleared, then RF-01 again with the raise failing.
insert into auth.users(id,phone,phone_confirmed_at)values('cb000000-0000-4000-8000-000000000003','37499018003',now());
insert into public.patient_assessments(user_id)values('cb000000-0000-4000-8000-000000000003');
update public.patient_assessments set urgent_rule='RF-01',revision=1 where user_id='cb000000-0000-4000-8000-000000000003';
update public.care_alerts set state='resolved',acknowledged_by=member_id,acknowledged_at=now(),resolved_by=member_id,resolved_at=now(),resolution='no_action_needed'where member_id='cb000000-0000-4000-8000-000000000003';
update public.patient_assessments set urgent_rule=null,revision=2 where user_id='cb000000-0000-4000-8000-000000000003';
update public.care_alerts set state='resolved',acknowledged_by=member_id,acknowledged_at=now(),resolved_by=member_id,resolved_at=now(),resolution='no_action_needed'where member_id='cb000000-0000-4000-8000-000000000003'and state<>'resolved';
alter table public.care_alert_screenings add constraint pg_temp_fail check(source<>'questionnaire')not valid;
update public.patient_assessments set urgent_rule='RF-01',revision=3 where user_id='cb000000-0000-4000-8000-000000000003';
alter table public.care_alert_screenings drop constraint pg_temp_fail;
select pg_temp.as_member('cb000000-0000-4000-8000-000000000003');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()@>'{"alerted":false}','A recent alert for an earlier occurrence does not count');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_assessments_retry(20)->>'raised'='1','Retry raises the current occurrence even though RF-01 was screened before (N1a)');
select pg_temp.ok(public.care_alert_assessments_retry(20)->>'raised'='0','And only once');
reset role;
select pg_temp.as_member('cb000000-0000-4000-8000-000000000003');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()@>'{"alerted":true}','Alerted once the current occurrence is raised');
reset role;

-- Resolved long ago still counts for the same occurrence: the care team was told.
update public.care_alerts set state='resolved',acknowledged_by=member_id,acknowledged_at=now(),resolved_by=member_id,resolved_at=now()-interval '30 days',resolution='no_action_needed'
 where member_id='cb000000-0000-4000-8000-000000000003'and state<>'resolved';
select pg_temp.as_member('cb000000-0000-4000-8000-000000000003');set local role authenticated;
select pg_temp.ok(public.care_alert_member_status()@>'{"alerted":true}','A resolved alert for the current occurrence still means the team was told');
reset role;

-- U1: a cleared flag whose alert fails is retried from its change record.
alter table public.care_alert_screenings add constraint pg_temp_fail check(source<>'questionnaire')not valid;
update public.patient_assessments set urgent_rule=null,revision=4 where user_id='cb000000-0000-4000-8000-000000000003';
alter table public.care_alert_screenings drop constraint pg_temp_fail;
select pg_temp.ok((select alert_id is null from public.urgent_answer_changes where member_id='cb000000-0000-4000-8000-000000000003'and revision=4),'Change recorded without an alert');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_assessments_retry(20)->>'raised'='1','Retry raises the cleared-flag alert');
select pg_temp.ok(public.care_alert_assessments_retry(20)->>'raised'='0','Once');
reset role;
select pg_temp.ok(exists(select 1 from public.care_alert_screenings where source_ref like '%:4'and member_id='cb000000-0000-4000-8000-000000000003'and reason_code='questionnaire_red_flag_cleared'and alert_id is not null),'Cleared-flag alert linked through its screening');

-- Access: no direct reads; append-only; status needs a signed-in member.
select pg_temp.ok(not has_table_privilege('authenticated','public.urgent_answer_changes','select'),'No direct table access');
do $$begin update public.urgent_answer_changes set revision=0;raise exception 'FAIL: append-only';exception when sqlstate '55000' then null;end$$;
set local role anon;
do $$begin perform public.care_alert_member_status();raise exception 'FAIL: anon allowed';exception when insufficient_privilege then null;end$$;
reset role;
rollback;
\echo 'PASS urgent screen care team: changes recorded, cleared flag alerts, member status truthful'
