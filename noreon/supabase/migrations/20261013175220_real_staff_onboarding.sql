-- Primary-project administration. Auth and mail calls remain server-side; pending
-- memberships have no clinical authority until the guarded completion step.
create table public.real_staff_invitations (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check (email=lower(btrim(email)) and length(email) between 3 and 320 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 display_name text not null check (length(btrim(display_name)) between 1 and 160),
 clinic_id uuid not null references public.workspace_clinics(id),
 issuer_id uuid not null references public.workspace_staff(user_id),
 expected_auth_user_id uuid not null unique default gen_random_uuid(),
 auth_user_id uuid unique references auth.users(id),
 generation bigint not null default 1 check (generation>0),
 operation_id uuid not null unique default gen_random_uuid(),
 status text not null default 'pending' check (status in ('pending','verified','accepted','revoked')),
 send_status text not null default 'pending' check (send_status in ('pending','accepted','failed','unknown')),
 created_at timestamptz not null default clock_timestamp(),
 last_requested_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '1 hour'),
 dispatch_claimed_at timestamptz,
 token_digest text check (token_digest ~ '^[a-f0-9]{64}$'),
 token_type text check (token_type in ('invite','recovery')),
 provider_reference text check (length(provider_reference) between 1 and 512),
 verified_at timestamptz,
 accepted_at timestamptz,
 check (auth_user_id is null or auth_user_id=expected_auth_user_id),
 check ((token_digest is null)=(token_type is null)),
 check (token_digest is null or auth_user_id is not null),
 check ((status='accepted')=(accepted_at is not null)),
 check (status not in ('verified','accepted') or verified_at is not null)
);
alter table public.real_staff_invitations enable row level security;
revoke all on public.real_staff_invitations from public,anon,authenticated,service_role;

create table public.real_staff_admin_events (
 id bigint generated always as identity primary key,
 invitation_id uuid references public.real_staff_invitations(id),
 clinic_id uuid references public.workspace_clinics(id),
 actor_id uuid references auth.users(id),
 generation bigint,
 request_id uuid unique,
 kind text not null check (kind in ('clinic_created','invitation_reserved','invitation_reissued','dispatch_claimed','identity_bound','token_prepared','submission_accepted','submission_failed','submission_unknown','invitation_verified','invitation_accepted')),
 details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object' and octet_length(details::text)<=1024),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.real_staff_admin_events enable row level security;
revoke all on public.real_staff_admin_events from public,anon,authenticated,service_role;
revoke all on sequence public.real_staff_admin_events_id_seq from public,anon,authenticated,service_role;

-- Internal helpers are not Data API entry points. Caller functions run as owner.
create function public._real_staff_require_admin() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 perform 1 from public.workspace_staff where user_id=actor and role='admin' and active for share;
 if not found then raise insufficient_privilege using message='Active administrator required';end if;
 return actor;
end $$;
create function public._real_staff_invitation_json(i public.real_staff_invitations) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',i.id,'generation',i.generation,'operationId',i.operation_id,
 'expectedAuthUserId',i.expected_auth_user_id,'authUserId',i.auth_user_id,'email',i.email,'name',i.display_name,
 'clinicId',i.clinic_id,'issuerId',i.issuer_id,'status',i.status,'sendStatus',i.send_status,'expiresAt',i.expires_at,
 'tokenDigest',i.token_digest,'tokenType',i.token_type,'dispatchClaimedAt',i.dispatch_claimed_at)
$$;
create function public._real_staff_lock_invitation(p_id uuid,p_generation bigint,p_allow_accepted boolean default false) returns public.real_staff_invitations
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 select * into i from public.real_staff_invitations where id=p_id for update;
 if not found then raise insufficient_privilege using message='Invitation unavailable';end if;
 if i.generation is distinct from p_generation then raise serialization_failure using message='Invitation changed';end if;
 if i.status='accepted' and p_allow_accepted then return i;end if;
 if i.status not in ('pending','verified') or i.expires_at<=clock_timestamp() then raise insufficient_privilege using message='Invitation unavailable';end if;
 perform 1 from public.workspace_staff where user_id=i.issuer_id and role='admin' and active for share;
 if not found then raise insufficient_privilege using message='Issuing administrator unavailable';end if;
 perform 1 from public.workspace_clinics where id=i.clinic_id and active for share;
 if not found then raise insufficient_privilege using message='Active clinic required';end if;
 return i;
end $$;
create function public._real_staff_dispatch_invitation(p_id uuid,p_generation bigint,p_operation_id uuid) returns public.real_staff_invitations
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 i:=public._real_staff_lock_invitation(p_id,p_generation);
 if i.operation_id is distinct from p_operation_id then raise serialization_failure using message='Invitation operation changed';end if;
 if i.status<>'pending' or i.dispatch_claimed_at is null or i.dispatch_claimed_at+interval '2 minutes'<=clock_timestamp() then raise insufficient_privilege using message='Dispatch claim unavailable';end if;
 return i;
end $$;

create function public.real_admin_clinics() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public._real_staff_require_admin();
 return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'active',active) order by name,id),'[]') from public.workspace_clinics);
end $$;
create function public.real_admin_doctors() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public._real_staff_require_admin();
 return (select coalesce(jsonb_agg(d.row_data order by d.name,d.id),'[]') from (
 select s.user_id id,s.display_name name,jsonb_build_object('id',s.user_id,'name',s.display_name,'email',u.email,'clinicId',s.clinic_id,'clinicName',c.name,'active',s.active,
 'invitationId',i.id,'generation',i.generation,'status',case when i.status in ('pending','verified') and i.expires_at<=clock_timestamp() then 'expired' when i.id is not null then i.status when s.active then 'active' else 'inactive' end,
 'sendStatus',i.send_status,'expiresAt',i.expires_at) row_data
 from public.workspace_staff s join auth.users u on u.id=s.user_id join public.workspace_clinics c on c.id=s.clinic_id
 left join public.real_staff_invitations i on i.auth_user_id=s.user_id where s.role='doctor'
 union all
 select i.expected_auth_user_id,i.display_name,jsonb_build_object('id',i.expected_auth_user_id,'name',i.display_name,'email',i.email,'clinicId',i.clinic_id,'clinicName',c.name,'active',false,
 'invitationId',i.id,'generation',i.generation,'status',case when i.expires_at<=clock_timestamp() and i.status in ('pending','verified') then 'expired' else i.status end,'sendStatus',i.send_status,'expiresAt',i.expires_at)
 from public.real_staff_invitations i join public.workspace_clinics c on c.id=i.clinic_id where i.auth_user_id is null
 )d);
end $$;
create function public.real_admin_create_clinic(p_name text,p_address text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public._real_staff_require_admin();c public.workspace_clinics;
begin
 if p_name is null or length(btrim(p_name)) not between 1 and 160 or p_address is null or length(btrim(p_address))>1000 then raise invalid_parameter_value using message='Check clinic details';end if;
 insert into public.workspace_clinics(name,address,active) values(btrim(p_name),btrim(p_address),true) returning * into c;
 insert into public.real_staff_admin_events(clinic_id,actor_id,kind) values(c.id,actor,'clinic_created');
 return jsonb_build_object('id',c.id,'name',c.name,'address',c.address,'active',c.active);
end $$;
create function public.real_admin_reserve_doctor_invitation(p_request_id uuid,p_email text,p_display_name text,p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public._real_staff_require_admin();email_value text:=lower(btrim(p_email));i public.real_staff_invitations;e public.real_staff_admin_events;
begin
 if p_request_id is null or p_clinic_id is null or email_value is null or length(email_value) not between 3 and 320 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_display_name is null or length(btrim(p_display_name)) not between 1 and 160 then raise invalid_parameter_value using message='Check doctor details';end if;
 perform pg_advisory_xact_lock(hashtextextended('real-staff-request:'||p_request_id::text,0));
 select * into e from public.real_staff_admin_events where request_id=p_request_id;
 if found then
  select * into i from public.real_staff_invitations where id=e.invitation_id for update;
  if e.kind<>'invitation_reserved' or e.actor_id<>actor or i.email<>email_value or i.display_name<>btrim(p_display_name) or i.clinic_id<>p_clinic_id then raise invalid_parameter_value using message='Request identity conflicts';end if;
  if i.generation<>e.generation then raise serialization_failure using message='Invitation changed';end if;
  return public._real_staff_invitation_json(i);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('real-staff-email:'||email_value,0));
 perform 1 from public.workspace_clinics where id=p_clinic_id and active for share;
 if not found then raise insufficient_privilege using message='Active clinic required';end if;
 if exists(select 1 from auth.users where lower(email)=email_value) or exists(select 1 from public.real_staff_invitations where email=email_value) then raise unique_violation using message='Email already has an account or invitation';end if;
 insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id) values(email_value,btrim(p_display_name),p_clinic_id,actor) returning * into i;
 insert into public.real_staff_admin_events(invitation_id,clinic_id,actor_id,generation,request_id,kind) values(i.id,i.clinic_id,actor,i.generation,p_request_id,'invitation_reserved');
 return public._real_staff_invitation_json(i);
end $$;
create function public.real_admin_reissue_doctor_invitation(p_invitation_id uuid,p_expected_generation bigint,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public._real_staff_require_admin();i public.real_staff_invitations;e public.real_staff_admin_events;
begin
 if p_request_id is null or p_invitation_id is null or p_expected_generation is null then raise invalid_parameter_value using message='Check invitation details';end if;
 perform pg_advisory_xact_lock(hashtextextended('real-staff-request:'||p_request_id::text,0));
 select * into i from public.real_staff_invitations where id=p_invitation_id for update;
 if not found then raise insufficient_privilege using message='Invitation unavailable';end if;
 select * into e from public.real_staff_admin_events where request_id=p_request_id;
 if found then
  if e.kind<>'invitation_reissued' or e.actor_id<>actor or e.invitation_id<>i.id or e.generation<>p_expected_generation+1 then raise invalid_parameter_value using message='Request identity conflicts';end if;
  if i.generation<>e.generation then raise serialization_failure using message='Invitation changed';end if;
  return public._real_staff_invitation_json(i);
 end if;
 if i.generation is distinct from p_expected_generation then raise serialization_failure using message='Invitation changed';end if;
 if i.status not in ('pending','verified') then raise insufficient_privilege using message='Invitation cannot be reissued';end if;
 if i.last_requested_at+interval '60 seconds'>clock_timestamp() or (i.dispatch_claimed_at is not null and i.dispatch_claimed_at+interval '2 minutes'>clock_timestamp()) then raise serialization_failure using message='Invitation dispatch is in progress or cooling down';end if;
 perform 1 from public.workspace_clinics where id=i.clinic_id and active for share;
 if not found then raise insufficient_privilege using message='Active clinic required';end if;
 -- A new active admin may explicitly reissue, becoming responsible for the new generation.
 update public.real_staff_invitations set generation=generation+1,operation_id=gen_random_uuid(),issuer_id=actor,status='pending',send_status='pending',last_requested_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 hour',dispatch_claimed_at=null,token_digest=null,token_type=null,provider_reference=null,verified_at=null where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,clinic_id,actor_id,generation,request_id,kind) values(i.id,i.clinic_id,actor,i.generation,p_request_id,'invitation_reissued');
 return public._real_staff_invitation_json(i);
end $$;

create function public.real_staff_invitation_context(p_invitation_id uuid,p_generation bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin i:=public._real_staff_lock_invitation(p_invitation_id,p_generation,true);return public._real_staff_invitation_json(i);end $$;
create function public.real_staff_claim_invitation_dispatch(p_invitation_id uuid,p_generation bigint,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 i:=public._real_staff_lock_invitation(p_invitation_id,p_generation);
 if i.operation_id is distinct from p_operation_id then raise serialization_failure using message='Invitation operation changed';end if;
 if i.status<>'pending' then raise insufficient_privilege using message='Invitation dispatch unavailable';end if;
 if i.dispatch_claimed_at is not null then return public._real_staff_invitation_json(i)||jsonb_build_object('claimed',false);end if;
 update public.real_staff_invitations set dispatch_claimed_at=clock_timestamp() where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.issuer_id,i.generation,'dispatch_claimed');
 return public._real_staff_invitation_json(i)||jsonb_build_object('claimed',true);
end $$;
create function public.real_staff_bind_invitation_identity(p_invitation_id uuid,p_generation bigint,p_operation_id uuid,p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;s public.workspace_staff;
begin
 i:=public._real_staff_dispatch_invitation(p_invitation_id,p_generation,p_operation_id);
 if p_auth_user_id is distinct from i.expected_auth_user_id then raise insufficient_privilege using message='Reserved identity required';end if;
 perform 1 from auth.users where id=p_auth_user_id and lower(email)=i.email for share;
 if not found then raise insufficient_privilege using message='Reserved identity unavailable';end if;
 select * into s from public.workspace_staff where user_id=p_auth_user_id for update;
 if found then
  if i.auth_user_id is null or s.role<>'doctor' or s.clinic_id<>i.clinic_id or s.active then raise insufficient_privilege using message='Existing membership cannot be replaced';end if;
 else
  if i.auth_user_id is not null then raise insufficient_privilege using message='Invited membership unavailable';end if;
  insert into public.workspace_staff(user_id,role,display_name,clinic_id,active) values(p_auth_user_id,'doctor',i.display_name,i.clinic_id,false);
 end if;
 if i.auth_user_id is null then
  update public.real_staff_invitations set auth_user_id=p_auth_user_id where id=i.id returning * into i;
  insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.issuer_id,i.generation,'identity_bound');
 end if;
 return public._real_staff_invitation_json(i);
end $$;
create function public.real_staff_store_invitation_token(p_invitation_id uuid,p_generation bigint,p_operation_id uuid,p_token_digest text,p_token_type text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 if p_token_digest is null or p_token_digest !~ '^[a-f0-9]{64}$' or p_token_type is null or p_token_type not in ('invite','recovery') then raise invalid_parameter_value using message='Invalid invitation token digest';end if;
 i:=public._real_staff_dispatch_invitation(p_invitation_id,p_generation,p_operation_id);
 if i.auth_user_id is null then raise insufficient_privilege using message='Bound identity required';end if;
 if i.token_digest is not null then
  if i.token_digest<>p_token_digest or i.token_type<>p_token_type then raise serialization_failure using message='Invitation token already prepared';end if;
  return public._real_staff_invitation_json(i);
 end if;
 update public.real_staff_invitations set token_digest=p_token_digest,token_type=p_token_type where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.issuer_id,i.generation,'token_prepared');
 return public._real_staff_invitation_json(i);
end $$;
create function public.real_staff_record_invitation_submission(p_invitation_id uuid,p_generation bigint,p_operation_id uuid,p_outcome text,p_provider_reference text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 if p_outcome is null or p_outcome not in ('accepted','failed','unknown') or (p_provider_reference is not null and length(p_provider_reference) not between 1 and 512) then raise invalid_parameter_value using message='Invalid submission outcome';end if;
 i:=public._real_staff_dispatch_invitation(p_invitation_id,p_generation,p_operation_id);
 if p_outcome='accepted' and i.token_digest is null then raise insufficient_privilege using message='Prepared invitation required';end if;
 if i.send_status<>'pending' then
  if i.send_status<>p_outcome or i.provider_reference is distinct from p_provider_reference then raise serialization_failure using message='Submission outcome already recorded';end if;
  return public._real_staff_invitation_json(i);
 end if;
 update public.real_staff_invitations set send_status=p_outcome,provider_reference=p_provider_reference where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.issuer_id,i.generation,'submission_'||p_outcome);
 return public._real_staff_invitation_json(i);
end $$;
create function public.real_staff_record_invitation_verification(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 i:=public._real_staff_lock_invitation(p_invitation_id,p_generation);
 if i.auth_user_id is null or i.auth_user_id is distinct from p_auth_user_id or i.token_digest is null then raise insufficient_privilege using message='Invited identity required';end if;
 perform 1 from auth.users where id=i.auth_user_id and lower(email)=i.email and email_confirmed_at is not null for share;
 if not found then raise insufficient_privilege using message='Verified invited identity required';end if;
 perform 1 from public.workspace_staff where user_id=i.auth_user_id and role='doctor' and clinic_id=i.clinic_id and not active for share;
 if not found then raise insufficient_privilege using message='Pending doctor required';end if;
 if i.status='pending' then
  update public.real_staff_invitations set status='verified',verified_at=clock_timestamp() where id=i.id returning * into i;
  insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.auth_user_id,i.generation,'invitation_verified');
 end if;
 return public._real_staff_invitation_json(i);
end $$;
create function public.real_staff_finalize_doctor_invitation(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 i:=public._real_staff_lock_invitation(p_invitation_id,p_generation,true);
 if i.auth_user_id is null or i.auth_user_id is distinct from p_auth_user_id then raise insufficient_privilege using message='Invited identity required';end if;
 -- Server verifies its purpose-bound password_set proof plus current Auth user.
 -- This idempotent branch MUST NOT write workspace_staff, including after disable.
 if i.status='accepted' then return public._real_staff_invitation_json(i);end if;
 if i.status<>'verified' then raise insufficient_privilege using message='Verified invitation required';end if;
 perform 1 from auth.users where id=i.auth_user_id and lower(email)=i.email and email_confirmed_at is not null for share;
 if not found then raise insufficient_privilege using message='Verified invited identity required';end if;
 perform 1 from public.workspace_staff where user_id=i.auth_user_id and role='doctor' and clinic_id=i.clinic_id and not active for update;
 if not found then raise insufficient_privilege using message='Pending doctor required';end if;
 update public.workspace_staff set active=true where user_id=i.auth_user_id;
 update public.real_staff_invitations set status='accepted',accepted_at=clock_timestamp() where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.auth_user_id,i.generation,'invitation_accepted');
 return public._real_staff_invitation_json(i);
end $$;

revoke all on function public._real_staff_require_admin(),public._real_staff_invitation_json(public.real_staff_invitations),public._real_staff_lock_invitation(uuid,bigint,boolean),public._real_staff_dispatch_invitation(uuid,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.real_admin_clinics(),public.real_admin_doctors(),public.real_admin_create_clinic(text,text),public.real_admin_reserve_doctor_invitation(uuid,text,text,uuid),public.real_admin_reissue_doctor_invitation(uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.real_admin_clinics(),public.real_admin_doctors(),public.real_admin_create_clinic(text,text),public.real_admin_reserve_doctor_invitation(uuid,text,text,uuid),public.real_admin_reissue_doctor_invitation(uuid,bigint,uuid) to authenticated;
revoke all on function public.real_staff_invitation_context(uuid,bigint),public.real_staff_claim_invitation_dispatch(uuid,bigint,uuid),public.real_staff_bind_invitation_identity(uuid,bigint,uuid,uuid),public.real_staff_store_invitation_token(uuid,bigint,uuid,text,text),public.real_staff_record_invitation_submission(uuid,bigint,uuid,text,text),public.real_staff_record_invitation_verification(uuid,bigint,uuid),public.real_staff_finalize_doctor_invitation(uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.real_staff_invitation_context(uuid,bigint),public.real_staff_claim_invitation_dispatch(uuid,bigint,uuid),public.real_staff_bind_invitation_identity(uuid,bigint,uuid,uuid),public.real_staff_store_invitation_token(uuid,bigint,uuid,text,text),public.real_staff_record_invitation_submission(uuid,bigint,uuid,text,text),public.real_staff_record_invitation_verification(uuid,bigint,uuid),public.real_staff_finalize_doctor_invitation(uuid,bigint,uuid) to service_role;
