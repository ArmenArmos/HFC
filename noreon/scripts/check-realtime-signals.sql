-- Realtime signals (WP R: 20261108084913_realtime_signals). Rolled back; synthetic fixtures only.
-- Actors: 01 member, 02 another member, 07 caregiver with receive_alerts, 08 caregiver without it, 03 family physician,
-- 06 nurse, 05 Noreon admin, 09 coordinator (clinic 10), 0c coordinator (clinic 11), 0a clinic portal member (clinic 10).
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.denied(q text)returns boolean language plpgsql as $$begin execute q;return false;
exception when insufficient_privilege then return true;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$select('5ea0f000-0000-4000-8000-0000000002'||n)::uuid$$;
create function pg_temp.sid(n text)returns uuid language sql immutable as $$select('5ea0f000-0000-4000-8000-0000000003'||n)::uuid$$;
create function pg_temp.as_user(u text)returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.id(u),'role','authenticated','session_id',pg_temp.sid(u),
  'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true)$$;
-- Signals of one recipient and kind (as the table owner).
create function pg_temp.signals(u text,k text)returns bigint language sql as $$
 select count(*)from public.realtime_signals where recipient_user_id=pg_temp.id(u)and kind=k$$;
-- A new statement batch: forget the per-transaction de-duplication, as a new transaction would.
create function pg_temp.next()returns void language sql as $$select set_config('noreon.realtime_sent','',true)$$;

-- 1. Shape: ids and kinds only, RLS on, select-only for authenticated, publication holds only this table ---------------
select pg_temp.ok((select array_agg(column_name::text order by ordinal_position)from information_schema.columns where table_schema='public'and table_name='realtime_signals')
 =array['id','recipient_user_id','kind','ref_id','created_at'],'The table has ids, a kind and a time only: no content column');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.realtime_signals'::regclass),'RLS is on');
select pg_temp.ok(has_table_privilege('authenticated','public.realtime_signals','select')
 and not has_table_privilege('authenticated','public.realtime_signals','insert')
 and not has_table_privilege('authenticated','public.realtime_signals','update')
 and not has_table_privilege('authenticated','public.realtime_signals','delete'),'authenticated may only select');
select pg_temp.ok(not has_table_privilege('anon','public.realtime_signals','select')and not has_table_privilege('service_role','public.realtime_signals','insert'),'anon and service_role have no table grant');
select pg_temp.ok(not has_function_privilege('authenticated','public._realtime_signal(uuid,text,text)','execute')
 and not has_function_privilege('service_role','public._realtime_signal(uuid,text,text)','execute')
 and not has_function_privilege('anon','public._realtime_signal(uuid,text,text)','execute'),'The writer is internal');
select pg_temp.ok(has_function_privilege('service_role','public.realtime_signals_prune(integer)','execute')
 and not has_function_privilege('authenticated','public.realtime_signals_prune(integer)','execute'),'Retention runs as the service role only');
select pg_temp.ok((select array_agg(schemaname||'.'||tablename)from pg_publication_tables where pubname='supabase_realtime')=array['public.realtime_signals'],
 'The supabase_realtime publication contains realtime_signals and nothing else');
select pg_temp.ok(not(select puballtables from pg_publication where pubname='supabase_realtime'),'The publication is table-scoped');
select pg_temp.ok((select pg_get_constraintdef(oid)from pg_constraint where conname='realtime_signals_ref_check')like '%A-Za-z0-9%','The ref is an opaque id, never text');

-- Fixtures.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),case when n in('01','02','07','08')then '374990002'||n end,case when n in('01','02','07','08')then now()end
 from unnest(array['01','02','03','05','06','07','08','09','0a','0c'])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.id(n),now(),now()from unnest(array['01','02','03','05','06','07','08','09','0a','0c'])n;
insert into public.workspace_clinics(id,name)values(pg_temp.id('10'),'Synthetic realtime clinic A'),(pg_temp.id('11'),'Synthetic realtime clinic B');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.id('03'),'doctor','Synthetic physician',pg_temp.id('10')),(pg_temp.id('05'),'admin','Synthetic admin',null),
 (pg_temp.id('06'),'nurse','Synthetic nurse',pg_temp.id('10')),(pg_temp.id('09'),'coordinator','Synthetic coordinator A',pg_temp.id('10')),
 (pg_temp.id('0c'),'coordinator','Synthetic coordinator B',pg_temp.id('11'));
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role)values(pg_temp.id('0a'),pg_temp.id('10'),'Synthetic clinic staff','staff');
insert into public.profiles(id,display_name)values(pg_temp.id('01'),'Synthetic realtime member'),(pg_temp.id('02'),'Synthetic other member')
 on conflict(id)do update set display_name=excluded.display_name;
insert into public.patient_consents(user_id,version)values(pg_temp.id('01'),'patient-pilot-v1'),(pg_temp.id('02'),'patient-pilot-v1');
insert into public.patient_assessments(user_id)values(pg_temp.id('01')),(pg_temp.id('02'));
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.id('01'),pg_temp.id('03'),pg_temp.id('06')),(pg_temp.id('02'),null,null);

-- Caregivers: 07 holds receive_alerts, 08 does not.
select pg_temp.as_user('01');set local role authenticated;
create temp table links as
 select 'alerts'::text which,(r#>>'{link,id}')::uuid id from public.member_caregiver_invite(gen_random_uuid(),'Synthetic Carer A','child','+374990002'||'07',array['receive_alerts','view_plan'],'caregiver-draft-1',repeat('c',64),'tap')r
 union all
 select 'plain',(r#>>'{link,id}')::uuid from public.member_caregiver_invite(gen_random_uuid(),'Synthetic Carer B','friend','+374990002'||'08',array['view_plan'],'caregiver-draft-1',repeat('c',64),'tap')r;
reset role;
select pg_temp.as_user('07');set local role authenticated;
select pg_temp.ok((public.caregiver_invitation_accept((select id from links where which='alerts')))->>'ok'='true','Caregiver A accepts');
reset role;
select pg_temp.as_user('08');set local role authenticated;
select pg_temp.ok((public.caregiver_invitation_accept((select id from links where which='plain')))->>'ok'='true','Caregiver B accepts');
reset role;
delete from public.realtime_signals where recipient_user_id in(select pg_temp.id(n)from unnest(array['01','02','03','05','06','07','08','09','0a','0c'])n);
select pg_temp.next();

-- 2. Member messages: member, care team, and only the caregiver with receive_alerts ------------------------------------
insert into public.conversations(id,member_id)values(pg_temp.id('40'),pg_temp.id('01'));
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values
 (pg_temp.id('40'),1,pg_temp.id('01'),'REALTIME_PRIVATE_CANARY','authenticated_member',gen_random_uuid()),
 (pg_temp.id('40'),2,pg_temp.id('01'),'REALTIME_PRIVATE_CANARY again','authenticated_member',gen_random_uuid());
select pg_temp.ok(pg_temp.signals('01','member_thread')=1,'The member gets one thread signal for the transaction (de-duplicated)');
select pg_temp.ok((select ref_id from public.realtime_signals where recipient_user_id=pg_temp.id('01')and kind='member_thread')=pg_temp.id('40')::text,'The ref is the conversation id');
select pg_temp.ok(pg_temp.signals('03','staff_thread')=1 and pg_temp.signals('06','staff_thread')=1,'The assigned physician and nurse get a staff thread signal');
select pg_temp.ok((select ref_id from public.realtime_signals where recipient_user_id=pg_temp.id('03')and kind='staff_thread')=pg_temp.id('01')::text,'The staff ref is the member id');
select pg_temp.ok(pg_temp.signals('07','caregiver_notice')=1,'The caregiver with receive_alerts is signalled');
select pg_temp.ok((select count(*)from public.realtime_signals where recipient_user_id=pg_temp.id('08'))=0,'A caregiver without receive_alerts is not');
select pg_temp.ok((select count(*)from public.realtime_signals where recipient_user_id in(pg_temp.id('02'),pg_temp.id('05'),pg_temp.id('09'),pg_temp.id('0a')))=0,'Nobody else is signalled');
select pg_temp.ok(not exists(select 1 from public.realtime_signals s where row_to_json(s)::text like '%CANARY%'),'No message text is copied into a signal');
select pg_temp.next();
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(pg_temp.id('40'),3,pg_temp.id('01'),'third','authenticated_member',gen_random_uuid());
select pg_temp.ok(pg_temp.signals('01','member_thread')=2,'A later transaction signals again');

-- A revoked caregiver is no longer signalled.
select pg_temp.next();
select pg_temp.as_user('01');set local role authenticated;
select pg_temp.ok((public.member_caregiver_revoke((select id from links where which='alerts'),(select revision from public.member_caregivers where id=(select id from links where which='alerts'))))->>'ok'='true','The member revokes caregiver A');
reset role;
select pg_temp.next();
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(pg_temp.id('40'),4,pg_temp.id('01'),'fourth','authenticated_member',gen_random_uuid());
select pg_temp.ok(pg_temp.signals('07','caregiver_notice')=2,'A revoked caregiver gets nothing new (two from before the revoke)');

-- 3. Zoe chat cards ----------------------------------------------------------------------------------------------------
select pg_temp.next();
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot)values(pg_temp.id('50'),pg_temp.id('01'),gen_random_uuid(),'bp','chip','{"secret":"REALTIME_PRIVATE_CANARY"}');
select pg_temp.ok(pg_temp.signals('01','member_cards')=1 and(select ref_id from public.realtime_signals where kind='member_cards'and recipient_user_id=pg_temp.id('01'))=pg_temp.id('50')::text,'A posted card signals the member with the card id');
select pg_temp.ok(not exists(select 1 from public.realtime_signals s where row_to_json(s)::text like '%CANARY%'),'No snapshot content in a signal');

-- 4. Care alerts, care queue, coordination tasks --------------------------------------------------------------------------
select pg_temp.next();
insert into public.care_alerts(id,member_id,source,reason_code,rule_id,rule_version,source_ref,doctor_id)
 values(pg_temp.id('60'),pg_temp.id('01'),'message','fixture','fixture','fixture','realtime-check',pg_temp.id('03'));
select pg_temp.ok(pg_temp.signals('03','care_alert')=1 and pg_temp.signals('06','care_alert')=1,'A care alert reaches the physician and the nurse');
select pg_temp.ok((select count(*)from public.realtime_signals where kind='care_alert'and recipient_user_id in(pg_temp.id('05'),pg_temp.id('09'),pg_temp.id('01')))=0,'Not the admin, the coordinator or the member');
select pg_temp.next();
select pg_temp.ok((public.care_queue_raise(pg_temp.id('01'),'admin',null,'lab_booking_needed','synthetic-1',null,null,'{}'::jsonb,null,'realtime-check:1'))->>'ok'='true','An admin logistics task');
select pg_temp.ok(pg_temp.signals('05','worklist')=1 and pg_temp.signals('09','worklist')=1,'The admin and the clinic coordinator get a worklist signal');
select pg_temp.ok(pg_temp.signals('0c','worklist')=0,'Another clinic''s coordinator does not');
select pg_temp.ok(pg_temp.signals('03','worklist')=0 and pg_temp.signals('06','worklist')=0,'The clinical team does not get admin queue signals');

-- 5. Staff notices and the clinic chat -------------------------------------------------------------------------------------
select pg_temp.next();
insert into public.staff_notice_links(token_hash,recipient_id,member_id,alert_id,expires_at)
 values(repeat('ab',32),pg_temp.id('03'),pg_temp.id('01'),pg_temp.id('60'),now()+interval '1 day');
select pg_temp.ok(pg_temp.signals('03','staff_notice')=1,'A staff notice link signals its recipient');
select pg_temp.ok((select ref_id from public.realtime_signals where kind='staff_notice'and recipient_user_id=pg_temp.id('03'))=pg_temp.id('60')::text,'with the alert id, never the token');
select pg_temp.next();
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)values(pg_temp.id('70'),pg_temp.id('10'),'Synthetic batch',pg_temp.id('0a'),'Synthetic clinic staff');
select pg_temp.ok(pg_temp.signals('0a','clinic_thread')=1,'An upload batch at the clinic reaches its portal member');
select pg_temp.ok((select count(*)from public.realtime_signals where kind='clinic_thread'and recipient_user_id<>pg_temp.id('0a'))=0,'and nobody outside the clinic');

-- 6. RLS: a recipient reads only their own signals -------------------------------------------------------------------------
select pg_temp.as_user('03');set local role authenticated;
select pg_temp.ok((select count(*)from public.realtime_signals)>0 and not exists(select 1 from public.realtime_signals where recipient_user_id<>pg_temp.id('03')),'The physician reads only their own signals');
select pg_temp.ok(pg_temp.denied($q$insert into public.realtime_signals(recipient_user_id,kind)values(pg_temp.id('01'),'member_thread')$q$),'Nobody can forge a signal');
select pg_temp.ok(pg_temp.denied($q$delete from public.realtime_signals$q$),'Nobody can delete signals');
select pg_temp.ok(pg_temp.denied($q$select public._realtime_signal(pg_temp.id('01'),'member_thread',null)$q$),'The writer cannot be called');
reset role;
select pg_temp.as_user('02');set local role authenticated;
select pg_temp.ok((select count(*)from public.realtime_signals)=0,'Another member reads nothing');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.denied($q$select count(*)from public.realtime_signals$q$),'anon reads nothing');
reset role;

-- 7. A signal never makes the original write fail -------------------------------------------------------------------------
select pg_temp.next();
alter table public.realtime_signals add constraint realtime_signals_check_block check(kind<>'member_thread')not valid;
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)values(pg_temp.id('40'),5,pg_temp.id('01'),'fifth','authenticated_member',gen_random_uuid());
select pg_temp.ok(exists(select 1 from public.conversation_messages where conversation_id=pg_temp.id('40')and seq=5),'The message is stored although its signal insert failed');
select pg_temp.ok(pg_temp.signals('03','staff_thread')>=2,'Other signals of the same write still go');
alter table public.realtime_signals drop constraint realtime_signals_check_block;

-- 8. Retention ---------------------------------------------------------------------------------------------------------------
insert into public.realtime_signals(recipient_user_id,kind,ref_id,created_at)values(pg_temp.id('01'),'member_thread',null,now()-interval '3 days'),(pg_temp.id('01'),'member_thread',null,now()-interval '1 day');
set local role service_role;
select pg_temp.ok((public.realtime_signals_prune(5000))->>'deleted'='1','Only signals older than two days are deleted');
reset role;
select pg_temp.ok(exists(select 1 from public.realtime_signals where created_at<now()-interval '20 hours'),'A one-day-old signal stays');
select pg_temp.ok((select max_hits from public._rate_limit_policy('realtime_token','user'))=120,'The token route has its own limit');

rollback;
\echo 'check-realtime-signals: ok'
