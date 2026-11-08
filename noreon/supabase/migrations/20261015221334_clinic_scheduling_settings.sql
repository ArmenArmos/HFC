-- Recipient configuration only. Saving a setting never sends or confirms a booking.
create function public._real_scheduling_email(p_email text) returns text
language plpgsql immutable set search_path='' as $normalize$
declare normalized text;
begin
 if p_email is null then return null;end if;
 if length(p_email)>1024 or position(chr(13) in p_email)>0 or position(chr(10) in p_email)>0 then raise invalid_parameter_value using message='Enter one valid email address';end if;
 normalized:=nullif(btrim(p_email,E' \t'),'');
 if normalized is null then return null;end if;
 -- Same practical single-mailbox pattern as the existing Zod email validator.
 if length(normalized)>254 or normalized !~ $mail$^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$$mail$ then
  raise invalid_parameter_value using message='Enter one valid email address';
 end if;
 return normalized;
end $normalize$;
revoke all on function public._real_scheduling_email(text) from public,anon,authenticated,service_role;

alter table public.workspace_clinics add column scheduling_email text;
alter table public.workspace_clinics add column scheduling_revision integer not null default 0 check(scheduling_revision>=0);
alter table public.workspace_clinics add constraint workspace_clinics_scheduling_email_check
 check(scheduling_email is null or scheduling_email is not distinct from public._real_scheduling_email(scheduling_email));

create table public.workspace_scheduling_settings (
 id boolean primary key default true check(id),
 copy_email text check(copy_email is null or copy_email is not distinct from public._real_scheduling_email(copy_email)),
 revision integer not null default 0 check(revision>=0)
);
insert into public.workspace_scheduling_settings(id) values(true);
alter table public.workspace_scheduling_settings enable row level security;
revoke all on public.workspace_scheduling_settings from public,anon,authenticated,service_role;

create table public.clinic_scheduling_operations (
 request_id uuid primary key,
 actor_id uuid not null references auth.users(id),
 operation text not null check(operation in('clinic','copy')),
 input jsonb not null check(jsonb_typeof(input)='object' and octet_length(input::text)<=2048),
 result jsonb not null check(jsonb_typeof(result)='object' and octet_length(result::text)<=2048),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.clinic_scheduling_operations enable row level security;
revoke all on public.clinic_scheduling_operations from public,anon,authenticated,service_role;

alter table public.real_staff_admin_events drop constraint real_staff_admin_events_kind_check;
alter table public.real_staff_admin_events add constraint real_staff_admin_events_kind_check check(kind in(
 'clinic_created','invitation_reserved','invitation_reissued','dispatch_claimed','identity_bound','token_prepared','submission_accepted','submission_failed','submission_unknown','invitation_verified','invitation_accepted','staff_updated','staff_removed',
 'clinic_scheduling_updated','scheduling_copy_updated'
));

-- Internal shared implementation. Public entry points fix the operation; no
-- client may invoke this helper or read operation receipts directly.
create function public._real_admin_save_scheduling_email(p_operation text,p_clinic_id uuid,p_expected_revision integer,p_request_id uuid,p_email text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public._real_staff_require_admin();normalized text;canonical jsonb;prior public.clinic_scheduling_operations;clinic public.workspace_clinics;settings public.workspace_scheduling_settings;result jsonb;
begin
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_operation not in('clinic','copy') or p_operation is null
  or (p_operation='clinic' and p_clinic_id is null) or (p_operation='copy' and p_clinic_id is not null) then raise invalid_parameter_value using message='Check scheduling setting details';end if;
 normalized:=public._real_scheduling_email(p_email);
 canonical:=jsonb_build_object('clinicId',p_clinic_id,'expectedRevision',p_expected_revision,'email',normalized);
 perform pg_advisory_xact_lock(hashtextextended('clinic-scheduling-request:'||p_request_id::text,0));
 select * into prior from public.clinic_scheduling_operations where request_id=p_request_id;
 if found then
  if prior.actor_id is distinct from actor or prior.operation is distinct from p_operation or prior.input is distinct from canonical then raise invalid_parameter_value using message='Request does not match its original operation';end if;
  return prior.result;
 end if;
 if p_operation='clinic' then
  select * into clinic from public.workspace_clinics where id=p_clinic_id for update;
  if not found or not clinic.active then raise insufficient_privilege using message='Active clinic required';end if;
  if clinic.scheduling_revision<>p_expected_revision then raise serialization_failure using message='Clinic settings changed';end if;
  update public.workspace_clinics set scheduling_email=normalized,scheduling_revision=scheduling_revision+1 where id=clinic.id returning * into clinic;
  result:=jsonb_build_object('id',clinic.id,'email',clinic.scheduling_email,'revision',clinic.scheduling_revision);
 else
  select * into settings from public.workspace_scheduling_settings where id for update;
  if not found then raise check_violation using message='Scheduling settings are unavailable';end if;
  if settings.revision<>p_expected_revision then raise serialization_failure using message='Copy settings changed';end if;
  update public.workspace_scheduling_settings set copy_email=normalized,revision=revision+1 where id returning * into settings;
  result:=jsonb_build_object('email',settings.copy_email,'revision',settings.revision);
 end if;
 insert into public.clinic_scheduling_operations(request_id,actor_id,operation,input,result) values(p_request_id,actor,p_operation,canonical,result);
 insert into public.real_staff_admin_events(clinic_id,actor_id,request_id,kind,details) values(p_clinic_id,actor,p_request_id,
  case when p_operation='clinic' then 'clinic_scheduling_updated' else 'scheduling_copy_updated' end,
  jsonb_build_object('revision',(result->>'revision')::integer));
 return result;
end $$;
revoke all on function public._real_admin_save_scheduling_email(text,uuid,integer,uuid,text) from public,anon,authenticated,service_role;

create function public.real_admin_update_clinic_scheduling_email(p_clinic_id uuid,p_expected_revision integer,p_request_id uuid,p_email text default null)
returns jsonb language sql security definer set search_path='' as $$
 select public._real_admin_save_scheduling_email('clinic',p_clinic_id,p_expected_revision,p_request_id,p_email)
$$;
create function public.real_admin_update_scheduling_copy_email(p_expected_revision integer,p_request_id uuid,p_email text default null)
returns jsonb language sql security definer set search_path='' as $$
 select public._real_admin_save_scheduling_email('copy',null,p_expected_revision,p_request_id,p_email)
$$;
create function public.real_admin_scheduling_copy_settings() returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform public._real_staff_require_admin();
 return(select jsonb_build_object('email',copy_email,'revision',revision) from public.workspace_scheduling_settings where id);
end $$;
create or replace function public.real_admin_clinics() returns jsonb
language plpgsql security definer set search_path='' as $$begin
 perform public._real_staff_require_admin();
 return(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'address',address,'active',active,'schedulingEmail',scheduling_email,'schedulingRevision',scheduling_revision) order by name,id),'[]') from public.workspace_clinics);
end $$;
revoke all on function public.real_admin_update_clinic_scheduling_email(uuid,integer,uuid,text),public.real_admin_update_scheduling_copy_email(integer,uuid,text),public.real_admin_scheduling_copy_settings() from public,anon,authenticated,service_role;
grant execute on function public.real_admin_update_clinic_scheduling_email(uuid,integer,uuid,text),public.real_admin_update_scheduling_copy_email(integer,uuid,text),public.real_admin_scheduling_copy_settings() to authenticated;
