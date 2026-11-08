-- Codex Astra A2 (Zoe safety audit, 2026-10-20), the database half (20261023063508): consent withdrawal stops runs already
-- claimed (reserve and publication refused, queued ordinary Zoe texts held, dispatch revalidates, 103 texts still go); a doctor
-- takeover holds queued ordinary Zoe texts (dispatch revalidates, 103 texts still go); the fixed same-day line passes the
-- doctor-mode guard. Real paths: conversation_receive, zoe_run_claim, zoe_run_reserve, zoe_run_finish, conversation_command,
-- system_message_claim. Synthetic, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1a20000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1a20000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,anon,service_role;
create function pg_temp.send(member int,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text',txt));reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: message not received: %',j;end if;return j;end$$;
create function pg_temp.claim(member int,p_tier text default 'high')returns uuid language plpgsql as $$declare j jsonb;run uuid;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;
 select(x->>'runId')::uuid into run from jsonb_array_elements(j)x where(x->>'memberId')::uuid=pg_temp.u(member);
 if run is null then raise exception 'FAIL: no run claimed: %',j;end if;
 update public.zoe_runs set reserved=p_tier<>'none',tier=nullif(p_tier,'none')where id=run;return run;end$$;
create function pg_temp.next(member int,txt text,p_tier text default 'high')returns uuid language sql as $$select pg_temp.send(member,txt);select pg_temp.claim(member,p_tier)$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.res(outcome text,reason text,answer text,extra jsonb default '{}',lang text default 'en')returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Synthetic summary for the doctor.','answer',answer,'language',case when answer is null then null else lang end,
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',300),'costUsd',0.01,'latencyMs',900,
  'provider','vercel.ai_gateway','model','anthropic/claude-opus-5.5','configVersion','doctor-takeover-check','sealed',null,'tier','high','tierReason','rule_result_reading','fallbackUsed',false,
  'events','[]'::jsonb))||extra
$$;
create function pg_temp.h(urgency text,fwd text default 'none',reason text default 'none')returns jsonb language sql as $$
 select jsonb_build_object('urgency',urgency,'modelUrgency',urgency,'forward',fwd,'forwardReason',reason)$$;
create function pg_temp.receipt()returns jsonb language sql as $$select jsonb_build_object('receipt',jsonb_build_object('text','Synthetic warm receipt.','language','en','kind','receipt'))$$;
-- A pending draft for member n (as Zoe proposes it), then doctor d approves it through conversation_actions and conversation_command.
create function pg_temp.reply(member int,d int,txt text default 'Synthetic question for the doctor')returns jsonb language plpgsql as $$declare run uuid;a jsonb;c jsonb;j jsonb;begin
 run:=pg_temp.next(member,txt,'medium');
 j:=pg_temp.finish(run,pg_temp.res('draft_proposed','draft_passed_guards',null,jsonb_build_object('draft','Synthetic doctor reply.','tier','medium')));
 if j->>'outcome'<>'draft_proposed'then raise exception 'FAIL: no draft proposed: %',j;end if;
 perform pg_temp.as_user(d);set local role authenticated;a:=public.conversation_actions(pg_temp.u(member));reset role;
 c:=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{view,actions}')x where x->>'purpose'='reply.approve'),
  'requestId',replace(gen_random_uuid()::text,'-',''));
 perform pg_temp.as_user(d);set local role authenticated;j:=public.conversation_command(c);reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: approval refused: %',j;end if;return j;end$$;
-- The doctor writes their own reply (conversation_compose) and approves it: the typed-reply path.
create function pg_temp.typed(member int,d int)returns jsonb language plpgsql as $$declare w jsonb;a jsonb;c jsonb;j jsonb;begin
 perform pg_temp.send(member,'Synthetic question, typed reply');
 perform pg_temp.as_user(d);set local role authenticated;w:=public.conversation_workspace(pg_temp.u(member));
 j:=public.conversation_compose(pg_temp.u(member),gen_random_uuid(),(w->>'version')::bigint,(w->>'clinicalRevision')::bigint,(w->>'draftEpoch')::bigint,w->>'sourceToken','Synthetic typed reply.','Synthetic summary.');
 if j->>'ok'<>'true'then raise exception 'FAIL: compose refused: %',j;end if;
 a:=public.conversation_actions(pg_temp.u(member));
 c:=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{view,actions}')x where x->>'purpose'='reply.approve'),
  'requestId',replace(gen_random_uuid()::text,'-',''));
 j:=public.conversation_command(c);reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: typed approval refused: %',j;end if;return j;end$$;
create function pg_temp.conv(member int)returns uuid language sql as $$select id from public.conversations where member_id=pg_temp.u(member)$$;
create function pg_temp.mode(member int)returns public.zoe_doctor_mode language sql as $$select * from public.zoe_doctor_mode where conversation_id=pg_temp.conv(member)$$;
create function pg_temp.view(n int,member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_zoe_mode(pg_temp.u(member));reset role;return j;end$$;
create function pg_temp.hand_back(n int,member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_zoe_hand_back(pg_temp.u(member));reset role;return j;end$$;
create function pg_temp.thread(member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_member_thread();reset role;return j;end$$;
create function pg_temp.waiting(n int,member int)returns boolean language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.conversation_awaiting_replies();reset role;
 return exists(select 1 from jsonb_array_elements(j->'items')x where(x->>'memberId')::uuid=pg_temp.u(member)and x->>'reason'='new_message');end$$;
create function pg_temp.dm_runs(run uuid)returns boolean language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_doctor_mode(array[run]);reset role;return(j->0->>'doctorMode')::boolean;end$$;
create function pg_temp.notices(member int,kind text)returns bigint language sql as $$select count(*)from public.zoe_mode_notices where member_id=pg_temp.u(member)and zoe_mode_notices.kind=notices.kind$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- People: members 01, 03 (doctor 11, nurse 13), 02 (doctor 12); doctors 11, 12; nurse 13; admin 14. Member 03 has no Zoe consent.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990372'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,3,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic A2 clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Dr Takeover One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Takeover Two',pg_temp.u(20)),(pg_temp.u(13),'nurse','Nurse Takeover',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Takeover');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null),(pg_temp.u(3),pg_temp.u(11),pg_temp.u(13));
update public.profiles set locale='en',display_name='Zara Synthetic'where id in(pg_temp.u(1),pg_temp.u(2),pg_temp.u(3));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-a2',3600,600,60,40,false,true,true)on conflict(singleton)do update set version=excluded.version,intake_max_messages=40,app_chat_enabled=true,delivery_enabled=true,grant_seconds=3600,intent_seconds=600;
-- Member 01 also has Telegram (the route a doctor's reply takes).
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.u(1),'telegram','synthetic-bot','synthetic-a2-1','9100001',1,true,'synthetic-a2',now()+interval '1 day',4096);
insert into public.zoe_consents(member_id,kind,granted,wording_version)select pg_temp.u(n),'zoe_reads_messages',true,'zoe-consent-draft-1'from unnest(array[1,2])n;
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.u(14)from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set conversational_replies_enabled=true;
update public.zoe_settings set health_answers_enabled=true;
-- This check covers the whole-conversation takeover; the per-topic scope (the default since 20261021070207) is in check-zoe-context-scope.sql.
update public.zoe_settings set doctor_takeover_scope='conversation';
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.answer','zoe.chat','zoe.receipt','zoe.urgent');
select pg_temp.ok((select bool_and(not approved and free_body)and count(*)=2 from public.system_message_templates where template_id='zoe.mode'),'zoe.mode ships unapproved (staging approves it)');
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id='zoe.mode';
insert into public.care_alert_settings(enabled)values(true)on conflict do nothing;
update public.care_alert_settings set enabled=true;

-- Member 02 also has Telegram.
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.u(2),'telegram','synthetic-bot','synthetic-a2-2','9100002',1,true,'synthetic-a2',now()+interval '1 day',4096);
-- A queued Telegram copy of a stored Zoe text (as _zoe_text_enqueue writes it for a Telegram message).
create function pg_temp.queue(answer uuid)returns uuid language plpgsql as $$declare a public.zoe_member_answers;t public.system_message_templates;ep public.conversation_endpoints;nid uuid;begin
 select * into a from public.zoe_member_answers where zoe_member_answers.id=answer;
 select * into ep from public.conversation_endpoints where member_id=a.member_id and active limit 1;
 select * into t from public.system_message_templates where template_id='zoe.answer'and locale='en'order by version desc limit 1;
 insert into public.system_messages(member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation)
 values(a.member_id,t.template_id,t.version,t.locale,'Zoe: '||a.body,public._system_message_hash(t.template_id,t.version,t.locale,'Zoe: '||a.body),ep.id,ep.generation)returning system_messages.id into nid;
 update public.zoe_member_answers set system_message_id=nid where zoe_member_answers.id=answer;return nid;end$$;
create function pg_temp.dispatch(m uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.system_message_claim(m,gen_random_uuid());reset role;return j;end$$;
create function pg_temp.reserve(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_reserve(run,0.01,true,'[]','high','anthropic/claude-opus-5.5');reset role;return j;end$$;
create function pg_temp.answer_of(run uuid)returns uuid language sql as $$select id from public.zoe_member_answers where run_id=run$$;
create function pg_temp.urgent()returns jsonb language sql as $$select pg_temp.res('discarded','urgent_route_no_model_call','Synthetic urgent text. Call 103.',jsonb_build_object('tier','none','tierReason','urgent'))$$;
create function pg_temp.answered()returns jsonb language sql as $$select pg_temp.res('answered','health_answer_passed_guards','Synthetic answer.',jsonb_build_object('health',pg_temp.h('planned')))$$;
create function pg_temp.withdraw(member int)returns void language sql as $$insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.u(member),'zoe_reads_messages',false,'zoe-consent-draft-1')$$;
create function pg_temp.grant_(member int)returns void language sql as $$insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.u(member),'zoe_reads_messages',true,'zoe-consent-draft-1')$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;
create temp table t(k text primary key,v uuid);

-- A2-3. Consent withdrawal stops runs already claimed.
-- An answered Zoe text and an urgent text are queued on Telegram for member 01.
insert into t select 'r1',pg_temp.next(1,'Synthetic question one');
select pg_temp.ok(pg_temp.finish((select v from t where k='r1'),pg_temp.answered())->>'outcome'='answered','before withdrawal: answered');
insert into t select 'sm1',pg_temp.queue(pg_temp.answer_of((select v from t where k='r1')));
insert into t select 'r0',pg_temp.next(1,'Synthetic urgent words','none');
select pg_temp.ok(pg_temp.finish((select v from t where k='r0'),pg_temp.urgent())->>'outcome'='discarded','urgent text stored');
insert into t select 'sm0',pg_temp.queue(pg_temp.answer_of((select v from t where k='r0')));
-- Two runs claimed before the withdrawal (unreserved), then the member withdraws.
insert into t select 'r2',pg_temp.next(1,'Synthetic question two','none');
select pg_temp.withdraw(1);
select pg_temp.ok((select state='held'and reason='zoe_consent_withdrawn'from public.system_messages where id=(select v from t where k='sm1')),'withdrawal holds the queued ordinary Zoe text');
select pg_temp.ok((select state='queued'from public.system_messages where id=(select v from t where k='sm0')),'withdrawal keeps the queued 103 text');
select pg_temp.ok(pg_temp.reserve((select v from t where k='r2'))->>'code'='no_zoe_reads_messages_consent','reserve after withdrawal: refused');
select pg_temp.ok((select not reserved from public.zoe_runs where id=(select v from t where k='r2')),'nothing reserved');
select pg_temp.ok((select j->>'outcome'='discarded'from(select pg_temp.finish((select v from t where k='r2'),pg_temp.answered()||pg_temp.receipt())j)x),'publish after withdrawal: refused');
select pg_temp.ok((select reason_code='consent_withdrawn'from public.zoe_runs where id=(select v from t where k='r2'))and pg_temp.answer_of((select v from t where k='r2'))is null,'no answer and no receipt stored');
-- Dispatch revalidates: an ordinary text queued again is held at the claim; the 103 text still goes.
update public.system_messages set state='queued',reason=null where id=(select v from t where k='sm1');
select pg_temp.ok(pg_temp.dispatch((select v from t where k='sm1'))->>'code'='zoe_consent_withdrawn','dispatch holds an ordinary Zoe text after withdrawal');
select pg_temp.ok(pg_temp.dispatch((select v from t where k='sm0'))->>'ok'='true','dispatch still sends the 103 text');
-- An urgent run claimed before the withdrawal still delivers its 103 text.
select pg_temp.grant_(1);
insert into t select 'r3',pg_temp.next(1,'Synthetic urgent words again','none');
select pg_temp.withdraw(1);
select pg_temp.ok(pg_temp.finish((select v from t where k='r3'),pg_temp.urgent())->>'outcome'='discarded','urgent finish after withdrawal');
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=(select v from t where k='r3')and kind='urgent'),'the 103 text is still stored for the member');

-- A2-5. Doctor takeover holds queued ordinary Zoe texts; 103 texts and later same-day lines still go.
insert into t select 'r4',pg_temp.next(2,'Synthetic question for Zoe');
select pg_temp.ok(pg_temp.finish((select v from t where k='r4'),pg_temp.answered())->>'outcome'='answered','member 02 answered');
insert into t select 'sm4',pg_temp.queue(pg_temp.answer_of((select v from t where k='r4')));
insert into t select 'r5',pg_temp.next(2,'Synthetic urgent words','none');
select pg_temp.finish((select v from t where k='r5'),pg_temp.urgent());
insert into t select 'sm5',pg_temp.queue(pg_temp.answer_of((select v from t where k='r5')));
select pg_temp.reply(2,12);
select pg_temp.ok((pg_temp.mode(2)).doctor_mode,'doctor mode on');
select pg_temp.ok((select state='held'and reason='doctor_takeover'from public.system_messages where id=(select v from t where k='sm4')),'takeover holds the queued Zoe answer');
select pg_temp.ok((select state='queued'from public.system_messages where id=(select v from t where k='sm5')),'takeover keeps the queued 103 text');
update public.system_messages set state='queued',reason=null where id=(select v from t where k='sm4');
select pg_temp.ok(pg_temp.dispatch((select v from t where k='sm4'))->>'code'='doctor_takeover','dispatch holds the older Zoe answer after takeover');
select pg_temp.ok(pg_temp.dispatch((select v from t where k='sm5'))->>'ok'='true','dispatch still sends the 103 text');
-- A2-2: the fixed same-day line goes in doctor mode; an ordinary receipt does not.
insert into t select 'r6',pg_temp.next(2,'Synthetic potassium reading','none');
select pg_temp.ok(pg_temp.finish((select v from t where k='r6'),pg_temp.res('summary_only','same_day_floor_doctor_mode',null,jsonb_build_object('tier','none','tierReason','not_routed',
 'health',jsonb_build_object('urgency','same_day','modelUrgency','none','forward','auto','forwardReason','same_day'),
 'receipt',jsonb_build_object('text','Synthetic same-day line.','language','en','kind','receipt'))))->>'ok'='true','same-day finish in doctor mode');
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=(select v from t where k='r6')and body='Synthetic same-day line.'),'the same-day line reaches the member in doctor mode');
select pg_temp.ok((select reason_code='same_day_floor_doctor_mode'from public.zoe_runs where id=(select v from t where k='r6')),'recorded as same-day');
insert into t select 'r7',pg_temp.next(2,'Synthetic ordinary question','none');
select pg_temp.finish((select v from t where k='r7'),pg_temp.res('summary_only','health_answer_blocked_by_guard',null,jsonb_build_object('tier','none','tierReason','not_routed'))||pg_temp.receipt());
select pg_temp.ok(pg_temp.answer_of((select v from t where k='r7'))is null,'an ordinary receipt is still held in doctor mode');

-- Task 8 review (Fable #522 R2, R3): the fixed "today" reply for self-harm thoughts without a plan passes a withdrawn consent as the 103 route
-- does. The answer, the forward audit and the care alert all stand, and dispatch sends it. Any other same-day exit stays held.
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.u(4),'37499037204',now());
insert into auth.sessions(id,user_id,created_at,updated_at)values(pg_temp.sid(4),pg_temp.u(4),now()-interval '1 hour',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(4),pg_temp.u(11),pg_temp.u(13));
update public.profiles set locale='en',display_name='Zara Synthetic'where id=pg_temp.u(4);
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.u(4),'telegram','synthetic-bot','synthetic-a2-4','9100004',1,true,'synthetic-a2',now()+interval '1 day',4096);
select pg_temp.grant_(4);
create function pg_temp.self_harm_today(p_reason text default 'same_day_floor_self_harm',p_forward text default 'self_harm')returns jsonb language sql as $$
 select pg_temp.res('summary_only',p_reason,null,jsonb_build_object('tier','none','tierReason','not_routed',
  'health',jsonb_build_object('urgency','same_day','modelUrgency','none','forward','auto','forwardReason',p_forward),
  'receipt',jsonb_build_object('text','Synthetic self-harm today text.','language','en','kind','receipt')))$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;
insert into t select 'r8',pg_temp.next(4,'Synthetic thoughts without a plan','none');
select pg_temp.withdraw(4);
select pg_temp.ok(pg_temp.finish((select v from t where k='r8'),pg_temp.self_harm_today())->>'ok'='true','R2: the finish passes a withdrawn consent');
select pg_temp.ok((select reason_code='same_day_floor_self_harm'and forward='auto'and forward_reason='self_harm'from public.zoe_runs where id=(select v from t where k='r8')),'R2: recorded and forwarded, not consent_withdrawn');
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=(select v from t where k='r8')and body='Synthetic self-harm today text.'),'R2: the answer row');
select pg_temp.ok(exists(select 1 from public.conversation_audit where conversation_id=pg_temp.conv(4)and kind='zoe.forward'and detail->>'runId'=(select v::text from t where k='r8')),'R2: the zoe.forward audit');
select pg_temp.ok(exists(select 1 from public.care_alerts where member_id=pg_temp.u(4)and source='zoe'and state<>'resolved'and reason_code='zoe_self_harm'),'R3: the care alert, reason zoe_self_harm');
insert into t select 'sm8',pg_temp.queue(pg_temp.answer_of((select v from t where k='r8')));
select pg_temp.ok(pg_temp.dispatch((select v from t where k='sm8'))->>'ok'='true','R2: dispatch sends it after the withdrawal');
-- A queued copy survives a withdrawal that comes after it.
select pg_temp.grant_(4);
insert into t select 'r9',pg_temp.next(4,'Synthetic thoughts, second time','none');
select pg_temp.ok(pg_temp.finish((select v from t where k='r9'),pg_temp.self_harm_today())->>'ok'='true','finish with consent');
insert into t select 'sm9',pg_temp.queue(pg_temp.answer_of((select v from t where k='r9')));
select pg_temp.withdraw(4);
select pg_temp.ok((select state='queued'from public.system_messages where id=(select v from t where k='sm9')),'R2: the withdrawal does not hold this queued text');
-- Control: any other same-day exit is still held by a withdrawn consent.
select pg_temp.grant_(4);
insert into t select 'r10',pg_temp.next(4,'Synthetic potassium reading','none');
select pg_temp.withdraw(4);
select pg_temp.finish((select v from t where k='r10'),pg_temp.self_harm_today('same_day_floor_doctor_mode','same_day'));
select pg_temp.ok((select reason_code='consent_withdrawn'from public.zoe_runs where id=(select v from t where k='r10')),'control: another same-day exit stays held');
select pg_temp.ok(pg_temp.answer_of((select v from t where k='r10'))is null,'control: no answer row');

-- Astra #522: the marker for the 24 hours after the today reply comes from the database, past the newest ten answers, through both window functions.
select pg_temp.ok(public._zoe_self_harm_today_minutes(pg_temp.conv(2))is null,'marker: null for a conversation with no today reply, never 0');
select pg_temp.grant_(4);
do $$declare i int;begin
 for i in 1..11 loop
  if pg_temp.finish(pg_temp.next(4,'Synthetic ordinary message '||i),pg_temp.answered())->>'outcome'<>'answered'then raise exception 'FAIL: intervening answer %',i;end if;
 end loop;end$$;
insert into t select 'r11',pg_temp.next(4,'Synthetic later message','none');
select pg_temp.ok((select count(*)>10 from public.zoe_member_answers a where a.conversation_id=pg_temp.conv(4)and a.created_at>(select max(b.created_at)from public.zoe_member_answers b join public.zoe_runs z on z.id=b.run_id where b.conversation_id=pg_temp.conv(4)and z.reason_code='same_day_floor_self_harm')),'more than ten answers since the today reply');
select pg_temp.as_service();
grant select on t to service_role;
set local role service_role;
select pg_temp.ok((public.zoe_run_urgent_window(array[(select v from t where k='r11')])->0->>'selfHarmTodayMinutes')::integer between 0 and 5,'marker through zoe_run_urgent_window');
select pg_temp.ok((public.zoe_run_alarm_window(array[(select v from t where k='r11')])->0->>'selfHarmTodayMinutes')::integer between 0 and 5,'marker through zoe_run_alarm_window');
reset role;

select 'zoe A2 safety: passed';
rollback;
