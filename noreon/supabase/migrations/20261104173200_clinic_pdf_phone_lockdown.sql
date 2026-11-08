-- Clinic PDFs stay private to Noreon staff and private processing.
-- Stamp 20261104173200 from the integrator (Armen audit 5 Nov, P0-01/P0-02).

create or replace function public._clinic_portal_batch_json(b public.clinic_batches)returns jsonb language sql volatile security definer set search_path=''as $$select jsonb_build_object('id',b.id,'clinicId',b.clinic_id,'name','Batch '||to_char(b.created_at at time zone 'UTC','YYYY-MM-DD'),'revision',b.revision,'createdAt',b.created_at,'uploaderName',b.uploader_name)$$;

create or replace function public._clinic_portal_file_json(f public.clinic_batch_files)returns jsonb language sql volatile security definer set search_path=''as $$select jsonb_build_object(
 'id',f.id,'logicalKey',f.logical_key,'name','PDF '||to_char(f.created_at at time zone 'Asia/Yerevan','YYYY-MM-DD')||'.pdf','mime',f.mime,'declaredSizeBytes',f.declared_size,'sizeBytes',f.measured_size,'checksum',f.sha256,'revision',f.revision,'createdAt',f.created_at,
 'upload',jsonb_build_object('status',case when f.state='retired'then'rejected'else f.state end,'attemptId',f.attempt_id,'possibleDuplicate',false,'cleanup',f.cleanup),
 'processing',jsonb_build_object('status',case when f.state='stored'then'unavailable'else'not_started'end,'sequence',0,'segments',0,'unresolvedRegions',0),
 'association',case when f.state='stored'and(public._clinic_result_current(f.id)).id is not null
   then jsonb_build_object('status','associated','associatedCount',1,'unmatchedCount',0)
   when f.state='stored'and exists(select 1 from public.clinic_result_attachments a where a.file_id=f.id)
   then jsonb_build_object('status','review_required','associatedCount',0,'unmatchedCount',0)
   else jsonb_build_object('status','not_started','associatedCount',0,'unmatchedCount',0)end,
 'correction',jsonb_build_object('pendingCount',0),'release',jsonb_build_object('hiddenCount',0,'releasedCount',0))$$;

create or replace function public._clinic_member_files(c uuid,mm uuid)returns jsonb
language sql volatile security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('fileId',f.id,'name','PDF '||to_char(f.created_at at time zone 'Asia/Yerevan','YYYY-MM-DD')||'.pdf','uploadedAt',f.created_at,'batchName','Batch '||to_char(b.created_at at time zone 'UTC','YYYY-MM-DD'),'linkedAt',cur.created_at,'visitedAt',v.created_at)
  order by f.created_at desc,f.id),'[]'::jsonb)
 from public.clinic_batch_files f join public.clinic_batches b on b.id=f.batch_id
 cross join lateral(select(public._clinic_result_current(f.id)).*)cur
 left join public.patient_care_visits v on v.id=cur.visit_id and v.user_id=mm
 where b.clinic_id=c and f.state='stored'and cur.user_id=mm
$$;

create or replace function public._clinic_member_file_json(c uuid,mm uuid,f public.clinic_batch_files,p_state text,p_upload boolean)returns jsonb
language sql volatile security definer set search_path=''as $$
 select jsonb_build_object('fileId',f.id,'name','PDF '||to_char(f.created_at at time zone 'Asia/Yerevan','YYYY-MM-DD')||'.pdf','uploadedAt',f.created_at,'fromRecord',p_upload,'state',p_state,
  'attached',cur.id is not null and cur.user_id=mm and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id),
  'override',exists(select 1 from public.clinic_upload_overrides o where o.file_id=f.id and o.member_id=mm),
  'fileReading',(select j.state from public.lab_ai_jobs j where j.kind='file'and j.file_id=f.id),
  'memberReading',(select j.state from public.lab_ai_jobs j where j.kind='attachment'and j.attachment_id=cur.id),
  'readingOn',public._lab_ai_enabled(),
  'compare',case when cur.id is null then public._clinic_member_comparison_masked(public._clinic_member_file_check(c,f.id,mm))end)
 from(select(public._clinic_result_current(f.id)).*)cur
$$;

create or replace function public.clinic_portal_lab_results(p_clinic uuid,p_batch uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_portal_user(p_clinic);
 if not exists(select 1 from public.clinic_batches where id=p_batch and clinic_id=p_clinic)then raise insufficient_privilege;end if;
 if not public._clinic_result_enabled()then return jsonb_build_object('version','clinic-lab-results-v1','enabled',false,'reading',false,'files','[]'::jsonb,'members','[]'::jsonb);end if;
 return jsonb_build_object('version','clinic-lab-results-v1','enabled',true,'reading',public._lab_ai_enabled(),
  'files',coalesce((select jsonb_agg(r order by r->>'uploadedAt' desc,r->>'fileId')from(
   select jsonb_build_object('fileId',f.id,'name','PDF '||to_char(f.created_at at time zone 'Asia/Yerevan','YYYY-MM-DD')||'.pdf','uploadedAt',f.created_at,
    'linked',(select case when cur.id is null or exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id)then null
      when cur.clinic_id<>p_clinic then null
      else jsonb_build_object('memberId',cur.user_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'linkedAt',cur.created_at)end
      from public._clinic_result_current(f.id)cur left join public.profiles p on p.id=cur.user_id),
    'everLinked',exists(select 1 from public.clinic_result_attachments x where x.file_id=f.id),
    'reading',(select case when j.id is null then null else jsonb_build_object('state',j.state,'outcome',j.outcome,'identityStatus',j.identity_status,
      'nameOnSheet',j.identity->>'nameOnSheet','birthDateOnSheet',null::text,'sampleDate',j.identity->>'sampleDate')end
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

create or replace function public.clinic_batch_read(p_clinic_id uuid,p_batch_id uuid,p_cursor text default null,p_limit integer default 50)returns jsonb language plpgsql volatile security definer set search_path=''as $$declare b public.clinic_batches;rows jsonb;nextid uuid;afterid uuid:=p_cursor::uuid;enabled boolean;begin
 select * into b from public.clinic_batches where id=p_batch_id and clinic_id=p_clinic_id for share nowait;
 if not found then raise insufficient_privilege;end if;perform public._clinic_portal_user(p_clinic_id);
 if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value;end if;
 select coalesce(jsonb_agg(public._clinic_portal_file_json(f)||jsonb_build_object('recoveryCommand',case when f.state='reserved'and f.actor_id=auth.uid()then(select case when cmd.payload->>'name'='PDF '||to_char(f.created_at at time zone 'Asia/Yerevan','YYYY-MM-DD')||'.pdf'then cmd.payload else null end from public.clinic_batch_commands cmd where cmd.actor_id=f.actor_id and cmd.submission_id=f.submission_id)else null end)order by f.id),'[]')into rows from(select * from public.clinic_batch_files where batch_id=b.id and(afterid is null or id>afterid)order by id limit p_limit)f;
 if jsonb_array_length(rows)=p_limit then select id into nextid from public.clinic_batch_files where batch_id=b.id and id>(rows->(p_limit-1)->>'id')::uuid limit 1;end if;
 select storage_enabled into enabled from public.clinic_portal_capabilities where singleton;
 return jsonb_build_object('version','clinic-batch-v1','batch',public._clinic_portal_batch_json(b),'files',rows,'nextCursor',case when nextid is not null then rows->(p_limit-1)->>'id'end,
 'limits',jsonb_build_object('maxFiles',100,'maxFileBytes',8388608),'capabilities',jsonb_build_object('upload',coalesce(enabled,false),'processing',false,'association',false,'correction',false,'sourceRelease',false));
end$$;

create or replace function public._clinic_schedule_row(c uuid,a public.booking_appointments)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
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
  'memberPhone',null::text,
  'startsAt',arr->>'startsAt','endsAt',arr->>'endsAt','previousStartsAt',prev->>'startsAt','previousEndsAt',prev->>'endsAt',
  'tests',public._clinic_schedule_tests(a.program_id,arr),'proposal',proposal,'rejectedProposal',rejected,
  'decline',(select jsonb_build_object('reason',d.reason,'at',d.created_at)from public.clinic_booking_decisions d where d.notice_id=ref and d.kind='declined'));
end$$;

create or replace function public._clinic_member_comparison_masked(p_compare jsonb)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
begin
 if jsonb_typeof(p_compare->'member')='object' then
  p_compare:=jsonb_set(p_compare,'{member}',public._clinic_member_identity_masked(p_compare->'member'),false);
  if jsonb_typeof(p_compare#>'{member,current}')='object'then
   p_compare:=jsonb_set(p_compare,'{member,current}',public._clinic_member_identity_masked(p_compare#>'{member,current}'),false);
  end if;
 end if;
 if jsonb_typeof(p_compare->'sheet')='object'then
  p_compare:=jsonb_set(p_compare,'{sheet}',public._clinic_member_identity_masked(p_compare->'sheet'),false);
 end if;
 return p_compare;
end$$;

create or replace function public.clinic_member_file_download(p_clinic uuid,p_member uuid,p_file uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,false);
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-download-refused',
  jsonb_build_object('outcome','refused','memberId',p_member,'fileId',p_file,'membershipId',m.id,'role',m.role));
 return jsonb_build_object('status','refused');
end$$;

create or replace function public.clinic_original_access(p_file uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;f public.clinic_batch_files;c uuid;
begin
 select * into f from public.clinic_batch_files where id=p_file;
 if not found then raise insufficient_privilege;end if;
 select clinic_id into c from public.clinic_batches where id=f.batch_id;
 m:=public._clinic_portal_user(c);
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)
 values(c,f.batch_id,m.user_id,'original-access-refused',jsonb_build_object('outcome','refused','fileId',p_file,'membershipId',m.id,'role',m.role));
 return jsonb_build_object('status','refused');
end$$;

-- All tickets created before this migration are revoked too. This service-only
-- RPC is a clinic-session download bridge, not the private extraction/upload path.
create or replace function public.clinic_original_target(p_access uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a public.clinic_original_accesses;c uuid;b uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into a from public.clinic_original_accesses where id=p_access;
 if not found then raise insufficient_privilege;end if;
 select cb.clinic_id,cb.id into c,b from public.clinic_batch_files f join public.clinic_batches cb on cb.id=f.batch_id where f.id=a.file_id;
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)
 values(c,b,a.actor_id,'original-target-refused',jsonb_build_object('outcome','refused','fileId',a.file_id,'accessId',a.id,'membershipId',a.membership_id));
 return jsonb_build_object('status','refused');
end$$;

create or replace function public.clinic_admin_original_open(p_file uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a uuid;f public.clinic_batch_files;clinic uuid;m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 select b.clinic_id into clinic from public.clinic_batch_files bf join public.clinic_batches b on b.id=bf.batch_id where bf.id=p_file;
 if exists(select 1 from public.clinic_portal_memberships where user_id=auth.uid()and clinic_id=clinic and active)and not exists(select 1 from public.workspace_staff where user_id=auth.uid()and role='admin'and active and removed_at is null)then
  m:=public._clinic_portal_user(clinic);
  perform public._clinic_schedule_audit(clinic,m.user_id,'admin-original-refused',jsonb_build_object('outcome','refused','fileId',p_file,'membershipId',m.id,'role',m.role));
  return jsonb_build_object('status','refused');
 end if;
 a:=public._clinic_portal_admin();
 if not public._clinic_result_enabled()then raise insufficient_privilege;end if;
 select * into f from public.clinic_batch_files where id=p_file and state='stored';if not found then raise insufficient_privilege;end if;
 select clinic_id into clinic from public.clinic_batches where id=f.batch_id;
 perform 1 from storage.objects where id=f.object_id and bucket_id='clinic-originals'and name=f.object_key and(metadata->>'size')::bigint=f.measured_size;
 if not found then raise insufficient_privilege;end if;
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(clinic,f.batch_id,a,'admin-original-opened',
  jsonb_build_object('fileId',f.id,'sessionId',auth.jwt()->>'session_id'));
 return jsonb_build_object('fileId',f.id,'bucket','clinic-originals','objectKey',f.object_key,'sha256',f.sha256,'sizeBytes',f.measured_size);
end$$;

-- CREATE OR REPLACE preserves existing ACLs; no new callable helpers are introduced.

-- Historical command receipts must obey the same presentation policy as fresh reads.
create or replace function public.clinic_schedule_command(p_clinic uuid,p_command jsonb)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare p jsonb;m public.clinic_portal_memberships;prior public.clinic_schedule_commands;sub uuid;aid uuid;a public.booking_appointments;n public.booking_scheduling_notices;
 r public.booking_manual_reservations;pool public.booking_manual_capacity;pr public.clinic_booking_proposals;result jsonb;op text;mid uuid;starts timestamptz;held bigint;
begin
 perform set_config('lock_timeout','1500ms',true);
 begin p:=public._clinic_schedule_command(p_command);
 exception when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('status','invalid');end;
 sub:=(p->>'submissionId')::uuid;aid:=(p->>'appointmentId')::uuid;op:=p->>'op';
 m:=public._clinic_scheduling_member(p_clinic,false);
 if not public._clinic_scheduling_enabled()then return jsonb_build_object('status','disabled');end if;
 perform public._clinic_portal_command_lock(m.user_id,sub);
 select * into prior from public.clinic_schedule_commands where actor_id=m.user_id and submission_id=sub;
 if found then
  if prior.clinic_id<>p_clinic or prior.payload<>p then return jsonb_build_object('status','conflict');end if;
  -- Receipts saved before the lockdown contain the then-visible contact number.
  -- Project only that presentation field; retain the saved outcome and replay semantics.
  if jsonb_typeof(prior.result->'booking')='object'then
   return jsonb_set(prior.result,'{booking,memberPhone}','null'::jsonb,true);
  end if;
  return prior.result;
 end if;
 -- Same lock order as the member RPCs: member lock first, then the appointment row (review F-07).
 perform pg_advisory_xact_lock(hashtextextended('booking-member:'||(select member_id from public.booking_appointments where id=aid)::text,0));
 select * into a from public.booking_appointments where id=aid for update nowait;
 if not found then return jsonb_build_object('status','invalid');end if;
 -- Isolation: the booking must have a notice addressed to this clinic.
 if not exists(select 1 from public.booking_scheduling_notices where appointment_id=a.id and clinic_id=p_clinic)then return jsonb_build_object('status','invalid');end if;
 if a.revision<>(p->>'revision')::bigint then return jsonb_build_object('status','stale');end if;
 select * into n from public.booking_scheduling_notices where id=a.notice_id;

 if op in('confirm','decline')then
  if a.status<>'notification-pending'or n.clinic_id<>p_clinic or n.channel<>'portal'or n.state<>'pending'or n.purpose='cancellation'then return jsonb_build_object('status','stale');end if;
  select * into r from public.booking_manual_reservations where id=a.proposed_reservation_id for update;
  select * into pool from public.booking_manual_capacity where key=r.capacity_key;
  if op='confirm'then
   if pool.starts_at<=clock_timestamp()then return jsonb_build_object('status','past');end if;
   update public.booking_scheduling_notices set state='accepted'where id=n.id;
   update public.booking_appointments set status='confirmed',current_arrangement=proposed_arrangement,current_reservation_id=proposed_reservation_id,legacy_current=null,
    current_program=(select jsonb_agg(i-'source')from public.booking_program_seals s cross join lateral jsonb_array_elements(s.program->'items')i where s.id=n.program_id)where id=a.id;
   update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held'and id<>r.id;
   insert into public.clinic_booking_decisions(id,clinic_id,appointment_id,appointment_revision,notice_id,kind,actor_id,membership_id)values(sub,p_clinic,a.id,a.revision,n.id,'confirmed',m.user_id,m.id);
   insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(a.id,a.revision,'clinic-confirmed',n.id);
  else
   update public.booking_scheduling_notices set state='declined'where id=n.id;
   if a.current_arrangement is null then
    update public.booking_appointments set status='cancelled'where id=a.id;
    update public.booking_manual_reservations set state='released'where appointment_id=a.id and state='held';
   else
    -- A declined change leaves the confirmed visit as it was.
    update public.booking_appointments set status='confirmed',proposed_arrangement=current_arrangement,proposed_reservation_id=current_reservation_id where id=a.id;
    update public.booking_manual_reservations set state='released'where id=r.id and id is distinct from a.current_reservation_id and state='held';
   end if;
   insert into public.clinic_booking_decisions(id,clinic_id,appointment_id,appointment_revision,notice_id,kind,reason,actor_id,membership_id)values(sub,p_clinic,a.id,a.revision,n.id,'declined',p->>'reason',m.user_id,m.id);
   insert into public.booking_appointment_events(appointment_id,revision,kind,notice_id)values(a.id,a.revision,'clinic-declined',n.id);
  end if;
  update public.clinic_booking_proposals set state='withdrawn',decided_at=clock_timestamp(),decided_by=m.user_id where appointment_id=a.id and state='open';
  perform public._clinic_schedule_audit(p_clinic,m.user_id,case when op='confirm'then 'booking-confirmed'else 'booking-declined'end,
   jsonb_build_object('appointmentId',a.id,'revision',a.revision,'noticeId',n.id,'membershipId',m.id,'role',m.role));

 elsif op='propose'then
  if not((a.status='notification-pending'and n.clinic_id=p_clinic and n.channel='portal'and n.state='pending'and n.purpose<>'cancellation')
   or(a.status='confirmed'and a.current_arrangement->>'clinicId'=p_clinic::text and n.state<>'pending'
    and exists(select 1 from public.booking_manual_reservations x join public.booking_manual_capacity xp on xp.key=x.capacity_key where x.id=a.current_reservation_id and xp.source='clinic-hours')))
  then return jsonb_build_object('status','stale');end if;
  select * into pool from public.booking_manual_capacity where key=p->>'slotKey'for share;
  if not found or pool.clinic_id<>p_clinic or pool.source<>'clinic-hours'then return jsonb_build_object('status','invalid');end if;
  if pool.starts_at<=clock_timestamp()or pool.valid_until<=clock_timestamp()
   or not exists(select 1 from public.booking_offer_snapshots o where o.capacity_key=pool.key and o.superseded_at is null)then return jsonb_build_object('status','unavailable');end if;
  if exists(select 1 from public.booking_manual_reservations x where x.id in(a.proposed_reservation_id,a.current_reservation_id)and x.capacity_key=pool.key)then return jsonb_build_object('status','invalid');end if;
  select count(distinct x.appointment_id)into held from public.booking_manual_reservations x where x.capacity_key=pool.key and x.state='held'and x.appointment_id<>a.id;
  if held>=pool.capacity then return jsonb_build_object('status','full');end if;
  update public.clinic_booking_proposals set state='withdrawn',decided_at=clock_timestamp(),decided_by=m.user_id where appointment_id=a.id and state='open';
  insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,note,actor_id,membership_id)
   values(sub,p_clinic,a.id,a.revision,pool.key,pool.starts_at,pool.ends_at,p->>'note',m.user_id,m.id);
  mid:=public._clinic_proposal_notify(a.member_id);
  if mid is not null then update public.clinic_booking_proposals set telegram_message_id=mid where id=sub;end if;
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'booking-time-proposed',
   jsonb_build_object('appointmentId',a.id,'revision',a.revision,'proposalId',sub,'startsAt',pool.starts_at,'telegramQueued',mid is not null,'membershipId',m.id,'role',m.role));

 elsif op='withdraw-proposal'then
  select * into pr from public.clinic_booking_proposals where id=(p->>'proposalId')::uuid and appointment_id=a.id and clinic_id=p_clinic for update;
  if not found or pr.state<>'open'then return jsonb_build_object('status','stale');end if;
  update public.clinic_booking_proposals set state='withdrawn',decided_at=clock_timestamp(),decided_by=m.user_id where id=pr.id;
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'booking-proposal-withdrawn',jsonb_build_object('appointmentId',a.id,'proposalId',pr.id,'membershipId',m.id,'role',m.role));

 else -- check-in
  if a.status<>'confirmed'or a.current_arrangement->>'clinicId'is distinct from p_clinic::text or a.current_reservation_id is null then return jsonb_build_object('status','stale');end if;
  starts:=(a.current_arrangement->>'startsAt')::timestamptz;
  -- Arrival from the visit day (Yerevan); no-show once the visit time has started.
  if(p->>'outcome'='arrived'and(clock_timestamp()at time zone 'Asia/Yerevan')::date<(starts at time zone 'Asia/Yerevan')::date)
   or(p->>'outcome'='no-show'and clock_timestamp()<starts)then return jsonb_build_object('status','early');end if;
  insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id)values(p_clinic,a.id,a.current_reservation_id,p->>'outcome',m.user_id,m.id);
  perform public._clinic_schedule_audit(p_clinic,m.user_id,case when p->>'outcome'='arrived'then 'booking-arrived'else 'booking-no-show'end,
   jsonb_build_object('appointmentId',a.id,'revision',a.revision,'reservationId',a.current_reservation_id,'membershipId',m.id,'role',m.role));
 end if;

 select * into a from public.booking_appointments where id=aid;
 result:=jsonb_build_object('status','saved','booking',public._clinic_schedule_row(p_clinic,a));
 insert into public.clinic_schedule_commands(actor_id,submission_id,clinic_id,payload,result)values(m.user_id,sub,p_clinic,p,result);
 return result;
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected or serialization_failure then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- Review round 1 (PDF-1, PDF-2): outcome-only identity fields for clinics; refused PDF calls answer HTTP 403 with the audit kept.
-- Matching and full PDF identity values remain private. Only fixed outcomes are
-- projected for clinic callers; the private attach/override checks are unchanged.
create or replace function public._clinic_member_comparison_masked(p_compare jsonb)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare sheet jsonb:=p_compare->'sheet';member jsonb:=p_compare->'member';
begin
 if jsonb_typeof(sheet)='object'then
  p_compare:=jsonb_set(p_compare,'{sheet}',jsonb_build_object(
   'nameMatch',case when nullif(btrim(sheet->>'name'),'')is null or nullif(btrim(member->>'name'),'')is null then 'unknown'
    when p_compare->>'mismatch'in('name','both')then 'no'else 'yes'end,
   'birthYearMatch',case when coalesce(sheet->>'birthDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or coalesce(member->>'birthDate','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'then 'unknown'
    when left(sheet->>'birthDate',4)=left(member->>'birthDate',4)then 'yes'else 'no'end),false);
 end if;
 if jsonb_typeof(member)='object'then
  p_compare:=jsonb_set(p_compare,'{member}',public._clinic_member_identity_masked(member),false);
  if jsonb_typeof(p_compare#>'{member,current}')='object'then
   p_compare:=jsonb_set(p_compare,'{member,current}',public._clinic_member_identity_masked(p_compare#>'{member,current}'),false);
  end if;
 end if;
 return p_compare;
end$$;

create or replace function public.clinic_portal_lab_results(p_clinic uuid,p_batch uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_portal_user(p_clinic);
 if not exists(select 1 from public.clinic_batches where id=p_batch and clinic_id=p_clinic)then raise insufficient_privilege;end if;
 if not public._clinic_result_enabled()then return jsonb_build_object('version','clinic-lab-results-v1','enabled',false,'reading',false,'files','[]'::jsonb,'members','[]'::jsonb);end if;
 return jsonb_build_object('version','clinic-lab-results-v1','enabled',true,'reading',public._lab_ai_enabled(),
  'files',coalesce((select jsonb_agg(r order by r->>'uploadedAt' desc,r->>'fileId')from(
   select jsonb_build_object('fileId',f.id,'name','PDF '||to_char(f.created_at at time zone 'Asia/Yerevan','YYYY-MM-DD')||'.pdf','uploadedAt',f.created_at,
    'linked',(select case when cur.id is null or exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id)then null
      when cur.clinic_id<>p_clinic then null
      else jsonb_build_object('memberId',cur.user_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'linkedAt',cur.created_at)end
      from public._clinic_result_current(f.id)cur left join public.profiles p on p.id=cur.user_id),
    'everLinked',exists(select 1 from public.clinic_result_attachments x where x.file_id=f.id),
    'reading',(select case when j.id is null then null else jsonb_build_object('state',j.state,'outcome',j.outcome,'identityStatus',j.identity_status,
      'nameMatch',coalesce(cmp.value#>>'{sheet,nameMatch}','unknown'),'birthYearMatch',coalesce(cmp.value#>>'{sheet,birthYearMatch}','unknown'))end
      from public.lab_ai_jobs j
      left join public.profiles target on target.id=coalesce(j.identity->>'memberId',j.suggestions#>>'{0,memberId}')::uuid
      cross join lateral(select case when target.id is not null then
       public._clinic_member_comparison_masked(public._clinic_member_file_compare(f.id,target.id))end as value)cmp
      where j.kind='file'and j.file_id=f.id),
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

-- Set PostgREST status without raising, so the refusal audit commits.
create or replace function public.clinic_member_file_download(p_clinic uuid,p_member uuid,p_file uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_scheduling_member(p_clinic,false);
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-download-refused',
  jsonb_build_object('outcome','refused','memberId',p_member,'fileId',p_file,'membershipId',m.id,'role',m.role));
 perform set_config('response.status','403',true);
 return jsonb_build_object('status','refused');
end$$;

create or replace function public.clinic_original_access(p_file uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare m public.clinic_portal_memberships;f public.clinic_batch_files;c uuid;
begin
 select * into f from public.clinic_batch_files where id=p_file;
 if not found then raise insufficient_privilege;end if;
 select clinic_id into c from public.clinic_batches where id=f.batch_id;
 m:=public._clinic_portal_user(c);
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)
 values(c,f.batch_id,m.user_id,'original-access-refused',jsonb_build_object('outcome','refused','fileId',p_file,'membershipId',m.id,'role',m.role));
 perform set_config('response.status','403',true);
 return jsonb_build_object('status','refused');
end$$;

create or replace function public.clinic_admin_original_open(p_file uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare a uuid;f public.clinic_batch_files;clinic uuid;m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 select b.clinic_id into clinic from public.clinic_batch_files bf join public.clinic_batches b on b.id=bf.batch_id where bf.id=p_file;
 if exists(select 1 from public.clinic_portal_memberships where user_id=auth.uid()and clinic_id=clinic and active)and not exists(select 1 from public.workspace_staff where user_id=auth.uid()and role='admin'and active and removed_at is null)then
  m:=public._clinic_portal_user(clinic);
  perform public._clinic_schedule_audit(clinic,m.user_id,'admin-original-refused',jsonb_build_object('outcome','refused','fileId',p_file,'membershipId',m.id,'role',m.role));
  perform set_config('response.status','403',true);
  return jsonb_build_object('status','refused');
 end if;
 a:=public._clinic_portal_admin();
 if not public._clinic_result_enabled()then raise insufficient_privilege;end if;
 select * into f from public.clinic_batch_files where id=p_file and state='stored';if not found then raise insufficient_privilege;end if;
 select clinic_id into clinic from public.clinic_batches where id=f.batch_id;
 perform 1 from storage.objects where id=f.object_id and bucket_id='clinic-originals'and name=f.object_key and(metadata->>'size')::bigint=f.measured_size;
 if not found then raise insufficient_privilege;end if;
 insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(clinic,f.batch_id,a,'admin-original-opened',
  jsonb_build_object('fileId',f.id,'sessionId',auth.jwt()->>'session_id'));
 return jsonb_build_object('fileId',f.id,'bucket','clinic-originals','objectKey',f.object_key,'sha256',f.sha256,'sizeBytes',f.measured_size);
end$$;
