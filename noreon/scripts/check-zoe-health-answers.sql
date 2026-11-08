-- Zoe health answers (20261019183543): the switch (off by default, needs real calls), zoe_run_health_context (the
-- member's home readings this week and doctor-reviewed results, numbers only, service role only), and zoe_run_finish:
-- an answered health answer on the medium or high tier up to 2 400 characters, held as a summary while the switch is
-- off, the model's emergency taking the urgent route, and invalid shapes refused. Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.send(m text,sid text,rid text,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',rid,'text',txt));reset role;return j;end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;return j;end$$;
create function pg_temp.run_for(m uuid)returns uuid language sql as $$select (x->>'runId')::uuid from jsonb_array_elements(pg_temp.claim())x where (x->>'memberId')::uuid=m$$;
create function pg_temp.hctx(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_health_context(array[run]);reset role;return j->0;end$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.res(outcome text,reason text,answer text,health jsonb,tier text default 'high')returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Zoe answered a health question (synthetic).','answer',answer,'language',case when answer is null then null else 'en'end,
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',300),'costUsd',0.01,'latencyMs',900,
  'provider','vercel.ai_gateway','model','anthropic/claude-opus-5.5','configVersion','zoe-health-check','sealed',null,'tier',tier,'tierReason','rule_result_reading','fallbackUsed',false,'events','[]'::jsonb,'health',health))
$$;
create function pg_temp.h(urgency text,fwd text default 'none')returns jsonb language sql as $$select jsonb_build_object('urgency',urgency,'modelUrgency',urgency,'forward',fwd,'forwardReason',case when fwd='none'then 'none'else 'same_day'end)$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;
create function pg_temp.k(key text)returns uuid language sql as $$select (v#>>'{}')::uuid from kv where k=key$$;
-- A fresh message and its started run, marked reserved on a tier (the worker's reservation is checked elsewhere).
create function pg_temp.next(rid text,txt text,p_tier text default 'high')returns uuid language plpgsql as $$declare run uuid;begin
 perform pg_temp.send('e1940000-0000-4000-8000-000000000001','e1940000-0000-4000-8000-000000000011',rid,txt);
 run:=pg_temp.run_for('e1940000-0000-4000-8000-000000000001');
 update public.zoe_runs set reserved=true,tier=p_tier where id=run;return run;end$$;

-- A: app member (EN); D: their doctor; X: admin.
insert into auth.users(id,phone,phone_confirmed_at)values('e1940000-0000-4000-8000-000000000001','37499094001',now()),('e1940000-0000-4000-8000-000000000002','37499094002',now()),
 ('e1940000-0000-4000-8000-000000000006',null,null);
insert into public.workspace_clinics(id,name)values('e1940000-0000-4000-8000-000000000004','Synthetic health clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e1940000-0000-4000-8000-000000000002','doctor','Dr Synthetic Health Doctor','e1940000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('e1940000-0000-4000-8000-000000000006','admin','Synthetic Health Admin');
insert into auth.sessions(id,user_id,created_at,updated_at)values('e1940000-0000-4000-8000-000000000011','e1940000-0000-4000-8000-000000000001',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('e1940000-0000-4000-8000-000000000001','e1940000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Hilda Synthetic'where id='e1940000-0000-4000-8000-000000000001';
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-zha',3600,600,60,40,false,true,true);
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('e1940000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1');
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
update public.system_message_templates set approved=true where template_id='zoe.answer';

-- 1. The switch: off by default; on only with real calls allowed.
select pg_temp.ok((select not health_answers_enabled from public.zoe_settings),'Health answers off by default');
do $$begin update public.zoe_settings set health_answers_enabled=true;raise exception 'FAIL: health answers on without real calls';exception when check_violation then
 if sqlerrm !~ 'model_calls_allowed' then raise exception 'FAIL: wrong refusal %',sqlerrm;end if;end$$;
update public.zoe_settings set staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510',510,0,0,'e1940000-0000-4000-8000-000000000006'from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
do $$begin update public.zoe_settings set health_answers_enabled=true;raise exception 'FAIL: health answers on without conversational replies';exception when check_violation then
 if sqlerrm !~ 'conversational' then raise exception 'FAIL: wrong refusal %',sqlerrm;end if;end$$;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,'e1940000-0000-4000-8000-000000000006'from public.zoe_tier_config where tier='low';
update public.zoe_settings set conversational_replies_enabled=true;
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.chat','zoe.receipt');

-- 2. The member's data: nothing while off; numbers only, this week's readings, reviewed results only.
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values
 ('e1940000-0000-4000-8000-000000000001',gen_random_uuid(),150,95,now()-interval '1 day'),('e1940000-0000-4000-8000-000000000001',gen_random_uuid(),140,90,now()-interval '3 days'),
 ('e1940000-0000-4000-8000-000000000001',gen_random_uuid(),190,120,now()-interval '20 days');
insert into public.patient_care_results(user_id,marker,value,unit,reference_high,collected_at,received_at,source,source_label,reviewed_at,reviewed_by,explanation)values
 ('e1940000-0000-4000-8000-000000000001','LDL cholesterol',3.9,'mmol/L',3.0,now()-interval '12 days',now()-interval '11 days','laboratory','Synthetic lab',now()-interval '10 days','Dr Synthetic Health Doctor','Synthetic doctor note'),
 ('e1940000-0000-4000-8000-000000000001','HbA1c',6.1,'%',5.6,now()-interval '5 days',now()-interval '4 days','laboratory','Synthetic lab',null,null,null);
insert into kv values('r1',to_jsonb(pg_temp.next('e1940000-0000-4000-8000-0000000000a1','What does 150/95 mean?')));
select pg_temp.ok((select (x->>'enabled')::boolean=false and x->'data'='null'::jsonb from pg_temp.hctx(pg_temp.k('r1'))x),'Off: no data');
update public.zoe_settings set health_answers_enabled=true;
select pg_temp.ok((select x->'data'->'bpWeek'=jsonb_build_object('count',2,'avgSystolic',145,'avgDiastolic',93,'latest',jsonb_build_object('systolic',150,'diastolic',95,'daysAgo',1))
 from pg_temp.hctx(pg_temp.k('r1'))x),'This week''s readings only');
select pg_temp.ok((select jsonb_array_length(x->'data'->'labs')=2 and x->'data'->'labs'->0->>'marker'='HbA1c'and (x->'data'->'labs'->0->>'reviewed')::boolean=false
 and x->'data'->'labs'->1->>'marker'='LDL cholesterol'and (x->'data'->'labs'->1->>'reviewed')::boolean and (x->'data'->'labs'->1->>'high')::numeric=3.0
 from pg_temp.hctx(pg_temp.k('r1'))x),'Recent results, newest first, with their review state');
select pg_temp.ok((select (x->'data'->'labs'->0->>'arrivedMinutesAgo')::integer between 5759 and 5761 and (x->'data'->'labs'->1->>'arrivedMinutesAgo')::integer between 14399 and 14401
 from pg_temp.hctx(pg_temp.k('r1'))x),'Arrival is when the result became visible: received, or reviewed when that is later (the LDL row), never collected');
-- A panel over the cap keeps its critical value, with 17 rows on one collection date (healthDataSchema's labs max is 16 too).
savepoint big_panel;
insert into public.patient_care_results(user_id,marker,value,unit,reference_low,reference_high,collected_at,received_at,source,source_label,reviewed_at,reviewed_by)
 select 'e1940000-0000-4000-8000-000000000001','Panel '||i,5,'mmol/L',1,10,date_trunc('day',now())-interval '1 day',now(),'laboratory','Synthetic lab',now(),'Dr Synthetic Health Doctor'from generate_series(1,16)i;
insert into public.patient_care_results(user_id,marker,value,unit,reference_low,reference_high,collected_at,received_at,source,source_label)values
 ('e1940000-0000-4000-8000-000000000001','Sodium',120,'mmol/L',135,145,date_trunc('day',now())-interval '1 day',now(),'laboratory','Synthetic lab');
select pg_temp.ok((select jsonb_array_length(x->'data'->'labs')=16 and exists(select 1 from jsonb_array_elements(x->'data'->'labs')l where l->>'marker'='Sodium'and(l->>'value')::numeric=120)
 from pg_temp.hctx(pg_temp.k('r1'))x),'Out of range comes first within the cap');
rollback to savepoint big_panel;
savepoint big_panel;
insert into public.patient_care_results(user_id,marker,value,unit,reference_low,reference_high,collected_at,received_at,source,source_label,reviewed_at,reviewed_by)
 select 'e1940000-0000-4000-8000-000000000001','Panel '||i,50,'mmol/L',1,10,date_trunc('day',now())-interval '1 day',now(),'laboratory','Synthetic lab',now(),'Dr Synthetic Health Doctor'from generate_series(1,16)i;
insert into public.patient_care_results(user_id,marker,value,unit,reference_low,reference_high,collected_at,received_at,source,source_label)values
 ('e1940000-0000-4000-8000-000000000001','Sodium',120,'mmol/L',135,145,date_trunc('day',now())-interval '1 day',now(),'laboratory','Synthetic lab');
select pg_temp.ok((select exists(select 1 from jsonb_array_elements(x->'data'->'labs')l where l->>'marker'='Sodium'and(l->>'reviewed')::boolean=false)
 from pg_temp.hctx(pg_temp.k('r1'))x),'Among results out of range, unreviewed comes before reviewed');
rollback to savepoint big_panel;
select pg_temp.ok((select x->'data'->'plan'='null'::jsonb from pg_temp.hctx(pg_temp.k('r1'))x),'No published plan: null');
select pg_temp.ok((select x::text !~ 'Synthetic|Hilda|e1940000' from pg_temp.hctx(pg_temp.k('r1'))x),'No names, ids, labels or doctor notes');
do $$begin perform pg_temp.as_user('e1940000-0000-4000-8000-000000000001','e1940000-0000-4000-8000-000000000011');set local role authenticated;
 perform public.zoe_run_health_context(array[gen_random_uuid()]);raise exception 'FAIL: a member read the health context';exception when insufficient_privilege then null;end$$;
reset role;

-- 3. An answered health answer: high tier, a long answer, stored for the app and audited with its level.
insert into kv values('f1',pg_temp.finish(pg_temp.k('r1'),pg_temp.res('answered','health_answer_passed_guards',repeat('Synthetic guideline explanation. ',60)||'How urgent: not urgent.',pg_temp.h('planned'))));
select pg_temp.ok((select v->>'outcome'='answered'from kv where k='f1'),'Answered on the high tier');
select pg_temp.ok((select length(body)>1900 and kind='answer'from public.zoe_member_answers where run_id=pg_temp.k('r1')),'The long answer stored');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.answered'and detail->'health'->>'urgency'='planned'),'Audited with the urgency');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where attributes->>'noreon.zoe.health.urgency'='planned'),'The level in the trace');

-- 4. Switch off: held as a summary, nothing stored.
update public.zoe_settings set health_answers_enabled=false;
insert into kv values('r2',to_jsonb(pg_temp.next('e1940000-0000-4000-8000-0000000000a2','Is LDL 3.9 high?')));
select pg_temp.ok((pg_temp.finish(pg_temp.k('r2'),pg_temp.res('answered','health_answer_passed_guards','Synthetic answer.',pg_temp.h('doctor_soon','asked')))->>'outcome')='summary_only','Off: held');
select pg_temp.ok((select reason_code='health_answers_off'from public.zoe_runs where id=pg_temp.k('r2'))and not exists(select 1 from public.zoe_member_answers where run_id=pg_temp.k('r2')),'Off: recorded, nothing stored');
update public.zoe_settings set health_answers_enabled=true;

-- 5. Invalid shapes are refused.
insert into kv values('r3',to_jsonb(pg_temp.next('e1940000-0000-4000-8000-0000000000a3','What is SCORE2?')));
select pg_temp.ok((pg_temp.finish(pg_temp.k('r3'),pg_temp.res('answered','health_answer_passed_guards','x',pg_temp.h('emergency')))->>'code')='invalid','An emergency is never answered');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r3'),pg_temp.res('answered','health_answer_passed_guards','x',pg_temp.h('later')))->>'code')='invalid','An unknown level is invalid');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r3'),pg_temp.res('answered','health_answer_passed_guards','x',pg_temp.h('planned','prescribe')))->>'code')='invalid','An unknown forward is invalid');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r3'),pg_temp.res('answered','health_answer_passed_guards',repeat('x',2401),pg_temp.h('planned')))->>'code')='invalid','Over 2 400 characters is invalid');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r3'),pg_temp.res('answered','direct_answer_passed_guards',repeat('x',701),null))->>'code')='invalid','A logistics answer stays at 700');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r3'),pg_temp.res('chatted','x','x',pg_temp.h('planned')))->>'code')='invalid','Health levels only on answered, summary-only or the urgent route');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r3'),pg_temp.res('discarded','urgent_health_answer_model','x',pg_temp.h('planned')))->>'code')='invalid','The urgent route needs the emergency level');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=pg_temp.k('r3')),'Invalid: nothing stored');
-- Free mode answers greetings and the app too: the low tier is valid.
update public.zoe_runs set tier='low'where id=pg_temp.k('r3');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r3'),pg_temp.res('answered','health_answer_passed_guards','Synthetic hello.',pg_temp.h('none'),'low'))->>'outcome')='answered','Free mode on the low tier');

-- 6. The model's emergency: the fixed urgent text as an urgent answer, no receipt, urgent today for staff.
insert into kv values('r4',to_jsonb(pg_temp.next('e1940000-0000-4000-8000-0000000000a4','My pressure is 150/95 and something feels wrong')));
select pg_temp.ok((pg_temp.finish(pg_temp.k('r4'),pg_temp.res('discarded','urgent_health_answer_model','Synthetic urgent text. Call 103.',pg_temp.h('emergency')))->>'outcome')='discarded','Emergency: the urgent route');
select pg_temp.ok((select kind='urgent'and model='zoe-urgent-fixed'from public.zoe_member_answers where run_id=pg_temp.k('r4')),'Emergency: an urgent answer, fixed wording');
select pg_temp.ok((select count(*)=1 from public.zoe_member_answers where run_id=pg_temp.k('r4')),'Emergency: no receipt');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.urgent'and detail->>'runId'=pg_temp.k('r4')::text),'Emergency: audited as urgent');

-- 7. A held health answer (the reply check said no): summary only, with its level.
insert into kv values('r5',to_jsonb(pg_temp.next('e1940000-0000-4000-8000-0000000000a5','Should I stop my statin?')));
select pg_temp.ok((pg_temp.finish(pg_temp.k('r5'),pg_temp.res('summary_only','health_answer_blocked_by_reply_check',null,pg_temp.h('doctor_soon','auto')))->>'outcome')='summary_only','Blocked: the doctor path');

select pg_temp.ok((select forward='auto'and forward_reason='same_day'from public.zoe_runs where id=pg_temp.k('r5')),'The forward is recorded on the run');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.forward'and detail->>'runId'=pg_temp.k('r5')::text and detail->>'forward'='auto'),'An automatic forward is audited');
select pg_temp.ok((select forward='none'from public.zoe_runs where id=pg_temp.k('r3'))and not exists(select 1 from public.conversation_audit where kind='zoe.forward'and detail->>'runId'=pg_temp.k('r3')::text),'No forward: nothing audited');

-- 8. A member yes (or request): a fixed confirmation as the receipt, the forward recorded.
insert into kv values('r6',to_jsonb(pg_temp.next('e1940000-0000-4000-8000-0000000000a6','yes please')));
select pg_temp.ok((pg_temp.finish(pg_temp.k('r6'),pg_temp.res('summary_only','health_forward_member_yes',null,jsonb_build_object('urgency','none','modelUrgency','none','forward','member_yes','forwardReason','member_yes'))
 ||jsonb_build_object('receipt',jsonb_build_object('text','Done, I''ve sent this to your doctor; they''ll reply here.','language','en','kind','receipt')))->>'outcome')='summary_only','Member yes: summary only');
select pg_temp.ok((select kind='receipt'and body like 'Done, I''ve sent%'from public.zoe_member_answers where run_id=pg_temp.k('r6')),'Member yes: the confirmation shown');
select pg_temp.ok((select forward='member_yes'from public.zoe_runs where id=pg_temp.k('r6')),'Member yes: recorded');
select pg_temp.ok((select summary like 'Zoe answered a health question (synthetic).%'from public.zoe_runs where id=pg_temp.k('r6')),'Member yes: carries the previous run''s summary');

select 'zoe health answers checks passed' as result;
rollback;
