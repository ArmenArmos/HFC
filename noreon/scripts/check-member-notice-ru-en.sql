-- Synthetic checks only, against an isolated migrated database. Everything rolls back.
-- Replica mode bypasses unrelated fixture triggers; notice and claim run in origin mode.
-- No delivery adapter is called and no existing template text or approval is changed.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n text)returns uuid language sql immutable as $$
 select('b1ce0000-0000-4000-8000-0000000000'||n)::uuid$$;
create function pg_temp.emit(m text,k text,tpl text default 'member.plan_ready')returns uuid language sql as $$
 select public._member_notice(pg_temp.id(m),'care',tpl,'test:ru-en:'||k,'{}','/patient/care',null)$$;
create temp table original_templates as
 select template_id,version,locale,body,approved from public.system_message_templates;
select pg_temp.ok(not has_function_privilege(r,'public._member_notice_locale(uuid,text)','execute'),
 r||' cannot call the internal locale helper')from unnest(array['anon','authenticated','service_role'])r;

set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)
 select pg_temp.id(n),'3749908'||n||'00',now()from unnest(array['01','02','03'])n;
insert into public.profiles(id,locale,ui_locale,display_name)
 select pg_temp.id(n),case when n='03'then 'en'else 'hy'end,
 case when n='01'then 'ru'end,'Synthetic notice member'from unnest(array['01','02','03'])n
 on conflict(id)do update set locale=excluded.locale,ui_locale=excluded.ui_locale;
insert into public.patient_clinical_cases(user_id)
 select pg_temp.id(n)from unnest(array['01','02','03'])n on conflict do nothing;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)
 values('noreon_ru_en',9231,600,'consent-ru-en')
 on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id(n),'member','synthetic-ru-en-'||n,public._telegram_account_ref(s),
 '+3749908'||n||'00','5588'||n,1
 from public.telegram_channel_settings s cross join unnest(array['01','02','03'])n;
insert into public.system_message_templates(template_id,version,locale,body,approved)values
 ('member.plan_ready',900,'en','Your synthetic plan is ready.',true),
 ('member.plan_ready',900,'hy','Ձեր սինթետիկ ծրագիրը պատրաստ է։',true),
 ('member.samples_collected',900,'en','Your synthetic samples have been collected.',true),
 ('member.samples_collected',900,'ru','UNAPPROVED PLACEHOLDER. Synthetic Russian draft.',false),
 ('member_notice.open_label',900,'en','Open Noreon',true),
 ('member_notice.open_label',900,'hy','Բացել Noreon-ը',true);
update public.member_notice_settings set care=true,throttle_seconds=0,hourly_cap=60;
set local session_replication_role=origin;

select pg_temp.emit(n,'plan-'||n)from unnest(array['01','02','03'])n;
select pg_temp.ok((select app_text='Your synthetic plan is ready.'and reason='queued'
 from public.member_notices where event_key='test:ru-en:plan-01'),'Russian UI gets English plan text');
select pg_temp.ok((select app_text='Ձեր սինթետիկ ծրագիրը պատրաստ է։'
 from public.member_notices where event_key='test:ru-en:plan-02'),'Armenian member keeps Armenian');
select pg_temp.ok((select app_text='Your synthetic plan is ready.'
 from public.member_notices where event_key='test:ru-en:plan-03'),'English member keeps English');
select pg_temp.ok((select count(*)=3 and bool_and(m.locale=case when n.member_id=pg_temp.id('02')then 'hy'else 'en'end)
 from public.member_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id
 where n.event_key like 'test:ru-en:plan-%'),'Telegram outbox uses the same selected language');
select pg_temp.ok(public._telegram_auth_locale(pg_temp.id('01'))='hy','other auth locale callers remain unchanged');

-- Exercise the weekly producer's approval precheck as well as _member_notice.
-- Six days in each comparison period, as in check-bp-weekly-summary.sql.
set local session_replication_role=replica;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
 select pg_temp.id(n),gen_random_uuid(),138,86,('2026-11-'||day||'T08:00:00+04:00')::timestamptz
 from unnest(array['01','02','03'])n cross join generate_series(3,8)day;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
 select pg_temp.id(n),gen_random_uuid(),128,80,('2026-10-'||day||'T08:00:00+04:00')::timestamptz
 from unnest(array['01','02','03'])n cross join generate_series(28,31)day;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
 select pg_temp.id(n),gen_random_uuid(),128,80,('2026-11-'||day||'T08:00:00+04:00')::timestamptz
 from unnest(array['01','02','03'])n cross join generate_series(1,2)day;
-- Only synthetic versions are approved. Existing Russian drafts remain untouched.
insert into public.system_message_templates(template_id,version,locale,body,approved)
 select template_id,900,locale,body,locale<>'ru' from public.system_message_templates
 where template_id='app.bp_weekly_summary'and version=1;
update public.bp_weekly_summary_settings set enabled=true,last_run_at=null;
set local session_replication_role=origin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok(not exists(select 1 from public.system_message_templates
 where template_id='app.bp_weekly_summary'and locale='ru'and approved),'weekly Russian wording is not approved');
select pg_temp.ok(public.bp_weekly_summary_run('2026-11-09T10:00:00+04:00')->>'state'='ran','weekly producer runs');
select pg_temp.ok((select app_text='Your week: average 138/86 mmHg. Change from last week: upper number +10, lower number +6 mmHg. You measured on 6 of the last 7 days. Next: measure morning and evening for the next 3 days.'
 and params->>'bp_change'=' Change from last week: upper number +10, lower number +6 mmHg.'
 and params->>'bp_next'=' Next: measure morning and evening for the next 3 days.'
 from public.member_notices where event_key='bp_weekly:'||pg_temp.id('01')||':2026-11-09'),
 'Russian UI gets an English weekly notice with English parameters despite unapproved Russian copy');
select pg_temp.ok((select app_text like 'Ձեր շաբաթը. միջին ճնշումը՝ 138/86%'
 and params->>'bp_next'=' Հաջորդ քայլը. հաջորդ 3 օրերին չափեք առավոտյան և երեկոյան։'
 from public.member_notices where event_key='bp_weekly:'||pg_temp.id('02')||':2026-11-09'),
 'weekly Armenian member keeps Armenian text and parameters');
select pg_temp.ok((select en.app_text=ru.app_text and en.params=ru.params
 from public.member_notices en join public.member_notices ru
 on ru.event_key='bp_weekly:'||pg_temp.id('01')||':2026-11-09'
 where en.event_key='bp_weekly:'||pg_temp.id('03')||':2026-11-09'),
 'weekly English member keeps English text and parameters');
select pg_temp.ok((select count(*)=3 and bool_and(app_text is not null and telegram_message_id is null and reason='telegram_off')
 from public.member_notices where member_id in(pg_temp.id('01'),pg_temp.id('02'),pg_temp.id('03'))
 and template_id='app.bp_weekly_summary'),'weekly summaries stay app-only for all three locales');
select pg_temp.ok((select count(*)=3 from public.bp_weekly_trends
 where member_id in(pg_temp.id('01'),pg_temp.id('02'),pg_temp.id('03'))and week_start='2026-11-09'),
 'weekly producer persists a trend for each locale');

-- Collection notices already permit Russian rows. Use that template to exercise the
-- future-approved branch without widening the production locale constraint for plan_ready.
select pg_temp.emit('01','draft-ru','member.samples_collected');
select pg_temp.ok((select app_text='Your synthetic samples have been collected.'
 from public.member_notices where event_key='test:ru-en:draft-ru'),'unapproved Russian draft falls back to English');
set local session_replication_role=replica;
insert into public.system_message_templates(template_id,version,locale,body,approved)values
 ('member.samples_collected',901,'ru','Ваши синтетические образцы взяты.',true);
set local session_replication_role=origin;
select pg_temp.emit('01','approved-ru','member.samples_collected');
select pg_temp.ok((select n.app_text='Ваши синтетические образцы взяты.'and m.locale='ru'and m.template_version=901
 from public.member_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id
 where n.event_key='test:ru-en:approved-ru'),'approved Russian template wins for its template id');
select pg_temp.emit('01','plan-after-ru');
select pg_temp.ok((select app_text='Your synthetic plan is ready.'
 from public.member_notices where event_key='test:ru-en:plan-after-ru'),'Russian approval for another template does not change the plan language');

-- Fallback must not bypass the existing latest-version approval hold or strip the
-- label in the Telegram outbox. Chat's presentation-only strip is unrelated to claim.
set local session_replication_role=replica;
insert into public.system_message_templates(template_id,version,locale,body,approved)values
 ('member.plan_ready',901,'en','UNAPPROVED PLACEHOLDER. Your synthetic replacement plan.',false);
set local session_replication_role=origin;
select pg_temp.emit('01','unapproved-en');
select pg_temp.ok((select n.app_text is null and m.locale='en'and m.template_version=901
 and m.body='UNAPPROVED PLACEHOLDER. Your synthetic replacement plan.'
 from public.member_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id
 where n.event_key='test:ru-en:unapproved-en'),'unapproved English fallback stays out of chat and keeps its outbox label');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok(public.telegram_auth_message_claim(
 (select telegram_message_id from public.member_notices where event_key='test:ru-en:unapproved-en'),
 gen_random_uuid())->>'code'='template_unapproved','unapproved prefixed fallback is held at claim');
select pg_temp.ok((select m.state='held'and m.reason='template_unapproved'
 from public.member_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id
 where n.event_key='test:ru-en:unapproved-en'),'claim persists the unapproved hold');
select pg_temp.ok(not exists(select * from original_templates except
 select template_id,version,locale,body,approved from public.system_message_templates),
 'existing template text and approval states are untouched');
rollback;
\echo 'check-member-notice-ru-en: all passed'
