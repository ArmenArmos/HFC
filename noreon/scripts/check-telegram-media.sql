-- Telegram T1 follow-up (AB-2): non-text messages from a linked member, rolled back.
-- Synthetic fixtures only; no Telegram, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_member(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_media",9003,"user",%s]',u)$$;
create function pg_temp.event(id text,kind text,u bigint,payload jsonb)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_media",9003,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind',kind,'payload',payload||jsonb_build_object('chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
-- Link through the T-auth binding (as the owner); the contact proof itself is covered in check-telegram-auth.sql.
create function pg_temp.link(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 return public._telegram_replies_activate(m,(b->>'bindingId')::uuid);end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

insert into auth.users(id,phone,phone_confirmed_at)values('d1300000-0000-4000-8000-000000000001','37499013001',now()),('d1300000-0000-4000-8000-000000000002',null,null);
insert into public.workspace_clinics(id,name)values('d1300000-0000-4000-8000-000000000004','Synthetic media clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1300000-0000-4000-8000-000000000002','doctor','Dr Media Synthetic','d1300000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1300000-0000-4000-8000-000000000005','d1300000-0000-4000-8000-000000000001',now(),now()),('d1300000-0000-4000-8000-000000000006','d1300000-0000-4000-8000-000000000002',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1300000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000002');
update public.profiles set locale='en'where id='d1300000-0000-4000-8000-000000000001';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_media',9003,600,'consent-m');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-media',3600,600,60,100,false,true);
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values('telegram.ack',2,'en','Synthetic acknowledgement. Call 103.',true,'test fixture');

-- Link the member (T-auth binding) and receive one text message.
select pg_temp.link('d1300000-0000-4000-8000-000000000001',8301);
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('200','text',8301,'{"text":"Synthetic first message"}'));
select pg_temp.drain();
reset role;

-- The doctor approves a reply; it is queued.
select pg_temp.as_staff('d1300000-0000-4000-8000-000000000002','d1300000-0000-4000-8000-000000000006');set local role authenticated;
insert into kv values('ws',public.conversation_workspace('d1300000-0000-4000-8000-000000000001'));
select public.conversation_compose('d1300000-0000-4000-8000-000000000001','d1300000-0000-4000-8000-000000000030',(v->>'version')::bigint,(v->>'clinicalRevision')::bigint,(v->>'draftEpoch')::bigint,v->>'sourceToken','Synthetic reply','Private summary')from kv where k='ws';
insert into kv values('actions',public.conversation_actions('d1300000-0000-4000-8000-000000000001'));
insert into kv select 'approved',public.conversation_command(jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(v#>'{view,actions}')x where x->>'purpose'='reply.approve'),'requestId','d1300000000040008000000000000031'))from kv where k='actions';
select pg_temp.ok(jsonb_array_length(public.conversation_awaiting_replies()->'items')=0,'Nothing waiting after approval');
reset role;
insert into kv select 'version-before',to_jsonb(version)from public.conversations where member_id='d1300000-0000-4000-8000-000000000001';

-- Two voice notes within one intake window, a redelivery, and one from an unlinked account.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('201','media',8301,'{}'))->>'status'='committed','Media event committed');
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('201','media',8301,'{}'))->>'status'='committed-duplicate','Media redelivery is a committed duplicate');
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('202','media',8301,'{"fileId":"x"}'))->>'code'='invalid_event','Media carries identifiers only');
select public.channel_inbox_commit(pg_temp.event('203','media',8301,'{}'));
select public.channel_inbox_commit(pg_temp.event('204','media',8399,'{}'));
select pg_temp.drain();
reset role;
select pg_temp.ok((select count(*)=2 from public.channel_inbox where kind='media'and result='media'and payload-array['chatId','messageId']='{}'),'Both linked media events processed without content');
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,204]')='principal_not_linked','Media from an unlinked account reaches no conversation');
select pg_temp.ok((select version=(select(v#>>'{}')::bigint+2 from kv where k='version-before')from public.conversations where member_id='d1300000-0000-4000-8000-000000000001'),'Each media message advances the conversation');
select pg_temp.ok((select state='held'and reason='member_sent_unsupported_media'from public.conversation_deliveries where id=(select(v->>'deliveryId')::uuid from kv where k='approved')),'Media holds the queued reply with its own reason');
select pg_temp.ok((select count(*)=1 from public.conversation_doctor_alerts a join public.channel_inbox i on i.id=a.inbox_id where i.kind='media'),'One doctor alert per intake window');
select pg_temp.ok((select count(*)=1 and min(template_id)='telegram.unsupported_media'and bool_and(body like '%103%')from public.system_messages s join public.channel_inbox i on i.id=s.source_inbox_id where i.kind='media'),'One text-only reply with Call 103 per intake window');
select pg_temp.ok(not exists(select 1 from public.conversation_messages where body like '%x%'and source='telegram_member'and body<>'Synthetic first message'),'No media content became a message');
-- The reply wording is UNAPPROVED and is held, never sent.
insert into kv select 'media-reply',to_jsonb(s.id)from public.system_messages s where template_id='telegram.unsupported_media';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.system_message_claim((v#>>'{}')::uuid,gen_random_uuid())->>'code'='template_unapproved','Unapproved text-only reply is held')from kv where k='media-reply';
reset role;
-- The doctor is told, in the list and on the conversation page.
select pg_temp.as_staff('d1300000-0000-4000-8000-000000000002','d1300000-0000-4000-8000-000000000006');set local role authenticated;
select pg_temp.ok(public.conversation_awaiting_replies()#>>'{items,0,reason}'='new_message'and public.conversation_awaiting_replies()#>>'{items,0,mediaPending}'='true','Doctor list shows the member with unreadable media');
select pg_temp.ok((public.conversation_workspace('d1300000-0000-4000-8000-000000000001')->>'unsupportedMedia')::boolean,'Conversation page is told about unreadable media');
reset role;
-- A member whose very first contact is a voice note is still on the doctor's list.
insert into auth.users(id,phone,phone_confirmed_at)values('d1300000-0000-4000-8000-000000000007','37499013007',now());
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1300000-0000-4000-8000-000000000008','d1300000-0000-4000-8000-000000000007',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1300000-0000-4000-8000-000000000007','d1300000-0000-4000-8000-000000000002');
-- Once its wording is approved for the member's language, the reply names the app's upload page; the source of the file is unchanged.
update public.system_message_templates set approved=true where template_id='telegram.media_to_app';
select pg_temp.link('d1300000-0000-4000-8000-000000000007',8302);
select pg_temp.as_service();set local role service_role;
select public.channel_inbox_commit(pg_temp.event('210','media',8302,'{}'));
select pg_temp.drain();
reset role;
select pg_temp.ok(not exists(select 1 from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='d1300000-0000-4000-8000-000000000007'),'Media-first member has no stored message');
select pg_temp.as_staff('d1300000-0000-4000-8000-000000000002','d1300000-0000-4000-8000-000000000006');set local role authenticated;
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.conversation_awaiting_replies()->'items')i where i->>'memberId'='d1300000-0000-4000-8000-000000000007'and(i->>'mediaPending')::boolean and i->>'lastMessageAt'is not null and i->>'channel'='telegram'),'Media-first member is listed for the doctor with a time and channel');
reset role;
select pg_temp.ok(not has_function_privilege('service_role','public._channel_inbox_receive_media(public.channel_inbox)','execute')and not has_function_privilege('authenticated','public._channel_inbox_receive_media(public.channel_inbox)','execute'),'Media handler is internal only');
select pg_temp.ok((select template_id='telegram.media_to_app'and body like '%103%'from public.system_messages where member_id='d1300000-0000-4000-8000-000000000007'),'Approved wording takes over the reply, and keeps 103');
select pg_temp.ok((select count(distinct locale)=2 from public.system_message_templates where template_id='telegram.media_to_app'),'The reply exists in both Telegram languages');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events e where e.member_id='d1300000-0000-4000-8000-000000000007'and e.name='auto_ack.decided'and e.outcome='queued'and e.rule_id='telegram.media_to_app')
 and not exists(select 1 from public.conversation_trace_events e where e.member_id='d1300000-0000-4000-8000-000000000007'and e.name='auto_ack.decided'and e.outcome='skipped'),'The trace records the reply that was queued, and no false skip');
\echo PASS telegram media: identifiers only, conversation advances, queued reply held, one alert and one held text-only reply per window, doctor told (rolled back)
rollback;
