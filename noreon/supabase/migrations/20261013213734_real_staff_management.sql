-- Staff management retains identities and clinical history. Existing invitations are doctors.
alter table public.real_staff_invitations add column role text not null default 'doctor' check(role in ('doctor','nurse'));
alter table public.real_staff_invitations add column management_revision bigint not null default 1 check(management_revision>0);
alter table public.workspace_staff add column management_revision bigint not null default 1 check(management_revision>0);
alter table public.real_staff_admin_events drop constraint real_staff_admin_events_details_check;
alter table public.real_staff_admin_events add constraint real_staff_admin_events_details_check check(jsonb_typeof(details)='object' and octet_length(details::text)<=4096);
alter table public.real_staff_admin_events drop constraint real_staff_admin_events_kind_check;
alter table public.real_staff_admin_events add constraint real_staff_admin_events_kind_check check(kind in ('clinic_created','invitation_reserved','invitation_reissued','dispatch_claimed','identity_bound','token_prepared','submission_accepted','submission_failed','submission_unknown','invitation_verified','invitation_accepted','staff_updated','staff_removed'));
-- Immutable operation receipts keep retries independent of subsequent directory changes.
create table public.real_staff_management_operations (
 request_id uuid primary key, actor_id uuid not null references auth.users(id),
 operation text not null check(operation in ('update','remove')), input jsonb not null,
 result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.real_staff_management_operations enable row level security;
revoke all on public.real_staff_management_operations from public,anon,authenticated,service_role;
create or replace function public._real_staff_invitation_json(i public.real_staff_invitations) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',i.id,'generation',i.generation,'operationId',i.operation_id,
 'expectedAuthUserId',i.expected_auth_user_id,'authUserId',i.auth_user_id,'email',i.email,'name',i.display_name,
 'role',i.role,'clinicId',i.clinic_id,'issuerId',i.issuer_id,'status',i.status,'sendStatus',i.send_status,'expiresAt',i.expires_at,
 'tokenDigest',i.token_digest,'tokenType',i.token_type,'dispatchClaimedAt',i.dispatch_claimed_at)
$$;
create or replace function public.real_admin_reserve_staff_invitation(p_request_id uuid,p_email text,p_display_name text,p_clinic_id uuid,p_role text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public._real_staff_require_admin();email_value text:=lower(btrim(p_email));i public.real_staff_invitations;e public.real_staff_admin_events;
begin
 if p_role is null or p_role not in ('doctor','nurse') or p_request_id is null or p_clinic_id is null or email_value is null or length(email_value) not between 3 and 320 or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_display_name is null or length(btrim(p_display_name)) not between 1 and 160 then raise invalid_parameter_value using message='Check staff details';end if;
 perform pg_advisory_xact_lock(hashtextextended('real-staff-request:'||p_request_id::text,0));
 select * into e from public.real_staff_admin_events where request_id=p_request_id;
 if found then
  select * into i from public.real_staff_invitations where id=e.invitation_id for update;
  if e.kind<>'invitation_reserved' or e.actor_id<>actor or i.role<>p_role or i.email<>email_value or i.display_name<>btrim(p_display_name) or i.clinic_id<>p_clinic_id then raise invalid_parameter_value using message='Request identity conflicts';end if;
  if i.generation<>e.generation then raise serialization_failure using message='Invitation changed';end if;
  return public._real_staff_invitation_json(i);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('real-staff-email:'||email_value,0));
 perform 1 from public.workspace_clinics where id=p_clinic_id and active for share;
 if not found then raise insufficient_privilege using message='Active clinic required';end if;
 if exists(select 1 from auth.users where lower(email)=email_value) or exists(select 1 from public.real_staff_invitations where email=email_value) then raise unique_violation using message='Email already has an account or invitation';end if;
 insert into public.real_staff_invitations(email,display_name,clinic_id,issuer_id,role) values(email_value,btrim(p_display_name),p_clinic_id,actor,p_role) returning * into i;
 insert into public.real_staff_admin_events(invitation_id,clinic_id,actor_id,generation,request_id,kind) values(i.id,i.clinic_id,actor,i.generation,p_request_id,'invitation_reserved');
 return public._real_staff_invitation_json(i);
end $$;
create or replace function public.real_admin_reissue_staff_invitation(p_invitation_id uuid,p_expected_generation bigint,p_request_id uuid) returns jsonb
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
create or replace function public.real_staff_bind_invitation_identity(p_invitation_id uuid,p_generation bigint,p_operation_id uuid,p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;s public.workspace_staff;
begin
 i:=public._real_staff_dispatch_invitation(p_invitation_id,p_generation,p_operation_id);
 if p_auth_user_id is distinct from i.expected_auth_user_id then raise insufficient_privilege using message='Reserved identity required';end if;
 perform 1 from auth.users where id=p_auth_user_id and lower(email)=i.email for share;
 if not found then raise insufficient_privilege using message='Reserved identity unavailable';end if;
 select * into s from public.workspace_staff where user_id=p_auth_user_id for update;
 if found then
  if i.auth_user_id is null or s.role<>i.role or s.clinic_id<>i.clinic_id or s.active then raise insufficient_privilege using message='Existing membership cannot be replaced';end if;
 else
  if i.auth_user_id is not null then raise insufficient_privilege using message='Invited membership unavailable';end if;
  insert into public.workspace_staff(user_id,role,display_name,clinic_id,active) values(p_auth_user_id,i.role,i.display_name,i.clinic_id,false);
 end if;
 if i.auth_user_id is null then
  update public.real_staff_invitations set auth_user_id=p_auth_user_id where id=i.id returning * into i;
  insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.issuer_id,i.generation,'identity_bound');
 end if;
 return public._real_staff_invitation_json(i);
end $$;
create or replace function public.real_staff_record_invitation_verification(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;
begin
 i:=public._real_staff_lock_invitation(p_invitation_id,p_generation);
 if i.auth_user_id is null or i.auth_user_id is distinct from p_auth_user_id or i.token_digest is null then raise insufficient_privilege using message='Invited identity required';end if;
 perform 1 from auth.users where id=i.auth_user_id and lower(email)=i.email and email_confirmed_at is not null for share;
 if not found then raise insufficient_privilege using message='Verified invited identity required';end if;
 perform 1 from public.workspace_staff where user_id=i.auth_user_id and role=i.role and clinic_id=i.clinic_id and not active for share;
 if not found then raise insufficient_privilege using message='Pending staff required';end if;
 if i.status='pending' then
  update public.real_staff_invitations set status='verified',verified_at=clock_timestamp() where id=i.id returning * into i;
  insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.auth_user_id,i.generation,'invitation_verified');
 end if;
 return public._real_staff_invitation_json(i);
end $$;
create or replace function public.real_staff_finalize_invitation(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid,p_auth_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare i public.real_staff_invitations;session_created_at timestamptz;
begin
 i:=public._real_staff_lock_invitation(p_invitation_id,p_generation,true);
 if i.auth_user_id is null or i.auth_user_id is distinct from p_auth_user_id then raise insufficient_privilege using message='Invited identity required';end if;
 select created_at into session_created_at from auth.sessions where id=p_auth_session_id and user_id=i.auth_user_id
  and (not_after is null or not_after>clock_timestamp()) for share;
 if not found or session_created_at is null then raise insufficient_privilege using message='Live invited session required';end if;
 -- The server derives this session ID from the exact Auth-validated access token
 -- and verifies its matching purpose-bound password_set proof. Never from a form.
 if i.status='accepted' then
  if p_auth_session_id is distinct from i.accepted_session_id and session_created_at<i.accepted_at then raise insufficient_privilege using message='Current doctor session required';end if;
  return public._real_staff_invitation_json(i);
 end if;
 if i.status<>'verified' or session_created_at<i.last_requested_at then raise insufficient_privilege using message='Current verified invitation session required';end if;
 perform 1 from auth.users where id=i.auth_user_id and lower(email)=i.email and email_confirmed_at is not null for share;
 if not found then raise insufficient_privilege using message='Verified invited identity required';end if;
 perform 1 from public.workspace_staff where user_id=i.auth_user_id and role=i.role and clinic_id=i.clinic_id and not active for update;
 if not found then raise insufficient_privilege using message='Pending staff required';end if;
 update public.workspace_staff set active=true where user_id=i.auth_user_id;
 update public.real_staff_invitations set status='accepted',accepted_at=clock_timestamp(),accepted_session_id=p_auth_session_id where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.auth_user_id,i.generation,'invitation_accepted');
 return public._real_staff_invitation_json(i);
end $$;
-- Old public contracts remain doctor-only; no legacy entry can change an invitation role.
create or replace function public.real_admin_reserve_doctor_invitation(p_request_id uuid,p_email text,p_display_name text,p_clinic_id uuid) returns jsonb
language sql security definer set search_path='' as $$select public.real_admin_reserve_staff_invitation(p_request_id,p_email,p_display_name,p_clinic_id,'doctor')$$;
create or replace function public.real_admin_reissue_doctor_invitation(p_invitation_id uuid,p_expected_generation bigint,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public._real_staff_require_admin();
 perform pg_advisory_xact_lock(hashtextextended('real-staff-request:'||p_request_id::text,0));
 perform 1 from public.real_staff_invitations where id=p_invitation_id and role='doctor' for update;
 if not found then raise insufficient_privilege using message='Doctor invitation required';end if;
 return public.real_admin_reissue_staff_invitation(p_invitation_id,p_expected_generation,p_request_id);
end $$;
create or replace function public.real_staff_finalize_doctor_invitation(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid,p_auth_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.real_staff_invitations where id=p_invitation_id and role='doctor' for update;
 if not found then raise insufficient_privilege using message='Doctor invitation required';end if;
 return public.real_staff_finalize_invitation(p_invitation_id,p_generation,p_auth_user_id,p_auth_session_id);
end $$;

create function public._real_staff_directory_row(p_staff_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with entry as (
 select jsonb_build_object('managementRevision',s.management_revision,'id',s.user_id,'name',s.display_name,'email',u.email,'role',s.role,'clinicId',s.clinic_id,'clinicName',c.name,'active',s.active,
 'invitationId',i.id,'generation',i.generation,'status',case when i.status in ('pending','verified') and i.expires_at<=clock_timestamp() then 'expired' when i.id is not null then i.status when s.active then 'active' else 'inactive' end,
 'sendStatus',i.send_status,'expiresAt',i.expires_at) data
 from public.workspace_staff s join auth.users u on u.id=s.user_id join public.workspace_clinics c on c.id=s.clinic_id
 left join public.real_staff_invitations i on i.auth_user_id=s.user_id where s.user_id=p_staff_id and s.role in ('doctor','nurse')
 union all
 select jsonb_build_object('managementRevision',i.management_revision,'id',i.expected_auth_user_id,'name',i.display_name,'email',i.email,'role',i.role,'clinicId',i.clinic_id,'clinicName',c.name,'active',false,
 'invitationId',i.id,'generation',i.generation,'status',case when i.expires_at<=clock_timestamp() and i.status in ('pending','verified') then 'expired' else i.status end,'sendStatus',i.send_status,'expiresAt',i.expires_at)
 from public.real_staff_invitations i join public.workspace_clinics c on c.id=i.clinic_id where i.expected_auth_user_id=p_staff_id and i.auth_user_id is null
 ) select (data-'managementRevision')||jsonb_build_object('version',md5(data::text),'assignmentCount',
 (select count(*) from public.patient_clinical_cases where assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id)+
 (select count(*) from public.workspace_cases where expires_at>clock_timestamp() and (assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id))) from entry
$$;
create function public.real_admin_staff() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public._real_staff_require_admin();
 return (select coalesce(jsonb_agg(row_data order by row_data->>'name',row_data->>'id'),'[]') from (
 select public._real_staff_directory_row(id) row_data from (
 select user_id id from public.workspace_staff where role in ('doctor','nurse')
 union select expected_auth_user_id from public.real_staff_invitations where auth_user_id is null
 ) ids) rows);
end $$;
create or replace function public.real_admin_doctors() returns jsonb
language plpgsql security definer set search_path='' as $$
begin return (select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(public.real_admin_staff()) x where x->>'role'='doctor');end $$;

create function public._real_staff_manage(p_staff_id uuid,p_expected_version text,p_display_name text,p_clinic_id uuid,p_request_id uuid,p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=public._real_staff_require_admin();i public.real_staff_invitations;s public.workspace_staff;receipt public.real_staff_management_operations;
 before_row jsonb;after_row jsonb;input_value jsonb;had_invitation boolean;had_staff boolean;
begin
 if p_staff_id is null or p_request_id is null or p_expected_version is null or length(p_expected_version)<>32 or p_operation not in ('update','remove') then raise invalid_parameter_value using message='Check staff details';end if;
 if p_operation='update' and (p_display_name is null or length(btrim(p_display_name)) not between 1 and 160 or p_clinic_id is null) then raise invalid_parameter_value using message='Check staff details';end if;
 input_value:=jsonb_build_object('staffId',p_staff_id,'version',p_expected_version,'name',btrim(p_display_name),'clinicId',p_clinic_id);
 perform pg_advisory_xact_lock(hashtextextended('real-staff-request:'||p_request_id::text,0));
 select * into receipt from public.real_staff_management_operations where request_id=p_request_id;
 if found then
  if receipt.actor_id<>actor or receipt.operation<>p_operation or receipt.input<>input_value then raise invalid_parameter_value using message='Request identity conflicts';end if;
  return receipt.result;
 end if;
 if exists(select 1 from public.real_staff_admin_events where request_id=p_request_id) then raise invalid_parameter_value using message='Request identity conflicts';end if;
 -- Match dispatch/finalization order. Never lock cases while holding membership UPDATE.
 select * into i from public.real_staff_invitations where expected_auth_user_id=p_staff_id for update;had_invitation:=found;
 select * into s from public.workspace_staff where user_id=p_staff_id for update;had_staff:=found;
 if (not had_invitation and not had_staff) or (had_staff and s.role not in ('doctor','nurse')) or
  (had_invitation and had_staff and (i.auth_user_id is distinct from s.user_id or i.role<>s.role)) then raise insufficient_privilege using message='Staff unavailable';end if;
 before_row:=public._real_staff_directory_row(p_staff_id);
 if before_row is null then raise insufficient_privilege using message='Staff unavailable';end if;
 if before_row->>'version' is distinct from p_expected_version then raise serialization_failure using message='Staff changed. Reload and try again';end if;
 if had_invitation and i.status='revoked' then raise insufficient_privilege using message='Staff access already removed';end if;
 if p_operation='remove' or (before_row->>'clinicId')::uuid is distinct from p_clinic_id then
  if exists(select 1 from public.patient_clinical_cases where assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id) or
   exists(select 1 from public.workspace_cases where expires_at>clock_timestamp() and (assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id)) then
   raise check_violation using message='Reassign active cases before changing clinic or removing access';
  end if;
 end if;
 if p_operation='update' then
  perform 1 from public.workspace_clinics where id=p_clinic_id and active for share;
  if not found then raise insufficient_privilege using message='Active clinic required';end if;
  if had_invitation then update public.real_staff_invitations set management_revision=management_revision+1,display_name=btrim(p_display_name),clinic_id=p_clinic_id where id=i.id;end if;
  if had_staff then update public.workspace_staff set management_revision=management_revision+1,display_name=btrim(p_display_name),clinic_id=p_clinic_id where user_id=p_staff_id;end if;
 else
  if had_staff then update public.workspace_staff set management_revision=management_revision+1,active=false where user_id=p_staff_id;end if;
  if had_invitation then
   update public.real_staff_invitations set management_revision=management_revision+1,status='revoked',generation=generation+1,operation_id=gen_random_uuid(),
    token_digest=null,token_type=null,dispatch_claimed_at=null,verified_at=null,accepted_at=null,accepted_session_id=null
   where id=i.id returning * into i;
  end if;
 end if;
 after_row:=public._real_staff_directory_row(p_staff_id);
 insert into public.real_staff_management_operations(request_id,actor_id,operation,input,result) values(p_request_id,actor,p_operation,input_value,after_row);
 insert into public.real_staff_admin_events(invitation_id,clinic_id,actor_id,generation,request_id,kind,details)
 values(case when had_invitation then i.id end,(after_row->>'clinicId')::uuid,actor,case when had_invitation then i.generation end,p_request_id,
 case when p_operation='update' then 'staff_updated' else 'staff_removed' end,
 jsonb_build_object('staffId',p_staff_id,'role',after_row->>'role','before',jsonb_build_object('name',before_row->>'name','clinicId',before_row->>'clinicId','active',before_row->'active'),'after',jsonb_build_object('name',after_row->>'name','clinicId',after_row->>'clinicId','active',after_row->'active')));
 return after_row;
end $$;
create function public.real_admin_update_staff(p_staff_id uuid,p_expected_version text,p_display_name text,p_clinic_id uuid,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select public._real_staff_manage(p_staff_id,p_expected_version,p_display_name,p_clinic_id,p_request_id,'update') $$;
create function public.real_admin_remove_staff(p_staff_id uuid,p_expected_version text,p_request_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select public._real_staff_manage(p_staff_id,p_expected_version,null,null,p_request_id,'remove') $$;

-- A managed nurse has the same session revocation boundary as a managed doctor.
create or replace function public.real_clinical_staff_identity() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.user_id,'role',s.role,'name',s.display_name,'clinicId',s.clinic_id)
 from public.workspace_staff s where s.user_id=auth.uid() and s.active
 and (s.role='admin' or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active))
 and (s.role='admin' or public._real_staff_managed_session_allowed(s.user_id))
$$;
create or replace function public.staff_care_access(p_id uuid,p_actor uuid,p_native boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare d uuid;n uuid;
begin
 if p_native then select assigned_doctor_id,assigned_nurse_id into d,n from public.patient_clinical_cases where user_id=p_id;
 else select assigned_doctor_id,assigned_nurse_id into d,n from public.workspace_cases where id=p_id and expires_at>now();end if;
 return exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
 where s.user_id=p_actor and s.active and k.active and (not p_native or public._real_staff_managed_session_allowed(p_actor))
 and ((s.role='doctor' and s.user_id=d) or (s.role='nurse' and s.user_id=n and exists(select 1 from public.workspace_staff doctor where doctor.user_id=d and doctor.role='doctor' and doctor.active and doctor.clinic_id=s.clinic_id))));
end $$;
-- Retain all source locks, evidence revisions, crisis and consultation holds in the delegate.
create or replace function public.lock_assigned_clinical_case(p_user_id uuid,p_actor uuid,p_revision bigint,p_token text) returns public.patient_clinical_cases
language plpgsql security definer set search_path='' as $$
begin
 if not public._real_staff_managed_session_allowed(p_actor) then raise insufficient_privilege using message='Current doctor session required';end if;
 perform 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
 where s.user_id=p_actor and s.role='doctor' and s.active and k.active for share of s,k;
 if not found then raise insufficient_privilege using message='Assigned active doctor required';end if;
 return public.lock_assigned_clinical_case_before_managed_session(p_user_id,p_actor,p_revision,p_token);
end $$;
create or replace function public.workspace_assign_case(p_id uuid,p_expected_revision integer,p_doctor_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare v_revision integer;
begin
 select revision into v_revision from public.workspace_cases where id=p_id and revision=p_expected_revision and expires_at>now() for update;
 if not found then return -1;end if;
 if p_doctor_id is not null then
  perform 1 from public.workspace_staff s join public.workspace_clinics c on c.id=s.clinic_id where s.user_id=p_doctor_id and s.role='doctor' and s.active and c.active for share of s,c;
  if not found then return -1;end if;
 end if;
 update public.workspace_cases set assigned_doctor_id=p_doctor_id,revision=revision+1 where id=p_id returning revision into v_revision;
 return v_revision;
end $$;

revoke all on function public._real_staff_directory_row(uuid),public._real_staff_manage(uuid,text,text,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.real_admin_staff(),public.real_admin_reserve_staff_invitation(uuid,text,text,uuid,text),public.real_admin_reissue_staff_invitation(uuid,bigint,uuid),public.real_admin_update_staff(uuid,text,text,uuid,uuid),public.real_admin_remove_staff(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.real_admin_staff(),public.real_admin_reserve_staff_invitation(uuid,text,text,uuid,text),public.real_admin_reissue_staff_invitation(uuid,bigint,uuid),public.real_admin_update_staff(uuid,text,text,uuid,uuid),public.real_admin_remove_staff(uuid,text,uuid) to authenticated;
revoke all on function public.real_staff_finalize_invitation(uuid,bigint,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.real_staff_finalize_invitation(uuid,bigint,uuid,uuid) to service_role;
