-- A blood pressure reading through a verified actor (20261030131500): the service entry points follow the same rules as the
-- session ones, only the service role reaches them, one member's week is not another's, and the session paths still work.
-- A typed reading may open only its own card after a health answer, also at the same-day level, and never after an urgent or other forwarded one.
-- Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.as_user(m text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);end$$;
create function pg_temp.save(m text,sub text,s int,d int,p int,at timestamptz)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.member_measurement_record_for(m::uuid,sub::uuid,s,d,p,at);reset role;return j;end$$;
create function pg_temp.week(m text,w text,slot text,sub text,s int,d int,at timestamptz)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.bp_week_record_for(m::uuid,w::uuid,slot,sub::uuid,s,d,null,at);reset role;return j;end$$;
create function pg_temp.reads(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.member_bp_read_for(m::uuid);reset role;return j;end$$;
create function pg_temp.post(m text,rid text,kind text,seq bigint,snap jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_post(m::uuid,rid::uuid,kind,'typed',seq,snap);reset role;return j;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role,anon;

-- Members A and B are complete; C has no assessment. Telegram eligibility needs a confirmed phone and a member case.
insert into auth.users(id,phone,phone_confirmed_at)values('af000000-0000-4000-8000-000000000001','37499083001',now()),('af000000-0000-4000-8000-000000000002','37499083002',now()),('af000000-0000-4000-8000-000000000003','37499083003',now());
insert into public.patient_clinical_cases(user_id)values('af000000-0000-4000-8000-000000000001'),('af000000-0000-4000-8000-000000000002'),('af000000-0000-4000-8000-000000000003');
update public.profiles set display_name='Fictional',birth_date='1970-01-01',biological_sex='male' where id in('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-000000000002','af000000-0000-4000-8000-000000000003');
insert into public.patient_consents(user_id,version)values('af000000-0000-4000-8000-000000000001','patient-pilot-v1'),('af000000-0000-4000-8000-000000000002','patient-pilot-v1'),('af000000-0000-4000-8000-000000000003','patient-pilot-v1');
insert into public.patient_assessments(user_id)values('af000000-0000-4000-8000-000000000001'),('af000000-0000-4000-8000-000000000002');
update public.bp_week_settings set enabled=true where singleton;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-cards',3600,600,60,100,false,true)
 on conflict(singleton)do update set version=excluded.version;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;

-- Only the service role reaches the new entry points; the bodies are nobody's.
do $$begin
 perform pg_temp.as_user('af000000-0000-4000-8000-000000000001');
 set local role authenticated;
 begin perform public.member_measurement_record_for('af000000-0000-4000-8000-000000000001',gen_random_uuid(),150,95,null,now());raise exception 'FAIL: a member reached the service entry';exception when insufficient_privilege then null;end;
 begin perform public.member_bp_read_for('af000000-0000-4000-8000-000000000002');raise exception 'FAIL: a member read through the service entry';exception when insufficient_privilege then null;end;
 begin perform public._record_patient_measurement('af000000-0000-4000-8000-000000000001',gen_random_uuid(),150,95,null,now());raise exception 'FAIL: a member reached the body';exception when insufficient_privilege then null;end;
 begin perform public._bp_week_record('af000000-0000-4000-8000-000000000001',gen_random_uuid(),'morning',gen_random_uuid(),150,95,null,now());raise exception 'FAIL: a member reached the week body';exception when insufficient_privilege then null;end;
 reset role;
 perform pg_temp.as_service();
 set local role service_role;
 begin perform public._record_patient_measurement('af000000-0000-4000-8000-000000000001',gen_random_uuid(),150,95,null,now());raise exception 'FAIL: the service role reached the body';exception when insufficient_privilege then null;end;
 reset role;
end$$;

-- The reading: saved once for the member the channel verified, the same rules, a plain status for each refusal.
select pg_temp.ok(pg_temp.save('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-0000000000a1',150,95,70,now()-interval '1 minute')->>'status'='saved','saved');
select pg_temp.ok((select count(*)=1 from public.patient_measurements where user_id='af000000-0000-4000-8000-000000000001'),'one row');
insert into kv select 'at',to_jsonb(measured_at)from public.patient_measurements where user_id='af000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.save('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-0000000000a1',150,95,70,(select (v#>>'{}')::timestamptz from kv where k='at'))->>'status'='saved','a replay is the same reading');
select pg_temp.ok((select count(*)=1 from public.patient_measurements where user_id='af000000-0000-4000-8000-000000000001'),'still one row');
select pg_temp.ok(pg_temp.save('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-0000000000a1',151,95,70,(select (v#>>'{}')::timestamptz from kv where k='at'))->>'status'='conflict','other numbers under one submission');
select pg_temp.ok(pg_temp.save('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-0000000000a2',95,150,null,now())->>'status'='invalid','lower above upper');
select pg_temp.ok(pg_temp.save('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-0000000000a3',150,95,null,now()+interval '1 hour')->>'status'='invalid','a reading in the future');
select pg_temp.ok(pg_temp.save('af000000-0000-4000-8000-000000000003','af000000-0000-4000-8000-0000000000a4',150,95,null,now())->>'status'='not-member','no assessment, no reading');
select pg_temp.ok(pg_temp.save('af000000-0000-4000-8000-0000000000ff','af000000-0000-4000-8000-0000000000a5',150,95,null,now())->>'status'='disabled','not an eligible member');

-- The read gives this member's newest reading and nobody else's.
select pg_temp.ok((pg_temp.reads('af000000-0000-4000-8000-000000000001')#>>'{latest,systolic}')='150','the newest reading');
select pg_temp.ok(pg_temp.reads('af000000-0000-4000-8000-000000000002')->'latest'='null'::jsonb,'nothing of anyone else');
select pg_temp.ok(pg_temp.reads('af000000-0000-4000-8000-0000000000ff')#>>'{week,enabled}'='false','an ineligible member reads as off');

-- The week: only the member's own, only today, into the slot asked for, once.
insert into public.bp_weeks(id,member_id,starts_on,morning_time,evening_time,started_by,started_by_role)
 values('af000000-0000-4000-8000-0000000000b1','af000000-0000-4000-8000-000000000001',(clock_timestamp()at time zone 'Asia/Yerevan')::date,'08:00','20:00','af000000-0000-4000-8000-000000000001','member');
select pg_temp.ok(pg_temp.week('af000000-0000-4000-8000-000000000002','af000000-0000-4000-8000-0000000000b1','morning','af000000-0000-4000-8000-0000000000c1',150,95,now())->>'status'='not-found','another member\''s week');
select pg_temp.ok(pg_temp.week('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-0000000000b1','morning','af000000-0000-4000-8000-0000000000c2',150,95,now()-interval '1 minute')->>'status'='saved','saved into the week');
select pg_temp.ok((select count(*)=1 from public.bp_week_readings where week_id='af000000-0000-4000-8000-0000000000b1'),'one week reading');
select pg_temp.ok(pg_temp.week('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-0000000000b1','evening','af000000-0000-4000-8000-0000000000c2',150,95,now())->>'status'='conflict','a saved submission in another slot');
select pg_temp.ok(pg_temp.week('af000000-0000-4000-8000-000000000001','af000000-0000-4000-8000-0000000000b1','morning','af000000-0000-4000-8000-0000000000c3',150,95,now()-interval '3 days')->>'status'in('not-today','outside-week'),'not measured today');

-- The session paths are unchanged.
do $$declare j jsonb;mid uuid;begin
 perform pg_temp.as_user('af000000-0000-4000-8000-000000000002');
 set local role authenticated;
 mid:=public.record_patient_measurement('af000000-0000-4000-8000-0000000000d1',140,85,null,now()-interval '2 minutes');
 perform pg_temp.ok(mid is not null,'the session save');
 j:=public.bp_week_member_read();
 perform pg_temp.ok(j->>'enabled'='true','the session read');
 begin perform public.bp_week_record('af000000-0000-4000-8000-0000000000b1','morning','af000000-0000-4000-8000-0000000000d2',140,85,null,now());raise exception 'FAIL: another member''s week by session';exception when insufficient_privilege then null;end;
 reset role;
end$$;
do $$begin
 perform pg_temp.as_service();
 set local role service_role;
 begin perform public.bp_week_record('af000000-0000-4000-8000-0000000000b1','morning','af000000-0000-4000-8000-0000000000d3',140,85,null,now());raise exception 'FAIL: the session entry took a service caller';exception when insufficient_privilege then null;end;
 reset role;
end$$;

-- The button is one of the known actions.
select pg_temp.ok((select pg_get_constraintdef(oid)like '%bp_save%' from pg_constraint where conname='zoe_chat_card_intents_action_check'),'bp_save is a button');

-- A typed reading after each kind of Zoe run.
insert into public.conversations(id,member_id)values('af000000-0000-4000-8000-0000000000e1','af000000-0000-4000-8000-000000000001');
create function pg_temp.say(seq bigint,outcome text,reason text,fwd text default null)returns void language plpgsql as $$begin
 insert into public.conversation_messages(conversation_id,seq,author_id,request_id,source,body)
  values('af000000-0000-4000-8000-0000000000e1',seq,'af000000-0000-4000-8000-000000000001',gen_random_uuid(),'telegram_member','150/95');
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,forward,spend_day,finished_at)
  values('af000000-0000-4000-8000-0000000000e1','af000000-0000-4000-8000-000000000001',seq,0,0,'finished',outcome,reason,fwd,current_date,clock_timestamp());
end$$;
create function pg_temp.typed(rid text,seq bigint,kind text,typed boolean)returns text language sql as $$
 select coalesce(pg_temp.post('af000000-0000-4000-8000-000000000001',rid,kind,seq,case when kind='bp'and typed then '{"v":1,"week":null,"typed":{"systolic":150,"diastolic":95,"pulse":null,"measuredAt":"2026-10-30T04:00:00+00:00"}}'::jsonb
  when kind='bp'then '{"v":1,"week":null}'::jsonb else '{"v":1}'::jsonb end)->>'code','posted')
$$;
select pg_temp.say(1,'answered','health_answer_passed_guards');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000f3',1,'bp',true)='posted','a card may follow a health answer that passed its guards');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000f4',1,'bp',true)='not_cleared','once per message');
select pg_temp.say(2,'answered','health_answer_passed_guards','auto');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000f5',2,'bp',true)='not_cleared','not after an answer forwarded automatically');
select pg_temp.say(3,'discarded','same_day_floor_doctor_mode');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000f6',3,'bp',true)='not_cleared','not after a same-day line');
select pg_temp.say(4,'discarded','urgent_route_no_model_call');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000f7',4,'bp',true)='not_cleared','not after the 103 route');
select pg_temp.say(5,'answered','health_answer_emergency_not_confirmed');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000f8',5,'bp',true)='not_cleared','not after an emergency answer that was not confirmed');
create function pg_temp.health_route(p_seq bigint,p_urgency text,p_reason text)returns void language plpgsql as $$declare r public.zoe_runs;begin
 select * into strict r from public.zoe_runs where conversation_id='af000000-0000-4000-8000-0000000000e1'and message_seq=p_seq;
 perform public._zoe_run_events(r,jsonb_build_array(
  jsonb_build_object('name','zoe.route','outcome','allow','reason',r.reason_code,'rule','zoe.pipeline','ruleVersion','synthetic-cards','actor','system',
   'attributes',jsonb_build_object('noreon.zoe.health.urgency',p_urgency,'noreon.zoe.health.forward_reason',p_reason))));
end$$;
-- A BP card may follow an answer at the same-day level that passed its guards; no other card, and no other automatic forward.
select pg_temp.say(40,'answered','health_answer_passed_guards','auto');select pg_temp.health_route(40,'same_day','same_day');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000f9',40,'side_effect',false)='not_cleared','same-day: no other card');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000fa',40,'bp',true)='posted','same-day: the reading card');
select pg_temp.say(41,'answered','health_answer_passed_guards','auto');select pg_temp.health_route(41,'same_day','same_day');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000fb',41,'bp',false)='posted','same-day: the empty BP card too');
select pg_temp.say(42,'answered','health_answer_passed_guards','auto');select pg_temp.health_route(42,'planned','self_harm');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000fc',42,'bp',true)='not_cleared','never after a self-harm forward');
select pg_temp.say(50,'answered','health_answer_passed_guards','asked');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000e2',50,'side_effect',false)='posted','after an answer that only asks about forwarding');
select pg_temp.say(51,'answered','health_answer_passed_guards','member_yes');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000e3',51,'dose',false)='not_cleared','not once the member has sent it on');
select pg_temp.say(52,'answered','health_answer_passed_guards');update public.zoe_runs set injection_detected=true where message_seq=52;
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000e4',52,'dose',false)='not_cleared','not after an injection attempt');
-- Numbers alone: the run ends with no language and no reply. Only the card that shows them back may follow.
select pg_temp.say(53,'discarded','language_not_supported');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000e5',53,'dose',false)='not_cleared','no other card after numbers alone');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000e6',53,'bp',false)='not_cleared','nor a BP card with nothing to show back');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000e7',53,'bp',true)='posted','the reading card follows it');
update public.zoe_runs set injection_detected=true where message_seq=53;
select pg_temp.say(54,'discarded','language_not_supported');update public.zoe_runs set injection_detected=true where message_seq=54;
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000e8',54,'bp',true)='not_cleared','not with an injection mark');
select pg_temp.say(60,'chatted','chat_reply_passed_guards');
select pg_temp.ok(pg_temp.typed('af000000-0000-4000-8000-0000000000f9',60,'bp',true)='posted','and after ordinary chat, as any card');

\echo 'check-zoe-cards-bp: all passed'
rollback;
