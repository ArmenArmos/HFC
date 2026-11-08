-- Staff-session admission and access audit on clinical reads and doctor writes (Codex Astra audit,
-- 20 Oct: A1 items 1-5, A3 item 2, A5 item 1). A staff JWT is only as good as its managed session:
-- live auth session, accepted invitation, password AMR, not removed, and Telegram admission when the
-- staff sign-in policy requires it (_real_staff_managed_session_allowed). Several helpers checked the
-- staff row alone, so a password-only, unadmitted or revoked session could read or change clinical data
-- through the Data API. Separately, some staff reads returned clinical content with no access_audit row.

-- 1. The assigned-doctor helper behind document release, lab AI review, care plans and lab results.
create or replace function public._assigned_active_doctor(p_user uuid)returns uuid
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.uid() is null or not exists(select 1 from public.patient_clinical_cases c where c.user_id=p_user and c.assigned_doctor_id=auth.uid())
  or not exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
   where s.user_id=auth.uid() and s.role='doctor'and s.active and s.removed_at is null and k.active)
  or not public._real_staff_managed_session_allowed(auth.uid())
 then raise insufficient_privilege using message='Assigned active doctor required';end if;
 return auth.uid();
end$$;

-- 2. The nurse and doctor visit guard (visits, BP week, medicines) checked the auth session row but not
-- the managed session (admission, accepted invitation, AMR, removal).
create or replace function public._patient_visit_authorize(p_member uuid,p_write boolean,p_exclusive boolean)returns public.workspace_staff
language plpgsql security definer set search_path=''as $$
declare actor uuid:=auth.uid();s public.workspace_staff;sid uuid;d uuid;
begin
 if auth.role()is distinct from 'authenticated'or actor is null then raise insufficient_privilege;end if;
 sid:=(auth.jwt()->>'session_id')::uuid;if sid is null then raise insufficient_privilege;end if;
 perform 1 from auth.users where id=p_member and phone is not null and phone_confirmed_at is not null for share nowait;
 if not found then raise insufficient_privilege;end if;
 if p_exclusive then select assigned_doctor_id into d from public.patient_clinical_cases where user_id=p_member for update nowait;
 else select assigned_doctor_id into d from public.patient_clinical_cases where user_id=p_member for share nowait;end if;
 if not found then raise insufficient_privilege;end if;
 perform 1 from public.workspace_staff t join public.workspace_clinics k on k.id=t.clinic_id where t.user_id=actor for share of t,k nowait;
 perform 1 from public.workspace_staff where user_id=d for share nowait;
 perform 1 from public.real_staff_invitations where auth_user_id=actor for share nowait;
 perform 1 from auth.sessions where id=sid and user_id=actor and(not_after is null or not_after>clock_timestamp())for share nowait;
 if not found then raise insufficient_privilege;end if;
 if not public._real_staff_managed_session_allowed(actor)then raise insufficient_privilege;end if;
 select * into s from public.workspace_staff where user_id=actor;
 if s.role not in('nurse','doctor')or s.removed_at is not null or(p_write and s.role is distinct from 'nurse')or not public.staff_care_access(p_member,actor,true)then raise insufficient_privilege;end if;
 return s;
exception when invalid_text_representation then raise insufficient_privilege;
end$$;

-- 3. Member-reported history: staff branches need a managed session. Still used by
-- staff_record_member_access and the clinic member upload check.
create or replace function public._member_history_reader(p_user uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select auth.uid() is not null and(
  auth.uid()=p_user
  or(public._real_staff_managed_session_allowed(auth.uid())and(
   exists(select 1 from public.patient_clinical_cases c
    join public.workspace_staff s on s.user_id=c.assigned_doctor_id and s.role='doctor'and s.active and s.removed_at is null
    join public.workspace_clinics k on k.id=s.clinic_id and k.active
    where c.user_id=p_user and c.assigned_doctor_id=auth.uid())
   or exists(select 1 from public.workspace_staff s where s.user_id=auth.uid() and s.role='admin'and s.active and s.removed_at is null))));
$$;

-- 4. Direct table reads are the member's own only. Staff read through staff_member_history, which
-- records the access in the same transaction (a failed audit insert fails the read).
alter policy member_reported_documents_read on public.member_reported_documents
 using(deleted_at is null and user_id=(select auth.uid()));
alter policy member_reported_values_read on public.member_reported_values
 using(user_id=(select auth.uid()));

create function public.staff_member_history(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'authenticated'or auth.uid() is null or p_member is null or auth.uid()=p_member
  or not public._member_history_reader(p_member)
  or not exists(select 1 from public.patient_clinical_cases where user_id=p_member)
 then raise insufficient_privilege using message='Member history access required';end if;
 perform public._access_audit_record(p_member,'member_history',null);
 return jsonb_build_object('version','staff-member-history-v1',
  'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'file_name',d.file_name,'mime',d.mime,'size_bytes',d.size_bytes,'result_date',d.result_date,'created_at',d.created_at)
    order by d.created_at desc,d.id)
   from(select * from public.member_reported_documents where user_id=p_member and deleted_at is null order by created_at desc,id limit 50)d),'[]'::jsonb),
  'values',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'source',v.source,'measure',v.measure,'value',v.value,'value2',v.value2,'unit',v.unit,'measured_on',v.measured_on)
    order by v.measured_on desc,v.created_at desc,v.id)
   from public.member_reported_values v where v.user_id=p_member),'[]'::jsonb));
end$$;
revoke all on function public.staff_member_history(uuid)from public,anon,authenticated,service_role;
grant execute on function public.staff_member_history(uuid)to authenticated;

-- 5. Admin lab-results read: the admin branch needs a managed admin session. The doctor branch goes
-- through _assigned_active_doctor (1). The body is unchanged and is kept as the inner function.
alter function public.staff_lab_ai_results(uuid)rename to _staff_lab_ai_results_body;
revoke all on function public._staff_lab_ai_results_body(uuid)from public,anon,authenticated,service_role;
create function public.staff_lab_ai_results(p_user_id uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if exists(select 1 from public.workspace_staff s where s.user_id=auth.uid()and s.role='admin'and s.active and s.removed_at is null)
  and not public._real_staff_managed_session_allowed(auth.uid())
 then raise insufficient_privilege using message='Active administrator session required';end if;
 return public._staff_lab_ai_results_body(p_user_id);
end$$;
revoke all on function public.staff_lab_ai_results(uuid)from public,anon,authenticated,service_role;
grant execute on function public.staff_lab_ai_results(uuid)to authenticated;

-- 6. Clinical reads with no access record. Each body is kept as an inner function; the public RPC records
-- a successful read (not a refused one, which raises, nor a switched-off one, which shows nothing).
alter function public.bp_week_staff_read(uuid)rename to _bp_week_staff_read_body;
revoke all on function public._bp_week_staff_read_body(uuid)from public,anon,authenticated,service_role;
create function public.bp_week_staff_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r jsonb:=public._bp_week_staff_read_body(p_member);
begin
 if r->>'enabled'='true'then perform public._access_audit_record(p_member,'bp_week',null);end if;
 return r;
end$$;
revoke all on function public.bp_week_staff_read(uuid)from public,anon,authenticated,service_role;
grant execute on function public.bp_week_staff_read(uuid)to authenticated;

alter function public.member_medicines_staff_read(uuid,integer)rename to _member_medicines_staff_read_body;
revoke all on function public._member_medicines_staff_read_body(uuid,integer)from public,anon,authenticated,service_role;
create function public.member_medicines_staff_read(p_member uuid,p_days integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r jsonb:=public._member_medicines_staff_read_body(p_member,p_days);
begin
 if r->>'enabled'='true'then perform public._access_audit_record(p_member,'member_medicines',null);end if;
 return r;
end$$;
revoke all on function public.member_medicines_staff_read(uuid,integer)from public,anon,authenticated,service_role;
grant execute on function public.member_medicines_staff_read(uuid,integer)to authenticated;

alter function public.zoe_symptom_intakes_for_doctor(uuid)rename to _zoe_symptom_intakes_for_doctor_body;
revoke all on function public._zoe_symptom_intakes_for_doctor_body(uuid)from public,anon,authenticated,service_role;
create function public.zoe_symptom_intakes_for_doctor(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r jsonb:=public._zoe_symptom_intakes_for_doctor_body(p_member);
begin
 perform public._access_audit_record(p_member,'zoe_symptom_intakes',null);
 return r;
end$$;
revoke all on function public.zoe_symptom_intakes_for_doctor(uuid)from public,anon,authenticated,service_role;
grant execute on function public.zoe_symptom_intakes_for_doctor(uuid)to authenticated;

-- The staff open of one member-reported document: same check as staff_member_history, recorded with the
-- document id before the server fetches the bytes. Null when the document is not the member's or removed.
create function public.staff_member_history_document(p_member uuid,p_document uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d public.member_reported_documents;
begin
 if auth.role()is distinct from 'authenticated'or auth.uid() is null or p_member is null or p_document is null or auth.uid()=p_member
  or not public._member_history_reader(p_member)
  or not exists(select 1 from public.patient_clinical_cases where user_id=p_member)
 then raise insufficient_privilege using message='Member history access required';end if;
 select * into d from public.member_reported_documents where id=p_document and user_id=p_member and deleted_at is null;
 if not found then return null;end if;
 perform public._access_audit_record(p_member,'member_upload',p_document::text);
 return jsonb_build_object('object_path',d.object_path,'mime',d.mime,'size_bytes',d.size_bytes,'sha256',d.sha256,'file_name',d.file_name);
end$$;
revoke all on function public.staff_member_history_document(uuid,uuid)from public,anon,authenticated,service_role;
grant execute on function public.staff_member_history_document(uuid,uuid)to authenticated;
