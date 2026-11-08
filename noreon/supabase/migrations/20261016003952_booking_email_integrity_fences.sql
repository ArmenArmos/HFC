-- BEP1–BEP5: forward-only fixes after real ordered PostgreSQL reproductions.
-- Read definitions/arrangements are preserved; no manual hold is fabricated for
-- historical provider bookings and no old hold is automatically released.
alter table public.booking_appointments add column legacy_current jsonb;
alter table public.booking_appointments add column current_program jsonb check(current_program is null or jsonb_typeof(current_program)='array');
alter table public.booking_appointment_versions add column previous_program jsonb;

update public.booking_appointments a set legacy_current=(
 select v.legacy_snapshot->'current_arrangement'from public.booking_appointment_versions v where v.appointment_id=a.id
 and v.legacy_snapshot->'current_arrangement'is not null and v.legacy_snapshot->'current_arrangement'<>'null'::jsonb order by v.revision limit 1
)where a.current_arrangement is null;
update public.booking_appointments a set current_program=(
 select jsonb_agg(i-'source')from public.booking_appointment_versions v join public.booking_program_seals s on s.id=v.program_id
 cross join lateral jsonb_array_elements(s.program->'items')i
 where v.appointment_id=a.id and v.proposed_arrangement=a.current_arrangement
 and v.revision=(select max(v2.revision)from public.booking_appointment_versions v2 join public.booking_scheduling_notices n on n.id=v2.notice_id
  where v2.appointment_id=a.id and v2.proposed_arrangement=a.current_arrangement and n.state='accepted')
)where a.current_arrangement is not null;
update public.booking_appointments a set current_program=(
 select jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method','preparation',''))
 from public.booking_legacy_conversions c join public.patient_test_requests r on r.id=c.legacy_id cross join lateral jsonb_array_elements(r.requirements)i where c.appointment_id=a.id
)where a.legacy_current is not null;
update public.booking_appointment_versions v set previous_program=(
 select jsonb_agg(i-'source')from public.booking_appointment_versions old join public.booking_program_seals s on s.id=old.program_id
 cross join lateral jsonb_array_elements(s.program->'items')i
 where old.appointment_id=v.appointment_id and old.proposed_arrangement=v.previous_arrangement
 and old.revision=(select max(o.revision)from public.booking_appointment_versions o where o.appointment_id=v.appointment_id and o.revision<v.revision and o.proposed_arrangement=v.previous_arrangement)
)where v.previous_arrangement is not null;
-- Repair already-started old failed retries, without authorizing any send.
update public.booking_appointments a set status=case when n.lease_until<=clock_timestamp()then 'unknown'else 'notification-pending'end
from public.booking_scheduling_notices n where n.id=a.notice_id and n.state='sending'and a.status='failed';

create or replace function public.create_patient_test_request(p_user_id uuid,p_request_id uuid,p_context_token text,p_terms jsonb,p_requirements jsonb,p_algorithm_version text)returns jsonb
language plpgsql security definer set search_path=''as $$begin
 perform public.lock_patient_clinical_sources(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 perform 1 from public.patient_test_requests where id=p_request_id and user_id=p_user_id for update nowait;
 if not found or exists(select 1 from public.booking_legacy_conversions where legacy_id=p_request_id)then
  raise insufficient_privilege using message='New bookings use the scheduling email pilot; historical creation is replay-only';
 end if;
 return public._legacy_create_patient_test_request(p_user_id,p_request_id,p_context_token,p_terms,p_requirements,p_algorithm_version);
end$$;
create or replace function public.command_patient_test_request(p_user_id uuid,p_actor uuid,p_staff boolean,p_id uuid,p_revision bigint,p_command_id uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$begin
 perform public.lock_patient_clinical_sources(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 perform 1 from public.patient_test_requests where id=p_id and user_id=p_user_id for update nowait;
 if exists(select 1 from public.booking_legacy_conversions where legacy_id=p_id)then raise insufficient_privilege using message='This request uses the scheduling email pilot';end if;
 return public._legacy_command_patient_test_request(p_user_id,p_actor,p_staff,p_id,p_revision,p_command_id,p_operation,p_input);
end$$;

create or replace function public.register_booking_program(p_id uuid,p_member uuid,p_actor uuid,p_program jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;prior public.booking_program_seals;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 perform public.lock_patient_clinical_sources(p_member);
 if p_actor<>p_member then
  perform 1 from public.patient_clinical_cases where user_id=p_member for share nowait;
  if not found then raise insufficient_privilege using message='Assigned member required';end if;
 end if;
 perform public._booking_assert_actor(p_member,p_actor);
 context:=public.patient_test_context(p_member);
 if p_id is null or jsonb_typeof(p_program) is distinct from 'object' or octet_length(p_program::text)>100000
 or p_program-array['memberId','sourceToken','requirementsToken','engineVersion','items']<>'{}'::jsonb
 or p_program->>'memberId' is distinct from p_member::text or coalesce(length(p_program->>'engineVersion'),0)not between 1 and 100
 or jsonb_typeof(p_program->'items')is distinct from 'array' then raise invalid_parameter_value using message='Invalid trusted booking program';end if;
 if jsonb_array_length(p_program->'items')not between 1 and 100
 or exists(select 1 from jsonb_array_elements(p_program->'items')i where jsonb_typeof(i)is distinct from 'object'
  or i-array['id','title','method','preparation','source']<>'{}'::jsonb or coalesce(length(i->>'id'),0)not between 1 and 100
  or coalesce(length(i->>'title'),0)not between 1 and 500 or coalesce(i->>'method','')not in('lab','clinic','home-log')
  or jsonb_typeof(i->'preparation')is distinct from 'string' or length(i->>'preparation')>8000
  or jsonb_typeof(i->'source')is distinct from 'string' or length(i->>'source')>2000)
 or(select count(*)<>count(distinct i->>'id')from jsonb_array_elements(p_program->'items')i)then
  raise invalid_parameter_value using message='Invalid trusted booking program';
 end if;
 if p_program->>'sourceToken' is distinct from context->>'token' or p_program->>'requirementsToken' is distinct from context->>'requirementsToken' then
  raise serialization_failure using message='Booking source changed';
 end if;
 if context#>>'{data,assessment,completed_at}' is null or context#>>'{data,assessment,urgent_rule}'is not null
 or context#>'{data,consent}'is null or context#>'{data,consent}'='null'::jsonb then
  raise insufficient_privilege using message='Current questionnaire and consent required';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-program:'||p_id::text,0));
 select * into prior from public.booking_program_seals where id=p_id;
 if found then
  if prior.member_id<>p_member or prior.actor_id<>p_actor or prior.program<>p_program then raise invalid_parameter_value using message='Program identity already used';end if;
 else
  insert into public.booking_program_seals(id,member_id,actor_id,source_token,requirements_token,engine_version,program)
  values(p_id,p_member,p_actor,p_program->>'sourceToken',p_program->>'requirementsToken',p_program->>'engineVersion',p_program);
 end if;
 return jsonb_build_object('id',p_id,'memberId',p_member,'sourceToken',context->>'token','requirementsToken',context->>'requirementsToken');
end $$;

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
  return prior.result;
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

create or replace function public._booking_notice_context(p_notice uuid,p_engine text,p_sender text,p_template text)returns boolean
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
 -- Assignment may have changed after the precheck but before this case lock.
 begin perform public._booking_assert_actor(s.member_id,actor);exception when insufficient_privilege then valid:=false;end;
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

create or replace function public.claim_booking_notice(p_notice uuid,p_attempt uuid,p_generation integer,p_lease_until timestamptz,p_engine text,p_sender text,p_template text)returns jsonb
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
 update public.booking_appointments set status='notification-pending'where id=n.appointment_id and notice_id=n.id;
 return jsonb_build_object('noticeId',n.id,'attemptId',p_attempt,'generation',p_generation,'envelopeHash',n.envelope_hash,
 'senderEmail',n.sender_email,'clinicEmail',n.clinic_email,'copyEmail',n.copy_email,'templateVersion',n.template_version,'subject',n.subject,'textContent',n.text_content);
end $$;

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
  update public.booking_appointments set status=case when outcome='accepted'then 'confirmed'else outcome end,
   current_arrangement=case when outcome='accepted'then proposed_arrangement else current_arrangement end,
   current_reservation_id=case when outcome='accepted'then proposed_reservation_id else current_reservation_id end,
   legacy_current=case when outcome='accepted'then null else legacy_current end,
   current_program=case when outcome='accepted'then(select jsonb_agg(i-'source')from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=n.program_id)else current_program end where id=a.id;
 end if;
 -- Old manual holds are intentionally NOT automatically released. Their actual
 -- reconciliation/release policy belongs to the trusted capacity source.
 update public.booking_notice_attempts set applied_at=clock_timestamp()where id=t.id;
 insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id,attempt_id)values(a.id,n.appointment_revision,outcome,n.id,t.id);
 select * into a from public.booking_appointments where id=a.id;
 return public._booking_appointment_dto(a);
end $$;

create or replace function public._booking_appointment_dto(p_row public.booking_appointments)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('version','email-pilot-v1','id',p_row.id,'memberId',p_row.member_id,'revision',p_row.revision,
 'status',case when n.state='sending'and n.lease_until<=clock_timestamp()then 'unknown'
  when n.state='sending'and exists(select 1 from public.booking_notice_attempts t where t.notice_id=n.id and t.receipt is not null)then 'reconciliation'else p_row.status end,
 'program',(select coalesce(jsonb_agg(i-'source'),'[]'::jsonb)from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=p_row.program_id),
 'currentProgram',coalesce(p_row.current_program,'[]'::jsonb),'legacyCurrent',p_row.legacy_current,
 'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',v.revision,'createdAt',v.created_at,
  'program',(select jsonb_agg(i-'source')from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=v.program_id),
  'previous',v.previous_arrangement,'proposed',v.proposed_arrangement,
  'noticeState',case when old_notice.state='sending'and old_notice.lease_until<=clock_timestamp()then 'unknown'else old_notice.state end)order by v.revision),'[]'::jsonb)
  from public.booking_appointment_versions v join public.booking_scheduling_notices old_notice on old_notice.id=v.notice_id where v.appointment_id=p_row.id),
 'current',p_row.current_arrangement,'proposed',p_row.proposed_arrangement,'noticeId',p_row.notice_id,'createdAt',p_row.created_at)
 from public.booking_scheduling_notices n where n.id=p_row.notice_id
$$;

-- HTTP/action recovery runs BEFORE deriving a fresh program or rendering a new
-- message. Only the original client selection is compared; the private receipt
-- retains its original program/template/body even after ordinary source drift.
create function public.recover_booking_command(p_command uuid,p_member uuid,p_actor uuid,p_selection jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare prior public.booking_appointment_commands;expected jsonb;canonical jsonb;clinic uuid;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 if p_command is null or jsonb_typeof(p_selection)is distinct from 'object'or octet_length(p_selection::text)>16000
 or p_selection-array['offerId','offerVersion','homeAddress','appointmentId','revision','agreementSource','legacyId']<>'{}'::jsonb then
  raise invalid_parameter_value using message='Invalid booking recovery selection';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-command:'||p_command::text,0));
 select * into prior from public.booking_appointment_commands where id=p_command;
 if not found then return null;end if;
 if prior.member_id<>p_member or prior.actor_id<>p_actor then raise insufficient_privilege using message='Original command actor required';end if;
 perform 1 from auth.users where id=p_member and phone is not null and phone_confirmed_at is not null for share nowait;
 if not found then raise insufficient_privilege using message='Verified member required';end if;
 perform 1 from public.patient_clinical_cases where user_id=p_member for share nowait;
 if p_actor<>p_member then
  select clinic_id into clinic from public.workspace_staff where user_id=p_actor for share nowait;
  if clinic is not null then perform 1 from public.workspace_clinics where id=clinic for share nowait;end if;
 end if;
 perform public._booking_assert_actor(p_member,p_actor);
 expected:=prior.input-array['programId','senderEmail','templateVersion','subject','textContent'];
 canonical:=jsonb_build_object('offerId',p_selection->'offerId','offerVersion',p_selection->'offerVersion','homeAddress',nullif(btrim(p_selection->>'homeAddress'),''),
 'appointmentId',p_selection->'appointmentId','revision',p_selection->'revision','agreementSource',nullif(btrim(p_selection->>'agreementSource'),''),'legacyId',p_selection->'legacyId');
 if expected<>canonical then raise invalid_parameter_value using message='Command identity already used';end if;
 return prior.result;
end$$;
revoke all on function public.recover_booking_command(uuid,uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.recover_booking_command(uuid,uuid,uuid,jsonb)to service_role;
