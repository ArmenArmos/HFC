-- B1 unified booking: capability slots, member/staff cancellation, hold release,
-- admin-entered slots and the member phone for the clinic notice.
-- Design: output/booking-b1-2026-10-16/DESIGN.md (outside the repository).

-- Each notice records why the clinic is being told: a first booking, a change
-- of an existing visit, or a cancellation.
alter table public.booking_scheduling_notices add column purpose text not null default 'booking'
 check(purpose in('booking','change','cancellation'));
alter table public.booking_appointments drop constraint booking_appointments_status_check;
alter table public.booking_appointments add constraint booking_appointments_status_check
 check(status in('notification-pending','confirmed','failed','unknown','reconciliation','cancelled'));

-- A slot states what it can do. It is offered when it does at least one
-- assigned visit test and every other assigned visit test has a follow-up.
-- An exact offer (the previous rule) still qualifies.
create or replace function public._booking_offer_coverage(p_program jsonb,p_offer jsonb)returns boolean
language sql immutable set search_path='' as $$
 with wanted as(select i->>'id' id from jsonb_array_elements(p_program->'items')i where i->>'method'<>'home-log'),
 covered as(select jsonb_array_elements_text(p_offer->'coveredTestIds')id),
 followed as(select f->>'testId' id from jsonb_array_elements(p_offer->'followUps')f)
 select exists(select 1 from wanted w join covered c on c.id=w.id)
 and not exists(select id from wanted except(select id from covered union select id from followed))
$$;
revoke all on function public._booking_offer_coverage(jsonb,jsonb)from public,anon,authenticated,service_role;

-- The member's view of a slot: only their own tests, in program order, with one
-- follow-up for each assigned test the slot does not do.
create function public._booking_offer_project(p_program jsonb,p_offer jsonb)returns jsonb
language sql immutable set search_path='' as $$
 with wanted as(select i->>'id' id,n from jsonb_array_elements(p_program->'items')with ordinality x(i,n)where i->>'method'<>'home-log'),
 covered as(select jsonb_array_elements_text(p_offer->'coveredTestIds')id),
 followed as(select distinct on(f->>'testId')f->>'testId' id,f from jsonb_array_elements(p_offer->'followUps')with ordinality y(f,m)order by f->>'testId',m)
 select p_offer||jsonb_build_object(
  'coveredTestIds',(select coalesce(jsonb_agg(w.id order by w.n),'[]'::jsonb)from wanted w where w.id in(select id from covered)),
  'followUps',(select coalesce(jsonb_agg(d.f order by w.n),'[]'::jsonb)from wanted w join followed d on d.id=w.id where w.id not in(select id from covered)))
$$;
revoke all on function public._booking_offer_project(jsonb,jsonb)from public,anon,authenticated,service_role;

create or replace function public.booking_pilot_offers(p_member uuid,p_actor uuid,p_program_id uuid)returns jsonb
language plpgsql stable security definer set search_path='' as $$declare seal public.booking_program_seals;begin
 perform public._booking_assert_actor(p_member,p_actor);
 select * into seal from public.booking_program_seals where id=p_program_id and member_id=p_member and actor_id=p_actor;
 if not found or seal.source_token is distinct from public.patient_test_context(p_member)->>'token'then raise serialization_failure using message='Booking program changed';end if;
 return(select coalesce(jsonb_agg(jsonb_build_object('offer',public._booking_offer_project(seal.program,o.offer),'clinicName',c.name)order by p.starts_at,o.id,o.version),'[]'::jsonb)
 from public.booking_offer_snapshots o join public.booking_manual_capacity p on p.key=o.capacity_key join public.workspace_clinics c on c.id=p.clinic_id
 where c.active and p.valid_until>clock_timestamp()and p.starts_at>clock_timestamp()and public._booking_offer_coverage(seal.program,o.offer)
 and(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=p.key and r.state='held')<p.capacity);
end $$;

-- Same as 20261016005213 except: the arrangement stores the member's projected
-- coverage, the notice records its purpose, a change stays with the same clinic,
-- and a cancelled visit can be rebooked.
create or replace function public.select_booking_appointment(p_command_id uuid,p_member uuid,p_actor uuid,p_program_id uuid,p_offer_id uuid,p_offer_version text,
 p_home_address text default null,p_appointment_id uuid default null,p_revision bigint default null,p_agreement_source text default null,p_legacy_id uuid default null,
 p_sender_email text default null,p_template_version text default null,p_subject text default null,p_text_content text default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare seal public.booking_program_seals;offer_row public.booking_offer_snapshots;pool public.booking_manual_capacity;clinic public.workspace_clinics;copy public.workspace_scheduling_settings;
 a public.booking_appointments;prior public.booking_appointment_commands;legacy public.patient_test_requests;canonical jsonb;details jsonb;projected jsonb;result jsonb;aid uuid;rev bigint;enrolled uuid;sender text;
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
  sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,purpose)
 values(p_command_id,aid,rev,seal.id,p_command_id,clinic.id,clinic.scheduling_revision,copy.revision,sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content,
 public._booking_envelope_hash(sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content),
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
-- released. Refused once the visit has started.
create function public.cancel_booking_appointment(p_command_id uuid,p_member uuid,p_actor uuid,p_appointment_id uuid,p_revision bigint,
 p_agreement_source text default null,p_sender_email text default null,p_template_version text default null,p_subject text default null,p_text_content text default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.booking_appointments;r public.booking_manual_reservations;pool public.booking_manual_capacity;clinic public.workspace_clinics;copy public.workspace_scheduling_settings;
 prior public.booking_appointment_commands;canonical jsonb;result jsonb;rev bigint;sender text;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 if p_command_id is null or p_appointment_id is null or p_revision is null or p_revision<0 then raise invalid_parameter_value using message='Appointment and command identity required';end if;
 canonical:=jsonb_build_object('cancel',true,'appointmentId',p_appointment_id,'revision',p_revision,'agreementSource',nullif(btrim(p_agreement_source),''),
 'senderEmail',p_sender_email,'templateVersion',p_template_version,'subject',p_subject,'textContent',p_text_content);
 perform pg_advisory_xact_lock(hashtextextended('booking-command:'||p_command_id::text,0));
 select * into prior from public.booking_appointment_commands where id=p_command_id;
 if found then
  -- Like recover_booking_command: only the member's choice is compared, so a
  -- retried request still recovers after the rendered email content changed.
  if prior.member_id<>p_member or prior.actor_id<>p_actor
  or prior.input-array['senderEmail','templateVersion','subject','textContent']<>canonical-array['senderEmail','templateVersion','subject','textContent']then
   raise invalid_parameter_value using message='Command identity already used';
  end if;
  perform 1 from public.patient_clinical_cases where user_id=p_member for share nowait;
  perform public._booking_assert_actor(p_member,p_actor);
  return prior.result;
 end if;
 perform public.lock_patient_clinical_sources(p_member);
 perform pg_advisory_xact_lock(hashtextextended('booking-member:'||p_member::text,0));
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 if not found then raise insufficient_privilege using message='Appointment unavailable';end if;
 perform public._booking_assert_actor(p_member,p_actor);
 select * into a from public.booking_appointments where id=p_appointment_id for update nowait;
 if not found or a.member_id<>p_member then raise insufficient_privilege using message='Appointment unavailable';end if;
 if a.revision is distinct from p_revision or a.status not in('confirmed','failed')or a.current_arrangement is null or a.current_reservation_id is null
 or exists(select 1 from public.booking_scheduling_notices n where n.id=a.notice_id and n.state in('pending','sending','unknown','reconciliation'))then
  raise serialization_failure using message='Resolve the current arrangement before cancelling it';
 end if;
 if p_actor<>p_member and coalesce(length(btrim(p_agreement_source)),0)not between 3 and 1000 then raise invalid_parameter_value using message='Record member agreement source';end if;
 select * into r from public.booking_manual_reservations where id=a.current_reservation_id and appointment_id=a.id for update nowait;
 if not found or r.state<>'held'then raise serialization_failure using message='Current reservation changed';end if;
 select * into pool from public.booking_manual_capacity where key=r.capacity_key for share nowait;
 if pool.starts_at<=clock_timestamp()or(a.current_arrangement->>'startsAt')::timestamptz<=clock_timestamp()then
  raise serialization_failure using message='The visit has already started';
 end if;
 select * into clinic from public.workspace_clinics where id=(a.current_arrangement->>'clinicId')::uuid and active for share;
 if not found or clinic.id<>pool.clinic_id then raise insufficient_privilege using message='Active clinic required';end if;
 select * into copy from public.workspace_scheduling_settings where id for share;
 sender:=public._real_scheduling_email(p_sender_email);
 if sender is null or clinic.scheduling_email is null or copy.copy_email is null or coalesce(length(p_template_version),0)not between 1 and 200
 or coalesce(length(p_subject),0)not between 1 and 200 or p_subject~E'[\r\n]'or coalesce(length(p_text_content),0)not between 1 and 32000 then
  raise invalid_parameter_value using message='Approved scheduling configuration and content required';
 end if;
 rev:=a.revision+1;
 update public.booking_appointments set revision=rev,status='notification-pending',proposed_arrangement=a.current_arrangement,
  proposed_reservation_id=a.current_reservation_id,notice_id=p_command_id where id=a.id;
 insert into public.booking_scheduling_notices(id,appointment_id,appointment_revision,program_id,reservation_id,clinic_id,clinic_revision,copy_revision,
  sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash,purpose)
 values(p_command_id,a.id,rev,a.program_id,r.id,clinic.id,clinic.scheduling_revision,copy.revision,sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content,
 public._booking_envelope_hash(sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content),'cancellation');
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,previous_arrangement,proposed_arrangement,notice_id,actor_id,agreement_source,previous_program)
 values(a.id,rev,a.program_id,a.current_arrangement,a.current_arrangement,p_command_id,p_actor,nullif(btrim(p_agreement_source),''),a.current_program);
 insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(a.id,rev,'cancellation-requested',p_command_id);
 select * into a from public.booking_appointments where id=a.id;result:=public._booking_appointment_dto(a);
 insert into public.booking_appointment_commands(id,member_id,actor_id,input,result)values(p_command_id,p_member,p_actor,canonical,result);
 return result;
end $$;
revoke all on function public.cancel_booking_appointment(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.cancel_booking_appointment(uuid,uuid,uuid,uuid,bigint,text,text,text,text,text)to service_role;

-- Same as 20261016003952 except a cancellation does not depend on the current
-- clinical source, the engine version or the slot still being offered: the
-- clinic must hear about it even after the member's answers change.
create or replace function public._booking_notice_context(p_notice uuid,p_engine text,p_sender text,p_template text)returns boolean
language plpgsql security definer set search_path='' as $$
declare n public.booking_scheduling_notices;s public.booking_program_seals;a public.booking_appointments;r public.booking_manual_reservations;
 pool public.booking_manual_capacity;c public.workspace_clinics;copy public.workspace_scheduling_settings;actor uuid;valid boolean:=true;cancelling boolean;
begin
 select * into n from public.booking_scheduling_notices where id=p_notice;
 if not found then raise insufficient_privilege using message='Scheduling notice unavailable';end if;
 cancelling:=n.purpose='cancellation';
 select * into s from public.booking_program_seals where id=n.program_id;
 select actor_id into actor from public.booking_appointment_commands where id=n.id;
 begin perform public._booking_assert_actor(s.member_id,actor);exception when insufficient_privilege then valid:=false;end;
 if valid then
  perform public.lock_patient_clinical_sources(s.member_id);
  valid:=cancelling or s.source_token is not distinct from public.patient_test_context(s.member_id)->>'token';
 end if;
 perform 1 from public.patient_clinical_cases where user_id=s.member_id for update nowait;
 begin perform public._booking_assert_actor(s.member_id,actor);exception when insufficient_privilege then valid:=false;end;
 select * into a from public.booking_appointments where id=n.appointment_id for update nowait;
 select * into r from public.booking_manual_reservations where id=n.reservation_id for share nowait;
 select * into pool from public.booking_manual_capacity where key=r.capacity_key for share nowait;
 select * into c from public.workspace_clinics where id=n.clinic_id for share nowait;
 select * into copy from public.workspace_scheduling_settings where id for share nowait;
 perform 1 from public.booking_scheduling_notices where id=p_notice for update nowait;
 return coalesce(valid and(cancelling or s.engine_version=p_engine)and a.notice_id=n.id and a.revision=n.appointment_revision
 and r.state='held'and r.appointment_id=a.id and(cancelling or(r.valid_until>clock_timestamp()and pool.valid_until>clock_timestamp()))and pool.starts_at>clock_timestamp()
 and c.active and c.scheduling_revision=n.clinic_revision and c.scheduling_email=n.clinic_email
 and copy.revision=n.copy_revision and copy.copy_email=n.copy_email and p_sender=n.sender_email and p_template=n.template_version,false);
end $$;

-- Same as 20261016003952 except an accepted notice now releases this
-- appointment's other holds (Noreon operations owns the slots), and an accepted
-- cancellation ends the visit and releases its hold.
create or replace function public.apply_booking_notice_receipt(p_notice uuid,p_attempt uuid,p_engine text,p_sender text,p_template text)returns jsonb
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
  if outcome='accepted'and n.purpose='cancellation'then
   update public.booking_appointments set status='cancelled',current_arrangement=null,current_reservation_id=null,legacy_current=null,current_program=null where id=a.id;
   update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held';
  else
   update public.booking_appointments set status=case when outcome='accepted'then 'confirmed'else outcome end,
    current_arrangement=case when outcome='accepted'then proposed_arrangement else current_arrangement end,
    current_reservation_id=case when outcome='accepted'then proposed_reservation_id else current_reservation_id end,
    legacy_current=case when outcome='accepted'then null else legacy_current end,
    current_program=case when outcome='accepted'then(select jsonb_agg(i-'source')from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=n.program_id)else current_program end where id=a.id;
   if outcome='accepted'then
    update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held'and id<>n.reservation_id;
   end if;
  end if;
 end if;
 update public.booking_notice_attempts set applied_at=clock_timestamp()where id=t.id;
 insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id,attempt_id)values(a.id,n.appointment_revision,outcome,n.id,t.id);
 select * into a from public.booking_appointments where id=a.id;
 return public._booking_appointment_dto(a);
end $$;

-- The clinic notice includes the member's verified phone (Q7 content), and screens
-- name the booked clinics. booking_pilot_workspace keeps its exact released shape so
-- an application still running the previous release parses it (migration first);
-- these details (phone, clinic names, notice purposes) come from a separate RPC with
-- the same actor check. The appointment record shape (_booking_appointment_dto) is unchanged.
create function public.booking_pilot_workspace_details(p_member uuid default null)returns jsonb
language plpgsql stable security definer set search_path='' as $$declare m uuid:=coalesce(p_member,auth.uid());begin
 perform public._booking_assert_actor(m,auth.uid());
 return jsonb_build_object('memberId',m,'phone',(select phone from auth.users where id=m),
 'purposes',(select coalesce(jsonb_object_agg(n.appointment_id::text||':'||n.appointment_revision,n.purpose),'{}'::jsonb)
  from public.booking_scheduling_notices n join public.booking_appointments a on a.id=n.appointment_id where a.member_id=m),
 'clinics',(select coalesce(jsonb_object_agg(c.id,c.name),'{}'::jsonb)from public.workspace_clinics c where c.id in(
  select(v.proposed_arrangement->>'clinicId')::uuid from public.booking_appointment_versions v join public.booking_appointments a on a.id=v.appointment_id where a.member_id=m)));
end $$;
revoke all on function public.booking_pilot_workspace_details(uuid)from public,anon,authenticated,service_role;
grant execute on function public.booking_pilot_workspace_details(uuid)to authenticated;

-- Admin-entered slots (Q4 option A: the clinic sends slots, Noreon operations
-- enters them). The writer remains register_manual_booking_offer.
create function public.real_admin_create_booking_slot(p_offer jsonb,p_capacity integer,p_valid_until timestamptz)returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform public._real_staff_require_admin();
 return public.register_manual_booking_offer(auth.uid(),p_offer,p_capacity,p_valid_until);
end $$;

-- Stop offering a slot. Visits already held keep their place.
create function public.real_admin_close_booking_slot(p_key text)returns boolean
language plpgsql security definer set search_path='' as $$declare pool public.booking_manual_capacity;begin
 perform public._real_staff_require_admin();
 select * into pool from public.booking_manual_capacity where key=p_key for update;
 if not found then raise invalid_parameter_value using message='Slot unavailable';end if;
 if pool.valid_until>clock_timestamp()then update public.booking_manual_capacity set valid_until=clock_timestamp()where key=p_key;end if;
 return true;
end $$;

create function public.real_admin_booking_slots()returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform public._real_staff_require_admin();
 return(select coalesce(jsonb_agg(jsonb_build_object('key',p.key,'clinicId',p.clinic_id,'clinicName',c.name,'startsAt',p.starts_at,'endsAt',p.ends_at,'capacity',p.capacity,
  'validUntil',p.valid_until,'open',p.valid_until>clock_timestamp()and p.starts_at>clock_timestamp(),'reference',p.reference,'createdAt',p.created_at,
  'held',(select count(distinct r.appointment_id)from public.booking_manual_reservations r where r.capacity_key=p.key and r.state='held'),
  'offers',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'version',o.version,'mode',o.offer->>'mode','coveredTestIds',o.offer->'coveredTestIds','preparation',o.offer->>'preparation')order by o.created_at),'[]'::jsonb)
   from public.booking_offer_snapshots o where o.capacity_key=p.key))order by p.starts_at,p.key),'[]'::jsonb)
 from public.booking_manual_capacity p join public.workspace_clinics c on c.id=p.clinic_id where p.ends_at>clock_timestamp()-interval '1 day');
end $$;
revoke all on function public.real_admin_create_booking_slot(jsonb,integer,timestamptz),public.real_admin_close_booking_slot(text),public.real_admin_booking_slots()from public,anon,authenticated,service_role;
grant execute on function public.real_admin_create_booking_slot(jsonb,integer,timestamptz),public.real_admin_close_booking_slot(text),public.real_admin_booking_slots()to authenticated;
