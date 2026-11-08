-- LDL-to-goal pilot, phase 1 (founders 29 Oct 2026; output/ldl-pivot-2026-10-29/FABLE_REPORT.md §2-3).
--
-- The pilot is members after a heart attack, ischaemic stroke or TIA. This adds the doctor's LDL record
-- for a member and nothing else:
--   1. ldl_goal_settings.ldl_goal_enabled, off by default. Off: every read says disabled and every write is refused.
--   2. ldl_index_events: the event (type, date or unknown, source), recorded by the assigned doctor.
--   3. ldl_lipid_therapies: current lipid therapy (drug, dose, start date, and the doctor-only
--      "maximally tolerated" flag). Ended, never edited.
--   4. ldl_goals: the LDL goal, one immutable row per version (category, threshold mmol/L, whether the
--      reduction rule applies, the baseline with its kind, source and date or "unknown", who, why, when).
--   5. _ldl_observations: LDL values that already exist, read in place. No second LDL store:
--      member_reported_values (typed, uploaded, doctor-approved uploads; the member-visibility rule of
--      20261021070050 applies), patient_care_results (clinic and laboratory results; the member sees only
--      published ones, as own_published_care_results) and, for the doctor only, lab_ai_values the doctor
--      verified or corrected. Each value says whether the member can see it.
--
-- Every clinical default (category thresholds, the 50% rule, what "at goal" means, which values count) lives
-- in lib/ldl/constants.ts, pending Armen and Yesayi. The database stores what the doctor confirmed and
-- computes nothing: lib/ldl/status.ts does, from what these reads return.
--
-- The member sees nothing until the doctor has recorded an event, a therapy or a goal (the member is then
-- in the LDL pathway: "your doctor is setting your goal"), and sees the goal only once the doctor has set it.
-- The member never sees the event, the therapy or the "maximally tolerated" flag.
--
-- Readers and writers: the assigned active doctor in an admitted staff session (_assigned_active_doctor).
-- Nurses and admins get nothing here. Each successful doctor read is recorded in access_audit.

-- 1. Switch ---------------------------------------------------------------------------------------------------
create table public.ldl_goal_settings(
 singleton boolean primary key default true check(singleton),
 ldl_goal_enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.ldl_goal_settings(singleton)values(true);
create trigger ldl_goal_settings_config_audit after insert or update or delete on public.ldl_goal_settings
 for each row execute function public._config_audit_row('singleton','updated_at');
create function public._ldl_goal_enabled()returns boolean language sql stable security definer set search_path=''as $$
 select coalesce((select ldl_goal_enabled from public.ldl_goal_settings where singleton),false)
$$;

-- 2. Records -----------------------------------------------------------------------------------------------------
create table public.ldl_index_events(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 submission_id uuid not null unique,
 event_type text not null check(event_type in('acs_mi','ischaemic_stroke','tia','other')),
 event_other text check(length(event_other)between 1 and 120),
 -- Null: the doctor does not know the date.
 event_on date check(event_on>=date '1950-01-01'),
 source text not null check(source in('document','doctor_entered')),
 note text check(length(note)between 1 and 300),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 removed_at timestamptz,
 removed_by uuid references auth.users(id),
 check((event_type='other')=(event_other is not null)),
 check((removed_at is null)=(removed_by is null))
);
create index ldl_index_events_member on public.ldl_index_events(member_id,recorded_at desc);

create table public.ldl_lipid_therapies(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 submission_id uuid not null unique,
 drug text not null check(drug in('atorvastatin','rosuvastatin','simvastatin','pravastatin','pitavastatin','fluvastatin',
  'ezetimibe','evolocumab','alirocumab','inclisiran','bempedoic_acid','other')),
 drug_other text check(length(drug_other)between 1 and 80),
 dose text not null check(length(dose)between 1 and 60),
 -- Null: the start date is not known.
 started_on date check(started_on>=date '1950-01-01'),
 -- Doctor only: never in a member read.
 maximally_tolerated boolean not null default false,
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp(),
 ended_at timestamptz,
 ended_by uuid references auth.users(id),
 end_reason text check(end_reason in('stopped','entered_in_error')),
 stopped_on date,
 check((drug='other')=(drug_other is not null)),
 check((ended_at is null)=(ended_by is null)and(ended_at is null)=(end_reason is null)),
 check(stopped_on is null or end_reason='stopped'),
 check(stopped_on is null or started_on is null or stopped_on>=started_on)
);
create index ldl_lipid_therapies_member on public.ldl_lipid_therapies(member_id,recorded_at desc);

create table public.ldl_goals(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 version int not null check(version>=1),
 submission_id uuid not null unique,
 category text not null check(category in('very_high','high','moderate','low')),
 threshold_mmol numeric(3,1)not null check(threshold_mmol between 0.5 and 5.0),
 reduction_rule boolean not null,
 reduction_pct smallint check(reduction_pct between 10 and 90),
 -- pre_treatment: a documented value from before lipid-lowering treatment (the only kind a % reduction is
 -- computed from); on_treatment: a value already on treatment (shown, never used for a %); unknown: none.
 baseline_kind text not null check(baseline_kind in('pre_treatment','on_treatment','unknown')),
 baseline_mmol numeric(4,2)check(baseline_mmol between 0.2 and 15),
 baseline_on date check(baseline_on>=date '1950-01-01'),
 baseline_source text check(baseline_source in('document','lab_result','doctor_entered')),
 next_test_on date,
 reason text check(length(reason)between 1 and 500),
 -- The lib/ldl/constants.ts defaults the doctor saw when confirming (audit of what the form proposed).
 defaults_version text not null check(defaults_version ~ '^[a-z0-9.-]{1,40}$'),
 set_by uuid not null references auth.users(id),
 set_at timestamptz not null default clock_timestamp(),
 unique(member_id,version),
 check(reduction_rule=(reduction_pct is not null)),
 check((baseline_kind='unknown')=(baseline_mmol is null)),
 check((baseline_mmol is null)=(baseline_on is null)and(baseline_mmol is null)=(baseline_source is null)),
 check(version=1 or reason is not null)
);
create trigger ldl_goals_immutable before update or delete on public.ldl_goals for each row execute function public._patient_visit_immutable();

-- Events are only marked removed, therapies only ended, once; nothing is deleted.
create function public._ldl_record_guard()returns trigger language plpgsql set search_path=''as $$
begin
 if tg_op='DELETE' then raise exception using errcode='55000',message='LDL records are append-only';end if;
 if tg_table_name='ldl_index_events' then
  if old.removed_at is not null or new.removed_at is null
   or(to_jsonb(new)-array['removed_at','removed_by'])<>(to_jsonb(old)-array['removed_at','removed_by'])
  then raise exception using errcode='55000',message='LDL records are append-only';end if;
 else
  if old.ended_at is not null or new.ended_at is null
   or(to_jsonb(new)-array['ended_at','ended_by','end_reason','stopped_on'])<>(to_jsonb(old)-array['ended_at','ended_by','end_reason','stopped_on'])
  then raise exception using errcode='55000',message='LDL records are append-only';end if;
 end if;
 return new;
end$$;
create trigger ldl_index_events_guard before update or delete on public.ldl_index_events for each row execute function public._ldl_record_guard();
create trigger ldl_lipid_therapies_guard before update or delete on public.ldl_lipid_therapies for each row execute function public._ldl_record_guard();

alter table public.ldl_goal_settings enable row level security;
alter table public.ldl_index_events enable row level security;
alter table public.ldl_lipid_therapies enable row level security;
alter table public.ldl_goals enable row level security;
-- No direct table access for browser roles: reads and writes go through the functions below.
revoke all on public.ldl_goal_settings,public.ldl_index_events,public.ldl_lipid_therapies,public.ldl_goals from public,anon,authenticated,service_role;

-- 3. Existing LDL values, read in place ---------------------------------------------------------------------------
-- Raw value and unit; lib/ldl/status.ts converts, checks plausibility, matches printed names against the lab
-- catalogue and removes duplicates. p_doctor adds the doctor-reviewed clinic readings the member cannot see yet.
create function public._ldl_observations(p_member uuid,p_doctor boolean)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(o order by o->>'on',o->>'id'),'[]'::jsonb)from(
  select jsonb_build_object('id','mr:'||v.id,'value',v.value,'unit',v.unit,'on',v.measured_on,
    'source',case when v.source='doctor_approved'then 'upload_checked' else 'member' end,'name',null,'memberVisible',true)o
   from public.member_reported_values v
   where v.user_id=p_member and v.measure='ldl_c'
    and(v.ai_value_id is null or public._member_upload_value_member_visible(v.ai_value_id,v.source))
  union all
  select jsonb_build_object('id','cr:'||r.id,'value',r.value,'unit',r.unit,'on',(r.collected_at at time zone 'Asia/Yerevan')::date,
    'source','clinic_result','name',r.marker,'memberVisible',r.published)
   from(select c.*,(c.reviewed_at is not null and c.reviewed_by is not null and exists(select 1 from public.patient_care_plans p
     where p.id=c.publication_plan_id and p.user_id=c.user_id and p.published_at<=clock_timestamp()))as published
    from public.patient_care_results c where c.user_id=p_member)r
   -- The member: published results only, the own_published_care_results rule (20261009164942). The doctor: all.
   where r.source in('clinic','laboratory')and r.collected_at<=clock_timestamp()and(p_doctor or r.published)
    -- Prefilter only (VLDL excluded); the name is matched against the catalogue in code.
    and r.marker ~* '(^|[^a-z])(ldl|лпнп|ЛПНП|ցխլպ|ՑԽԼՊ)'
  union all
  select jsonb_build_object('id','la:'||v.id,'value',coalesce(v.corrected_value,v.value),'unit',coalesce(v.corrected_unit,v.unit),'on',v.collected_on,
    'source','clinic_reviewed','name',v.test_name,'memberVisible',false)
   from public.lab_ai_values v
   -- The _lab_ai_verified_values rule: reviewed, and the attachment still current (not detached or moved to another member).
   where p_doctor and v.user_id=p_member and v.catalogue_ref='ldl_c'and v.status in('verified','corrected')and v.reviewed_by is not null
    and public._lab_ai_current(v.attachment_id)and coalesce(v.corrected_value,v.value)is not null and v.collected_on is not null
 )x
$$;

create function public._ldl_goal_json(g public.ldl_goals,p_doctor boolean)returns jsonb language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version',g.version,'category',g.category,'thresholdMmol',g.threshold_mmol,'reductionRule',g.reduction_rule,
  'reductionPct',g.reduction_pct,'baseline',jsonb_build_object('kind',g.baseline_kind,'mmol',g.baseline_mmol,'on',g.baseline_on,'source',g.baseline_source),
  'nextTestOn',g.next_test_on,'setAt',g.set_at,'doctorName',(select s.display_name from public.workspace_staff s where s.user_id=g.set_by))
  ||case when p_doctor then jsonb_build_object('reason',g.reason,'defaultsVersion',g.defaults_version,'byYou',g.set_by=auth.uid())else '{}'::jsonb end
$$;

-- 4. Doctor: read --------------------------------------------------------------------------------------------------
create function public.doctor_ldl_read(p_member uuid)returns jsonb
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
  'observations',public._ldl_observations(p_member,true));
end$$;

-- 5. Doctor: writes ------------------------------------------------------------------------------------------------
-- Each command is a strict object with a submission id; resending the same submission returns its outcome.
-- Returns {status}: saved | replayed | stale | invalid | disabled | not-found | unavailable. Access raises 42501.
create function public._ldl_clean(p text,p_max int)returns text language sql immutable set search_path=''as $$
 select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p,''),'[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]',' ','g'),'[ ]+',' ','g')),p_max+1),'')
$$;
create function public._ldl_today()returns date language sql stable set search_path=''as $$
 select(clock_timestamp()at time zone 'Asia/Yerevan')::date
$$;
-- Locks the member's case, then checks the doctor against what is committed now (same order as the first note).
create function public._ldl_doctor_lock(p_member uuid)returns uuid language plpgsql security definer set search_path=''as $$
begin
 perform set_config('lock_timeout','1500ms',true);
 perform 1 from public.patient_clinical_cases where user_id=p_member for update;
 perform 1 from public.workspace_staff where user_id=auth.uid()for share;
 return public._assigned_active_doctor(p_member);
end$$;
create function public._ldl_date(p jsonb,k text)returns date language plpgsql immutable set search_path=''as $$
begin
 if p->k is null or jsonb_typeof(p->k)='null' then return null;end if;
 if jsonb_typeof(p->k)<>'string'or p->>k!~'^\d{4}-\d{2}-\d{2}$'then raise invalid_parameter_value;end if;
 return(p->>k)::date;
end$$;

create function public.doctor_ldl_event_add(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare keys text[]:=array['version','memberId','submissionId','type','other','on','source','note'];m uuid;sub uuid;d uuid;on_ date;other text;note text;prior public.ldl_index_events;
begin
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-keys<>'{}'or not(p_command?&array['version','memberId','submissionId','type','source'])
  or p_command->>'version'is distinct from 'ldl-goal-v1'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;on_:=public._ldl_date(p_command,'on');
 exception when invalid_text_representation or invalid_parameter_value or datetime_field_overflow then return jsonb_build_object('status','invalid');end;
 d:=public._ldl_doctor_lock(m);
 if not public._ldl_goal_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.ldl_index_events where submission_id=sub;
 if found then return jsonb_build_object('status',case when prior.member_id=m then 'replayed' else 'stale' end);end if;
 other:=public._ldl_clean(p_command->>'other',120);note:=public._ldl_clean(p_command->>'note',300);
 if p_command->>'type'not in('acs_mi','ischaemic_stroke','tia','other')or p_command->>'source'not in('document','doctor_entered')
  or((p_command->>'type')='other')<>(other is not null)or length(other)>120 or length(note)>300
  or on_>public._ldl_today()then return jsonb_build_object('status','invalid');end if;
 insert into public.ldl_index_events(member_id,submission_id,event_type,event_other,event_on,source,note,recorded_by)
  values(m,sub,p_command->>'type',other,on_,p_command->>'source',note,d);
 return jsonb_build_object('status','saved');
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation then return jsonb_build_object('status','invalid');
end$$;

create function public.doctor_ldl_event_remove(p_member uuid,p_event uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;n int;
begin
 d:=public._ldl_doctor_lock(p_member);
 if not public._ldl_goal_enabled()then return jsonb_build_object('status','disabled');end if;
 update public.ldl_index_events set removed_at=clock_timestamp(),removed_by=d where id=p_event and member_id=p_member and removed_at is null;
 get diagnostics n=row_count;
 return jsonb_build_object('status',case when n=1 then 'saved' else 'not-found' end);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

create function public.doctor_ldl_therapy_add(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare keys text[]:=array['version','memberId','submissionId','drug','other','dose','startedOn','maximallyTolerated'];m uuid;sub uuid;d uuid;started date;other text;dose text;prior public.ldl_lipid_therapies;
begin
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-keys<>'{}'or not(p_command?&array['version','memberId','submissionId','drug','dose','maximallyTolerated'])
  or p_command->>'version'is distinct from 'ldl-goal-v1'or jsonb_typeof(p_command->'maximallyTolerated')<>'boolean'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;started:=public._ldl_date(p_command,'startedOn');
 exception when invalid_text_representation or invalid_parameter_value or datetime_field_overflow then return jsonb_build_object('status','invalid');end;
 d:=public._ldl_doctor_lock(m);
 if not public._ldl_goal_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.ldl_lipid_therapies where submission_id=sub;
 if found then return jsonb_build_object('status',case when prior.member_id=m then 'replayed' else 'stale' end);end if;
 other:=public._ldl_clean(p_command->>'other',80);dose:=public._ldl_clean(p_command->>'dose',60);
 if dose is null or length(dose)>60 or length(other)>80 or((p_command->>'drug')='other')<>(other is not null)or started>public._ldl_today()
  then return jsonb_build_object('status','invalid');end if;
 insert into public.ldl_lipid_therapies(member_id,submission_id,drug,drug_other,dose,started_on,maximally_tolerated,recorded_by)
  values(m,sub,p_command->>'drug',other,dose,started,(p_command->>'maximallyTolerated')::boolean,d);
 return jsonb_build_object('status','saved');
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation then return jsonb_build_object('status','invalid');
end$$;

-- Stopped (with the day it stopped, or unknown) or entered in error (hidden from every read).
create function public.doctor_ldl_therapy_end(p_member uuid,p_therapy uuid,p_reason text,p_stopped_on date)returns jsonb
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
 return jsonb_build_object('status',case when n=1 then 'saved' else 'not-found' end);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation then return jsonb_build_object('status','invalid');
end$$;

-- A new goal version. expectedVersion is the version the doctor's form was built on (0 for none): a goal set
-- by someone else in between makes this stale rather than silently replacing it.
create function public.doctor_ldl_goal_set(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare keys text[]:=array['version','memberId','submissionId','expectedVersion','category','thresholdMmol','reductionRule','reductionPct',
  'baselineKind','baselineMmol','baselineOn','baselineSource','nextTestOn','reason','defaultsVersion'];
 m uuid;sub uuid;d uuid;cur int;prior public.ldl_goals;b_on date;next_on date;reason text;thr numeric;pct smallint;b_mmol numeric;
begin
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-keys<>'{}'
  or not(p_command?&array['version','memberId','submissionId','expectedVersion','category','thresholdMmol','reductionRule','baselineKind','defaultsVersion'])
  or p_command->>'version'is distinct from 'ldl-goal-v1'or jsonb_typeof(p_command->'reductionRule')<>'boolean'
  or jsonb_typeof(p_command->'thresholdMmol')<>'number'or jsonb_typeof(p_command->'expectedVersion')<>'number'
  or coalesce(jsonb_typeof(p_command->'reductionPct'),'null')not in('number','null')or coalesce(jsonb_typeof(p_command->'baselineMmol'),'null')not in('number','null')
  or coalesce(p_command->>'defaultsVersion','')!~'^[a-z0-9.-]{1,40}$'
 then return jsonb_build_object('status','invalid');end if;
 begin
  m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;
  b_on:=public._ldl_date(p_command,'baselineOn');next_on:=public._ldl_date(p_command,'nextTestOn');
  thr:=(p_command->>'thresholdMmol')::numeric;pct:=(p_command->>'reductionPct')::smallint;b_mmol:=(p_command->>'baselineMmol')::numeric;
 exception when invalid_text_representation or invalid_parameter_value or datetime_field_overflow or numeric_value_out_of_range
  then return jsonb_build_object('status','invalid');end;
 d:=public._ldl_doctor_lock(m);
 if not public._ldl_goal_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.ldl_goals where submission_id=sub;
 if found then return jsonb_build_object('status',case when prior.member_id=m and prior.set_by=d then 'replayed' else 'stale' end);end if;
 select coalesce(max(version),0)into cur from public.ldl_goals where member_id=m;
 if cur<>(p_command->>'expectedVersion')::numeric then return jsonb_build_object('status','stale');end if;
 reason:=public._ldl_clean(p_command->>'reason',500);
 -- One decimal for the threshold and two for the baseline, as stored: a value the column would round is refused, not rounded.
 if thr<>round(thr,1)or b_mmol<>round(b_mmol,2)or length(reason)>500 or(cur>0 and reason is null)
  or b_on>public._ldl_today()or next_on<public._ldl_today()or next_on>public._ldl_today()+731
 then return jsonb_build_object('status','invalid');end if;
 insert into public.ldl_goals(member_id,version,submission_id,category,threshold_mmol,reduction_rule,reduction_pct,baseline_kind,baseline_mmol,baseline_on,
  baseline_source,next_test_on,reason,defaults_version,set_by)
 values(m,cur+1,sub,p_command->>'category',thr,(p_command->>'reductionRule')::boolean,pct,p_command->>'baselineKind',b_mmol,b_on,
  nullif(p_command->>'baselineSource',''),next_on,reason,p_command->>'defaultsVersion',d);
 return jsonb_build_object('status','saved','goalVersion',cur+1);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation or not_null_violation then return jsonb_build_object('status','invalid');
end$$;

-- 6. Member: own goal ----------------------------------------------------------------------------------------------
-- Not in the pathway (no event, therapy or goal recorded): {inPathway:false}, and the app shows nothing.
-- In the pathway without a goal: goal null ("your doctor is setting your goal"), and no values.
create function public.member_ldl_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare uid uuid:=auth.uid();g public.ldl_goals;
begin
 if uid is null or auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 if not public._ldl_goal_enabled()then return jsonb_build_object('version','ldl-member-v1','enabled',false);end if;
 select * into g from public.ldl_goals where member_id=uid order by version desc limit 1;
 if g.id is null and not exists(select 1 from public.ldl_index_events where member_id=uid and removed_at is null)
  and not exists(select 1 from public.ldl_lipid_therapies where member_id=uid and end_reason is distinct from 'entered_in_error')
 then return jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',false);end if;
 return jsonb_build_object('version','ldl-member-v1','enabled',true,'inPathway',true,
  'goal',case when g.id is null then null else public._ldl_goal_json(g,false)end,
  'observations',case when g.id is null then '[]'::jsonb else public._ldl_observations(uid,false)end);
end$$;

-- 7. Grants: functions only ----------------------------------------------------------------------------------------
revoke all on function public._ldl_goal_enabled(),public._ldl_record_guard(),public._ldl_observations(uuid,boolean),public._ldl_goal_json(public.ldl_goals,boolean),
 public._ldl_clean(text,int),public._ldl_today(),public._ldl_doctor_lock(uuid),public._ldl_date(jsonb,text),
 public.doctor_ldl_read(uuid),public.doctor_ldl_event_add(jsonb),public.doctor_ldl_event_remove(uuid,uuid),public.doctor_ldl_therapy_add(jsonb),
 public.doctor_ldl_therapy_end(uuid,uuid,text,date),public.doctor_ldl_goal_set(jsonb),public.member_ldl_read()
 from public,anon,authenticated,service_role;
grant execute on function public.doctor_ldl_read(uuid),public.doctor_ldl_event_add(jsonb),public.doctor_ldl_event_remove(uuid,uuid),public.doctor_ldl_therapy_add(jsonb),
 public.doctor_ldl_therapy_end(uuid,uuid,text,date),public.doctor_ldl_goal_set(jsonb),public.member_ldl_read()to authenticated;
