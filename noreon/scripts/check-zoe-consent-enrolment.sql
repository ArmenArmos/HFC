-- Zoe consent at enrolment, the one-time card and the settings switch (20261018073940), rolled back.
-- Synthetic fixtures only. Covers: Agree records the enrolment consent and the Zoe grant with
-- wording version, time and source; the card grant; no overturning of an earlier choice;
-- refusals; withdrawal stops the next Zoe claim; every change is a history row and a trace event.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')))::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
-- Run a member RPC as that member (the app's own call path) and return its JSON.
create function pg_temp.call(m text,kind text,granted boolean,version text,source text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m);set local role authenticated;
 j:=case when source is null then public.zoe_consent_set(kind,granted,version)else public.zoe_consent_set(kind,granted,version,source)end;
 reset role;return j;end$$;
create function pg_temp.prompt(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m);set local role authenticated;j:=public.zoe_consent_prompt();reset role;return j;end$$;
-- Telegram fixtures for the claim, as in check-zoe-pipeline.sql.
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_zc",9011,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_zc",9011,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
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

-- A: new member enrolling (no clinical case yet). B: staff. C: member with a case, doctor and
-- Telegram (claim test). D: no confirmed phone. E: existing member, never decided. F: enrolled 2 hours ago.
-- G: new member who presses "Continue without Zoe" (20261019211953). H: the same, with a case,
-- doctor and Telegram, for the run guard.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('e2000000-0000-4000-8000-00000000000a','37499020001',now()),('e2000000-0000-4000-8000-00000000000b','37499020002',now()),
 ('e2000000-0000-4000-8000-00000000000c','37499020003',now()),('e2000000-0000-4000-8000-00000000000d',null,null),
 ('e2000000-0000-4000-8000-00000000000e','37499020005',now()),('e2000000-0000-4000-8000-00000000000f','37499020006',now()),
 ('e2000000-0000-4000-8000-000000000001',null,null),('e2000000-0000-4000-8000-000000000010','37499020007',now()),
 ('e2000000-0000-4000-8000-000000000011','37499020008',now());
insert into public.workspace_clinics(id,name)values('e2000000-0000-4000-8000-000000000002','Synthetic consent clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e2000000-0000-4000-8000-000000000001','doctor','Dr Consent Synthetic','e2000000-0000-4000-8000-000000000002');
insert into public.workspace_staff(user_id,role,display_name)values('e2000000-0000-4000-8000-00000000000b','admin','Admin Consent Synthetic');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('e2000000-0000-4000-8000-00000000000c','e2000000-0000-4000-8000-000000000001');
insert into public.patient_consents(user_id,version,accepted_at)values('e2000000-0000-4000-8000-00000000000f','patient-pilot-v1',now()-interval '2 hours');

-- Off: no settings row, so nothing is offered and nothing can be granted.
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000a')->>'show'='false','No card or statement while Zoe settings are absent');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-2','enrolment')->>'code'='unavailable','No enrolment grant while off');
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-2');
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000a')@>'{"show":true,"wordingVersion":"zoe-consent-draft-2"}','Statement offered to a member who never decided, with the server wording');
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000b')->>'show'='false'and pg_temp.prompt('e2000000-0000-4000-8000-00000000000d')->>'show'='false','Not offered to staff or a member without a confirmed phone');
do $$begin perform set_config('request.jwt.claims','{"role":"anon"}',true);perform public.zoe_consent_prompt();raise exception 'FAIL: anonymous prompt read';exception when insufficient_privilege then null;end$$;

-- Enrolment: the grant rides only on a fresh enrolment consent.
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-2','enrolment')->>'code'='not_eligible','No enrolment grant before the enrolment consent');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000f','zoe_reads_messages',true,'zoe-consent-draft-2','enrolment')->>'code'='not_eligible','No enrolment grant on an enrolment consent from hours ago');
-- Pressing Agree: save_patient_profile records the enrolment consent, then the app records Zoe.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.save_patient_profile('e2000000-0000-4000-8000-00000000000a','Consent Member','1980-01-01','female','en','patient-pilot-v1',
 '{"q1.age":{"fieldId":"q1.age","value":46,"source":"manual","answeredAt":"2026-10-18T08:00:00Z"}}',-1,null)=0,'Enrolment profile saved');
reset role;
select pg_temp.ok(exists(select 1 from public.patient_consents where user_id='e2000000-0000-4000-8000-00000000000a'and version='patient-pilot-v1'),'Enrolment consent recorded');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-1','enrolment')->>'code'='stale','A statement of another wording version is refused as stale');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_scheduled_questions',false,'zoe-consent-draft-2','enrolment')->>'code'='invalid','Enrolment records nothing about scheduled questions');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',false,'zoe-consent-draft-2','prompt')->>'code'='invalid'
 and pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',false,'zoe-consent-draft-2','zoe_screen')->>'code'='invalid','The card and the Zoe screen cannot record a no');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_scheduled_questions',true,'zoe-consent-draft-2','enrolment')->>'code'='invalid','Enrolment never grants scheduled questions');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-2','signup')->>'code'='invalid','Unknown source refused');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-2','enrolment')@>'{"ok":true,"changed":true,"readsMessages":true,"scheduledQuestions":false}','Agree records Zoe reading messages, without a clinical case');
select pg_temp.ok((select count(*)=1 and bool_and(granted and source='enrolment'and wording_version='zoe-consent-draft-2'and created_at>=now())
 from public.zoe_consents where member_id='e2000000-0000-4000-8000-00000000000a'),'One grant row: source enrolment, server wording version, timestamp');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where member_id='e2000000-0000-4000-8000-00000000000a'and subject_kind='zoe_consent'and name='zoe.consent.granted'
 and outcome='allow'and actor_kind='member'and rule_version='zoe-consent-draft-2'and attributes->>'noreon.zoe.consent.source'='enrolment'),'Enrolment grant is traced with its source');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-2','enrolment')->>'changed'='false'
 and pg_temp.prompt('e2000000-0000-4000-8000-00000000000a')->>'show'='false','A repeat writes nothing and the card is not shown after a decision');

-- "Continue without Zoe" (Gohar D-011, lead 19 Oct 23:10): enrolment records a first no, under the
-- same checks as a yes; the Home card stays away; only settings or the Zoe screen turn Zoe on again.
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000f','zoe_reads_messages',false,'zoe-consent-draft-2','enrolment')->>'code'='not_eligible','No enrolment no on an enrolment consent from hours ago');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.save_patient_profile('e2000000-0000-4000-8000-000000000010','Decline Member','1981-02-02','male','en','patient-pilot-v1',
 '{"q1.age":{"fieldId":"q1.age","value":45,"source":"manual","answeredAt":"2026-10-19T08:00:00Z"}}',-1,null)=0,'Declining member enrolled');
reset role;
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-000000000010','zoe_reads_messages',false,'zoe-consent-draft-1','enrolment')->>'code'='stale','An enrolment no about another wording is refused as stale');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-000000000010','zoe_reads_messages',false,'zoe-consent-draft-2','enrolment')@>'{"ok":true,"changed":true,"readsMessages":false}','Continue without Zoe records a no');
select pg_temp.ok((select count(*)=1 and bool_and(not granted and source='enrolment'and wording_version='zoe-consent-draft-2')
 from public.zoe_consents where member_id='e2000000-0000-4000-8000-000000000010'),'One no row: source enrolment, server wording version');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where member_id='e2000000-0000-4000-8000-000000000010'and subject_kind='zoe_consent'and name='zoe.consent.declined'
 and outcome='block'and actor_kind='member'and rule_version='zoe-consent-draft-2'and attributes->>'noreon.zoe.consent.source'='enrolment'),'The enrolment no is traced as declined');
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-000000000010')@>'{"show":false,"zoeScreen":true}','After the no: no Home card, the Zoe screen still offers Zoe');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-000000000010','zoe_reads_messages',false,'zoe-consent-draft-2','enrolment')->>'changed'='false'
 and pg_temp.call('e2000000-0000-4000-8000-000000000010','zoe_reads_messages',true,'zoe-consent-draft-2','enrolment')->>'changed'='false'
 and pg_temp.call('e2000000-0000-4000-8000-000000000010','zoe_reads_messages',true,'zoe-consent-draft-2','prompt')->>'changed'='false','Enrolment and the Home card never overturn the no');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-000000000010','zoe_reads_messages',true,'zoe-consent-draft-2','zoe_screen')@>'{"changed":true,"readsMessages":true}','Agree on the Zoe screen overturns an enrolment no');
select pg_temp.ok((select source='zoe_screen'and granted from public.zoe_consents where member_id='e2000000-0000-4000-8000-000000000010'order by id desc limit 1)
 and (select count(*)=2 from public.zoe_consents where member_id='e2000000-0000-4000-8000-000000000010')
 and exists(select 1 from public.conversation_trace_events where member_id='e2000000-0000-4000-8000-000000000010'and name='zoe.consent.granted'and attributes->>'noreon.zoe.consent.source'='zoe_screen'),'The Zoe screen yes is a new, traced row');
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-000000000010')@>'{"show":false,"zoeScreen":false}','No card anywhere once Zoe is on');
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000e')@>'{"show":true,"zoeScreen":true}','Never decided: both cards offered');

-- Settings: withdrawal through the existing three-argument call is a settings row; enrolment and
-- the card never overturn it.
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',false,'zoe-consent-draft-2',null)@>'{"changed":true,"readsMessages":false}','Settings switch turns Zoe off');
select pg_temp.ok((select source='settings'and not granted from public.zoe_consents where member_id='e2000000-0000-4000-8000-00000000000a'order by id desc limit 1),'Withdrawal recorded as source settings');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-2','prompt')@>'{"changed":false,"readsMessages":false}','The card never overturns a no');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-2','zoe_screen')@>'{"changed":false,"readsMessages":false}'
 and pg_temp.prompt('e2000000-0000-4000-8000-00000000000a')@>'{"show":false,"zoeScreen":false}','A no given in settings is undone only in settings: no Zoe screen card, no overturn there');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-2','settings')@>'{"changed":true,"readsMessages":true}','The member can turn it back on in settings');

-- One-time card for an existing member who never decided.
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000e')->>'show'='true','Card offered to an existing member without a decision');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000e','zoe_reads_messages',true,'zoe-consent-draft-2','prompt')@>'{"changed":true,"readsMessages":true}','OK on the card grants');
select pg_temp.ok((select source='prompt'and granted and wording_version='zoe-consent-draft-2'from public.zoe_consents where member_id='e2000000-0000-4000-8000-00000000000e'),'Card grant recorded as source prompt');
select pg_temp.ok((select attributes->>'noreon.zoe.consent.direct_answers'='false'from public.conversation_trace_events where member_id='e2000000-0000-4000-8000-00000000000e'and subject_kind='zoe_consent'),'The trace says direct answers were off when the member agreed (N3)');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000e','zoe_reads_messages',false,'zoe-consent-draft-2','prompt')->>'code'='invalid','The card cannot record a no (Not now records nothing)');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000b','zoe_reads_messages',true,'zoe-consent-draft-2','prompt')->>'code'='not_eligible'
 and pg_temp.call('e2000000-0000-4000-8000-00000000000d','zoe_reads_messages',true,'zoe-consent-draft-2','prompt')->>'code'='not_eligible','Staff and unconfirmed phones cannot grant');
select pg_temp.ok(not exists(select 1 from public.zoe_consents where member_id in('e2000000-0000-4000-8000-00000000000b','e2000000-0000-4000-8000-00000000000d','e2000000-0000-4000-8000-00000000000f')),'Refusals write nothing');
do $$begin update public.zoe_consents set granted=true;raise exception 'FAIL: consent history edited';exception when sqlstate '55000' then null;end$$;
select pg_temp.ok((select count(*)from public.zoe_consents)=(select count(*)from public.conversation_trace_events where subject_kind='zoe_consent'),'Every consent row has its trace event');

-- The run guard: a card grant lets Zoe claim the member's message; a withdrawal stops the next one.
update public.profiles set locale='en',display_name='Claim Member'where id='e2000000-0000-4000-8000-00000000000c';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_zc',9011,600,'consent-zc');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-zc',3600,600,60,20,false,true);
select pg_temp.link('e2000000-0000-4000-8000-00000000000c',9201);
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000c','zoe_reads_messages',true,'zoe-consent-draft-2','prompt')->>'changed'='true','Claim member grants on the card');
select pg_temp.say('9300',9201,'Synthetic consent line one');
select pg_temp.ok(jsonb_array_length(pg_temp.claim())=1,'With the grant Zoe claims the message');
reset role;
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000c','zoe_reads_messages',false,'zoe-consent-draft-2','settings')->>'changed'='true','Claim member turns Zoe off');
select pg_temp.say('9301',9201,'Synthetic consent line two');
select pg_temp.ok(pg_temp.claim()='[]'::jsonb,'After the withdrawal Zoe claims nothing');
reset role;
select pg_temp.ok((select reason_code='no_zoe_reads_messages_consent'from public.zoe_runs where member_id='e2000000-0000-4000-8000-00000000000c'order by message_seq desc limit 1),'The skipped run says no consent');
-- An enrolment no (20261019211953) also keeps Zoe away; a yes on the Zoe screen lets her claim again.
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('e2000000-0000-4000-8000-000000000011','e2000000-0000-4000-8000-000000000001');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.save_patient_profile('e2000000-0000-4000-8000-000000000011','Decline Claim Member','1979-04-04','female','en','patient-pilot-v1',
 '{"q1.age":{"fieldId":"q1.age","value":47,"source":"manual","answeredAt":"2026-10-19T08:00:00Z"}}',-1,null)=0,'Declining claim member enrolled');
reset role;
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-000000000011','zoe_reads_messages',false,'zoe-consent-draft-2','enrolment')->>'changed'='true','Claim member continues without Zoe');
select pg_temp.link('e2000000-0000-4000-8000-000000000011',9202);
select pg_temp.say('9400',9202,'Synthetic decline line one');
select pg_temp.ok(pg_temp.claim()='[]'::jsonb,'After an enrolment no Zoe claims nothing');
reset role;
select pg_temp.ok((select reason_code='no_zoe_reads_messages_consent'from public.zoe_runs where member_id='e2000000-0000-4000-8000-000000000011'order by message_seq desc limit 1),'The skipped run after an enrolment no says no consent');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-000000000011','zoe_reads_messages',true,'zoe-consent-draft-2','zoe_screen')->>'changed'='true','Claim member turns Zoe on from the Zoe screen');
select pg_temp.say('9401',9202,'Synthetic decline line two');
select pg_temp.ok(jsonb_array_length(pg_temp.claim())=1,'After the Zoe screen yes Zoe claims the next message');
reset role;

update public.zoe_settings set direct_answers_enabled=true;
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000a')->>'directAnswers'='true','The prompt tells the app direct answers are on (F3)');
-- Fable F2: a new wording version re-asks and stops Zoe until the member agrees to it.
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000c','zoe_reads_messages',true,'zoe-consent-draft-2','settings')->>'changed'='true','Claim member turns Zoe back on (draft-2)');
update public.zoe_settings set consent_wording_version='zoe-consent-draft-3';
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000c')@>'{"show":true,"wordingVersion":"zoe-consent-draft-3"}','New wording: the card asks again');
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000a')->>'show'='true','Every member with an outdated yes is asked again');
select pg_temp.say('9302',9201,'Synthetic consent line three');
select pg_temp.ok(pg_temp.claim()='[]'::jsonb,'A yes to outdated wording does not let Zoe claim');
reset role;
select pg_temp.ok((select reason_code='no_zoe_reads_messages_consent'from public.zoe_runs where member_id='e2000000-0000-4000-8000-00000000000c'order by message_seq desc limit 1),'Skipped: no consent to the current wording');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000c','zoe_reads_messages',true,'zoe-consent-draft-2','prompt')->>'code'='stale','The old text cannot be agreed to again');
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000c','zoe_reads_messages',true,'zoe-consent-draft-3','prompt')@>'{"changed":true,"readsMessages":true}','OK on the card agrees to the new wording');
select pg_temp.ok((select source='prompt'and wording_version='zoe-consent-draft-3'from public.zoe_consents where member_id='e2000000-0000-4000-8000-00000000000c'order by id desc limit 1),'Recorded against draft-3');
select pg_temp.ok((select attributes->>'noreon.zoe.consent.direct_answers'='true'from public.conversation_trace_events where member_id='e2000000-0000-4000-8000-00000000000c'and subject_kind='zoe_consent'order by id desc limit 1),'The trace says direct answers were on for the draft-3 yes (N3)');
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000c')->>'show'='false','No card once the current wording is agreed');
select pg_temp.say('9303',9201,'Synthetic consent line four');
select pg_temp.ok(jsonb_array_length(pg_temp.claim())=1,'Zoe claims again after the new yes');
reset role;
-- An outdated "no" stays a no: the card never asks a member who withdrew.
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000e')->>'show'='true'
 and pg_temp.call('e2000000-0000-4000-8000-00000000000e','zoe_reads_messages',false,'zoe-consent-draft-3','settings')->>'changed'='true'
 and pg_temp.prompt('e2000000-0000-4000-8000-00000000000e')->>'show'='false','A withdrawal of an outdated yes ends the asking');
-- Operator override for a purely editorial change: draft-3 stays valid under draft-4.
update public.zoe_settings set consent_wording_version='zoe-consent-draft-4',consent_wording_also_valid='{zoe-consent-draft-3}';
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000c')->>'show'='false','Kept-valid wording: no new card');
select pg_temp.say('9304',9201,'Synthetic consent line five');
select pg_temp.ok(jsonb_array_length(pg_temp.claim())=1,'Kept-valid wording: Zoe keeps claiming');
reset role;
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000c','zoe_reads_messages',true,'zoe-consent-draft-4','prompt')->>'changed'='false','No duplicate grant while the old wording is kept valid');
select pg_temp.ok(pg_temp.prompt('e2000000-0000-4000-8000-00000000000a')->>'show'='true','draft-2 is not kept valid: still asked');
-- Fable probe lines: a banned member and the service role cannot grant.
update auth.users set banned_until=now()+interval '1 day'where id='e2000000-0000-4000-8000-00000000000a';
select pg_temp.ok(pg_temp.call('e2000000-0000-4000-8000-00000000000a','zoe_reads_messages',true,'zoe-consent-draft-4','prompt')->>'code'='not_eligible','A banned member cannot grant');
do $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);perform public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-4','prompt');raise exception 'FAIL: service role grant';exception when insufficient_privilege then null;end$$;

-- Grants on the four-argument call are for signed-in members only.
do $$begin perform set_config('request.jwt.claims','{"role":"anon"}',true);perform public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-2','enrolment');raise exception 'FAIL: anonymous grant';exception when insufficient_privilege then null;end$$;
select pg_temp.ok(not has_function_privilege('anon','public.zoe_consent_set(text,boolean,text,text)','execute')and not has_function_privilege('anon','public.zoe_consent_prompt()','execute'),'Anon cannot call the consent functions');
select 'PASS zoe consent enrolment: enrolment and card grants with source, version and time; no overturning; refusals; withdrawal stops the next claim; history and trace (rolled back)';
rollback;
