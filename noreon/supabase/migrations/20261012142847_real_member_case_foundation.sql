-- Real care coordination is distinct from expiring fictional workspace cases.
create table public.patient_clinical_cases (
 user_id uuid primary key references auth.users(id) on delete cascade,
 assigned_doctor_id uuid references public.workspace_staff(user_id) on delete restrict,
 revision bigint not null default 0 check(revision>=0),
 draft jsonb, draft_evidence_token text, draft_saved_by uuid references public.workspace_staff(user_id), draft_saved_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.patient_clinical_cases enable row level security;
revoke all on public.patient_clinical_cases from public,anon,authenticated,service_role;
create table public.patient_clinical_case_events (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.patient_clinical_cases(user_id) on delete cascade,
 revision bigint not null, kind text not null check(kind in ('enrolled','assigned','draft-saved')),
 actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 detail jsonb not null default '{}'
);
alter table public.patient_clinical_case_events enable row level security;
revoke all on public.patient_clinical_case_events from public,anon,authenticated,service_role;
create index patient_clinical_cases_assignment on public.patient_clinical_cases(assigned_doctor_id,created_at);

create function public.real_clinical_staff_identity() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.user_id,'role',s.role,'name',s.display_name,'clinicId',s.clinic_id)
 from public.workspace_staff s where s.user_id=auth.uid() and s.active
 and (s.role='admin' or exists(select 1 from public.workspace_clinics c where c.id=s.clinic_id and c.active))
$$;

create function public.enroll_patient_clinical_case() returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();inserted uuid;
begin
 if uid is null then raise insufficient_privilege using message='Verified membership required';end if;
 perform 1 from auth.users where id=uid and phone is not null and phone_confirmed_at is not null for share;
 if not found or not exists(select 1 from public.profiles where id=uid and nullif(btrim(display_name),'') is not null and birth_date is not null and biological_sex in ('male','female'))
 or not exists(select 1 from public.patient_consents where user_id=uid and version='patient-pilot-v1')
 or not exists(select 1 from public.patient_assessments where user_id=uid) then raise insufficient_privilege using message='Complete your verified profile and consent first';end if;
 insert into public.patient_clinical_cases(user_id) values(uid) on conflict do nothing returning user_id into inserted;
 if inserted is not null then insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id) values(uid,0,'enrolled',uid);end if;
 return uid;
end $$;

-- Member status contains no clinical draft, staff identifiers, or other owners.
create function public.patient_clinical_case_status() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',case when c.assigned_doctor_id is null then 'awaiting_assignment' else 'review_pending' end,'createdAt',c.created_at)
 from public.patient_clinical_cases c where c.user_id=auth.uid()
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null)
$$;

create function public.patient_clinical_case_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare staff jsonb:=public.real_clinical_staff_identity(); result jsonb;
begin
 if staff is null then raise insufficient_privilege using message='Active staff membership required';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q."createdAt",q.id),'[]') into result from (
 select c.user_id id,p.display_name name,c.revision,c.assigned_doctor_id "doctorId",c.created_at "createdAt"
 from public.patient_clinical_cases c join public.profiles p on p.id=c.user_id
 where staff->>'role'='admin' or c.assigned_doctor_id=auth.uid()
 order by c.created_at,c.user_id limit 200) q;
 return result;
end $$;
create function public.patient_clinical_doctor_directory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.real_clinical_staff_identity()->>'role' is distinct from 'admin' then raise insufficient_privilege using message='Administrator required';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name,'clinic',c.name) order by s.display_name,s.user_id),'[]') from public.workspace_staff s join public.workspace_clinics c on c.id=s.clinic_id where s.role='doctor' and s.active and c.active);
end $$;
create function public.assign_patient_clinical_case(p_user_id uuid,p_expected_revision bigint,p_doctor_id uuid) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;n bigint;
begin
 perform 1 from public.workspace_staff where user_id=auth.uid() and role='admin' and active for share;
 if not found then raise insufficient_privilege using message='Administrator required';end if;
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update;
 if not found then raise insufficient_privilege using message='Case unavailable';end if;
 if c.revision is distinct from p_expected_revision then raise serialization_failure using message='Case changed. Reload before assigning';end if;
 if p_doctor_id is not null then
  perform 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_doctor_id and s.role='doctor' and s.active and k.active for share of s,k;
  if not found then raise insufficient_privilege using message='Choose an active doctor in an active clinic';end if;
 end if;
 if c.assigned_doctor_id is not distinct from p_doctor_id then return c.revision;end if;
 update public.patient_clinical_cases set assigned_doctor_id=p_doctor_id,revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'assigned',auth.uid(),jsonb_build_object('doctorId',p_doctor_id));
 return n;
end $$;

-- Internal coherent source snapshot, never callable by a browser. Fingerprint includes
-- all measurements and reports; no browser-controlled evidence payload.
create function public.patient_clinical_evidence(p_user_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 with evidence as (select jsonb_build_object(
 'profile',(select jsonb_build_object('name',display_name,'birthDate',birth_date,'biologicalSex',biological_sex) from public.profiles where id=p_user_id),
 'consent',(select to_jsonb(c) from public.patient_consents c where user_id=p_user_id and version='patient-pilot-v1'),
 'assessment',(select to_jsonb(a)-'user_id' from public.patient_assessments a where user_id=p_user_id),
 'measurements',coalesce((select jsonb_agg(to_jsonb(m)-'user_id' order by m.measured_at desc,m.id) from public.patient_measurements m where user_id=p_user_id),'[]'),
 'reports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'revision',r.revision,'state',r.state,'reviewed',r.reviewed,'confirmedAt',r.confirmed_at) order by r.id) from public.patient_reports r where user_id=p_user_id),'[]')
 ) body)
 select jsonb_build_object('token',md5(body::text),'data',body) from evidence
$$;
create function public.patient_clinical_case_snapshot(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.real_clinical_staff_identity()->>'role' is distinct from 'doctor' then raise insufficient_privilege using message='Assigned active doctor required';end if;
 select jsonb_build_object('id',c.user_id,'revision',c.revision,'evidenceToken',e.value->>'token','evidence',e.value->'data','draft',c.draft,'draftSavedAt',c.draft_saved_at,
 'draftStale',c.draft is not null and (c.draft_evidence_token is distinct from e.value->>'token' or c.draft_saved_by is distinct from auth.uid()))
 into result from public.patient_clinical_cases c cross join lateral (select public.patient_clinical_evidence(c.user_id) value) e
 where c.user_id=p_user_id and c.assigned_doctor_id=auth.uid();
 if result is null then raise insufficient_privilege using message='Assigned case unavailable';end if;
 return result;
end $$;
create function public.save_patient_clinical_draft(p_user_id uuid,p_expected_revision bigint,p_evidence_token text,p_draft jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;e jsonb;n bigint;
begin
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update;
 if not found or c.assigned_doctor_id is distinct from auth.uid() then raise insufficient_privilege using message='Assigned active doctor required';end if;
 perform 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=auth.uid() and s.role='doctor' and s.active and k.active for share of s,k;
 if not found then raise insufficient_privilege using message='Assigned active doctor required';end if;
 if c.revision is distinct from p_expected_revision then raise serialization_failure using message='Case changed. Reload before saving';end if;
 e:=public.patient_clinical_evidence(p_user_id);
 if e->>'token' is distinct from p_evidence_token then raise serialization_failure using message='Evidence changed. Reload and review before saving';end if;
 if e#>>'{data,assessment,completed_at}' is null or e#>>'{data,assessment,urgent_rule}' is not null or e#>'{data,consent}'='null'::jsonb then raise exception 'Complete the questionnaire and resolve urgent guidance before review';end if;
 if not public.workspace_valid_review_draft(p_draft) then raise exception 'Save a complete, valid clinical draft';end if;
 update public.patient_clinical_cases set draft=p_draft,draft_evidence_token=p_evidence_token,draft_saved_by=auth.uid(),draft_saved_at=now(),revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'draft-saved',auth.uid(),jsonb_build_object('evidenceToken',p_evidence_token));
 return n;
end $$;
revoke all on function public.patient_clinical_evidence(uuid) from public,anon,authenticated,service_role;
revoke all on function public.real_clinical_staff_identity(),public.enroll_patient_clinical_case(),public.patient_clinical_case_status(),public.patient_clinical_case_queue(),public.patient_clinical_doctor_directory(),public.assign_patient_clinical_case(uuid,bigint,uuid),public.patient_clinical_case_snapshot(uuid),public.save_patient_clinical_draft(uuid,bigint,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.real_clinical_staff_identity(),public.enroll_patient_clinical_case(),public.patient_clinical_case_status(),public.patient_clinical_case_queue(),public.patient_clinical_doctor_directory(),public.assign_patient_clinical_case(uuid,bigint,uuid),public.patient_clinical_case_snapshot(uuid),public.save_patient_clinical_draft(uuid,bigint,text,jsonb) to authenticated;
