-- Clinic-portal scheduling (dark).
--
-- Khikar, 17 Oct 2026: clinics manage scheduling in the clinic portal and may see the phone
-- number of members booked with them. A new time proposed by a clinic needs the member to
-- accept it; a clinic never moves a booking on its own.
--
-- Built on the B1 slot engine (booking_manual_capacity, booking_offer_snapshots,
-- booking_appointments). What this adds:
--  1. Opening hours, slot length and capacity per clinic, set by the clinic admin. They
--     generate "clinic-hours" slots for the next 28 days, so the member is offered only
--     free times (replaces the manual capacity placeholder, Q4).
--  2. A second notice channel. A booking on a clinic-hours slot is announced in the clinic
--     portal instead of by email: the clinic confirms, proposes another time or declines
--     with a reason. Email notices are unchanged.
--  3. Check-in (arrived or no-show), clinic roles (admin, staff) and an audit row for
--     every clinic action.
--
-- Two switches, both off: the app flag NOREON_CLINIC_SCHEDULING_ENABLED and the row
-- clinic_scheduling_capabilities.enabled. With the row off nothing is generated, no
-- clinic-hours slot is offered or booked, and the clinic scheduling RPCs answer 'disabled'.
--
-- Isolation: every clinic RPC starts from _clinic_portal_user(clinic), which proves a live
-- membership of that clinic, and only reads bookings that have a notice addressed to it.
-- Clinics see name, phone, tests and time; never answers, notes, messages or plans.

-- 1. Switch ---------------------------------------------------------------------------------

create table public.clinic_scheduling_capabilities(
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.clinic_scheduling_capabilities(singleton)values(true);
alter table public.clinic_scheduling_capabilities enable row level security;
revoke all on public.clinic_scheduling_capabilities from public,anon,authenticated,service_role;

create function public._clinic_scheduling_enabled()returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select enabled from public.clinic_scheduling_capabilities where singleton),false)
$$;

-- 2. Clinic roles ---------------------------------------------------------------------------
-- Existing memberships keep everything they had (admin). Staff: bookings, check-in, uploads.

alter table public.clinic_portal_memberships add column role text not null default 'admin'check(role in('admin','staff'));

create or replace function public.clinic_portal_identity(p_clinic_id uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$declare m public.clinic_portal_memberships;cs jsonb;cid uuid;begin
 if p_clinic_id is null then
 select jsonb_agg(jsonb_build_object('id',x.clinic_id,'name',c.name)order by x.clinic_id)into cs from public.clinic_portal_memberships x join public.workspace_clinics c on c.id=x.clinic_id and c.active where x.user_id=auth.uid()and x.active;
 if cs is null then raise insufficient_privilege;end if;
 for cid in select(value->>'id')::uuid from jsonb_array_elements(cs)loop perform public._clinic_portal_user(cid);end loop;
 if jsonb_array_length(cs)>1 then return jsonb_build_object('status','selection-required','clinics',cs);end if;
 p_clinic_id:=(cs->0->>'id')::uuid;
 end if;
 m:=public._clinic_portal_user(p_clinic_id);
 return jsonb_build_object('status','ready','identity',jsonb_build_object('version','clinic-portal-v1','userId',m.user_id,'membershipId',m.id,'membershipRevision',m.revision,'clinicId',m.clinic_id,'clinicName',(select name from public.workspace_clinics where id=m.clinic_id),'displayName',m.display_name,
  'capability',case when m.role='staff'then 'clinic_staff'else 'clinic_admin'end));
end$$;

-- Live membership of this clinic; admin-only operations pass p_admin.
create function public._clinic_scheduling_member(c uuid,p_admin boolean)returns public.clinic_portal_memberships
language plpgsql security definer set search_path=''as $$declare m public.clinic_portal_memberships;begin
 m:=public._clinic_portal_user(c);
 if p_admin and m.role<>'admin'then raise insufficient_privilege;end if;
 return m;
end$$;

-- 3. Portal notice channel ------------------------------------------------------------------

alter table public.booking_scheduling_notices add column channel text not null default 'email'check(channel in('email','portal'));
alter table public.booking_scheduling_notices alter column sender_email drop not null,alter column clinic_email drop not null,alter column copy_email drop not null,
 alter column template_version drop not null,alter column subject drop not null,alter column text_content drop not null,alter column envelope_hash drop not null,alter column copy_revision drop not null;
alter table public.booking_scheduling_notices add constraint booking_scheduling_notices_channel_fields check(
 (channel='email'and sender_email is not null and clinic_email is not null and copy_email is not null and template_version is not null and subject is not null
  and text_content is not null and envelope_hash is not null and copy_revision is not null)
 or(channel='portal'and sender_email is null and clinic_email is null and copy_email is null and template_version is null and subject is null and text_content is null and envelope_hash is null));
alter table public.booking_scheduling_notices drop constraint booking_scheduling_notices_state_check;
alter table public.booking_scheduling_notices add constraint booking_scheduling_notices_state_check
 check(state in('pending','sending','accepted','failed','unknown','reconciliation','declined','superseded'));

-- A notice's channel follows its slot: clinic-hours slots are portal, every other slot email.
-- A portal notice only moves pending -> accepted/declined/superseded, and never gets a send attempt.
create function public._booking_notice_channel_guard()returns trigger language plpgsql security definer set search_path=''as $$
declare src text;begin
 if tg_op='INSERT'then
  select p.source into src from public.booking_manual_reservations r join public.booking_manual_capacity p on p.key=r.capacity_key where r.id=new.reservation_id;
  if(src='clinic-hours')is distinct from(new.channel='portal')then raise exception using errcode='22023',message='Notice channel must follow the slot';end if;
  if new.channel='portal'and new.state not in('pending','accepted')then raise exception using errcode='22023',message='Portal notice state';end if;
  return new;
 end if;
 if new.channel<>old.channel then raise exception using errcode='22023',message='Notice channel is fixed';end if;
 if new.channel='portal'and new.state<>old.state and not(old.state='pending'and new.state in('accepted','declined','superseded'))then
  raise exception using errcode='22023',message='Portal notice state';end if;
 if new.channel='email'and new.state in('declined','superseded')then raise exception using errcode='22023',message='Email notice state';end if;
 return new;
end$$;
create trigger booking_notice_channel_guard before insert or update on public.booking_scheduling_notices for each row execute function public._booking_notice_channel_guard();
create function public._booking_attempt_channel_guard()returns trigger language plpgsql security definer set search_path=''as $$begin
 if exists(select 1 from public.booking_scheduling_notices where id=new.notice_id and channel='portal')then raise exception using errcode='22023',message='Portal notices are not sent';end if;
 return new;
end$$;
create trigger booking_attempt_channel_guard before insert on public.booking_notice_attempts for each row execute function public._booking_attempt_channel_guard();

-- Same as 20261016003952 except a portal notice is never claimed: a browser replay of a portal
-- booking reads the saved outcome instead of failing on the channel guard (review F-01).
create or replace function public.claim_booking_notice(p_notice uuid,p_attempt uuid,p_generation integer,p_lease_until timestamptz,p_engine text,p_sender text,p_template text)returns jsonb
language plpgsql security definer set search_path='' as $$declare n public.booking_scheduling_notices;valid boolean;begin
 if p_attempt is null or p_generation is null or p_generation<1 or p_lease_until is null or not isfinite(p_lease_until)
 or p_lease_until<=clock_timestamp()or p_lease_until>clock_timestamp()+interval '15 minutes'then raise invalid_parameter_value using message='Invalid scheduling attempt';end if;
 -- A portal notice is answered in the clinic portal and is never sent (review F-01).
 if exists(select 1 from public.booking_scheduling_notices where id=p_notice and channel='portal')then return null;end if;
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
 update public.booking_appointments set status='notification-pending'where id=n.appointment_id and notice_id=n.id;
 return jsonb_build_object('noticeId',n.id,'attemptId',p_attempt,'generation',p_generation,'envelopeHash',n.envelope_hash,
 'senderEmail',n.sender_email,'clinicEmail',n.clinic_email,'copyEmail',n.copy_email,'templateVersion',n.template_version,'subject',n.subject,'textContent',n.text_content);
end $$;

-- Generated offers are re-versioned when the clinic changes its tests, preparation or address.
alter table public.booking_offer_snapshots add column superseded_at timestamptz;

-- 4. Opening hours and generated slots -----------------------------------------------------

create table public.clinic_schedules(
 clinic_id uuid primary key references public.workspace_clinics(id),
 active boolean not null default false,
 slot_minutes integer not null check(slot_minutes between 10 and 240),
 capacity integer not null check(capacity between 1 and 50),
 covered_test_ids text[] not null check(cardinality(covered_test_ids)between 1 and 50),
 follow_up_test_ids text[] not null default '{}'check(cardinality(follow_up_test_ids)<=50),
 preparation text not null check(length(btrim(preparation))between 1 and 2000),
 revision bigint not null default 1 check(revision>0),
 generated_on date,generated_version text,
 updated_by uuid not null references auth.users(id),updated_at timestamptz not null default clock_timestamp(),
 check(not(covered_test_ids&&follow_up_test_ids))
);
create table public.clinic_schedule_hours(
 clinic_id uuid not null references public.clinic_schedules(clinic_id)on delete cascade,
 weekday smallint not null check(weekday between 1 and 7),
 opens time not null,closes time not null,check(closes>opens),
 primary key(clinic_id,weekday)
);
alter table public.clinic_schedules enable row level security;
alter table public.clinic_schedule_hours enable row level security;
revoke all on public.clinic_schedules,public.clinic_schedule_hours from public,anon,authenticated,service_role;

-- Materialise this clinic's slots for the next 28 Yerevan days. Idempotent: an existing slot
-- keeps its key and its holds; capacity and validity follow the current hours; a future slot
-- outside the hours stops being offered (visits already held keep their place). Skips when
-- nothing changed today unless forced.
create function public._clinic_schedule_generate(c uuid,p_force boolean)returns integer
language plpgsql security definer set search_path=''as $$
declare s public.clinic_schedules;cl public.workspace_clinics;ver text;today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;
 d date;h public.clinic_schedule_hours;m integer;om integer;cm integer;st timestamptz;en timestamptz;k text;ref text;oid uuid;follow jsonb;keys text[]:='{}';n integer:=0;held bigint;
begin
 select * into s from public.clinic_schedules where clinic_id=c for update;
 if not found then return 0;end if;
 select * into cl from public.workspace_clinics where id=c;
 -- The offer version follows what the member sees (tests, preparation, address), not the hours (review F-06).
 ver:='clinic-hours-'||left(md5(array_to_string(s.covered_test_ids,',')||'|'||array_to_string(s.follow_up_test_ids,',')||'|'||s.preparation||'|'||coalesce(cl.address,'')),16);
 if not p_force and s.generated_on=today and s.generated_version=ver then return 0;end if;
 if s.active and cl.active and public._clinic_scheduling_enabled()and nullif(btrim(cl.address),'')is not null then
  select coalesce(jsonb_agg(jsonb_build_object('testId',x,'owner','Noreon care team','action','Noreon arranges this test separately.','reference','clinic-hours')order by x),'[]'::jsonb)
   into follow from unnest(s.follow_up_test_ids)x;
  for d in select g::date from generate_series(today,today+27,interval '1 day')g loop
   for h in select * from public.clinic_schedule_hours where clinic_id=c and weekday=extract(isodow from d)loop
    om:=extract(hour from h.opens)::integer*60+extract(minute from h.opens)::integer;
    cm:=extract(hour from h.closes)::integer*60+extract(minute from h.closes)::integer;
    m:=om;
    while m+s.slot_minutes<=cm loop
     st:=(d+make_time(m/60,m%60,0))at time zone 'Asia/Yerevan';en:=st+make_interval(mins=>s.slot_minutes);m:=m+s.slot_minutes;
     if st<=clock_timestamp()then continue;end if;
     k:=encode(extensions.digest('clinic-hours:'||c::text||':'||extract(epoch from st)::bigint::text||':'||s.slot_minutes::text,'sha256'),'hex');
     ref:=c::text||'@'||to_char(st at time zone 'UTC','YYYY-MM-DD"T"HH24:MI"Z"')||'/'||s.slot_minutes;
     -- Visits held on an overlapping earlier slot (for example before a visit-length change) use up
     -- this time's capacity (review F-06).
     select count(distinct r.appointment_id)into held from public.booking_manual_reservations r join public.booking_manual_capacity p on p.key=r.capacity_key
      where r.state='held'and p.clinic_id=c and p.source='clinic-hours'and p.key<>k and p.starts_at<en and p.ends_at>st;
     if s.capacity-held<1 then continue;end if;
     keys:=keys||k;
     insert into public.booking_manual_capacity(key,source,reference,clinic_id,starts_at,ends_at,capacity,valid_until,created_by)
      values(k,'clinic-hours',ref,c,st,en,s.capacity-held,st,s.updated_by)
      on conflict(key)do update set capacity=excluded.capacity,valid_until=excluded.valid_until where public.booking_manual_capacity.source='clinic-hours';
     -- Deterministic offer id per slot, shaped as an RFC 4122 version-5 UUID (the app validates the version and variant).
     oid:=(substr(md5(k),1,8)||'-'||substr(md5(k),9,4)||'-5'||substr(md5(k),14,3)||'-a'||substr(md5(k),18,3)||'-'||substr(md5(k),21,12))::uuid;
     if not exists(select 1 from public.booking_offer_snapshots where id=oid and version=ver)then
      update public.booking_offer_snapshots set superseded_at=clock_timestamp()where capacity_key=k and superseded_at is null;
      insert into public.booking_offer_snapshots(id,version,capacity_key,offer,created_by)values(oid,ver,k,jsonb_build_object(
       'id',oid,'version',ver,'source','clinic-hours','clinicId',c,'mode','clinic','startsAt',st,'endsAt',en,'timezone','Asia/Yerevan','clinicAddress',cl.address,
       'preparation',s.preparation,'preparationVersion',ver,'coveredTestIds',to_jsonb(s.covered_test_ids),'followUps',follow,
       'reservationContract',jsonb_build_object('version','clinic-hours-v1','reference',ref)),s.updated_by);
     end if;
     n:=n+1;
    end loop;
   end loop;
  end loop;
 end if;
 update public.booking_manual_capacity set valid_until=clock_timestamp()
  where clinic_id=c and source='clinic-hours'and starts_at>clock_timestamp()and valid_until>clock_timestamp()and not(key=any(keys));
 update public.clinic_schedules set generated_on=today,generated_version=ver where clinic_id=c;
 return n;
end$$;

-- Daily top-up before member offers are read (service role, from the member booking path).
create function public.clinic_schedule_top_up()returns integer
language plpgsql security definer set search_path=''as $$declare c uuid;n integer:=0;begin
 if not public._clinic_scheduling_enabled()then return 0;end if;
 for c in select clinic_id from public.clinic_schedules where active order by clinic_id loop
  n:=n+public._clinic_schedule_generate(c,false);
 end loop;
 return n;
end$$;

-- 5. Offers and the admin slot list ---------------------------------------------------------

-- Same as 20261016181417 except superseded generated offers are not offered, and clinic-hours
-- slots only while clinic scheduling is switched on.
create or replace function public.booking_pilot_offers(p_member uuid,p_actor uuid,p_program_id uuid)returns jsonb
language plpgsql stable security definer set search_path='' as $$declare seal public.booking_program_seals;begin
 perform public._booking_assert_actor(p_member,p_actor);
 select * into seal from public.booking_program_seals where id=p_program_id and member_id=p_member and actor_id=p_actor;
 if not found or seal.source_token is distinct from public.patient_test_context(p_member)->>'token'then raise serialization_failure using message='Booking program changed';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('offer',public._booking_offer_project(seal.program,o.offer),'clinicName',c.name)order by p.starts_at,o.id,o.version),'[]'::jsonb)
 from public.booking_offer_snapshots o join public.booking_manual_capacity p on p.key=o.capacity_key join public.workspace_clinics c on c.id=p.clinic_id
 where c.active and p.valid_until>clock_timestamp()and p.starts_at>clock_timestamp()and public._booking_offer_coverage(seal.program,o.offer)
 and o.superseded_at is null and(p.source<>'clinic-hours'or public._clinic_scheduling_enabled())
 and(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=p.key and r.state='held')<p.capacity);
end $$;

-- Same as 20261016181417 except generated clinic-hours slots are managed in the clinic portal.
create or replace function public.real_admin_booking_slots()returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform public._real_staff_require_admin();
 return(select coalesce(jsonb_agg(jsonb_build_object('key',p.key,'clinicId',p.clinic_id,'clinicName',c.name,'startsAt',p.starts_at,'endsAt',p.ends_at,'capacity',p.capacity,
  'validUntil',p.valid_until,'open',p.valid_until>clock_timestamp()and p.starts_at>clock_timestamp(),'reference',p.reference,'createdAt',p.created_at,
  'held',(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=p.key and r.state='held'),
  'offers',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'version',o.version,'mode',o.offer->>'mode','coveredTestIds',o.offer->'coveredTestIds','preparation',o.offer->>'preparation')order by o.created_at),'[]'::jsonb)
   from public.booking_offer_snapshots o where o.capacity_key=p.key))order by p.starts_at,p.key),'[]'::jsonb)
 from public.booking_manual_capacity p join public.workspace_clinics c on c.id=p.clinic_id where p.ends_at>clock_timestamp()-interval '1 day'and p.source<>'clinic-hours');
end $$;

-- Same as 20261016030811 except a portal notice never offers the email first-send.
create or replace function public._booking_appointment_dto(p_row public.booking_appointments)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version','email-pilot-v1','id',p_row.id,'memberId',p_row.member_id,'revision',p_row.revision,
 'status',case when n.state='sending'and n.lease_until<=clock_timestamp()then 'unknown'
  when n.state='sending'and exists(select 1 from public.booking_notice_attempts t where t.notice_id=n.id and t.receipt is not null)then 'reconciliation'else p_row.status end,
 'canStartScheduling',p_row.status='notification-pending'and n.channel='email'and n.state='pending'and n.generation=0 and not exists(select 1 from public.booking_notice_attempts t where t.notice_id=n.id),
 'program',(select coalesce(jsonb_agg(i-'source'),'[]'::jsonb)from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=p_row.program_id),
 'currentProgram',coalesce(p_row.current_program,'[]'::jsonb),'legacyCurrent',p_row.legacy_current,
 'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',v.revision,'createdAt',v.created_at,
  'program',(select jsonb_agg(i-'source')from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=v.program_id),
  'previous',v.previous_arrangement,'proposed',v.proposed_arrangement,
  'noticeState',case when old_notice.state='sending'and old_notice.lease_until<=clock_timestamp()then 'unknown'when old_notice.state='sending'and exists(select 1 from public.booking_notice_attempts t where t.notice_id=old_notice.id and t.receipt is not null)then 'reconciliation'else old_notice.state end)order by v.revision),'[]'::jsonb)
  from public.booking_appointment_versions v join public.booking_scheduling_notices old_notice on old_notice.id=v.notice_id where v.appointment_id=p_row.id),
 'current',p_row.current_arrangement,'proposed',p_row.proposed_arrangement,'noticeId',p_row.notice_id,'createdAt',p_row.created_at)
 from public.booking_scheduling_notices n where n.id=p_row.notice_id
$$;

-- 6. Member booking on a clinic-hours slot --------------------------------------------------
-- Same as 20261016181417 except a clinic-hours slot records a portal notice (no email
-- content) and a superseded offer version is refused.
create or replace function public.select_booking_appointment(p_command_id uuid,p_member uuid,p_actor uuid,p_program_id uuid,p_offer_id uuid,p_offer_version text,
 p_home_address text default null,p_appointment_id uuid default null,p_revision bigint default null,p_agreement_source text default null,p_legacy_id uuid default null,
 p_sender_email text default null,p_template_version text default null,p_subject text default null,p_text_content text default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare seal public.booking_program_seals;offer_row public.booking_offer_snapshots;pool public.booking_manual_capacity;clinic public.workspace_clinics;copy public.workspace_scheduling_settings;
 a public.booking_appointments;prior public.booking_appointment_commands;legacy public.patient_test_requests;canonical jsonb;details jsonb;projected jsonb;result jsonb;aid uuid;rev bigint;enrolled uuid;sender text;portal boolean;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 if p_command_id is null or p_offer_id is null or nullif(p_offer_version,'')is null then raise invalid_parameter_value using message='Offer and command identity required';end if;
 canonical:=jsonb_build_object('programId',p_program_id,'offerId',p_offer_id,'offerVersion',p_offer_version,'homeAddress',nullif(btrim(p_home_address),''),
 'appointmentId',p_appointment_id,'revision',p_revision,'agreementSource',nullif(btrim(p_agreement_source),''),'legacyId',p_legacy_id,
 'senderEmail',p_sender_email,'templateVersion',p_template_version,'subject',p_subject,'textContent',p_text_content);
 perform pg_advisory_xact_lock(hashtextextended('booking-command:'||p_command_id::text,0));
 select * into prior from public.booking_appointment_commands where id=p_command_id;
 if found then
  if prior.member_id<>p_member or prior.actor_id<>p_actor or prior.input<>canonical then raise invalid_parameter_value using message='Command identity already used';end if;
  return public.recover_booking_command(p_command_id,p_member,p_actor,canonical-array['programId','senderEmail','templateVersion','subject','textContent']);
 end if;
 perform public.lock_patient_clinical_sources(p_member);
 select * into seal from public.booking_program_seals where id=p_program_id and member_id=p_member and actor_id=p_actor;
 if not found or seal.source_token is distinct from public.patient_test_context(p_member)->>'token'then raise serialization_failure using message='Booking program changed';end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-member:'||p_member::text,0));
 insert into public.patient_clinical_cases(user_id)values(p_member)on conflict do nothing returning user_id into enrolled;
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 perform public._booking_assert_actor(p_member,p_actor);
 if enrolled is not null then insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id)values(p_member,0,'enrolled',p_actor);end if;
 if exists(select 1 from public.patient_test_requests r where r.user_id=p_member and r.status<>'cancelled'
  and(r.id is distinct from p_legacy_id)and not exists(select 1 from public.booking_legacy_conversions c where c.legacy_id=r.id))then raise serialization_failure using message='Reconcile the existing historical request first';end if;
 aid:=coalesce(p_appointment_id,p_command_id);
 select * into a from public.booking_appointments where id=aid for update nowait;
 if p_appointment_id is not null then
  if not found or a.member_id<>p_member then raise insufficient_privilege using message='Appointment unavailable';end if;
  if a.revision is distinct from p_revision or (a.status in('notification-pending','unknown','reconciliation')or exists(select 1 from public.booking_scheduling_notices n where n.id=a.notice_id and n.state in('pending','sending','unknown','reconciliation')))then raise serialization_failure using message='Resolve the current arrangement before changing it';end if;
  if p_actor<>p_member and coalesce(length(btrim(p_agreement_source)),0)not between 3 and 1000 then raise invalid_parameter_value using message='Record member agreement source';end if;
  -- B1: a change stays with the clinic that holds the visit. Moving to another clinic is a
  -- cancellation (emailed to the first clinic) followed by a new booking (emailed to the second).
  if a.current_arrangement is not null and exists(select 1 from public.booking_offer_snapshots o join public.booking_manual_capacity p on p.key=o.capacity_key
   where o.id=p_offer_id and o.version=p_offer_version and p.clinic_id is distinct from(a.current_arrangement->>'clinicId')::uuid)then
   raise invalid_parameter_value using message='Reschedule within the same clinic; cancel and book again to change clinic';
  end if;
  rev:=a.revision+1;
 elsif found or exists(select 1 from public.booking_appointments where member_id=p_member and requirements_token=seal.requirements_token)then
  raise serialization_failure using message='Use the existing appointment for this program';
 else rev:=0;end if;
 select * into offer_row from public.booking_offer_snapshots where id=p_offer_id and version=p_offer_version;
 if not found or not public._booking_offer_coverage(seal.program,offer_row.offer)then raise invalid_parameter_value using message='Complete program coverage and follow-up required';end if;
 projected:=public._booking_offer_project(seal.program,offer_row.offer);
 select * into pool from public.booking_manual_capacity where key=offer_row.capacity_key for update nowait;
 if pool.valid_until<=clock_timestamp()or pool.starts_at<=clock_timestamp()then raise serialization_failure using message='Offer validity changed';end if;
 if(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=pool.key and r.state='held'and r.appointment_id<>aid)>=pool.capacity then raise serialization_failure using message='Offer capacity changed';end if;
 -- Clinic-hours slots are announced in the clinic portal, not by email (clinic scheduling).
 portal:=pool.source='clinic-hours';
 if offer_row.superseded_at is not null or(portal and not public._clinic_scheduling_enabled())then raise serialization_failure using message='Offer validity changed';end if;
 select * into clinic from public.workspace_clinics where id=pool.clinic_id and active for share;
 if not found then raise insufficient_privilege using message='Active clinic required';end if;
 if not portal then
 select * into copy from public.workspace_scheduling_settings where id for share;
 sender:=public._real_scheduling_email(p_sender_email);
 if sender is null or clinic.scheduling_email is null or copy.copy_email is null or coalesce(length(p_template_version),0)not between 1 and 200
 or coalesce(length(p_subject),0)not between 1 and 200 or p_subject~E'[\r\n]'or coalesce(length(p_text_content),0)not between 1 and 32000 then
  raise invalid_parameter_value using message='Approved scheduling configuration and content required';
 end if;
 end if;
 if offer_row.offer->>'mode'='home'then
  if coalesce(length(btrim(p_home_address)),0)not between 3 and 1000 then raise invalid_parameter_value using message='Home visit address required';end if;
 elsif p_home_address is not null or nullif(btrim(clinic.address),'')is null or offer_row.offer->>'clinicAddress'is distinct from clinic.address then
  raise invalid_parameter_value using message='Use the current trusted clinic address';
 end if;
 details:=jsonb_build_object('offerId',p_offer_id,'offerVersion',p_offer_version,'clinicId',clinic.id,'mode',offer_row.offer->>'mode','startsAt',offer_row.offer->>'startsAt',
 'endsAt',offer_row.offer->>'endsAt','timezone','Asia/Yerevan','location',case when offer_row.offer->>'mode'='home'then btrim(p_home_address)else clinic.address end,
 'preparation',offer_row.offer->>'preparation','preparationVersion',offer_row.offer->>'preparationVersion','coveredTestIds',projected->'coveredTestIds','followUps',projected->'followUps');
 if p_legacy_id is not null then
  select * into legacy from public.patient_test_requests where id=p_legacy_id and user_id=p_member for update nowait;
  if not found or legacy.status in('cancelled','change-pending')or exists(select 1 from public.booking_legacy_conversions where legacy_id=p_legacy_id)
   or coalesce(length(btrim(p_agreement_source)),0)not between 3 and 1000 then raise serialization_failure using message='Historical conversion requires explicit reconciliation';end if;
 end if;
 insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)
 values(p_command_id,aid,pool.key,p_offer_id,p_offer_version,p_member,pool.valid_until);
 if p_appointment_id is null then
  insert into public.booking_appointments(id,member_id,program_id,requirements_token,revision,status,proposed_arrangement,proposed_reservation_id,notice_id,legacy_current,current_program)
  values(aid,p_member,seal.id,seal.requirements_token,rev,'notification-pending',details,p_command_id,p_command_id,
   case when p_legacy_id is not null then legacy.current_arrangement else null end,
   case when p_legacy_id is not null and legacy.current_arrangement is not null then
    (select jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method','preparation',''))from jsonb_array_elements(legacy.requirements)i)else null end);
 else
  update public.booking_appointments set program_id=seal.id,requirements_token=seal.requirements_token,revision=rev,status='notification-pending',proposed_arrangement=details,
   proposed_reservation_id=p_command_id,notice_id=p_command_id where id=aid;
 end if;
 insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,
  sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,channel,purpose)
 values(p_command_id,aid,rev,seal.id,p_command_id,clinic.id,clinic.scheduling_revision,case when portal then null else copy.revision end,
 case when portal then null else sender end,case when portal then null else clinic.scheduling_email end,case when portal then null else copy.copy_email end,
 case when portal then null else p_template_version end,case when portal then null else p_subject end,case when portal then null else p_text_content end,
 case when portal then null else public._booking_envelope_hash(sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content)end,
 case when portal then 'portal'else 'email'end,
 case when a.current_arrangement is not null or legacy.current_arrangement is not null then 'change'else 'booking'end);
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,previous_arrangement,proposed_arrangement,notice_id,actor_id,agreement_source,legacy_snapshot,previous_program)
 values(aid,rev,seal.id,a.current_arrangement,details,p_command_id,p_actor,nullif(btrim(p_agreement_source),''),case when p_legacy_id is not null then to_jsonb(legacy)else null end,a.current_program);
 if p_legacy_id is not null then insert into public.booking_legacy_conversions(legacy_id,appointment_id,actor_id,agreement_source)values(p_legacy_id,aid,p_actor,btrim(p_agreement_source));end if;
 insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(aid,rev,'selected',p_command_id);
 select * into a from public.booking_appointments where id=aid;result:=public._booking_appointment_dto(a);
 insert into public.booking_appointment_commands(id,member_id,actor_id,input,result)values(p_command_id,p_member,p_actor,canonical,result);
 return result;
end $$;

-- Cancelling tells the clinic through the same notice path. The visit stays
-- current until the clinic email is accepted; then it is cancelled and its hold


-- 7. Clinic decisions, proposals, check-ins and their audit ---------------------------------

create table public.clinic_booking_decisions(
 id uuid primary key,clinic_id uuid not null references public.workspace_clinics(id),appointment_id uuid not null references public.booking_appointments(id),
 appointment_revision bigint not null,notice_id uuid not null unique references public.booking_scheduling_notices(id),
 kind text not null check(kind in('confirmed','declined')),reason text,
 actor_id uuid not null references auth.users(id),membership_id uuid not null references public.clinic_portal_memberships(id),created_at timestamptz not null default clock_timestamp(),
 check((kind='confirmed'and reason is null)or(kind='declined'and length(btrim(reason))between 3 and 500))
);
create table public.clinic_booking_proposals(
 id uuid primary key,clinic_id uuid not null references public.workspace_clinics(id),appointment_id uuid not null references public.booking_appointments(id),
 appointment_revision bigint not null,capacity_key text not null references public.booking_manual_capacity(key),starts_at timestamptz not null,ends_at timestamptz not null,
 note text check(note is null or length(btrim(note))between 1 and 500),
 state text not null default 'open'check(state in('open','accepted','rejected','withdrawn')),
 actor_id uuid not null references auth.users(id),membership_id uuid not null references public.clinic_portal_memberships(id),
 telegram_message_id uuid references public.telegram_auth_messages(id),created_at timestamptz not null default clock_timestamp(),
 decided_at timestamptz,decided_by uuid references auth.users(id),
 check((state='open')=(decided_at is null))
);
create unique index clinic_booking_proposals_one_open on public.clinic_booking_proposals(appointment_id)where state='open';
create table public.clinic_booking_checkins(
 id bigint generated always as identity primary key,clinic_id uuid not null references public.workspace_clinics(id),appointment_id uuid not null references public.booking_appointments(id),
 reservation_id uuid not null references public.booking_manual_reservations(id),outcome text not null check(outcome in('arrived','no-show')),
 actor_id uuid not null references auth.users(id),membership_id uuid not null references public.clinic_portal_memberships(id),recorded_at timestamptz not null default clock_timestamp()
);
create index clinic_booking_checkins_reservation on public.clinic_booking_checkins(reservation_id,id desc);
create table public.clinic_schedule_commands(
 actor_id uuid not null references auth.users(id),submission_id uuid not null,clinic_id uuid not null references public.workspace_clinics(id),
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default clock_timestamp(),primary key(actor_id,submission_id)
);
alter table public.clinic_booking_decisions enable row level security;
alter table public.clinic_booking_proposals enable row level security;
alter table public.clinic_booking_checkins enable row level security;
alter table public.clinic_schedule_commands enable row level security;
revoke all on public.clinic_booking_decisions,public.clinic_booking_proposals,public.clinic_booking_checkins,public.clinic_schedule_commands from public,anon,authenticated,service_role;
create trigger clinic_booking_decisions_immutable before update or delete on public.clinic_booking_decisions for each row execute function public._clinic_portal_immutable();
create trigger clinic_booking_checkins_immutable before update or delete on public.clinic_booking_checkins for each row execute function public._clinic_portal_immutable();

-- Placeholder wording, held at claim by the auth outbox until an approved version exists.
insert into public.system_message_templates(template_id,version,locale,body)values
 ('booking.clinic_proposal',1,'en','UNAPPROVED PLACEHOLDER. Your clinic suggested a new visit time. Open Noreon to accept or decline it.'),
 ('booking.clinic_proposal',1,'hy','UNAPPROVED PLACEHOLDER. Ձեր կլինիկան այցի նոր ժամ է առաջարկել։ Բացեք Noreon-ը՝ այն ընդունելու կամ մերժելու համար։');

-- Program titles of the tests done at this arrangement, in program order.
create function public._clinic_schedule_tests(p_program uuid,p_arrangement jsonb)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(i->>'title'order by n),'[]'::jsonb)from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')with ordinality x(i,n)
 where s.id=p_program and p_arrangement->'coveredTestIds'?(i->>'id')
$$;

-- The clinic's view of one booking. kind: 'pending' (a portal or email request addressed to
-- this clinic), 'current' (a confirmed visit at this clinic) or 'history' (the latest notice
-- this clinic received, for a booking that is no longer active here).
create function public._clinic_schedule_row(c uuid,a public.booking_appointments)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare cur public.booking_scheduling_notices;last public.booking_scheduling_notices;v public.booking_appointment_versions;kind text;arr jsonb;prev jsonb:=null;status text;
 checkin text;ref uuid;channel text;proposal jsonb;active boolean;
begin
 select * into cur from public.booking_scheduling_notices where id=a.notice_id;
 if a.status='notification-pending'and cur.clinic_id=c and cur.state='pending'and cur.purpose<>'cancellation'then
  kind:='pending';arr:=a.proposed_arrangement;prev:=a.current_arrangement;ref:=cur.id;channel:=cur.channel;
  status:=case when a.current_arrangement is null then 'requested'else 'change-requested'end;
 elsif a.status='confirmed'and a.current_arrangement->>'clinicId'=c::text then
  kind:='current';arr:=a.current_arrangement;ref:=a.notice_id;
  select p.source into channel from public.booking_manual_reservations r join public.booking_manual_capacity p on p.key=r.capacity_key where r.id=a.current_reservation_id;
  channel:=case when channel='clinic-hours'then 'portal'else 'email'end;
  select outcome into checkin from public.clinic_booking_checkins where reservation_id=a.current_reservation_id order by id desc limit 1;
  status:=coalesce(checkin,'confirmed');
 else
  select * into last from public.booking_scheduling_notices where appointment_id=a.id and clinic_id=c order by appointment_revision desc limit 1;
  if not found then return null;end if;
  select * into v from public.booking_appointment_versions where notice_id=last.id;
  kind:='history';arr:=v.proposed_arrangement;ref:=last.id;channel:=last.channel;
  status:=case when last.purpose='cancellation'and last.state='accepted'then 'cancelled'when last.state='declined'then 'declined'else 'other'end;
 end if;
 active:=status in('requested','change-requested','confirmed','arrived','no-show');
 select jsonb_build_object('id',p.id,'startsAt',p.starts_at,'endsAt',p.ends_at,'note',p.note,'createdAt',p.created_at)into proposal
  from public.clinic_booking_proposals p where p.appointment_id=a.id and p.clinic_id=c and p.state='open';
 return jsonb_build_object('appointmentId',a.id,'revision',a.revision,'reference',ref,'kind',kind,'status',status,'channel',channel,
  'memberName',coalesce((select nullif(btrim(display_name),'')from public.profiles where id=a.member_id),''),
  'memberPhone',case when active then(select case when phone is null or phone=''then null when phone like '+%'then phone else '+'||phone end from auth.users where id=a.member_id)else null end,
  'startsAt',arr->>'startsAt','endsAt',arr->>'endsAt','previousStartsAt',prev->>'startsAt','previousEndsAt',prev->>'endsAt',
  'tests',public._clinic_schedule_tests(a.program_id,arr),'proposal',proposal,
  'decline',(select jsonb_build_object('reason',d.reason,'at',d.created_at)from public.clinic_booking_decisions d where d.notice_id=ref and d.kind='declined'));
end$$;

-- Bookings at this clinic. Scope 'upcoming' (from the start of today, Yerevan) or 'past';
-- a day overrides the scope. Status filter: requested (includes change requests), confirmed,
-- arrived, no-show, declined, cancelled.
create function public.clinic_schedule_bookings(p_clinic uuid,p_scope text default 'upcoming',p_day date default null,p_status text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;today timestamptz;rows jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then return jsonb_build_object('version','clinic-schedule-bookings-v1','enabled',false,'bookings','[]'::jsonb);end if;
 if p_scope not in('upcoming','past')or(p_status is not null and p_status not in('requested','confirmed','arrived','no-show','declined','cancelled'))then raise invalid_parameter_value;end if;
 perform public._clinic_schedule_generate(p_clinic,false);
 today:=((clock_timestamp()at time zone 'Asia/Yerevan')::date)::timestamp at time zone 'Asia/Yerevan';
 select coalesce(jsonb_agg(r order by case when p_day is null and p_scope='past'then -extract(epoch from(r->>'startsAt')::timestamptz)else extract(epoch from(r->>'startsAt')::timestamptz)end,r->>'appointmentId'),'[]'::jsonb)
 into rows from(
  select r from public.booking_appointments a cross join lateral public._clinic_schedule_row(p_clinic,a)r
  where exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=p_clinic)and r is not null
  and r->>'status'<>'other'
  and(p_status is null or r->>'status'=p_status or(p_status='requested'and r->>'status'='change-requested'))
  and(case when p_day is not null then(((r->>'startsAt')::timestamptz)at time zone 'Asia/Yerevan')::date=p_day
   when p_scope='upcoming'then(r->>'startsAt')::timestamptz>=today else(r->>'startsAt')::timestamptz<today end)
  order by case when p_day is null and p_scope='past'then -extract(epoch from(r->>'startsAt')::timestamptz)else extract(epoch from(r->>'startsAt')::timestamptz)end,r->>'appointmentId'
  limit 300)x;
 return jsonb_build_object('version','clinic-schedule-bookings-v1','enabled',true,'role',m.role,'bookings',rows);
end$$;

-- Free generated slots of this clinic on one day, for proposing another time.
create function public.clinic_schedule_free_slots(p_clinic uuid,p_day date)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then return '[]'::jsonb;end if;
 if p_day is null then raise invalid_parameter_value;end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('key',p.key,'startsAt',p.starts_at,'endsAt',p.ends_at,
  'free',p.capacity-(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=p.key and r.state='held'))order by p.starts_at),'[]'::jsonb)
 from public.booking_manual_capacity p where p.clinic_id=p_clinic and p.source='clinic-hours'and p.starts_at>clock_timestamp()and p.valid_until>clock_timestamp()
  and((p.starts_at at time zone 'Asia/Yerevan')::date)=p_day
  and(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=p.key and r.state='held')<p.capacity
  and exists(select 1 from public.booking_offer_snapshots o where o.capacity_key=p.key and o.superseded_at is null));
end$$;

-- Normalised clinic command. UUIDs are canonicalised so a replay compares equal.
create function public._clinic_schedule_command(p jsonb)returns jsonb language plpgsql immutable set search_path=''as $$declare keys text[];k text;begin
 if jsonb_typeof(p)is distinct from 'object'or p->>'version'is distinct from 'clinic-schedule-command-v1'then raise invalid_parameter_value;end if;
 keys:=case p->>'op'
  when 'confirm'then array['version','op','submissionId','appointmentId','revision']
  when 'decline'then array['version','op','submissionId','appointmentId','revision','reason']
  when 'propose'then array['version','op','submissionId','appointmentId','revision','slotKey','note']
  when 'withdraw-proposal'then array['version','op','submissionId','appointmentId','revision','proposalId']
  when 'check-in'then array['version','op','submissionId','appointmentId','revision','outcome']
  else null end;
 if keys is null or p-keys<>'{}'::jsonb or not p?&keys then raise invalid_parameter_value;end if;
 foreach k in array(array['submissionId','appointmentId']||case when p->>'op'='withdraw-proposal'then array['proposalId']else '{}'::text[]end)loop
  if jsonb_typeof(p->k)is distinct from 'string'then raise invalid_parameter_value;end if;p:=jsonb_set(p,array[k],to_jsonb((p->>k)::uuid::text));
 end loop;
 if jsonb_typeof(p->'revision')is distinct from 'number'or p->>'revision'!~'^[0-9]+$'or(p->>'revision')::numeric>9007199254740991 then raise invalid_parameter_value;end if;
 if p->>'op'='decline'then
  if jsonb_typeof(p->'reason')is distinct from 'string'or length(btrim(p->>'reason'))not between 3 and 500 then raise invalid_parameter_value;end if;p:=jsonb_set(p,'{reason}',to_jsonb(btrim(p->>'reason')));
 elsif p->>'op'='propose'then
  if jsonb_typeof(p->'slotKey')is distinct from 'string'or p->>'slotKey'!~'^[a-f0-9]{64}$'then raise invalid_parameter_value;end if;
  if jsonb_typeof(p->'note')='string'and length(btrim(p->>'note'))between 1 and 500 then p:=jsonb_set(p,'{note}',to_jsonb(btrim(p->>'note')));
  elsif jsonb_typeof(p->'note')='null'or(jsonb_typeof(p->'note')='string'and btrim(p->>'note')='')then p:=jsonb_set(p,'{note}','null'::jsonb);
  else raise invalid_parameter_value;end if;
 elsif p->>'op'='check-in'and coalesce(p->>'outcome','')not in('arrived','no-show')then raise invalid_parameter_value;
 end if;
 return p;
end$$;

create function public._clinic_schedule_audit(c uuid,a uuid,kind text,detail jsonb)returns void
language sql security definer set search_path=''as $$
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(c,null,a,kind,detail)
$$;

-- Queue the member's Telegram notice about a proposed time (auth outbox, test bot in staging).
create function public._clinic_proposal_notify(p_member uuid)returns uuid
language plpgsql security definer set search_path=''as $$declare b public.telegram_auth_bindings;begin
 select * into b from public.telegram_auth_bindings where auth_user_id=p_member and kind='member'and active order by created_at desc limit 1;
 if not found then return null;end if;
 return public._telegram_auth_enqueue('booking.clinic_proposal',public._telegram_auth_locale(p_member),b.address,b.principal_ref,null,null);
end$$;

-- Confirm, decline, propose another time, withdraw a proposal, or record arrival/no-show.
-- Answers a status code; never throws for an expected refusal. Replays return the saved result.
create function public.clinic_schedule_command(p_clinic uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare p jsonb;m public.clinic_portal_memberships;prior public.clinic_schedule_commands;sub uuid;aid uuid;a public.booking_appointments;n public.booking_scheduling_notices;
 r public.booking_manual_reservations;pool public.booking_manual_capacity;pr public.clinic_booking_proposals;result jsonb;op text;mid uuid;starts timestamptz;held bigint;
begin
 perform set_config('lock_timeout','1500ms',true);
 begin p:=public._clinic_schedule_command(p_command);
 exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status','invalid');end;
 sub:=(p->>'submissionId')::uuid;aid:=(p->>'appointmentId')::uuid;op:=p->>'op';
 m:=public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then return jsonb_build_object('status','disabled');end if;
 perform public._clinic_portal_command_lock(m.user_id,sub);
 select * into prior from public.clinic_schedule_commands where actor_id=m.user_id and submission_id=sub;
 if found then
  if prior.clinic_id<>p_clinic or prior.payload<>p then return jsonb_build_object('status','conflict');end if;
  return prior.result;
 end if;
 -- Same lock order as the member RPCs: member lock first, then the appointment row (review F-07).
 perform pg_advisory_xact_lock(hashtextextended('booking-member:'||(select member_id from public.booking_appointments where id=aid)::text,0));
 select * into a from public.booking_appointments where id=aid for update nowait;
 if not found then return jsonb_build_object('status','invalid');end if;
 -- Isolation: the booking must have a notice addressed to this clinic.
 if not exists(select 1 from public.booking_scheduling_notices where appointment_id=a.id and clinic_id=p_clinic)then return jsonb_build_object('status','invalid');end if;
 if a.revision<>(p->>'revision')::bigint then return jsonb_build_object('status','stale');end if;
 select * into n from public.booking_scheduling_notices where id=a.notice_id;

 if op in('confirm','decline')then
  if a.status<>'notification-pending'or n.clinic_id<>p_clinic or n.channel<>'portal'or n.state<>'pending'or n.purpose='cancellation'then return jsonb_build_object('status','stale');end if;
  select * into r from public.booking_manual_reservations where id=a.proposed_reservation_id for update;
  select * into pool from public.booking_manual_capacity where key=r.capacity_key;
  if op='confirm'then
   if pool.starts_at<=clock_timestamp()then return jsonb_build_object('status','past');end if;
   update public.booking_scheduling_notices set state='accepted'where id=n.id;
   update public.booking_appointments set status='confirmed',current_arrangement=proposed_arrangement,current_reservation_id=proposed_reservation_id,legacy_current=null,
    current_program=(select jsonb_agg(i-'source')from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=n.program_id)where id=a.id;
   update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held'and id<>r.id;
   insert into public.clinic_booking_decisions(id,clinic_id,appointment_id,appointment_revision,notice_id,kind,actor_id,membership_id)values(sub,p_clinic,a.id,a.revision,n.id,'confirmed',m.user_id,m.id);
   insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(a.id,a.revision,'clinic-confirmed',n.id);
  else
   update public.booking_scheduling_notices set state='declined'where id=n.id;
   if a.current_arrangement is null then
    update public.booking_appointments set status='cancelled'where id=a.id;
    update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held';
   else
    -- A declined change leaves the confirmed visit as it was.
    update public.booking_appointments set status='confirmed',proposed_arrangement=current_arrangement,proposed_reservation_id=current_reservation_id where id=a.id;
    update public.booking_manual_reservations set state='released'where id=r.id and id is distinct from a.current_reservation_id and state='held';
   end if;
   insert into public.clinic_booking_decisions(id,clinic_id,appointment_id,appointment_revision,notice_id,kind,reason,actor_id,membership_id)values(sub,p_clinic,a.id,a.revision,n.id,'declined',p->>'reason',m.user_id,m.id);
   insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(a.id,a.revision,'clinic-declined',n.id);
  end if;
  update public.clinic_booking_proposals set state='withdrawn',decided_at=clock_timestamp(),decided_by=m.user_id where appointment_id=a.id and state='open';
  perform public._clinic_schedule_audit(p_clinic,m.user_id,case when op='confirm'then 'booking-confirmed'else 'booking-declined'end,
   jsonb_build_object('appointmentId',a.id,'revision',a.revision,'noticeId',n.id,'membershipId',m.id,'role',m.role));

 elsif op='propose'then
  if not((a.status='notification-pending'and n.clinic_id=p_clinic and n.channel='portal'and n.state='pending'and n.purpose<>'cancellation')
   or(a.status='confirmed'and a.current_arrangement->>'clinicId'=p_clinic::text and n.state<>'pending'
    and exists(select 1 from public.booking_manual_reservations x join public.booking_manual_capacity xp on xp.key=x.capacity_key where x.id=a.current_reservation_id and xp.source='clinic-hours')))
  then return jsonb_build_object('status','stale');end if;
  select * into pool from public.booking_manual_capacity where key=p->>'slotKey'for share;
  if not found or pool.clinic_id<>p_clinic or pool.source<>'clinic-hours'then return jsonb_build_object('status','invalid');end if;
  if pool.starts_at<=clock_timestamp()or pool.valid_until<=clock_timestamp()
   or not exists(select 1 from public.booking_offer_snapshots o where o.capacity_key=pool.key and o.superseded_at is null)then return jsonb_build_object('status','unavailable');end if;
  if exists(select 1 from public.booking_manual_reservations x where x.id in(a.proposed_reservation_id,a.current_reservation_id)and x.capacity_key=pool.key)then return jsonb_build_object('status','invalid');end if;
  select count(distinct x.appointment_id)into held from public.booking_manual_reservations x where x.capacity_key=pool.key and x.state='held'and x.appointment_id<>a.id;
  if held>=pool.capacity then return jsonb_build_object('status','full');end if;
  update public.clinic_booking_proposals set state='withdrawn',decided_at=clock_timestamp(),decided_by=m.user_id where appointment_id=a.id and state='open';
  insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,note,actor_id,membership_id)
   values(sub,p_clinic,a.id,a.revision,pool.key,pool.starts_at,pool.ends_at,p->>'note',m.user_id,m.id);
  mid:=public._clinic_proposal_notify(a.member_id);
  if mid is not null then update public.clinic_booking_proposals set telegram_message_id=mid where id=sub;end if;
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'booking-time-proposed',
   jsonb_build_object('appointmentId',a.id,'revision',a.revision,'proposalId',sub,'startsAt',pool.starts_at,'telegramQueued',mid is not null,'membershipId',m.id,'role',m.role));

 elsif op='withdraw-proposal'then
  select * into pr from public.clinic_booking_proposals where id=(p->>'proposalId')::uuid and appointment_id=a.id and clinic_id=p_clinic for update;
  if not found or pr.state<>'open'then return jsonb_build_object('status','stale');end if;
  update public.clinic_booking_proposals set state='withdrawn',decided_at=clock_timestamp(),decided_by=m.user_id where id=pr.id;
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'booking-proposal-withdrawn',jsonb_build_object('appointmentId',a.id,'proposalId',pr.id,'membershipId',m.id,'role',m.role));

 else -- check-in
  if a.status<>'confirmed'or a.current_arrangement->>'clinicId'is distinct from p_clinic::text or a.current_reservation_id is null then return jsonb_build_object('status','stale');end if;
  starts:=(a.current_arrangement->>'startsAt')::timestamptz;
  -- Arrival from the visit day (Yerevan); no-show once the visit time has started.
  if(p->>'outcome'='arrived'and(clock_timestamp()at time zone 'Asia/Yerevan')::date<(starts at time zone 'Asia/Yerevan')::date)
   or(p->>'outcome'='no-show'and clock_timestamp()<starts)then return jsonb_build_object('status','early');end if;
  insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id)values(p_clinic,a.id,a.current_reservation_id,p->>'outcome',m.user_id,m.id);
  perform public._clinic_schedule_audit(p_clinic,m.user_id,case when p->>'outcome'='arrived'then 'booking-arrived'else 'booking-no-show'end,
   jsonb_build_object('appointmentId',a.id,'revision',a.revision,'reservationId',a.current_reservation_id,'membershipId',m.id,'role',m.role));
 end if;

 select * into a from public.booking_appointments where id=aid;
 result:=jsonb_build_object('status','saved','booking',public._clinic_schedule_row(p_clinic,a));
 insert into public.clinic_schedule_commands(actor_id,submission_id,clinic_id,payload,result)values(m.user_id,sub,p_clinic,p,result);
 return result;
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- 8. Hours and capacity (clinic admin) ------------------------------------------------------

create function public._clinic_schedule_settings_json(c uuid,m public.clinic_portal_memberships)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version','clinic-schedule-settings-v1','enabled',public._clinic_scheduling_enabled(),'canEdit',m.role='admin',
  'clinic',(select jsonb_build_object('name',name,'address',address)from public.workspace_clinics where id=c),
  'schedule',(select jsonb_build_object('active',s.active,'slotMinutes',s.slot_minutes,'capacity',s.capacity,'coveredTestIds',to_jsonb(s.covered_test_ids),
   'followUpTestIds',to_jsonb(s.follow_up_test_ids),'preparation',s.preparation,'revision',s.revision,'updatedAt',s.updated_at,
   'hours',(select coalesce(jsonb_agg(jsonb_build_object('weekday',h.weekday,'opens',to_char(h.opens,'HH24:MI'),'closes',to_char(h.closes,'HH24:MI'))order by h.weekday),'[]'::jsonb)
    from public.clinic_schedule_hours h where h.clinic_id=c))
   from public.clinic_schedules s where s.clinic_id=c))
$$;
create function public.clinic_schedule_settings(p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$declare m public.clinic_portal_memberships;begin
 m:=public._clinic_scheduling_member(p_clinic,false);
 return public._clinic_schedule_settings_json(p_clinic,m);
end$$;

-- p_settings: {expectedRevision (0 for a first save), active, slotMinutes, capacity,
-- coveredTestIds, followUpTestIds, preparation, hours:[{weekday 1-7, opens 'HH:MM', closes 'HH:MM'}]}.
create function public.clinic_schedule_settings_save(p_clinic uuid,p_settings jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;s public.clinic_schedules;cl public.workspace_clinics;h jsonb;covered text[];follow text[];expected bigint;slot integer;cap integer;prep text;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,true);
 if not public._clinic_scheduling_enabled()then return jsonb_build_object('status','disabled');end if;
 begin
  if jsonb_typeof(p_settings)is distinct from 'object'
   or p_settings-array['expectedRevision','active','slotMinutes','capacity','coveredTestIds','followUpTestIds','preparation','hours']<>'{}'::jsonb
   or not p_settings?&array['expectedRevision','active','slotMinutes','capacity','coveredTestIds','followUpTestIds','preparation','hours']
   or jsonb_typeof(p_settings->'active')<>'boolean'or jsonb_typeof(p_settings->'hours')<>'array'or jsonb_array_length(p_settings->'hours')>7
   or jsonb_typeof(p_settings->'coveredTestIds')<>'array'or jsonb_typeof(p_settings->'followUpTestIds')<>'array'or jsonb_typeof(p_settings->'preparation')<>'string'
   or p_settings->>'expectedRevision'!~'^[0-9]+$'or p_settings->>'slotMinutes'!~'^[0-9]+$'or p_settings->>'capacity'!~'^[0-9]+$'then return jsonb_build_object('status','invalid');end if;
  expected:=(p_settings->>'expectedRevision')::bigint;slot:=(p_settings->>'slotMinutes')::integer;cap:=(p_settings->>'capacity')::integer;prep:=btrim(p_settings->>'preparation');
  select array_agg(x order by x)into covered from jsonb_array_elements_text(p_settings->'coveredTestIds')x;
  select coalesce(array_agg(x order by x),'{}')into follow from jsonb_array_elements_text(p_settings->'followUpTestIds')x;
  if slot not between 10 and 240 or cap not between 1 and 50 or length(prep)not between 1 and 2000 or covered is null
   or exists(select 1 from unnest(covered||follow)x where x!~'^[a-z0-9][a-z0-9-]{0,99}$')
   or cardinality(covered)<>(select count(distinct x)from unnest(covered)x)or cardinality(follow)<>(select count(distinct x)from unnest(follow)x)or covered&&follow
   or exists(select 1 from jsonb_array_elements(p_settings->'hours')e where jsonb_typeof(e)<>'object'or e-array['weekday','opens','closes']<>'{}'::jsonb
    or coalesce(e->>'weekday','')!~'^[1-7]$'or coalesce(e->>'opens','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'or coalesce(e->>'closes','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or(e->>'closes')::time<=(e->>'opens')::time)
   or(select count(distinct e->>'weekday')from jsonb_array_elements(p_settings->'hours')e)<>jsonb_array_length(p_settings->'hours')then return jsonb_build_object('status','invalid');end if;
 exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then return jsonb_build_object('status','invalid');end;
 select * into cl from public.workspace_clinics where id=p_clinic;
 if(p_settings->>'active')::boolean and nullif(btrim(cl.address),'')is null then return jsonb_build_object('status','address-required');end if;
 select * into s from public.clinic_schedules where clinic_id=p_clinic for update;
 if coalesce(s.revision,0)<>expected then return jsonb_build_object('status','stale');end if;
 insert into public.clinic_schedules(clinic_id,active,slot_minutes,capacity,covered_test_ids,follow_up_test_ids,preparation,updated_by)
  values(p_clinic,(p_settings->>'active')::boolean,slot,cap,covered,follow,prep,m.user_id)
  on conflict(clinic_id)do update set active=excluded.active,slot_minutes=excluded.slot_minutes,capacity=excluded.capacity,covered_test_ids=excluded.covered_test_ids,
   follow_up_test_ids=excluded.follow_up_test_ids,preparation=excluded.preparation,revision=public.clinic_schedules.revision+1,updated_by=excluded.updated_by,updated_at=clock_timestamp();
 delete from public.clinic_schedule_hours where clinic_id=p_clinic;
 for h in select value from jsonb_array_elements(p_settings->'hours')loop
  insert into public.clinic_schedule_hours(clinic_id,weekday,opens,closes)values(p_clinic,(h->>'weekday')::smallint,(h->>'opens')::time,(h->>'closes')::time);
 end loop;
 perform public._clinic_schedule_generate(p_clinic,true);
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'schedule-saved',jsonb_build_object('membershipId',m.id,'settings',p_settings-'expectedRevision'));
 return jsonb_build_object('status','saved','settings',public._clinic_schedule_settings_json(p_clinic,m));
exception when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;

-- 9. Clinic team (clinic admin) -------------------------------------------------------------
-- New people are still invited by Noreon (Telegram invitations). The clinic admin sets each
-- teammate's role and can switch access off, never for themselves, and the clinic always keeps
-- one active admin. Switching access back on is Noreon's (review F-04).

create function public.clinic_schedule_team(p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$declare m public.clinic_portal_memberships;begin
 m:=public._clinic_scheduling_member(p_clinic,true);
 return jsonb_build_object('version','clinic-team-v1','members',(select coalesce(jsonb_agg(jsonb_build_object('membershipId',x.id,'displayName',x.display_name,'role',x.role,'active',x.active,
  'revision',x.revision,'self',x.user_id=m.user_id)order by lower(x.display_name),x.id),'[]'::jsonb)from public.clinic_portal_memberships x where x.clinic_id=p_clinic));
end$$;
create function public.clinic_schedule_team_command(p_clinic uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;t public.clinic_portal_memberships;want_role text;want_active boolean;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['membershipId','expectedRevision','role','active']<>'{}'::jsonb
  or not p_command?&array['membershipId','expectedRevision','role','active']or coalesce(p_command->>'role','')not in('admin','staff')
  or jsonb_typeof(p_command->'active')<>'boolean'or coalesce(p_command->>'expectedRevision','')!~'^[0-9]+$'then return jsonb_build_object('status','invalid');end if;
 want_role:=p_command->>'role';want_active:=(p_command->>'active')::boolean;
 perform pg_advisory_xact_lock(hashtextextended('clinic-team:'||p_clinic::text,0));
 begin select * into t from public.clinic_portal_memberships where id=(p_command->>'membershipId')::uuid and clinic_id=p_clinic for update;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 if not found then return jsonb_build_object('status','invalid');end if;
 if t.user_id=m.user_id then return jsonb_build_object('status','self');end if;
 if t.revision<>(p_command->>'expectedRevision')::bigint then return jsonb_build_object('status','stale');end if;
 -- Access that is off (switched off by the clinic or by Noreon) is restored only by Noreon (review F-04).
 if want_active and not t.active then return jsonb_build_object('status','noreon-only');end if;
 if t.role=want_role and t.active=want_active then return jsonb_build_object('status','saved');end if;
 update public.clinic_portal_memberships set role=want_role,active=want_active where id=t.id;
 if not exists(select 1 from public.clinic_portal_memberships where clinic_id=p_clinic and role='admin'and active)then raise exception using errcode='P0001',message='last-admin';end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'team-member-updated',jsonb_build_object('membershipId',t.id,'role',want_role,'active',want_active,
  'previousRole',t.role,'previousActive',t.active,'byMembershipId',m.id));
 return jsonb_build_object('status','saved');
exception when raise_exception then return jsonb_build_object('status','last-admin');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;

-- 10. Member side ---------------------------------------------------------------------------

-- Portal state per appointment for the member (or staff with care access): the channel of
-- the current notice, a clinic decline reason, an open proposal and the latest check-in.
create function public.booking_portal_details(p_member uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$declare mm uuid:=coalesce(p_member,auth.uid());begin
 perform public._booking_assert_actor(mm,auth.uid());
 return jsonb_build_object('memberId',mm,'enabled',public._clinic_scheduling_enabled(),
  'appointments',(select coalesce(jsonb_object_agg(a.id,jsonb_build_object(
   'channel',n.channel,'noticeState',n.state,
   'portalRevisions',(select coalesce(jsonb_agg(x.appointment_revision order by x.appointment_revision),'[]'::jsonb)from public.booking_scheduling_notices x where x.appointment_id=a.id and x.channel='portal'),
   'decline',(select jsonb_build_object('reason',d.reason,'at',d.created_at)from public.clinic_booking_decisions d where d.notice_id=n.id and d.kind='declined'),
   'proposal',(select jsonb_build_object('id',p.id,'startsAt',p.starts_at,'endsAt',p.ends_at,'note',p.note,'clinicId',p.clinic_id,'clinicName',c.name,'clinicAddress',c.address,'createdAt',p.created_at)
    from public.clinic_booking_proposals p join public.workspace_clinics c on c.id=p.clinic_id where p.appointment_id=a.id and p.state='open'),
   'checkin',(select jsonb_build_object('outcome',k.outcome,'at',k.recorded_at)from public.clinic_booking_checkins k where k.reservation_id=a.current_reservation_id order by k.id desc limit 1))),'{}'::jsonb)
  from public.booking_appointments a join public.booking_scheduling_notices n on n.id=a.notice_id where a.member_id=mm));
end$$;

-- The member answers a clinic's proposed time. Accepting moves the visit to that slot at once
-- (the clinic already agreed to it); declining leaves the booking as it was. Service role,
-- after the member's own Auth guard; replays return the saved result.
create function public.booking_portal_proposal_answer(p_command uuid,p_member uuid,p_actor uuid,p_proposal uuid,p_accept boolean)returns jsonb
language plpgsql security definer set search_path=''as $$
declare prior public.booking_appointment_commands;canonical jsonb;pr public.clinic_booking_proposals;a public.booking_appointments;n public.booking_scheduling_notices;
 pool public.booking_manual_capacity;o public.booking_offer_snapshots;seal public.booking_program_seals;clinic public.workspace_clinics;projected jsonb;details jsonb;rev bigint;result jsonb;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 if p_actor<>p_member then raise insufficient_privilege using message='The member answers a clinic proposal';end if;
 if p_command is null or p_proposal is null or p_accept is null then raise invalid_parameter_value using message='Proposal answer required';end if;
 canonical:=jsonb_build_object('proposalAnswer',true,'proposalId',p_proposal,'accept',p_accept);
 perform pg_advisory_xact_lock(hashtextextended('booking-command:'||p_command::text,0));
 select * into prior from public.booking_appointment_commands where id=p_command;
 if found then
  if prior.member_id<>p_member or prior.actor_id<>p_actor or prior.input<>canonical then raise invalid_parameter_value using message='Command identity already used';end if;
  return prior.result;
 end if;
 perform public.lock_patient_clinical_sources(p_member);
 perform pg_advisory_xact_lock(hashtextextended('booking-member:'||p_member::text,0));
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 select * into pr from public.clinic_booking_proposals where id=p_proposal for update;
 if not found then raise insufficient_privilege using message='Proposal unavailable';end if;
 select * into a from public.booking_appointments where id=pr.appointment_id for update nowait;
 if a.member_id<>p_member then raise insufficient_privilege using message='Proposal unavailable';end if;
 if pr.state<>'open'or a.revision<>pr.appointment_revision then raise serialization_failure using message='The proposal changed';end if;
 if not p_accept then
  update public.clinic_booking_proposals set state='rejected',decided_at=clock_timestamp(),decided_by=p_actor where id=pr.id;
  perform public._clinic_schedule_audit(pr.clinic_id,p_actor,'booking-proposal-rejected',jsonb_build_object('appointmentId',a.id,'proposalId',pr.id));
 else
  if not public._clinic_scheduling_enabled()then raise insufficient_privilege using message='Clinic scheduling is off';end if;
  select * into n from public.booking_scheduling_notices where id=a.notice_id;
  select * into pool from public.booking_manual_capacity where key=pr.capacity_key for update nowait;
  if pool.starts_at<=clock_timestamp()or pool.valid_until<=clock_timestamp()then raise serialization_failure using message='Offer validity changed';end if;
  if(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=pool.key and r.state='held'and r.appointment_id<>a.id)>=pool.capacity then
   raise serialization_failure using message='Offer capacity changed';end if;
  select * into o from public.booking_offer_snapshots where capacity_key=pool.key and superseded_at is null order by created_at desc limit 1;
  select * into seal from public.booking_program_seals where id=a.program_id;
  if o.id is null or not public._booking_offer_coverage(seal.program,o.offer)then raise invalid_parameter_value using message='Complete program coverage and follow-up required';end if;
  select * into clinic from public.workspace_clinics where id=pool.clinic_id and active for share;
  if not found or nullif(btrim(clinic.address),'')is null or o.offer->>'clinicAddress'is distinct from clinic.address then raise serialization_failure using message='Use the current trusted clinic address';end if;
  projected:=public._booking_offer_project(seal.program,o.offer);
  details:=jsonb_build_object('offerId',o.id,'offerVersion',o.version,'clinicId',clinic.id,'mode','clinic','startsAt',o.offer->>'startsAt','endsAt',o.offer->>'endsAt',
   'timezone','Asia/Yerevan','location',clinic.address,'preparation',o.offer->>'preparation','preparationVersion',o.offer->>'preparationVersion',
   'coveredTestIds',projected->'coveredTestIds','followUps',projected->'followUps');
  -- A request still waiting for the clinic is replaced by the accepted proposal.
  if n.state='pending'then update public.booking_scheduling_notices set state='superseded'where id=n.id;end if;
  rev:=a.revision+1;
  insert into public.booking_manual_reservations(id,appointment_id,capacity_key,offer_id,offer_version,member_id,valid_until)values(p_command,a.id,pool.key,o.id,o.version,p_member,pool.valid_until);
  update public.booking_appointments set revision=rev,status='confirmed',proposed_arrangement=details,proposed_reservation_id=p_command,notice_id=p_command,
   current_arrangement=details,current_reservation_id=p_command,legacy_current=null,
   current_program=(select jsonb_agg(i-'source')from jsonb_array_elements(seal.program->'items')i)where id=a.id;
  update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held'and id<>p_command;
  insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state)
   values(p_command,a.id,rev,seal.id,p_command,clinic.id,clinic.scheduling_revision,'portal',case when a.current_arrangement is not null then 'change'else 'booking'end,'accepted');
  insert into public.booking_appointment_versions(appointment_id,revision,program_id,previous_arrangement,proposed_arrangement,notice_id,actor_id,agreement_source,previous_program)
   values(a.id,rev,seal.id,a.current_arrangement,details,p_command,p_actor,'Member accepted clinic proposal '||pr.id::text,a.current_program);
  insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(a.id,rev,'clinic-proposal-accepted',p_command);
  update public.clinic_booking_proposals set state='accepted',decided_at=clock_timestamp(),decided_by=p_actor where id=pr.id;
  perform public._clinic_schedule_audit(pr.clinic_id,p_actor,'booking-proposal-accepted',jsonb_build_object('appointmentId',a.id,'proposalId',pr.id,'revision',rev));
 end if;
 select * into a from public.booking_appointments where id=a.id;result:=public._booking_appointment_dto(a);
 insert into public.booking_appointment_commands(id,member_id,actor_id,input,result)values(p_command,p_member,p_actor,canonical,result);
 return result;
end$$;

-- Cancel a confirmed clinic-hours visit, or withdraw a first request the clinic has not
-- answered yet. The clinic sees it in the portal at once; no email. Refused once the visit
-- has started. Staff need the member's recorded agreement, as for email cancellations.
create function public.booking_portal_cancel(p_command uuid,p_member uuid,p_actor uuid,p_appointment uuid,p_revision bigint,p_agreement_source text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare prior public.booking_appointment_commands;canonical jsonb;a public.booking_appointments;n public.booking_scheduling_notices;r public.booking_manual_reservations;
 pool public.booking_manual_capacity;clinic public.workspace_clinics;arr jsonb;rev bigint;result jsonb;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 if p_command is null or p_appointment is null or p_revision is null or p_revision<0 then raise invalid_parameter_value using message='Appointment and command identity required';end if;
 canonical:=jsonb_build_object('portalCancel',true,'appointmentId',p_appointment,'revision',p_revision,'agreementSource',nullif(btrim(p_agreement_source),''));
 perform pg_advisory_xact_lock(hashtextextended('booking-command:'||p_command::text,0));
 select * into prior from public.booking_appointment_commands where id=p_command;
 if found then
  if prior.member_id<>p_member or prior.actor_id<>p_actor or prior.input<>canonical then raise invalid_parameter_value using message='Command identity already used';end if;
  return prior.result;
 end if;
 if p_actor<>p_member and coalesce(length(btrim(p_agreement_source)),0)not between 3 and 1000 then raise invalid_parameter_value using message='Record member agreement source';end if;
 perform public.lock_patient_clinical_sources(p_member);
 perform pg_advisory_xact_lock(hashtextextended('booking-member:'||p_member::text,0));
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 select * into a from public.booking_appointments where id=p_appointment for update nowait;
 if not found or a.member_id<>p_member then raise insufficient_privilege using message='Appointment unavailable';end if;
 if a.revision<>p_revision then raise serialization_failure using message='Appointment changed';end if;
 select * into n from public.booking_scheduling_notices where id=a.notice_id;
 if a.status='confirmed'and a.current_reservation_id is not null and n.state<>'pending'then
  select * into r from public.booking_manual_reservations where id=a.current_reservation_id for update;arr:=a.current_arrangement;
 elsif a.status='notification-pending'and a.current_arrangement is null and n.channel='portal'and n.state='pending'then
  select * into r from public.booking_manual_reservations where id=a.proposed_reservation_id for update;arr:=a.proposed_arrangement;
  update public.booking_scheduling_notices set state='superseded'where id=n.id;
 else raise serialization_failure using message='Resolve the current arrangement before cancelling it';end if;
 select * into pool from public.booking_manual_capacity where key=r.capacity_key;
 if pool.source<>'clinic-hours'then raise invalid_parameter_value using message='Email-arranged visits are cancelled by email';end if;
 if pool.starts_at<=clock_timestamp()then raise serialization_failure using message='The visit has already started';end if;
 select * into clinic from public.workspace_clinics where id=pool.clinic_id;
 rev:=a.revision+1;
 update public.booking_appointments set revision=rev,status='cancelled',current_arrangement=null,current_reservation_id=null,legacy_current=null,current_program=null,
  proposed_arrangement=arr,proposed_reservation_id=r.id,notice_id=p_command where id=a.id;
 update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held';
 insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,channel,purpose,state)
  values(p_command,a.id,rev,a.program_id,r.id,clinic.id,clinic.scheduling_revision,'portal','cancellation','accepted');
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,previous_arrangement,proposed_arrangement,notice_id,actor_id,agreement_source,previous_program)
  values(a.id,rev,a.program_id,arr,arr,p_command,p_actor,nullif(btrim(p_agreement_source),''),a.current_program);
 insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(a.id,rev,'cancelled',p_command);
 update public.clinic_booking_proposals set state='withdrawn',decided_at=clock_timestamp(),decided_by=p_actor where appointment_id=a.id and state='open';
 perform public._clinic_schedule_audit(clinic.id,p_actor,'booking-cancelled-by-member',jsonb_build_object('appointmentId',a.id,'revision',rev,'byStaff',p_actor<>p_member));
 select * into a from public.booking_appointments where id=a.id;result:=public._booking_appointment_dto(a);
 insert into public.booking_appointment_commands(id,member_id,actor_id,input,result)values(p_command,p_member,p_actor,canonical,result);
 return result;
end$$;

-- 11. Grants ---------------------------------------------------------------------------------

revoke all on function public._clinic_scheduling_enabled(),public._clinic_scheduling_member(uuid,boolean),public._booking_notice_channel_guard(),public._booking_attempt_channel_guard(),
 public._clinic_schedule_generate(uuid,boolean),public.clinic_schedule_top_up(),public._clinic_schedule_tests(uuid,jsonb),public._clinic_schedule_row(uuid,public.booking_appointments),
 public.clinic_schedule_bookings(uuid,text,date,text),public.clinic_schedule_free_slots(uuid,date),public._clinic_schedule_command(jsonb),public._clinic_schedule_audit(uuid,uuid,text,jsonb),
 public._clinic_proposal_notify(uuid),public.clinic_schedule_command(uuid,jsonb),public._clinic_schedule_settings_json(uuid,public.clinic_portal_memberships),
 public.clinic_schedule_settings(uuid),public.clinic_schedule_settings_save(uuid,jsonb),public.clinic_schedule_team(uuid),public.clinic_schedule_team_command(uuid,jsonb),
 public.booking_portal_details(uuid),public.booking_portal_proposal_answer(uuid,uuid,uuid,uuid,boolean),public.booking_portal_cancel(uuid,uuid,uuid,uuid,bigint,text)
 from public,anon,authenticated,service_role;
grant execute on function public.clinic_schedule_bookings(uuid,text,date,text),public.clinic_schedule_free_slots(uuid,date),public.clinic_schedule_command(uuid,jsonb),
 public.clinic_schedule_settings(uuid),public.clinic_schedule_settings_save(uuid,jsonb),public.clinic_schedule_team(uuid),public.clinic_schedule_team_command(uuid,jsonb),
 public.booking_portal_details(uuid)to authenticated;
grant execute on function public.clinic_schedule_top_up(),public.booking_portal_proposal_answer(uuid,uuid,uuid,uuid,boolean),public.booking_portal_cancel(uuid,uuid,uuid,uuid,bigint,text)to service_role;
