-- Programme rhythm (dark): the week-4 review, the month-3 and month-6 checkpoints, and the
-- member's journey timeline (prototype D3, D4, J1; Khikar approved the programme features 17 Oct).
--
-- What the database does:
--   * one settings row holds the switch and every offset. The offsets are a proposal that the
--     clinical owner has not signed off (Armen C10/C12); they are data, never code, and the row
--     says so (clinical_status). Changing an offset moves every checkpoint that has not opened yet.
--   * checkpoints are anchored on the member's first published care plan (version 1, #197).
--     Dates are Yerevan calendar dates. Creating them is idempotent (one row per member and kind).
--   * a checkpoint opens (member check-in available, doctor task in the queue) a set number of
--     days before its date. Opening is done by programme_run, called from the 5-minute dispatcher
--     sweep, outside quiet hours (21:00 to 09:00), and sends one member notice per checkpoint.
--   * the member answers a short check-in: how they feel, their own report of taking medicines
--     and an optional note. Nothing here interprets the answers or raises an alert.
--   * the assigned doctor closes a checkpoint either by publishing a new plan version (the
--     existing publish path with its "what changed" note and member notice) or by confirming the
--     current plan, which sends its own notice.
-- What it does not do: no clinical value is derived, no test is ordered, nothing is sent to a GP.
-- Repeat tests at month 3 and 6 are shown to the doctor only as the decision tree states them;
-- otherwise the doctor decides.

-- 1. Settings ------------------------------------------------------------------------------------

create table public.programme_settings(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 week4_review_offset interval not null default interval '28 days'check(week4_review_offset between interval '7 days'and interval '90 days'),
 month3_offset interval not null default interval '3 months'check(month3_offset between interval '30 days'and interval '9 months'),
 month6_offset interval not null default interval '6 months'check(month6_offset between interval '60 days'and interval '12 months'),
 -- The member check-in and the doctor task open this many days before the checkpoint date.
 opens_days_before integer not null default 3 check(opens_days_before between 0 and 14),
 clinical_status text not null default 'pending_clinical_signoff'check(clinical_status in('pending_clinical_signoff','signed_off')),
 clinical_note text not null default 'Proposed offsets from the founders'' prototype; not signed off (Armen C10, C12).'check(length(clinical_note)between 1 and 500),
 updated_at timestamptz not null default clock_timestamp(),
 check(week4_review_offset<month3_offset and month3_offset<month6_offset)
);
insert into public.programme_settings(singleton)values(true);
alter table public.programme_settings enable row level security;
revoke all on public.programme_settings from public,anon,authenticated,service_role;

create function public._programme_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.programme_settings where singleton),false)
$$;

-- 2. Checkpoints, check-ins and their history -------------------------------------------------------

create table public.programme_checkpoints(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references auth.users(id)on delete cascade,
 kind text not null check(kind in('week4_review','month3','month6')),
 anchor_plan_id uuid not null references public.patient_clinical_publications(plan_id),
 anchor_at timestamptz not null,
 due_on date not null,
 state text not null default 'scheduled'check(state in('scheduled','open','completed')),
 opened_at timestamptz,
 completed_at timestamptz,
 completed_by uuid references auth.users(id),
 completed_by_name text check(completed_by_name is null or length(completed_by_name)between 1 and 200),
 outcome text check(outcome in('confirmed','republished')),
 outcome_plan_id uuid references public.patient_clinical_publications(plan_id),
 doctor_note text check(doctor_note is null or length(btrim(doctor_note))between 1 and 1000),
 submission_id uuid unique,
 created_at timestamptz not null default clock_timestamp(),
 unique(member_id,kind),
 check((state='scheduled')=(opened_at is null)),
 check((state='completed')=(completed_at is not null and outcome is not null)),
 check(outcome is distinct from 'republished'or outcome_plan_id is not null)
);
create index programme_checkpoints_due on public.programme_checkpoints(state,due_on)where state<>'completed';
alter table public.programme_checkpoints enable row level security;
revoke all on public.programme_checkpoints from public,anon,authenticated,service_role;

-- A completed checkpoint is frozen; the anchor never moves.
create function public._programme_checkpoint_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then
  -- Only the member's account deletion (cascade) removes rows.
  if exists(select 1 from auth.users where id=old.member_id)then raise exception using errcode='55000',message='Programme checkpoints are not deleted';end if;
  return old;
 end if;
 if old.state='completed'then raise exception using errcode='55000',message='A completed checkpoint is frozen';end if;
 if new.member_id<>old.member_id or new.kind<>old.kind or new.anchor_plan_id<>old.anchor_plan_id or new.anchor_at<>old.anchor_at then
  raise exception using errcode='55000',message='The checkpoint anchor does not change';end if;
 if old.state='open'and new.due_on<>old.due_on then raise exception using errcode='55000',message='An open checkpoint keeps its date';end if;
 return new;
end$$;
create trigger programme_checkpoints_guard before update or delete on public.programme_checkpoints
 for each row execute function public._programme_checkpoint_guard();

create table public.programme_checkins(
 id uuid primary key default gen_random_uuid(),
 checkpoint_id uuid not null unique references public.programme_checkpoints(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 feeling text not null check(feeling in('better','same','worse')),
 medicines text not null check(medicines in('all','missed_some','missed_many','no_medicines','not_sure')),
 note text check(note is null or length(btrim(note))between 1 and 500),
 submission_id uuid not null unique,
 submitted_at timestamptz not null default clock_timestamp()
);
alter table public.programme_checkins enable row level security;
revoke all on public.programme_checkins from public,anon,authenticated,service_role;
create trigger programme_checkins_frozen before update on public.programme_checkins
 for each row execute function public._member_notice_frozen();

create table public.programme_checkpoint_events(
 id bigint generated always as identity primary key,
 checkpoint_id uuid not null references public.programme_checkpoints(id)on delete cascade,
 kind text not null check(kind in('scheduled','rescheduled','opened','checkin','confirmed','republished')),
 actor_id uuid,
 detail jsonb not null default '{}'check(jsonb_typeof(detail)='object'),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.programme_checkpoint_events enable row level security;
revoke all on public.programme_checkpoint_events from public,anon,authenticated,service_role;
create trigger programme_checkpoint_events_frozen before update on public.programme_checkpoint_events
 for each row execute function public._member_notice_frozen();

-- 3. Dates --------------------------------------------------------------------------------------------

-- Today in Yerevan.
create function public._programme_today(p_now timestamptz)returns date language sql stable set search_path=''as $$
 select (p_now at time zone 'Asia/Yerevan')::date
$$;

-- A checkpoint date: the anchor's Yerevan calendar date plus the offset (calendar months stay months).
create function public._programme_due_on(p_anchor timestamptz,p_kind text)returns date language sql stable security definer set search_path=''as $$
 select ((p_anchor at time zone 'Asia/Yerevan')::date+case p_kind when 'week4_review'then s.week4_review_offset when 'month3'then s.month3_offset else s.month6_offset end)::date
 from public.programme_settings s where s.singleton
$$;

-- The member's first published plan (version 1), the programme's start.
create function public._programme_anchor(p_member uuid,out plan_id uuid,out anchor_at timestamptz)language sql stable security definer set search_path=''as $$
 select v.plan_id,p.published_at from public.patient_care_plan_versions v join public.patient_clinical_publications p on p.plan_id=v.plan_id
 where v.user_id=p_member and v.version=1
$$;

-- Creates the three checkpoints once (idempotent) and moves the ones not yet open to the current
-- offsets. Returns the number of rows created or moved.
create function public._programme_schedule(p_member uuid)returns integer language plpgsql security definer set search_path=''as $$
declare a record;k text;n integer:=0;cp public.programme_checkpoints;d date;
begin
 select * into a from public._programme_anchor(p_member);
 if a.plan_id is null then return 0;end if;
 foreach k in array array['week4_review','month3','month6']loop
  d:=public._programme_due_on(a.anchor_at,k);
  insert into public.programme_checkpoints(member_id,kind,anchor_plan_id,anchor_at,due_on)values(p_member,k,a.plan_id,a.anchor_at,d)
  on conflict(member_id,kind)do nothing returning * into cp;
  if found then
   insert into public.programme_checkpoint_events(checkpoint_id,kind,detail)values(cp.id,'scheduled',jsonb_build_object('dueOn',d));n:=n+1;
  else
   update public.programme_checkpoints set due_on=d where member_id=p_member and kind=k and state='scheduled'and due_on<>d returning * into cp;
   if found then insert into public.programme_checkpoint_events(checkpoint_id,kind,detail)values(cp.id,'rescheduled',jsonb_build_object('dueOn',d));n:=n+1;end if;
  end if;
 end loop;
 return n;
end$$;

-- 4. Wording (v1 placeholders, held at claim until approved) ----------------------------------------

insert into public.system_message_templates(template_id,version,locale,body)values
 ('member.programme_week4_open',1,'en','UNAPPROVED PLACEHOLDER. Your week-4 review is coming up. Open Noreon to answer three short questions for your doctor.'),
 ('member.programme_week4_open',1,'hy','UNAPPROVED PLACEHOLDER. Մոտենում է ձեր 4-րդ շաբաթվա վերանայումը։ Բացեք Noreon-ը և պատասխանեք ձեր բժշկի երեք կարճ հարցին։'),
 ('member.programme_month3_open',1,'en','UNAPPROVED PLACEHOLDER. Your month-3 check-in is coming up. Open Noreon to answer three short questions for your doctor.'),
 ('member.programme_month3_open',1,'hy','UNAPPROVED PLACEHOLDER. Մոտենում է ձեր 3-րդ ամսվա ստուգումը։ Բացեք Noreon-ը և պատասխանեք ձեր բժշկի երեք կարճ հարցին։'),
 ('member.programme_month6_open',1,'en','UNAPPROVED PLACEHOLDER. Your month-6 check-in is coming up. Open Noreon to answer three short questions for your doctor.'),
 ('member.programme_month6_open',1,'hy','UNAPPROVED PLACEHOLDER. Մոտենում է ձեր 6-րդ ամսվա ստուգումը։ Բացեք Noreon-ը և պատասխանեք ձեր բժշկի երեք կարճ հարցին։'),
 ('member.programme_plan_confirmed',1,'en','UNAPPROVED PLACEHOLDER. Your doctor reviewed your progress. Your care plan stays the same. Open Noreon to see the note.'),
 ('member.programme_plan_confirmed',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր բժիշկը վերանայեց ձեր առաջընթացը։ Ձեր խնամքի ծրագիրը մնում է նույնը։ Բացեք Noreon-ը՝ նշումը տեսնելու համար։');

-- 5. Scheduling: the first plan and the sweep ---------------------------------------------------------

-- Version 1 of a plan schedules the programme (when the switch is on). A later version closes an
-- open checkpoint as "republished" (whatever the switch); the plan's own notice
-- (member.plan_updated) tells the member.
-- Never raises: it rides on the publish command.
create function public._programme_plan_version()returns trigger language plpgsql security definer set search_path=''as $$
declare cp public.programme_checkpoints;who text;
begin
 begin
  -- Scheduling waits for the switch; closing an open checkpoint does not, so a plan published
  -- while the switch was off still answers the review it was published for.
  if new.version=1 then
   if public._programme_enabled()then perform public._programme_schedule(new.user_id);end if;
  else
   select display_name into who from public.workspace_staff s join public.patient_clinical_publications p on p.actor_id=s.user_id where p.plan_id=new.plan_id;
   for cp in select * from public.programme_checkpoints where member_id=new.user_id and state='open'for update loop
    update public.programme_checkpoints set state='completed',completed_at=clock_timestamp(),outcome='republished',outcome_plan_id=new.plan_id,
     completed_by=(select actor_id from public.patient_clinical_publications where plan_id=new.plan_id),completed_by_name=coalesce(who,'Doctor')
    where id=cp.id;
    insert into public.programme_checkpoint_events(checkpoint_id,kind,actor_id,detail)
    values(cp.id,'republished',(select actor_id from public.patient_clinical_publications where plan_id=new.plan_id),jsonb_build_object('planId',new.plan_id,'version',new.version));
   end loop;
  end if;
 exception when others then null;
 end;
 return null;
end$$;
create trigger programme_plan_version after insert on public.patient_care_plan_versions
 for each row execute function public._programme_plan_version();

-- Called by the dispatcher sweep. Schedules members whose first plan predates the switch, moves
-- unopened checkpoints to the current offsets, and opens those whose window has started (with one
-- member notice each). Only members with a current plan are opened. Nothing is opened in quiet
-- hours. p_now is for tests.
create function public.programme_run(p_now timestamptz default null)returns jsonb language plpgsql security definer set search_path=''as $$
declare nowt timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;today date;s public.programme_settings;m uuid;cp public.programme_checkpoints;
 scheduled integer:=0;opened integer:=0;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into s from public.programme_settings where singleton;
 if not s.enabled then return jsonb_build_object('ok',true,'state','off');end if;
 -- One sweep at a time; a second caller leaves the work to the first.
 if not pg_try_advisory_xact_lock(hashtextextended('programme-run',0))then return jsonb_build_object('ok',true,'state','busy');end if;
 for m in select v.user_id from public.patient_care_plan_versions v where v.version=1 loop
  scheduled:=scheduled+public._programme_schedule(m);
 end loop;
 lt:=nowt at time zone 'Asia/Yerevan';today:=lt::date;
 if lt::time>='21:00'or lt::time<'09:00'then return jsonb_build_object('ok',true,'state','quiet_hours','scheduled',scheduled);end if;
 perform set_config('noreon.member_notice_sweep','on',true);
 for cp in select c.* from public.programme_checkpoints c
  where c.state='scheduled'and c.due_on-s.opens_days_before<=today
   and exists(select 1 from public.patient_care_plans p where p.user_id=c.member_id and p.active)
  order by c.due_on,c.id for update of c skip locked
 loop
  -- A later checkpoint never opens while an earlier one is still open: one review at a time.
  continue when exists(select 1 from public.programme_checkpoints o where o.member_id=cp.member_id and o.state='open');
  update public.programme_checkpoints set state='open',opened_at=nowt where id=cp.id;
  insert into public.programme_checkpoint_events(checkpoint_id,kind,detail)values(cp.id,'opened',jsonb_build_object('dueOn',cp.due_on));
  perform public._member_notice_safe(cp.member_id,'care','member.programme_'||case cp.kind when 'week4_review'then 'week4'else cp.kind end||'_open',
   'programme.open:'||cp.id::text,'{}','/patient/dashboard','open_home');
  opened:=opened+1;
 end loop;
 -- The sweep never waits for a member's notice lock, so an opening notice can go undecided (no
 -- journal row). Retry those for a day; the event key keeps it to one decision. Only while the
 -- care group is on, so a switched-off group is not traced every five minutes.
 if(select care from public.member_notice_settings where singleton)then
  for cp in select c.* from public.programme_checkpoints c
   where c.state='open'and c.opened_at>nowt-interval '1 day'
    and not exists(select 1 from public.member_notices n where n.event_key='programme.open:'||c.id::text)
  loop
   perform public._member_notice_safe(cp.member_id,'care','member.programme_'||case cp.kind when 'week4_review'then 'week4'else cp.kind end||'_open',
    'programme.open:'||cp.id::text,'{}','/patient/dashboard','open_home');
  end loop;
 end if;
 perform set_config('noreon.member_notice_sweep','off',true);
 return jsonb_build_object('ok',true,'state','ran','scheduled',scheduled,'opened',opened);
end$$;

-- 6. Member -------------------------------------------------------------------------------------------

create function public._programme_member()returns uuid language plpgsql stable security definer set search_path=''as $$
begin
 if auth.uid()is null or not exists(select 1 from auth.users u where u.id=auth.uid()and u.phone_confirmed_at is not null)
  or exists(select 1 from public.workspace_staff where user_id=auth.uid())or exists(select 1 from public.clinic_portal_memberships where user_id=auth.uid())
 then raise insufficient_privilege using message='Member session required';end if;
 return auth.uid();
end$$;

-- The member's own programme: the offsets status, the start, and each checkpoint with its date,
-- state, check-in and outcome. Before the sweep has scheduled the rows, the dates are projected
-- from the same settings. No staff identifiers beyond the doctor's display name.
create function public.member_programme_timeline()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare me uuid;a record;s public.programme_settings;
begin
 select * into s from public.programme_settings where singleton;
 if not s.enabled then return jsonb_build_object('version','programme-v1','enabled',false);end if;
 me:=public._programme_member();
 select * into a from public._programme_anchor(me);
 return jsonb_build_object('version','programme-v1','enabled',true,'today',public._programme_today(clock_timestamp()),
  'schedulePending',s.clinical_status<>'signed_off','opensDaysBefore',s.opens_days_before,
  'startedAt',a.anchor_at,
  'checkpoints',case when a.plan_id is null then '[]'::jsonb else(
   select jsonb_agg(jsonb_build_object('id',c.id,'kind',k.kind,'dueOn',coalesce(c.due_on,public._programme_due_on(a.anchor_at,k.kind)),
    'state',coalesce(c.state,'scheduled'),'openedAt',c.opened_at,'completedAt',c.completed_at,'outcome',c.outcome,'doctorNote',c.doctor_note,
    'checkin',(select jsonb_build_object('feeling',i.feeling,'medicines',i.medicines,'note',i.note,'submittedAt',i.submitted_at)from public.programme_checkins i where i.checkpoint_id=c.id))
    order by k.n)
   from(values('week4_review',1),('month3',2),('month6',3))k(kind,n)left join public.programme_checkpoints c on c.member_id=me and c.kind=k.kind)end);
end$$;

-- The member's check-in for an open checkpoint. A resend of the same submission returns the
-- recorded check-in; a second, different check-in is refused (the first one stands).
create function public.member_programme_checkin_submit(p_checkpoint uuid,p_feeling text,p_medicines text,p_note text,p_submission uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare me uuid;cp public.programme_checkpoints;i public.programme_checkins;note text:=nullif(btrim(coalesce(p_note,'')),'');
begin
 if not public._programme_enabled()then raise exception using errcode='55P03',message='The programme is switched off';end if;
 me:=public._programme_member();
 if p_submission is null then raise exception using errcode='22023',message='Submission id required';end if;
 select * into i from public.programme_checkins where submission_id=p_submission;
 if found then
  if i.member_id<>me then raise insufficient_privilege;end if;
  return jsonb_build_object('status','saved','submittedAt',i.submitted_at);
 end if;
 if p_feeling is null or p_feeling not in('better','same','worse')or p_medicines is null or p_medicines not in('all','missed_some','missed_many','no_medicines','not_sure')then
  raise exception using errcode='22023',message='Choose an answer for each question';end if;
 if note is not null and length(note)>500 then raise exception using errcode='22023',message='Keep the note within 500 characters';end if;
 select * into cp from public.programme_checkpoints where id=p_checkpoint for update;
 if not found or cp.member_id<>me then raise insufficient_privilege using message='Not your checkpoint';end if;
 if cp.state<>'open'then return jsonb_build_object('status','closed');end if;
 if exists(select 1 from public.programme_checkins where checkpoint_id=cp.id)then return jsonb_build_object('status','already');end if;
 insert into public.programme_checkins(checkpoint_id,member_id,feeling,medicines,note,submission_id)values(cp.id,me,p_feeling,p_medicines,note,p_submission)returning * into i;
 insert into public.programme_checkpoint_events(checkpoint_id,kind,actor_id)values(cp.id,'checkin',me);
 return jsonb_build_object('status','saved','submittedAt',i.submitted_at);
end$$;

-- 7. Doctor ---------------------------------------------------------------------------------------------

create function public._programme_doctor(p_member uuid)returns uuid language plpgsql stable security definer set search_path=''as $$
begin
 if coalesce(public.real_clinical_staff_identity()->>'role','')<>'doctor'or not public.staff_care_access(p_member,auth.uid(),true)then
  raise insufficient_privilege using message='Assigned doctor access required';end if;
 return auth.uid();
end$$;

-- Open checkpoints for the members assigned to this doctor, earliest date first.
create function public.doctor_programme_queue()returns jsonb language plpgsql stable security definer set search_path=''as $$
begin
 if not public._programme_enabled()then return jsonb_build_object('version','programme-queue-v1','enabled',false,'items','[]'::jsonb);end if;
 if coalesce(public.real_clinical_staff_identity()->>'role','')<>'doctor'then raise insufficient_privilege using message='Doctor session required';end if;
 return jsonb_build_object('version','programme-queue-v1','enabled',true,'today',public._programme_today(clock_timestamp()),'items',coalesce((
  select jsonb_agg(jsonb_build_object('checkpointId',c.id,'memberId',c.member_id,'memberName',p.display_name,'kind',c.kind,'dueOn',c.due_on,'openedAt',c.opened_at,
   'checkinAt',(select submitted_at from public.programme_checkins i where i.checkpoint_id=c.id))order by c.due_on,c.id)
  from public.programme_checkpoints c join public.patient_clinical_cases k on k.user_id=c.member_id left join public.profiles p on p.id=c.member_id
  where c.state='open'and k.assigned_doctor_id=auth.uid()and public.staff_care_access(c.member_id,auth.uid(),true)),'[]'::jsonb));
end$$;

-- One member's programme for the assigned doctor: checkpoints with check-ins, and the recorded
-- readings and medicine ticks since the plan started (counts and values as recorded, no judgement).
create function public.doctor_programme_member(p_user_id uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare s public.programme_settings;a record;since timestamptz;
begin
 select * into s from public.programme_settings where singleton;
 if not s.enabled then return jsonb_build_object('version','programme-member-v1','enabled',false);end if;
 perform public._programme_doctor(p_user_id);
 select * into a from public._programme_anchor(p_user_id);
 since:=coalesce((select max(coalesce(c.completed_at,c.opened_at))from public.programme_checkpoints c where c.member_id=p_user_id and c.state='completed'),a.anchor_at);
 return jsonb_build_object('version','programme-member-v1','enabled',true,'today',public._programme_today(clock_timestamp()),
  'schedulePending',s.clinical_status<>'signed_off','startedAt',a.anchor_at,'since',since,
  'offsets',jsonb_build_object('week4Review',s.week4_review_offset::text,'month3',s.month3_offset::text,'month6',s.month6_offset::text,'opensDaysBefore',s.opens_days_before),
  'currentPlan',(select jsonb_build_object('planId',v.plan_id,'version',v.version,'publishedAt',p.published_at)
   from public.patient_care_plan_versions v join public.patient_clinical_publications p on p.plan_id=v.plan_id join public.patient_care_plans c on c.id=v.plan_id
   where v.user_id=p_user_id and c.active order by v.version desc limit 1),
  'checkpoints',case when a.plan_id is null then '[]'::jsonb else(
   select jsonb_agg(jsonb_build_object('id',c.id,'kind',k.kind,'dueOn',coalesce(c.due_on,public._programme_due_on(a.anchor_at,k.kind)),'state',coalesce(c.state,'scheduled'),
    'openedAt',c.opened_at,'completedAt',c.completed_at,'completedByName',c.completed_by_name,'outcome',c.outcome,'doctorNote',c.doctor_note,
    'outcomePlanVersion',(select version from public.patient_care_plan_versions where plan_id=c.outcome_plan_id),
    'checkin',(select jsonb_build_object('feeling',i.feeling,'medicines',i.medicines,'note',i.note,'submittedAt',i.submitted_at)from public.programme_checkins i where i.checkpoint_id=c.id))
    order by k.n)
   from(values('week4_review',1),('month3',2),('month6',3))k(kind,n)left join public.programme_checkpoints c on c.member_id=p_user_id and c.kind=k.kind)end,
  'readings',(select jsonb_build_object('count',count(*),'first',min(measured_at),'last',max(measured_at),
    'last7',(select jsonb_build_object('count',count(*),'systolic',round(avg(systolic)),'diastolic',round(avg(diastolic)))
     from public.patient_measurements x where x.user_id=p_user_id and x.measured_at>clock_timestamp()-interval '7 days'and x.measured_at<=clock_timestamp()))
   from public.patient_measurements m where m.user_id=p_user_id and m.measured_at>=since and m.measured_at<=clock_timestamp()),
  'doses',(select jsonb_build_object('taken',count(*)filter(where status='taken'),'skipped',count(*)filter(where status='skipped'))
   from public.patient_dose_events d where d.user_id=p_user_id and d.due_at>=since and d.due_at<=clock_timestamp()),
  'gpReport',(select jsonb_build_object('version',g.version,'approvedAt',g.approved_at)from public.gp_report_versions g where g.member_id=p_user_id order by g.version desc limit 1));
end$$;

-- The doctor confirms the current plan for an open checkpoint, with an optional note the member
-- sees. A resend of the same submission returns the recorded outcome.
create function public.doctor_programme_confirm(p_user_id uuid,p_checkpoint uuid,p_note text,p_submission uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;cp public.programme_checkpoints;note text:=nullif(btrim(coalesce(p_note,'')),'');who text;
begin
 if not public._programme_enabled()then raise exception using errcode='55P03',message='The programme is switched off';end if;
 d:=public._programme_doctor(p_user_id);
 if p_submission is null then raise exception using errcode='22023',message='Submission id required';end if;
 select * into cp from public.programme_checkpoints where submission_id=p_submission;
 if found then
  if cp.member_id<>p_user_id then raise insufficient_privilege;end if;
  return jsonb_build_object('status','confirmed','completedAt',cp.completed_at);
 end if;
 if note is not null and length(note)>1000 then raise exception using errcode='22023',message='Keep the note within 1000 characters';end if;
 select * into cp from public.programme_checkpoints where id=p_checkpoint and member_id=p_user_id for update;
 if not found then raise insufficient_privilege using message='Not this member''s checkpoint';end if;
 if cp.state<>'open'then return jsonb_build_object('status','closed');end if;
 if not exists(select 1 from public.patient_care_plans p where p.user_id=p_user_id and p.active)then return jsonb_build_object('status','no_plan');end if;
 select display_name into who from public.workspace_staff where user_id=d;
 update public.programme_checkpoints set state='completed',completed_at=clock_timestamp(),completed_by=d,completed_by_name=coalesce(who,'Doctor'),
  outcome='confirmed',doctor_note=note,submission_id=p_submission where id=cp.id returning * into cp;
 insert into public.programme_checkpoint_events(checkpoint_id,kind,actor_id)values(cp.id,'confirmed',d);
 perform public._member_notice_safe(p_user_id,'care','member.programme_plan_confirmed','programme.confirmed:'||cp.id::text,'{}','/patient/dashboard','open_home');
 return jsonb_build_object('status','confirmed','completedAt',cp.completed_at);
end$$;

-- 8. Privileges ---------------------------------------------------------------------------------------------

revoke all on function public._programme_enabled(),public._programme_checkpoint_guard(),public._programme_today(timestamptz),
 public._programme_due_on(timestamptz,text),public._programme_anchor(uuid),public._programme_schedule(uuid),public._programme_plan_version(),
 public.programme_run(timestamptz),public._programme_member(),public.member_programme_timeline(),
 public.member_programme_checkin_submit(uuid,text,text,text,uuid),public._programme_doctor(uuid),public.doctor_programme_queue(),
 public.doctor_programme_member(uuid),public.doctor_programme_confirm(uuid,uuid,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.programme_run(timestamptz)to service_role;
grant execute on function public.member_programme_timeline(),public.member_programme_checkin_submit(uuid,text,text,text,uuid),
 public.doctor_programme_queue(),public.doctor_programme_member(uuid),public.doctor_programme_confirm(uuid,uuid,text,uuid)to authenticated;
