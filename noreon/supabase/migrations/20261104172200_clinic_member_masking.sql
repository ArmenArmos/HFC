-- Clinic member contact details are masked at the portal presentation boundaries.
-- Every existing key, version, guard, audit and internal matching predicate is retained.
-- Stamp 20261104172200 from the integrator (S1-11 part a).

-- Preserve identity object keys while replacing portal member contact values.
create function public._clinic_member_identity_masked(p_identity jsonb)returns jsonb
language plpgsql immutable set search_path=''as $$
declare field text;
begin
 if jsonb_typeof(p_identity)='object'then
  foreach field in array array['phone','memberPhone','birthDate']loop
   if p_identity ? field then p_identity:=jsonb_set(p_identity,array[field],'null'::jsonb,false);end if;
  end loop;
 end if;
 return p_identity;
end$$;
revoke all on function public._clinic_member_identity_masked(jsonb)from public,anon,authenticated,service_role;

-- Latest definition: 20261104171700_clinic_admin_no_clinical.sql
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
  'profileChanges',(select coalesce(jsonb_agg(jsonb_build_object('at',h.created_at,'by',(select display_name from public.clinic_portal_memberships where id=h.membership_id),'before',public._clinic_member_identity_masked(h.before),'after',public._clinic_member_identity_masked(h.after))order by h.created_at desc,h.id),'[]'::jsonb)
   from(select * from public.clinic_member_profile_changes where member_id=p_member and clinic_id=p_clinic order by created_at desc,id limit 20)h));
end$function$
;

-- Latest definition: 20261018161307_clinic_admin_full_access.sql
create or replace function public.clinic_admin_patients(p_clinic uuid,p_query text default null)returns jsonb
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
  select jsonb_build_object('memberId',x.member_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'phone',null::text,'birthDate',null::date,
   'doctorName',(select display_name from public.workspace_staff where user_id=k.assigned_doctor_id),
   'nurseName',(select display_name from public.workspace_staff where user_id=k.assigned_nurse_id))r
  from public._clinic_admin_patients(p_clinic)x join public.profiles p on p.id=x.member_id
  left join public.patient_clinical_cases k on k.user_id=x.member_id left join auth.users u on u.id=x.member_id
  where q=''or lower(coalesce(p.display_name,''))like pattern or(length(digits)=4 and right(regexp_replace(coalesce(u.phone,''),'[^0-9]','','g'),4)=digits)
  order by lower(coalesce(p.display_name,'')),x.member_id limit 200)y;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-patients-listed',jsonb_build_object('results',jsonb_array_length(rows),'filtered',q<>'','membershipId',m.id));
 return jsonb_build_object('version','clinic-admin-patients-v1','enabled',true,'patients',rows);
end$$;

-- Latest definition: 20261018120100_clinic_portal_declined_proposal_and_member_list.sql
-- Phone search matches only the last digits a clinic already sees (at most 4), so the
-- hidden digits cannot be recovered by trying prefixes (review CM-1).
create or replace function public.clinic_member_search(p_clinic uuid,p_query text,p_page integer default 1)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;q text:=btrim(coalesce(p_query,''));digits text;by_phone boolean;pattern text;rows jsonb;total integer;size constant integer:=25;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then return jsonb_build_object('version','clinic-member-search-v2','enabled',false,'members','[]'::jsonb);end if;
 if length(q)>100 or p_page is null or p_page not between 1 and 10000 then raise invalid_parameter_value;end if;
 digits:=regexp_replace(q,'[^0-9]','','g');
 by_phone:=length(digits)>0 and q~'^[0-9 +()-]+$';
 pattern:='%'||replace(replace(replace(lower(q),'\','\\'),'%','\%'),'_','\_')||'%';
 with found as(
  select k.member_id,coalesce(nullif(btrim(p.display_name),''),'')name,p.birth_date,
   greatest((select max(n.created_at)from public.booking_scheduling_notices n join public.booking_appointments a on a.id=n.appointment_id where n.clinic_id=p_clinic and a.member_id=k.member_id),
    (select max(x.created_at)from public.clinic_result_attachments x where x.clinic_id=p_clinic and x.user_id=k.member_id))last_at
  from public._clinic_known_members(p_clinic)k join public.profiles p on p.id=k.member_id left join auth.users u on u.id=k.member_id
  where q=''or lower(coalesce(p.display_name,''))like pattern or(by_phone and length(digits)<=4 and right(regexp_replace(coalesce(u.phone,''),'[^0-9]','','g'),length(digits))=digits)),
 page as(select * from found order by last_at desc nulls last,member_id limit size offset(p_page-1)*size)
 select(select count(*)from found),
  coalesce((select jsonb_agg(jsonb_build_object('memberId',x.member_id,'name',x.name,'phone',null::text,'birthDate',null::date)order by x.last_at desc nulls last,x.member_id)from page x),'[]'::jsonb)
 into total,rows;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-search',jsonb_build_object('results',jsonb_array_length(rows),'byDigits',by_phone,'membershipId',m.id,'role',m.role));
 return jsonb_build_object('version','clinic-member-search-v2','enabled',true,'members',rows,'total',total,'page',p_page,'pageSize',size);
end$$;

-- Latest definition: 20261017115559_clinic_member_file.sql
create or replace function public.clinic_member_file(p_clinic uuid,p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;p public.profiles;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then return jsonb_build_object('version','clinic-member-file-v1','enabled',false);end if;
 if p_member is null or not public._clinic_member_known(p_clinic,p_member)then
  -- Refused the same way for an unknown member and another clinic's member; the attempt is audited (review MF-3).
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id,'role',m.role));
  return jsonb_build_object('version','clinic-member-file-v1','enabled',true,'status','refused');
 end if;
 select * into p from public.profiles where id=p_member;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-opened',jsonb_build_object('memberId',p_member,'membershipId',m.id,'role',m.role));
 return jsonb_build_object('version','clinic-member-file-v1','enabled',true,'status','ok',
  'member',jsonb_build_object('memberId',p_member,'name',coalesce(nullif(btrim(p.display_name),''),''),'phone',null::text,'birthDate',null::date),
  'bookings',(select coalesce(jsonb_agg(r order by r->>'startsAt' desc,r->>'appointmentId'),'[]'::jsonb)from public.booking_appointments a cross join lateral public._clinic_schedule_row(p_clinic,a)r
   where a.member_id=p_member and r is not null and exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=p_clinic)),
  'checkins',(select coalesce(jsonb_agg(jsonb_build_object('outcome',k.outcome,'recordedAt',k.recorded_at,'visitStartsAt',pool.starts_at,'appointmentId',k.appointment_id)order by k.id desc),'[]'::jsonb)
   from public.clinic_booking_checkins k join public.booking_appointments a on a.id=k.appointment_id join public.booking_manual_reservations r on r.id=k.reservation_id
   join public.booking_manual_capacity pool on pool.key=r.capacity_key where k.clinic_id=p_clinic and a.member_id=p_member),
  'visits',public._clinic_member_visits(p_clinic,p_member),
  'files',public._clinic_member_files(p_clinic,p_member));
end$$;

-- Latest definition: 20261018203024_clinic_uploads_duplicates_cleanup_members.sql
create or replace function public.clinic_portal_lab_members(p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;total bigint;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_portal_user(p_clinic);
 if not public._clinic_result_enabled()then return jsonb_build_object('version','clinic-lab-members-v1','enabled',false,'members','[]'::jsonb,'capped',false);end if;
 select count(distinct member_id)into total from public._lab_clinic_bookings(p_clinic);
 return jsonb_build_object('version','clinic-lab-members-v1','enabled',true,'capped',total>1000,
  'members',coalesce((select jsonb_agg(jsonb_build_object('memberId',x.member_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',null::date,'bookingAt',x.starts_at)
    order by lower(coalesce(p.display_name,'')),x.member_id)
   from(select * from(select distinct on(member_id)member_id,starts_at from public._lab_clinic_bookings(p_clinic)order by member_id,abs(extract(epoch from starts_at-clock_timestamp())))y
    order by starts_at desc limit 1000)x
   join public.profiles p on p.id=x.member_id),'[]'));
end$$;

-- Latest definition: 20261017165254_clinic_lab_result_linking.sql
create or replace function public.clinic_portal_lab_results(p_clinic uuid,p_batch uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_portal_user(p_clinic);
 if not exists(select 1 from public.clinic_batches where id=p_batch and clinic_id=p_clinic)then raise insufficient_privilege;end if;
 if not public._clinic_result_enabled()then return jsonb_build_object('version','clinic-lab-results-v1','enabled',false,'reading',false,'files','[]'::jsonb,'members','[]'::jsonb);end if;
 return jsonb_build_object('version','clinic-lab-results-v1','enabled',true,'reading',public._lab_ai_enabled(),
  'files',coalesce((select jsonb_agg(r order by r->>'uploadedAt' desc,r->>'fileId')from(
   select jsonb_build_object('fileId',f.id,'name',f.name,'uploadedAt',f.created_at,
    'linked',(select case when cur.id is null or exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id)then null
      when cur.clinic_id<>p_clinic then null
      else jsonb_build_object('memberId',cur.user_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'linkedAt',cur.created_at)end
      from public._clinic_result_current(f.id)cur left join public.profiles p on p.id=cur.user_id),
    'everLinked',exists(select 1 from public.clinic_result_attachments x where x.file_id=f.id),
    'reading',(select case when j.id is null then null else jsonb_build_object('state',j.state,'outcome',j.outcome,'identityStatus',j.identity_status,
      'nameOnSheet',j.identity->>'nameOnSheet','birthDateOnSheet',j.identity->>'birthDateOnSheet','sampleDate',j.identity->>'sampleDate')end
      from public.lab_ai_jobs j where j.kind='file'and j.file_id=f.id),
    -- Only members who still have a booking here are ever shown.
    'suggestion',(select jsonb_build_object('memberId',s->>'memberId','confidence',s->>'confidence','name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',null::date)
      from public.lab_ai_jobs j cross join lateral jsonb_array_elements(coalesce(j.suggestions,'[]'))with ordinality s(s,o) join public.profiles p on p.id=(s->>'memberId')::uuid
      where j.kind='file'and j.file_id=f.id and j.state='done'and exists(select 1 from public._lab_clinic_bookings(p_clinic)b where b.member_id=p.id)order by o limit 1))r
   from public.clinic_batch_files f where f.batch_id=p_batch and f.state='stored'order by f.created_at desc,f.id limit 100)x),'[]'),
  'members',coalesce((select jsonb_agg(jsonb_build_object('memberId',x.member_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',null::date,'bookingAt',x.starts_at)
    order by lower(coalesce(p.display_name,'')),x.member_id)
   from(select * from(select distinct on(member_id)member_id,starts_at from public._lab_clinic_bookings(p_clinic)order by member_id,abs(extract(epoch from starts_at-clock_timestamp())))y
    order by starts_at desc limit 300)x
   join public.profiles p on p.id=x.member_id),'[]'));
end$$;

-- Latest definition: 20261018120100_clinic_portal_declined_proposal_and_member_list.sql
create or replace function public._clinic_schedule_row(c uuid,a public.booking_appointments)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare cur public.booking_scheduling_notices;last public.booking_scheduling_notices;v public.booking_appointment_versions;kind text;arr jsonb;prev jsonb:=null;status text;
 checkin text;ref uuid;channel text;proposal jsonb;active boolean;rej public.clinic_booking_proposals;rejected jsonb:=null;
begin
 select * into cur from public.booking_scheduling_notices where id=a.notice_id;
 if a.status='notification-pending'and cur.clinic_id=c and cur.state='pending'and cur.purpose<>'cancellation'then
  kind:='pending';arr:=a.proposed_arrangement;prev:=a.current_arrangement;ref:=cur.id;channel:=cur.channel;
  status:=case when a.current_arrangement is null then 'requested'else 'change-requested'end;
 elsif a.status='confirmed'and a.current_arrangement->>'clinicId'=c::text then
  kind:='current';arr:=a.current_arrangement;ref:=a.notice_id;
  select p.source into channel from public.booking_manual_reservations r join public.booking_manual_capacity p on p.key=r.capacity_key where r.id=a.current_reservation_id;
  channel:=case when channel='clinic-hours'then 'portal'else 'email'end;
  select outcome into checkin from public.clinic_booking_checkins where reservation_id=a.current_reservation_id order by id desc limit 1;
  status:=coalesce(checkin,'confirmed');
 else
  select * into last from public.booking_scheduling_notices where appointment_id=a.id and clinic_id=c order by appointment_revision desc limit 1;
  if not found then return null;end if;
  select * into v from public.booking_appointment_versions where notice_id=last.id;
  kind:='history';arr:=v.proposed_arrangement;ref:=last.id;channel:=last.channel;
  status:=case when last.purpose='cancellation'and last.state='accepted'then 'cancelled'when last.state='declined'then 'declined'else 'other'end;
 end if;
 active:=status in('requested','change-requested','confirmed','arrived','no-show');
 select jsonb_build_object('id',p.id,'startsAt',p.starts_at,'endsAt',p.ends_at,'note',p.note,'createdAt',p.created_at)into proposal
  from public.clinic_booking_proposals p where p.appointment_id=a.id and p.clinic_id=c and p.state='open';
 -- The clinic's latest proposal for this booking was rejected by the member, the booking has
 -- not changed since, and the clinic has not decided or checked in after the rejection.
 if kind in('pending','current')and status in('requested','change-requested','confirmed','no-show')then
  select * into rej from public.clinic_booking_proposals p where p.appointment_id=a.id and p.clinic_id=c order by p.created_at desc,p.id desc limit 1;
  if found and rej.state='rejected'and rej.appointment_revision=a.revision
   and not exists(select 1 from public.clinic_booking_decisions d where d.appointment_id=a.id and d.clinic_id=c and d.created_at>rej.decided_at)
   and not exists(select 1 from public.clinic_booking_checkins k where k.appointment_id=a.id and k.clinic_id=c and k.recorded_at>rej.decided_at)then
   rejected:=jsonb_build_object('id',rej.id,'startsAt',rej.starts_at,'endsAt',rej.ends_at,'rejectedAt',rej.decided_at);
  end if;
 end if;
 return jsonb_build_object('appointmentId',a.id,'memberId',a.member_id,'revision',a.revision,'reference',ref,'kind',kind,'status',status,'channel',channel,
  'memberName',coalesce((select nullif(btrim(display_name),'')from public.profiles where id=a.member_id),''),
  'memberPhone',case when active and kind in('pending','current') and arr->>'clinicId'=c::text and (arr->>'endsAt')::timestamptz>clock_timestamp() and a.status<>'cancelled' then(select case when phone is null or phone=''then null when phone like '+%'then phone else '+'||phone end from auth.users where id=a.member_id)else null end,
  'startsAt',arr->>'startsAt','endsAt',arr->>'endsAt','previousStartsAt',prev->>'startsAt','previousEndsAt',prev->>'endsAt',
  'tests',public._clinic_schedule_tests(a.program_id,arr),'proposal',proposal,'rejectedProposal',rejected,
  'decline',(select jsonb_build_object('reason',d.reason,'at',d.created_at)from public.clinic_booking_decisions d where d.notice_id=ref and d.kind='declined'));
end$$;

-- Keep comparison inputs, mismatch decisions and stored override evidence complete.
-- Only the JSON leaving a portal presentation boundary loses the member DOB;
-- the sheet identity, including birthDateOnSheet, is deliberately unchanged.
create function public._clinic_member_comparison_masked(p_compare jsonb)returns jsonb
language plpgsql immutable set search_path=''as $$
begin
 if jsonb_typeof(p_compare->'member')='object' then
  p_compare:=jsonb_set(p_compare,'{member}',public._clinic_member_identity_masked(p_compare->'member'),false);
  if jsonb_typeof(p_compare#>'{member,current}')='object'then
   p_compare:=jsonb_set(p_compare,'{member,current}',public._clinic_member_identity_masked(p_compare#>'{member,current}'),false);
  end if;
 end if;
 return p_compare;
end$$;
revoke all on function public._clinic_member_comparison_masked(jsonb)from public,anon,authenticated,service_role;

-- Latest definition: 20261018161309_clinic_admin_review_fixes.sql
create or replace function public._clinic_member_file_json(c uuid,mm uuid,f public.clinic_batch_files,p_state text,p_upload boolean)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('fileId',f.id,'name',f.name,'uploadedAt',f.created_at,'fromRecord',p_upload,'state',p_state,
  'attached',cur.id is not null and cur.user_id=mm and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id),
  'override',exists(select 1 from public.clinic_upload_overrides o where o.file_id=f.id and o.member_id=mm),
  'fileReading',(select j.state from public.lab_ai_jobs j where j.kind='file'and j.file_id=f.id),
  'memberReading',(select j.state from public.lab_ai_jobs j where j.kind='attachment'and j.attachment_id=cur.id),
  'readingOn',public._lab_ai_enabled(),
  'compare',case when cur.id is null then public._clinic_member_comparison_masked(public._clinic_member_file_check(c,f.id,mm))end)
 from(select(public._clinic_result_current(f.id)).*)cur
$$;

-- Latest definition: 20261021092808_labs_notify_audit_fixes.sql
create or replace function public.clinic_admin_member_file_attach(p_clinic uuid,p_member uuid,p_file uuid,p_submission uuid,p_confirm boolean default false,p_reason text default null,p_appointment uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare res jsonb;
begin
 perform set_config('noreon.clinic_upload_confirmed',case when p_confirm is true then coalesce(p_file::text,'')else ''end,true);
 res:=public._clinic_admin_member_file_attach_core(p_clinic,p_member,p_file,p_submission,p_confirm,p_reason,p_appointment);
 perform set_config('noreon.clinic_upload_confirmed','',true);
 if res ? 'compare' then res:=jsonb_set(res,'{compare}',public._clinic_member_comparison_masked(res->'compare'),false);end if;
 return res;
end$$;

-- Search/file visibility is _clinic_member_known. Assigned-only members are
-- already visible to admins through the full-access patient list, but not to
-- staff, so that additional path retains both the role and feature gates.
create function public.clinic_member_masked(p_clinic uuid,p_members uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare m public.clinic_portal_memberships;rows jsonb;
begin
 m:=public._clinic_scheduling_member(p_clinic,false);
 -- Records and lab matching have independent switches; only live membership
 -- and the already-visible member predicate govern this partial-value read.
 if p_members is null or (select count(distinct id)from unnest(p_members)id)>200 then
  return jsonb_build_object('ok',false,'code','invalid');
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('memberId',p.id,
  'phoneLast4',nullif(right(regexp_replace(coalesce(u.phone,''),'[^0-9]','','g'),4),''),
  'birthYear',extract(year from p.birth_date)::integer)order by p.id),'[]'::jsonb)into rows
 from public.profiles p left join auth.users u on u.id=p.id
 where p.id=any(p_members)and(public._clinic_member_known(p_clinic,p.id)
  or(m.role='admin'and public._clinic_admin_full_access_enabled()and public._clinic_admin_patient(p_clinic,p.id)));
 return jsonb_build_object('ok',true,'members',rows);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','unavailable');
end$$;

create function public.clinic_admin_member_reveal(p_clinic uuid,p_member uuid,p_reason text)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;reason text:=btrim(coalesce(p_reason,''));p public.profiles;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('ok',false,'code','disabled');end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then return jsonb_build_object('ok',false,'code','refused');end if;
 if length(reason)not between 5 and 500 then return jsonb_build_object('ok',false,'code','reason_required');end if;
 -- Serialize this admin across clinics. Count and insert share the transaction
 -- lock, so parallel requests cannot both consume the final allowance.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('clinic_member_reveal:'||m.user_id::text,0));
 if(select count(*)from public.clinic_portal_audit where actor_id=m.user_id and kind='member_reveal'
  and created_at>clock_timestamp()-interval '1 hour')>=30 then
  return jsonb_build_object('ok',false,'code','rate_limited');
 end if;
 select * into p from public.profiles where id=p_member;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member_reveal',
  jsonb_build_object('memberId',p_member,'membershipId',m.id,'reason',reason));
 perform public._access_audit_record(p_member,'clinic_member_reveal');
 return jsonb_build_object('ok',true,'phone',public._clinic_member_phone(p_member),'birthDate',p.birth_date);
exception when insufficient_privilege then return jsonb_build_object('ok',false,'code','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('ok',false,'code','unavailable');
end$$;

revoke all on function public.clinic_member_masked(uuid,uuid[]),public.clinic_admin_member_reveal(uuid,uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.clinic_member_masked(uuid,uuid[]),public.clinic_admin_member_reveal(uuid,uuid,text)to authenticated;
