-- Zoe non-AI scaffolding: K4 consents, switches and journaled Zoe decisions, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,amr text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id','d1700000-0000-4000-8000-000000000009')::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create temp table kv(k text primary key,v jsonb);grant all on kv to authenticated,service_role;
insert into auth.users(id,phone,phone_confirmed_at)values('d1700000-0000-4000-8000-000000000001','37499017001',now()),('d1700000-0000-4000-8000-000000000002',null,null),('d1700000-0000-4000-8000-000000000003',null,null);
insert into public.patient_clinical_cases(user_id)values('d1700000-0000-4000-8000-000000000003');
insert into public.workspace_staff(user_id,role,display_name)values('d1700000-0000-4000-8000-000000000002','admin','Zoe admin synthetic');
insert into public.patient_clinical_cases(user_id)values('d1700000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1700000-0000-4000-8000-000000000009','d1700000-0000-4000-8000-000000000002',now(),now());

-- Off by default: no settings row means nothing can be recorded.
select pg_temp.ok(not exists(select 1 from public.zoe_settings),'No Zoe settings are seeded');
select pg_temp.as_user('d1700000-0000-4000-8000-000000000001','otp');set local role authenticated;
select pg_temp.ok(public.zoe_consent_status()->>'available'='false','Consent collection is off');
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-1')->>'code'='unavailable','Consent refused while off');
reset role;
insert into public.zoe_settings(consent_collection_enabled)values(true);
-- F3: no server-held wording yet means no grant, even with collection on.
select pg_temp.as_user('d1700000-0000-4000-8000-000000000001','otp');set local role authenticated;
select pg_temp.ok(public.zoe_consent_status()->>'available'='false'and public.zoe_consent_status()->>'wordingVersion'is null,'No wording version: not available');
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-1')->>'code'='unavailable','No grant without a server-held wording');
reset role;
update public.zoe_settings set consent_wording_version='zoe-consent-draft-1';
select pg_temp.ok((select daily_spend_cap_usd=10 and quiet_start='21:00'and quiet_end='09:00'and time_zone='Asia/Yerevan'and scheduled_daily_max=2 and not model_calls_allowed from public.zoe_settings),'Defaults follow K3 and K7');
do $$begin update public.zoe_settings set daily_spend_cap_usd=11;raise exception 'FAIL: cap above 10';exception when check_violation then null;end$$;
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: model calls switched on';exception when check_violation then null;end$$;

-- Member sets each consent separately; repeats are no-ops; every change is traced.
select pg_temp.as_user('d1700000-0000-4000-8000-000000000001','otp');set local role authenticated;
select pg_temp.ok(public.zoe_consent_status()->>'readsMessages'='false'and public.zoe_consent_status()->>'scheduledQuestions'='false','Nothing is consented by default');
select pg_temp.ok(public.zoe_consent_status()->>'wordingVersion'='zoe-consent-draft-1'and public.zoe_consent_status()->>'available'='true','Status names the current wording');
-- F3: a client cannot claim a wording it was not shown; a stale page is told to re-render.
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-signed-3')->>'code'='stale'and public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-signed-3')->>'wordingVersion'='zoe-consent-draft-1','Other wording version is stale');
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-1')->>'readsMessages'='true','Reads-messages consent granted');
select pg_temp.ok(public.zoe_consent_status()->>'scheduledQuestions'='false','Scheduled questions stay off independently');
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-1')->>'changed'='false','Repeat is a no-op');
select pg_temp.ok(public.zoe_consent_set('zoe_scheduled_questions',true,'zoe-consent-draft-1')->>'scheduledQuestions'='true','Scheduled consent granted');
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',false,'zoe-consent-draft-1')->>'readsMessages'='false','Reads-messages withdrawn');
select pg_temp.ok(public.zoe_consent_status()->>'scheduledQuestions'='true','Withdrawing one leaves the other');
reset role;
-- Collection switched off: no new grant, but withdrawal still works.
update public.zoe_settings set consent_collection_enabled=false;
select pg_temp.as_user('d1700000-0000-4000-8000-000000000001','otp');set local role authenticated;
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-1')->>'code'='unavailable','No grant while collection is off');
reset role;
update public.zoe_settings set consent_wording_version=null;
select pg_temp.as_user('d1700000-0000-4000-8000-000000000001','otp');set local role authenticated;
select pg_temp.ok(public.zoe_consent_set('zoe_scheduled_questions',false,'zoe-consent-client-9')->>'scheduledQuestions'='false','Withdrawal works while collection is off and no wording is held');
reset role;
select pg_temp.ok((select wording_version='zoe-consent-draft-1'from public.zoe_consents where kind='zoe_scheduled_questions'order by id desc limit 1),'A withdrawal records the withdrawn grant wording, never the client value');
update public.zoe_settings set consent_wording_version='zoe-consent-draft-1';
select pg_temp.as_user('d1700000-0000-4000-8000-000000000001','otp');set local role authenticated;
select pg_temp.ok(public.zoe_consent_set('zoe_scheduled_questions',true,'zoe-consent-draft-1')->>'code'='unavailable','Still no grant');
reset role;
update public.zoe_settings set consent_collection_enabled=true;
select pg_temp.as_user('d1700000-0000-4000-8000-000000000003','otp');set local role authenticated;
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-1')->>'code'='not_eligible','A member without a confirmed phone cannot grant');
reset role;
select pg_temp.as_user('d1700000-0000-4000-8000-000000000001','otp');set local role authenticated;
select pg_temp.ok(public.zoe_consent_set('telegram_replies',true,'zoe-consent-draft-1')->>'code'='invalid','Unknown consent kind refused');
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'Bad Version!')->>'code'='invalid','Malformed wording version refused');
reset role;
select pg_temp.ok((select count(*)=4 from public.zoe_consents where member_id='d1700000-0000-4000-8000-000000000001'),'Four changes recorded');
select pg_temp.ok((select count(*)=4 and count(*)filter(where name='zoe.consent.withdrawn'and outcome='block')=2 and bool_and(step='zoe'and actor_kind='member'and rule_version='zoe-consent-draft-1')
 from public.conversation_trace_events where member_id='d1700000-0000-4000-8000-000000000001'and subject_kind='zoe_consent'),'Each consent change is traced');
do $$begin update public.zoe_consents set granted=true;raise exception 'FAIL: consent history edited';exception when sqlstate '55000' then null;end$$;
-- Staff accounts are not members.
select pg_temp.as_user('d1700000-0000-4000-8000-000000000002','password');set local role authenticated;
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-1')->>'code'='not_eligible','Staff cannot consent');
select pg_temp.ok(public.zoe_consent_set('zoe_reads_messages',false,'zoe-consent-draft-1')->>'changed'='false','A no without an earlier yes writes nothing');
reset role;
select pg_temp.ok(not exists(select 1 from public.zoe_consents where member_id='d1700000-0000-4000-8000-000000000002')and not exists(select 1 from public.conversation_trace_events where member_id='d1700000-0000-4000-8000-000000000002'),'No consent or trace row for staff');

-- The admin Trace view shows the consent events (the retired zoe_trace_record writer is gone, WP-22b).
select pg_temp.as_user('d1700000-0000-4000-8000-000000000002','password');set local role authenticated;
select pg_temp.ok((select count(*)=4 from jsonb_array_elements(public.conversation_trace('d1700000-0000-4000-8000-000000000001')->'events')e where e->>'step'='zoe'),'Zoe events appear in the admin trace');
reset role;
select pg_temp.ok(not has_table_privilege('authenticated','public.zoe_consents','select')and not has_table_privilege('authenticated','public.zoe_settings','select')and not has_table_privilege('service_role','public.zoe_settings','update'),'No direct table access');
select pg_temp.ok(not has_function_privilege('anon','public.zoe_consent_set(text,boolean,text)','execute')and to_regprocedure('public.zoe_trace_record(uuid,text,text,text,text,text,jsonb)')is null,'Grants are minimal; the retired trace writer is gone');
select pg_temp.ok(not exists(select 1 from public.zoe_consents where wording_version<>'zoe-consent-draft-1'),'Only the server-held wording is ever recorded');
-- F5: deleting an account removes its consent history; nothing else may delete or edit it.
insert into auth.users(id)values('d1700000-0000-4000-8000-000000000004');
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('d1700000-0000-4000-8000-000000000004','zoe_reads_messages',true,'zoe-consent-draft-1');
do $$begin delete from public.zoe_consents where member_id='d1700000-0000-4000-8000-000000000004';raise exception 'FAIL: direct delete allowed';exception when sqlstate '55000' then null;end$$;
delete from auth.users where id='d1700000-0000-4000-8000-000000000004';
select pg_temp.ok(not exists(select 1 from public.zoe_consents where member_id='d1700000-0000-4000-8000-000000000004'),'Account deletion cascades through the consent history');
\echo PASS zoe scaffolding: off by default, K4 consents separate and traced, K3/K7 defaults, cap never above 10, no model calls, zoe.* journal service-only (rolled back)
rollback;
