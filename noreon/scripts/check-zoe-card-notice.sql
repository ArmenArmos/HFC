-- A member notice can open its card (20261031010300): the read names the task only when the cards are on, the card template is
-- approved and the chat is the one the notice is for. Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('b1000000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.notice(tpl text,key text)returns uuid language sql as $$select public._member_notice_safe(pg_temp.id('01'),'care',tpl,key,'{}','/patient/progress','open_progress')$$;
create function pg_temp.read(m uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;j:=public.zoe_chat_card_notice(m);reset role;return j;end$$;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.id('01'),'37499085001',now());
insert into public.patient_clinical_cases(user_id)values(pg_temp.id('01'));
update public.profiles set locale='en'where id=pg_temp.id('01');
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_ev',9201,600,'consent-v1')on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-ev',3600,600,60,100,false,true)
 on conflict(singleton)do update set version=excluded.version;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=true where singleton;
update public.member_notice_settings set care=true,reminders=true,throttle_seconds=0,hourly_cap=60;
do $$declare b jsonb;begin
 b:=public._telegram_auth_bind(pg_temp.id('01'),'member','["telegram","noreon_ev",9201,"user",8901]',(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(pg_temp.id('01')),'8901',null);
 perform public._telegram_replies_activate(pg_temp.id('01'),(b->>'bindingId')::uuid);
end$$;
create temp table kv(k text primary key,v uuid);grant all on kv to service_role;
insert into kv select 'ldl',pg_temp.notice('member.ldl_retest_overdue','ldl.retest_overdue:one');
insert into kv select 'none',pg_temp.notice('member.consultation_needed','care.consultation:one');
insert into kv select 'doc',pg_temp.notice('member.document_released','care.document:one');
select pg_temp.ok((select count(*)=2 from kv where v is not null),'two active notices queued; document-ready notice suppressed');
-- The template not approved: the link.
set local session_replication_role=replica;update public.system_message_templates set approved=false where template_id='zoe.card';set local session_replication_role=origin;
select pg_temp.ok(pg_temp.read((select v from kv where k='ldl'))is null,'not approved: the link');
set local session_replication_role=replica;update public.system_message_templates set approved=true where template_id='zoe.card';set local session_replication_role=origin;
select pg_temp.ok(pg_temp.read((select v from kv where k='ldl'))->>'kind'='ldl','approved: the LDL card');
select pg_temp.ok(pg_temp.read((select v from kv where k='ldl'))->>'memberId'=pg_temp.id('01')::text,'for this member');
select pg_temp.ok(pg_temp.read((select v from kv where k='none'))is null,'no task card: the link');
select pg_temp.ok(pg_temp.read((select v from kv where k='doc'))is null,'a released document sends no member notice');
select pg_temp.ok(pg_temp.read('b1000000-0000-4000-8000-0000000000ff')is null,'an unknown message');
update public.conversation_policy set zoe_chat_actions_enabled=false where singleton;
select pg_temp.ok(pg_temp.read((select v from kv where k='ldl'))is null,'cards off: the link');
update public.conversation_policy set zoe_chat_actions_enabled=true where singleton;
update public.conversation_endpoints set active=false where member_id=pg_temp.id('01');
select pg_temp.ok(pg_temp.read((select v from kv where k='ldl'))is null,'no linked chat: the link');
do $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id('01'),'role','authenticated')::text,true);
 set local role authenticated;
 begin perform public.zoe_chat_card_notice(pg_temp.id('01'));raise exception 'FAIL: a member reached the notice read';exception when insufficient_privilege then null;end;
 reset role;
end$$;
\echo 'check-zoe-card-notice: all passed'
rollback;
