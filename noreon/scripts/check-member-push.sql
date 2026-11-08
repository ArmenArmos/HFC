-- Synthetic, rolled-back SQL checks. Run only against an isolated migrated database.
-- This never contacts a push provider. Sequential duplicate claims are tested here;
-- simultaneous-session SKIP LOCKED/advisory-lock behavior needs a live concurrency check.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text) returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text) returns uuid language sql immutable as $$select ('b2c00000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.member(n text) returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(n),'role','authenticated')::text,true)$$;
create function pg_temp.service() returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.subscribe(endpoint text) returns jsonb language sql as $$
 select public.member_push_subscribe(endpoint,'B'||repeat('A',86),repeat('A',22))$$;
create function pg_temp.notice(n text,k text,tpl text default 'member.samples_at_lab',age interval default interval '0',app text default 'Synthetic private app notice') returns uuid
language plpgsql as $$declare nid uuid;begin
 insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,app_text,created_at)
 values(pg_temp.id(n),'push:'||k,case when tpl like 'member.reminder\_%' then 'reminders' else 'results' end,tpl,'skipped','not_connected',app,clock_timestamp()-age) returning id into nid;
 return nid;
end$$;
create temp table evidence(k text primary key,v jsonb);
grant all on evidence to authenticated,service_role;
select pg_temp.ok(c.relrowsecurity,'RLS enabled: '||c.relname) from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
 where ns.nspname='public' and c.relname in('member_push_subscriptions','member_push_deliveries');
select pg_temp.ok(not has_table_privilege(r,'public.member_push_deliveries','select') and not has_table_privilege(r,'public.member_push_subscriptions','insert'),r||' has no direct writes or outcomes') from unnest(array['anon','authenticated','service_role'])r;
select pg_temp.ok(not has_function_privilege('authenticated','public.member_push_claim(integer)','execute') and not has_function_privilege('anon','public.member_push_subscribe(text,text,text)','execute'),'RPC grants separate member and service');
select pg_temp.ok((select count(*)=2 and bool_and(not approved) from public.system_message_templates where template_id='member_notice.push' and version=1),'seeded push wording is dark');
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at) select pg_temp.id(n),'3749908'||n||'00',now() from unnest(array['01','02','03','04'])n;
insert into public.profiles(id,locale,display_name) select pg_temp.id(n),'en','Synthetic push member' from unnest(array['01','02','03','04'])n;
insert into public.workspace_staff(user_id,role,display_name) values(pg_temp.id('03'),'admin','Synthetic staff');
insert into public.workspace_clinics(id,name,address) values(pg_temp.id('90'),'Synthetic clinic','Synthetic address');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role) values(pg_temp.id('04'),pg_temp.id('90'),'Synthetic clinic staff','staff');
set local session_replication_role=origin;
update public.member_notice_settings set booking=true,reminders=true,results=true,care=true;
insert into public.patient_reminder_preferences(user_id,preferences) select pg_temp.id(n),'{"quietStart":"00:00","quietEnd":"00:00"}'::jsonb from unnest(array['01','02'])n;
select pg_temp.member('01');set local role authenticated;
insert into evidence values('device-a',pg_temp.subscribe('https://push.example.test/a'));
select pg_temp.ok(pg_temp.subscribe('https://push.example.test/a')=(select v from evidence where k='device-a'),'repeat subscription is idempotent');
select pg_temp.ok((select count(*)=1 from public.member_push_subscriptions),'own subscription readable');
-- Generic errors must never echo the endpoint or key.
do $$begin
 begin perform public.member_push_subscribe('http://push.example.test/a','B'||repeat('A',86),repeat('A',22));raise exception 'FAIL: insecure endpoint';exception when invalid_parameter_value then null;end;
 begin perform public.member_push_subscribe('https://person:secret@push.example.test/a','B'||repeat('A',86),repeat('A',22));raise exception 'FAIL: URL credentials';exception when invalid_parameter_value then null;end;
 begin perform public.member_push_subscribe('https://push.example.test/a','invalid',repeat('A',22));raise exception 'FAIL: invalid key';exception when invalid_parameter_value then null;end;
 begin perform public.member_push_claim();raise exception 'FAIL: member service RPC';exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.member('02');set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.member_push_subscriptions),'RLS hides another member endpoint and keys');
select public.member_push_unsubscribe('https://push.example.test/a');
select pg_temp.ok(pg_temp.subscribe('https://push.example.test/a')=(select v from evidence where k='device-a'),'shared endpoint moves to signed-in member');
reset role;
select pg_temp.ok((select member_id=pg_temp.id('02') and generation=2 from public.member_push_subscriptions where endpoint='https://push.example.test/a'),'ownership moved and generation fenced');
select pg_temp.member('01');set local role authenticated;
select pg_temp.ok((select count(*)=0 from public.member_push_subscriptions),'old owner no longer sees shared endpoint');
select public.member_push_unsubscribe('https://push.example.test/a');
select pg_temp.subscribe('https://push.example.test/b');
select pg_temp.subscribe('https://push.example.test/c');
reset role;
select pg_temp.ok((select count(*)=3 from public.member_push_subscriptions),'old owner cannot unsubscribe new owner');
select pg_temp.member('02');set local role authenticated;
select pg_temp.subscribe('https://push.example.test/temporary');
select public.member_push_unsubscribe('https://push.example.test/temporary');
select pg_temp.ok(not exists(select 1 from public.member_push_subscriptions where endpoint='https://push.example.test/temporary'),'own unsubscribe revokes subscription');
reset role;
select pg_temp.member('03');set local role authenticated;
do $$begin begin perform pg_temp.subscribe('https://push.example.test/staff');raise exception 'FAIL: staff subscribed';exception when insufficient_privilege then null;end;end$$;
reset role;
select pg_temp.member('04');set local role authenticated;
do $$begin begin perform pg_temp.subscribe('https://push.example.test/clinic');raise exception 'FAIL: clinic subscribed';exception when insufficient_privilege then null;end;end$$;
reset role;

-- Two devices, one notice. Unapproved copy is held; newest unapproved cannot fall back.
select pg_temp.notice('01','two-devices');
select pg_temp.service();
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'unapproved placeholder sends nothing');
insert into public.system_message_templates(template_id,version,locale,body,approved) values
 ('member_notice.push',900,'en','You have an update in Noreon.',true),
 ('member_notice.push',900,'hy','Noreon-ում ձեզ համար նոր տեղեկություն կա։',true),
 ('member_notice.push',901,'en','Unapproved newer line.',false);
update public.member_push_deliveries set next_attempt_at=now();
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'newest unapproved does not use older approved');
set local session_replication_role=replica;
delete from public.system_message_templates where template_id='member_notice.push' and version=901;
set local session_replication_role=origin;
update public.member_push_deliveries set next_attempt_at=now();
insert into evidence values('claimed',public.member_push_claim());
select pg_temp.ok((select jsonb_array_length(v->'deliveries')=2 from evidence where k='claimed'),'one delivery per device');
select pg_temp.ok((select bool_and(x->>'text'='You have an update in Noreon.' and (x->>'ttlSeconds')::int between 1 and 21600
 and not (x ? 'app_text') and not (x ? 'params') and x->>'noticeId'=(select id::text from public.member_notices where event_key='push:two-devices'))
 from evidence e cross join lateral jsonb_array_elements(e.v->'deliveries')x where k='claimed'),'neutral approved envelope with notice id and freshness TTL');
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'second claim cannot double-send either device');
select pg_temp.ok(public.member_push_outcome((select(v#>>'{deliveries,0,deliveryId}')::uuid from evidence where k='claimed'),gen_random_uuid(),'sent')->>'ok'='false','wrong attempt fenced');
select pg_temp.ok(public.member_push_outcome((select(v#>>'{deliveries,0,deliveryId}')::uuid from evidence where k='claimed'),(select(v#>>'{deliveries,0,attemptId}')::uuid from evidence where k='claimed'),'retryable')->>'ok'='true','definite rejection may retry');
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'retry observes backoff');
update public.member_push_deliveries set next_attempt_at=now() where state='queued';
insert into evidence values('retry',public.member_push_claim());
select pg_temp.ok((select jsonb_array_length(v->'deliveries')=1 from evidence where k='retry'),'only rejected device retries');
select pg_temp.ok(public.member_push_outcome((select(v#>>'{deliveries,0,deliveryId}')::uuid from evidence where k='claimed'),(select(v#>>'{deliveries,0,attemptId}')::uuid from evidence where k='claimed'),'gone')->>'ok'='false','late first attempt cannot delete retried subscription');
select public.member_push_outcome((v#>>'{deliveries,0,deliveryId}')::uuid,(v#>>'{deliveries,0,attemptId}')::uuid,'retryable') from evidence where k='retry';
update public.member_push_deliveries set next_attempt_at=now() where state='queued';
insert into evidence values('last-retry',public.member_push_claim());
select public.member_push_outcome((v#>>'{deliveries,0,deliveryId}')::uuid,(v#>>'{deliveries,0,attemptId}')::uuid,'retryable') from evidence where k='last-retry';
select pg_temp.ok(not exists(select 1 from public.member_push_deliveries where state='queued') and exists(select 1 from public.member_push_deliveries where state='failed' and attempts=3),'retry limit is three attempts');
select public.member_push_outcome((v#>>'{deliveries,1,deliveryId}')::uuid,(v#>>'{deliveries,1,attemptId}')::uuid,'unknown') from evidence where k='claimed';
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'unknown result is never retried');

-- Recheck channel/group switches, app-only source eligibility, freshness, and closure.
update public.notice_channels set push=false where template_id='member.samples_at_lab';
select pg_temp.notice('01','channel-off');
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'channel off holds push independently of Telegram');
update public.notice_channels set push=true where template_id='member.samples_at_lab';
update public.member_notice_settings set results=false;
select pg_temp.notice('01','group-off');
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'group switch rechecked');
update public.member_notice_settings set results=true;
select pg_temp.notice('01','no-app','member.samples_at_lab',interval '0',null);
select pg_temp.notice('01','expired','member.samples_at_lab',interval '6 hours 1 minute');
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'no app text and expired notices do not push');
-- A missing care-plan source is closed, exercising the real closure helper.
insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,app_text)
 values(pg_temp.id('01'),'care.plan:'||pg_temp.id('99')::text,'care','member.plan_ready','skipped','not_connected','Synthetic closed plan');
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'closed source does not push');

-- Quiet reminder waits, then expires. Age the source only in this rolled-back fixture.
update public.patient_reminder_preferences set preferences='{"quietStart":"00:00","quietEnd":"23:59:59.999999"}' where user_id=pg_temp.id('01');
select pg_temp.notice('01','quiet','member.reminder_visit_soon');
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'fresh quiet reminder waits');
select pg_temp.ok((select count(*)=2 and bool_and(state='queued' and next_attempt_at>now()) from public.member_push_deliveries where notice_id=(select id from public.member_notices where event_key='push:quiet')),'quiet devices are deferred');
set local session_replication_role=replica;
update public.member_notices set created_at=clock_timestamp()-interval '31 minutes' where event_key='push:quiet';
set local session_replication_role=origin;
update public.member_push_deliveries set next_attempt_at=now() where state='queued';
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'quiet reminder expires without sending');
select pg_temp.ok((select bool_and(state='failed') from public.member_push_deliveries where notice_id=(select id from public.member_notices where event_key='push:quiet')),'expired reminder terminal');

-- A gone endpoint is removed, its deliveries cascade, and other device remains usable.
select pg_temp.notice('01','gone');
insert into evidence values('gone-claim',public.member_push_claim());
select pg_temp.ok((select jsonb_array_length(v->'deliveries')=2 from evidence where k='gone-claim'),'two current devices before gone');
select public.member_push_outcome((v#>>'{deliveries,0,deliveryId}')::uuid,(v#>>'{deliveries,0,attemptId}')::uuid,'gone') from evidence where k='gone-claim';
select pg_temp.ok((select count(*)=1 from public.member_push_subscriptions where member_id=pg_temp.id('01')),'410 removes only gone device');
select public.member_push_outcome((v#>>'{deliveries,1,deliveryId}')::uuid,(v#>>'{deliveries,1,attemptId}')::uuid,'sent') from evidence where k='gone-claim';
select pg_temp.ok((select last_ok_at is not null from public.member_push_subscriptions where member_id=pg_temp.id('01')),'sent outcome records current subscription success');
-- RU screen preference uses HY system-message language, matching existing locale semantics.
update public.profiles set locale='hy',ui_locale='ru' where id=pg_temp.id('02');
-- Crash state is not leased back, even when timestamp is old.
select pg_temp.notice('02','crash');
insert into evidence values('crash',public.member_push_claim());
select pg_temp.ok((select v#>>'{deliveries,0,text}'='Noreon-ում ձեզ համար նոր տեղեկություն կա։' from evidence where k='crash'),'RU screen preference receives HY push copy');
update public.member_push_deliveries set updated_at=now()-interval '1 day' where state='sending';
select pg_temp.ok(public.member_push_claim()->'deliveries'='[]'::jsonb,'abandoned sending claim cannot duplicate');
-- Moving endpoint while an old claim is in flight fences its eventual gone outcome.
select pg_temp.member('01');set local role authenticated;
select pg_temp.subscribe('https://push.example.test/a');
reset role;select pg_temp.service();
select public.member_push_outcome((v#>>'{deliveries,0,deliveryId}')::uuid,(v#>>'{deliveries,0,attemptId}')::uuid,'gone') from evidence where k='crash';
select pg_temp.ok((select member_id=pg_temp.id('01') and last_ok_at is null from public.member_push_subscriptions where endpoint='https://push.example.test/a'),'old owner gone cannot remove new owner device or carry success metadata');
-- No alert for what happened before this device subscribed, or for a notice Telegram held back.
reset role;
select pg_temp.notice('01','before-subscribing','member.samples_at_lab',interval '2 hours');
insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,app_text)
 values(pg_temp.id('01'),'push:throttled','results','member.samples_at_lab','skipped','throttled','Synthetic private app notice');
select pg_temp.service();set local role service_role;
insert into evidence values('held-back',public.member_push_claim());
reset role;
select pg_temp.ok(not exists(select 1 from public.member_notices n,evidence e,jsonb_array_elements(e.v->'deliveries')x where e.k='held-back'
 and x->>'noticeId'=n.id::text and n.event_key in('push:before-subscribing','push:throttled')),'older and throttled notices do not alert');
-- Account deletion must remove endpoint secrets and delivery history.
delete from auth.users where id=pg_temp.id('01');
select pg_temp.ok(not exists(select 1 from public.member_push_subscriptions where member_id=pg_temp.id('01')) and not exists(select 1 from public.member_push_deliveries where member_id=pg_temp.id('01')),'account delete cascades push data');
\echo 'check-member-push: all passed'
rollback;
