-- Registrations (Khikar, 18 Oct): admins see everyone who signed up on the member side and which
-- journey step each person has reached, so nobody is lost before enrolment. Read-only and derived
-- from existing records; the step mapping is in docs/operations/registrations.md.
--
-- Admin only, through one definer function. Every call is recorded in access_audit as one
-- 'registrations.list' read by the admin (no member id: it is a list, the filters go in object_id).
-- It returns no clinical detail beyond the step and an urgent yes/no: no answers, readings, results,
-- plan text or the urgent rule id. Clinics and doctors get nothing here; clinic visibility stays
-- booking-based (P21).

-- The per-member lookups below would otherwise scan these tables once per person (review F1:
-- 2.5 s at 10k accounts without them, 0.16 s with them and the materialized facts).
create index clinic_booking_checkins_appointment on public.clinic_booking_checkins(appointment_id);
create index programme_checkins_member on public.programme_checkins(member_id);
create index patient_care_plans_member on public.patient_care_plans(user_id);

create function public.admin_member_registrations(p_step integer default null,p_stuck_days integer default null,p_limit integer default 500)
returns jsonb language plpgsql volatile security definer set search_path=''as $$
declare a uuid:=public._real_staff_require_admin();r jsonb;
begin
 if p_step is not null and p_step not between 1 and 10 then raise invalid_parameter_value using message='Unknown step';end if;
 if p_stuck_days is not null and p_stuck_days not between 1 and 365 then raise invalid_parameter_value using message='Stuck days out of range';end if;
 if p_limit is null or p_limit not between 1 and 1000 then raise invalid_parameter_value using message='Limit out of range';end if;
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
  values(a,'admin',null,'registrations.list',nullif(concat_ws(';','step='||p_step,'stuck='||p_stuck_days),''),left(auth.jwt()->>'session_id',80));

 with people as(
  -- Member-side accounts: not staff or clinic users (current or removed), not banned, deleted or anonymous.
  select u.id,u.created_at,u.last_sign_in_at,u.phone,u.email
  from auth.users u
  where u.deleted_at is null and not u.is_anonymous
   and(u.banned_until is null or u.banned_until<=clock_timestamp())
   and not exists(select 1 from public.workspace_staff s where s.user_id=u.id)
   and not exists(select 1 from public.clinic_portal_memberships m where m.user_id=u.id)
   -- A clinic invitee has an auth user from verification, before (or without) a membership (review F2).
   and not exists(select 1 from public.clinic_portal_invitations i where i.auth_user_id=u.id)
 ),facts as materialized(
  select p.*,
   nullif(btrim(pr.display_name),'')as name,
   pr.updated_at as profile_at,
   (nullif(btrim(pr.display_name),'')is not null and pr.birth_date is not null and pr.biological_sex in('male','female'))as profile_done,
   (select min(c.accepted_at)from public.patient_consents c where c.user_id=p.id)as consent_at,
   pa.updated_at as assessment_at,pa.completed_at as assessment_done_at,
   -- Started means an answer beyond the two the profile step writes (age and sex).
   (pa.completed_at is not null or exists(select 1 from pg_catalog.jsonb_object_keys(pa.answers)k where k not in('q1.age','q1.sex')))as assessment_started,
   (pa.urgent_rule is not null)as urgent,
   cc.created_at as enrolled_at,(cc.assigned_doctor_id is not null)as doctor_assigned,cc.updated_at as case_at,
   (select min(x.at)from(
     select t.created_at at from public.patient_test_requests t where t.user_id=p.id and t.status<>'cancelled'
     union all select b.created_at from public.booking_appointments b where b.member_id=p.id and b.status in('confirmed','notification-pending'))x)as booked_at,
   (select max(t.updated_at)from public.patient_test_requests t where t.user_id=p.id)as booking_changed_at,
   (select min(x.at)from(
     select v.created_at at from public.patient_care_visits v where v.user_id=p.id
     union all select k.recorded_at from public.clinic_booking_checkins k join public.booking_appointments b on b.id=k.appointment_id where b.member_id=p.id and k.outcome='arrived')x)as visit_at,
   (select min(x.at)from(
     -- A retracted "results received" stage does not count (review F3).
     select l.recorded_at at from public.patient_care_lab_stages l where l.user_id=p.id and l.stage='results-received'
      and not exists(select 1 from public.patient_care_lab_stages x where x.retracts=l.id)
     union all select ra.created_at from public.clinic_result_attachments ra where ra.user_id=p.id
     union all select cr.received_at from public.patient_care_results cr where cr.user_id=p.id and cr.source in('clinic','laboratory'))x)as results_at,
   (select min(pb.published_at)from public.patient_clinical_publications pb where pb.user_id=p.id)as plan_at,
   (select max(pb.published_at)from public.patient_clinical_publications pb where pb.user_id=p.id)as plan_latest_at,
   (select max(m.created_at)from public.patient_measurements m where m.user_id=p.id)as reading_at
  from people p
  left join public.profiles pr on pr.id=p.id
  left join public.patient_assessments pa on pa.user_id=p.id
  left join public.patient_clinical_cases cc on cc.user_id=p.id
 ),programme as(
  -- In the programme: a published plan, then the member acted on it (acknowledged the current plan,
  -- sent a home reading after the first plan, or sent a programme check-in).
  select f.*,
   case when f.plan_at is null then null else(select min(x.at)from(
     select cp.acknowledged_at at from public.patient_care_plans cp join public.patient_clinical_publications pb on pb.plan_id=cp.id where cp.user_id=f.id and cp.acknowledged_at is not null
     union all select min(m.created_at)from public.patient_measurements m where m.user_id=f.id and m.created_at>f.plan_at
     union all select min(ci.submitted_at)from public.programme_checkins ci where ci.member_id=f.id)x)end as programme_at
  from facts f
 ),stepped as(
  select g.*,
   case when g.programme_at is not null then 10 when g.plan_at is not null then 9 when g.results_at is not null then 8
    when g.visit_at is not null then 7 when g.booked_at is not null then 6 when g.enrolled_at is not null then 5
    when g.assessment_started then 4 when g.consent_at is not null then 3 when g.profile_done then 2 else 1 end as step
  from programme g
 ),dated as(
  select s.*,
   case s.step when 10 then s.programme_at when 9 then s.plan_at when 8 then s.results_at when 7 then s.visit_at
    when 6 then s.booked_at when 5 then s.enrolled_at when 4 then coalesce(s.assessment_done_at,s.assessment_at)
    when 3 then s.consent_at when 2 then s.profile_at else s.created_at end as step_at,
   greatest(s.created_at,s.last_sign_in_at,s.profile_at,s.consent_at,s.assessment_at,s.case_at,s.booked_at,s.booking_changed_at,
    s.visit_at,s.results_at,s.plan_latest_at,s.programme_at,s.reading_at)as last_activity_at
  from stepped s
 ),chosen as(
  select d.* from dated d
  where(p_step is null or d.step=p_step)
   and(p_stuck_days is null or(d.step<10 and d.step_at<clock_timestamp()-make_interval(days=>p_stuck_days)))
 )
 select jsonb_build_object(
  'ok',true,'asOf',clock_timestamp(),
  'counts',(select jsonb_object_agg(n::text,(select count(*)from dated d where d.step=n))from generate_series(1,10)n),
  'total',(select count(*)from dated),
  'matching',(select count(*)from chosen),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'name',c.name,
    'phoneMasked',case when length(c.phone)>=10 then '+'||left(c.phone,3)||' ••• '||right(c.phone,3) when c.phone is not null then '+'||left(c.phone,3)||' •••' end,
    'signedUpAt',c.created_at,
    'channel',case when exists(select 1 from public.telegram_auth_bindings tb where tb.auth_user_id=c.id and tb.kind='member'and tb.active)then 'telegram'
     when c.phone is not null then 'phone' when c.email is not null then 'email' else 'other'end,
    'step',c.step,'stepAt',c.step_at,
    'questionnaire',case when c.assessment_done_at is not null then 'completed' when c.assessment_started then 'started' end,
    'urgent',c.urgent,
    'enrolled',c.enrolled_at is not null,'doctorAssigned',c.doctor_assigned,
    'lastActivityAt',c.last_activity_at)order by c.last_activity_at desc,c.id)
   from(select * from chosen order by last_activity_at desc,id limit p_limit)c),'[]'::jsonb)
 )into r;
 return r;
end$$;
revoke all on function public.admin_member_registrations(integer,integer,integer)from public,anon,authenticated,service_role;
grant execute on function public.admin_member_registrations(integer,integer,integer)to authenticated;
