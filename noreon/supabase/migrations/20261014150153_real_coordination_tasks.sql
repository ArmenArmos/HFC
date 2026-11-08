-- Operational coordination is versioned independently from clinical evidence.
create table public.patient_coordination_tasks (
 id uuid primary key,
 patient_case_id uuid not null references public.patient_clinical_cases(user_id) on delete restrict,
 kind text not null check(kind in ('contact-followup','evidence-collection','booking-coordination','doctor-referral')),
 title text not null check(title=btrim(title) and length(title) between 1 and 160),
 instructions text not null check(instructions=btrim(instructions) and length(instructions) between 1 and 2000),
 due_at timestamptz check(due_at is null or isfinite(due_at)),
 creator_id uuid not null references public.workspace_staff(user_id) on delete restrict,
 owner_id uuid not null references public.workspace_staff(user_id) on delete restrict,
 status text not null default 'open' check(status in ('open','awaiting-member','awaiting-doctor','completed','cancelled')),
 revision bigint not null default 1 check(revision>0),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(kind='doctor-referral' or status<>'awaiting-doctor'),
 check(kind<>'doctor-referral' or status<>'awaiting-member')
);
create index patient_coordination_case_status on public.patient_coordination_tasks(patient_case_id,status,created_at);
create table public.patient_coordination_events (
 id bigint generated always as identity primary key,
 task_id uuid not null references public.patient_coordination_tasks(id) on delete restrict,
 revision bigint not null,request_id uuid not null unique,
 actor_id uuid not null references public.workspace_staff(user_id) on delete restrict,
 actor_name text not null,actor_role text not null,
 operation text not null,old_status text,new_status text not null,old_owner_id uuid,new_owner_id uuid not null,
 note text not null default '' check(length(note)<=2000),
 care_note_id uuid references public.staff_care_notes(id) on delete restrict,
 detail jsonb not null default '{}',created_at timestamptz not null default now(),
 unique(task_id,revision)
);
create table public.patient_coordination_receipts (
 request_id uuid primary key,actor_id uuid not null,patient_case_id uuid not null,
 input jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
alter table public.patient_coordination_tasks enable row level security;
alter table public.patient_coordination_events enable row level security;
alter table public.patient_coordination_receipts enable row level security;
revoke all on public.patient_coordination_tasks,public.patient_coordination_events,public.patient_coordination_receipts from public,anon,authenticated,service_role;

-- Public read predicate derives the caller; it never grants access through ownership.
create function public.patient_coordination_access(p_case uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare identity jsonb;
begin
 if auth.role() is distinct from 'authenticated' or auth.uid() is null then return false;end if;
 if not exists(select 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and (not_after is null or not_after>now())) then return false;end if;
 identity:=public.real_clinical_staff_identity();
 if identity is null then return false;end if;
 if identity->>'role'='admin' then return exists(select 1 from public.patient_clinical_cases where user_id=p_case);end if;
 return public.staff_care_access(p_case,auth.uid(),true);
end $$;
revoke all on function public.patient_coordination_access(uuid) from public,anon,authenticated,service_role;
grant execute on function public.patient_coordination_access(uuid) to authenticated;
grant select on public.patient_coordination_tasks,public.patient_coordination_events to authenticated;
create policy coordination_task_read on public.patient_coordination_tasks for select to authenticated using(public.patient_coordination_access(patient_case_id));
create policy coordination_event_read on public.patient_coordination_events for select to authenticated using(exists(select 1 from public.patient_coordination_tasks t where t.id=task_id and public.patient_coordination_access(t.patient_case_id)));

create function public._patient_coordination_owner_valid(p_case uuid,p_owner uuid,p_referral boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.patient_clinical_cases c
 join public.workspace_staff d on d.user_id=c.assigned_doctor_id and d.role='doctor' and d.active and d.removed_at is null
 join public.workspace_clinics k on k.id=d.clinic_id and k.active
 join public.workspace_staff s on s.user_id=p_owner and s.active and s.removed_at is null and s.clinic_id=d.clinic_id
 where c.user_id=p_case and ((s.role='doctor' and s.user_id=c.assigned_doctor_id) or (not p_referral and s.role='nurse' and s.user_id=c.assigned_nurse_id)))
$$;
revoke all on function public._patient_coordination_owner_valid(uuid,uuid,boolean) from public,anon,authenticated,service_role;
create function public._patient_coordination_task_json(t public.patient_coordination_tasks) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',t.id,'caseId',t.patient_case_id,'memberName',p.display_name,'kind',t.kind,'title',t.title,'instructions',t.instructions,'dueAt',t.due_at,'creatorId',t.creator_id,'ownerId',t.owner_id,'ownerName',s.display_name,'status',t.status,'revision',t.revision,'createdAt',t.created_at,'updatedAt',t.updated_at,'needsReassignment',t.status not in ('completed','cancelled') and not public._patient_coordination_owner_valid(t.patient_case_id,t.owner_id,t.kind='doctor-referral'))
 from public.profiles p join public.workspace_staff s on s.user_id=t.owner_id where p.id=t.patient_case_id
$$;
revoke all on function public._patient_coordination_task_json(public.patient_coordination_tasks) from public,anon,authenticated,service_role;
create function public.patient_coordination_queue(p_case uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.real_clinical_staff_identity() is null then raise insufficient_privilege using message='Current staff access required';end if;
 if p_case is not null and not public.patient_coordination_access(p_case) then raise insufficient_privilege using message='Current case access required';end if;
 return (select coalesce(jsonb_agg(public._patient_coordination_task_json(t) order by t.created_at,t.id),'[]') from (select * from public.patient_coordination_tasks where (p_case is null or patient_case_id=p_case) and public.patient_coordination_access(patient_case_id) order by created_at,id limit 200) t);
end $$;
create function public.patient_coordination_members() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or public.real_clinical_staff_identity() is null then raise insufficient_privilege using message='Current staff access required';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',c.user_id,'name',p.display_name,'owners',(select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name,'role',s.role) order by s.role,s.user_id),'[]') from public.workspace_staff s where public._patient_coordination_owner_valid(c.user_id,s.user_id,false))) order by c.created_at,c.user_id),'[]') from (select * from public.patient_clinical_cases where public.patient_coordination_access(user_id) order by created_at,user_id limit 200) c join public.profiles p on p.id=c.user_id);
end $$;
create function public.patient_coordination_snapshot(p_task uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.patient_coordination_tasks;
begin
 select * into t from public.patient_coordination_tasks where id=p_task;
 if not found or not public.patient_coordination_access(t.patient_case_id) then raise insufficient_privilege using message='Current case access required';end if;
 return public._patient_coordination_task_json(t)||jsonb_build_object('events',(select coalesce(jsonb_agg(to_jsonb(e)-'task_id' order by e.revision desc),'[]') from (select * from public.patient_coordination_events where task_id=p_task order by revision desc limit 100) e));
end $$;
revoke all on function public.patient_coordination_queue(uuid),public.patient_coordination_members(),public.patient_coordination_snapshot(uuid) from public,anon,authenticated,service_role;
grant execute on function public.patient_coordination_queue(uuid),public.patient_coordination_members(),public.patient_coordination_snapshot(uuid) to authenticated;

-- Single write path: request -> member -> case -> task -> staff -> clinics -> session.
create function public.patient_coordination_command(p_case uuid,p_task uuid,p_expected_revision bigint,p_request uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 c public.patient_clinical_cases;t public.patient_coordination_tasks;before_task public.patient_coordination_tasks;
 actor public.workspace_staff;owner uuid;title_value text;instructions_value text;note_value text;kind_value text;outcome text;due_value timestamptz;
 keys text[];normalized jsonb;receipt public.patient_coordination_receipts;result jsonb;care_note uuid;
begin
 if p_case is null or p_task is null or p_request is null or p_expected_revision is null or p_expected_revision<0 or p_input is null or jsonb_typeof(p_input)<>'object' then raise check_violation using message='Check the task details';end if;
 keys:=case p_operation when 'create' then array['kind','title','instructions','dueAt','ownerId'] when 'edit' then array['title','instructions','dueAt'] when 'reassign' then array['ownerId'] when 'contact' then array['outcome','note'] when 'await-member' then array[]::text[] when 'reopen' then array[]::text[] when 'complete' then array['note'] when 'refer' then array['note'] when 'resolve' then array['note'] when 'cancel' then array['note'] else null end;
 if keys is null or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(keys)) then raise check_violation using message='Task operation unavailable';end if;
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
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('noreon:coordination:'||p_request::text,0));
 perform 1 from auth.users where id=p_case and phone is not null and phone_confirmed_at is not null for share;
 if not found then raise insufficient_privilege using message='Verified member required';end if;
 select * into c from public.patient_clinical_cases where user_id=p_case for update;
 if not found then raise insufficient_privilege using message='Current case access required';end if;
 select * into t from public.patient_coordination_tasks where id=p_task for update;
 before_task:=t;
 if t.id is not null and t.patient_case_id is distinct from p_case then raise insufficient_privilege using message='Current case access required';end if;
 perform 1 from public.workspace_staff where user_id=any(array[auth.uid(),owner,t.owner_id,c.assigned_doctor_id,c.assigned_nurse_id]) order by user_id for share;
 perform 1 from public.workspace_clinics where id in (select clinic_id from public.workspace_staff where user_id=any(array[auth.uid(),owner,t.owner_id,c.assigned_doctor_id,c.assigned_nurse_id])) order by id for share;
 if not public.patient_coordination_access(p_case) then raise insufficient_privilege using message='Current case access required';end if;
 perform 1 from auth.sessions where id::text=auth.jwt()->>'session_id' and user_id=auth.uid() and (not_after is null or not_after>now()) for share;
 if not found or not public.patient_coordination_access(p_case) then raise insufficient_privilege using message='Current staff session required';end if;
 select * into actor from public.workspace_staff where user_id=auth.uid();
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
  -- Repair is permitted when ownership became stale. Other operations fail closed.
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
 insert into public.patient_coordination_receipts(request_id,actor_id,patient_case_id,input,result) values(p_request,actor.user_id,p_case,normalized,result);
 return result;
end $$;
revoke all on function public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.patient_coordination_command(uuid,uuid,bigint,uuid,text,jsonb) to authenticated;
