-- Member journey notices in Telegram (Khikar, 17 Oct 2026), dark.
--
-- Today the only member booking notice is booking.clinic_proposal. This sends one short Telegram
-- notice for every step of the member's journey through the auth outbox (telegram_auth_messages:
-- approved-template gating, delivery states, the existing dispatcher), with one "Open Noreon"
-- button into the member app and, where the member still has link quota, a one-tap sign-in link
-- (20261017131420).
--   booking:   visit confirmed, new time proposed (existing template), declined by the clinic,
--              cancelled by staff, rescheduled, home visit request received, home visit arranged.
--   reminders: the day before (18:00 to 21:00 Yerevan) and about 2 hours before; never in quiet
--              hours (21:00 to 09:00); a cancelled or moved visit is never reminded.
--   results:   samples reached the lab, results received.
--   care:      consultation needed, consultation arranged, document released, care plan ready or
--              updated.
--
-- Content: no health details or values. The event, and for visits the date, time, clinic name and
-- the nurse's first name. Those values travel as params on the outbox row and are rendered into
-- the approved template at claim; the stored body stays the template body, so the template
-- check at claim is unchanged.
--
-- Who gets one: a member with an active Telegram sign-in binding on the bot in use now, who has not
-- turned Telegram replies off. Staff and clinic accounts never. Everyone else gets nothing here
-- (the app shows the state on its pages).
--
-- Idempotent per event: member_notices.event_key is unique, and every decision (queued or skipped
-- with the reason) is journaled once. Throttle: the same template to the same member at most once
-- per throttle_seconds, and at most hourly_cap notices per member per hour.
--
-- Dark: member_notice_settings has one switch per group, all off. The v1 wording is an unapproved
-- placeholder that the outbox holds at claim. Never raises: every notice runs inside a booking,
-- clinical or lab command, which must not roll back because of a notice.

-- 1. Tables ---------------------------------------------------------------------------------------

create table public.member_notice_settings(
 singleton boolean primary key default true check(singleton),
 booking boolean not null default false,
 reminders boolean not null default false,
 results boolean not null default false,
 care boolean not null default false,
 -- Where the button points. One origin, no path; the adapter also refuses anything but the member app host.
 app_origin text not null default 'https://app.noreon.health'check(app_origin ~ '^https://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'),
 throttle_seconds integer not null default 600 check(throttle_seconds between 0 and 86400),
 hourly_cap integer not null default 6 check(hourly_cap between 1 and 60),
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.member_notice_settings(singleton)values(true);

create table public.member_notices(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id)on delete cascade,
 event_key text not null unique check(event_key ~ '^[a-z_.]+:[a-z0-9:._-]{1,200}$'),
 notice_group text not null check(notice_group in('booking','reminders','results','care')),
 template_id text not null,
 outcome text not null check(outcome in('queued','skipped')),
 reason text not null check(reason in('queued','not_connected','other_bot','turned_off','staff_account','throttled','hourly_cap','no_template')),
 telegram_message_id uuid unique references public.telegram_auth_messages(id),
 created_at timestamptz not null default clock_timestamp(),
 check((outcome='queued')=(telegram_message_id is not null))
);
create index member_notices_throttle on public.member_notices(member_id,created_at desc)where outcome='queued';
alter table public.member_notice_settings enable row level security;
alter table public.member_notices enable row level security;
revoke all on public.member_notice_settings,public.member_notices from public,anon,authenticated,service_role;
-- History is append-only (a deleted member's rows go with the account).
create function public._member_notice_frozen()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Member notice history is append-only';
end$$;
create trigger member_notices_frozen before update on public.member_notices for each row execute function public._member_notice_frozen();

-- 2. Outbox: params rendered at claim, and a member app button -------------------------------------

-- Only these names, short single-line values, no braces: a value can never smuggle text in.
create function public._member_notice_params_ok(p jsonb)returns boolean language sql immutable set search_path=''as $$
 select p is null or(jsonb_typeof(p)='object'and(p-array['date','time','end_time','clinic','nurse'])='{}'::jsonb
  and not exists(select 1 from jsonb_each(p)e where jsonb_typeof(e.value)<>'string'or length(e.value#>>'{}')not between 1 and 80
   or e.value#>>'{}'~'[{}\r\n\t]'or e.value#>>'{}'<>btrim(e.value#>>'{}')))
$$;
alter table public.telegram_auth_messages add column params jsonb check(public._member_notice_params_ok(params));
alter table public.telegram_auth_messages drop constraint telegram_auth_messages_keyboard_check;
alter table public.telegram_auth_messages add constraint telegram_auth_messages_keyboard_check check(keyboard is null
 or keyboard in('{"kind":"request_contact"}'::jsonb,'{"kind":"remove"}'::jsonb)
 or coalesce(keyboard->>'kind'='open_url'and(keyboard-'kind'-'url')='{}'::jsonb and jsonb_typeof(keyboard->'url')='string'
  and keyboard->>'url'~'^https://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?/(staff/real|patient)/[a-z0-9/-]{1,120}$',false));

-- Same as 20261017121556 plus: a member app button takes the member label, params are rendered
-- into the approved body (held when a placeholder is left without a value), and a member notice
-- stays fresh for 6 hours (a reminder for 30 minutes) instead of 15, so a dispatcher gap does not
-- silently drop it (review F1). Sign-in prompts and staff notices keep 15 minutes.
create or replace function public.telegram_auth_message_claim(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.telegram_auth_messages;t public.system_message_templates;lbl public.system_message_templates;envelope jsonb;hold text;txt text;kv record;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','2s',true);
 select * into m from public.telegram_auth_messages where id=p_message for update;
 if not found then return jsonb_build_object('ok',false,'code','message_unknown');end if;
 if m.state<>'queued'or exists(select 1 from public.telegram_auth_message_attempts where id=p_attempt or message_id=p_message)then return jsonb_build_object('ok',false,'code','already_claimed_or_held');end if;
 select * into t from public.system_message_templates where template_id=m.template_id and version=m.template_version and locale=m.locale;
 if m.keyboard->>'kind'='request_contact'then
  select * into lbl from public.system_message_templates where template_id='telegram.share_contact_label'and locale=m.locale and approved order by version desc limit 1;
 elsif m.keyboard->>'kind'='open_url'then
  select * into lbl from public.system_message_templates where locale=m.locale and approved
   and template_id=case when m.keyboard->>'url'~'^https://[^/]+/patient/'then 'member_notice.open_label'else 'staff_message.open_label'end order by version desc limit 1;
 end if;
 txt:=m.body;
 for kv in select key,value from jsonb_each_text(coalesce(m.params,'{}'))loop txt:=replace(txt,'{'||kv.key||'}',kv.value);end loop;
 hold:=case when not t.approved then 'template_unapproved'when t.body<>m.body then 'template_changed'
  when m.keyboard->>'kind'in('request_contact','open_url')and lbl.body is null then 'template_unapproved'
  when txt~'\{[a-z_]+\}'then 'params_missing'
  when m.created_at<clock_timestamp()-case when m.template_id like 'member.reminder\_%'then interval '30 minutes'
   when m.template_id like 'member.%'or m.template_id='booking.clinic_proposal'then interval '6 hours'else interval '15 minutes'end then 'expired'end;
 if hold is not null then
  update public.telegram_auth_messages set state='held',reason=hold,state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id;
  return jsonb_build_object('ok',false,'code',hold);end if;
 envelope:=jsonb_build_object('messageId',m.id,'attemptId',p_attempt,'address',m.address,'text',txt,
  'keyboard',case m.keyboard->>'kind'when 'request_contact'then jsonb_build_object('kind','request_contact','label',lbl.body)when 'remove'then jsonb_build_object('kind','remove')
   when 'open_url'then jsonb_build_object('kind','open_url','label',lbl.body,'url',m.keyboard->>'url')end);
 update public.telegram_auth_messages set state='sending',state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id returning * into m;
 insert into public.telegram_auth_message_attempts(id,message_id,state_seq,envelope)values(p_attempt,m.id,m.state_seq,envelope);
 return jsonb_build_object('ok',true,'fresh',true,'envelope',jsonb_strip_nulls(envelope));
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end$$;

-- One-tap sign-in links may also open the member's care, results or home page.
alter table public.telegram_signin_links drop constraint telegram_signin_links_step_check;
alter table public.telegram_signin_links add constraint telegram_signin_links_step_check
 check(step in('next_profile','next_questionnaire','next_review','replies_off','open_care','open_results','open_home'));

-- 3. Wording (v1 placeholders, held at claim until approved) ---------------------------------------

insert into public.system_message_templates(template_id,version,locale,body)values
 ('member_notice.open_label',1,'en','Open Noreon'),
 ('member_notice.open_label',1,'hy','Բացել Noreon-ը'),
 ('member.booking_confirmed',1,'en','UNAPPROVED PLACEHOLDER. Your visit is confirmed for {date} at {time} at {clinic}. See how to prepare in Noreon.'),
 ('member.booking_confirmed',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր այցը հաստատված է՝ {date}, ժամը {time}, {clinic}։ Ինչպես նախապատրաստվել՝ տեսեք Noreon-ում։'),
 ('member.booking_rescheduled',1,'en','UNAPPROVED PLACEHOLDER. Your visit has a new time: {date} at {time} at {clinic}. See how to prepare in Noreon.'),
 ('member.booking_rescheduled',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր այցի ժամը փոխվել է՝ {date}, ժամը {time}, {clinic}։ Ինչպես նախապատրաստվել՝ տեսեք Noreon-ում։'),
 ('member.booking_declined',1,'en','UNAPPROVED PLACEHOLDER. The clinic could not take the visit time you asked for. Open Noreon to choose another time.'),
 ('member.booking_declined',1,'hy','UNAPPROVED PLACEHOLDER. Կլինիկան չկարողացավ ընդունել ձեր խնդրած այցի ժամը։ Բացեք Noreon-ը՝ այլ ժամ ընտրելու համար։'),
 ('member.booking_cancelled',1,'en','UNAPPROVED PLACEHOLDER. Your visit on {date} at {time} was cancelled. Open Noreon to see the details or choose a new time.'),
 ('member.booking_cancelled',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր այցը՝ {date}, ժամը {time}, չեղարկվել է։ Բացեք Noreon-ը՝ մանրամասները տեսնելու կամ նոր ժամ ընտրելու համար։'),
 ('member.request_cancelled',1,'en','UNAPPROVED PLACEHOLDER. Your visit request was cancelled. Open Noreon to see the details or make a new request.'),
 ('member.request_cancelled',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր այցի հայտը չեղարկվել է։ Բացեք Noreon-ը՝ մանրամասները տեսնելու կամ նոր հայտ ներկայացնելու համար։'),
 ('member.home_received',1,'en','UNAPPROVED PLACEHOLDER. We have your home visit request. Noreon will contact you to agree a time.'),
 ('member.home_received',1,'hy','UNAPPROVED PLACEHOLDER. Մենք ստացել ենք տնային այցի ձեր հայտը։ Noreon-ը կկապվի ձեզ հետ՝ ժամը համաձայնեցնելու համար։'),
 ('member.home_arranged',1,'en','UNAPPROVED PLACEHOLDER. Your home visit is arranged for {date}, between {time} and {end_time}. Your nurse is {nurse}.'),
 ('member.home_arranged',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր տնային այցը նշանակված է՝ {date}, ժամը {time}-ից մինչև {end_time}։ Ձեր բուժքույրը՝ {nurse}։'),
 ('member.home_arranged_plain',1,'en','UNAPPROVED PLACEHOLDER. Your home visit is arranged for {date}, between {time} and {end_time}.'),
 ('member.home_arranged_plain',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր տնային այցը նշանակված է՝ {date}, ժամը {time}-ից մինչև {end_time}։'),
 ('member.reminder_visit_tomorrow',1,'en','UNAPPROVED PLACEHOLDER. Reminder: your visit is tomorrow, {date} at {time} at {clinic}. See how to prepare in Noreon.'),
 ('member.reminder_visit_tomorrow',1,'hy','UNAPPROVED PLACEHOLDER. Հիշեցում՝ ձեր այցը վաղն է՝ {date}, ժամը {time}, {clinic}։ Ինչպես նախապատրաստվել՝ տեսեք Noreon-ում։'),
 ('member.reminder_visit_soon',1,'en','UNAPPROVED PLACEHOLDER. Reminder: your visit is today at {time} at {clinic}.'),
 ('member.reminder_visit_soon',1,'hy','UNAPPROVED PLACEHOLDER. Հիշեցում՝ ձեր այցն այսօր է, ժամը {time}, {clinic}։'),
 ('member.reminder_home_tomorrow',1,'en','UNAPPROVED PLACEHOLDER. Reminder: your home visit is tomorrow, {date}, between {time} and {end_time}.'),
 ('member.reminder_home_tomorrow',1,'hy','UNAPPROVED PLACEHOLDER. Հիշեցում՝ ձեր տնային այցը վաղն է՝ {date}, ժամը {time}-ից մինչև {end_time}։'),
 ('member.reminder_home_soon',1,'en','UNAPPROVED PLACEHOLDER. Reminder: your nurse is coming today between {time} and {end_time}.'),
 ('member.reminder_home_soon',1,'hy','UNAPPROVED PLACEHOLDER. Հիշեցում՝ բուժքույրը կգա այսօր՝ ժամը {time}-ից մինչև {end_time}։'),
 ('member.samples_at_lab',1,'en','UNAPPROVED PLACEHOLDER. Your samples have reached the lab. We will tell you when your results arrive.'),
 ('member.samples_at_lab',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր նմուշները հասել են լաբորատորիա։ Կտեղեկացնենք, երբ արդյունքները ստացվեն։'),
 ('member.results_received',1,'en','UNAPPROVED PLACEHOLDER. Your results have arrived. Open Noreon to see your next step.'),
 ('member.results_received',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր արդյունքները ստացվել են։ Բացեք Noreon-ը՝ հաջորդ քայլը տեսնելու համար։'),
 ('member.consultation_needed',1,'en','UNAPPROVED PLACEHOLDER. Your doctor would like to talk with you. Noreon will contact you to arrange a time.'),
 ('member.consultation_needed',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր բժիշկը ցանկանում է խոսել ձեզ հետ։ Noreon-ը կկապվի ձեզ հետ՝ ժամը համաձայնեցնելու համար։'),
 ('member.consultation_clinic',1,'en','UNAPPROVED PLACEHOLDER. Your consultation is arranged for {date} at {time} at {clinic}.'),
 ('member.consultation_clinic',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր խորհրդատվությունը նշանակված է՝ {date}, ժամը {time}, {clinic}։'),
 ('member.consultation_phone',1,'en','UNAPPROVED PLACEHOLDER. Your doctor will call you on {date} at about {time}.'),
 ('member.consultation_phone',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր բժիշկը կզանգահարի ձեզ {date}, մոտավորապես ժամը {time}-ին։'),
 ('member.document_released',1,'en','UNAPPROVED PLACEHOLDER. A new result is ready for you in Noreon.'),
 ('member.document_released',1,'hy','UNAPPROVED PLACEHOLDER. Noreon-ում ձեզ համար նոր արդյունք կա։'),
 ('member.plan_ready',1,'en','UNAPPROVED PLACEHOLDER. Your care plan is ready. Open Noreon to read it.'),
 ('member.plan_ready',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր խնամքի ծրագիրը պատրաստ է։ Բացեք Noreon-ը՝ այն կարդալու համար։'),
 ('member.plan_updated',1,'en','UNAPPROVED PLACEHOLDER. Your care plan was updated. Open Noreon to see what changed.'),
 ('member.plan_updated',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր խնամքի ծրագիրը թարմացվել է։ Բացեք Noreon-ը՝ փոփոխությունները տեսնելու համար։');

-- 4. Helpers ------------------------------------------------------------------------------------------

-- The member's own "off" for Telegram (same rule as _telegram_replies_auto, 20261017104836).
create function public._member_notice_turned_off(m uuid)returns boolean language sql stable security definer set search_path=''as $$
 select greatest(coalesce((select max(created_at)from public.telegram_audit where member_id=m and kind='link.unlinked'),'-infinity'),
   coalesce((select max(created_at)from public.telegram_auth_audit where auth_user_id=m and kind='binding.revoked'and detail->>'reason'='member_unlinked'),'-infinity'))
  >coalesce((select max(created_at)from public.telegram_audit where member_id=m and kind='link.redeemed'),'-infinity')
$$;

-- A visit moment in the member's language, Yerevan time: {date} and {time}.
create function public._member_notice_when(ts timestamptz,loc text,p_prefix text default '')returns jsonb language sql stable set search_path=''as $$
 select case when ts is null then '{}'::jsonb else jsonb_build_object(p_prefix||'date',
  case when loc='hy'then extract(day from l)::int||' '||(array['հունվարի','փետրվարի','մարտի','ապրիլի','մայիսի','հունիսի','հուլիսի','օգոստոսի','սեպտեմբերի','հոկտեմբերի','նոյեմբերի','դեկտեմբերի'])[extract(month from l)::int]
    ||', '||(array['կիրակի','երկուշաբթի','երեքշաբթի','չորեքշաբթի','հինգշաբթի','ուրբաթ','շաբաթ'])[extract(dow from l)::int+1]
   else(array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[extract(dow from l)::int+1]||' '||extract(day from l)::int||' '
    ||(array['January','February','March','April','May','June','July','August','September','October','November','December'])[extract(month from l)::int]end,
  p_prefix||'time',to_char(l,'HH24:MI'))end
 from(select ts at time zone 'Asia/Yerevan' l)x
$$;

-- A display value for a params slot: one line, no braces, at most 80 characters, or nothing.
create function public._member_notice_text(v text)returns text language sql immutable set search_path=''as $$
 select nullif(left(btrim(regexp_replace(coalesce(v,''),'[{}\s]+',' ','g')),80),'')
$$;

-- Date, time, end time and clinic of a visit arrangement (booking or request terms shape).
create function public._member_notice_visit(m uuid,starts timestamptz,ends timestamptz,clinic text)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_strip_nulls(public._member_notice_when(starts,public._telegram_auth_locale(m))
  ||jsonb_build_object('end_time',case when ends is not null then to_char(ends at time zone 'Asia/Yerevan','HH24:MI')end,'clinic',public._member_notice_text(clinic)))
$$;

create function public._member_notice_trace(m uuid,p_template text,p_key text,p_group text,p_outcome text,p_reason text)returns void
language sql security definer set search_path=''as $$
 select public._conversation_trace(m,null,'member_notice',p_key,'delivery','member_notice.'||p_outcome,p_outcome,p_reason,p_template,null,'system',null,
  jsonb_build_object('messaging.system','telegram','noreon.notice.group',p_group));
$$;

-- 5. The notice ----------------------------------------------------------------------------------------

-- One decision per event key: queued (with the outbox message) or skipped (with the reason).
-- Returns the outbox message id, or null.
create function public._member_notice(p_member uuid,p_group text,p_template text,p_key text,p_params jsonb,p_path text,p_step text)returns uuid
language plpgsql security definer set search_path=''as $$
declare s public.member_notice_settings;ch public.telegram_channel_settings;b public.telegram_auth_bindings;t public.system_message_templates;
 enabled boolean;why text;mid uuid;loc text;
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
 if why is null then
  loc:=public._telegram_auth_locale(p_member);
  select * into t from public.system_message_templates where template_id=p_template and locale=loc order by version desc limit 1;
  if not found then why:='no_template';
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
 insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,telegram_message_id)
 values(p_member,p_key,p_group,p_template,case when mid is null then 'skipped'else 'queued'end,why,mid);
 perform public._member_notice_trace(p_member,p_template,p_key,p_group,case when mid is null then 'skipped'else 'queued'end,why);
 return mid;
end$$;

-- Never raises: a failed notice is traced and the command it rides on goes ahead.
create function public._member_notice_safe(p_member uuid,p_group text,p_template text,p_key text,p_params jsonb,p_path text,p_step text)returns uuid
language plpgsql security definer set search_path=''as $$
begin
 return public._member_notice(p_member,p_group,p_template,p_key,p_params,p_path,p_step);
exception when others then
 begin perform public._member_notice_trace(p_member,p_template,p_key,p_group,'failed',lower(sqlstate));exception when others then null;end;
 return null;
end$$;

-- 6. Booking --------------------------------------------------------------------------------------------

-- Clinic-portal bookings: the clinic confirms, declines or confirms a change; staff cancel for the
-- member. The member's own cancel, change request and acceptance of a proposal send nothing (they
-- did it in the app).
create function public._member_notice_booking_event()returns trigger
language plpgsql security definer set search_path=''as $$
declare a public.booking_appointments;purpose text;actor uuid;arr jsonb;tpl text;
begin
 if new.kind not in('clinic-confirmed','clinic-declined','cancelled')then return null;end if;
 begin
  select * into a from public.booking_appointments where id=new.appointment_id;
  select n.purpose into purpose from public.booking_scheduling_notices n where n.id=new.notice_id;
  if new.kind='clinic-confirmed'then
   arr:=a.current_arrangement;tpl:=case when purpose='change'then 'member.booking_rescheduled'else 'member.booking_confirmed'end;
  elsif new.kind='clinic-declined'then tpl:='member.booking_declined';
  else
   select v.actor_id into actor from public.booking_appointment_versions v where v.notice_id=new.notice_id;
   if actor is null or actor=a.member_id then return null;end if;
   arr:=a.proposed_arrangement;tpl:='member.booking_cancelled';
  end if;
  perform public._member_notice_safe(a.member_id,'booking',tpl,'booking:'||new.id::text,
   case when arr is null then '{}'::jsonb else public._member_notice_visit(a.member_id,(arr->>'startsAt')::timestamptz,null,
    (select name from public.workspace_clinics where id::text=arr->>'clinicId'))end,'/patient/care','open_care');
 exception when others then null;
 end;
 return null;
end$$;
create trigger member_notice_booking_event after insert on public.booking_appointment_events
 for each row execute function public._member_notice_booking_event();

-- New time proposed: through the member notice rules when the booking switch is on; otherwise as
-- before (20261017111652), so turning this feature on or off never silences the proposal notice.
create or replace function public._clinic_proposal_notify(p_member uuid)returns uuid
language plpgsql security definer set search_path=''as $$declare b public.telegram_auth_bindings;pid uuid;begin
 if(select booking from public.member_notice_settings where singleton)is true then
  select pr.id into pid from public.clinic_booking_proposals pr join public.booking_appointments a on a.id=pr.appointment_id
  where a.member_id=p_member and pr.state='open'order by pr.created_at desc limit 1;
  if pid is null then return null;end if;
  return public._member_notice_safe(p_member,'booking','booking.clinic_proposal','booking.proposal:'||pid::text,'{}','/patient/care','open_care');
 end if;
 select * into b from public.telegram_auth_bindings where auth_user_id=p_member and kind='member'and active order by created_at desc limit 1;
 if not found then return null;end if;
 return public._telegram_auth_enqueue('booking.clinic_proposal',public._telegram_auth_locale(p_member),b.address,b.principal_ref,null,null);
end$$;

-- Requests in the admin booking queue (home visits, D2): received, arranged (time window and the
-- nurse's first name), and cancelled by staff.
create function public._member_notice_nurse_name(m uuid)returns text language sql stable security definer set search_path=''as $$
 select public._member_notice_text(split_part(btrim(ws.display_name),' ',1))
 from public.patient_clinical_cases c join public.workspace_staff ws on ws.user_id=c.assigned_nurse_id and ws.role='nurse'and ws.active and ws.removed_at is null
 where c.user_id=m
$$;
create function public._member_notice_request_changed()returns trigger
language plpgsql security definer set search_path=''as $$
declare p jsonb;nurse text;starts timestamptz;
begin
 begin
  if tg_op='INSERT'then
   if new.requested_terms->>'mode'='home'then
    perform public._member_notice_safe(new.user_id,'booking','member.home_received','home.received:'||new.id::text,'{}','/patient/care','open_care');
   end if;
  elsif public._home_visit_is_home(new)and(not public._home_visit_is_home(old)or old.current_arrangement is distinct from new.current_arrangement)then
   starts:=(new.current_arrangement#>>'{terms,startsAt}')::timestamptz;
   if starts>clock_timestamp()then
    nurse:=public._member_notice_nurse_name(new.user_id);
    p:=public._member_notice_visit(new.user_id,starts,(new.current_arrangement#>>'{terms,endsAt}')::timestamptz,null);
    if p?'end_time'then
     perform public._member_notice_safe(new.user_id,'booking',case when nurse is null then 'member.home_arranged_plain'else 'member.home_arranged'end,
      'home.arranged:'||new.id::text||':'||new.revision::text,p||coalesce(jsonb_build_object('nurse',nurse),'{}'),'/patient/care','open_care');
    end if;
   end if;
  end if;
 exception when others then null;
 end;
 return null;
end$$;
create trigger member_notice_request_changed after insert or update of status,current_arrangement on public.patient_test_requests
 for each row execute function public._member_notice_request_changed();

create function public._member_notice_request_event()returns trigger
language plpgsql security definer set search_path=''as $$
declare r public.patient_test_requests;
begin
 if new.operation<>'cancel'then return null;end if;
 begin
  select * into r from public.patient_test_requests where id=new.request_id;
  if r.status='cancelled'and new.actor_id<>r.user_id then
   perform public._member_notice_safe(r.user_id,'booking','member.request_cancelled','request.cancelled:'||r.id::text||':'||new.revision::text,'{}','/patient/care','open_care');
  end if;
 exception when others then null;
 end;
 return null;
end$$;
create trigger member_notice_request_event after insert on public.patient_test_request_events
 for each row execute function public._member_notice_request_event();

-- 7. Reminders ------------------------------------------------------------------------------------------

-- Called by the dispatcher sweep (every 5 minutes) before it sends. The day before: 18:00 to 21:00
-- Yerevan. Soon: from 2 hours to 1 hour before the start. Nothing is queued in quiet hours (21:00
-- to 09:00): a soon reminder whose hour falls in them is not sent (the day-before one covers it).
-- Only confirmed visits are read at the moment of sending, so cancelled ones never get one; a moved
-- visit gets its own reminders (the key holds the start time). p_now is for tests.
create function public.member_notice_reminders_run(p_now timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare nowt timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;r record;home boolean;queued integer:=0;tpl text;k text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(select reminders from public.member_notice_settings where singleton)is not true then return jsonb_build_object('ok',true,'state','off');end if;
 perform set_config('noreon.member_notice_sweep','on',true);
 lt:=nowt at time zone 'Asia/Yerevan';
 if lt::time>='21:00'or lt::time<'09:00'then return jsonb_build_object('ok',true,'state','quiet_hours');end if;
 for r in
  select 'booking'src,a.id,a.member_id m,(a.current_arrangement->>'startsAt')::timestamptz starts,(a.current_arrangement->>'endsAt')::timestamptz ends,
   a.current_arrangement->>'mode'mode,(select name from public.workspace_clinics c where c.id::text=a.current_arrangement->>'clinicId')clinic
  from public.booking_appointments a
  where a.status='confirmed'and a.current_arrangement?'startsAt'and(a.current_arrangement->>'startsAt')::timestamptz between nowt and nowt+interval '30 hours'
  union all
  select 'request',q.id,q.user_id,(q.current_arrangement#>>'{terms,startsAt}')::timestamptz,(q.current_arrangement#>>'{terms,endsAt}')::timestamptz,
   q.current_arrangement#>>'{terms,mode}',q.current_arrangement->>'provider'
  from public.patient_test_requests q
  where q.status='confirmed'and q.current_arrangement#>>'{terms,startsAt}'is not null
   and(q.current_arrangement#>>'{terms,startsAt}')::timestamptz between nowt and nowt+interval '30 hours'
 loop
  home:=r.mode='home';tpl:=null;
  if(r.starts at time zone 'Asia/Yerevan')::date=lt::date+1 and lt::time>='18:00'then
   tpl:=case when home then 'member.reminder_home_tomorrow'else 'member.reminder_visit_tomorrow'end;k:='reminder.tomorrow:';
  elsif nowt>=r.starts-interval '2 hours'and nowt<r.starts-interval '1 hour'then
   tpl:=case when home then 'member.reminder_home_soon'else 'member.reminder_visit_soon'end;k:='reminder.soon:';
  end if;
  if tpl is not null and(not home or r.ends is not null)then
   if public._member_notice_safe(r.m,'reminders',tpl,k||r.src||':'||r.id::text||':'||extract(epoch from r.starts)::bigint::text,
    public._member_notice_visit(r.m,r.starts,case when home then r.ends end,case when not home then r.clinic end),'/patient/care','open_care')is not null then
    queued:=queued+1;
   end if;
  end if;
 end loop;
 perform set_config('noreon.member_notice_sweep','off',true);
 return jsonb_build_object('ok',true,'state','ran','queued',queued);
end$$;

-- 8. Results ---------------------------------------------------------------------------------------------

-- Samples reached the lab, results received: once per visit (many samples, one notice). A
-- retraction ('results-retracted') sends nothing.
create function public._member_notice_lab_stage()returns trigger
language plpgsql security definer set search_path=''as $$
declare v uuid;
begin
 begin
  select visit_id into v from public.patient_care_visit_entries where id=new.collection_entry_id;
  if new.stage='at-lab'then
   perform public._member_notice_safe(new.user_id,'results','member.samples_at_lab','results.at_lab:'||coalesce(v,new.collection_entry_id)::text,'{}','/patient/results','open_results');
  elsif new.stage='results-received'then
   perform public._member_notice_safe(new.user_id,'results','member.results_received','results.received:'||coalesce(v,new.collection_entry_id)::text,'{}','/patient/results','open_results');
  end if;
 exception when others then null;
 end;
 return null;
end$$;
create trigger member_notice_lab_stage after insert on public.patient_care_lab_stages
 for each row execute function public._member_notice_lab_stage();

-- A clinic lab PDF attached to the member's visit: results received (same key as the lab stage).
create function public._member_notice_result_attached()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 perform public._member_notice_safe(new.user_id,'results','member.results_received','results.received:'||new.visit_id::text,'{}','/patient/results','open_results');
 return null;
end$$;
create trigger member_notice_result_attached after insert on public.clinic_result_attachments
 for each row execute function public._member_notice_result_attached();

-- 9. Care ---------------------------------------------------------------------------------------------------

-- A new consultation hold (B5): once per hold. The notice carries no reason.
create function public._member_notice_case_review()returns trigger
language plpgsql security definer set search_path=''as $$
declare since timestamptz;
begin
 begin
  since:=public._consultation_hold_since(new);
  if since is not null and since is distinct from public._consultation_hold_since(old)then
   perform public._member_notice_safe(new.user_id,'care','member.consultation_needed',
    'care.consultation_needed:'||new.user_id::text||':'||extract(epoch from since)::bigint::text,'{}','/patient/dashboard','open_home');
  end if;
 exception when others then null;
 end;
 return null;
end$$;
create trigger member_notice_case_review after update of review,assigned_doctor_id on public.patient_clinical_cases
 for each row execute function public._member_notice_case_review();

create function public._member_notice_consultation_arranged()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 begin
  perform public._member_notice_safe(new.user_id,'care',case when new.channel='clinic'then 'member.consultation_clinic'else 'member.consultation_phone'end,
   'care.consultation:'||new.id::text,public._member_notice_visit(new.user_id,new.scheduled_at,null,
    case when new.channel='clinic'then(select name from public.workspace_clinics where id=new.clinic_id)end),'/patient/dashboard','open_home');
 exception when others then null;
 end;
 return null;
end$$;
create trigger member_notice_consultation_arranged after insert on public.patient_consultation_arrangements
 for each row execute function public._member_notice_consultation_arranged();

create function public._member_notice_document_released()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 if new.kind='released'then
  perform public._member_notice_safe(new.user_id,'care','member.document_released','care.document:'||new.id::text,'{}','/patient/results','open_results');
 end if;
 return null;
end$$;
create trigger member_notice_document_released after insert on public.patient_document_release_events
 for each row execute function public._member_notice_document_released();

create function public._member_notice_plan_version()returns trigger
language plpgsql security definer set search_path=''as $$
begin
 perform public._member_notice_safe(new.user_id,'care',case when new.version=1 then 'member.plan_ready'else 'member.plan_updated'end,
  'care.plan:'||new.plan_id::text,'{}','/patient/results','open_results');
 return null;
end$$;
create trigger member_notice_plan_version after insert on public.patient_care_plan_versions
 for each row execute function public._member_notice_plan_version();

-- 10. Privileges --------------------------------------------------------------------------------------------

revoke all on function public._member_notice_frozen(),public._member_notice_params_ok(jsonb),public._member_notice_turned_off(uuid),
 public._member_notice_when(timestamptz,text,text),public._member_notice_text(text),public._member_notice_visit(uuid,timestamptz,timestamptz,text),
 public._member_notice_trace(uuid,text,text,text,text,text),public._member_notice(uuid,text,text,text,jsonb,text,text),
 public._member_notice_safe(uuid,text,text,text,jsonb,text,text),public._member_notice_booking_event(),public._clinic_proposal_notify(uuid),
 public._member_notice_nurse_name(uuid),public._member_notice_request_changed(),public._member_notice_request_event(),
 public.member_notice_reminders_run(timestamptz),public._member_notice_lab_stage(),public._member_notice_result_attached(),
 public._member_notice_case_review(),public._member_notice_consultation_arranged(),public._member_notice_document_released(),
 public._member_notice_plan_version(),public.telegram_auth_message_claim(uuid,uuid)
 from public,anon,authenticated,service_role;
-- The check constraint calls the params check as whoever writes the outbox row.
grant execute on function public._member_notice_params_ok(jsonb)to service_role;
grant execute on function public.member_notice_reminders_run(timestamptz),public.telegram_auth_message_claim(uuid,uuid)to service_role;
