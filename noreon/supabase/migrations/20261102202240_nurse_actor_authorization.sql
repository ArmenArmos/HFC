-- Authorization groundwork only. No Telegram entry point, inbox or outbox changes.
-- Public signatures and ACLs survive CREATE OR REPLACE. Their delegates retain web
-- checks at their original sites (after validation/advisory locks where applicable).
-- Null binding = original web authorization; a binding = owner-only Telegram execution.
-- Actor IDs are internal arguments, never accepted by an API-role function.
-- Bodies below are copied from the cited newest definitions, with only actor/auth
-- dispatch, nested delegate calls and truthful provenance changed.

alter table public.access_audit
 add column channel text not null default 'web',
 add column binding_id uuid references public.telegram_auth_bindings(id),
 add column binding_generation bigint,
 add constraint access_audit_channel_provenance check(
  (channel='web'and binding_id is null and binding_generation is null)or
  (channel='telegram'and session_id is null and binding_id is not null and binding_generation is not null and binding_generation>0));

alter table public.patient_care_visit_command_receipts
 add column channel text not null default 'web',
 add column binding_id uuid references public.telegram_auth_bindings(id),
 add column binding_generation bigint,
 alter column session_id drop not null,
 add constraint patient_care_visit_command_receipts_channel_provenance check(
  (channel='web'and session_id is not null and binding_id is null and binding_generation is null)or
  (channel='telegram'and session_id is null and binding_id is not null and binding_generation is not null and binding_generation>0));

alter table public.patient_coordination_receipts
 add column session_id uuid,
 add column channel text not null default 'web',
 add column binding_id uuid references public.telegram_auth_bindings(id),
 add column binding_generation bigint,
 add constraint patient_coordination_receipts_channel_provenance check(
  (channel='web'and binding_id is null and binding_generation is null)or
  (channel='telegram'and session_id is null and binding_id is not null and binding_generation is not null and binding_generation>0));

alter table public.nurse_visit_completions
 add column session_id uuid,
 add column channel text not null default 'web',
 add column binding_id uuid references public.telegram_auth_bindings(id),
 add column binding_generation bigint,
 add constraint nurse_visit_completions_channel_provenance check(
  (channel='web'and binding_id is null and binding_generation is null)or
  (channel='telegram'and session_id is null and binding_id is not null and binding_generation is not null and binding_generation>0));

-- Revoke/replacement takes the binding row FOR UPDATE before account/session work.
-- Take FOR SHARE on the same row first: a completed revocation is seen, and a
-- later revocation waits until this transaction ends. Recheck all mutable predicates
-- under row locks. No auth.uid(), JWT actor or caller-supplied identity is consulted.
create function public._telegram_nurse_authority(p_binding uuid,p_generation bigint)returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;s public.workspace_staff;i public.real_staff_invitations;
begin
 select * into b from public.telegram_auth_bindings where id=p_binding for share;
 if not found or b.kind<>'staff'or not b.active or b.revoked_at is not null or b.generation is distinct from p_generation then raise insufficient_privilege;end if;
 if exists(select 1 from public.telegram_auth_bindings x where x.auth_user_id=b.auth_user_id and(x.generation>b.generation or(x.active and x.id<>b.id)))then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=b.auth_user_id and(banned_until is null or banned_until<=clock_timestamp())for share;
 if not found then raise insufficient_privilege;end if;
 -- Invitations before staff, the order _real_staff_manage takes, so the two cannot deadlock.
 perform 1 from public.real_staff_invitations where expected_auth_user_id=b.auth_user_id for share;
 select * into i from public.real_staff_invitations where auth_user_id=b.auth_user_id for share;
 if found and(i.status<>'accepted'or i.accepted_at is null)then raise insufficient_privilege;end if;
 select t.* into s from public.workspace_staff t join public.workspace_clinics k on k.id=t.clinic_id
  where t.user_id=b.auth_user_id and t.role='nurse'and t.active and t.removed_at is null and k.active for share of t,k;
 if not found then raise insufficient_privilege;end if;
 -- The current own-contact staff binding supplies Telegram admission. Web session,
 -- password AMR and session admission remain solely in the unchanged web helpers.
 if not public._staff_signin_eligible(b.auth_user_id)then raise insufficient_privilege;end if;
 return s;
end$$;
revoke all on function public._telegram_nurse_authority(uuid,bigint)from public,anon,authenticated,service_role;

-- Keep the web nurse gate exactly where each body originally called it.
create function public._nurse_visit_nurse_as(p_actor uuid,p_binding uuid,p_generation bigint)returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 if p_binding is null then s:=public._nurse_visit_nurse();
 else s:=public._telegram_nurse_authority(p_binding,p_generation);end if;
 if s.user_id is distinct from p_actor then raise insufficient_privilege;end if;
 return s;
end$$;
revoke all on function public._nurse_visit_nurse_as(uuid,uuid,bigint)from public,anon,authenticated,service_role;

-- Volatile only on the Telegram path: STABLE web reads retain their snapshots.
-- The locked SELECT observes a reassignment committed while binding authorization
-- was waiting, rather than reusing the caller's older statement snapshot.
create function public._telegram_nurse_case_access(p_actor uuid,p_binding uuid,p_generation bigint,p_case uuid)returns boolean
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;c public.patient_clinical_cases;
begin
 s:=public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 select * into c from public.patient_clinical_cases where user_id=p_case for share;
 if not found or c.assigned_nurse_id is distinct from s.user_id then return false;end if;
 perform 1 from public.workspace_staff d where d.user_id=c.assigned_doctor_id and d.role='doctor'and d.active and d.clinic_id=s.clinic_id for share;
 return found;
end$$;
revoke all on function public._telegram_nurse_case_access(uuid,uuid,bigint,uuid)from public,anon,authenticated,service_role;


-- Source: 20261016215605_clinic_result_attach_part2.sql (patient_staff_lab_stage_command).
create function public._patient_staff_lab_stage_command_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;sub uuid;entry uuid;st text;occurred timestamptz;s public.workspace_staff;existing public.patient_care_lab_stages;
 collected timestamptz;atlab timestamptz;r bigint;sid uuid;
 bad constant jsonb:=jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('path','','message','Check the lab stage details')));
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','id','submissionId','entryId','stage','occurredAt']<>'{}'
  or not(p_command?&array['version','id','submissionId','entryId','stage','occurredAt'])or p_command->>'version'is distinct from 'lab-stage-v1'
  or coalesce(p_command->>'stage','')not in('at-lab','results-received')or jsonb_typeof(p_command->'occurredAt')is distinct from 'string'
  or p_command->>'occurredAt'!~'^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d+)?)?(Z|[+-]\d{2}:\d{2})$'then return bad;end if;
 begin
  m:=(p_command->>'id')::uuid;sub:=(p_command->>'submissionId')::uuid;entry:=(p_command->>'entryId')::uuid;
  occurred:=public._patient_visit_instant(p_command->>'occurredAt');
 exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return bad;end;
 st:=p_command->>'stage';
 if not isfinite(occurred)or occurred>clock_timestamp()+interval '5 minutes'then return bad;end if;
 perform pg_advisory_xact_lock(hashtextextended('patient-lab-stage:'||m::text||':'||entry::text,0));
 -- p_exclusive=true takes the case row FOR UPDATE NOWAIT before any check below,
 -- so this command and every attach/detach/move serialise on the case row.
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,false,true);
 if st='at-lab'and s.role is distinct from 'nurse'then raise insufficient_privilege;end if;
 select * into existing from public.patient_care_lab_stages where user_id=m and submission_id=sub;
 if found then
  if existing.collection_entry_id<>entry or existing.stage<>st or existing.occurred_at<>occurred or existing.actor_id is distinct from s.user_id then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','submissionId',sub,'stageId',existing.id,'revision',(select revision from public.patient_clinical_cases where user_id=m),'replayed',true);
 end if;
 select e.observed_instant into collected from public.patient_care_visit_entries e
  where e.id=entry and e.user_id=m and public._patient_lab_current_collection(e);
 if not found then return bad;end if;
 if(st='at-lab'and exists(select 1 from public.patient_care_lab_stages where collection_entry_id=entry and stage='at-lab'))
  or(st='results-received'and(public._patient_lab_active_result(entry)).id is not null)then return jsonb_build_object('status','stale');end if;
 if st='results-received'then
  select occurred_at into atlab from public.patient_care_lab_stages where collection_entry_id=entry and stage='at-lab';
  if not found or occurred<atlab then return bad;end if;
 elsif occurred<collected then return bad;
 end if;
 insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
  values(m,entry,st,sub,occurred,s.user_id,s.display_name,s.role,s.clinic_id)returning id into sid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,r,'care-evidence',s.user_id,jsonb_build_object('labStageId',sid,'entryId',entry,'stage',st,'submissionId',sub));
 return jsonb_build_object('status','saved','submissionId',sub,'stageId',sid,'revision',r,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;
revoke all on function public._patient_staff_lab_stage_command_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;

create or replace function public.patient_staff_lab_stage_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 return public._patient_staff_lab_stage_command_as(auth.uid(),null,null,p_command);
end$$;

-- Source: 20261018170600_nurse_visit_flow.sql (_nurse_visit_sync_lab).
create function public._nurse_visit_sync_lab_as(p_actor uuid,p_binding uuid,p_generation bigint,p_member uuid,p_visit uuid,p_at timestamptz)returns void
language plpgsql security definer set search_path=''as $$
declare e public.patient_care_visit_entries;res jsonb;
begin
 for e in select * from public.patient_care_visit_entries x where x.user_id=p_member and x.visit_id=p_visit and x.payload->>'kind'='collection'and x.payload->>'outcome'='collected'
  and public._patient_lab_current_collection(x)and not exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=x.id and s.stage='at-lab')order by x.position loop
  res:=public._patient_staff_lab_stage_command_as(p_actor,p_binding,p_generation,jsonb_build_object('version','lab-stage-v1','id',p_member,'submissionId',gen_random_uuid(),'entryId',e.id,'stage','at-lab',
   'occurredAt',public._nurse_visit_iso(greatest(p_at,e.observed_instant))));
  if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Lab stage was not saved';end if;
 end loop;
end$$;
revoke all on function public._nurse_visit_sync_lab_as(uuid,uuid,bigint,uuid,uuid,timestamptz)from public,anon,authenticated,service_role;

create or replace function public._nurse_visit_sync_lab(p_member uuid,p_visit uuid,p_at timestamptz)returns void
language plpgsql security definer set search_path=''as $$
begin
 perform public._nurse_visit_sync_lab_as(auth.uid(),null,null,p_member,p_visit,p_at);
end$$;

-- Source: 20261017201838_activity_log.sql (_access_audit_record).
create function public._access_audit_record_as(p_actor uuid,p_binding uuid,p_generation bigint,p_member uuid,p_surface text,p_object text default null)returns void
language plpgsql security definer set search_path=''as $$
declare a uuid:=p_actor;r text;
begin
 if p_binding is not null then perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);end if;
 if a is null or p_member is null or a=p_member then return;end if;
 select case when s.role='admin'then 'admin' when s.role='doctor'then 'doctor' when s.role='nurse'then 'nurse' else 'staff' end into r
  from public.workspace_staff s where s.user_id=a;
 if r is null and exists(select 1 from public.clinic_portal_memberships m where m.user_id=a)then r:='clinic';end if;
 if r is null then return;end if;
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id,channel,binding_id,binding_generation)
  values(a,r,p_member,p_surface,left(p_object,200),case when p_binding is null then left(auth.jwt()->>'session_id',80)end,case when p_binding is null then 'web'else 'telegram'end,p_binding,p_generation);
end$$;
revoke all on function public._access_audit_record_as(uuid,uuid,bigint,uuid,text,text)from public,anon,authenticated,service_role;

create or replace function public._access_audit_record(p_member uuid,p_surface text,p_object text default null)returns void
language plpgsql security definer set search_path=''as $$
begin
 perform public._access_audit_record_as(auth.uid(),null,null,p_member,p_surface,p_object);
end$$;

-- Source: 20261014150153_real_coordination_tasks.sql (patient_coordination_access).
create function public._patient_coordination_access_as(p_actor uuid,p_binding uuid,p_generation bigint,p_case uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare identity jsonb;
begin
 if p_binding is not null then
  perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
  return public._telegram_nurse_case_access(p_actor,p_binding,p_generation,p_case);
 end if;
 if auth.role() is distinct from 'authenticated' or p_actor is null then return false;end if;
 if not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=p_actor and (not_after is null or not_after>now())) then return false;end if;
 identity:=public.real_clinical_staff_identity();
 if identity is null then return false;end if;
 if identity->>'role'='admin' then return exists(select 1 from public.patient_clinical_cases where user_id=p_case);end if;
 return public.staff_care_access(p_case,p_actor,true);
end $$;
revoke all on function public._patient_coordination_access_as(uuid,uuid,bigint,uuid)from public,anon,authenticated,service_role;

create or replace function public.patient_coordination_access(p_case uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 return public._patient_coordination_access_as(auth.uid(),null,null,p_case);
end$$;

-- Source: 20261020195207_staff_session_admission_clinical_reads.sql (_patient_visit_authorize).
create function public._patient_visit_authorize_as(p_actor uuid,p_binding uuid,p_generation bigint,p_member uuid,p_write boolean,p_exclusive boolean)returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare actor uuid:=p_actor;s public.workspace_staff;sid uuid;d uuid;
begin
 if p_binding is null then
  if auth.role()is distinct from 'authenticated'or actor is null then raise insufficient_privilege;end if;
  sid:=(auth.jwt()->>'session_id')::uuid;if sid is null then raise insufficient_privilege;end if;
 else perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);end if;
 perform 1 from auth.users where id=p_member and phone is not null and phone_confirmed_at is not null for share nowait;
 if not found then raise insufficient_privilege;end if;
 if p_exclusive then select assigned_doctor_id into d from public.patient_clinical_cases where user_id=p_member for update nowait;
 else select assigned_doctor_id into d from public.patient_clinical_cases where user_id=p_member for share nowait;end if;
 if not found then raise insufficient_privilege;end if;
 perform 1 from public.workspace_staff t join public.workspace_clinics k on k.id=t.clinic_id where t.user_id=actor for share of t,k nowait;
 perform 1 from public.workspace_staff where user_id=d for share nowait;
 perform 1 from public.real_staff_invitations where auth_user_id=actor for share nowait;
 if p_binding is null then
 perform 1 from auth.sessions where id=sid and user_id=actor and(not_after is null or not_after>clock_timestamp())for share nowait;
 if not found then raise insufficient_privilege;end if;
 if not public._real_staff_managed_session_allowed(actor)then raise insufficient_privilege;end if;
 end if;
 select * into s from public.workspace_staff where user_id=actor;
 if s.role not in('nurse','doctor')or s.removed_at is not null or(p_write and s.role is distinct from 'nurse')or not(case when p_binding is null then public.staff_care_access(p_member,actor,true)else public._patient_coordination_access_as(p_actor,p_binding,p_generation,p_member)end)then raise insufficient_privilege;end if;
 return s;
exception when invalid_text_representation then raise insufficient_privilege;
end$$;
revoke all on function public._patient_visit_authorize_as(uuid,uuid,bigint,uuid,boolean,boolean)from public,anon,authenticated,service_role;

create or replace function public._patient_visit_authorize(p_member uuid,p_write boolean,p_exclusive boolean)returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
begin
 return public._patient_visit_authorize_as(auth.uid(),null,null,p_member,p_write,p_exclusive);
end$$;

-- Source: 20261016035421_patient_care_visit_evidence.sql (patient_staff_visit_command).
create function public._patient_staff_visit_command_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare p jsonb;m uuid;sub uuid;vid uuid;s public.workspace_staff;r bigint;receipt public.patient_care_visit_command_receipts;
 v public.patient_care_visits;b jsonb;e jsonb;ordinal bigint;eid uuid;ids jsonb:='[]';measurement uuid;sys jsonb;dia jsonb;pulse jsonb;result jsonb;stamp timestamptz;
begin
 perform set_config('lock_timeout','1500ms',true);
 p:=public._patient_visit_command(p_command);
 if p is null then return jsonb_build_object('status','invalid','issues',jsonb_build_array(jsonb_build_object('path','','message','Check the visit command and factual entries')));end if;
 m:=(p->>'id')::uuid;sub:=(p->>'submissionId')::uuid;vid:=(p->>'visitId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended('patient-visit-command:'||m::text||':'||sub::text,0));
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,true);
 select * into receipt from public.patient_care_visit_command_receipts where user_id=m and submission_id=sub;
 if found then
  if receipt.actor_id is distinct from s.user_id or receipt.command is distinct from p then return jsonb_build_object('status','stale');end if;
  if receipt.state='retired'then return jsonb_build_object('status','stale');end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 select revision into r from public.patient_clinical_cases where user_id=m;
 if r is distinct from(p->>'revision')::numeric::bigint then return jsonb_build_object('status','stale');end if;
 if p->>'op'='open-visit'then
  if exists(select 1 from public.patient_care_visits where id=vid)then return jsonb_build_object('status','stale');end if;
  if p->'booking'<>'null'::jsonb then
   b:=public._patient_visit_booking(m,(p#>>'{booking,appointmentId}')::uuid);
   if b->>'availability'is distinct from 'available'or (b#>>'{context,acceptedRevision}')::numeric is distinct from (p#>>'{booking,acceptedRevision}')::numeric then return jsonb_build_object('status','stale');end if;
  end if;
  insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context)
   values(vid,m,s.user_id,s.display_name,s.role,s.clinic_id,(p#>>'{booking,appointmentId}')::uuid,(p#>>'{booking,acceptedRevision}')::numeric::bigint,b->'context');
 else
  select * into v from public.patient_care_visits where id=vid and user_id=m;
  if not found then return jsonb_build_object('status','stale');end if;
  if exists(select 1 from jsonb_array_elements(p->'entries')x where x->>'kind'='collection')then
   if v.booking_context is null then return jsonb_build_object('status','stale');end if;
   b:=public._patient_visit_booking(m,v.appointment_id);
   if b->>'availability'is distinct from 'available'or b->'context'is distinct from v.booking_context then return jsonb_build_object('status','stale');end if;
   for e in select value from jsonb_array_elements(p->'entries')where value->>'kind'='collection'loop
    if(e->>'appointmentId')::uuid<>v.appointment_id or(e->>'acceptedRevision')::numeric::bigint<>v.accepted_revision
     or not exists(select 1 from jsonb_array_elements(v.booking_context->'tests')t where t->>'id'=e->>'testId')then return jsonb_build_object('status','stale');end if;
   end loop;
  end if;
  select value into sys from jsonb_array_elements(p->'entries')where value->>'kind'='observation'and value->>'field'='systolic'and value->>'state'='known';
  select value into dia from jsonb_array_elements(p->'entries')where value->>'kind'='observation'and value->>'field'='diastolic'and value->>'state'='known';
  if sys is not null and dia is not null then
   stamp:=public._patient_visit_instant(sys->>'observedAt');
   select value into pulse from jsonb_array_elements(p->'entries')where value->>'kind'='observation'and value->>'field'='pulse'and value->>'state'='known'and public._patient_visit_instant(value->>'observedAt')=stamp;
   insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)
    values(m,sub,(sys->>'value')::numeric::integer,(dia->>'value')::numeric::integer,(pulse->>'value')::numeric::integer,stamp)returning id into measurement;
  end if;
  for e,ordinal in select value,ordinality from jsonb_array_elements(p->'entries')with ordinality loop
   insert into public.patient_care_visit_entries(user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id,measurement_id)
    values(m,vid,sub,ordinal,e,e->>'observedAt',public._patient_visit_instant(e->>'observedAt'),s.user_id,s.display_name,s.role,s.clinic_id,
    case when measurement is not null and e->>'kind'='observation'and e->>'state'='known'and e->>'field'in('systolic','diastolic','pulse')and public._patient_visit_instant(e->>'observedAt')=stamp then measurement end)returning id into eid;
   ids:=ids||to_jsonb(eid);
  end loop;
 end if;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)values(m,r,'care-evidence',s.user_id,jsonb_build_object('visitId',vid,'submissionId',sub,'operation',p->>'op','entryIds',ids,'measurementId',measurement));
 result:=jsonb_build_object('status','saved','submissionId',sub,'visitId',vid,'revision',r,'entryIds',ids,'replayed',false);
 insert into public.patient_care_visit_command_receipts(user_id,submission_id,actor_id,session_id,command,state,result,channel,binding_id,binding_generation)
 values(m,sub,s.user_id,case when p_binding is null then (auth.jwt()->>'session_id')::uuid end,p,'committed',result,case when p_binding is null then 'web'else 'telegram'end,p_binding,p_generation);
 return result;
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;
revoke all on function public._patient_staff_visit_command_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;

create or replace function public.patient_staff_visit_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 return public._patient_staff_visit_command_as(auth.uid(),null,null,p_command);
end$$;

-- Source: 20261014154149_coordination_queue_paging_and_replay_authority.sql (patient_coordination_queue).
create function public._patient_coordination_queue_as(p_actor uuid,p_binding uuid,p_generation bigint,p_case uuid default null,p_filter text default 'active',p_after_created_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb;has_more boolean;cursor jsonb;
begin
 if p_filter is null or p_filter not in ('active','all','open','awaiting-member','awaiting-doctor','completed','cancelled','reassign') or p_limit is null or p_limit not between 1 and 100 or (p_after_created_at is null) is distinct from (p_after_id is null) or (p_after_created_at is not null and not isfinite(p_after_created_at)) then raise check_violation using message='Check the task page';end if;
 if (p_binding is null and auth.uid() is null) or (case when p_binding is null then public.real_clinical_staff_identity()else to_jsonb(public._nurse_visit_nurse_as(p_actor,p_binding,p_generation))end) is null then raise insufficient_privilege using message='Current staff access required';end if;
 if p_case is not null and not public._patient_coordination_access_as(p_actor,p_binding,p_generation,p_case) then raise insufficient_privilege using message='Current case access required';end if;
 with authorized as (
  select t.* from public.patient_coordination_tasks t where (p_case is null or t.patient_case_id=p_case)
   and public._patient_coordination_access_as(p_actor,p_binding,p_generation,t.patient_case_id)
   and (p_filter='all' or (p_filter='active' and t.status not in ('completed','cancelled')) or t.status=p_filter or (p_filter='reassign' and t.status not in ('completed','cancelled') and not public._patient_coordination_owner_valid(t.patient_case_id,t.owner_id,t.kind='doctor-referral')))
   and (p_after_id is null or (t.created_at,t.id)>(p_after_created_at,p_after_id)) order by t.created_at,t.id limit p_limit+1
 ), numbered as(select a.*,row_number() over(order by created_at,id) rn from authorized a)
 select coalesce(jsonb_agg(public._patient_coordination_task_json((n.id,n.patient_case_id,n.kind,n.title,n.instructions,n.due_at,n.creator_id,n.owner_id,n.status,n.revision,n.created_at,n.updated_at)::public.patient_coordination_tasks) order by n.created_at,n.id) filter(where rn<=p_limit),'[]'),count(*)>p_limit,
  (jsonb_agg(jsonb_build_object('createdAt',created_at,'id',id)) filter(where rn=p_limit))->0 into rows,has_more,cursor from numbered n;
 return jsonb_build_object('tasks',rows,'nextCursor',case when has_more then cursor else null end);
end $$;
revoke all on function public._patient_coordination_queue_as(uuid,uuid,bigint,uuid,text,timestamptz,uuid,integer)from public,anon,authenticated,service_role;

create or replace function public.patient_coordination_queue(p_case uuid default null,p_filter text default 'active',p_after_created_at timestamptz default null,p_after_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 return public._patient_coordination_queue_as(auth.uid(),null,null,p_case,p_filter,p_after_created_at,p_after_id,p_limit);
end$$;

-- Source: 20261014150153_real_coordination_tasks.sql (patient_coordination_snapshot_unlogged).
create function public._patient_coordination_snapshot_unlogged_as(p_actor uuid,p_binding uuid,p_generation bigint,p_task uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.patient_coordination_tasks;
begin
 select * into t from public.patient_coordination_tasks where id=p_task;
 if not found or not public._patient_coordination_access_as(p_actor,p_binding,p_generation,t.patient_case_id) then raise insufficient_privilege using message='Current case access required';end if;
 return public._patient_coordination_task_json(t)||jsonb_build_object('events',(select coalesce(jsonb_agg(to_jsonb(e)-'task_id' order by e.revision desc),'[]') from (select * from public.patient_coordination_events where task_id=p_task order by revision desc limit 100) e));
end $$;
revoke all on function public._patient_coordination_snapshot_unlogged_as(uuid,uuid,bigint,uuid)from public,anon,authenticated,service_role;

create or replace function public.patient_coordination_snapshot_unlogged(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 return public._patient_coordination_snapshot_unlogged_as(auth.uid(),null,null,p_task);
end$$;

-- Source: 20261017201838_activity_log.sql (patient_coordination_snapshot).
create function public._patient_coordination_snapshot_as(p_actor uuid,p_binding uuid,p_generation bigint,p_task uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare r jsonb:=public._patient_coordination_snapshot_unlogged_as(p_actor,p_binding,p_generation,p_task);
begin if r is not null and coalesce(r->>'enabled','true')<>'false' then perform public._access_audit_record_as(p_actor,p_binding,p_generation,(select patient_case_id from public.patient_coordination_tasks where id=p_task),'member_coordination',p_task::text);end if;return r;end$$;
revoke all on function public._patient_coordination_snapshot_as(uuid,uuid,bigint,uuid)from public,anon,authenticated,service_role;

create or replace function public.patient_coordination_snapshot(p_task uuid)returns jsonb language plpgsql security definer set search_path=''as $$
begin
 return public._patient_coordination_snapshot_as(auth.uid(),null,null,p_task);
end$$;

-- Source: 20261014154149_coordination_queue_paging_and_replay_authority.sql (patient_coordination_command_before_nurse_handoffs).
create function public._patient_coordination_command_before_nurse_handoffs_as(p_actor uuid,p_binding uuid,p_generation bigint,p_case uuid,p_task uuid,p_expected_revision bigint,p_request uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 c public.patient_clinical_cases;t public.patient_coordination_tasks;before_task public.patient_coordination_tasks;
 actor public.workspace_staff;owner uuid;title_value text;instructions_value text;note_value text;kind_value text;outcome text;due_value timestamptz;
 keys text[];normalized jsonb;receipt public.patient_coordination_receipts;result jsonb;care_note uuid;
begin
 if p_case is null or p_task is null or p_request is null or p_expected_revision is null or p_expected_revision<0 or p_input is null or jsonb_typeof(p_input)<>'object' then raise check_violation using message='Check the task details';end if;
 keys:=case p_operation when 'create' then array['kind','title','instructions','dueAt','ownerId'] when 'edit' then array['title','instructions','dueAt'] when 'reassign' then array['ownerId'] when 'contact' then array['outcome','note'] when 'await-member' then array[]::text[] when 'reopen' then array[]::text[] when 'complete' then array['note'] when 'refer' then array['note'] when 'resolve' then array['note'] when 'cancel' then array['note'] else null end;
 if keys is null or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(keys)) then raise check_violation using message='Task operation unavailable';end if;
 if exists(select 1 from jsonb_each(p_input) e where e.key<>'dueAt' and jsonb_typeof(e.value)<>'string') or (p_input ? 'dueAt' and jsonb_typeof(p_input->'dueAt') not in ('string','null')) then raise check_violation using message='Check the task details';end if;
 title_value:=btrim(p_input->>'title');instructions_value:=btrim(p_input->>'instructions');note_value:=btrim(p_input->>'note');kind_value:=p_input->>'kind';outcome:=p_input->>'outcome';
 if p_operation in ('create','edit') then
  if title_value is null or length(title_value) not between 1 and 160 or instructions_value is null or length(instructions_value) not between 1 and 2000 then raise check_violation using message='Enter a task title and instructions';end if;
  if p_input->>'dueAt' is not null then due_value:=(p_input->>'dueAt')::timestamptz;if not isfinite(due_value) then raise check_violation using message='Enter a finite due time';end if;end if;
 end if;
 if p_operation in ('create','reassign') then owner:=(p_input->>'ownerId')::uuid;if owner is null then raise check_violation using message='Choose an assigned owner';end if;end if;
 if p_operation='create' and (kind_value is null or kind_value not in ('contact-followup','evidence-collection','booking-coordination','doctor-referral')) then raise check_violation using message='Choose an operational task kind';end if;
 if p_operation in ('contact','complete','refer','resolve','cancel') and (note_value is null or length(note_value) not between 1 and 2000) then raise check_violation using message='Enter a note or reason';end if;
 if p_operation='contact' and (outcome is null or outcome not in ('contact-attempted','reached','unreachable')) then raise check_violation using message='Choose a contact outcome';end if;
 normalized:=jsonb_build_object('caseId',p_case,'taskId',p_task,'revision',p_expected_revision,'operation',p_operation,'input',p_input||case when title_value is null then '{}'::jsonb else jsonb_build_object('title',title_value,'instructions',instructions_value,'dueAt',due_value) end||case when note_value is null then '{}'::jsonb else jsonb_build_object('note',note_value) end);
 if (p_binding is null and(auth.role() is distinct from 'authenticated' or auth.uid() is null)) or (case when p_binding is null then public.real_clinical_staff_identity()else to_jsonb(public._nurse_visit_nurse_as(p_actor,p_binding,p_generation))end) is null then raise insufficient_privilege using message='Current staff access required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('noreon:coordination:'||p_request::text,0));
 perform 1 from auth.users where id=p_case and phone is not null and phone_confirmed_at is not null for share;
 if not found then raise insufficient_privilege using message='Verified member required';end if;
 select * into c from public.patient_clinical_cases where user_id=p_case for update;
 if not found then raise insufficient_privilege using message='Current case access required';end if;
 select * into t from public.patient_coordination_tasks where id=p_task for update;
 before_task:=t;
 if t.id is not null and t.patient_case_id is distinct from p_case then raise insufficient_privilege using message='Current case access required';end if;
 perform 1 from public.workspace_staff where user_id=any(array[p_actor,owner,t.owner_id,c.assigned_doctor_id,c.assigned_nurse_id]) order by user_id for share;
 perform 1 from public.workspace_clinics where id in (select clinic_id from public.workspace_staff where user_id=any(array[p_actor,owner,t.owner_id,c.assigned_doctor_id,c.assigned_nurse_id])) order by id for share;
 if not public._patient_coordination_access_as(p_actor,p_binding,p_generation,p_case) then raise insufficient_privilege using message='Current case access required';end if;
 if p_binding is null then
 perform 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and (not_after is null or not_after>now()) for share;
 if not found or not public._patient_coordination_access_as(p_actor,p_binding,p_generation,p_case) then raise insufficient_privilege using message='Current staff session required';end if;
 end if;
 select * into actor from public.workspace_staff where user_id=p_actor;
 -- Current command authority is required even for an immutable receipt replay.
 if p_operation in ('create','edit','reassign') and actor.role not in ('admin','doctor') then raise insufficient_privilege using message='Administrator or assigned doctor required';end if;
 if p_operation in ('contact','refer') and actor.role not in ('nurse','doctor') then raise insufficient_privilege using message='Assigned nurse or doctor required';end if;
 if p_operation='resolve' and (actor.role<>'doctor' or actor.user_id is distinct from c.assigned_doctor_id or t.owner_id is distinct from actor.user_id) then raise insufficient_privilege using message='Assigned doctor resolution required';end if;
 if p_operation='cancel' and actor.role not in ('admin','doctor') and (actor.user_id is distinct from t.creator_id or not public._patient_coordination_owner_valid(p_case,t.owner_id,t.kind='doctor-referral')) then raise insufficient_privilege using message='Current cancellation authority required';end if;
 select * into receipt from public.patient_coordination_receipts where request_id=p_request;
 if found then
  if receipt.actor_id is distinct from actor.user_id or receipt.patient_case_id is distinct from p_case or receipt.input is distinct from normalized then raise serialization_failure using message='Task request changed';end if;
  return receipt.result;
 end if;
 if p_operation='create' then
  if actor.role not in ('admin','doctor') then raise insufficient_privilege using message='Administrator or assigned doctor required';end if;
  if t.id is not null or p_expected_revision<>0 then raise serialization_failure using message='Task changed';end if;
  if not public._patient_coordination_owner_valid(p_case,owner,kind_value='doctor-referral') then raise insufficient_privilege using message='Choose the current assigned doctor or nurse';end if;
  insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,due_at,creator_id,owner_id) values(p_task,p_case,kind_value,title_value,instructions_value,due_value,actor.user_id,owner) returning * into t;
 else
  if t.id is null or t.revision<>p_expected_revision then raise serialization_failure using message='Task changed';end if;
  if t.status in ('completed','cancelled') then raise check_violation using message='This task is closed';end if;
  -- Reassign and reason-required admin/doctor cancellation may repair or close stale ownership. Other operations fail closed.
  if p_operation not in ('reassign','cancel') and not public._patient_coordination_owner_valid(p_case,t.owner_id,t.kind='doctor-referral') then raise insufficient_privilege using message='Task needs owner reassignment';end if;
  if p_operation in ('edit','reassign') then
   if actor.role not in ('admin','doctor') then raise insufficient_privilege using message='Administrator or assigned doctor required';end if;
   if p_operation='edit' then t.title:=title_value;t.instructions:=instructions_value;t.due_at:=due_value;
   else if not public._patient_coordination_owner_valid(p_case,owner,t.kind='doctor-referral') then raise insufficient_privilege using message='Choose the current assigned doctor or nurse';end if;t.owner_id:=owner;end if;
  elsif p_operation='contact' then
   if actor.role not in ('nurse','doctor') then raise insufficient_privilege using message='Assigned nurse or doctor required';end if;
  elsif p_operation in ('await-member','reopen','complete') then
   if t.kind='doctor-referral' or t.status not in ('open','awaiting-member') then raise check_violation using message='Use the doctor referral pathway';end if;
   if (p_operation='await-member' and t.status<>'open') or (p_operation='reopen' and t.status<>'awaiting-member') then raise check_violation using message='Task state changed';end if;
   t.status:=case p_operation when 'await-member' then 'awaiting-member' when 'reopen' then 'open' else 'completed' end;
  elsif p_operation='refer' then
   if actor.role not in ('nurse','doctor') then raise insufficient_privilege using message='Assigned nurse or doctor required';end if;
   if t.kind<>'doctor-referral' or t.status<>'open' then raise check_violation using message='Open doctor referral required';end if;
   if not public._patient_coordination_owner_valid(p_case,c.assigned_doctor_id,true) then raise insufficient_privilege using message='Current assigned doctor required';end if;
   t.status:='awaiting-doctor';t.owner_id:=c.assigned_doctor_id;
   insert into public.staff_care_notes(patient_case_id,actor_id,actor_name,actor_role,kind,note,detail) values(p_case,actor.user_id,actor.display_name,actor.role,'refer-doctor',note_value,jsonb_build_object('coordinationTaskId',t.id,'requestId',p_request)) returning id into care_note;
  elsif p_operation='resolve' then
   if actor.role<>'doctor' or actor.user_id is distinct from c.assigned_doctor_id or t.owner_id is distinct from actor.user_id then raise insufficient_privilege using message='Assigned doctor resolution required';end if;
   if t.kind<>'doctor-referral' or t.status<>'awaiting-doctor' then raise check_violation using message='Awaiting doctor referral required';end if;t.status:='completed';
  elsif p_operation='cancel' then
   if actor.role not in ('admin','doctor') and actor.user_id is distinct from t.creator_id then raise insufficient_privilege using message='Creator with current access, administrator or assigned doctor required';end if;t.status:='cancelled';
  end if;
  update public.patient_coordination_tasks set title=t.title,instructions=t.instructions,due_at=t.due_at,owner_id=t.owner_id,status=t.status,revision=revision+1,updated_at=clock_timestamp() where id=p_task returning * into t;
 end if;
 insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,old_status,new_status,old_owner_id,new_owner_id,note,care_note_id,detail)
 values(t.id,t.revision,p_request,actor.user_id,actor.display_name,actor.role,p_operation,before_task.status,t.status,before_task.owner_id,t.owner_id,coalesce(note_value,''),care_note,jsonb_build_object('input',normalized->'input','before',case when before_task.id is null then null else jsonb_build_object('title',before_task.title,'instructions',before_task.instructions,'dueAt',before_task.due_at) end));
 result:=jsonb_build_object('id',t.id,'revision',t.revision,'status',t.status);
 insert into public.patient_coordination_receipts(request_id,actor_id,patient_case_id,input,result,session_id,channel,binding_id,binding_generation) values(p_request,actor.user_id,p_case,normalized,result,case when p_binding is null then (auth.jwt()->>'session_id')::uuid end,case when p_binding is null then 'web'else 'telegram'end,p_binding,p_generation);
 return result;
end $$;
revoke all on function public._patient_coordination_command_before_nurse_handoffs_as(uuid,uuid,bigint,uuid,uuid,bigint,uuid,text,jsonb)from public,anon,authenticated,service_role;

create or replace function public.patient_coordination_command_before_nurse_handoffs(p_case uuid,p_task uuid,p_expected_revision bigint,p_request uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 return public._patient_coordination_command_before_nurse_handoffs_as(auth.uid(),null,null,p_case,p_task,p_expected_revision,p_request,p_operation,p_input);
end$$;

-- Source: 20261031233500_nurse_chat_handoffs.sql (patient_coordination_command).
create function public._patient_coordination_command_as(p_actor uuid,p_binding uuid,p_generation bigint,p_case uuid,p_task uuid,p_expected_revision bigint,p_request uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare t public.patient_coordination_tasks;
begin
 if (case when p_binding is null then public.real_clinical_staff_identity()else to_jsonb(public._nurse_visit_nurse_as(p_actor,p_binding,p_generation))end)->>'role'='nurse'and p_operation='cancel'then
  -- Match the underlying lock order; check before receipt replay too.
  perform pg_advisory_xact_lock(hashtextextended('noreon:coordination:'||p_request::text,0));
  perform 1 from auth.users where id=p_case for share;
  perform 1 from public.patient_clinical_cases where user_id=p_case for update;
  select * into t from public.patient_coordination_tasks where id=p_task and patient_case_id=p_case for update;
  if exists(select 1 from public.conversation_nurse_handoffs where task_id=t.id)then
   raise insufficient_privilege using message='Assigned doctor required to cancel a nurse handoff';
  end if;
 end if;
 return public._patient_coordination_command_before_nurse_handoffs_as(p_actor,p_binding,p_generation,p_case,p_task,p_expected_revision,p_request,p_operation,p_input);
end$$;
revoke all on function public._patient_coordination_command_as(uuid,uuid,bigint,uuid,uuid,bigint,uuid,text,jsonb)from public,anon,authenticated,service_role;

create or replace function public.patient_coordination_command(p_case uuid,p_task uuid,p_expected_revision bigint,p_request uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 return public._patient_coordination_command_as(auth.uid(),null,null,p_case,p_task,p_expected_revision,p_request,p_operation,p_input);
end$$;

-- Source: 20261029114618_nurse_visit_qa151_155.sql (nurse_visit_list).
create function public._nurse_visit_list_as(p_actor uuid,p_binding uuid,p_generation bigint)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare actor uuid;admin boolean:=case when p_binding is null then public._nurse_visit_is_admin()else false end;today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
begin
 if admin then actor:=null;else actor:=(public._nurse_visit_nurse_as(p_actor,p_binding,p_generation)).user_id;end if;
 if not public._nurse_visit_enabled()then return jsonb_build_object('version','nurse-visit-v1','enabled',false,'visits','[]'::jsonb);end if;
 return jsonb_build_object('version','nurse-visit-v1','enabled',true,'today',today,'role',case when admin then 'admin'else 'nurse'end,'visits',coalesce((
  select jsonb_agg(v||(select jsonb_build_object('samplesPlanned',c->'samplesPlanned','samplesTaken',c->'samplesTaken','openItems',jsonb_array_length(c->'openItems'))
   from public._nurse_visit_counts(public._nurse_visit_items_marked(v->>'source',(v->>'id')::uuid,false))c)
   ||jsonb_build_object('steps',public._nurse_visit_events(v->>'source',(v->>'id')::uuid,true),
    'nurseName',(select ws.display_name from public.patient_clinical_cases pc join public.workspace_staff ws on ws.user_id=pc.assigned_nurse_id where pc.user_id=(v->>'memberId')::uuid))
   order by v->>'startsAt',v->>'id')
  from(
   select public._nurse_visit_row('home-request',r.id)v from public.patient_test_requests r join public.patient_clinical_cases pc on pc.user_id=r.user_id
    where(admin or pc.assigned_nurse_id=actor)and r.status in('confirmed','completed')and r.current_arrangement#>>'{terms,mode}'='home'
   union all
   select public._nurse_visit_row('appointment',a.id)from public.booking_appointments a join public.patient_clinical_cases pc on pc.user_id=a.member_id
    where(admin or pc.assigned_nurse_id=actor)and a.status='confirmed'and a.current_arrangement is not null and a.current_reservation_id is not null
  )x
  -- QA 151: the same member rule as the detail (_patient_visit_authorize), so every listed visit opens.
  where v is not null and(admin or((case when p_binding is null then public.staff_care_access((v->>'memberId')::uuid,actor,true)else public._patient_coordination_access_as(p_actor,p_binding,p_generation,(v->>'memberId')::uuid)end)
   and exists(select 1 from auth.users u where u.id=(v->>'memberId')::uuid and u.phone is not null and u.phone_confirmed_at is not null)))
   and((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date between today-14 and today+60
   and(v->'completion'='null'::jsonb or((v#>>'{completion,completedAt}')::timestamptz at time zone 'Asia/Yerevan')::date>=today-7)),'[]'::jsonb));
end$$;
revoke all on function public._nurse_visit_list_as(uuid,uuid,bigint)from public,anon,authenticated,service_role;

create or replace function public.nurse_visit_list()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 return public._nurse_visit_list_as(auth.uid(),null,null);
end$$;

-- Source: 20261018170600_nurse_visit_flow.sql (nurse_visit_detail).
create function public._nurse_visit_detail_as(p_actor uuid,p_binding uuid,p_generation bigint,p_member uuid,p_source text,p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare v jsonb;items jsonb;c public.nurse_visit_completions;
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 perform public._patient_visit_authorize_as(p_actor,p_binding,p_generation,p_member,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('version','nurse-visit-v1','enabled',false);end if;
 v:=public._nurse_visit_row(p_source,p_id);
 if v is null or(v->>'memberId')::uuid is distinct from p_member then raise insufficient_privilege;end if;
 items:=public._nurse_visit_items_marked(p_source,p_id);
 select * into c from public.nurse_visit_completions where source=p_source and source_id=p_id;
 perform public._access_audit_record_as(p_actor,p_binding,p_generation,p_member,'member_nurse_visit',p_id::text);
 return jsonb_build_object('version','nurse-visit-v1','enabled',true,'visit',v,'items',items,'counts',public._nurse_visit_counts(items),
  'steps',public._nurse_visit_events(p_source,p_id,true),'checklistVersion',(select checklist_version from public.nurse_visit_settings where singleton),
  'caseRevision',(select revision from public.patient_clinical_cases where user_id=p_member),
  'today',(clock_timestamp()at time zone 'Asia/Yerevan')::date,
  'completion',case when c.id is null then null else jsonb_build_object('completedAt',c.completed_at,'nurseName',c.actor_name,'reason',c.reason,'summary',c.summary,'visitId',c.visit_id)end);
exception when insufficient_privilege then return jsonb_build_object('version','nurse-visit-v1','status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('version','nurse-visit-v1','status','unavailable');
end$$;
revoke all on function public._nurse_visit_detail_as(uuid,uuid,bigint,uuid,text,uuid)from public,anon,authenticated,service_role;

create or replace function public.nurse_visit_detail(p_member uuid,p_source text,p_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 return public._nurse_visit_detail_as(auth.uid(),null,null,p_member,p_source,p_id);
end$$;

-- Source: 20261029114618_nurse_visit_qa151_155.sql (nurse_visit_mark).
create function public._nurse_visit_mark_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;item text;done boolean;note text;vals jsonb;s public.workspace_staff;v jsonb;prior public.nurse_visit_marks;r bigint;mid uuid;cv text;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','item','done','note','values'])
  or p_command-array['version','memberId','source','sourceId','submissionId','item','done','note','values','startsAt','checklistVersion']<>'{}'
  or jsonb_typeof(p_command->'done')is distinct from 'boolean'or jsonb_typeof(p_command->'item')is distinct from 'string'
  or jsonb_typeof(p_command->'note')not in('null','string')or jsonb_typeof(p_command->'values')not in('null','object')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';item:=p_command->>'item';done:=(p_command->>'done')::boolean;
 note:=nullif(btrim(p_command->>'note'),'');vals:=nullif(p_command->'values','null'::jsonb);
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or(note is not null and length(note)>1000)then return bad;end if;
 if item='measure:bp'and done then
  if vals is null or vals-array['systolic','diastolic','pulse']<>'{}'or not(vals?&array['systolic','diastolic','pulse'])
   or not public._nurse_visit_number(vals->'systolic',60,300,true)or not public._nurse_visit_number(vals->'diastolic',30,200,true)
   or(vals->>'systolic')::numeric<=(vals->>'diastolic')::numeric
   or(vals->'pulse'<>'null'::jsonb and not public._nurse_visit_number(vals->'pulse',20,250,true))then return bad;end if;
 elsif item in('measure:weight','measure:waist')and done then
  if vals is null or vals-array['value']<>'{}'or not public._nurse_visit_number(vals->'value',case when item='measure:weight'then 20 else 30 end,case when item='measure:weight'then 400 else 250 end,false)then return bad;end if;
 elsif vals is not null then return bad;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_marks where member_id=m and submission_id=sub;
 if found then
  if prior.source<>src or prior.source_id<>sid or prior.item<>item or prior.done<>done or prior.note is distinct from note or prior.vals is distinct from vals or prior.actor_id<>s.user_id then
   return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','markId',prior.id,'submissionId',sub,'replayed',true);
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 if p_command?'startsAt'then
  begin
   if jsonb_typeof(p_command->'startsAt')is distinct from 'string'then return bad;end if;
   if(p_command->>'startsAt')::timestamptz is distinct from(v->>'startsAt')::timestamptz then return jsonb_build_object('status','stale');end if;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_parameter_value then return bad;end;
 end if;
 if v->'completion'<>'null'::jsonb then return jsonb_build_object('status','completed');end if;
 -- QA 155: items are recorded on or after the visit day (Yerevan), like the arrival step.
 if((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 select i->>'version'into cv from jsonb_array_elements(public._nurse_visit_items(src,sid))i where i->>'key'=item;
 if not found then return jsonb_build_object('status','stale');end if;
 if item like 'check:%'and p_command?'checklistVersion'and(p_command->>'checklistVersion')is distinct from cv then return jsonb_build_object('status','stale');end if;
 insert into public.nurse_visit_marks(member_id,source,source_id,item,done,note,vals,checklist_version,submission_id,actor_id,actor_name)
  values(m,src,sid,item,done,note,vals,cv,sub,s.user_id,s.display_name)returning id into mid;
 update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=m returning revision into r;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(m,r,'care-evidence',s.user_id,jsonb_build_object('nurseVisit','mark','source',src,'sourceId',sid,'item',item,'done',done,'commented',note is not null,'markId',mid,'submissionId',sub));
 return jsonb_build_object('status','saved','markId',mid,'submissionId',sub,'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public._nurse_visit_mark_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;

create or replace function public.nurse_visit_mark(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 return public._nurse_visit_mark_as(auth.uid(),null,null,p_command);
end$$;

-- Source: 20261018170600_nurse_visit_flow.sql (nurse_visit_step).
create function public._nurse_visit_step_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;st text;s public.workspace_staff;v jsonb;prior public.nurse_visit_events;eid uuid;vid uuid;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','step'])or p_command-array['version','memberId','source','sourceId','submissionId','step']<>'{}'
  or coalesce(p_command->>'step','')not in('confirmed','started','samples-collected','samples-at-lab')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';st:=p_command->>'step';
 if src not in('home-request','appointment')or m is null or sid is null or sub is null then return bad;end if;
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_events where member_id=m and submission_id=sub;
 if found then
  if prior.source<>src or prior.source_id<>sid or prior.step<>st or prior.actor_id<>s.user_id then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','eventId',prior.id,'submissionId',sub,'occurredAt',prior.occurred_at,'replayed',true);
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 select * into prior from public.nurse_visit_events where source=src and source_id=sid and step=st and arrangement=(v->>'startsAt')::timestamptz;
 if found then return jsonb_build_object('status','already-recorded','occurredAt',prior.occurred_at);end if;
 if v->'completion'<>'null'::jsonb and st<>'samples-at-lab'then return jsonb_build_object('status','completed');end if;
 if st in('started','samples-collected')and((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 if st='samples-collected'and not exists(select 1 from jsonb_array_elements(public._nurse_visit_items_marked(src,sid))i where i->>'kind'='sample'and i#>>'{mark,done}'='true')then
  return jsonb_build_object('status','no-samples');end if;
 if st='samples-at-lab'and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  return jsonb_build_object('status','no-samples');end if;
 -- A completed slot-booking visit hands over the current samples it recorded; none is refused (review F1).
 select visit_id into vid from public.nurse_visit_completions where source=src and source_id=sid;
 if st='samples-at-lab'and src='appointment'and vid is not null and not exists(select 1 from public.patient_care_visit_entries x
  where x.user_id=m and x.visit_id=vid and x.payload->>'kind'='collection'and x.payload->>'outcome'='collected'
  and public._patient_lab_current_collection(x))then
  -- Only current samples count: a later "not collected" correction supersedes an earlier entry (Codex F1 re-check).
  return jsonb_build_object('status','no-lab-entries');end if;
 eid:=public._nurse_visit_record_step(m,src,sid,st,sub,s);
 if st='samples-at-lab'and vid is not null then perform public._nurse_visit_sync_lab_as(p_actor,p_binding,p_generation,m,vid,clock_timestamp());end if;
 return jsonb_build_object('status','saved','eventId',eid,'submissionId',sub,'occurredAt',(select occurred_at from public.nurse_visit_events where id=eid),'replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public._nurse_visit_step_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;

create or replace function public.nurse_visit_step(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 return public._nurse_visit_step_as(auth.uid(),null,null,p_command);
end$$;

-- Source: 20261021070106_clinic_plan_audit_fixes.sql (nurse_visit_complete).
create function public._nurse_visit_complete_as(p_actor uuid,p_binding uuid,p_generation bigint,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;src text;sid uuid;sub uuid;vid uuid;oid uuid;aid uuid;reason text;s public.workspace_staff;v jsonb;items jsonb;counts jsonb;
 prior public.nurse_visit_completions;rq public.patient_test_requests;b jsonb;booking jsonb;res jsonb;entries jsonb:='[]';i jsonb;bp public.nurse_visit_marks;k public.nurse_visit_marks;
 stamp text:=public._nurse_visit_iso(clock_timestamp());result jsonb;r bigint;canonical jsonb;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'nurse-visit-v1'
  or not(p_command?&array['memberId','source','sourceId','submissionId','visitId','openSubmissionId','appendSubmissionId','reason'])
  or p_command-array['version','memberId','source','sourceId','submissionId','visitId','openSubmissionId','appendSubmissionId','reason']<>'{}'
  or jsonb_typeof(p_command->'reason')not in('null','string')then return bad;end if;
 begin
  m:=(p_command->>'memberId')::uuid;sid:=(p_command->>'sourceId')::uuid;sub:=(p_command->>'submissionId')::uuid;
  vid:=(p_command->>'visitId')::uuid;oid:=(p_command->>'openSubmissionId')::uuid;aid:=(p_command->>'appendSubmissionId')::uuid;
 exception when invalid_text_representation then return bad;end;
 src:=p_command->>'source';reason:=nullif(btrim(p_command->>'reason'),'');
 if src not in('home-request','appointment')or m is null or sid is null or sub is null or vid is null or oid is null or aid is null
  or oid=aid or(reason is not null and length(reason)not between 3 and 1000)then return bad;end if;
 canonical:=jsonb_set(p_command,'{reason}',coalesce(to_jsonb(reason),'null'::jsonb));
 perform pg_advisory_xact_lock(hashtextextended('nurse-visit:'||sid::text,0));
 perform public._nurse_visit_nurse_as(p_actor,p_binding,p_generation);
 s:=public._patient_visit_authorize_as(p_actor,p_binding,p_generation,m,true,false);
 if not public._nurse_visit_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.nurse_visit_completions where source=src and source_id=sid;
 if found then
  if prior.submission_id=sub and prior.command=canonical and prior.actor_id=s.user_id then return prior.result||jsonb_build_object('replayed',true);end if;
  return jsonb_build_object('status','completed');
 end if;
 v:=public._nurse_visit_row(src,sid);
 if v is null or(v->>'memberId')::uuid<>m then raise insufficient_privilege;end if;
 -- A visit is completed on or after its arranged day, never ahead of it.
 if((v->>'startsAt')::timestamptz at time zone 'Asia/Yerevan')::date>(clock_timestamp()at time zone 'Asia/Yerevan')::date then
  return jsonb_build_object('status','too-early');end if;
 items:=public._nurse_visit_items_marked(src,sid);counts:=public._nurse_visit_counts(items);
 if jsonb_array_length(counts->'openItems')>0 and reason is null then return jsonb_build_object('status','reason-required','openItems',counts->'openItems');end if;
 -- 1. The home request closes first, so the auto-close trigger on the visit insert finds nothing to do.
 if src='home-request'then
  select * into rq from public.patient_test_requests where id=sid and user_id=m for update nowait;
  if rq.status='confirmed'then
   update public.patient_test_requests set revision=revision+1,status='completed',updated_at=now()where id=sid;
   insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
    values(sid,sub,s.user_id,rq.revision+1,'completed-by-visit',jsonb_build_object('visitId',vid,'nurseVisit',true),jsonb_build_object('status','completed'));
  end if;
 else
  -- A slot booking needs its current booking context, or its samples cannot be recorded against
  -- the booking. The nurse is told to check the booking instead of completing silently (review F1).
  b:=public._patient_visit_booking(m,sid);
  if b->>'availability'is distinct from 'available'then return jsonb_build_object('status','booking-stale');end if;
  booking:=jsonb_build_object('appointmentId',sid,'acceptedRevision',(b#>>'{context,acceptedRevision}')::numeric);
 end if;
 -- 2. The visit record, through the existing nurse visit command.
 res:=public._patient_staff_visit_command_as(p_actor,p_binding,p_generation,jsonb_build_object('version','visit-evidence-v1','op','open-visit','id',m,'visitId',vid,'submissionId',oid,
  'revision',(select revision from public.patient_clinical_cases where user_id=m),'booking',coalesce(booking,'null'::jsonb)));
 if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Nurse visit open was not saved';end if;
 select x.* into bp from public.nurse_visit_marks x where x.source=src and x.source_id=sid and x.item='measure:bp'and x.arrangement=(v->>'startsAt')::timestamptz order by x.recorded_at desc,x.id desc limit 1;
 if bp.done then
  entries:=entries||jsonb_build_array(
   jsonb_build_object('kind','observation','field','systolic','observedAt',public._nurse_visit_iso(bp.recorded_at),'state','known','value',(bp.vals->>'systolic')::int,'unit','mmHg'),
   jsonb_build_object('kind','observation','field','diastolic','observedAt',public._nurse_visit_iso(bp.recorded_at),'state','known','value',(bp.vals->>'diastolic')::int,'unit','mmHg'))
   ||case when bp.vals->'pulse'<>'null'::jsonb then jsonb_build_array(jsonb_build_object('kind','observation','field','pulse','observedAt',public._nurse_visit_iso(bp.recorded_at),
    'state','known','value',(bp.vals->>'pulse')::int,'unit','beats/min'))else '[]'::jsonb end;
 end if;
 for k in select distinct on(x.item)x.* from public.nurse_visit_marks x where x.source=src and x.source_id=sid and x.item in('measure:weight','measure:waist')and x.arrangement=(v->>'startsAt')::timestamptz order by x.item,x.recorded_at desc,x.id desc loop
  if k.done then entries:=entries||jsonb_build_array(jsonb_build_object('kind','observation','field',substr(k.item,9),'observedAt',public._nurse_visit_iso(k.recorded_at),
   'state','known','value',(k.vals->'value'),'unit',case when k.item='measure:weight'then 'kg'else 'cm'end));end if;
 end loop;
 if booking is not null then
  for i in select x from jsonb_array_elements(items)x where x->>'kind'='sample'
   and exists(select 1 from jsonb_array_elements(b#>'{context,tests}')t where t->>'id'=x->>'testId')loop
   entries:=entries||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('kind','collection','observedAt',coalesce(public._nurse_visit_iso((i#>>'{mark,recordedAt}')::timestamptz),stamp),
    'appointmentId',sid,'acceptedRevision',booking->'acceptedRevision','testId',i->>'testId',
    'outcome',case when i#>>'{mark,done}'='true'then 'collected'when i->'mark'is not null and i->'mark'<>'null'::jsonb then 'not-collected'else 'unknown'end,
    'reason',case when i#>>'{mark,done}'='true'then null else coalesce(i#>>'{mark,note}',reason)end)));
  end loop;
 end if;
 if reason is not null then entries:=entries||jsonb_build_array(jsonb_build_object('kind','note','observedAt',stamp,'text',reason));end if;
 if jsonb_array_length(entries)>0 then
  res:=public._patient_staff_visit_command_as(p_actor,p_binding,p_generation,jsonb_build_object('version','visit-evidence-v1','op','append-evidence','id',m,'visitId',vid,'submissionId',aid,
   'revision',(select revision from public.patient_clinical_cases where user_id=m),'entries',entries));
  if res->>'status'is distinct from 'saved'then raise exception using errcode='40001',message='Nurse visit evidence was not saved';end if;
 end if;
 -- 3. The completion, which also counts a slot booking as attended (_booking_visit_attended).
 result:=jsonb_build_object('status','saved','submissionId',sub,'visitId',vid,'summary',counts,'replayed',false);
 insert into public.nurse_visit_completions(member_id,source,source_id,visit_id,submission_id,command,reason,summary,result,actor_id,actor_name,session_id,channel,binding_id,binding_generation)
  values(m,src,sid,vid,sub,canonical,reason,counts,result,s.user_id,s.display_name,case when p_binding is null then (auth.jwt()->>'session_id')::uuid end,case when p_binding is null then 'web'else 'telegram'end,p_binding,p_generation);
 -- 4. The timeline: samples collected (if taken and not tapped), completed; samples already handed
 -- to the lab get their lab stages now that the collection entries exist.
 if(counts->>'samplesTaken')::int>0 and not public._nurse_visit_has_step(src,sid,'samples-collected')then
  perform public._nurse_visit_record_step(m,src,sid,'samples-collected',gen_random_uuid(),s);
 end if;
 perform public._nurse_visit_record_step(m,src,sid,'completed',sub,s);
 if public._nurse_visit_has_step(src,sid,'samples-at-lab')then
  perform public._nurse_visit_sync_lab_as(p_actor,p_binding,p_generation,m,vid,(select max(occurred_at)from public.nurse_visit_events where source=src and source_id=sid and step='samples-at-lab'));
 end if;
 return result;
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public._nurse_visit_complete_as(uuid,uuid,bigint,jsonb)from public,anon,authenticated,service_role;

create or replace function public.nurse_visit_complete(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 return public._nurse_visit_complete_as(auth.uid(),null,null,p_command);
end$$;
