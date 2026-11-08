-- Clinic member search and member file (dark, behind the clinic scheduling switches).
--
-- Khikar, 17 Oct 2026: clinic users can search members and open a member "file". Lead
-- boundary:
--  * Search finds only members who have ever had a booking or visit with THIS clinic (a
--    scheduling notice addressed to it) or a lab PDF this clinic uploaded and linked to
--    them. By name or phone; no other Noreon members.
--  * The file shows name, phone and date of birth; this clinic's bookings and visits with
--    status and tests; check-in history; this clinic's lab PDFs currently linked to the
--    member, with the visit they are linked to (download audited), and results-received
--    status per visit.
--  * Never: questionnaire, risk results, doctor notes, care plans, messages, documents of
--    other clinics. A PDF unlinked or moved to another member is not shown.
--  * Every file open and every download is audited; a search is audited without its text.
-- Clinic admin and clinic staff both have access.

-- Same as 20261017111652 except each row carries the member id, for the link to the member file.
create or replace function public._clinic_schedule_row(c uuid,a public.booking_appointments)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare cur public.booking_scheduling_notices;last public.booking_scheduling_notices;v public.booking_appointment_versions;kind text;arr jsonb;prev jsonb:=null;status text;
 checkin text;ref uuid;channel text;proposal jsonb;active boolean;
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
 return jsonb_build_object('appointmentId',a.id,'memberId',a.member_id,'revision',a.revision,'reference',ref,'kind',kind,'status',status,'channel',channel,
  'memberName',coalesce((select nullif(btrim(display_name),'')from public.profiles where id=a.member_id),''),
  'memberPhone',case when active then(select case when phone is null or phone=''then null when phone like '+%'then phone else '+'||phone end from auth.users where id=a.member_id)else null end,
  'startsAt',arr->>'startsAt','endsAt',arr->>'endsAt','previousStartsAt',prev->>'startsAt','previousEndsAt',prev->>'endsAt',
  'tests',public._clinic_schedule_tests(a.program_id,arr),'proposal',proposal,
  'decline',(select jsonb_build_object('reason',d.reason,'at',d.created_at)from public.clinic_booking_decisions d where d.notice_id=ref and d.kind='declined'));
end$$;

-- Is this member known to this clinic?
create function public._clinic_member_known(c uuid,m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.booking_scheduling_notices n join public.booking_appointments a on a.id=n.appointment_id where n.clinic_id=c and a.member_id=m)
 or exists(select 1 from public.clinic_result_attachments x where x.clinic_id=c and x.user_id=m and(public._clinic_result_current(x.file_id)).user_id=m)
$$;

-- Members known to the clinic (same rule as above), as a set.
create function public._clinic_known_members(c uuid)returns table(member_id uuid)
language sql stable security definer set search_path=''as $$
 select a.member_id from public.booking_scheduling_notices n join public.booking_appointments a on a.id=n.appointment_id where n.clinic_id=c
 union
 select x.user_id from public.clinic_result_attachments x where x.clinic_id=c and(public._clinic_result_current(x.file_id)).user_id=x.user_id
$$;

create function public._clinic_member_phone(m uuid)returns text
language sql stable security definer set search_path=''as $$
 select case when phone is null or phone=''then null when phone like '+%'then phone else '+'||phone end from auth.users where id=m
$$;

-- Search by name (two or more characters) or phone (four or more digits). At most 20 rows.
create function public.clinic_member_search(p_clinic uuid,p_query text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;q text:=btrim(coalesce(p_query,''));digits text;pattern text;rows jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then return jsonb_build_object('version','clinic-member-search-v1','enabled',false,'members','[]'::jsonb);end if;
 if length(q)not between 2 and 100 then raise invalid_parameter_value;end if;
 digits:=regexp_replace(q,'[^0-9]','','g');
 pattern:='%'||replace(replace(replace(lower(q),'\','\\'),'%','\%'),'_','\_')||'%';
 select coalesce(jsonb_agg(r order by lower(r->>'name'),r->>'memberId'),'[]'::jsonb)into rows from(
  select jsonb_build_object('memberId',k.member_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'phone',public._clinic_member_phone(k.member_id),'birthDate',p.birth_date)r
  from public._clinic_known_members(p_clinic)k join public.profiles p on p.id=k.member_id left join auth.users u on u.id=k.member_id
  where lower(coalesce(p.display_name,''))like pattern or(length(digits)>=4 and coalesce(u.phone,'')like '%'||digits||'%')
  order by lower(p.display_name),k.member_id limit 20)x;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-search',jsonb_build_object('results',jsonb_array_length(rows),'byDigits',length(digits)>=4,'membershipId',m.id,'role',m.role));
 return jsonb_build_object('version','clinic-member-search-v1','enabled',true,'members',rows);
end$$;

-- This clinic's lab PDFs currently linked to this member (_clinic_result_current excludes
-- unlinked ones and follows a move to another member), with the visit each is linked to.
create function public._clinic_member_files(c uuid,mm uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('fileId',f.id,'name',f.name,'uploadedAt',f.created_at,'batchName',b.name,'linkedAt',cur.created_at,'visitedAt',v.created_at)
  order by f.created_at desc,f.id),'[]'::jsonb)
 from public.clinic_batch_files f join public.clinic_batches b on b.id=f.batch_id
 cross join lateral(select(public._clinic_result_current(f.id)).*)cur
 left join public.patient_care_visits v on v.id=cur.visit_id and v.user_id=mm
 where b.clinic_id=c and f.state='stored'and cur.user_id=mm
$$;

-- Visits booked with this clinic and their lab progress (samples sent, results received).
create function public._clinic_member_visits(c uuid,mm uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('visitId',v.id,'visitedAt',v.created_at,'samples',x.samples,'atLab',x.at_lab,'resultsReceived',x.received)order by v.created_at desc,v.id),'[]'::jsonb)
 from public.patient_care_visits v
 join public.booking_appointment_versions bv on bv.appointment_id=v.appointment_id and bv.revision=v.accepted_revision
 join public.booking_scheduling_notices n on n.id=bv.notice_id
 cross join lateral(select count(*)filter(where public._patient_lab_current_collection(e))samples,
   count(*)filter(where public._patient_lab_current_collection(e)and exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='at-lab')
    and(public._patient_lab_active_result(e.id)).id is null)at_lab,
   count(*)filter(where public._patient_lab_current_collection(e)and(public._patient_lab_active_result(e.id)).id is not null)received
  from public.patient_care_visit_entries e where e.visit_id=v.id and e.user_id=v.user_id)x
 where v.user_id=mm and n.clinic_id=c and v.booking_context is not null
$$;

-- The member file. Opening it is audited. An unknown member and another clinic's member
-- are refused the same way.
create function public.clinic_member_file(p_clinic uuid,p_member uuid)returns jsonb
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
  'member',jsonb_build_object('memberId',p_member,'name',coalesce(nullif(btrim(p.display_name),''),''),'phone',public._clinic_member_phone(p_member),'birthDate',p.birth_date),
  'bookings',(select coalesce(jsonb_agg(r order by r->>'startsAt' desc,r->>'appointmentId'),'[]'::jsonb)from public.booking_appointments a cross join lateral public._clinic_schedule_row(p_clinic,a)r
   where a.member_id=p_member and r is not null and exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=p_clinic)),
  'checkins',(select coalesce(jsonb_agg(jsonb_build_object('outcome',k.outcome,'recordedAt',k.recorded_at,'visitStartsAt',pool.starts_at,'appointmentId',k.appointment_id)order by k.id desc),'[]'::jsonb)
   from public.clinic_booking_checkins k join public.booking_appointments a on a.id=k.appointment_id join public.booking_manual_reservations r on r.id=k.reservation_id
   join public.booking_manual_capacity pool on pool.key=r.capacity_key where k.clinic_id=p_clinic and a.member_id=p_member),
  'visits',public._clinic_member_visits(p_clinic,p_member),
  'files',public._clinic_member_files(p_clinic,p_member));
end$$;

-- Download one of this member's linked PDFs. Records an access ticket (the existing audited
-- original-access path; the server reads the object with clinic_original_target) and an
-- audit row.
create function public.clinic_member_file_download(p_clinic uuid,p_member uuid,p_file uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;f public.clinic_batch_files;cur public.clinic_result_attachments;ticket uuid;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then raise insufficient_privilege;end if;
 select f2.* into f from public.clinic_batch_files f2 join public.clinic_batches b on b.id=f2.batch_id where f2.id=p_file and b.clinic_id=p_clinic and f2.state='stored'for share;
 if found then cur:=public._clinic_result_current(f.id);end if;
 if p_member is null or p_file is null or f.id is null or cur.user_id is distinct from p_member or not public._clinic_member_known(p_clinic,p_member)then
  -- Audited, then refused (review MF-3).
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-download-refused',jsonb_build_object('memberId',p_member,'fileId',p_file,'membershipId',m.id,'role',m.role));
  return jsonb_build_object('status','refused');
 end if;
 insert into public.clinic_original_accesses(file_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,file_revision)
  values(f.id,auth.uid(),(auth.jwt()->>'session_id')::uuid,auth.jwt()->'amr',to_timestamp((auth.jwt()->>'exp')::double precision),m.id,m.revision,f.revision)returning id into ticket;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-downloaded',jsonb_build_object('memberId',p_member,'fileId',f.id,'accessId',ticket,'membershipId',m.id,'role',m.role));
 return jsonb_build_object('status','ok','accessId',ticket,'fileId',f.id);
end$$;

revoke all on function public._clinic_member_known(uuid,uuid),public._clinic_known_members(uuid),public._clinic_member_phone(uuid),public.clinic_member_search(uuid,text),
 public._clinic_member_files(uuid,uuid),public._clinic_member_visits(uuid,uuid),public.clinic_member_file(uuid,uuid),public.clinic_member_file_download(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.clinic_member_search(uuid,text),public.clinic_member_file(uuid,uuid),public.clinic_member_file_download(uuid,uuid,uuid)to authenticated;
