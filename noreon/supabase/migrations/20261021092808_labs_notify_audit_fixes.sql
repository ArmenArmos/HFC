-- Fixes from the 20 Oct Codex Astra audits (output/codex-audits-2026-10-20): A3 items 1 and 3, A4 items 1 to 4.
-- A3 items 4 and 5 (number parsing, PDF page count) are app code. A3 item 2 is the security lane's.

-- 1. A3-1: every clinic attach path checks the sheet's identity -----------------------------------------------
-- The shared helper is wrapped (the previous body, 20261021070106, is kept as _clinic_result_attach_core; it already
-- refuses a record upload for another member). For a clinic admin: a sheet with several people is refused; a sheet
-- whose name or birth date differs from the member is attached only through "Continue anyway" in
-- clinic_admin_member_file_attach (which records the override). The legacy clinic_portal_result_attach and
-- clinic_portal_lab_link reach the same checks. Noreon admin corrections are unchanged.
-- Why a clinic admin may not attach this file to this member now, or null. Uses the guarded comparison
-- (_clinic_member_file_check: a profile edited by this clinic in the last day is compared as it was before).
create function public._clinic_attach_refusal(p_file uuid,p_member uuid)returns text
language plpgsql stable security definer set search_path=''as $$
declare clinic uuid;cmp jsonb;
begin
 -- A record upload going to another member: left to the core, which refuses it by raising (20261021070106 B1-1).
 if exists(select 1 from public.clinic_member_uploads u join public.clinic_batch_files f on f.batch_id=u.batch_id where f.id=p_file and u.member_id<>p_member)then return null;end if;
 select b.clinic_id into clinic from public.clinic_batch_files f join public.clinic_batches b on b.id=f.batch_id where f.id=p_file;
 cmp:=public._clinic_member_file_check(clinic,p_file,p_member);
 -- 'needs-review' is the answer the clinic pages already explain; the record upload page asks first.
 if cmp->>'status'in('reading','blocked')or((cmp->>'differs')::boolean and current_setting('noreon.clinic_upload_confirmed',true)is distinct from p_file::text)then
  return 'needs-review';end if;
 return null;
end$$;
revoke all on function public._clinic_attach_refusal(uuid,uuid)from public,anon,authenticated,service_role;

alter function public._clinic_result_attach(text,uuid,uuid,uuid,uuid,uuid,uuid)rename to _clinic_result_attach_core;
revoke all on function public._clinic_result_attach_core(text,uuid,uuid,uuid,uuid,uuid,uuid)from public,anon,authenticated,service_role;
create function public._clinic_result_attach(p_kind text,p_actor uuid,p_sub uuid,p_file uuid,p_member uuid,p_visit uuid,p_clinic_only uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare why text;
begin
 if p_kind='clinic-admin'and not exists(select 1 from public.clinic_result_attachments where submission_id=p_sub and file_id=p_file and user_id=p_member and visit_id=p_visit and actor_id=p_actor)then
  why:=public._clinic_attach_refusal(p_file,p_member);
  if why is not null then return jsonb_build_object('status',why);end if;
 end if;
 return public._clinic_result_attach_core(p_kind,p_actor,p_sub,p_file,p_member,p_visit,p_clinic_only);
end$$;
revoke all on function public._clinic_result_attach(text,uuid,uuid,uuid,uuid,uuid,uuid)from public,anon,authenticated,service_role;

-- The clinic's lab link creates an inferred visit before it attaches: refuse first, so nothing is left behind
-- (Astra R4). The body is unchanged (20261017165254).
alter function public.clinic_portal_lab_link(uuid,jsonb)rename to _clinic_portal_lab_link_core;
revoke all on function public._clinic_portal_lab_link_core(uuid,jsonb)from public,anon,authenticated,service_role;
create function public.clinic_portal_lab_link(p_clinic uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare fid uuid;mid uuid;sub uuid;why text;
begin
 begin fid:=(p_command->>'fileId')::uuid;mid:=(p_command->>'memberId')::uuid;sub:=(p_command->>'submissionId')::uuid;
 exception when others then fid:=null;end;
 if fid is not null and mid is not null and not exists(select 1 from public.clinic_result_attachments where submission_id=sub)
  and public._clinic_result_enabled()and exists(select 1 from public.clinic_batch_files f join public.clinic_batches b on b.id=f.batch_id where f.id=fid and b.clinic_id=p_clinic)
  -- The core's own answers come first for another clinic's member ('not-this-clinic').
  and exists(select 1 from public._lab_clinic_bookings(p_clinic)b where b.member_id=mid)then
  why:=public._clinic_attach_refusal(fid,mid);
  -- Membership and switches are checked by the core first, so an outsider learns nothing here.
  if why is not null then
   perform public._clinic_portal_user(p_clinic);
   return jsonb_build_object('status',why);
  end if;
 end if;
 return public._clinic_portal_lab_link_core(p_clinic,p_command);
exception when insufficient_privilege then return jsonb_build_object('status','access');
end$$;
revoke all on function public.clinic_portal_lab_link(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.clinic_portal_lab_link(uuid,jsonb)to authenticated;

-- "Continue anyway" marks this file (transaction-local) for the helper above; the body is unchanged (20261018161309).
alter function public.clinic_admin_member_file_attach(uuid,uuid,uuid,uuid,boolean,text,uuid)rename to _clinic_admin_member_file_attach_core;
revoke all on function public._clinic_admin_member_file_attach_core(uuid,uuid,uuid,uuid,boolean,text,uuid)from public,anon,authenticated,service_role;
create function public.clinic_admin_member_file_attach(p_clinic uuid,p_member uuid,p_file uuid,p_submission uuid,p_confirm boolean default false,p_reason text default null,p_appointment uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare res jsonb;
begin
 perform set_config('noreon.clinic_upload_confirmed',case when p_confirm is true then coalesce(p_file::text,'')else ''end,true);
 res:=public._clinic_admin_member_file_attach_core(p_clinic,p_member,p_file,p_submission,p_confirm,p_reason,p_appointment);
 perform set_config('noreon.clinic_upload_confirmed','',true);
 return res;
end$$;
revoke all on function public.clinic_admin_member_file_attach(uuid,uuid,uuid,uuid,boolean,text,uuid)from public,anon,authenticated,service_role;
grant execute on function public.clinic_admin_member_file_attach(uuid,uuid,uuid,uuid,boolean,text,uuid)to authenticated;

-- 2. A3-3: confirming a corrected value keeps the correction ------------------------------------------------
-- As 20261017165252, except: confirm on a corrected row keeps status, corrected value and unit (and the note when
-- none is given). Going back to the AI's number is an explicit correction to that number.
create or replace function public.doctor_lab_ai_value_review(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;sub uuid;m uuid;vid uuid;act text;v public.lab_ai_values;j public.lab_ai_jobs;prior public.lab_ai_value_reviews;nv numeric;nu text;note text;before_v jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','memberId','valueId','action','value','unit','note']<>'{}'
  or not(p_command?&array['version','submissionId','memberId','valueId','action'])or p_command->>'version'is distinct from 'lab-ai-review-v1'
  or p_command->>'action'not in('confirm','correct','reject')then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;m:=(p_command->>'memberId')::uuid;vid:=(p_command->>'valueId')::uuid;
  nv:=case when p_command ? 'value'and jsonb_typeof(p_command->'value')='number'then(p_command->>'value')::numeric end;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 act:=p_command->>'action';nu:=nullif(btrim(coalesce(p_command->>'unit','')),'');note:=nullif(btrim(coalesce(p_command->>'note','')),'');
 if length(nu)>30 or length(note)>300 or(act='correct'and(nv is null or nv<=-1e9 or nv>=1e9))or(act<>'correct'and(p_command ? 'value'or p_command ? 'unit'))then
  return jsonb_build_object('status','invalid');end if;
 d:=public._assigned_active_doctor(m);
 if not public._doctor_completion_enabled()or not public._lab_ai_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into prior from public.lab_ai_value_reviews where submission_id=sub;
 if found then
  if prior.value_id<>vid or prior.actor_id<>d or prior.action<>act then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','replayed',true);
 end if;
 select * into v from public.lab_ai_values where id=vid and user_id=m for update;
 if not found then return jsonb_build_object('status','stale');end if;
 select * into j from public.lab_ai_jobs where id=v.job_id;
 if not public._lab_ai_current(v.attachment_id)then return jsonb_build_object('status','stale');end if;
 if j.identity_status is distinct from 'match'and j.identity_confirmed_at is null then return jsonb_build_object('status','identity-first');end if;
 if not exists(select 1 from public.patient_document_opens o where o.file_id=v.file_id and o.attachment_id=v.attachment_id and o.actor_id=d and o.actor_kind='doctor')then
  return jsonb_build_object('status','open-first');end if;
 before_v:=jsonb_build_object('status',v.status,'correctedValue',v.corrected_value,'correctedUnit',v.corrected_unit,'reviewNote',v.review_note,'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at);
 update public.lab_ai_values set status=case when act='confirm'and v.status='corrected'then 'corrected' when act='confirm'then 'verified'when act='correct'then 'corrected'else 'rejected'end,
  corrected_value=case when act='correct'then nv when act='confirm'and v.status='corrected'then v.corrected_value end,corrected_unit=case when act='correct'then coalesce(nu,v.unit)when act='confirm'and v.status='corrected'then v.corrected_unit end,review_note=case when act='confirm'and v.status='corrected'then coalesce(note,v.review_note)else note end,reviewed_by=d,reviewed_at=clock_timestamp()
  where id=v.id returning * into v;
 insert into public.lab_ai_value_reviews(value_id,submission_id,actor_id,action,before,after)values(v.id,sub,d,act,before_v,
  jsonb_build_object('status',v.status,'correctedValue',v.corrected_value,'correctedUnit',v.corrected_unit,'reviewNote',v.review_note,'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at));
 return jsonb_build_object('status','saved','replayed',false,'valueStatus',v.status);
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- 3. A4-2: a cancelled one-tap link cannot finish a sign-in ---------------------------------------------------
-- As 20261017131420, except: only a link still 'redeeming' for this request finishes, or one already used by this
-- same request (a retry). A cancelled or expired link is refused and the session created for it is ended.
create or replace function public.telegram_signin_link_finish(p_request uuid,p_nonce_hmac text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare l public.telegram_signin_links;r public.auth_code_requests;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select r2.* into r from public.auth_code_requests r2 where r2.id=p_request and r2.state='verified'for update;
 select l2.* into l from public.telegram_signin_links l2 where l2.request_id=p_request and l2.redeem_nonce_hmac=p_nonce_hmac for update;
 if r.id is null or l.id is null then return jsonb_build_object('ok',false,'code','unknown');end if;
 if l.state='redeeming'and l.expires_at>clock_timestamp()then
  update public.telegram_signin_links set state='used',used_at=clock_timestamp()where id=l.id;
  perform public._telegram_auth_audit(l.auth_user_id,'signin_link.used',jsonb_build_object('linkId',l.id,'step',l.step));
 elsif l.state is distinct from 'used'then
  if r.verified_session is not null then delete from auth.sessions where id=r.verified_session;end if;
  perform public._telegram_auth_audit(l.auth_user_id,'signin_link.refused',jsonb_build_object('linkId',l.id,'state',l.state));
  return jsonb_build_object('ok',false,'code','cancelled');
 end if;
 return jsonb_build_object('ok',true,'step',l.step);
end$$;

-- 4. A4-1, A4-3, A4-4: member and staff notices re-checked when the dispatcher claims them -------------------
-- The previous claim body is kept as _telegram_auth_message_claim_base (unchanged); the coach wrapper still calls
-- _telegram_auth_message_claim_core, which now first checks:
--  * binding_revoked (held): a member notice, a booking notice, a coach teaser or a staff message notice whose chat
--    is no longer an active binding (same principal and address; a member notice: that member's member binding).
--    Auth-flow messages (telegram.*, staff.*) are not affected: they go to chats before or after a binding.
--  * quiet_hours (left queued, deferred 5 minutes): a reminder claimed inside the member's own quiet hours (their
--    settings, or 22:00 to 07:00). A later sweep sends it once quiet hours end, or the usual 30-minute limit expires it.
--  * event_changed (held): a visit reminder whose visit is no longer confirmed as the reminder says (start, end,
--    clinic, home or clinic), or a medicine reminder whose dose was recorded, whose medicine stopped or whose
--    reminders were turned off.
-- A message the claim deferred (quiet hours) is not offered again before this time.
alter table public.telegram_auth_messages add column defer_until timestamptz;
-- As 20261016182740, plus: deferred messages are skipped until their time.
create or replace function public.telegram_auth_message_queue(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 update public.telegram_auth_messages set state='unknown',state_seq=state_seq+1,updated_at=clock_timestamp()
 where state='sending'and updated_at<clock_timestamp()-interval '2 minutes';
 return coalesce((select jsonb_agg(id)from(select id from public.telegram_auth_messages where state='queued'and(defer_until is null or defer_until<=clock_timestamp())
  order by created_at,id limit greatest(1,least(coalesce(p_limit,20),50)))q),'[]');
end$$;
alter function public._telegram_auth_message_claim_core(uuid,uuid)rename to _telegram_auth_message_claim_base;
revoke all on function public._telegram_auth_message_claim_base(uuid,uuid)from public,anon,authenticated,service_role;

-- Messages that may only go to the recipient's current binding.
create function public._telegram_notice_bound(p_template text)returns boolean language sql immutable set search_path=''as $$
 select p_template like 'member.%'or p_template like 'booking.%'or p_template like 'staff\_message.%'
$$;
revoke all on function public._telegram_notice_bound(text)from public,anon,authenticated,service_role;

create function public._member_reminder_stale(p_member uuid,p_key text,p_template text,p_params jsonb)returns boolean
language plpgsql stable security definer set search_path=''as $$
declare part text[];at_ timestamptz;r record;home boolean;
begin
 part:=string_to_array(p_key,':');
 if part[1] in('reminder.tomorrow','reminder.soon')and array_length(part,1)=4 then
  at_:=to_timestamp(part[4]::bigint);
  if part[2]='booking'then
   select a.status,(a.current_arrangement->>'startsAt')::timestamptz starts,(a.current_arrangement->>'endsAt')::timestamptz ends,a.current_arrangement->>'mode'mode,
    (select name from public.workspace_clinics c where c.id::text=a.current_arrangement->>'clinicId')clinic
   into r from public.booking_appointments a where a.id=part[3]::uuid and a.member_id=p_member;
  elsif part[2]='request'then
   select q.status,(q.current_arrangement#>>'{terms,startsAt}')::timestamptz starts,(q.current_arrangement#>>'{terms,endsAt}')::timestamptz ends,
    q.current_arrangement#>>'{terms,mode}'mode,q.current_arrangement->>'provider'clinic
   into r from public.patient_test_requests q where q.id=part[3]::uuid and q.user_id=p_member;
  else return true;end if;
  if r.status is distinct from 'confirmed'or r.starts is distinct from at_ then return true;end if;
  home:=r.mode='home';
  -- What the reminder says must still be true: home or clinic, and the rendered date, times and clinic (Astra R7).
  if(p_template like 'member.reminder\_home\_%')<>home then return true;end if;
  return public._member_notice_visit(p_member,r.starts,case when home then r.ends end,case when not home then r.clinic end)is distinct from coalesce(p_params,'{}');
 elsif part[1]='medicine'and array_length(part,1)=3 then
  at_:=to_timestamp(part[3]::bigint);
  if coalesce((select(p.preferences->>'medicationEnabled')::boolean from public.patient_reminder_preferences p where p.user_id=p_member),true)is not true then return true;end if;
  return not(exists(select 1 from public.member_medicines m cross join unnest(m.times)t
    cross join(values((at_ at time zone 'Asia/Yerevan')::date-1),((at_ at time zone 'Asia/Yerevan')::date),((at_ at time zone 'Asia/Yerevan')::date+1))v(dd)
    where m.user_id=p_member and m.stopped_at is null and m.started_on<=dd and public._member_medicine_due(dd,t)=at_
     and not exists(select 1 from public.member_medicine_doses x where x.medicine_id=m.id and x.due_at=at_))
   or exists(select 1 from(values((at_ at time zone 'Asia/Yerevan')::date-1),((at_ at time zone 'Asia/Yerevan')::date),((at_ at time zone 'Asia/Yerevan')::date+1))v(dd)
    cross join lateral public._member_plan_medicines(p_member,dd)pm cross join unnest(pm.times)t
    where exists(select 1 from public.patient_care_plans p where p.user_id=p_member and p.active)and public._member_medicine_due(dd,t)=at_
     and not exists(select 1 from public.patient_dose_events x where x.user_id=p_member and x.medication_id=pm.id and x.due_at=at_)));
 end if;
 return false;
exception when others then return true; -- unreadable key: fail closed
end$$;
revoke all on function public._member_reminder_stale(uuid,text,text,jsonb)from public,anon,authenticated,service_role;

create function public._telegram_auth_message_claim_core(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.telegram_auth_messages;n public.member_notices;hold text;
begin
 perform set_config('lock_timeout','2s',true);
 select * into m from public.telegram_auth_messages where id=p_message for update;
 if not found or m.state<>'queued'then return public._telegram_auth_message_claim_base(p_message,p_attempt);end if;
 select * into n from public.member_notices where telegram_message_id=m.id;
 if public._telegram_notice_bound(m.template_id)
  and not exists(select 1 from public.telegram_auth_bindings b where b.active and b.principal_ref=m.principal_ref and b.address=m.address
   and(m.template_id like 'staff\_message.%'or b.kind='member')and(n.id is null or b.auth_user_id=n.member_id))then hold:='binding_revoked';
 elsif n.id is not null and m.template_id like 'member.reminder\_%'and m.created_at>=clock_timestamp()-interval '30 minutes'
  and public._member_quiet_now(n.member_id,(clock_timestamp()at time zone 'Asia/Yerevan')::time)then
  -- Out of the queue until the next sweep, so waiting reminders never crowd out other messages (Astra round 2).
  update public.telegram_auth_messages set defer_until=clock_timestamp()+interval '5 minutes',updated_at=clock_timestamp()where id=m.id;
  return jsonb_build_object('ok',false,'code','quiet_hours');
 elsif n.id is not null and m.template_id like 'member.reminder\_%'and public._member_reminder_stale(n.member_id,n.event_key,m.template_id,m.params)then hold:='event_changed';
 end if;
 if hold is not null then
  update public.telegram_auth_messages set state='held',reason=hold,state_seq=state_seq+1,updated_at=clock_timestamp()where id=m.id;
  return jsonb_build_object('ok',false,'code',hold);
 end if;
 return public._telegram_auth_message_claim_base(p_message,p_attempt);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end$$;
revoke all on function public._telegram_auth_message_claim_core(uuid,uuid)from public,anon,authenticated,service_role;

-- A revoked binding also holds its queued notices at once (the claim check above is the guarantee).
alter function public._telegram_revoke_binding(uuid,text)rename to _telegram_revoke_binding_core;
revoke all on function public._telegram_revoke_binding_core(uuid,text)from public,anon,authenticated,service_role;
create function public._telegram_revoke_binding(p_binding uuid,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare b public.telegram_auth_bindings;res jsonb;
begin
 select * into b from public.telegram_auth_bindings where id=p_binding;
 res:=public._telegram_revoke_binding_core(p_binding,p_reason);
 if(res->>'revoked')::boolean then
  update public.telegram_auth_messages o set state='held',reason='binding_revoked',state_seq=state_seq+1,updated_at=clock_timestamp()
   where o.state='queued'and o.principal_ref=b.principal_ref and public._telegram_notice_bound(o.template_id);
 end if;
 return res;
end$$;
revoke all on function public._telegram_revoke_binding(uuid,text)from public,anon,authenticated,service_role;
