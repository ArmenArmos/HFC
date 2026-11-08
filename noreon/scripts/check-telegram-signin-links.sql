-- One-tap sign-in links from the bot: created with a member's next step, armed at send, redeemed once
-- by one browser, never for staff or clinic accounts, rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_stl",9008,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_stl",9008,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.say(id text,u bigint)returns void language plpgsql as $$declare i jsonb;begin
 perform pg_temp.as_service();
 perform public.channel_inbox_commit(pg_temp.event(id,u,'hello'));
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.bind(m uuid,u bigint,k text default 'member')returns jsonb language sql as $$
 select public._telegram_auth_bind(m,k,pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null)$$;
-- The newest link of a chat; its outbox message; a fresh hourly window for the next-step reply.
create function pg_temp.link(u bigint)returns public.telegram_signin_links language sql as $$select * from public.telegram_signin_links where principal_ref=pg_temp.principal(u)order by created_at desc limit 1$$;
create function pg_temp.next_hour(u bigint)returns void language sql as $$update public.telegram_auth_messages set created_at=created_at-interval '61 minutes'where principal_ref=pg_temp.principal(u)$$;
create function pg_temp.h(t text)returns text language sql as $$select encode(extensions.digest(t,'sha256'),'hex')$$;
-- Begin as a browser with nobody signed in (the server passes the signed-in member, if any).
create function pg_temp.begin(h text,nonce text)returns jsonb language sql as $$select public.telegram_signin_link_begin(h,nonce,null,false)$$;
-- Supabase asks for a code, the hook claims and seals it, Auth accepts: what Continue does up to reading the code.
create function pg_temp.sign_in(tok text,nonce text,wh text)returns jsonb language plpgsql as $$declare b jsonb;c jsonb;begin
 b:=pg_temp.begin(pg_temp.h(tok),nonce);
 if b->>'ok'<>'true'then return b;end if;
 c:=public.auth_code_request_claim(b->>'phone',wh,repeat('b',64));
 if c->>'route'is distinct from 'link'then raise exception 'FAIL: hook route %',c;end if;
 perform public.auth_code_request_seal((b->>'requestId')::uuid,wh,'sealed-'||wh);
 perform public.auth_code_request_finish((b->>'requestId')::uuid,wh,'accepted',repeat('d',64));
 return b;end$$;
create temp table kv(k text primary key,v jsonb);

-- Fixtures: member M (profile, consent, questionnaire done; no review request), clinic user C, staff-member S.
insert into auth.users(id,phone,phone_confirmed_at)values('d3000000-0000-4000-8000-000000000001','37499030001',now()),('d3000000-0000-4000-8000-000000000002','37499030002',now()),('d3000000-0000-4000-8000-000000000003','37499030003',now());
update public.profiles set display_name='Synthetic member',birth_date='1980-01-01',biological_sex='female',locale='en'where id in('d3000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000003');
insert into public.patient_consents(user_id,version)select id,'patient-pilot-v1'from auth.users where id::text like 'd3000000-%';
insert into public.patient_assessments(user_id,revision,completed_at)select id,2,now()from auth.users where id::text like 'd3000000-%';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_stl',9008,600,'consent-s');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok(not has_function_privilege('authenticated','public.telegram_signin_link_begin(text,text,uuid,boolean)','execute')and not has_function_privilege('authenticated','public.telegram_signin_links_cancel(uuid)','execute')and not has_function_privilege('anon','public.telegram_signin_link_code(uuid,text)','execute'),'Link functions are service-only');
reset role;

-- 1. The member's next step carries a pending link; sending arms it (only the hash is stored).
select pg_temp.bind('d3000000-0000-4000-8000-000000000001',8401);
select pg_temp.say('9401',8401);
select pg_temp.ok((pg_temp.link(8401)).state='pending'and(pg_temp.link(8401)).step='next_review'and(pg_temp.link(8401)).token_hash is null,'Pending link with the next-step message');
select pg_temp.ok(pg_temp.begin(pg_temp.h('never-armed'),repeat('1',64))->>'code'='expired'and pg_temp.begin(pg_temp.h('never-armed'),repeat('1',64))->>'step'is null,'Unknown token: expired, no step');
update public.system_message_templates set approved=false where template_id='member_notice.open_label';
select pg_temp.ok(public.telegram_signin_link_arm((pg_temp.link(8401)).message_id,pg_temp.h('tok-x'))->>'code'='none'and(pg_temp.link(8401)).state='cancelled'and(pg_temp.link(8401)).token_hash is null,'No approved button label: not armed, cancelled');
delete from public.telegram_signin_links where id=(pg_temp.link(8401)).id;
update public.system_message_templates set approved=true,approval_note='test fixture'where template_id='member_notice.open_label'and locale='en';
select pg_temp.next_hour(8401);select pg_temp.say('9400',8401);
insert into kv values('a1',public.telegram_signin_link_arm((pg_temp.link(8401)).message_id,pg_temp.h('tok-a')));
select pg_temp.ok((select v->>'ok'='true'and v->>'label'='Open Noreon'from kv where k='a1'),'Armed at send, with the approved button label');
select pg_temp.ok(public.telegram_signin_link_arm((pg_temp.link(8401)).message_id,pg_temp.h('tok-a2'))->>'code'='none','Armed once (a resend cannot re-arm)');
select pg_temp.ok((select expires_at between clock_timestamp()+interval '23 hours 59 minutes' and clock_timestamp()+interval '24 hours' from pg_temp.link(8401)),'Valid 24 hours from send');

-- 2. Continue: the hook seals the code instead of sending; the server reads it once; verify; used.
insert into kv values('b1',pg_temp.sign_in('tok-a',repeat('1',64),'wh-l1'));
select pg_temp.ok((select v->>'phone'='+37499030001'and v->>'step'='next_review'from kv where k='b1'),'Begins a sign-in for the bound member');
select pg_temp.ok((select address is null and binding_id is null and state='sent'from public.auth_code_requests where id=(select (v->>'requestId')::uuid from kv where k='b1')),'No delivery address: the code went nowhere');
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-a'),repeat('2',64))->>'code'='expired','Forwarded link opened in another browser mid-redeem: expired');
select pg_temp.ok(public.telegram_signin_link_code((select (v->>'requestId')::uuid from kv where k='b1'),repeat('2',64))->>'code'='expired','Another browser cannot read the code');
select pg_temp.ok(public.telegram_signin_link_code((select (v->>'requestId')::uuid from kv where k='b1'),repeat('1',64))->>'sealed'='sealed-wh-l1','This browser reads the sealed code');
select pg_temp.ok(public.telegram_signin_link_code((select (v->>'requestId')::uuid from kv where k='b1'),repeat('1',64))->>'code'='expired','Only once');
select pg_temp.ok(public.auth_code_request_check((select (v->>'requestId')::uuid from kv where k='b1'),repeat('1',64),repeat('d',64))->>'ok'='true','Checked like a typed code');
select pg_temp.ok(public.auth_code_request_verified((select (v->>'requestId')::uuid from kv where k='b1'),repeat('1',64),repeat('d',64),'d3000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000011')->>'result'='signed_in','Verified');
select pg_temp.ok(public.telegram_signin_link_finish((select (v->>'requestId')::uuid from kv where k='b1'),repeat('1',64))->>'step'='next_review','Finished');
select pg_temp.ok((pg_temp.link(8401)).state='used','Link used');
-- Astra A4-2 (20 Oct audit): a retry of a finished link replays.
select pg_temp.ok(public.telegram_signin_link_finish((select (v->>'requestId')::uuid from kv where k='b1'),repeat('1',64))->>'ok'='true','A retry of a finished link replays');

-- 3. Replay: the same link again, from either browser, is expired.
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-a'),repeat('1',64))->>'code'='expired'and pg_temp.begin(pg_temp.h('tok-a'),repeat('1',64))->>'step'='next_review','Replay from the same browser: expired, with the step to continue to after sign-in');
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-a'),repeat('3',64))->>'code'='expired','Replay from a forwarded copy: expired');

-- 4. Expiry: 24 hours after send (still good just before).
select pg_temp.next_hour(8401);select pg_temp.say('9402',8401);
select public.telegram_signin_link_arm((pg_temp.link(8401)).message_id,pg_temp.h('tok-b'));
update public.telegram_signin_links set armed_at=armed_at-interval '23 hours 59 minutes',expires_at=expires_at-interval '23 hours 59 minutes'where id=(pg_temp.link(8401)).id;
select pg_temp.ok((pg_temp.link(8401)).expires_at>clock_timestamp(),'Still valid after 23 hours 59 minutes');
update public.telegram_signin_links set armed_at=armed_at-interval '2 minutes',expires_at=expires_at-interval '2 minutes'where id=(pg_temp.link(8401)).id;
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-b'),repeat('1',64))->>'code'='expired'and(pg_temp.link(8401)).state='expired','Expired link refused and marked');
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-b'),repeat('1',64))->>'step'='next_review','Expired: the step is returned so sign-in continues there');

-- 5. A retry from the same browser may continue (lost response); a lapsed hook claim is refused.
select pg_temp.next_hour(8401);select pg_temp.say('9403',8401);
select public.telegram_signin_link_arm((pg_temp.link(8401)).message_id,pg_temp.h('tok-c'));
insert into kv values('b3',pg_temp.begin(pg_temp.h('tok-c'),repeat('4',64)));
update public.auth_code_requests set lease_until=clock_timestamp()-interval '1 second'where id=(select (v->>'requestId')::uuid from kv where k='b3');
insert into kv values('b3r',pg_temp.begin(pg_temp.h('tok-c'),repeat('4',64)));
select pg_temp.ok((select v->>'ok'='true'from kv where k='b3r')and(select state='cancelled'from public.auth_code_requests where id=(select (v->>'requestId')::uuid from kv where k='b3')),'Same browser retries; the earlier request is cancelled');
update public.telegram_signin_links set state='expired'where id=(pg_temp.link(8401)).id;
select pg_temp.ok(public.auth_code_request_claim('+37499030001','wh-l3',repeat('b',64))->>'code'='link_unavailable','Hook refuses a request whose link is no longer redeeming');

-- 6. Revoked binding (chat replaced or unlinked): an armed link no longer signs in.
select pg_temp.next_hour(8401);select pg_temp.say('9404',8401);
select public.telegram_signin_link_arm((pg_temp.link(8401)).message_id,pg_temp.h('tok-d'));
select public._telegram_revoke_binding((pg_temp.link(8401)).binding_id,'synthetic');
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-d'),repeat('1',64))->>'code'='expired'and(pg_temp.link(8401)).state='cancelled','Revoked binding: refused and cancelled');

-- 6b. Binding revoked before the send: arming cancels the pending link (no token, no expiry).
select pg_temp.bind('d3000000-0000-4000-8000-000000000001',8405);
select pg_temp.say('9411',8405);
select public._telegram_revoke_binding((pg_temp.link(8405)).binding_id,'synthetic');
select pg_temp.ok(public.telegram_signin_link_arm((pg_temp.link(8405)).message_id,pg_temp.h('tok-f'))->>'code'='none'and(pg_temp.link(8405)).state='cancelled','Arm after revoke: cancelled');
delete from public.telegram_signin_links where principal_ref=pg_temp.principal(8405);

-- 6c. A sealed code never outlives its request: dropped on abandon or any state other than sending/sent.
select pg_temp.bind('d3000000-0000-4000-8000-000000000001',8406);
select pg_temp.say('9412',8406);
select public.telegram_signin_link_arm((pg_temp.link(8406)).message_id,pg_temp.h('tok-g'));
update public.auth_code_requests set lease_until=clock_timestamp()-interval '1 second'where phone='+37499030001'and state='issuing';
insert into kv values('b6',pg_temp.sign_in('tok-g',repeat('6',64),'wh-l6'));
select pg_temp.ok((select code_sealed is not null from public.auth_code_requests where id=(select (v->>'requestId')::uuid from kv where k='b6')),'Sealed while unread');
select public.auth_code_request_abandon((select (v->>'requestId')::uuid from kv where k='b6'),repeat('6',64));
select pg_temp.ok((select code_sealed is null from public.auth_code_requests where id=(select (v->>'requestId')::uuid from kv where k='b6')),'Abandon drops the sealed code');
delete from public.telegram_signin_links where principal_ref=pg_temp.principal(8406);

-- 7. Staff and clinic accounts: no link is made, and an existing link stops working once the role appears.
select pg_temp.bind('d3000000-0000-4000-8000-000000000002',8402);
select pg_temp.say('9405',8402);
select public.telegram_signin_link_arm((pg_temp.link(8402)).message_id,pg_temp.h('tok-e'));
insert into public.workspace_clinics(id,name)values('d3000000-0000-4000-8000-000000000009','Synthetic link clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d3000000-0000-4000-8000-000000000002','nurse','Nurse Link Synthetic','d3000000-0000-4000-8000-000000000009');
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-e'),repeat('1',64))->>'code'='expired'and(pg_temp.link(8402)).state='cancelled','Became staff: link refused');
select pg_temp.next_hour(8402);select pg_temp.say('9406',8402);
select pg_temp.ok((select count(*)from public.telegram_signin_links where auth_user_id='d3000000-0000-4000-8000-000000000002')=1,'Staff chat: no new link');
select pg_temp.bind('d3000000-0000-4000-8000-000000000003',8403);
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name)values('d3000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000009','Clinic Synthetic');
select pg_temp.say('9407',8403);
select pg_temp.ok(not exists(select 1 from public.telegram_signin_links where auth_user_id='d3000000-0000-4000-8000-000000000003'),'Clinic account: no link');

-- 8. At most 5 links per member per hour (a fresh binding for M after the revoke).
select pg_temp.bind('d3000000-0000-4000-8000-000000000001',8404);
update public.telegram_signin_links set created_at=clock_timestamp()where auth_user_id='d3000000-0000-4000-8000-000000000001';
select pg_temp.say('9408',8404);select pg_temp.next_hour(8404);select pg_temp.say('9409',8404);
select pg_temp.ok((select count(*)from public.telegram_signin_links where auth_user_id='d3000000-0000-4000-8000-000000000001')=5,'Five links this hour');
select pg_temp.next_hour(8404);select pg_temp.say('9410',8404);
select pg_temp.ok((select count(*)from public.telegram_signin_links where auth_user_id='d3000000-0000-4000-8000-000000000001')=5
 and(select count(*)from public.telegram_auth_messages where principal_ref=pg_temp.principal(8404)and template_id='telegram.next_review')=3,'Sixth next step is sent without a link');
select pg_temp.ok((select count(*)from public.telegram_auth_audit where kind in('signin_link.armed','signin_link.used','signin_link.refused'))>=6,'Audited');

-- 9. Review F-1/F-2 (member P): one live link per member; already signed in; another member signed in; sign-out and revoke cancel.
insert into auth.users(id,phone,phone_confirmed_at)values('d3000000-0000-4000-8000-000000000004','37499030004',now());
update public.profiles set display_name='Synthetic member P',birth_date='1981-01-01',biological_sex='male',locale='en'where id='d3000000-0000-4000-8000-000000000004';
insert into public.patient_consents(user_id,version)values('d3000000-0000-4000-8000-000000000004','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('d3000000-0000-4000-8000-000000000004',2,now());
select pg_temp.bind('d3000000-0000-4000-8000-000000000004',8407);
select pg_temp.say('9413',8407);select public.telegram_signin_link_arm((pg_temp.link(8407)).message_id,pg_temp.h('tok-h'));
insert into kv values('l1',to_jsonb((pg_temp.link(8407)).id));
select pg_temp.next_hour(8407);select pg_temp.say('9414',8407);
select pg_temp.ok(public.telegram_signin_link_arm((pg_temp.link(8407)).message_id,pg_temp.h('tok-i'))->>'ok'='true','Second link armed');
select pg_temp.ok((select state='cancelled'from public.telegram_signin_links where id=(select (v#>>'{}')::uuid from kv where k='l1'))and(pg_temp.link(8407)).state='armed','Newest wins: the older armed link is cancelled');
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-h'),repeat('7',64))->>'code'='expired'and pg_temp.begin(pg_temp.h('tok-h'),repeat('7',64))->>'step'='next_review','Older link: expired, with its step');
-- Already signed in as P on this browser: used up, no sign-in request at all.
insert into kv values('same',public.telegram_signin_link_begin(pg_temp.h('tok-i'),repeat('7',64),'d3000000-0000-4000-8000-000000000004',false));
select pg_temp.ok((select v->>'ok'='true'and v->>'signedIn'='true'and v->>'step'='next_review'from kv where k='same')and(pg_temp.link(8407)).state='used'and(pg_temp.link(8407)).used_at is not null,'Same member signed in: link used, no second sign-in');
select pg_temp.ok(not exists(select 1 from public.auth_code_requests where phone='+37499030004'),'Same member: no code request');
select pg_temp.ok(public.telegram_signin_link_begin(pg_temp.h('tok-i'),repeat('7',64),'d3000000-0000-4000-8000-000000000004',false)->>'code'='expired','Same member: still single use');
-- Another member (M) signed in on the opening browser: refused without a swap, link untouched; confirmed switch continues.
select pg_temp.next_hour(8407);select pg_temp.say('9415',8407);select public.telegram_signin_link_arm((pg_temp.link(8407)).message_id,pg_temp.h('tok-j'));
insert into kv values('other',public.telegram_signin_link_begin(pg_temp.h('tok-j'),repeat('8',64),'d3000000-0000-4000-8000-000000000001',false));
select pg_temp.ok((select v->>'code'='other_account'and v->>'step'='next_review'from kv where k='other')and(pg_temp.link(8407)).state='armed'and(pg_temp.link(8407)).request_id is null,'Other member signed in: other_account, link left armed, no request');
select pg_temp.ok(not exists(select 1 from public.auth_code_requests where phone='+37499030004'),'Other member: no code request');
insert into kv values('switch',public.telegram_signin_link_begin(pg_temp.h('tok-j'),repeat('8',64),'d3000000-0000-4000-8000-000000000001',true));
select pg_temp.ok((select v->>'ok'='true'and v->>'phone'='+37499030004'from kv where k='switch')and(pg_temp.link(8407)).state='redeeming','Confirmed switch: sign-in for the link member begins');
-- Sign-out: every live link of P (armed or mid-redeem) is cancelled; service only.
select pg_temp.next_hour(8407);select pg_temp.say('9416',8407);select public.telegram_signin_link_arm((pg_temp.link(8407)).message_id,pg_temp.h('tok-k'));
select pg_temp.ok((select count(*)from public.telegram_signin_links where auth_user_id='d3000000-0000-4000-8000-000000000004'and state in('armed','redeeming'))=2,'Redeeming link left alone by a newer arm');
select pg_temp.ok((public.telegram_signin_links_cancel('d3000000-0000-4000-8000-000000000004')->>'cancelled')::int=2,'Sign-out cancels both live links');
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-k'),repeat('9',64))->>'code'='expired'and(pg_temp.link(8407)).state='cancelled','After sign-out the link is expired');
select pg_temp.ok(not exists(select 1 from public.telegram_signin_links where auth_user_id='d3000000-0000-4000-8000-000000000004'and state in('armed','redeeming')),'Nothing live after sign-out');
-- Revoked binding: the armed link is cancelled at once, not only refused later.
select pg_temp.next_hour(8407);select pg_temp.say('9417',8407);select public.telegram_signin_link_arm((pg_temp.link(8407)).message_id,pg_temp.h('tok-l'));
select pg_temp.ok((pg_temp.link(8407)).state='armed','Armed before the revoke');
select public._telegram_revoke_binding((pg_temp.link(8407)).binding_id,'synthetic');
select pg_temp.ok((pg_temp.link(8407)).state='cancelled','Revoke cancels the live link');
select pg_temp.ok((select count(*)from public.telegram_auth_audit where kind='signin_link.cancelled'and auth_user_id='d3000000-0000-4000-8000-000000000004')=2,'Cancellations audited');

-- 10. Security review 19 Oct (member R). F-1: the 30-day re-proof rule holds for links (no link, no arm,
-- no begin, no code); a fresh proof still works. F-3: a sign-in that did not start re-arms the link and
-- leaves the member's typed-code request alone.
insert into auth.users(id,phone,phone_confirmed_at)values('d3000000-0000-4000-8000-000000000005','37499030005',now());
update public.profiles set display_name='Synthetic member R',birth_date='1982-01-01',biological_sex='female',locale='en'where id='d3000000-0000-4000-8000-000000000005';
insert into public.patient_consents(user_id,version)values('d3000000-0000-4000-8000-000000000005','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('d3000000-0000-4000-8000-000000000005',2,now());
select pg_temp.bind('d3000000-0000-4000-8000-000000000005',8408);
create function pg_temp.proof_age(d interval)returns void language sql as $$update public.telegram_auth_bindings set proven_at=clock_timestamp()-d where principal_ref=pg_temp.principal(8408)and active$$;
-- Lapsed proof: the next step goes out without a link.
select pg_temp.proof_age('31 days');
select pg_temp.say('9418',8408);
select pg_temp.ok(exists(select 1 from public.telegram_auth_messages where principal_ref=pg_temp.principal(8408)and template_id='telegram.next_review')
 and not exists(select 1 from public.telegram_signin_links where principal_ref=pg_temp.principal(8408)),'Lapsed proof: next step sent, no link made');
-- Proof lapses between making and sending: not armed.
select pg_temp.proof_age('29 days');select pg_temp.next_hour(8408);select pg_temp.say('9419',8408);
select pg_temp.ok((pg_temp.link(8408)).state='pending','Fresh proof (29 days): link made');
select pg_temp.proof_age('31 days');
select pg_temp.ok(public.telegram_signin_link_arm((pg_temp.link(8408)).message_id,pg_temp.h('tok-m'))->>'code'='none'and(pg_temp.link(8408)).state='cancelled','Lapsed at send: not armed, cancelled');
-- Proof lapses after arming: begin refuses (expired with the step, so normal sign-in asks to re-prove), audited.
select pg_temp.proof_age('1 day');select pg_temp.next_hour(8408);select pg_temp.say('9420',8408);
select pg_temp.ok(public.telegram_signin_link_arm((pg_temp.link(8408)).message_id,pg_temp.h('tok-n'))->>'ok'='true','Armed with a fresh proof');
select pg_temp.proof_age('31 days');
insert into kv values('lapsed',pg_temp.begin(pg_temp.h('tok-n'),repeat('a',64)));
select pg_temp.ok((select v->>'code'='expired'and v->>'step'='next_review'from kv where k='lapsed')and(pg_temp.link(8408)).state='cancelled','Lapsed after arm: begin refuses, link cancelled');
select pg_temp.ok(exists(select 1 from public.telegram_auth_audit where auth_user_id='d3000000-0000-4000-8000-000000000005'and kind='signin_link.refused'and detail->>'reason'='reproof_required'),'Audited as reproof_required');
select pg_temp.ok(not exists(select 1 from public.auth_code_requests where phone='+37499030005'),'Lapsed: no code request');
-- Proof lapses mid-redeem: the hook refuses the link route with reproof_required.
select pg_temp.proof_age('1 day');select pg_temp.next_hour(8408);select pg_temp.say('9421',8408);
select public.telegram_signin_link_arm((pg_temp.link(8408)).message_id,pg_temp.h('tok-o'));
insert into kv values('mid',pg_temp.begin(pg_temp.h('tok-o'),repeat('b',64)));
select pg_temp.proof_age('31 days');
select pg_temp.ok(public.auth_code_request_claim('+37499030005','wh-r1',repeat('b',64))->>'code'='reproof_required','Hook: link route refused reproof_required');
select pg_temp.ok((select state='refused'and refusal='reproof_required'from public.auth_code_requests where id=(select (v->>'requestId')::uuid from kv where k='mid')),'Hook: request recorded as refused');
-- F-3: a sign-in that did not start (CAPTCHA) re-arms the link; another browser can then use it; the typed-code request in flight is kept.
select pg_temp.proof_age('1 day');
insert into public.auth_code_requests(phone,nonce_hmac,lease_until,state)values('+37499030005',repeat('c',64),clock_timestamp()-interval '1 minute','sent');
select pg_temp.next_hour(8408);select pg_temp.say('9422',8408);
select public.telegram_signin_link_arm((pg_temp.link(8408)).message_id,pg_temp.h('tok-p'));
insert into kv values('first',pg_temp.begin(pg_temp.h('tok-p'),repeat('d',64)));
select pg_temp.ok((select v->>'ok'='true'from kv where k='first')and(pg_temp.link(8408)).state='redeeming','First open: redeeming');
select pg_temp.ok(public.auth_code_request_abandon((select (v->>'requestId')::uuid from kv where k='first'),repeat('d',64))->>'rearmed'='true','CAPTCHA failed: abandon re-arms');
select pg_temp.ok((pg_temp.link(8408)).state='armed'and(pg_temp.link(8408)).redeem_nonce_hmac is null and(pg_temp.link(8408)).request_id is null,'Link armed again, no browser bound');
select pg_temp.ok((select state='sent'from public.auth_code_requests where phone='+37499030005'and nonce_hmac=repeat('c',64)),'Typed-code request kept');
-- A fresh proof still signs in, now from another browser.
insert into kv values('second',pg_temp.sign_in('tok-p',repeat('e',64),'wh-r2'));
select pg_temp.ok((select v->>'ok'='true'from kv where k='second')and(pg_temp.link(8408)).state='redeeming','Fresh proof: another browser signs in through the hook link route');
select pg_temp.ok(public.auth_code_request_abandon((select (v->>'requestId')::uuid from kv where k='first'),repeat('d',64))->>'rearmed'is distinct from 'true'and(pg_temp.link(8408)).state='redeeming','A stale abandon never re-arms a link another browser is redeeming');

-- R314-1: a link armed while another was mid-redeem wins; the abandoned older one is cancelled, not re-armed.
update public.telegram_signin_links set created_at=created_at-interval '2 hours'where auth_user_id='d3000000-0000-4000-8000-000000000005';
select pg_temp.next_hour(8408);select pg_temp.say('9423',8408);
select public.telegram_signin_link_arm((pg_temp.link(8408)).message_id,pg_temp.h('tok-q'));
insert into kv values('older',to_jsonb((pg_temp.link(8408)).id));
insert into kv values('q1',pg_temp.begin(pg_temp.h('tok-q'),repeat('f',64)));
select pg_temp.next_hour(8408);select pg_temp.say('9424',8408);
select public.telegram_signin_link_arm((pg_temp.link(8408)).message_id,pg_temp.h('tok-r'));
select pg_temp.ok(public.auth_code_request_abandon((select (v->>'requestId')::uuid from kv where k='q1'),repeat('f',64))->>'rearmed'='false','Newer link armed meanwhile: abandon does not re-arm');
select pg_temp.ok((select state='cancelled'from public.telegram_signin_links where id=(select (v#>>'{}')::uuid from kv where k='older'))
 and(select count(*)from public.telegram_signin_links where auth_user_id='d3000000-0000-4000-8000-000000000005'and state='armed')=1,'One armed link: the newest');
select pg_temp.ok(pg_temp.begin(pg_temp.h('tok-q'),repeat('9',64))->>'code'='expired'and pg_temp.begin(pg_temp.h('tok-r'),repeat('9',64))->>'ok'='true','Older expired, newest signs in');
-- Clear the redemption left open above, so this member can start a new one.
update public.auth_code_requests set state='cancelled'where phone='+37499030005'and state in('issuing','sending','sent');
update public.telegram_signin_links set state='cancelled'where auth_user_id='d3000000-0000-4000-8000-000000000005'and state in('armed','redeeming');
update public.telegram_signin_links set created_at=created_at-interval '2 hours'where auth_user_id='d3000000-0000-4000-8000-000000000005';
-- Astra A4-2 (20 Oct audit): a retry of a finished link is still fine; a link cancelled while it is being redeemed
-- (the member signed out elsewhere) cannot finish, and the session made for it is ended.
select pg_temp.next_hour(8408);select pg_temp.say('9481',8408);
select public.telegram_signin_link_arm((pg_temp.link(8408)).message_id,pg_temp.h('tok-a4'));
insert into kv values('c4',pg_temp.sign_in('tok-a4',repeat('7',64),'wh-a4'));
select pg_temp.ok(public.telegram_signin_link_code((select (v->>'requestId')::uuid from kv where k='c4'),repeat('7',64))->>'ok'='true','The code is read');
select pg_temp.ok(public.auth_code_request_check((select (v->>'requestId')::uuid from kv where k='c4'),repeat('7',64),repeat('d',64))->>'ok'='true','Checked');
select pg_temp.ok((public.telegram_signin_links_cancel('d3000000-0000-4000-8000-000000000005')->>'cancelled')::int=1,'Signed out elsewhere: the link is cancelled');
insert into auth.sessions(id,user_id)values('d3000000-0000-4000-8000-0000000000a4','d3000000-0000-4000-8000-000000000005');
select pg_temp.ok(public.auth_code_request_verified((select (v->>'requestId')::uuid from kv where k='c4'),repeat('7',64),repeat('d',64),'d3000000-0000-4000-8000-000000000005','d3000000-0000-4000-8000-0000000000a4')->>'result'='signed_in','Auth verified the code');
select pg_temp.ok(public.telegram_signin_link_finish((select (v->>'requestId')::uuid from kv where k='c4'),repeat('7',64))->>'code'='cancelled','A cancelled link does not finish');
select pg_temp.ok(not exists(select 1 from auth.sessions where id='d3000000-0000-4000-8000-0000000000a4')and(pg_temp.link(8408)).state='cancelled','Its session is ended; the link stays cancelled');

rollback;
\echo 'check-telegram-signin-links: ok'
