-- BEP3 residual: an actor valid before a command-lock wait may be revoked
-- before receipt recovery. Recheck through the existing locked read boundary.
create or replace function public.select_booking_appointment(p_command_id uuid,p_member uuid,p_actor uuid,p_program_id uuid,p_offer_id uuid,p_offer_version text,
 p_home_address text default null,p_appointment_id uuid default null,p_revision bigint default null,p_agreement_source text default null,p_legacy_id uuid default null,
 p_sender_email text default null,p_template_version text default null,p_subject text default null,p_text_content text default null)returns jsonb
language plpgsql security definer set search_path='' as $$
declare seal public.booking_program_seals;offer_row public.booking_offer_snapshots;pool public.booking_manual_capacity;clinic public.workspace_clinics;copy public.workspace_scheduling_settings;
 a public.booking_appointments;prior public.booking_appointment_commands;legacy public.patient_test_requests;canonical jsonb;details jsonb;result jsonb;aid uuid;rev bigint;enrolled uuid;sender text;
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
  -- Reuse the locked receipt-actor boundary after the command wait.
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
  sender_email,clinic_email,copy_email,template_version,subject,text_content,envelope_hash)
 values(p_command_id,aid,rev,seal.id,p_command_id,clinic.id,clinic.scheduling_revision,copy.revision,sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content,
 public._booking_envelope_hash(sender,clinic.scheduling_email,copy.copy_email,p_template_version,p_subject,p_text_content));
 insert into public.booking_appointment_versions(appointment_id,revision,program_id,previous_arrangement,proposed_arrangement,notice_id,actor_id,agreement_source,legacy_snapshot,previous_program)
 values(aid,rev,seal.id,a.current_arrangement,details,p_command_id,p_actor,nullif(btrim(p_agreement_source),''),case when p_legacy_id is not null then to_jsonb(legacy)else null end,a.current_program);
 if p_legacy_id is not null then insert into public.booking_legacy_conversions(legacy_id,appointment_id,actor_id,agreement_source)values(p_legacy_id,aid,p_actor,btrim(p_agreement_source));end if;
 insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(aid,rev,'selected',p_command_id);
 select * into a from public.booking_appointments where id=aid;result:=public._booking_appointment_dto(a);
 insert into public.booking_appointment_commands(id,member_id,actor_id,input,result)values(p_command_id,p_member,p_actor,canonical,result);
 return result;
end $$;

