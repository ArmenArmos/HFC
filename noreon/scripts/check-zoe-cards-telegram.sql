-- Zoe chat cards on Telegram (20261030102535): who pressed is decided here, from the bound chat, never from the update.
-- Forged and foreign references, unlinked, relinked, expired and ineligible chats do nothing; a verified press names only
-- the bound member; the service entry points are the only way in and act as the session ones do; card text leaves
-- through the system-message outbox, once per inbox event, and an unknown send is never claimed again.
-- Rolled back. Synthetic fixtures only; no Telegram, network or provider is involved.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_cards",9101,"user",%s]',u)$$;
create function pg_temp.event(id bigint,u bigint,ref text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_cards",9101,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','callback',
  'payload',jsonb_build_object('chatId',u,'messageId',500+id,'callbackId','cb_'||id,'intentRef',ref))
$$;
create function pg_temp.commit_(id bigint,u bigint,ref text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.channel_inbox_commit(pg_temp.event(id,u,ref));reset role;return j;end$$;
-- Lease and process whatever is pending, as the sweep does; the last result.
create function pg_temp.drain()returns jsonb language plpgsql as $$declare i jsonb;r jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop r:=public.channel_inbox_process((i#>>'{}')::uuid);end loop;
 reset role;return r;end$$;
create function pg_temp.press(id bigint,u bigint,ref text)returns jsonb language plpgsql as $$begin
 perform pg_temp.commit_(id,u,ref);return pg_temp.drain();end$$;
create function pg_temp.post(m text,rid text,kind text,snap jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_post(m::uuid,rid::uuid,kind,'chip',null,snap);reset role;return j;end$$;
create function pg_temp.arm(m text,card uuid,buttons jsonb)returns jsonb language plpgsql as $$declare j jsonb;e uuid;g bigint;begin
 select id,generation into e,g from public.conversation_endpoints where member_id=m::uuid and active;
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_arm(m::uuid,card,e,g,buttons);reset role;return j;end$$;
create function pg_temp.arm_on(m text,card uuid,e uuid,g bigint)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_arm(m::uuid,card,e,g,'[{"action":"show_current"}]');reset role;return j;end$$;
create function pg_temp.send(m text,card uuid,inbox uuid,body text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_send(m::uuid,card,inbox,body);reset role;return j;end$$;
create function pg_temp.link(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 return public._telegram_replies_activate(m,(b->>'bindingId')::uuid);end$$;
create function pg_temp.unlink(m text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m);set local role authenticated;j:=public.telegram_unlink();reset role;return j;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role,anon;

-- Fixtures: members A (chat 8801) and B (chat 8802), one self-reported medicine each, due yesterday at 08:00.
insert into auth.users(id,phone,phone_confirmed_at)values('ad000000-0000-4000-8000-000000000001','37499081001',now()),('ad000000-0000-4000-8000-000000000002','37499081002',now());
insert into public.patient_clinical_cases(user_id)values('ad000000-0000-4000-8000-000000000001'),('ad000000-0000-4000-8000-000000000002');
update public.profiles set locale='en'where id in('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-000000000002');
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_cards',9101,600,'consent-v1')on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-cards',3600,600,60,100,false,true)
 on conflict(singleton)do update set version=excluded.version,delivery_enabled=true;
update public.conversation_policy set app_chat_enabled=true,zoe_chat_actions_enabled=false where singleton;
update public.member_medicine_settings set enabled=true where singleton;
insert into public.member_medicines(id,user_id,name,dose,times,started_on)values
 ('ad000000-0000-4000-8000-0000000000a1','ad000000-0000-4000-8000-000000000001','Synthetic A',null,array['08:00'::time],current_date-5),
 ('ad000000-0000-4000-8000-0000000000a2','ad000000-0000-4000-8000-000000000002','Synthetic B',null,array['08:00'::time],current_date-5);
insert into kv values('due',to_jsonb(public._member_medicine_due(((clock_timestamp()at time zone 'Asia/Yerevan')::date-1),'08:00'::time)));
create function pg_temp.due()returns timestamptz language sql as $$select (v#>>'{}')::timestamptz from kv where k='due'$$;
select pg_temp.ok((pg_temp.link('ad000000-0000-4000-8000-000000000001',8801)->>'ok')='true','link A');
select pg_temp.ok((pg_temp.link('ad000000-0000-4000-8000-000000000002',8802)->>'ok')='true','link B');

-- 1. Dark: with the switch off a press does nothing, and nothing can be issued or queued.
select pg_temp.ok(pg_temp.post('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000b1','dose','{"v":1}')->>'code'='disabled','off: no card');
update public.conversation_policy set zoe_chat_actions_enabled=true where singleton;
insert into kv values('card',pg_temp.post('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000b1','dose','{"v":1}')->'card');
insert into kv values('cardB',pg_temp.post('ad000000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-0000000000b2','dose','{"v":1}')->'card');
create function pg_temp.cid(k_ text default 'card')returns uuid language sql as $$select (v->>'id')::uuid from kv where k=k_$$;
insert into kv values('arm',pg_temp.arm('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),'[{"action":"dose_taken","item":{"medicineId":"ad000000-0000-4000-8000-0000000000a1"}},{"action":"show_current"}]'));
create function pg_temp.ref(i int default 0)returns text language sql as $$select v#>>array['refs',i::text] from kv where k='arm'$$;
select pg_temp.ok((v->>'ok')::boolean and jsonb_array_length(v->'refs')=2 and pg_temp.ref()~'^[A-Za-z0-9_-]{16,60}$','arm returns references in order')from kv where k='arm';
select pg_temp.ok(not exists(select 1 from public.zoe_chat_card_intents i where i.ref_hash=pg_temp.ref()),'the reference itself is not stored');
select pg_temp.ok(pg_temp.arm('ad000000-0000-4000-8000-000000000002',pg_temp.cid(),'[{"action":"show_current"}]')->>'code'='not_found','no button on another member''s card');
select pg_temp.ok(pg_temp.arm('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),'[{"action":"publish_plan"}]')->>'code'='invalid','only known actions');
update public.conversation_policy set zoe_chat_actions_enabled=false where singleton;
select pg_temp.ok(pg_temp.press(1,8801,pg_temp.ref())#>>'{refused,code}'='disabled','off: a real press is refused');
select pg_temp.ok(pg_temp.arm('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),'[]')->>'code'='disabled','off: no references');
update public.conversation_policy set zoe_chat_actions_enabled=true where singleton;

-- 2. Only the service role, and only the entry points. A member cannot act as anyone through them, not even as themself.
do $$declare n text;begin
 perform pg_temp.as_user('ad000000-0000-4000-8000-000000000001');set local role authenticated;
 begin perform public.member_medicine_dose_report_for('ad000000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-0000000000a2',now(),'taken',0);raise exception 'FAIL: member wrote for another';exception when insufficient_privilege then null;end;
 begin perform public.member_medicines_read_for('ad000000-0000-4000-8000-000000000002');raise exception 'FAIL: member read for another';exception when insufficient_privilege then null;end;
 begin perform public.zoe_chat_card_get('ad000000-0000-4000-8000-000000000002',gen_random_uuid());raise exception 'FAIL: member read a card';exception when insufficient_privilege then null;end;
 begin perform public.zoe_chat_card_arm('ad000000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),1,'[]');raise exception 'FAIL: member armed';exception when insufficient_privilege then null;end;
 begin perform public.zoe_chat_card_send('ad000000-0000-4000-8000-000000000001',gen_random_uuid(),gen_random_uuid(),'x');raise exception 'FAIL: member queued';exception when insufficient_privilege then null;end;
 begin perform public.channel_inbox_press_done(gen_random_uuid(),'ok');raise exception 'FAIL: member finished a press';exception when insufficient_privilege then null;end;
 reset role;
 perform set_config('request.jwt.claims','{"role":"anon"}',true);set local role anon;
 begin perform public.zoe_chat_card_telegram_candidates(5);raise exception 'FAIL: anon read candidates';exception when insufficient_privilege then null;end;
 reset role;
 perform pg_temp.as_service();set local role service_role;
 foreach n in array array['public._member_medicine_dose_report(''ad000000-0000-4000-8000-000000000001'',''ad000000-0000-4000-8000-0000000000a1'',now(),''taken'',0)','public._member_medicines_read(''ad000000-0000-4000-8000-000000000001'')']loop
  begin execute 'select '||n;raise exception 'FAIL: internal function reachable: %',n;exception when insufficient_privilege then null;end;
 end loop;
 reset role;
end$$;
select pg_temp.ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relname in('zoe_chat_card_intents','zoe_chat_card_sends','zoe_chat_card_scans')and not c.relrowsecurity),'RLS on the new tables');
select pg_temp.ok(not exists(select 1 from information_schema.role_table_grants where table_schema='public'and grantee in('anon','authenticated','service_role')and table_name in('zoe_chat_card_intents','zoe_chat_card_sends','zoe_chat_card_scans')),'no direct table grants');

-- 3. The event itself cannot carry an identity or a command.
select pg_temp.ok(pg_temp.commit_(10,8801,'not valid!')->>'code'='invalid_event','a malformed reference is refused');
do $$declare e jsonb;r jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 e:=jsonb_set(pg_temp.event(11,8801,pg_temp.ref()),'{payload,memberId}','"ad000000-0000-4000-8000-000000000002"');
 perform pg_temp.ok(public.channel_inbox_commit(e)->>'code'='invalid_event','a member id in the event is refused');
 e:=jsonb_set(pg_temp.event(12,8801,pg_temp.ref()),'{payload,chatId}','8802');
 perform pg_temp.ok(public.channel_inbox_commit(e)->>'code'='foreign_principal','the principal must be the chat it pressed in');
 e:=pg_temp.event(13,8801,pg_temp.ref())#-'{payload,callbackId}';
 perform pg_temp.ok(public.channel_inbox_commit(e)->>'code'='invalid_event','a press has its query id');
 reset role;
end$$;

-- 4. A real press names the bound member and stays leased until its command finished.
insert into kv values('press',pg_temp.press(20,8801,pg_temp.ref()));
select pg_temp.ok(v#>>'{press,memberId}'='ad000000-0000-4000-8000-000000000001' and v#>>'{press,action}'='dose_taken' and (v#>>'{press,cardId}')::uuid=pg_temp.cid()
 and v#>>'{press,callbackId}'='cb_20' and (v#>>'{press,chatId}')::bigint=8801 and v#>>'{press,locale}'='en','the press carries the bound member')from kv where k='press';
create function pg_temp.inbox(k_ text default 'press')returns uuid language sql as $$select (v#>>'{press,inboxId}')::uuid from kv where k=k_$$;
select pg_temp.ok((select status='processing' and payload?'intentRef' from public.channel_inbox where id=pg_temp.inbox()),'leased while the command runs');
-- A crash before it finished: the lease ends, the row is processed again, and everything is rechecked.
update public.channel_inbox set lease_until=clock_timestamp()-interval '1 second' where id=pg_temp.inbox();
select pg_temp.ok(pg_temp.drain()#>>'{press,inboxId}'=pg_temp.inbox()::text,'a lost lease replays the same press');
do $$begin perform pg_temp.as_service();set local role service_role;
 perform pg_temp.ok((public.channel_inbox_press_done(pg_temp.inbox(),'ok')->>'ok')::boolean,'the press finishes');
 perform pg_temp.ok((public.channel_inbox_press_done(pg_temp.inbox(),'ok')->>'ok')::boolean is false,'once');
 perform pg_temp.ok((public.channel_inbox_press_done(gen_random_uuid(),'ok')->>'ok')::boolean is false,'only a real row');
 reset role;end$$;
select pg_temp.ok((select status='done'and result='press_ok'and not payload?'intentRef' from public.channel_inbox where id=pg_temp.inbox()),'finished, and the reference is gone');
select pg_temp.ok(pg_temp.commit_(20,8801,pg_temp.ref())->>'status'='committed-duplicate','a redelivered update is the same row');
select pg_temp.ok(pg_temp.drain() is null,'and is not processed again');
-- A second tap is a new press of a live reference: it verifies again; the card's claim is what makes the write once.
select pg_temp.ok(pg_temp.press(21,8801,pg_temp.ref())#>>'{press,memberId}'='ad000000-0000-4000-8000-000000000001','a second tap verifies again');
select public.channel_inbox_press_done((select id from public.channel_inbox where event_id=format('["telegram","noreon_cards",9101,"update",%s]',21)),'ok');

-- 5. Forged and foreign references learn nothing and do nothing.
select pg_temp.ok(v->'refused'->>'code'='unknown' and not v?'press','a guessed reference')from(select pg_temp.press(30,8801,'AAAAAAAAAAAAAAAAAAAAAAAA')v)x;
select pg_temp.ok(v->'refused'->>'code'='unknown' and not v?'press' and v::text!~'ad000000-0000-4000-8000-000000000001','B presses A''s reference, and A is not named')from(select pg_temp.press(31,8802,pg_temp.ref())v)x;
select pg_temp.ok((select count(*)=1 from public.telegram_audit where kind='card.press_refused'and member_id='ad000000-0000-4000-8000-000000000002'and detail->>'code'='unknown'),'refusals are audited under the presser');
select pg_temp.ok(v->'refused'->>'code'='not_linked' and not v?'press','an unlinked chat pressing A''s reference')from(select pg_temp.press(32,8899,pg_temp.ref())v)x;

-- 6. Expired and ineligible.
update public.zoe_chat_card_intents set created_at=clock_timestamp()-interval '3 days',expires_at=clock_timestamp()-interval '1 second' where ref_hash=encode(sha256(convert_to(pg_temp.ref(1),'UTF8')),'hex');
select pg_temp.ok(pg_temp.press(40,8801,pg_temp.ref(1))#>>'{refused,code}'='expired','an expired button');
update public.conversation_endpoints set expires_at=clock_timestamp()-interval '1 second' where member_id='ad000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.press(41,8801,pg_temp.ref())#>>'{refused,code}'='binding_expired','an expired binding');
select pg_temp.ok(pg_temp.arm('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),'[]')->>'code'='no_route','no references on an expired binding');
update public.conversation_endpoints set expires_at='infinity' where member_id='ad000000-0000-4000-8000-000000000001';
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='ad000000-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.press(42,8801,pg_temp.ref())#>>'{refused,code}'='not_eligible','a banned member');
update auth.users set banned_until=null where id='ad000000-0000-4000-8000-000000000001';

-- 7. Relink: a press from before it, and a reference issued before it, are void for the new link.
-- The link a press was verified on, kept for the check after the unlink (Astra MC-01).
insert into kv select 'route',jsonb_build_object('e',id,'g',generation)from public.conversation_endpoints where member_id='ad000000-0000-4000-8000-000000000001'and active;
select pg_temp.commit_(50,8801,pg_temp.ref());
select pg_temp.ok((select generation from public.conversation_endpoints where member_id='ad000000-0000-4000-8000-000000000001' and active)=(select endpoint_generation from public.channel_inbox where event_id=format('["telegram","noreon_cards",9101,"update",%s]',50)),'the press carries its generation');
select pg_temp.unlink('ad000000-0000-4000-8000-000000000001');
select pg_temp.ok(v#>>'{refused,code}'='not_linked'and v#>>'{refused,locale}'='en','a press committed before the unlink is void, and answered in the member''s language')from(select pg_temp.drain()v)x;
select pg_temp.ok(pg_temp.press(51,8801,pg_temp.ref())#>>'{refused,code}'='not_linked','pressing after the unlink is void');
select pg_temp.ok(exists(select 1 from public.telegram_auth_messages where principal_ref=pg_temp.principal(8801)),'and the chat gets its next step');
select pg_temp.ok(pg_temp.arm('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),'[]')->>'code'='no_route','unlinked: no references');
select pg_temp.ok(pg_temp.send('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),(select id from public.channel_inbox limit 1),'Zoe: card')->>'code'='no_route','unlinked: nothing queued');
select pg_temp.ok(pg_temp.arm_on('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),(v->>'e')::uuid,(v->>'g')::bigint)->>'code'='no_route','an edit after the unlink gets no route')from kv where k='route';
select pg_temp.ok((pg_temp.link('ad000000-0000-4000-8000-000000000001',8801)->>'ok')='true','relink the same chat');
select pg_temp.ok(pg_temp.arm_on('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),(v->>'e')::uuid,(v->>'g')::bigint)->>'code'='no_route','the old generation stays dead on the new link')from kv where k='route';
select pg_temp.ok(pg_temp.arm_on('ad000000-0000-4000-8000-000000000002',pg_temp.cid('cardB'),(v->>'e')::uuid,(select generation from public.conversation_endpoints where id=(v->>'e')::uuid))->>'code'='no_route','another member''s endpoint is no route')from kv where k='route';
select pg_temp.ok(pg_temp.press(52,8801,pg_temp.ref())#>>'{refused,code}'='unknown','an old reference is void on the new link');
insert into kv values('arm2',pg_temp.arm('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),'[{"action":"show_current"}]'));
select pg_temp.ok(pg_temp.press(53,8801,v#>>'{refs,0}')#>>'{press,memberId}'='ad000000-0000-4000-8000-000000000001','a new reference works')from kv where k='arm2';
select public.channel_inbox_press_done((select id from public.channel_inbox where event_id=format('["telegram","noreon_cards",9101,"update",%s]',53)),'ok');
-- Another member takes over the chat's Telegram account: the old member's reference is void, and names no one.
select pg_temp.unlink('ad000000-0000-4000-8000-000000000001');

-- 8. The dose through the service entry point, for a verified actor: the same rules as the session one.
do $$begin
 perform pg_temp.as_service();set local role service_role;
 perform pg_temp.ok((public.member_medicines_read_for('ad000000-0000-4000-8000-000000000001')->>'enabled')='true','service read');
 perform pg_temp.ok(public.member_medicine_dose_report_for('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000a1',pg_temp.due(),'taken',0)->>'status'='saved','saved for the actor');
 perform pg_temp.ok(public.member_medicine_dose_report_for('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000a1',pg_temp.due(),'taken',1)->>'status'='saved','the same answer at the current revision saves nothing new');
 perform pg_temp.ok(public.member_medicine_dose_report_for('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000a1',pg_temp.due(),'taken',0)->>'status'='conflict','an old revision conflicts, and the command then reads the record');
 perform pg_temp.ok(public.member_medicine_dose_report_for('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000a1',pg_temp.due(),'skipped',5)->>'status'='conflict','a stale revision conflicts');
 perform pg_temp.ok(public.member_medicine_dose_report_for('ad000000-0000-4000-8000-000000000001','ad000000-0000-4000-8000-0000000000a1',clock_timestamp()+interval '2 days','taken',0)->>'status'='not-due','not due');
 begin perform public.member_medicine_dose_report_for('ad000000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-0000000000a1',pg_temp.due(),'taken',0);raise exception 'FAIL: B wrote A''s medicine';
 exception when insufficient_privilege then null;end;
 reset role;
end$$;
select pg_temp.ok((select count(*)=1 and min(status)='taken' from public.member_medicine_doses where medicine_id='ad000000-0000-4000-8000-0000000000a1'),'one dose row');
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='ad000000-0000-4000-8000-000000000002';
do $$begin perform pg_temp.as_service();set local role service_role;
 perform pg_temp.ok(public.member_medicine_dose_report_for('ad000000-0000-4000-8000-000000000002','ad000000-0000-4000-8000-0000000000a2',pg_temp.due(),'taken',0)->>'status'='disabled','ineligible: no write');
 perform pg_temp.ok((public.member_medicines_read_for('ad000000-0000-4000-8000-000000000002')->>'enabled')='false','ineligible: no read');
 reset role;end$$;
update auth.users set banned_until=null where id='ad000000-0000-4000-8000-000000000002';
-- The session path is unchanged.
do $$declare j jsonb;begin
 perform pg_temp.as_user('ad000000-0000-4000-8000-000000000002');set local role authenticated;
 j:=public.member_medicine_dose_report('ad000000-0000-4000-8000-0000000000a2',pg_temp.due(),'skipped',0);
 perform pg_temp.ok(j->>'status'='saved','the session tick still saves');
 perform pg_temp.ok((public.member_medicines_read()->>'enabled')='true','the session read still reads');
 begin perform public.member_medicine_dose_report('ad000000-0000-4000-8000-0000000000a1',pg_temp.due(),'skipped',0);raise exception 'FAIL: session wrote another member''s';exception when insufficient_privilege then null;end;
 reset role;
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 begin perform public.member_medicines_read();raise exception 'FAIL: anon read';exception when insufficient_privilege then null;end;
end$$;

-- 9. Saved is not delivered: the card's text goes through the outbox, once per inbox event, held until approved.
select pg_temp.ok((pg_temp.link('ad000000-0000-4000-8000-000000000001',8801)->>'ok')='true','relink for delivery');
create function pg_temp.src()returns uuid language sql as $$select id from public.channel_inbox where event_id=format('["telegram","noreon_cards",9101,"update",%s]',53)$$;
insert into kv values('sent',pg_temp.send('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),pg_temp.src(),'Zoe: Today''s medicines'));
select pg_temp.ok((v->>'ok')::boolean and (v->>'replayed')='false','queued')from kv where k='sent';
select pg_temp.ok((pg_temp.send('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),pg_temp.src(),'Zoe: Today''s medicines')->>'replayed')='true','the same event queues nothing more');
select pg_temp.ok((select count(*)=1 from public.system_messages where template_id='zoe.card'),'one message');
select pg_temp.ok(pg_temp.send('ad000000-0000-4000-8000-000000000002',pg_temp.cid(),pg_temp.src(),'x')->>'code'='not_found','never another member''s card');
select pg_temp.ok(pg_temp.send('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),pg_temp.src(),' padded ')->>'code'='invalid','Telegram would trim it');
select pg_temp.ok(pg_temp.send('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),pg_temp.src(),repeat('x',4097))->>'code'='invalid','too long');
insert into kv select 'm1',to_jsonb(id)from public.system_messages where template_id='zoe.card'order by created_at limit 1;
create function pg_temp.msg()returns uuid language sql as $$select (v#>>'{}')::uuid from kv where k='m1'$$;
do $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 j:=public.zoe_chat_card_for_message(pg_temp.msg());
 perform pg_temp.ok(j#>>'{card,id}'=pg_temp.cid()::text and j->>'memberId'='ad000000-0000-4000-8000-000000000001' and j->>'locale'='en','the message names its card');
 perform pg_temp.ok(public.zoe_chat_card_for_message(gen_random_uuid()) is null,'any other message has no card');
 -- Not approved: held, nothing goes out.
 perform pg_temp.ok(public.system_message_claim(pg_temp.msg(),'ad000000-0000-4000-8000-0000000000d1')->>'code'='template_unapproved','unapproved wording is held');
 reset role;
end$$;
select pg_temp.ok((select state='held'and reason='template_unapproved' from public.system_messages where id=pg_temp.msg()),'held');
update public.system_message_templates set approved=true where template_id='zoe.card';
create function pg_temp.src2()returns uuid language sql as $$select id from public.channel_inbox where event_id=format('["telegram","noreon_cards",9101,"update",%s]',21)$$;
select pg_temp.ok((pg_temp.send('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),pg_temp.src2(),'Zoe: approved card')->>'ok')::boolean,'queued after approval');
insert into kv select 'claim',to_jsonb(id)from public.system_messages where template_id='zoe.card'and state='queued';
do $$declare m uuid:=(select (v#>>'{}')::uuid from kv where k='claim');j jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 j:=public.system_message_claim(m,'ad000000-0000-4000-8000-0000000000d2');
 perform pg_temp.ok(j->>'ok'='true' and j#>>'{envelope,text}'='Zoe: approved card' and j#>>'{envelope,address}'='8801','claimed for the bound chat');
 -- The send timed out: unknown. Nothing is claimed again, so nothing is sent twice.
 perform public.delivery_observe('system','ad000000-0000-4000-8000-0000000000d2','{"kind":"unknown","reason":"telegram_timeout"}');
 perform public.system_message_outcome('ad000000-0000-4000-8000-0000000000d2','{"kind":"unknown","reason":"telegram_timeout"}');
 perform pg_temp.ok(public.system_message_claim(m,'ad000000-0000-4000-8000-0000000000d3')->>'code'='already_claimed_or_held','unknown is never claimed again');
 reset role;
end$$;
select pg_temp.ok((select state='unknown' from public.system_messages where id=(select (v#>>'{}')::uuid from kv where k='claim')),'delivery unknown');
select pg_temp.ok(not exists(select 1 from public.system_messages where template_id='zoe.card' and state='queued'),'nothing queued again');
-- A queued card does not follow the member to a new link.
select pg_temp.ok((pg_temp.send('ad000000-0000-4000-8000-000000000001',pg_temp.cid(),(select id from public.channel_inbox where event_id=format('["telegram","noreon_cards",9101,"update",%s]',20)),'Zoe: before relink')->>'ok')::boolean,'queued for this link');
insert into kv select 'm3',to_jsonb(id)from public.system_messages where template_id='zoe.card'and state='queued';
select pg_temp.unlink('ad000000-0000-4000-8000-000000000001');
select pg_temp.ok((pg_temp.link('ad000000-0000-4000-8000-000000000001',8801)->>'ok')='true','relink');
do $$begin perform pg_temp.as_service();set local role service_role;
 perform pg_temp.ok(public.system_message_claim((select (v#>>'{}')::uuid from kv where k='m3'),'ad000000-0000-4000-8000-0000000000d4')->>'code'='route_unavailable','an old link''s message stays unsent');
 reset role;end$$;

-- 10. Typed cards: only a Telegram member's newest message that Zoe's run cleared.
insert into public.conversations(id,member_id)values('ad000000-0000-4000-8000-0000000000c1','ad000000-0000-4000-8000-000000000001')on conflict(member_id)do nothing;
create function pg_temp.conv()returns uuid language sql as $$select id from public.conversations where member_id='ad000000-0000-4000-8000-000000000001'$$;
create function pg_temp.msg3(seq_ bigint,src text,outcome text,reason text)returns void language plpgsql as $$begin
 update public.conversations set version=greatest(version,seq_) where id=pg_temp.conv();
 insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(pg_temp.conv(),seq_,'ad000000-0000-4000-8000-000000000001','I took my pill, can you log it '||seq_,src,gen_random_uuid());
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,spend_day,finished_at)
 values(pg_temp.conv(),'ad000000-0000-4000-8000-000000000001',seq_,0,0,'finished',outcome,reason,current_date,clock_timestamp());end$$;
create function pg_temp.cand()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_chat_card_telegram_candidates(10);reset role;return j;end$$;
select pg_temp.msg3(100,'telegram_member','summary_only','same_day_floor_bp');
select pg_temp.ok(pg_temp.cand()='[]'::jsonb,'not cleared: nothing');
select pg_temp.msg3(101,'authenticated_member','chatted','chat_reply_passed_guards');
select pg_temp.ok(pg_temp.cand()='[]'::jsonb,'an app message stays with the app''s own offer');
select pg_temp.msg3(102,'telegram_member','chatted','chat_reply_passed_guards');
select pg_temp.ok(jsonb_array_length(pg_temp.cand())=1 and pg_temp.cand()#>>'{0,memberId}'='ad000000-0000-4000-8000-000000000001' and (pg_temp.cand()#>>'{0,seq}')::bigint=102,'cleared: the member and the message');
update public.conversation_policy set zoe_chat_actions_enabled=false where singleton;
select pg_temp.ok(pg_temp.cand()='[]'::jsonb,'off: nothing');
update public.conversation_policy set zoe_chat_actions_enabled=true where singleton;
do $$begin perform pg_temp.as_service();set local role service_role;
 perform pg_temp.ok((public.zoe_chat_card_post('ad000000-0000-4000-8000-000000000001',gen_random_uuid(),'dose','typed',102,'{"v":1}')->>'ok')::boolean,'the card opens');
 reset role;end$$;
-- MC-02: the card exists but its message never queued: the next sweep still sees it.
select pg_temp.ok(jsonb_array_length(pg_temp.cand())=1,'a card without its message comes back');
insert into kv select 'card102',to_jsonb(id)from public.zoe_chat_cards where source_seq=102;
do $$declare c uuid:=(select (v#>>'{}')::uuid from kv where k='card102');i uuid:=(select id from public.channel_inbox where event_id=format('["telegram","noreon_cards",9101,"update",%s]',40));begin
 perform pg_temp.as_service();set local role service_role;
 perform pg_temp.ok((public.zoe_chat_card_send('ad000000-0000-4000-8000-000000000001',c,i,'Zoe: typed card')->>'ok')::boolean,'queued on the retry');
 reset role;end$$;
select pg_temp.ok(pg_temp.cand()='[]'::jsonb,'once queued it is settled');
-- MC-03: a look that found no card settles the message, so it never uses up the scan.
select pg_temp.msg3(103,'telegram_member','chatted','chat_reply_passed_guards');
select pg_temp.ok(jsonb_array_length(pg_temp.cand())=1,'seen once');
do $$begin perform pg_temp.as_service();set local role service_role;
 perform public.zoe_chat_card_telegram_settle('ad000000-0000-4000-8000-000000000001',103);
 perform public.zoe_chat_card_telegram_settle('ad000000-0000-4000-8000-000000000001',103);
 reset role;end$$;
select pg_temp.ok(pg_temp.cand()='[]'::jsonb,'settled messages are not returned again');
-- A burst may have only a run for the final thanks. Keep the reading, its request id and time.
select pg_temp.msg3(110,'telegram_member','answered','health_answer_passed_guards');
set local session_replication_role=replica;update public.conversation_messages set body='my bp is 127/81'where conversation_id=pg_temp.conv()and seq=110;set local session_replication_role=origin;
delete from public.zoe_runs where conversation_id=pg_temp.conv()and message_seq=110;
select pg_temp.msg3(111,'telegram_member','answered','health_answer_passed_guards');
set local session_replication_role=replica;update public.conversation_messages set body='thanks'where conversation_id=pg_temp.conv()and seq=111;set local session_replication_role=origin;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.cand())x where (x->>'seq')::bigint=110 and x->>'text'='my bp is 127/81'and x->>'cleared'='false'),'a batched reading survives thanks, for a BP card only');
do $$begin
 perform pg_temp.as_service();set local role service_role;
 perform pg_temp.ok(public.zoe_chat_card_post('ad000000-0000-4000-8000-000000000001',gen_random_uuid(),'dose','typed',110,'{"v":1}')->>'code'='not_cleared','pending reading opens no dose card');
 perform pg_temp.ok(public.zoe_chat_card_post('ad000000-0000-4000-8000-000000000001',gen_random_uuid(),'bp','typed',110,'{"v":1,"week":null}')->>'code'='not_cleared','pending reading needs numbers to show back');
 reset role;end$$;
do $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 j:=public.zoe_chat_card_post('ad000000-0000-4000-8000-000000000001',gen_random_uuid(),'bp','typed',110,
  '{"v":1,"week":null,"typed":{"systolic":127,"diastolic":81,"pulse":null,"measuredAt":"2026-10-30T04:00:00+00:00"}}');
 perform pg_temp.ok((j->>'ok')::boolean,'the post re-check also accepts the pending reading');
 reset role;end$$;
insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,spend_day,finished_at)
 values(pg_temp.conv(),'ad000000-0000-4000-8000-000000000001',110,0,0,'finished','answered','health_answer_passed_guards',current_date,clock_timestamp());
select pg_temp.ok(public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'a reading with its own safe run also survives thanks');
update public.zoe_runs set outcome='summary_only',reason_code='same_day_floor_bp'where conversation_id=pg_temp.conv()and message_seq=110;
select pg_temp.ok(not public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'thanks cannot rehabilitate an earlier held reading');
update public.zoe_runs set outcome='stale',reason_code='context_changed'where conversation_id=pg_temp.conv()and message_seq=110;
select pg_temp.ok(public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'a stale earlier run defers to the new batch safety decision');
set local session_replication_role=replica;update public.conversation_messages set body='Շնորհակալություն։'where conversation_id=pg_temp.conv()and seq=111;set local session_replication_role=origin;
select pg_temp.ok(public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'Armenian small talk keeps the reading');
set local session_replication_role=replica;update public.conversation_messages set body='Спасибо.'where conversation_id=pg_temp.conv()and seq=111;set local session_replication_role=origin;
select pg_temp.ok(public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'Russian small talk keeps the reading');
set local session_replication_role=replica;update public.conversation_messages set body='thanks'where conversation_id=pg_temp.conv()and seq=111;set local session_replication_role=origin;
-- The next message still gates the whole window, and other words never carry an old reading.
-- Use the same route event as zoe_run_finish. Keep forward safe so it cannot hide an urgency-check regression.
create function pg_temp.health_route(p_seq bigint,p_urgency text)returns void language plpgsql as $$declare r public.zoe_runs;begin
 select * into strict r from public.zoe_runs where conversation_id=pg_temp.conv()and message_seq=p_seq;
 perform pg_temp.ok(public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route','outcome','allow',
  'reason',r.reason_code,'rule','zoe.pipeline','ruleVersion','synthetic-cards','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.health.urgency',p_urgency))))=1,'route event recorded');
end$$;
select pg_temp.health_route(111,'routine');
select pg_temp.ok(public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'routine latest urgency keeps the pending card');
savepoint latest_same_day;
select pg_temp.health_route(111,'same_day');
select pg_temp.ok(not public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'same-day latest run blocks the pending card');
rollback to savepoint latest_same_day;
release savepoint latest_same_day;
savepoint latest_emergency;
select pg_temp.health_route(111,'emergency');
select pg_temp.ok(not public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'emergency latest run blocks the pending card');
rollback to savepoint latest_emergency;
release savepoint latest_emergency;
update public.zoe_runs set outcome='answered',reason_code='health_answer_passed_guards'where conversation_id=pg_temp.conv()and message_seq=110;
select pg_temp.health_route(110,'routine');
select pg_temp.ok(public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'routine earlier urgency keeps the pending card');
savepoint earlier_same_day;
select pg_temp.health_route(110,'same_day');
select pg_temp.ok(not public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'thanks cannot rehabilitate a same-day earlier run');
rollback to savepoint earlier_same_day;
release savepoint earlier_same_day;
savepoint earlier_emergency;
select pg_temp.health_route(110,'emergency');
select pg_temp.ok(not public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'thanks cannot rehabilitate an emergency earlier run');
rollback to savepoint earlier_emergency;
release savepoint earlier_emergency;
set local session_replication_role=replica;update public.conversation_messages set body='sorry, that was wrong'where conversation_id=pg_temp.conv()and seq=111;set local session_replication_role=origin;
select pg_temp.ok(not public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'a correction cancels the pending reading');
set local session_replication_role=replica;update public.conversation_messages set body='thanks, I feel dizzy'where conversation_id=pg_temp.conv()and seq=111;set local session_replication_role=origin;
select pg_temp.ok(not public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',110),'small talk mixed with symptoms does not carry a reading');
select pg_temp.msg3(112,'telegram_member','chatted','chat_reply_passed_guards');
-- A correction from the app also cancels the original pending reading.
select pg_temp.msg3(120,'telegram_member','chatted','chat_reply_passed_guards');
set local session_replication_role=replica;update public.conversation_messages set body='128/82' where conversation_id=pg_temp.conv() and seq=120;set local session_replication_role=origin;
select pg_temp.msg3(121,'authenticated_member','chatted','chat_reply_passed_guards');
set local session_replication_role=replica;update public.conversation_messages set body='sorry, that was my dad''s reading' where conversation_id=pg_temp.conv() and seq=121;set local session_replication_role=origin;
select pg_temp.msg3(122,'telegram_member','chatted','chat_reply_passed_guards');
set local session_replication_role=replica;update public.conversation_messages set body='thanks' where conversation_id=pg_temp.conv() and seq=122;set local session_replication_role=origin;
select pg_temp.ok(not public._zoe_chat_reading_cleared('ad000000-0000-4000-8000-000000000001',120),'a cross-channel correction blocks the original pending card');

select pg_temp.unlink('ad000000-0000-4000-8000-000000000001');
select pg_temp.ok(pg_temp.cand()='[]'::jsonb,'unlinked: nothing');

rollback;
\echo ok zoe cards telegram
