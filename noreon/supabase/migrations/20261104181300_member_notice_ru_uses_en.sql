-- Russian member notices use English until Russian wording for that template is approved.
-- Keep staff/auth locale selection, template text and approval states unchanged.
create function public._member_notice_locale(p_member uuid,p_template text)returns text
language sql stable security definer set search_path=''as $$
 select case when (select ui_locale from public.profiles where id=p_member)='ru' then
  case when exists(select 1 from public.system_message_templates
   where template_id=p_template and locale='ru'and approved)then 'ru'else 'en'end
 else public._telegram_auth_locale(p_member)end
$$;
revoke all on function public._member_notice_locale(uuid,text)from public,anon,authenticated,service_role;

-- Latest definition: 20261104174400_sample_collected_notice.sql. Only the locale pick changes.
-- CREATE OR REPLACE preserves the existing internal-only function grants.
create or replace function public._member_notice(p_member uuid,p_group text,p_template text,p_key text,p_params jsonb,p_path text,p_step text)returns uuid
language plpgsql security definer set search_path=''as $$
declare s public.member_notice_settings;ch public.telegram_channel_settings;b public.telegram_auth_bindings;t public.system_message_templates;
 enabled boolean;why text;mid uuid;loc text;route public.notice_channels;app_txt text;
begin
 if p_member is null or p_key is null then return null;end if;
 -- Member results notifications stop here, including old lab/PDF trigger callers.
 if p_template in('member.results_received','member.document_released')then return null;end if;
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
 loc:=case when p_template in('app.bp_weekly_summary','member.samples_collected','member.samples_collected_exceptions')
  and (select ui_locale from public.profiles where id=p_member)is distinct from 'ru' then
  coalesce((select coalesce(ui_locale,locale) from public.profiles where id=p_member),'hy')
  else public._member_notice_locale(p_member,p_template) end;
 select * into t from public.system_message_templates where template_id=p_template and locale=loc order by version desc limit 1;
 -- This collection copy is requested for the app even while Telegram wording awaits approval.
 -- Telegram still queues the template version and is held at claim, like other care notices.
 -- Staff accounts and staff-targeted templates never produce an app notice.
 if why<>'staff_account'or why is null then
  if coalesce(route.audience,'member')='member'and coalesce(route.chat,true)and (t.approved or p_template in('member.samples_collected','member.samples_collected_exceptions')) then app_txt:=public._member_notice_render(t.body,p_params);end if;
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

-- Latest definition: 20261104172900_bp_weekly_summary.sql. Only the locale pick changes.
-- Match approval and parameter rendering to _member_notice; CREATE OR REPLACE keeps grants.
create or replace function public.bp_weekly_summary_run(p_now timestamptz default null)returns jsonb
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
 for r in select distinct m.user_id,public._member_notice_locale(m.user_id,'app.bp_weekly_summary')locale
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
