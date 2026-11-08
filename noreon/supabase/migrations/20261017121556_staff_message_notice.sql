-- Telegram notice to staff for routine member messages (dark).
--
-- A new member message already records a conversation_doctor_alerts row and shows in the
-- staff app; nobody is told. This sends one short Telegram notice to the member's assigned
-- doctor (or, when the member has no active assigned doctor, to every active admin) through
-- the auth outbox, to staff who enrolled Telegram from Doctors & nurses (an active
-- kind='staff' binding). Same pattern as care_alert.staff_notice (20261017083922).
--
-- Content: no member name, no message text, no health content. A fixed sentence and one
-- "open" button whose link is the conversation (doctor) or the unassigned queue / member
-- file (admins) on the staff app. Doctors answer in the staff app only; the bot takes no reply.
--
-- Throttle: at most one notice per conversation and recipient per throttle_seconds (10 min).
-- Dark: no staff_message_notice_settings row (or enabled=false) sends nothing. The wording
-- and the button label are unapproved placeholders; the auth outbox holds them at claim.
-- Every decision is journaled (step doctor_alert): identifiers and codes only.
-- Never raises: the notice runs inside member message intake, which must not roll back.

-- 1. Tables -------------------------------------------------------------------------------

create table public.staff_message_notice_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 -- Where the button points. One origin, no path; the adapter also refuses anything but the staff host.
 staff_origin text not null default 'https://backoffice.noreon.health'check(staff_origin ~ '^https://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$'),
 throttle_seconds integer not null default 600 check(throttle_seconds between 60 and 86400),
 updated_at timestamptz not null default clock_timestamp()
);

create table public.staff_message_notices (
 id uuid primary key default gen_random_uuid(),
 alert_id uuid not null references public.conversation_doctor_alerts(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 recipient_role text not null check(recipient_role in('doctor','admin')),
 telegram_message_id uuid not null unique references public.telegram_auth_messages(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(alert_id,recipient_id)
);
create index staff_message_notices_throttle on public.staff_message_notices(conversation_id,recipient_id,created_at desc);

-- 2. Wording (placeholders, held at claim until approved) ---------------------------------

insert into public.system_message_templates(template_id,version,locale,body)values
 ('staff_message.notice',1,'en','UNAPPROVED PLACEHOLDER. You have a new message from a member. Open it in the Noreon staff app.'),
 ('staff_message.notice',1,'hy','UNAPPROVED PLACEHOLDER. Դուք նոր հաղորդագրություն ունեք անդամից։ Բացեք այն Noreon-ի աշխատակազմի հավելվածում։'),
 ('staff_message.open_label',1,'en','Open in Noreon'),
 ('staff_message.open_label',1,'hy','Բացել Noreon-ում');

-- 3. Auth outbox: an "open" link button -------------------------------------------------

-- The stored keyboard carries the full link; its shape is fixed here so nothing but a staff
-- app path can ever be queued. The label is looked up (approved only) at claim.
alter table public.telegram_auth_messages drop constraint telegram_auth_messages_keyboard_check;
alter table public.telegram_auth_messages add constraint telegram_auth_messages_keyboard_check check(keyboard is null
 or keyboard in('{"kind":"request_contact"}'::jsonb,'{"kind":"remove"}'::jsonb)
 or coalesce(keyboard->>'kind'='open_url'and(keyboard-'kind'-'url')='{}'::jsonb and jsonb_typeof(keyboard->'url')='string'
  and keyboard->>'url'~'^https://[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?/staff/real/[a-z0-9/-]{1,120}$',false));

-- Same as 20261016182740 plus the open_url button: held while its label is unapproved.
create or replace function public.telegram_auth_message_claim(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.telegram_auth_messages;t public.system_message_templates;lbl public.system_message_templates;envelope jsonb;hold text;
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
  select * into lbl from public.system_message_templates where template_id='staff_message.open_label'and locale=m.locale and approved order by version desc limit 1;
 end if;
 hold:=case when not t.approved then 'template_unapproved'when t.body<>m.body then 'template_changed'
  when m.keyboard->>'kind'in('request_contact','open_url')and lbl.body is null then 'template_unapproved'
  when m.created_at<clock_timestamp()-interval '15 minutes'then 'expired'end;
 if hold is not null then
  update public.telegram_auth_messages set state='held',reason=hold,state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id;
  return jsonb_build_object('ok',false,'code',hold);end if;
 envelope:=jsonb_build_object('messageId',m.id,'attemptId',p_attempt,'address',m.address,'text',m.body,
  'keyboard',case m.keyboard->>'kind'when 'request_contact'then jsonb_build_object('kind','request_contact','label',lbl.body)when 'remove'then jsonb_build_object('kind','remove')
   when 'open_url'then jsonb_build_object('kind','open_url','label',lbl.body,'url',m.keyboard->>'url')end);
 update public.telegram_auth_messages set state='sending',state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id returning * into m;
 insert into public.telegram_auth_message_attempts(id,message_id,state_seq,envelope)values(p_attempt,m.id,m.state_seq,envelope);
 return jsonb_build_object('ok',true,'fresh',true,'envelope',jsonb_strip_nulls(envelope));
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end$$;

-- 4. The notice --------------------------------------------------------------------------

create function public._staff_message_notice_trace(a public.conversation_doctor_alerts,p_name text,p_outcome text,p_reason text,p_attrs jsonb)returns void
language sql security definer set search_path=''as $$
 select public._conversation_trace(a.member_id,a.conversation_id,'doctor_alert',a.id::text,'doctor_alert',p_name,p_outcome,p_reason,'staff_message.notice',null,'system',null,
  jsonb_build_object('noreon.doctor.id',a.doctor_id,'noreon.message.seq',a.message_seq,'messaging.system','telegram')||coalesce(p_attrs,'{}'));
$$;

-- Recipients: the assigned doctor when that doctor is active staff, otherwise every active
-- admin; only staff with an active staff Telegram binding. A recipient notified about this
-- conversation within throttle_seconds is skipped (the staff app shows every message).
create function public._staff_message_notice(a public.conversation_doctor_alerts)returns void
language plpgsql security definer set search_path=''as $$
declare s public.staff_message_notice_settings;doctor_active boolean;r record;mid uuid;url text;
 queued integer:=0;throttled integer:=0;eligible integer:=0;candidates integer:=0;
begin
 select * into s from public.staff_message_notice_settings where singleton;
 if not found or not s.enabled then
  perform public._staff_message_notice_trace(a,'doctor_alert.staff_notice_skipped','skipped','staff_notice_off','{}');return;end if;
 doctor_active:=a.doctor_id is not null and exists(select 1 from public.workspace_staff where user_id=a.doctor_id and role='doctor'and active and removed_at is null);
 url:=s.staff_origin||case when doctor_active then '/staff/real/conversations/'||a.member_id::text
  when a.doctor_id is null then '/staff/real/unassigned'else '/staff/real/members/'||a.member_id::text end;
 for r in select ws.user_id,ws.role,b.address,b.principal_ref,b.id is not null bound
  from public.workspace_staff ws
  left join lateral(select id,address,principal_ref from public.telegram_auth_bindings where auth_user_id=ws.user_id and kind='staff'and active order by created_at desc limit 1)b on true
  where ws.active and ws.removed_at is null and(case when doctor_active then ws.user_id=a.doctor_id and ws.role='doctor'else ws.role='admin'end)
  order by ws.user_id loop
  candidates:=candidates+1;
  if not r.bound then continue;end if;
  eligible:=eligible+1;
  -- Serialises two alerts for one conversation and recipient (the throttle read below).
  perform pg_advisory_xact_lock(hashtextextended('staff-message-notice:'||a.conversation_id::text||':'||r.user_id::text,0));
  if exists(select 1 from public.staff_message_notices where conversation_id=a.conversation_id and recipient_id=r.user_id
   and created_at>clock_timestamp()-make_interval(secs=>s.throttle_seconds))then throttled:=throttled+1;continue;end if;
  mid:=public._telegram_auth_enqueue('staff_message.notice',public._telegram_auth_locale(r.user_id),r.address,r.principal_ref,jsonb_build_object('kind','open_url','url',url),null);
  if mid is null then continue;end if;
  insert into public.staff_message_notices(alert_id,conversation_id,recipient_id,recipient_role,telegram_message_id)values(a.id,a.conversation_id,r.user_id,r.role,mid);
  queued:=queued+1;
 end loop;
 if queued>0 then
  perform public._staff_message_notice_trace(a,'doctor_alert.staff_notice_queued','queued',
   case when(select approved from public.system_message_templates where template_id='staff_message.notice'order by version desc limit 1)is not true
    then 'queued_wording_unapproved_will_be_held'else 'staff_notice_queued'end,
   jsonb_build_object('noreon.staff_notice.recipients',queued,'noreon.staff_notice.throttled',throttled,'noreon.staff_notice.to',case when doctor_active then 'assigned_doctor'else 'admins'end));
 else
  perform public._staff_message_notice_trace(a,'doctor_alert.staff_notice_skipped','skipped',
   case when candidates=0 then 'no_recipient'when eligible=0 then 'no_enrolled_staff'when throttled>0 then 'recently_notified'else 'no_template_available'end,
   jsonb_build_object('noreon.staff_notice.to',case when doctor_active then 'assigned_doctor'else 'admins'end));
 end if;
exception when others then
 -- Never undo the member's message: drop the notice, keep the code only.
 raise warning 'staff message notice dropped (%)',sqlstate;
 perform public._staff_message_notice_trace(a,'doctor_alert.staff_notice_skipped','skipped','staff_notice_error',jsonb_build_object('noreon.error.sqlstate',sqlstate));
end$$;

create function public._staff_message_notice_on_alert()returns trigger language plpgsql security definer set search_path=''as $$
begin
 perform public._staff_message_notice(new);
 return null;
end$$;
create trigger staff_message_notice after insert on public.conversation_doctor_alerts
 for each row execute function public._staff_message_notice_on_alert();

-- Telegram outcome of each notice, journaled on its alert.
create function public._trace_staff_message_notice()returns trigger language plpgsql security definer set search_path=''as $$
declare a public.conversation_doctor_alerts;
begin
 if new.state is not distinct from old.state or new.state not in('held','accepted_by_provider','definitely_failed','unknown')then return null;end if;
 select al.* into a from public.staff_message_notices n join public.conversation_doctor_alerts al on al.id=n.alert_id where n.telegram_message_id=new.id;
 if not found then return null;end if;
 perform public._staff_message_notice_trace(a,'doctor_alert.staff_notice_'||case new.state when 'accepted_by_provider'then 'sent'when 'definitely_failed'then 'failed'else new.state end,
  case new.state when 'accepted_by_provider'then 'sent'when 'definitely_failed'then 'failed'else new.state end,coalesce(new.reason,new.state),'{}');
 return null;
end$$;
create trigger staff_message_notice_trace after update of state on public.telegram_auth_messages
 for each row execute function public._trace_staff_message_notice();

-- 5. RLS and grants ----------------------------------------------------------------------

alter table public.staff_message_notice_settings enable row level security;
alter table public.staff_message_notices enable row level security;
revoke all on public.staff_message_notice_settings,public.staff_message_notices from public,anon,authenticated,service_role;
revoke all on function public._staff_message_notice_trace(public.conversation_doctor_alerts,text,text,text,jsonb),public._staff_message_notice(public.conversation_doctor_alerts),
 public._staff_message_notice_on_alert(),public._trace_staff_message_notice()from public,anon,authenticated,service_role;
