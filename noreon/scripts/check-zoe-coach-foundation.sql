-- Zoe coach C0 (20261020103406; COACH_SPEC §8.2-8.4, §8.8). Through the real functions: zoe_coach_blocked and each of its
-- reasons, the one quiet rule, the coach_events state machine and its caps, zoe_coach_claim refusing while inbound work is
-- pending, publication refused when a member message arrived after the claim (and that message then claimed by the
-- inbound path), the inbound finish refusing a coach run, the delivery-time check at the Telegram claim, cancel on consent
-- withdrawal, pause, takeover and switch-off, the new consent kinds, and RLS as the member, the doctor and another member.
-- Synthetic, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1c00000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1c00000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;exception when insufficient_privilege then return true;end$$;
create function pg_temp.svc(q text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;execute 'select ('||q||')::jsonb' into j;reset role;return j;end$$;
create function pg_temp.mem(n int,q text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n,case when n>=10 then 'password' else 'otp' end);set local role authenticated;execute 'select ('||q||')::jsonb' into j;reset role;return j;end$$;
create function pg_temp.send(member int,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text',txt));reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: message not received: %',j;end if;return j;end$$;
create function pg_temp.why(member int)returns text language sql as $$select public._zoe_coach_block_reason(pg_temp.u(member))$$;
create function pg_temp.ev(member int,k text default 'checkin')returns public.coach_events language sql as $$select * from public.coach_events where member_id=pg_temp.u(member)and kind=k$$;
create function pg_temp.sched(member int,k text default 'checkin')returns uuid language sql as $$
 select(pg_temp.svc(format('public.zoe_coach_schedule(%L,%L,clock_timestamp())',pg_temp.u(member),k))->>'eventId')::uuid$$;
-- Retry fixtures belong to tomorrow's week but are eligible now, even on Sunday. Keep sched for the scheduling checks.
create function pg_temp.sched_retry(member int,k text default 'checkin')returns uuid language plpgsql as $$declare e uuid;begin
 e:=(pg_temp.svc(format('public.zoe_coach_schedule(%L,%L,now()+interval ''1 day'')',pg_temp.u(member),k))->>'eventId')::uuid;
 perform public._zoe_coach_move(e,'deferred','synthetic',now());return e;end$$;
create function pg_temp.claim()returns jsonb language sql as $$select pg_temp.svc('public.zoe_coach_claim(10)')$$;
create function pg_temp.job(member int)returns uuid language sql as $$select(x->>'runId')::uuid from jsonb_array_elements(pg_temp.claim()->'jobs')x where(x->>'memberId')::uuid=pg_temp.u(member)$$;
create function pg_temp.publish(run uuid,body text default 'Synthetic weekly check-in. How did the week go?')returns jsonb language sql as $$
 select pg_temp.svc(format('public.zoe_coach_finish(%L,%L::jsonb)',run,jsonb_build_object('outcome','publish','body',body,'language','en','provider','vercel.ai_gateway',
  'model','anthropic/claude-sonnet-5.5','configVersion','coach-c0-check','costUsd',0.01,'usage',jsonb_build_object('inputTokens',800,'outputTokens',120),'latencyMs',900)))$$;
create function pg_temp.due(member int,k text default 'checkin')returns void language sql as $$
 update public.coach_events set retry_at=clock_timestamp()-interval '1 second'where member_id=pg_temp.u(member)and kind=k and state='deferred'$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,anon,service_role;
create function pg_temp.k(key text)returns uuid language sql as $$select(v#>>'{}')::uuid from kv where k=key$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- People: members 01 (Telegram), 02, 03 (doctor 11), 04 (doctor 12); doctors 11, 12.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990410'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,4,11,12,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,3,4,11,12,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic coach clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.u(11),'doctor','Dr Coach One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Coach Two',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Coach');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.u(1),pg_temp.u(11)),(pg_temp.u(2),pg_temp.u(11)),(pg_temp.u(3),pg_temp.u(11)),(pg_temp.u(4),pg_temp.u(12));
update public.profiles set locale='en',display_name='Coach Synthetic'where id in(pg_temp.u(1),pg_temp.u(2),pg_temp.u(3),pg_temp.u(4));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-coach',3600,600,60,40,false,true,true)on conflict(singleton)do update set version=excluded.version,intake_max_messages=40,app_chat_enabled=true,delivery_enabled=true;
-- Published plans for 01, 03 and 04 (02 has none).
insert into public.patient_care_plans(id,user_id,clinician,instructions)select pg_temp.u(30+n),pg_temp.u(n),'Dr Coach','Synthetic plan.'from unnest(array[1,3,4])n;
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft)
 select pg_temp.u(n),pg_temp.u(30+n),gen_random_uuid(),case when n=4 then pg_temp.u(12)else pg_temp.u(11)end,n,'synthetic','{}','{}','{"explanation":"Synthetic."}'from unnest(array[1,3,4])n;
-- Never quiet for these members (start = end), so the checks do not depend on the hour they run at.
insert into public.patient_reminder_preferences(user_id,preferences)select pg_temp.u(n),'{"quietStart":"03:00","quietEnd":"03:00"}'from unnest(array[1,2,3,4])n;
-- Telegram for member 01.
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_coach',9031,600,'consent-coach')on conflict do nothing;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.u(1),'member','fictional-coach-01',public._telegram_account_ref(s),'+374990410001','5559301',1 from public.telegram_channel_settings s where s.singleton;
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values
 ('member.zoe_coach_teaser',1,'en','Synthetic teaser, no health words.',true,'Synthetic check'),('member.zoe_coach_teaser',1,'hy','Synthetic teaser HY.',true,'Synthetic check');
update public.system_message_templates set approved=true,approval_note='Synthetic check'where template_id='member_notice.open_label';
-- Zoe on, with real-call evals so free mode can switch on.
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',staging_ai_mode=true,
 coach_window_start='00:00',coach_window_end='23:59:59.999999';
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.u(14)from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set conversational_replies_enabled=true;
update public.zoe_settings set health_answers_enabled=true;
insert into public.zoe_consents(member_id,kind,granted,wording_version)select pg_temp.u(n),'zoe_reads_messages',true,'zoe-consent-draft-1'from unnest(array[1,2,3,4])n;

-- 1. Off by default; the new consent kinds have no wording yet ---------------------------------------------------------
select pg_temp.ok((select not coach_enabled and coach_checkins_wording_version is null and memory_wording_version is null from public.zoe_settings),'coach off, no coach wordings');
select pg_temp.ok(pg_temp.why(1)='coach_off'and public.zoe_coach_blocked(pg_temp.u(1)),'coach_off blocks');
select pg_temp.ok(pg_temp.mem(1,$q$public.zoe_coach_consent_set('zoe_coach_checkins',true,'coach-checkins-draft-1','settings')$q$)->>'code'='unavailable','no wording: the grant is refused');
select pg_temp.ok(pg_temp.mem(1,$q$public.zoe_consent_set('zoe_coach_checkins',true,'zoe-consent-draft-1','settings')$q$)->>'code'='invalid','the existing consent function does not take the coach kinds');
update public.zoe_settings set coach_enabled=true,coach_checkins_wording_version='coach-checkins-draft-1',memory_wording_version='zoe-memory-draft-1';
select pg_temp.ok(pg_temp.why(1)='no_coach_consent','consent missing');
select pg_temp.ok(pg_temp.mem(1,$q$public.zoe_coach_consent_set('zoe_coach_checkins',true,'coach-checkins-draft-0','settings')$q$)->>'code'='stale','an old wording is refused');
select pg_temp.ok(pg_temp.mem(n,$q$public.zoe_coach_consent_set('zoe_coach_checkins',true,'coach-checkins-draft-1','prompt')$q$)->>'changed'='true','coach consent granted')from unnest(array[1,2,3,4])n;
select pg_temp.ok((select kind='zoe_coach_checkins'and granted and wording_version='coach-checkins-draft-1'and source='prompt'from public.zoe_consents where member_id=pg_temp.u(1)order by id desc limit 1),'recorded with the kind wording');
select pg_temp.ok(pg_temp.why(1)is null and not public.zoe_coach_blocked(pg_temp.u(1)),'member 01 is not blocked');
select pg_temp.ok(public._zoe_coach_block_reason(pg_temp.u(1),'memory')='no_memory_consent','memory needs its own consent');
select pg_temp.ok(pg_temp.mem(1,$q$public.zoe_coach_consent_set('zoe_memory',true,'zoe-memory-draft-1','settings')$q$)->>'granted'='true','memory consent granted');
select pg_temp.ok(public._zoe_coach_block_reason(pg_temp.u(1),'memory')is null,'memory consent separate');
select pg_temp.ok(pg_temp.why(2)='no_plan','no published plan');

-- 2. Each blocking state, on member 03 ------------------------------------------------------------------------------------
select pg_temp.ok(pg_temp.why(3)is null,'03 clear');
update public.zoe_settings set health_answers_enabled=false;
select pg_temp.ok(pg_temp.why(3)='free_mode_off','free mode off');
update public.zoe_settings set health_answers_enabled=true;
insert into public.conversations(member_id)values(pg_temp.u(3));
insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,reason)select id,pg_temp.u(3),true,pg_temp.u(11),'doctor_reply'from public.conversations where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)='doctor_takeover','doctor takeover');
update public.zoe_doctor_mode set doctor_mode=false,reason='hand_back'where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)is null,'handed back: clear');
insert into public.zoe_symptom_intakes(conversation_id,member_id,sheet_id,sheet_version,language,started_seq,last_seq,record)
 select c.id,pg_temp.u(3),sh.sheet_id,sh.version,'en',1,1,'{}'from public.conversations c,(select * from public.zoe_symptom_sheets limit 1)sh where c.member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)='intake_active','intake active');
delete from public.zoe_symptom_intakes where member_id=pg_temp.u(3);
insert into public.member_safety_holds(member_id,kind,source_field,source_value)values(pg_temp.u(3),'exercise_pause','q10.syncope','exertion');
select pg_temp.ok(pg_temp.why(3)='safety_hold','safety hold');
update public.member_safety_holds set cleared_at=now(),cleared_by=pg_temp.u(11),cleared_by_role='doctor'where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)is null,'hold cleared: clear');
insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref)values(pg_temp.u(3),'zoe','zoe_urgent_route','zoe.urgent_route','1','urgent:synthetic');
select pg_temp.ok(pg_temp.why(3)='care_alert_open','an open care alert');
update public.care_alerts set state='acknowledged',acknowledged_by=pg_temp.u(11),acknowledged_at=now()where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)='urgent_pause','acknowledged, but within 7 days of a 103 route');
select pg_temp.ok(pg_temp.denied($q$select pg_temp.mem(3,'public.doctor_zoe_coach_resume(''e1c00000-0000-4000-8000-000000000003'')')$q$),'a member cannot resume');
select pg_temp.ok(pg_temp.denied($q$select pg_temp.mem(12,'public.doctor_zoe_coach_resume(''e1c00000-0000-4000-8000-000000000003'')')$q$),'another doctor cannot resume');
select pg_temp.ok(pg_temp.mem(11,$q$public.doctor_zoe_coach_resume('e1c00000-0000-4000-8000-000000000003')$q$)->>'ok'='true','the assigned doctor resumes');
select pg_temp.ok(pg_temp.why(3)is null,'resumed: clear');
-- An urgent answer after the resume pauses again.
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 select pg_temp.u(40),id,pg_temp.u(3),900,0,0,current_date,'finished','discarded','synthetic',now()from public.conversations where member_id=pg_temp.u(3);
insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)
 select id,pg_temp.u(3),pg_temp.u(40),900,'Synthetic urgent text.','en','noreon.rules','zoe-urgent-fixed','urgent'from public.conversations where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)='urgent_window','an urgent answer after the resume: the 103 window');
select pg_temp.mem(11,$q$public.doctor_zoe_coach_resume('e1c00000-0000-4000-8000-000000000003')$q$);
select pg_temp.ok(pg_temp.why(3)='urgent_window','C0-02: a doctor resume never lifts the open 103 window');
update public.zoe_member_answers set created_at=now()-interval '3 hours'where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)is null,'window over, urgent answer before the latest resume: clear');
update public.zoe_coach_member_state set doctor_resumed_at=now()-interval '4 hours'where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)='urgent_pause','window over, no resume since: the 7-day pause');
update public.zoe_member_answers set created_at=now()-interval '8 days'where member_id=pg_temp.u(3);
update public.care_alerts set created_at=now()-interval '8 days',last_seen_at=now()-interval '8 days'where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)is null,'8 days later: clear');
insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at,reserved,estimate_usd,cost_usd)
 select id,pg_temp.u(3),901,0,0,(clock_timestamp()at time zone 'Asia/Yerevan')::date,'finished','answered','synthetic',now(),true,3,3 from public.conversations where member_id=pg_temp.u(3);
select pg_temp.ok(pg_temp.why(3)='spend_cap'and public._zoe_coach_block_reason(pg_temp.u(3),'checkin',false)is null,'the member spend cap blocks new calls only');
update public.zoe_runs set spend_day=current_date-2 where member_id=pg_temp.u(3)and message_seq=901;
-- The same-day pause (last: trace events are append-only, so member 03 stays paused from here).
insert into public.conversation_trace_events(occurred_at,member_id,subject_kind,subject_id,step,name,outcome,actor_kind,attributes)
 values(now()-interval '73 hours',pg_temp.u(3),'zoe_run',gen_random_uuid()::text,'zoe','zoe.route','allow','system','{"noreon.zoe.health.urgency":"same_day"}');
select pg_temp.ok(pg_temp.why(3)is null,'a same-day route 73 hours ago: clear');
insert into public.conversation_trace_events(member_id,subject_kind,subject_id,step,name,outcome,actor_kind,attributes)
 values(pg_temp.u(3),'zoe_run',gen_random_uuid()::text,'zoe','zoe.route','allow','system','{"noreon.zoe.health.urgency":"same_day"}');
select pg_temp.ok(pg_temp.why(3)='same_day_pause','a same-day route in 72 hours');

-- 3. The quiet rule --------------------------------------------------------------------------------------------------------
update public.zoe_settings set coach_window_start='10:00',coach_window_end='20:00';
create function pg_temp.at(h text)returns timestamptz language sql as $$select(current_date::text||' '||h)::timestamp at time zone 'Asia/Yerevan'$$;
select pg_temp.ok(public._zoe_coach_quiet(pg_temp.u(2),pg_temp.at('09:59'))and not public._zoe_coach_quiet(pg_temp.u(2),pg_temp.at('10:00'))
 and not public._zoe_coach_quiet(pg_temp.u(2),pg_temp.at('19:59'))and public._zoe_coach_quiet(pg_temp.u(2),pg_temp.at('20:00')),'the 10:00-20:00 coach window');
update public.patient_reminder_preferences set preferences='{"quietStart":"12:00","quietEnd":"14:00"}'where user_id=pg_temp.u(2);
select pg_temp.ok(public._zoe_coach_quiet(pg_temp.u(2),pg_temp.at('13:00'))and not public._zoe_coach_quiet(pg_temp.u(2),pg_temp.at('14:00')),'and the member''s own quiet hours');
select pg_temp.ok(public._zoe_coach_next_send(pg_temp.u(2),pg_temp.at('12:10'))=pg_temp.at('14:00'),'next slot after the member''s quiet hours');
select pg_temp.ok(public._zoe_coach_next_send(pg_temp.u(2),pg_temp.at('21:00'))=pg_temp.at('10:00')+interval '1 day','next slot is tomorrow 10:00');
delete from public.patient_reminder_preferences where user_id=pg_temp.u(2);
select pg_temp.ok(public._zoe_coach_quiet(pg_temp.u(2),pg_temp.at('12:00'))is false,'default member quiet hours 22:00-07:00 sit outside the window');
update public.zoe_settings set coach_window_start='00:00',coach_window_end='23:59:59.999999';

-- 4. State machine, publication and delivery (member 01) ----------------------------------------------------------------
select pg_temp.ok(pg_temp.denied($q$select public.zoe_coach_claim(1)$q$)and pg_temp.denied($q$select pg_temp.mem(1,'public.zoe_coach_claim(1)')$q$),'claim: service role only');
select pg_temp.ok(pg_temp.sched(1)is not null and(pg_temp.ev(1)).state='scheduled','scheduled');
select pg_temp.ok(pg_temp.svc(format('public.zoe_coach_schedule(%L,''checkin'',clock_timestamp())',pg_temp.u(1)))->>'replayed'='true','one row per member, kind and week');
select pg_temp.ok((pg_temp.ev(1)).event_key='coach-checkin:'||pg_temp.u(1)||':'||public._zoe_coach_iso_week(now()),'the ISO-week key');
insert into kv values('run1',to_jsonb(pg_temp.job(1)));
select pg_temp.ok(pg_temp.k('run1')is not null and(pg_temp.ev(1)).state='generating'and(pg_temp.ev(1)).claimed_member_seq=0,'claimed: generating, no member message yet');
select pg_temp.ok((select kind='coach_checkin'and message_seq is null and state='started'from public.zoe_runs where id=pg_temp.k('run1')),'a coach run with no message_seq');
select pg_temp.ok(jsonb_array_length(pg_temp.claim()->'jobs')=0,'a second sweep claims nothing');
do $$begin update public.coach_events set state='scheduled'where member_id=pg_temp.u(1);raise exception 'FAIL: went back to scheduled';
exception when sqlstate '55000' then null;end$$;
-- The inbound finish refuses a coach run.
do $$begin perform pg_temp.as_service();set local role service_role;
 perform public.zoe_run_finish(pg_temp.k('run1'),jsonb_build_object('outcome','no_output','reason','synthetic'));reset role;raise exception 'FAIL: inbound finish took a coach run';
exception when sqlstate '55000' then reset role;end$$;
select pg_temp.ok((select state='started'from public.zoe_runs where id=pg_temp.k('run1')),'still started');
select pg_temp.ok(pg_temp.svc(format('public.zoe_coach_reserve(%L,0,true,''[]''::jsonb,''low'',''synthetic-local'')',pg_temp.k('run1')))->>'ok'='true','reserved with the same caps');
select pg_temp.ok(pg_temp.svc(format('public.zoe_run_reserve(%L,0,true,''[]''::jsonb,''low'',''synthetic-local'')',pg_temp.k('run1')))->>'code'='run_not_reservable','no double reservation');
select pg_temp.ok(pg_temp.publish(pg_temp.k('run1'))->>'outcome'='published','published');
select pg_temp.ok((pg_temp.ev(1)).state='ready'and(select count(*)=1 from public.zoe_coach_messages where member_id=pg_temp.u(1)),'ready with one text');
select pg_temp.ok((select state='finished'and outcome='published'and kind='coach_checkin'from public.zoe_runs where id=pg_temp.k('run1')),'the coach run is finished as published');
select pg_temp.ok(not exists(select 1 from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id=pg_temp.u(1))
 and not exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(1)),'no member message and no Zoe answer row: the 103 window and approvals are untouched');
select pg_temp.ok(jsonb_array_length(pg_temp.mem(1,'public.zoe_coach_member_status()')->'messages')=1,'the member sees the card');
select pg_temp.ok(jsonb_array_length(pg_temp.mem(3,'public.zoe_coach_member_status()')->'messages')=0,'another member does not');
-- Delivery: queued, then the Telegram claim re-checks.
select pg_temp.ok(pg_temp.svc(format('public.zoe_coach_queue_teaser(%L)',(pg_temp.ev(1)).id))->>'channel'='telegram'and(pg_temp.ev(1)).state='queued','teaser queued');
select pg_temp.ok((select template_id='member.zoe_coach_teaser'and keyboard->>'url'like '%/patient/zoe'from public.telegram_auth_messages where id=(pg_temp.ev(1)).telegram_message_id),'teaser row');
-- Leave room for the one-hour quiet retry, including late Sunday.
update public.coach_events set due_at=now()+interval '1 day'where id=(pg_temp.ev(1)).id;
update public.patient_reminder_preferences set preferences=jsonb_build_object('quietStart',to_char((now()at time zone 'Asia/Yerevan')-interval '1 hour','HH24:MI'),
 'quietEnd',to_char((now()at time zone 'Asia/Yerevan')+interval '1 hour','HH24:MI'))where user_id=pg_temp.u(1);
select pg_temp.ok(pg_temp.svc(format('public.telegram_auth_message_claim(%L,gen_random_uuid())',(pg_temp.ev(1)).telegram_message_id))->>'code'='coach_deferred','quiet now: not sent');
select pg_temp.ok((pg_temp.ev(1)).state='deferred'and(pg_temp.ev(1)).reason='quiet_hours'and(pg_temp.ev(1)).retry_at>now()
 and(select state='held'and reason='coach_deferred'from public.telegram_auth_messages where id=(pg_temp.ev(1)).telegram_message_id),'deferred, teaser held');
select pg_temp.ok(not exists(select 1 from public.telegram_auth_message_attempts a where a.message_id=(pg_temp.ev(1)).telegram_message_id),'no send attempt');
update public.patient_reminder_preferences set preferences='{"quietStart":"03:00","quietEnd":"03:00"}'where user_id=pg_temp.u(1);
select pg_temp.due(1);
select pg_temp.ok(pg_temp.claim()->'redeliver'->0->>'memberId'=pg_temp.u(1)::text and(pg_temp.ev(1)).state='ready','published row back to ready, not regenerated');
select pg_temp.ok((select count(*)=1 from public.zoe_runs where member_id=pg_temp.u(1)and kind='coach_checkin'),'still one coach run');
select pg_temp.ok(pg_temp.svc(format('public.zoe_coach_queue_teaser(%L)',(pg_temp.ev(1)).id))->>'channel'='telegram','re-queued');
select pg_temp.ok(pg_temp.svc(format('public.telegram_auth_message_claim(%L,gen_random_uuid())',(pg_temp.ev(1)).telegram_message_id))->>'ok'='true'
 and(pg_temp.ev(1)).state='sent'and(pg_temp.ev(1)).sent_at is not null,'sent on a clear claim');

-- 5. Caps, and publication refused by a member message after the claim (member 01, nudge) ------------------------------
select pg_temp.sched_retry(1,'nudge');
select pg_temp.ok(jsonb_array_length(pg_temp.claim()->'jobs')=0 and(pg_temp.ev(1,'nudge')).reason='cap_daily'and(pg_temp.ev(1,'nudge')).state='deferred','daily cap: the nudge waits');
-- Match the retry fixture's due date: this send cannot age out before that week's end, even on Sunday.
update public.coach_events set sent_at=now()+interval '1 day'where id=(pg_temp.ev(1)).id;
update public.zoe_settings set coach_daily_max=2,coach_weekly_max=1;select pg_temp.due(1,'nudge');
select pg_temp.ok(jsonb_array_length(pg_temp.claim()->'jobs')=0 and(pg_temp.ev(1,'nudge')).reason='cap_weekly_week_passed'and(pg_temp.ev(1,'nudge')).state='cancelled',
 'weekly cap that cannot free this week: the week is skipped');
update public.coach_events set sent_at=now()where id=(pg_temp.ev(1)).id;
update public.zoe_settings set coach_weekly_max=2;delete from public.coach_events where member_id=pg_temp.u(1)and kind='nudge';select pg_temp.sched_retry(1,'nudge');
insert into kv values('run2',to_jsonb(pg_temp.job(1)));
select pg_temp.ok(pg_temp.k('run2')is not null,'nudge claimed');
select pg_temp.send(1,'Actually my chest feels tight right now');
select pg_temp.ok(pg_temp.publish(pg_temp.k('run2'))->>'reason'='coach_publication_refused_member_message_since_claim','publication refused');
select pg_temp.ok((pg_temp.ev(1,'nudge')).state='deferred'and not exists(select 1 from public.zoe_coach_messages where run_id=pg_temp.k('run2'))
 and(select outcome='discarded'from public.zoe_runs where id=pg_temp.k('run2')),'nothing stored; the run is discarded; the row deferred');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.svc('public.zoe_run_claim(10)'))x where(x->>'memberId')::uuid=pg_temp.u(1)
 and x->'messages'->-1->>'text'='Actually my chest feels tight right now'),'the member message is claimed by the inbound path');
-- While that inbound run is open, the coach claim refuses.
select pg_temp.due(1,'nudge');
select pg_temp.ok(jsonb_array_length(pg_temp.claim()->'jobs')=0 and(pg_temp.ev(1,'nudge')).reason='inbound_run_open','inbound run open: coach waits');
-- An unclaimed member message (member 04): the claim refuses and waits 10 minutes.
select pg_temp.send(4,'Hello');
select pg_temp.sched_retry(4);
select pg_temp.ok(jsonb_array_length(pg_temp.claim()->'jobs')=0 and(pg_temp.ev(4)).reason='inbound_pending'and(pg_temp.ev(4)).retry_at between now()+interval '9 minutes'and now()+interval '11 minutes','unclaimed member message: inbound first');

-- C0-04: a row published yesterday and sent today holds today; a published row not yet sent holds now.
-- (Member 01's message from above: its inbound run finished, and the message a day old, so only the caps decide.)
update public.zoe_runs set state='finished',outcome='answered',reason_code='synthetic',finished_at=now()where member_id=pg_temp.u(1)and kind='inbound'and state='started';
alter table public.conversation_messages disable trigger conversation_messages_immutable;
update public.conversation_messages set created_at=now()-interval '25 hours'where conversation_id=(select id from public.conversations where member_id=pg_temp.u(1));
alter table public.conversation_messages enable trigger conversation_messages_immutable;
delete from public.coach_events where member_id=pg_temp.u(1)and kind='nudge';
update public.zoe_settings set coach_daily_max=1;
alter table public.coach_events disable trigger coach_events_transition;
update public.coach_events set ready_at=now()-interval '1 day',claimed_at=now()-interval '1 day',sent_at=now()where member_id=pg_temp.u(1)and kind='checkin';
alter table public.coach_events enable trigger coach_events_transition;
delete from public.coach_events where member_id=pg_temp.u(1)and kind='nudge';select pg_temp.sched_retry(1,'nudge');
select pg_temp.ok(jsonb_array_length(pg_temp.claim()->'jobs')=0 and(pg_temp.ev(1,'nudge')).reason='cap_daily','C0-04: sent today counts today, whenever it was published');
alter table public.coach_events disable trigger coach_events_transition;
update public.coach_events set state='ready',sent_at=null where member_id=pg_temp.u(1)and kind='checkin';
alter table public.coach_events enable trigger coach_events_transition;
select pg_temp.due(1,'nudge');
select pg_temp.ok(jsonb_array_length(pg_temp.claim()->'jobs')=0 and(pg_temp.ev(1,'nudge')).reason='cap_daily','C0-04: published yesterday, not yet sent: counts now');
delete from public.coach_events where member_id=pg_temp.u(1)and kind='nudge';
-- C0-05: an unsent row from a past week no longer counts; the reaper cancels it and holds nothing back.
alter table public.coach_events disable trigger coach_events_transition;
update public.coach_events set due_at=now()-interval '8 days',ready_at=now()-interval '8 days',claimed_at=now()-interval '8 days'where member_id=pg_temp.u(1)and kind='checkin';
alter table public.coach_events enable trigger coach_events_transition;
select pg_temp.sched_retry(1,'nudge');
select pg_temp.ok((select count(*)=1 from jsonb_array_elements(pg_temp.claim()->'jobs')x where(x->>'memberId')::uuid=pg_temp.u(1)),'C0-05: a stuck row from a past week does not block this week');
select pg_temp.ok((pg_temp.ev(1)).state='cancelled'and(pg_temp.ev(1)).reason='week_passed','C0-05: the stuck row is cancelled at its week end');
-- C0-05: a queued teaser the outbox held is delivered again later, not left counting.
update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=now()where member_id=pg_temp.u(1)and kind='coach_nudge'and state='started';
alter table public.coach_events disable trigger coach_events_transition;
update public.coach_events set state='queued',ready_at=now(),telegram_message_id=(select id from public.telegram_auth_messages order by created_at limit 1)where member_id=pg_temp.u(1)and kind='nudge';
alter table public.coach_events enable trigger coach_events_transition;
update public.telegram_auth_messages set state='held',reason='template_unapproved'where id=(pg_temp.ev(1,'nudge')).telegram_message_id;
select pg_temp.claim();
select pg_temp.ok((pg_temp.ev(1,'nudge')).state='deferred'and(pg_temp.ev(1,'nudge')).reason='redeliver'and(pg_temp.ev(1,'nudge')).retry_at>now(),'C0-05: a held teaser goes back for redelivery');
-- Astra round 3: a prior-week row published 2 days ago and never sent counts in neither cap, even before the reaper reaches it.
delete from public.coach_events where member_id=pg_temp.u(1);
update public.zoe_settings set coach_weekly_max=1;
select pg_temp.sched(1,'checkin');
insert into public.coach_events(event_key,member_id,kind,iso_week,state,due_at,ready_at,claimed_at,claimed_member_seq,conversation_id)
 select 'coach-nudge:'||pg_temp.u(1)||':2000-W02',pg_temp.u(1),'nudge','2000-W02','ready',now()-interval '9 days',now()-interval '2 days',now()-interval '2 days',0,
  (select id from public.conversations where member_id=pg_temp.u(1));
select pg_temp.ok(x.reason is null,'round 3: a stale unsent row from another week does not hold the cap')
 from public.coach_events e,lateral public._zoe_coach_check(e,'claim')x where e.member_id=pg_temp.u(1)and e.iso_week<>'2000-W02';
update public.zoe_settings set coach_weekly_max=2;
-- C0-06: the weekly cap retries when it frees, not a day later.
delete from public.coach_events where member_id=pg_temp.u(1);
update public.zoe_settings set coach_weekly_max=1,coach_daily_max=2;
select pg_temp.sched(1,'checkin');
alter table public.coach_events disable trigger coach_events_transition;
update public.coach_events set state='sent',reason='telegram',ready_at=now()-interval '7 days'+interval '3 minutes',claimed_at=now()-interval '7 days',sent_at=now()-interval '7 days'+interval '3 minutes',
 due_at=now()-interval '7 days',iso_week='2000-W01',event_key='coach-checkin:'||member_id||':2000-W01'where member_id=pg_temp.u(1);
alter table public.coach_events enable trigger coach_events_transition;
select pg_temp.sched_retry(1,'checkin');
select pg_temp.claim();
select pg_temp.ok(x.reason='cap_weekly'and x.retry_at<now()+interval '20 minutes','C0-06: retried in minutes when last week''s row ages out')
 from(select * from public.coach_events where member_id=pg_temp.u(1)and iso_week<>'2000-W01')x;
delete from public.coach_events where member_id=pg_temp.u(1);
update public.zoe_settings set coach_weekly_max=2,coach_daily_max=1;

-- 6. Cancel on state change ------------------------------------------------------------------------------------------------
-- Member 02 gets a plan now (no messages, so never recently active).
insert into public.patient_care_plans(id,user_id,clinician,instructions)values(pg_temp.u(32),pg_temp.u(2),'Dr Coach','Synthetic plan.');
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft)
 values(pg_temp.u(2),pg_temp.u(32),gen_random_uuid(),pg_temp.u(11),2,'synthetic','{}','{}','{}');
insert into public.patient_reminder_preferences(user_id,preferences)values(pg_temp.u(2),'{"quietStart":"03:00","quietEnd":"03:00"}');
create function pg_temp.queued(member int)returns uuid language plpgsql as $$declare run uuid;e uuid;begin
 e:=pg_temp.sched_retry(member);
 run:=pg_temp.job(member);if run is null then raise exception 'FAIL: not claimed: %',pg_temp.ev(member);end if;
 perform pg_temp.publish(run);return e;end$$;
grant execute on function pg_temp.queued(int)to service_role,authenticated;
select pg_temp.queued(2);
select pg_temp.ok((pg_temp.ev(2)).state='ready','02 ready');
select pg_temp.mem(2,$q$public.zoe_coach_consent_set('zoe_coach_checkins',false,'coach-checkins-draft-1','settings')$q$);
select pg_temp.ok((pg_temp.ev(2)).state='cancelled'and(pg_temp.ev(2)).reason='no_coach_consent','withdrawal cancels at once');
select pg_temp.ok(jsonb_array_length(pg_temp.mem(2,'public.zoe_coach_member_status()')->'messages')=0,'and the card is hidden');
select pg_temp.mem(2,$q$public.zoe_coach_consent_set('zoe_coach_checkins',true,'coach-checkins-draft-1','settings')$q$);
-- Pause cancels.
delete from public.coach_events where member_id=pg_temp.u(2);
select pg_temp.queued(2);
select pg_temp.mem(2,'public.zoe_coach_pause(true)');
select pg_temp.ok((pg_temp.ev(2)).state='cancelled'and(pg_temp.ev(2)).reason='paused','pause cancels');
select pg_temp.mem(2,'public.zoe_coach_pause(false)');
delete from public.coach_events where member_id=pg_temp.u(2);
select pg_temp.queued(2);
insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,reason)select id,pg_temp.u(2),true,pg_temp.u(11),'doctor_reply'from public.conversations where member_id=pg_temp.u(2);
select pg_temp.ok((pg_temp.ev(2)).state='cancelled'and(pg_temp.ev(2)).reason='doctor_takeover','takeover cancels');
delete from public.zoe_doctor_mode where member_id=pg_temp.u(2);
delete from public.coach_events where member_id=pg_temp.u(2);
select pg_temp.queued(2);
update public.zoe_settings set health_answers_enabled=false;
select pg_temp.ok((pg_temp.ev(2)).state='cancelled'and(pg_temp.ev(2)).reason='free_mode_off','free mode off cancels');
update public.zoe_settings set health_answers_enabled=true;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.u(2),'member','fictional-coach-02',public._telegram_account_ref(s),'+374990410002','5559302',1 from public.telegram_channel_settings s where s.singleton;
-- Member 02's queued teaser is held when coaching is switched off.
delete from public.coach_events where member_id=pg_temp.u(2);
select pg_temp.queued(2);
select pg_temp.svc(format('public.zoe_coach_queue_teaser(%L)',(pg_temp.ev(2)).id));
select pg_temp.ok((pg_temp.ev(2)).state='queued','02 queued');
-- C0-01: a member message after publication: the Telegram claim does not send the teaser before the inbound path ran.
select pg_temp.send(2,'Actually my chest feels tight right now');
select pg_temp.ok(pg_temp.svc(format('public.telegram_auth_message_claim(%L,gen_random_uuid())',(pg_temp.ev(2)).telegram_message_id))->>'code'='coach_deferred'
 and(pg_temp.ev(2)).reason='inbound_pending'and not exists(select 1 from public.telegram_auth_message_attempts a where a.message_id=(pg_temp.ev(2)).telegram_message_id),
 'C0-01: delivery waits for the inbound path; no send attempt');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.svc('public.zoe_run_claim(10)'))x where(x->>'memberId')::uuid=pg_temp.u(2)),'and the inbound path claims the message');
-- C0-03: a member message older than 24 hours that nobody answered keeps coaching away (the inbound claim no longer takes it).
update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=now()where member_id=pg_temp.u(2)and kind='inbound'and state='started';
delete from public.zoe_runs where member_id=pg_temp.u(2)and kind='inbound';
alter table public.conversation_messages disable trigger conversation_messages_immutable;
update public.conversation_messages set created_at=now()-interval '25 hours'where conversation_id=(select id from public.conversations where member_id=pg_temp.u(2));
alter table public.conversation_messages enable trigger conversation_messages_immutable;
select pg_temp.due(2);
select pg_temp.ok(jsonb_array_length(pg_temp.claim()->'redeliver')=0 and(pg_temp.ev(2)).reason='inbound_unanswered'and(pg_temp.ev(2)).state='deferred','C0-03: an old unanswered message: no coaching');
-- Answered by an inbound run: coaching may go on (member 02's message is covered from here).
insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
 select c.id,pg_temp.u(2),(select max(seq)from public.conversation_messages where conversation_id=c.id),c.version,c.draft_epoch,current_date,'finished','answered','synthetic',now()
 from public.conversations c where c.member_id=pg_temp.u(2);
select pg_temp.due(2);
select pg_temp.ok(pg_temp.claim()->'redeliver'->0->>'memberId'=pg_temp.u(2)::text,'answered: the published row is delivered again');
select pg_temp.svc(format('public.zoe_coach_queue_teaser(%L)',(pg_temp.ev(2)).id));
select pg_temp.ok((pg_temp.ev(2)).state='queued','02 queued again');
update public.zoe_settings set coach_enabled=false;
select pg_temp.ok((pg_temp.ev(2)).state='cancelled'and(select state='held'and reason='coach_cancelled'from public.telegram_auth_messages where id=(pg_temp.ev(2)).telegram_message_id),'switch off cancels and holds the teaser');
update public.zoe_settings set coach_enabled=true;
-- A non-coach message still goes through the previous claim unchanged.
insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body)
 select pg_temp.u(50),'5559301','fictional-coach-01','member.zoe_coach_teaser',1,'en','Synthetic teaser, no health words.';
select pg_temp.ok(pg_temp.svc(format('public.telegram_auth_message_claim(%L,gen_random_uuid())',pg_temp.u(50)))->>'ok'='true','other messages unaffected');

-- 7. RLS and grants: the member, the doctor and another member ------------------------------------------------------------
create function pg_temp.tables_denied(n int)returns boolean language plpgsql as $$begin
 perform pg_temp.as_user(n,'otp');set local role authenticated;
 if not pg_temp.denied('select 1 from public.coach_events')or not pg_temp.denied('select 1 from public.zoe_coach_messages')
  or not pg_temp.denied('select 1 from public.zoe_coach_member_state')then reset role;return false;end if;
 reset role;return true;end$$;
grant execute on function pg_temp.tables_denied(int)to authenticated;
select pg_temp.ok(pg_temp.tables_denied(1)and pg_temp.tables_denied(3)and pg_temp.tables_denied(11),'no direct table access for the member, another member or the doctor');
select pg_temp.ok(pg_temp.mem(11,format('public.doctor_zoe_coach(%L)',pg_temp.u(1)))->>'ok'='true','the assigned doctor reads the coaching state');
select pg_temp.ok(jsonb_array_length(pg_temp.mem(11,format('public.doctor_zoe_coach(%L)',pg_temp.u(2)))->'messages')>=1,'with the texts shown');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.mem(11,format('public.zoe_runs_for_doctor(%L)',pg_temp.u(1)))->'runs')x where x->'messageSeq'='null'::jsonb)
 and exists(select 1 from public.zoe_runs where member_id=pg_temp.u(1)and kind<>'inbound'and state='finished'),'the doctor''s Zoe block lists inbound runs only (its messageSeq is a number)');
select pg_temp.ok(pg_temp.denied(format('select pg_temp.mem(12,%L)',format('public.doctor_zoe_coach(%L)',pg_temp.u(1)))),'another doctor is refused');
select pg_temp.ok(pg_temp.denied(format('select pg_temp.mem(3,%L)',format('public.doctor_zoe_coach(%L)',pg_temp.u(1)))),'another member is refused');
select pg_temp.ok(pg_temp.denied(format('select pg_temp.mem(1,%L)',format('public.doctor_zoe_coach(%L)',pg_temp.u(1)))),'the member is refused the doctor view');
select pg_temp.ok(pg_temp.denied(format('select pg_temp.mem(1,%L)',format('public.zoe_coach_finish(%L,''{}''::jsonb)',pg_temp.k('run1'))))
 and pg_temp.denied(format('select pg_temp.mem(1,%L)',format('public.zoe_coach_schedule(%L,''checkin'',now())',pg_temp.u(1))))
 and pg_temp.denied($q$select pg_temp.mem(1,'public.zoe_coach_blocked(''e1c00000-0000-4000-8000-000000000001'')::text::jsonb')$q$),'worker functions: service role only');
select pg_temp.ok(pg_temp.denied($q$select pg_temp.svc('public.zoe_coach_member_status()')$q$),'member status: members only');
select pg_temp.ok((select prosrc like '%_telegram_auth_message_claim_core%'from pg_proc where oid='public.telegram_auth_message_claim(uuid,uuid)'::regprocedure),'the Telegram claim is the coach wrapper');
select 'Zoe coach foundation SQL checks passed.';
rollback;
