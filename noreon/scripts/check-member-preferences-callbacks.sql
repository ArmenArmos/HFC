-- Member preferences (text size, contact channel and times) and callback requests: RLS (a
-- member reads only their own rows and writes only through the functions), validation, the
-- dark switch, one open request and the daily limit, member cancel, the admin-only queue and
-- close, and the admin Telegram notice (only when the staff notice path is on, enrolled
-- active admins only, held at claim while unapproved, never undoing the request).
-- Synthetic fixtures, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_member(m text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_cb",9021,"user",%s]',u)$$;
create function pg_temp.bind(m uuid,u bigint)returns jsonb language sql as $$
 select public._telegram_auth_bind(m,'staff',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null)$$;
create function pg_temp.raises(sql text,code text)returns boolean language plpgsql as $$begin execute sql;return false;exception when others then return sqlstate=code;end$$;
grant execute on function pg_temp.raises(text,text) to authenticated;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;
-- Start from the dark defaults whatever the database holds (rolled back).
delete from public.member_callback_settings;delete from public.staff_message_notice_settings;delete from public.member_callback_requests;

-- Members M1, M2 (registered), M3 (no name). Admins A1 (enrolled), A2 (not enrolled), A3 (enrolled, deactivated). Doctor D1 (enrolled).
insert into auth.users(id,phone,phone_confirmed_at)values
 ('5f000000-0000-4000-8000-000000000001','37499018001',now()),('5f000000-0000-4000-8000-000000000002','37499018002',now()),
 ('5f000000-0000-4000-8000-000000000003','37499018003',now()),
 ('5f000000-0000-4000-8000-000000000021','37499018021',now()),('5f000000-0000-4000-8000-000000000022','37499018022',now()),
 ('5f000000-0000-4000-8000-000000000023','37499018023',now()),('5f000000-0000-4000-8000-000000000011','37499018011',now());
update public.profiles set display_name='Synthetic Member One'where id='5f000000-0000-4000-8000-000000000001';
update public.profiles set display_name='Synthetic Member Two'where id='5f000000-0000-4000-8000-000000000002';
insert into public.workspace_clinics(id,name)values('5f000000-0000-4000-8000-000000000030','Synthetic callback clinic');
insert into public.workspace_staff(user_id,role,display_name)values
 ('5f000000-0000-4000-8000-000000000021','admin','Admin Cb One'),('5f000000-0000-4000-8000-000000000022','admin','Admin Cb Two'),
 ('5f000000-0000-4000-8000-000000000023','admin','Admin Cb Three');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('5f000000-0000-4000-8000-000000000011','doctor','Dr Cb','5f000000-0000-4000-8000-000000000030');
insert into auth.sessions(id,user_id,created_at,updated_at)values
 ('5f000000-0000-4000-8000-000000000041','5f000000-0000-4000-8000-000000000021',now(),now()),
 ('5f000000-0000-4000-8000-000000000042','5f000000-0000-4000-8000-000000000011',now(),now());
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_cb',9021,600,'consent-cb');
select pg_temp.bind('5f000000-0000-4000-8000-000000000021',8821),pg_temp.bind('5f000000-0000-4000-8000-000000000023',8823),pg_temp.bind('5f000000-0000-4000-8000-000000000011',8811);
update public.workspace_staff set active=false where user_id='5f000000-0000-4000-8000-000000000023';

-- 1. Preferences: defaults, partial saves, validation, own rows only.
select pg_temp.as_member('5f000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok((select public.member_contact_status()->>'textSize')='normal'and(select public.member_contact_status()->>'callbacksEnabled')='false','Defaults before any save');
select public.save_member_preferences(p_text_size=>'large');
select pg_temp.ok((select text_size from public.member_preferences)='large'and(select contact_channel from public.member_preferences)='telegram','Text size saved alone');
select public.save_member_preferences(p_contact_channel=>'phone',p_contact_times=>array['evening','morning','evening']);
select pg_temp.ok((select text_size from public.member_preferences)='large'and(select contact_times from public.member_preferences)=array['evening','morning'],'Contact saved; text size kept; times de-duplicated');
select public.save_member_preferences(p_contact_times=>'{}');
select pg_temp.ok((select contact_times from public.member_preferences)='{}'and(select contact_channel from public.member_preferences)='phone','Empty times clear; channel kept');
select public.save_member_preferences(p_contact_times=>array['morning']);
select pg_temp.ok(pg_temp.raises($q$select public.save_member_preferences(p_text_size=>'huge')$q$,'23514'),'Unknown text size refused');
select pg_temp.ok(pg_temp.raises($q$select public.save_member_preferences(p_contact_channel=>'sms')$q$,'23514'),'SMS is not a contact channel');
select pg_temp.ok(pg_temp.raises($q$select public.save_member_preferences(p_contact_times=>array['night'])$q$,'23514'),'Unknown time refused');
select pg_temp.ok(pg_temp.raises($q$insert into public.member_preferences(user_id)values('5f000000-0000-4000-8000-000000000002')$q$,'42501'),'No direct insert');
select pg_temp.ok(pg_temp.raises($q$update public.member_preferences set text_size='xlarge'$q$,'42501'),'No direct update');
reset role;
select pg_temp.as_member('5f000000-0000-4000-8000-000000000002');set local role authenticated;
select pg_temp.ok((select count(*)from public.member_preferences)=0,'M2 cannot read M1 preferences');
reset role;
select pg_temp.as_member('5f000000-0000-4000-8000-000000000003');set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.save_member_preferences(p_text_size=>'large')$q$,'42501'),'Member without a profile name refused');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.raises($q$select public.member_contact_status()$q$,'42501'),'Anon cannot call member functions');
reset role;

-- 2. Dark: no settings row, then enabled=false.
select pg_temp.as_member('5f000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok((select public.member_request_callback('nurse')->>'code')='unavailable','Off (no row): refused');
reset role;
insert into public.member_callback_settings(enabled)values(false);
select pg_temp.as_member('5f000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok((select public.member_request_callback('nurse')->>'code')='unavailable','Off (enabled=false): refused');
reset role;
select pg_temp.ok(not exists(select 1 from public.member_callback_requests),'Off: nothing recorded');

-- 3. On, staff notice path off: request recorded with the preference copied; no notice.
update public.member_callback_settings set enabled=true;
select pg_temp.as_member('5f000000-0000-4000-8000-000000000001');set local role authenticated;
insert into kv values('r1',public.member_request_callback('nurse'));
select pg_temp.ok((select v->>'result'from kv where k='r1')='created','Request created');
select pg_temp.ok((select public.member_contact_status()->'openRequest'->>'requestedFrom')='nurse','Member sees their open request');
select pg_temp.ok((select public.member_request_callback('care_team')->>'result')='already_open','Second request returns the open one');
select pg_temp.ok(pg_temp.raises($q$select public.member_request_callback('doctor')$q$,'23514'),'Unknown requester refused');
reset role;
select pg_temp.ok((select contact_channel='phone'and contact_times=array['morning']and requested_from='nurse'from public.member_callback_requests),'Preference copied onto the request');
select pg_temp.ok((select count(*)from public.member_callback_requests)=1,'Only one open request');
select pg_temp.ok(not exists(select 1 from public.telegram_auth_messages where template_id='callback_request.notice'),'Notice path off: no notice');
select pg_temp.as_member('5f000000-0000-4000-8000-000000000002');set local role authenticated;
select pg_temp.ok((select count(*)from public.member_callback_requests)=0,'M2 cannot read M1 requests');
select pg_temp.ok((select public.member_cancel_callback((select (v->>'id')::uuid from kv where k='r1'))->>'code')='not_open','M2 cannot cancel M1 request');
select pg_temp.ok(pg_temp.raises($q$select public.staff_callback_queue()$q$,'42501'),'Member cannot read the admin queue');
reset role;

-- 4. Member cancels; daily limit.
select pg_temp.as_member('5f000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok((select public.member_cancel_callback((select (v->>'id')::uuid from kv where k='r1'))->>'ok')='true','Member cancels own request');
select pg_temp.ok((select public.member_contact_status()->'openRequest')='null'::jsonb,'No open request after cancel');
select public.member_cancel_callback((select (public.member_request_callback('care_team')->>'id')::uuid));
select pg_temp.ok((select public.member_request_callback('nurse')->>'result')='created','Third request today allowed');
reset role;
update public.member_callback_requests set state='cancelled',outcome='cancelled_by_member',closed_by=member_id,closed_by_role='member',closed_at=clock_timestamp()where state='open';
select pg_temp.as_member('5f000000-0000-4000-8000-000000000001');set local role authenticated;
select pg_temp.ok((select public.member_request_callback('nurse')->>'code')='rate_limited','Fourth request in 24 hours refused');
reset role;

-- 5. Staff notice path on: active enrolled admins only, link to the queue, held while unapproved.
insert into public.staff_message_notice_settings(enabled)values(true);
select pg_temp.as_member('5f000000-0000-4000-8000-000000000002');set local role authenticated;
insert into kv values('r2',public.member_request_callback('care_team'));
reset role;
select pg_temp.ok((select count(*)from public.telegram_auth_messages where template_id='callback_request.notice')=1,'One notice queued');
select pg_temp.ok((select address from public.telegram_auth_messages where template_id='callback_request.notice')='8821','Only the active enrolled admin');
select pg_temp.ok((select keyboard->>'url'from public.telegram_auth_messages where template_id='callback_request.notice')='https://backoffice.noreon.health/staff/real/callbacks','Button opens the queue');
select pg_temp.ok((select body not like '%Synthetic%'from public.telegram_auth_messages where template_id='callback_request.notice'),'No member name in the notice');
select pg_temp.ok((select count(*)from public.member_callback_notices)=1,'Notice recorded');
insert into kv select 'notice',to_jsonb(id)from public.telegram_auth_messages where template_id='callback_request.notice';
select set_config('request.jwt.claims','{"role":"service_role"}',true);set local role service_role;
insert into kv values('claim',public.telegram_auth_message_claim((select (v#>>'{}')::uuid from kv where k='notice'),gen_random_uuid()));
reset role;
select pg_temp.ok((select v->>'code'from kv where k='claim')='template_unapproved','Held at claim while unapproved');
-- Throttle (Fable F2): a second request within throttle_seconds does not notify the same admin again.
update public.member_callback_settings set daily_limit=10;
update public.member_callback_requests set state='done',outcome='reached',closed_by='5f000000-0000-4000-8000-000000000021',closed_by_role='admin',closed_at=clock_timestamp()
 where member_id='5f000000-0000-4000-8000-000000000002'and state='open';
select pg_temp.as_member('5f000000-0000-4000-8000-000000000002');set local role authenticated;
select pg_temp.ok((select public.member_request_callback('nurse')->>'result')='created','Second request created');
reset role;
select pg_temp.ok((select count(*)from public.telegram_auth_messages where template_id='callback_request.notice')=1,'Throttled: still one notice');
-- A failing notice never undoes the request (earlier notices aged past the throttle first).
update public.member_callback_notices set created_at=created_at-interval '1 hour';
alter table public.member_callback_notices add constraint pg_temp_fail check(false) not valid;
update public.member_callback_requests set state='done',outcome='reached',closed_by='5f000000-0000-4000-8000-000000000021',closed_by_role='admin',closed_at=clock_timestamp()
 where member_id='5f000000-0000-4000-8000-000000000002'and state='open';
select pg_temp.as_member('5f000000-0000-4000-8000-000000000002');set local role authenticated;
select pg_temp.ok((select public.member_request_callback('nurse')->>'result')='created','Request kept when the notice fails');
reset role;
alter table public.member_callback_notices drop constraint pg_temp_fail;

-- 6. Admin queue and close: current admin session only; doctors refused.
update public.profiles set display_name='Dr Cb'where id='5f000000-0000-4000-8000-000000000011';
select pg_temp.as_staff('5f000000-0000-4000-8000-000000000011','5f000000-0000-4000-8000-000000000042');set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.staff_callback_queue()$q$,'42501'),'Doctor cannot read the queue');
select pg_temp.ok(pg_temp.raises($q$select public.member_request_callback('nurse')$q$,'42501'),'Staff account cannot request a callback as a member (F1)');
select pg_temp.ok(pg_temp.raises($q$select public.save_member_preferences(p_text_size=>'large')$q$,'42501'),'Staff account cannot save member preferences (F1)');
reset role;
select pg_temp.as_staff('5f000000-0000-4000-8000-000000000021','5f000000-0000-4000-8000-000000000099');set local role authenticated;
select pg_temp.ok(pg_temp.raises($q$select public.staff_callback_queue()$q$,'42501'),'Admin without a current session refused');
reset role;
select pg_temp.as_staff('5f000000-0000-4000-8000-000000000021','5f000000-0000-4000-8000-000000000041');set local role authenticated;
insert into kv values('q',public.staff_callback_queue());
select pg_temp.ok((select jsonb_array_length(v)from kv where k='q')>=5,'Admin sees open and recent requests');
select pg_temp.ok((select v->0->>'state'from kv where k='q')='open'and(select v->0->>'memberName'from kv where k='q')='Synthetic Member Two','Open first, with name');
select pg_temp.ok(pg_temp.raises($q$select public.staff_callback_close((select (v->0->>'id')::uuid from kv where k='q'),'cancelled_by_member')$q$,'23514'),'Admin cannot record a member cancel');
select pg_temp.ok((select public.staff_callback_close((select (v->0->>'id')::uuid from kv where k='q'),'no_answer')->>'ok')='true','Admin closes a request');
select pg_temp.ok((select public.staff_callback_close((select (v->0->>'id')::uuid from kv where k='q'),'reached')->>'code')='not_open','Closing twice refused');
reset role;
select pg_temp.ok((select closed_by_role='admin'and state='done'from public.member_callback_requests where outcome='no_answer'),'Close recorded with role');

rollback;
\echo 'member preferences and callbacks: ok'
