-- WP-5 (quality review items 6 and 12): a member can book again after an attended visit.
-- A slot booking is refused only while an appointment exists for the CURRENT requirements token
-- (select_booking_appointment, unchanged here). The app offered a new booking only while the member
-- had no appointment at all, and a home-visit request was refused while any appointment was not
-- cancelled, so one attended visit blocked every later programme.
--
-- A visit "blocks" a new one while it belongs to the current programme, or while it is still open:
-- not cancelled, not attended, and not a confirmed visit whose time has passed. An older
-- programme's attended, missed or past visit stays in the history and no longer blocks. The database
-- enforces this for home requests (create_patient_test_request) and for every new slot hold (a
-- trigger on booking_appointments); select_booking_appointment keeps its same-requirements refusal.

-- Open: the member still has to attend, move or cancel this visit.
create function public._booking_visit_open(p_row public.booking_appointments)returns boolean
language sql stable security definer set search_path=''as $$
 select p_row.status<>'cancelled'
  -- _booking_visit_attended is NULL for a reservation with no check-in (review WP5-R1).
  and public._booking_visit_attended(p_row.current_reservation_id)is not true
  and not(p_row.status='confirmed'and p_row.current_arrangement is not null
   and(p_row.current_arrangement->>'endsAt')::timestamptz<=clock_timestamp())
$$;
revoke all on function public._booking_visit_open(public.booking_appointments)from public,anon,authenticated,service_role;

-- The same rule in the database for every new slot hold (review WP5-R2, WP5-R3): a new booking, a
-- change, a rebooking or an accepted clinic proposal takes a new proposed reservation. It is refused
-- while another of the member's visits is open, and an accepted clinic proposal (which confirms at
-- once) is also refused while a home-visit request is open; select_booking_appointment already
-- checks open requests itself. A row trigger, so the booking commands themselves are unchanged.
-- Releasing a change (proposed back to the old current) and cancellations take no new hold. An
-- accepted proposal sets proposed and current to the same new reservation, so the update is compared
-- with the OLD current reservation (review WP5-R2 follow-up).
create function public._booking_new_hold_guard()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if exists(select 1 from public.booking_appointments o where o.member_id=new.member_id and o.id<>new.id and public._booking_visit_open(o))then
  raise serialization_failure using message='Another visit is still open';
 end if;
 if tg_op='UPDATE'and new.status='confirmed'and exists(select 1 from public.patient_test_requests r where r.user_id=new.member_id and r.status not in('cancelled','completed')
  and not exists(select 1 from public.booking_legacy_conversions c where c.legacy_id=r.id))then
  raise serialization_failure using message='Reconcile the existing historical request first';
 end if;
 return new;
end$$;
revoke all on function public._booking_new_hold_guard()from public,anon,authenticated,service_role;
create trigger booking_new_hold_insert before insert on public.booking_appointments for each row
 when(new.proposed_reservation_id is not null and new.proposed_reservation_id is distinct from new.current_reservation_id)
 execute function public._booking_new_hold_guard();
create trigger booking_new_hold_update before update of proposed_reservation_id on public.booking_appointments for each row
 when(new.proposed_reservation_id is not null and new.proposed_reservation_id is distinct from old.proposed_reservation_id
  and new.proposed_reservation_id is distinct from old.current_reservation_id)
 execute function public._booking_new_hold_guard();

-- Which appointments belong to the current programme and which block a new visit. Read-only,
-- same actor check as booking_pilot_workspace (whose audited read precedes it on every page), and
-- it returns ids and flags only. A separate function so booking_pilot_workspace keeps its shape.
create function public.booking_pilot_programme_state(p_member uuid default null)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m uuid:=coalesce(p_member,auth.uid());token text;
begin
 perform public._booking_assert_actor(m,auth.uid());
 token:=public.patient_test_context(m)->>'requirementsToken';
 return jsonb_build_object('memberId',m,'appointments',(select coalesce(jsonb_object_agg(a.id,jsonb_build_object(
  'currentProgramme',a.requirements_token=token,
  'open',public._booking_visit_open(a))),'{}'::jsonb)
  from public.booking_appointments a where a.member_id=m));
end$$;
revoke all on function public.booking_pilot_programme_state(uuid)from public,anon,authenticated,service_role;
grant execute on function public.booking_pilot_programme_state(uuid)to authenticated;

-- Home-visit request: same as 20261017115601 except the appointment fence. A cancelled visit never
-- fenced it; now an attended or past visit from an earlier programme does not either.
create or replace function public.create_patient_test_request(p_user_id uuid,p_request_id uuid,p_context_token text,p_terms jsonb,p_requirements jsonb,p_algorithm_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare replay boolean;result jsonb;token text;
begin
 perform public.lock_patient_clinical_sources(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 perform 1 from public.patient_test_requests where id=p_request_id and user_id=p_user_id for update nowait;
 replay:=found;
 if exists(select 1 from public.booking_legacy_conversions where legacy_id=p_request_id)then
  raise insufficient_privilege using message='This request uses the scheduling email pilot';
 end if;
 -- Delegate retains all baseline clinical validation, canonical payload replay,
 -- first enrollment, enrollment event and requested/preference semantics.
 result:=public._legacy_create_patient_test_request(p_user_id,p_request_id,p_context_token,p_terms,p_requirements,p_algorithm_version);
 -- The delegate now holds the SAME case UPDATE lock as pilot selection, including
 -- first enrollment. Recheck here, not before delegation: any conflict rolls back
 -- its request/event/enrollment together. No extra opposite-order advisory lock.
 token:=public.patient_test_context(p_user_id)->>'requirementsToken';
 if not replay and exists(select 1 from public.booking_appointments a where a.member_id=p_user_id and a.status<>'cancelled'
  and(a.requirements_token=token or public._booking_visit_open(a)))then
  raise serialization_failure using message='Reconcile the existing pilot appointment before creating a manual request';
 end if;
 return result;
end$$;
