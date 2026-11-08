-- B7 blood-pressure monitor inventory, ships dark (NOREON_BP_DEVICES_ENABLED).
-- Devices, who holds each one and since when, and the readings a monitor sends.
-- Real sync is awaiting Q11 (device model and vendor API): readings arrive only
-- through bp_device_ingest_reading, called by the server-side sync adapter, which
-- today has a fake transport only.
--
-- Device readings are kept apart from patient_measurements on purpose. They do
-- not enter the clinical case snapshot, evidence token or publication until the
-- device path is validated against a real monitor (Q11). Staff see them beside
-- the manual readings in the readings history.

create table public.bp_devices(
 id uuid primary key default gen_random_uuid(),
 model text not null check(length(btrim(model))between 1 and 120),
 serial text not null unique check(serial~'^[A-Z0-9][A-Z0-9-]{2,63}$'),
 status text not null default 'in-stock' check(status in('in-stock','assigned','returned','lost','faulty')),
 revision bigint not null default 1,
 created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null references auth.users(id),
 updated_at timestamptz not null default clock_timestamp()
);

-- One row per holding period. A period is closed, never edited or removed.
create table public.bp_device_assignments(
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.bp_devices(id),
 member_id uuid not null references public.patient_clinical_cases(user_id),
 assigned_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 assigned_by uuid not null references auth.users(id),assigned_by_name text not null,
 assigned_by_role text not null check(assigned_by_role in('admin','nurse')),
 assign_reason text check(assign_reason is null or length(btrim(assign_reason))between 1 and 500),
 ended_at timestamptz,ended_recorded_at timestamptz,ended_by uuid references auth.users(id),ended_by_name text,
 ended_by_role text check(ended_by_role is null or ended_by_role in('admin','nurse')),
 end_reason text check(end_reason is null or length(btrim(end_reason))between 1 and 500),
 check((ended_at is null)=(ended_by is null)and(ended_at is null)=(end_reason is null)and(ended_at is null)=(ended_recorded_at is null)),
 check(ended_at is null or ended_at>=assigned_at)
);
create unique index bp_device_assignments_open_device on public.bp_device_assignments(device_id)where ended_at is null;
create unique index bp_device_assignments_open_member on public.bp_device_assignments(member_id)where ended_at is null;
create index bp_device_assignments_device_time on public.bp_device_assignments(device_id,assigned_at desc);
create index bp_device_assignments_member_time on public.bp_device_assignments(member_id,assigned_at desc);

create function public._bp_assignment_guard()returns trigger language plpgsql set search_path=''as $$begin
 if tg_op='DELETE'then raise exception using errcode='55000',message='Device history is immutable';end if;
 -- Only closing an open period is allowed; every other column is fixed.
 if old.ended_at is not null or new.ended_at is null
  or(new.id,new.device_id,new.member_id,new.assigned_at,new.recorded_at,new.assigned_by,new.assigned_by_name,new.assigned_by_role,new.assign_reason)
   is distinct from(old.id,old.device_id,old.member_id,old.assigned_at,old.recorded_at,old.assigned_by,old.assigned_by_name,old.assigned_by_role,old.assign_reason)
 then raise exception using errcode='55000',message='Device history is immutable';end if;
 return new;
end$$;
create trigger bp_device_assignments_guard before update or delete on public.bp_device_assignments for each row execute function public._bp_assignment_guard();

-- Audit trail for every inventory change: who, when, why.
create table public.bp_device_events(
 id uuid primary key default gen_random_uuid(),
 device_id uuid not null references public.bp_devices(id),
 kind text not null check(kind in('registered','status','assigned','ended','reading-attached','reading-dismissed','reading-detached')),
 actor_id uuid not null references auth.users(id),actor_name text not null,actor_role text not null check(actor_role in('admin','nurse')),
 reason text,detail jsonb not null default '{}',
 at timestamptz not null default clock_timestamp()
);
create index bp_device_events_device on public.bp_device_events(device_id,at desc);
create function public._bp_immutable()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Device history is immutable';
end$$;
create trigger bp_device_events_immutable before update or delete on public.bp_device_events for each row execute function public._bp_immutable();

-- Idempotent commands: resending the same submission replays the stored result.
create table public.bp_device_commands(
 actor_id uuid not null references auth.users(id),submission_id uuid not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(actor_id,submission_id)
);

-- Readings sent by a monitor. Attached only to the member who held that monitor
-- at the time of the reading; anything else is held for staff review.
create table public.bp_device_readings(
 id uuid primary key default gen_random_uuid(),
 transport text not null check(transport~'^[a-z0-9-]{1,40}$'),
 external_id text not null check(length(external_id)between 1 and 200),
 serial text not null check(length(serial)between 1 and 64),
 device_id uuid references public.bp_devices(id),
 claimed_member_id uuid,
 systolic integer not null check(systolic between 60 and 300),
 diastolic integer not null check(diastolic between 30 and 200 and diastolic<systolic),
 pulse integer check(pulse between 20 and 250),
 measured_at timestamptz not null,
 received_at timestamptz not null default clock_timestamp(),
 state text not null check(state in('attached','held','dismissed')),
 hold_reason text check(hold_reason in('unknown-device','no-assignment','member-mismatch')),
 member_id uuid references public.patient_clinical_cases(user_id),
 assignment_id uuid references public.bp_device_assignments(id),
 resolved_at timestamptz,resolved_by uuid references auth.users(id),resolution_note text,
 unique(transport,external_id),
 check((state='attached')=(member_id is not null)and(member_id is null)=(assignment_id is null)),
 check(state<>'held'or hold_reason is not null)
);
create index bp_device_readings_member on public.bp_device_readings(member_id,measured_at desc)where state='attached';
create index bp_device_readings_held on public.bp_device_readings(received_at)where state='held';

alter table public.bp_devices enable row level security;
alter table public.bp_device_assignments enable row level security;
alter table public.bp_device_events enable row level security;
alter table public.bp_device_commands enable row level security;
alter table public.bp_device_readings enable row level security;
-- No direct table access: every read and write goes through the functions below.
revoke all on public.bp_devices,public.bp_device_assignments,public.bp_device_events,public.bp_device_commands,public.bp_device_readings
 from public,anon,authenticated,service_role;

-- The holding period that covers an instant, if any. Periods are half-open:
-- a reading at the exact hand-over instant belongs to the new holder.
create function public._bp_assignment_at(p_device uuid,p_at timestamptz)returns public.bp_device_assignments
language sql stable security definer set search_path=''as $$
 select * from public.bp_device_assignments where device_id=p_device and assigned_at<=p_at and(ended_at is null or ended_at>p_at)
 order by assigned_at desc limit 1
$$;

-- The wrong-member guard, shared by ingest and recheck. Caller holds the device row lock.
create function public._bp_reading_guard(p_device uuid,p_claimed uuid,p_at timestamptz,out o_state text,out o_reason text,out o_member uuid,out o_assignment uuid)
language plpgsql stable security definer set search_path=''as $$
declare a public.bp_device_assignments;
begin
 if p_device is null then o_state:='held';o_reason:='unknown-device';return;end if;
 a:=public._bp_assignment_at(p_device,p_at);
 if a.id is null then o_state:='held';o_reason:='no-assignment';return;end if;
 if p_claimed is not null and p_claimed<>a.member_id then o_state:='held';o_reason:='member-mismatch';return;end if;
 o_state:='attached';o_member:=a.member_id;o_assignment:=a.id;
end$$;

-- Sync adapter entry point (service role only).
-- {version:'bp-reading-v1',transport,externalId,serial,systolic,diastolic,pulse|null,measuredAt,memberId|null}
-- memberId is the account the reading was synced from, when the transport knows it.
create function public.bp_device_ingest_reading(p_reading jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare tr text;ext text;ser text;sys integer;dia integer;pul integer;at timestamptz;claimed uuid;d uuid;g record;existing public.bp_device_readings;rid uuid;
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_reading)is distinct from 'object'or p_reading-array['version','transport','externalId','serial','systolic','diastolic','pulse','measuredAt','memberId']<>'{}'
  or not(p_reading?&array['version','transport','externalId','serial','systolic','diastolic','measuredAt'])or p_reading->>'version'is distinct from 'bp-reading-v1'
  or jsonb_typeof(p_reading->'systolic')<>'number'or jsonb_typeof(p_reading->'diastolic')<>'number'
  or coalesce(jsonb_typeof(p_reading->'pulse'),'null')not in('number','null')or coalesce(jsonb_typeof(p_reading->'memberId'),'null')not in('string','null')
  or jsonb_typeof(p_reading->'measuredAt')<>'string'
  or p_reading->>'measuredAt'!~'^\d{4}-\d{2}-\d{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.\d+)?)?(Z|[+-]\d{2}:\d{2})$'then return bad;end if;
 begin
  tr:=p_reading->>'transport';ext:=p_reading->>'externalId';ser:=upper(btrim(p_reading->>'serial'));
  sys:=(p_reading->>'systolic')::integer;dia:=(p_reading->>'diastolic')::integer;pul:=(p_reading->>'pulse')::integer;
  at:=(p_reading->>'measuredAt')::timestamptz;claimed:=(p_reading->>'memberId')::uuid;
 exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return bad;end;
 if tr is null or tr!~'^[a-z0-9-]{1,40}$'or ext is null or length(ext)not between 1 and 200 or ser is null or length(ser)not between 1 and 64
  or sys not between 60 and 300 or dia not between 30 and 200 or dia>=sys or(pul is not null and pul not between 20 and 250)
  or (p_reading->>'systolic')::numeric<>sys or (p_reading->>'diastolic')::numeric<>dia or(pul is not null and(p_reading->>'pulse')::numeric<>pul)
  or not isfinite(at)or at>clock_timestamp()+interval '5 minutes'or at<clock_timestamp()-interval '366 days'then return bad;end if;
 perform pg_advisory_xact_lock(hashtextextended('bp-reading:'||tr||':'||ext,0));
 select * into existing from public.bp_device_readings where transport=tr and external_id=ext;
 if found then
  if(existing.serial,existing.systolic,existing.diastolic,existing.pulse,existing.measured_at,existing.claimed_member_id)is distinct from(ser,sys,dia,pul,at,claimed)
   then return jsonb_build_object('status','conflict');end if;
  return jsonb_build_object('status',existing.state,'readingId',existing.id,'reason',existing.hold_reason,'replayed',true);
 end if;
 select id into d from public.bp_devices where serial=ser for share;
 select * into g from public._bp_reading_guard(d,claimed,at);
 insert into public.bp_device_readings(transport,external_id,serial,device_id,claimed_member_id,systolic,diastolic,pulse,measured_at,state,hold_reason,member_id,assignment_id)
  values(tr,ext,ser,d,claimed,sys,dia,pul,at,g.o_state,g.o_reason,g.o_member,g.o_assignment)returning id into rid;
 return jsonb_build_object('status',g.o_state,'readingId',rid,'reason',g.o_reason,'replayed',false);
exception when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;

-- Actor for staff device work. Admin: full inventory. Nurse: hand-over and
-- return for an assigned member only (checked per command).
create function public._bp_actor()returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid()is null then raise insufficient_privilege;end if;
 select * into s from public.workspace_staff where user_id=auth.uid()and active and removed_at is null;
 if not found then raise insufficient_privilege;end if;
 if s.role='admin'then perform public._clinic_portal_admin();end if;
 return s;
end$$;

create function public._bp_device_json(d public.bp_devices)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',d.id,'model',d.model,'serial',d.serial,'status',d.status,'revision',d.revision,'createdAt',d.created_at,
  'holder',(select jsonb_build_object('assignmentId',a.id,'memberId',a.member_id,'memberName',coalesce(nullif(btrim(p.display_name),''),'Member'),'since',a.assigned_at)
   from public.bp_device_assignments a left join public.profiles p on p.id=a.member_id where a.device_id=d.id and a.ended_at is null))
$$;

create function public._bp_assignment_json(a public.bp_device_assignments)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',a.id,'deviceId',a.device_id,'serial',d.serial,'model',d.model,'memberId',a.member_id,
  'memberName',coalesce(nullif(btrim(p.display_name),''),'Member'),
  'assignedAt',a.assigned_at,'recordedAt',a.recorded_at,'assignedBy',jsonb_build_object('name',a.assigned_by_name,'role',a.assigned_by_role),'assignReason',a.assign_reason,
  'endedAt',a.ended_at,'endedBy',case when a.ended_at is null then null else jsonb_build_object('name',a.ended_by_name,'role',a.ended_by_role)end,'endReason',a.end_reason)
 from public.bp_devices d left join public.profiles p on p.id=a.member_id where d.id=a.device_id
$$;

-- Admin inventory: every device with its holder and recent history, plus the
-- held readings queue. Held readings show no values: admins have no clinical read.
create function public.bp_admin_device_inventory()returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;
begin
 s:=public._bp_actor();if s.role<>'admin'then raise insufficient_privilege;end if;
 return jsonb_build_object('version','bp-device-v1',
  'devices',coalesce((select jsonb_agg(public._bp_device_json(d)||jsonb_build_object('history',coalesce((
    select jsonb_agg(public._bp_assignment_json(a)order by a.assigned_at desc)from(select * from public.bp_device_assignments where device_id=d.id order by assigned_at desc limit 20)a),'[]'))
   order by d.serial)from public.bp_devices d),'[]'),
  'held',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'serial',r.serial,'deviceId',r.device_id,'measuredAt',r.measured_at,'receivedAt',r.received_at,'reason',r.hold_reason,
    'claimedMember',case when r.claimed_member_id is null then null else jsonb_build_object('id',r.claimed_member_id,'name',coalesce((select nullif(btrim(display_name),'')from public.profiles where id=r.claimed_member_id),'Member'))end)
   order by r.received_at)from public.bp_device_readings r where r.state='held'),'[]'));
end$$;

-- Device panel for one member. Admin and the assigned nurse see the device,
-- its history and the devices that can be handed over; the assigned nurse and
-- doctor also see the readings (manual and attached device readings).
create function public.bp_staff_member_devices(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;clinical boolean;
begin
 perform set_config('lock_timeout','1500ms',true);
 s:=public._bp_actor();
 if s.role='admin'then
  perform 1 from public.patient_clinical_cases where user_id=p_member;if not found then raise insufficient_privilege;end if;
  clinical:=false;
 else s:=public._patient_visit_authorize(p_member,false,false);clinical:=true;end if;
 return jsonb_build_object('version','bp-device-v1','memberId',p_member,
  'current',(select public._bp_assignment_json(a)from public.bp_device_assignments a where a.member_id=p_member and a.ended_at is null),
  'history',coalesce((select jsonb_agg(public._bp_assignment_json(a)order by a.assigned_at desc)from public.bp_device_assignments a where a.member_id=p_member),'[]'),
  -- Devices that can be handed over. An admin also sees devices held by other
  -- members, to reassign one; that needs a reason in the command.
  'available',case when s.role in('admin','nurse')then coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'serial',d.serial,'model',d.model,'status',d.status,
    'holderName',(select coalesce(nullif(btrim(p.display_name),''),'Member')from public.bp_device_assignments a left join public.profiles p on p.id=a.member_id where a.device_id=d.id and a.ended_at is null))order by d.serial)
   from public.bp_devices d where d.status='in-stock'or(s.role='admin'and d.status='returned')
    or(s.role='admin'and d.status='assigned'and not exists(select 1 from public.bp_device_assignments a where a.device_id=d.id and a.ended_at is null and a.member_id=p_member))),'[]')else '[]'::jsonb end,
  'readings',case when clinical then coalesce((select jsonb_agg(q.x order by q.t desc,q.x->>'id')from(
    select * from(
     select m.measured_at t,jsonb_build_object('id',m.id,'systolic',m.systolic,'diastolic',m.diastolic,'pulse',m.pulse,'measuredAt',m.measured_at,
      'source',case when exists(select 1 from public.patient_care_visit_entries e where e.measurement_id=m.id)then 'visit'else 'manual'end,'serial',null)x
      from public.patient_measurements m where m.user_id=p_member
     union all
     select r.measured_at,jsonb_build_object('id',r.id,'systolic',r.systolic,'diastolic',r.diastolic,'pulse',r.pulse,'measuredAt',r.measured_at,'source','device','serial',r.serial)
      from public.bp_device_readings r where r.member_id=p_member and r.state='attached')u order by t desc limit 500)q),'[]')else null end);
end$$;

-- Command: {version:'bp-device-v1',submissionId,action,...}
--  register      {model,serial}                                        admin
--  set-status    {deviceId,status,reason}                              admin; closes an open holding period
--  assign        {deviceId,memberId,effectiveAt|null,reason|null}      admin, or the assigned nurse of the member (hand-over)
--  end           {deviceId,status:'returned'|'lost'|'faulty',reason,effectiveAt|null}
--                admin, or the assigned nurse of the holder; only an admin may backdate the end
--                (to correct a late return), which detaches later readings back to held
--  recheck-held  {readingId}                                           admin; re-runs the guard on current history
--  dismiss-held  {readingId,reason}                                    admin
create function public.bp_device_command(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.workspace_staff;sub uuid;act text;stored public.bp_device_commands;d public.bp_devices;a public.bp_device_assignments;
 dev uuid;mem uuid;eff timestamptz;why text;st text;model text;ser text;rid uuid;r public.bp_device_readings;g record;latest timestamptz;result jsonb;
 allowed text[];
 bad constant jsonb:=jsonb_build_object('status','invalid');
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command->>'version'is distinct from 'bp-device-v1'or jsonb_typeof(p_command->'action')<>'string'then return bad;end if;
 act:=p_command->>'action';
 allowed:=case act when 'register'then array['model','serial']when 'set-status'then array['deviceId','status','reason']
  when 'assign'then array['deviceId','memberId','effectiveAt','reason']when 'end'then array['deviceId','status','reason','effectiveAt']
  when 'recheck-held'then array['readingId']when 'dismiss-held'then array['readingId','reason']else null end;
 if allowed is null or p_command-(array['version','submissionId','action']||allowed)<>'{}'then return bad;end if;
 begin
  sub:=(p_command->>'submissionId')::uuid;dev:=(p_command->>'deviceId')::uuid;mem:=(p_command->>'memberId')::uuid;rid:=(p_command->>'readingId')::uuid;
  eff:=case when p_command->>'effectiveAt'is null then null else(p_command->>'effectiveAt')::timestamptz end;
 exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then return bad;end;
 if sub is null then return bad;end if;
 why:=nullif(btrim(p_command->>'reason'),'');st:=p_command->>'status';
 if why is not null and length(why)>500 then return bad;end if;
 s:=public._bp_actor();
 -- Serialise a resend of the same submission so it replays the stored result.
 perform pg_advisory_xact_lock(hashtextextended('bp-command:'||s.user_id::text||':'||sub::text,0));
 select * into stored from public.bp_device_commands where actor_id=s.user_id and submission_id=sub;
 if found then
  if stored.payload<>p_command then return jsonb_build_object('status','stale');end if;
  return stored.result||jsonb_build_object('replayed',true);
 end if;

 if act='register'then
  if s.role<>'admin'then raise insufficient_privilege;end if;
  model:=btrim(p_command->>'model');ser:=upper(btrim(p_command->>'serial'));
  if model is null or length(model)not between 1 and 120 or ser is null or ser!~'^[A-Z0-9][A-Z0-9-]{2,63}$'then return bad;end if;
  perform pg_advisory_xact_lock(hashtextextended('bp-serial:'||ser,0));
  if exists(select 1 from public.bp_devices where serial=ser)then return jsonb_build_object('status','duplicate-serial');end if;
  insert into public.bp_devices(model,serial,created_by)values(model,ser,s.user_id)returning id into dev;
  insert into public.bp_device_events(device_id,kind,actor_id,actor_name,actor_role,detail)values(dev,'registered',s.user_id,s.display_name,s.role,jsonb_build_object('model',model,'serial',ser));
  result:=jsonb_build_object('status','saved','deviceId',dev);

 elsif act in('set-status','end','assign')then
  if dev is null then return bad;end if;
  select * into d from public.bp_devices where id=dev for update nowait;
  if not found then return bad;end if;
  select * into a from public.bp_device_assignments where device_id=dev and ended_at is null for update;

  if act='set-status'then
   if s.role<>'admin'then raise insufficient_privilege;end if;
   if st is null or st not in('in-stock','returned','lost','faulty')then return bad;end if;
   if(a.id is not null or st in('lost','faulty'))and why is null then return jsonb_build_object('status','reason-required');end if;
   if d.status=st and a.id is null then return jsonb_build_object('status','stale');end if;
  elsif act='end'then
   if st is null or st not in('returned','lost','faulty')then return bad;end if;
   if why is null then return jsonb_build_object('status','reason-required');end if;
   if a.id is null then return jsonb_build_object('status','stale');end if;
   if s.role='nurse'then perform public._patient_visit_authorize(a.member_id,true,false);elsif s.role<>'admin'then raise insufficient_privilege;end if;
   if eff is not null then
    if s.role<>'admin'then return bad;end if;
    if not isfinite(eff)or eff>clock_timestamp()+interval '5 minutes'or eff<clock_timestamp()-interval '30 days'or eff<a.assigned_at then return bad;end if;
   end if;
  else -- assign
   if mem is null then return bad;end if;
   if s.role='nurse'then perform public._patient_visit_authorize(mem,true,false);
   elsif s.role='admin'then perform 1 from public.patient_clinical_cases where user_id=mem for share nowait;if not found then return bad;end if;
   else raise insufficient_privilege;end if;
   perform pg_advisory_xact_lock(hashtextextended('bp-member:'||mem::text,0));
   eff:=coalesce(eff,clock_timestamp());
   -- A nurse records a hand-over during or soon after the visit; only an admin
   -- may record an older hand-over, up to 30 days back, to correct the history.
   if not isfinite(eff)or eff>clock_timestamp()+interval '5 minutes'then return bad;end if;
   if s.role='admin'and eff<clock_timestamp()-interval '30 days'then return bad;end if;
   if s.role='nurse'and eff<clock_timestamp()-interval '24 hours'then return bad;end if;
   if a.id is not null then
    if a.member_id=mem then return jsonb_build_object('status','stale');end if;
    -- Reassignment straight from another member: admin only, with a reason.
    if s.role<>'admin'then return jsonb_build_object('status','device-unavailable');end if;
    if why is null then return jsonb_build_object('status','reason-required');end if;
    if eff<a.assigned_at then return bad;end if;
   -- A returned monitor waits for the admin check; nurses hand over in-stock monitors only.
   elsif d.status<>'in-stock'and not(s.role='admin'and d.status='returned')then return jsonb_build_object('status','device-unavailable');
   end if;
   if exists(select 1 from public.bp_device_assignments where member_id=mem and ended_at is null and device_id<>dev)then return jsonb_build_object('status','member-has-device');end if;
   -- Holding periods never overlap, for the device or for the member.
   select max(ended_at)into latest from public.bp_device_assignments where(device_id=dev or member_id=mem)and ended_at is not null;
   if latest is not null and eff<latest then return jsonb_build_object('status','overlap');end if;
   -- Nor may a backdated hand-over take readings already attached to the previous holder.
   if exists(select 1 from public.bp_device_readings where device_id=dev and state='attached'and measured_at>=eff)then return jsonb_build_object('status','overlap');end if;
  end if;

  if a.id is not null and(act<>'assign'or a.member_id<>mem)then
   update public.bp_device_assignments set ended_at=coalesce(eff,clock_timestamp()),ended_recorded_at=clock_timestamp(),
    ended_by=s.user_id,ended_by_name=s.display_name,ended_by_role=s.role,end_reason=why where id=a.id;
   -- A backdated end corrects the history: readings attached after it no longer
   -- belong to that holder and go back to staff review.
   if act='end'and eff is not null then
    with moved as(update public.bp_device_readings set state='held',hold_reason='no-assignment',member_id=null,assignment_id=null,
      resolved_at=clock_timestamp(),resolved_by=s.user_id,resolution_note='Detached: holding period corrected'
     where assignment_id=a.id and state='attached'and measured_at>=eff returning id)
    insert into public.bp_device_events(device_id,kind,actor_id,actor_name,actor_role,reason,detail)
     select dev,'reading-detached',s.user_id,s.display_name,s.role,why,jsonb_build_object('readingId',id,'memberId',a.member_id)from moved;
   end if;
   insert into public.bp_device_events(device_id,kind,actor_id,actor_name,actor_role,reason,detail)
    values(dev,'ended',s.user_id,s.display_name,s.role,why,jsonb_build_object('assignmentId',a.id,'memberId',a.member_id));
  end if;
  if act='assign'then
   insert into public.bp_device_assignments(device_id,member_id,assigned_at,assigned_by,assigned_by_name,assigned_by_role,assign_reason)
    values(dev,mem,eff,s.user_id,s.display_name,s.role,why)returning * into a;
   insert into public.bp_device_events(device_id,kind,actor_id,actor_name,actor_role,reason,detail)
    values(dev,'assigned',s.user_id,s.display_name,s.role,why,jsonb_build_object('assignmentId',a.id,'memberId',mem,'assignedAt',eff));
   st:='assigned';
  end if;
  update public.bp_devices set status=st,revision=revision+1,updated_at=clock_timestamp()where id=dev;
  if act='set-status'then
   insert into public.bp_device_events(device_id,kind,actor_id,actor_name,actor_role,reason,detail)
    values(dev,'status',s.user_id,s.display_name,s.role,why,jsonb_build_object('from',d.status,'to',st));
  end if;
  result:=jsonb_build_object('status','saved','deviceId',dev);

 else -- recheck-held, dismiss-held
  if s.role<>'admin'then raise insufficient_privilege;end if;
  if rid is null then return bad;end if;
  select * into r from public.bp_device_readings where id=rid;
  if not found then return bad;end if;
  -- Re-resolve the device by serial: it may have been registered after the reading arrived.
  select * into d from public.bp_devices where serial=r.serial for share;
  select * into r from public.bp_device_readings where id=rid for update;
  if r.state<>'held'then return jsonb_build_object('status','stale');end if;
  if act='dismiss-held'then
   if why is null then return jsonb_build_object('status','reason-required');end if;
   update public.bp_device_readings set state='dismissed',device_id=d.id,resolved_at=clock_timestamp(),resolved_by=s.user_id,resolution_note=why where id=rid;
   if d.id is not null then insert into public.bp_device_events(device_id,kind,actor_id,actor_name,actor_role,reason,detail)
    values(d.id,'reading-dismissed',s.user_id,s.display_name,s.role,why,jsonb_build_object('readingId',rid));end if;
   result:=jsonb_build_object('status','saved','reading','dismissed');
  else
   select * into g from public._bp_reading_guard(d.id,r.claimed_member_id,r.measured_at);
   if g.o_state='attached'then
    update public.bp_device_readings set state='attached',hold_reason=null,device_id=d.id,member_id=g.o_member,assignment_id=g.o_assignment,
     resolved_at=clock_timestamp(),resolved_by=s.user_id,resolution_note='Matched holder on recheck' where id=rid;
    insert into public.bp_device_events(device_id,kind,actor_id,actor_name,actor_role,detail)
     values(d.id,'reading-attached',s.user_id,s.display_name,s.role,jsonb_build_object('readingId',rid,'memberId',g.o_member));
    result:=jsonb_build_object('status','saved','reading','attached');
   else
    update public.bp_device_readings set hold_reason=g.o_reason,device_id=d.id where id=rid;
    -- Not stored as a command: a later recheck after a history fix must run again.
    return jsonb_build_object('status','still-held','reason',g.o_reason);
   end if;
  end if;
 end if;
 insert into public.bp_device_commands(actor_id,submission_id,payload,result)values(s.user_id,sub,p_command,result);
 return result||jsonb_build_object('replayed',false);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

revoke all on function public._bp_assignment_at(uuid,timestamptz),public._bp_reading_guard(uuid,uuid,timestamptz),public.bp_device_ingest_reading(jsonb),
 public._bp_actor(),public._bp_device_json(public.bp_devices),public._bp_assignment_json(public.bp_device_assignments),
 public.bp_admin_device_inventory(),public.bp_staff_member_devices(uuid),public.bp_device_command(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.bp_device_ingest_reading(jsonb)to service_role;
grant execute on function public.bp_admin_device_inventory(),public.bp_staff_member_devices(uuid),public.bp_device_command(jsonb)to authenticated;
