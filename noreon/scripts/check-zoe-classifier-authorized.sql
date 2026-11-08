-- Zoe classifier authorization (zoe_run_classifier_authorized): read-only, same gates as the reservation for the OpenAI Decisions provider. Rolled back; synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_sai",9017,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_sai",9017,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
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
create function pg_temp.reserve(run uuid,est numeric,loc boolean,tier text,model text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_reserve(run,est,loc,'[]',tier,model);reset role;return j;end$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.answer(text text,provider text default 'vercel.ai_gateway',tier text default 'low')returns jsonb language sql as $$
 select jsonb_build_object('outcome','answered','reason','direct_answer_passed_guards','summary','Member asked where visit times are.','draft',null,'answer',text,'language','en',
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',80),'costUsd',0.0002,'latencyMs',800,
  'provider',provider,'model','anthropic/claude-haiku-5.5','configVersion','zoe-conversation-prompt-1+test','sealed',null,'tier',tier,'tierReason','rule_logistics','fallbackUsed',false,'events','[]'::jsonb)
$$;
create function pg_temp.newrun(m uuid,seq bigint)returns uuid language sql as $$
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day)
 select c.id,m,seq,c.version,c.draft_epoch,(now() at time zone 'Asia/Yerevan')::date from public.conversations c where c.member_id=m returning id
$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

insert into auth.users(id,phone,phone_confirmed_at)values('d1920000-0000-4000-8000-000000000001','37499019101',now()),('d1920000-0000-4000-8000-000000000002',null,null),('d1920000-0000-4000-8000-000000000003',null,null);
insert into public.workspace_clinics(id,name)values('d1920000-0000-4000-8000-000000000004','Synthetic staging AI clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1920000-0000-4000-8000-000000000002','doctor','Dr Staging Synthetic','d1920000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('d1920000-0000-4000-8000-000000000003','admin','Admin Staging Synthetic');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1920000-0000-4000-8000-000000000001','d1920000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Staging Member'where id='d1920000-0000-4000-8000-000000000001';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_sai',9017,600,'consent-s');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-sai',3600,600,60,20,false,true);
select pg_temp.link('d1920000-0000-4000-8000-000000000001',8911);
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('d1920000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1');
create function pg_temp.auth(run uuid,model text default 'openai/gpt-6-luna')returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_classifier_authorized(run,model);reset role;return j;end$$;
create function pg_temp.settings(calls boolean,staging boolean)returns void language plpgsql as $$begin
 alter table public.zoe_settings disable trigger zoe_settings_guard;
 update public.zoe_settings set model_calls_allowed=calls,staging_ai_mode=staging;
 alter table public.zoe_settings enable trigger zoe_settings_guard;end$$;

-- Fixture: one started run for the synthetic member.
select pg_temp.say('2100',8911,'Where can I see my visit times?');
insert into kv values('c1',pg_temp.claim());
insert into kv select 'run',v->0->'runId'from kv where k='c1';
select pg_temp.ok((select jsonb_array_length(v)=1 from kv where k='c1'),'One claimed run');
create temp table before_state as select r.reserved,r.state,r.estimate_usd,(select count(*) from public.conversation_trace_events)events from public.zoe_runs r where r.id=(select (v#>>'{}')::uuid from kv where k='run');
grant all on before_state to authenticated,service_role;

-- 1. Real calls off: refused with the same code the reservation gives.
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'code'='model_calls_not_permitted','Calls off: refused (model_calls_not_permitted)');
-- 2. Staging mode plus calls on: allowed for the OpenAI classifier model.
select pg_temp.settings(true,true);
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'ok'='true','Staging mode with calls on: authorized');
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'),'OpenAI/GPT')->>'code'='invalid','A malformed model id is refused');
-- 3. Read-only: no reservation, no state change, no trace event.
select pg_temp.ok((select r.reserved=b.reserved and r.state=b.state and r.estimate_usd is not distinct from b.estimate_usd and (select count(*) from public.conversation_trace_events)=b.events
 from public.zoe_runs r,before_state b where r.id=(select (v#>>'{}')::uuid from kv where k='run')),'Asking changes nothing: not reserved, same state, no event');
-- 4. Data-agreement path: only a provider with a signed agreement (staging mode off).
select pg_temp.settings(true,false);
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'code'='model_calls_not_permitted','No staging mode, no signed agreement: refused');
update public.zoe_model_providers set data_agreement='signed'where provider='anthropic';
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'code'='model_calls_not_permitted','Only the answering provider is signed: OpenAI is still refused');
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'),'anthropic/claude-haiku-5.5')->>'ok'='true','The signed provider''s own model is allowed (same helper as the reservation)');
update public.zoe_model_providers set data_agreement='signed'where provider='openai';
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'ok'='true','OpenAI signed: authorized');
update public.zoe_model_providers set data_agreement='none';
select pg_temp.settings(true,true);
-- 5. Caps.
update public.zoe_settings set daily_spend_cap_usd=0.0005;
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'code'='daily_spend_cap_reached','Daily cap reached: refused');
update public.zoe_settings set daily_spend_cap_usd=10;
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'ok'='true','Cap restored: authorized');
update public.zoe_settings set member_daily_cap_usd=0.01;
insert into kv values('spent',to_jsonb(pg_temp.newrun('d1920000-0000-4000-8000-000000000001',-9)));
update public.zoe_runs set reserved=true,estimate_usd=0.02 where id=(select (v#>>'{}')::uuid from kv where k='spent');
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'code'='member_spend_cap_reached','Member daily cap reached: refused');
update public.zoe_settings set member_daily_cap_usd=3.00;
-- 6. Consent withdrawn after the claim.
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('d1920000-0000-4000-8000-000000000001','zoe_reads_messages',false,'zoe-consent-draft-1');
select pg_temp.ok(pg_temp.auth((select (v#>>'{}')::uuid from kv where k='run'))->>'code'='no_zoe_reads_messages_consent','Consent withdrawn after the claim: refused');
-- 7. A run that is not started, and an unknown run.
select pg_temp.ok(pg_temp.auth('00000000-0000-4000-8000-0000000000ff')->>'code'='run_not_authorizable','Unknown run: refused');
-- 8. Only the service role may call it.
do $$begin set local role authenticated;perform public.zoe_run_classifier_authorized((select (v#>>'{}')::uuid from kv where k='run'),'openai/gpt-6-luna');reset role;raise exception 'FAIL: a signed-in member called the authorization';
 exception when insufficient_privilege then reset role;end$$;
rollback;
select 'PASS Zoe classifier authorization: same gates as the reservation for the OpenAI provider, read-only, service role only';
