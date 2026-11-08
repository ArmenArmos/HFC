-- Weekly home BP summary, part A, DRAFT for Armen. No doctor action or AI call.
-- The CLI created this migration stamp; the integrator assigns its final ordering.
create table public.bp_weekly_summary_settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 last_run_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.bp_weekly_summary_settings(singleton)values(true);
create table public.bp_weekly_trends(
 member_id uuid not null references auth.users(id)on delete cascade,
 week_start date not null check(extract(isodow from week_start)=1),
 this_mean_sys integer not null,
 this_mean_dia integer not null,
 previous_mean_sys integer,
 previous_mean_dia integer,
 readings_this integer not null check(readings_this>=3),
 readings_previous integer not null check(readings_previous>=0),
 days_measured integer not null check(days_measured between 2 and 7),
 trend text not null check(trend in('worsening','stable','improving')),
 created_at timestamptz not null default clock_timestamp(),
 primary key(member_id,week_start),
 check((previous_mean_sys is null)=(previous_mean_dia is null))
);
alter table public.bp_weekly_summary_settings enable row level security;
alter table public.bp_weekly_trends enable row level security;
revoke all on public.bp_weekly_summary_settings,public.bp_weekly_trends from public,anon,authenticated,service_role;
grant select on public.bp_weekly_trends to service_role;
-- No browser policies. Part B may read these rows as service role.

-- SQL transcription of bp-trend.ts. The JSON cuts and words are pinned against TypeScript
-- by scripts/check-bp-trend.ts; SQL execution cases are in check-bp-weekly-summary.sql.
create function public._bp_weekly_trend(p_member uuid,p_now timestamptz)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare cuts constant jsonb:='{"elevatedSystolic":135,"elevatedDiastolic":85,"bpTrendWindowDays":7,"bpTrendSummaryReadings":3,"bpTrendSummaryDays":2,"bpTrendComparisonReadings":3,"bpTrendMinReadings":4,"bpTrendChangeSystolic":10,"bpTrendPeriodReadings":2,"bpTrendMorningEndHour":12,"bpTrendEveningStartHour":16,"bpTrendRegularDays":4,"bpTrendNextDays":3}'::jsonb;
 today date:=(p_now at time zone 'Asia/Yerevan')::date; first_day date;
 a record;flag text:='stable';old_mean jsonb;delta jsonb;am jsonb;pm jsonb;
begin
 first_day:=today+1-(cuts->>'bpTrendWindowDays')::int;
 select count(*)filter(where local_day>=first_day)n,count(*)filter(where local_day<first_day)pn,
  count(distinct local_day)filter(where local_day>=first_day)days,
  sum(systolic)filter(where local_day>=first_day)ss,sum(systolic)filter(where local_day<first_day)pss,
  avg(systolic)filter(where local_day>=first_day)s,avg(diastolic)filter(where local_day>=first_day)d,
  avg(systolic)filter(where local_day<first_day)ps,avg(diastolic)filter(where local_day<first_day)pd,
  count(*)filter(where local_day>=first_day and local_hour<(cuts->>'bpTrendMorningEndHour')::int)an,
  count(*)filter(where local_day>=first_day and local_hour>=(cuts->>'bpTrendEveningStartHour')::int)en,
  avg(systolic)filter(where local_day>=first_day and local_hour<(cuts->>'bpTrendMorningEndHour')::int)ams,
  avg(diastolic)filter(where local_day>=first_day and local_hour<(cuts->>'bpTrendMorningEndHour')::int)amd,
  avg(systolic)filter(where local_day>=first_day and local_hour>=(cuts->>'bpTrendEveningStartHour')::int)pms,
  avg(diastolic)filter(where local_day>=first_day and local_hour>=(cuts->>'bpTrendEveningStartHour')::int)pmd
 into a from(select m.*, (measured_at at time zone 'Asia/Yerevan')::date as local_day,
  extract(hour from measured_at at time zone 'Asia/Yerevan')as local_hour from public.patient_measurements m
  where user_id=p_member and measured_at>=((first_day-(cuts->>'bpTrendWindowDays')::int)::timestamp at time zone 'Asia/Yerevan')
   and measured_at<((today+1)::timestamp at time zone 'Asia/Yerevan')and measured_at<=p_now)r;
 if a.n<(cuts->>'bpTrendSummaryReadings')::int or a.days<(cuts->>'bpTrendSummaryDays')::int then return null;end if;
 if a.pn>0 then old_mean:=jsonb_build_object('systolic',round(a.ps)::int,'diastolic',round(a.pd)::int);end if;
 if a.pn>=(cuts->>'bpTrendComparisonReadings')::int then
  delta:=jsonb_build_object('systolic',round(a.s)::int-round(a.ps)::int,'diastolic',round(a.d)::int-round(a.pd)::int);end if;
 if a.n>=(cuts->>'bpTrendMinReadings')::int and a.pn>=(cuts->>'bpTrendMinReadings')::int then
  if a.ss::numeric*a.pn-a.pss::numeric*a.n>=(cuts->>'bpTrendChangeSystolic')::int*a.n::numeric*a.pn and(a.s>=(cuts->>'elevatedSystolic')::int or a.d>=(cuts->>'elevatedDiastolic')::int)then flag:='worsening';
  elsif a.ss::numeric*a.pn-a.pss::numeric*a.n<=-(cuts->>'bpTrendChangeSystolic')::int*a.n::numeric*a.pn then flag:='improving';end if;
 end if;
 if a.an>=(cuts->>'bpTrendPeriodReadings')::int and a.en>=(cuts->>'bpTrendPeriodReadings')::int then
  am:=jsonb_build_object('systolic',round(a.ams)::int,'diastolic',round(a.amd)::int);
  pm:=jsonb_build_object('systolic',round(a.pms)::int,'diastolic',round(a.pmd)::int);end if;
 return jsonb_build_object('weekStart',date_trunc('week',today::timestamp)::date,
  'thisMean',jsonb_build_object('systolic',round(a.s)::int,'diastolic',round(a.d)::int),'previousMean',old_mean,'change',delta,
  'morning',am,'evening',pm,'readingsThis',a.n,'readingsPrevious',a.pn,'daysMeasured',a.days,'trend',flag,
  'nextStep',case when a.days<(cuts->>'bpTrendRegularDays')::int then 'mornings'when flag='worsening'then 'twice_daily'else 'keep'end);
end$$;

create function public._bp_weekly_summary_params(p_summary jsonb,p_locale text)returns jsonb
language plpgsql immutable set search_path=''as $$
declare words constant jsonb:='{"en":{"average":"Your week: average {sys}/{dia} mmHg.","change":" Change from last week: upper number {sys}, lower number {dia} mmHg.","pattern":" Mornings {morning_sys}/{morning_dia}, evenings {evening_sys}/{evening_dia} mmHg.","days":" You measured on {days} of the last {window} days.","mornings":" Next: measure each morning for the next {next_days} days.","twice_daily":" Next: measure morning and evening for the next {next_days} days.","keep":" Next: keep measuring a few mornings a week."},"hy":{"average":"Ձեր շաբաթը. միջին ճնշումը՝ {sys}/{dia} մմ սնդ. սյուն։","change":" Փոփոխությունն անցած շաբաթվա համեմատ. վերին թիվը՝ {sys}, ստորինը՝ {dia} մմ սնդ. սյուն։","pattern":" Առավոտյան՝ {morning_sys}/{morning_dia}, երեկոյան՝ {evening_sys}/{evening_dia} մմ սնդ. սյուն։","days":" Դուք չափել եք վերջին {window} օրերից {days}-ում։","mornings":" Հաջորդ քայլը. հաջորդ {next_days} օրերին չափեք ամեն առավոտ։","twice_daily":" Հաջորդ քայլը. հաջորդ {next_days} օրերին չափեք առավոտյան և երեկոյան։","keep":" Հաջորդ քայլը. շարունակեք չափել շաբաթական մի քանի առավոտ։"},"ru":{"average":"Ваша неделя: среднее давление {sys}/{dia} мм рт. ст.","change":" Изменение за неделю: верхнее число {sys}, нижнее число {dia} мм рт. ст.","pattern":" Утром {morning_sys}/{morning_dia}, вечером {evening_sys}/{evening_dia} мм рт. ст.","days":" Вы измеряли давление в {days} из последних {window} дней.","mornings":" Следующий шаг: измеряйте каждое утро в следующие {next_days} дня.","twice_daily":" Следующий шаг: измеряйте утром и вечером в следующие {next_days} дня.","keep":" Следующий шаг: продолжайте измерять несколько раз в неделю по утрам."}}'::jsonb;
 w jsonb:=words->p_locale;change_line text:='';pattern_line text:='';c jsonb:=p_summary->'change';v jsonb;
begin
 if w is null then raise exception using errcode='22023',message='Unsupported weekly summary locale';end if;
 if c<>'null'::jsonb then
  v:=jsonb_build_object('sys',case when(c->>'systolic')::int>0 then '+'else ''end||(c->>'systolic'),
   'dia',case when(c->>'diastolic')::int>0 then '+'else ''end||(c->>'diastolic'));
  change_line:=public._member_notice_render(w->>'change',v);
 end if;
 if p_summary->'morning'<>'null'::jsonb then
  pattern_line:=public._member_notice_render(w->>'pattern',jsonb_build_object(
   'morning_sys',p_summary->'morning'->>'systolic','morning_dia',p_summary->'morning'->>'diastolic',
   'evening_sys',p_summary->'evening'->>'systolic','evening_dia',p_summary->'evening'->>'diastolic'));
 end if;
 return jsonb_build_object('bp_sys',p_summary->'thisMean'->>'systolic','bp_dia',p_summary->'thisMean'->>'diastolic',
  'bp_days',p_summary->>'daysMeasured','bp_change',change_line,'bp_pattern',pattern_line,
  'bp_next',public._member_notice_render(w->>(p_summary->>'nextStep'),jsonb_build_object('next_days','3')));
end$$;

-- Preserve the original visit params exactly. Weekly params are a separate complete shape;
-- optional fixed sentences can be empty and include their separating space.
create or replace function public._member_notice_params_ok(p jsonb)returns boolean language sql immutable set search_path=''as $$
 select p is null or case when jsonb_typeof(p)<>'object'then false
 when p ?| array['bp_sys','bp_dia','bp_days','bp_change','bp_pattern','bp_next'] then
  (p-array['bp_sys','bp_dia','bp_days','bp_change','bp_pattern','bp_next'])='{}'::jsonb
  and p ?& array['bp_sys','bp_dia','bp_days','bp_change','bp_pattern','bp_next']
  and coalesce(p->>'bp_sys'~'^[0-9]{2,3}$'and p->>'bp_dia'~'^[0-9]{2,3}$'and p->>'bp_days'~'^[2-7]$',false)
  and not exists(select 1 from jsonb_each(p)e where jsonb_typeof(e.value)<>'string'or length(e.value#>>'{}')>200 or e.value#>>'{}'~'[{}\r\n\t]')
 else (p-array['date','time','end_time','clinic','nurse'])='{}'::jsonb
  and not exists(select 1 from jsonb_each(p)e where jsonb_typeof(e.value)<>'string'or length(e.value#>>'{}')not between 1 and 80
   or e.value#>>'{}'~'[{}\r\n\t]'or e.value#>>'{}'<>btrim(e.value#>>'{}'))end
$$;

-- Russian is scoped to this summary and its existing open button. All other notice locales
-- retain the existing profiles.locale lookup. Templates remain unapproved drafts.
alter table public.system_message_templates drop constraint system_message_templates_locale_check;
alter table public.system_message_templates add constraint system_message_templates_locale_check check(locale in('en','hy')or(locale='ru'and(template_id like 'telegram.nurse.%'or template_id='app.bp_weekly_summary')));
insert into public.system_message_templates(template_id,version,locale,body)values
 ('app.bp_weekly_summary',1,'en','Your week: average {bp_sys}/{bp_dia} mmHg.{bp_change}{bp_pattern} You measured on {bp_days} of the last 7 days.{bp_next}'),
 ('app.bp_weekly_summary',1,'hy','Ձեր շաբաթը. միջին ճնշումը՝ {bp_sys}/{bp_dia} մմ սնդ. սյուն։{bp_change}{bp_pattern} Դուք չափել եք վերջին 7 օրերից {bp_days}-ում։{bp_next}'),
 ('app.bp_weekly_summary',1,'ru','Ваша неделя: среднее давление {bp_sys}/{bp_dia} мм рт. ст.{bp_change}{bp_pattern} Вы измеряли давление в {bp_days} из последних 7 дней.{bp_next}');
-- App only: average readings are health values, and the existing wording check keeps them out of Telegram and push
-- (check-member-notifications.sql). A values-free Telegram nudge is a question for Armen, not part of this PR.
insert into public.notice_channels(template_id,telegram,push)values('app.bp_weekly_summary',false,false);

-- Latest _member_notice, with only the summary-specific locale selection changed.
create or replace function public._member_notice(p_member uuid,p_group text,p_template text,p_key text,p_params jsonb,p_path text,p_step text)returns uuid
language plpgsql security definer set search_path=''as $$
declare s public.member_notice_settings;ch public.telegram_channel_settings;b public.telegram_auth_bindings;t public.system_message_templates;
 enabled boolean;why text;mid uuid;loc text;route public.notice_channels;app_txt text;
begin
 if p_member is null or p_key is null then return null;end if;
 select * into s from public.member_notice_settings where singleton;
 enabled:=case p_group when 'booking'then s.booking when 'reminders'then s.reminders when 'results'then s.results when 'care'then s.care end;
 if enabled is not true then perform public._member_notice_trace(p_member,p_template,p_key,p_group,'skipped','switched_off');return null;end if;
 -- One decision per member at a time, so the throttle and the once-per-event check cannot race.
 -- A leaf lock: nothing below waits on another lock while holding it. The reminder sweep never
 -- waits for it: a busy member is left for the next sweep (no journal row), so a booking or care
 -- command is not kept waiting behind the sweep (review F2A).
 if current_setting('noreon.member_notice_sweep',true)='on'then
  if not pg_try_advisory_xact_lock(hashtextextended('member-notice:'||p_member::text,0))then return null;end if;
 else perform pg_advisory_xact_lock(hashtextextended('member-notice:'||p_member::text,0));end if;
 if exists(select 1 from public.member_notices where event_key=p_key)then return null;end if;
 select * into ch from public.telegram_channel_settings where singleton;
 select * into b from public.telegram_auth_bindings where auth_user_id=p_member and kind='member'and active order by created_at desc limit 1;
 why:=case
  when exists(select 1 from public.workspace_staff where user_id=p_member)or exists(select 1 from public.clinic_portal_memberships where user_id=p_member)then 'staff_account'
  when b.id is null then 'not_connected'
  when ch.singleton is null or b.account_ref is distinct from public._telegram_account_ref(ch)then 'other_bot'
  when public._member_notice_turned_off(p_member)then 'turned_off'
  when exists(select 1 from public.member_notices where member_id=p_member and template_id=p_template and outcome='queued'
   and created_at>clock_timestamp()-make_interval(secs=>s.throttle_seconds))then 'throttled'
  when(select count(*)from public.member_notices where member_id=p_member and outcome='queued'and created_at>clock_timestamp()-interval '1 hour')>=s.hourly_cap then 'hourly_cap'
 end;
 select * into route from public.notice_channels where template_id=p_template;
 loc:=case when p_template='app.bp_weekly_summary' then
  coalesce((select coalesce(ui_locale,locale) from public.profiles where id=p_member),'hy')
  else public._telegram_auth_locale(p_member) end;
 select * into t from public.system_message_templates where template_id=p_template and locale=loc order by version desc limit 1;
 -- Staff accounts and staff-targeted templates never produce an app notice.
 if why<>'staff_account'or why is null then
  if coalesce(route.audience,'member')='member'and coalesce(route.chat,true)and t.approved then app_txt:=public._member_notice_render(t.body,p_params);end if;
  if coalesce(route.audience,'member')<>'member'then why:='staff_account';
  elsif route.telegram is false then why:='telegram_off';end if;
 end if;
 if why is null then
  if t.template_id is null then why:='no_template';
  else
   insert into public.telegram_auth_messages(address,principal_ref,template_id,template_version,locale,body,keyboard,params)
   values(b.address,b.principal_ref,t.template_id,t.version,t.locale,t.body,jsonb_build_object('kind','open_url','url',s.app_origin||p_path),nullif(p_params,'{}'::jsonb))
   returning id into mid;
   why:='queued';
   -- The one-tap sign-in link (armed only when sent; at most 5 per member per hour, as for next-step replies).
   -- The link row references the binding (a key-share lock): never wait for it, since an unlink
   -- locks the binding and then the case this command may hold (review F2B); skip the link instead.
   if p_step is not null and(select count(*)from public.telegram_signin_links where auth_user_id=p_member and created_at>clock_timestamp()-interval '1 hour')<5 then
    begin
     perform 1 from public.telegram_auth_bindings where id=b.id for key share nowait;
     insert into public.telegram_signin_links(auth_user_id,binding_id,binding_generation,principal_ref,step,message_id)values(p_member,b.id,b.generation,b.principal_ref,p_step,mid);
    exception when lock_not_available then null;
    end;
   end if;
  end if;
 end if;
 insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,telegram_message_id,app_text,params)
 values(p_member,p_key,p_group,p_template,case when mid is null then 'skipped'else 'queued'end,why,mid,app_txt,nullif(p_params,'{}'::jsonb));
 perform public._member_notice_trace(p_member,p_template,p_key,p_group,case when mid is null then 'skipped'else 'queued'end,why);
 return mid;
end$$;

-- A new urgent alert closes an already queued weekly summary on app read and delivery claim.
create or replace function public._member_notice_closed(p_member uuid,p_key text,p_template text,p_params jsonb)returns boolean
language plpgsql stable security definer set search_path=''as $$
declare part text[]:=string_to_array(p_key,':');w public.bp_weeks;
begin
 if part[1]='bp_weekly'then
  return exists(select 1 from public.care_alerts a where a.member_id=p_member and a.priority='urgent'and a.state='open');
 elsif part[1]in('reminder.tomorrow','reminder.soon','medicine')then
  return public._member_reminder_stale(p_member,p_key,p_template,p_params);
 elsif part[1]='bpweek'then
  if array_length(part,1)<>4 or part[4]not in('morning','evening')then return true;end if;
  select * into w from public.bp_weeks where id=part[2]::uuid and member_id=p_member;
  if not found or w.stopped_at is not null or part[3]::integer not between 1 and w.days then return true;end if;
  return(select count(*)from public.bp_week_readings where week_id=w.id and day=part[3]::integer and slot=part[4])>=w.readings_per_slot;
 elsif part[1]='medicine_ask'then
  return not exists(select 1 from public.member_medicine_asks a where a.id=part[2]::uuid and a.user_id=p_member
   and a.state='open'and a.expires_at>now());
 elsif part[1]='booking.proposal'then
  return not exists(select 1 from public.clinic_booking_proposals pr join public.booking_appointments a on a.id=pr.appointment_id
   where pr.id=part[2]::uuid and a.member_id=p_member and pr.state='open');
 elsif part[1]='care.plan'then
  return not exists(select 1 from public.patient_care_plans p where p.id=part[2]::uuid and p.user_id=p_member and p.active and p.retired_at is null and p.acknowledged_at is null);
 elsif part[1]in('ldl.retest_due','ldl.retest_overdue')then
  return not exists(select 1 from public.ldl_retests r where r.id=part[2]::uuid and r.member_id=p_member and r.state in('scheduled','requested','fenced'));
 end if;
 return false;
exception when others then return true;
end$$;

create function public.bp_weekly_summary_run(p_now timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare nowt timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;today date;week date;
 s public.bp_weekly_summary_settings;r record;summary jsonb;params jsonb;k text;made integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 -- The dispatcher calls only when NOREON_ZOE_BP_TRENDS is exactly true. This independent
 -- database switch and the existing care switch also default off; no writes while off.
 select * into s from public.bp_weekly_summary_settings where singleton;
 if s.enabled is not true or(select care from public.member_notice_settings where singleton)is not true then
  return jsonb_build_object('ok',true,'state','off');end if;
 lt:=nowt at time zone 'Asia/Yerevan';today:=lt::date;week:=date_trunc('week',lt)::date;
 if lt::time<'09:00'::time or lt::time>='11:00'::time then return jsonb_build_object('ok',true,'state','outside_window');end if;
 -- A non-waiting global lock plus the persisted date fences concurrent sweeps and daily repeats.
 if not pg_try_advisory_xact_lock(hashtextextended('bp-weekly-summary',0))then return jsonb_build_object('ok',true,'state','busy');end if;
 select * into s from public.bp_weekly_summary_settings where singleton for update;
 -- Sweeps repeat inside the window so a member skipped for quiet hours, the throttle or the hourly cap is retried; this only
 -- spaces them out. The week key and the one trend row per member and week keep a repeat from writing twice.
 if s.last_run_at>nowt-interval '15 minutes' then return jsonb_build_object('ok',true,'state','already_ran');end if;
 perform set_config('noreon.member_notice_sweep','on',true);
 for r in select distinct m.user_id,coalesce(p.ui_locale,p.locale,'hy')locale
  from public.patient_measurements m left join public.profiles p on p.id=m.user_id
  where m.measured_at>=((today-6)::timestamp at time zone 'Asia/Yerevan')and m.measured_at<=nowt
   and not exists(select 1 from public.bp_weekly_trends t where t.member_id=m.user_id and t.week_start=week)
   and not exists(select 1 from public.workspace_staff st where st.user_id=m.user_id)
   and not exists(select 1 from public.clinic_portal_memberships st where st.user_id=m.user_id)
   and not exists(select 1 from public.care_alerts a where a.member_id=m.user_id and a.priority='urgent'and a.state='open')
   and not public._member_notice_turned_off(m.user_id)
  order by m.user_id
 loop
  -- Hold the same non-waiting member lock through prechecks, notice and trend. A concurrent
  -- notice cannot consume the cap after preflight and strand the weekly key without a trend.
  continue when not pg_try_advisory_xact_lock(hashtextextended('member-notice:'||r.user_id::text,0));
  continue when public._member_quiet_now(r.user_id,lt::time)or public._member_reminder_held(r.user_id,'app.bp_weekly_summary');
  summary:=public._bp_weekly_trend(r.user_id,nowt);continue when summary is null;
  -- Do not consume the week before its newest copy is approved in the member's language.
  continue when(select approved from public.system_message_templates where template_id='app.bp_weekly_summary'and locale=r.locale order by version desc limit 1)is not true;
  params:=public._bp_weekly_summary_params(summary,r.locale);k:='bp_weekly:'||r.user_id::text||':'||week::text;
  -- _member_notice keeps channel routing, opt-out, cap, approval, and its leaf try-lock.
  -- Its return is a Telegram id, so test the journal row for app-only members as well.
  -- The candidate cursor may be old: recheck member decisions immediately before publishing.
  continue when public._member_notice_turned_off(r.user_id)
   or exists(select 1 from public.care_alerts a where a.member_id=r.user_id and a.priority='urgent'and a.state='open')
   or exists(select 1 from public.workspace_staff st where st.user_id=r.user_id)
   or exists(select 1 from public.clinic_portal_memberships st where st.user_id=r.user_id);
  perform public._member_notice(r.user_id,'care','app.bp_weekly_summary',k,params,'/patient/chat','open_home');
  if exists(select 1 from public.member_notices where event_key=k and reason not in('turned_off','staff_account','throttled','hourly_cap','no_template'))then
   insert into public.bp_weekly_trends(member_id,week_start,this_mean_sys,this_mean_dia,previous_mean_sys,previous_mean_dia,
    readings_this,readings_previous,days_measured,trend)
   values(r.user_id,week,(summary->'thisMean'->>'systolic')::int,(summary->'thisMean'->>'diastolic')::int,
    (summary->'previousMean'->>'systolic')::int,(summary->'previousMean'->>'diastolic')::int,
    (summary->>'readingsThis')::int,(summary->>'readingsPrevious')::int,(summary->>'daysMeasured')::int,summary->>'trend');
   made:=made+1;
  end if;
 end loop;
 perform set_config('noreon.member_notice_sweep','off',true);
 update public.bp_weekly_summary_settings set last_run_at=nowt,updated_at=clock_timestamp()where singleton;
 return jsonb_build_object('ok',true,'state','ran','queued',made);
end$$;
revoke all on function public._bp_weekly_trend(uuid,timestamptz),public._bp_weekly_summary_params(jsonb,text),public.bp_weekly_summary_run(timestamptz)from public,anon,authenticated;
grant execute on function public.bp_weekly_summary_run(timestamptz)to service_role;
