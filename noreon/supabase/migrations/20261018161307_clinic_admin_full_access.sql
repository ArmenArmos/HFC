-- Clinic admin full access (dark, one DB switch).
--
-- Khikar, 18 Oct 2026: clinic admins see everything about their clinic's patients, edit their
-- personal data, and attach or change the doctor and nurse. Lead scope:
--  * Who: an active clinic-portal membership with role 'admin' (20261017111652). Clinic staff,
--    workspace staff, members and anon are refused.
--  * Which patients: members whose assigned doctor or nurse belongs to the clinic, or who are known
--    to the clinic through a booking or a linked lab PDF (_clinic_member_known). Staff and clinic
--    accounts are never patients. Other clinics' patients are refused the same way as unknown ids.
--  * Read: personal data, consent, questionnaire answers and urgent result, blood pressure readings,
--    this clinic's bookings, visits with recorded steps, ordered tests, lab results, documents, the
--    published plan with medicines, and the care team. Read-only for clinical content.
--  * Edit: full name and date of birth (same bounds as member sign-up: 1-100 characters, age
--    18-110). Phone is the sign-in identity and is never edited here; biological sex is not
--    editable by any staff path today, so it is not editable here either. Each change keeps
--    before/after in clinic_member_profile_changes.
--  * Care team: the doctor must be an active doctor of this clinic; the nurse an active nurse of the
--    same clinic (the doctor's clinic), or none. A member whose current doctor is at another clinic
--    is refused, so a clinic cannot take another clinic's patient. The clear-nurse, review
--    invalidation and notification triggers on patient_clinical_cases run as for an admin change,
--    and each change writes a case event.
--  * Privacy gate (P21, legal pending): everything above sits behind
--    clinic_portal_capabilities.clinic_admin_full_access, default false. Switching it on is an
--    operator step for prod-as-staging only; GO_LIVE_GATES carries the legal condition.
--  * Every read and write is audited: clinic_portal_audit for each call, access_audit for each
--    record opened.

-- 1. Switch ----------------------------------------------------------------------------------------
alter table public.clinic_portal_capabilities add column clinic_admin_full_access boolean not null default false;

create function public._clinic_admin_full_access_enabled()returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select clinic_admin_full_access from public.clinic_portal_capabilities where singleton),false)
$$;

-- 2. Profile change history (before/after) ----------------------------------------------------------
create table public.clinic_member_profile_changes(
 id uuid primary key default gen_random_uuid(),
 clinic_id uuid not null references public.workspace_clinics(id),
 actor_id uuid not null references auth.users(id),
 membership_id uuid not null references public.clinic_portal_memberships(id),
 member_id uuid not null references auth.users(id),
 submission_id uuid not null,
 before jsonb not null,
 after jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,submission_id)
);
create index clinic_member_profile_changes_member on public.clinic_member_profile_changes(member_id,created_at desc);
alter table public.clinic_member_profile_changes enable row level security;
revoke all on public.clinic_member_profile_changes from public,anon,authenticated,service_role;
create trigger clinic_member_profile_changes_immutable before update or delete on public.clinic_member_profile_changes
 for each row execute function public._audit_immutable();

-- 3. Scope ----------------------------------------------------------------------------------------
-- A live admin membership of this clinic (raises 42501 otherwise).
create function public._clinic_admin_member(c uuid)returns public.clinic_portal_memberships
language plpgsql security definer set search_path=''as $$
begin
 return public._clinic_scheduling_member(c,true);
end$$;

-- Is this member one of the clinic's patients?
create function public._clinic_admin_patient(c uuid,mm uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select mm is not null
  and exists(select 1 from public.profiles where id=mm)
  and not exists(select 1 from public.workspace_staff where user_id=mm)
  and not exists(select 1 from public.clinic_portal_memberships where user_id=mm)
  and(exists(select 1 from public.patient_clinical_cases k join public.workspace_staff s on s.user_id in(k.assigned_doctor_id,k.assigned_nurse_id)
       where k.user_id=mm and s.clinic_id=c)
   or public._clinic_member_known(c,mm))
$$;

create function public._clinic_admin_patients(c uuid)returns table(member_id uuid)
language sql stable security definer set search_path=''as $$
 select x.member_id from(
  select k.user_id member_id from public.patient_clinical_cases k join public.workspace_staff s on s.user_id in(k.assigned_doctor_id,k.assigned_nurse_id) where s.clinic_id=c
  union select member_id from public._clinic_known_members(c))x
 where not exists(select 1 from public.workspace_staff where user_id=x.member_id)
  and not exists(select 1 from public.clinic_portal_memberships where user_id=x.member_id)
  and exists(select 1 from public.profiles where id=x.member_id)
$$;

create function public._clinic_admin_staff_json(s uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('id',w.user_id,'name',w.display_name,'role',w.role,'clinicId',w.clinic_id,'clinicName',k.name,'active',w.active and w.removed_at is null)
 from public.workspace_staff w left join public.workspace_clinics k on k.id=w.clinic_id where w.user_id=s
$$;

-- 4. Patient list -----------------------------------------------------------------------------------
-- Optional filter by name (two or more characters) or phone (four or more digits). At most 200 rows.
-- Audited without the query text.
create function public.clinic_admin_patients(p_clinic uuid,p_query text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;q text:=btrim(coalesce(p_query,''));digits text;pattern text;rows jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('version','clinic-admin-patients-v1','enabled',false);end if;
 if length(q)=1 or length(q)>100 then raise invalid_parameter_value;end if;
 digits:=regexp_replace(q,'[^0-9]','','g');
 pattern:='%'||replace(replace(replace(lower(q),'\','\\'),'%','\%'),'_','\_')||'%';
 select coalesce(jsonb_agg(r order by lower(r->>'name'),r->>'memberId'),'[]'::jsonb)into rows from(
  select jsonb_build_object('memberId',x.member_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'phone',public._clinic_member_phone(x.member_id),'birthDate',p.birth_date,
   'doctorName',(select display_name from public.workspace_staff where user_id=k.assigned_doctor_id),
   'nurseName',(select display_name from public.workspace_staff where user_id=k.assigned_nurse_id))r
  from public._clinic_admin_patients(p_clinic)x join public.profiles p on p.id=x.member_id
  left join public.patient_clinical_cases k on k.user_id=x.member_id left join auth.users u on u.id=x.member_id
  where q=''or lower(coalesce(p.display_name,''))like pattern or(length(digits)>=4 and coalesce(u.phone,'')like '%'||digits||'%')
  order by lower(coalesce(p.display_name,'')),x.member_id limit 200)y;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-patients-listed',jsonb_build_object('results',jsonb_array_length(rows),'filtered',q<>'','membershipId',m.id));
 return jsonb_build_object('version','clinic-admin-patients-v1','enabled',true,'patients',rows);
end$$;

-- 5. Full record ----------------------------------------------------------------------------------
create function public.clinic_admin_patient_record(p_clinic uuid,p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;p public.profiles;k public.patient_clinical_cases;doctor_clinic uuid;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('version','clinic-admin-record-v1','enabled',false);end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-record-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id));
  return jsonb_build_object('version','clinic-admin-record-v1','enabled',true,'status','refused');
 end if;
 select * into p from public.profiles where id=p_member;
 select * into k from public.patient_clinical_cases where user_id=p_member;
 select clinic_id into doctor_clinic from public.workspace_staff where user_id=k.assigned_doctor_id;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-record-opened',jsonb_build_object('memberId',p_member,'membershipId',m.id));
 perform public._access_audit_record(p_member,'clinic_admin_record',p_clinic::text);
 return jsonb_build_object('version','clinic-admin-record-v1','enabled',true,'status','ok',
  'member',jsonb_build_object('memberId',p.id,'name',coalesce(nullif(btrim(p.display_name),''),''),'phone',public._clinic_member_phone(p.id),'birthDate',p.birth_date,
   'sex',p.biological_sex,'locale',p.locale,'joinedAt',p.created_at,'updatedAt',p.updated_at),
  'consents',(select coalesce(jsonb_agg(jsonb_build_object('version',c.version,'acceptedAt',c.accepted_at)order by c.accepted_at desc),'[]'::jsonb)from public.patient_consents c where c.user_id=p_member),
  'careTeam',jsonb_build_object('enrolled',k.user_id is not null,'revision',k.revision,'enrolledAt',k.created_at,
   'doctor',case when k.assigned_doctor_id is not null then public._clinic_admin_staff_json(k.assigned_doctor_id)end,
   'nurse',case when k.assigned_nurse_id is not null then public._clinic_admin_staff_json(k.assigned_nurse_id)end,
   'editable',k.user_id is not null and(k.assigned_doctor_id is null or doctor_clinic=p_clinic),
   'doctors',(select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name)order by s.display_name,s.user_id),'[]'::jsonb)
    from public.workspace_staff s where s.clinic_id=p_clinic and s.role='doctor'and s.active and s.removed_at is null),
   'nurses',(select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name)order by s.display_name,s.user_id),'[]'::jsonb)
    from public.workspace_staff s where s.clinic_id=p_clinic and s.role='nurse'and s.active and s.removed_at is null)),
  'assessment',(select jsonb_build_object('completedAt',a.completed_at,'assessmentDate',a.assessment_date,'algorithmVersion',a.algorithm_version,'urgentRule',a.urgent_rule,'answers',a.answers,'updatedAt',a.updated_at)
   from public.patient_assessments a where a.user_id=p_member),
  'measurements',(select coalesce(jsonb_agg(jsonb_build_object('measuredAt',x.measured_at,'systolic',x.systolic,'diastolic',x.diastolic,'pulse',x.pulse,'source',x.source)order by x.measured_at desc,x.id),'[]'::jsonb)
   from(select * from public.patient_measurements where user_id=p_member order by measured_at desc,id limit 60)x),
  'bookings',(select coalesce(jsonb_agg(r order by r->>'startsAt' desc,r->>'appointmentId'),'[]'::jsonb)from public.booking_appointments a cross join lateral public._clinic_schedule_row(p_clinic,a)r
   where a.member_id=p_member and r is not null and exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=p_clinic)),
  'visits',(select coalesce(jsonb_agg(jsonb_build_object('visitId',v.id,'visitedAt',v.created_at,'clinicName',c.name,'thisClinic',v.clinic_id=p_clinic,'recordedBy',v.actor_name,'role',v.actor_role,
    'entries',(select coalesce(jsonb_agg(jsonb_build_object('observedAt',e.observed_at,'recordedBy',e.actor_name,'payload',e.payload)order by e.position,e.id),'[]'::jsonb)
     from public.patient_care_visit_entries e where e.visit_id=v.id and e.user_id=p_member))order by v.created_at desc,v.id),'[]'::jsonb)
   from(select * from public.patient_care_visits where user_id=p_member order by created_at desc,id limit 100)v left join public.workspace_clinics c on c.id=v.clinic_id),
  'tests',(select coalesce(jsonb_agg(jsonb_build_object('title',t.title,'status',t.status,'orderedAt',t.ordered_at,'dueAt',t.due_at,'location',t.location,'source',t.source_label)order by t.ordered_at desc,t.id),'[]'::jsonb)
   from(select * from public.patient_care_tests where user_id=p_member order by ordered_at desc,id limit 200)t),
  'results',(select coalesce(jsonb_agg(jsonb_build_object('marker',r.marker,'value',r.value,'unit',r.unit,'referenceLow',r.reference_low,'referenceHigh',r.reference_high,'referenceText',r.reference_text,
    'collectedAt',r.collected_at,'receivedAt',r.received_at,'source',r.source_label)order by r.collected_at desc,r.marker,r.id),'[]'::jsonb)
   from(select * from public.patient_care_results where user_id=p_member order by collected_at desc,id limit 300)r),
  'plan',(select jsonb_build_object('clinician',pl.clinician,'instructions',pl.instructions,'publishedAt',pl.published_at,'acknowledgedAt',pl.acknowledged_at,
    'medicines',(select coalesce(jsonb_agg(jsonb_build_object('name',md.name,'dose',md.dose,'times',to_jsonb(md.times),'instructions',md.instructions,'startDate',md.start_date,'endDate',md.end_date)order by md.name,md.id),'[]'::jsonb)
     from public.patient_care_medications md where md.plan_id=pl.id and md.user_id=p_member and md.active))
   from public.patient_care_plans pl where pl.user_id=p_member and pl.active and pl.retired_at is null order by pl.published_at desc limit 1),
  'files',public._clinic_member_files(p_clinic,p_member),
  'memberDocuments',(select coalesce(jsonb_agg(jsonb_build_object('name',d.file_name,'resultDate',d.result_date,'uploadedAt',d.created_at)order by d.created_at desc,d.id),'[]'::jsonb)
   from(select * from public.member_reported_documents where user_id=p_member and deleted_at is null order by created_at desc,id limit 100)d),
  'reports',(select coalesce(jsonb_agg(jsonb_build_object('name',r.file_name,'state',r.state,'uploadedAt',r.created_at)order by r.created_at desc,r.id),'[]'::jsonb)
   from(select * from public.patient_reports where user_id=p_member and deleted_at is null order by created_at desc,id limit 100)r),
  'profileChanges',(select coalesce(jsonb_agg(jsonb_build_object('at',h.created_at,'by',(select display_name from public.clinic_portal_memberships where id=h.membership_id),'before',h.before,'after',h.after)order by h.created_at desc,h.id),'[]'::jsonb)
   from(select * from public.clinic_member_profile_changes where member_id=p_member and clinic_id=p_clinic order by created_at desc,id limit 20)h));
end$$;

-- 6. Edit personal data ------------------------------------------------------------------------------
-- p_expected is what the admin saw ({name, birthDate}); a different current value is 'stale'. The
-- submission id makes a retry return the same result.
create function public.clinic_admin_patient_profile_update(p_clinic uuid,p_member uuid,p_submission uuid,p_expected jsonb,p_name text,p_birth_date date)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;p public.profiles;prior public.clinic_member_profile_changes;new_name text:=btrim(coalesce(p_name,''));
 today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;yrs int;v_before jsonb;v_after jsonb;change uuid;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_submission is null or p_member is null then return jsonb_build_object('status','invalid');end if;
 select * into prior from public.clinic_member_profile_changes where actor_id=m.user_id and submission_id=p_submission;
 if found then
  return case when prior.member_id=p_member and prior.clinic_id=p_clinic and prior.after=jsonb_build_object('name',new_name,'birthDate',p_birth_date)
   then jsonb_build_object('status','committed','changeId',prior.id)else jsonb_build_object('status','conflict')end;
 end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-profile-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id));
  return jsonb_build_object('status','refused');
 end if;
 yrs:=case when p_birth_date is null then null else extract(year from age(today,p_birth_date))::int end;
 if length(new_name)not between 1 and 100 or new_name~'[[:cntrl:]]'or yrs is null or yrs not between 18 and 110 then return jsonb_build_object('status','invalid');end if;
 select * into p from public.profiles where id=p_member for update;
 if jsonb_typeof(p_expected)is distinct from 'object'
  or p_expected->>'name'is distinct from coalesce(nullif(btrim(p.display_name),''),'')
  or p_expected->>'birthDate'is distinct from p.birth_date::text then return jsonb_build_object('status','stale');end if;
 v_before:=jsonb_build_object('name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',p.birth_date);
 v_after:=jsonb_build_object('name',new_name,'birthDate',p_birth_date);
 if v_before=v_after then return jsonb_build_object('status','unchanged');end if;
 update public.profiles set display_name=new_name,birth_date=p_birth_date,updated_at=now()where id=p_member;
 insert into public.clinic_member_profile_changes(clinic_id,actor_id,membership_id,member_id,submission_id,before,after)
  values(p_clinic,m.user_id,m.id,p_member,p_submission,v_before,v_after)returning id into change;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-profile-updated',jsonb_build_object('memberId',p_member,'changeId',change,'membershipId',m.id,
  'fields',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb)from jsonb_each(v_after)where v_before->key is distinct from value)));
 return jsonb_build_object('status','committed','changeId',change);
end$$;

-- 7. Care team -------------------------------------------------------------------------------------
-- Sets the doctor (required) and the nurse (or none). Changing the doctor clears the nurse through
-- the existing trigger before the requested nurse is set, so each step writes its own case event.
create function public.clinic_admin_patient_care_team(p_clinic uuid,p_member uuid,p_expected_revision bigint,p_doctor uuid,p_nurse uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;k public.patient_clinical_cases;current_clinic uuid;r bigint;before_doctor uuid;before_nurse uuid;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_member is null or p_doctor is null or p_expected_revision is null then return jsonb_build_object('status','invalid');end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-care-team-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id));
  return jsonb_build_object('status','refused');
 end if;
 select * into k from public.patient_clinical_cases where user_id=p_member for update;
 if not found then return jsonb_build_object('status','not_enrolled');end if;
 before_doctor:=k.assigned_doctor_id;before_nurse:=k.assigned_nurse_id;
 if k.assigned_doctor_id is not null then
  select clinic_id into current_clinic from public.workspace_staff where user_id=k.assigned_doctor_id for share;
  if current_clinic is distinct from p_clinic then
   perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-care-team-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id,'reason','other_clinic'));
   return jsonb_build_object('status','refused','reason','other_clinic');
  end if;
 end if;
 if k.revision is distinct from p_expected_revision then return jsonb_build_object('status','stale','revision',k.revision);end if;
 perform 1 from public.workspace_staff s join public.workspace_clinics c on c.id=s.clinic_id
  where s.user_id=p_doctor and s.role='doctor'and s.active and s.removed_at is null and s.clinic_id=p_clinic and c.active for share of s,c;
 if not found then return jsonb_build_object('status','rejected','reason','doctor_unavailable');end if;
 if p_nurse is not null then
  perform 1 from public.workspace_staff s where s.user_id=p_nurse and s.role='nurse'and s.active and s.removed_at is null and s.clinic_id=p_clinic for share;
  if not found then return jsonb_build_object('status','rejected','reason','nurse_unavailable');end if;
 end if;
 r:=k.revision;
 if k.assigned_doctor_id is distinct from p_doctor then
  update public.patient_clinical_cases set assigned_doctor_id=p_doctor,revision=revision+1,updated_at=now()where user_id=p_member returning * into k;r:=k.revision;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(p_member,r,'assigned',m.user_id,jsonb_build_object('doctorId',p_doctor,'by','clinic-admin','clinicId',p_clinic,'membershipId',m.id));
 end if;
 if k.assigned_nurse_id is distinct from p_nurse then
  update public.patient_clinical_cases set assigned_nurse_id=p_nurse,revision=revision+1,updated_at=now()where user_id=p_member returning * into k;r:=k.revision;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(p_member,r,'nurse-assigned',m.user_id,jsonb_build_object('nurseId',p_nurse,'by','clinic-admin','clinicId',p_clinic,'membershipId',m.id));
 end if;
 if r=p_expected_revision then return jsonb_build_object('status','unchanged','revision',r);end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-care-team-changed',jsonb_build_object('memberId',p_member,'membershipId',m.id,'revision',r,
  'doctorFrom',before_doctor,'doctorTo',p_doctor,'nurseFrom',before_nurse,'nurseTo',p_nurse));
 return jsonb_build_object('status','committed','revision',r);
end$$;

-- 8. Grants ----------------------------------------------------------------------------------------
revoke all on function public._clinic_admin_full_access_enabled(),public._clinic_admin_member(uuid),public._clinic_admin_patient(uuid,uuid),public._clinic_admin_patients(uuid),
 public._clinic_admin_staff_json(uuid),public.clinic_admin_patients(uuid,text),public.clinic_admin_patient_record(uuid,uuid),
 public.clinic_admin_patient_profile_update(uuid,uuid,uuid,jsonb,text,date),public.clinic_admin_patient_care_team(uuid,uuid,bigint,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.clinic_admin_patients(uuid,text),public.clinic_admin_patient_record(uuid,uuid),
 public.clinic_admin_patient_profile_update(uuid,uuid,uuid,jsonb,text,date),public.clinic_admin_patient_care_team(uuid,uuid,bigint,uuid,uuid)to authenticated;
