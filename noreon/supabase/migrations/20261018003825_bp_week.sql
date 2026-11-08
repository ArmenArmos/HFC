-- D1, the 7-day home blood pressure week (HBPM), dark.
--
-- Decision tree v1.1 (NRN-CLIN-ALG-001, row "I don't remember", 2024 HTN §5.2.3) and the
-- questionnaire spec ("7-day home measurement programme, twice a day, morning and evening"):
-- 7 days, a morning and an evening slot, 2 readings in each slot. Those three numbers are the
-- only clinical parameters here and they are fixed by checks, not settings.
--
-- What this does NOT do (pending Armen, output/bp-week-medicines-2026-10-17/QUESTIONS.md):
-- no averaging rule (the app shows the raw readings and a plain average labelled "pending"),
-- no home thresholds (135/85 is in the tree's table but which readings it applies to is open),
-- no alert on a single reading (P6). A reading saved here is an ordinary home reading in
-- patient_measurements (the same row the member's manual entry writes, with the same rules
-- downstream); bp_week_readings only says which week, day and slot it belongs to.
--
-- Who starts a week: the member (when bp_week_settings.member_can_start) or the member's
-- assigned nurse or doctor. A nurse who has handed the member a monitor (#183) starts the
-- week and the open hand-over is linked. One open week per member.
--
-- Reminders: one Telegram notice per slot at the slot time while the slot is not complete,
-- through the member notices (#221; group "reminders", so that switch must be on too), never
-- in the member's quiet hours, and never when the member turned week reminders or Telegram off.
--
-- Readers: the member; the assigned nurse and doctor (same rule as the BP monitor panel).
-- Admins have no clinical read and get nothing here.

create table public.bp_week_settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 reminders boolean not null default false,
 member_can_start boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.bp_week_settings(singleton)values(true);

create table public.bp_weeks(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id)on delete cascade,
 starts_on date not null,
 days smallint not null default 7 check(days=7),
 readings_per_slot smallint not null default 2 check(readings_per_slot=2),
 morning_time time not null default '08:00'check(morning_time between '05:00' and '11:30' and date_trunc('minute',morning_time)=morning_time),
 evening_time time not null default '20:00'check(evening_time between '17:00' and '22:30' and date_trunc('minute',evening_time)=evening_time),
 reminders boolean not null default true,
 device_assignment_id uuid references public.bp_device_assignments(id),
 started_by uuid not null references auth.users(id),
 started_by_role text not null check(started_by_role in('member','nurse','doctor')),
 created_at timestamptz not null default clock_timestamp(),
 stopped_at timestamptz,
 stopped_by uuid references auth.users(id),
 stop_reason text check(stop_reason is null or length(btrim(stop_reason))between 1 and 300),
 check((stopped_at is null)=(stopped_by is null))
);
create index bp_weeks_member on public.bp_weeks(member_id,starts_on desc);
create index bp_weeks_open on public.bp_weeks(starts_on)where stopped_at is null;

create table public.bp_week_readings(
 measurement_id uuid primary key references public.patient_measurements(id)on delete cascade,
 week_id uuid not null references public.bp_weeks(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 day smallint not null check(day between 1 and 7),
 slot text not null check(slot in('morning','evening')),
 created_at timestamptz not null default clock_timestamp()
);
create index bp_week_readings_slot on public.bp_week_readings(week_id,day,slot);

alter table public.bp_week_settings enable row level security;
alter table public.bp_weeks enable row level security;
alter table public.bp_week_readings enable row level security;
-- No direct table access for browser roles: reads and writes go through the functions below.
revoke all on public.bp_week_settings,public.bp_weeks,public.bp_week_readings from public,anon,authenticated,service_role;

-- A week is open from its first day to its last day (Yerevan dates) unless stopped.
create function public._bp_week_today()returns date language sql stable set search_path=''as $$
 select(clock_timestamp()at time zone 'Asia/Yerevan')::date
$$;

create function public._bp_week_json(w public.bp_weeks)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',w.id,'startsOn',w.starts_on,'days',w.days,'readingsPerSlot',w.readings_per_slot,
  'morningTime',to_char(w.morning_time,'HH24:MI'),'eveningTime',to_char(w.evening_time,'HH24:MI'),'reminders',w.reminders,
  'startedByRole',w.started_by_role,'createdAt',w.created_at,'stoppedAt',w.stopped_at,'stopReason',w.stop_reason,
  'device',(select jsonb_build_object('model',d.model,'serial',d.serial,'since',a.assigned_at,'endedAt',a.ended_at)
   from public.bp_device_assignments a join public.bp_devices d on d.id=a.device_id where a.id=w.device_assignment_id),
  'readings',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'day',r.day,'slot',r.slot,'systolic',m.systolic,'diastolic',m.diastolic,
    'pulse',m.pulse,'measuredAt',m.measured_at)order by r.day,r.slot desc,m.measured_at,m.id)
   from public.bp_week_readings r join public.patient_measurements m on m.id=r.measurement_id where r.week_id=w.id),'[]'::jsonb))
$$;

-- The member's weeks: the open one and the last few, newest first. Also says whether the
-- feature is on and whether the member may start a week.
create function public.bp_week_member_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare s public.bp_week_settings;uid uuid:=auth.uid();
begin
 if uid is null then raise insufficient_privilege;end if;
 select * into s from public.bp_week_settings where singleton;
 if not s.enabled then return jsonb_build_object('version','bp-week-v1','enabled',false);end if;
 return jsonb_build_object('version','bp-week-v1','enabled',true,'memberCanStart',s.member_can_start,'today',public._bp_week_today(),
  'currentDevice',(select jsonb_build_object('model',d.model,'serial',d.serial,'since',a.assigned_at)
   from public.bp_device_assignments a join public.bp_devices d on d.id=a.device_id where a.member_id=uid and a.ended_at is null),
  'weeks',coalesce((select jsonb_agg(public._bp_week_json(w)order by w.starts_on desc,w.created_at desc)
   from(select * from public.bp_weeks where member_id=uid order by starts_on desc,created_at desc limit 4)w),'[]'::jsonb));
end$$;

-- The assigned nurse and doctor. Same authority as the visit and monitor panels.
create function public.bp_week_staff_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.bp_week_settings;
begin
 perform set_config('lock_timeout','1500ms',true);
 select * into s from public.bp_week_settings where singleton;
 if not s.enabled then return jsonb_build_object('version','bp-week-v1','enabled',false);end if;
 perform public._patient_visit_authorize(p_member,false,false);
 return jsonb_build_object('version','bp-week-v1','enabled',true,'today',public._bp_week_today(),
  'currentDevice',(select jsonb_build_object('model',d.model,'serial',d.serial,'since',a.assigned_at,'assignmentId',a.id)
   from public.bp_device_assignments a join public.bp_devices d on d.id=a.device_id where a.member_id=p_member and a.ended_at is null),
  'weeks',coalesce((select jsonb_agg(public._bp_week_json(w)order by w.starts_on desc,w.created_at desc)
   from(select * from public.bp_weeks where member_id=p_member order by starts_on desc,created_at desc limit 8)w),'[]'::jsonb));
exception when lock_not_available then raise exception using errcode='55P03',message='bp week busy';
end$$;

-- Start a week. p_member null (or the caller) = the member starts their own week.
-- Returns {status:'started',weekId} | {status:'open-week'} | {status:'disabled'} | {status:'invalid'}.
create function public.bp_week_start(p_member uuid,p_starts_on date,p_morning time,p_evening time)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.bp_week_settings;uid uuid:=auth.uid();m uuid;role text;st public.workspace_staff;today date:=public._bp_week_today();wid uuid;asg uuid;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','1500ms',true);
 select * into s from public.bp_week_settings where singleton;
 if not s.enabled then return jsonb_build_object('status','disabled');end if;
 m:=coalesce(p_member,uid);
 if m=uid then
  if not s.member_can_start then return jsonb_build_object('status','disabled');end if;
  if exists(select 1 from public.workspace_staff where user_id=uid)then raise insufficient_privilege;end if;
  if not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
  role:='member';
 else
  st:=public._patient_visit_authorize(m,false,false);role:=st.role;
 end if;
 if p_starts_on is null or p_starts_on<today or p_starts_on>today+14 or p_morning is null or p_evening is null
  or p_morning not between '05:00' and '11:30' or p_evening not between '17:00' and '22:30'
  or date_trunc('minute',p_morning)<>p_morning or date_trunc('minute',p_evening)<>p_evening then return jsonb_build_object('status','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('bp-week:'||m::text,0));
 if exists(select 1 from public.bp_weeks where member_id=m and stopped_at is null and starts_on+days>today)then return jsonb_build_object('status','open-week');end if;
 select id into asg from public.bp_device_assignments where member_id=m and ended_at is null;
 insert into public.bp_weeks(member_id,starts_on,morning_time,evening_time,device_assignment_id,started_by,started_by_role)
  values(m,p_starts_on,p_morning,p_evening,asg,uid,role)returning id into wid;
 return jsonb_build_object('status','started','weekId',wid);
exception when lock_not_available then return jsonb_build_object('status','busy');
end$$;

-- Stop an open week (the member or the assigned nurse or doctor). Readings stay.
create function public.bp_week_stop(p_week uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();w public.bp_weeks;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 perform set_config('lock_timeout','1500ms',true);
 select * into w from public.bp_weeks where id=p_week;
 if not found then raise insufficient_privilege;end if;
 if w.member_id<>uid then perform public._patient_visit_authorize(w.member_id,false,false);end if;
 if p_reason is not null and length(btrim(p_reason))not between 1 and 300 then return jsonb_build_object('status','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('bp-week:'||w.member_id::text,0));
 update public.bp_weeks set stopped_at=clock_timestamp(),stopped_by=uid,stop_reason=nullif(btrim(p_reason),'')
  where id=p_week and stopped_at is null and starts_on+days>public._bp_week_today();
 return jsonb_build_object('status',case when found then 'stopped'else 'not-open'end);
exception when lock_not_available then return jsonb_build_object('status','busy');
end$$;

-- The member turns Telegram reminders for this week on or off.
create function public.bp_week_set_reminders(p_week uuid,p_on boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.uid()is null or p_on is null then raise insufficient_privilege;end if;
 update public.bp_weeks set reminders=p_on where id=p_week and member_id=auth.uid();
 return jsonb_build_object('status',case when found then 'saved'else 'not-found'end);
end$$;

-- Save one reading into a slot of today. The reading must be measured today (Yerevan date) while
-- the week is running: a missed slot stays missed and is never filled in later (review F1). The
-- slot is the member's choice (a morning reading entered at noon is still the morning reading). The reading
-- itself is an ordinary home reading (record_patient_measurement: same checks, idempotent on the
-- submission id). Returns {status:'saved'|'replayed',measurementId,day,slot} | {status:'slot-full'}
-- | {status:'outside-week'} | {status:'not-today'} | {status:'not-open'} | {status:'conflict'} | {status:'disabled'}.
create function public.bp_week_record(p_week uuid,p_slot text,p_submission uuid,p_systolic integer,p_diastolic integer,p_pulse integer,p_measured_at timestamptz)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();w public.bp_weeks;d integer;mid uuid;existing public.bp_week_readings;prior uuid;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.bp_week_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if p_slot is null or p_slot not in('morning','evening')or p_measured_at is null or not isfinite(p_measured_at)then return jsonb_build_object('status','invalid');end if;
 select * into w from public.bp_weeks where id=p_week and member_id=uid;
 if not found then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended('bp-week:'||uid::text,0));
 select * into w from public.bp_weeks where id=p_week;
 -- A retry of a saved submission replays, whatever happened to the week since.
 select id into prior from public.patient_measurements where user_id=uid and submission_id=p_submission;
 if prior is not null then
  select * into existing from public.bp_week_readings where measurement_id=prior;
  if existing.week_id=w.id and existing.slot=p_slot then
   mid:=public.record_patient_measurement(p_submission,p_systolic,p_diastolic,p_pulse,p_measured_at);
   return jsonb_build_object('status','replayed','measurementId',mid,'day',existing.day,'slot',existing.slot);
  end if;
  return jsonb_build_object('status','conflict');
 end if;
 if w.stopped_at is not null then return jsonb_build_object('status','not-open');end if;
 d:=((p_measured_at at time zone 'Asia/Yerevan')::date-w.starts_on)+1;
 if public._bp_week_today()not between w.starts_on and w.starts_on+w.days-1 then return jsonb_build_object('status','not-open');end if;
 if d not between 1 and w.days then return jsonb_build_object('status','outside-week');end if;
 if(p_measured_at at time zone 'Asia/Yerevan')::date<>public._bp_week_today()then return jsonb_build_object('status','not-today');end if;
 if(select count(*)from public.bp_week_readings where week_id=w.id and day=d and slot=p_slot)>=w.readings_per_slot then
  return jsonb_build_object('status','slot-full','day',d,'slot',p_slot);end if;
 mid:=public.record_patient_measurement(p_submission,p_systolic,p_diastolic,p_pulse,p_measured_at);
 insert into public.bp_week_readings(measurement_id,week_id,member_id,day,slot)values(mid,w.id,uid,d,p_slot);
 return jsonb_build_object('status','saved','measurementId',mid,'day',d,'slot',p_slot);
exception
 when raise_exception then
  if sqlerrm in('invalid measurement','measurement conflict','verified membership required')then
   return jsonb_build_object('status',case sqlerrm when 'measurement conflict'then 'conflict'when 'invalid measurement'then 'invalid'else 'not-member'end);
  end if;
  raise;
end$$;

-- Member's quiet hours (their reminder settings, or the app's defaults 22:00 to 07:00).
create function public._member_quiet_now(p_member uuid,p_local time)returns boolean
language sql stable security definer set search_path=''as $$
 select case when qs<=qe then p_local>=qs and p_local<qe else p_local>=qs or p_local<qe end
 from(select coalesce((p.preferences->>'quietStart')::time,'22:00')qs,coalesce((p.preferences->>'quietEnd')::time,'07:00')qe
  from(select 1)x left join public.patient_reminder_preferences p on p.user_id=p_member)q
$$;

-- True when the member-notice throttle or hourly cap would skip this reminder now. The sweeps then
-- leave it for the next sweep inside its window instead of journaling it as skipped for good
-- (review F2). Same rules and settings as _member_notice (#221).
create function public._member_reminder_held(p_member uuid,p_template text)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.member_notices n,public.member_notice_settings s where s.singleton and n.member_id=p_member and n.template_id=p_template
   and n.outcome='queued'and n.created_at>clock_timestamp()-make_interval(secs=>s.throttle_seconds))
  or(select count(*)from public.member_notices where member_id=p_member and outcome='queued'and created_at>clock_timestamp()-interval '1 hour')
   >=(select hourly_cap from public.member_notice_settings where singleton)
$$;

insert into public.system_message_templates(template_id,version,locale,body)values
 ('member.reminder_bp_week',1,'en','UNAPPROVED PLACEHOLDER. It is {time}: time for your two readings. Save them in Noreon.'),
 ('member.reminder_bp_week',1,'hy','UNAPPROVED PLACEHOLDER. Ժամը {time} է՝ ձեր երկու չափումների ժամանակն է։ Պահեք դրանք Noreon-ում։');

-- Called by the dispatcher sweep (every 5 minutes). For each open week on one of its days, a slot
-- whose time has come within the last 30 minutes and that is not complete gets one notice (the key
-- holds the week, day and slot, so a retry or a later sweep never sends a second one). p_now is
-- for tests.
create function public.bp_week_reminders_run(p_now timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare nowt timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;s public.bp_week_settings;r record;queued integer:=0;slot_at timestamptz;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into s from public.bp_week_settings where singleton;
 if not s.enabled or not s.reminders then return jsonb_build_object('ok',true,'state','off');end if;
 perform set_config('noreon.member_notice_sweep','on',true);
 lt:=nowt at time zone 'Asia/Yerevan';
 for r in
  select w.*,(lt::date-w.starts_on)+1 d,x.slot,x.at from public.bp_weeks w
   cross join lateral(values('morning',w.morning_time),('evening',w.evening_time))x(slot,at)
  where w.stopped_at is null and w.reminders and lt::date between w.starts_on and w.starts_on+w.days-1
 loop
  slot_at:=(lt::date+r.at)at time zone 'Asia/Yerevan';
  if nowt>=slot_at and nowt<slot_at+interval '30 minutes'
   and(select count(*)from public.bp_week_readings where week_id=r.id and day=r.d and slot=r.slot)<r.readings_per_slot
   and not public._member_quiet_now(r.member_id,lt::time)and not public._member_reminder_held(r.member_id,'member.reminder_bp_week')then
   if public._member_notice_safe(r.member_id,'reminders','member.reminder_bp_week','bpweek:'||r.id::text||':'||r.d::text||':'||r.slot,
    jsonb_build_object('time',to_char(r.at,'HH24:MI')),'/patient/bp-week','open_home')is not null then queued:=queued+1;end if;
  end if;
 end loop;
 perform set_config('noreon.member_notice_sweep','off',true);
 return jsonb_build_object('ok',true,'state','ran','queued',queued);
end$$;

revoke all on function public._bp_week_today(),public._bp_week_json(public.bp_weeks),public.bp_week_member_read(),public.bp_week_staff_read(uuid),
 public.bp_week_start(uuid,date,time,time),public.bp_week_stop(uuid,text),public.bp_week_set_reminders(uuid,boolean),
 public.bp_week_record(uuid,text,uuid,integer,integer,integer,timestamptz),public._member_quiet_now(uuid,time),public._member_reminder_held(uuid,text),public.bp_week_reminders_run(timestamptz)
 from public,anon,authenticated,service_role;
grant execute on function public.bp_week_member_read(),public.bp_week_staff_read(uuid),public.bp_week_start(uuid,date,time,time),public.bp_week_stop(uuid,text),
 public.bp_week_set_reminders(uuid,boolean),public.bp_week_record(uuid,text,uuid,integer,integer,integer,timestamptz)to authenticated;
grant execute on function public.bp_week_reminders_run(timestamptz)to service_role;
