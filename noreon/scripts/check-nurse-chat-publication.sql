-- Fictional rollback-only risk path through receive, claim, nurse send and finish.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.uid(n integer)returns uuid language sql as $$select ('ad120000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.claims(n integer)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.uid(n),'role','authenticated',
 'amr',jsonb_build_array(jsonb_build_object('method',case when n=1 then 'otp'else 'password'end)),'session_id',pg_temp.uid(n+10))::text,true)$$;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.uid(1),'37499001201',now()),(pg_temp.uid(2),null,null),(pg_temp.uid(3),null,null);
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.uid(n+10),pg_temp.uid(n),now(),now()from generate_series(1,3)n;
insert into public.workspace_clinics(id,name)values(pg_temp.uid(9),'Fictional nurse publication clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.uid(2),'doctor','Fictional doctor',pg_temp.uid(9)),(pg_temp.uid(3),'nurse','Fictional nurse',pg_temp.uid(9));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.uid(1),pg_temp.uid(2),pg_temp.uid(3));
update public.profiles set locale='en'where id=pg_temp.uid(1);
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'nurse-publication-fictional',3600,600,60,100,false,false,true);
update public.nurse_chat_settings set enabled=true where singleton;
insert into public.zoe_settings(singleton)values(true)on conflict do nothing;
update public.zoe_settings set staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.uid(2)from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',
 conversational_replies_enabled=true,direct_answers_enabled=true,health_answers_enabled=true,doctor_takeover_scope='conversation';
insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.uid(1),'zoe_reads_messages',true,'zoe-consent-draft-1');
update public.system_message_templates set approved=true,approval_note='Fictional nurse publication check'where template_id in('zoe.answer','zoe.urgent','zoe.receipt');

create function pg_temp.claim_run()returns uuid language plpgsql as $$declare j jsonb;run uuid;begin
 perform pg_temp.claims(1);set local role authenticated;
 j:=public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text','Fictional question'));
 reset role;perform pg_temp.ok(j->>'ok'='true','Member message accepted');
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
 j:=public.zoe_run_claim(10);reset role;
 select(x->>'runId')::uuid into run from jsonb_array_elements(j)x where x->>'memberId'=pg_temp.uid(1)::text;
 perform pg_temp.ok(run is not null,'Real run claimed before nurse reply');
 update public.zoe_runs set reserved=true,tier='high'where id=run;
 return run;
end$$;
create function pg_temp.nurse_send()returns void language plpgsql as $$declare j jsonb;v bigint;ep bigint;req uuid:=gen_random_uuid();begin
 select version,draft_epoch into v,ep from public.conversations where member_id=pg_temp.uid(1);
 perform pg_temp.claims(3);set local role authenticated;
 j:=public.conversation_nurse_reply(pg_temp.uid(1),req,v,'Fictional intervening nurse reply');
 perform pg_temp.ok(j->>'ok'='true','Assigned nurse sends after claim');
 perform pg_temp.ok(public.conversation_nurse_reply(pg_temp.uid(1),req,v,'Fictional intervening nurse reply')->>'replayed'='true','Same send replays');
 reset role;
 perform pg_temp.ok((select version=v and draft_epoch=ep+1 from public.conversations where member_id=pg_temp.uid(1)),
 'Nurse send advances staff freshness exactly once, without creating member speech');
end$$;
create function pg_temp.finish_run(run uuid,urgent boolean default false)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
 j:=public.zoe_run_finish(run,jsonb_build_object(
 'outcome',case when urgent then 'discarded'else 'answered'end,
 'reason',case when urgent then 'urgent_route_no_model_call'else 'health_answer_passed_guards'end,
 'answer',case when urgent then 'Fictional urgent safety text.'else 'Fictional ordinary advice.'end,'language','en',
 'summary','Fictional summary.','provider','vercel.ai_gateway','model','synthetic','tier','high','tierReason','rule_result_reading',
 'costUsd',0,'guardReasons','[]'::jsonb,'events','[]'::jsonb)
 ||case when urgent then '{}'::jsonb else jsonb_build_object('health',jsonb_build_object('urgency','planned','modelUrgency','planned','forward','none','forwardReason','none'),
 'receipt',jsonb_build_object('text','Fictional receipt.','language','en','kind','receipt'))end);
 reset role;perform pg_temp.ok(j->>'ok'='true','Finish accepted');return j;
end$$;
do $$declare run uuid;j jsonb;c uuid;begin
 -- Control proves settings/template/consent gates really permit this ordinary payload.
 run:=pg_temp.claim_run();j:=pg_temp.finish_run(run);
 perform pg_temp.ok(j->>'outcome'='answered'and exists(select 1 from public.zoe_member_answers where run_id=run and kind='answer'),'Control ordinary advice publishes');
 run:=pg_temp.claim_run();perform pg_temp.nurse_send();j:=pg_temp.finish_run(run);
 perform pg_temp.ok(j->>'outcome'='stale','Intervening nurse reply fences ordinary advice');
 perform pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=run),'Stale run publishes neither advice nor receipt');
 select id into c from public.conversations where member_id=pg_temp.uid(1);
 perform pg_temp.ok(not public._zoe_doctor_mode(c),'Nurse reply does not take over the thread');
 run:=pg_temp.claim_run();perform pg_temp.nurse_send();perform pg_temp.finish_run(run,true);
 perform pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=run and kind='urgent'),'Urgent output survives nurse freshness fence');
 insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,reason)values(c,pg_temp.uid(1),true,pg_temp.uid(2),'doctor_reply');
 run:=pg_temp.claim_run();perform pg_temp.nurse_send();j:=pg_temp.finish_run(run);
 perform pg_temp.ok(j->>'outcome'='discarded'and(select reason_code='doctor_mode_held'from public.zoe_runs where id=run),'Doctor mode retains its publication guard');
 perform pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=run),'Doctor mode still holds all ordinary member text');
 run:=pg_temp.claim_run();perform pg_temp.nurse_send();perform pg_temp.finish_run(run,true);
 perform pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=run and kind='urgent'),'Doctor mode still permits urgent output after nurse reply');
 perform pg_temp.ok(public._zoe_doctor_mode(c)and not exists(select 1 from public.zoe_mode_notices where conversation_id=c),'Nurse send leaves doctor mode and notices unchanged');
end$$;
rollback;
