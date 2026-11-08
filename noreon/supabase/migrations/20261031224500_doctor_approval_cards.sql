-- Small card adapters only. Existing first-note, consultation and regimen commands own clinical eligibility.
-- Freeze sources and the case while reading so draft, evidence, replacement and appointment text agree.
create function public.doctor_approval_cards_read(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s jsonb;n jsonb;r jsonb;b jsonb;
begin
 perform public.lock_patient_clinical_sources(p_member);
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 perform public._first_note_doctor(p_member);
 if not public.staff_care_access(p_member,auth.uid(),true)then raise insufficient_privilege;end if;
 s:=public.patient_clinical_case_snapshot(p_member);
 n:=public.doctor_first_note_read(p_member);
 r:=public.doctor_regimen_review(p_member);
 -- This is the existing read-only booking projection, never program preparation or provider dispatch.
 b:=public.booking_pilot_workspace(p_member)->'appointments';
 perform public._access_audit_record(p_member,'doctor_decisions','approval-cards:read');
 return jsonb_build_object('snapshot',s,'firstNote',n,'regimen',r,'appointments',b,'appointmentsRevision',md5(b::text),
  'replacementId',(select id from public.patient_care_plans where user_id=p_member and active));
end$$;

create function public.doctor_first_note_card_approve(p_command jsonb,p_revision bigint,p_evidence_token text,p_appointments_revision text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m uuid;c public.patient_clinical_cases;r jsonb;b jsonb;
begin
 m:=(p_command->>'memberId')::uuid;
 if m is null or p_revision is null or p_revision<0 or p_evidence_token is null or p_evidence_token!~'^[a-f0-9]{32}$'
  or p_appointments_revision is null or p_appointments_revision!~'^[a-f0-9]{32}$'then return jsonb_build_object('status','invalid');end if;
 perform public.lock_patient_clinical_sources(m);
 select * into c from public.patient_clinical_cases where user_id=m for update nowait;
 perform public._first_note_doctor(m);
 if not public.staff_care_access(m,auth.uid(),true)then raise insufficient_privilege;end if;
 if c.revision is distinct from p_revision or public.patient_clinical_evidence(m)->>'token' is distinct from p_evidence_token
  then return jsonb_build_object('status','stale');end if;
 b:=public.booking_pilot_workspace(m)->'appointments';
 if md5(b::text)is distinct from p_appointments_revision then return jsonb_build_object('status','stale');end if;
 -- A second tab or lost-response retry must reload the saved note; it cannot record a second approval/audit.
 if exists(select 1 from public.member_first_notes where user_id=m)then return jsonb_build_object('status','already');end if;
 r:=public.doctor_first_note_approve(p_command);
 if r->>'status'='approved'then
  -- The page command normalises whitespace/control characters. Refuse a card if that would change its shown text.
  if not exists(select 1 from public.member_first_notes where user_id=m and text_en=p_command->>'textEn'and text_hy=p_command->>'textHy')then
   raise invalid_parameter_value using message='Review the exact first-note text';
  end if;
  perform public._access_audit_record(m,'doctor_decisions','first-note:'||(p_command->>'submissionId')||':'||p_revision::text||':approved');
 end if;
 return r;
 -- Any exception rolls the entire inner transaction back, including the note and its audit.
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available then return jsonb_build_object('status','unavailable');
 when invalid_text_representation then return jsonb_build_object('status','invalid');
 when invalid_parameter_value then return jsonb_build_object('status','invalid');
end$$;

revoke all on function public.doctor_approval_cards_read(uuid),public.doctor_first_note_card_approve(jsonb,bigint,text,text)from public,anon,authenticated,service_role;
grant execute on function public.doctor_approval_cards_read(uuid),public.doctor_first_note_card_approve(jsonb,bigint,text,text)to authenticated;
