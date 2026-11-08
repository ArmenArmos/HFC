-- D2, medicines and adherence, dark.
--
-- Two kinds of medicine, never mixed up:
--  - the doctor's: patient_care_medications in the member's published care plan (existing; the
--    member already ticks them through report_patient_dose_versioned);
--  - the member's own list, "self-reported": member_medicines, added and stopped by the member,
--    ticked through member_medicine_dose_report. Nothing here is a prescription.
-- Ticks are the member's own report, not proof that a dose was taken.
--
-- Reminders: one Telegram notice per member per dose time (all medicines due at that minute
-- together; the wording names no medicine and no health detail), through the member notices (#221; group "reminders", so that
-- switch must be on too), at the member's chosen offset, never in their quiet hours, never when
-- they turned medicine reminders or Telegram off, and never when every dose at that time is ticked.
--
-- The doctor sees an adherence summary (assigned nurse and doctor; admins have no clinical read).
-- No dosing advice, no automatic change, no missed-dose rule: those are Armen's
-- (output/bp-week-medicines-2026-10-17/QUESTIONS.md).

create table public.member_medicine_settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 reminders boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.member_medicine_settings(singleton)values(true);

create function public._member_medicine_times_ok(t time[])returns boolean language sql immutable set search_path=''as $$
 select t is not null and cardinality(t)between 1 and 6 and array_position(t,null)is null
  and(select count(distinct x)=cardinality(t)and bool_and(date_trunc('minute',x)=x)from unnest(t)x)
$$;

create table public.member_medicines(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id)on delete cascade,
 source text not null default 'self-reported'check(source='self-reported'),
 name text not null check(length(btrim(name))between 1 and 120 and name=btrim(name)),
 dose text check(dose is null or(length(btrim(dose))between 1 and 120 and dose=btrim(dose))),
 times time[] not null check(public._member_medicine_times_ok(times)),
 created_at timestamptz not null default clock_timestamp(),
 started_on date not null,
 stopped_at timestamptz,
 unique(id,user_id)
);
create index member_medicines_member on public.member_medicines(user_id,created_at);

create table public.member_medicine_doses(
 medicine_id uuid not null,
 user_id uuid not null,
 due_at timestamptz not null,
 status text not null check(status in('taken','skipped')),
 recorded_at timestamptz not null default clock_timestamp(),
 revision integer not null default 1 check(revision>=1),
 primary key(medicine_id,due_at),
 foreign key(medicine_id,user_id)references public.member_medicines(id,user_id)on delete cascade
);
create index member_medicine_doses_member on public.member_medicine_doses(user_id,due_at desc);

alter table public.member_medicine_settings enable row level security;
alter table public.member_medicines enable row level security;
alter table public.member_medicine_doses enable row level security;
revoke all on public.member_medicine_settings,public.member_medicines,public.member_medicine_doses from public,anon,authenticated,service_role;

-- A Yerevan wall-clock time on a date, as an instant.
create function public._member_medicine_due(p_day date,p_time time)returns timestamptz language sql immutable set search_path=''as $$
 select(p_day+p_time)at time zone 'Asia/Yerevan'
$$;

create function public._member_medicine_json(m public.member_medicines,p_from timestamptz)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',m.id,'source',m.source,'name',m.name,'dose',m.dose,
  'times',(select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(m.times)t),
  'startedOn',m.started_on,'createdAt',m.created_at,'stoppedAt',m.stopped_at,
  'doses',coalesce((select jsonb_agg(jsonb_build_object('dueAt',d.due_at,'status',d.status,'recordedAt',d.recorded_at,'revision',d.revision)order by d.due_at)
   from public.member_medicine_doses d where d.medicine_id=m.id and d.due_at>=p_from),'[]'::jsonb))
$$;

-- The member's own list with the last 8 days of ticks.
create function public.member_medicines_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();s public.member_medicine_settings;
begin
 if uid is null then raise insufficient_privilege;end if;
 select * into s from public.member_medicine_settings where singleton;
 if not s.enabled then return jsonb_build_object('version','member-medicines-v1','enabled',false);end if;
 return jsonb_build_object('version','member-medicines-v1','enabled',true,
  'medicines',coalesce((select jsonb_agg(public._member_medicine_json(m,clock_timestamp()-interval '8 days')order by m.stopped_at nulls first,m.created_at)
   from public.member_medicines m where m.user_id=uid and(m.stopped_at is null or m.stopped_at>clock_timestamp()-interval '30 days')),'[]'::jsonb));
end$$;

-- Add one self-reported medicine. {status:'added',id} | {status:'invalid'} | {status:'limit'} | {status:'disabled'}.
create function public.member_medicine_add(p_name text,p_dose text,p_times time[])returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();mid uuid;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if exists(select 1 from public.workspace_staff where user_id=uid)or not exists(select 1 from public.profiles where id=uid)then raise insufficient_privilege;end if;
 if p_name is null or length(btrim(p_name))not between 1 and 120 or(p_dose is not null and length(btrim(p_dose))>120)
  or not public._member_medicine_times_ok(p_times)then return jsonb_build_object('status','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('member-medicines:'||uid::text,0));
 if(select count(*)from public.member_medicines where user_id=uid and stopped_at is null)>=20 then return jsonb_build_object('status','limit');end if;
 insert into public.member_medicines(user_id,name,dose,times,started_on)
  values(uid,btrim(p_name),nullif(btrim(p_dose),''),(select array_agg(t order by t)from unnest(p_times)t),(clock_timestamp()at time zone 'Asia/Yerevan')::date)
  returning id into mid;
 return jsonb_build_object('status','added','id',mid);
end$$;

-- Stop one (kept for history). {status:'stopped'|'not-found'}.
create function public.member_medicine_stop(p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.uid()is null then raise insufficient_privilege;end if;
 update public.member_medicines set stopped_at=clock_timestamp()where id=p_id and user_id=auth.uid()and stopped_at is null;
 return jsonb_build_object('status',case when found then 'stopped'else 'not-found'end);
end$$;

-- Tick one dose of a self-reported medicine. The dose must be one of its times on a Yerevan date
-- from its start, within the last 3 days, and not more than 60 minutes ahead. A change needs the
-- revision the member saw (0 for a first tick). {status:'saved',revision} | {status:'conflict'} |
-- {status:'not-due'} | {status:'invalid'} | {status:'disabled'}.
create function public.member_medicine_dose_report(p_medicine uuid,p_due_at timestamptz,p_status text,p_expected_revision integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare uid uuid:=auth.uid();m public.member_medicines;local timestamp;d public.member_medicine_doses;rev integer;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not(select enabled from public.member_medicine_settings where singleton)then return jsonb_build_object('status','disabled');end if;
 if p_status is null or p_status not in('taken','skipped')or p_due_at is null or not isfinite(p_due_at)or p_expected_revision is null or p_expected_revision<0
  then return jsonb_build_object('status','invalid');end if;
 select * into m from public.member_medicines where id=p_medicine and user_id=uid for share;
 if not found then raise insufficient_privilege;end if;
 local:=p_due_at at time zone 'Asia/Yerevan';
 if not(local::time=any(m.times))or local::date<m.started_on or p_due_at>clock_timestamp()+interval '60 minutes'
  or p_due_at<clock_timestamp()-interval '3 days'or(m.stopped_at is not null and p_due_at>=m.stopped_at)then return jsonb_build_object('status','not-due');end if;
 select * into d from public.member_medicine_doses where medicine_id=m.id and due_at=p_due_at for update;
 if not found then
  if p_expected_revision<>0 then return jsonb_build_object('status','conflict');end if;
  insert into public.member_medicine_doses(medicine_id,user_id,due_at,status)values(m.id,uid,p_due_at,p_status)
   on conflict(medicine_id,due_at)do nothing returning revision into rev;
  if rev is null then return jsonb_build_object('status','conflict');end if;
  return jsonb_build_object('status','saved','revision',rev);
 end if;
 if d.revision<>p_expected_revision then return jsonb_build_object('status','conflict');end if;
 if d.status=p_status then return jsonb_build_object('status','saved','revision',d.revision);end if;
 update public.member_medicine_doses set status=p_status,recorded_at=clock_timestamp(),revision=revision+1 where medicine_id=m.id and due_at=p_due_at returning revision into rev;
 return jsonb_build_object('status','saved','revision',rev);
end$$;

-- The doctor's medicines in force on a Yerevan date: the active published plan, its own and its
-- carried-over medicines, active and within their dates (as the member app reads them).
create function public._member_plan_medicines(p_member uuid,p_day date)returns setof public.patient_care_medications
language sql stable security definer set search_path=''as $$
 select m.* from public.patient_care_plans p join public.patient_care_medications m on m.user_id=p.user_id
  and(m.plan_id=p.id or exists(select 1 from public.patient_care_plan_medications l where l.plan_id=p.id and l.medication_id=m.id))
 where p.user_id=p_member and p.active and p.published_at<=clock_timestamp()and m.active
  and m.start_date<=p_day and(m.end_date is null or m.end_date>=p_day)
$$;

-- Adherence for the assigned nurse and doctor: both kinds of medicine with the ticks of the last
-- p_days days (1 to 60). The app counts; this returns the facts.
create function public.member_medicines_staff_read(p_member uuid,p_days integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.member_medicine_settings;since timestamptz;today date;
begin
 perform set_config('lock_timeout','1500ms',true);
 select * into s from public.member_medicine_settings where singleton;
 if not s.enabled then return jsonb_build_object('version','member-medicines-v1','enabled',false);end if;
 perform public._patient_visit_authorize(p_member,false,false);
 if p_days is null or p_days not between 1 and 60 then raise invalid_parameter_value;end if;
 today:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
 since:=public._member_medicine_due(today-p_days+1,'00:00');
 return jsonb_build_object('version','member-medicines-v1','enabled',true,'today',today,'days',p_days,'now',clock_timestamp(),
  'self',coalesce((select jsonb_agg(public._member_medicine_json(m,since)order by m.stopped_at nulls first,m.created_at)
   from public.member_medicines m where m.user_id=p_member and(m.stopped_at is null or m.stopped_at>=since)),'[]'::jsonb),
  'plan',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'source','plan','name',m.name,'dose',m.dose,
    'effectiveAt',coalesce(m.effective_at,(select published_at from public.patient_care_plans where id=m.plan_id)),
    'times',(select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(m.times)t),'startedOn',m.start_date,'endDate',m.end_date,
    'doses',coalesce((select jsonb_agg(jsonb_build_object('dueAt',e.due_at,'status',e.status,'recordedAt',e.recorded_at)order by e.due_at)
     from public.patient_dose_events e where e.user_id=p_member and e.medication_id=m.id and e.due_at>=since),'[]'::jsonb))order by m.name)
   from public._member_plan_medicines(p_member,today)m),'[]'::jsonb));
exception when lock_not_available then raise exception using errcode='55P03',message='medicines busy';
end$$;

insert into public.system_message_templates(template_id,version,locale,body)values
 ('member.reminder_medicine',1,'en','UNAPPROVED PLACEHOLDER. It is {time}, a time you chose for your daily routine. Tick it off in Noreon when it is done.'),
 ('member.reminder_medicine',1,'hy','UNAPPROVED PLACEHOLDER. Ժամը {time} է՝ ձեր օրվա ռեժիմի համար ընտրած ժամը։ Կատարելուց հետո նշեք Noreon-ում։');

-- Called by the dispatcher sweep (every 5 minutes). A member's dose time (plus their offset) that
-- came within the last 15 minutes gets one notice for everything due at that time, unless all of it
-- is already ticked. Members who turned medicine reminders off (medicationEnabled false) get none.
create function public.member_medicine_reminders_run(p_now timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare nowt timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;today date;r record;queued integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if(select not enabled or not reminders from public.member_medicine_settings where singleton)then return jsonb_build_object('ok',true,'state','off');end if;
 perform set_config('noreon.member_notice_sweep','on',true);
 lt:=nowt at time zone 'Asia/Yerevan';today:=lt::date;
 for r in
  with prefs as(
   select u.user_id,coalesce((p.preferences->>'medicationEnabled')::boolean,true)on_,coalesce((p.preferences->>'medicationOffsetMinutes')::integer,0)off_
   from(select user_id from public.member_medicines where stopped_at is null
        union select p.user_id from public.patient_care_plans p where p.active and p.published_at<=nowt)u
   left join public.patient_reminder_preferences p on p.user_id=u.user_id),
  due as(
   -- Today and yesterday, so an offset that crosses midnight is still found.
   select m.user_id,public._member_medicine_due(dd,t)due_at,(not exists(select 1 from public.member_medicine_doses x where x.medicine_id=m.id and x.due_at=public._member_medicine_due(dd,t)))open_
    from public.member_medicines m cross join unnest(m.times)t cross join(values(today),(today-1))v(dd)
    where m.stopped_at is null and m.started_on<=dd
   union all
   select pm.user_id,public._member_medicine_due(dd,t),(not exists(select 1 from public.patient_dose_events x where x.user_id=pm.user_id and x.medication_id=pm.id and x.due_at=public._member_medicine_due(dd,t)))
    from(select distinct p.user_id from public.patient_care_plans p where p.active and p.published_at<=nowt)u
    cross join(values(today),(today-1))v(dd)
    cross join lateral public._member_plan_medicines(u.user_id,dd)pm cross join unnest(pm.times)t
    -- Not before the medicine is in force (published plan or its effective time), review F4.
    where public._member_medicine_due(dd,t)>=coalesce(pm.effective_at,(select published_at from public.patient_care_plans where id=pm.plan_id)))
  select d.user_id,d.due_at,bool_or(d.open_)any_open from due d join prefs p on p.user_id=d.user_id
  where p.on_ and nowt>=d.due_at+make_interval(mins=>p.off_)and nowt<d.due_at+make_interval(mins=>p.off_)+interval '15 minutes'
  group by d.user_id,d.due_at
 loop
  if r.any_open and not public._member_quiet_now(r.user_id,lt::time)and not public._member_reminder_held(r.user_id,'member.reminder_medicine')then
   if public._member_notice_safe(r.user_id,'reminders','member.reminder_medicine','medicine:'||r.user_id::text||':'||extract(epoch from r.due_at)::bigint::text,
    jsonb_build_object('time',to_char(r.due_at at time zone 'Asia/Yerevan','HH24:MI')),'/patient/medicines','open_home')is not null then queued:=queued+1;end if;
  end if;
 end loop;
 perform set_config('noreon.member_notice_sweep','off',true);
 return jsonb_build_object('ok',true,'state','ran','queued',queued);
end$$;

revoke all on function public._member_medicine_times_ok(time[]),public._member_medicine_due(date,time),public._member_medicine_json(public.member_medicines,timestamptz),
 public.member_medicines_read(),public.member_medicine_add(text,text,time[]),public.member_medicine_stop(uuid),
 public.member_medicine_dose_report(uuid,timestamptz,text,integer),public._member_plan_medicines(uuid,date),
 public.member_medicines_staff_read(uuid,integer),public.member_medicine_reminders_run(timestamptz)
 from public,anon,authenticated,service_role;
-- The table check calls the times check as whoever writes the row.
grant execute on function public._member_medicine_times_ok(time[])to authenticated,service_role;
grant execute on function public.member_medicines_read(),public.member_medicine_add(text,text,time[]),public.member_medicine_stop(uuid),
 public.member_medicine_dose_report(uuid,timestamptz,text,integer),public.member_medicines_staff_read(uuid,integer)to authenticated;
grant execute on function public.member_medicine_reminders_run(timestamptz)to service_role;
