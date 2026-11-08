-- Operational preferences and attributed provider statements never create clinical orders/results.
create table public.patient_test_requests(
 id uuid primary key,user_id uuid not null references public.patient_clinical_cases(user_id),
 revision bigint not null default 0,status text not null default 'requested' check(status in ('requested','provider-proposed','confirmed','change-pending','cancelled')),
 requested_terms jsonb not null,requirements jsonb not null,algorithm_version text not null,context_token text not null,
 create_payload jsonb not null,proposal jsonb,current_arrangement jsonb,pending_change jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index patient_test_requests_owner on public.patient_test_requests(user_id,created_at);
alter table public.patient_test_requests enable row level security;
revoke all on public.patient_test_requests from public,anon,authenticated,service_role;
grant select on public.patient_test_requests to authenticated;
create policy member_own_test_requests on public.patient_test_requests for select to authenticated using(user_id=(select auth.uid()));
create table public.patient_test_request_events(
 request_id uuid not null references public.patient_test_requests(id),command_id uuid not null,
 actor_id uuid not null references auth.users(id),revision bigint not null,operation text not null,
 payload jsonb not null,result jsonb not null,created_at timestamptz not null default now(),primary key(request_id,command_id)
);
alter table public.patient_test_request_events enable row level security;
revoke all on public.patient_test_request_events from public,anon,authenticated,service_role;

create function public.patient_test_context(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('token',md5(((e->'data')-'reports')::text),'data',e->'data') from (select public.patient_clinical_evidence(p_user_id) e) s
$$;
create function public.patient_test_request_dto(p_row public.patient_test_requests) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',p_row.id,'revision',p_row.revision,'status',p_row.status,
 'requestedTerms',p_row.requested_terms,'requirements',p_row.requirements,'algorithmVersion',p_row.algorithm_version,
 'contextToken',p_row.context_token,'contextStale',p_row.context_token is distinct from public.patient_test_context(p_row.user_id)->>'token',
 'proposal',p_row.proposal,'currentArrangement',p_row.current_arrangement,'pendingChange',p_row.pending_change,'createdAt',p_row.created_at)
$$;
create function public.patient_test_booking_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from auth.users where id=auth.uid() and phone_confirmed_at is not null) then raise insufficient_privilege using message='Verified member required';end if;
 return public.patient_test_context(auth.uid());
end $$;
create function public.patient_test_booking_requests(p_user_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=coalesce(p_user_id,auth.uid());
begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 if owner_id<>auth.uid() and not(coalesce(public.real_clinical_staff_identity()->>'role'='admin',false) or public.staff_care_access(owner_id,auth.uid(),true)) then raise insufficient_privilege using message='Assigned operations access required';end if;
 return (select coalesce(jsonb_agg(public.patient_test_request_dto(r) order by r.created_at desc),'[]') from public.patient_test_requests r where r.user_id=owner_id);
end $$;
create function public.valid_patient_test_terms(p_terms jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare start_at timestamptz;end_at timestamptz;
begin
 if jsonb_typeof(p_terms) is distinct from 'object' or p_terms->>'timezone' is distinct from 'Asia/Yerevan' or coalesce(p_terms->>'mode','') not in ('clinic','home') or coalesce(length(btrim(p_terms->>'location')),0) not between 3 and 1000 then return false;end if;
 start_at:=(p_terms->>'startsAt')::timestamptz;end_at:=(p_terms->>'endsAt')::timestamptz;
 return coalesce(isfinite(start_at) and isfinite(end_at) and end_at>start_at and end_at-start_at<=interval '1 day',false);
exception when others then return false;
end $$;
create function public.valid_patient_provider_source(p_input jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare obtained timestamptz;
begin
 obtained:=(p_input->>'obtainedAt')::timestamptz;
 return coalesce(jsonb_typeof(p_input)='object' and isfinite(obtained) and obtained<=now()+interval '5 minutes'
 and p_input->>'channel' in ('phone','email','portal','in-person') and length(btrim(p_input->>'source')) between 3 and 1000,false);
exception when others then return false;
end $$;

-- Service writer receives requirements only from the server's existing clinical engine.
-- All source protection precedes case, request and event locks, matching publication.
create function public.create_patient_test_request(p_user_id uuid,p_request_id uuid,p_context_token text,p_terms jsonb,p_requirements jsonb,p_algorithm_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;existing public.patient_test_requests;payload jsonb;enrolled uuid;result jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public.lock_patient_clinical_sources(p_user_id);
 context:=public.patient_test_context(p_user_id);
 if context->>'token' is distinct from p_context_token then raise serialization_failure using message='Your questionnaire or profile changed. Reload before requesting.';end if;
 if context#>>'{data,assessment,completed_at}' is null or context#>>'{data,assessment,urgent_rule}' is not null or context#>'{data,consent}' is null or context#>'{data,consent}'='null'::jsonb then raise insufficient_privilege using message='Complete your questionnaire and current consent first';end if;
 if nullif(btrim(context#>>'{data,profile,name}'),'') is null or context#>>'{data,profile,birthDate}' is null or coalesce(context#>>'{data,profile,biologicalSex}','') not in ('male','female') then raise insufficient_privilege using message='Complete your member profile first';end if;
 if not public.valid_patient_test_terms(p_terms) or p_request_id is null or coalesce(length(p_algorithm_version),0) not between 1 and 100 or jsonb_typeof(p_requirements) is distinct from 'array' then raise exception 'Invalid test request';end if;
 if jsonb_array_length(p_requirements) not between 1 and 50 or exists(select 1 from jsonb_array_elements(p_requirements) r where coalesce(r->>'method','') not in ('lab','clinic') or coalesce(length(r->>'id'),0) not between 1 and 100 or coalesce(length(r->>'title'),0) not between 1 and 500) or (select count(*)<>count(distinct r->>'id') from jsonb_array_elements(p_requirements) r) then raise exception 'Invalid trusted requirements';end if;
 payload:=jsonb_build_object('contextToken',p_context_token,'terms',p_terms,'requirements',p_requirements,'algorithmVersion',p_algorithm_version);
 -- Serialize first enrollment without holding request rows; a conflict rolls back enrollment too.
 insert into public.patient_clinical_cases(user_id) values(p_user_id) on conflict do nothing returning user_id into enrolled;
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 select * into existing from public.patient_test_requests where id=p_request_id for update nowait;
 if found then
  if existing.user_id<>p_user_id or existing.create_payload<>payload then raise serialization_failure using message='Request identity was already used with different details';end if;
  return public.patient_test_request_dto(existing);
 end if;
 if (p_terms->>'startsAt')::timestamptz<=now() then raise exception 'Choose a future preferred time';end if;
 if enrolled is not null then insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id) values(p_user_id,0,'enrolled',p_user_id);end if;
 insert into public.patient_test_requests(id,user_id,requested_terms,requirements,algorithm_version,context_token,create_payload)
 values(p_request_id,p_user_id,p_terms,p_requirements,p_algorithm_version,p_context_token,payload) returning * into existing;
 result:=public.patient_test_request_dto(existing);
 insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result) values(p_request_id,p_request_id,p_user_id,0,'create',payload,result);
 return result;
end $$;

create function public.command_patient_test_request(p_user_id uuid,p_actor uuid,p_staff boolean,p_id uuid,p_revision bigint,p_command_id uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.patient_test_requests;e public.patient_test_request_events;result jsonb;payload jsonb;staff jsonb;arrangement jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public.lock_patient_clinical_sources(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if not found then raise insufficient_privilege using message='Request unavailable';end if;
 if p_staff then
  if not exists(select 1 from public.workspace_staff s where s.user_id=p_actor and s.active and (s.role='admin' or public.staff_care_access(p_user_id,p_actor,true))) then raise insufficient_privilege using message='Active assigned operations access required';end if;
 elsif p_actor is distinct from p_user_id then raise insufficient_privilege;end if;
 select * into r from public.patient_test_requests where id=p_id and user_id=p_user_id for update nowait;
 if not found then raise insufficient_privilege using message='Request unavailable';end if;
 if p_command_id is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>16000 then raise exception 'Invalid command';end if;
 payload:=jsonb_build_object('operation',p_operation,'input',p_input,'revision',p_revision,'staff',p_staff);
 select * into e from public.patient_test_request_events where request_id=p_id and command_id=p_command_id;
 if found then
  if e.actor_id is distinct from p_actor or e.payload is distinct from payload then raise serialization_failure using message='Command identity was already used with different details';end if;
  return e.result;
 end if;
 if r.revision is distinct from p_revision then raise serialization_failure using message='This request changed. Reload before continuing';end if;
 if p_operation in ('confirm','accept') and r.context_token is distinct from public.patient_test_context(p_user_id)->>'token' then raise serialization_failure using message='Test requirements changed. Keep the existing provider time and arrange a new review';end if;
 if p_staff and p_operation='confirm' then
  if r.status not in ('requested','provider-proposed','confirmed','change-pending') or (r.status='change-pending' and r.pending_change->>'kind'='cancel') then raise exception 'Resolve the pending cancellation first';end if;
  if not public.valid_patient_test_terms(p_input->'terms') or not public.valid_patient_provider_source(p_input) or coalesce(length(btrim(p_input->>'provider')),0) not between 2 and 300 or coalesce(length(btrim(p_input->>'preparation')),0) not between 3 and 8000 or (p_input#>>'{terms,startsAt}')::timestamptz<=now() then raise exception 'Record complete actual provider terms, source and preparation';end if;
  if r.current_arrangement is not null and (r.current_arrangement#>>'{terms,startsAt}')::timestamptz<=now() then raise exception 'Past provider arrangements require operational follow-up';end if;
  if coalesce(r.current_arrangement,r.proposal) is not null and (p_input->>'replacesExisting' is distinct from 'true' or p_input->>'provider' is distinct from coalesce(r.current_arrangement,r.proposal)->>'provider') then raise exception 'The same provider must confirm replacement of the existing arrangement. Cancel separately before changing provider';end if;
  select jsonb_build_object('recordedBy',display_name,'recordedAt',now()) into staff from public.workspace_staff where user_id=p_actor;
  arrangement:=jsonb_build_object('provider',p_input->'provider','terms',p_input->'terms','obtainedAt',p_input->'obtainedAt','channel',p_input->'channel','source',p_input->'source','preparation',p_input->'preparation','replacesExisting',coalesce(p_input->'replacesExisting','false'::jsonb))||staff;
  -- Every new/corrected proposal requires explicit acceptance, also covering preparation corrections.
  r.proposal:=arrangement;r.status:='provider-proposed';
 elsif not p_staff and p_operation='accept' then
  if r.status<>'provider-proposed' or r.proposal is null or (r.proposal#>>'{terms,startsAt}')::timestamptz<=now() then raise exception 'No current future provider proposal to accept';end if;
  r.current_arrangement:=r.proposal;r.proposal:=null;r.pending_change:=null;r.status:='confirmed';
 elsif not p_staff and p_operation in ('cancel','request-change') then
  if r.status='cancelled' then raise exception 'This request is already cancelled';end if;
  if p_operation='request-change' and (not public.valid_patient_test_terms(p_input->'terms') or (p_input#>>'{terms,startsAt}')::timestamptz<=now()) then raise exception 'Choose valid future preferred terms';end if;
  if r.current_arrangement is null and r.proposal is null then
   if p_operation='request-change' then raise exception 'Cancel this unconfirmed request and send a new preference';end if;
   r.status:='cancelled';r.pending_change:=null;
  else
   r.pending_change:=case when p_operation='cancel' then jsonb_build_object('kind','cancel') else jsonb_build_object('kind','reschedule','terms',p_input->'terms') end;
   r.status:='change-pending';
  end if;
 elsif p_staff and p_operation='change-outcome' then
  if r.status<>'change-pending' or r.pending_change is null or not public.valid_patient_provider_source(p_input) or coalesce(p_input->>'outcome','') not in ('accepted','declined') then raise exception 'Record the actual provider response to the pending change';end if;
  if p_input->>'outcome'='accepted' and r.pending_change->>'kind'='reschedule' then raise exception 'Record complete replacement provider terms and preparation for member acceptance';end if;
  if p_input->>'outcome'='accepted' then r.status:='cancelled';r.current_arrangement:=null;r.proposal:=null;
  else r.status:=case when r.proposal is not null then 'provider-proposed' when r.current_arrangement is not null then 'confirmed' else 'requested' end;end if;
  r.pending_change:=null;
 else raise insufficient_privilege using message='Command unavailable';end if;
 update public.patient_test_requests set revision=revision+1,status=r.status,proposal=r.proposal,current_arrangement=r.current_arrangement,pending_change=r.pending_change,updated_at=now() where id=r.id returning * into r;
 result:=public.patient_test_request_dto(r);
 insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result) values(r.id,p_command_id,p_actor,r.revision,p_operation,payload,result);
 return result;
end $$;
create function public.staff_patient_test_command(p_id uuid,p_revision bigint,p_command_id uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare uid uuid;
begin
 select user_id into uid from public.patient_test_requests where id=p_id;
 if uid is null then raise insufficient_privilege using message='Request unavailable';end if;
 return public.command_patient_test_request(uid,auth.uid(),true,p_id,p_revision,p_command_id,p_operation,p_input);
end $$;
revoke all on function public.patient_test_context(uuid),public.patient_test_request_dto(public.patient_test_requests),public.valid_patient_test_terms(jsonb),public.valid_patient_provider_source(jsonb),public.create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text),public.command_patient_test_request(uuid,uuid,boolean,uuid,bigint,uuid,text,jsonb),public.patient_test_booking_context(),public.patient_test_booking_requests(uuid),public.staff_patient_test_command(uuid,bigint,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.patient_test_booking_context(),public.patient_test_booking_requests(uuid),public.staff_patient_test_command(uuid,bigint,uuid,text,jsonb) to authenticated;
grant execute on function public.create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text),public.command_patient_test_request(uuid,uuid,boolean,uuid,bigint,uuid,text,jsonb) to service_role;
