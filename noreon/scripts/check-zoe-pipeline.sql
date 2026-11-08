-- Zoe message pipeline (fake provider): claim, consent, spend cap, finish, doctor approval and
-- trace events, rolled back. Synthetic fixtures only; no Telegram, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_zoe",9007,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_zoe",9007,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.link(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 return public._telegram_replies_activate(m,(b->>'bindingId')::uuid);end$$;
create function pg_temp.say(id text,u bigint,txt text)returns void language plpgsql as $$begin
 perform pg_temp.as_service();perform public.channel_inbox_commit(pg_temp.event(id,u,txt));perform pg_temp.drain();end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;return j;end$$;
create function pg_temp.svc(fn text,run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 if fn='finish'then j:=public.zoe_run_finish(run,arg);else j:=public.zoe_run_reserve(run,(arg->>'estimate')::numeric,(arg->>'local')::boolean,coalesce(arg->'events','[]'),coalesce(arg->>'tier','high'),coalesce(arg->>'model','noreon-fake-deterministic-1'));end if;
 reset role;return j;end$$;
create function pg_temp.result(outcome text,draft text default null)returns jsonb language sql as $$
 select jsonb_build_object('outcome',outcome,'reason',case outcome when 'draft_proposed'then 'draft_passed_guards'when 'draft_blocked'then 'draft_discarded_by_guard'else 'provider_timeout'end,
  'summary','Member wrote 1 message. Latest, as written: "synthetic"','draft',draft,'guardReasons',case when outcome='draft_blocked'then '["draft.dose"]'::jsonb else '[]'::jsonb end,
  'redactionCount',1,'usage',jsonb_build_object('inputTokens',400,'outputTokens',60),'costUsd',0.0035,'latencyMs',3,'provider','noreon.fake','model','noreon-fake-deterministic-1',
  'configVersion','zoe-intake-draft-prompt-1+test','sealed','v1:abc:iv:tag:body',
  'events',jsonb_build_array(jsonb_build_object('name','zoe.provider.call','outcome','allow','reason','completed','rule','zoe.provider','ruleVersion','zoe-intake-draft-prompt-1','actor','ai',
   'attributes',jsonb_build_object('gen_ai.operation.name','chat','gen_ai.provider.name','noreon.fake','gen_ai.request.model','noreon-fake-deterministic-1','gen_ai.usage.input_tokens',400,'gen_ai.usage.output_tokens',60,'noreon.zoe.latency_ms',3,'noreon.zoe.cost_usd',0.0035))))
$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

-- Member, assigned doctor, a second doctor, admin; a second member without consent.
insert into auth.users(id,phone,phone_confirmed_at)values('d1900000-0000-4000-8000-000000000001','37499019001',now()),('d1900000-0000-4000-8000-000000000002',null,null),
 ('d1900000-0000-4000-8000-000000000003',null,null),('d1900000-0000-4000-8000-000000000008',null,null),('d1900000-0000-4000-8000-000000000009','37499019009',now());
insert into public.workspace_clinics(id,name)values('d1900000-0000-4000-8000-000000000004','Synthetic Zoe clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1900000-0000-4000-8000-000000000002','doctor','Dr Zoe Synthetic','d1900000-0000-4000-8000-000000000004'),
 ('d1900000-0000-4000-8000-000000000008','doctor','Dr Other Synthetic','d1900000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('d1900000-0000-4000-8000-000000000003','admin','Admin Zoe Synthetic');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1900000-0000-4000-8000-000000000006','d1900000-0000-4000-8000-000000000002',now(),now()),
 ('d1900000-0000-4000-8000-000000000007','d1900000-0000-4000-8000-000000000003',now(),now()),('d1900000-0000-4000-8000-000000000010','d1900000-0000-4000-8000-000000000008',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1900000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000002'),('d1900000-0000-4000-8000-000000000009','d1900000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Zoe Member'where id='d1900000-0000-4000-8000-000000000001';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_zoe',9007,600,'consent-z');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-zoe',3600,600,60,20,false,true);
select pg_temp.link('d1900000-0000-4000-8000-000000000001',8901);
select pg_temp.link('d1900000-0000-4000-8000-000000000009',8909);

-- G0: without the settings row nothing is read; the run is skipped with its reason and traced.
select pg_temp.say('900',8901,'Synthetic first message');
insert into kv values('c0',pg_temp.claim());reset role;
select pg_temp.ok((select v='[]'::jsonb from kv where k='c0'),'No job without Zoe settings');
select pg_temp.ok((select outcome='skipped'and reason_code='zoe_settings_off'from public.zoe_runs where member_id='d1900000-0000-4000-8000-000000000001'),'Run skipped: zoe_settings_off');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.guard.consent'and outcome='block'and reason_code='zoe_settings_off'),'Consent block is traced');
select pg_temp.ok((select v='[]'::jsonb from kv where k='c0')and pg_temp.claim()='[]'::jsonb,'A message is claimed once');

-- Consent on for the first member only.
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('d1900000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1');
select pg_temp.say('901',8909,'Synthetic message from a member without consent');
select pg_temp.say('902',8901,'First synthetic line');
select pg_temp.say('903',8901,'Second synthetic line from Zoe Member');
insert into kv values('c1',pg_temp.claim());reset role;
select pg_temp.ok((select jsonb_array_length(v)=1 from kv where k='c1'),'O04: one job for the consenting member, for the newest message only');
select pg_temp.ok((select reason_code='no_zoe_reads_messages_consent'from public.zoe_runs where member_id='d1900000-0000-4000-8000-000000000009'),'No consent: skipped with reason');
select pg_temp.ok((select v->0->>'messageSeq'=(select max(seq)::text from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='d1900000-0000-4000-8000-000000000001')from kv where k='c1'),'Job is for the newest message');
select pg_temp.ok((select jsonb_array_length(v->0->'messages')=3 and v->0->>'displayName'='Zoe Member'from kv where k='c1'),'Window: unanswered member messages; display name for server-side redaction only');
select pg_temp.ok((select not(v->0 ?| array['phone','assignedDoctor','conversationId','endpoint'])from kv where k='c1'),'K07: the job carries no phone, doctor or conversation identifiers');
insert into kv select 'run',v->0->'runId'from kv where k='c1';

-- K7 spend cap: a non-local provider is refused (model_calls_allowed is false); the cap is checked per Yerevan day.
select pg_temp.ok(pg_temp.svc('reserve',(select (v#>>'{}')::uuid from kv where k='run'),'{"estimate":0.01,"local":false}')->>'code'='model_calls_not_permitted','K2: a real provider cannot reserve spend');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.spend.reserve'and outcome='block'and reason_code='model_calls_not_permitted'and rule_id='zoe.k2.launch_gate'),'Refusal is traced');
update public.zoe_settings set daily_spend_cap_usd=0.02;
insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at,reserved,estimate_usd,cost_usd)
 select conversation_id,member_id,-1,0,0,spend_day,'finished','no_output','provider_timeout',now(),true,0,0.015 from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='run');
select pg_temp.ok(pg_temp.svc('reserve',(select (v#>>'{}')::uuid from kv where k='run'),'{"estimate":0.01,"local":true}')->>'code'='daily_spend_cap_reached','K05: estimate over today''s remaining cap is refused');
select pg_temp.ok((select (attributes->>'noreon.zoe.spent_today_usd')::numeric=0.015 and (attributes->>'noreon.zoe.daily_cap_usd')::numeric=0.02 from public.conversation_trace_events where name='zoe.spend.reserve'and reason_code='daily_spend_cap_reached'),'Cap event carries spent, estimate and cap');
update public.zoe_settings set daily_spend_cap_usd=10;
select pg_temp.ok(pg_temp.svc('reserve',(select (v#>>'{}')::uuid from kv where k='run'),'{"estimate":0.01,"local":true,"events":[{"name":"zoe.guard.scope","outcome":"allow","reason":"in_scope","rule":"zoe.scope_classifier","ruleVersion":"zoe-scope-1","actor":"system","attributes":{"noreon.zoe.language":"en"}},{"name":"zoe.guard.bad","outcome":"allow","reason":"Free text here","rule":"x","ruleVersion":"1","actor":"system"}]}')->>'ok'='true','Within the cap the fake provider is reserved');
select pg_temp.ok(pg_temp.svc('reserve',(select (v#>>'{}')::uuid from kv where k='run'),'{"estimate":0.01,"local":true}')->>'code'='run_not_reservable','A run reserves once');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.guard.scope'and attributes->>'noreon.zoe.run.id'=(select v#>>'{}'from kv where k='run'))
 and exists(select 1 from public.conversation_trace_events where name='zoe.trace.event_rejected'and reason_code='event_invalid'),'Valid events written with the run id; an invalid one is replaced, never stored as sent');

-- Finish with a passing draft: a pending ai_assistant draft with no human author, nothing sent.
insert into kv select 'f1',pg_temp.svc('finish',(v#>>'{}')::uuid,pg_temp.result('draft_proposed','Synthetic AI draft reply'))from kv where k='run';
select pg_temp.ok((select v->>'outcome'='draft_proposed'from kv where k='f1'),'Draft proposed');
select pg_temp.ok((select r.author_kind='ai_assistant'and r.author_id is null and r.provenance->>'kind'='zoe'and r.provenance->>'engine'='noreon.fake'and d.state='pending'
 from public.conversation_drafts d join public.conversation_revisions r on r.draft_id=d.id where d.id=(select (v->>'draftId')::uuid from kv where k='f1')),'Pending AI draft with Zoe provenance');
select pg_temp.ok(not exists(select 1 from public.conversation_approvals)and not exists(select 1 from public.conversation_deliveries),'K1: nothing approved or queued by Zoe');
select pg_temp.ok((select cost_usd=0.0035 and input_tokens=400 and output_tokens=60 and summary is null and sealed_io is not null from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='run')),'Run records tokens, cost and sealed IO; the summary lives on the revision');
select pg_temp.ok((select pg_temp.svc('finish',(v#>>'{}')::uuid,pg_temp.result('draft_blocked'))->>'replayed'='true'from kv where k='run'),'K09/K16: a repeat finish replays, no second draft');
select pg_temp.ok((select count(*)=1 from public.conversation_drafts),'Exactly one draft');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.route'and outcome='allow'and reason_code='draft_passed_guards'and attributes ? 'noreon.draft.id')
 and exists(select 1 from public.conversation_trace_events where name='zoe.provider.call'and attributes->>'gen_ai.provider.name'='noreon.fake'and (attributes->>'gen_ai.usage.input_tokens')::int=400),'Route and OTel GenAI provider event traced');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='draft.revision_written'and reason_code='engine_draft'and rule_id='draft_engine.zoe'),'The existing draft journal names the Zoe engine');
select pg_temp.ok(not exists(select 1 from public.conversation_trace_events where attributes::text ~ 'Synthetic AI draft|First synthetic|Second synthetic|Member wrote'),'K12: no member, summary or draft text in any trace event');

-- The assigned doctor sees the AI draft in the existing reply flow and approves the exact text.
select pg_temp.as_staff('d1900000-0000-4000-8000-000000000002','d1900000-0000-4000-8000-000000000006');set local role authenticated;
insert into kv values('ws',public.conversation_workspace('d1900000-0000-4000-8000-000000000001'));
select pg_temp.ok((select (v->'drafts'->-1->'revisions'->0->>'author_kind')='ai_assistant'from kv where k='ws'),'Doctor workspace shows the AI draft');
insert into kv values('actions',public.conversation_actions('d1900000-0000-4000-8000-000000000001'));
select pg_temp.ok((select v#>>'{view,draft,author}'='ai_assistant'and v#>>'{view,draft,body}'='Synthetic AI draft reply'from kv where k='actions'),'Actions are issued for the AI draft');
insert into kv select 'approved',public.conversation_command(jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(v#>'{view,actions}')x where x->>'purpose'='reply.approve'),'requestId','d1900000000040008000000000000031'))from kv where k='actions';
select pg_temp.ok((select v->>'ok'='true'and v ? 'deliveryId'from kv where k='approved'),'The doctor approves through the reply machine');
select pg_temp.ok((select count(*)filter(where x->>'outcome'='draft_proposed')=1 and count(*)filter(where x->>'outcome'='skipped')=0 from jsonb_array_elements(public.zoe_runs_for_doctor('d1900000-0000-4000-8000-000000000001')->'runs')x),'Assigned doctor reads Zoe runs (skipped runs hidden)');
reset role;
select pg_temp.ok((select a.doctor_id='d1900000-0000-4000-8000-000000000002'and a.body='Synthetic AI draft reply'from public.conversation_approvals a),'Approval is the doctor''s, on the exact text');
select pg_temp.as_staff('d1900000-0000-4000-8000-000000000008','d1900000-0000-4000-8000-000000000010');set local role authenticated;
do $$begin perform public.zoe_runs_for_doctor('d1900000-0000-4000-8000-000000000001');raise exception 'FAIL: other doctor read runs';exception when insufficient_privilege then null;end$$;
reset role;
do $$begin perform set_config('request.jwt.claims','{"sub":"d1900000-0000-4000-8000-000000000001","role":"authenticated"}',true);set local role authenticated;
 perform public.zoe_run_claim(5);raise exception 'FAIL: member claimed';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.ok(not has_table_privilege('authenticated','public.zoe_runs','select')and not has_table_privilege('service_role','public.zoe_runs','select'),'zoe_runs is reachable only through functions');

-- K04: a newer member message during the call makes the proposal stale; the newer message gets its own run.
select pg_temp.say('904',8901,'Third synthetic line');
insert into kv values('c2',pg_temp.claim());reset role;
insert into kv select 'run2',v->0->'runId'from kv where k='c2';
select pg_temp.say('905',8901,'Fourth synthetic line');
select pg_temp.ok((select pg_temp.svc('finish',(v#>>'{}')::uuid,pg_temp.result('draft_proposed','Stale AI draft'))->>'outcome'='stale'from kv where k='run2'),'K04: stale on a newer member message');
select pg_temp.ok((select reason_code='newer_member_message'and draft_id is null from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='run2')),'Stale reason recorded, no draft');
insert into kv values('c3',pg_temp.claim());reset role;
select pg_temp.ok((select jsonb_array_length(v)=1 from kv where k='c3'),'The newer message is claimed next');
insert into kv select 'run3',v->0->'runId'from kv where k='c3';

-- K18: doctor work since the claim stands; no AI draft replaces it.
select pg_temp.as_staff('d1900000-0000-4000-8000-000000000002','d1900000-0000-4000-8000-000000000006');set local role authenticated;
insert into kv values('ws2',public.conversation_workspace('d1900000-0000-4000-8000-000000000001'));
select public.conversation_compose('d1900000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000032',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Doctor own reply','Doctor own summary')from kv where k='ws2';
reset role;
select pg_temp.ok((select pg_temp.svc('finish',(v#>>'{}')::uuid,pg_temp.result('draft_proposed','Late AI draft'))->>'outcome'='stale'from kv where k='run3'),'K18: doctor work since claim makes the AI result stale');
select pg_temp.ok((select count(*)=1 from public.conversation_drafts where state='pending')and exists(select 1 from public.conversation_revisions where body='Doctor own reply'),'The doctor''s draft stands');

-- A doctor draft already present for the current message is never replaced: summary only.
select pg_temp.say('906',8901,'Fifth synthetic line');
select pg_temp.as_staff('d1900000-0000-4000-8000-000000000002','d1900000-0000-4000-8000-000000000006');set local role authenticated;
insert into kv values('ws3',public.conversation_workspace('d1900000-0000-4000-8000-000000000001'));
select public.conversation_compose('d1900000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000033',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Doctor reply for fifth','Doctor summary')from kv where k='ws3';
reset role;
insert into kv values('c4',pg_temp.claim());reset role;
select pg_temp.ok((select pg_temp.svc('finish',(v->0->>'runId')::uuid,pg_temp.result('draft_proposed','AI draft for fifth'))->>'outcome'='summary_only'from kv where k='c4'),'A current doctor draft is not replaced');
select pg_temp.ok((select reason_code='doctor_draft_present'and summary is not null from public.zoe_runs where id=(select (v->0->>'runId')::uuid from kv where k='c4')),'Summary kept on the run for the doctor');

-- A blocked draft: summary and reasons for the doctor, no draft.
select pg_temp.say('907',8901,'Sixth synthetic line');
insert into kv values('c5',pg_temp.claim());reset role;
select pg_temp.ok((select pg_temp.svc('finish',(v->0->>'runId')::uuid,pg_temp.result('draft_blocked'))->>'outcome'='draft_blocked'from kv where k='c5'),'Blocked draft recorded');
select pg_temp.ok((select guard_reasons='{draft.dose}'and draft_id is null and summary is not null from public.zoe_runs where id=(select (v->0->>'runId')::uuid from kv where k='c5')),'Guard reasons and summary kept; no draft');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.route'and outcome='block'and reason_code='draft_discarded_by_guard'),'Blocked route traced');
-- Fable Z-F3: a message already answered by the doctor gets no AI draft.
select pg_temp.say('9071',8901,'Answered synthetic line');
select pg_temp.as_staff('d1900000-0000-4000-8000-000000000002','d1900000-0000-4000-8000-000000000006');set local role authenticated;
insert into kv values('ws4',public.conversation_workspace('d1900000-0000-4000-8000-000000000001'));
select public.conversation_compose('d1900000-0000-4000-8000-000000000001','d1900000-0000-4000-8000-000000000034',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Doctor answer','Doctor summary')from kv where k='ws4';
insert into kv values('actions4',public.conversation_actions('d1900000-0000-4000-8000-000000000001'));
select public.conversation_command(jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(v#>'{view,actions}')x where x->>'purpose'='reply.approve'),'requestId','d1900000000040008000000000000035'))from kv where k='actions4';
reset role;
select pg_temp.ok(pg_temp.claim()='[]'::jsonb,'Z-F3: an answered message is not claimed for drafting');reset role;
select pg_temp.ok(exists(select 1 from public.zoe_runs where reason_code='already_answered'and outcome='skipped'),'Z-F3: skipped as already_answered');
-- Invalid finish payloads are refused, never partially applied.
select pg_temp.say('908',8901,'Seventh synthetic line');
insert into kv values('c6',pg_temp.claim());reset role;
select pg_temp.ok((select pg_temp.svc('finish',(v->0->>'runId')::uuid,pg_temp.result('draft_proposed',repeat('x',2001)))->>'code'='invalid'from kv where k='c6'),'Over-long draft refused');
select pg_temp.ok((select pg_temp.svc('finish',(v->0->>'runId')::uuid,pg_temp.result('approved'))->>'code'='invalid'from kv where k='c6'),'Unknown outcome refused');
select pg_temp.ok((select pg_temp.svc('finish',(v->0->>'runId')::uuid,pg_temp.result('no_output')||jsonb_build_object('sealed',repeat('x',200001)))->>'ok'='true'from kv where k='c6')
 and(select sealed_io is null from public.zoe_runs where id=(select (v->0->>'runId')::uuid from kv where k='c6')),'Z-F4: oversized sealed IO is dropped, the run is still recorded');
-- A second run for the reaper test.
select pg_temp.say('9081',8901,'Eighth synthetic line');
insert into kv values('c7',pg_temp.claim());reset role;

-- A crashed worker's run is recorded as lost after ten minutes and never retried.
update public.zoe_runs set started_at=now()-interval '11 minutes'where id=(select (v->0->>'runId')::uuid from kv where k='c7');
select pg_temp.claim();reset role;
select pg_temp.ok((select state='finished'and outcome='no_output'and reason_code='worker_lost'from public.zoe_runs where id=(select (v->0->>'runId')::uuid from kv where k='c7')),'Lost run recorded, not retried');

-- Admin opens one run's sealed IO; the read is journaled.
select pg_temp.as_staff('d1900000-0000-4000-8000-000000000003','d1900000-0000-4000-8000-000000000007');set local role authenticated;
select pg_temp.ok((select public.zoe_run_detail((v#>>'{}')::uuid)#>>'{run,sealed}'='v1:abc:iv:tag:body'from kv where k='run'),'Admin reads the sealed IO');
reset role;
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.run.io_viewed'and actor_kind='admin'and actor_id='d1900000-0000-4000-8000-000000000003'),'Admin read is journaled');
select pg_temp.as_staff('d1900000-0000-4000-8000-000000000002','d1900000-0000-4000-8000-000000000006');set local role authenticated;
do $$begin perform public.zoe_run_detail(gen_random_uuid());raise exception 'FAIL: doctor read run detail';exception when insufficient_privilege then null;end$$;
reset role;

-- An AI revision needs no human author; a staff revision still does.
do $$begin insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)
 select id,99,'x','y','h',null,'staff','{}'from public.conversation_drafts limit 1;raise exception 'FAIL: staff revision without author';exception when check_violation then null;end$$;

-- K22: deleting the account removes its runs.
delete from public.zoe_runs where member_id='d1900000-0000-4000-8000-000000000009';
select pg_temp.ok(not exists(select 1 from public.zoe_runs where member_id='d1900000-0000-4000-8000-000000000009'),'Runs are deletable with the member');
select pg_temp.ok((select confdeltype='c'from pg_constraint where conname='zoe_runs_member_id_fkey')and(select confdeltype='c'from pg_constraint where conname='zoe_runs_conversation_id_fkey'),'Runs cascade with the account and the conversation');
rollback;
