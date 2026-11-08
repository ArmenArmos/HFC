-- A disabled legacy membership and a deliberately removed membership are different states.
-- Keep historical operation receipts immutable, including results written before this marker.
alter table public.workspace_staff add column removed_at timestamptz;
alter table public.workspace_staff add constraint workspace_staff_removed_inactive check(removed_at is null or not active);
-- Recover prior successful management removals; ordinary inactive memberships stay inactive.
update public.workspace_staff s set removed_at=r.removed_at,management_revision=s.management_revision+1
from (select (input->>'staffId')::uuid staff_id,min(created_at) removed_at
 from public.real_staff_management_operations where operation='remove' group by (input->>'staffId')::uuid) r
where s.user_id=r.staff_id and not s.active;
create or replace function public._real_staff_directory_row(p_staff_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with entry as (
 select jsonb_build_object('managementRevision',s.management_revision,'id',s.user_id,'name',s.display_name,'email',u.email,'role',s.role,'clinicId',s.clinic_id,'clinicName',c.name,'active',s.active,
 'invitationId',i.id,'generation',i.generation,'status',case when s.removed_at is not null then 'revoked' when i.status in ('pending','verified') and i.expires_at<=clock_timestamp() then 'expired' when i.id is not null then i.status when s.active then 'active' else 'inactive' end,
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
create or replace function public._real_staff_manage(p_staff_id uuid,p_expected_version text,p_display_name text,p_clinic_id uuid,p_request_id uuid,p_operation text) returns jsonb
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
 if (had_staff and s.removed_at is not null) or (had_invitation and i.status='revoked') then raise insufficient_privilege using message='Staff access already removed';end if;
 if p_operation='remove' or (before_row->>'clinicId')::uuid is distinct from p_clinic_id then
  if exists(select 1 from public.patient_clinical_cases where assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id) or
   exists(select 1 from public.workspace_cases where expires_at>clock_timestamp() and (assigned_doctor_id=p_staff_id or assigned_nurse_id=p_staff_id)) then
   raise check_violation using message='Reassign active cases before changing clinic or removing access';
  end if;
 end if;
 if p_operation='update' then
  perform 1 from public.workspace_clinics where id=p_clinic_id and (active or id=(before_row->>'clinicId')::uuid) for share;
  if not found then raise insufficient_privilege using message='Active clinic required';end if;
  if had_invitation then update public.real_staff_invitations set management_revision=management_revision+1,display_name=btrim(p_display_name),clinic_id=p_clinic_id where id=i.id;end if;
  if had_staff then update public.workspace_staff set management_revision=management_revision+1,display_name=btrim(p_display_name),clinic_id=p_clinic_id where user_id=p_staff_id;end if;
 else
  if had_staff then update public.workspace_staff set management_revision=management_revision+1,active=false,removed_at=clock_timestamp() where user_id=p_staff_id;end if;
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
revoke all on function public._real_staff_directory_row(uuid),public._real_staff_manage(uuid,text,text,uuid,uuid,text) from public,anon,authenticated,service_role;
