-- One SQL line changes a notice: update public.notice_channels set telegram=false where template_id='member.results_received';
-- Do not turn telegram off for a notice until NOREON_MEMBER_CHAT_V2 and NOREON_MEMBER_NOTICES_IN_CHAT are both on:
-- that notice then reaches the member only in the app. A template with no row has every channel on.
-- push is read by the phone push PR.
-- Member notices in app chat. Existing Telegram decisions and outbox ids stay authoritative.
-- No history backfill: only newly produced notices have app text. Approved, rendered copy is
-- snapshotted at creation so later template edits cannot rewrite a member's history.
create table public.notice_channels(
 template_id text primary key,
 audience text not null default 'member' check(audience in('member','nurse','doctor')),
 chat boolean not null default true,
 push boolean not null default true,
 telegram boolean not null default true,
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.notice_channels enable row level security;
revoke all on public.notice_channels from public,anon,authenticated,service_role;
-- All templates emitted by _member_notice_safe, including dynamic programme template names.
insert into public.notice_channels(template_id)values
 ('booking.clinic_proposal'),
 ('member.booking_confirmed'),
 ('member.booking_rescheduled'),
 ('member.booking_declined'),
 ('member.booking_cancelled'),
 ('member.request_cancelled'),
 ('member.home_received'),
 ('member.home_arranged'),
 ('member.home_arranged_plain'),
 ('member.reminder_visit_tomorrow'),
 ('member.reminder_visit_soon'),
 ('member.reminder_home_tomorrow'),
 ('member.reminder_home_soon'),
 ('member.samples_at_lab'),
 ('member.results_received'),
 ('member.consultation_needed'),
 ('member.consultation_clinic'),
 ('member.consultation_phone'),
 ('member.document_released'),
 ('member.plan_ready'),
 ('member.plan_updated'),
 ('member.programme_week4_open'),
 ('member.programme_month3_open'),
 ('member.programme_month6_open'),
 ('member.programme_plan_confirmed'),
 ('member.reminder_bp_week'),
 ('member.reminder_medicine'),
 ('member.medicine_ask'),
 ('member.ldl_retest_due'),
 ('member.ldl_retest_overdue'),
 ('member.ldl_result_with_doctor');

alter table public.member_notices add column app_text text;
-- Skipped Telegram notices have no outbox row: retain the same safe params for source freshness.
alter table public.member_notices add column params jsonb check(public._member_notice_params_ok(params));
create index member_notices_app_history on public.member_notices(member_id,created_at desc)where app_text is not null;
alter table public.member_notices drop constraint member_notices_reason_check;
alter table public.member_notices add constraint member_notices_reason_check
 check(reason in('queued','not_connected','other_bot','turned_off','staff_account','throttled','hourly_cap','no_template','telegram_off','direct_send'));
-- The queued iff telegram_message_id constraint and frozen-history trigger remain unchanged.

-- App copies only. Stricter than the claim: any leftover {token} keeps the notice out of the chat.
create function public._member_notice_render(p_body text,p_params jsonb)returns text
language plpgsql immutable set search_path=''as $$
declare txt text:=p_body;kv record;
begin
 for kv in select key,value from jsonb_each_text(coalesce(p_params,'{}'))loop
  txt:=replace(txt,'{'||kv.key||'}',kv.value);
 end loop;
 if txt~'\{[^{}]+\}'then return null;end if;
 return txt;
end$$;

create function public._member_notice_app_text(p_member uuid,p_template text,p_params jsonb)returns text
language sql stable security definer set search_path=''as $$
 select case when t.approved then public._member_notice_render(t.body,p_params)end from public.system_message_templates t
 where t.template_id=p_template and t.locale=public._telegram_auth_locale(p_member)
 order by t.version desc limit 1
$$;

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
 loc:=public._telegram_auth_locale(p_member);
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



-- Proposal acceptance now sends member.booking_confirmed; this replaces the old no-send comment.
-- clinic-proposal-accepted sees current_arrangement updated earlier in the same command.
create or replace function public._member_notice_booking_event()returns trigger
language plpgsql security definer set search_path=''as $$
declare a public.booking_appointments;purpose text;actor uuid;arr jsonb;tpl text;
begin
 if new.kind not in('clinic-confirmed','clinic-proposal-accepted','clinic-declined','cancelled')then return null;end if;
 begin
  select * into a from public.booking_appointments where id=new.appointment_id;
  select n.purpose into purpose from public.booking_scheduling_notices n where n.id=new.notice_id;
  if new.kind in('clinic-confirmed','clinic-proposal-accepted')then
   arr:=a.current_arrangement;tpl:=case when new.kind='clinic-confirmed'and purpose='change'then 'member.booking_rescheduled'else 'member.booking_confirmed'end;
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


-- Keep the older proposal send when the booking group is off, and save its app copy once. This send predates the group
-- switches: it stays outside them and outside the throttle and hourly cap, so its journal row is outcome 'skipped', reason
-- 'direct_send', with no outbox link. Counting it as queued would use up the member's Telegram allowance (Astra MN-R1).
create or replace function public._clinic_proposal_notify(p_member uuid)returns uuid
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;pid uuid;mid uuid;route public.notice_channels;txt text;why text;
begin
 select pr.id into pid from public.clinic_booking_proposals pr join public.booking_appointments a on a.id=pr.appointment_id
 where a.member_id=p_member and pr.state='open'order by pr.created_at desc limit 1;
 if pid is null then return null;end if;
 if(select booking from public.member_notice_settings where singleton)is true then
  return public._member_notice_safe(p_member,'booking','booking.clinic_proposal','booking.proposal:'||pid::text,'{}','/patient/care','open_care');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('member-notice:'||p_member::text,0));
 if exists(select 1 from public.member_notices where event_key='booking.proposal:'||pid::text)then return null;end if;
 select * into route from public.notice_channels where template_id='booking.clinic_proposal';
 if exists(select 1 from public.workspace_staff where user_id=p_member)
  or exists(select 1 from public.clinic_portal_memberships where user_id=p_member)
  or coalesce(route.audience,'member')<>'member'then why:='staff_account';
 else
  if coalesce(route.chat,true)then txt:=public._member_notice_app_text(p_member,'booking.clinic_proposal','{}');end if;
  if route.telegram is false then why:='telegram_off';
  else
   select * into b from public.telegram_auth_bindings where auth_user_id=p_member and kind='member'and active order by created_at desc limit 1;
   if b.id is null then why:='not_connected';
   else
    mid:=public._telegram_auth_enqueue('booking.clinic_proposal',public._telegram_auth_locale(p_member),b.address,b.principal_ref,null,null);
    why:=case when mid is null then 'no_template'else 'direct_send'end;
   end if;
  end if;
 end if;
 -- Its own block: a failed journal row costs the app copy, never the send.
 begin
  insert into public.member_notices(member_id,event_key,notice_group,template_id,outcome,reason,telegram_message_id,app_text)
  values(p_member,'booking.proposal:'||pid::text,'booking','booking.clinic_proposal','skipped',why,null,txt);
  perform public._member_notice_trace(p_member,'booking.clinic_proposal','booking.proposal:'||pid::text,'booking','skipped',why);
 exception when others then null;
 end;
 return mid;
exception when others then
 -- Notice work is a subtransaction: a rendering/journal/outbox failure cannot undo the proposal.
 return null;
end$$;

-- Closure follows the original clinical/booking records; there is no new task registry.
create function public._member_notice_closed(p_member uuid,p_key text,p_template text,p_params jsonb)returns boolean
language plpgsql stable security definer set search_path=''as $$
declare part text[]:=string_to_array(p_key,':');w public.bp_weeks;
begin
 if part[1]in('reminder.tomorrow','reminder.soon','medicine')then
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

-- Binding and quiet-hours decisions keep their order; every closed notice is held before sending.
create or replace function public._telegram_auth_message_claim_core(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.telegram_auth_messages;n public.member_notices;hold text;
begin
 perform set_config('lock_timeout','2s',true);
 select * into m from public.telegram_auth_messages where id=p_message for update;
 if not found or m.state<>'queued'then return public._telegram_auth_message_claim_base(p_message,p_attempt);end if;
 select * into n from public.member_notices where telegram_message_id=m.id;
 if public._telegram_notice_bound(m.template_id)
  and not exists(select 1 from public.telegram_auth_bindings b where b.active and b.principal_ref=m.principal_ref and b.address=m.address
   and(m.template_id like 'staff\_message.%'or b.kind='member')and(n.id is null or b.auth_user_id=n.member_id))then hold:='binding_revoked';
 elsif n.id is not null and m.template_id like 'member.reminder\_%'and m.created_at>=clock_timestamp()-interval '30 minutes'
  and public._member_quiet_now(n.member_id,(clock_timestamp()at time zone 'Asia/Yerevan')::time)then
  -- Out of the queue until the next sweep, so waiting reminders never crowd out other messages (Astra round 2).
  update public.telegram_auth_messages set defer_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp()where id=m.id;
  return jsonb_build_object('ok',false,'code','quiet_hours');
 -- member.medicine_ask keeps its own claim guard (20261020105629).
 elsif n.id is not null and m.template_id<>'member.medicine_ask'and public._member_notice_closed(n.member_id,n.event_key,m.template_id,m.params)then hold:='event_changed';
 end if;
 if hold is not null then
  update public.telegram_auth_messages set state='held',reason=hold,state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id;
  return jsonb_build_object('ok',false,'code',hold);
 end if;
 return public._telegram_auth_message_claim_base(p_message,p_attempt);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end$$;


-- Sweep audit (latest definitions): member_notice_reminders_run, bp_week_reminders_run,
-- member_medicine_reminders_run, member_medicine_asks_run, programme_run and ldl_response_run
-- already select clinical/event sources without a Telegram binding predicate. No replacement
-- is needed. Keep their time windows, quiet hours, eligibility and Telegram-throttle retry
-- prefilters unchanged; each eligible unbound member now gets app text via _member_notice.

create table public.member_notice_seen(
 member_id uuid primary key references auth.users(id)on delete cascade,
 seen_at timestamptz not null
);
alter table public.member_notice_seen enable row level security;
revoke all on public.member_notice_seen from public,anon,authenticated,service_role;

create function public.member_notices_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();result jsonb;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 with recent as materialized(
  select n.id,n.created_at,n.app_text,n.event_key,n.template_id,n.params
  from public.member_notices n where n.member_id=uid and n.app_text is not null
  order by n.created_at desc,n.id desc limit 200
 ), items as materialized(
  select r.*,case when r.created_at>=now()-interval '7 days'
   then public._member_notice_closed(uid,r.event_key,r.template_id,r.params)else true end closed from recent r
 )
 select jsonb_build_object('notices',coalesce(jsonb_agg(jsonb_build_object('id',i.id,'text',i.app_text,'at',i.created_at,'closed',i.closed)order by i.created_at,i.id),'[]'::jsonb),
  'firstUnseen',(select x.id from items x where not x.closed
   and x.created_at>coalesce((select s.seen_at from public.member_notice_seen s where s.member_id=uid),'-infinity'::timestamptz)
   order by x.created_at,x.id limit 1))into result from items i;
 return result;
end$$;

create function public.member_notices_mark_seen(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();stamp timestamptz;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 select created_at into stamp from public.member_notices where id=p_id and member_id=uid and app_text is not null;
 if not found then return jsonb_build_object('ok',false);end if;
 insert into public.member_notice_seen(member_id,seen_at)values(uid,stamp)
 on conflict(member_id)do update set seen_at=greatest(public.member_notice_seen.seen_at,excluded.seen_at);
 return jsonb_build_object('ok',true);
end$$;

revoke all on function public._member_notice_render(text,jsonb),public._member_notice_app_text(uuid,text,jsonb),
 public._member_notice(uuid,text,text,text,jsonb,text,text),public._member_notice_closed(uuid,text,text,jsonb),
 public._clinic_proposal_notify(uuid),public._member_notice_booking_event(),
 public._telegram_auth_message_claim_core(uuid,uuid),
 public.member_notices_read(),public.member_notices_mark_seen(uuid)from public,anon,authenticated,service_role;
grant execute on function public.member_notices_read(),public.member_notices_mark_seen(uuid)to authenticated;
-- CREATE OR REPLACE preserves the existing grants of the sweeps and booking entry points.
