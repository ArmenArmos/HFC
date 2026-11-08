-- S1-11c: clinic identity and care-team changes need a second approver.
-- Stamp 20261104172700 from the integrator (S1-11 part c).
create table public.clinic_admin_change_requests (
 id uuid primary key default gen_random_uuid(),
 clinic_id uuid not null references public.workspace_clinics(id),
 member_id uuid not null references auth.users(id),
 kind text not null check(kind in ('profile','care_team')),
 requested_by uuid not null references auth.users(id),
 requested_membership uuid not null references public.clinic_portal_memberships(id),
 submission_id uuid not null,
 expected jsonb not null, proposed jsonb not null, before jsonb not null,
 state text not null default 'pending' check(state in ('pending','approved','rejected','cancelled','stale','expired')),
 decided_by uuid references auth.users(id),
 decided_via text check(decided_via in ('clinic_admin','platform_admin')),
 decision_note text check(length(decision_note)<=500),
 decided_at timestamptz, created_at timestamptz not null default clock_timestamp(),
 unique(requested_by,submission_id)
);
create unique index clinic_admin_change_requests_pending on public.clinic_admin_change_requests(member_id,kind) where state='pending';
create index clinic_admin_change_requests_clinic on public.clinic_admin_change_requests(clinic_id,created_at desc);
alter table public.clinic_admin_change_requests enable row level security;
revoke all on public.clinic_admin_change_requests from public,anon,authenticated,service_role;
alter table public.clinic_member_profile_changes add column approved_by uuid references auth.users(id);

-- Final-state transfer, called once after all updates (including clear_patient_nurse).
-- We retain pinned work if a doctor is removed without a replacement. No timer or
-- routing snapshot is changed. Clinic actors fit the alert audit's UUID column;
-- coordination's staff FK uses the final doctor as the system's representative,
-- with the actual actor and request recorded in detail. Each task event needs its
-- own unique request_id; the approval request is linked through detail.requestId.
create function public._care_team_reconcile(p_member uuid,p_actor uuid,p_via text,p_request uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
declare c public.patient_clinical_cases; a public.care_alerts; t public.patient_coordination_tasks;
 actor public.workspace_staff; target uuid; old_name text; recipient record; mid uuid;
 settings public.care_alert_settings:=public._care_alert_settings();
begin
 select * into c from public.patient_clinical_cases where user_id=p_member for update;
 if not found then return;end if;
 -- A clinic approval is always a system transfer named after the clinic admin, even when that
 -- person also has a staff row (review r2 F3); staff writers keep their own name and role.
 if p_via='clinic_admin' then
  actor.user_id:=c.assigned_doctor_id;actor.role:='system';
  select m.display_name into actor.display_name from public.clinic_portal_memberships m
   join public.clinic_admin_change_requests r on r.clinic_id=m.clinic_id
   where r.id=p_request and m.user_id=p_actor;
  actor.display_name:=coalesce(actor.display_name,'');
 else
  select * into actor from public.workspace_staff where user_id=p_actor;
  if not found then actor.user_id:=c.assigned_doctor_id;actor.role:='system';actor.display_name:='';end if;
 end if;
 if c.assigned_doctor_id is not null then
  for a in select * from public.care_alerts where member_id=p_member and state in ('open','acknowledged')
   and doctor_id is distinct from c.assigned_doctor_id order by id for update loop
   update public.care_alerts set doctor_id=c.assigned_doctor_id where id=a.id;
   insert into public.care_alert_audit(alert_id,actor_id,kind,detail) values(a.id,p_actor,'reassigned',
    jsonb_build_object('fromDoctor',a.doctor_id,'toDoctor',c.assigned_doctor_id,'via',p_via,'requestId',p_request));
   -- Same outbox and delivery uniqueness as _care_alert_notify; only the new
   -- doctor is eligible. Bypass repeat throttling and role routing for this handoff.
   if settings.telegram_delivery is true and not(settings.sandbox_test_accounts is true
    and exists(select 1 from public.profiles where id=p_member and is_test_account)) then
    for recipient in select distinct on(s.user_id) s.user_id,b.address,b.principal_ref
     from public.workspace_staff s join public.telegram_auth_bindings b on b.auth_user_id=s.user_id and b.kind='staff' and b.active
     where s.user_id=c.assigned_doctor_id and s.role='doctor' and s.active and s.removed_at is null
      and not public._test_member_hidden(p_member,s.user_id) order by s.user_id loop
     if not exists(select 1 from public.care_alert_deliveries where alert_id=a.id and recipient_id=recipient.user_id and occurrence=a.occurrences) then
      mid:=public._telegram_auth_enqueue('care_alert.staff_notice',public._telegram_auth_locale(recipient.user_id),recipient.address,recipient.principal_ref,null,null);
      if mid is not null then
       insert into public.care_alert_deliveries(alert_id,recipient_id,channel,telegram_message_id,occurrence)
        values(a.id,recipient.user_id,'telegram',mid,a.occurrences);
      end if;
     end if;
    end loop;
   end if;
  end loop;
 end if;
 for t in select * from public.patient_coordination_tasks where patient_case_id=p_member
  and status in ('open','awaiting-member','awaiting-doctor')
  and owner_id is distinct from c.assigned_doctor_id and owner_id is distinct from c.assigned_nurse_id
  order by id for update loop
  if exists(select 1 from public.workspace_staff where user_id=t.owner_id and role='nurse') then
   target:=coalesce(c.assigned_nurse_id,c.assigned_doctor_id);
  else target:=c.assigned_doctor_id;end if;
  if target is null or target=t.owner_id then continue;end if;
  select display_name into old_name from public.workspace_staff where user_id=t.owner_id;
  update public.patient_coordination_tasks set owner_id=target,revision=revision+1,updated_at=clock_timestamp() where id=t.id;
  insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,old_status,new_status,old_owner_id,new_owner_id,note,detail)
   values(t.id,t.revision+1,gen_random_uuid(),actor.user_id,actor.display_name,actor.role,'reassign',t.status,t.status,t.owner_id,target,
    'Care team changed. Was: '||coalesce(old_name,'')||'.',jsonb_build_object('input',jsonb_build_object('ownerId',target),'before',null,'actorId',p_actor,'via',p_via,'requestId',p_request,'approvedBy',p_actor,'system',true));
 end loop;
end $$;

-- Validate and lock exactly the member rows used by the old writers. Shared by
-- request and decision so an approval cannot bypass current scope/staff checks.
create function public._clinic_admin_change_prepare(p_clinic uuid,p_member uuid,p_kind text,p_expected jsonb,p_proposed jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare p public.profiles;a public.patient_assessments;k public.patient_clinical_cases;current_clinic uuid;new_name text;birth date;yrs int;
 doctor uuid;nurse uuid;v_before jsonb;v_after jsonb;
begin
 if p_member is null or p_kind is null or p_kind not in ('profile','care_team')
  or jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_proposed) is distinct from 'object' then return jsonb_build_object('status','invalid');end if;
 if not public._clinic_admin_patient(p_clinic,p_member) then return jsonb_build_object('status','refused');end if;
 if p_kind='profile' then
  if not(p_expected ?& array['name','birthDate']) or not(p_proposed ?& array['name','birthDate'])
   or exists(select 1 from jsonb_object_keys(p_expected) x where x not in ('name','birthDate'))
   or exists(select 1 from jsonb_object_keys(p_proposed) x where x not in ('name','birthDate'))
   or jsonb_typeof(p_proposed->'name') is distinct from 'string'
   or jsonb_typeof(p_proposed->'birthDate') is distinct from 'string' then return jsonb_build_object('status','invalid');end if;
  new_name:=btrim(p_proposed->>'name');
  if (p_proposed->>'birthDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return jsonb_build_object('status','invalid');end if;
  birth:=(p_proposed->>'birthDate')::date;
  yrs:=extract(year from age((clock_timestamp() at time zone 'Asia/Yerevan')::date,birth))::int;
  if length(new_name) not between 1 and 100 or new_name~'[[:cntrl:]]' or yrs not between 18 and 110 then return jsonb_build_object('status','invalid');end if;
  select * into p from public.profiles where id=p_member for update;
  v_before:=jsonb_build_object('name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',p.birth_date);
  if p_expected is distinct from v_before then return jsonb_build_object('status','stale');end if;
  -- Preserve the later F1 fix: never leave an existing questionnaire's age stale.
  if birth is distinct from p.birth_date then
   select * into a from public.patient_assessments where user_id=p_member for share;
   if found and p.birth_date is not null and extract(year from age(a.assessment_date,birth))<>extract(year from age(a.assessment_date,p.birth_date)) then
    return jsonb_build_object('status','age-changes');
   end if;
  end if;
  v_after:=jsonb_build_object('name',new_name,'birthDate',birth);
 else
  if not(p_expected ? 'revision') or not(p_proposed ?& array['doctorId','nurseId'])
   or exists(select 1 from jsonb_object_keys(p_expected) x where x<>'revision')
   or exists(select 1 from jsonb_object_keys(p_proposed) x where x not in ('doctorId','nurseId'))
   or jsonb_typeof(p_expected->'revision') is distinct from 'number'
   or jsonb_typeof(p_proposed->'doctorId') is distinct from 'string'
   or jsonb_typeof(p_proposed->'nurseId') not in ('string','null') then return jsonb_build_object('status','invalid');end if;
  doctor:=(p_proposed->>'doctorId')::uuid;nurse:=(p_proposed->>'nurseId')::uuid;
  if doctor is null or (p_expected->>'revision')::bigint is null then return jsonb_build_object('status','invalid');end if;
  select * into k from public.patient_clinical_cases where user_id=p_member for update;
  if not found then return jsonb_build_object('status','not_enrolled');end if;
  if k.assigned_doctor_id is not null then
   select clinic_id into current_clinic from public.workspace_staff where user_id=k.assigned_doctor_id for share;
   if current_clinic is distinct from p_clinic then return jsonb_build_object('status','refused','reason','other_clinic');end if;
  end if;
  if k.revision is distinct from (p_expected->>'revision')::bigint then return jsonb_build_object('status','stale');end if;
  perform 1 from public.workspace_staff s join public.workspace_clinics c on c.id=s.clinic_id
   where s.user_id=doctor and s.role='doctor' and s.active and s.removed_at is null and s.clinic_id=p_clinic and c.active for share of s,c;
  if not found then return jsonb_build_object('status','rejected','reason','doctor_unavailable');end if;
  if nurse is not null then
   perform 1 from public.workspace_staff s where s.user_id=nurse and s.role='nurse' and s.active and s.removed_at is null and s.clinic_id=p_clinic for share;
   if not found then return jsonb_build_object('status','rejected','reason','nurse_unavailable');end if;
  end if;
  v_before:=jsonb_build_object('doctorId',k.assigned_doctor_id,'nurseId',k.assigned_nurse_id);
  v_after:=jsonb_build_object('doctorId',doctor,'nurseId',nurse);
 end if;
 if v_before=v_after then return jsonb_build_object('status','unchanged');end if;
 return jsonb_build_object('status','ready','before',v_before,'proposed',v_after,
  'fields',(select jsonb_agg(key order by key) from jsonb_each(v_after) where v_before->key is distinct from value));
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or numeric_value_out_of_range then
 return jsonb_build_object('status','invalid');
end $$;

create function public.clinic_admin_change_request(p_clinic uuid,p_member uuid,p_kind text,p_submission uuid,p_expected jsonb,p_proposed jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare m public.clinic_portal_memberships;prior public.clinic_admin_change_requests;prepared jsonb;rid uuid;expired public.clinic_admin_change_requests;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled() then return jsonb_build_object('status','disabled');end if;
 if p_submission is null or p_member is null or p_kind is null or p_kind not in ('profile','care_team') then return jsonb_build_object('status','invalid');end if;
 if not public._clinic_admin_patient(p_clinic,p_member) then return jsonb_build_object('status','refused');end if;
 if p_kind='profile' and jsonb_typeof(p_proposed)='object' and jsonb_typeof(p_proposed->'name')='string' then
  p_proposed:=p_proposed||jsonb_build_object('name',btrim(p_proposed->>'name'));
 end if;
 -- Serialize retries without taking a request row after a member lock. Decisions
 -- always lock the request first. Different kinds share their member-row locks.
 perform pg_advisory_xact_lock(hashtextextended('clinic-change-submission:'||m.user_id::text||':'||p_submission::text,0));
 select * into prior from public.clinic_admin_change_requests where requested_by=m.user_id and submission_id=p_submission;
 if found then
  if prior.clinic_id=p_clinic and prior.member_id=p_member and prior.kind=p_kind and prior.expected=p_expected and prior.proposed=p_proposed then
   return jsonb_build_object('status','pending','requestId',prior.id);
  end if;
  return jsonb_build_object('status','conflict');
 end if;
 perform pg_advisory_xact_lock(hashtextextended('clinic-change-member:'||p_member::text||':'||p_kind,0));
 -- Retire expired requests before taking member locks, preserving the decision order.
 for expired in select * from public.clinic_admin_change_requests where member_id=p_member and kind=p_kind and state='pending'
  and created_at<=clock_timestamp()-interval '7 days' for update loop
  update public.clinic_admin_change_requests set state='expired',decided_at=clock_timestamp() where id=expired.id;
  perform public._clinic_schedule_audit(expired.clinic_id,m.user_id,'change_expired',jsonb_build_object('requestId',expired.id,'memberId',p_member,'kind',p_kind));
 end loop;
 prepared:=public._clinic_admin_change_prepare(p_clinic,p_member,p_kind,p_expected,p_proposed);
 if prepared->>'status'<>'ready' then return prepared;end if;
 select id into rid from public.clinic_admin_change_requests where member_id=p_member and kind=p_kind and state='pending';
 if found then return jsonb_build_object('status','pending_exists','requestId',rid);end if;
 insert into public.clinic_admin_change_requests(clinic_id,member_id,kind,requested_by,requested_membership,submission_id,expected,proposed,before)
  values(p_clinic,p_member,p_kind,m.user_id,m.id,p_submission,p_expected,prepared->'proposed',prepared->'before') returning id into rid;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'change_requested',jsonb_build_object('requestId',rid,'memberId',p_member,'kind',p_kind,'fields',prepared->'fields'));
 return jsonb_build_object('status','pending','requestId',rid);
end $$;

-- A single renderer keeps staff/clinic summaries aligned; clinic birth dates are
-- reduced to years before crossing the RPC boundary, including historical rows.
create function public._clinic_admin_change_json(r public.clinic_admin_change_requests,p_full_dates boolean) returns jsonb
language sql volatile security definer set search_path='' as $$
 select jsonb_build_object(
  'id',r.id,'clinicId',r.clinic_id,'clinicName',(select name from public.workspace_clinics where id=r.clinic_id),
  'kind',r.kind,'memberId',r.member_id,'memberName',coalesce((select display_name from public.profiles where id=r.member_id),''),
  'requesterName',(select display_name from public.clinic_portal_memberships where id=r.requested_membership),
  'mine',r.requested_by=auth.uid(),'createdAt',r.created_at,'decidedAt',r.decided_at,
  'state',case when r.state='pending' and r.created_at<=clock_timestamp()-interval '7 days' then 'expired' else r.state end,
  'decisionNote',r.decision_note,'summary',
  case when r.kind='profile' then
   case when r.before->'name' is distinct from r.proposed->'name' then jsonb_build_object('name',jsonb_build_object('before',r.before->'name','after',r.proposed->'name')) else '{}'::jsonb end ||
   case when r.before->'birthDate' is distinct from r.proposed->'birthDate' then jsonb_build_object('birthDate',
    jsonb_build_object('beforeYear',extract(year from (r.before->>'birthDate')::date)::int,'afterYear',extract(year from (r.proposed->>'birthDate')::date)::int) ||
    case when p_full_dates then jsonb_build_object('before',r.before->'birthDate','after',r.proposed->'birthDate') else '{}'::jsonb end) else '{}'::jsonb end
  else
   case when r.before->'doctorId' is distinct from r.proposed->'doctorId' then jsonb_build_object('doctor',jsonb_build_object(
    'before',(select display_name from public.workspace_staff where user_id=(r.before->>'doctorId')::uuid),
    'after',(select display_name from public.workspace_staff where user_id=(r.proposed->>'doctorId')::uuid))) else '{}'::jsonb end ||
   case when r.before->'nurseId' is distinct from r.proposed->'nurseId' then jsonb_build_object('nurse',jsonb_build_object(
    'before',(select display_name from public.workspace_staff where user_id=(r.before->>'nurseId')::uuid),
    'after',(select display_name from public.workspace_staff where user_id=(r.proposed->>'nurseId')::uuid))) else '{}'::jsonb end
  end)
$$;

-- Latest masked/no-clinical record, with member-scoped pending summaries.
create or replace function public.clinic_admin_patient_record(p_clinic uuid, p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  'member',jsonb_build_object('memberId',p.id,'name',coalesce(nullif(btrim(p.display_name),''),''),'phone',null::text,'birthDate',null::date,
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
  'bookings',(select coalesce(jsonb_agg(r order by r->>'startsAt' desc,r->>'appointmentId'),'[]'::jsonb)from public.booking_appointments a cross join lateral public._clinic_schedule_row(p_clinic,a)r
   where a.member_id=p_member and r is not null and exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=p_clinic)),
  'assessment',null::jsonb,'measurements','[]'::jsonb,'tests','[]'::jsonb,'results','[]'::jsonb,'plan',null::jsonb,'memberDocuments','[]'::jsonb,'reports','[]'::jsonb,
  'visits',(select coalesce(jsonb_agg(jsonb_build_object('visitId',v.id,'visitedAt',v.created_at,'clinicName',(select c.name from public.workspace_clinics c where c.id=p_clinic),'thisClinic',true,
    'recordedBy',v.actor_name,'role',v.actor_role,'entries','[]'::jsonb)
    order by v.created_at desc,v.id),'[]'::jsonb)
   from(select * from public.patient_care_visits v where v.user_id=p_member and v.clinic_id=p_clinic order by v.created_at desc,v.id limit 100)v),
  'files',public._clinic_member_files(p_clinic,p_member),
  -- A member's banner must not disappear behind the 100-row clinic queue limit.
  'pendingRequests',(select coalesce(jsonb_agg(public._clinic_admin_change_json(cr,false) order by cr.created_at desc,cr.id),'[]'::jsonb)
   from public.clinic_admin_change_requests cr where cr.clinic_id=p_clinic and cr.member_id=p_member and cr.state='pending' and cr.created_at>clock_timestamp()-interval '7 days'),
  'profileChanges',(select coalesce(jsonb_agg(jsonb_build_object('at',h.created_at,'by',(select display_name from public.clinic_portal_memberships where id=h.membership_id),'before',public._clinic_member_identity_masked(h.before),'after',public._clinic_member_identity_masked(h.after))order by h.created_at desc,h.id),'[]'::jsonb)
   from(select * from public.clinic_member_profile_changes where member_id=p_member and clinic_id=p_clinic order by created_at desc,id limit 20)h));
end$function$
;

create function public._clinic_admin_change_list(p_clinic uuid,p_state text,p_full_dates boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare rows jsonb;listed public.clinic_admin_change_requests;actor uuid:=auth.uid();
begin
 if p_state is null or p_state not in ('pending','decided','approved','rejected','cancelled','stale','expired','all') then return jsonb_build_object('status','invalid');end if;
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]'::jsonb) into rows from (
  select r.id,r.created_at,public._clinic_admin_change_json(r,p_full_dates) item from public.clinic_admin_change_requests r
  where (p_clinic is null or r.clinic_id=p_clinic) and (
   p_state='all' or (p_state='pending' and r.state='pending' and r.created_at>clock_timestamp()-interval '7 days')
   or (p_state='decided' and (r.state<>'pending' or r.created_at<=clock_timestamp()-interval '7 days'))
   or (p_state='expired' and (r.state='expired' or (r.state='pending' and r.created_at<=clock_timestamp()-interval '7 days')))
   or (p_state not in ('pending','decided','expired') and r.state=p_state))
  order by r.created_at desc,r.id limit 100) x;
 -- Staff has full dates, so each returned member gets an access audit as well.
 if p_full_dates then
  for listed in select q.* from public.clinic_admin_change_requests q where q.id in (select (value->>'id')::uuid from jsonb_array_elements(rows)) loop
   perform public._clinic_schedule_audit(listed.clinic_id,actor,'change_request_viewed',jsonb_build_object('requestId',listed.id,'memberId',listed.member_id));
   perform public._access_audit_record(listed.member_id,'staff_clinic_change_requests',listed.id::text);
  end loop;
 end if;
 return jsonb_build_object('status','ok','requests',rows);
end $$;

create function public.clinic_admin_change_requests(p_clinic uuid,p_state text default 'pending') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare m public.clinic_portal_memberships;result jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled() then return jsonb_build_object('status','disabled');end if;
 result:=public._clinic_admin_change_list(p_clinic,p_state,false);
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'change_requests_listed',jsonb_build_object('state',p_state));
 return result;
end $$;
create function public.staff_clinic_change_requests(p_state text default 'pending') returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._real_staff_require_admin();
 return public._clinic_admin_change_list(null,p_state,true);
end $$;

-- Private shared decision engine. No caller can choose the platform path except
-- the guarded staff wrapper. Request first, then live authority, then member rows.
create function public._clinic_admin_change_decide(p_clinic uuid,p_request uuid,p_decision text,p_note text,p_platform boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.clinic_admin_change_requests;m public.clinic_portal_memberships;actor uuid;via text;
 prepared jsonb;k public.patient_clinical_cases;new_doctor uuid;new_nurse uuid;
 v_revision bigint;change uuid;note text:=btrim(coalesce(p_note,''));
begin
 perform set_config('lock_timeout','1500ms',true);
 select * into r from public.clinic_admin_change_requests where id=p_request for update;
 -- Always authorize, including for an unknown request id.
 if p_platform then actor:=public._real_staff_require_admin();via:='platform_admin';
 else
  m:=public._clinic_admin_member(p_clinic);actor:=m.user_id;via:='clinic_admin';
  if not public._clinic_admin_full_access_enabled() then return jsonb_build_object('status','disabled');end if;
 end if;
 if r.id is null or (not p_platform and r.clinic_id is distinct from p_clinic) then return jsonb_build_object('status','refused');end if;
 if p_decision is null or p_decision not in ('approve','reject','cancel') or (p_platform and p_decision='cancel') then return jsonb_build_object('status','invalid');end if;
 if p_decision='reject' and length(note) not between 5 and 500 then return jsonb_build_object('status','reason_required');end if;
 if length(note)>500 then return jsonb_build_object('status','invalid');end if;
 if p_decision='cancel' then
  if r.requested_by is distinct from actor then return jsonb_build_object('status','refused');end if;
 elsif r.requested_by=actor then return jsonb_build_object('status','self_approval');end if;
 if r.state<>'pending' then return jsonb_build_object('status',case when r.state='expired' then 'expired' else 'not_pending' end);end if;
 if r.created_at<=clock_timestamp()-interval '7 days' then
  update public.clinic_admin_change_requests set state='expired',decided_by=actor,decided_via=via,decided_at=clock_timestamp() where id=r.id;
  perform public._clinic_schedule_audit(r.clinic_id,actor,'change_expired',jsonb_build_object('requestId',r.id,'memberId',r.member_id,'kind',r.kind));
  if p_platform then perform public._access_audit_record(r.member_id,'staff_clinic_change_decide',r.id::text);end if;
  return jsonb_build_object('status','expired');
 end if;
 if p_decision in ('reject','cancel') then
  update public.clinic_admin_change_requests set state=case when p_decision='reject' then 'rejected' else 'cancelled' end,
   decided_by=actor,decided_via=via,decision_note=nullif(note,''),decided_at=clock_timestamp() where id=r.id;
  perform public._clinic_schedule_audit(r.clinic_id,actor,case when p_decision='reject' then 'change_rejected' else 'change_cancelled' end,
   jsonb_build_object('requestId',r.id,'memberId',r.member_id,'kind',r.kind));
  if p_platform then perform public._access_audit_record(r.member_id,'staff_clinic_change_decide',r.id::text);end if;
  return jsonb_build_object('status',case when p_decision='reject' then 'rejected' else 'cancelled' end);
 end if;
 -- A revoked requester's authority cannot be revived by approving an old request.
 perform 1 from public.clinic_portal_memberships rm join public.workspace_clinics c on c.id=rm.clinic_id
  where rm.id=r.requested_membership and rm.user_id=r.requested_by and rm.clinic_id=r.clinic_id and rm.active and rm.role='admin' and c.active for share of rm,c;
 if found then prepared:=public._clinic_admin_change_prepare(r.clinic_id,r.member_id,r.kind,r.expected,r.proposed);
 else prepared:=jsonb_build_object('status','refused');end if;
 if prepared->>'status'<>'ready' then
  update public.clinic_admin_change_requests set state='stale',decided_by=actor,decided_via=via,decided_at=clock_timestamp() where id=r.id;
  perform public._clinic_schedule_audit(r.clinic_id,actor,'change_stale',jsonb_build_object('requestId',r.id,'memberId',r.member_id,'kind',r.kind));
  if p_platform then perform public._access_audit_record(r.member_id,'staff_clinic_change_decide',r.id::text);end if;
  return jsonb_build_object('status','stale');
 end if;
 if r.kind='profile' then
  update public.profiles set display_name=r.proposed->>'name',birth_date=(r.proposed->>'birthDate')::date,updated_at=now() where id=r.member_id;
  insert into public.clinic_member_profile_changes(clinic_id,actor_id,membership_id,member_id,submission_id,before,after,approved_by)
   values(r.clinic_id,r.requested_by,r.requested_membership,r.member_id,r.submission_id,r.before,r.proposed,actor) returning id into change;
 else
  select * into k from public.patient_clinical_cases where user_id=r.member_id;
  new_doctor:=(r.proposed->>'doctorId')::uuid;new_nurse:=(r.proposed->>'nurseId')::uuid;
  if k.assigned_doctor_id is distinct from new_doctor then
   update public.patient_clinical_cases set assigned_doctor_id=new_doctor,revision=revision+1,updated_at=now() where user_id=r.member_id returning * into k;
   insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(r.member_id,k.revision,'assigned',r.requested_by,
    jsonb_build_object('doctorId',new_doctor,'by','clinic-admin','clinicId',r.clinic_id,'membershipId',r.requested_membership,'requestId',r.id,'approvedBy',actor));
  end if;
  if k.assigned_nurse_id is distinct from new_nurse then
   update public.patient_clinical_cases set assigned_nurse_id=new_nurse,revision=revision+1,updated_at=now() where user_id=r.member_id returning * into k;
   insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(r.member_id,k.revision,'nurse-assigned',r.requested_by,
    jsonb_build_object('nurseId',new_nurse,'by','clinic-admin','clinicId',r.clinic_id,'membershipId',r.requested_membership,'requestId',r.id,'approvedBy',actor));
  end if;
  perform public._care_team_reconcile(r.member_id,actor,via,r.id);
 end if;
 update public.clinic_admin_change_requests set state='approved',decided_by=actor,decided_via=via,decision_note=nullif(note,''),decided_at=clock_timestamp() where id=r.id;
 perform public._clinic_schedule_audit(r.clinic_id,actor,'change_approved',jsonb_build_object('requestId',r.id,'memberId',r.member_id,'kind',r.kind,'fields',prepared->'fields','changeId',change));
 if p_platform then perform public._access_audit_record(r.member_id,'staff_clinic_change_decide',r.id::text);end if;
 return jsonb_build_object('status','approved');
end $$;
create function public.clinic_admin_change_decide(p_clinic uuid,p_request uuid,p_decision text,p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin return public._clinic_admin_change_decide(p_clinic,p_request,p_decision,p_note,false);end $$;
create function public.staff_clinic_change_decide(p_request uuid,p_decision text,p_note text default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin return public._clinic_admin_change_decide(null,p_request,p_decision,p_note,true);end $$;

-- Fail closed during the schema/app deployment window. Keep existing refusals.
create or replace function public.clinic_admin_patient_profile_update(p_clinic uuid,p_member uuid,p_submission uuid,p_expected jsonb,p_name text,p_birth_date date)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;p public.profiles;prior public.clinic_member_profile_changes;new_name text:=btrim(coalesce(p_name,''));
 today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;yrs int;v_before jsonb;v_after jsonb;change uuid;a public.patient_assessments;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_submission is null or p_member is null then return jsonb_build_object('status','invalid');end if;
 select * into prior from public.clinic_member_profile_changes where actor_id=m.user_id and submission_id=p_submission;
 if found then
  return case when prior.member_id=p_member and prior.clinic_id=p_clinic and prior.after=jsonb_build_object('name',new_name,'birthDate',p_birth_date)
   then jsonb_build_object('status','disabled')else jsonb_build_object('status','conflict')end;
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
 -- The questionnaire records the age on its assessment date; a new date of birth must not change it (F1).
 if p_birth_date is distinct from p.birth_date then
  select * into a from public.patient_assessments where user_id=p_member for share;
  if found and p.birth_date is not null and extract(year from age(a.assessment_date,p_birth_date))<>extract(year from age(a.assessment_date,p.birth_date))then
   perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-profile-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id,'reason','age-changes'));
   return jsonb_build_object('status','age-changes');
  end if;
 end if;
 v_before:=jsonb_build_object('name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',p.birth_date);
 v_after:=jsonb_build_object('name',new_name,'birthDate',p_birth_date);
 if v_before=v_after then return jsonb_build_object('status','unchanged');end if;
 return jsonb_build_object('status','disabled');
end$$;

create or replace function public.clinic_admin_patient_care_team(p_clinic uuid,p_member uuid,p_expected_revision bigint,p_doctor uuid,p_nurse uuid default null)returns jsonb
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
 return jsonb_build_object('status','disabled');
end$$;

-- Latest staff writers, with one final-state handoff per call.
create or replace function public.assign_patient_clinical_case(p_user_id uuid,p_expected_revision bigint,p_doctor_id uuid default null) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;n bigint;
begin
 perform public._real_staff_require_admin();
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
 perform public._care_team_reconcile(p_user_id,auth.uid(),'staff',null);
 return n;
end $$;
create or replace function public.assign_case_nurse(p_id uuid,p_actor uuid,p_revision bigint,p_nurse uuid default null,p_native boolean default false) returns bigint
language plpgsql security definer set search_path='' as $$
declare d uuid;r bigint;
begin
 if p_native then select assigned_doctor_id,revision into d,r from public.patient_clinical_cases where user_id=p_id for update;
 else select assigned_doctor_id,revision into d,r from public.workspace_cases where id=p_id and expires_at>now() for update;end if;
 if not found then raise insufficient_privilege using message='Case unavailable';end if;
 perform 1 from public.workspace_staff where user_id=p_actor and role='admin' and active for share;
 if not found then raise insufficient_privilege using message='Administrator required';end if;
 if r is distinct from p_revision then raise serialization_failure using message='Case changed';end if;
 if p_nurse is not null then
  perform 1 from public.workspace_staff n join public.workspace_staff doctor on doctor.user_id=d join public.workspace_clinics k on k.id=n.clinic_id
  where n.user_id=p_nurse and n.role='nurse' and n.active and doctor.role='doctor' and doctor.active and doctor.clinic_id=n.clinic_id and k.active for share of n,doctor,k;
  if not found then raise insufficient_privilege using message='Choose an active nurse in the assigned doctor clinic';end if;
 end if;
 if p_native then
  update public.patient_clinical_cases set assigned_nurse_id=p_nurse,revision=revision+1,updated_at=now() where user_id=p_id returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_id,r,'nurse-assigned',p_actor,jsonb_build_object('nurseId',p_nurse));
 else
  perform public.workspace_set_actor(p_actor,p_id);
  update public.workspace_cases set assigned_nurse_id=p_nurse,revision=revision+1 where id=p_id returning revision into r;
  perform public.workspace_record_event(p_id,'nurse-assignment.changed',r::integer);
 end if;
 if p_native then perform public._care_team_reconcile(p_id,p_actor,'staff',null);end if;
 return r;
end $$;

-- Latest enrolment writer, with reconciliation after both automatic assignments.
create or replace function public.enroll_patient_clinical_case() returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();inserted uuid;doctor uuid;nurse uuid;n bigint;tries integer:=0;
begin
 if uid is null then raise insufficient_privilege using message='Verified membership required';end if;
 perform 1 from auth.users where id=uid and phone is not null and phone_confirmed_at is not null for share;
 if not found or not exists(select 1 from public.profiles where id=uid and nullif(btrim(display_name),'') is not null and birth_date is not null and biological_sex in ('male','female'))
 or not exists(select 1 from public.patient_consents where user_id=uid and version='patient-pilot-v1')
 or not exists(select 1 from public.patient_assessments where user_id=uid) then raise insufficient_privilege using message='Complete your verified profile and consent first';end if;
 insert into public.patient_clinical_cases(user_id) values(uid) on conflict do nothing returning user_id into inserted;
 if inserted is not null then
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id) values(uid,0,'enrolled',uid);
  -- Concurrent enrolments choose one at a time, so the load counts stay fair.
  perform pg_advisory_xact_lock(hashtextextended('auto-assign-doctor',0));
  -- Lock the chosen doctor with the full eligibility check, as admin assignment does: a doctor
  -- removed, moved or whose clinic closed meanwhile is not assigned; choose again (review F1).
  loop
   doctor:=public._auto_assign_doctor();tries:=tries+1;
   exit when doctor is null;
   perform 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
    where s.user_id=doctor and s.role='doctor'and s.active and s.removed_at is null and k.active for share of s,k;
   exit when found;
   doctor:=null;
   exit when tries>=3;
  end loop;
  if doctor is not null then
   update public.patient_clinical_cases set assigned_doctor_id=doctor,revision=revision+1,updated_at=now() where user_id=uid returning revision into n;
   -- The case event needs an Auth actor: the enrolling member's own action, marked as the system's choice.
   insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(uid,n,'assigned',uid,jsonb_build_object('doctorId',doctor,'by','system','reason','auto_least_loaded_on_enrolment'));
   -- The nurse comes after the doctor (clear_patient_nurse empties the nurse when the doctor
   -- changes) and from the doctor's clinic, as admin assignment requires (assign_case_nurse).
   tries:=0;
   loop
    nurse:=public._auto_assign_nurse(doctor);tries:=tries+1;
    exit when nurse is null;
    perform 1 from public.workspace_staff s join public.workspace_staff d on d.user_id=doctor join public.workspace_clinics k on k.id=s.clinic_id
     where s.user_id=nurse and s.role='nurse'and s.active and s.removed_at is null and d.clinic_id=s.clinic_id and k.active for share of s,k;
    exit when found;
    nurse:=null;
    exit when tries>=3;
   end loop;
   if nurse is not null then
    update public.patient_clinical_cases set assigned_nurse_id=nurse,revision=revision+1,updated_at=now() where user_id=uid returning revision into n;
    insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
    values(uid,n,'nurse-assigned',uid,jsonb_build_object('nurseId',nurse,'by','system','reason','auto_least_loaded_on_enrolment'));
   end if;
  end if;
  -- Only a new case: a repeated enrolment changes no team, so it moves nothing (review r2 F2).
  perform public._care_team_reconcile(uid,uid,'enrolment',null);
 end if;
 return uid;
end $$;

-- Private helpers are deliberately unavailable even to service_role.
revoke all on function public._care_team_reconcile(uuid,uuid,text,uuid),
 public._clinic_admin_change_prepare(uuid,uuid,text,jsonb,jsonb),
 public._clinic_admin_change_json(public.clinic_admin_change_requests,boolean),
 public._clinic_admin_change_list(uuid,text,boolean),
 public._clinic_admin_change_decide(uuid,uuid,text,text,boolean),
 public.clinic_admin_change_request(uuid,uuid,text,uuid,jsonb,jsonb),
 public.clinic_admin_change_requests(uuid,text),public.clinic_admin_change_decide(uuid,uuid,text,text),
 public.staff_clinic_change_requests(text),public.staff_clinic_change_decide(uuid,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.clinic_admin_change_request(uuid,uuid,text,uuid,jsonb,jsonb),
 public.clinic_admin_change_requests(uuid,text),public.clinic_admin_change_decide(uuid,uuid,text,text),
 public.staff_clinic_change_requests(text),public.staff_clinic_change_decide(uuid,text,text) to authenticated;

-- Serialize an alert raise with final-state assignment/rerouting. Otherwise a
-- concurrent raise can pin an old doctor after the rerouting scan has completed.
-- Lock order matches the writers: case, then alert. The rest is the latest body.
create or replace function public._care_alert_raise(p_member uuid,p_source text,p_reason text,p_red_flags text[],p_rule text,p_rule_version text,p_source_ref text)returns uuid
language plpgsql security definer set search_path=''as $$
declare a public.care_alerts;doc uuid;
begin
 select assigned_doctor_id into doc from public.patient_clinical_cases where user_id=p_member for share;
 perform pg_advisory_xact_lock(hashtextextended('care-alert:'||p_member::text||':'||p_source,0));
 select * into a from public.care_alerts where member_id=p_member and source=p_source and state<>'resolved'for update;
 if found then
  -- New information reopens an acknowledged alert so it is looked at again.
  update public.care_alerts set occurrences=occurrences+1,last_seen_at=clock_timestamp(),state_seq=state_seq+1,state='open',
   red_flags=(select coalesce(array_agg(distinct f order by f),'{}')from unnest(red_flags||coalesce(p_red_flags,'{}'))f),
   doctor_id=coalesce(doc,doctor_id)where id=a.id returning * into a;
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,null,'repeated',jsonb_build_object('sourceRef',p_source_ref,'reason',p_reason,'redFlags',p_red_flags));
  perform public._care_alert_trace(a,'care_alert.repeated','escalate',p_reason,'system',null,jsonb_build_object('noreon.care_alert.source_ref',p_source_ref));
 else
  insert into public.care_alerts(member_id,source,reason_code,red_flags,rule_id,rule_version,source_ref,doctor_id)
  values(p_member,p_source,p_reason,coalesce(p_red_flags,'{}'),p_rule,p_rule_version,p_source_ref,doc)returning * into a;
  insert into public.care_alert_audit(alert_id,actor_id,kind,detail)values(a.id,null,'raised',jsonb_build_object('sourceRef',p_source_ref,'reason',p_reason,'redFlags',p_red_flags,'doctorId',doc));
  perform public._care_alert_trace(a,'care_alert.raised','escalate',p_reason,'system',null,
   jsonb_build_object('noreon.care_alert.source_ref',p_source_ref,'noreon.doctor.id',doc,'noreon.care_alert.assigned_doctor',doc is not null));
 end if;
 perform public._care_alert_notify(a);
 return a.id;
end$$;


-- The automatic nurse task must read the team under the same case lock too.
-- Otherwise a task created concurrently can appear after the rerouting scan.
create or replace function public._zoe_nurse_first_task()returns trigger
language plpgsql security definer set search_path=''as $$
declare z public.zoe_runs;c public.conversations;k public.patient_clinical_cases;task uuid;done text;
begin
 select * into z from public.zoe_runs where id=(new.detail->>'runId')::uuid;
 if z.id is null or z.outcome is distinct from 'answered'or new.detail->>'forward'is distinct from 'auto'
  or new.detail->>'urgency'not in('none','self_monitoring','planned','doctor_soon')then return new;end if;
 begin
  select * into c from public.conversations where id=new.conversation_id;
  select * into k from public.patient_clinical_cases where user_id=c.member_id for share;
  task:=md5('zoe-nurse-first:'||z.id::text)::uuid;
  if not exists(select 1 from public.nurse_chat_settings where singleton and enabled)then done:='nurse_chat_off';
  elsif k.assigned_nurse_id is null or not public._patient_coordination_owner_valid(c.member_id,k.assigned_nurse_id,false)then done:='no_assigned_nurse';
  elsif exists(select 1 from public.patient_coordination_tasks t where t.patient_case_id=c.member_id and t.kind='contact-followup'and t.title='Mild side effect from Zoe'
   and t.status not in('completed','cancelled'))then done:='already_open';
  else
   insert into public.patient_coordination_tasks(id,patient_case_id,kind,title,instructions,creator_id,owner_id)values(task,c.member_id,'contact-followup','Mild side effect from Zoe',
    'Zoe recorded a mild side effect. Read the conversation, collect the details and write a note for the doctor. Do not advise stopping, reducing or switching a medicine.',k.assigned_doctor_id,k.assigned_nurse_id);
   insert into public.patient_coordination_events(task_id,revision,request_id,actor_id,actor_name,actor_role,operation,new_status,new_owner_id,detail)
   values(task,1,md5('zoe-nurse-first-request:'||z.id::text)::uuid,k.assigned_doctor_id,'Zoe','system','create','open',k.assigned_nurse_id,jsonb_build_object('input',jsonb_build_object('runId',z.id)));
   done:='task';
  end if;
 exception when others then done:='failed';
 end;
 insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(new.conversation_id,null,'zoe.nurse_first',jsonb_build_object('runId',z.id,'outcome',done));
 return new;
end$$;

