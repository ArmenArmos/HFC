-- LDL-to-goal pilot, phase 2: the re-test and response loop (founders 29 Oct 2026;
-- output/ldl-pivot-2026-10-29/FABLE_REPORT.md §3 "Phase 2", spec §2.4 and §4.5). Builds on 20261029171957.
--
--   1. ldl_goal_settings.ldl_response_enabled, off by default, and only on together with ldl_goal_enabled.
--   2. ldl_retests: when the assigned doctor records a change to lipid therapy they may confirm a re-test window.
--      The window is computed in lib/ldl/constants.ts (pending Armen/Yesayi) and proposed by the form; the
--      database stores what the doctor confirmed, as phase 1 does for the goal. One open re-test per member; a
--      newer change supersedes it (and keeps its home-visit request, if one is already open).
--   3. ldl_response_run, from the 5-minute dispatcher sweep, outside quiet hours (21:00 to 09:00):
--      on the request day it creates a home-visit request for a blood draw in patient_test_requests, the
--      existing admin queue (an admin confirms with the lab or nurse, as today; the nurse visit lists one
--      sample per ordered lab test). It is created near the window, not at the change, because an open home
--      request fences clinic slot booking. A member with an open visit or request, or not yet eligible (confirmed
--      phone, consent, no urgent hold), gets none yet: the re-test is "fenced", retried every sweep, and shown to the
--      admin. The member gets a notice.
--      After the window, an open re-test becomes overdue: one member notice and an item on the admin's
--      Operations page (admin_ldl_retests).
--   4. The response check. The app (lib/ldl/response.ts, using lib/ldl/status.ts) reads ldl_response_candidates,
--      decides at goal / above goal / not assessable for the newest counted LDL value that a doctor reviewed or
--      released, and records it with ldl_response_record: one row per value, with the facts the doctor sees (the
--      value, the goal, the change since the previous value, adherence in the last 28 days from the dose logs,
--      the latest ALT) and the guideline next step as text. No medicine is selected; the doctor decides. The open
--      re-test is then done. The member is told their result is with their doctor (one notice, fixed text).
--   5. doctor_ldl_responses on the doctor's Today page until the doctor marks the item reviewed.
--
-- No value is computed here: the app computes, the database checks shape, membership and once-only.
-- Member notices carry no health detail (no value, no status, no name): a date at most, like every member notice.

-- 1. Switch ---------------------------------------------------------------------------------------------------
alter table public.ldl_goal_settings add column ldl_response_enabled boolean not null default false;
create function public._ldl_response_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select ldl_goal_enabled and ldl_response_enabled from public.ldl_goal_settings where singleton),false)
$$;

-- 2. Records -----------------------------------------------------------------------------------------------------
create table public.ldl_responses(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 -- The value as _ldl_observations names it ('cr:', 'la:' or 'mr:' and the row id).
 observation_key text not null check(observation_key ~ '^(cr|la|mr):[0-9a-f-]{36}$'),
 observed_on date not null,
 status text not null check(status in('at_goal','above_goal','not_assessable')),
 -- What the doctor sees, as lib/ldl/response.ts computed it (schema: lib/ldl/response-schema.ts).
 facts jsonb not null check(jsonb_typeof(facts)='object'and octet_length(facts::text)<=8000),
 doctor_id uuid not null references auth.users(id),
 retest_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 closed_at timestamptz,
 closed_by uuid references auth.users(id),
 close_note text check(length(close_note)between 1 and 500),
 unique(member_id,observation_key),
 check((closed_at is null)=(closed_by is null))
);
create index ldl_responses_open on public.ldl_responses(member_id)where closed_at is null;

-- Reviewed values the check cannot use (not LDL by the catalogue, an unknown unit, implausible): recorded so they never
-- make the member a candidate again, and never shown as assessed (Astra LDLR-04).
create table public.ldl_response_skips(
 member_id uuid not null references public.patient_clinical_cases(user_id),
 observation_key text not null check(observation_key ~ '^(cr|la|mr):[0-9a-f-]{36}$'),
 created_at timestamptz not null default clock_timestamp(),
 primary key(member_id,observation_key)
);

create table public.ldl_retests(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 therapy_id uuid not null unique references public.ldl_lipid_therapies(id),
 -- acs: after a heart attack or acute coronary syndrome; other: any other recorded event (pending: stroke).
 rule text not null check(rule in('acs','other')),
 anchor_on date not null,
 due_from date not null,
 due_to date not null,
 -- The day the home-visit request is created (a few days before the window).
 request_on date not null,
 defaults_version text not null check(defaults_version ~ '^[a-z0-9.-]{1,40}$'),
 state text not null default 'scheduled'check(state in('scheduled','requested','fenced','done','cancelled','superseded')),
 request_id uuid references public.patient_test_requests(id),
 response_id uuid references public.ldl_responses(id),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 opened_at timestamptz,
 overdue_at timestamptz,
 closed_at timestamptz,
 closed_by uuid references auth.users(id),
 -- fenced: why no request was created ('open_visit': the member already has an open visit or request; 'not_eligible': no
 -- confirmed phone, no consent, or an urgent hold). The sweep retries a fenced re-test until it can create the request.
 fence_reason text check(fence_reason in('open_visit','not_eligible')),
 -- The admin's two acknowledgements, kept apart so handling a fence never hides a later overdue item (Astra LDLR-03).
 fence_ack_at timestamptz,
 fence_ack_by uuid references auth.users(id),
 admin_ack_at timestamptz,
 admin_ack_by uuid references auth.users(id),
 admin_note text check(length(admin_note)between 1 and 500),
 check(anchor_on<due_from and due_from<=due_to and request_on<=due_to),
 check((state in('scheduled','requested','fenced'))=(closed_at is null)),
 check(state<>'requested'or request_id is not null),
 check(state<>'done'or response_id is not null),
 check((admin_ack_at is null)=(admin_ack_by is null)),
 check((fence_ack_at is null)=(fence_ack_by is null)),
 check((state='fenced')=(fence_reason is not null))
);
create unique index ldl_retests_one_open on public.ldl_retests(member_id)where state in('scheduled','requested','fenced');
create index ldl_retests_due on public.ldl_retests(state,request_on,due_to)where state in('scheduled','requested','fenced');
alter table public.ldl_responses add constraint ldl_responses_retest foreign key(retest_id)references public.ldl_retests(id);

-- A response is closed once and otherwise never changes; a re-test only moves forward, and a closed one is frozen
-- (except the admin's acknowledgement of an overdue item, which never touches the clinical fields).
create function public._ldl_loop_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='LDL loop records are append-only';end if;
 if tg_table_name='ldl_responses'then
  if old.closed_at is not null or new.closed_at is null
   or(to_jsonb(new)-array['closed_at','closed_by','close_note'])<>(to_jsonb(old)-array['closed_at','closed_by','close_note'])
  then raise exception using errcode='55000',message='LDL loop records are append-only';end if;
 else
  if(to_jsonb(new)-array['state','request_id','response_id','opened_at','overdue_at','closed_at','closed_by','fence_reason','fence_ack_at','fence_ack_by','admin_ack_at','admin_ack_by','admin_note'])
    <>(to_jsonb(old)-array['state','request_id','response_id','opened_at','overdue_at','closed_at','closed_by','fence_reason','fence_ack_at','fence_ack_by','admin_ack_at','admin_ack_by','admin_note'])
   or(old.closed_at is not null and(to_jsonb(new)-array['fence_ack_at','fence_ack_by','admin_ack_at','admin_ack_by','admin_note'])<>(to_jsonb(old)-array['fence_ack_at','fence_ack_by','admin_ack_at','admin_ack_by','admin_note']))
   or(old.request_id is not null and new.request_id is distinct from old.request_id)
   or(old.admin_ack_at is not null and(new.admin_ack_at,new.admin_ack_by)is distinct from(old.admin_ack_at,old.admin_ack_by))
   or(old.fence_ack_at is not null and(new.fence_ack_at,new.fence_ack_by)is distinct from(old.fence_ack_at,old.fence_ack_by))
   or(old.overdue_at is not null and new.overdue_at is distinct from old.overdue_at)
  then raise exception using errcode='55000',message='LDL loop records are append-only';end if;
 end if;
 return new;
end$$;
create trigger ldl_responses_guard before update or delete on public.ldl_responses for each row execute function public._ldl_loop_guard();
create trigger ldl_retests_guard before update or delete on public.ldl_retests for each row execute function public._ldl_loop_guard();

alter table public.ldl_retests enable row level security;
alter table public.ldl_responses enable row level security;
alter table public.ldl_response_skips enable row level security;
-- No direct table access for browser roles: reads and writes go through the functions below.
revoke all on public.ldl_retests,public.ldl_responses,public.ldl_response_skips from public,anon,authenticated,service_role;

create function public._ldl_retest_json(r public.ldl_retests,p_doctor boolean)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',r.id,'dueFrom',r.due_from,'dueTo',r.due_to,'state',r.state,
  'overdue',r.state in('scheduled','requested','fenced')and r.due_to<public._ldl_today())
  ||case when p_doctor then jsonb_build_object('rule',r.rule,'anchorOn',r.anchor_on,'requestOn',r.request_on,'therapyId',r.therapy_id,'fenceReason',r.fence_reason,
   'requestStatus',(select q.status from public.patient_test_requests q where q.id=r.request_id),'createdAt',r.created_at,'closedAt',r.closed_at,
   'defaultsVersion',r.defaults_version)
  -- The member: the open LDL request itself (the provider's proposal or the confirmed arrangement), so the goal card can
  -- offer acceptance without the screening booking page, which needs a completed questionnaire (Astra LDLR-02).
  else jsonb_build_object('request',(select jsonb_build_object('id',q.id,'revision',q.revision,'status',q.status,'algorithmVersion',q.algorithm_version,
    'proposal',case when q.proposal is null then null else jsonb_build_object('provider',q.proposal->'provider','startsAt',q.proposal#>'{terms,startsAt}',
     'endsAt',q.proposal#>'{terms,endsAt}','preparation',q.proposal->'preparation')end,
    'arrangement',case when q.current_arrangement is null then null else jsonb_build_object('provider',q.current_arrangement->'provider',
     'startsAt',q.current_arrangement#>'{terms,startsAt}','endsAt',q.current_arrangement#>'{terms,endsAt}','preparation',q.current_arrangement->'preparation')end)
   from public.patient_test_requests q where q.id=r.request_id and q.user_id=r.member_id and q.status not in('cancelled','completed')))end
$$;

-- 3. Doctor: therapy commands with an optional re-test -------------------------------------------------------------
-- As 20261029171957, plus an optional "retest" key: null, or {dueFrom, dueTo, requestOn, rule, defaultsVersion}.
-- The re-test is anchored on the therapy's start date (today when unknown). Saving it supersedes the member's
-- open re-test; an open home-visit request of that re-test is kept for the new one.
create or replace function public.doctor_ldl_therapy_add(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare keys text[]:=array['version','memberId','submissionId','drug','other','dose','startedOn','maximallyTolerated','retest'];m uuid;sub uuid;d uuid;started date;other text;dose text;
 prior public.ldl_lipid_therapies;t public.ldl_lipid_therapies;rt jsonb;r_from date;r_to date;r_req date;anchor date;old public.ldl_retests;today date;
begin
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-keys<>'{}'or not(p_command?&array['version','memberId','submissionId','drug','dose','maximallyTolerated'])
  or p_command->>'version'is distinct from 'ldl-goal-v1'or jsonb_typeof(p_command->'maximallyTolerated')<>'boolean'
  or coalesce(jsonb_typeof(p_command->'retest'),'null')not in('object','null')then return jsonb_build_object('status','invalid');end if;
 rt:=nullif(p_command->'retest','null'::jsonb);
 if rt is not null and(rt-array['dueFrom','dueTo','requestOn','rule','defaultsVersion']<>'{}'or not(rt?&array['dueFrom','dueTo','requestOn','rule','defaultsVersion'])
  or rt->>'rule'not in('acs','other')or coalesce(rt->>'defaultsVersion','')!~'^[a-z0-9.-]{1,40}$')then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;started:=public._ldl_date(p_command,'startedOn');
  if rt is not null then r_from:=public._ldl_date(rt,'dueFrom');r_to:=public._ldl_date(rt,'dueTo');r_req:=public._ldl_date(rt,'requestOn');end if;
 exception when invalid_text_representation or invalid_parameter_value or datetime_field_overflow then return jsonb_build_object('status','invalid');end;
 d:=public._ldl_doctor_lock(m);
 if not public._ldl_goal_enabled()then return jsonb_build_object('status','disabled');end if;
 if rt is not null and not public._ldl_response_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.ldl_lipid_therapies where submission_id=sub;
 if found then return jsonb_build_object('status',case when prior.member_id=m then 'replayed' else 'stale' end);end if;
 other:=public._ldl_clean(p_command->>'other',80);dose:=public._ldl_clean(p_command->>'dose',60);today:=public._ldl_today();
 if dose is null or length(dose)>60 or length(other)>80 or((p_command->>'drug')='other')<>(other is not null)or started>today
  then return jsonb_build_object('status','invalid');end if;
 anchor:=coalesce(started,today);
 -- A window the form computed: after the change, open or still ahead, at most 8 weeks wide and a year out, and a
 -- request day from today to the end of the window.
 if rt is not null and(r_from is null or r_to is null or r_req is null or r_from<=anchor or r_to<r_from or r_to-r_from>56 or r_to<today
  or r_from>today+366 or r_req<today or r_req>r_to)then return jsonb_build_object('status','invalid');end if;
 insert into public.ldl_lipid_therapies(member_id,submission_id,drug,drug_other,dose,started_on,maximally_tolerated,recorded_by)
  values(m,sub,p_command->>'drug',other,dose,started,(p_command->>'maximallyTolerated')::boolean,d)returning * into t;
 if rt is not null then
  select * into old from public.ldl_retests where member_id=m and state in('scheduled','requested','fenced')for update;
  if found then update public.ldl_retests set state='superseded',closed_at=clock_timestamp(),closed_by=d where id=old.id;end if;
  insert into public.ldl_retests(member_id,therapy_id,rule,anchor_on,due_from,due_to,request_on,defaults_version,state,request_id,opened_at,created_by)
  values(m,t.id,rt->>'rule',anchor,r_from,r_to,r_req,rt->>'defaultsVersion',
   -- The open request of the superseded re-test carries over (still one blood draw to arrange).
   case when old.state='requested'and exists(select 1 from public.patient_test_requests q where q.id=old.request_id and q.status not in('cancelled','completed'))
    then 'requested'else 'scheduled'end,
   case when old.state='requested'and exists(select 1 from public.patient_test_requests q where q.id=old.request_id and q.status not in('cancelled','completed'))
    then old.request_id end,
   case when old.state='requested'and exists(select 1 from public.patient_test_requests q where q.id=old.request_id and q.status not in('cancelled','completed'))
    then clock_timestamp()end,d);
 end if;
 return jsonb_build_object('status','saved');
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation then return jsonb_build_object('status','invalid');
end$$;

-- As 20261029171957, plus: a therapy entered in error cancels the open re-test it created.
create or replace function public.doctor_ldl_therapy_end(p_member uuid,p_therapy uuid,p_reason text,p_stopped_on date)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;n int;
begin
 if p_reason not in('stopped','entered_in_error')or(p_reason='entered_in_error'and p_stopped_on is not null)then return jsonb_build_object('status','invalid');end if;
 d:=public._ldl_doctor_lock(p_member);
 if not public._ldl_goal_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_stopped_on>public._ldl_today()then return jsonb_build_object('status','invalid');end if;
 update public.ldl_lipid_therapies set ended_at=clock_timestamp(),ended_by=d,end_reason=p_reason,stopped_on=p_stopped_on
  where id=p_therapy and member_id=p_member and ended_at is null;
 get diagnostics n=row_count;
 if n=1 and p_reason='entered_in_error'then
  update public.ldl_retests set state='cancelled',closed_at=clock_timestamp(),closed_by=d
   where therapy_id=p_therapy and member_id=p_member and state in('scheduled','requested','fenced');
 end if;
 return jsonb_build_object('status',case when n=1 then 'saved' else 'not-found' end);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation then return jsonb_build_object('status','invalid');
end$$;

-- The doctor decides no re-test is needed after all. A home-visit request already created stays in the admin
-- queue (the admin cancels it with the member, as for any request).
create function public.doctor_ldl_retest_cancel(p_member uuid,p_retest uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;n int;
begin
 d:=public._ldl_doctor_lock(p_member);
 if not public._ldl_response_enabled()then return jsonb_build_object('status','disabled');end if;
 update public.ldl_retests set state='cancelled',closed_at=clock_timestamp(),closed_by=d
  where id=p_retest and member_id=p_member and state in('scheduled','requested','fenced');
 get diagnostics n=row_count;
 return jsonb_build_object('status',case when n=1 then 'saved' else 'not-found' end);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- 4. Reads: doctor and member ------------------------------------------------------------------------------------
-- As 20261029171957, plus the re-tests and responses while the loop is on.
create or replace function public.doctor_ldl_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._assigned_active_doctor(p_member);
 if not public._ldl_goal_enabled()then return jsonb_build_object('version','ldl-goal-v1','enabled',false);end if;
 perform public._access_audit_record(p_member,'ldl_goal',null);
 return jsonb_build_object('version','ldl-goal-v1','enabled',true,'today',(clock_timestamp()at time zone 'Asia/Yerevan')::date,
  'events',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'type',e.event_type,'other',e.event_other,'on',e.event_on,'source',e.source,
    'note',e.note,'recordedAt',e.recorded_at)order by e.event_on desc nulls last,e.recorded_at desc)
   from public.ldl_index_events e where e.member_id=p_member and e.removed_at is null),'[]'::jsonb),
  'therapies',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'drug',t.drug,'other',t.drug_other,'dose',t.dose,'startedOn',t.started_on,
    'maximallyTolerated',t.maximally_tolerated,'recordedAt',t.recorded_at,'endedAt',t.ended_at,'endReason',t.end_reason,'stoppedOn',t.stopped_on)
    order by t.ended_at desc nulls first,t.recorded_at desc)
   from public.ldl_lipid_therapies t where t.member_id=p_member and t.end_reason is distinct from 'entered_in_error'),'[]'::jsonb),
  'goals',coalesce((select jsonb_agg(public._ldl_goal_json(g,true)order by g.version desc)from public.ldl_goals g where g.member_id=p_member),'[]'::jsonb),
  'observations',public._ldl_observations(p_member,true),
  'loop',case when not public._ldl_response_enabled()then null else jsonb_build_object(
   'retests',coalesce((select jsonb_agg(public._ldl_retest_json(r,true)order by r.created_at desc)
    from(select * from public.ldl_retests r where r.member_id=p_member and r.state<>'superseded'order by r.created_at desc limit 10)r),'[]'::jsonb),
   'responses',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'observedOn',x.observed_on,'status',x.status,'createdAt',x.created_at,
     'closedAt',x.closed_at)order by x.created_at desc)
    from(select * from public.ldl_responses x where x.member_id=p_member order by x.created_at desc limit 10)x),'[]'::jsonb))end);
end$$;

-- As 20261029171957, plus (while the loop is on) the open or overdue re-test window and whether a result is with
-- the doctor. The member never sees the value of a result the doctor has not released.
create or replace function public.member_ldl_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();g public.ldl_goals;r public.ldl_retests;x public.ldl_responses;base jsonb;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not public._ldl_goal_enabled()then return jsonb_build_object('version','ldl-member-v1','enabled',false);end if;
 select * into g from public.ldl_goals where member_id=uid order by version desc limit 1;
 if g.id is null and not exists(select 1 from public.ldl_index_events where member_id=uid and removed_at is null)
  and not exists(select 1 from public.ldl_lipid_therapies where member_id=uid and end_reason is distinct from 'entered_in_error')
 then return jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',false);end if;
 base:=jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',true,
  'goal',case when g.id is null then null else public._ldl_goal_json(g,false)end,
  'observations',case when g.id is null then '[]'::jsonb else public._ldl_observations(uid,false)end);
 if not public._ldl_response_enabled()then return base;end if;
 select * into r from public.ldl_retests where member_id=uid and state in('scheduled','requested','fenced')order by created_at desc limit 1;
 select * into x from public.ldl_responses where member_id=uid and closed_at is null order by created_at desc limit 1;
 return base||jsonb_build_object('retest',case when r.id is null then null else public._ldl_retest_json(r,false)end,
  'withDoctor',case when x.id is null then null else jsonb_build_object('since',x.created_at,
   'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=x.doctor_id))end);
end$$;

-- 5. Service: the response check's inputs and its record -----------------------------------------------------------
-- The LDL values a doctor reviewed or released: verified clinic readings, doctor-approved uploads, and clinic or
-- laboratory results the doctor marked reviewed or that are published. Typed values never count.
create function public._ldl_response_observations(p_member uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(o order by o->>'on',o->>'id'),'[]'::jsonb)
 from jsonb_array_elements(public._ldl_observations(p_member,true))o
 where o->>'source'in('upload_checked','clinic_reviewed')
  or(o->>'source'='clinic_result'and((o->>'memberVisible')::boolean or exists(select 1 from public.patient_care_results c
   where c.id=substring(o->>'id' from 4)::uuid and c.user_id=p_member and c.reviewed_at is not null and c.reviewed_by is not null)))
$$;

-- ALT values a doctor reviewed or released, raw; lib/ldl/response.ts matches the name and converts the unit.
create function public._ldl_alt_observations(p_member uuid)returns jsonb language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(o order by o->>'on',o->>'id'),'[]'::jsonb)from(
  select jsonb_build_object('id','cr:'||c.id,'value',c.value,'unit',c.unit,'on',(c.collected_at at time zone 'Asia/Yerevan')::date,'name',c.marker)o
   from public.patient_care_results c
   where c.user_id=p_member and c.source in('clinic','laboratory')and c.collected_at<=clock_timestamp()
    and c.reviewed_at is not null and c.reviewed_by is not null
    and c.marker ~* '(^|[^a-z])(alt|alat|алт|алат|ալտ|ԱԼՏ)'
  union all
  select jsonb_build_object('id','la:'||v.id,'value',coalesce(v.corrected_value,v.value),'unit',coalesce(v.corrected_unit,v.unit),'on',v.collected_on,'name',v.test_name)
   from public.lab_ai_values v
   where v.user_id=p_member and v.catalogue_ref='alt'and v.status in('verified','corrected')and v.reviewed_by is not null
    and public._lab_ai_current(v.attachment_id)and coalesce(v.corrected_value,v.value)is not null and v.collected_on is not null
 )x
$$;

-- Plan and self-reported medicines with the ticks of the last p_days days, the member_medicines_staff_read shape
-- (20261018003827) without its staff check: lib/member-medicines/model.ts adherence() counts them.
create function public._ldl_medicine_facts(p_member uuid,p_days integer)returns jsonb language sql stable security definer set search_path=''as $$
 with w as(select(clock_timestamp()at time zone 'Asia/Yerevan')::date today),
  s as(select today,public._member_medicine_due(today-p_days+1,'00:00')since from w)
 select jsonb_build_object('today',s.today,'days',p_days,'now',clock_timestamp(),
  'self',coalesce((select jsonb_agg(public._member_medicine_json(m,s.since)order by m.stopped_at nulls first,m.created_at)
   from public.member_medicines m where m.user_id=p_member and(m.stopped_at is null or m.stopped_at>=s.since)),'[]'::jsonb),
  'plan',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'source','plan','name',m.name,'dose',m.dose,
    'effectiveAt',coalesce(m.effective_at,(select published_at from public.patient_care_plans where id=m.plan_id)),
    'times',(select jsonb_agg(to_char(t,'HH24:MI')order by t)from unnest(m.times)t),'startedOn',m.start_date,'endDate',m.end_date,
    'doses',coalesce((select jsonb_agg(jsonb_build_object('dueAt',e.due_at,'status',e.status,'recordedAt',e.recorded_at)order by e.due_at)
     from public.patient_dose_events e where e.user_id=p_member and e.medication_id=m.id and e.due_at>=s.since),'[]'::jsonb))order by m.name)
   from public._member_plan_medicines(p_member,s.today)m),'[]'::jsonb))
 from s
$$;

-- The response check starts after the change it follows: the open (or last) re-test's anchor day, otherwise the
-- day the first goal was set. Values on or before it never make a response, so switching the loop on does not
-- turn old results into inbox items.
create function public._ldl_response_floor(p_member uuid)returns date language sql stable security definer set search_path=''as $$
 select coalesce(
  (select r.anchor_on from public.ldl_retests r where r.member_id=p_member and r.state not in('cancelled','superseded')order by r.created_at desc limit 1),
  (select(min(g.set_at)at time zone 'Asia/Yerevan')::date from public.ldl_goals g where g.member_id=p_member))
$$;

-- Members with a reviewed LDL value after their floor that has no response yet, at most p_limit, with everything
-- the check needs. Service role only (the dispatcher sweep).
create function public.ldl_response_candidates(p_limit integer default 50)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare out jsonb;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._ldl_response_enabled()then return jsonb_build_object('version','ldl-response-v1','enabled',false);end if;
 if p_limit is null or p_limit not between 1 and 200 then raise invalid_parameter_value;end if;
 select coalesce(jsonb_agg(x order by x->>'memberId'),'[]')into out from(
  select jsonb_build_object('memberId',k.user_id,'floorOn',f.floor_on,'observations',o.obs,
   'goal',(select public._ldl_goal_json(g,false)from public.ldl_goals g where g.member_id=k.user_id order by g.version desc limit 1),
   'checked',coalesce((select jsonb_agg(x.observation_key)from public.ldl_responses x where x.member_id=k.user_id),'[]'::jsonb),
   'retestId',(select r.id from public.ldl_retests r where r.member_id=k.user_id and r.state in('scheduled','requested','fenced')),
   'alt',public._ldl_alt_observations(k.user_id),
   'medicines',public._ldl_medicine_facts(k.user_id,28))x
  from public.patient_clinical_cases k
  cross join lateral(select public._ldl_response_floor(k.user_id)floor_on)f
  cross join lateral(select public._ldl_response_observations(k.user_id)obs)o
  where k.assigned_doctor_id is not null and f.floor_on is not null
   -- Only a value newer than the floor and than every recorded response: an older one never becomes due again.
   and exists(select 1 from jsonb_array_elements(o.obs)e where(e->>'on')::date>greatest(f.floor_on,
     (select max(x.observed_on)from public.ldl_responses x where x.member_id=k.user_id))
    and not exists(select 1 from public.ldl_responses x where x.member_id=k.user_id and x.observation_key=e->>'id')
    and not exists(select 1 from public.ldl_response_skips x where x.member_id=k.user_id and x.observation_key=e->>'id'))
  order by k.user_id limit p_limit)q;
 return jsonb_build_object('version','ldl-response-v1','enabled',true,'today',public._ldl_today(),'members',out);
end$$;

-- Records one response: {version, memberId, observationKey, observedOn, status, facts}. The value must be one the
-- check may use, dated after the floor; a second record of the same value replays. The open re-test anchored before
-- the value is done. {status: saved | replayed | invalid | disabled | not-found | unavailable}.
create function public.ldl_response_record(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;k public.patient_clinical_cases;on_ date;x public.ldl_responses;r public.ldl_retests;floor_on date;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','memberId','observationKey','observedOn','status','facts']<>'{}'
  or not(p_command?&array['version','memberId','observationKey','observedOn','status','facts'])or p_command->>'version'is distinct from 'ldl-response-v1'
  or p_command->>'status'not in('at_goal','above_goal','not_assessable')or jsonb_typeof(p_command->'facts')<>'object'
  or coalesce(p_command->>'observationKey','')!~'^(cr|la|mr):[0-9a-f-]{36}$'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;on_:=public._ldl_date(p_command,'observedOn');
 exception when invalid_text_representation or invalid_parameter_value or datetime_field_overflow then return jsonb_build_object('status','invalid');end;
 if not public._ldl_response_enabled()then return jsonb_build_object('status','disabled');end if;
 perform set_config('lock_timeout','1500ms',true);
 select * into k from public.patient_clinical_cases where user_id=m for update;
 if not found or k.assigned_doctor_id is null then return jsonb_build_object('status','not-found');end if;
 select * into x from public.ldl_responses where member_id=m and observation_key=p_command->>'observationKey';
 if found then return jsonb_build_object('status','replayed');end if;
 floor_on:=public._ldl_response_floor(m);
 if on_ is null or floor_on is null or on_<=floor_on or not exists(select 1 from jsonb_array_elements(public._ldl_response_observations(m))e
  where e->>'id'=p_command->>'observationKey'and(e->>'on')::date=on_)then return jsonb_build_object('status','invalid');end if;
 select * into r from public.ldl_retests where member_id=m and state in('scheduled','requested','fenced')for update;
 insert into public.ldl_responses(member_id,observation_key,observed_on,status,facts,doctor_id,retest_id)
  values(m,p_command->>'observationKey',on_,p_command->>'status',p_command->'facts',k.assigned_doctor_id,case when r.anchor_on<on_ then r.id end)
  returning * into x;
 if r.id is not null and r.anchor_on<on_ then
  update public.ldl_retests set state='done',response_id=x.id,closed_at=clock_timestamp()where id=r.id;
 end if;
 return jsonb_build_object('status','saved','responseId',x.id);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation then return jsonb_build_object('status','invalid');
end$$;

-- Marks reviewed values the check could not use, so they are not offered again. Only keys of the member's own
-- reviewed values; returns how many were new.
create function public.ldl_response_skip(p_member uuid,p_keys text[])returns integer
language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._ldl_response_enabled()or p_keys is null or cardinality(p_keys)>200 then return 0;end if;
 insert into public.ldl_response_skips(member_id,observation_key)
  select p_member,k from unnest(p_keys)k
  where exists(select 1 from jsonb_array_elements(public._ldl_response_observations(p_member))e where e->>'id'=k)
  on conflict do nothing;
 get diagnostics n=row_count;
 return n;
end$$;

-- 6. The sweep -------------------------------------------------------------------------------------------------------
create function public._ldl_retest_requirement()returns jsonb language sql immutable set search_path=''as $$
 -- lib/ldl/retest.ts LDL_RETEST_REQUIREMENT, word for word: the booking code checks it against this.
 select jsonb_build_object('id','ldl-retest-lipid-panel','title','Lipid panel (LDL cholesterol) after a change to lipid treatment','method','lab')
$$;

-- The LDL eligibility contract, the same rule the app applies at confirm and accept (lib/ldl/retest.ts ldlRetestHold):
-- a verified member (confirmed phone) with consent recorded and no urgent hold. A completed screening questionnaire is
-- not required: the assigned doctor ordered this test. (A crisis-range reading is checked by the app at confirm and
-- accept, from the same evidence, before anything is arranged.)
create function public._ldl_retest_eligible(p_member uuid)returns boolean language sql stable security definer set search_path=''as $$
 select exists(select 1 from auth.users u where u.id=p_member and u.phone_confirmed_at is not null)
  and coalesce((select(c->'data'->'consent')is not null and c->'data'->'consent'<>'null'::jsonb and(c#>>'{data,assessment,urgent_rule}')is null
   from(select public.patient_test_context(p_member)c)x),false)
$$;

-- Creates the home-visit request for a scheduled or fenced re-test, or reports why not: 'fenced' (an open visit or
-- request already exists, or the member is not eligible yet; the next sweep tries again, so a cleared fence recovers
-- by itself, Astra LDLR-01) or 'busy' (the member's case is locked: next sweep).
create function public._ldl_retest_open(r public.ldl_retests,p_now timestamptz)returns text
language plpgsql security definer set search_path=''as $$
declare rid uuid:=gen_random_uuid();terms jsonb;req jsonb:=jsonb_build_array(public._ldl_retest_requirement());payload jsonb;q public.patient_test_requests;
 day date:=greatest(r.due_from,(p_now at time zone 'Asia/Yerevan')::date+1);token text;why text;
begin
 perform 1 from public.patient_clinical_cases where user_id=r.member_id for update skip locked;
 if not found then return 'busy';end if;
 why:=case
  when exists(select 1 from public.patient_test_requests x where x.user_id=r.member_id and x.status not in('cancelled','completed'))
   or exists(select 1 from public.booking_appointments a where a.member_id=r.member_id and public._booking_visit_open(a))then 'open_visit'
  when not public._ldl_retest_eligible(r.member_id)then 'not_eligible'end;
 if why is not null then
  if r.state is distinct from 'fenced'or r.fence_reason is distinct from why then
   update public.ldl_retests set state='fenced',fence_reason=why,opened_at=coalesce(opened_at,p_now)where id=r.id;
  end if;
  return 'fenced';
 end if;
 -- A morning preference on the first day of the window (or tomorrow); the admin agrees the real time with the member.
 terms:=jsonb_build_object('startsAt',to_char(((day+time '09:00')at time zone 'Asia/Yerevan')at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'endsAt',to_char(((day+time '13:00')at time zone 'Asia/Yerevan')at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'timezone','Asia/Yerevan','mode','home','location','Member''s home: confirm the address with the member');
 token:=public.patient_test_context(r.member_id)->>'requirementsToken';
 payload:=jsonb_build_object('contextToken',token,'terms',terms,'requirements',req,'algorithmVersion','ldl-retest-v1','ldlRetestId',r.id);
 insert into public.patient_test_requests(id,user_id,requested_terms,requirements,algorithm_version,context_token,create_payload)
  values(rid,r.member_id,terms,req,'ldl-retest-v1',token,payload)returning * into q;
 insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
  values(rid,rid,r.created_by,0,'create',payload,public.patient_test_request_dto(q));
 update public.ldl_retests set state='requested',fence_reason=null,request_id=rid,opened_at=coalesce(opened_at,p_now)where id=r.id;
 return 'requested';
end$$;

-- An LDL request's requirement is the doctor's order, not the screening questionnaire's, so its requirements token is
-- kept current: a questionnaire, consent or profile change after creation must not leave it unconfirmable (Astra
-- LDLR-02). Only open LDL requests of open re-tests; the booking commands still check every other condition.
create function public._ldl_request_refresh()returns integer language plpgsql security definer set search_path=''as $$
declare n integer;
begin
 update public.patient_test_requests q set context_token=public.patient_test_context(q.user_id)->>'requirementsToken'
  from public.ldl_retests r
  where r.request_id=q.id and r.state='requested'and q.algorithm_version='ldl-retest-v1'and q.status not in('cancelled','completed')
   and q.context_token is distinct from public.patient_test_context(q.user_id)->>'requirementsToken';
 get diagnostics n=row_count;
 return n;
end$$;

-- Called by the dispatcher sweep after the response check (lib/ldl/response.ts). Outside quiet hours: opens re-tests
-- whose request day has come, marks overdue ones (the day after the window) and sends the member notices, each once
-- (the event key), retrying a notice the sweep could not decide for up to two days. p_now is for tests.
create function public.ldl_response_run(p_now timestamptz default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare nowt timestamptz:=coalesce(p_now,clock_timestamp());lt timestamp;today date;r public.ldl_retests;x public.ldl_responses;
 opened int:=0;fenced int:=0;overdue int:=0;told int:=0;res text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not public._ldl_response_enabled()then return jsonb_build_object('ok',true,'state','off');end if;
 if not pg_try_advisory_xact_lock(hashtextextended('ldl-response-run',0))then return jsonb_build_object('ok',true,'state','busy');end if;
 lt:=nowt at time zone 'Asia/Yerevan';today:=lt::date;
 if lt::time>='21:00'or lt::time<'09:00'then return jsonb_build_object('ok',true,'state','quiet_hours');end if;
 perform set_config('noreon.member_notice_sweep','on',true);
 -- Scheduled re-tests on their request day, and fenced ones again (also after the window: the draw is still needed).
 for r in select * from public.ldl_retests where state in('scheduled','fenced')and request_on<=today order by request_on,id for update skip locked loop
  res:=public._ldl_retest_open(r,nowt);
  if res='requested'then opened:=opened+1;elsif res='fenced'then fenced:=fenced+1;end if;
 end loop;
 perform public._ldl_request_refresh();
 for r in select * from public.ldl_retests where state in('scheduled','requested','fenced')and due_to<today and overdue_at is null order by due_to,id for update skip locked loop
  update public.ldl_retests set overdue_at=nowt where id=r.id;
  overdue:=overdue+1;
 end loop;
 -- Notices: the request (or fenced) day, overdue, and a response. Each decided once by its event key; only while the
 -- care group is on, so a switched-off group is not traced every five minutes (as programme_run).
 if coalesce((select care from public.member_notice_settings where singleton),false)then
 for r in select t.* from public.ldl_retests t where t.opened_at>nowt-interval '2 days'and t.state in('requested','fenced')
  and not exists(select 1 from public.member_notices n where n.event_key='ldl.retest_due:'||t.id::text)loop
  -- The first day of the window as {date} (the notice params allow date and time only; the time is not used).
  perform public._member_notice_safe(r.member_id,'care','member.ldl_retest_due','ldl.retest_due:'||r.id::text,
   public._member_notice_when((greatest(r.due_from,(nowt at time zone 'Asia/Yerevan')::date)+time '12:00')at time zone 'Asia/Yerevan',
    public._telegram_auth_locale(r.member_id)),'/patient/progress','open_progress');
 end loop;
 for r in select t.* from public.ldl_retests t where t.overdue_at>nowt-interval '2 days'and t.state in('scheduled','requested','fenced')
  and not exists(select 1 from public.member_notices n where n.event_key='ldl.retest_overdue:'||t.id::text)loop
  perform public._member_notice_safe(r.member_id,'care','member.ldl_retest_overdue','ldl.retest_overdue:'||r.id::text,'{}','/patient/progress','open_progress');
 end loop;
 for x in select t.* from public.ldl_responses t where t.created_at>nowt-interval '2 days'
  and not exists(select 1 from public.member_notices n where n.event_key='ldl.result_with_doctor:'||t.id::text)loop
  -- No name or result in the notice (member notices carry dates, times, clinic and nurse only); the app names the doctor.
  perform public._member_notice_safe(x.member_id,'care','member.ldl_result_with_doctor','ldl.result_with_doctor:'||x.id::text,'{}','/patient/progress','open_progress');
  told:=told+1;
 end loop;
 end if;
 perform set_config('noreon.member_notice_sweep','off',true);
 return jsonb_build_object('ok',true,'state','ran','opened',opened,'fenced',fenced,'overdue',overdue,'responses',told);
end$$;

-- 7. Doctor: the inbox items -----------------------------------------------------------------------------------------
-- Open responses of the doctor's assigned members, oldest first, at most 200; above goal first. The Today page's
-- own section (components/doctor-inbox/ldl-responses.tsx). Each member shown is recorded in access_audit.
create function public.doctor_ldl_responses()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;items jsonb;
begin
 if who is null or who->>'role'is distinct from 'doctor'then raise insufficient_privilege using message='Assigned doctor session required';end if;
 if not public._ldl_response_enabled()then return jsonb_build_object('version','ldl-response-v1','enabled',false);end if;
 me:=(who->>'id')::uuid;
 select coalesce(jsonb_agg(x order by(x->>'status'<>'above_goal'),x->>'createdAt',x->>'id'),'[]')into items from(
  select jsonb_build_object('id',r.id,'memberId',r.member_id,'memberName',coalesce(pr.display_name,''),'observedOn',r.observed_on,'status',r.status,
   'facts',r.facts,'createdAt',r.created_at)x
  from public.ldl_responses r join public.patient_clinical_cases k on k.user_id=r.member_id
  left join public.profiles pr on pr.id=r.member_id
  where r.closed_at is null and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true)
  order by(r.status<>'above_goal'),r.created_at,r.id limit 200)q;
 perform public._access_audit_record(m,'doctor_inbox','ldl_responses')from(select distinct(x->>'memberId')::uuid m from jsonb_array_elements(items)x)q;
 return jsonb_build_object('version','ldl-response-v1','enabled',true,'items',items);
end$$;

-- The assigned doctor marks the result reviewed (they decided the next step and told the member).
create function public.doctor_ldl_response_close(p_response uuid,p_note text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare x public.ldl_responses;d uuid;note text:=public._ldl_clean(p_note,500);
begin
 select * into x from public.ldl_responses where id=p_response;
 if not found then raise insufficient_privilege using message='Assigned doctor session required';end if;
 d:=public._ldl_doctor_lock(x.member_id);
 if not public._ldl_response_enabled()then return jsonb_build_object('status','disabled');end if;
 if length(note)>500 then return jsonb_build_object('status','invalid');end if;
 update public.ldl_responses set closed_at=clock_timestamp(),closed_by=d,close_note=note where id=p_response and closed_at is null;
 return jsonb_build_object('status',case when found then 'saved' else 'replayed' end);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- 8. Admin: overdue and fenced re-tests ------------------------------------------------------------------------------
-- Re-tests the admin must act on: overdue (the window passed without a result) until the overdue item is acknowledged,
-- or fenced (an open visit or request, or the member is not eligible yet) until the fence is acknowledged. The two
-- acknowledgements are separate, so handling a fence never hides a later overdue item.
create function public.admin_ldl_retests()returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();items jsonb;
begin
 if who is null or who->>'role'is distinct from 'admin'then raise insufficient_privilege using message='Admin session required';end if;
 if not public._ldl_response_enabled()then return jsonb_build_object('version','ldl-response-v1','enabled',false);end if;
 select coalesce(jsonb_agg(x order by x->>'dueTo',x->>'id'),'[]')into items from(
  select public._ldl_retest_json(r,true)||jsonb_build_object('memberId',r.member_id,'memberName',coalesce(pr.display_name,''),'overdueAt',r.overdue_at,
   'kind',case when r.overdue_at is not null and r.admin_ack_at is null then 'overdue'else 'fenced'end,
   'doctorName',(select s.display_name from public.workspace_staff s join public.patient_clinical_cases k on k.assigned_doctor_id=s.user_id where k.user_id=r.member_id))x
  from public.ldl_retests r left join public.profiles pr on pr.id=r.member_id
  where r.state in('scheduled','requested','fenced')
   and((r.overdue_at is not null and r.admin_ack_at is null)or(r.state='fenced'and r.fence_ack_at is null))
  order by r.due_to,r.id limit 200)q;
 perform public._access_audit_record(m,'admin_ldl_retests',null)from(select distinct(x->>'memberId')::uuid m from jsonb_array_elements(items)x)q;
 return jsonb_build_object('version','ldl-response-v1','enabled',true,'items',items);
end$$;

create function public.admin_ldl_retest_ack(p_retest uuid,p_note text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();note text:=public._ldl_clean(p_note,500);
begin
 if who is null or who->>'role'is distinct from 'admin'then raise insufficient_privilege using message='Admin session required';end if;
 if not public._ldl_response_enabled()then return jsonb_build_object('status','disabled');end if;
 if length(note)>500 then return jsonb_build_object('status','invalid');end if;
 -- The item the admin sees: the overdue one first, else the fence.
 update public.ldl_retests set admin_ack_at=clock_timestamp(),admin_ack_by=(who->>'id')::uuid,admin_note=coalesce(note,admin_note)
  where id=p_retest and state in('scheduled','requested','fenced')and overdue_at is not null and admin_ack_at is null;
 if found then return jsonb_build_object('status','saved');end if;
 update public.ldl_retests set fence_ack_at=clock_timestamp(),fence_ack_by=(who->>'id')::uuid,admin_note=coalesce(note,admin_note)
  where id=p_retest and state='fenced'and fence_ack_at is null;
 return jsonb_build_object('status',case when found then 'saved' else 'not-found' end);
end$$;

-- 9. Wording (v1 placeholders, held at claim until approved; hy and en, the template table's locales). As every member
-- notice: no health content (check-member-notifications.sql), and only the date placeholder.
insert into public.system_message_templates(template_id,version,locale,body)values
 ('member.ldl_retest_due',1,'en','UNAPPROVED PLACEHOLDER. Your doctor asked for a follow-up blood test from {date}. Our team will call you to arrange a nurse visit at home.'),
 ('member.ldl_retest_due',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր բժիշկը խնդրել է հանձնել կրկնակի արյան անալիզ՝ սկսած {date}-ից։ Մեր թիմը կզանգի ձեզ՝ բուժքրոջ տնային այց կազմակերպելու համար։'),
 ('member.ldl_retest_overdue',1,'en','UNAPPROVED PLACEHOLDER. Your follow-up blood test is still to do. Our team will call you to find a time. You can also see the details in Noreon.'),
 ('member.ldl_retest_overdue',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր կրկնակի արյան անալիզը դեռ հանձնված չէ։ Մեր թիմը կզանգի ձեզ՝ հարմար ժամ գտնելու համար։ Մանրամասները կարող եք տեսնել Noreon-ում։'),
 ('member.ldl_result_with_doctor',1,'en','UNAPPROVED PLACEHOLDER. Your new test result is with your doctor. They will tell you the next step.'),
 ('member.ldl_result_with_doctor',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր նոր անալիզի արդյունքը ձեր բժշկի մոտ է։ Բժիշկը ձեզ կտեղեկացնի հաջորդ քայլի մասին։');

-- 10. Grants: functions only -------------------------------------------------------------------------------------------
revoke all on function public._ldl_response_enabled(),public._ldl_loop_guard(),public._ldl_retest_json(public.ldl_retests,boolean),
 public.doctor_ldl_retest_cancel(uuid,uuid),public._ldl_response_observations(uuid),public._ldl_alt_observations(uuid),public._ldl_medicine_facts(uuid,integer),
 public._ldl_response_floor(uuid),public.ldl_response_candidates(integer),public.ldl_response_record(jsonb),public._ldl_retest_requirement(),
 public._ldl_retest_open(public.ldl_retests,timestamptz),public.ldl_response_run(timestamptz),public.doctor_ldl_responses(),
 public.doctor_ldl_response_close(uuid,text),public.admin_ldl_retests(),public.admin_ldl_retest_ack(uuid,text),
 public._ldl_retest_eligible(uuid),public._ldl_request_refresh(),public.ldl_response_skip(uuid,text[])
 from public,anon,authenticated,service_role;
grant execute on function public.doctor_ldl_retest_cancel(uuid,uuid),public.doctor_ldl_responses(),public.doctor_ldl_response_close(uuid,text),
 public.admin_ldl_retests(),public.admin_ldl_retest_ack(uuid,text)to authenticated;
grant execute on function public.ldl_response_candidates(integer),public.ldl_response_record(jsonb),public.ldl_response_run(timestamptz),public.ldl_response_skip(uuid,text[])to service_role;
-- create or replace keeps the grants of doctor_ldl_read, member_ldl_read, doctor_ldl_therapy_add and doctor_ldl_therapy_end.
