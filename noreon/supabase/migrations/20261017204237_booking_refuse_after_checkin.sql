-- QA F-03 (server side): the member and admin cancel and reschedule paths, and accepting a clinic
-- proposal, refuse once the clinic has recorded the visit as attended: the latest check-in is
-- "arrived", or results were linked ("completed"). A no-show stays open (lead decision 18 Oct,
-- review F2): the member can move, cancel or book it again and the clinic can still propose a time;
-- cancelling a missed visit is allowed even though its start time has passed.
--
-- The three functions below are copied unchanged from their latest definitions
--   booking_portal_cancel        20261017111652_clinic_portal_scheduling.sql
--   cancel_booking_appointment   20261016181417_booking_b1_unified_cancel.sql
--   booking_portal_proposal_answer 20261017111652_clinic_portal_scheduling.sql (the accept path)
--   select_booking_appointment   20261017123453_home_visit_dispatch.sql (the change path only:
--                                p_appointment_id given; a cancelled visit has no current
--                                reservation, so booking it again stays possible)
-- except for one added refusal after the appointment row is locked (and, in booking_portal_cancel,
-- the started-visit refusal no longer applies to a no-show). A replayed command still
-- returns its recorded result, because the replay returns before the new check.
-- create or replace keeps each function's owner and grants.

-- Attended: results linked, or the latest check-in (a correction replaces the one before) is an arrival.
create function public._booking_visit_attended(p_reservation uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select p_reservation is not null and(
  exists(select 1 from public.clinic_booking_checkins k where k.reservation_id=p_reservation and k.outcome='completed')
  or(select k.outcome from public.clinic_booking_checkins k where k.reservation_id=p_reservation order by k.id desc limit 1)='arrived')
$$;
-- Missed: the latest check-in is a no-show and no results were linked.
create function public._booking_visit_missed(p_reservation uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select p_reservation is not null and not public._booking_visit_attended(p_reservation)
  and(select k.outcome from public.clinic_booking_checkins k where k.reservation_id=p_reservation order by k.id desc limit 1)='no-show'
$$;
revoke all on function public._booking_visit_attended(uuid),public._booking_visit_missed(uuid)from public,anon,authenticated,service_role;

-- An arrival or linked results end any open clinic proposal for the visit (review F1), and a new
-- proposal for an attended visit is refused (the clinic command reports it as unavailable).
create function public._clinic_checkin_withdraw_proposals()returns trigger language plpgsql security definer set search_path=''as $$begin
 if new.outcome in('arrived','completed')then
  update public.clinic_booking_proposals set state='withdrawn',decided_at=clock_timestamp(),decided_by=new.actor_id where appointment_id=new.appointment_id and state='open';
 end if;
 return null;
end$$;
create trigger clinic_booking_checkins_withdraw_proposals after insert on public.clinic_booking_checkins for each row execute function public._clinic_checkin_withdraw_proposals();
create function public._clinic_proposal_attended_guard()returns trigger language plpgsql security definer set search_path=''as $$begin
 if public._booking_visit_attended((select a.current_reservation_id from public.booking_appointments a where a.id=new.appointment_id))then
  raise serialization_failure using message='The clinic has recorded this visit';
 end if;
 return new;
end$$;
create trigger clinic_booking_proposals_attended_guard before insert on public.clinic_booking_proposals for each row execute function public._clinic_proposal_attended_guard();
revoke all on function public._clinic_checkin_withdraw_proposals(),public._clinic_proposal_attended_guard()from public,anon,authenticated,service_role;

create or replace function public.booking_portal_cancel(p_command uuid,p_member uuid,p_actor uuid,p_appointment uuid,p_revision bigint,p_agreement_source text default null)returns jsonb
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
 -- QA F-03: once the clinic has recorded the arrival or the results, the visit is settled.
 if public._booking_visit_attended(a.current_reservation_id)then raise serialization_failure using message='The clinic has recorded this visit';end if;
 select * into n from public.booking_scheduling_notices where id=a.notice_id;
 if a.status='confirmed'and a.current_reservation_id is not null and n.state<>'pending'then
  select * into r from public.booking_manual_reservations where id=a.current_reservation_id for update;arr:=a.current_arrangement;
 elsif a.status='notification-pending'and a.current_arrangement is null and n.channel='portal'and n.state='pending'then
  select * into r from public.booking_manual_reservations where id=a.proposed_reservation_id for update;arr:=a.proposed_arrangement;
  update public.booking_scheduling_notices set state='superseded'where id=n.id;
 else raise serialization_failure using message='Resolve the current arrangement before cancelling it';end if;
 select * into pool from public.booking_manual_capacity where key=r.capacity_key;
 if pool.source<>'clinic-hours'then raise invalid_parameter_value using message='Email-arranged visits are cancelled by email';end if;
 -- A no-show can still be cancelled after its start (review F2).
 if pool.starts_at<=clock_timestamp()and not public._booking_visit_missed(a.current_reservation_id)then raise serialization_failure using message='The visit has already started';end if;
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

create or replace function public.cancel_booking_appointment(p_command_id uuid,p_member uuid,p_actor uuid,p_appointment_id uuid,p_revision bigint,
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
 -- QA F-03: once the clinic has recorded the arrival or the results, the visit is settled.
 if public._booking_visit_attended(a.current_reservation_id)then raise serialization_failure using message='The clinic has recorded this visit';end if;
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
 if exists(select 1 from public.patient_test_requests r where r.user_id=p_member and r.status not in('cancelled','completed')
  and(r.id is distinct from p_legacy_id)and not exists(select 1 from public.booking_legacy_conversions c where c.legacy_id=r.id))then raise serialization_failure using message='Reconcile the existing historical request first';end if;
 aid:=coalesce(p_appointment_id,p_command_id);
 select * into a from public.booking_appointments where id=aid for update nowait;
 if p_appointment_id is not null then
  if not found or a.member_id<>p_member then raise insufficient_privilege using message='Appointment unavailable';end if;
  -- QA F-03: once the clinic has recorded the arrival or the results, the visit is settled.
  if public._booking_visit_attended(a.current_reservation_id)then raise serialization_failure using message='The clinic has recorded this visit';end if;
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

create or replace function public.booking_portal_proposal_answer(p_command uuid,p_member uuid,p_actor uuid,p_proposal uuid,p_accept boolean)returns jsonb
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
  -- QA F-03 (review F1): a proposal never moves a visit the clinic has recorded as attended.
  if public._booking_visit_attended(a.current_reservation_id)then raise serialization_failure using message='The clinic has recorded this visit';end if;
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
