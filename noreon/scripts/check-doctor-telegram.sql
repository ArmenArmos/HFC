-- Synthetic fixtures only. Run after a clean local migration replay. Everything rolls back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
select pg_temp.service();
select pg_temp.ok((select not enabled from public.doctor_telegram_settings where singleton),'dark seed');
update public.doctor_telegram_settings set enabled=true;
select pg_temp.ok(not has_table_privilege('authenticated','public.doctor_telegram_connections','select')and not has_function_privilege('authenticated','public.doctor_telegram_take_lease(uuid,bigint)','execute'),'credential boundary');
insert into auth.users(id,email)values('d7100000-0000-4000-8000-000000000001','doctor.telegram.synthetic@example.invalid');
insert into public.workspace_clinics(id,name)values('d7100000-0000-4000-8000-000000000002','Synthetic Telegram clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d7100000-0000-4000-8000-000000000001','doctor','Synthetic doctor','d7100000-0000-4000-8000-000000000002');
insert into auth.sessions(id,user_id,created_at,updated_at)select ('d7100000-0000-4000-8000-'||lpad(x::text,12,'0'))::uuid,'d7100000-0000-4000-8000-000000000001',now(),now()from generate_series(11,20)x;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('doctor_synthetic',9710,600,'synthetic')on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id,link_token_seconds=excluded.link_token_seconds,consent_version=excluded.consent_version;
insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
select 'd7100000-0000-4000-8000-000000000003','d7100000-0000-4000-8000-000000000001','staff',public._telegram_principal_ref(s,7710),public._telegram_account_ref(s),'+37499097101','7710',1 from public.telegram_channel_settings s where singleton;
create temp table dt(k text primary key,v jsonb);
insert into dt values('open',public.doctor_telegram_open('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000003',1,'d7100000-0000-4000-8000-000000000011',1,'synthetic-cipher','test','nonce-1'));
select pg_temp.ok(v->>'ok'='true','open')from dt where k='open';
create function pg_temp.cid()returns uuid language sql as $$select(v#>>'{connection,id}')::uuid from dt where k='open'$$;
insert into dt values('lease',public.doctor_telegram_take_lease(pg_temp.cid(),1));
create function pg_temp.lease()returns uuid language sql as $$select(v#>>'{connection,lease_token}')::uuid from dt where k='lease'$$;
select pg_temp.ok(public.doctor_telegram_take_lease(pg_temp.cid(),1)->>'code'='busy','one worker');
select pg_temp.ok(public.doctor_telegram_action_admit(pg_temp.cid(),2,pg_temp.lease())->>'ok'='false','generation fenced');
select pg_temp.ok(public.doctor_telegram_begin_refresh(pg_temp.cid(),1,gen_random_uuid())->>'ok'='false','lease fenced');
select pg_temp.ok(public.doctor_telegram_begin_refresh(pg_temp.cid(),1,pg_temp.lease())->>'ok'='true','begin before Auth');
select pg_temp.ok(public.doctor_telegram_action_admit(pg_temp.cid(),1,pg_temp.lease())->>'ok'='false','cannot act while refreshing');
select pg_temp.ok(public.doctor_telegram_release_lease(pg_temp.cid(),1,pg_temp.lease())->>'ok'='false','refresh cannot be released');
update public.doctor_telegram_connections set lease_until=clock_timestamp()-interval '1 second'where id=pg_temp.cid();
select pg_temp.ok(public.doctor_telegram_finish_refresh(pg_temp.cid(),1,pg_temp.lease(),'rotated','test','nonce-2')->>'ok'='false','expired worker cannot persist rotation');
select pg_temp.ok(public.doctor_telegram_take_lease(pg_temp.cid(),1)->>'code'='quarantined','uncertain rotation quarantined');
select pg_temp.ok((select ciphertext is null and state='quarantined'from public.doctor_telegram_connections where id=pg_temp.cid()),'quarantine erases credential');
select pg_temp.ok(public.doctor_telegram_disconnect('d7100000-0000-4000-8000-000000000001')->>'ok'='true','disconnect');
select pg_temp.ok(not exists(select 1 from auth.sessions where id='d7100000-0000-4000-8000-000000000011')and exists(select 1 from auth.sessions where id='d7100000-0000-4000-8000-000000000012'),'only dedicated session revoked');
-- Make the same identity a real member when no staff membership exists; with staff membership,
-- the doctor/staff-binding path still wins without consulting member eligibility.
update auth.users set phone='37499097101',phone_confirmed_at=now()where id='d7100000-0000-4000-8000-000000000001';
insert into public.patient_clinical_cases(user_id)values('d7100000-0000-4000-8000-000000000001');
-- Full routing cross product: both switches, binding active/kind, doctor/nurse/admin/member,
-- connection open/closed, and every ingress kind (896 combinations).
-- The legacy handlers execute unchanged; this matrix asserts only the newly persisted routing decision.
do $$declare env_on boolean;db_on boolean;bound boolean;staff_role text;binding_kind text;connected boolean;k text;event uuid;outcome jsonb;expected text;
begin
 for env_on in select unnest(array[false,true])loop
 for db_on in select unnest(array[false,true])loop
 for bound in select unnest(array[false,true])loop
 for staff_role in select unnest(array['doctor','nurse','admin','none'])loop
 for binding_kind in select unnest(array['staff','member'])loop
 for connected in select unnest(array[false,true])loop
 for k in select unnest(array['text','callback','start','media','redo','link','contact'])loop
  update public.doctor_telegram_settings set enabled=db_on;
  update public.telegram_auth_bindings set active=bound,kind=binding_kind where id='d7100000-0000-4000-8000-000000000003';
  if staff_role='none'then
   delete from public.workspace_staff where user_id='d7100000-0000-4000-8000-000000000001';
  else
   insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d7100000-0000-4000-8000-000000000001',staff_role,'Synthetic doctor','d7100000-0000-4000-8000-000000000002')on conflict(user_id)do update set role=excluded.role;
  end if;
  if staff_role='none'then perform pg_temp.ok(public._telegram_member_eligible('d7100000-0000-4000-8000-000000000001'),'member-only fixture is eligible');end if;
  insert into auth.sessions(id,user_id,created_at,updated_at)values('d7100000-0000-4000-8000-000000000011','d7100000-0000-4000-8000-000000000001',now(),now())on conflict(id)do nothing;
  update public.doctor_telegram_connections set state=case when connected then 'active'else 'closed'end,
   ciphertext=case when connected then 'synthetic'end,key_version=case when connected then 'test'end,nonce=case when connected then 'nonce'end,
   lease_token=null,lease_until=null,expires_at=clock_timestamp()+interval '1 hour'where id=pg_temp.cid();
  insert into public.channel_inbox(adapter,event_id,fingerprint,principal_ref,kind,payload,status,lease_until)
  select 'telegram',gen_random_uuid()::text,'synthetic',b.principal_ref,k,jsonb_build_object('text','synthetic','chatId',7710,'messageId',1,'intentRef',repeat('x',16),'callbackId','synthetic'),
   'processing',clock_timestamp()+interval '60 seconds'from public.telegram_auth_bindings b where id='d7100000-0000-4000-8000-000000000003'returning id into event;
  outcome:=public.channel_inbox_process(event,env_on);
  expected:=case when env_on and db_on and bound and binding_kind='staff'and staff_role='doctor'and connected and k in('text','callback')then 'staff'else 'legacy'end;
  perform pg_temp.ok((select doctor_telegram_route=expected from public.channel_inbox where id=event),'routing matrix');
  if expected='legacy'then
   update public.channel_inbox set status='processing',lease_until=clock_timestamp()+interval '60 seconds'where id=event;
   perform public.channel_inbox_process(event,true);
   perform pg_temp.ok((select doctor_telegram_route='legacy'from public.channel_inbox where id=event),'legacy retry never changes identity');
  end if;
  if expected='staff'then
   perform pg_temp.ok(outcome?'staff','staff branch returns staff');
   perform public.doctor_telegram_disconnect('d7100000-0000-4000-8000-000000000001');
   outcome:=public.channel_inbox_process(event,env_on);
   perform pg_temp.ok(outcome#>>'{staff,closed}'='true','retry after disconnect stays staff closed');
   update public.channel_inbox set payload=payload||jsonb_build_object('text','synthetic sensitive text','phone','+37499097109')where id=event;
   perform pg_temp.ok(public.doctor_telegram_inbox_claim(event,pg_temp.cid(),1)->>'ok'='true','first send attempt');
   perform pg_temp.ok(public.doctor_telegram_inbox_claim(event,pg_temp.cid(),1)->>'ok'='false','uncertain response never resent');
   perform pg_temp.ok((select not(payload?'text')and not(payload?'phone')from public.channel_inbox where id=event),'uncertain terminal response scrubs text and phone');
   -- Independently exercise successful response completion using the same frozen route.
   update public.channel_inbox set status='processing',payload=payload||jsonb_build_object('text','synthetic sensitive text','phone','+37499097109')where id=event;
   perform pg_temp.ok(public.doctor_telegram_inbox_done(event,pg_temp.cid(),1,'connected')->>'ok'='true','normal response completes');
   perform pg_temp.ok((select not(payload?'text')and not(payload?'phone')from public.channel_inbox where id=event),'normal terminal response scrubs text and phone');
  end if;
 end loop;end loop;end loop;end loop;end loop;end loop;end loop;
end$$;
-- Astra SQL-01: captured nurse input and captured member endpoints never take the staff route, even after the principal
-- became a doctor with a live connection; they run the legacy path with their captured identity checks.
do $$declare event uuid;r jsonb;
begin
 update public.doctor_telegram_settings set enabled=true;
 update public.telegram_auth_bindings set active=true,kind='staff'where id='d7100000-0000-4000-8000-000000000003';
 insert into auth.sessions(id,user_id,created_at,updated_at)values('d7100000-0000-4000-8000-000000000011','d7100000-0000-4000-8000-000000000001',now(),now())on conflict(id)do nothing;
 update public.doctor_telegram_connections set state='active',ciphertext='synthetic',key_version='test',nonce='nonce',lease_token=null,lease_until=null,expires_at=clock_timestamp()+interval '1 hour'where id=pg_temp.cid();
 -- A nurse message committed while the account was a nurse, then the account is promoted to a doctor before first processing.
 insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d7100000-0000-4000-8000-000000000001','nurse','Synthetic nurse','d7100000-0000-4000-8000-000000000002')on conflict(user_id)do update set role=excluded.role;
 for k in 1..2 loop
  insert into public.channel_inbox(adapter,event_id,fingerprint,principal_ref,kind,payload,status,lease_until)
  select 'telegram',gen_random_uuid()::text,'synthetic',b.principal_ref,case k when 1 then 'text' else 'callback' end,jsonb_build_object('text','synthetic','chatId',7710,'messageId',1,'intentRef',repeat('x',16),'callbackId','synthetic'),
   'processing',clock_timestamp()+interval '60 seconds'from public.telegram_auth_bindings b where id='d7100000-0000-4000-8000-000000000003'returning id into event;
  perform pg_temp.ok((select nurse_at_commit and nurse_binding_id is not null from public.channel_inbox where id=event),'The nurse capture is on the committed row');
  update public.workspace_staff set role='doctor'where user_id='d7100000-0000-4000-8000-000000000001';
  -- The role change closes the connection through its lifecycle trigger; restore a live one so only the capture can decide.
  insert into auth.sessions(id,user_id,created_at,updated_at)values('d7100000-0000-4000-8000-000000000011','d7100000-0000-4000-8000-000000000001',now(),now())on conflict(id)do nothing;
  update public.doctor_telegram_connections set state='active',ciphertext='synthetic',key_version='test',nonce='nonce',lease_token=null,lease_until=null,expires_at=clock_timestamp()+interval '1 hour'where id=pg_temp.cid();
  perform pg_temp.ok((select public._doctor_telegram_valid(d)from public.doctor_telegram_connections d where id=pg_temp.cid()),'The doctor connection is live, so only the capture keeps the nurse message off the staff route');
  r:=public.channel_inbox_process(event,true);
  perform pg_temp.ok((select doctor_telegram_route='legacy'from public.channel_inbox where id=event)and not(r?'staff'),'A captured nurse message never takes the doctor route after promotion');
  update public.channel_inbox set status='processing',lease_until=clock_timestamp()+interval '60 seconds'where id=event;
  r:=public.channel_inbox_process(event,true);
  perform pg_temp.ok((select doctor_telegram_route='legacy'from public.channel_inbox where id=event)and not(r?'staff'),'Retries keep the legacy route');
  update public.workspace_staff set role='nurse'where user_id='d7100000-0000-4000-8000-000000000001';
 end loop;
 update public.workspace_staff set role='doctor'where user_id='d7100000-0000-4000-8000-000000000001';
end$$;
-- A captured member endpoint on a principal that is also a doctor with a live connection.
do $$declare event uuid;ep uuid:=gen_random_uuid();r jsonb;
begin
 -- The nurse cases above closed the connection (role changes close it); restore a live one so only the endpoint capture decides.
 insert into auth.sessions(id,user_id,created_at,updated_at)values('d7100000-0000-4000-8000-000000000011','d7100000-0000-4000-8000-000000000001',now(),now())on conflict(id)do nothing;
 update public.doctor_telegram_connections set state='active',ciphertext='synthetic',key_version='test',nonce='nonce',lease_token=null,lease_until=null,expires_at=clock_timestamp()+interval '1 hour'where id=pg_temp.cid();
 perform pg_temp.ok((select public._doctor_telegram_valid(d)from public.doctor_telegram_connections d where id=pg_temp.cid()),'The doctor connection is live before the endpoint case');
 insert into public.conversation_endpoints(id,member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16,binding_id)
  select ep,'d7100000-0000-4000-8000-000000000001','telegram',b.account_ref,b.principal_ref,b.address,1,true,'synthetic-doctor-telegram','infinity',4096,b.id from public.telegram_auth_bindings b where id='d7100000-0000-4000-8000-000000000003';
 insert into public.channel_inbox(adapter,event_id,fingerprint,principal_ref,kind,payload,status,lease_until,endpoint_id,endpoint_generation)
 select 'telegram',gen_random_uuid()::text,'synthetic',b.principal_ref,'text',jsonb_build_object('text','synthetic','chatId',7710,'messageId',1),'processing',clock_timestamp()+interval '60 seconds',ep,1
  from public.telegram_auth_bindings b where id='d7100000-0000-4000-8000-000000000003'returning id into event;
 r:=public.channel_inbox_process(event,true);
 perform pg_temp.ok((select doctor_telegram_route='legacy'from public.channel_inbox where id=event)and not(r?'staff'),'A captured member endpoint never takes the doctor route');
end$$;
-- Refresh success, obsolete writes and lifecycle hooks.
update public.doctor_telegram_settings set enabled=true;
update public.telegram_auth_bindings set active=true,kind='staff'where id='d7100000-0000-4000-8000-000000000003';
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d7100000-0000-4000-8000-000000000001','doctor','Synthetic doctor','d7100000-0000-4000-8000-000000000002')on conflict(user_id)do update set role=excluded.role;
insert into auth.sessions(id,user_id,created_at,updated_at)values('d7100000-0000-4000-8000-000000000013','d7100000-0000-4000-8000-000000000001',now(),now())on conflict(id)do nothing;
select pg_temp.ok(public.doctor_telegram_open('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000003',1,'d7100000-0000-4000-8000-000000000013',2,'sealed','test','nonce-new')->>'ok'='true','reconnect increments generation');
update dt set v=public.doctor_telegram_take_lease(pg_temp.cid(),2)where k='lease';
select pg_temp.ok(public.doctor_telegram_begin_refresh(pg_temp.cid(),2,pg_temp.lease())->>'ok'='true','current refresh starts');
select pg_temp.ok(public.doctor_telegram_finish_refresh(pg_temp.cid(),2,pg_temp.lease(),'sealed-rotated','test','nonce-rotated')->>'ok'='true','rotation persisted');
select pg_temp.ok(public.doctor_telegram_action_admit(pg_temp.cid(),2,pg_temp.lease())->>'ok'='true','current fence admitted');
select pg_temp.ok(public.doctor_telegram_quarantine(pg_temp.cid(),1,pg_temp.lease())->>'ok'='false','old generation cannot quarantine reconnect');
-- An obsolete token cannot mutate any connection field, even with the current generation.
-- Run in each refresh state so rejection cannot merely be attributed to the wrong state.
do $$declare st text;before_row jsonb;old_lease uuid:=pg_temp.lease();r jsonb;
begin
 for st in select unnest(array['active','refreshing'])loop
  update public.doctor_telegram_connections set state=st,lease_token=gen_random_uuid()where id=pg_temp.cid();
  select to_jsonb(c)into before_row from public.doctor_telegram_connections c where id=pg_temp.cid();
  r:=public.doctor_telegram_begin_refresh(pg_temp.cid(),2,old_lease);perform pg_temp.ok(r->>'ok'='false','obsolete begin refused');
  r:=public.doctor_telegram_finish_refresh(pg_temp.cid(),2,old_lease,'obsolete-cipher','test','obsolete-nonce');perform pg_temp.ok(r->>'ok'='false','obsolete finish refused');
  r:=public.doctor_telegram_quarantine(pg_temp.cid(),2,old_lease);perform pg_temp.ok(r->>'ok'='false','obsolete quarantine refused');
  r:=public.doctor_telegram_action_admit(pg_temp.cid(),2,old_lease);perform pg_temp.ok(r->>'ok'='false','obsolete admission refused');
  r:=public.doctor_telegram_release_lease(pg_temp.cid(),2,old_lease);perform pg_temp.ok(r->>'ok'='false','obsolete release refused');
  r:=public.doctor_telegram_close(pg_temp.cid(),2,old_lease);perform pg_temp.ok(r->>'ok'='false','obsolete close refused');
  perform pg_temp.ok((select to_jsonb(c)=before_row from public.doctor_telegram_connections c where id=pg_temp.cid()),'all obsolete mutators leave exact row unchanged');
  perform pg_temp.ok(exists(select 1 from auth.sessions where id='d7100000-0000-4000-8000-000000000013'),'obsolete close preserves auth session');
 end loop;
 update public.doctor_telegram_connections set state='active',lease_token=old_lease where id=pg_temp.cid();
end$$;
select pg_temp.ok(public.doctor_telegram_abandon('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000013')->>'connected'='true'and exists(select 1 from auth.sessions where id='d7100000-0000-4000-8000-000000000013'),'lost open response cannot abandon connected session');
update public.doctor_telegram_connections set state='refreshing'where id=pg_temp.cid();
select pg_temp.ok(public.doctor_telegram_abandon('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000013')->>'connected'='true','refreshing connection survives abandon');
update public.doctor_telegram_connections set state='quarantined',ciphertext=null,key_version=null,nonce=null where id=pg_temp.cid();
select pg_temp.ok(public.doctor_telegram_abandon('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000013')->>'connected'='true'and exists(select 1 from auth.sessions where id='d7100000-0000-4000-8000-000000000013'),'quarantined connection survives abandon');
update public.telegram_auth_bindings set generation=2 where id='d7100000-0000-4000-8000-000000000003';
select pg_temp.ok((select state='closed'and ciphertext is null from public.doctor_telegram_connections where id=pg_temp.cid())and not exists(select 1 from auth.sessions where id='d7100000-0000-4000-8000-000000000013'),'binding mutation closes and revokes immediately');
select pg_temp.ok(public.doctor_telegram_action_admit(pg_temp.cid(),2,pg_temp.lease())->>'ok'='false','paused actor refused after close');
-- Password and staff deactivation are independently wired, and each deletes only the dedicated session.
do $$declare sid uuid;g bigint;x jsonb;mode text;
begin
 for mode in select unnest(array['password','staff','expiry'])loop
  g:=(public.doctor_telegram_status('d7100000-0000-4000-8000-000000000001')->>'nextGeneration')::bigint;sid:=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at)values(sid,'d7100000-0000-4000-8000-000000000001',now(),now());
  x:=public.doctor_telegram_open('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000003',2,sid,g,'sealed','test',gen_random_uuid()::text);
  perform pg_temp.ok(x->>'ok'='true','lifecycle fixture opens');
  if mode='password'then update auth.users set encrypted_password='synthetic-password-hash'where id='d7100000-0000-4000-8000-000000000001';
  elsif mode='staff'then update public.workspace_staff set active=false where user_id='d7100000-0000-4000-8000-000000000001';
  else update public.doctor_telegram_connections set expires_at=clock_timestamp()-interval '1 second'where id=pg_temp.cid();perform public.doctor_telegram_sweep();end if;
  perform pg_temp.ok((select state='closed'and ciphertext is null from public.doctor_telegram_connections where id=pg_temp.cid())and not exists(select 1 from auth.sessions where id=sid),'lifecycle closure');
  update public.workspace_staff set active=true where user_id='d7100000-0000-4000-8000-000000000001';
 end loop;
end$$;
-- Abandon deletes exactly the server-held pending session and preserves another browser session.
insert into auth.refresh_tokens(token,user_id,session_id,revoked,created_at,updated_at)values('synthetic-doctor-telegram-pending-token','d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000020',false,now(),now());
select pg_temp.ok(public.doctor_telegram_abandon('d7100000-0000-4000-8000-000000000099','d7100000-0000-4000-8000-000000000020')->>'connected'='false'and exists(select 1 from auth.refresh_tokens where token='synthetic-doctor-telegram-pending-token'),'another actor cannot abandon supplied session');
select pg_temp.ok(public.doctor_telegram_abandon('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000020')->>'connected'='false','pending session abandoned');
select pg_temp.ok(not exists(select 1 from auth.refresh_tokens where token='synthetic-doctor-telegram-pending-token'),'pending refresh token deleted');
select pg_temp.ok(not exists(select 1 from auth.sessions where id='d7100000-0000-4000-8000-000000000020')and exists(select 1 from auth.sessions where id='d7100000-0000-4000-8000-000000000012'),'abandon preserves browser session');
select pg_temp.ok(not has_function_privilege('authenticated','public.doctor_telegram_abandon(uuid,uuid)','execute')and has_function_privilege('service_role','public.doctor_telegram_abandon(uuid,uuid)','execute'),'abandon service boundary');
-- Structural lock check accompanies sequential lost-response tests above; no concurrent execution is implied.
select pg_temp.ok(position('pg_advisory_xact_lock(hashtextextended(''doctor_telegram:''||p_doctor::text,0))'in pg_get_functiondef('public.doctor_telegram_abandon(uuid,uuid)'::regprocedure))>0
 and position('pg_advisory_xact_lock(hashtextextended(''doctor_telegram:''||p_doctor::text,0))'in pg_get_functiondef('public.doctor_telegram_open(uuid,uuid,bigint,uuid,bigint,text,text,text)'::regprocedure))>0,'open and abandon share doctor lock');
-- Required admission is independently checked at SQL open and before work.
insert into public.staff_telegram_policy(signin_required)values(true)on conflict(singleton)do update set signin_required=true;
select pg_temp.ok(public.doctor_telegram_open('d7100000-0000-4000-8000-000000000001','d7100000-0000-4000-8000-000000000003',2,'d7100000-0000-4000-8000-000000000019',6,'sealed','test','no-admission')->>'ok'='false','unadmitted session cannot open');
-- Optional prompt correlation is retained exactly, and invalid message identifiers are rejected.
do $$declare s public.telegram_channel_settings;e jsonb;outcome jsonb;
begin
 select *into s from public.telegram_channel_settings where singleton;
 e:=jsonb_build_object('adapter','telegram','eventId','synthetic-reply-correlation','fingerprint','synthetic-reply','principalRef',public._telegram_principal_ref(s,7710),'kind','text','payload',jsonb_build_object('chatId',7710,'messageId',55,'replyToMessageId',41,'text','synthetic'));
 outcome:=public.channel_inbox_commit(e);
 perform pg_temp.ok(outcome->>'status'='committed'and(select payload->>'replyToMessageId'='41'from public.channel_inbox where event_id='synthetic-reply-correlation'),'prompt correlation retained');
 e:=jsonb_set(e,'{eventId}','"synthetic-invalid-reply"');e:=jsonb_set(e,'{payload,replyToMessageId}','-1');
 perform pg_temp.ok(public.channel_inbox_commit(e)->>'code'='invalid_event','invalid prompt correlation rejected');
end$$;
rollback;
