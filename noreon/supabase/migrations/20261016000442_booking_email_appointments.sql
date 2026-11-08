-- Trusted manual capacity is supplied by clinic operations, never fabricated.
-- Versions sharing the same source capacity reference share allocations.
create table public.booking_manual_capacity(
 key text primary key,source text not null,reference text not null,clinic_id uuid not null references public.workspace_clinics(id),
 starts_at timestamptz not null,ends_at timestamptz not null,capacity integer not null check(capacity between 1 and 100000),valid_until timestamptz not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),check(ends_at>starts_at)
);
create table public.booking_offer_snapshots(
 id uuid not null,version text not null,capacity_key text not null references public.booking_manual_capacity(key),offer jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default clock_timestamp(),primary key(id,version),
 check(jsonb_typeof(offer)='object' and octet_length(offer::text)<=50000)
);
create table public.booking_appointments(
 id uuid primary key,member_id uuid not null references auth.users(id),program_id uuid not null references public.booking_program_seals(id),requirements_token text not null,
 revision bigint not null default 0 check(revision>=0),status text not null check(status in('notification-pending','confirmed','failed','unknown','reconciliation')),
 current_arrangement jsonb,proposed_arrangement jsonb not null,current_reservation_id uuid,proposed_reservation_id uuid not null,notice_id uuid not null,
 created_at timestamptz not null default clock_timestamp(),unique(member_id,requirements_token)
);
alter table public.booking_legacy_conversions add foreign key(appointment_id)references public.booking_appointments(id);
create table public.booking_manual_reservations(
 id uuid primary key,appointment_id uuid not null references public.booking_appointments(id) deferrable initially deferred,
 capacity_key text not null references public.booking_manual_capacity(key),offer_id uuid not null,offer_version text not null,
 member_id uuid not null references auth.users(id),valid_until timestamptz not null,state text not null default 'held' check(state in('held','released')),
 created_at timestamptz not null default clock_timestamp(),foreign key(offer_id,offer_version)references public.booking_offer_snapshots(id,version)
);
alter table public.booking_appointments add foreign key(proposed_reservation_id)references public.booking_manual_reservations(id)deferrable initially deferred;
alter table public.booking_appointments add foreign key(current_reservation_id)references public.booking_manual_reservations(id)deferrable initially deferred;
create table public.booking_scheduling_notices(
 id uuid primary key,appointment_id uuid not null references public.booking_appointments(id),appointment_revision bigint not null,program_id uuid not null references public.booking_program_seals(id),
 reservation_id uuid not null references public.booking_manual_reservations(id),clinic_id uuid not null references public.workspace_clinics(id),clinic_revision integer not null,copy_revision integer not null,
 sender_email text not null,clinic_email text not null,copy_email text not null,template_version text not null,subject text not null,text_content text not null,envelope_hash text not null,
 state text not null default 'pending' check(state in('pending','sending','accepted','failed','unknown','reconciliation')),generation integer not null default 0,
 lease_until timestamptz,created_at timestamptz not null default clock_timestamp(),unique(appointment_id,appointment_revision),check(envelope_hash~'^[a-f0-9]{64}$')
);
alter table public.booking_appointments add foreign key(notice_id)references public.booking_scheduling_notices(id)deferrable initially deferred;
create table public.booking_appointment_versions(
 appointment_id uuid not null references public.booking_appointments(id),revision bigint not null,program_id uuid not null references public.booking_program_seals(id),
 previous_arrangement jsonb,proposed_arrangement jsonb not null,notice_id uuid not null unique references public.booking_scheduling_notices(id),
 actor_id uuid not null references auth.users(id),agreement_source text,legacy_snapshot jsonb,created_at timestamptz not null default clock_timestamp(),primary key(appointment_id,revision)
);
create table public.booking_appointment_commands(
 id uuid primary key,member_id uuid not null references auth.users(id),actor_id uuid not null references auth.users(id),input jsonb not null,result jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
create table public.booking_notice_attempts(
 id uuid primary key,notice_id uuid not null references public.booking_scheduling_notices(id),generation integer not null,envelope_hash text not null,
 receipt jsonb,applied_at timestamptz,created_at timestamptz not null default clock_timestamp(),unique(notice_id,generation)
);
create table public.booking_appointment_events(
 id uuid primary key default gen_random_uuid(),appointment_id uuid not null references public.booking_appointments(id),revision bigint not null,
 kind text not null,notice_id uuid not null references public.booking_scheduling_notices(id),attempt_id uuid references public.booking_notice_attempts(id),
 created_at timestamptz not null default clock_timestamp(),unique(notice_id,attempt_id,kind)
);
alter table public.booking_manual_capacity enable row level security;
alter table public.booking_offer_snapshots enable row level security;
alter table public.booking_appointments enable row level security;
alter table public.booking_manual_reservations enable row level security;
alter table public.booking_scheduling_notices enable row level security;
alter table public.booking_appointment_versions enable row level security;
alter table public.booking_appointment_commands enable row level security;
alter table public.booking_notice_attempts enable row level security;
alter table public.booking_appointment_events enable row level security;
revoke all on public.booking_manual_capacity,public.booking_offer_snapshots,public.booking_appointments,public.booking_manual_reservations,public.booking_scheduling_notices,public.booking_appointment_versions,public.booking_appointment_commands,public.booking_notice_attempts,public.booking_appointment_events from public,anon,authenticated,service_role;

create function public._booking_offer_coverage(p_program jsonb,p_offer jsonb)returns boolean
language sql immutable set search_path='' as $$
 with wanted as(select i->>'id' id from jsonb_array_elements(p_program->'items')i where i->>'method'<>'home-log'),
 supplied as(select jsonb_array_elements_text(p_offer->'coveredTestIds')id union all select f->>'testId'from jsonb_array_elements(p_offer->'followUps')f)
 select jsonb_array_length(p_offer->'coveredTestIds')>0
 and(select count(*)from wanted)=(select count(*)from supplied)
 and(select count(distinct id)from supplied)=(select count(*)from supplied)
 and not exists(select id from supplied except select id from wanted)
$$;
revoke all on function public._booking_offer_coverage(jsonb,jsonb)from public,anon,authenticated,service_role;

create function public._booking_envelope_hash(p_sender text,p_clinic text,p_copy text,p_template text,p_subject text,p_text text)returns text
language sql immutable set search_path='' as $$
 select encode(extensions.digest(
  octet_length(p_sender)::text||':'||p_sender||octet_length(p_clinic)::text||':'||p_clinic||octet_length(p_copy)::text||':'||p_copy||
  octet_length(p_template)::text||':'||p_template||octet_length(p_subject)::text||':'||p_subject||octet_length(p_text)::text||':'||p_text,'sha256'),'hex')
$$;
revoke all on function public._booking_envelope_hash(text,text,text,text,text,text)from public,anon,authenticated,service_role;

create function public.register_manual_booking_offer(p_actor uuid,p_offer jsonb,p_capacity integer,p_valid_until timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$
declare clinic public.workspace_clinics;pool public.booking_manual_capacity;prior public.booking_offer_snapshots;k text;oid uuid;v text;start_time timestamptz;end_time timestamptz;
begin
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role='admin'and active and removed_at is null)
 or not public._real_staff_managed_session_allowed(p_actor)then raise insufficient_privilege using message='Current operations administrator required';end if;
 if p_capacity is null or p_capacity not between 1 and 100000 or p_valid_until is null or not isfinite(p_valid_until)or p_valid_until<=clock_timestamp()
 or jsonb_typeof(p_offer)is distinct from 'object' or octet_length(p_offer::text)>50000
 or p_offer-array['id','version','source','clinicId','mode','startsAt','endsAt','timezone','clinicAddress','preparation','preparationVersion','coveredTestIds','followUps','reservationContract']<>'{}'::jsonb
 or coalesce(length(p_offer->>'version'),0)not between 1 and 200 or coalesce(length(p_offer->>'source'),0)not between 1 and 200
 or coalesce(p_offer->>'mode','')not in('home','clinic')or p_offer->>'timezone'is distinct from 'Asia/Yerevan'
 or coalesce(length(p_offer->>'preparation'),0)not between 1 and 8000 or coalesce(length(p_offer->>'preparationVersion'),0)not between 1 and 200
 or coalesce(length(p_offer#>>'{reservationContract,version}'),0)not between 1 and 200
 or coalesce(length(p_offer#>>'{reservationContract,reference}'),0)not between 1 and 1000
 or jsonb_typeof(p_offer->'coveredTestIds')is distinct from 'array'or jsonb_typeof(p_offer->'followUps')is distinct from 'array'then
  raise invalid_parameter_value using message='Actual approved offer and capacity required';
 end if;
 if jsonb_array_length(p_offer->'coveredTestIds')not between 1 and 100 or jsonb_array_length(p_offer->'followUps')>100
 or exists(select 1 from jsonb_array_elements(p_offer->'coveredTestIds')x where jsonb_typeof(x)<>'string'or length(x#>>'{}')not between 1 and 100)
 or exists(select 1 from jsonb_array_elements(p_offer->'followUps')f where jsonb_typeof(f)<>'object'or f-array['testId','owner','action','reference']<>'{}'::jsonb
  or coalesce(length(f->>'testId'),0)not between 1 and 100 or coalesce(length(f->>'owner'),0)not between 1 and 300
  or coalesce(length(f->>'action'),0)not between 1 and 2000 or coalesce(length(f->>'reference'),0)not between 1 and 1000)then
  raise invalid_parameter_value using message='Actual approved procedure coverage required';
 end if;
 oid:=(p_offer->>'id')::uuid;v:=p_offer->>'version';start_time:=(p_offer->>'startsAt')::timestamptz;end_time:=(p_offer->>'endsAt')::timestamptz;
 if oid is null or not isfinite(start_time)or not isfinite(end_time)or start_time<=clock_timestamp()or end_time<=start_time then raise invalid_parameter_value using message='Actual future offer window required';end if;
 select * into clinic from public.workspace_clinics where id=(p_offer->>'clinicId')::uuid and active for share;
 if not found or(p_offer->>'mode'='clinic'and(nullif(btrim(clinic.address),'')is null or p_offer->>'clinicAddress'is distinct from clinic.address))then raise invalid_parameter_value using message='Current clinic address required';end if;
 k:=encode(extensions.digest(octet_length(p_offer->>'source')::text||':'||(p_offer->>'source')||(p_offer#>>'{reservationContract,reference}'),'sha256'),'hex');
 insert into public.booking_manual_capacity(key,source,reference,clinic_id,starts_at,ends_at,capacity,valid_until,created_by)
 values(k,p_offer->>'source',p_offer#>>'{reservationContract,reference}',clinic.id,start_time,end_time,p_capacity,p_valid_until,p_actor)on conflict do nothing;
 select * into pool from public.booking_manual_capacity where key=k for update;
 if pool.clinic_id<>clinic.id or pool.starts_at<>start_time or pool.ends_at<>end_time or pool.capacity<>p_capacity or pool.valid_until<>p_valid_until then
  raise serialization_failure using message='Reconcile the existing source capacity reference';
 end if;
 select * into prior from public.booking_offer_snapshots where id=oid and version=v;
 if found then if prior.capacity_key<>k or prior.offer<>p_offer then raise invalid_parameter_value using message='Offer version already used';end if;
 else insert into public.booking_offer_snapshots(id,version,capacity_key,offer,created_by)values(oid,v,k,p_offer,p_actor);end if;
 return jsonb_build_object('id',oid,'version',v);
end $$;
revoke all on function public.register_manual_booking_offer(uuid,jsonb,integer,timestamptz)from public,anon,authenticated,service_role;
grant execute on function public.register_manual_booking_offer(uuid,jsonb,integer,timestamptz)to service_role;

create function public._booking_appointment_dto(p_row public.booking_appointments)returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version','email-pilot-v1','id',p_row.id,'memberId',p_row.member_id,'revision',p_row.revision,
 'status',case when n.state='sending'and n.lease_until<=clock_timestamp()then 'unknown'
  when n.state='sending'and exists(select 1 from public.booking_notice_attempts t where t.notice_id=n.id and t.receipt is not null)then 'reconciliation'else p_row.status end,
 'program',(select coalesce(jsonb_agg(i-'source'),'[]'::jsonb)from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=p_row.program_id),
 'current',p_row.current_arrangement,'proposed',p_row.proposed_arrangement,'noticeId',p_row.notice_id,'createdAt',p_row.created_at)
 from public.booking_scheduling_notices n where n.id=p_row.notice_id
$$;
revoke all on function public._booking_appointment_dto(public.booking_appointments)from public,anon,authenticated,service_role;

create function public.booking_pilot_workspace(p_member uuid default null)returns jsonb
language plpgsql stable security definer set search_path='' as $$declare m uuid:=coalesce(p_member,auth.uid());begin
 perform public._booking_assert_actor(m,auth.uid());
 return jsonb_build_object('member',(select jsonb_build_object('id',id,'name',display_name)from public.profiles where id=m),
 'appointments',(select coalesce(jsonb_agg(public._booking_appointment_dto(a)order by a.created_at,a.id),'[]'::jsonb)from public.booking_appointments a where a.member_id=m));
end $$;
revoke all on function public.booking_pilot_workspace(uuid)from public,anon,authenticated,service_role;
grant execute on function public.booking_pilot_workspace(uuid)to authenticated;

create function public.booking_pilot_offers(p_member uuid,p_actor uuid,p_program_id uuid)returns jsonb
language plpgsql stable security definer set search_path='' as $$declare seal public.booking_program_seals;begin
 perform public._booking_assert_actor(p_member,p_actor);
 select * into seal from public.booking_program_seals where id=p_program_id and member_id=p_member and actor_id=p_actor;
 if not found or seal.source_token is distinct from public.patient_test_context(p_member)->>'token'then raise serialization_failure using message='Booking program changed';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('offer',o.offer,'clinicName',c.name)order by p.starts_at,o.id,o.version),'[]'::jsonb)
 from public.booking_offer_snapshots o join public.booking_manual_capacity p on p.key=o.capacity_key join public.workspace_clinics c on c.id=p.clinic_id
 where c.active and p.valid_until>clock_timestamp()and p.starts_at>clock_timestamp()and public._booking_offer_coverage(seal.program,o.offer)
 and(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=p.key and r.state='held')<p.capacity);
end $$;
revoke all on function public.booking_pilot_offers(uuid,uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.booking_pilot_offers(uuid,uuid,uuid)to service_role;

create function public.select_booking_appointment(p_command_id uuid,p_member uuid,p_actor uuid,p_program_id uuid,p_offer_id uuid,p_offer_version text,
 p_home_address text default null,p_appointment_id uuid default null,p_revision bigint default null,p_agreement_source text default null,p_legacy_id uuid default null,
 p_sender_email text default null,p_template_version text default null,p_subject text default null,p_text_content text default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare seal public.booking_program_seals;offer_row public.booking_offer_snapshots;pool public.booking_manual_capacity;clinic public.workspace_clinics;copy public.workspace_scheduling_settings;
 a public.booking_appointments;prior public.booking_appointment_commands;legacy public.patient_test_requests;canonical jsonb;details jsonb;result jsonb;aid uuid;rev bigint;enrolled uuid;sender text;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 perform public.lock_patient_clinical_sources(p_member);
 select * into seal from public.booking_program_seals where id=p_program_id and member_id=p_member and actor_id=p_actor;
 if not found or seal.source_token is distinct from public.patient_test_context(p_member)->>'token'then raise serialization_failure using message='Booking program changed';end if;
 if p_command_id is null or p_offer_id is null or nullif(p_offer_version,'')is null then raise invalid_parameter_value using message='Offer and command identity required';end if;
 canonical:=jsonb_build_object('programId',p_program_id,'offerId',p_offer_id,'offerVersion',p_offer_version,'homeAddress',nullif(btrim(p_home_address),''),
 'appointmentId',p_appointment_id,'revision',p_revision,'agreementSource',nullif(btrim(p_agreement_source),''),'legacyId',p_legacy_id,
 'senderEmail',p_sender_email,'templateVersion',p_template_version,'subject',p_subject,'textContent',p_text_content);
 perform pg_advisory_xact_lock(hashtextextended('booking-command:'||p_command_id::text,0));
 select * into prior from public.booking_appointment_commands where id=p_command_id;
 if found then
  if prior.member_id<>p_member or prior.actor_id<>p_actor or prior.input<>canonical then raise invalid_parameter_value using message='Command identity already used';end if;
  return prior.result;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-member:'||p_member::text,0));
 insert into public.patient_clinical_cases(user_id)values(p_member)on conflict do nothing returning user_id into enrolled;
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 if enrolled is not null then insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id)values(p_member,0,'enrolled',p_actor);end if;
 if exists(select 1 from public.patient_test_requests r where r.user_id=p_member and r.status<>'cancelled'
  and(r.id is distinct from p_legacy_id)and not exists(select 1 from public.booking_legacy_conversions c where c.legacy_id=r.id))then raise serialization_failure using message='Reconcile the existing historical request first';end if;
 aid:=coalesce(p_appointment_id,p_command_id);
 select * into a from public.booking_appointments where id=aid for update nowait;
 if p_appointment_id is not null then
  if not found or a.member_id<>p_member then raise insufficient_privilege using message='Appointment unavailable';end if;
  if a.revision is distinct from p_revision or a.status in('notification-pending','unknown','reconciliation')then raise serialization_failure using message='Resolve the current arrangement before changing it';end if;
  if p_actor<>p_member and coalesce(length(btrim(p_agreement_source)),0)not between 3 and 1000 then raise invalid_parameter_value using message='Record member agreement source';end if;
  rev:=a.revision+1;
 elsif found or exists(select 1 from public.booking_appointments where member_id=p_member and requirements_token=seal.requirements_token)then
  raise serialization_failure using message='Use the existing appointment for this program';
 else rev:=0;end if;
 select * into offer_row from public.booking_offer_snapshots where id=p_offer_id and version=p_offer_version;
 if not found or not public._booking_offer_coverage(seal.program,offer_row.offer)then raise invalid_parameter_value using message='Complete program coverage and follow-up required';end if;
 select * into pool from public.booking_manual_capacity where key=offer_row.capacity_key for update nowait;
 if pool.valid_until<=clock_timestamp()or pool.starts_at<=clock_timestamp()then raise serialization_failure using message='Offer validity changed';end if;
 if(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=pool.key and r.state='held'and r.appointment_id<>aid)>=pool.capacity then raise serialization_failure using message='Offer capacity changed';end if;
 select * into clinic from public.workspace_clinics where id=pool.clinic_id and active for share;
 if not found then raise insufficient_privilege using message='Active clinic required';end if;
 select * into copy from public.workspace_scheduling_settings where id for share;
 sender:=public._real_scheduling_email(p_sender_email);
 if sender is null or clinic.scheduling_email is null or copy.copy_email is null or coalesce(length(p_template_version),0)not between 1 and 200
 or coalesce(length(p_subject),0)not between 1 and 200 or p_subject~E'[\r\n]'or coalesce(length(p_text_content),0)not between 1 and 32000 then
  raise invalid_parameter_value using message='Approved scheduling configuration and content required';
 end if;
 if offer_row.offer->>'mode'='home'then
  if coalesce(length(btrim(p_home_address)),0)not between 3 and 1000 then raise invalid_parameter_value using message='Home visit address required';end if;
 elsif p_home_address is not null or nullif(btrim(clinic.address),'')is null or offer_row.offer->>'clinicAddress'is distinct from clinic.address then
  raise invalid_parameter_value using message='Use the current trusted clinic address';
 end if;
 details:=jsonb_build_object('offerId',p_offer_id,'offerVersion',p_offer_version,'clinicId',clinic.id,'mode',offer_row.offer->>'mode','startsAt',offer_row.offer->>'startsAt',
 'endsAt',offer_row.offer->>'endsAt','timezone','Asia/Yerevan','location',case when offer_row.offer->>'mode'='home'then btrim(p_home_address)else clinic.address end,
 'preparation',offer_row.offer->>'preparation','preparationVersion',offer_row.offer->>'preparationVersion','coveredTestIds',offer_row.offer->'coveredTestIds','followUps',offer_row.offer->'followUps');
 if p_legacy_id is not null then
  select * into legacy from public.patient_test_requests where id=p_legacy_id and user_id=p_member for update nowait;
  if not found or legacy.status in('cancelled','change-pending')or exists(select 1 from public.booking_legacy_conversions where legacy_id=p_legacy_id)
   or coalesce(length(btrim(p_agreement_source)),0)not between 3 and 1000 then raise serialization_failure using message='Historical conversion requires explicit reconciliation';end if;
 end if;
 insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
 values(p_command_id,aid,pool.key,p_offer_id,p_offer_version,p_member,pool.valid_until);
 if p_appointment_id is null then
  insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,proposed_arrangement,proposed_reservation_id,notice_id)
  values(aid,p_member,seal.id,seal.requirements_token,rev,'notification-pending',details,p_command_id,p_command_id);
 else
  update public.booking_appointments set program_id=seal.id,requirements_token=seal.requirements_token,revision=rev,status='notification-pending',proposed_arrangement=details,
   proposed_reservation_id=p_command_id,notice_id=p_command_id where id=aid;
 end if;
 insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,
  sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash)
 values(p_command_id,aid,rev,seal.id,p_command_id,clinic.id,clinic.scheduling_revision,copy.revision,sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content,
 public._booking_envelope_hash(sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content));
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,previous_arrangement,proposed_arrangement,notice_id,actor_id,agreement_source,legacy_snapshot)
 values(aid,rev,seal.id,a.current_arrangement,details,p_command_id,p_actor,nullif(btrim(p_agreement_source),''),case when p_legacy_id is not null then to_jsonb(legacy)else null end);
 if p_legacy_id is not null then insert into public.booking_legacy_conversions(legacy_id,appointment_id,actor_id,agreement_source)values(p_legacy_id,aid,p_actor,btrim(p_agreement_source));end if;
 insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(aid,rev,'selected',p_command_id);
 select * into a from public.booking_appointments where id=aid;result:=public._booking_appointment_dto(a);
 insert into public.booking_appointment_commands(id,member_id,actor_id,input,result)values(p_command_id,p_member,p_actor,canonical,result);
 return result;
end $$;
revoke all on function public.select_booking_appointment(uuid,uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,uuid,text,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.select_booking_appointment(uuid,uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,uuid,text,text,text,text)to service_role;

-- Source readers retain NOWAIT source -> case -> appointment -> capacity ->
-- configuration -> notice order. This is not the source-writer nurse lock path.
create function public._booking_notice_context(p_notice uuid,p_engine text,p_sender text,p_template text)returns boolean
language plpgsql security definer set search_path='' as $$
declare n public.booking_scheduling_notices;s public.booking_program_seals;a public.booking_appointments;r public.booking_manual_reservations;
 pool public.booking_manual_capacity;c public.workspace_clinics;copy public.workspace_scheduling_settings;actor uuid;valid boolean:=true;
begin
 select * into n from public.booking_scheduling_notices where id=p_notice;
 if not found then raise insufficient_privilege using message='Scheduling notice unavailable';end if;
 select * into s from public.booking_program_seals where id=n.program_id;
 select actor_id into actor from public.booking_appointment_commands where id=n.id;
 begin perform public._booking_assert_actor(s.member_id,actor);exception when insufficient_privilege then valid:=false;end;
 if valid then
  perform public.lock_patient_clinical_sources(s.member_id);
  valid:=s.source_token is not distinct from public.patient_test_context(s.member_id)->>'token';
 end if;
 perform 1 from public.patient_clinical_cases where user_id=s.member_id for update nowait;
 select * into a from public.booking_appointments where id=n.appointment_id for update nowait;
 select * into r from public.booking_manual_reservations where id=n.reservation_id for share nowait;
 select * into pool from public.booking_manual_capacity where key=r.capacity_key for share nowait;
 select * into c from public.workspace_clinics where id=n.clinic_id for share nowait;
 select * into copy from public.workspace_scheduling_settings where id for share nowait;
 perform 1 from public.booking_scheduling_notices where id=p_notice for update nowait;
 return coalesce(valid and s.engine_version=p_engine and a.notice_id=n.id and a.revision=n.appointment_revision
 and r.state='held'and r.appointment_id=a.id and r.valid_until>clock_timestamp()and pool.valid_until>clock_timestamp()and pool.starts_at>clock_timestamp()
 and c.active and c.scheduling_revision=n.clinic_revision and c.scheduling_email=n.clinic_email
 and copy.revision=n.copy_revision and copy.copy_email=n.copy_email and p_sender=n.sender_email and p_template=n.template_version,false);
end $$;
revoke all on function public._booking_notice_context(uuid,text,text,text)from public,anon,authenticated,service_role;

create function public.claim_booking_notice(p_notice uuid,p_attempt uuid,p_generation integer,p_lease_until timestamptz,p_engine text,p_sender text,p_template text)returns jsonb
language plpgsql security definer set search_path='' as $$declare n public.booking_scheduling_notices;valid boolean;begin
 if p_attempt is null or p_generation is null or p_generation<1 or p_lease_until is null or not isfinite(p_lease_until)
 or p_lease_until<=clock_timestamp()or p_lease_until>clock_timestamp()+interval '15 minutes'then raise invalid_parameter_value using message='Invalid scheduling attempt';end if;
 valid:=public._booking_notice_context(p_notice,p_engine,p_sender,p_template);
 select * into n from public.booking_scheduling_notices where id=p_notice;
 if n.state='sending'then
  if n.lease_until<=clock_timestamp()then
   update public.booking_scheduling_notices set state='unknown'where id=n.id;
   update public.booking_appointments set status='unknown'where id=n.appointment_id and notice_id=n.id;
  end if;
  return null;
 end if;
 if n.state not in('pending','failed')then return null;end if;
 if not valid then
  update public.booking_scheduling_notices set state='reconciliation'where id=n.id;
  update public.booking_appointments set status='reconciliation'where id=n.appointment_id and notice_id=n.id;
  return null;
 end if;
 if p_generation<>n.generation+1 then raise serialization_failure using message='Attempt generation changed';end if;
 insert into public.booking_notice_attempts(id,notice_id,generation,envelope_hash)values(p_attempt,n.id,p_generation,n.envelope_hash);
 update public.booking_scheduling_notices set state='sending',generation=p_generation,lease_until=p_lease_until where id=n.id;
 return jsonb_build_object('noticeId',n.id,'attemptId',p_attempt,'generation',p_generation,'envelopeHash',n.envelope_hash,
 'senderEmail',n.sender_email,'clinicEmail',n.clinic_email,'copyEmail',n.copy_email,'templateVersion',n.template_version,'subject',n.subject,'textContent',n.text_content);
end $$;
revoke all on function public.claim_booking_notice(uuid,uuid,integer,timestamptz,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.claim_booking_notice(uuid,uuid,integer,timestamptz,text,text,text)to service_role;

-- Record external evidence in its own committed RPC BEFORE projecting it. A
-- busy source/case cannot erase a possibly accepted email or cause a resend.
create function public.record_booking_notice_receipt(p_notice uuid,p_attempt uuid,p_generation integer,p_hash text,p_outcome text,p_reference text default null,p_accepted_roles jsonb default null)returns boolean
language plpgsql security definer set search_path='' as $$
declare t public.booking_notice_attempts;n public.booking_scheduling_notices;canonical_receipt jsonb;outcome text:=p_outcome;
begin
 select * into t from public.booking_notice_attempts where id=p_attempt for update;
 if not found or t.notice_id<>p_notice or t.generation is distinct from p_generation or t.envelope_hash is distinct from p_hash then raise invalid_parameter_value using message='Receipt does not match the claimed attempt';end if;
 select * into n from public.booking_scheduling_notices where id=p_notice;
 if p_outcome is null or p_outcome not in('accepted','failed','unknown')or length(p_reference)>255 or octet_length(coalesce(p_accepted_roles,'{}'::jsonb)::text)>4096 then raise invalid_parameter_value using message='Invalid receipt';end if;
 if p_outcome='accepted'and(nullif(p_reference,'')is null or p_accepted_roles is null
  or p_accepted_roles<>jsonb_build_object('clinic',n.clinic_email,'copy',n.copy_email))then outcome:='unknown';end if;
 canonical_receipt:=jsonb_build_object('outcome',outcome,'reportedOutcome',p_outcome,'reference',p_reference,'acceptedRoles',p_accepted_roles);
 if t.receipt is not null then
  if t.receipt<>canonical_receipt then raise invalid_parameter_value using message='Receipt identity already recorded';end if;
  return true;
 end if;
 update public.booking_notice_attempts set receipt=canonical_receipt where id=t.id;
 return true;
end $$;
revoke all on function public.record_booking_notice_receipt(uuid,uuid,integer,text,text,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.record_booking_notice_receipt(uuid,uuid,integer,text,text,text,jsonb)to service_role;

create function public.apply_booking_notice_receipt(p_notice uuid,p_attempt uuid,p_engine text,p_sender text,p_template text)returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.booking_notice_attempts;n public.booking_scheduling_notices;a public.booking_appointments;valid boolean;outcome text;
begin
 select * into t from public.booking_notice_attempts where id=p_attempt and notice_id=p_notice;
 if not found or t.receipt is null then raise invalid_parameter_value using message='Recorded attempt receipt required';end if;
 select * into n from public.booking_scheduling_notices where id=p_notice;
 if t.applied_at is not null then select * into a from public.booking_appointments where id=n.appointment_id;return public._booking_appointment_dto(a);end if;
 valid:=public._booking_notice_context(p_notice,p_engine,p_sender,p_template);
 select * into n from public.booking_scheduling_notices where id=p_notice;
 select * into t from public.booking_notice_attempts where id=p_attempt for update nowait;
 select * into a from public.booking_appointments where id=n.appointment_id;
 if t.applied_at is not null then return public._booking_appointment_dto(a);end if;
 valid:=valid and n.generation=t.generation and n.state='sending'and n.lease_until>clock_timestamp();
 outcome:=case when not valid then 'reconciliation'when t.receipt->>'outcome'='accepted'then 'accepted'else t.receipt->>'outcome'end;
 update public.booking_scheduling_notices set state=outcome where id=n.id;
 if a.notice_id=n.id then
  update public.booking_appointments set status=case when outcome='accepted'then 'confirmed'else outcome end,
   current_arrangement=case when outcome='accepted'then proposed_arrangement else current_arrangement end,
   current_reservation_id=case when outcome='accepted'then proposed_reservation_id else current_reservation_id end where id=a.id;
 end if;
 -- Old manual holds are intentionally NOT automatically released. Their actual
 -- reconciliation/release policy belongs to the trusted capacity source.
 update public.booking_notice_attempts set applied_at=clock_timestamp()where id=t.id;
 insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id,attempt_id)values(a.id,n.appointment_revision,outcome,n.id,t.id);
 select * into a from public.booking_appointments where id=a.id;
 return public._booking_appointment_dto(a);
end $$;
revoke all on function public.apply_booking_notice_receipt(uuid,uuid,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.apply_booking_notice_receipt(uuid,uuid,text,text,text)to service_role;

create index booking_capacity_allocations on public.booking_manual_reservations(capacity_key,state,appointment_id);
create index booking_member_history on public.booking_appointments(member_id,created_at);
alter table public.booking_program_seals add constraint booking_program_engine_type check(jsonb_typeof(program->'engineVersion')='string');
