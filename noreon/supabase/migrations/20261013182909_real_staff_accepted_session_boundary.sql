-- An unexpired JWT may survive deletion of its GoTrue session. Managed doctors
-- must not inherit clinical access through a superseded invitation session.
alter table public.real_staff_invitations add column accepted_session_id uuid;

create function public._real_staff_managed_session_allowed(p_actor uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare i public.real_staff_invitations;sid text;
begin
 select * into i from public.real_staff_invitations where auth_user_id=p_actor;
 if not found then return true;end if;
 if i.status<>'accepted' or i.accepted_at is null then return false;end if;
 -- Service entry points are authenticated by the server before dispatch. Browser
 -- RPCs retain role=authenticated even while running SECURITY DEFINER functions.
 if auth.role()='service_role' then return true;end if;
 if auth.uid() is distinct from p_actor then return false;end if;
 sid:=auth.jwt()->>'session_id';
 if sid is null then return false;end if;
 return exists(select 1 from auth.sessions s where s.id::text=sid and s.user_id=p_actor
  and (s.not_after is null or s.not_after>now())
  and (s.id=i.accepted_session_id or s.created_at>=i.accepted_at));
end $$;
revoke all on function public._real_staff_managed_session_allowed(uuid) from public,anon,authenticated,service_role;

create or replace function public.real_clinical_staff_identity() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.user_id,'role',s.role,'name',s.display_name,'clinicId',s.clinic_id)
 from public.workspace_staff s where s.user_id=auth.uid() and s.active
 and (s.role='admin' or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active))
 and (s.role<>'doctor' or public._real_staff_managed_session_allowed(s.user_id))
$$;

create or replace function public.staff_care_access(p_id uuid,p_actor uuid,p_native boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare d uuid;n uuid;
begin
 if p_native then select assigned_doctor_id,assigned_nurse_id into d,n from public.patient_clinical_cases where user_id=p_id;
 else select assigned_doctor_id,assigned_nurse_id into d,n from public.workspace_cases where id=p_id and expires_at>now();end if;
 return exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
 where s.user_id=p_actor and s.active and k.active and ((s.role='doctor' and s.user_id=d
  and (not p_native or public._real_staff_managed_session_allowed(p_actor))) or
 (s.role='nurse' and s.user_id=n and exists(select 1 from public.workspace_staff doctor where doctor.user_id=d and doctor.role='doctor' and doctor.active and doctor.clinic_id=s.clinic_id))));
end $$;

create or replace function public.save_patient_clinical_draft(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_draft jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
 if not public._real_staff_managed_session_allowed(auth.uid()) then raise insufficient_privilege using message='Current doctor session required';end if;
 perform public.lock_assigned_clinical_case(p_user_id,auth.uid(),p_expected_revision,p_evidence_token);
 n:=public.save_patient_clinical_draft_before_review(p_user_id,p_expected_revision,p_evidence_token,p_draft);
 update public.patient_clinical_cases set draft_review_token=md5(review::text) where user_id=p_user_id;return n;
end $$;

-- Never retain an overload that can activate an account without session binding.
drop function public.real_staff_finalize_doctor_invitation(uuid,bigint,uuid);
create function public.real_staff_finalize_doctor_invitation(p_invitation_id uuid,p_generation bigint,p_auth_user_id uuid,p_auth_session_id uuid) returns jsonb
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
 perform 1 from public.workspace_staff where user_id=i.auth_user_id and role='doctor' and clinic_id=i.clinic_id and not active for update;
 if not found then raise insufficient_privilege using message='Pending doctor required';end if;
 update public.workspace_staff set active=true where user_id=i.auth_user_id;
 update public.real_staff_invitations set status='accepted',accepted_at=clock_timestamp(),accepted_session_id=p_auth_session_id where id=i.id returning * into i;
 insert into public.real_staff_admin_events(invitation_id,actor_id,generation,kind) values(i.id,i.auth_user_id,i.generation,'invitation_accepted');
 return public._real_staff_invitation_json(i);
end $$;
revoke all on function public.real_staff_finalize_doctor_invitation(uuid,bigint,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.real_staff_finalize_doctor_invitation(uuid,bigint,uuid,uuid) to service_role;
-- Keep the original narrow caller contracts explicit after replacements.
revoke all on function public.real_clinical_staff_identity(),public.save_patient_clinical_draft(uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.real_clinical_staff_identity(),public.save_patient_clinical_draft(uuid,bigint,text,jsonb) to authenticated;
revoke all on function public.staff_care_access(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.staff_care_access(uuid,uuid,boolean) to service_role;
