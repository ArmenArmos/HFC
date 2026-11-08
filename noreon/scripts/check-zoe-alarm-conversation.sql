-- SYNTHETIC rollback-only SQL risk-path checks. Run after a clean local migration replay.
-- Never aimed at hosted data. Exercises real window/finish, audit and trace persistence.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
insert into auth.users(id)values('ec1e0000-0000-4000-8000-000000000001');
insert into public.patient_clinical_cases(user_id)values('ec1e0000-0000-4000-8000-000000000001');
insert into public.conversations(id,member_id)values('ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001');
insert into public.zoe_settings(singleton,consent_collection_enabled,consent_wording_version)
 values(true,true,'member-clear-test')on conflict(singleton)do update set consent_collection_enabled=true,consent_wording_version='member-clear-test';
insert into public.zoe_consents(member_id,kind,granted,wording_version)
 values('ec1e0000-0000-4000-8000-000000000001','zoe_reads_messages',true,'member-clear-test');
-- A synthetic alarm anchored ten minutes ago, and a started follow-up.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 values('ec1e0000-0000-4000-8000-000000000003','ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001',1,0,0,current_date,'finished','discarded','symptom_red_flag_no_model_call',now());
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)
 values('ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001','ec1e0000-0000-4000-8000-000000000003',1,'Synthetic urgent answer.','en','noreon.rules','synthetic','urgent',clock_timestamp()-interval '10 minutes');
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 values('ec1e0000-0000-4000-8000-000000000004','ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001',3,0,0,current_date,'started');
insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at,created_at)
 values('ec1e0000-0000-4000-8000-000000000005','ec1e0000-0000-4000-8000-000000000001',gen_random_uuid(),198,106,clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '20 minutes');
create function pg_temp.win(run uuid default 'ec1e0000-0000-4000-8000-000000000004')returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 j:=public.zoe_run_urgent_window(array[run]);return j->0;end$$;
select pg_temp.ok(pg_temp.win()#>>'{memberClear,readingClearReason}'is null,'Old crisis does not clear');

create function pg_temp.alarm()returns jsonb language sql as $$select public.zoe_run_alarm_window(array['ec1e0000-0000-4000-8000-000000000004'::uuid])->0$$;
select pg_temp.ok(not(pg_temp.win()->'memberClear'?'trigger'),'Legacy RPC retains its strict v1 shape');
select pg_temp.ok(pg_temp.alarm()#>>'{memberClear,sinceMinutes}'='10','Flagged window starts with original alarm');
-- A saved staff-only rationale must never supply the member's alarm context.
update public.zoe_runs set why='{"v":1,"alarm":{"rules":["bp_crisis_reading","RF-03"],"messageHash":"synthetic","symptom":"fatigue","reading":{"systolic":198,"diastolic":106,"id":"ec1e0000-0000-4000-8000-000000000005","version":"1"}}}'
 where id='ec1e0000-0000-4000-8000-000000000003';
-- A normal answer carrying the actual continuation event preserves only the flagged alarm window.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 values('ec1e0000-0000-4000-8000-000000000009','ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001',2,0,0,current_date,'finished','answered','health_answer_passed_guards',now());
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)
 values('ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001','ec1e0000-0000-4000-8000-000000000009',2,'Synthetic unrelated answer with warning.','en','noreon.rules','synthetic','answer',clock_timestamp()-interval '1 minute');
select public._zoe_run_events(r,'[{"name":"zoe.urgent.conversation","outcome":"recorded","reason":"alarm_conversation_continues","rule":"zoe.alarm_conversation","ruleVersion":"zoe-alarm-conversation-1","actor":"system","attributes":{}}]')
 from public.zoe_runs r where id='ec1e0000-0000-4000-8000-000000000009';
select pg_temp.ok(pg_temp.win()#>>'{memberClear,sinceMinutes}'is null,'Legacy window still closes on ordinary answer');
select pg_temp.ok(pg_temp.alarm()#>>'{memberClear,sinceMinutes}'='10','Conversation does not close or refresh flagged alarm');
select pg_temp.ok((select started_at is not null from public._zoe_talking_urgent_window('ec1e0000-0000-4000-8000-000000000002')),'Doctor clear still sees the original window after a continuation');
select pg_temp.ok(pg_temp.alarm()#>>'{memberClear,throughSeq}'='1','Continuation does not move the urgent through-seq');
update public.patient_measurements set systolic=117,diastolic=91 where id='ec1e0000-0000-4000-8000-000000000005';
insert into public.conversation_audit(conversation_id,kind,detail)
 values('ec1e0000-0000-4000-8000-000000000002','zoe.urgent_reading','{"runId":"ec1e0000-0000-4000-8000-000000000003","readingId":"ec1e0000-0000-4000-8000-000000000005"}');
select pg_temp.ok(pg_temp.alarm()#>>'{memberClear,trigger}'is null,'Staff-only trigger never supplies the member context');
select pg_temp.ok((select why#>>'{alarm,reading,systolic}'from public.zoe_runs where id='ec1e0000-0000-4000-8000-000000000003')='198','Staff-only snapshot survives the reading correction');
select pg_temp.ok(pg_temp.alarm()#>>'{memberClear,readingClearReason}'='corrected_reading','Correction clear remains eligible across an ordinary conversation answer');
-- Real finish validation uses the same effective window; no receipt to bypass wording holds.
select pg_temp.ok(public.zoe_run_finish('ec1e0000-0000-4000-8000-000000000004',jsonb_build_object(
 'outcome','summary_only','reason','member_cleared_urgent_window','summary','Synthetic clear after conversation.',
 'provider','none','model','none','tier','none','tierReason','not_routed','guardReasons','[]'::jsonb,'events','[]'::jsonb,'memberClearEnabled',true,
 'memberClear',jsonb_build_object('startedAt',pg_temp.alarm()#>>'{memberClear,startedAt}',
  'readingId',pg_temp.alarm()#>>'{memberClear,readingId}','readingVersion',pg_temp.alarm()#>>'{memberClear,readingVersion}','reason','corrected_reading')))->>'ok'='true','Clear can finish across ordinary conversation answer');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.member_cleared_urgent'),'Durable clear was written');
-- A fresh model alarm after a member clear belongs to that new member window, even when its acknowledgement was held.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 values('ec1e0000-0000-4000-8000-000000000011','ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001',4,0,0,current_date,'finished','discarded','urgent_health_answer_model',clock_timestamp());
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind,created_at)
 values('ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001','ec1e0000-0000-4000-8000-000000000011',4,'Synthetic fresh model alarm.','en','noreon.rules','synthetic','urgent',clock_timestamp());
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
 values('ec1e0000-0000-4000-8000-000000000010','ec1e0000-0000-4000-8000-000000000002','ec1e0000-0000-4000-8000-000000000001',5,0,0,current_date,'started');
select pg_temp.ok((public.zoe_run_alarm_window(array['ec1e0000-0000-4000-8000-000000000010'::uuid])->0)#>>'{memberClear,openedBy}'='model','Post-clear provenance belongs to the fresh model alarm');
select pg_temp.ok((public.zoe_run_alarm_window(array['ec1e0000-0000-4000-8000-000000000010'::uuid])->0)#>>'{memberClear,trigger}'is null,'No trigger from the previous cleared window leaks into the new alarm');

-- Real finish -> audit -> alarm-window round trips, without a staff rationale write.
-- Removing the trigger write/read must break these checks, rather than only a source-text assertion.
do $$declare m uuid;c uuid;opener uuid;followup uuid;reading uuid;later uuid;has_reading boolean;payload jsonb;snapshot jsonb;returned jsonb;measured timestamptz:=clock_timestamp()-interval '20 minutes';begin
 for has_reading in select unnest(array[true,false])loop
  m:=gen_random_uuid();c:=gen_random_uuid();opener:=gen_random_uuid();followup:=gen_random_uuid();reading:=gen_random_uuid();
  insert into auth.users(id)values(m);
  insert into public.patient_clinical_cases(user_id)values(m);
  insert into public.conversations(id,member_id)values(c,m);
  insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)
   values(c,1,m,case when has_reading then 'I feel weak'else 'I have chest pain'end,'authenticated_member',gen_random_uuid());
  if has_reading then
   insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,measured_at)
    values(reading,m,gen_random_uuid(),198,106,measured);
  end if;
  insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
   values(opener,c,m,1,0,0,current_date,'started');
  payload:=jsonb_build_object('outcome','discarded','reason','urgent_route_no_model_call','answer','Synthetic urgent answer.',
   'language','en','provider','none','model','none','tier','none','tierReason','not_routed','guardReasons','[]'::jsonb,'events','[]'::jsonb,'memberClearEnabled',true,
   'alarmTrigger',jsonb_build_object('rules',case when has_reading then '["bp_crisis_reading","RF-03"]'::jsonb else '["S-CHEST-EN-1","RF-01"]'::jsonb end,
    'messageHash',repeat('a',64),'symptom',case when has_reading then 'fatigue'else 'chest_pain'end,
    'reading',case when has_reading then jsonb_build_object('systolic',198,'diastolic',106,'id',reading,'version','123','measuredAt',measured,'modelText','Must not escape')end,
    'modelText','Must not escape'),'modelText','Must not escape');
  perform pg_temp.ok(public.zoe_run_finish(opener,payload)->>'ok'='true','Alarm finish succeeds');
  select detail->'trigger'into snapshot from public.conversation_audit where conversation_id=c and kind='zoe.alarm_trigger';
  perform pg_temp.ok(snapshot is not null,'Finish stores a member-safe trigger in audit');
  perform pg_temp.ok(snapshot->>'kind'=case when has_reading then 'saved_reading'else 'symptom_words'end,'Trigger kind is stored');
  perform pg_temp.ok(snapshot::text not like '%Must not escape%','No model text is stored in the trigger');
  perform pg_temp.ok((select why is null from public.zoe_runs where id=opener),'Trigger does not depend on the staff rationale');
  perform public.zoe_run_finish(opener,payload);
  perform pg_temp.ok((select count(*)=1 from public.conversation_audit where conversation_id=c and kind='zoe.alarm_trigger'),'Finish replay cannot duplicate the trigger');
  if has_reading then
   update public.patient_measurements set systolic=117,diastolic=91,measured_at=clock_timestamp()where id=reading;
  end if;
  insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state)
   values(followup,c,m,2,0,0,current_date,'started');
  returned:=public.zoe_run_alarm_window(array[followup])#>'{0,memberClear,trigger}';
  perform pg_temp.ok(returned=snapshot,'Alarm window returns exactly the stored trigger');
  if has_reading then
   perform pg_temp.ok(returned#>>'{reading,systolic}'='198'and returned#>>'{reading,diastolic}'='106'
    and(returned#>>'{reading,measuredAt}')::timestamptz=measured,'Reading values and date remain those that opened the alarm');
  else
   perform pg_temp.ok(returned->'rules'?'RF-01'and returned->>'symptom'='chest_pain','Chest-pain trigger is returned without a reading');
  end if;
  -- A repeated safety reminder keeps the trigger; a fresh alarm without facts must not borrow it.
  later:=gen_random_uuid();
  insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
   values(later,c,m,3,0,0,current_date,'finished','discarded','urgent_in_window_no_model_call',clock_timestamp());
  insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
   values(c,m,later,3,'Synthetic repeated reminder.','en','noreon.rules','synthetic','urgent');
  perform pg_temp.ok(public.zoe_run_alarm_window(array[followup])#>'{0,memberClear,trigger}'=snapshot,'A repeated reminder preserves the actual trigger');
  later:=gen_random_uuid();
  insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
   values(later,c,m,4,0,0,current_date,'finished','discarded','urgent_route_no_model_call',clock_timestamp());
  insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
   values(c,m,later,4,'Synthetic fresh alarm with missing facts.','en','noreon.rules','synthetic','urgent');
  perform pg_temp.ok(public.zoe_run_alarm_window(array[followup])#>>'{0,memberClear,trigger}'is null,'A fresh alarm with missing facts uses the fallback instead of older facts');
 end loop;
end$$;
select 'Zoe alarm conversation SQL checks passed.';
rollback;
