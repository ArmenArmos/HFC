-- Telegram T1 SQL lifecycle in one rolled-back transaction: linking (contact proof since
-- T-auth; the token and proof rules are covered in check-telegram-auth.sql), durable inbox,
-- generation fence, acknowledgement and doctor alert, exact replies, delivery states,
-- unlink, CR5 hold, operations view and least-privilege catalog. Synthetic fixtures
-- only; no Telegram, network or provider is involved.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_member(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_test",9001,"user",%s]',u)$$;
create function pg_temp.event(id text,kind text,u bigint,payload jsonb)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_test",9001,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind',kind,'payload',payload||jsonb_build_object('chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.hash(t text)returns text language sql as $$select encode(sha256(convert_to(t,'UTF8')),'hex')$$;
-- Lease and process every pending inbox row as the service role.
create function pg_temp.drain()returns jsonb language plpgsql as $$declare i jsonb;out jsonb:='[]';begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop out:=out||jsonb_build_array(public.channel_inbox_process((i#>>'{}')::uuid));end loop;return out;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role,anon;

-- Relink outside the inbox (as the owner), so already-committed text is processed after it.
-- Replacing the Telegram account ends the member's sessions (T-auth C4); the member then
-- signs in again, modelled by restoring the fixture session.
create function pg_temp.relink(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;r jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 r:=public._telegram_replies_activate(m,(b->>'bindingId')::uuid);
 insert into auth.sessions(id,user_id,created_at,updated_at)values('d1100000-0000-4000-8000-000000000005',m,now(),now())on conflict do nothing;
 return r;end$$;
create function pg_temp.now_s()returns bigint language sql as $$select ceil(extract(epoch from clock_timestamp()))::bigint$$;

-- Fixtures ------------------------------------------------------------------------
insert into auth.users(id,phone,phone_confirmed_at)values
 ('d1100000-0000-4000-8000-000000000001','37499011001',now()),('d1100000-0000-4000-8000-000000000008','37499011008',now()),
 ('d1100000-0000-4000-8000-000000000002',null,null),('d1100000-0000-4000-8000-000000000009',null,null),
 ('d1100000-0000-4000-8000-000000000010','37499011010',null);
insert into public.workspace_clinics(id,name)values('d1100000-0000-4000-8000-000000000004','Synthetic Telegram clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('d1100000-0000-4000-8000-000000000002','doctor','Dr Synthetic Approver','d1100000-0000-4000-8000-000000000004'),
 ('d1100000-0000-4000-8000-000000000009','admin','Synthetic operations admin',null);
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('d1100000-0000-4000-8000-000000000005','d1100000-0000-4000-8000-000000000001',now(),now()),
 ('d1100000-0000-4000-8000-000000000006','d1100000-0000-4000-8000-000000000002',now(),now()),
 ('d1100000-0000-4000-8000-000000000007','d1100000-0000-4000-8000-000000000008',now(),now()),
 ('d1100000-0000-4000-8000-000000000011','d1100000-0000-4000-8000-000000000009',now(),now()),
 ('d1100000-0000-4000-8000-000000000012','d1100000-0000-4000-8000-000000000010',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000002'),('d1100000-0000-4000-8000-000000000008','d1100000-0000-4000-8000-000000000002');
update public.profiles set locale='en'where id='d1100000-0000-4000-8000-000000000001';

-- Dark by default: no settings means linking is unavailable.
select pg_temp.as_member('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000005');set local role authenticated;
select pg_temp.ok(public.telegram_link_status()->>'available'='false','Status reports unavailable when dark');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_challenge_create('member_link','+37499011001','d1100000-0000-4000-8000-000000000001',null,'consent-v1')->>'code'='unavailable','Unconfigured channel refuses linking');
reset role;

-- Explicit test-only configuration, never production values.
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_test',9001,600,'consent-v1');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-t1',3600,600,60,100,false,true);
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values
 ('telegram.ack',2,'en','Synthetic approved acknowledgement. Call 103 in an emergency.',true,'test fixture'),
 ('telegram.ack',2,'hy','Synthetic approved acknowledgement HY. 103.',true,'test fixture'),
 ('telegram.link_confirmed',2,'en','Synthetic link confirmation.',true,'test fixture'),
 ('telegram.link_confirmed',2,'hy','Synthetic link confirmation HY.',true,'test fixture');

-- 1. Connect challenges ------------------------------------------------------------------
set local role anon;
do $$begin perform public.telegram_auth_challenge_create('member_link','+37499011001',null,null,'consent-v1');raise exception 'anon issued';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_challenge_create('member_link','+37499011001','d1100000-0000-4000-8000-000000000002',null,'consent-v1')->>'code'='not_eligible','Staff cannot link a member channel');
select pg_temp.ok(public.telegram_auth_challenge_create('member_link','+37499011010','d1100000-0000-4000-8000-000000000010',null,'consent-v1')->>'code'='not_eligible','Unverified phone cannot link');
select pg_temp.ok(public.telegram_auth_challenge_create('member_link','+37499011001','d1100000-0000-4000-8000-000000000001',null,'consent-v0')->>'code'='consent_required','Current consent version is required');
insert into kv values('a-first',public.telegram_auth_challenge_create('member_link','+37499011001','d1100000-0000-4000-8000-000000000001',null,'consent-v1'));
insert into kv values('a-token',public.telegram_auth_challenge_create('member_link','+37499011001','d1100000-0000-4000-8000-000000000001',null,'consent-v1'));
select pg_temp.ok(v->>'ok'='true'and v->>'token'~'^[A-Za-z0-9_-]{32}$','Token is 32 URL-safe characters')from kv where k='a-token';
insert into kv values('b-token',public.telegram_auth_challenge_create('member_link','+37499011008','d1100000-0000-4000-8000-000000000008',null,'consent-v1'));
reset role;
select pg_temp.ok((select count(*)=2 and count(*)filter(where state='open')=2 from public.telegram_auth_challenges where target_user='d1100000-0000-4000-8000-000000000001'),'A second Connect press keeps the earlier link usable');
select pg_temp.ok(not exists(select 1 from public.telegram_auth_challenges t,kv where kv.k='a-token'and t.token_hash=kv.v->>'token'),'Raw token is never stored');

-- 2. Inbox commit, duplicates and conflicts -------------------------------------------
select pg_temp.as_service();set local role service_role;
insert into kv select 'commit-link',public.channel_inbox_commit(pg_temp.event('100','link',7001,jsonb_build_object('tokenHash',pg_temp.hash(v->>'token'))))from kv where k='a-token';
select pg_temp.ok(v->>'status'='committed','Link event committed')from kv where k='commit-link';
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('100','link',7001,jsonb_build_object('tokenHash',pg_temp.hash(v->>'token'))))->>'status'='committed-duplicate','Same event and fingerprint is a committed duplicate')from kv where k='a-token';
select pg_temp.ok(public.channel_inbox_commit(jsonb_set(pg_temp.event('100','link',7001,jsonb_build_object('tokenHash',pg_temp.hash(v->>'token'))),'{fingerprint}','"fp-different"'))->>'status'='conflict','Same event with another fingerprint conflicts')from kv where k='a-token';
select pg_temp.ok(public.channel_inbox_commit(jsonb_set(pg_temp.event('101','text',7001,'{"text":"x"}'),'{principalRef}','"[\"telegram\",\"other_bot\",1,\"user\",7001]"'))->>'code'='foreign_principal','Another bot principal is refused');
select pg_temp.ok(public.channel_inbox_commit(jsonb_set(pg_temp.event('102','text',7001,'{"text":"x"}'),'{payload,chatId}','7002'))->>'code'='foreign_principal','Principal must be the private chat it wrote in');
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('103','text',7001,'{"text":"x","memberId":"forged"}'))->>'code'='invalid_event','Injected payload keys are refused');
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('104','link',7001,'{"tokenHash":"not-a-hash"}'))->>'code'='invalid_event','Link carries only a token digest');
reset role;
select pg_temp.as_member('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000005');set local role authenticated;
do $$begin perform public.channel_inbox_commit('{}');raise exception 'member committed inbox';exception when insufficient_privilege then null;end$$;
reset role;

-- 3. Contact proof links -----------------------------------------------------------------
select pg_temp.as_service();set local role service_role;
insert into kv values('drain-1',pg_temp.drain());
select pg_temp.ok(v#>>'{0,result}'='auth:prompted','Fresh token asks for the member''s own contact')from kv where k='drain-1';
select public.channel_inbox_commit(pg_temp.event('105','contact',7001,jsonb_build_object('phone','+37499011001','sentAt',pg_temp.now_s())));
insert into kv values('drain-1b',pg_temp.drain());
select pg_temp.ok(v#>>'{0,result}'='contact:linked','Own contact with the account phone links the principal')from kv where k='drain-1b';
reset role;
select pg_temp.ok((select active and generation=1 and member_id='d1100000-0000-4000-8000-000000000001'and address='7001'from public.conversation_endpoints where principal_ref=pg_temp.principal(7001)),'Endpoint active at generation 1');
select pg_temp.ok((select state='queued'and template_id='telegram.link_confirmed'and locale='en'from public.system_messages where member_id='d1100000-0000-4000-8000-000000000001'),'Link confirmation queued in the member language');
select pg_temp.as_member('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000005');set local role authenticated;
select pg_temp.ok(public.telegram_link_status()->>'linked'='true','Member sees linked status');
reset role;
select pg_temp.as_service();set local role service_role;
-- Reused, superseded and forged tokens; another member's challenge on a linked account.
select public.channel_inbox_commit(pg_temp.event('106','link',7009,jsonb_build_object('tokenHash',pg_temp.hash(v->>'token'))))from kv where k='a-token';
select public.channel_inbox_commit(pg_temp.event('107','link',7009,jsonb_build_object('tokenHash',pg_temp.hash(v->>'token'))))from kv where k='a-first';
select public.channel_inbox_commit(pg_temp.event('108','link',7009,jsonb_build_object('tokenHash',pg_temp.hash('forged-token-forged-token-forged0'))));
select public.channel_inbox_commit(pg_temp.event('109','link',7001,jsonb_build_object('tokenHash',pg_temp.hash(v->>'token'))))from kv where k='b-token';
select pg_temp.drain();
select public.channel_inbox_commit(pg_temp.event('114','contact',7001,jsonb_build_object('phone','+37499011008','sentAt',pg_temp.now_s())));
select pg_temp.drain();
reset role;
select pg_temp.ok((select array_agg(result order by event_id)=array['auth:token_invalid','auth:prompted','auth:token_invalid','auth:prompted']from public.channel_inbox where event_id ~ ',10[6-9]\]$'),'Reused and forged tokens do nothing; an earlier unused link stays usable');
select pg_temp.ok((select count(*)=2 from public.telegram_auth_messages where template_id='telegram.link_expired'and address='7009'),'A dead link gets the neutral expired-link reply');
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,114]')='contact:principal_bound_elsewhere','A linked Telegram account cannot take another member''s challenge');
select pg_temp.ok(not exists(select 1 from public.conversation_endpoints where member_id='d1100000-0000-4000-8000-000000000008'),'No rejected path created an endpoint');

-- 4. Inbound text: acknowledgement and doctor alert -----------------------------------
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('110','text',7001,'{"text":"Synthetic first member message"}'));
select public.channel_inbox_commit(pg_temp.event('111','text',7777,'{"text":"From an unlinked account"}'));
select public.channel_inbox_commit(pg_temp.event('112','start',7001,'{}'));
insert into kv values('drain-2',pg_temp.drain());
reset role;
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,110]')='received','Linked text received');
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,111]')='principal_not_linked','Unlinked account never reaches a conversation');
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,112]')='ignored_start','Bare /start does nothing');
select pg_temp.ok((select count(*)=1 and min(source)='telegram_member'and min(body)='Synthetic first member message'from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='d1100000-0000-4000-8000-000000000001'),'Exact member text stored once');
select pg_temp.ok(not exists(select 1 from public.channel_inbox where payload?'text'and status='done'),'Processed inbox rows keep no message text');
select pg_temp.ok((select count(*)=1 and min(doctor_id::text)='d1100000-0000-4000-8000-000000000002'from public.conversation_doctor_alerts),'Assigned doctor alerted');
select pg_temp.ok((select count(*)=1 from public.system_messages where template_id='telegram.ack'and body like '%103%'),'Acknowledgement with Call 103 queued before any doctor action');
select pg_temp.ok(not exists(select 1 from pg_attribute where attrelid='public.conversation_doctor_alerts'::regclass and attname ~ 'read|seen'),'Alerts have no read state');

-- 5. Doctor reply: compose, approve, invalidation by new member text -------------------
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000006');set local role authenticated;
select pg_temp.ok(jsonb_array_length(public.conversation_awaiting_replies()->'items')=1,'Awaiting list shows the new message');
insert into kv values('ws',public.conversation_workspace('d1100000-0000-4000-8000-000000000001'));
select public.conversation_compose('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000030',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Exact synthetic doctor reply','Private synthetic summary')from kv where k='ws';
insert into kv values('actions',public.conversation_actions('d1100000-0000-4000-8000-000000000001'));
insert into kv select 'approve',jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(v#>'{view,actions}')x where x->>'purpose'='reply.approve'),'requestId','d1100000000040008000000000000031')from kv where k='actions';
insert into kv select 'approved-1',public.conversation_command(v)from kv where k='approve';
reset role;
select pg_temp.ok((select state='queued'and endpoint_generation=1 from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-1')),'Approved reply queued to the linked endpoint');
-- New member text after approval invalidates it before any claim.
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('113','text',7001,'{"text":"Synthetic second message after approval"}'));
select pg_temp.drain();
reset role;
select pg_temp.ok((select state='held'and reason='newer_member_message'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-1')),'New member text holds the earlier approval');
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000006');set local role authenticated;
update kv set v=public.conversation_workspace('d1100000-0000-4000-8000-000000000001')where k='ws';
select public.conversation_compose('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000032',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Second exact synthetic reply','Private second summary')from kv where k='ws';
update kv set v=public.conversation_actions('d1100000-0000-4000-8000-000000000001')where k='actions';
update kv set v=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from kv a,jsonb_array_elements(a.v#>'{view,actions}')x where a.k='actions'and x->>'purpose'='reply.approve'),'requestId','d1100000000040008000000000000033')where k='approve';
insert into kv select 'approved-2',public.conversation_command(v)from kv where k='approve';
select pg_temp.ok(jsonb_array_length(public.conversation_awaiting_replies()->'items')=0,'Approval clears the awaiting list');
reset role;

-- 6. Exact claim and typed outcomes -----------------------------------------------------
select pg_temp.as_service();set local role service_role;
insert into kv select 'claim-2',public.conversation_claim((v->>'deliveryId')::uuid,'d1100000-0000-4000-8000-000000000040')from kv where k='approved-2';
select pg_temp.ok(v->>'ok'='true'and v#>>'{envelope,body}'='Second exact synthetic reply'and v#>>'{envelope,approvedBy,displayName}'='Dr Synthetic Approver'and v#>>'{envelope,address}'='7001'and v->>'accountRef'='["noreon_test",9001]','Claim carries the exact approved body, doctor and destination')from kv where k='claim-2';
select pg_temp.ok(public.conversation_claim((v->>'deliveryId')::uuid,'d1100000-0000-4000-8000-000000000041')->>'code'='already_claimed_or_held','One claim per delivery')from kv where k='approved-2';
-- R1-1: a recognised kind with a missing, null or mistyped field is refused with no observation or state change.
select pg_temp.ok(bool_and(public.conversation_outcome('d1100000-0000-4000-8000-000000000040',o::jsonb)->>'code'='invalid_outcome'),'Incomplete conversation outcomes refused')
 from unnest(array['{"kind":"accepted"}','{"kind":"accepted","providerRef":null}','{"kind":"accepted","providerRef":7}','{"kind":"definitely_failed"}','{"kind":"unknown","reason":""}','{"kind":"unknown"}','null','[]'])o;
select pg_temp.ok(public.delivery_observe('conversation','d1100000-0000-4000-8000-000000000040','{"kind":"accepted"}')->>'code'='invalid_outcome','Incomplete observation refused');
select pg_temp.ok(public.delivery_observe('system','d1100000-0000-4000-8000-000000000040','{"kind":"accepted","providerRef":"x"}')->>'code'='attempt_unknown','Observation channel must match the attempt');
reset role;
select pg_temp.ok(not exists(select 1 from public.delivery_observations where attempt_id='d1100000-0000-4000-8000-000000000040')and(select state='sending'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-2')),'Refused outcomes left no observation and no state change');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.delivery_observe('conversation','d1100000-0000-4000-8000-000000000040','{"kind":"accepted","providerRef":"synthetic-1"}')->>'result'='retained','Observation committed before recording');
select pg_temp.ok(public.conversation_outcome('d1100000-0000-4000-8000-000000000040','{"kind":"accepted","providerRef":"synthetic-1"}')->>'result'='recorded','Accepted outcome recorded');
select pg_temp.ok(public.conversation_outcome('d1100000-0000-4000-8000-000000000040','{"kind":"accepted","providerRef":"synthetic-1"}')->>'result'='duplicate','Identical outcome is a duplicate');
select pg_temp.ok(public.conversation_outcome('d1100000-0000-4000-8000-000000000040','{"kind":"unknown","reason":"other"}')->>'result'='conflict','Different observation for the same attempt conflicts');
select pg_temp.ok(public.conversation_outcome('d1100000-0000-4000-8000-000000000049','{"kind":"unknown","reason":"x"}')->>'code'='attempt_unknown','Unknown attempt is a typed failure');
select pg_temp.ok(public.conversation_outcome('d1100000-0000-4000-8000-000000000040','{"kind":"sent"}')->>'code'='invalid_outcome','Invalid outcome is a typed failure');
reset role;
select pg_temp.ok((select state='accepted_by_provider'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-2')),'Delivery shows accepted');
select pg_temp.ok((select count(*)=1 from public.delivery_observations where attempt_id='d1100000-0000-4000-8000-000000000040'),'Observation retained once');

-- 7. System message states: accepted, failed, unknown, timeout to unknown, never re-claimed
insert into kv select 'sys-'||row_number()over(order by created_at,id),to_jsonb(id)from public.system_messages where state='queued';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((select count(*)=3 from kv where k like 'sys-%'),'Three queued system messages (link confirmation and two acknowledgements)');
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,'d1100000-0000-4000-8000-000000000050')->>'ok'='true','System message claimed')from kv where k='sys-1';
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,'d1100000-0000-4000-8000-000000000051')->>'ok'='true','Second system message claimed')from kv where k='sys-2';
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,'d1100000-0000-4000-8000-000000000052')->>'ok'='true','Third system message claimed')from kv where k='sys-3';
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,'d1100000-0000-4000-8000-000000000053')->>'code'='already_claimed_or_held','A claimed system message is never claimed again')from kv where k='sys-1';
select pg_temp.ok(bool_and(public.system_message_outcome('d1100000-0000-4000-8000-000000000050',o::jsonb)->>'code'='invalid_outcome'),'Incomplete system outcomes refused')
 from unnest(array['{"kind":"accepted"}','{"kind":"definitely_failed","evidence":null}','{"kind":"unknown","reason":1}'])o;
select pg_temp.ok(public.delivery_observe('system','d1100000-0000-4000-8000-000000000050','{"kind":"definitely_failed"}')->>'code'='invalid_outcome','Incomplete system observation refused');
select pg_temp.ok(public.system_message_outcome('d1100000-0000-4000-8000-000000000050','{"kind":"accepted","providerRef":"s1"}')->>'result'='recorded','System accepted');
select pg_temp.ok(public.system_message_outcome('d1100000-0000-4000-8000-000000000051','{"kind":"definitely_failed","evidence":"not_sent_unsupported_payload"}')->>'result'='recorded','System definitely failed');
reset role;
-- Simulate an elapsed lease; the frozen-attempt trigger is bypassed only for this fixture edit.
set local session_replication_role=replica;
update public.system_message_attempts set claimed_at=claimed_at-interval '10 minutes'where id='d1100000-0000-4000-8000-000000000052';
set local session_replication_role=origin;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.delivery_reconcile_stale(120)->>'reconciled'='1','Stuck sending becomes unknown after the lease');
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,'d1100000-0000-4000-8000-000000000054')->>'code'='already_claimed_or_held','Unknown is never re-claimed')from kv where k='sys-3';
select pg_temp.ok(jsonb_array_length(public.telegram_dispatch_queue(50)->'system')=0,'Dispatch queue lists only queued messages');
reset role;
select pg_temp.ok((select array_agg(state order by created_at,id)=array['accepted_by_provider','definitely_failed','unknown']from public.system_messages),'System states are truthful');
select pg_temp.ok((select count(*)=2 from public.conversation_doctor_alerts)and exists(select 1 from public.system_messages s join public.conversation_doctor_alerts a on a.inbox_id=s.source_inbox_id where s.state='definitely_failed'),'Doctor alert stands even though its acknowledgement failed');

-- 7b. Over the intake limit: text not stored, safety path kept and bounded (R2-1) --------
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000006');set local role authenticated;
update kv set v=public.conversation_workspace('d1100000-0000-4000-8000-000000000001')where k='ws';
select public.conversation_compose('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000038',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Approved reply before overflow','Private overflow summary')from kv where k='ws';
update kv set v=public.conversation_actions('d1100000-0000-4000-8000-000000000001')where k='actions';
update kv set v=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from kv a,jsonb_array_elements(a.v#>'{view,actions}')x where a.k='actions'and x->>'purpose'='reply.approve'),'requestId','d1100000000040008000000000000039')where k='approve';
insert into kv select 'approved-overflow',public.conversation_command(v)from kv where k='approve';
select pg_temp.ok(jsonb_array_length(public.conversation_awaiting_replies()->'items')=0,'Nothing waiting once the reply is approved and queued');
reset role;
select pg_temp.ok((select state='queued'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-overflow')),'Reply queued before the overflow');
insert into kv select 'version-before',to_jsonb(version)from public.conversations where member_id='d1100000-0000-4000-8000-000000000001';
update public.conversation_policy set intake_max_messages=2;
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('115','text',7001,'{"text":"Overflow one"}'));
select public.channel_inbox_commit(pg_temp.event('116','text',7001,'{"text":"Overflow two"}'));
select pg_temp.drain();
reset role;
update public.conversation_policy set intake_max_messages=100;
select pg_temp.ok((select count(*)=2 from public.channel_inbox where result='rate_limited'and not(payload?'text')),'Over-limit messages finish without keeping text');
select pg_temp.ok(not exists(select 1 from public.conversation_messages where body like 'Overflow%'),'Over-limit text is not stored');
select pg_temp.ok((select count(*)=1 from public.conversation_doctor_alerts a join public.channel_inbox i on i.id=a.inbox_id where i.result='rate_limited'),'One doctor alert per intake window over the limit');
select pg_temp.ok((select count(*)=1 from public.system_messages s join public.channel_inbox i on i.id=s.source_inbox_id where i.result='rate_limited'and s.template_id='telegram.ack'),'One acknowledgement per intake window over the limit');
select pg_temp.ok((select version=(select(v#>>'{}')::bigint+2 from kv where k='version-before')from public.conversations where member_id='d1100000-0000-4000-8000-000000000001'),'Over-limit messages still advance the conversation');
select pg_temp.ok((select state='held'and reason='member_over_intake_limit'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-overflow')),'Over-limit message holds the queued approved reply with its own reason');
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000006');set local role authenticated;
select pg_temp.ok(public.conversation_awaiting_replies()#>>'{items,0,reason}'='new_message'and public.conversation_awaiting_replies()#>>'{items,0,overLimit}'='true','Doctor list shows the member with unsaved over-limit messages (N1)');
select pg_temp.ok((public.conversation_workspace('d1100000-0000-4000-8000-000000000001')->>'unsavedOverLimit')::boolean,'Conversation page is told about unsaved over-limit messages');
update kv set v=public.conversation_workspace('d1100000-0000-4000-8000-000000000001')where k='ws';
select public.conversation_compose('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000037',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','No reply needed draft','Doctor decides no reply')from kv where k='ws';
update kv set v=public.conversation_actions('d1100000-0000-4000-8000-000000000001')where k='actions';
select public.conversation_command(jsonb_build_object('schema',1,'purpose','reply.reject','intentId',(select x->>'intentId'from kv a,jsonb_array_elements(a.v#>'{view,actions}')x where a.k='actions'and x->>'purpose'='reply.reject'),'requestId','d1100000000040008000000000000040'));
select pg_temp.ok(jsonb_array_length(public.conversation_awaiting_replies()->'items')=0,'Rejecting after an over-limit hold clears the doctor list');
select pg_temp.ok(not(public.conversation_workspace('d1100000-0000-4000-8000-000000000001')->>'unsavedOverLimit')::boolean,'The unsaved notice clears after a decision');
reset role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('115','text',7001,'{"text":"Overflow one"}'))->>'status'='committed-duplicate','A redelivered over-limit update is a committed duplicate');
select pg_temp.drain();
reset role;
select pg_temp.ok((select count(*)=1 from public.conversation_doctor_alerts a join public.channel_inbox i on i.id=a.inbox_id where i.result='rate_limited'),'Redelivery adds no alert');

-- 8. Relink: generation bump and G2 fence for queued old-account text -------------------
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('120','text',7001,'{"text":"Old account text committed before relink"}'));
reset role;
select pg_temp.relink('d1100000-0000-4000-8000-000000000001',7002);
select pg_temp.as_service();set local role service_role;
insert into kv values('drain-3',pg_temp.drain());
reset role;
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,120]')='generation_mismatch','Old-generation text fails closed after relink');
select pg_temp.ok((select not active and generation=2 from public.conversation_endpoints where principal_ref=pg_temp.principal(7001))and(select active and generation=3 from public.conversation_endpoints where principal_ref=pg_temp.principal(7002)),'Relink retires the old account and bumps the generation');
select pg_temp.ok((select count(*)=2 from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='d1100000-0000-4000-8000-000000000001'),'Fenced text never entered the conversation');
-- Relink back to the first account bumps again.
select pg_temp.ok(pg_temp.relink('d1100000-0000-4000-8000-000000000001',7001)->>'generation'='5','Relinking the original account bumps generation again');

-- 9. CR5: authority lapse at claim is an explicit hold ------------------------------------
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('130','text',7001,'{"text":"Synthetic third message"}'));
select pg_temp.drain();
reset role;
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000006');set local role authenticated;
update kv set v=public.conversation_workspace('d1100000-0000-4000-8000-000000000001')where k='ws';
select public.conversation_compose('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000034',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Third exact reply','Private third summary')from kv where k='ws';
update kv set v=public.conversation_actions('d1100000-0000-4000-8000-000000000001')where k='actions';
update kv set v=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from kv a,jsonb_array_elements(a.v#>'{view,actions}')x where a.k='actions'and x->>'purpose'='reply.approve'),'requestId','d1100000000040008000000000000035')where k='approve';
insert into kv select 'approved-3',public.conversation_command(v)from kv where k='approve';
reset role;
delete from auth.sessions where id='d1100000-0000-4000-8000-000000000006';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.conversation_claim((v->>'deliveryId')::uuid,'d1100000-0000-4000-8000-000000000042')->>'code'='approval_authority_lapsed','Lapsed doctor session is reported')from kv where k='approved-3';
reset role;
select pg_temp.ok((select state='held'and reason='approval_authority_lapsed'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-3')),'Lapsed authority holds with a reason');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='delivery.held'and detail->>'reason'='approval_authority_lapsed'),'Hold is audited');
select pg_temp.ok(not exists(select 1 from public.conversation_attempts where delivery_id=(select(v->>'deliveryId')::uuid from kv where k='approved-3')),'No attempt and no send for a lapsed approval');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1100000-0000-4000-8000-000000000006','d1100000-0000-4000-8000-000000000002',now(),now());
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000006');set local role authenticated;
select pg_temp.ok(public.conversation_awaiting_replies()#>>'{items,0,reason}'='not_delivered'and public.conversation_awaiting_replies()#>>'{items,0,latestReason}'='approval_authority_lapsed','An undelivered reply keeps the member on the doctor list (R3-1)');
select pg_temp.ok(public.conversation_workspace('d1100000-0000-4000-8000-000000000001')?'memberName','Staff workspace names the member (R3-2)');
reset role;

-- 10. Unapproved template holds; unlink holds everything --------------------------------
update public.system_message_templates set approved=true where template_id='telegram.ack'and version=1 and locale='en';
select pg_temp.ok((select count(*)from public.system_message_templates where approved and version=1)=1,'Approval flag can be set');
do $$begin update public.system_message_templates set approved=false where template_id='telegram.ack'and version=1 and locale='en';raise exception 'unapproved';exception when sqlstate '55000' then null;end$$;
do $$begin update public.system_message_templates set body='changed'where template_id='telegram.ack'and version=2 and locale='en';raise exception 'body changed';exception when sqlstate '55000' then null;end$$;
insert into public.system_message_templates(template_id,version,locale,body)values('telegram.ack',3,'en','Synthetic newer unapproved wording');
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('140','text',7001,'{"text":"Synthetic fourth message"}'));
select pg_temp.drain();
reset role;
insert into kv select 'unapproved',to_jsonb(id)from public.system_messages where template_version=3;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,'d1100000-0000-4000-8000-000000000055')->>'code'='template_unapproved','Unapproved wording is held, never sent')from kv where k='unapproved';
reset role;
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values('telegram.ack',4,'en','Synthetic approved acknowledgement v4. Call 103.',true,'test fixture');
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('141','text',7001,'{"text":"Synthetic fifth message"}'));
select pg_temp.drain();
reset role;
-- R1-4: an expired endpoint holds a system message at claim with no attempt.
insert into kv select 'expiring',to_jsonb(id)from public.system_messages where state='queued'order by created_at desc limit 1;
update public.conversation_endpoints set expires_at=now()-interval '1 second'where member_id='d1100000-0000-4000-8000-000000000001'and active;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,'d1100000-0000-4000-8000-000000000056')->>'code'='route_unavailable','Expired endpoint holds the system message')from kv where k='expiring';
reset role;
select pg_temp.ok(not exists(select 1 from public.system_message_attempts where id='d1100000-0000-4000-8000-000000000056'),'No attempt for an expired endpoint');
update public.conversation_endpoints set expires_at='infinity'where member_id='d1100000-0000-4000-8000-000000000001'and active;
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('142','text',7001,'{"text":"Synthetic sixth message"}'));
select pg_temp.drain();
reset role;
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000006');set local role authenticated;
update kv set v=public.conversation_workspace('d1100000-0000-4000-8000-000000000001')where k='ws';
select public.conversation_compose('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000036',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Fourth exact reply','Private fourth summary')from kv where k='ws';
update kv set v=public.conversation_actions('d1100000-0000-4000-8000-000000000001')where k='actions';
update kv set v=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from kv a,jsonb_array_elements(a.v#>'{view,actions}')x where a.k='actions'and x->>'purpose'='reply.approve'),'requestId','d1100000000040008000000000000037')where k='approve';
insert into kv select 'approved-4',public.conversation_command(v)from kv where k='approve';
reset role;
select pg_temp.ok((select state='queued'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-4')),'Fourth reply queued before unlink');
select pg_temp.as_member('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000005');set local role authenticated;
select pg_temp.ok(public.telegram_unlink()->>'unlinked'='true','Member unlinks');
select pg_temp.ok(public.telegram_link_status()->>'linked'='false','Status shows not linked');
reset role;
select pg_temp.ok((select state='held'and reason='endpoint_unlinked'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved-4')),'Unlink holds queued replies');
insert into kv select 'queued-'||id,to_jsonb(id)from public.system_messages where state='queued';
select pg_temp.ok((select count(*)>=1 from kv where k like 'queued-%'),'Acknowledgement queued before unlink');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(bool_and(public.system_message_claim((v#>>'{}')::uuid,gen_random_uuid())->>'code'='route_unavailable'),'Unlink holds queued system messages at claim')from kv where k like 'queued-%';
reset role;
select pg_temp.ok(not exists(select 1 from public.system_messages where state='queued'),'Nothing left queued after unlink');

-- 11. Poison and dead letters -----------------------------------------------------------
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_reject('["telegram","noreon_test",9001,"update",150]','unsupported_update');
select public.channel_inbox_commit(pg_temp.event('151','text',7001,'{"text":"Poison candidate"}'));
reset role;
update public.channel_inbox set status='processing',attempts=5,lease_until=now()-interval '1 minute'where event_id like '%,151]';
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_next(10);
reset role;
select pg_temp.ok((select status='dead'and result='max_attempts'from public.channel_inbox where event_id like '%,151]'),'Repeated failure dead-letters the update');
select pg_temp.ok((select not(payload?'text')from public.channel_inbox where event_id like '%,151]'),'Exhausted dead letter keeps no message text (R1-3)');
select pg_temp.ok(not exists(select 1 from public.conversation_messages where body='Poison candidate'),'No partial conversation write from a dead letter');
select pg_temp.ok((select status='dead'and payload='{}'from public.channel_inbox where event_id like '%,150]'),'Unsupported update stored as a content-free dead letter');

-- 12. Operations view and least privilege ------------------------------------------------
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000009','d1100000-0000-4000-8000-000000000011');set local role authenticated;
insert into kv values('ops',public.telegram_delivery_problems());
select pg_temp.ok(jsonb_array_length(v->'system')>=3 and jsonb_array_length(v->'replies')=3 and not(v->'replies')::text like '%newer_member_message%'and(v#>>'{inbox,dead}')::int=2,'Operations view lists failed, unknown and held items')from kv where k='ops';
select pg_temp.ok(not(v::text like '%Exact%'or v::text like '%Synthetic first member%'),'Operations view carries no message bodies')from kv where k='ops';
reset role;
select pg_temp.as_staff('d1100000-0000-4000-8000-000000000002','d1100000-0000-4000-8000-000000000006');set local role authenticated;
do $$begin perform public.telegram_delivery_problems();raise exception 'doctor read ops';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.as_member('d1100000-0000-4000-8000-000000000008','d1100000-0000-4000-8000-000000000007');set local role authenticated;
do $$begin perform public.conversation_awaiting_replies();raise exception 'member read awaiting';exception when insufficient_privilege then null;end$$;
reset role;
select pg_temp.as_member('d1100000-0000-4000-8000-000000000001','d1100000-0000-4000-8000-000000000005');set local role authenticated;
select pg_temp.ok(not(public.conversation_workspace(null)::text ~ 'staffId|clinicId|reviewAfterSend'),'Member reply history omits internal staff fields (CR6)');
reset role;
select pg_temp.ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relname in('telegram_channel_settings','telegram_audit','telegram_link_tokens','channel_inbox','system_message_templates','system_messages','system_message_attempts','system_message_audit','conversation_doctor_alerts','delivery_observations')and not c.relrowsecurity),'RLS on every T1 table');
select pg_temp.ok(not exists(select 1 from information_schema.role_table_grants where table_schema='public'and grantee in('anon','authenticated','service_role')and table_name in('telegram_channel_settings','telegram_audit','telegram_link_tokens','channel_inbox','system_message_templates','system_messages','system_message_attempts','system_message_audit','conversation_doctor_alerts','delivery_observations')),'No direct table grants');
select pg_temp.ok(not has_function_privilege('authenticated','public.channel_inbox_commit(jsonb)','execute')and to_regprocedure('public.telegram_link_redeem(text,text,bigint)')is null and not has_function_privilege('authenticated','public.system_message_claim(uuid,uuid)','execute')
 and to_regprocedure('public.telegram_link_issue(text)')is null and to_regprocedure('public._telegram_link_redeem(text,text,bigint)')is null
 and not has_function_privilege('service_role','public._conversation_record_outcome(uuid,jsonb,boolean)','execute'),'Function grants are least privilege');
\echo PASS telegram T1 SQL lifecycle: link, inbox, generation fence, ack and alert, exact reply, states, unlink, CR5, grants (rolled back)
rollback;
