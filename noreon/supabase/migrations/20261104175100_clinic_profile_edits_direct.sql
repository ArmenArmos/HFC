-- Clinic profile edits apply immediately; only care-team changes need approval.
-- Stamp 20261104175100 assigned by the integrator (Khikar 5 Nov 20:58).

alter table public.clinic_admin_change_requests drop constraint clinic_admin_change_requests_state_check;
alter table public.clinic_admin_change_requests add constraint clinic_admin_change_requests_state_check
 check(state in ('pending','approved','rejected','cancelled','stale','expired','applied','superseded'));

-- Private apply path shared by new submissions and the migration backfill. The
-- request holds the immutable expected/before/proposed values and original actor.
-- No approver is invented. Full values stay in the existing private history table.
create function public._clinic_profile_apply(p_request uuid,p_backfill boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r public.clinic_admin_change_requests;prepared jsonb;change uuid;event text;
begin
 select * into r from public.clinic_admin_change_requests where id=p_request for update;
 if r.id is null or r.kind<>'profile' or r.state<>'pending' then
  return jsonb_build_object('status','not_pending');
 end if;
 -- Recheck the requester's live authority, including during migration replay.
 perform 1 from public.clinic_portal_memberships m join public.workspace_clinics c on c.id=m.clinic_id
  where m.id=r.requested_membership and m.user_id=r.requested_by and m.clinic_id=r.clinic_id
   and m.active and m.role='admin' and c.active for share of m,c;
 if found then prepared:=public._clinic_admin_change_prepare(r.clinic_id,r.member_id,'profile',r.expected,r.proposed);
 else prepared:=jsonb_build_object('status','refused');end if;
 if prepared->>'status'<>'ready' or prepared->'before' is distinct from r.before then
  if not p_backfill then raise serialization_failure using message='Profile changed. Reload before saving';end if;
  update public.clinic_admin_change_requests set state='superseded',decided_at=clock_timestamp(),
   decision_note='Superseded when profile approval was removed' where id=r.id;
  perform public._clinic_schedule_audit(r.clinic_id,r.requested_by,'profile_superseded',
   jsonb_build_object('requestId',r.id,'memberId',r.member_id,'kind','profile','reason',prepared->>'status'));
  return jsonb_build_object('status','superseded');
 end if;
 update public.profiles set display_name=prepared#>>'{proposed,name}',birth_date=(prepared#>>'{proposed,birthDate}')::date,
  updated_at=now() where id=r.member_id;
 insert into public.clinic_member_profile_changes(clinic_id,actor_id,membership_id,member_id,submission_id,before,after)
  values(r.clinic_id,r.requested_by,r.requested_membership,r.member_id,r.submission_id,prepared->'before',prepared->'proposed') returning id into change;
 update public.clinic_admin_change_requests set state='applied',decided_at=clock_timestamp(),
  decision_note=case when p_backfill then 'Auto-applied when profile approval was removed' end where id=r.id;
 event:=case when p_backfill then 'profile_auto_applied' else 'profile_updated' end;
 perform public._clinic_schedule_audit(r.clinic_id,r.requested_by,event,
  jsonb_build_object('requestId',r.id,'memberId',r.member_id,'kind','profile','fields',prepared->'fields','changeId',change));
 return jsonb_build_object('status','applied');
end $$;
revoke all on function public._clinic_profile_apply(uuid,boolean) from public,anon,authenticated,service_role;

create or replace function public.clinic_admin_change_request(p_clinic uuid,p_member uuid,p_kind text,p_submission uuid,p_expected jsonb,p_proposed jsonb) returns jsonb
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
   if p_kind='profile' and prior.state not in ('applied','approved') then return jsonb_build_object('status','stale');end if;
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
 if p_kind='profile' then
  perform public._clinic_profile_apply(rid,false);
 else
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'change_requested',jsonb_build_object('requestId',rid,'memberId',p_member,'kind',p_kind,'fields',prepared->'fields'));
 end if;
 -- Keep the deployed strict parser's success shape until the app is replaced.
 -- For profile requests this response means applied; old UI may say waiting.
 return jsonb_build_object('status','pending','requestId',rid);
end $$;

-- All pending profile requests, even older than seven days, are considered in
-- creation order. Live scope, original values and clinical-age checks still win.
-- Care-team requests are not touched. The helper and updates are transactional.
do $$declare r record;begin
 for r in select id from public.clinic_admin_change_requests where kind='profile' and state='pending'
  order by created_at,id for update loop
  perform public._clinic_profile_apply(r.id,true);
 end loop;
end $$;

create or replace function public.clinic_admin_patient_record(p_clinic uuid, p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE
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
   from public.clinic_admin_change_requests cr where cr.clinic_id=p_clinic and cr.member_id=p_member and cr.kind='care_team' and cr.state='pending' and cr.created_at>clock_timestamp()-interval '7 days'),
  'profileChanges',(select coalesce(jsonb_agg(jsonb_build_object('at',h.created_at,'by',(select display_name from public.clinic_portal_memberships where id=h.membership_id),'before',public._clinic_member_identity_masked(h.before),'after',public._clinic_member_identity_masked(h.after))order by h.created_at desc,h.id),'[]'::jsonb)
   from(select * from public.clinic_member_profile_changes where member_id=p_member and clinic_id=p_clinic order by created_at desc,id limit 20)h));
end$function$
;

create or replace function public._clinic_admin_change_list(p_clinic uuid,p_state text,p_full_dates boolean) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare rows jsonb;listed public.clinic_admin_change_requests;actor uuid:=auth.uid();
begin
 if p_state is null or p_state not in ('pending','decided','approved','rejected','cancelled','stale','expired','all') then return jsonb_build_object('status','invalid');end if;
 select coalesce(jsonb_agg(x.item order by x.created_at desc,x.id),'[]'::jsonb) into rows from (
  select r.id,r.created_at,public._clinic_admin_change_json(r,p_full_dates) item from public.clinic_admin_change_requests r
  where r.kind='care_team' and (p_clinic is null or r.clinic_id=p_clinic) and (
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

-- _audit_rows already classifies the new clinic events as care_change. Keep
-- the deployed strict audit DTO unchanged unless the caller opts into values.
create function public._audit_profile_page(p_actor uuid,p_member uuid,p_category text,p_from timestamptz,p_to timestamptz,
 p_cursor text,p_limit integer,p_clinic uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page jsonb;rows jsonb;
begin
 page:=public._audit_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,p_limit,p_clinic);
 select coalesce(jsonb_agg(e.item || coalesce((
  select jsonb_build_object('profileChange',public._clinic_admin_change_json(cr,p_clinic is null)->'summary')
   from public.clinic_portal_audit ca join public.clinic_admin_change_requests cr on cr.id::text=ca.detail->>'requestId'
   where 'clinic:'||ca.id::text=e.item->>'key' and cr.kind='profile'
    and ca.kind in('profile_updated','profile_auto_applied','profile_superseded')
    and e.item->>'memberId' is not null and (p_clinic is null or cr.clinic_id=p_clinic)
 ),'{}'::jsonb) order by e.ord),'[]'::jsonb) into rows
 from jsonb_array_elements(page->'rows') with ordinality e(item,ord);
 return page||jsonb_build_object('rows',rows);
end $$;
revoke all on function public._audit_profile_page(uuid,uuid,text,timestamptz,timestamptz,text,integer,uuid)
 from public,anon,authenticated,service_role;

-- Replace signatures rather than overloading optional parameters: PostgREST
-- must have exactly one match for deployed callers without p_profile_values.
-- Authorization, export limits and access audit behavior are unchanged.
drop function public.admin_audit_log(uuid,uuid,text,timestamptz,timestamptz,text,integer);
create function public.admin_audit_log(p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 100,p_profile_values boolean default false)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a uuid;
begin
 a:=public._real_staff_require_admin();
 insert into public.access_audit(actor_id,actor_role,member_id,surface,session_id)
  values(a,'admin',p_member,'audit_log.view',left(auth.jwt()->>'session_id',80));
 if p_profile_values then return public._audit_profile_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200),null);end if;
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200));
end$$;
revoke all on function public.admin_audit_log(uuid,uuid,text,timestamptz,timestamptz,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_audit_log(uuid,uuid,text,timestamptz,timestamptz,text,integer,boolean) to authenticated;

drop function public.admin_audit_log_export(uuid,uuid,text,timestamptz,timestamptz);
create function public.admin_audit_log_export(p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_profile_values boolean default false)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a uuid;
begin
 a:=public._real_staff_require_admin();
 insert into public.access_audit(actor_id,actor_role,member_id,surface,session_id)
  values(a,'admin',p_member,'audit_log.export',left(auth.jwt()->>'session_id',80));
 if p_profile_values then return public._audit_profile_page(p_actor,p_member,p_category,p_from,p_to,null,5000,null);end if;
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,null,5000);
end$$;
revoke all on function public.admin_audit_log_export(uuid,uuid,text,timestamptz,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_audit_log_export(uuid,uuid,text,timestamptz,timestamptz,boolean) to authenticated;

drop function public.clinic_audit_log(uuid,uuid,uuid,text,timestamptz,timestamptz,text,integer);
create function public.clinic_audit_log(p_clinic uuid,p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_cursor text default null,p_limit integer default 100,p_profile_values boolean default false)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_actor is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='actor'and s.id=p_actor)
  then return jsonb_build_object('status','refused');end if;
 if p_member is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='member'and s.id=p_member)
  then return jsonb_build_object('status','refused');end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'audit-log-view',jsonb_build_object('membershipId',m.id));
 if p_profile_values then return public._audit_profile_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200),p_clinic);end if;
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,p_cursor,least(coalesce(p_limit,100),200),p_clinic);
exception when insufficient_privilege then return jsonb_build_object('status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public.clinic_audit_log(uuid,uuid,uuid,text,timestamptz,timestamptz,text,integer,boolean) from public,anon,authenticated,service_role;
grant execute on function public.clinic_audit_log(uuid,uuid,uuid,text,timestamptz,timestamptz,text,integer,boolean) to authenticated;

drop function public.clinic_audit_log_export(uuid,uuid,uuid,text,timestamptz,timestamptz);
create function public.clinic_audit_log_export(p_clinic uuid,p_actor uuid default null,p_member uuid default null,p_category text default null,
 p_from timestamptz default null,p_to timestamptz default null,p_profile_values boolean default false)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_actor is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='actor'and s.id=p_actor)
  then return jsonb_build_object('status','refused');end if;
 if p_member is not null and not exists(select 1 from public._audit_clinic_scope(p_clinic)s where s.kind='member'and s.id=p_member)
  then return jsonb_build_object('status','refused');end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'audit-log-export',jsonb_build_object('membershipId',m.id));
 if p_profile_values then return public._audit_profile_page(p_actor,p_member,p_category,p_from,p_to,null,5000,p_clinic);end if;
 return public._audit_page(p_actor,p_member,p_category,p_from,p_to,null,5000,p_clinic);
exception when insufficient_privilege then return jsonb_build_object('status','refused');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
end$$;
revoke all on function public.clinic_audit_log_export(uuid,uuid,uuid,text,timestamptz,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function public.clinic_audit_log_export(uuid,uuid,uuid,text,timestamptz,timestamptz,boolean) to authenticated;

