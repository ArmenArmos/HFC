-- Fictional data only, rolled back. Run against an isolated replay, never hosted data.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin
 if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.id(n int)returns uuid language sql immutable as $$select('b9a00000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function pg_temp.at(day int,hhmm text default '10:00')returns timestamptz language sql immutable as $$
 select('2026-11-'||lpad(day::text,2,'0')||'T'||hhmm||':00+04:00')::timestamptz$$;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select pg_temp.ok((select not enabled and last_run_at is null from public.bp_weekly_summary_settings),'default off and never run');
select pg_temp.ok(not has_table_privilege('anon','public.bp_weekly_trends','select')and not has_table_privilege('authenticated','public.bp_weekly_trends','select'),'browsers have no trend table grant');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.bp_weekly_trends'::regclass),'RLS enabled');
select pg_temp.ok(not exists(select 1 from pg_policies where schemaname='public'and tablename='bp_weekly_trends'),'no browser RLS policies');
select pg_temp.ok(has_table_privilege('service_role','public.bp_weekly_trends','select'),'part B service can read trends');
select pg_temp.ok(not has_function_privilege('authenticated','public.bp_weekly_summary_run(timestamptz)','execute')and not has_function_privilege('anon','public.bp_weekly_summary_run(timestamptz)','execute')and has_function_privilege('service_role','public.bp_weekly_summary_run(timestamptz)','execute'),'sweep is service-only');

set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.id(n),'374990088'||lpad(n::text,2,'0'),now()from generate_series(1,14)n;
insert into public.profiles(id,locale,ui_locale,display_name)
 select pg_temp.id(n),case when n in(7,8)then 'hy'else 'en'end,case when n=7 then 'ru'end,'Synthetic BP member'
 from generate_series(1,14)n on conflict(id)do update set locale=excluded.locale,ui_locale=excluded.ui_locale;
insert into public.patient_clinical_cases(user_id)select pg_temp.id(n)from generate_series(1,14)n on conflict do nothing;
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.id(2),'admin','Synthetic admin');
insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref)
 values(pg_temp.id(3),'message','synthetic','synthetic','synthetic','synthetic');
insert into public.telegram_auth_audit(auth_user_id,kind,detail)values(pg_temp.id(4),'binding.revoked','{"reason":"member_unlinked"}');
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('synthetic_bp_weekly',99152,600,'synthetic')
 on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id;
insert into public.telegram_auth_bindings(auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id(n),'member','synthetic-weekly-'||n,public._telegram_account_ref(s),'+374990088'||lpad(n::text,2,'0'),'559900'||n,1
 from public.telegram_channel_settings s cross join unnest(array[1,7,10,14])n;
-- 1 connected EN, 2 staff, 3 urgent, 4 notices off, 5 few readings, 6 only one day,
-- 7 connected RU, 8 app-only HY, 9 quiet, 10 no previous, 11 catches up Tuesday, 12 clinic staff,
-- 13 becomes urgent while the candidate cursor is open, 14 is capped then catches up.
insert into public.workspace_clinics(id,name,address)values(pg_temp.id(90),'Synthetic clinic','Synthetic street');
insert into public.clinic_portal_memberships(user_id,clinic_id,display_name,role)values(pg_temp.id(12),pg_temp.id(90),'Synthetic clinic staff','staff');
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
 select pg_temp.id(n),gen_random_uuid(),case when day>=3 then 138 else 128 end,case when day>=3 then 86 else 80 end,pg_temp.at(day,'08:00')
 from generate_series(1,14)n cross join unnest(array[1,2,3,4,5,6,7,8])day
 where (n<>5 or day in(7,8))and(n<>6 or day=8)and(n<>10 or day>=3)and n<>11;
-- Both comparison periods are present for HY; midday is not part of either period.
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values
 (pg_temp.id(8),gen_random_uuid(),134,82,pg_temp.at(5,'16:00')),
 (pg_temp.id(8),gen_random_uuid(),134,82,pg_temp.at(6,'23:59'));
-- Single-day fixture has enough readings, so it fails only the day count.
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
 select pg_temp.id(6),gen_random_uuid(),138,86,pg_temp.at(8,'09:00')from generate_series(1,3);
-- Complete previous week: Oct 28..31. Nov 1/2 above are also in previous, all 128/80.
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
 select pg_temp.id(n),gen_random_uuid(),128,80,('2026-10-'||day||'T08:00:00+04:00')::timestamptz
 from generate_series(1,14)n cross join generate_series(28,31)day where n not in(5,6,10,11);
-- Monday has two readings; Tuesday gains the third on a second day.
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values
 (pg_temp.id(11),gen_random_uuid(),130,80,pg_temp.at(9,'08:00')),
 (pg_temp.id(11),gen_random_uuid(),130,80,pg_temp.at(9,'08:10')),
 (pg_temp.id(11),gen_random_uuid(),130,80,pg_temp.at(10,'08:00'));
insert into public.patient_reminder_preferences(user_id,preferences)values(pg_temp.id(9),'{"quietStart":"09:00","quietEnd":"10:00"}');
-- Approve fixture versions only, retaining the actual draft body. No changes to draft approval.
insert into public.system_message_templates(template_id,version,locale,body,approved)
 select template_id,900,locale,body,true from public.system_message_templates
 where template_id='app.bp_weekly_summary'and version=1;
-- Same boundary cases as the pure TypeScript rule.
insert into auth.users(id)values(pg_temp.id(99));
create function pg_temp.trend(s int,d int,ps int,n int default 4,pn int default 4)returns jsonb language plpgsql as $$begin
 delete from public.patient_measurements where user_id=pg_temp.id(99);
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
  select pg_temp.id(99),gen_random_uuid(),s,d,pg_temp.at(5+i%4,'08:00')from generate_series(0,n-1)i;
 insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
  select pg_temp.id(99),gen_random_uuid(),ps,75,('2026-10-'||(28+i%4)||'T08:00:00+04:00')::timestamptz from generate_series(0,pn-1)i;
 return public._bp_weekly_trend(pg_temp.id(99),pg_temp.at(9));
end$$;
select pg_temp.ok(pg_temp.trend(135,85,126)->>'trend'='stable','9 mmHg stable');
select pg_temp.ok(pg_temp.trend(135,85,125)->>'trend'='worsening','10 mmHg and 135/85 worsening');
select pg_temp.ok(pg_temp.trend(134,84,124)->>'trend'='stable','134/84 below either yellow cut');
select pg_temp.ok(pg_temp.trend(135,84,125)->>'trend'='worsening','systolic cut alone');
select pg_temp.ok(pg_temp.trend(134,85,124)->>'trend'='worsening','diastolic cut alone');
select pg_temp.ok(pg_temp.trend(135,85,125,3)->>'trend'='stable','3 current insufficient for trend');
select pg_temp.ok(pg_temp.trend(135,85,125,4,3)->>'trend'='stable','3 previous insufficient for trend');
select pg_temp.ok(pg_temp.trend(115,75,125)->>'trend'='improving','minus 10 improving');
select pg_temp.ok(pg_temp.trend(116,75,125)->>'trend'='stable','minus 9 stable');
select pg_temp.ok(pg_temp.trend(135,85,125,4,2)->'change'='null'::jsonb,'two previous no change line');
select pg_temp.ok(pg_temp.trend(135,85,125,4,3)->'change'=jsonb_build_object('systolic',10,'diastolic',10),'three previous enables change');
select pg_temp.trend(135,85,125,5,5);
update public.patient_measurements set systolic=systolic+1 where id in(
 select distinct on ((measured_at at time zone 'Asia/Yerevan')::date<'2026-11-03'::date)id
 from public.patient_measurements where user_id=pg_temp.id(99)
 order by (measured_at at time zone 'Asia/Yerevan')::date<'2026-11-03'::date,id);
select pg_temp.ok(public._bp_weekly_trend(pg_temp.id(99),pg_temp.at(9))->>'trend'='worsening','exact 135.2 minus 125.2 is 10');
select pg_temp.ok(pg_temp.trend(135,85,125,2)is null,'two readings silent');
select pg_temp.ok(pg_temp.trend(135,85,125,3)->>'nextStep'='mornings','sparse days get morning step');
select pg_temp.ok(pg_temp.trend(135,85,125)->>'nextStep'='twice_daily','worsening on four days gets twice-daily step');
select pg_temp.ok(pg_temp.trend(125,80,125)->>'nextStep'='keep','stable regular days keeps mornings');
delete from public.patient_measurements where user_id=pg_temp.id(99);
set local session_replication_role=origin;
update public.member_notice_settings set care=true,throttle_seconds=0,hourly_cap=1;
insert into public.system_message_templates(template_id,version,locale,body,approved)values('member.samples_at_lab',900,'en','Your synthetic notice.',true);
select public._member_notice(pg_temp.id(14),'care','member.samples_at_lab','weekly_test:cap14','{}','/patient/chat',null);
-- Model a committed alert appearing after candidate selection but before that member is visited.
create function pg_temp.later_alert()returns trigger language plpgsql as $$begin
 if new.template_id='app.bp_weekly_summary'and new.member_id=pg_temp.id(1)then
  insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref)
   values(pg_temp.id(13),'message','synthetic_later','synthetic','synthetic','synthetic_later');
 end if;
 return new;
end$$;
create trigger bp_weekly_test_later_alert after insert on public.member_notices for each row execute function pg_temp.later_alert();
select pg_temp.ok(public.bp_weekly_summary_run(pg_temp.at(9))->>'state'='off','DB switch off');
select pg_temp.ok((select last_run_at is null from public.bp_weekly_summary_settings),'off does not consume day');
update public.bp_weekly_summary_settings set enabled=true;
update public.member_notice_settings set care=false;
select pg_temp.ok(public.bp_weekly_summary_run(pg_temp.at(9))->>'state'='off','care switch off');
update public.member_notice_settings set care=true;
select pg_temp.ok(public.bp_weekly_summary_run(pg_temp.at(9,'08:59'))->>'state'='outside_window','before 09:00');
select pg_temp.ok(public.bp_weekly_summary_run(pg_temp.at(9,'11:00'))->>'state'='outside_window','11:00 is excluded');
select pg_temp.ok(public.bp_weekly_summary_run(pg_temp.at(9,'09:00'))->>'state'='ran','09:00 is included');
select pg_temp.ok(public.bp_weekly_summary_run(pg_temp.at(9,'09:10'))->>'state'='already_ran','sweeps are spaced 15 minutes apart');
select pg_temp.ok((select count(*)=1 from public.member_notices where event_key='bp_weekly:'||pg_temp.id(1)||':2026-11-09'),'once per event key');
select pg_temp.ok((select this_mean_sys=138 and this_mean_dia=86 and previous_mean_sys=128 and previous_mean_dia=80 and readings_this=6 and readings_previous=6 and days_measured=6 and trend='worsening'
 from public.bp_weekly_trends where member_id=pg_temp.id(1)),'persisted means, counts and worsening flag');
select pg_temp.ok(not exists(select 1 from public.bp_weekly_trends where member_id in(pg_temp.id(2),pg_temp.id(3),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(9),pg_temp.id(11),pg_temp.id(12))),'staff, clinic staff, urgent, opt-out, few, single-day, quiet and incomplete skipped');
select pg_temp.ok(not exists(select 1 from public.member_notices where member_id in(pg_temp.id(2),pg_temp.id(3),pg_temp.id(4),pg_temp.id(5),pg_temp.id(6),pg_temp.id(9),pg_temp.id(11),pg_temp.id(12))),'skipped members have no empty or alarm notice');
select pg_temp.ok((select app_text like 'Ձեր շաբաթը%'and telegram_message_id is null from public.member_notices where member_id=pg_temp.id(8)),'unbound member gets app summary');
select pg_temp.ok((select app_text like 'Ваша неделя%'from public.member_notices where member_id=pg_temp.id(7)and template_id='app.bp_weekly_summary'),'Russian UI gets the Russian summary');
select pg_temp.ok((select app_text not like '%Change from last week%'from public.member_notices where member_id=pg_temp.id(10)),'no previous week gives no change line');
select pg_temp.ok((select previous_mean_sys is null and readings_previous=0 from public.bp_weekly_trends where member_id=pg_temp.id(10)),'no previous week remains unknown');
select pg_temp.ok((select app_text like '%Առավոտյան՝ 138/86, երեկոյան՝ 134/82%'from public.member_notices where member_id=pg_temp.id(8)),'morning and evening means render in Armenian');
-- Claim the actual fixed template, through existing channel machinery.
-- App only: connected members too get no Telegram message and no push, so readings never leave the app.
select pg_temp.ok(not exists(select 1 from public.telegram_auth_messages where template_id='app.bp_weekly_summary'),'no Telegram message is queued for any summary');
select pg_temp.ok((select bool_and(telegram_message_id is null and reason='telegram_off'and app_text is not null)from public.member_notices where template_id='app.bp_weekly_summary'and member_id in(pg_temp.id(1),pg_temp.id(7),pg_temp.id(10),pg_temp.id(14))),'connected members get the app summary only');
select pg_temp.ok(not exists(select 1 from public.member_notices where template_id='app.bp_weekly_summary'and app_text~*'doctor|care team|diagnos|103|—|!|բժիշկ|վրաչ|врач|диагноз'),'no doctor action, diagnosis or alarm');
select pg_temp.ok(not exists(select 1 from public.member_notices where member_id in(pg_temp.id(13),pg_temp.id(14))and template_id='app.bp_weekly_summary'),'late urgent and capped members leave no weekly key');
select pg_temp.ok(not exists(select 1 from public.bp_weekly_trends where member_id in(pg_temp.id(13),pg_temp.id(14))),'late urgent and capped members leave no trend');
-- An alert after enqueue closes the app item.
select pg_temp.ok(not public._member_notice_closed(pg_temp.id(10),'bp_weekly:'||pg_temp.id(10)||':2026-11-09','app.bp_weekly_summary','{}'),'summary initially open');
insert into public.care_alerts(member_id,source,reason_code,rule_id,rule_version,source_ref)
 values(pg_temp.id(10),'message','synthetic_after','synthetic','synthetic','synthetic_after');
select pg_temp.ok(public._member_notice_closed(pg_temp.id(10),'bp_weekly:'||pg_temp.id(10)||':2026-11-09','app.bp_weekly_summary','{}'),'new urgent alert closes app item');
-- A member skipped for quiet hours at 09:00 is visited again once they end at 10:00, in the same window, without a second summary.
select pg_temp.ok(public.bp_weekly_summary_run(pg_temp.at(9,'10:30'))->>'state'='ran','a later sweep in the same window runs');
select pg_temp.ok((select count(*)=1 from public.bp_weekly_trends where member_id=pg_temp.id(9)),'quiet until 10:00 member is reached at 10:30');
select pg_temp.ok((select count(*)=1 from public.member_notices where member_id=pg_temp.id(1)and template_id='app.bp_weekly_summary'),'a second sweep never duplicates the week');
update public.member_notice_settings set hourly_cap=60;
delete from public.patient_reminder_preferences where user_id=pg_temp.id(9);
select pg_temp.ok(public.bp_weekly_summary_run(pg_temp.at(10))->>'state'='ran','Tuesday catch-up');
select pg_temp.ok((select count(*)=1 from public.bp_weekly_trends where member_id=pg_temp.id(14)),'capped member catches up after capacity is available');
-- Delivery waits for quiet hours that begin after the summary was queued, and goes out after they end.
select pg_temp.ok((select count(*)=1 from public.bp_weekly_trends where member_id=pg_temp.id(11)),'previously insufficient member catches up');
select pg_temp.ok((select count(*)=1 from public.bp_weekly_trends where member_id=pg_temp.id(9)),'quiet member catches up when outside quiet hours on a later run');
select pg_temp.ok((select count(*)=1 from public.member_notices where member_id=pg_temp.id(1)and template_id='app.bp_weekly_summary'),'later day never duplicates the week');
do $$begin
 insert into public.bp_weekly_trends select * from public.bp_weekly_trends where member_id=pg_temp.id(1);
 raise exception 'FAIL: duplicate trend accepted';exception when unique_violation then null;end$$;
select pg_temp.ok(not public._member_notice_params_ok('{"bp_sys":"138"}'),'incomplete weekly params refused');
select pg_temp.ok(not public._member_notice_params_ok('{"clinic":"{inject}"}'),'existing visit safety retained');
set local role authenticated;
do $$begin perform 1 from public.bp_weekly_trends;raise exception 'FAIL: browser read trends';exception when insufficient_privilege then null;end$$;
reset role;
set local role anon;
do $$begin perform 1 from public.bp_weekly_trends;raise exception 'FAIL: anonymous read trends';exception when insufficient_privilege then null;end$$;
reset role;
rollback;
