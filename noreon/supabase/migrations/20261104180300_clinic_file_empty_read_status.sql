-- C-17: expose only a boolean read status, never values, counts or source content.
-- Ported onto 20261104173200_clinic_pdf_phone_lockdown.sql, preserving masking and guards.
-- Placeholder stamp requested by the lead; the integrator assigns the final timestamp.
create or replace function public._clinic_member_file_json(c uuid,mm uuid,f public.clinic_batch_files,p_state text,p_upload boolean)returns jsonb
language sql volatile security definer set search_path=''as $$
 select jsonb_build_object('fileId',f.id,'name','PDF '||to_char(f.created_at at time zone 'Asia/Yerevan','YYYY-MM-DD')||'.pdf','uploadedAt',f.created_at,'fromRecord',p_upload,'state',p_state,
  'attached',cur.id is not null and cur.user_id=mm and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id),
  'override',exists(select 1 from public.clinic_upload_overrides o where o.file_id=f.id and o.member_id=mm),
  'fileReading',(select j.state from public.lab_ai_jobs j where j.kind='file'and j.file_id=f.id),
  'memberReading',(select j.state from public.lab_ai_jobs j where j.kind='attachment'and j.attachment_id=cur.id),
  -- Prefer the current member read, including a successful retry of an unreadable file.
  -- A removed or moved attachment must not disclose another member's reading status.
  'noValuesRead',case
   when cur.id is null and exists(select 1 from public.clinic_result_attachments a where a.file_id=f.id)then false
   when cur.id is not null and cur.user_id<>mm then false
   else coalesce(
    (select (j.state='done'and not exists(select 1 from public.lab_ai_values v where v.job_id=j.id))
      or(j.state in('done','failed')and j.outcome='unreadable')
     from public.lab_ai_jobs j where j.kind='attachment'and j.attachment_id=cur.id),
    (select j.state in('done','failed')and j.outcome='unreadable'
     from public.lab_ai_jobs j where j.kind='file'and j.file_id=f.id),false)end,
  'readingOn',public._lab_ai_enabled(),
  'compare',case when cur.id is null then public._clinic_member_comparison_masked(public._clinic_member_file_check(c,f.id,mm))end)
 from(select(public._clinic_result_current(f.id)).*)cur
$$;
