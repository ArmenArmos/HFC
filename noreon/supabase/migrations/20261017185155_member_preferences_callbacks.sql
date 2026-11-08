-- Member preferences and callback requests (prototype D6 and D8, 17 Oct 2026).
--
-- * Text size (D8): Normal, Large or Extra large, kept per member so it follows them to
--   every device and the installed app. Presentation only.
-- * Contact preference (D6): how the care team should reach the member (Telegram message or
--   phone call) and the parts of the day that suit them. Telegram stays the only messaging
--   channel; "phone" means a person calls. Nothing automatic sends by phone.
-- * Callback request (D6): the member asks for a call or message from a nurse or the care
--   team. It lands in an admin queue with the member's preference copied onto it. No free
--   text, on purpose: a queue that is not watched around the clock must not collect symptoms
--   (the request screen sends anyone unwell to 103 instead).
--
-- Dark: no member_callback_settings row (or enabled=false) refuses new requests; the
-- preferences themselves are always available. The admin Telegram notice is a second
-- switch: it runs only when the staff notice path (staff_message_notice_settings.enabled) is
-- on, goes to active admins with a staff Telegram binding (at most one per admin per
-- throttle_seconds), and its wording is an unapproved
-- placeholder that the auth outbox holds at claim. A notice failure never undoes a request.

-- 1. Tables -------------------------------------------------------------------------------

create table public.member_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 text_size text not null default 'normal'check(text_size in('normal','large','xlarge')),
 contact_channel text not null default 'telegram'check(contact_channel in('telegram','phone')),
 contact_times text[] not null default '{}'check(contact_times <@ array['morning','afternoon','evening']and cardinality(contact_times)<=3),
 updated_at timestamptz not null default clock_timestamp()
);

create table public.member_callback_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 -- New requests a member may open in 24 hours (one may be open at a time).
 daily_limit integer not null default 3 check(daily_limit between 1 and 20),
 updated_at timestamptz not null default clock_timestamp()
);

create table public.member_callback_requests (
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id) on delete cascade,
 requested_from text not null check(requested_from in('nurse','care_team')),
 -- Copied from member_preferences when the request is made.
 contact_channel text not null check(contact_channel in('telegram','phone')),
 contact_times text[] not null check(contact_times <@ array['morning','afternoon','evening']),
 state text not null default 'open'check(state in('open','done','cancelled')),
 -- Who closed it: staff are deactivated, not deleted, so no foreign key.
 closed_by uuid,closed_by_role text check(closed_by_role in('member','admin')),closed_at timestamptz,
 outcome text check(outcome in('reached','no_answer','cancelled_by_member','not_needed')),
 created_at timestamptz not null default clock_timestamp(),
 check((state='open')=(closed_at is null and closed_by is null and outcome is null)),
 check(state='open'or(closed_by_role is not null and outcome is not null)),
 check(state<>'cancelled'or outcome in('cancelled_by_member','not_needed'))
);
create unique index member_callback_one_open on public.member_callback_requests(member_id)where state='open';
create index member_callback_member_created on public.member_callback_requests(member_id,created_at desc);
create index member_callback_queue on public.member_callback_requests(state,created_at);

create table public.member_callback_notices (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.member_callback_requests(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 telegram_message_id uuid not null unique references public.telegram_auth_messages(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(request_id,recipient_id)
);
create index member_callback_notices_recipient on public.member_callback_notices(recipient_id,created_at desc);

alter table public.member_preferences enable row level security;
alter table public.member_callback_settings enable row level security;
alter table public.member_callback_requests enable row level security;
alter table public.member_callback_notices enable row level security;
revoke all on public.member_preferences,public.member_callback_settings,public.member_callback_requests,public.member_callback_notices
 from public,anon,authenticated,service_role;
-- A member reads only their own rows. Every write goes through the functions below.
grant select on public.member_preferences,public.member_callback_requests to authenticated;
create policy own_member_preferences on public.member_preferences for select to authenticated using((select auth.uid())=user_id);
create policy own_member_callback_requests on public.member_callback_requests for select to authenticated using((select auth.uid())=member_id);

-- 2. Wording (placeholder, held at claim until approved) -----------------------------------

insert into public.system_message_templates(template_id,version,locale,body)values
 ('callback_request.notice',1,'en','UNAPPROVED PLACEHOLDER. A member asked to be contacted. Open the callback queue in the Noreon staff app.'),
 ('callback_request.notice',1,'hy','UNAPPROVED PLACEHOLDER. Անդամը խնդրել է կապվել իր հետ։ Բացեք հետզանգերի հերթը Noreon-ի աշխատակազմի հավելվածում։');

-- 3. Member functions ----------------------------------------------------------------------

create function public._member_callback_member()returns uuid language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();
begin
 if auth.role()is distinct from 'authenticated'or uid is null then raise insufficient_privilege using message='Sign in required';end if;
 if not exists(select 1 from public.profiles where id=uid and nullif(btrim(display_name),'')is not null)then
  raise insufficient_privilege using message='Complete your profile first';end if;
 -- Staff accounts are not members (Fable F1): a doctor must not land in the queue as a member.
 if exists(select 1 from public.workspace_staff where user_id=uid)then raise insufficient_privilege using message='Member account required';end if;
 return uid;
end$$;

-- Null keeps the saved value, so the text-size control and the contact form save separately.
create function public.save_member_preferences(p_text_size text default null,p_contact_channel text default null,p_contact_times text[] default null)
returns jsonb language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();p public.member_preferences;
begin
 if p_text_size is not null and p_text_size not in('normal','large','xlarge')then raise check_violation using message='Choose a text size';end if;
 if p_contact_channel is not null and p_contact_channel not in('telegram','phone')then raise check_violation using message='Choose how to contact you';end if;
 if p_contact_times is not null and(array_position(p_contact_times,null)is not null or not p_contact_times <@ array['morning','afternoon','evening'])then
  raise check_violation using message='Choose times of day';end if;
 insert into public.member_preferences as m(user_id,text_size,contact_channel,contact_times)
 values(uid,coalesce(p_text_size,'normal'),coalesce(p_contact_channel,'telegram'),
  coalesce((select array_agg(distinct t order by t)from unnest(p_contact_times)t),'{}'))
 on conflict(user_id)do update set
  text_size=coalesce(p_text_size,m.text_size),
  contact_channel=coalesce(p_contact_channel,m.contact_channel),
  contact_times=coalesce((select array_agg(distinct t order by t)from unnest(p_contact_times)t),case when p_contact_times is null then m.contact_times else '{}'end),
  updated_at=clock_timestamp()
 returning * into p;
 return jsonb_build_object('textSize',p.text_size,'contactChannel',p.contact_channel,'contactTimes',to_jsonb(p.contact_times));
end$$;

-- What the contact screen needs in one call: the saved preference, whether requests are on,
-- and the member's open request if any.
create function public.member_contact_status()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();p public.member_preferences;r public.member_callback_requests;s public.member_callback_settings;
begin
 if auth.role()is distinct from 'authenticated'or uid is null then raise insufficient_privilege using message='Sign in required';end if;
 select * into p from public.member_preferences where user_id=uid;
 select * into s from public.member_callback_settings where singleton;
 select * into r from public.member_callback_requests where member_id=uid and state='open';
 return jsonb_build_object('textSize',coalesce(p.text_size,'normal'),'contactChannel',coalesce(p.contact_channel,'telegram'),
  'contactTimes',to_jsonb(coalesce(p.contact_times,'{}')),'callbacksEnabled',coalesce(s.enabled,false),
  'openRequest',case when r.id is null then null else jsonb_build_object('id',r.id,'requestedFrom',r.requested_from,'createdAt',r.created_at)end);
end$$;

-- Admins with a staff Telegram binding hear about a new request when the staff notice path is
-- on. Content: a fixed sentence and a button to the queue; no member name, no health content.
create function public._member_callback_notice(r public.member_callback_requests)returns integer
language plpgsql security definer set search_path=''as $$
declare s public.staff_message_notice_settings;a record;mid uuid;queued integer:=0;
begin
 select * into s from public.staff_message_notice_settings where singleton;
 if not found or not s.enabled then return 0;end if;
 for a in select ws.user_id,b.address,b.principal_ref from public.workspace_staff ws
  join lateral(select address,principal_ref from public.telegram_auth_bindings where auth_user_id=ws.user_id and kind='staff'and active order by created_at desc limit 1)b on true
  where ws.role='admin'and ws.active and ws.removed_at is null order by ws.user_id loop
  -- At most one notice per admin per throttle_seconds (Fable F2); the queue shows every request.
  perform pg_advisory_xact_lock(hashtextextended('member-callback-notice:'||a.user_id::text,0));
  if exists(select 1 from public.member_callback_notices where recipient_id=a.user_id
   and created_at>clock_timestamp()-make_interval(secs=>s.throttle_seconds))then continue;end if;
  mid:=public._telegram_auth_enqueue('callback_request.notice',public._telegram_auth_locale(a.user_id),a.address,a.principal_ref,
   jsonb_build_object('kind','open_url','url',s.staff_origin||'/staff/real/callbacks'),null);
  if mid is null then continue;end if;
  insert into public.member_callback_notices(request_id,recipient_id,telegram_message_id)values(r.id,a.user_id,mid);
  queued:=queued+1;
 end loop;
 return queued;
exception when others then
 -- Never undo the member's request: drop the notice, keep the code only.
 raise warning 'callback notice dropped (%)',sqlstate;
 return 0;
end$$;

create function public.member_request_callback(p_from text)returns jsonb language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();s public.member_callback_settings;p public.member_preferences;r public.member_callback_requests;
begin
 if p_from is null or p_from not in('nurse','care_team')then raise check_violation using message='Choose who should contact you';end if;
 select * into s from public.member_callback_settings where singleton;
 if not found or not s.enabled then return jsonb_build_object('ok',false,'code','unavailable');end if;
 -- One member at a time: the open-request and daily-limit reads below cannot race.
 perform pg_advisory_xact_lock(hashtextextended('member-callback:'||uid::text,0));
 select * into r from public.member_callback_requests where member_id=uid and state='open';
 if found then return jsonb_build_object('ok',true,'result','already_open','id',r.id,'createdAt',r.created_at);end if;
 if(select count(*)from public.member_callback_requests where member_id=uid and created_at>clock_timestamp()-interval '24 hours')>=s.daily_limit then
  return jsonb_build_object('ok',false,'code','rate_limited');end if;
 select * into p from public.member_preferences where user_id=uid;
 insert into public.member_callback_requests(member_id,requested_from,contact_channel,contact_times)
 values(uid,p_from,coalesce(p.contact_channel,'telegram'),coalesce(p.contact_times,'{}'))returning * into r;
 perform public._member_callback_notice(r);
 return jsonb_build_object('ok',true,'result','created','id',r.id,'createdAt',r.created_at);
end$$;

create function public.member_cancel_callback(p_request uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare uid uuid:=public._member_callback_member();n integer;
begin
 update public.member_callback_requests set state='cancelled',outcome='cancelled_by_member',closed_by=uid,closed_by_role='member',closed_at=clock_timestamp()
  where id=p_request and member_id=uid and state='open';
 get diagnostics n=row_count;
 return jsonb_build_object('ok',n=1,'code',case when n=1 then null else 'not_open'end);
end$$;

-- 4. Admin queue ---------------------------------------------------------------------------

-- Same caller derivation as the coordination queue: a current session and an active admin.
create function public._member_callback_admin()returns boolean language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then return false;end if;
 if not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id'and user_id=auth.uid()and(not_after is null or not_after>now()))then return false;end if;
 return coalesce(public.real_clinical_staff_identity()->>'role'='admin',false);
end$$;

create function public.staff_callback_queue()returns jsonb language plpgsql stable security definer set search_path=''as $$
begin
 if not public._member_callback_admin()then raise insufficient_privilege using message='Current administrator required';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'memberId',r.member_id,'memberName',p.display_name,'phone',u.phone,
   'locale',coalesce(p.locale,'hy'),'requestedFrom',r.requested_from,'contactChannel',r.contact_channel,'contactTimes',to_jsonb(r.contact_times),
   'state',r.state,'outcome',r.outcome,'createdAt',r.created_at,'closedAt',r.closed_at,
   'telegramLinked',exists(select 1 from public.conversation_endpoints e where e.member_id=r.member_id and e.adapter='telegram'and e.active))
   order by r.state<>'open',case when r.state='open'then r.created_at end,r.closed_at desc),'[]')
  from(select * from public.member_callback_requests where state='open'or closed_at>clock_timestamp()-interval '7 days'order by created_at desc limit 200)r
  join public.profiles p on p.id=r.member_id join auth.users u on u.id=r.member_id);
end$$;

create function public.staff_callback_close(p_request uuid,p_outcome text)returns jsonb language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 if not public._member_callback_admin()then raise insufficient_privilege using message='Current administrator required';end if;
 if p_outcome is null or p_outcome not in('reached','no_answer','not_needed')then raise check_violation using message='Choose an outcome';end if;
 update public.member_callback_requests set state=case when p_outcome='not_needed'then 'cancelled'else 'done'end,outcome=p_outcome,
  closed_by=auth.uid(),closed_by_role='admin',closed_at=clock_timestamp()
  where id=p_request and state='open';
 get diagnostics n=row_count;
 return jsonb_build_object('ok',n=1,'code',case when n=1 then null else 'not_open'end);
end$$;

-- 5. Grants --------------------------------------------------------------------------------

revoke all on function public._member_callback_member(),public.save_member_preferences(text,text,text[]),public.member_contact_status(),
 public._member_callback_notice(public.member_callback_requests),public.member_request_callback(text),public.member_cancel_callback(uuid),
 public._member_callback_admin(),public.staff_callback_queue(),public.staff_callback_close(uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.save_member_preferences(text,text,text[]),public.member_contact_status(),public.member_request_callback(text),
 public.member_cancel_callback(uuid),public.staff_callback_queue(),public.staff_callback_close(uuid,text)to authenticated;
