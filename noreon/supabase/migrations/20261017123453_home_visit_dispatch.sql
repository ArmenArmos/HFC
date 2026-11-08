-- Home visits (lead decisions D2 and MFF-1, 17 Oct 2026), dark.
--  1. Nurse dispatch notice: when a home-visit request is confirmed (or its time changes, or
--     another nurse is assigned to the member), the member's assigned nurse gets a Telegram
--     notice through the staff binding and the auth outbox, like the care-alert staff notice.
--     The message carries no member or health details; the nurse opens the staff app.
--  2. Auto-close: when a nurse records a visit for the member on or after the arranged day,
--     the confirmed home request becomes 'completed', so it stops fencing clinic slot booking.
-- Both are off until home_visit_settings is switched on. The template is an unapproved
-- placeholder that the outbox holds at claim.

-- 1. State -----------------------------------------------------------------------------------

alter table public.patient_test_requests drop constraint patient_test_requests_status_check;
alter table public.patient_test_requests add constraint patient_test_requests_status_check
 check(status in('requested','provider-proposed','confirmed','change-pending','cancelled','completed'));

create table public.home_visit_settings(
 singleton boolean primary key default true check(singleton),
 telegram_notice boolean not null default false,
 auto_close boolean not null default false,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.home_visit_settings(singleton)values(true);

-- One row per notice decision: queued (with the outbox message) or skipped (with the reason).
create table public.home_visit_dispatches(
 id bigint generated always as identity primary key,
 request_id uuid not null references public.patient_test_requests(id),
 request_revision bigint not null,
 nurse_id uuid references auth.users(id),
 outcome text not null check(outcome in('queued','skipped')),
 reason text not null check(reason in('queued','no_nurse_assigned','nurse_inactive','no_staff_binding','no_template_available')),
 telegram_message_id uuid unique references public.telegram_auth_messages(id),
 created_at timestamptz not null default clock_timestamp()
);
create unique index home_visit_dispatches_once on public.home_visit_dispatches(request_id,request_revision,coalesce(nurse_id,'00000000-0000-0000-0000-000000000000'::uuid));
alter table public.home_visit_settings enable row level security;
alter table public.home_visit_dispatches enable row level security;
revoke all on public.home_visit_settings,public.home_visit_dispatches from public,anon,authenticated,service_role;
create trigger home_visit_dispatches_immutable before update or delete on public.home_visit_dispatches for each row execute function public._clinic_portal_immutable();

insert into public.system_message_templates(template_id,version,locale,body)values
 ('home_visit.nurse_assigned',1,'en','UNAPPROVED PLACEHOLDER. A home visit was assigned to you. Open the Noreon staff app to see it.'),
 ('home_visit.nurse_assigned',1,'hy','UNAPPROVED PLACEHOLDER. Ձեզ տնային այց է հանձնարարվել։ Բացեք Noreon-ի աշխատակազմի հավելվածը՝ այն տեսնելու համար։');

-- 2. Nurse notice ----------------------------------------------------------------------------

create function public._home_visit_is_home(r public.patient_test_requests)returns boolean
language sql immutable set search_path=''as $$
 select r.status='confirmed'and r.current_arrangement#>>'{terms,mode}'='home'
$$;

create function public._home_visit_notify(r public.patient_test_requests)returns void
language plpgsql security definer set search_path=''as $$
declare nurse uuid;b public.telegram_auth_bindings;mid uuid;why text;
begin
 if(select telegram_notice from public.home_visit_settings where singleton)is not true then return;end if;
 if not public._home_visit_is_home(r)or(r.current_arrangement#>>'{terms,startsAt}')::timestamptz<=clock_timestamp()then return;end if;
 -- One decision per request at a time, so the dedup check and the journal insert cannot race (review HV-2).
 perform pg_advisory_xact_lock(hashtextextended('home-visit-notice:'||r.id::text,0));
 select assigned_nurse_id into nurse from public.patient_clinical_cases where user_id=r.user_id;
 if exists(select 1 from public.home_visit_dispatches where request_id=r.id and request_revision=r.revision and nurse_id is not distinct from nurse)then return;end if;
 if nurse is null then why:='no_nurse_assigned';
 elsif not exists(select 1 from public.workspace_staff where user_id=nurse and role='nurse'and active and removed_at is null)then why:='nurse_inactive';
 else
  select * into b from public.telegram_auth_bindings where auth_user_id=nurse and kind='staff'and active order by created_at desc limit 1;
  if not found then why:='no_staff_binding';
  else
   mid:=public._telegram_auth_enqueue('home_visit.nurse_assigned',public._telegram_auth_locale(nurse),b.address,b.principal_ref,null,null);
   why:=case when mid is null then 'no_template_available'else 'queued'end;
  end if;
 end if;
 insert into public.home_visit_dispatches(request_id,request_revision,nurse_id,outcome,reason,telegram_message_id)
  values(r.id,r.revision,nurse,case when mid is null then 'skipped'else 'queued'end,why,mid);
end$$;

create function public._home_visit_request_changed()returns trigger
language plpgsql security definer set search_path=''as $$begin
 if public._home_visit_is_home(new)and(not public._home_visit_is_home(old)or old.current_arrangement is distinct from new.current_arrangement)then
  perform public._home_visit_notify(new);
 end if;
 return null;
end$$;
create trigger home_visit_request_notice after update of status,current_arrangement on public.patient_test_requests
 for each row execute function public._home_visit_request_changed();

-- A newly assigned nurse hears about the member's upcoming confirmed home visits.
create function public._home_visit_nurse_changed()returns trigger
language plpgsql security definer set search_path=''as $$declare r public.patient_test_requests;begin
 if new.assigned_nurse_id is distinct from old.assigned_nurse_id and new.assigned_nurse_id is not null then
  for r in select * from public.patient_test_requests where user_id=new.user_id and status='confirmed'order by created_at for update loop
   perform public._home_visit_notify(r);
  end loop;
 end if;
 return null;
end$$;
create trigger home_visit_nurse_notice after update of assigned_nurse_id on public.patient_clinical_cases
 for each row execute function public._home_visit_nurse_changed();

-- 3. Auto-close when the visit is recorded ---------------------------------------------------

create function public._home_visit_close_on_visit()returns trigger
language plpgsql security definer set search_path=''as $$declare r public.patient_test_requests;begin
 if(select auto_close from public.home_visit_settings where singleton)is not true then return null;end if;
 for r in select * from public.patient_test_requests where user_id=new.user_id and status='confirmed'and current_arrangement#>>'{terms,mode}'='home'
  and((current_arrangement#>>'{terms,startsAt}')::timestamptz at time zone 'Asia/Yerevan')::date<=(new.created_at at time zone 'Asia/Yerevan')::date
  order by created_at for update loop
  update public.patient_test_requests set revision=revision+1,status='completed',updated_at=now()where id=r.id;
  insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
   values(r.id,gen_random_uuid(),new.actor_id,r.revision+1,'completed-by-visit',jsonb_build_object('visitId',new.id),jsonb_build_object('status','completed'));
 end loop;
 return null;
end$$;
create trigger home_visit_close_on_visit after insert on public.patient_care_visits
 for each row execute function public._home_visit_close_on_visit();

-- 4. Fences: a completed request takes no more commands and no longer blocks slot booking ------

-- Same as 20261016003952 except a completed request is closed to commands.
create or replace function public.command_patient_test_request(p_user_id uuid,p_actor uuid,p_staff boolean,p_id uuid,p_revision bigint,p_command_id uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$begin
 perform public.lock_patient_clinical_sources(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 perform 1 from public.patient_test_requests where id=p_id and user_id=p_user_id for update nowait;
 if exists(select 1 from public.booking_legacy_conversions where legacy_id=p_id)then raise insufficient_privilege using message='This request uses the scheduling email pilot';end if;
 -- A retried command keeps its recorded result even after the visit was completed (review HV-1).
 if exists(select 1 from public.patient_test_requests where id=p_id and status='completed')
  and not exists(select 1 from public.patient_test_request_events where request_id=p_id and command_id=p_command_id)then raise exception 'This visit is completed';end if;
 return public._legacy_command_patient_test_request(p_user_id,p_actor,p_staff,p_id,p_revision,p_command_id,p_operation,p_input);
end$$;

-- Same as 20261017111652 except a completed request no longer blocks slot booking.
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

revoke all on function public._home_visit_is_home(public.patient_test_requests),public._home_visit_notify(public.patient_test_requests),public._home_visit_request_changed(),
 public._home_visit_nurse_changed(),public._home_visit_close_on_visit()from public,anon,authenticated,service_role;
