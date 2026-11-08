-- T-auth PR A (members): Telegram as the sign-in code channel, rolled back.
-- Synthetic fixtures only; no Telegram, Supabase Auth API, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_member(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_auth",9004,"user",%s]',u)$$;
create function pg_temp.h(v text)returns text language sql as $$select encode(sha256(convert_to(v,'UTF8')),'hex')$$;
create function pg_temp.event(id text,kind text,u bigint,payload jsonb)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_auth",9004,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind',kind,'payload',payload||jsonb_build_object('chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.now_s()returns bigint language sql as $$select ceil(extract(epoch from clock_timestamp()))::bigint$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
-- One full contact proof from a Telegram account: /start <token>, then the own-contact share.
create function pg_temp.prove(token text,u bigint,phone text,ev integer)returns void language plpgsql as $$begin
 perform public.channel_inbox_commit(pg_temp.event(ev::text,'link',u,jsonb_build_object('tokenHash',pg_temp.h(token))));perform pg_temp.drain();
 perform public.channel_inbox_commit(pg_temp.event((ev+1)::text,'contact',u,jsonb_build_object('phone',phone,'sentAt',pg_temp.now_s())));perform pg_temp.drain();
end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;
create function pg_temp.kv(key text)returns jsonb language sql as $$select v from kv where k=key$$;

-- Fixtures: a member with a confirmed phone and clinical case, a doctor, a second member.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('d1400000-0000-4000-8000-000000000001','37499014001',now()),('d1400000-0000-4000-8000-000000000002',null,null),
 ('d1400000-0000-4000-8000-000000000003','37499014003',now());
insert into public.workspace_clinics(id,name)values('d1400000-0000-4000-8000-000000000004','Synthetic auth clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1400000-0000-4000-8000-000000000002','doctor','Dr Auth Synthetic','d1400000-0000-4000-8000-000000000004');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1400000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000002');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-auth',3600,600,60,100,false,true);

-- Privileges and dark launch -------------------------------------------------------------
select pg_temp.ok(not has_function_privilege('anon','public.auth_code_request_begin(text,text)','execute')and not has_function_privilege('authenticated','public.auth_code_request_claim(text,text,text)','execute')
 and not has_function_privilege('authenticated','public.telegram_auth_challenge_create(text,text,uuid,text,text,boolean)','execute')and not has_function_privilege('authenticated','public._telegram_revoke_binding(uuid,text)','execute')
 and not has_function_privilege('service_role','public._telegram_auth_bind(uuid,text,text,text,text,text,uuid,boolean)','execute')and has_function_privilege('authenticated','public.telegram_auth_unlink()','execute')
 and not has_function_privilege('anon','public.telegram_auth_unlink()','execute')and to_regprocedure('public.telegram_link_issue(text)')is null and to_regprocedure('public.telegram_link_redeem(text,text,bigint)')is null,
 'Service-only RPCs, member unlink only, T1 bearer link removed');
select pg_temp.ok(not has_table_privilege('authenticated','public.telegram_auth_bindings','select')and not has_table_privilege('service_role','public.auth_code_requests','select')and not has_table_privilege('anon','public.telegram_phone_proofs','select'),'No direct table access');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_challenge_create('member_link','+37499014001','d1400000-0000-4000-8000-000000000001',null,null)->>'code'='unavailable','Unconfigured channel refuses challenges');
reset role;
do $$begin perform set_config('request.jwt.claims','{"role":"anon"}',true);perform public.auth_code_request_begin('+37499014001',repeat('a',64));raise exception 'anon began';exception when insufficient_privilege then null;end$$;

insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_auth',9004,600,'consent-a');
-- Approved test copies so prompts can be claimed (production placeholders stay unapproved).
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values
 ('telegram.share_contact',9,'hy','Synthetic share prompt.',true,'test fixture'),('telegram.share_contact_label',9,'hy','Synthetic share',true,'test fixture'),
 ('telegram.contact_ok',9,'hy','Synthetic confirmed.',true,'test fixture');

-- Challenge validation -----------------------------------------------------------------------
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_challenge_create('member_link','+37499014001','d1400000-0000-4000-8000-000000000002',null,null)->>'code'='not_eligible','Phone must be the account''s phone');
select pg_temp.ok(public.telegram_auth_challenge_create('member_signin','+37499014001',null,null,null)->>'code'='invalid','Sign-in challenge needs a browser nonce');
select pg_temp.ok(public.telegram_auth_challenge_create('staff_invite','+37499014001',null,repeat('a',64),null)->>'code'='invalid','Unknown purpose refused');
select pg_temp.ok(public.telegram_auth_challenge_create('member_link','+37499014001','d1400000-0000-4000-8000-000000000001',null,'consent-old')->>'code'='consent_required','Stale consent refused');

-- Connect from the app (member_link with consent) ------------------------------------------
insert into kv values('link1',public.telegram_auth_challenge_create('member_link','+37499014001','d1400000-0000-4000-8000-000000000001',null,'consent-a'));
select public.channel_inbox_commit(pg_temp.event('100','link',7101,jsonb_build_object('tokenHash',pg_temp.h(pg_temp.kv('link1')->>'token'))));
select pg_temp.drain();
reset role;
select pg_temp.ok((select count(*)=1 from public.telegram_contact_requests where principal_ref=pg_temp.principal(7101)and state='open'),'Start opens one contact request');
select pg_temp.ok((select keyboard->>'kind'='request_contact'and template_id='telegram.share_contact'and address='7101'from public.telegram_auth_messages where principal_ref=pg_temp.principal(7101)),'Bot asks for the contact with a share button');
select pg_temp.as_service();set local role service_role;
-- A contact from another account, someone else's number, or none open: refused.
select public.channel_inbox_commit(pg_temp.event('101','contact',7199,jsonb_build_object('phone','+37499014001','sentAt',pg_temp.now_s())));
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('109','contact',7101,jsonb_build_object('phone','+37499014001','sentAt',pg_temp.now_s(),'name','x')))->>'code'='invalid_event','Contact carries only phone and time');
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('108','contact',7101,jsonb_build_object('phone','37499014001','sentAt',pg_temp.now_s())))->>'code'='invalid_event','Contact phone must be normalised');
select public.channel_inbox_commit(pg_temp.event('102','contact',7101,jsonb_build_object('phone','+37499014001','sentAt',pg_temp.now_s())));
select pg_temp.drain();
reset role;
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,101]')='principal_not_linked','Contact without an open request is an ordinary non-text message');
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,102]')='contact:linked','Own contact with the right number proves it and turns replies on');
select pg_temp.ok((select bool_and(not payload?'phone')from public.channel_inbox where kind='contact'and status='done'),'Processed contacts keep no phone');
select pg_temp.ok((select count(*)=1 from public.telegram_auth_bindings where auth_user_id='d1400000-0000-4000-8000-000000000001'and active and principal_ref=pg_temp.principal(7101)and address='7101'and generation=1),'Binding created');
select pg_temp.ok((select active and binding_id is not null from public.conversation_endpoints where member_id='d1400000-0000-4000-8000-000000000001'),'Consent given at Connect turns replies on');
select pg_temp.ok((select state='consumed'from public.telegram_auth_challenges where token_hash=pg_temp.h(pg_temp.kv('link1')->>'token')),'Challenge single use');
select pg_temp.as_member('d1400000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok(public.telegram_link_status()->>'connected'='true'and public.telegram_link_status()->>'linked'='true','Member sees connected and linked');
reset role;

-- Prompts: claim builds the keyboard; unapproved copy is held -------------------------------
insert into kv select 'prompt-id',to_jsonb(id)from public.telegram_auth_messages where principal_ref=pg_temp.principal(7101)and template_id='telegram.share_contact';
select pg_temp.as_service();set local role service_role;
insert into kv values('prompt',public.telegram_auth_message_claim((pg_temp.kv('prompt-id')#>>'{}')::uuid,'d1400000-0000-4000-8000-0000000000a1'));
select pg_temp.ok(pg_temp.kv('prompt')#>>'{envelope,keyboard,label}'='Synthetic share'and pg_temp.kv('prompt')#>>'{envelope,keyboard,kind}'='request_contact','Prompt carries the approved button label');
select pg_temp.ok(public.telegram_auth_message_outcome('d1400000-0000-4000-8000-0000000000a1','{"kind":"accepted","providerRef":"tg-1"}')->>'result'='recorded','Outcome recorded');
select pg_temp.ok(public.telegram_auth_message_outcome('d1400000-0000-4000-8000-0000000000a1','{"kind":"accepted","providerRef":"tg-1"}')->>'result'='duplicate','Same outcome is a duplicate');
reset role;

-- Code requests through the binding (R3, app-level) -----------------------------------------
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_claim('+37499014001','wh-0',repeat('b',64))->>'code'='no_request','No waiting request: no code is sent');
insert into kv values('r1',public.auth_code_request_begin('+37499014001',repeat('1',64)));
select pg_temp.ok(public.auth_code_request_begin('+37499014001',repeat('2',64))->>'code'='busy','A second request waits for the first lease');
insert into kv values('c1',public.auth_code_request_claim('+37499014001','wh-1',repeat('b',64)));
select pg_temp.ok(pg_temp.kv('c1')->>'route'='binding'and pg_temp.kv('c1')->>'address'='7101'and pg_temp.kv('c1')->>'requestId'=pg_temp.kv('r1')->>'requestId','Code goes to the bound Telegram account');
select pg_temp.ok(public.auth_code_request_claim('+37499014001','wh-1',repeat('b',64))->>'replay'='true','Webhook retry replays, never resends');
select pg_temp.ok(public.auth_code_request_claim('+37499014001','wh-1',repeat('c',64))->>'code'='conflict','Same webhook id with another body conflicts');
select pg_temp.ok(public.auth_code_request_claim('+37499014001','wh-2',repeat('b',64))->>'code'='no_request','A second hook call finds nothing to claim');
select pg_temp.ok(public.auth_code_request_finish((pg_temp.kv('r1')->>'requestId')::uuid,'wh-1','accepted',null)->>'code'='invalid','Accepted send must carry the code digest');
select pg_temp.ok(public.auth_code_request_finish((pg_temp.kv('r1')->>'requestId')::uuid,'wh-1','accepted',repeat('d',64))->>'updated'='true','Send recorded');
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('r1')->>'requestId')::uuid,repeat('2',64),repeat('d',64))->>'code'='unknown_request','Another browser cannot use the request');
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('r1')->>'requestId')::uuid,repeat('1',64),repeat('e',64))->>'code'='wrong_code','A code from another issuance is refused');
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('r1')->>'requestId')::uuid,repeat('1',64),repeat('d',64))->>'ok'='true','The delivered code checks out');
select pg_temp.ok(public.auth_code_request_verified((pg_temp.kv('r1')->>'requestId')::uuid,repeat('1',64),repeat('d',64),'d1400000-0000-4000-8000-000000000003','d1400000-0000-4000-8000-000000000012')->>'code'='user_mismatch','Session must belong to the phone''s user');
select pg_temp.ok(public.auth_code_request_verified((pg_temp.kv('r1')->>'requestId')::uuid,repeat('1',64),repeat('d',64),'d1400000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000012')->>'result'='signed_in','Verified');
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('r1')->>'requestId')::uuid,repeat('1',64),repeat('d',64))->>'code'='not_verifiable','A verified request cannot be reused');
-- An expired lease is never claimed; a failed send is not verifiable.
insert into kv values('r2',public.auth_code_request_begin('+37499014001',repeat('1',64)));
reset role;
update public.auth_code_requests set lease_until=clock_timestamp()-interval '1 second'where id=(pg_temp.kv('r2')->>'requestId')::uuid;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_claim('+37499014001','wh-3',repeat('b',64))->>'code'='no_request','Expired lease is not claimed');
insert into kv values('r3',public.auth_code_request_begin('+37499014001',repeat('1',64)));
reset role;
select pg_temp.ok((select state='unknown'from public.auth_code_requests where id=(pg_temp.kv('r2')->>'requestId')::uuid),'An expired issuing request is retired as unknown');
select pg_temp.as_service();set local role service_role;
select public.auth_code_request_claim('+37499014001','wh-4',repeat('b',64));
select public.auth_code_request_finish((pg_temp.kv('r3')->>'requestId')::uuid,'wh-4','failed',null);
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('r3')->>'requestId')::uuid,repeat('1',64),repeat('d',64))->>'code'='not_verifiable','A failed send is not verifiable');
reset role;

-- 30-day re-share -----------------------------------------------------------------------------
update public.telegram_auth_bindings set proven_at=clock_timestamp()-interval '31 days'where auth_user_id='d1400000-0000-4000-8000-000000000001';
select pg_temp.as_service();set local role service_role;
insert into kv values('r4',public.auth_code_request_begin('+37499014001',repeat('1',64)));
select pg_temp.ok(public.auth_code_request_claim('+37499014001','wh-5',repeat('b',64))->>'code'='reproof_required','A binding proven over 30 days ago needs a fresh share');
select pg_temp.ok(public.auth_code_request_status((pg_temp.kv('r4')->>'requestId')::uuid,repeat('1',64))->>'refusal'='reproof_required','Browser learns why');
-- Re-share from the same account refreshes the binding through a sign-in proof.
insert into kv values('s1',public.telegram_auth_challenge_create('member_signin','+37499014001',null,repeat('1',64),null));
select pg_temp.prove(pg_temp.kv('s1')->>'token',7101,'+37499014001',110);
insert into kv values('r5',public.auth_code_request_begin('+37499014001',repeat('1',64)));
insert into kv values('c5',public.auth_code_request_claim('+37499014001','wh-6',repeat('b',64)));
select pg_temp.ok(pg_temp.kv('c5')->>'route'='proof'and pg_temp.kv('c5')->>'address'='7101','Re-share routes through the fresh proof, same account');
select public.auth_code_request_finish((pg_temp.kv('r5')->>'requestId')::uuid,'wh-6','accepted',repeat('d',64));
select pg_temp.ok(public.auth_code_request_verified((pg_temp.kv('r5')->>'requestId')::uuid,repeat('1',64),repeat('d',64),'d1400000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000013')->>'binding'='refreshed','Verification refreshes the same binding');
reset role;
select pg_temp.ok((select proven_at>clock_timestamp()-interval '1 minute'and generation=1 from public.telegram_auth_bindings where auth_user_id='d1400000-0000-4000-8000-000000000001'and active),'Binding proven again, generation unchanged');

-- New member signs up: proof first, binding after verification --------------------------------
select pg_temp.as_service();set local role service_role;
insert into kv values('r6',public.auth_code_request_begin('+37499014005',repeat('5',64)));
select pg_temp.ok(public.auth_code_request_claim('+37499014005','wh-7',repeat('b',64))->>'code'='no_destination','Unknown phone without proof gets no code');
insert into kv values('s2',public.telegram_auth_challenge_create('member_signin','+37499014005',null,repeat('5',64),null));
-- A contact share with a different number is refused and consumes the challenge.
select public.channel_inbox_commit(pg_temp.event('120','link',7105,jsonb_build_object('tokenHash',pg_temp.h(pg_temp.kv('s2')->>'token'))));select pg_temp.drain();
select public.channel_inbox_commit(pg_temp.event('121','contact',7105,jsonb_build_object('phone','+37499014099','sentAt',pg_temp.now_s())));select pg_temp.drain();
reset role;
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,121]')='contact:refused'and(select refusal from public.telegram_contact_requests where principal_ref=pg_temp.principal(7105))='phone_mismatch','Another number is refused');
-- QA 284: only the exact challenge, phone and browser nonce reveal a fixed refusal code.
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_link_open('+37499014005',repeat('5',64),pg_temp.h(pg_temp.kv('s2')->>'token'))
 ='{"ok":true,"open":false,"contactRefusal":"phone_mismatch"}'::jsonb,'Own challenge returns only mismatch code, no phone or Telegram identity');
-- Multiple attempts on one challenge: the latest attempt wins, with no historical refusal after proof.
reset role;
insert into public.telegram_contact_requests(id,challenge_id,principal_ref,address,state,refusal,requested_at,expires_at)
 select 'd1400000-0000-4000-8000-000000000099',id,pg_temp.principal(7105),'7105','refused','stale',clock_timestamp()+interval '1 second',expires_at
 from public.telegram_auth_challenges where token_hash=pg_temp.h(pg_temp.kv('s2')->>'token');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_link_open('+37499014005',repeat('5',64),pg_temp.h(pg_temp.kv('s2')->>'token'))
 ='{"ok":true,"open":false,"contactRefusal":"stale"}'::jsonb,'Latest attempt on this challenge wins');
reset role;
update public.telegram_contact_requests set state='proven'where id='d1400000-0000-4000-8000-000000000099';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_link_open('+37499014005',repeat('5',64),pg_temp.h(pg_temp.kv('s2')->>'token'))
 ='{"ok":true,"open":false}'::jsonb,'Latest proven attempt does not expose an older refusal');
reset role;
delete from public.telegram_contact_requests where id='d1400000-0000-4000-8000-000000000099';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_link_open('+37499014005',repeat('6',64),pg_temp.h(pg_temp.kv('s2')->>'token'))
 ='{"ok":true,"open":false}'::jsonb,'Another browser cannot read the refusal');
select pg_temp.ok(public.auth_code_request_link_open('+37499014099',repeat('5',64),pg_temp.h(pg_temp.kv('s2')->>'token'))
 ='{"ok":true,"open":false}'::jsonb,'Another typed phone cannot read the refusal');
select pg_temp.ok(public.auth_code_request_link_open('+37499014005',repeat('5',64),repeat('0',64))
 ='{"ok":true,"open":false}'::jsonb,'Unknown challenge reveals nothing');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.auth_code_request_link_open(text,text,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.auth_code_request_link_open(text,text,text)','EXECUTE'),'Contact refusal RPC stays service-only');
-- A stale share (sent before the request) is refused.
select pg_temp.as_service();set local role service_role;
insert into kv values('s3',public.telegram_auth_challenge_create('member_signin','+37499014005',null,repeat('5',64),null));
select pg_temp.ok(public.auth_code_request_link_open('+37499014005',repeat('5',64),pg_temp.h(pg_temp.kv('s3')->>'token'))
 ='{"ok":true,"open":true}'::jsonb,'New challenge in same browser does not inherit an older refusal');
select public.channel_inbox_commit(pg_temp.event('122','link',7105,jsonb_build_object('tokenHash',pg_temp.h(pg_temp.kv('s3')->>'token'))));select pg_temp.drain();
select public.channel_inbox_commit(pg_temp.event('123','contact',7105,jsonb_build_object('phone','+37499014005','sentAt',pg_temp.now_s()-120)));select pg_temp.drain();
reset role;
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,123]')='contact:refused','A share sent before the request is refused');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_link_open('+37499014005',repeat('5',64),pg_temp.h(pg_temp.kv('s3')->>'token'))
 ='{"ok":true,"open":false,"contactRefusal":"stale"}'::jsonb,'Stale share has its own fixed code');
reset role;

select pg_temp.as_service();set local role service_role;
insert into kv values('s4',public.telegram_auth_challenge_create('member_signin','+37499014005',null,repeat('5',64),null));
select pg_temp.prove(pg_temp.kv('s4')->>'token',7105,'+37499014005',124);
reset role;
select pg_temp.ok((select count(*)=1 from public.telegram_phone_proofs where phone='+37499014005'and principal_ref=pg_temp.principal(7105)and consumed_at is null),'Proof recorded');
-- Supabase creates the Auth user when the code is requested.
insert into auth.users(id,phone)values('d1400000-0000-4000-8000-000000000005','37499014005');
select pg_temp.as_service();set local role service_role;
-- Another browser (other nonce) cannot ride this proof.
insert into kv values('r7',public.auth_code_request_begin('+37499014005',repeat('6',64)));
select pg_temp.ok(public.auth_code_request_claim('+37499014005','wh-8',repeat('b',64))->>'code'='no_destination','A proof serves only the browser that made it');
insert into kv values('r8',public.auth_code_request_begin('+37499014005',repeat('5',64)));
select pg_temp.ok(public.auth_code_request_claim('+37499014005','wh-9',repeat('b',64))->>'route'='proof','Code goes to the freshly proven account');
select public.auth_code_request_finish((pg_temp.kv('r8')->>'requestId')::uuid,'wh-9','accepted',repeat('f',64));
select pg_temp.ok(public.auth_code_request_verified((pg_temp.kv('r8')->>'requestId')::uuid,repeat('5',64),repeat('f',64),'d1400000-0000-4000-8000-000000000005','d1400000-0000-4000-8000-000000000015')->>'binding'='bound','First verification binds the account');
reset role;
select pg_temp.ok((select count(*)=1 from public.telegram_auth_bindings where auth_user_id='d1400000-0000-4000-8000-000000000005'and active and principal_ref=pg_temp.principal(7105)),'New member bound');
select pg_temp.ok((select consumed_at is not null from public.telegram_phone_proofs where phone='+37499014005'and principal_ref=pg_temp.principal(7105)and consumed_at is not null),'Proof consumed');

-- One Telegram account per member: 7105 cannot become another member's channel -------------
select pg_temp.as_service();set local role service_role;
insert into kv values('s5',public.telegram_auth_challenge_create('member_link','+37499014003','d1400000-0000-4000-8000-000000000003',null,null));
select public.channel_inbox_commit(pg_temp.event('130','link',7105,jsonb_build_object('tokenHash',pg_temp.h(pg_temp.kv('s5')->>'token'))));select pg_temp.drain();
select public.channel_inbox_commit(pg_temp.event('131','contact',7105,jsonb_build_object('phone','+37499014003','sentAt',pg_temp.now_s())));select pg_temp.drain();
reset role;
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,131]')='contact:principal_bound_elsewhere','A bound Telegram account cannot serve a second member');

-- Replacement after losing the old account (C4): new account proves, verifies, all sessions end
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1400000-0000-4000-8000-000000000016','d1400000-0000-4000-8000-000000000005',now(),now());
update auth.users set confirmation_token='synthetic-pending'where id='d1400000-0000-4000-8000-000000000005';
select pg_temp.as_service();set local role service_role;
insert into kv values('s6',public.telegram_auth_challenge_create('member_signin','+37499014005',null,repeat('7',64),null));
select pg_temp.prove(pg_temp.kv('s6')->>'token',7106,'+37499014005',140);
insert into kv values('r9',public.auth_code_request_begin('+37499014005',repeat('7',64)));
select pg_temp.ok(public.auth_code_request_claim('+37499014005','wh-10',repeat('b',64))->>'address'='7106','The browser that proved a new account gets the code there');
select public.auth_code_request_finish((pg_temp.kv('r9')->>'requestId')::uuid,'wh-10','accepted',repeat('a',64));
select pg_temp.ok(public.auth_code_request_verified((pg_temp.kv('r9')->>'requestId')::uuid,repeat('7',64),repeat('a',64),'d1400000-0000-4000-8000-000000000005','d1400000-0000-4000-8000-000000000017')->>'result'='sign_in_again','Replacement asks for a fresh sign-in');
reset role;
select pg_temp.ok((select principal_ref=pg_temp.principal(7106)and generation=2 from public.telegram_auth_bindings where auth_user_id='d1400000-0000-4000-8000-000000000005'and active),'New account bound with the next generation');
select pg_temp.ok((select revoked_reason='replaced'from public.telegram_auth_bindings where principal_ref=pg_temp.principal(7105)),'Old binding revoked');
select pg_temp.ok(not exists(select 1 from auth.sessions where user_id='d1400000-0000-4000-8000-000000000005'),'Every session ended, including the new one');
select pg_temp.ok((select confirmation_token=''from auth.users where id='d1400000-0000-4000-8000-000000000005'),'Outstanding Supabase code cancelled');
select pg_temp.ok((select count(*)=2 from public.auth_cleanup_jobs where auth_user_id='d1400000-0000-4000-8000-000000000005'),'Two cleanup sweeps scheduled');
insert into kv select 'notice-id',to_jsonb(id)from public.telegram_auth_messages where template_id='telegram.binding_replaced'and address='7105';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_message_claim((pg_temp.kv('notice-id')#>>'{}')::uuid,'d1400000-0000-4000-8000-0000000000a2')->>'code'='template_unapproved','Old chat notice queued and held until its wording is approved');
reset role;

-- Member removes their Telegram account (R2) --------------------------------------------------
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1400000-0000-4000-8000-000000000018','d1400000-0000-4000-8000-000000000001',now(),now());
update auth.users set confirmation_token='synthetic-pending',recovery_token='synthetic-r'where id='d1400000-0000-4000-8000-000000000001';
insert into auth.one_time_tokens(id,user_id,token_type,token_hash,relates_to)values(gen_random_uuid(),'d1400000-0000-4000-8000-000000000001','confirmation_token','synthetic-hash','37499014001');
select pg_temp.as_member('d1400000-0000-4000-8000-000000000001','d1400000-0000-4000-8000-000000000018');set local role authenticated;
select pg_temp.ok(public.telegram_auth_unlink()->>'unlinked'='true','Member removes the account');
select pg_temp.ok(public.telegram_auth_unlink()->>'unlinked'='false','Second removal is a no-op');
reset role;
select pg_temp.ok(not exists(select 1 from public.telegram_auth_bindings where auth_user_id='d1400000-0000-4000-8000-000000000001'and active),'Binding revoked');
select pg_temp.ok(not exists(select 1 from public.conversation_endpoints where member_id='d1400000-0000-4000-8000-000000000001'and active),'Replies stop');
select pg_temp.ok(not exists(select 1 from auth.sessions where user_id='d1400000-0000-4000-8000-000000000001'),'Sessions ended');
select pg_temp.ok((select confirmation_token=''and recovery_token=''from auth.users where id='d1400000-0000-4000-8000-000000000001')and not exists(select 1 from auth.one_time_tokens where user_id='d1400000-0000-4000-8000-000000000001'),'Codes cancelled');
select pg_temp.ok(not exists(select 1 from public.auth_code_requests where phone='+37499014001'and state in('issuing','sending','sent')),'Code requests cancelled');
select pg_temp.as_service();set local role service_role;
insert into kv values('r10',public.auth_code_request_begin('+37499014001',repeat('1',64)));
select pg_temp.ok(public.auth_code_request_claim('+37499014001','wh-11',repeat('b',64))->>'code'='no_destination','After removal the next sign-in needs a new proof');
reset role;

-- Cleanup sweep: sessions created after revocation are removed when due -----------------------
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1400000-0000-4000-8000-000000000019','d1400000-0000-4000-8000-000000000001',now(),now());
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.auth_cleanup_run()->>'deleted')::int=0,'Nothing runs before the due time');
reset role;
update public.auth_cleanup_jobs set due_at=clock_timestamp()-interval '1 second'where auth_user_id='d1400000-0000-4000-8000-000000000001';
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.auth_cleanup_run()->>'deleted')::int>=1,'Due sweep deletes the late session');
reset role;
select pg_temp.ok(not exists(select 1 from auth.sessions where user_id='d1400000-0000-4000-8000-000000000001')and not exists(select 1 from public.auth_cleanup_jobs where auth_user_id='d1400000-0000-4000-8000-000000000001'and state='due'),'Jobs done');

-- Staff never get a member binding --------------------------------------------------------------
insert into auth.users(id,phone,phone_confirmed_at)values('d1400000-0000-4000-8000-000000000006','37499014006',now());
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1400000-0000-4000-8000-000000000006','nurse','Nurse Synthetic','d1400000-0000-4000-8000-000000000004');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.telegram_auth_challenge_create('member_link','+37499014006','d1400000-0000-4000-8000-000000000006',null,null)->>'code'='not_eligible','Staff cannot connect a member Telegram account');
reset role;

-- Review fixes (Opus fallback review, 16 Oct) ------------------------------------------------
-- A legitimate sign-in after a replacement survives the cleanup sweeps; a stray session does not.
select pg_temp.as_service();set local role service_role;
insert into kv values('r20',public.auth_code_request_begin('+37499014005',repeat('7',64)));
select pg_temp.ok(public.auth_code_request_claim('+37499014005','wh-20',repeat('b',64))->>'route'='binding','Sign-in again goes to the new binding');
select public.auth_code_request_finish((pg_temp.kv('r20')->>'requestId')::uuid,'wh-20','accepted',repeat('a',64));
select pg_temp.ok(public.auth_code_request_verified((pg_temp.kv('r20')->>'requestId')::uuid,repeat('7',64),repeat('a',64),'d1400000-0000-4000-8000-000000000005','d1400000-0000-4000-8000-000000000020')->>'result'='signed_in','Signed in again');
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1400000-0000-4000-8000-000000000020','d1400000-0000-4000-8000-000000000005',now(),now()),('d1400000-0000-4000-8000-000000000021','d1400000-0000-4000-8000-000000000005',now(),now());
update public.auth_cleanup_jobs set due_at=clock_timestamp()-interval '1 second'where auth_user_id='d1400000-0000-4000-8000-000000000005';
select pg_temp.as_service();set local role service_role;select public.auth_cleanup_run();reset role;
select pg_temp.ok(exists(select 1 from auth.sessions where id='d1400000-0000-4000-8000-000000000020')and not exists(select 1 from auth.sessions where id='d1400000-0000-4000-8000-000000000021'),'Recorded post-revocation session kept; unrecorded one removed');

-- Connect while Telegram codes are off binds but never replaces.
select pg_temp.as_service();set local role service_role;
insert into kv values('xc1',public.telegram_auth_challenge_create('member_link','+37499014003','d1400000-0000-4000-8000-000000000003',null,null,false));
select pg_temp.prove(pg_temp.kv('xc1')->>'token',7107,'+37499014003',150);
insert into kv values('xc2',public.telegram_auth_challenge_create('member_link','+37499014003','d1400000-0000-4000-8000-000000000003',null,null,false));
select pg_temp.prove(pg_temp.kv('xc2')->>'token',7108,'+37499014003',152);
reset role;
select pg_temp.ok((select result from public.channel_inbox where event_id like '%,153]')='contact:principal_changed','Replacement refused while codes are off');
select pg_temp.ok((select principal_ref=pg_temp.principal(7107)from public.telegram_auth_bindings where auth_user_id='d1400000-0000-4000-8000-000000000003'and active),'First binding kept');

-- Someone else's contact card is refused and consumes the request; no number is stored.
select pg_temp.as_service();set local role service_role;
insert into kv values('xc3',public.telegram_auth_challenge_create('member_signin','+37499014003',null,repeat('8',64),null));
select public.channel_inbox_commit(pg_temp.event('154','link',7109,jsonb_build_object('tokenHash',pg_temp.h(pg_temp.kv('xc3')->>'token'))));select pg_temp.drain();
select pg_temp.ok(public.channel_inbox_commit(pg_temp.event('156','contact',7109,jsonb_build_object('foreign',true,'phone','+37499014003','sentAt',pg_temp.now_s())))->>'code'='invalid_event','A foreign card carries no number');
select public.channel_inbox_commit(pg_temp.event('155','contact',7109,jsonb_build_object('foreign',true,'sentAt',pg_temp.now_s())));select pg_temp.drain();
reset role;
select pg_temp.ok((select refusal='not_own_contact'from public.telegram_contact_requests where principal_ref=pg_temp.principal(7109))
 and(select state='consumed'from public.telegram_auth_challenges where token_hash=pg_temp.h(pg_temp.kv('xc3')->>'token')),'Foreign card refused; challenge consumed');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_link_open('+37499014003',repeat('8',64),pg_temp.h(pg_temp.kv('xc3')->>'token'))
 ='{"ok":true,"open":false,"contactRefusal":"not_own_contact"}'::jsonb,'Foreign card reports only not_own_contact');
reset role;


-- Another browser's request never cancels a member's sent code; wrong codes are bounded.
select pg_temp.as_service();set local role service_role;
insert into kv values('g1',public.auth_code_request_begin('+37499014003',repeat('8',64)));
select public.auth_code_request_claim('+37499014003','wh-30',repeat('b',64));
select public.auth_code_request_finish((pg_temp.kv('g1')->>'requestId')::uuid,'wh-30','accepted',repeat('d',64));
insert into kv values('g2',public.auth_code_request_begin('+37499014003',repeat('9',64)));
select pg_temp.ok(public.auth_code_request_status((pg_temp.kv('g1')->>'requestId')::uuid,repeat('8',64))->>'state'='sent','A stranger''s request leaves the member''s sent code alone');
select pg_temp.ok(public.auth_code_request_abandon((pg_temp.kv('g2')->>'requestId')::uuid,repeat('9',64))->>'updated'='true','Unconfirmed issuance abandoned at once');
select pg_temp.ok(public.auth_code_request_status((pg_temp.kv('g2')->>'requestId')::uuid,repeat('9',64))->>'state'='unknown','Abandoned request is not verifiable');
insert into kv values('g2b',public.auth_code_request_begin('+37499014003',repeat('9',64)));
select pg_temp.ok(pg_temp.kv('g2b')->>'ok'='true','Abandon releases the lease');
select public.auth_code_request_abandon((pg_temp.kv('g2b')->>'requestId')::uuid,repeat('9',64));
select pg_temp.ok(bool_and(public.auth_code_request_check((pg_temp.kv('g1')->>'requestId')::uuid,repeat('8',64),repeat(c,64))->>'code'='wrong_code'),'Four wrong codes refused')from unnest(array['1','2','3','4'])c;
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('g1')->>'requestId')::uuid,repeat('8',64),repeat('5',64))->>'code'='too_many_attempts','Fifth wrong code ends the request');
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('g1')->>'requestId')::uuid,repeat('8',64),repeat('d',64))->>'code'='not_verifiable','The right code no longer works after five wrong ones');
reset role;
update public.auth_code_requests set failed_checks=5,last_failed_at=clock_timestamp()where id=(pg_temp.kv('g2')->>'requestId')::uuid;
select pg_temp.as_service();set local role service_role;
insert into kv values('g3',public.auth_code_request_begin('+37499014003',repeat('6',64)));
select public.auth_code_request_claim('+37499014003','wh-31',repeat('b',64));
select public.auth_code_request_finish((pg_temp.kv('g3')->>'requestId')::uuid,'wh-31','accepted',repeat('e',64));
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('g3')->>'requestId')::uuid,repeat('6',64),repeat('f',64))->>'code'='too_many_attempts','Past ten wrong codes per phone per hour, one wrong code ends the request');
reset role;
update public.auth_code_requests set state='sent',failed_checks=0,last_failed_at=null where id=(pg_temp.kv('g3')->>'requestId')::uuid;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_check((pg_temp.kv('g3')->>'requestId')::uuid,repeat('6',64),repeat('e',64))->>'ok'='true','A request with no wrong guesses still accepts the right code: strangers cannot lock the member out');
-- Proof links: only a recent request that reached the hook, twice at most.
select pg_temp.ok(public.auth_code_request_allow_proof((pg_temp.kv('g3')->>'requestId')::uuid,repeat('6',64))->>'ok'='true'
 and public.auth_code_request_allow_proof((pg_temp.kv('g3')->>'requestId')::uuid,repeat('6',64))->>'ok'='true'
 and public.auth_code_request_allow_proof((pg_temp.kv('g3')->>'requestId')::uuid,repeat('6',64))->>'ok'='false','Two proof links per request');
select pg_temp.ok(public.auth_code_request_allow_proof((pg_temp.kv('g2')->>'requestId')::uuid,repeat('9',64))->>'ok'='false','A request that never reached the hook opens no proof link');
reset role;
update public.auth_code_requests set created_at=clock_timestamp()-interval '11 minutes',proof_links=0 where id=(pg_temp.kv('g3')->>'requestId')::uuid;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(public.auth_code_request_allow_proof((pg_temp.kv('g3')->>'requestId')::uuid,repeat('6',64))->>'ok'='false','An old request opens no proof link');
-- A retried verification after a lost response gets the stored answer.
select pg_temp.ok(public.auth_code_request_verified((pg_temp.kv('r20')->>'requestId')::uuid,repeat('7',64),repeat('a',64),'d1400000-0000-4000-8000-000000000005','d1400000-0000-4000-8000-000000000020')->>'result'='signed_in','Verification is idempotent for the same session');
reset role;

-- A dead contact row keeps no phone.
insert into public.channel_inbox(adapter,event_id,fingerprint,principal_ref,kind,payload,status,attempts,lease_until)
 values('telegram','["telegram","noreon_auth",9004,"update",160]','fp-160',pg_temp.principal(7110),'contact','{"phone":"+37499014010","sentAt":1,"chatId":7110,"messageId":160}','processing',5,clock_timestamp()-interval '1 minute');
select pg_temp.as_service();set local role service_role;select public.channel_inbox_next(1);reset role;
select pg_temp.ok((select status='dead'and not payload?'phone'from public.channel_inbox where event_id like '%,160]'),'Poisoned contact row scrubbed when it dies');

rollback;
\echo 'check-telegram-auth: ok'
