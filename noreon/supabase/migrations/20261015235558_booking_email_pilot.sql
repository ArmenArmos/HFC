-- Private trusted-program authority and explicit legacy creation cutover.
-- The clinical engine remains server-side TypeScript. A source hash is freshness,
-- not authority for a browser-supplied test list.
create table public.booking_program_seals(
 id uuid primary key,member_id uuid not null references auth.users(id),actor_id uuid not null references auth.users(id),
 source_token text not null,requirements_token text not null,engine_version text not null,program jsonb not null,
 created_at timestamptz not null default clock_timestamp(),check(jsonb_typeof(program)='object' and octet_length(program::text)<=100000)
);
alter table public.booking_program_seals enable row level security;
revoke all on public.booking_program_seals from public,anon,authenticated,service_role;

-- Appointment FK is added with the appointment schema in the next migration.
create table public.booking_legacy_conversions(
 legacy_id uuid primary key references public.patient_test_requests(id),appointment_id uuid not null unique,
 actor_id uuid not null references auth.users(id),agreement_source text not null check(length(btrim(agreement_source)) between 3 and 1000),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.booking_legacy_conversions enable row level security;
revoke all on public.booking_legacy_conversions from public,anon,authenticated,service_role;

create function public._booking_assert_actor(p_member uuid,p_actor uuid) returns void
language plpgsql stable security definer set search_path='' as $$begin
 if p_member is null or p_actor is null or not exists(select 1 from auth.users where id=p_member and phone is not null and phone_confirmed_at is not null)then
  raise insufficient_privilege using message='Verified member required';
 end if;
 if p_actor=p_member then return;end if;
 if not exists(select 1 from public.patient_clinical_cases where user_id=p_member)
 or not exists(select 1 from public.workspace_staff s where s.user_id=p_actor and s.active and s.removed_at is null
 and public._real_staff_managed_session_allowed(p_actor)
 and(s.role='admin' or public.staff_care_access(p_member,p_actor,true)))then
  raise insufficient_privilege using message='Current assigned operations access required';
 end if;
end $$;
revoke all on function public._booking_assert_actor(uuid,uuid) from public,anon,authenticated,service_role;

create function public.booking_program_source(p_member uuid,p_actor uuid)returns jsonb
language plpgsql stable security definer set search_path='' as $$begin
 perform public._booking_assert_actor(p_member,p_actor);
 return public.patient_test_context(p_member);
end $$;
revoke all on function public.booking_program_source(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.booking_program_source(uuid,uuid)to service_role;

create function public.register_booking_program(p_id uuid,p_member uuid,p_actor uuid,p_program jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;prior public.booking_program_seals;
begin
 perform public._booking_assert_actor(p_member,p_actor);
 perform public.lock_patient_clinical_sources(p_member);
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
revoke all on function public.register_booking_program(uuid,uuid,uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.register_booking_program(uuid,uuid,uuid,jsonb)to service_role;

-- Existing historical receipts/behavior remain; every NEW legacy ID is denied,
-- even before a member has any pilot record. No hidden fallback flag or date.
alter function public.create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text)rename to _legacy_create_patient_test_request;
revoke all on function public._legacy_create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text)from public,anon,authenticated,service_role;
create function public.create_patient_test_request(p_user_id uuid,p_request_id uuid,p_context_token text,p_terms jsonb,p_requirements jsonb,p_algorithm_version text)returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.patient_test_requests where id=p_request_id and user_id=p_user_id)
 or exists(select 1 from public.booking_legacy_conversions where legacy_id=p_request_id)then
  raise insufficient_privilege using message='New bookings use the scheduling email pilot; historical creation is replay-only';
 end if;
 return public._legacy_create_patient_test_request(p_user_id,p_request_id,p_context_token,p_terms,p_requirements,p_algorithm_version);
end $$;
revoke all on function public.create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text)from public,anon,authenticated,service_role;
grant execute on function public.create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text)to service_role;

alter function public.command_patient_test_request(uuid,uuid,boolean,uuid,bigint,uuid,text,jsonb)rename to _legacy_command_patient_test_request;
revoke all on function public._legacy_command_patient_test_request(uuid,uuid,boolean,uuid,bigint,uuid,text,jsonb)from public,anon,authenticated,service_role;
create function public.command_patient_test_request(p_user_id uuid,p_actor uuid,p_staff boolean,p_id uuid,p_revision bigint,p_command_id uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform public._booking_assert_actor(p_user_id,p_actor);
 if exists(select 1 from public.booking_legacy_conversions where legacy_id=p_id)then raise insufficient_privilege using message='This request uses the scheduling email pilot';end if;
 return public._legacy_command_patient_test_request(p_user_id,p_actor,p_staff,p_id,p_revision,p_command_id,p_operation,p_input);
end $$;
revoke all on function public.command_patient_test_request(uuid,uuid,boolean,uuid,bigint,uuid,text,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.command_patient_test_request(uuid,uuid,boolean,uuid,bigint,uuid,text,jsonb)to service_role;

alter function public.patient_test_request_dto(public.patient_test_requests)rename to _legacy_patient_test_request_dto;
revoke all on function public._legacy_patient_test_request_dto(public.patient_test_requests)from public,anon,authenticated,service_role;
create function public.patient_test_request_dto(p_row public.patient_test_requests)returns jsonb
language sql stable security definer set search_path='' as $$
 select public._legacy_patient_test_request_dto(p_row)||coalesce((select jsonb_build_object('pilotAppointmentId',appointment_id)from public.booking_legacy_conversions where legacy_id=p_row.id),'{}'::jsonb)
$$;
revoke all on function public.patient_test_request_dto(public.patient_test_requests)from public,anon,authenticated,service_role;
