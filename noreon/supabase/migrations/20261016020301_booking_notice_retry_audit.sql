-- Explicit staff retry intents. Ordinary booking replays and reads still use
-- generation1 only; unknown/reconciliation outcomes are never retry admission.
create table public.booking_notice_retry_commands(
 id uuid primary key,
 member_id uuid not null references auth.users(id),
 actor_id uuid not null references auth.users(id),
 notice_id uuid not null references public.booking_scheduling_notices(id),
 input jsonb not null,
 attempt_id uuid unique references public.booking_notice_attempts(id),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.booking_notice_retry_commands enable row level security;
revoke all on public.booking_notice_retry_commands from public,anon,authenticated,service_role;

create function public.retry_booking_notice(p_member uuid,p_actor uuid,p_appointment uuid,p_revision bigint,p_notice uuid,p_command uuid,p_engine text,p_sender text,p_template text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare prior public.booking_notice_retry_commands;canonical jsonb;a public.booking_appointments;n public.booking_scheduling_notices;
 envelope jsonb;attempt uuid;generation integer;recorded boolean:=false;
begin
 if p_member is null or p_actor is null or p_appointment is null or p_notice is null or p_command is null or p_revision is null or p_revision<0
 or coalesce(length(p_engine),0)not between 1 and 100 or public._real_scheduling_email(p_sender)is null or coalesce(length(p_template),0)not between 1 and 200 then
  raise invalid_parameter_value using message='Invalid scheduling retry';
 end if;
 perform public._booking_assert_actor(p_member,p_actor);
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role in('admin','doctor','nurse')and active and removed_at is null)then
  raise insufficient_privilege using message='Active assigned staff required';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('booking-notice-retry:'||p_command::text,0));
 -- This is a publication/dispatch reader, not a measurement source writer.
 -- Lock staff/clinic sources and the case before rechecking current authority.
 perform public.lock_patient_clinical_sources(p_member);
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 if not found then raise insufficient_privilege using message='Assigned case required';end if;
 perform public._booking_assert_actor(p_member,p_actor);
 if not exists(select 1 from public.workspace_staff where user_id=p_actor and role in('admin','doctor','nurse')and active and removed_at is null)then
  raise insufficient_privilege using message='Active assigned staff required';
 end if;
 canonical:=jsonb_build_object('appointmentId',p_appointment,'revision',p_revision,'noticeId',p_notice,'engine',p_engine,'sender',p_sender,'template',p_template);
 select * into prior from public.booking_notice_retry_commands where id=p_command;
 if found then
  if prior.member_id<>p_member or prior.actor_id<>p_actor then raise insufficient_privilege using message='Original retry operator required';end if;
  if prior.input<>canonical then raise invalid_parameter_value using message='Retry command identity already used';end if;
  if prior.attempt_id is not null then
   select t.generation,t.receipt is not null into generation,recorded from public.booking_notice_attempts t where t.id=prior.attempt_id and t.notice_id=p_notice;
  end if;
  -- A replay can recover a durable receipt, never a second send envelope.
  return jsonb_build_object('noticeId',p_notice,'attemptId',prior.attempt_id,'generation',generation,'envelope',null,'receiptRecorded',coalesce(recorded,false));
 end if;
 select * into a from public.booking_appointments where id=p_appointment for update nowait;
 if not found or a.member_id<>p_member then raise insufficient_privilege using message='Appointment unavailable';end if;
 select * into n from public.booking_scheduling_notices where id=p_notice and appointment_id=a.id;
 if not found or a.notice_id<>p_notice or a.revision<>p_revision or n.appointment_revision<>p_revision or a.status<>'failed'or n.state<>'failed'then
  raise serialization_failure using message='Only a current definite failure can be retried';
 end if;
 generation:=n.generation+1;
 envelope:=public.claim_booking_notice(p_notice,p_command,generation,clock_timestamp()+interval '5 minutes',p_engine,p_sender,p_template);
 if envelope is not null then attempt:=p_command;else generation:=null;end if;
 insert into public.booking_notice_retry_commands(id,member_id,actor_id,notice_id,input,attempt_id)
 values(p_command,p_member,p_actor,p_notice,canonical,attempt);
 return jsonb_build_object('noticeId',p_notice,'attemptId',attempt,'generation',generation,'envelope',envelope,'receiptRecorded',false);
end$$;
revoke all on function public.retry_booking_notice(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.retry_booking_notice(uuid,uuid,uuid,bigint,uuid,uuid,text,text,text)to service_role;
