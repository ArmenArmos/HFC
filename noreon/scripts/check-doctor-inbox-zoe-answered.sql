-- Doctor inbox, part 2 (20261020060842): a thread Zoe fully answered in free mode (forward none, or the member declined
-- her ask) is "answered by Zoe": off the needs-reply lists (conversation_awaiting_replies, the doctor_ai_inbox replies
-- lane, admin needsReply) and in conversation_zoe_answered / doctor_ai_inbox.zoeAnswered. Anything forwarded (ask left
-- open, auto, the member's yes or request, stale included), urgent, careful line, intake, open care alert, photo, newer
-- message or pending draft stays needs reply. The doctor can mark it reviewed or reopen it, bound to the version seen.
-- Each scenario goes through the real path: conversation_receive, zoe_run_claim, zoe_run_finish. Synthetic, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1d10000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1d10000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,anon,service_role;
create function pg_temp.k(key text)returns uuid language sql as $$select(v#>>'{}')::uuid from kv where k=key$$;
-- Member 01 writes in the app; a run is claimed for the newest message, reserved on the high tier.
create function pg_temp.send(txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(1,'otp');set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text',txt));reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: message not received: %',j;end if;return j;end$$;
create function pg_temp.claim(p_tier text default 'high')returns uuid language plpgsql as $$declare j jsonb;run uuid;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;
 select(x->>'runId')::uuid into run from jsonb_array_elements(j)x where(x->>'memberId')::uuid=pg_temp.u(1);
 if run is null then raise exception 'FAIL: no run claimed: %',j;end if;
 update public.zoe_runs set reserved=p_tier<>'none',tier=p_tier where id=run;return run;end$$;
create function pg_temp.next(txt text,p_tier text default 'high')returns uuid language sql as $$select pg_temp.send(txt);select pg_temp.claim(p_tier)$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.res(outcome text,reason text,answer text,health jsonb,extra jsonb default '{}')returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Zoe answered a health question (synthetic).','answer',answer,'language',case when answer is null then null else 'en'end,
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',300),'costUsd',0.01,'latencyMs',900,
  'provider','vercel.ai_gateway','model','anthropic/claude-opus-5.5','configVersion','inbox-zoe-check','sealed',null,'tier','high','tierReason','rule_result_reading','fallbackUsed',false,'events','[]'::jsonb,'health',health))||extra
$$;
create function pg_temp.h(urgency text,fwd text default 'none',reason text default 'none')returns jsonb language sql as $$
 select jsonb_build_object('urgency',urgency,'modelUrgency',urgency,'forward',fwd,'forwardReason',reason)$$;
-- A health answer as the worker finishes it.
create function pg_temp.answer(run uuid,urgency text default 'planned',fwd text default 'none',reason text default 'none',body text default 'Synthetic guideline explanation. How urgent: not urgent.')returns void language plpgsql as $$declare j jsonb;begin
 j:=pg_temp.finish(run,pg_temp.res('answered','health_answer_passed_guards',body,pg_temp.h(urgency,fwd,reason)));
 if j->>'outcome'<>'answered'then raise exception 'FAIL: not answered: %',j;end if;end$$;
create function pg_temp.conv()returns uuid language sql as $$select id from public.conversations where member_id=pg_temp.u(1)$$;
create function pg_temp.ver()returns bigint language sql as $$select version from public.conversations where member_id=pg_temp.u(1)$$;
-- What doctor n sees for member 01.
create function pg_temp.waiting(n int)returns boolean language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.conversation_awaiting_replies();reset role;
 return exists(select 1 from jsonb_array_elements(j->'items')x where(x->>'memberId')::uuid=pg_temp.u(1)and x->>'reason'='new_message');end$$;
create function pg_temp.answered(n int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.conversation_zoe_answered();reset role;
 return(select x from jsonb_array_elements(j->'items')x where(x->>'memberId')::uuid=pg_temp.u(1));end$$;
create function pg_temp.inbox(n int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_ai_inbox();reset role;return j;end$$;
create function pg_temp.admin_needs_reply()returns boolean language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(14);set local role authenticated;j:=public.admin_conversation_list(null);reset role;
 return(select(x->>'needsReply')::boolean from jsonb_array_elements(j->'items')x where(x->>'memberId')::uuid=pg_temp.u(1));end$$;
create function pg_temp.mark(n int,action text,version bigint)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_zoe_answered_mark(pg_temp.u(1),action,version);reset role;return j;end$$;
-- Needs reply on every doctor surface, and not "answered by Zoe".
create function pg_temp.needs_reply(label text)returns void language plpgsql as $$declare i jsonb;begin
 i:=pg_temp.inbox(11);
 perform pg_temp.ok(pg_temp.waiting(11),label||': on the Replies list');
 perform pg_temp.ok(exists(select 1 from jsonb_array_elements(i->'items')x where(x->>'memberId')::uuid=pg_temp.u(1)and x->>'kind'like 'reply%'),label||': a reply item in the Today inbox');
 perform pg_temp.ok(pg_temp.answered(11)is null and not exists(select 1 from jsonb_array_elements(i->'zoeAnswered')x where(x->>'memberId')::uuid=pg_temp.u(1)),label||': not answered by Zoe');
 perform pg_temp.ok(pg_temp.admin_needs_reply(),label||': admin needsReply');
end$$;
create function pg_temp.zoe_answered(label text)returns void language plpgsql as $$declare i jsonb;begin
 i:=pg_temp.inbox(11);
 perform pg_temp.ok(not pg_temp.waiting(11),label||': off the Replies list');
 perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(i->'items')x where(x->>'memberId')::uuid=pg_temp.u(1)and x->>'kind'like 'reply%'),label||': no reply item in the Today inbox');
 perform pg_temp.ok(pg_temp.answered(11)->>'version'=pg_temp.ver()::text,label||': answered by Zoe, at the current version');
 perform pg_temp.ok(exists(select 1 from jsonb_array_elements(i->'zoeAnswered')x where(x->>'memberId')::uuid=pg_temp.u(1))and(i->>'zoeAnsweredTotal')::int>=1,label||': in the inbox''s answered group');
 perform pg_temp.ok(not pg_temp.admin_needs_reply(),label||': admin needsReply false');
end$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- People: member 01 (doctor 11), member 02 (doctor 12); doctors 11, 12; nurse 13; admin 14.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990290'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic Zoe-answered clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Dr Answered One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Answered Two',pg_temp.u(20)),(pg_temp.u(13),'nurse','Nurse Answered',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Answered');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null);
update public.profiles set locale='en',display_name='Zara Synthetic'where id=pg_temp.u(1);
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-inbox-zoe',3600,600,60,40,false,true,true)on conflict(singleton)do update set version=excluded.version,intake_max_messages=40,app_chat_enabled=true,delivery_enabled=true;
insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.u(1),'zoe_reads_messages',true,'zoe-consent-draft-1');
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.u(14)from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set conversational_replies_enabled=true;
update public.zoe_settings set health_answers_enabled=true;
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.answer','zoe.chat','zoe.receipt');
update public.admin_oversight_settings set admin_conversation_read_enabled=true;

-- 0. Access: only the assigned doctor reads the list or marks a thread; the function is not callable by anon.
select pg_temp.ok(not has_function_privilege('anon','public.conversation_zoe_answered()','execute')and not has_function_privilege('anon','public.doctor_zoe_answered_mark(uuid,text,bigint)','execute')
 and not has_function_privilege('authenticated','public._zoe_answered_open(uuid)','execute'),'grants: authenticated wrappers only, the rule is private');
select pg_temp.as_user(13);select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.conversation_zoe_answered()$$),'nurse refused the list');reset role;
select pg_temp.as_user(14);select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.conversation_zoe_answered()$$),'admin refused the list');reset role;
select pg_temp.as_user(1,'otp');select pg_temp.ok(pg_temp.denied($$set local role authenticated;select public.conversation_zoe_answered()$$),'member refused the list');reset role;

-- 1. Answered: a health answer below same day, nothing sent to the doctor.
savepoint s1;
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
select pg_temp.zoe_answered('answered, planned');
select pg_temp.ok((select x->>'urgency'='planned'and x->>'memberName'='Zara Synthetic'and(x->>'unanswered')::int=1 and x->>'declined'='false'from pg_temp.answered(11)x),'the item carries urgency, name, count');
select pg_temp.ok(pg_temp.answered(12)is null,'another doctor never sees member 01');
select pg_temp.ok(pg_temp.denied(format($$select pg_temp.mark(12,'reviewed',%s)$$,pg_temp.ver())),'another doctor cannot mark it');
-- Coming days without a forward is still Zoe's answer (spec level 3 asks first; no ask means the model chose none).
rollback to s1;savepoint s1;
select pg_temp.answer(pg_temp.next('Is 135/85 a problem?'),'doctor_soon');
select pg_temp.zoe_answered('answered, doctor soon, no forward');
-- A thanks after the answer (fixed chat reply) keeps it answered.
select pg_temp.ok((pg_temp.finish(pg_temp.next('Thank you!','none'),pg_temp.res('chatted','conversation_reply','You are welcome.',null,
 jsonb_build_object('tier','none','chat',jsonb_build_object('kind','thanks','source','fixed'))))->>'outcome')='chatted','thanks chatted');
select pg_temp.zoe_answered('answered, then thanks');
-- A distress reply after it does not.
select pg_temp.ok((pg_temp.finish(pg_temp.next('I feel so alone with this','none'),pg_temp.res('chatted','conversation_reply','I am here with you.',null,
 jsonb_build_object('tier','none','chat',jsonb_build_object('kind','distress','source','fixed'))))->>'outcome')='chatted','distress chatted');
select pg_temp.needs_reply('distress chat');
rollback to s1;

-- 2. Forwarded or urgent: needs reply exactly as before.
savepoint s2;
select pg_temp.answer(pg_temp.next('Should I start statins?'),'doctor_soon','asked','treatment_decision');
select pg_temp.needs_reply('ask left open');
rollback to s2;savepoint s2;
select pg_temp.answer(pg_temp.next('I stopped my pills last week'),'doctor_soon','auto','stopped_medicine');
select pg_temp.needs_reply('auto forward');
rollback to s2;savepoint s2;
select pg_temp.ok((pg_temp.finish(pg_temp.next('Please send this to my doctor'),pg_temp.res('summary_only','health_forward_member_request',null,pg_temp.h('none','member_request','member_request'),
 '{"receipt":{"text":"I have sent this to your doctor.","language":"en","kind":"receipt"}}'))->>'outcome')='summary_only','member request recorded');
select pg_temp.needs_reply('member asked for the doctor');
rollback to s2;savepoint s2;
-- The careful line: Zoe could not answer safely; forwarded automatically.
select pg_temp.ok((pg_temp.finish(pg_temp.next('Can I double my dose?'),pg_temp.res('summary_only','health_answer_blocked_by_reply_check',null,pg_temp.h('planned','auto','zoe_could_not_answer'),
 '{"receipt":{"text":"Your doctor will look at this.","language":"en","kind":"receipt"}}'))->>'outcome')='summary_only','careful line recorded');
select pg_temp.needs_reply('careful line');
rollback to s2;savepoint s2;
-- The urgent route (no model; 103 text).
select pg_temp.ok((pg_temp.finish(pg_temp.next('Crushing chest pain right now','none'),pg_temp.res('discarded','urgent_route_no_model_call','Call 103 now.',pg_temp.h('emergency','auto','same_day'),
 '{"tier":"none"}'))->>'outcome')='discarded','urgent route recorded');
select pg_temp.needs_reply('urgent route');
rollback to s2;savepoint s2;
-- The model's emergency, and same day (auto by the urgency).
select pg_temp.ok((pg_temp.finish(pg_temp.next('My BP is 190/125'),pg_temp.res('discarded','urgent_health_answer_model','Call 103 now.',pg_temp.h('emergency','auto','same_day')))->>'outcome')='discarded','model emergency');
select pg_temp.needs_reply('model emergency');
rollback to s2;savepoint s2;
select pg_temp.answer(pg_temp.next('My BP is 182/110 and I feel fine'),'same_day','auto','same_day');
select pg_temp.needs_reply('same day');
rollback to s2;savepoint s2;
-- Belt and braces: an answer that says same day with forward none is not trusted either.
select pg_temp.answer(pg_temp.next('My BP is 182/110'),'same_day','none','none');
select pg_temp.needs_reply('same day without a forward');
rollback to s2;savepoint s2;
-- An earlier forward in the window, then a later plain answer: the forward wins.
select pg_temp.answer(pg_temp.next('I stopped my pills'),'doctor_soon','auto','stopped_medicine');
select pg_temp.answer(pg_temp.next('And what is a normal pulse?'),'planned');
select pg_temp.needs_reply('auto earlier in the window');
rollback to s2;savepoint s2;
-- A stale run that would have forwarded (a newer message overtook it), then a plain answer: still needs reply.
create temp table stale_run as select pg_temp.next('I skipped my tablets for a week')id;
select pg_temp.answer(pg_temp.next('What should my LDL be?'),'planned');
select pg_temp.ok((pg_temp.finish((select id from stale_run),pg_temp.res('answered','health_answer_passed_guards','Synthetic.',pg_temp.h('doctor_soon','auto','stopped_medicine')))->>'outcome')='stale','the earlier run is stale');
select pg_temp.needs_reply('stale forward in the window');
rollback to s2;savepoint s2;
-- A logistics (non-health) direct answer is not a free-mode answer.
update public.zoe_settings set direct_answers_enabled=true;
select pg_temp.ok((pg_temp.finish(pg_temp.next('When is my visit?','low'),pg_temp.res('answered','direct_answer_passed_guards','Your visit is on Monday.',null,'{"tier":"low"}'))->>'outcome')='answered','logistics answered');
select pg_temp.needs_reply('logistics answer');
rollback to s2;

-- 3. Declined: Zoe asked, the member said no, Zoe answered: answered by Zoe. Another reply to the ask is not a decline.
savepoint s3;
select pg_temp.answer(pg_temp.next('Should I start statins?'),'doctor_soon','asked','treatment_decision');
select pg_temp.answer(pg_temp.next('No, thanks'),'doctor_soon','none','member_declined');
select pg_temp.zoe_answered('declined ask');
select pg_temp.ok((pg_temp.answered(11)->>'declined')::boolean and(pg_temp.answered(11)->>'unanswered')::int=2,'the item says the member declined; both messages counted');
rollback to s3;savepoint s3;
select pg_temp.answer(pg_temp.next('Should I start statins?'),'doctor_soon','asked','treatment_decision');
select pg_temp.answer(pg_temp.next('What about fish oil?'),'planned','none','none');
select pg_temp.needs_reply('ask not answered by a no');
rollback to s3;savepoint s3;
-- Astra ZA-02: a no answers only the ask right before it; an earlier ask stays open.
select pg_temp.answer(pg_temp.next('Should I start statins?'),'doctor_soon','asked','treatment_decision');
select pg_temp.answer(pg_temp.next('And what about aspirin?'),'doctor_soon','asked','treatment_decision');
select pg_temp.answer(pg_temp.next('No'),'doctor_soon','none','member_declined');
select pg_temp.needs_reply('two asks, one no');
rollback to s3;savepoint s3;
-- The member's yes is a forward.
select pg_temp.answer(pg_temp.next('Should I start statins?'),'doctor_soon','asked','treatment_decision');
select pg_temp.ok((pg_temp.finish(pg_temp.next('Yes please'),pg_temp.res('summary_only','health_forward_member_yes',null,pg_temp.h('none','member_yes','member_yes'),
 '{"receipt":{"text":"I have sent this to your doctor.","language":"en","kind":"receipt"}}'))->>'outcome')='summary_only','yes recorded');
select pg_temp.needs_reply('member said yes');
rollback to s3;

-- Astra ZA-01: an answer ending with Zoe's own question (a danger-sign question) is an open assessment.
savepoint s35;
select pg_temp.answer(pg_temp.next('I have a headache and my BP is 160/100'),'doctor_soon','none','zoe_question','Your reading needs a look. Is there weakness on one side of your body or trouble speaking?');
select pg_temp.needs_reply('Zoe''s danger-sign question');
select pg_temp.ok(pg_temp.mark(11,'reviewed',pg_temp.ver())->>'code'='not_answered_by_zoe','an open question cannot be marked reviewed');
-- The member answers no; Zoe then answers fully: answered.
select pg_temp.answer(pg_temp.next('No, none of that'),'doctor_soon');
select pg_temp.zoe_answered('the question answered, then a full answer');
rollback to s35;savepoint s35;
-- Runs from before the worker recorded zoe_question: the stored text decides (EN, RU and HY question marks).
select pg_temp.answer(pg_temp.next('My BP is 160/100'),'doctor_soon','none','none','Your reading needs a look. Do you have chest pain?');
select pg_temp.needs_reply('a question mark at the end, no reason recorded');
rollback to s35;savepoint s35;
select pg_temp.answer(pg_temp.next('My BP is 160/100'),'doctor_soon','none','none','Ձեր ցուցանիշը պետք է նայել։ Կրծքավանդակի ցա՞վ ունեք։');
select pg_temp.needs_reply('an Armenian question');
rollback to s35;

-- 4. Other signals that keep it with the doctor.
savepoint s4;
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
select pg_temp.zoe_answered('before the newer message');
select pg_temp.send('One more question');
select pg_temp.needs_reply('a newer message with no Zoe answer yet');
rollback to s4;savepoint s4;
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
set local session_replication_role=replica;
insert into public.care_alerts(id,member_id,source,reason_code,red_flags,rule_id,rule_version,source_ref,doctor_id,state,created_at)
 values(pg_temp.u(40),pg_temp.u(1),'zoe','zoe_red_flag','{}','zoe.red_flag','v1','run-x',pg_temp.u(11),'open',now());
set local session_replication_role=origin;
select pg_temp.needs_reply('an unresolved care alert');
set local session_replication_role=replica;
delete from public.care_alerts where id=pg_temp.u(40);
set local session_replication_role=origin;
select pg_temp.zoe_answered('no alert');
rollback to s4;savepoint s4;
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
set local session_replication_role=replica;
insert into public.zoe_symptom_intakes(conversation_id,member_id,sheet_id,sheet_version,state,language,started_seq,last_seq,record)values(pg_temp.conv(),pg_temp.u(1),'synthetic',1,'active','en',1,1,'{}');
set local session_replication_role=origin;
select pg_temp.needs_reply('an active intake');
rollback to s4;savepoint s4;
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(pg_temp.conv(),null,'message.media',jsonb_build_object('channel','telegram','version',pg_temp.ver()));
select pg_temp.needs_reply('a photo in the window');
rollback to s4;savepoint s4;
-- A member message older than the free-mode switch (held as a summary) is unanswered by Zoe.
update public.zoe_settings set health_answers_enabled=false;
select pg_temp.ok((pg_temp.finish(pg_temp.next('What does 150/95 mean?'),pg_temp.res('answered','health_answer_passed_guards','Synthetic.',pg_temp.h('planned')))->>'outcome')='summary_only','switch off: held');
update public.zoe_settings set health_answers_enabled=true;
select pg_temp.answer(pg_temp.next('And 140/90?'),'planned');
select pg_temp.needs_reply('an earlier message Zoe did not answer');
rollback to s4;savepoint s4;
-- A run still in progress for the newest message.
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
select pg_temp.next('And 140/90?');
select pg_temp.needs_reply('the newest run still running');
rollback to s4;

-- 5. The doctor reviews or reopens.
savepoint s5;
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
select pg_temp.ok(pg_temp.mark(11,'reopen',pg_temp.ver()-1)->>'code'='stale','a version the doctor did not see: stale, nothing written');
select pg_temp.ok(pg_temp.mark(11,'archive',pg_temp.ver())->>'code'='invalid','unknown action');
select pg_temp.ok(pg_temp.mark(11,'reopen',pg_temp.ver())->>'ok'='true','reopen');
select pg_temp.needs_reply('reopened');
select pg_temp.ok(pg_temp.mark(11,'reviewed',pg_temp.ver())->>'code'='not_answered_by_zoe','a reopened thread is not answered by Zoe');
-- Zoe answering a newer message does not undo the doctor's reopen; the doctor's decision does.
select pg_temp.answer(pg_temp.next('And 140/90?'),'planned');
select pg_temp.needs_reply('reopened, then Zoe answered again');
set local session_replication_role=replica;
insert into public.conversation_drafts(conversation_id,state,context_version,clinical_revision,source_token)values(pg_temp.conv(),'rejected',pg_temp.ver(),0,'x');
set local session_replication_role=origin;
select pg_temp.ok(not pg_temp.waiting(11)and pg_temp.answered(11)is null,'after the doctor''s decision: on neither list');
select pg_temp.answer(pg_temp.next('What about salt?'),'planned');
select pg_temp.zoe_answered('a new question after the decision');
rollback to s5;savepoint s5;
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
select pg_temp.ok(pg_temp.mark(11,'reviewed',pg_temp.ver())->>'replayed'='false','reviewed');
select pg_temp.ok(pg_temp.mark(11,'reviewed',pg_temp.ver())->>'replayed'='true','reviewed again: replayed');
select pg_temp.ok(not pg_temp.waiting(11)and pg_temp.answered(11)is null and not exists(select 1 from jsonb_array_elements(pg_temp.inbox(11)->'zoeAnswered')x where(x->>'memberId')::uuid=pg_temp.u(1)),
 'reviewed: on neither list');
select pg_temp.ok(not pg_temp.admin_needs_reply(),'reviewed: admin needsReply false');
select pg_temp.ok((select count(*)=1 from public.conversation_audit where conversation_id=pg_temp.conv()and kind='inbox.zoe_reviewed'and actor_id=pg_temp.u(11)),'one reviewed record by the doctor');
-- The member-specific chat read retains reviewed status even though the inbox hides the row.
select pg_temp.as_user(11);
set local role authenticated;
insert into kv(k,v)values('reviewed-chat-card',public.doctor_chat_conversation(pg_temp.u(1)));
select pg_temp.ok((v#>>'{zoeReview,reviewed}')::boolean
 and(v#>>'{zoeReview,version}')::bigint=(v#>>'{workspace,version}')::bigint
 and(v#>>'{zoeReview,memberId}')::uuid=pg_temp.u(1),'reviewed chat reload retains exact member cursor')from kv where k='reviewed-chat-card';
reset role;
-- Reopen still works after review.
select pg_temp.ok(pg_temp.mark(11,'reopen',pg_temp.ver())->>'ok'='true','reopen after review');
select pg_temp.needs_reply('reopened after review');
select pg_temp.as_user(11);
set local role authenticated;
select pg_temp.ok(public.doctor_chat_conversation(pg_temp.u(1))->'zoeReview'='null'::jsonb,'reopened chat reload removes Zoe review cursor');
reset role;
rollback to s5;savepoint s5;
-- A reviewed thread returns with the next answered message.
select pg_temp.answer(pg_temp.next('What does 150/95 mean?'),'planned');
select pg_temp.mark(11,'reviewed',pg_temp.ver());
select pg_temp.answer(pg_temp.next('And 140/90?'),'planned');
select pg_temp.zoe_answered('reviewed, then a new answered message');
rollback to s5;
-- Marking a thread that needs reply is refused.
savepoint s6;
select pg_temp.answer(pg_temp.next('I stopped my pills'),'doctor_soon','auto','stopped_medicine');
select pg_temp.ok(pg_temp.mark(11,'reviewed',pg_temp.ver())->>'code'='not_answered_by_zoe','a forwarded thread cannot be marked reviewed');
select pg_temp.ok(not exists(select 1 from public.conversation_audit where conversation_id=pg_temp.conv()and kind like 'inbox.zoe_%'),'nothing written');
rollback to s6;

select 'check-doctor-inbox-zoe-answered: all assertions passed'as result;
rollback;
