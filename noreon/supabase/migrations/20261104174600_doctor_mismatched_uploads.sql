-- Clinic files attached despite a sheet mismatch must reach the assigned doctor.
-- Stamp 20261104174600 assigned by the integrator (urgent, Khikar live test 5 Nov).
create function public.doctor_mismatched_uploads(p_member uuid default null)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;rows jsonb;
begin
 if who is null or who->>'role' is distinct from 'doctor'then
  raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 if p_member is not null and not exists(select 1 from public.patient_clinical_cases k
  where k.user_id=p_member and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true))then
  raise insufficient_privilege using message='Member access required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('fileId',o.file_id,'fileName',f.name,'at',o.created_at,
  'clinicName',c.name,'mismatch',o.mismatch,'reason',o.reason,'sheet',o.sheet,'member',o.member_values,'current',true,
  'memberId',o.member_id,'memberName',coalesce(p.display_name,''),'jobState',j.state)order by o.created_at,o.id),'[]'::jsonb)
 into rows
 from public.clinic_upload_overrides o
 join public.patient_clinical_cases k on k.user_id=o.member_id
 join public.clinic_batch_files f on f.id=o.file_id
 join public.workspace_clinics c on c.id=o.clinic_id
 left join public.profiles p on p.id=o.member_id
 left join public.lab_ai_jobs j on j.attachment_id=o.attachment_id
 where k.assigned_doctor_id=me and(p_member is null or o.member_id=p_member)
  and public.staff_care_access(k.user_id,me,true)and public._lab_ai_current(o.attachment_id)
  and j.identity_confirmed_at is null;
 perform public._access_audit_record(mid,'member_upload_overrides',null)
 from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(rows)x)q;
 return rows;
end$$;
revoke all on function public.doctor_mismatched_uploads(uuid)from public,anon,authenticated,service_role;
grant execute on function public.doctor_mismatched_uploads(uuid)to authenticated;

-- The clinic's mismatch remains authoritative even if a later AI read guesses a match.
-- Keep the existing assignment, PDF-open, note and job locks and confirmation record.
create or replace function public.doctor_lab_ai_identity_confirm(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare d uuid;m uuid;jid uuid;j public.lab_ai_jobs;note text;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','memberId','jobId','note']<>'{}'or not(p_command?&array['version','memberId','jobId'])
  or p_command->>'version'is distinct from 'lab-ai-identity-v1'then return jsonb_build_object('status','invalid');end if;
 begin m:=(p_command->>'memberId')::uuid;jid:=(p_command->>'jobId')::uuid;exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 note:=nullif(btrim(coalesce(p_command->>'note','')),'');
 if length(note)>300 then return jsonb_build_object('status','invalid');end if;
 d:=public._assigned_active_doctor(m);
 if not public._doctor_completion_enabled()or not public._lab_ai_enabled()then return jsonb_build_object('status','disabled');end if;
 select * into j from public.lab_ai_jobs where id=jid and user_id=m for update;
 if not found or j.state<>'done'or not public._lab_ai_current(j.attachment_id)then return jsonb_build_object('status','stale');end if;
 if j.identity_confirmed_at is not null or (j.identity_status='match'and not exists(select 1 from public.clinic_upload_overrides o where o.attachment_id=j.attachment_id))then return jsonb_build_object('status','unchanged');end if;
 if j.identity_status='multiple_patients'then return jsonb_build_object('status','not-allowed');end if;
 if(j.identity_status='mismatch'or exists(select 1 from public.clinic_upload_overrides o where o.attachment_id=j.attachment_id))and note is null then return jsonb_build_object('status','reason-required');end if;
 if not exists(select 1 from public.patient_document_opens o where o.file_id=j.file_id and o.attachment_id=j.attachment_id and o.actor_id=d and o.actor_kind='doctor')then
  return jsonb_build_object('status','open-first');end if;
 update public.lab_ai_jobs set identity_confirmed_by=d,identity_confirmed_at=clock_timestamp(),identity_note=note where id=j.id;
 perform public._access_audit_record(m,'member_upload_overrides',j.file_id::text);
 return jsonb_build_object('status','confirmed');
exception when lock_not_available then return jsonb_build_object('status','unavailable');
end$$;

-- Values on an override still need the explicit identity confirmation.
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
 if(j.identity_status is distinct from 'match'or exists(select 1 from public.clinic_upload_overrides o where o.attachment_id=j.attachment_id))and j.identity_confirmed_at is null then return jsonb_build_object('status','identity-first');end if;
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

-- Preserve the existing audited read wrapper. All doctor cards need the confirmation
-- control when the clinic overrode identity, including an AI read that guessed match.
create or replace function public.doctor_lab_ai_read(p_user_id uuid,p_file uuid)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare r jsonb;
begin
 r:=public.doctor_lab_ai_read_unlogged(p_user_id,p_file);
 if r is not null and coalesce(r->>'enabled','true')<>'false'then
  perform public._access_audit_record(p_user_id,'member_lab_read',p_file::text);end if;
 if r->>'enabled'='true'and r->'job'<>'null'::jsonb
  and r#>>'{job,identityConfirmedAt}'is null and r#>>'{job,identityStatus}'is distinct from 'multiple_patients'
  and exists(select 1 from public.clinic_upload_overrides o where o.file_id=p_file and o.member_id=p_user_id and public._lab_ai_current(o.attachment_id))then
  r:=jsonb_set(r,'{job,identityStatus}','"mismatch"'::jsonb);
 end if;
 return r;
end$$;

-- Preserve the assigned-doctor authority, current attachment check and access audit.
create or replace function public.doctor_mismatched_uploads(p_member uuid default null)returns jsonb
language plpgsql volatile security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();me uuid;rows jsonb;
begin
 if who is null or who->>'role' is distinct from 'doctor'then
  raise insufficient_privilege using message='Assigned doctor session required';end if;
 me:=(who->>'id')::uuid;
 if p_member is not null and not exists(select 1 from public.patient_clinical_cases k
  where k.user_id=p_member and k.assigned_doctor_id=me and public.staff_care_access(k.user_id,me,true))then
  raise insufficient_privilege using message='Member access required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('fileId',o.file_id,'fileName',f.name,'at',o.created_at,
  'clinicName',c.name,'mismatch',o.mismatch,'reason',o.reason,'sheet',o.sheet,'member',o.member_values,'current',true,
  'memberId',o.member_id,'memberName',coalesce(p.display_name,''),'jobState',j.state,
  'noValuesRead',coalesce(j.state='done'and not exists(select 1 from public.lab_ai_values v where v.job_id=j.id),false))order by o.created_at,o.id),'[]'::jsonb)
 into rows
 from public.clinic_upload_overrides o
 join public.patient_clinical_cases k on k.user_id=o.member_id
 join public.clinic_batch_files f on f.id=o.file_id
 join public.workspace_clinics c on c.id=o.clinic_id
 left join public.profiles p on p.id=o.member_id
 left join public.lab_ai_jobs j on j.attachment_id=o.attachment_id
 where k.assigned_doctor_id=me and(p_member is null or o.member_id=p_member)
  and public.staff_care_access(k.user_id,me,true)and public._lab_ai_current(o.attachment_id)
  and j.identity_confirmed_at is null;
 perform public._access_audit_record(mid,'member_upload_overrides',null)
 from(select distinct(x->>'memberId')::uuid mid from jsonb_array_elements(rows)x)q;
 return rows;
end$$;
