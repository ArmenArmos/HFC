-- WP T: physician-set home BP targets and alert thresholds, and the assigned cardiologist as a physician on the case.
--
-- 1. public.member_bp_targets: one immutable row per version (modelled on ldl_goals, 20261029171957). The member's home BP
--    target and the clinician-set alert thresholds the BP flow compares a saved reading with. The defaults the form
--    proposed live in lib/clinical/rules/thresholds.ts (THRESHOLD.personalBp*, pending clinical sign-off) and their version
--    is stored with each row. Only the assigned family physician or the assigned cardiologist (public._case_physician) may
--    set a version: idempotent on the submission id, optimistic on the expected version, recorded in
--    patient_clinical_case_events ('bp-target-set', in the unified audit) and in access_audit. Nurses, coordinators,
--    admins, members and caregivers can never set one.
-- 2. Reads: doctor_bp_target_read (care team: assigned doctor, cardiologist or nurse via staff_care_access; never a
--    coordinator), member_bp_target_read (own), caregiver_bp_target_read (scope view_plan). Every staff and caregiver read
--    is audited. bp_personal_context is the service-role read for the BP flow and the clinical sweeps.
-- 3. The assigned cardiologist may set the LDL goal (doctor_ldl_goal_set) and read the LDL record (doctor_ldl_read), and
--    may review, save and publish the care plan (the publication chain below). Everything else in those functions is
--    unchanged: each is patched from its live definition by an exact text replacement asserted to occur once.

-- Helpers for this migration only.
create or replace function pg_temp.widen_in_check(p_table regclass,p_constraint text,p_column text,p_add text[])returns void
language plpgsql as $$
declare def text;vals text[];
begin
 select pg_get_constraintdef(oid)into def from pg_constraint where conrelid=p_table and conname=p_constraint;
 if def is null then raise exception 'Constraint % not found',p_constraint;end if;
 select coalesce(array_agg(m[1] order by ord),'{}')into vals from regexp_matches(def,'''([^'']+)''::text','g')with ordinality t(m,ord);
 if cardinality(vals)=0 then raise exception 'Constraint % is not a value list',p_constraint;end if;
 select array_agg(v order by first_seen)into vals from(select v,min(o)first_seen from unnest(vals||p_add)with ordinality u(v,o)group by v)x;
 execute format('alter table %s drop constraint %I',p_table,p_constraint);
 execute format('alter table %s add constraint %I check(%I in(%s))',p_table,p_constraint,p_column,(select string_agg(quote_literal(v),',')from unnest(vals)v));
end$$;
drop table if exists pg_temp.function_patches;
create temp table function_patches(n serial primary key,fn regprocedure not null,old text not null,new text not null);

select pg_temp.widen_in_check('public.patient_clinical_case_events','patient_clinical_case_events_kind_check','kind',array['bp-target-set']);

-- 1. Table ------------------------------------------------------------------------------------------------------------
create table public.member_bp_targets(
 id uuid primary key default gen_random_uuid(),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 version int not null check(version>=1),
 submission_id uuid not null unique,
 -- Home readings at or below these are "at target".
 home_systolic_target smallint not null check(home_systolic_target between 100 and 160),
 home_diastolic_target smallint not null check(home_diastolic_target between 55 and 100),
 -- A home reading at or above either number, on this many consecutive readings, raises the same-day nurse task.
 alert_high_systolic smallint not null check(alert_high_systolic between 120 and 180),
 alert_high_diastolic smallint not null check(alert_high_diastolic between 70 and 120),
 alert_high_consecutive int not null default 2 check(alert_high_consecutive between 1 and 5),
 -- With symptoms only: a reading at or below this systolic, or a pulse at or below this, raises the same-day nurse task.
 alert_low_systolic smallint not null check(alert_low_systolic between 70 and 110),
 alert_low_pulse smallint not null check(alert_low_pulse between 30 and 60),
 reason text check(length(reason)between 1 and 500),
 set_by uuid not null references auth.users(id),
 set_by_role text not null check(set_by_role in('family_physician','cardiologist')),
 -- The THRESHOLD defaults version the physician saw when confirming.
 defaults_version text not null check(defaults_version ~ '^[a-z0-9.-]{1,40}$'),
 created_at timestamptz not null default clock_timestamp(),
 unique(member_id,version),
 constraint member_bp_targets_diastolic_below_systolic check(home_diastolic_target<home_systolic_target),
 constraint member_bp_targets_alert_above_target check(alert_high_systolic>home_systolic_target and alert_high_diastolic>home_diastolic_target),
 constraint member_bp_targets_low_below_target check(alert_low_systolic<home_systolic_target),
 constraint member_bp_targets_reason_on_change check(version=1 or reason is not null)
);
create index member_bp_targets_member on public.member_bp_targets(member_id,version desc);
create trigger member_bp_targets_immutable before update or delete on public.member_bp_targets for each row execute function public._patient_visit_immutable();
alter table public.member_bp_targets enable row level security;
-- No direct table access: reads and writes go through the functions below.
revoke all on public.member_bp_targets from public,anon,authenticated,service_role;

-- 2. Helpers -----------------------------------------------------------------------------------------------------------
-- The assigned family physician or the assigned cardiologist of the member, in their own managed session; 42501 otherwise.
create function public._case_physician_require(p_member uuid)returns uuid
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.uid()is null or public._case_physician(p_member,auth.uid())is null then
  raise insufficient_privilege using message='Assigned active physician required';end if;
 return auth.uid();
end$$;

-- _ldl_doctor_lock with the physician check: locks the case, then checks against what is committed now.
create function public._case_physician_lock(p_member uuid)returns uuid
language plpgsql security definer set search_path=''as $$
begin
 perform set_config('lock_timeout','1500ms',true);
 perform 1 from public.patient_clinical_cases where user_id=p_member for update;
 perform 1 from public.workspace_staff where user_id=auth.uid()for share;
 return public._case_physician_require(p_member);
end$$;

-- p_scope: 'staff' (every field), 'member' (the target only: the alert thresholds are the care team's working settings).
create function public._bp_target_json(t public.member_bp_targets,p_scope text)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version',t.version,'homeSystolicTarget',t.home_systolic_target,'homeDiastolicTarget',t.home_diastolic_target,
  'setAt',t.created_at,'setByRole',t.set_by_role,'physicianName',(select s.display_name from public.workspace_staff s where s.user_id=t.set_by))
 ||case when p_scope='staff'then jsonb_build_object('alertHighSystolic',t.alert_high_systolic,'alertHighDiastolic',t.alert_high_diastolic,
  'alertHighConsecutive',t.alert_high_consecutive,'alertLowSystolic',t.alert_low_systolic,'alertLowPulse',t.alert_low_pulse,
  'reason',t.reason,'defaultsVersion',t.defaults_version,'byYou',t.set_by=auth.uid())else '{}'::jsonb end
$$;

create function public._bp_target_current(p_member uuid)returns public.member_bp_targets
language sql stable security definer set search_path=''as $$
 select * from public.member_bp_targets where member_id=p_member order by version desc limit 1
$$;

-- 3. Physician: set --------------------------------------------------------------------------------------------------
-- {status}: saved (with targetVersion) | replayed | stale | invalid | unavailable. Access raises 42501.
create function public.doctor_bp_target_set(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare keys text[]:=array['version','memberId','submissionId','expectedVersion','homeSystolicTarget','homeDiastolicTarget','alertHighSystolic',
  'alertHighDiastolic','alertHighConsecutive','alertLowSystolic','alertLowPulse','reason','defaultsVersion'];
 nums text[]:=array['expectedVersion','homeSystolicTarget','homeDiastolicTarget','alertHighSystolic','alertHighDiastolic','alertHighConsecutive','alertLowSystolic','alertLowPulse'];
 m uuid;sub uuid;d uuid;who text;cur int;prior public.member_bp_targets;reason text;k text;rev bigint;
begin
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-keys<>'{}'or not(p_command?&(keys[1:11]||array['defaultsVersion']))
  or p_command->>'version'is distinct from 'bp-target-v1'or coalesce(p_command->>'defaultsVersion','')!~'^[a-z0-9.-]{1,40}$'
  or coalesce(jsonb_typeof(p_command->'reason'),'null')not in('string','null')
 then return jsonb_build_object('status','invalid');end if;
 foreach k in array nums loop
  if jsonb_typeof(p_command->k)<>'number'or(p_command->>k)::numeric<>trunc((p_command->>k)::numeric)then return jsonb_build_object('status','invalid');end if;
 end loop;
 begin m:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 d:=public._case_physician_lock(m);
 who:=public._case_physician(m,d);
 select * into prior from public.member_bp_targets where submission_id=sub;
 if found then return jsonb_build_object('status',case when prior.member_id=m and prior.set_by=d then 'replayed' else 'stale' end);end if;
 select coalesce(max(version),0)into cur from public.member_bp_targets where member_id=m;
 if cur<>(p_command->>'expectedVersion')::numeric then return jsonb_build_object('status','stale');end if;
 reason:=public._ldl_clean(p_command->>'reason',500);
 if length(reason)>500 or(cur>0 and reason is null)then return jsonb_build_object('status','invalid');end if;
 insert into public.member_bp_targets(member_id,version,submission_id,home_systolic_target,home_diastolic_target,alert_high_systolic,alert_high_diastolic,
  alert_high_consecutive,alert_low_systolic,alert_low_pulse,reason,set_by,set_by_role,defaults_version)
 values(m,cur+1,sub,(p_command->>'homeSystolicTarget')::smallint,(p_command->>'homeDiastolicTarget')::smallint,(p_command->>'alertHighSystolic')::smallint,
  (p_command->>'alertHighDiastolic')::smallint,(p_command->>'alertHighConsecutive')::int,(p_command->>'alertLowSystolic')::smallint,
  (p_command->>'alertLowPulse')::smallint,reason,d,who,p_command->>'defaultsVersion');
 select revision into rev from public.patient_clinical_cases where user_id=m;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,rev,'bp-target-set',d,jsonb_build_object('version',cur+1,'role',who));
 perform public._access_audit_record(m,'bp_target_set','v'||(cur+1));
 return jsonb_build_object('status','saved','targetVersion',cur+1);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
 when check_violation or not_null_violation or numeric_value_out_of_range then return jsonb_build_object('status','invalid');
end$$;

-- 4. Reads ------------------------------------------------------------------------------------------------------------
-- The care team: the assigned doctor, the assigned cardiologist and the assigned nurse (staff_care_access). Never a
-- coordinator or an admin. canSet says whether this reader may set a version (a physician on the case).
create function public.doctor_bp_target_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare who text;
begin
 if auth.uid()is null or not public.staff_care_access(p_member,auth.uid(),true)then raise insufficient_privilege;end if;
 who:=public._case_physician(p_member,auth.uid());
 perform public._access_audit_record(p_member,'bp_target',null);
 return jsonb_build_object('version','bp-target-read-v1','canSet',who is not null,'role',who,
  'current',(select public._bp_target_json(t,'staff')from public.member_bp_targets t where t.member_id=p_member order by t.version desc limit 1),
  'history',coalesce((select jsonb_agg(public._bp_target_json(t,'staff')order by t.version desc)
   from(select * from public.member_bp_targets where member_id=p_member order by version desc limit 10)t),'[]'::jsonb));
end$$;

-- The member's own target, once a physician has set one.
create function public.member_bp_target_read()returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=public._member_self();t public.member_bp_targets;
begin
 t:=public._bp_target_current(m);
 return jsonb_build_object('version','bp-target-member-v1','target',case when t.id is null then null else public._bp_target_json(t,'member')end);
end$$;

-- A caregiver with the view_plan scope sees the target the member sees.
create function public.caregiver_bp_target_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare t public.member_bp_targets;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null or not public._caregiver_can(p_member,auth.uid(),'view_plan')then raise insufficient_privilege;end if;
 t:=public._bp_target_current(p_member);
 perform public._caregiver_audit(p_member,auth.uid(),'plan_read','caregiver_bp_target',null);
 return jsonb_build_object('ok',true,'version','bp-target-member-v1','target',case when t.id is null then null else public._bp_target_json(t,'member')end);
end$$;

-- Service role: the BP flow and the clinical sweeps. The current target (or null: defaults apply) and the member's home
-- readings of the last p_days days, oldest first. Caregiver and member-typed readings carry their entry source, unverified.
create function public.bp_personal_context(p_member uuid,p_days integer default 14)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare t public.member_bp_targets;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_days is null or p_days not between 1 and 60 then raise invalid_parameter_value;end if;
 t:=public._bp_target_current(p_member);
 return jsonb_build_object('version','bp-personal-context-v1',
  'target',case when t.id is null then null else public._bp_target_json(t,'staff')-'byYou'end,
  'readings',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'systolic',r.systolic,'diastolic',r.diastolic,'pulse',r.pulse,
    'measuredAt',r.measured_at,'entrySource',r.entry_source)order by r.measured_at,r.id)
   from(select * from public.patient_measurements where user_id=p_member and measured_at>clock_timestamp()-make_interval(days=>p_days)
    and measured_at<=clock_timestamp()order by measured_at desc limit 200)r),'[]'::jsonb));
end$$;

-- 5. The assigned cardiologist on the LDL goal and the care plan -----------------------------------------------------
-- LDL goal: the setter and the doctor's LDL read accept either physician. Events, therapies and re-tests stay with the
-- assigned doctor (_ldl_doctor_lock, unchanged).
insert into function_patches(fn,old,new)values('public.doctor_ldl_goal_set(jsonb)'::regprocedure,
 ' d:=public._ldl_doctor_lock(m);',' d:=public._case_physician_lock(m);');
insert into function_patches(fn,old,new)values('public.doctor_ldl_read(uuid)'::regprocedure,
 ' perform public._assigned_active_doctor(p_member);',' perform public._case_physician_require(p_member);');
-- Care plan review, draft, regimen review and publication. A family physician keeps exactly the old check.
insert into function_patches(fn,old,new)values('public.patient_clinical_case_snapshot_before_review(uuid)'::regprocedure,
 'c.assigned_doctor_id=auth.uid();','(c.assigned_doctor_id=auth.uid() or public._case_physician(c.user_id,auth.uid())=''cardiologist'');');
insert into function_patches(fn,old,new)values('public.lock_assigned_clinical_case_before_managed_session(uuid,uuid,bigint,text)'::regprocedure,
 'c.assigned_doctor_id is distinct from p_actor','(c.assigned_doctor_id is distinct from p_actor and public._case_physician(p_user_id,p_actor) is distinct from ''cardiologist'')');
insert into function_patches(fn,old,new)values('public.save_patient_clinical_draft_before_review(uuid,bigint,text,jsonb)'::regprocedure,
 'c.assigned_doctor_id is distinct from auth.uid()','(c.assigned_doctor_id is distinct from auth.uid() and public._case_physician(p_user_id,auth.uid()) is distinct from ''cardiologist'')');
insert into function_patches(fn,old,new)values('public.publish_patient_clinical_plan(uuid,uuid,bigint,text,jsonb,uuid)'::regprocedure,
 'c.assigned_doctor_id is distinct from p_actor','(c.assigned_doctor_id is distinct from p_actor and public._case_physician(p_user_id,p_actor) is distinct from ''cardiologist'')');
insert into function_patches(fn,old,new)values('public.doctor_regimen_review(uuid)'::regprocedure,
 ' perform public._assigned_active_doctor(p_user_id);',' perform public._case_physician_require(p_user_id);');

-- Apply the queued function patches, in order.
do $patch$
declare r record;def text;
begin
 for r in select * from function_patches order by n loop
  def:=pg_get_functiondef(r.fn);
  if position(r.old in def)=0 or cardinality(string_to_array(def,r.old))<>2 then raise exception 'Unexpected definition of %',r.fn;end if;
  execute replace(def,r.old,r.new);
 end loop;
end $patch$;
drop table pg_temp.function_patches;

-- 6. Grants ----------------------------------------------------------------------------------------------------------
revoke all on function public._case_physician_require(uuid),public._case_physician_lock(uuid),public._bp_target_json(public.member_bp_targets,text),
 public._bp_target_current(uuid),public.doctor_bp_target_set(jsonb),public.doctor_bp_target_read(uuid),public.member_bp_target_read(),
 public.caregiver_bp_target_read(uuid),public.bp_personal_context(uuid,integer)
 from public,anon,authenticated,service_role;
grant execute on function public.doctor_bp_target_set(jsonb),public.doctor_bp_target_read(uuid),public.member_bp_target_read(),public.caregiver_bp_target_read(uuid)to authenticated;
grant execute on function public.bp_personal_context(uuid,integer)to service_role;
