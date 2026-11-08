-- Zoe coach C0: the safety and state foundation for proactive coaching (output/zoe-coach/COACH_SPEC.md §11 row C0, §8.2-8.4,
-- §8.8; Armen approved the design 20 Oct). Dark: zoe_settings.coach_enabled, default off, and nothing schedules a coach
-- event yet (C4 does). No member-facing copy: the consent wordings are null until Tatevik approves them, and the Telegram
-- teaser template comes with C4. No clinical rule changes.
--
-- 1. Settings: coach_enabled, the coach send window (10:00-20:00 Yerevan), the daily and weekly caps, and one wording
--    version per new consent kind (null: the kind cannot be granted).
-- 2. Consent kinds zoe_coach_checkins and zoe_memory in zoe_consents, granted through zoe_coach_consent_set (the existing
--    zoe_consent_set and its view are unchanged, so the running app's strict parse is unaffected).
-- 3. _zoe_coach_block_reason(member) / zoe_coach_blocked(member): coach off, Zoe consent, the coach (or memory) consent,
--    free mode, an assigned doctor, a published plan, doctor takeover (#369), an active symptom intake, a 103 route in
--    the last 7 days or a same-day route in the last 72 hours (unless the doctor resumed coaching since), any open care
--    alert, an active safety hold, and the spend caps.
-- 4. One quiet rule for proactive Zoe messages: inside the coach window AND outside the member's own quiet hours
--    (patient_reminder_preferences, default 22:00-07:00, _member_quiet_now).
-- 5. coach_events: one row per member, kind and ISO week (Yerevan). States scheduled -> generating -> ready -> queued ->
--    sent, plus deferred (retry_at, reason; retryable) and cancelled (reason; terminal). Transitions are checked by a
--    trigger, and every transition runs under the per-member advisory lock zoe-coach:<member>, where the daily and weekly
--    caps are also counted.
-- 6. zoe_runs.kind: 'inbound' (every existing run) or 'coach_checkin' / 'coach_nudge'. A coach run has no message_seq, so
--    it can never cover an inbound member message. Coach runs finish only through zoe_coach_finish (trigger).
-- 7. zoe_coach_schedule (C4's entry), zoe_coach_claim (refuses while any member message is unclaimed, an inbound run is
--    open, or the member is blocked; inbound always wins, the coach row waits 10 minutes), zoe_coach_reserve (the same
--    spend caps through zoe_run_reserve), zoe_coach_finish (publication: one transaction under the conversation row
--    lock, which member-message inserts also take, re-checking everything; a refused publication is recorded as
--    discarded and the coach row deferred or cancelled; nothing stale is ever stored).
-- 8. zoe_coach_messages: the published coach text (not conversation_messages, not zoe_member_answers; see
--    output/zoe-coach/C0-STATUS.md decision 1). It does not touch the 103 window or any doctor approval.
-- 9. Delivery: zoe_coach_queue_teaser enqueues the Telegram teaser; telegram_auth_message_claim (wrapper; the previous
--    function is kept as _telegram_auth_message_claim_core) re-checks a coach teaser at the moment of sending and holds it,
--    deferring or cancelling the coach row, when any check fails. Withdrawing a consent, pausing check-ins, a doctor
--    takeover, and switching coaching or free mode off cancel open coach rows and hold their queued teasers in the same
--    transaction.
-- 10. zoe_run_claim: "the latest member message not covered by a run" instead of "the latest conversation message, which
--    must be member-authored" (§8.8.5), so no proactive row can ever hide a pending member reply. Otherwise unchanged.
-- 11. Member and doctor surfaces: zoe_coach_member_status, zoe_coach_consent_set, zoe_coach_pause (member);
--    doctor_zoe_coach, doctor_zoe_coach_resume (the assigned doctor). Tables have RLS on and no grants.
-- Lock order everywhere: zoe_runs row -> conversations row -> zoe-coach:<member> -> coach_events row -> outbox row.

-- 1. Settings ---------------------------------------------------------------------------------------------------------
alter table public.zoe_settings
 add column coach_enabled boolean not null default false,
 add column coach_window_start time not null default '10:00',
 add column coach_window_end time not null default '20:00',
 add column coach_daily_max integer not null default 1 check(coach_daily_max between 0 and 2),
 add column coach_weekly_max integer not null default 2 check(coach_weekly_max between 0 and 4),
 add column coach_checkins_wording_version text check(coach_checkins_wording_version ~ '^[a-z0-9-]{1,64}$'),
 add column memory_wording_version text check(memory_wording_version ~ '^[a-z0-9-]{1,64}$'),
 add constraint zoe_settings_coach_window check(coach_window_start<coach_window_end);
comment on column public.zoe_settings.coach_enabled is
 'Zoe coaching (check-ins, nudges, memory; COACH_SPEC C0). Off until C2/C4 give it something to do, then on in staging. zoe_coach_blocked reports coach_off while false.';
comment on column public.zoe_settings.coach_checkins_wording_version is
 'Wording id of the zoe_coach_checkins consent the app shows. Null: the consent cannot be granted (wording pending Tatevik).';
comment on column public.zoe_settings.memory_wording_version is
 'Wording id of the zoe_memory consent the app shows. Null: the consent cannot be granted (wording pending Tatevik).';

-- 2. Consent kinds ------------------------------------------------------------------------------------------------------
alter table public.zoe_consents drop constraint zoe_consents_kind_check;
alter table public.zoe_consents add constraint zoe_consents_kind_check
 check(kind in('zoe_reads_messages','zoe_scheduled_questions','zoe_coach_checkins','zoe_memory'));

-- A coach kind is current when its latest row is a grant of that kind's current wording.
create function public._zoe_coach_consent_current(m uuid,p_kind text)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select z.granted and z.wording_version=case p_kind when 'zoe_coach_checkins'then s.coach_checkins_wording_version
   when 'zoe_memory'then s.memory_wording_version end
  from public.zoe_consents z,public.zoe_settings s where s.singleton and z.member_id=m and z.kind=p_kind order by z.id desc limit 1),false)
$$;

-- 3. Coach tables -------------------------------------------------------------------------------------------------------
create table public.zoe_coach_member_state(
 member_id uuid primary key references auth.users(id)on delete cascade,
 checkins_paused boolean not null default false,
 paused_reason text check(paused_reason in('member','no_replies')),
 paused_at timestamptz,
 -- The doctor's one-tap resume after an urgent or same-day pause (§8.2): lifts the time-based pauses for routes before it.
 doctor_resumed_at timestamptz,
 doctor_resumed_by uuid,
 updated_at timestamptz not null default clock_timestamp(),
 check(not checkins_paused or(paused_reason is not null and paused_at is not null)),
 check((doctor_resumed_at is null)=(doctor_resumed_by is null))
);
alter table public.zoe_coach_member_state enable row level security;
revoke all on public.zoe_coach_member_state from public,anon,authenticated,service_role;

create table public.coach_events(
 id uuid primary key default gen_random_uuid(),
 event_key text not null unique check(event_key ~ '^coach-(checkin|nudge):[0-9a-f-]{36}:[0-9]{4}-W[0-9]{2}$'),
 member_id uuid not null references auth.users(id)on delete cascade,
 kind text not null check(kind in('checkin','nudge')),
 iso_week text not null check(iso_week ~ '^[0-9]{4}-W[0-9]{2}$'),
 state text not null default 'scheduled'check(state in('scheduled','generating','ready','queued','sent','deferred','cancelled')),
 due_at timestamptz not null,
 retry_at timestamptz,
 reason text check(reason ~ '^[a-z0-9_]{1,60}$'),
 conversation_id uuid references public.conversations(id)on delete cascade,
 run_id uuid unique references public.zoe_runs(id)on delete set null,
 -- The newest member message seq when the run was claimed (0: none). Publication refuses if a newer one exists.
 claimed_member_seq bigint,
 claimed_at timestamptz,
 attempts integer not null default 0 check(attempts between 0 and 10),
 telegram_message_id uuid unique references public.telegram_auth_messages(id)on delete set null,
 ready_at timestamptz,
 sent_at timestamptz,
 cancelled_at timestamptz,
 state_seq bigint not null default 0,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(member_id,kind,iso_week),
 check(event_key='coach-'||kind||':'||member_id::text||':'||iso_week),
 check((state='deferred')=(retry_at is not null)),
 check(state not in('deferred','cancelled')or reason is not null),
 check((state='cancelled')=(cancelled_at is not null)),
 check(state<>'generating'or(run_id is not null and claimed_at is not null and claimed_member_seq is not null)),
 check(state not in('ready','queued','sent')or ready_at is not null),
 check(state<>'queued'or telegram_message_id is not null),
 check((state='sent')=(sent_at is not null))
);
create index coach_events_due on public.coach_events(coalesce(retry_at,due_at))where state in('scheduled','deferred');
create index coach_events_member on public.coach_events(member_id,ready_at desc);
create index coach_events_generating on public.coach_events(claimed_at)where state='generating';
alter table public.coach_events enable row level security;
revoke all on public.coach_events from public,anon,authenticated,service_role;
comment on table public.coach_events is
 'Proactive Zoe coaching ledger (COACH_SPEC 8.8): one row per member, kind and ISO week. Codes only, no member text.';

-- Allowed transitions. A row never goes back to scheduled; cancelled and sent are terminal; a published row (ready_at
-- set) keeps its text across a delivery deferral and returns to ready, never to generating.
create function public._coach_events_transition()returns trigger language plpgsql set search_path=''as $$
begin
 if new.id<>old.id or new.member_id<>old.member_id or new.kind<>old.kind or new.iso_week<>old.iso_week or new.event_key<>old.event_key then
  raise exception using errcode='55000',message='Coach event identity is fixed';end if;
 if new.state<>old.state and not(
  (old.state='scheduled'and new.state in('generating','deferred','cancelled'))
  or(old.state='deferred'and new.state in('generating','deferred','cancelled')and old.ready_at is null)
  or(old.state='deferred'and new.state in('ready','deferred','cancelled')and old.ready_at is not null)
  or(old.state='generating'and new.state in('ready','deferred','cancelled'))
  or(old.state='ready'and new.state in('queued','sent','deferred','cancelled'))
  or(old.state='queued'and new.state in('sent','deferred','cancelled')))then
  raise exception using errcode='55000',message='Coach event transition not allowed: '||old.state||' to '||new.state;end if;
 if old.ready_at is not null and new.ready_at is distinct from old.ready_at then
  raise exception using errcode='55000',message='A published coach event keeps its publication time';end if;
 new.state_seq:=old.state_seq+1;new.updated_at:=clock_timestamp();
 return new;
end$$;
create trigger coach_events_transition before update on public.coach_events for each row execute function public._coach_events_transition();

create table public.zoe_coach_messages(
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null unique references public.coach_events(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 conversation_id uuid not null references public.conversations(id)on delete cascade,
 run_id uuid not null unique references public.zoe_runs(id)on delete cascade,
 kind text not null check(kind in('checkin','nudge')),
 body text not null check(length(body)between 1 and 600 and body=btrim(body)),
 language text not null check(language in('en','hy','ru')),
 provider text not null check(provider ~ '^[a-z0-9_.-]{1,64}$'),
 model text not null check(model ~ '^[a-z0-9_.:/-]{1,80}$'),
 created_at timestamptz not null default clock_timestamp()
);
create index zoe_coach_messages_member on public.zoe_coach_messages(member_id,created_at desc);
alter table public.zoe_coach_messages enable row level security;
revoke all on public.zoe_coach_messages from public,anon,authenticated,service_role;
comment on table public.zoe_coach_messages is
 'Published proactive Zoe texts (check-ins, nudges). Member-facing text, shown only while the coach row is live and the member is not blocked; deleted with the account.';
create function public._zoe_coach_messages_frozen()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Published coach texts are not edited';end$$;
create trigger zoe_coach_messages_frozen before update on public.zoe_coach_messages for each row execute function public._zoe_coach_messages_frozen();

-- 4. Coach runs ---------------------------------------------------------------------------------------------------------
alter table public.zoe_runs add column kind text not null default 'inbound'check(kind in('inbound','coach_checkin','coach_nudge'));
alter table public.zoe_runs alter column message_seq drop not null;
alter table public.zoe_runs add constraint zoe_runs_kind_seq check((kind='inbound')=(message_seq is not null));
alter table public.zoe_runs drop constraint zoe_runs_outcome_check;
alter table public.zoe_runs add constraint zoe_runs_outcome_check check(outcome in('draft_proposed','draft_blocked','summary_only','discarded','no_output','stale','skipped','answered',
 'intake_asked','intake_completed','intake_escalated','chatted','published'));
alter table public.zoe_runs add constraint zoe_runs_published_coach check(outcome is distinct from 'published'or kind<>'inbound');
comment on column public.zoe_runs.kind is
 'inbound: a member message (message_seq). coach_checkin / coach_nudge: a proactive coach run (no message_seq; finished only by zoe_coach_finish).';

-- A coach run is finished only by zoe_coach_finish (or recorded lost by the claim's reaper); the inbound finish refuses it.
create function public._zoe_runs_kind_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if new.kind<>old.kind then raise exception using errcode='55000',message='Zoe run kind is fixed';end if;
 if old.kind<>'inbound'and old.state='started'and new.state='finished'
  and coalesce(current_setting('noreon.zoe_coach_finish',true),'')<>'on'and new.reason_code is distinct from 'worker_lost'then
  raise exception using errcode='55000',message='A coach run is finished only by zoe_coach_finish';end if;
 return new;
end$$;
create trigger zoe_runs_kind_guard before update on public.zoe_runs for each row execute function public._zoe_runs_kind_guard();

-- 5. Rules --------------------------------------------------------------------------------------------------------------
create function public._zoe_coach_lock(m uuid)returns void language sql security definer set search_path=''as $$
 select pg_advisory_xact_lock(hashtextextended('zoe-coach:'||m::text,0))
$$;
create function public._zoe_coach_tz()returns text language sql stable security definer set search_path=''as $$
 select coalesce((select time_zone from public.zoe_settings where singleton),'Asia/Yerevan')
$$;
create function public._zoe_coach_iso_week(p_at timestamptz)returns text language sql stable security definer set search_path=''as $$
 select to_char(p_at at time zone public._zoe_coach_tz(),'IYYY-"W"IW')
$$;
-- The first moment after the ISO week (Monday 00:00 local) of a coach row's due time.
create function public._zoe_coach_week_end(due timestamptz)returns timestamptz language sql stable security definer set search_path=''as $$
 select (date_trunc('week',due at time zone public._zoe_coach_tz())+interval '7 days')at time zone public._zoe_coach_tz()
$$;

-- Why coaching may not run for this member now, or null. p_purpose 'checkin' (check-ins and nudges) or 'memory' (C5's
-- extraction). p_spend false at publication and delivery: the cost was already incurred, and the spend cap only stops
-- new model calls.
create function public._zoe_coach_block_reason(m uuid,p_purpose text default 'checkin',p_spend boolean default true)returns text
language plpgsql stable security definer set search_path=''as $$
declare s public.zoe_settings;cv public.conversations;st public.zoe_coach_member_state;resumed timestamptz;day date;cap numeric;member_cap numeric;spent numeric;
begin
 if m is null then return 'no_member';end if;
 select * into s from public.zoe_settings where singleton;
 if s.singleton is null or not s.coach_enabled then return 'coach_off';end if;
 if not s.consent_collection_enabled or s.consent_wording_version is null or not public._zoe_consent_current(m,'zoe_reads_messages')then return 'no_zoe_consent';end if;
 if not public._zoe_coach_consent_current(m,case when p_purpose='memory'then 'zoe_memory'else 'zoe_coach_checkins'end)then
  return case when p_purpose='memory'then 'no_memory_consent'else 'no_coach_consent'end;end if;
 if not s.health_answers_enabled then return 'free_mode_off';end if;
 if not exists(select 1 from public.patient_clinical_cases k where k.user_id=m and k.assigned_doctor_id is not null)then return 'no_assigned_doctor';end if;
 select * into cv from public.conversations where member_id=m;
 if cv.id is not null and public._zoe_doctor_mode(cv.id)then return 'doctor_takeover';end if;
 if cv.id is not null and exists(select 1 from public.zoe_symptom_intakes i where i.conversation_id=cv.id and i.state='active')then return 'intake_active';end if;
 -- Safety pauses (§8.2, A5 proposed): any open care alert; the 103 window; a 103 route in 7 days; a same-day route in 72 hours
 -- (the last two lifted by a doctor resume for routes before it).
 if exists(select 1 from public.care_alerts a where a.member_id=m and a.state='open')then return 'care_alert_open';end if;
 -- Astra C0-02: the 103 window itself (any urgent text in the last 120 minutes) is never lifted by a doctor resume.
 if exists(select 1 from public.zoe_member_answers a where a.member_id=m and a.kind='urgent'and a.created_at>clock_timestamp()-interval '120 minutes')then
  return 'urgent_window';end if;
 select * into st from public.zoe_coach_member_state where member_id=m;
 resumed:=coalesce(st.doctor_resumed_at,'-infinity'::timestamptz);
 if exists(select 1 from public.zoe_member_answers a where a.member_id=m and a.kind='urgent'and a.created_at>greatest(clock_timestamp()-interval '7 days',resumed))
  or exists(select 1 from public.care_alerts a where a.member_id=m and greatest(a.created_at,a.last_seen_at)>greatest(clock_timestamp()-interval '7 days',resumed))then
  return 'urgent_pause';end if;
 if exists(select 1 from public.conversation_trace_events e where e.member_id=m and e.subject_kind='zoe_run'
   and e.occurred_at>greatest(clock_timestamp()-interval '72 hours',resumed)and e.attributes->>'noreon.zoe.health.urgency'in('same_day','emergency'))then
  return 'same_day_pause';end if;
 if exists(select 1 from public.member_safety_holds h where h.member_id=m and h.cleared_at is null and(h.expires_at is null or h.expires_at>clock_timestamp()))then
  return 'safety_hold';end if;
 if not exists(select 1 from public.patient_care_plans p join public.patient_clinical_publications pb on pb.plan_id=p.id and pb.user_id=p.user_id
   where p.user_id=m and p.active and p.published_at<=now()and pb.published_at<=now())then return 'no_plan';end if;
 if p_spend then
  day:=(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date;
  cap:=least(coalesce(s.daily_spend_cap_usd,0),10);member_cap:=least(coalesce(s.member_daily_cap_usd,3.00),cap);
  select coalesce(sum(coalesce(z.cost_usd,z.estimate_usd)),0)into spent from public.zoe_runs z where z.member_id=m and z.reserved and z.spend_day=day;
  if spent>=member_cap or(select x.total from public._ai_spend(day,'high')x)>=cap then return 'spend_cap';end if;
 end if;
 return null;
end$$;
create function public.zoe_coach_blocked(m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select public._zoe_coach_block_reason(m,'checkin',true)is not null
$$;
comment on function public.zoe_coach_blocked(uuid)is
 'True while no proactive Zoe coaching may run for the member (COACH_SPEC 8.2-8.4, C0). _zoe_coach_block_reason gives the code.';

-- The one quiet rule for proactive Zoe messages (§4.2, P3): true when nothing may be sent at that moment.
create function public._zoe_coach_quiet(m uuid,p_at timestamptz)returns boolean
language sql stable security definer set search_path=''as $$
 select not(l>=s.coach_window_start and l<s.coach_window_end)or public._member_quiet_now(m,l)
 from(select coalesce(z.coach_window_start,'10:00')coach_window_start,coalesce(z.coach_window_end,'20:00')coach_window_end,coalesce(z.time_zone,'Asia/Yerevan')tz
  from(select 1)x left join public.zoe_settings z on z.singleton)s,lateral(select(p_at at time zone s.tz)::time l)t
$$;
-- The first 15-minute slot at or after p_from that is not quiet, within 3 days; null when there is none.
create function public._zoe_coach_next_send(m uuid,p_from timestamptz)returns timestamptz
language sql stable security definer set search_path=''as $$
 select min(greatest(t,p_from))from(select date_bin('15 minutes',p_from,'2000-01-01'::timestamptz)+make_interval(mins=>15*i)t from generate_series(0,4*24*3)i)x
 where t>=p_from-interval '15 minutes'and not public._zoe_coach_quiet(m,greatest(t,p_from))
$$;

-- Retryable reasons defer the row (§8.8.1); everything else cancels it.
create function public._zoe_coach_retryable(p_reason text)returns boolean language sql immutable set search_path=''as $$
 select p_reason in('spend_cap','intake_active','inbound_pending','inbound_unanswered','inbound_run_open','member_message_since_claim','quiet_hours','cap_daily','cap_weekly',
  'recently_active','worker_lost','generation_failed','reserve_refused','redeliver')
$$;

-- Every check for one coach row at one stage ('claim', 'publish', 'deliver'). Null reason: go. Caller holds the lock.
create function public._zoe_coach_check(ev public.coach_events,p_stage text,out reason text,out retry_at timestamptz)
language plpgsql stable security definer set search_path=''as $$
declare now_ timestamptz:=clock_timestamp();s public.zoe_settings;cv public.conversations;last_msg record;n integer;oldest timestamptz;tz text:=public._zoe_coach_tz();
begin
 if now_>=public._zoe_coach_week_end(ev.due_at)then reason:='week_passed';return;end if;
 reason:=public._zoe_coach_block_reason(ev.member_id,'checkin',p_stage='claim');
 if reason is not null then
  retry_at:=case reason when 'intake_active'then now_+interval '1 hour'when 'spend_cap'then
   public._zoe_coach_next_send(ev.member_id,((date_trunc('day',now_ at time zone tz)+interval '1 day')at time zone tz))end;
  return;end if;
 if exists(select 1 from public.zoe_coach_member_state st where st.member_id=ev.member_id and st.checkins_paused)then reason:='paused';return;end if;
 select * into s from public.zoe_settings where singleton;
 select * into cv from public.conversations where member_id=ev.member_id;
 -- Inbound always wins (§8.8.2, 8.8.4), at every stage (Astra C0-01): the newest member message must be resolved, by an
 -- inbound run or a doctor reply approved after it, whatever its age (Astra C0-03: an unanswered message older than the
 -- inbound claim's 24 hours keeps coaching away until someone answers it), and no inbound run may be open. Callers hold
 -- the conversation row lock, which member-message inserts take, so no message can slip in between this check and the write.
 if cv.id is not null then
  select m.seq,m.created_at into last_msg from public.conversation_messages m where m.conversation_id=cv.id and m.source in('telegram_member','authenticated_member')
   order by m.seq desc limit 1;
  if p_stage='publish'and coalesce(last_msg.seq,0)>coalesce(ev.claimed_member_seq,0)then reason:='member_message_since_claim';retry_at:=now_+interval '10 minutes';return;end if;
  if last_msg.seq is not null
   and not exists(select 1 from public.zoe_runs zr where zr.conversation_id=cv.id and zr.kind='inbound'and zr.message_seq>=last_msg.seq)
   and not exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=cv.id and ap.context_version>=last_msg.seq)then
   if last_msg.created_at>now_-interval '24 hours'then reason:='inbound_pending';retry_at:=now_+interval '10 minutes';
   else reason:='inbound_unanswered';retry_at:=now_+interval '1 hour';end if;
   return;end if;
  if exists(select 1 from public.zoe_runs zr where zr.conversation_id=cv.id and zr.kind='inbound'and zr.state='started')then
   reason:='inbound_run_open';retry_at:=now_+interval '10 minutes';return;end if;
  -- Recently active (§4.2): wait until 24 hours after the member's last message; more than 2 days late skips the week.
  if p_stage='claim'and last_msg.created_at>now_-interval '24 hours'then
   if last_msg.created_at+interval '24 hours'>ev.due_at+interval '2 days'then reason:='recently_active_skip';return;end if;
   reason:='recently_active';retry_at:=last_msg.created_at+interval '24 hours';return;end if;
 end if;
 if public._zoe_coach_quiet(ev.member_id,now_)then reason:='quiet_hours';retry_at:=public._zoe_coach_next_send(ev.member_id,now_);return;end if;
 -- Caps (§4.2, P4), counted under the lock over the member's other live rows: at most coach_daily_max a local day and
 -- coach_weekly_max in any 7 days. A row counts on the day it was generated or published AND on the day it was sent, and a
 -- published row not yet sent counts as going out now (Astra C0-04: a check-in published Monday and sent Tuesday holds
 -- Tuesday too) within its own week (Fable C0-05: a row stuck unsent never blocks later weeks). A row being generated counts as sent.
 -- Astra round 3: a row not yet sent counts only inside its own week, in both caps, whether or not the reaper reached it.
 select count(*)into n from public.coach_events o where o.member_id=ev.member_id and o.id<>ev.id and o.state<>'cancelled'
  and(o.ready_at is not null or o.state='generating')
  and((o.sent_at is not null and((coalesce(o.ready_at,o.claimed_at)at time zone tz)::date=(now_ at time zone tz)::date or(o.sent_at at time zone tz)::date=(now_ at time zone tz)::date))
   or(o.sent_at is null and now_<public._zoe_coach_week_end(o.due_at)));
 if n>=coalesce(s.coach_daily_max,1)then reason:='cap_daily';
  retry_at:=public._zoe_coach_next_send(ev.member_id,((date_trunc('day',now_ at time zone tz)+interval '1 day')at time zone tz));return;end if;
 select count(*),min(greatest(coalesce(o.ready_at,o.claimed_at),coalesce(o.sent_at,'-infinity'::timestamptz)))into n,oldest from public.coach_events o
  where o.member_id=ev.member_id and o.id<>ev.id and o.state<>'cancelled'and(o.ready_at is not null or o.state='generating')
   and((o.sent_at is not null and greatest(coalesce(o.ready_at,o.claimed_at),o.sent_at)>now_-interval '7 days')
    or(o.sent_at is null and now_<public._zoe_coach_week_end(o.due_at)));
 if n>=coalesce(s.coach_weekly_max,2)then reason:='cap_weekly';retry_at:=public._zoe_coach_next_send(ev.member_id,greatest(oldest+interval '7 days',now_+interval '15 minutes'));return;end if;
end$$;

-- Moves a coach row (caller holds the lock and the row). A deferral past the row's week, or with no send slot, cancels.
create function public._zoe_coach_move(p_event uuid,p_state text,p_reason text,p_retry timestamptz)returns public.coach_events
language plpgsql security definer set search_path=''as $$
declare ev public.coach_events;st text:=p_state;rs text:=p_reason;
begin
 select * into ev from public.coach_events where id=p_event;
 if st='deferred'and(p_retry is null or p_retry>=public._zoe_coach_week_end(ev.due_at))then st:='cancelled';rs:=coalesce(rs,'week_passed')||'_week_passed';end if;
 rs:=left(rs,60);
 update public.coach_events set state=st,reason=rs,retry_at=case when st='deferred'then p_retry end,
  cancelled_at=case when st='cancelled'then clock_timestamp()end
 where id=p_event returning * into ev;
 perform public._conversation_trace(ev.member_id,ev.conversation_id,'coach_event',ev.id::text,'zoe','zoe.coach.'||st,
  case st when 'cancelled'then 'block'when 'deferred'then 'skipped'else 'recorded'end,coalesce(rs,st),'zoe.coach','c0-1','system',null,
  jsonb_build_object('noreon.zoe.coach.kind',ev.kind,'noreon.zoe.coach.week',ev.iso_week,'noreon.zoe.coach.state',st));
 return ev;
end$$;

-- Cancels a member's open coach rows and holds their queued teasers (consent withdrawn, paused, takeover, switched off).
-- A sent row stays sent; its app card is hidden by the live check.
create function public._zoe_coach_cancel_member(m uuid,p_reason text)returns integer
language plpgsql security definer set search_path=''as $$
declare ev public.coach_events;n integer:=0;
begin
 if not exists(select 1 from public.coach_events where member_id=m and state in('scheduled','generating','ready','queued','deferred'))then return 0;end if;
 perform public._zoe_coach_lock(m);
 for ev in select * from public.coach_events where member_id=m and state in('scheduled','generating','ready','queued','deferred')for update loop
  update public.telegram_auth_messages set state='held',reason='coach_cancelled',state_seq=state_seq+1,updated_at=clock_timestamp()
   where id=ev.telegram_message_id and state='queued';
  perform public._zoe_coach_move(ev.id,'cancelled',p_reason,null);n:=n+1;
 end loop;
 return n;
end$$;

-- Cancel on state change, in the same transaction as the change.
create function public._zoe_coach_on_consent()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if not new.granted and new.kind in('zoe_reads_messages','zoe_coach_checkins')then
  perform public._zoe_coach_cancel_member(new.member_id,case new.kind when 'zoe_reads_messages'then 'no_zoe_consent'else 'no_coach_consent'end);end if;
 return null;
end$$;
create trigger zoe_consents_coach_cancel after insert on public.zoe_consents for each row execute function public._zoe_coach_on_consent();

create function public._zoe_coach_on_takeover()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.doctor_mode then perform public._zoe_coach_cancel_member(new.member_id,'doctor_takeover');end if;
 return null;
end$$;
create trigger zoe_doctor_mode_coach_cancel after insert or update on public.zoe_doctor_mode for each row execute function public._zoe_coach_on_takeover();

create function public._zoe_coach_on_settings()returns trigger language plpgsql security definer set search_path=''as $$
declare m uuid;
begin
 if(old.coach_enabled and not new.coach_enabled)or(old.health_answers_enabled and not new.health_answers_enabled)then
  for m in select distinct member_id from public.coach_events where state in('scheduled','generating','ready','queued','deferred')loop
   perform public._zoe_coach_cancel_member(m,case when not new.coach_enabled then 'coach_off'else 'free_mode_off'end);
  end loop;
 end if;
 return null;
end$$;
create trigger zoe_settings_coach_cancel after update on public.zoe_settings for each row execute function public._zoe_coach_on_settings();

-- 6. Worker functions (service role) ------------------------------------------------------------------------------------
-- C4's scheduler entry: one row per member, kind and ISO week of p_due_at; a repeat returns the existing row.
create function public.zoe_coach_schedule(p_member uuid,p_kind text,p_due_at timestamptz)returns jsonb
language plpgsql security definer set search_path=''as $$
declare wk text;ev public.coach_events;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_member is null or p_kind not in('checkin','nudge')or p_due_at is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 wk:=public._zoe_coach_iso_week(p_due_at);
 insert into public.coach_events(event_key,member_id,kind,iso_week,due_at)
 values('coach-'||p_kind||':'||p_member::text||':'||wk,p_member,p_kind,wk,p_due_at)on conflict(event_key)do nothing returning * into ev;
 if ev.id is null then select * into ev from public.coach_events where event_key='coach-'||p_kind||':'||p_member::text||':'||wk;
  return jsonb_build_object('ok',true,'eventId',ev.id,'replayed',true,'state',ev.state);end if;
 perform public._conversation_trace(p_member,null,'coach_event',ev.id::text,'zoe','zoe.coach.scheduled','recorded','scheduled','zoe.coach','c0-1','system',null,
  jsonb_build_object('noreon.zoe.coach.kind',p_kind,'noreon.zoe.coach.week',wk));
 return jsonb_build_object('ok',true,'eventId',ev.id,'replayed',false,'state',ev.state);
end$$;

-- Claims due coach rows. A row whose member is busy (another transaction holds the coach lock) waits for the next sweep.
-- Returns generation jobs (a started coach run each) and the rows returned to ready for another delivery attempt.
create function public.zoe_coach_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ev public.coach_events;chk record;cv public.conversations;r public.zoe_runs;s public.zoe_settings;jobs jsonb:='[]';redeliver jsonb:='[]';seq_ bigint;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into s from public.zoe_settings where singleton;
 -- A generating row whose run ended without zoe_coach_finish (worker lost) or was never finished in 15 minutes: retry.
 for ev in select e.* from public.coach_events e left join public.zoe_runs z on z.id=e.run_id
   where e.state='generating'and(z.id is null or z.state='finished'or e.claimed_at<clock_timestamp()-interval '15 minutes')
   order by e.claimed_at limit 20 for update of e skip locked loop
  if not pg_try_advisory_xact_lock(hashtextextended('zoe-coach:'||ev.member_id::text,0))then continue;end if;
  if ev.attempts>=3 then perform public._zoe_coach_move(ev.id,'cancelled','too_many_attempts',null);
  else perform public._zoe_coach_move(ev.id,'deferred','worker_lost',clock_timestamp()+interval '1 hour');end if;
 end loop;
 -- Fable C0-05: published rows that stalled. Past their week: cancelled (a queued teaser held). A teaser the outbox held or
 -- failed, or a ready row left unqueued for 30 minutes (worker lost between finish and queue): delivered again later.
 for ev in select e.* from public.coach_events e left join public.telegram_auth_messages t on t.id=e.telegram_message_id
   where(e.state in('scheduled','deferred','ready','queued')and clock_timestamp()>=public._zoe_coach_week_end(e.due_at))
    or(e.state='queued'and t.state in('held','definitely_failed'))or(e.state='ready'and e.updated_at<clock_timestamp()-interval '30 minutes')
   order by e.updated_at limit 20 for update of e skip locked loop
  if not pg_try_advisory_xact_lock(hashtextextended('zoe-coach:'||ev.member_id::text,0))then continue;end if;
  if clock_timestamp()>=public._zoe_coach_week_end(ev.due_at)then
   update public.telegram_auth_messages set state='held',reason='coach_cancelled',state_seq=state_seq+1,updated_at=clock_timestamp()
    where id=ev.telegram_message_id and state='queued';
   perform public._zoe_coach_move(ev.id,'cancelled','week_passed',null);
  else perform public._zoe_coach_move(ev.id,'deferred','redeliver',clock_timestamp()+case when ev.state='queued'then interval '1 hour'else interval '0 seconds'end);end if;
 end loop;
 for ev in select * from public.coach_events where state in('scheduled','deferred')and coalesce(retry_at,due_at)<=clock_timestamp()
   order by coalesce(retry_at,due_at)limit greatest(1,least(coalesce(p_limit,10),20))for update skip locked loop
  if not pg_try_advisory_xact_lock(hashtextextended('zoe-coach:'||ev.member_id::text,0))then continue;end if;
  select * into chk from public._zoe_coach_check(ev,'claim');
  if chk.reason is not null then
   perform public._zoe_coach_move(ev.id,case when public._zoe_coach_retryable(chk.reason)then 'deferred'else 'cancelled'end,chk.reason,chk.retry_at);continue;end if;
  if ev.ready_at is not null then
   -- Published before; only its delivery was deferred. The text is not generated again.
   perform public._zoe_coach_move(ev.id,'ready','redeliver',null);
   redeliver:=redeliver||jsonb_build_array(jsonb_build_object('eventId',ev.id,'memberId',ev.member_id,'kind',ev.kind));continue;end if;
  insert into public.conversations(member_id)values(ev.member_id)on conflict(member_id)do nothing;
  select * into cv from public.conversations where member_id=ev.member_id;
  seq_:=coalesce((select max(m.seq)from public.conversation_messages m where m.conversation_id=cv.id and m.source in('telegram_member','authenticated_member')),0);
  insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,kind)
  values(cv.id,ev.member_id,null,cv.version,cv.draft_epoch,(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date,'started','coach_'||ev.kind)
  returning * into r;
  update public.coach_events set state='generating',reason=null,retry_at=null,conversation_id=cv.id,run_id=r.id,claimed_member_seq=seq_,
   claimed_at=clock_timestamp(),attempts=attempts+1 where id=ev.id returning * into ev;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.coach.claim','outcome','allow','reason','coach_claimed','rule','zoe.coach',
   'ruleVersion','c0-1','actor','system','attributes',jsonb_build_object('noreon.zoe.coach.kind',ev.kind,'noreon.zoe.coach.week',ev.iso_week,'noreon.zoe.coach.attempt',ev.attempts))));
  jobs:=jobs||jsonb_build_array(jsonb_build_object('runId',r.id,'eventId',ev.id,'memberId',ev.member_id,'kind',ev.kind,'isoWeek',ev.iso_week,
   'displayName',(select pr.display_name from public.profiles pr where pr.id=ev.member_id),
   'locale',(select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=ev.member_id)));
 end loop;
 return jsonb_build_object('jobs',jobs,'redeliver',redeliver);
end$$;

-- The proactive reserve: the coach row must still be generating and the member not blocked; then the same spend caps,
-- tier and judge rules as an inbound run (zoe_run_reserve).
create function public.zoe_coach_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_events jsonb,p_tier text,p_model text,p_judge_model text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;why text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run;
 if not found or r.kind='inbound'or r.state<>'started'then return jsonb_build_object('ok',false,'code','run_not_reservable');end if;
 if not exists(select 1 from public.coach_events e where e.run_id=r.id and e.state='generating')then return jsonb_build_object('ok',false,'code','coach_event_not_generating');end if;
 why:=public._zoe_coach_block_reason(r.member_id,'checkin',true);
 if why is not null then return jsonb_build_object('ok',false,'code','coach_blocked','reason',why);end if;
 return public.zoe_run_reserve(p_run,p_estimate_usd,p_local,p_events,p_tier,p_model,p_judge_model);
end$$;

-- The proactive finish and publication. p_result: outcome 'publish' (with body, language, provider, model) or 'discarded'
-- / 'no_output' (with reason); configVersion, costUsd, usage, latencyMs, sealedIo, events as for an inbound run.
-- Publication is one transaction under the conversation row lock (member-message inserts take it too), re-checking the
-- member's newest message, open inbound runs, zoe_coach_blocked, consent, the pause, the quiet rule and the caps.
-- Refused: the run is recorded as discarded and no text is stored; the coach row is deferred or cancelled.
create function public.zoe_coach_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;ev public.coach_events;chk record;o text;rs text;body text;lang text;mid uuid;outc text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if jsonb_typeof(p_result)is distinct from 'object'then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.kind='inbound'or r.state<>'started'then return jsonb_build_object('ok',false,'code','run_not_finishable');end if;
 perform 1 from public.conversations where id=r.conversation_id for update;
 perform public._zoe_coach_lock(r.member_id);
 select * into ev from public.coach_events where run_id=r.id for update;
 o:=p_result->>'outcome';body:=btrim(coalesce(p_result->>'body',''));lang:=p_result->>'language';
 if o='publish'and(length(body)not between 1 and 600 or coalesce(lang,'')not in('en','hy','ru')or coalesce(p_result->>'provider','')!~'^[a-z0-9_.-]{1,64}$'
  or coalesce(p_result->>'model','')!~'^[a-z0-9_.:/-]{1,80}$')then o:='discarded';rs:='coach_publish_invalid';end if;
 if o not in('publish','discarded','no_output')then o:='discarded';rs:='coach_outcome_invalid';end if;
 if o='publish'then
  if ev.id is null or ev.state<>'generating'then rs:='coach_event_'||coalesce(ev.state,'missing');
  else
   select * into chk from public._zoe_coach_check(ev,'publish');
   rs:=chk.reason;
  end if;
  if rs is null then
   insert into public.zoe_coach_messages(event_id,member_id,conversation_id,run_id,kind,body,language,provider,model)
   values(ev.id,r.member_id,r.conversation_id,r.id,ev.kind,body,lang,p_result->>'provider',p_result->>'model')returning id into mid;
   update public.coach_events set state='ready',reason=null,ready_at=clock_timestamp()where id=ev.id;
   perform public._conversation_trace(ev.member_id,ev.conversation_id,'coach_event',ev.id::text,'zoe','zoe.coach.ready','recorded','published','zoe.coach','c0-1','system',null,
    jsonb_build_object('noreon.zoe.coach.kind',ev.kind,'noreon.zoe.coach.week',ev.iso_week,'noreon.zoe.coach.state','ready'));
   outc:='published';rs:='coach_published';
  else
   if ev.id is not null and ev.state='generating'then
    perform public._zoe_coach_move(ev.id,case when public._zoe_coach_retryable(rs)then 'deferred'else 'cancelled'end,rs,coalesce(chk.retry_at,clock_timestamp()+interval '10 minutes'));end if;
   outc:='discarded';rs:='coach_publication_refused_'||rs;
  end if;
 else
  outc:=o;rs:=coalesce(rs,case when coalesce(p_result->>'reason','')~'^[a-z0-9_]{1,40}$'then 'coach_'||(p_result->>'reason')else 'coach_generation_failed'end);
  if ev.id is not null and ev.state='generating'then
   if ev.attempts>=3 then perform public._zoe_coach_move(ev.id,'cancelled','too_many_attempts',null);
   else perform public._zoe_coach_move(ev.id,'deferred','generation_failed',clock_timestamp()+interval '1 hour');end if;
  end if;
 end if;
 perform public._zoe_run_events(r,case when jsonb_typeof(p_result->'events')='array'then p_result->'events'else '[]'::jsonb end);
 perform set_config('noreon.zoe_coach_finish','on',true);
 update public.zoe_runs z set state='finished',outcome=outc,reason_code=left(rs,80),provider=coalesce(p_result->>'provider','none'),model=coalesce(p_result->>'model','none'),
  config_version=left(coalesce(p_result->>'configVersion','unknown'),200),cost_usd=case when z.reserved then coalesce((p_result->>'costUsd')::numeric,0)end,
  input_tokens=(p_result#>>'{usage,inputTokens}')::integer,output_tokens=(p_result#>>'{usage,outputTokens}')::integer,latency_ms=(p_result->>'latencyMs')::integer,
  sealed_io=case when length(p_result->>'sealedIo')<=200000 then p_result->>'sealedIo'end,finished_at=clock_timestamp()
 where z.id=r.id returning * into r;
 perform set_config('noreon.zoe_coach_finish','',true);
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.coach.finish','outcome',case when outc='published'then 'allow'when outc='discarded'then 'block'else 'failed'end,
  'reason',left(rs,80),'rule','zoe.coach','ruleVersion','c0-1','actor','system','attributes',jsonb_build_object('noreon.zoe.run.outcome',outc))));
 return jsonb_build_object('ok',true,'outcome',outc,'reason',left(rs,80),'messageId',mid);
end$$;

-- The Telegram teaser for a published row (template member.zoe_coach_teaser, added with its approved copy in C4; held at
-- claim until approved). No active binding, the member's Telegram off, or no template: the row is delivered in the app only.
create function public.zoe_coach_queue_teaser(p_event uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ev public.coach_events;chk record;ch public.telegram_channel_settings;b public.telegram_auth_bindings;t public.system_message_templates;origin text;mid uuid;why text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select member_id into ev.member_id from public.coach_events where id=p_event;
 if ev.member_id is null then return jsonb_build_object('ok',false,'code','event_unknown');end if;
 -- The conversation row lock first (member-message inserts take it), then the coach lock: the inbound check holds until commit.
 perform 1 from public.conversations where member_id=ev.member_id for update;
 perform public._zoe_coach_lock(ev.member_id);
 select * into ev from public.coach_events where id=p_event for update;
 if ev.state<>'ready'then return jsonb_build_object('ok',false,'code','event_not_ready','state',ev.state);end if;
 select * into chk from public._zoe_coach_check(ev,'deliver');
 if chk.reason is not null then
  ev:=public._zoe_coach_move(ev.id,case when public._zoe_coach_retryable(chk.reason)then 'deferred'else 'cancelled'end,chk.reason,chk.retry_at);
  return jsonb_build_object('ok',false,'code','coach_'||ev.state,'reason',ev.reason);end if;
 select * into ch from public.telegram_channel_settings where singleton;
 select * into b from public.telegram_auth_bindings where auth_user_id=ev.member_id and kind='member'and active order by created_at desc limit 1;
 why:=case when b.id is null then 'app_only_not_connected'when ch.singleton is null or b.account_ref is distinct from public._telegram_account_ref(ch)then 'app_only_other_bot'
  when public._member_notice_turned_off(ev.member_id)then 'app_only_turned_off'end;
 if why is null then
  select * into t from public.system_message_templates where template_id='member.zoe_coach_teaser'and locale=public._telegram_auth_locale(ev.member_id)order by version desc limit 1;
  if not found then why:='app_only_no_template';end if;
 end if;
 if why is not null then
  update public.coach_events set state='sent',reason=why,sent_at=clock_timestamp()where id=ev.id;
  return jsonb_build_object('ok',true,'channel','app','reason',why);end if;
 origin:=coalesce((select app_origin from public.member_notice_settings where singleton),'https://app.noreon.health');
 insert into public.telegram_auth_messages(address,principal_ref,template_id,template_version,locale,body,keyboard)
 values(b.address,b.principal_ref,t.template_id,t.version,t.locale,t.body,jsonb_build_object('kind','open_url','url',origin||'/patient/zoe'))returning id into mid;
 update public.coach_events set state='queued',reason=null,telegram_message_id=mid where id=ev.id;
 return jsonb_build_object('ok',true,'channel','telegram','telegramMessageId',mid);
end$$;

-- The delivery-time check (§8.8): a coach teaser is re-checked at the moment of the Telegram claim. Every other message
-- goes straight to the previous claim, unchanged.
alter function public.telegram_auth_message_claim(uuid,uuid)rename to _telegram_auth_message_claim_core;
revoke all on function public._telegram_auth_message_claim_core(uuid,uuid)from public,anon,authenticated,service_role;
comment on function public._telegram_auth_message_claim_core(uuid,uuid)is
 'telegram_auth_message_claim before the coach delivery check (20261020103406). Change the claim here; telegram_auth_message_claim wraps it.';
create function public.telegram_auth_message_claim(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare ev public.coach_events;chk record;res jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into ev from public.coach_events where telegram_message_id=p_message;
 if not found then return public._telegram_auth_message_claim_core(p_message,p_attempt);end if;
 -- Astra C0-01: the conversation row lock (never waited for) so a member message cannot arrive between the check and the send.
 begin perform 1 from public.conversations where member_id=ev.member_id for update nowait;
 exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');end;
 if not pg_try_advisory_xact_lock(hashtextextended('zoe-coach:'||ev.member_id::text,0))then return jsonb_build_object('ok',false,'code','busy');end if;
 select * into ev from public.coach_events where id=ev.id for update;
 if ev.state<>'queued'or ev.telegram_message_id is distinct from p_message then
  update public.telegram_auth_messages set state='held',reason='coach_not_queued',state_seq=state_seq+1,updated_at=clock_timestamp()where id=p_message and state='queued';
  return jsonb_build_object('ok',false,'code','coach_not_queued');end if;
 select * into chk from public._zoe_coach_check(ev,'deliver');
 if chk.reason is not null then
  ev:=public._zoe_coach_move(ev.id,case when public._zoe_coach_retryable(chk.reason)then 'deferred'else 'cancelled'end,chk.reason,chk.retry_at);
  update public.telegram_auth_messages set state='held',reason='coach_'||ev.state,state_seq=state_seq+1,updated_at=clock_timestamp()where id=p_message and state='queued';
  return jsonb_build_object('ok',false,'code','coach_'||ev.state);end if;
 res:=public._telegram_auth_message_claim_core(p_message,p_attempt);
 if(res->>'ok')::boolean then update public.coach_events set state='sent',reason='telegram',sent_at=clock_timestamp()where id=ev.id;end if;
 return res;
end$$;

-- 7. The inbound claim: the latest MEMBER message not covered by a run (§8.8.5). From 20261018115307; changes marked C0.
create or replace function public.zoe_run_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;rec record;r public.zoe_runs;jobs jsonb:='[]';consent boolean;skip text;since timestamptz;ix public.zoe_symptom_intakes;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for r in update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=clock_timestamp()
  where state='started'and started_at<clock_timestamp()-interval '10 minutes'returning * loop
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route','outcome','failed','reason','worker_lost','rule','zoe.pipeline','ruleVersion','1','actor','system','attributes',jsonb_build_object('noreon.zoe.run.outcome','no_output'))));
 end loop;
 -- An intake idle for 12 hours ends; the doctor still gets what the member answered.
 for ix in update public.zoe_symptom_intakes set state='expired',ending='expired',finished_at=clock_timestamp(),updated_at=clock_timestamp(),
   summary=jsonb_set(summary,'{ending}','"expired"')
  where state='active'and updated_at<clock_timestamp()-interval '12 hours'and summary is not null returning * loop
  perform public._conversation_trace(ix.member_id,ix.conversation_id,'zoe_intake',ix.id::text,'zoe','zoe.intake.expired','recorded','member_idle_12h','zoe.symptom_intake','1','system',null,
   jsonb_build_object('noreon.zoe.intake.sheet',ix.sheet_id));
  perform public._zoe_intake_notice(ix.id);
 end loop;
 select * into s from public.zoe_settings where singleton;
 for rec in
  select c.id conversation_id,c.member_id,c.version,c.draft_epoch,lm.seq,cs.assigned_doctor_id,pr.display_name
  from public.conversations c
  -- C0: the newest member message (any other row in the thread can never hide it).
  join lateral(select m.seq,m.source,m.created_at from public.conversation_messages m where m.conversation_id=c.id
   and m.source in('telegram_member','authenticated_member')order by m.seq desc limit 1)lm on true
  join public.patient_clinical_cases cs on cs.user_id=c.member_id
  left join public.profiles pr on pr.id=c.member_id
  where lm.created_at>clock_timestamp()-interval '24 hours'
   -- C0: covered only by an inbound run (a coach run has no message_seq).
   and not exists(select 1 from public.zoe_runs zr where zr.conversation_id=c.id and zr.kind='inbound'and zr.message_seq>=lm.seq)
  order by lm.created_at limit greatest(1,least(coalesce(p_limit,10),20))
  for update of c skip locked
 loop
  -- Consent as 20261018073940 (#265): only a grant of the current wording (or one kept valid) counts.
  consent:=s.singleton is not null and s.consent_collection_enabled and s.consent_wording_version is not null
   and public._zoe_consent_current(rec.member_id,'zoe_reads_messages');
  skip:=case when s.singleton is null or not s.consent_collection_enabled or s.consent_wording_version is null then 'zoe_settings_off'
   when not consent then 'no_zoe_reads_messages_consent' when rec.assigned_doctor_id is null then 'no_assigned_doctor'
   when exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
    where d.conversation_id=rec.conversation_id and ap.context_version>=rec.version)then 'already_answered'end;
  insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
  values(rec.conversation_id,rec.member_id,rec.seq,rec.version,rec.draft_epoch,(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date,
   case when skip is null then 'started'else 'finished'end,case when skip is null then null else 'skipped'end,skip,case when skip is null then null else clock_timestamp()end)
  on conflict(conversation_id,message_seq)do nothing returning * into r;
  if r.id is null then continue;end if;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.consent','outcome',case when skip is null then 'allow'else 'block'end,
   'reason',coalesce(skip,'zoe_reads_messages_granted'),'rule','zoe.consent','ruleVersion',coalesce(s.consent_wording_version,'none'),'actor','system',
   'attributes',jsonb_build_object('noreon.zoe.guard.name','consent','noreon.zoe.consent.kind','zoe_reads_messages'))));
  if skip is not null then r:=null;continue;end if;
  since:=(select max(ap.created_at)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id);
  select * into ix from public.zoe_symptom_intakes where conversation_id=rec.conversation_id and state='active';
  jobs:=jobs||jsonb_build_array(jsonb_build_object('runId',r.id,'memberId',rec.member_id,'messageSeq',rec.seq,'displayName',rec.display_name,
   'messages',(select jsonb_agg(jsonb_build_object('seq',w.seq,'text',w.body,'minutesAgo',w.ago)order by w.seq)from(
     select m.seq,m.body,floor(extract(epoch from clock_timestamp()-m.created_at)/60)::integer ago from public.conversation_messages m
     -- An active intake keeps its own messages in the window, whatever was approved since. C0: member messages only.
     where m.conversation_id=rec.conversation_id and m.source in('telegram_member','authenticated_member')and m.seq<=rec.seq
      and(since is null or m.created_at>since or m.seq=rec.seq or m.seq>=ix.started_seq)order by m.seq desc limit 20)w),
   'replies',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select ap.body,ap.created_at,floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer ago from public.conversation_approvals ap
     join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id order by ap.created_at desc limit 3)x),'[]'),
   'answers',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select a.body,a.created_at,floor(extract(epoch from clock_timestamp()-a.created_at)/60)::integer ago from public.zoe_member_answers a
     where a.conversation_id=rec.conversation_id and(since is null or a.created_at>since or a.message_seq>=ix.started_seq)order by a.created_at desc limit 10)x),'[]'),
   'directAnswers',coalesce(s.direct_answers_enabled,false))
   ||case when coalesce(s.symptom_intake_enabled,false)then jsonb_build_object('intake',jsonb_build_object('enabled',true,
     'registered',coalesce((select jsonb_agg(jsonb_build_object('id',sh.sheet_id,'version',sh.version)order by sh.sheet_id)from public.zoe_symptom_sheets sh),'[]'),
     'active',case when ix.id is null then null else jsonb_build_object('id',ix.id,'sheetId',ix.sheet_id,'sheetVersion',ix.sheet_version,'startedSeq',ix.started_seq,'language',ix.language,'record',ix.record)end,
     'doctorName',(select ws.display_name from public.workspace_staff ws where ws.user_id=rec.assigned_doctor_id and ws.active and ws.removed_at is null),
     -- Only readings measured at or before now: a future-dated row must not pose as the latest one.
     'latestReading',(select jsonb_build_object('systolic',pm.systolic,'diastolic',pm.diastolic,'minutesAgo',floor(extract(epoch from clock_timestamp()-pm.measured_at)/60)::integer)
       from public.patient_measurements pm where pm.user_id=rec.member_id and pm.measured_at<=clock_timestamp() order by pm.measured_at desc limit 1),
     'redFlagsAfterSeq',coalesce((select max(zr.message_seq)from public.zoe_runs zr where zr.conversation_id=rec.conversation_id and zr.outcome='intake_escalated'),0)))
   else '{}'::jsonb end);
  r:=null;ix:=null;
 end loop;
 return jobs;
end$$;

-- 8. Member and doctor surfaces -----------------------------------------------------------------------------------------
-- The member's coaching state and the live coach texts (hidden whenever the member is blocked or the row was cancelled).
create function public.zoe_coach_member_status()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;st public.zoe_coach_member_state;why text;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 select * into s from public.zoe_settings where singleton;
 select * into st from public.zoe_coach_member_state where member_id=m;
 why:=public._zoe_coach_block_reason(m,'checkin',false);
 return jsonb_build_object('ok',true,'enabled',coalesce(s.coach_enabled,false),
  'wording',jsonb_build_object('coachCheckins',s.coach_checkins_wording_version,'memory',s.memory_wording_version),
  'coachCheckins',public._zoe_coach_consent_current(m,'zoe_coach_checkins'),'memory',public._zoe_coach_consent_current(m,'zoe_memory'),
  'paused',coalesce(st.checkins_paused,false),
  'messages',case when why is null and not coalesce(st.checkins_paused,false)then coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'kind',x.kind,'text',x.body,'at',x.created_at)order by x.created_at)
    from(select cm.id,cm.kind,cm.body,cm.created_at from public.zoe_coach_messages cm join public.coach_events e on e.id=cm.event_id
     where cm.member_id=m and e.state in('ready','queued','sent')and cm.created_at>clock_timestamp()-interval '30 days'order by cm.created_at desc limit 10)x),'[]')
   else '[]'::jsonb end);
end$$;

-- The member's choice for a coach consent kind (zoe_coach_checkins or zoe_memory). A grant needs collection on, the kind's
-- current wording (as shown), an eligible member and Zoe reading messages; a withdrawal is always possible. Withdrawing
-- zoe_coach_checkins cancels open coach rows (trigger). Sources: settings, prompt.
create function public.zoe_coach_consent_set(p_kind text,p_granted boolean,p_wording_version text,p_source text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();s public.zoe_settings;cur boolean;want text;v text;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if p_kind is null or p_kind not in('zoe_coach_checkins','zoe_memory')or p_granted is null or coalesce(p_wording_version,'')!~'^[a-z0-9-]{1,64}$'
  or p_source is null or p_source not in('settings','prompt')then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into s from public.zoe_settings where singleton;
 want:=case p_kind when 'zoe_coach_checkins'then s.coach_checkins_wording_version else s.memory_wording_version end;
 if p_granted then
  if not found or not s.consent_collection_enabled or want is null then return jsonb_build_object('ok',false,'code','unavailable');end if;
  if p_wording_version is distinct from want then return jsonb_build_object('ok',false,'code','stale','wordingVersion',want);end if;
  if not public._zoe_member_eligible(m)or not public._zoe_consent_current(m,'zoe_reads_messages')then return jsonb_build_object('ok',false,'code','not_eligible');end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-consent:'||m::text,0));
 select granted into cur from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1;
 if(p_granted and public._zoe_coach_consent_current(m,p_kind))or(not p_granted and not coalesce(cur,false))then
  return jsonb_build_object('ok',true,'changed',false,'granted',public._zoe_coach_consent_current(m,p_kind));end if;
 v:=case when p_granted then want else coalesce(want,(select wording_version from public.zoe_consents where member_id=m and kind=p_kind order by id desc limit 1))end;
 insert into public.zoe_consents(member_id,kind,granted,wording_version,source)values(m,p_kind,p_granted,v,p_source);
 perform public._conversation_trace(m,null,'zoe_consent',p_kind,'zoe',case when p_granted then 'zoe.consent.granted'else 'zoe.consent.withdrawn'end,
  case when p_granted then 'allow'else 'block'end,p_kind,'zoe.consent',v,'member',m,
  jsonb_build_object('noreon.zoe.consent.kind',p_kind,'noreon.zoe.consent.source',p_source));
 return jsonb_build_object('ok',true,'changed',true,'granted',p_granted);
end$$;

-- "Pause check-ins" / resume (§4.2): immediate, logged; pausing cancels open coach rows and holds queued teasers.
create function public.zoe_coach_pause(p_paused boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid:=auth.uid();n integer:=0;
begin
 if auth.role()is distinct from 'authenticated'or m is null then raise insufficient_privilege;end if;
 if p_paused is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 insert into public.zoe_coach_member_state(member_id,checkins_paused,paused_reason,paused_at)
 values(m,p_paused,case when p_paused then 'member'end,case when p_paused then clock_timestamp()end)
 on conflict(member_id)do update set checkins_paused=excluded.checkins_paused,paused_reason=excluded.paused_reason,paused_at=excluded.paused_at,updated_at=clock_timestamp();
 if p_paused then n:=public._zoe_coach_cancel_member(m,'paused');end if;
 perform public._conversation_trace(m,null,'coach_member',m::text,'zoe',case when p_paused then 'zoe.coach.paused'else 'zoe.coach.resumed'end,'recorded',
  case when p_paused then 'member_paused'else 'member_resumed'end,'zoe.coach','c0-1','member',m,jsonb_build_object('noreon.zoe.coach.cancelled',n));
 return jsonb_build_object('ok',true,'paused',p_paused);
end$$;

-- The assigned doctor's view (codes and the coach texts the member was shown) and one-tap resume after a pause.
create function public.doctor_zoe_coach(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);st public.zoe_coach_member_state;
begin
 select * into st from public.zoe_coach_member_state where member_id=p_member;
 perform public._access_audit_record(p_member,'doctor_zoe_coach','read');
 return jsonb_build_object('ok',true,'blockedReason',public._zoe_coach_block_reason(p_member,'checkin',false),'paused',coalesce(st.checkins_paused,false),
  'pausedReason',st.paused_reason,'resumedAt',st.doctor_resumed_at,
  'events',coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'week',e.iso_week,'state',e.state,'reason',e.reason,'dueAt',e.due_at,'readyAt',e.ready_at,'sentAt',e.sent_at)
    order by e.due_at desc)from(select * from public.coach_events where member_id=p_member order by due_at desc limit 12)e),'[]'),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('kind',x.kind,'text',x.body,'at',x.created_at)order by x.created_at desc)
    from(select * from public.zoe_coach_messages where member_id=p_member order by created_at desc limit 12)x),'[]'));
end$$;

create function public.doctor_zoe_coach_resume(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid:=public._zoe_mode_doctor(p_member);
begin
 insert into public.zoe_coach_member_state(member_id,doctor_resumed_at,doctor_resumed_by)values(p_member,clock_timestamp(),me)
 on conflict(member_id)do update set doctor_resumed_at=excluded.doctor_resumed_at,doctor_resumed_by=excluded.doctor_resumed_by,updated_at=clock_timestamp();
 perform public._access_audit_record(p_member,'doctor_zoe_coach','resume');
 perform public._conversation_trace(p_member,null,'coach_member',p_member::text,'zoe','zoe.coach.doctor_resumed','recorded','doctor_resumed','zoe.coach','c0-1','doctor',me,'{}'::jsonb);
 return jsonb_build_object('ok',true,'blockedReason',public._zoe_coach_block_reason(p_member,'checkin',false));
end$$;

-- 9. Grants -------------------------------------------------------------------------------------------------------------
revoke all on function public._zoe_coach_consent_current(uuid,text),public._coach_events_transition(),public._zoe_coach_messages_frozen(),public._zoe_runs_kind_guard(),
 public._zoe_coach_lock(uuid),public._zoe_coach_tz(),public._zoe_coach_iso_week(timestamptz),public._zoe_coach_week_end(timestamptz),
 public._zoe_coach_block_reason(uuid,text,boolean),public.zoe_coach_blocked(uuid),public._zoe_coach_quiet(uuid,timestamptz),public._zoe_coach_next_send(uuid,timestamptz),
 public._zoe_coach_retryable(text),public._zoe_coach_check(public.coach_events,text),public._zoe_coach_move(uuid,text,text,timestamptz),
 public._zoe_coach_cancel_member(uuid,text),public._zoe_coach_on_consent(),public._zoe_coach_on_takeover(),public._zoe_coach_on_settings(),
 public.zoe_coach_schedule(uuid,text,timestamptz),public.zoe_coach_claim(integer),public.zoe_coach_reserve(uuid,numeric,boolean,jsonb,text,text,text),
 public.zoe_coach_finish(uuid,jsonb),public.zoe_coach_queue_teaser(uuid),public.telegram_auth_message_claim(uuid,uuid),public.zoe_run_claim(integer),
 public.zoe_coach_member_status(),public.zoe_coach_consent_set(text,boolean,text,text),public.zoe_coach_pause(boolean),
 public.doctor_zoe_coach(uuid),public.doctor_zoe_coach_resume(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.zoe_coach_blocked(uuid),public.zoe_coach_schedule(uuid,text,timestamptz),public.zoe_coach_claim(integer),
 public.zoe_coach_reserve(uuid,numeric,boolean,jsonb,text,text,text),public.zoe_coach_finish(uuid,jsonb),public.zoe_coach_queue_teaser(uuid),
 public.telegram_auth_message_claim(uuid,uuid),public.zoe_run_claim(integer)to service_role;
grant execute on function public.zoe_coach_member_status(),public.zoe_coach_consent_set(text,boolean,text,text),public.zoe_coach_pause(boolean),
 public.doctor_zoe_coach(uuid),public.doctor_zoe_coach_resume(uuid)to authenticated;

-- 10. The doctor's and the admin's Zoe run lists show inbound runs only (their contracts read messageSeq as a number); the
--     coach rows are in doctor_zoe_coach. Bodies as current (20261017201838 via 20261018213357; 20261018160427); changes marked C0.
CREATE OR REPLACE FUNCTION public.zoe_runs_for_doctor_unlogged(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare who jsonb:=public.real_clinical_staff_identity();
begin
 if who is null or who->>'role'<>'doctor'or not exists(select 1 from public.patient_clinical_cases where user_id=p_member and assigned_doctor_id=auth.uid())then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'runs',coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'messageSeq',z.message_seq,'outcome',z.outcome,'reason',z.reason_code,
  'summary',z.summary,'guardReasons',to_jsonb(z.guard_reasons),'provider',z.provider,'model',z.model,'draftId',z.draft_id,
  'draftState',(select d.state from public.conversation_drafts d where d.id=z.draft_id),
  'draftCurrent',(select d.context_version=c.version from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where d.id=z.draft_id),
  'answer',(select a.body from public.zoe_member_answers a where a.run_id=z.id),'finishedAt',z.finished_at)order by z.finished_at desc)
  from(select * from public.zoe_runs where member_id=p_member and kind='inbound'and state='finished'and outcome<>'skipped'order by finished_at desc limit 5)z),'[]'));
end$$;
CREATE OR REPLACE FUNCTION public.admin_conversation_read(p_member uuid, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare a uuid:=public._real_staff_require_admin();c public.conversations;upto timestamptz:=coalesce(p_before,'infinity');since timestamptz:='-infinity';n int;older boolean;
 lo bigint;hi bigint;
begin
 if p_member is null then raise invalid_parameter_value;end if;
 if not public._admin_conversation_read_on()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if not exists(select 1 from public.patient_clinical_cases where user_id=p_member)then return jsonb_build_object('ok',false,'code','not_found');end if;
 -- Recorded before anything is read, in the same transaction as the read.
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
  values(a,'admin',p_member,'conversation.read.admin',case when p_before is not null then left('before='||p_before::text,200)end,left(auth.jwt()->>'session_id',80));
 select * into c from public.conversations where member_id=p_member;
 select count(*),min(x.created_at),min(x.seq),max(x.seq)into n,since,lo,hi from(select m.created_at,m.seq from public.conversation_messages m
  where m.conversation_id=c.id and m.created_at<upto order by m.seq desc limit 200)x;
 if n<200 then since:='-infinity';lo:=null;end if;
 -- Zoe answers go with the message they answer (review F1 follow-up: an urgent answer may come after
 -- newer messages), so the window is the messages' seq range, not the answers' own time.
 if p_before is null then hi:=null;end if;
 older:=since>'-infinity'and(exists(select 1 from public.conversation_messages m where m.conversation_id=c.id and m.created_at<since)
  or exists(select 1 from public.zoe_member_answers za where za.conversation_id=c.id and za.message_seq<lo)
  or exists(select 1 from public.conversation_drafts d where d.conversation_id=c.id and d.created_at<since));
 return jsonb_build_object('ok',true,'memberId',p_member,'asOf',statement_timestamp(),
  'memberName',coalesce((select display_name from public.profiles where id=p_member),''),
  'doctorName',(select ws.display_name from public.patient_clinical_cases cs join public.workspace_staff ws on ws.user_id=cs.assigned_doctor_id where cs.user_id=p_member),
  'conversationId',c.id,
  'window',jsonb_build_object('before',p_before,'from',case when since>'-infinity'then since end,'olderBefore',case when older then since end),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('seq',m.seq,'text',m.body,'at',m.created_at,
    'channel',case when m.source='telegram_member'then 'telegram'else 'app'end)order by m.seq)
   from public.conversation_messages m where m.conversation_id=c.id and m.created_at>=since and m.created_at<upto),'[]'::jsonb),
  -- Every Zoe answer to a message in the window (whenever it was written), including ones held back from Telegram; heldReason says why.
  'zoeAnswers',coalesce((select jsonb_agg(jsonb_build_object('id',za.id,'kind',za.kind,'text',za.body,'at',za.created_at,'messageSeq',za.message_seq,
    'telegramState',sm.state,'heldReason',case when sm.state='held'then sm.reason end)order by za.created_at,za.id)
   from public.zoe_member_answers za left join public.system_messages sm on sm.id=za.system_message_id
   where za.conversation_id=c.id and(lo is null or za.message_seq>=lo)and(hi is null or za.message_seq<=hi)),'[]'::jsonb),
  -- Every approved doctor reply in the window, whatever happened to its delivery.
  'replies',coalesce((select jsonb_agg(jsonb_build_object('approvalId',ap.id,'text',ap.body,'at',ap.created_at,'doctorName',ap.doctor_name,
    'deliveryState',dl.state,'deliveryReason',dl.reason)order by ap.created_at,ap.id)
   from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
   left join public.conversation_deliveries dl on dl.approval_id=ap.id
   where d.conversation_id=c.id and ap.created_at>=since and ap.created_at<upto),'[]'::jsonb),
  'drafts',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'state',d.state,'createdAt',d.created_at,'contextVersion',d.context_version,
    'revisions',(select count(*)from public.conversation_revisions r where r.draft_id=d.id),
    'latest',(select jsonb_build_object('revision',r.revision,'text',r.body,'summary',r.summary,'authorKind',r.author_kind,
      'authorName',(select ws.display_name from public.workspace_staff ws where ws.user_id=r.author_id),'at',r.created_at)
     from public.conversation_revisions r where r.draft_id=d.id order by r.revision desc limit 1))order by d.created_at,d.id)
   from public.conversation_drafts d where d.conversation_id=c.id and d.created_at>=since and d.created_at<upto),'[]'::jsonb),
  -- Same shape as zoe_runs_for_doctor: the latest 20, with the total.
  'zoeRunsTotal',(select count(*)from public.zoe_runs where member_id=p_member and kind='inbound'and state='finished'and outcome<>'skipped'),
  'zoeRuns',coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'messageSeq',z.message_seq,'outcome',z.outcome,'reason',z.reason_code,
    'summary',z.summary,'guardReasons',to_jsonb(z.guard_reasons),'provider',z.provider,'model',z.model,'draftId',z.draft_id,
    'draftState',(select d.state from public.conversation_drafts d where d.id=z.draft_id),
    'draftCurrent',(select d.context_version=c.version from public.conversation_drafts d where d.id=z.draft_id),
    'answer',(select za.body from public.zoe_member_answers za where za.run_id=z.id),'finishedAt',z.finished_at)order by z.finished_at desc)
   from(select * from public.zoe_runs where member_id=p_member and kind='inbound'and state='finished'and outcome<>'skipped'order by finished_at desc limit 20)z),'[]'::jsonb),
  -- Same shape as zoe_symptom_intakes_for_doctor (the summary, not the record): the latest 10, with the total.
  'intakesTotal',(select count(*)from public.zoe_symptom_intakes where member_id=p_member),
  'intakes',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'sheetId',i.sheet_id,'sheetVersion',i.sheet_version,'state',i.state,'ending',i.ending,
    'summary',i.summary,'startedAt',i.created_at,'updatedAt',i.updated_at,'finishedAt',i.finished_at)order by i.created_at desc)
   from(select * from public.zoe_symptom_intakes where member_id=p_member order by created_at desc limit 10)i),'[]'::jsonb),
  -- The admin trace (latest 300; the Trace page pages further), read here so one open is one audit row.
  'traceTotal',(select count(*)from public.conversation_trace_events where member_id=p_member),
  'trace',coalesce(public.conversation_trace_unlogged(p_member,null)->'events','[]'::jsonb));
end$$;
