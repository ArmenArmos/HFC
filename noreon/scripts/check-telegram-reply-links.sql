-- One-tap "Open Noreon" button on doctor replies and Zoe's Telegram texts (lead decision 19 Oct): armed at
-- send time by telegram_signin_link_arm_reply under the same rules as the other links; otherwise the reply
-- goes without a button. Synthetic fixtures only, rolled back. Delivery and system-message rows are written
-- directly (replica role) because only their state, member and endpoint matter here.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_rl",9011,"user",%s]',u)$$;
create function pg_temp.h(t text)returns text language sql as $$select encode(extensions.digest(t,'sha256'),'hex')$$;
create function pg_temp.bind(m uuid,u bigint)returns jsonb language sql as $$
 select public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null)$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to service_role;

-- Fixtures: member A (chat 8801), member B (chat 8802, staff), member C (chat 8803, no Telegram sign-in binding); one endpoint each.
insert into auth.users(id,phone,phone_confirmed_at)values('d4000000-0000-4000-8000-000000000001','37499040001',now()),('d4000000-0000-4000-8000-000000000002','37499040002',now()),
 ('d4000000-0000-4000-8000-000000000003','37499040003',now());
update public.profiles set locale='en'where id::text like 'd4000000-%';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_rl',9011,600,'consent-r');
update public.system_message_templates set approved=true,approval_note='test fixture'where template_id='member_notice.open_label'and locale='en';
select pg_temp.as_service();
select pg_temp.bind('d4000000-0000-4000-8000-000000000001',8801);
select pg_temp.bind('d4000000-0000-4000-8000-000000000002',8802);
set local session_replication_role=replica;
insert into public.conversation_endpoints(id,member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)values
 ('d4000000-0000-4000-8000-0000000000e1','d4000000-0000-4000-8000-000000000001','telegram','acct',pg_temp.principal(8801),'8801',1,true,'p',clock_timestamp()+interval '1 hour',4096),
 ('d4000000-0000-4000-8000-0000000000e2','d4000000-0000-4000-8000-000000000002','telegram','acct',pg_temp.principal(8802),'8802',1,true,'p',clock_timestamp()+interval '1 hour',4096),
 ('d4000000-0000-4000-8000-0000000000e3','d4000000-0000-4000-8000-000000000003','telegram','acct',pg_temp.principal(8803),'8803',1,true,'p',clock_timestamp()+interval '1 hour',4096);
insert into public.conversations(id,member_id)values('d4000000-0000-4000-8000-0000000000c1','d4000000-0000-4000-8000-000000000001'),('d4000000-0000-4000-8000-0000000000c2','d4000000-0000-4000-8000-000000000002'),('d4000000-0000-4000-8000-0000000000c3','d4000000-0000-4000-8000-000000000003');
-- A doctor reply in each state we need, and Zoe texts (answer, urgent) plus a non-Zoe acknowledgement.
create function pg_temp.delivery(id text,conv text,ep text,st text)returns void language sql as $$
 insert into public.conversation_deliveries(id,conversation_id,approval_id,state,endpoint_id,endpoint_generation)values(id::uuid,conv::uuid,gen_random_uuid(),st,ep::uuid,1)$$;
create function pg_temp.sysmsg(id text,m text,tpl text,ep text,st text)returns void language sql as $$
 insert into public.system_messages(id,member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation,state)
 values(id::uuid,m::uuid,tpl,1,'en','Synthetic text','h',ep::uuid,1,st)$$;
select pg_temp.delivery('d4000000-0000-4000-8000-0000000000d1','d4000000-0000-4000-8000-0000000000c1','d4000000-0000-4000-8000-0000000000e1','sending');
select pg_temp.delivery('d4000000-0000-4000-8000-0000000000d2','d4000000-0000-4000-8000-0000000000c1','d4000000-0000-4000-8000-0000000000e1','queued');
select pg_temp.delivery('d4000000-0000-4000-8000-0000000000d3','d4000000-0000-4000-8000-0000000000c2','d4000000-0000-4000-8000-0000000000e2','sending');
select pg_temp.delivery('d4000000-0000-4000-8000-0000000000d4','d4000000-0000-4000-8000-0000000000c3','d4000000-0000-4000-8000-0000000000e3','sending');
select pg_temp.sysmsg('d4000000-0000-4000-8000-0000000000a1','d4000000-0000-4000-8000-000000000001','zoe.answer','d4000000-0000-4000-8000-0000000000e1','sending');
select pg_temp.sysmsg('d4000000-0000-4000-8000-0000000000a2','d4000000-0000-4000-8000-000000000001','zoe.urgent','d4000000-0000-4000-8000-0000000000e1','sending');
select pg_temp.sysmsg('d4000000-0000-4000-8000-0000000000a3','d4000000-0000-4000-8000-000000000001','telegram.ack','d4000000-0000-4000-8000-0000000000e1','sending');
set local session_replication_role=origin;
insert into public.workspace_clinics(id,name)values('d4000000-0000-4000-8000-0000000000f1','Synthetic reply-link clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d4000000-0000-4000-8000-000000000002','nurse','Nurse Reply Synthetic','d4000000-0000-4000-8000-0000000000f1');
select pg_temp.as_service();
select pg_temp.ok(not has_function_privilege('authenticated','public.telegram_signin_link_arm_reply(text,uuid,text)','execute')
 and not has_function_privilege('anon','public.telegram_signin_link_arm_reply(text,uuid,text)','execute'),'Service only');

-- 1. A doctor reply being sent is armed: 24 h, open_messages, only the hash, bound to the member's chat binding.
insert into kv values('d1',public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-0000000000d1',pg_temp.h('tok-d1')));
select pg_temp.ok((select v->>'ok'='true'and v->>'label'='Open Noreon'and v->>'step'='open_messages'from kv where k='d1'),'Doctor reply armed with the approved label');
select pg_temp.ok((select state='armed'and step='open_messages'and token_hash=pg_temp.h('tok-d1')and message_id is null and system_message_id is null
 and expires_at between clock_timestamp()+interval '23 hours 59 minutes'and clock_timestamp()+interval '24 hours'
 and binding_id=(select id from public.telegram_auth_bindings where principal_ref=pg_temp.principal(8801)and active)
 from public.telegram_signin_links where delivery_id='d4000000-0000-4000-8000-0000000000d1'),'Delivery link row: 24 h, hash only, chat binding');
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-0000000000d1',pg_temp.h('tok-d1b'))->>'code'='none','Once per reply (a resend never re-arms)');
-- The link signs in like any other and continues to the thread.
insert into kv values('b1',public.telegram_signin_link_begin(pg_temp.h('tok-d1'),repeat('1',64),null,false));
select pg_temp.ok((select v->>'ok'='true'and v->>'step'='open_messages'and v->>'phone'='+37499040001'from kv where k='b1'),'Begin: sign-in for member A, step open_messages');

-- 2. A Zoe text is armed; newest wins over the doctor-reply link; urgent and non-Zoe texts never.
insert into kv values('a1',public.telegram_signin_link_arm_reply('system','d4000000-0000-4000-8000-0000000000a1',pg_temp.h('tok-a1')));
select pg_temp.ok((select v->>'ok'='true'from kv where k='a1')and(select state='armed'and step='open_messages'from public.telegram_signin_links where system_message_id='d4000000-0000-4000-8000-0000000000a1'),'Zoe reply armed');
select pg_temp.ok(public.telegram_signin_link_arm_reply('system','d4000000-0000-4000-8000-0000000000a2',pg_temp.h('tok-a2'))->>'code'='none','Zoe urgent text: no button');
select pg_temp.ok(public.telegram_signin_link_arm_reply('system','d4000000-0000-4000-8000-0000000000a3',pg_temp.h('tok-a3'))->>'code'='none','Non-Zoe system text: no button');

-- 3. Never: a reply not being sent, a staff account, a chat that is not the member's bound chat, unknown ids.
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-0000000000d2',pg_temp.h('tok-d2'))->>'code'='none','Not claimed (queued): none');
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-0000000000d3',pg_temp.h('tok-d3'))->>'code'='none','Staff account: none');
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-0000000000d4',pg_temp.h('tok-d4'))->>'code'='none','Chat without the member sign-in binding: none');
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery',gen_random_uuid(),pg_temp.h('tok-x'))->>'code'='none'
 and public.telegram_signin_link_arm_reply('other','d4000000-0000-4000-8000-0000000000d1',pg_temp.h('tok-x'))->>'code'='invalid'
 and public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-0000000000d1','not-a-hash')->>'code'='invalid','Unknown or malformed: none');

-- 4. Lapsed proof (over 30 days) and an unapproved label: no button.
update public.telegram_auth_bindings set proven_at=clock_timestamp()-interval '31 days'where principal_ref=pg_temp.principal(8801)and active;
set local session_replication_role=replica;select pg_temp.delivery('d4000000-0000-4000-8000-0000000000d5','d4000000-0000-4000-8000-0000000000c1','d4000000-0000-4000-8000-0000000000e1','sending');set local session_replication_role=origin;
select pg_temp.as_service();
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-0000000000d5',pg_temp.h('tok-d5'))->>'code'='none','Lapsed proof: no button');
update public.telegram_auth_bindings set proven_at=clock_timestamp()where principal_ref=pg_temp.principal(8801)and active;
-- The member reads Armenian, where the fixture's label is not approved.
update public.profiles set locale='hy'where id='d4000000-0000-4000-8000-000000000001';
select pg_temp.ok(not exists(select 1 from public.system_message_templates where template_id='member_notice.open_label'and locale='hy'and approved)
 and public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-0000000000d5',pg_temp.h('tok-d5'))->>'code'='none','Unapproved label in the member language: no button');
update public.profiles set locale='en'where id='d4000000-0000-4000-8000-000000000001';

-- 5. At most 5 links per member per hour, shared with every other link: the sixth reply goes without a button.
set local session_replication_role=replica;
select pg_temp.delivery(format('d4000000-0000-4000-8000-0000000001%s',n),'d4000000-0000-4000-8000-0000000000c1','d4000000-0000-4000-8000-0000000000e1','sending')from generate_series(10,14)n;
set local session_replication_role=origin;select pg_temp.as_service();
select pg_temp.ok((select count(*)from public.telegram_signin_links where auth_user_id='d4000000-0000-4000-8000-000000000001')=2,'Two links so far this hour');
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery',format('d4000000-0000-4000-8000-0000000001%s',n)::uuid,pg_temp.h('tok-r'||n))->>'ok'='true',format('Reply %s armed',n))from generate_series(10,12)n;
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-000000000113',pg_temp.h('tok-r13'))->>'code'='rate_limited','Sixth this hour: rate_limited (sent without a button)');
select pg_temp.ok((select count(*)from public.telegram_signin_links where auth_user_id='d4000000-0000-4000-8000-000000000001'and state='armed')=1,'Newest wins: one armed link');
select pg_temp.ok((select count(*)from public.telegram_auth_audit where auth_user_id='d4000000-0000-4000-8000-000000000001'and kind='signin_link.armed'and detail->>'source'in('delivery','system'))=5,'Audited with the source');

-- 7. Review R2: one lock and one rule for every source. The cap holds for an auth-outbox insert too (a sixth
-- row this hour is skipped, the insert itself does not fail), and arming in one source cancels the armed link
-- of the other.
select pg_temp.ok((select count(*)from public.telegram_signin_links where auth_user_id='d4000000-0000-4000-8000-000000000001'and created_at>clock_timestamp()-interval '1 hour')=5,'Five links this hour for A');
insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body)
 select 'd4000000-0000-4000-8000-0000000002a1','8801',pg_temp.principal(8801),template_id,version,locale,body from public.system_message_templates where template_id='telegram.next_review'and locale='en'order by version desc limit 1;
insert into public.telegram_signin_links(auth_user_id,binding_id,binding_generation,principal_ref,step,message_id)
 select auth_user_id,id,generation,principal_ref,'next_review','d4000000-0000-4000-8000-0000000002a1'from public.telegram_auth_bindings where principal_ref=pg_temp.principal(8801)and active;
select pg_temp.ok(not exists(select 1 from public.telegram_signin_links where message_id='d4000000-0000-4000-8000-0000000002a1'),'Sixth link this hour from the auth outbox: skipped by the shared cap');
-- Cross-source newest wins: age the hour, arm an auth-outbox link, then a doctor reply, then the outbox link's twin.
update public.telegram_signin_links set created_at=created_at-interval '2 hours'where auth_user_id='d4000000-0000-4000-8000-000000000001';
insert into public.telegram_signin_links(auth_user_id,binding_id,binding_generation,principal_ref,step,message_id)
 select auth_user_id,id,generation,principal_ref,'next_review','d4000000-0000-4000-8000-0000000002a1'from public.telegram_auth_bindings where principal_ref=pg_temp.principal(8801)and active;
select pg_temp.ok(public.telegram_signin_link_arm('d4000000-0000-4000-8000-0000000002a1',pg_temp.h('tok-o1'))->>'ok'='true','Auth-outbox link armed');
select pg_temp.ok((select count(*)from public.telegram_signin_links where auth_user_id='d4000000-0000-4000-8000-000000000001'and state='armed')=1
 and(select state='cancelled'from public.telegram_signin_links where delivery_id='d4000000-0000-4000-8000-000000000112'),'Outbox arm cancels the armed doctor-reply link');
set local session_replication_role=replica;select pg_temp.delivery('d4000000-0000-4000-8000-000000000120','d4000000-0000-4000-8000-0000000000c1','d4000000-0000-4000-8000-0000000000e1','sending');set local session_replication_role=origin;
select pg_temp.as_service();
select pg_temp.ok(public.telegram_signin_link_arm_reply('delivery','d4000000-0000-4000-8000-000000000120',pg_temp.h('tok-r20'))->>'ok'='true','Doctor reply armed after it');
select pg_temp.ok((select state='cancelled'from public.telegram_signin_links where message_id='d4000000-0000-4000-8000-0000000002a1')
 and(select count(*)from public.telegram_signin_links where auth_user_id='d4000000-0000-4000-8000-000000000001'and state='armed')=1,'Reply arm cancels the outbox link: one live link');

-- 6. A link row has exactly one source.
reset role;
do $$begin
 insert into public.telegram_signin_links(auth_user_id,binding_id,binding_generation,principal_ref,step,message_id,delivery_id)
 select auth_user_id,binding_id,binding_generation,principal_ref,'open_messages',null,null from public.telegram_signin_links limit 1;
 raise exception 'FAIL: a link without a source was accepted';
exception when check_violation then null;end$$;

rollback;
\echo 'check-telegram-reply-links: ok'
