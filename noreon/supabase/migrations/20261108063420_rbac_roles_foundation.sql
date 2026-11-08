-- WP F (RBAC foundation): care coordinator role, physician specialty, assigned cardiologist, coordinator logistics reads.
--
-- * workspace_staff.role gains 'coordinator' (care coordinator). Doctors gain a specialty: 'family_physician' or
--   'cardiologist'. Every existing role='doctor' check keeps working unchanged, because a cardiologist is still a doctor.
-- * patient_clinical_cases.assigned_cardiologist_id: a second, optional physician on the case, set by an administrator.
--   staff_care_access gives the assigned cardiologist the same member access as the assigned doctor.
-- * _case_physician(member, actor) and _staff_coordination_access(member, actor) are the helpers later work packages use
--   to authorise target setting, plan approval and coordinator logistics.
-- * Coordinators get no clinical write authority anywhere. They read the admin logistics queue, coordination tasks and
--   consultations to arrange for their own clinic, and arrange consultations. Every coordinator read of member data is
--   recorded in access_audit with actor_role 'coordinator'.
--
-- Constraint widenings below read the live definition and add values, so a widening made by another migration is kept.

-- Helpers for this migration only (pg_temp: dropped at the end of the session).
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
-- Function patches (exact text replacements of live definitions) are queued here and applied by one DO block at the
-- end of this migration, each asserting that its target text occurs exactly once.
drop table if exists pg_temp.function_patches;
create temp table function_patches(n serial primary key,fn regprocedure not null,old text not null,new text not null);

-- 1. Roles and specialty ------------------------------------------------------------------------------------------

select pg_temp.widen_in_check('public.workspace_staff','workspace_staff_role_check','role',array['coordinator']);
select pg_temp.widen_in_check('public.real_staff_invitations','real_staff_invitations_role_check','role',array['coordinator']);

alter table public.workspace_staff add column specialty text;
alter table public.workspace_staff add constraint workspace_staff_specialty_check check(specialty in('family_physician','cardiologist'));
alter table public.real_staff_invitations add column specialty text;
alter table public.real_staff_invitations add constraint real_staff_invitations_specialty_check check(specialty in('family_physician','cardiologist'));
comment on column public.workspace_staff.specialty is
 'Physician specialty (family_physician|cardiologist). Required for role doctor, null for every other role. A cardiologist is still role doctor, so every role=doctor check is unchanged.';

-- A doctor written without a specialty (existing inserts, seeds and checks that predate this column) is a family
-- physician; a role change away from doctor drops the specialty it no longer needs. The CHECK below stays the invariant.
create function public._staff_specialty_default()returns trigger
language plpgsql set search_path=''as $$
begin
 if new.role='doctor'and new.specialty is null then new.specialty:='family_physician';
 elsif new.role<>'doctor'and tg_op='UPDATE'and old.role='doctor'and new.specialty is not distinct from old.specialty then new.specialty:=null;
 end if;
 return new;
end$$;
revoke all on function public._staff_specialty_default()from public,anon,authenticated,service_role;
create trigger workspace_staff_specialty_default before insert or update of role,specialty on public.workspace_staff
 for each row execute function public._staff_specialty_default();
create trigger real_staff_invitations_specialty_default before insert or update of role,specialty on public.real_staff_invitations
 for each row execute function public._staff_specialty_default();
-- Fixtures written with session_replication_role=replica (the SQL checks do this) must still default the specialty.
alter table public.workspace_staff enable always trigger workspace_staff_specialty_default;
alter table public.real_staff_invitations enable always trigger real_staff_invitations_specialty_default;

-- Backfill before the constraint: every existing doctor is a family physician until an administrator says otherwise.
update public.workspace_staff set specialty='family_physician' where role='doctor' and specialty is null;
update public.real_staff_invitations set specialty='family_physician' where role='doctor' and specialty is null;
alter table public.workspace_staff add constraint workspace_staff_doctor_specialty check((role='doctor')=(specialty is not null));
alter table public.real_staff_invitations add constraint real_staff_invitations_doctor_specialty check((role='doctor')=(specialty is not null));

-- Identity: every existing key, plus the specialty (null except for doctors).
create or replace function public.real_clinical_staff_identity() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.user_id,'role',s.role,'name',s.display_name,'clinicId',s.clinic_id,'specialty',s.specialty)
 from public.workspace_staff s where s.user_id=auth.uid() and s.active and s.removed_at is null
 and (s.role='admin' or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active))
 and public._real_staff_managed_session_allowed(s.user_id)
$$;

-- The optional assigned cardiologist (section 3 below uses it; the staff directory counts it as an assignment).
alter table public.patient_clinical_cases add column assigned_cardiologist_id uuid references public.workspace_staff(user_id) on delete restrict;
create index patient_clinical_cases_cardiologist on public.patient_clinical_cases(assigned_cardiologist_id) where assigned_cardiologist_id is not null;
comment on column public.patient_clinical_cases.assigned_cardiologist_id is
 'Optional second physician (specialty cardiologist), set only by an administrator through assign_patient_case_cardiologist. Has the assigned doctor''s member access through staff_care_access.';

-- 2. Invitations carry role and specialty --------------------------------------------------------------------------

create or replace function public._real_staff_invitation_json(i public.real_staff_invitations) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',i.id,'generation',i.generation,'operationId',i.operation_id,
 'expectedAuthUserId',i.expected_auth_user_id,'authUserId',i.auth_user_id,'email',i.email,'name',i.display_name,
 'role',i.role,'specialty',i.specialty,'clinicId',i.clinic_id,'issuerId',i.issuer_id,'status',i.status,'sendStatus',i.send_status,'expiresAt',i.expires_at,
 'tokenDigest',i.token_digest,'tokenType',i.token_type,'dispatchClaimedAt',i.dispatch_claimed_at)
$$;

-- The specialty is an optional trailing argument: an existing five-argument call reserves a doctor as a family physician.
drop function public.real_admin_reserve_staff_invitation(uuid,text,text,uuid,text);
create function public.real_admin_reserve_staff_invitation(p_request_id uuid,p_email text,p_display_name text,p_clinic_id uuid,p_role text,p_specialty text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public._real_staff_require_admin();email_value text:=lower(btrim(p_email));i public.real_staff_invitations;e public.real_staff_admin_events;
 spec text:=case when p_role='doctor' then coalesce(p_specialty,'family_physician') end;
begin
 if p_role is null or p_role not in ('doctor','nurse','coordinator') or p_request_id is null or p_clinic_id is null or email_value is null or length(email_value) not between 3 and 320 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_display_name is null or length(btrim(p_display_name)) not between 1 and 160 then raise invalid_parameter_value using message='Check staff details';end if;
 if (p_role<>'doctor' and p_specialty is not null) or (spec is not null and spec not in ('family_physician','cardiologist')) then raise invalid_parameter_value using message='Check staff details';end if;
 perform pg_advisory_xact_lock(hashtextextended('real-staff-request:'||p_request_id::text,0));
 select * into e from public.real_staff_admin_events where request_id=p_request_id;
 if found then
  select * into i from public.real_staff_invitations where id=e.invitation_id for update;
  if e.kind<>'invitation_reserved' or e.actor_id<>actor or i.role<>p_role or i.specialty is distinct from spec or i.email<>email_value or i.display_name<>btrim(p_display_name) or i.clinic_id<>p_clinic_id then raise invalid_parameter_value using message='Request identity conflicts';end if;
  if i.generation<>e.generation then raise serialization_failure using message='Invitation changed';end if;
  return public._real_staff_invitation_json(i);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('real-staff-email:'||email_value,0));
 perform 1 from public.workspace_clinics where id=p_clinic_id and active for share;
 if not found then raise insufficient_privilege using message='Active clinic required';end if;
 if exists(select 1 from auth.users where lower(email)=email_value) or exists(select 1 from public.real_staff_invitations where email=email_value) then raise unique_violation using message='Email already has an account or invitation';end if;
 insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,role,specialty) values(email_value,btrim(p_display_name),p_clinic_id,actor,p_role,spec) returning * into i;
 insert into public.real_staff_admin_events(invitation_id,clinic_id,actor_id,generation,request_id,kind) values(i.id,i.clinic_id,actor,i.generation,p_request_id,'invitation_reserved');
 return public._real_staff_invitation_json(i);
end $$;
revoke all on function public.real_admin_reserve_staff_invitation(uuid,text,text,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.real_admin_reserve_staff_invitation(uuid,text,text,uuid,text,text) to authenticated;
-- The doctor-only legacy entry resolves to the new signature; recreated so its dependency is explicit.
create or replace function public.real_admin_reserve_doctor_invitation(p_request_id uuid,p_email text,p_display_name text,p_clinic_id uuid) returns jsonb
language sql security definer set search_path='' as $$select public.real_admin_reserve_staff_invitation(p_request_id,p_email,p_display_name,p_clinic_id,'doctor',null)$$;

-- Accepting an invitation creates the membership with the invited role and specialty.
create or replace function public.real_staff_bind_invitation_identity(p_invitation_id uuid,p_generation bigint,p_operation_id uuid,p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;s public.workspace_staff;
begin
 i:=public._real_staff_dispatch_invitation(p_invitation_id,p_generation,p_operation_id);
 if p_auth_user_id is distinct from i.expected_auth_user_id then raise insufficient_privilege using message='Reserved identity required';end if;
 perform 1 from auth.users where id=p_auth_user_id and lower(email)=i.email for share;
 if not found then raise insufficient_privilege using message='Reserved identity unavailable';end if;
 select * into s from public.workspace_staff where user_id=p_auth_user_id for update;
 if found then
  if i.auth_user_id is null or s.role<>i.role or s.specialty is distinct from i.specialty or s.clinic_id<>i.clinic_id or s.active then raise insufficient_privilege using message='Existing membership cannot be replaced';end if;
 else
  if i.auth_user_id is not null then raise insufficient_privilege using message='Invited membership unavailable';end if;
  insert into public.workspace_staff(user_id,role,specialty,display_name,clinic_id,active) values(p_auth_user_id,i.role,i.specialty,i.display_name,i.clinic_id,false);
 end if;
 if i.auth_user_id is null then
  update public.real_staff_invitations set auth_user_id=p_auth_user_id where id=i.id returning * into i;
  insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.issuer_id,i.generation,'identity_bound');
 end if;
 return public._real_staff_invitation_json(i);
end $$;

-- Verification and finalisation match the pending membership on role; the specialty must match too.
insert into function_patches(fn,old,new)values('public.real_staff_record_invitation_verification(uuid,bigint,uuid)'::regprocedure,
 'where user_id=i.auth_user_id and role=i.role and clinic_id=i.clinic_id and not active for share',
 'where user_id=i.auth_user_id and role=i.role and specialty is not distinct from i.specialty and clinic_id=i.clinic_id and not active for share');
insert into function_patches(fn,old,new)values('public.real_staff_finalize_invitation(uuid,bigint,uuid,uuid)'::regprocedure,
 'where user_id=i.auth_user_id and role=i.role and clinic_id=i.clinic_id and not active for update',
 'where user_id=i.auth_user_id and role=i.role and specialty is not distinct from i.specialty and clinic_id=i.clinic_id and not active for update');

-- The staff directory lists coordinators too, and shows each doctor's specialty.
create or replace function public._real_staff_directory_row(p_staff_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with entry as (
 select jsonb_build_object('managementRevision',s.management_revision,'id',s.user_id,'name',s.display_name,'email',u.email,'role',s.role,'specialty',s.specialty,'clinicId',s.clinic_id,'clinicName',c.name,'active',s.active,
 'invitationId',i.id,'generation',i.generation,'status',case when s.removed_at is not null then 'revoked' when i.status in ('pending','verified') and i.expires_at<=clock_timestamp() then 'expired' when i.id is not null then i.status when s.active then 'active' else 'inactive' end,
 'sendStatus',i.send_status,'expiresAt',i.expires_at) data
 from public.workspace_staff s join auth.users u on u.id=s.user_id join public.workspace_clinics c on c.id=s.clinic_id
 left join public.real_staff_invitations i on i.auth_user_id=s.user_id where s.user_id=p_staff_id and s.role in ('doctor','nurse','coordinator')
 union all
 select jsonb_build_object('managementRevision',i.management_revision,'id',i.expected_auth_user_id,'name',i.display_name,'email',i.email,'role',i.role,'specialty',i.specialty,'clinicId',i.clinic_id,'clinicName',c.name,'active',false,
 'invitationId',i.id,'generation',i.generation,'status',case when i.expires_at<=clock_timestamp() and i.status in ('pending','verified') then 'expired' else i.status end,'sendStatus',i.send_status,'expiresAt',i.expires_at)
 from public.real_staff_invitations i join public.workspace_clinics c on c.id=i.clinic_id where i.expected_auth_user_id=p_staff_id and i.auth_user_id is null
 ) select (data-'managementRevision')||jsonb_build_object('version',md5(data::text),'assignmentCount',
 (select count(*) from public.patient_clinical_cases where assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id or assigned_cardiologist_id=p_staff_id)+
 (select count(*) from public.workspace_cases where expires_at>clock_timestamp() and (assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id))) from entry
$$;

-- 3. Assigned cardiologist ---------------------------------------------------------------------------------------

select pg_temp.widen_in_check('public.patient_clinical_case_events','patient_clinical_case_events_kind_check','kind',array['cardiologist-assigned']);

insert into function_patches(fn,old,new)values('public.real_admin_staff()'::regprocedure,
 'select user_id id from public.workspace_staff where role in (''doctor'',''nurse'')',
 'select user_id id from public.workspace_staff where role in (''doctor'',''nurse'',''coordinator'')');
insert into function_patches(fn,old,new)values('public._real_staff_manage(uuid,text,text,uuid,uuid,text)'::regprocedure,
 '(had_staff and s.role not in (''doctor'',''nurse''))',
 '(had_staff and s.role not in (''doctor'',''nurse'',''coordinator''))');
insert into function_patches(fn,old,new)values('public._real_staff_manage(uuid,text,text,uuid,uuid,text)'::regprocedure,
 'if exists(select 1 from public.patient_clinical_cases where assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id) or',
 'if exists(select 1 from public.patient_clinical_cases where assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id or assigned_cardiologist_id=p_staff_id) or');

-- The assigned cardiologist reads the member exactly as the assigned doctor does. Coordinators are never here.
create or replace function public.staff_care_access(p_id uuid,p_actor uuid,p_native boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare d uuid;n uuid;cg uuid;
begin
 if p_native then select assigned_doctor_id,assigned_nurse_id,assigned_cardiologist_id into d,n,cg from public.patient_clinical_cases where user_id=p_id;
 else select assigned_doctor_id,assigned_nurse_id into d,n from public.workspace_cases where id=p_id and expires_at>now();end if;
 return exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
 where s.user_id=p_actor and s.active and k.active and (not p_native or public._real_staff_managed_session_allowed(p_actor))
 and ((s.role='doctor' and (s.user_id=d or (cg is not null and s.user_id=cg and s.specialty='cardiologist')))
  or (s.role='nurse' and s.user_id=n and exists(select 1 from public.workspace_staff doctor where doctor.user_id=d and doctor.role='doctor' and doctor.active and doctor.clinic_id=s.clinic_id))));
end $$;

-- Which physician the actor is for this member: 'cardiologist' for the assigned cardiologist, the assigned doctor's own
-- specialty for the assigned doctor (normally 'family_physician'), otherwise null. Later work packages authorise target
-- setting and plan approval on it, always together with the session checks their entry point already makes.
create function public._case_physician(p_member uuid,p_actor uuid)returns text
language plpgsql stable security definer set search_path=''as $$
declare c public.patient_clinical_cases;s public.workspace_staff;
begin
 if p_member is null or p_actor is null then return null;end if;
 select * into c from public.patient_clinical_cases where user_id=p_member;
 if not found then return null;end if;
 select * into s from public.workspace_staff where user_id=p_actor and role='doctor' and active and removed_at is null
  and exists(select 1 from public.workspace_clinics k where k.id=clinic_id and k.active);
 if not found or not public._real_staff_managed_session_allowed(p_actor) then return null;end if;
 if c.assigned_cardiologist_id=p_actor and s.specialty='cardiologist' then return 'cardiologist';end if;
 if c.assigned_doctor_id=p_actor then return s.specialty;end if;
 return null;
end$$;
revoke all on function public._case_physician(uuid,uuid)from public,anon,authenticated,service_role;

-- Administrator only, like assign_patient_case_nurse: optimistic revision, audited in patient_clinical_case_events.
create function public.assign_patient_case_cardiologist(p_id uuid,p_revision bigint,p_cardiologist uuid default null)returns bigint
language plpgsql security definer set search_path=''as $$
declare actor uuid:=public._real_staff_require_admin();r bigint;cur uuid;
begin
 select revision,assigned_cardiologist_id into r,cur from public.patient_clinical_cases where user_id=p_id for update;
 if not found then raise insufficient_privilege using message='Case unavailable';end if;
 if r is distinct from p_revision then raise serialization_failure using message='Case changed';end if;
 if p_cardiologist is not null then
  perform 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
   where s.user_id=p_cardiologist and s.role='doctor' and s.specialty='cardiologist' and s.active and s.removed_at is null and k.active for share of s,k;
  if not found then raise insufficient_privilege using message='Choose an active cardiologist';end if;
 end if;
 if cur is not distinct from p_cardiologist then return r;end if;
 update public.patient_clinical_cases set assigned_cardiologist_id=p_cardiologist,revision=revision+1,updated_at=now() where user_id=p_id returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)values(p_id,r,'cardiologist-assigned',actor,jsonb_build_object('cardiologistId',p_cardiologist));
 return r;
end$$;
revoke all on function public.assign_patient_case_cardiologist(uuid,bigint,uuid)from public,anon,authenticated,service_role;
grant execute on function public.assign_patient_case_cardiologist(uuid,bigint,uuid)to authenticated;

-- 4. Coordinator logistics -----------------------------------------------------------------------------------------

-- The case's clinic is its assigned doctor's clinic, as staff_care_access uses for the nurse.
create function public._case_clinic(p_member uuid)returns uuid
language sql stable security definer set search_path=''as $$
 select d.clinic_id from public.patient_clinical_cases c join public.workspace_staff d on d.user_id=c.assigned_doctor_id where c.user_id=p_member
$$;
revoke all on function public._case_clinic(uuid)from public,anon,authenticated,service_role;

-- An active care coordinator whose clinic matches the case clinic, or an active administrator. Logistics only: no
-- clinical function accepts this, and staff_care_access never includes coordinators.
create function public._staff_coordination_access(p_member uuid,p_actor uuid)returns boolean
language plpgsql stable security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 if p_member is null or p_actor is null then return false;end if;
 select * into s from public.workspace_staff where user_id=p_actor and active and removed_at is null and role in('admin','coordinator');
 if not found or not public._real_staff_managed_session_allowed(p_actor) then return false;end if;
 if not exists(select 1 from public.patient_clinical_cases where user_id=p_member)then return false;end if;
 if s.role='admin' then return true;end if;
 return exists(select 1 from public.workspace_clinics k where k.id=s.clinic_id and k.active)and s.clinic_id=public._case_clinic(p_member);
end$$;
revoke all on function public._staff_coordination_access(uuid,uuid)from public,anon,authenticated,service_role;

-- The admin or coordinator acting on logistics, or insufficient_privilege. Returns the actor.
create function public._coordination_actor()returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 select * into s from public.workspace_staff where user_id=auth.uid() and role in('admin','coordinator') and active and removed_at is null for share;
 if not found or not public._real_staff_managed_session_allowed(s.user_id) then raise insufficient_privilege using message='Active administrator or coordinator session required';end if;
 if s.role='coordinator' and not exists(select 1 from public.workspace_clinics k where k.id=s.clinic_id and k.active) then raise insufficient_privilege using message='Active clinic required';end if;
 return s;
end$$;
revoke all on function public._coordination_actor()from public,anon,authenticated,service_role;

-- access_audit names coordinators and caregivers.
select pg_temp.widen_in_check('public.access_audit','access_audit_actor_role_check','actor_role',array['coordinator','caregiver']);
insert into function_patches(fn,old,new)values('public._access_audit_record_as(uuid,uuid,bigint,uuid,text,text)'::regprocedure,
 'when s.role=''nurse''then ''nurse'' else ''staff'' end',
 'when s.role=''nurse''then ''nurse'' when s.role=''coordinator''then ''coordinator'' else ''staff'' end');

-- Care queue: a coordinator reads and moves the admin logistics queue for their clinic. Admin rows carry no clinical
-- content (a table check), but they name the member, so each coordinator read is recorded per member.
create or replace function public._care_queue_actor()returns jsonb language plpgsql stable security definer set search_path=''as $$
declare who jsonb;
begin
 if auth.role()is distinct from 'authenticated'then raise insufficient_privilege;end if;
 who:=public.real_clinical_staff_identity();
 if who is null or who->>'role'is null or who->>'role'not in('nurse','doctor','admin','coordinator')then
  raise insufficient_privilege using message='Active nurse, doctor, coordinator or admin session required';end if;
 return jsonb_build_object('id',who->>'id','role',who->>'role');
end$$;
insert into function_patches(fn,old,new)values('public._care_queue_visible(public.care_queue_tasks,jsonb)'::regprocedure,
 'when ''admin''then t.queue=''admin''',
 'when ''admin''then t.queue=''admin''
  when ''coordinator''then t.queue=''admin''and public._staff_coordination_access(t.member_id,(actor->>''id'')::uuid)');
insert into function_patches(fn,old,new)values('public.care_queue_inbox(text,text)'::regprocedure,
 'if p_queue<>(case actor->>''role''when ''admin''then ''admin''when ''nurse''then ''nurse''else ''physician''end)then raise insufficient_privilege;end if;',
 'if p_queue<>(case actor->>''role''when ''admin''then ''admin''when ''coordinator''then ''admin''when ''nurse''then ''nurse''else ''physician''end)then raise insufficient_privilege;end if;');

-- Coordination tasks: a coordinator reads (never writes) the tasks of cases in their clinic, each read recorded.
-- _patient_coordination_access_as is unchanged, so patient_coordination_command still refuses coordinators.
create or replace function public._patient_coordination_queue_as(p_actor uuid,p_binding uuid,p_generation bigint,p_case uuid default null,p_filter text default 'active',p_after_created_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare rows jsonb;has_more boolean;cursor jsonb;who jsonb;coordinator boolean;item jsonb;
begin
 if p_filter is null or p_filter not in ('active','all','open','awaiting-member','awaiting-doctor','completed','cancelled','reassign') or p_limit is null or p_limit not between 1 and 100 or (p_after_created_at is null) is distinct from (p_after_id is null) or (p_after_created_at is not null and not isfinite(p_after_created_at)) then raise check_violation using message='Check the task page';end if;
 who:=case when p_binding is null then public.real_clinical_staff_identity()else to_jsonb(public._nurse_visit_nurse_as(p_actor,p_binding,p_generation))end;
 if (p_binding is null and auth.uid() is null) or who is null then raise insufficient_privilege using message='Current staff access required';end if;
 coordinator:=p_binding is null and who->>'role'='coordinator';
 if p_case is not null and not (case when coordinator then public._staff_coordination_access(p_case,p_actor) else public._patient_coordination_access_as(p_actor,p_binding,p_generation,p_case) end) then raise insufficient_privilege using message='Current case access required';end if;
 with authorized as (
  select t.* from public.patient_coordination_tasks t where (p_case is null or t.patient_case_id=p_case)
   and (case when coordinator then public._staff_coordination_access(t.patient_case_id,p_actor) else public._patient_coordination_access_as(p_actor,p_binding,p_generation,t.patient_case_id) end)
   and (p_filter='all' or (p_filter='active' and t.status not in ('completed','cancelled')) or t.status=p_filter or (p_filter='reassign' and t.status not in ('completed','cancelled') and not public._patient_coordination_owner_valid(t.patient_case_id,t.owner_id,t.kind='doctor-referral')))
   and (p_after_id is null or (t.created_at,t.id)>(p_after_created_at,p_after_id)) order by t.created_at,t.id limit p_limit+1
 ), numbered as(select a.*,row_number() over(order by created_at,id) rn from authorized a)
 select coalesce(jsonb_agg(public._patient_coordination_task_json((n.id,n.patient_case_id,n.kind,n.title,n.instructions,n.due_at,n.creator_id,n.owner_id,n.status,n.revision,n.created_at,n.updated_at,n.origin)::public.patient_coordination_tasks) order by n.created_at,n.id) filter(where rn<=p_limit),'[]'),count(*)>p_limit,
  (jsonb_agg(jsonb_build_object('createdAt',created_at,'id',id)) filter(where rn=p_limit))->0 into rows,has_more,cursor from numbered n;
 if coordinator then
  for item in select e from jsonb_array_elements(rows)e loop
   perform public._access_audit_record_as(p_actor,null,null,(item->>'caseId')::uuid,'member_coordination',item->>'id');
  end loop;
 end if;
 return jsonb_build_object('tasks',rows,'nextCursor',case when has_more then cursor else null end);
end $$;
revoke all on function public._patient_coordination_queue_as(uuid,uuid,bigint,uuid,text,timestamptz,uuid,integer)from public,anon,authenticated,service_role;
alter function public.patient_coordination_queue(uuid,text,timestamptz,uuid,integer) volatile;

-- Consultations to arrange: a coordinator sees and arranges those of their own clinic. Each listed member is recorded.
create or replace function public.admin_consultations_to_arrange()returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor public.workspace_staff:=public._coordination_actor();result jsonb;item jsonb;
begin
 if not public._doctor_completion_enabled()then return jsonb_build_object('version','consultation-queue-v1','enabled',false,'cases','[]'::jsonb,'clinics','[]'::jsonb);end if;
 result:=jsonb_build_object('version','consultation-queue-v1','enabled',true,
  'cases',coalesce((select jsonb_agg(jsonb_build_object('memberId',q.user_id,'memberName',q.member_name,'doctorName',q.doctor_name,'since',q.since,
    'arrangement',case when q.aid is null then null else jsonb_build_object('scheduledAt',q.scheduled_at,'channel',q.channel,'clinic',q.clinic_name,'arrangedAt',q.arranged_at,'arrangedBy',q.arranged_by)end)
   order by q.aid is not null,q.since,q.user_id)
   from(select c.user_id,p.display_name member_name,d.display_name doctor_name,public._consultation_hold_since(c)since,
     a.id aid,a.scheduled_at,a.channel,k.name clinic_name,a.created_at arranged_at,s.display_name arranged_by
    from public.patient_clinical_cases c
    left join public.profiles p on p.id=c.user_id
    left join public.workspace_staff d on d.user_id=c.assigned_doctor_id
    left join lateral public._consultation_arrangement(c.user_id,public._consultation_hold_since(c))a on true
    left join public.workspace_clinics k on k.id=a.clinic_id
    left join public.workspace_staff s on s.user_id=a.actor_id
    where public._consultation_hold_since(c) is not null and (actor.role='admin' or d.clinic_id=actor.clinic_id))q),'[]'),
  'clinics',coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name)order by k.name,k.id)from public.workspace_clinics k where k.active and (actor.role='admin' or k.id=actor.clinic_id)),'[]'));
 if actor.role='coordinator' then
  for item in select e from jsonb_array_elements(result->'cases')e loop
   perform public._access_audit_record((item->>'memberId')::uuid,'consultations_to_arrange',null);
  end loop;
 end if;
 return result;
end$$;

create or replace function public.admin_consultation_arrange_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor public.workspace_staff;a uuid;sub uuid;m uuid;since timestamptz;previous timestamptz;cur public.patient_consultation_arrangements;sched timestamptz;ch text;clinic uuid;c public.patient_clinical_cases;prior public.patient_consultation_arrangements;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 actor:=public._coordination_actor();a:=actor.user_id;
 if not public._doctor_completion_enabled()then return jsonb_build_object('status','disabled');end if;
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','memberId','since','previous','scheduledAt','channel','clinicId']<>'{}'
  or not(p_command?&array['version','submissionId','memberId','since','previous','scheduledAt','channel'])or p_command->>'version'is distinct from 'consultation-arrange-v1'then return bad;end if;
 begin
  sub:=(p_command->>'submissionId')::uuid;m:=(p_command->>'memberId')::uuid;since:=(p_command->>'since')::timestamptz;sched:=(p_command->>'scheduledAt')::timestamptz;
  clinic:=nullif(p_command->>'clinicId','')::uuid;previous:=(p_command->>'previous')::timestamptz;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return bad;end;
 ch:=p_command->>'channel';
 if ch is null or ch not in('clinic','phone')or(ch='clinic')<>(clinic is not null)then return bad;end if;
 -- A coordinator arranges only for cases of their own clinic, and only at their own clinic.
 if actor.role='coordinator' and (not public._staff_coordination_access(m,a) or (clinic is not null and clinic<>actor.clinic_id)) then raise insufficient_privilege using message='Coordinator clinic access required';end if;
 select * into prior from public.patient_consultation_arrangements where submission_id=sub;
 if found then
  if prior.user_id<>m or prior.actor_id<>a or prior.scheduled_at<>sched or prior.channel<>ch or prior.clinic_id is distinct from clinic then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','arranged');
 end if;
 if sched<=clock_timestamp()or sched>clock_timestamp()+interval '180 days'then return jsonb_build_object('status','invalid-time');end if;
 if clinic is not null and not exists(select 1 from public.workspace_clinics where id=clinic and active)then return bad;end if;
 select * into c from public.patient_clinical_cases where user_id=m for update nowait;
 if not found or public._consultation_hold_since(c) is distinct from since then return jsonb_build_object('status','stale');end if;
 cur:=public._consultation_arrangement(m,since);
 if cur.created_at is distinct from previous then return jsonb_build_object('status','stale');end if;
 insert into public.patient_consultation_arrangements(user_id,hold_since,scheduled_at,channel,clinic_id,actor_id,submission_id)values(m,since,sched,ch,clinic,a,sub);
 if actor.role='coordinator' then perform public._access_audit_record(m,'consultation_arrange',sub::text);end if;
 return jsonb_build_object('status','arranged');
end$$;

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
