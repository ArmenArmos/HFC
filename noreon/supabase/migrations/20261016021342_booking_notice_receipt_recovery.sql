-- Receipt recovery is an explicit audited operator action. It never submits
-- email and never allocates a new attempt, even when no receipt is present.
alter table public.booking_appointment_events add column actor_id uuid references auth.users(id);
alter table public.booking_appointment_events add column operation_input jsonb;
alter table public.booking_appointment_events add column operation_result jsonb;

create function public.reconcile_booking_notice(p_member uuid,p_actor uuid,p_appointment uuid,p_revision bigint,p_notice uuid,p_command uuid,p_engine text,p_sender text,p_template text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare prior public.booking_appointment_events;canonical jsonb;a public.booking_appointments;n public.booking_scheduling_notices;t public.booking_notice_attempts;
 result jsonb;dto jsonb;recorded boolean:=false;
begin
 if p_member is null or p_actor is null or p_appointment is null or p_notice is null or p_command is null or p_revision is null or p_revision<0
 or coalesce(length(p_engine),0)not between 1 and 100 or public._real_scheduling_email(p_sender)is null or coalesce(length(p_template),0)not between 1 and 200 then
  raise invalid_parameter_value using message='Invalid scheduling receipt recovery';
 end if;
 perform public._booking_assert_actor(p_member,p_actor);
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role in('admin','doctor','nurse')and active and removed_at is null)then
  raise insufficient_privilege using message='Active assigned staff required';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-notice-recovery:'||p_command::text,0));
 perform public.lock_patient_clinical_sources(p_member);
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 if not found then raise insufficient_privilege using message='Assigned case required';end if;
 perform public._booking_assert_actor(p_member,p_actor);
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role in('admin','doctor','nurse')and active and removed_at is null)then
  raise insufficient_privilege using message='Active assigned staff required';
 end if;
 canonical:=jsonb_build_object('memberId',p_member,'appointmentId',p_appointment,'revision',p_revision,'noticeId',p_notice,'engine',p_engine,'sender',p_sender,'template',p_template);
 select * into prior from public.booking_appointment_events where id=p_command;
 if found then
  if prior.actor_id is distinct from p_actor then raise insufficient_privilege using message='Original recovery operator required';end if;
  if prior.kind<>'receipt-recovery-requested'or prior.operation_input is distinct from canonical then raise invalid_parameter_value using message='Recovery command identity already used';end if;
  return prior.operation_result;
 end if;
 select * into a from public.booking_appointments where id=p_appointment for update nowait;
 if not found or a.member_id<>p_member then raise insufficient_privilege using message='Appointment unavailable';end if;
 if a.notice_id<>p_notice or a.revision<>p_revision then raise serialization_failure using message='Booking changed before receipt recovery';end if;
 select * into n from public.booking_scheduling_notices where id=p_notice and appointment_id=a.id;
 if not found then raise insufficient_privilege using message='Scheduling notice unavailable';end if;
 select * into t from public.booking_notice_attempts where notice_id=n.id and generation=n.generation;
 recorded:=found and t.receipt is not null;
 if recorded then
  dto:=public.apply_booking_notice_receipt(p_notice,t.id,p_engine,p_sender,p_template);
 else
  if n.state='sending'and n.lease_until<=clock_timestamp()then
   -- Existing claim logic marks an expired in-flight send UNKNOWN before any
   -- attempt-generation insertion. This branch cannot allocate or resend.
   perform public.claim_booking_notice(p_notice,p_command,n.generation+1,clock_timestamp()+interval '5 minutes',p_engine,p_sender,p_template);
  end if;
  select * into a from public.booking_appointments where id=p_appointment;
  dto:=public._booking_appointment_dto(a);
 end if;
 result:=jsonb_build_object('appointment',dto,'receiptRecorded',coalesce(recorded,false));
 -- attempt_id stays null for these command events: the existing unique
 -- (notice_id,attempt_id,kind) tracks transport events, not repeated explicit
 -- receipt checks. The original attempt remains in its immutable own table.
 insert into public.booking_appointment_events(id,appointment_id,revision,kind,notice_id,actor_id,operation_input,operation_result)
 values(p_command,p_appointment,p_revision,'receipt-recovery-requested',p_notice,p_actor,canonical,result);
 return result;
end$$;
revoke all on function public.reconcile_booking_notice(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.reconcile_booking_notice(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text)to service_role;
