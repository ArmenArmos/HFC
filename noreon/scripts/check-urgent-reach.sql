-- How urgent member messages reach people (20261031134000). Message screening: an urgent word with no red flag code raises an alert
-- for any member, read by Zoe or not. A Telegram member Zoe skips gets the fixed 103 text (zoe_unread_urgent_pending and _finish, the
-- real claim and the real dispatch claim); their run stays skipped, nothing happens with no urgent word, and it goes after consent is
-- withdrawn. The doctor's inbox: a same-day forward is in Today (P1) at any age until a decision. Synthetic, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1b20000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1b20000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,anon,service_role;
create function pg_temp.k(key text)returns uuid language sql as $$select(v#>>'{}')::uuid from kv where k=key$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_ur",9041,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_ur",9041,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.bind(m uuid,kind text,u bigint)returns jsonb language sql as $$
 select public._telegram_auth_bind(m,kind,pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null)$$;
-- A Telegram message from member n (Telegram user 9400+n); returns its inbox id.
create function pg_temp.say(p_id text,n int,txt text)returns uuid language plpgsql as $$begin
 perform pg_temp.as_service();perform public.channel_inbox_commit(pg_temp.event(p_id,9400+n,txt));perform pg_temp.drain();
 return(select i.id from public.channel_inbox i where i.event_id=format('["telegram","noreon_ur",9041,"update",%s]',p_id));end$$;
create function pg_temp.send(member int,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text',txt));reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: message not received: %',j;end if;return j;end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(20);reset role;return j;end$$;
create function pg_temp.pending()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_unread_urgent_pending(20);reset role;return j;end$$;
create function pg_temp.un(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_unread_urgent_finish(run,arg);reset role;return j;end$$;
create function pg_temp.conv(member int)returns uuid language sql as $$select id from public.conversations where member_id=pg_temp.u(member)$$;
create function pg_temp.run(member int)returns public.zoe_runs language sql as $$select * from public.zoe_runs where member_id=pg_temp.u(member)order by message_seq desc limit 1$$;
create function pg_temp.newest_seq(member int)returns bigint language sql as $$select max(m.seq)from public.conversation_messages m where m.conversation_id=pg_temp.conv(member)$$;
-- The pending row for member n's newest run, or null.
create function pg_temp.row_for(member int)returns jsonb language sql as $$select x from jsonb_array_elements(pg_temp.pending())x where(x->>'runId')::uuid=(pg_temp.run(member)).id$$;
-- The word list said urgent: the fixed text on the newest message.
create function pg_temp.urgent(seq bigint,alert text default 'zoe_urgent_route',flags text default 'RF-01')returns jsonb language sql as $$
 select jsonb_build_object('seq',seq,'answer','Synthetic fixed 103 text. Call 103.','language','en','alertReason',alert,'configVersion','urgent-reach-check',
  'events',jsonb_build_array(jsonb_build_object('name','zoe.guard.urgent_match','outcome','escalate','reason','urgent_words_matched_staging_list','rule','zoe.urgent_staging_placeholder','ruleVersion','check','actor','system',
   'attributes',jsonb_build_object('noreon.zoe.urgent.red_flags',flags))))$$;
create function pg_temp.calm()returns jsonb language sql as $$
 select jsonb_build_object('seq',null,'answer',null,'language',null,'alertReason',null,'configVersion','urgent-reach-check',
  'events',jsonb_build_array(jsonb_build_object('name','zoe.guard.urgent_match','outcome','allow','reason','no_staging_list_words','rule','zoe.urgent_staging_placeholder','ruleVersion','check','actor','system','attributes','{}'::jsonb)))$$;
create function pg_temp.dispatch(m uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.system_message_claim(m,gen_random_uuid());reset role;return j;end$$;
-- Member n's Zoe run in the app, claimed and reserved; finished with a result.
create function pg_temp.claim_run(member int)returns uuid language plpgsql as $$declare j jsonb;r uuid;begin
 j:=pg_temp.claim();select(x->>'runId')::uuid into r from jsonb_array_elements(j)x where(x->>'memberId')::uuid=pg_temp.u(member);
 if r is null then raise exception 'FAIL: no run claimed: %',j;end if;
 update public.zoe_runs set reserved=true,tier='high'where id=r;return r;end$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.res(outcome text,reason text,answer text,urgency text,fwd text,why text,receipt jsonb default null)returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Synthetic summary for the doctor.','answer',answer,'language',case when answer is null then null else 'en'end,
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',300),'costUsd',0.01,'latencyMs',900,
  'provider','vercel.ai_gateway','model','anthropic/claude-opus-5.5','configVersion','urgent-reach-check','sealed',null,'tier','high','tierReason','rule_result_reading','fallbackUsed',false,'events','[]'::jsonb,
  'receipt',receipt,'health',jsonb_build_object('urgency',urgency,'modelUrgency',urgency,'forward',fwd,'forwardReason',why)))$$;
-- Doctor 11's reply item for member 01.
create function pg_temp.reply_item()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(11);set local role authenticated;j:=public.doctor_ai_inbox();reset role;
 return(select x from jsonb_array_elements(j->'items')x where(x->>'memberId')::uuid=pg_temp.u(1)and x->>'kind'like 'reply%');end$$;
-- The doctor writes and approves a reply: a decision closes the window (as check-zoe-a2-safety.sql).
create function pg_temp.typed(member int,d int)returns jsonb language plpgsql as $$declare w jsonb;a jsonb;c jsonb;j jsonb;begin
 perform pg_temp.as_user(d);set local role authenticated;w:=public.conversation_workspace(pg_temp.u(member));
 j:=public.conversation_compose(pg_temp.u(member),gen_random_uuid(),(w->>'version')::bigint,(w->>'clinicalRevision')::bigint,(w->>'draftEpoch')::bigint,w->>'sourceToken','Synthetic typed reply.','Synthetic summary.');
 if j->>'ok'<>'true'then raise exception 'FAIL: compose refused: %',j;end if;
 -- #438 still applies when the pending reply is in Today because of a same-day forward.
 w:=public.doctor_ai_inbox();
 perform pg_temp.ok(exists(select 1 from jsonb_array_elements(w->'items')x where(x->>'memberId')::uuid=pg_temp.u(member)
  and x->>'kind'='reply_draft'and x->>'lane'='P1'and x->>'ai'='none'and x->>'confidence'='L'and x#>>'{draft,author}'='staff'),
  'inbox: #438 keeps the doctor''s own same-day draft free of AI labels');
 a:=public.conversation_actions(pg_temp.u(member));
 c:=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{view,actions}')x where x->>'purpose'='reply.approve'),
  'requestId',replace(gen_random_uuid()::text,'-',''));
 j:=public.conversation_command(c);reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: typed approval refused: %',j;end if;return j;end$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- People. 01: read by Zoe, app and Telegram, doctor 11. 02: no Zoe consent, doctor 11. 03: consent, no assigned doctor. 04: consent later withdrawn,
-- doctor 11. 05: no Zoe consent, app only, doctor 11. Doctor 11, admin 14.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990410'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,4,5,11,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,3,4,5,11,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic urgent reach clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values(pg_temp.u(11),'doctor','Dr Reach',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Reach');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values(pg_temp.u(1),pg_temp.u(11)),(pg_temp.u(2),pg_temp.u(11)),(pg_temp.u(3),null),(pg_temp.u(4),pg_temp.u(11)),(pg_temp.u(5),pg_temp.u(11));
update public.profiles set locale='en',display_name='Reach Synthetic'where id in(pg_temp.u(1),pg_temp.u(2),pg_temp.u(3),pg_temp.u(4),pg_temp.u(5));
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_ur',9041,600,'consent-ur');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-ur',3600,600,60,40,false,true,true)on conflict(singleton)do update set version=excluded.version,intake_max_messages=40,app_chat_enabled=true,delivery_enabled=true,grant_seconds=3600,intent_seconds=600;
select public._telegram_replies_activate(pg_temp.u(n),(pg_temp.bind(pg_temp.u(n),'member',9400+n)->>'bindingId')::uuid)from unnest(array[2,3,4])n;
-- Member 01's Telegram is only the route a doctor's reply takes (section 11).
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.u(1),'telegram','synthetic-bot','synthetic-ur-1','9100001',1,true,'synthetic-ur',now()+interval '1 day',4096);
insert into public.zoe_consents(member_id,kind,granted,wording_version)select pg_temp.u(n),'zoe_reads_messages',true,'zoe-consent-draft-1'from unnest(array[1,3,4])n;
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.u(14)from public.zoe_tier_config;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33+intake-30',540,0,0,pg_temp.u(14)from public.zoe_tier_config where tier='high';
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set conversational_replies_enabled=true;
update public.zoe_settings set health_answers_enabled=true;
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.answer','zoe.chat','zoe.receipt','zoe.urgent');
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values('telegram.ack',2,'en','Synthetic approved acknowledgement. Call 103 in an emergency.',true,'test fixture');
insert into public.care_alert_settings(enabled)values(true)on conflict do nothing;
update public.care_alert_settings set enabled=true;

-- 0. Grants: the worker only.
select pg_temp.ok(not has_function_privilege('anon','public.zoe_unread_urgent_pending(integer)','execute')and not has_function_privilege('authenticated','public.zoe_unread_urgent_pending(integer)','execute')
 and not has_function_privilege('anon','public.zoe_unread_urgent_finish(uuid,jsonb)','execute')and not has_function_privilege('authenticated','public.zoe_unread_urgent_finish(uuid,jsonb)','execute')
 and has_function_privilege('service_role','public.zoe_unread_urgent_pending(integer)','execute')and has_function_privilege('service_role','public.zoe_unread_urgent_finish(uuid,jsonb)','execute'),'grants: service role only');

-- 1. Message screening: urgent words with no red flag code raise an alert, for a member Zoe does not read too.
insert into kv values('i-self',to_jsonb(pg_temp.say('9501',2,'Synthetic words that are on the urgent list with no code')));
insert into kv values('m-self',to_jsonb((select id from public.conversation_messages where conversation_id=pg_temp.conv(2)order by seq desc limit 1)));
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_screen(null,'message',pg_temp.k('m-self')::text,'escalate','some_other_reason','{}','care_alert.urgent_staging_placeholder','check')->>'code'='invalid','screen: another reason with no code stays refused');
select pg_temp.ok(public.care_alert_screen(pg_temp.u(2),'zoe','urgent:reach','escalate','urgent_words_matched','{}','care_alert.urgent_staging_placeholder','check')->>'code'='invalid','screen: Zoe with no code stays refused here');
insert into kv values('s-self',public.care_alert_screen(null,'message',pg_temp.k('m-self')::text,'escalate','urgent_words_matched','{}','care_alert.urgent_staging_placeholder','check'));
select pg_temp.ok((select v->>'ok'='true'and v->>'outcome'='escalate'and v->>'alertId'is not null from kv where k='s-self'),'screen: an urgent word with no code escalates');
reset role;
select pg_temp.ok((select member_id=pg_temp.u(2)and source='message'and red_flags='{}'and reason_code='urgent_words_matched'and state='open'and doctor_id=pg_temp.u(11)from public.care_alerts where id=(select(v->>'alertId')::uuid from kv where k='s-self')),'screen: the alert is the member''s, for their doctor');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_messages_pending(20,false)@>'[]'::jsonb and not public.care_alert_messages_pending(20,false)@>jsonb_build_array(jsonb_build_object('messageId',pg_temp.k('m-self'))),'screen: the message is no longer pending, so it is not retried');
reset role;
-- No assigned doctor: the alert still exists, for admins.
insert into kv values('i-nodoc',to_jsonb(pg_temp.say('9502',3,'Synthetic words that are on the urgent list with no code')));
insert into kv values('m-nodoc',to_jsonb((select id from public.conversation_messages where conversation_id=pg_temp.conv(3)order by seq desc limit 1)));
select pg_temp.as_service();set local role service_role;
insert into kv values('s-nodoc',public.care_alert_screen(null,'message',pg_temp.k('m-nodoc')::text,'escalate','urgent_words_matched','{}','care_alert.urgent_staging_placeholder','check'));
reset role;
select pg_temp.ok((select member_id=pg_temp.u(3)and doctor_id is null from public.care_alerts where id=(select(v->>'alertId')::uuid from kv where k='s-nodoc')),'screen: no assigned doctor still raises');
select pg_temp.as_user(14);set local role authenticated;
select pg_temp.ok(public.care_alert_inbox()->'alerts'@>jsonb_build_array(jsonb_build_object('memberId',pg_temp.u(3),'redFlags','[]'::jsonb)),'screen: admins see it, with no code');
reset role;

-- 2. Skipped members. The claim gives Zoe nothing for them; the worker gets their Telegram messages, with the skip reason kept on the run.
select pg_temp.claim();
select pg_temp.ok((pg_temp.run(2)).outcome='skipped'and(pg_temp.run(2)).reason_code='no_zoe_reads_messages_consent'and(pg_temp.run(2)).urgent_checked_at is null,'skip: no consent');
select pg_temp.ok((pg_temp.run(3)).outcome='skipped'and(pg_temp.run(3)).reason_code='no_assigned_doctor'and(pg_temp.run(3)).urgent_checked_at is null,'skip: no doctor');
select pg_temp.ok(jsonb_array_length(pg_temp.row_for(2)->'messages')=1 and pg_temp.row_for(2)#>>'{messages,0,text}'='Synthetic words that are on the urgent list with no code'
 and pg_temp.row_for(2)->>'locale'='en'and pg_temp.row_for(2)->>'freeMode'='false','pending: the Telegram message, the locale, free mode off with the intake off');
update public.zoe_settings set symptom_intake_enabled=true;
select pg_temp.ok(pg_temp.row_for(2)->>'freeMode'='true','pending: free mode follows the settings');
update public.zoe_settings set symptom_intake_enabled=false;
select pg_temp.ok(pg_temp.row_for(3)is not null,'pending: the member with no doctor too');
-- An app member Zoe skips is not listed: the app's 103 screen covers them, and a Telegram text could not reach them.
select pg_temp.send(5,'Synthetic app message');select pg_temp.claim();
select pg_temp.ok((pg_temp.run(5)).outcome='skipped'and pg_temp.row_for(5)is null,'pending: an app-only member is not listed');
-- A member Zoe reads is not listed.
insert into kv values('i-read',to_jsonb(pg_temp.say('9503',4,'Synthetic message to Zoe')));
select pg_temp.claim();
select pg_temp.ok((pg_temp.run(4)).state='started'and pg_temp.row_for(4)is null,'pending: a member Zoe reads is not listed');
select pg_temp.ok(pg_temp.un((pg_temp.run(4)).id,pg_temp.urgent(1))->>'code'='not_a_skipped_run','finish: a run Zoe has is refused');

-- 3. Nothing urgent: no text, no answer, no alert, and it is not looked at again.
select pg_temp.ok(pg_temp.un((pg_temp.run(3)).id,pg_temp.calm())->>'outcome'='checked','calm: checked');
select pg_temp.ok((pg_temp.run(3)).urgent_checked_at is not null and(pg_temp.run(3)).outcome='skipped','calm: the run stays skipped');
select pg_temp.ok(pg_temp.row_for(3)is null,'calm: no longer pending');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(3)),'calm: no answer');
select pg_temp.ok(not exists(select 1 from public.system_messages where source_inbox_id=pg_temp.k('i-nodoc')and template_id in('zoe.answer','zoe.urgent')),'calm: nothing queued');
select pg_temp.ok(not exists(select 1 from public.care_alerts where member_id=pg_temp.u(3)and source='zoe'),'calm: no Zoe alert');
select pg_temp.ok(pg_temp.un((pg_temp.run(3)).id,pg_temp.urgent(1))->>'replayed'='true','calm: a later result changes nothing');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(3)),'calm: still no answer');

-- 4. Refused results leave the run pending.
select pg_temp.ok(pg_temp.un((pg_temp.run(2)).id,pg_temp.urgent(999))->>'code'='invalid','refused: a message the run does not cover');
select pg_temp.ok(pg_temp.un((pg_temp.run(2)).id,pg_temp.urgent(pg_temp.newest_seq(2))||'{"language":"fr"}')->>'code'='invalid','refused: an unsupported language');
select pg_temp.ok(pg_temp.un((pg_temp.run(2)).id,pg_temp.urgent(pg_temp.newest_seq(2))||jsonb_build_object('answer',repeat('x',701)))->>'code'='invalid','refused: too long');
select pg_temp.ok(pg_temp.un((pg_temp.run(2)).id,pg_temp.urgent(pg_temp.newest_seq(2))||'{"alertReason":"zoe_refused_103"}')->>'code'='invalid','refused: an unknown alert reason');
select pg_temp.ok(pg_temp.un((pg_temp.run(2)).id,'"x"'::jsonb)->>'code'='invalid','refused: not an object');
select pg_temp.ok(pg_temp.row_for(2)is not null and not exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(2)),'refused: still pending, nothing stored');

-- 5. Urgent: the fixed text, stored, queued, sent by the real dispatch claim with no Zoe consent; the alert; the run stays skipped and no model.
select pg_temp.ok(pg_temp.un((pg_temp.run(2)).id,pg_temp.urgent(pg_temp.newest_seq(2)))->>'outcome'='urgent_sent','urgent: sent');
select pg_temp.ok((pg_temp.run(2)).outcome='skipped'and(pg_temp.run(2)).reason_code='no_zoe_reads_messages_consent'and not(pg_temp.run(2)).reserved and(pg_temp.run(2)).urgent_checked_at is not null,'urgent: the run stays skipped, nothing reserved');
select pg_temp.ok((select kind='urgent'and provider='noreon.rules'and model='zoe-urgent-fixed'and language='en'and system_message_id is not null from public.zoe_member_answers where run_id=(pg_temp.run(2)).id),'urgent: an urgent answer on Telegram');
select pg_temp.ok((select template_id='zoe.answer'and state='queued'and body='Zoe: Synthetic fixed 103 text. Call 103.'from public.system_messages where source_inbox_id=pg_temp.k('i-self')and template_id='zoe.answer'),'urgent: the signed text is queued on the member''s Telegram message');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.urgent'and conversation_id=pg_temp.conv(2)and detail->>'runId'=(pg_temp.run(2)).id::text and(detail->>'unread')::boolean),'urgent: audited');
select pg_temp.ok((select reason_code='zoe_urgent_route'and red_flags='{RF-01}'and doctor_id=pg_temp.u(11)from public.care_alerts where member_id=pg_temp.u(2)and source='zoe'),'urgent: the Zoe alert, as for a member she reads');
select pg_temp.ok(exists(select 1 from public.care_alert_screenings where source='zoe'and source_ref='urgent:'||(pg_temp.run(2)).id::text and alert_id is not null),'urgent: screened per run');
select pg_temp.ok(pg_temp.dispatch((select system_message_id from public.zoe_member_answers where run_id=(pg_temp.run(2)).id))->>'ok'='true','urgent: the dispatch claim sends it with no Zoe consent');
select pg_temp.ok(pg_temp.un((pg_temp.run(2)).id,pg_temp.urgent(pg_temp.newest_seq(2)))->>'replayed'='true','urgent: a replay is a no-op');
select pg_temp.ok((select count(*)=1 from public.zoe_member_answers where member_id=pg_temp.u(2)),'urgent: one answer only');
select pg_temp.ok(pg_temp.row_for(2)is null,'urgent: no longer pending');

-- 6. The batch: a run covers the messages since the previous inbound run, Telegram ones only, and the text goes on one of them.
insert into kv values('i-b1',to_jsonb(pg_temp.say('9504',2,'Synthetic first in the batch')));
insert into kv values('i-b2',to_jsonb(pg_temp.say('9505',2,'Synthetic second in the batch')));
select pg_temp.claim();
select pg_temp.ok(jsonb_array_length(pg_temp.row_for(2)->'messages')=2 and pg_temp.row_for(2)#>>'{messages,0,text}'='Synthetic first in the batch'and pg_temp.row_for(2)#>>'{messages,1,text}'='Synthetic second in the batch','batch: both messages, oldest first, nothing from the earlier run');
-- Self-harm keeps its own reason on the alert; a live alert absorbs the repeat.
select pg_temp.ok(pg_temp.un((pg_temp.run(2)).id,pg_temp.urgent((pg_temp.row_for(2)#>>'{messages,1,seq}')::bigint,'zoe_self_harm',''))->>'outcome'='urgent_sent','batch: sent');
select pg_temp.ok((select reason_code='zoe_self_harm'and occurrences=2 from public.care_alerts where member_id=pg_temp.u(2)and source='zoe'),'batch: self-harm keeps its reason on the live alert');

-- 7. Consent withdrawn: a member with a run Zoe was going to read, and a new message: the 103 text still goes (20261023063508).
update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=clock_timestamp()where id=(pg_temp.run(4)).id;
insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.u(4),'zoe_reads_messages',false,'zoe-consent-draft-1');
insert into kv values('i-w',to_jsonb(pg_temp.say('9506',4,'Synthetic urgent words after withdrawing')));
select pg_temp.claim();
select pg_temp.ok((pg_temp.run(4)).reason_code='no_zoe_reads_messages_consent'and pg_temp.row_for(4)is not null,'withdrawn: skipped and pending');
select pg_temp.ok(pg_temp.un((pg_temp.run(4)).id,pg_temp.urgent(pg_temp.newest_seq(4)))->>'outcome'='urgent_sent','withdrawn: sent');
select pg_temp.ok(pg_temp.dispatch((select system_message_id from public.zoe_member_answers where run_id=(pg_temp.run(4)).id))->>'ok'='true','withdrawn: the dispatch claim sends it');

-- 8. zoe.answer not approved: the text is stored and the zoe.urgent template is the Telegram fallback. Care alerts off: the text still goes, no alert.
savepoint fallback;
insert into public.system_message_templates(template_id,version,locale,body,free_body,approved,approval_note)
 select 'zoe.answer',max(version)+1,'en','withdrawn',true,false,'Staging check'from public.system_message_templates where template_id='zoe.answer'and locale='en';
update public.care_alert_settings set enabled=false;
insert into kv values('i-f',to_jsonb(pg_temp.say('9507',4,'Synthetic urgent words, wording unapproved')));
select pg_temp.claim();
select pg_temp.ok(pg_temp.un((pg_temp.run(4)).id,pg_temp.urgent(pg_temp.newest_seq(4)))->>'outcome'='urgent_sent','fallback: sent');
select pg_temp.ok((select system_message_id is null from public.zoe_member_answers where run_id=(pg_temp.run(4)).id),'fallback: stored, no free text');
select pg_temp.ok(exists(select 1 from public.system_messages where source_inbox_id=pg_temp.k('i-f')and template_id='zoe.urgent'),'fallback: the zoe.urgent template');
select pg_temp.ok(not exists(select 1 from public.care_alert_screenings where source='zoe'and source_ref='urgent:'||(pg_temp.run(4)).id::text),'alerts off: no alert');
rollback to savepoint fallback;

-- 9. A failed raise never costs the member the text: it is journalled, and care_alert_zoe_urgent_retry raises it.
savepoint failed_raise;
alter table public.care_alert_screenings add constraint pg_temp_fail check(source<>'zoe')not valid;
insert into kv values('i-r',to_jsonb(pg_temp.say('9508',4,'Synthetic urgent words, raise fails')));
select pg_temp.claim();
select pg_temp.ok(pg_temp.un((pg_temp.run(4)).id,pg_temp.urgent(pg_temp.newest_seq(4)))->>'outcome'='urgent_sent','failed raise: the text still goes');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where subject_kind='zoe_run'and subject_id=(pg_temp.run(4)).id::text and name='care_alert.raise_failed'),'failed raise: journalled');
alter table public.care_alert_screenings drop constraint pg_temp_fail;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.care_alert_zoe_urgent_retry(20)->>'raised'='1','failed raise: the sweep raises it');
reset role;
rollback to savepoint failed_raise;

-- Zoe switched off is a skip like the others; the fixed text does not depend on her.
savepoint zoe_off;
update public.zoe_settings set consent_collection_enabled=false;
insert into kv values('i-off',to_jsonb(pg_temp.say('9510',4,'Synthetic message with Zoe off')));
select pg_temp.claim();
select pg_temp.ok((pg_temp.run(4)).reason_code='zoe_settings_off'and pg_temp.row_for(4)is not null,'Zoe off: skipped and pending');
rollback to savepoint zoe_off;

-- 10. Older than a day: not sent late.
insert into kv values('i-old',to_jsonb(pg_temp.say('9509',4,'Synthetic message, a day old by the time it is seen')));
select pg_temp.claim();
select pg_temp.ok(pg_temp.row_for(4)is not null,'late: pending');
update public.zoe_runs set finished_at=clock_timestamp()-interval '25 hours'where id=(pg_temp.run(4)).id;
select pg_temp.ok(pg_temp.row_for(4)is null,'late: past a day it is not');

-- 11. The doctor's inbox. Member 01, in the app. Below same day: routine. Same-day forward: Today, under a day old, with no draft.
select pg_temp.send(1,'Synthetic question about a reading');
select pg_temp.finish(pg_temp.claim_run(1),pg_temp.res('answered','health_answer_passed_guards','Synthetic answer. Should I send this to your doctor?','doctor_soon','auto','stopped_medicine'));
select pg_temp.ok(pg_temp.reply_item()->>'lane'='P3'and(pg_temp.reply_item()->>'rank')::int=0,'inbox: a forward below same day stays routine');
-- Zoe's fixed same-day exit is a summary and a receipt, not an answer: the same lane.
savepoint exit_path;
select pg_temp.send(1,'Synthetic third question');
select pg_temp.finish(pg_temp.claim_run(1),pg_temp.res('summary_only','same_day_floor_read_in_full',null,'same_day','auto','same_day',jsonb_build_object('text','Synthetic same-day line.','language','en','kind','receipt')));
select pg_temp.ok(pg_temp.reply_item()->>'lane'='P1','inbox: the fixed same-day exit too');
rollback to savepoint exit_path;
select pg_temp.send(1,'Synthetic second question');
select pg_temp.finish(pg_temp.claim_run(1),pg_temp.res('answered','health_answer_passed_guards','Synthetic same-day answer: this needs a doctor today.','same_day','auto','same_day'));
select pg_temp.ok(exists(select 1 from public.conversation_audit where conversation_id=pg_temp.conv(1)and kind='zoe.forward'and detail->>'urgency'='same_day'),'inbox: setup, the same-day forward is audited');
select pg_temp.ok(pg_temp.reply_item()->>'lane'='P1'and(pg_temp.reply_item()->>'rank')::int=4 and pg_temp.reply_item()->>'kind'='reply_draft','inbox: a same-day forward is in Today, the item kind unchanged');
select pg_temp.ok((pg_temp.reply_item()->>'at')::timestamptz>clock_timestamp()-interval '1 hour','inbox: Today well before the 24 hours');
-- A decision closes it: the next message starts a new window, in its usual lane.
select pg_temp.typed(1,11);
select pg_temp.ok(pg_temp.reply_item()is null,'inbox: the doctor''s reply closes the item');
select pg_temp.send(1,'Synthetic question after the reply');
select pg_temp.ok(pg_temp.reply_item()->>'lane'='P3','inbox: an older same-day forward does not carry into the next window');
select pg_temp.as_user(11);set local role authenticated;
select pg_temp.ok(public.doctor_ai_inbox()->>'unavailable'='[]','inbox: every source available');
reset role;

rollback;
